/**
 * Task rules as pure functions: which fields an edit changed, and whether a
 * new list of predecessors is acceptable (same organization, no self
 * reference, no cycle). No database, no HTTP.
 *
 * Status: any status may change to any other, like events (a task marked done
 * by mistake can be reopened); the activity log keeps the trail. Warnings
 * (overlaps, heavy loads, routes) are computed by the UI from
 * `shared/logistics/conflicts.ts`; they never block a save.
 */
import {findCycle} from '../../../shared/logistics/schedule.ts';
import {changedFields} from '../records/slot.ts';
import type {
  DataSource,
  IsoInstant,
  LocalDate,
  TaskKind,
  TaskStatus,
  Uuid,
  Verification,
} from '../../../shared/logistics/contracts.ts';

// Single source shared with the UI; re-exported for server modules.
export {TASK_KINDS, TASK_STATUSES} from '../../../shared/logistics/rules.ts';

/** Predecessors per task; generous for a real plan, small enough to check. */
export const MAX_DEPENDENCIES = 50;

/** The editable state of a task, in comparable form. */
export interface TaskState {
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  eventId: Uuid | null;
  venueId: Uuid | null;
  companyId: Uuid | null;
  contactId: Uuid | null;
  localDate: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  /** Sorted ids. */
  dependsOn: Uuid[];
  heavyLoad: boolean | null;
  /** Sorted ids. */
  resourceIds: Uuid[];
  /** «Subsuelo revisado en el simulador»: who declared it and when, or null. */
  subsoilReviewedBy: Uuid | null;
  subsoilReviewedAt: IsoInstant | null;
  notes: string | null;
  source: DataSource | null;
  verification: Verification;
}

/** Contract field names, in a stable order, for the activity log. */
const FIELD_NAMES: readonly (readonly [keyof TaskState, string])[] = [
  ['title', 'title'],
  ['kind', 'kind'],
  ['status', 'status'],
  ['eventId', 'eventId'],
  ['venueId', 'venue'],
  ['companyId', 'company'],
  ['contactId', 'contact'],
  ['localDate', 'date'],
  ['endDate', 'endDate'],
  ['startsAt', 'startsAt'],
  ['endsAt', 'endsAt'],
  ['timezone', 'timezone'],
  ['dependsOn', 'dependsOn'],
  ['heavyLoad', 'heavyLoad'],
  ['resourceIds', 'resourceIds'],
  // Both columns are one contract field.
  ['subsoilReviewedBy', 'subsoilReview'],
  ['subsoilReviewedAt', 'subsoilReview'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

export function changedTaskFields(
  before: TaskState,
  after: TaskState,
): string[] {
  return [...new Set(changedFields(before, after, FIELD_NAMES))];
}

export const SUBSOIL_NEEDS_HEAVY_LOAD =
  'Solo se puede declarar en una tarea con carga pesada.';

/**
 * The declared subsoil review after an edit, or a Spanish message for
 * `fields.subsoilReviewed`. Pure: no database.
 *
 * - The mark is declared by a person, never inferred: only
 *   `subsoilReviewed: true` sets it (to `actor` at `now`), only on a task whose
 *   resulting `heavyLoad` is `true`. `false` withdraws it (same condition).
 * - The review was for one placement and one set of material, so changing the
 *   venue, `heavyLoad` or the resources clears it, unless the same request
 *   declares it again (then it is renewed to `actor` at `now`).
 * - Declaring it again with nothing else relevant changed keeps the original
 *   declaration (who and when), so a repeated save is not a change.
 */
export function nextSubsoilReview(args: {
  before: Pick<TaskState, 'venueId' | 'heavyLoad' | 'resourceIds'> & {
    review: {by: Uuid; at: IsoInstant} | null;
  };
  after: Pick<TaskState, 'venueId' | 'heavyLoad' | 'resourceIds'>;
  requested: boolean | undefined;
  actorId: Uuid;
  now: IsoInstant;
}):
  | {ok: true; review: {by: Uuid; at: IsoInstant} | null}
  | {
      ok: false;
      message: string;
    } {
  const {before, after, requested} = args;
  if (requested !== undefined && after.heavyLoad !== true) {
    return {ok: false, message: SUBSOIL_NEEDS_HEAVY_LOAD};
  }
  const placementChanged =
    before.venueId !== after.venueId ||
    before.heavyLoad !== after.heavyLoad ||
    before.resourceIds.length !== after.resourceIds.length ||
    before.resourceIds.some((id, i) => id !== after.resourceIds[i]);
  if (requested === false) return {ok: true, review: null};
  if (requested === true) {
    return {
      ok: true,
      review:
        before.review && !placementChanged
          ? before.review
          : {by: args.actorId, at: args.now},
    };
  }
  return {ok: true, review: placementChanged ? null : before.review};
}

export {normalizeIds} from '../records/ids.ts';

export const DEPENDS_ON_SELF = 'Una tarea no puede depender de sí misma.';
export const DEPENDS_ON_UNKNOWN =
  'Alguna de las tareas previas ya no existe o no es de esta organización.';

export interface GraphTask {
  id: Uuid;
  title: string;
  dependsOn: Uuid[];
}

/**
 * Checks a new predecessor list for `taskId` (null when the task is being
 * created) against the organization's current graph. Returns a Spanish
 * message for `fields.dependsOn`, or null when it is acceptable.
 */
export function dependencyProblem(
  taskId: Uuid | null,
  dependsOn: readonly Uuid[],
  graph: readonly GraphTask[],
): string | null {
  if (taskId && dependsOn.includes(taskId)) return DEPENDS_ON_SELF;
  const byId = new Map(graph.map(t => [t.id, t]));
  if (dependsOn.some(id => !byId.has(id))) return DEPENDS_ON_UNKNOWN;
  // A task being created has no successors yet, so it cannot close a cycle.
  if (!taskId) return null;
  const items = graph.map(t => ({
    id: t.id,
    label: t.title,
    startsAt: null,
    endsAt: null,
    lane: null,
    dependsOn: t.id === taskId ? [...dependsOn] : t.dependsOn,
  }));
  const cycle = findCycle(items);
  if (!cycle) return null;
  const path = cycle.map(id => `«${byId.get(id)?.title ?? id}»`).join(' → ');
  return `Esa dependencia crearía un ciclo: ${path}. Cada tarea esperaría a la siguiente y ninguna podría empezar.`;
}
