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
  localDate: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  /** Sorted ids. */
  dependsOn: Uuid[];
  heavyLoad: boolean | null;
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
  ['localDate', 'date'],
  ['endDate', 'endDate'],
  ['startsAt', 'startsAt'],
  ['endsAt', 'endsAt'],
  ['timezone', 'timezone'],
  ['dependsOn', 'dependsOn'],
  ['heavyLoad', 'heavyLoad'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

export function changedTaskFields(
  before: TaskState,
  after: TaskState,
): string[] {
  return changedFields(before, after, FIELD_NAMES);
}

/** Lower-case, de-duplicated and sorted, so lists compare reliably. */
export function normalizeIds(ids: readonly string[]): Uuid[] {
  return [...new Set(ids.map(id => id.toLowerCase()))].sort();
}

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
