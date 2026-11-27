/**
 * Moving a task in time (Revisión 1 · E2): a calendar drag, its keyboard
 * equivalent, a conflict exit («Retrasar la segunda», «Adelantar la
 * primera») or «Deshacer» of one of those.
 *
 * Like applying a delay hypothesis, a move takes the organization's graph
 * lock and then the organization's task rows in id order, recomputes the
 * move on the current plan with the shared `simulateMove` and writes it only
 * if it is exactly what the member confirmed (`sameShift`); otherwise 409
 * with the involved tasks as they are now, and nothing changes.
 *
 * A move only writes times and the local days that follow from them. It
 * never touches status, heavy load, the declared subsoil review (still the
 * same venue and material), the venue or the resources, so heavy-load and
 * route reminders keep being computed from the plan as before. A move whose
 * task would end up outside its venue's known opening hours is refused
 * (400 `fields.minutes`); unknown hours limit nothing.
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {plannedWrites} from '../hypotheses/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {lockGraph} from '../records/locks.ts';
import {hoursOf, placeColumns} from '../records/places.ts';
import type {PlaceColumns} from '../records/places.ts';
import {loadTasksByIds, loadTasksForPlan} from './service.ts';
import type {MoveTaskBody} from './move-schemas.ts';
import {
  sameShift,
  shiftExpectations,
} from '../../../shared/logistics/followup.ts';
import {
  MOVE_BLOCKED,
  moveBlocker,
  moveItems,
  outsideHoursMessage,
  withinOpeningHours,
} from '../../../shared/logistics/move.ts';
import {MAX_DELAY_MINUTES} from '../../../shared/logistics/rules.ts';
import {simulateMove} from '../../../shared/logistics/schedule.ts';
import type {
  MoveOrigin,
  MoveTaskResponse,
  SessionUser,
  ShiftExpectation,
  Task,
} from '../../../shared/logistics/contracts.ts';

export const MOVE_PLAN_CHANGED =
  'El plan ha cambiado desde que revisaste este cambio de hora. Mira de nuevo qué tareas se mueven antes de confirmarlo.';
export const UNDO_PLAN_CHANGED =
  'Alguna de estas tareas ha cambiado desde que se movió: ya no se puede deshacer de golpe. Revísalas una a una.';
const UNDO_TOO_FAR = `«Deshacer» solo devuelve tareas movidas como mucho ${MAX_DELAY_MINUTES / 60} horas.`;

const MIN = 60_000;
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

function taskNotFound(): AppError {
  return notFound('No encontramos esa tarea: puede que se haya eliminado.');
}

/** The task's organization, if the actor is a member of it. */
async function ownOrganization(
  tx: Queryable,
  actor: SessionUser,
  taskId: string,
) {
  const rows = await tx.query<{organization_id: string}>(
    'SELECT organization_id FROM tasks WHERE id = $1',
    [taskId],
  );
  const row = rows[0];
  if (!row) throw taskNotFound();
  try {
    return await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw taskNotFound();
  }
}

async function conflict(
  tx: Queryable,
  orgId: string,
  tasks: Task[],
  ids: string[],
  actor: SessionUser,
  message: string,
): Promise<AppError> {
  // Client-sent ids are kept only when they are this organization's tasks.
  const own = new Set(tasks.map(t => t.id));
  const involved = [...new Set(ids)].filter(id => own.has(id));
  return new AppError('VERSION_CONFLICT', message, {
    current: await loadTasksByIds(tx, orgId, involved, actor),
  });
}

/**
 * Writes new windows (and the local days they give) for each task, in id
 * order, logging each as `update` with the fields that changed and `origin`.
 */
async function writeWindows(
  tx: Queryable,
  args: {
    orgId: string;
    tasks: Task[];
    rootId: string;
    windows: ShiftExpectation[];
    actor: SessionUser;
    now: Date;
    origin: MoveOrigin;
  },
): Promise<string[]> {
  const writes = plannedWrites({
    tasks: args.tasks,
    rootId: args.rootId,
    shifted: args.windows,
    markDelayed: false,
  })
    .filter(w => w.changedFields.length > 0)
    .sort((a, b) => (a.task.id < b.task.id ? -1 : 1));
  for (const w of writes) {
    const updated = await tx.query<{id: string}>(
      `UPDATE tasks
          SET starts_at = $3::timestamptz, ends_at = $4::timestamptz,
              local_date = $5::date, end_date = $6::date,
              version = version + 1, updated_by = $7,
              updated_at = $8::timestamptz
        WHERE id = $1 AND version = $2
        RETURNING id`,
      [
        w.task.id,
        w.task.version,
        w.startsAt,
        w.endsAt,
        w.date,
        w.endDate,
        args.actor.id,
        args.now.toISOString(),
      ],
    );
    if (updated.length === 0) {
      // Unreachable while the rows are locked; kept as a safety net (the
      // transaction rolls back, so nothing is written).
      throw await conflict(
        tx,
        args.orgId,
        args.tasks,
        [w.task.id],
        args.actor,
        MOVE_PLAN_CHANGED,
      );
    }
    await appendActivity(tx, {
      organizationId: args.orgId,
      userId: args.actor.id,
      entityType: 'task',
      entityId: w.task.id,
      entityLabel: w.task.title,
      action: 'update',
      changedFields: w.changedFields,
      at: args.now,
      isDemo: w.task.isDemo,
      origin: args.origin,
    });
  }
  return writes.map(w => w.task.id);
}

/**
 * Moves a task by `minutes` if the move recomputed now is exactly the one
 * the member confirmed; «Deshacer» (`origin: 'undo'`) puts the tasks of a
 * move back if none of them changed since.
 */
export async function moveTask(
  db: Db,
  actor: SessionUser,
  id: string,
  input: MoveTaskBody,
  now: Date,
): Promise<MoveTaskResponse> {
  if (!isUuid(id)) throw taskNotFound();
  const rootId = id.toLowerCase();
  return db.transaction(async tx => {
    const org = await ownOrganization(tx, actor, rootId);
    // Same order as every multi-task writer: graph lock, then task rows by id.
    await lockGraph(tx, org.id);
    await tx.query(
      'SELECT id FROM tasks WHERE organization_id = $1 ORDER BY id FOR UPDATE',
      [org.id],
    );
    const tasks = await loadTasksForPlan(tx, org.id);
    const root = tasks.find(t => t.id === rootId);
    if (!root) throw taskNotFound();
    const write = (windows: ShiftExpectation[]) =>
      writeWindows(tx, {
        orgId: org.id,
        tasks,
        rootId,
        windows,
        actor,
        now,
        origin: input.origin,
      });
    const answer = async (ids: string[]): Promise<MoveTaskResponse> => ({
      tasks: await loadTasksByIds(tx, org.id, ids, actor),
    });

    if (input.origin === 'undo') {
      const byId = new Map(tasks.map(t => [t.id, t]));
      const fits = input.expected.every(e => {
        const t = byId.get(e.id);
        return (
          !!t &&
          t.version === e.version &&
          ms(e.endsAt) - ms(e.startsAt) === ms(t.endsAt) - ms(t.startsAt)
        );
      });
      if (!fits || !input.expected.some(e => e.id === rootId)) {
        throw await conflict(
          tx,
          org.id,
          tasks,
          [rootId, ...input.expected.map(e => e.id)],
          actor,
          UNDO_PLAN_CHANGED,
        );
      }
      const tooFar = input.expected.some(e => {
        const t = byId.get(e.id) as Task;
        return (
          Math.abs(ms(e.startsAt) - ms(t.startsAt)) > MAX_DELAY_MINUTES * MIN
        );
      });
      if (tooFar) throw validationError({minutes: UNDO_TOO_FAR});
      return answer(await write(input.expected));
    }

    const blocker = moveBlocker(root);
    if (blocker) throw validationError({minutes: MOVE_BLOCKED[blocker]});
    const impact = simulateMove(moveItems(tasks), rootId, input.minutes);
    const computed = shiftExpectations(impact, tasks);
    if (computed.length === 0 || !sameShift(input.expected, computed)) {
      throw await conflict(
        tx,
        org.id,
        tasks,
        [rootId, ...input.expected.map(e => e.id), ...computed.map(c => c.id)],
        actor,
        MOVE_PLAN_CHANGED,
      );
    }
    if (root.venue) {
      const [venue] = await tx.query<PlaceColumns & {name: string}>(
        `SELECT v.name, ${placeColumns('v')} FROM venues v WHERE v.id = $1`,
        [root.venue.id],
      );
      const hours = venue ? hoursOf(venue) : null;
      const moved = computed.find(c => c.id === rootId);
      if (
        venue &&
        hours &&
        moved &&
        !withinOpeningHours(moved, hours, org.timezone)
      ) {
        throw validationError(
          {minutes: outsideHoursMessage(venue.name, hours)},
          outsideHoursMessage(venue.name, hours),
        );
      }
    }
    return answer(await write(computed));
  });
}
