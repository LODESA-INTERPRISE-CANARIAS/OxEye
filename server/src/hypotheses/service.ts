/**
 * Delay hypotheses («¿Y si…?», milestone 5): stored scenarios that never
 * change the plan until a member applies one after confirming what moves.
 *
 * Applying recomputes the shift on the server with the same shared functions
 * the UI used (`delayItems`, `simulateDelay`, `shiftExpectations`) and writes
 * it only if it equals what the member confirmed (`sameShift`: same tasks,
 * versions and new times). Otherwise it answers 409 with the involved tasks as
 * they are now and changes nothing. A hypothesis only moves times (and, when
 * asked, marks the delayed task «Con retraso»): it never touches heavy load,
 * the declared subsoil review, resources or dependencies.
 *
 * Every write holds the organization's graph lock (task deletes, which detach
 * hypotheses, hold it too), and applying also locks the organization's task
 * rows in id order before reading them, so no task edit can slip in between
 * the check and the write. Activity is labelled with `hypothesisLabel`, never
 * the note; the note is withheld from guests (records/redact.ts).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso, toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {lockGraph} from '../records/locks.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {loadTasksByIds, loadTasksForPlan} from '../tasks/service.ts';
import {
  delayBlocker,
  delayItems,
  sameShift,
  shiftExpectations,
} from '../../../shared/logistics/followup.ts';
import {hypothesisLabel} from '../../../shared/logistics/history.ts';
import {simulateDelay} from '../../../shared/logistics/schedule.ts';
import {daysForInstants} from '../../../shared/logistics/time.ts';
import type {ApplyHypothesisBody, CreateHypothesisBody} from './schemas.ts';
import type {
  ApplyHypothesisResponse,
  DelayHypothesis,
  DelayMode,
  SessionUser,
  Task,
  TaskStatus,
} from '../../../shared/logistics/contracts.ts';

interface HypothesisRow {
  id: string;
  organization_id: string;
  task_id: string | null;
  task_title: string;
  delay_minutes: number;
  mode: DelayMode;
  estimated: boolean;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: unknown;
  applied_by: string | null;
  applied_by_name: string | null;
  applied_at: unknown;
  is_demo: boolean;
}

const SELECT_HYPOTHESIS = `
  SELECT h.id, h.organization_id, h.task_id, h.task_title, h.delay_minutes,
         h.mode, h.estimated, h.note, h.created_by,
         cu.display_name AS created_by_name, h.created_at, h.applied_by,
         au.display_name AS applied_by_name, h.applied_at, h.is_demo
    FROM hypotheses h
    JOIN users cu ON cu.id = h.created_by
    LEFT JOIN users au ON au.id = h.applied_by`;

export const TASK_NOT_FOUND =
  'No encontramos esa tarea en esta organización: puede que se haya eliminado.';

/** Why a task cannot be delayed, in plain Spanish (`delayBlocker`). */
export const DELAY_BLOCKED: Record<
  NonNullable<ReturnType<typeof delayBlocker>>,
  string
> = {
  finished: 'Esa tarea ya está hecha: no se puede retrasar.',
  cancelled: 'Esa tarea está cancelada: no se puede retrasar.',
  untimed:
    'Esa tarea no tiene hora de inicio y de fin: ponle horario para poder calcular un retraso.',
};

export const ALREADY_APPLIED =
  'Esta hipótesis ya se aplicó al plan: se conserva como registro de la decisión.';

export const PLAN_CHANGED =
  'El plan ha cambiado desde que revisaste esta hipótesis. Mira de nuevo qué tareas se mueven antes de aplicarla.';

/** Statuses the «Con retraso» mark replaces (a task not started yet). */
const MARKABLE: ReadonlySet<TaskStatus> = new Set(['planned', 'confirmed']);

/** The single row → record mapping; the viewer decides what is withheld. */
function toHypothesis(row: HypothesisRow, viewer: Viewer): DelayHypothesis {
  return forViewer(
    'hypothesis',
    {
      id: row.id,
      organizationId: row.organization_id,
      taskId: row.task_id,
      taskTitle: row.task_title,
      delayMinutes: Number(row.delay_minutes),
      mode: row.mode,
      estimated: Boolean(row.estimated),
      note: row.note,
      createdBy: {id: row.created_by, displayName: row.created_by_name},
      createdAt: toIso(row.created_at),
      appliedAt: toIsoOrNull(row.applied_at),
      appliedBy:
        row.applied_by && row.applied_by_name !== null
          ? {id: row.applied_by, displayName: row.applied_by_name}
          : null,
    },
    viewer,
  );
}

function labelOf(row: HypothesisRow): string {
  return hypothesisLabel({
    delayMinutes: Number(row.delay_minutes),
    mode: row.mode,
    estimated: Boolean(row.estimated),
    taskTitle: row.task_title,
  });
}

function hypothesisNotFound(): AppError {
  return notFound(
    'No encontramos esa hipótesis: puede que se haya descartado o que su tarea se haya eliminado.',
  );
}

/** Newest first. */
export async function listHypotheses(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<DelayHypothesis[]> {
  const rows = await db.query<HypothesisRow>(
    `${SELECT_HYPOTHESIS}
      WHERE h.organization_id = $1
      ORDER BY h.created_at DESC, h.id DESC`,
    [organizationId],
  );
  return rows.map(r => toHypothesis(r, viewer));
}

async function loadHypothesis(
  db: Queryable,
  id: string,
  lock = false,
): Promise<HypothesisRow | undefined> {
  const rows = await db.query<HypothesisRow>(
    `${SELECT_HYPOTHESIS} WHERE h.id = $1${lock ? ' FOR UPDATE OF h' : ''}`,
    [id],
  );
  return rows[0];
}

/** Loads the hypothesis and checks membership; foreign ones are «not found». */
async function loadOwnHypothesis(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<HypothesisRow> {
  if (!isUuid(id)) throw hypothesisNotFound();
  const row = await loadHypothesis(tx, id);
  if (!row) throw hypothesisNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw hypothesisNotFound();
  }
  return row;
}

/** Stores a hypothesis; the plan does not change. */
export async function createHypothesis(
  db: Db,
  actor: SessionUser,
  input: CreateHypothesisBody,
  now: Date,
): Promise<DelayHypothesis> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    // Task deletes detach hypotheses under this lock.
    await lockGraph(tx, org.id);
    const [task] = await loadTasksByIds(tx, org.id, [input.taskId], actor);
    if (!task) throw validationError({taskId: TASK_NOT_FOUND});
    const blocker = delayBlocker(task);
    if (blocker) throw validationError({taskId: DELAY_BLOCKED[blocker]});

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO hypotheses
         (organization_id, task_id, task_title, delay_minutes, mode, estimated,
          note, created_by, created_at, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)
       RETURNING id`,
      [
        org.id,
        task.id,
        task.title,
        input.delayMinutes,
        input.mode,
        input.estimated,
        input.note ?? null,
        actor.id,
        now.toISOString(),
        task.isDemo,
      ],
    );
    const row = (await loadHypothesis(
      tx,
      (inserted[0] as {id: string}).id,
    )) as HypothesisRow;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'hypothesis',
      entityId: row.id,
      entityLabel: labelOf(row),
      action: 'create',
      at: now,
      isDemo: row.is_demo,
    });
    return toHypothesis(row, actor);
  });
}

/** Discards an open hypothesis; applied ones stay as a record (400). */
export async function deleteHypothesis(
  db: Db,
  actor: SessionUser,
  id: string,
  now: Date,
): Promise<void> {
  await db.transaction(async tx => {
    const unlocked = await loadOwnHypothesis(tx, actor, id);
    await lockGraph(tx, unlocked.organization_id);
    const row = await loadHypothesis(tx, id, true);
    if (!row) throw hypothesisNotFound();
    if (row.applied_at != null) {
      throw new AppError('VALIDATION', ALREADY_APPLIED);
    }
    await tx.query('DELETE FROM hypotheses WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: row.organization_id,
      userId: actor.id,
      entityType: 'hypothesis',
      entityId: row.id,
      entityLabel: labelOf(row),
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}

/** One task's change under the hypothesis, as stored values. */
interface TaskShift {
  task: Task;
  startsAt: string;
  endsAt: string;
  date: string;
  endDate: string | null;
  status: TaskStatus;
  changedFields: string[];
}

/**
 * What applying writes for each moved task: new instants, the stored local
 * days derived from them in the task's time zone, and the root's status when
 * `markDelayed` (only a task not started yet becomes «Con retraso»). Pure.
 */
export function plannedWrites(args: {
  tasks: Task[];
  rootId: string;
  shifted: {id: string; startsAt: string; endsAt: string}[];
  markDelayed: boolean;
}): TaskShift[] {
  const byId = new Map(args.tasks.map(t => [t.id, t]));
  return args.shifted.map(s => {
    const task = byId.get(s.id) as Task;
    const days = daysForInstants(s.startsAt, s.endsAt, task.timezone);
    const status =
      s.id === args.rootId && args.markDelayed && MARKABLE.has(task.status)
        ? 'delayed'
        : task.status;
    const same = (a: string | null, b: string | null) =>
      a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));
    const changedFields = [
      ...(task.status !== status ? ['status'] : []),
      ...(task.date !== days.date ? ['date'] : []),
      ...(task.endDate !== days.endDate ? ['endDate'] : []),
      ...(same(task.startsAt, s.startsAt) ? [] : ['startsAt']),
      ...(same(task.endsAt, s.endsAt) ? [] : ['endsAt']),
    ];
    return {
      task,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      date: days.date,
      endDate: days.endDate,
      status,
      changedFields,
    };
  });
}

/**
 * Applies a hypothesis if the shift recomputed now is exactly the one the
 * member confirmed; otherwise 409 with the involved tasks and nothing changes.
 */
export async function applyHypothesis(
  db: Db,
  actor: SessionUser,
  id: string,
  input: ApplyHypothesisBody,
  now: Date,
): Promise<ApplyHypothesisResponse> {
  return db.transaction(async tx => {
    const unlocked = await loadOwnHypothesis(tx, actor, id);
    const orgId = unlocked.organization_id;
    // Same order as every multi-task writer: graph lock, then task rows by id.
    await lockGraph(tx, orgId);
    await tx.query(
      'SELECT id FROM tasks WHERE organization_id = $1 ORDER BY id FOR UPDATE',
      [orgId],
    );
    const row = await loadHypothesis(tx, id, true);
    if (!row) throw hypothesisNotFound();
    if (row.applied_at != null) {
      throw new AppError('VALIDATION', ALREADY_APPLIED);
    }

    const tasks = await loadTasksForPlan(tx, orgId);
    const root = row.task_id
      ? tasks.find(t => t.id === row.task_id)
      : undefined;
    const impact =
      root && !delayBlocker(root)
        ? simulateDelay(
            delayItems(tasks, root.id),
            root.id,
            Number(row.delay_minutes),
            row.mode,
          )
        : null;
    const computed = impact ? shiftExpectations(impact, tasks) : [];
    if (!root || !impact || !sameShift(input.expected, computed)) {
      // Client-sent ids are kept only when they are this organization's
      // tasks (loadTasksByIds filters by organization too).
      const own = new Set(tasks.map(t => t.id));
      const involved = new Set(
        [
          ...input.expected.map(e => e.id),
          ...computed.map(c => c.id),
          ...(row.task_id ? [row.task_id] : []),
        ].filter(taskId => own.has(taskId)),
      );
      throw new AppError('VERSION_CONFLICT', PLAN_CHANGED, {
        current: await loadTasksByIds(tx, orgId, [...involved], actor),
      });
    }

    const writes = plannedWrites({
      tasks,
      rootId: root.id,
      shifted: computed,
      markDelayed: input.markDelayed,
    }).sort((a, b) => (a.task.id < b.task.id ? -1 : 1));
    for (const w of writes) {
      const updated = await tx.query<{id: string}>(
        `UPDATE tasks
            SET starts_at = $3::timestamptz, ends_at = $4::timestamptz,
                local_date = $5::date, end_date = $6::date, status = $7,
                version = version + 1, updated_by = $8,
                updated_at = $9::timestamptz
          WHERE id = $1 AND version = $2
          RETURNING id`,
        [
          w.task.id,
          w.task.version,
          w.startsAt,
          w.endsAt,
          w.date,
          w.endDate,
          w.status,
          actor.id,
          now.toISOString(),
        ],
      );
      if (updated.length === 0) {
        // Unreachable while the rows are locked; kept as a safety net (the
        // transaction rolls back, so nothing is applied).
        throw new AppError('VERSION_CONFLICT', PLAN_CHANGED, {
          current: await loadTasksByIds(tx, orgId, [w.task.id], actor),
        });
      }
      await appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType: 'task',
        entityId: w.task.id,
        entityLabel: w.task.title,
        action: 'update',
        changedFields: w.changedFields,
        at: now,
        isDemo: w.task.isDemo,
      });
    }
    await tx.query(
      `UPDATE hypotheses SET applied_at = $2::timestamptz, applied_by = $3
        WHERE id = $1`,
      [id, now.toISOString(), actor.id],
    );
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'hypothesis',
      entityId: row.id,
      entityLabel: labelOf(row),
      action: 'update',
      changedFields: ['appliedAt'],
      at: now,
      isDemo: row.is_demo,
    });
    return {
      hypothesis: toHypothesis(
        (await loadHypothesis(tx, id)) as HypothesisRow,
        actor,
      ),
      tasks: await loadTasksByIds(
        tx,
        orgId,
        writes.map(w => w.task.id),
        actor,
      ),
    };
  });
}
