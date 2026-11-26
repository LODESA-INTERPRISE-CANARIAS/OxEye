/**
 * Tasks: list, create (only the title is required), edit and delete with
 * optimistic concurrency. Every write appends to the activity log in the same
 * transaction.
 *
 * Writes that change the dependency graph of an organization take a
 * transaction-level advisory lock first, so two people linking tasks at the
 * same time cannot build a cycle between them. The lock is always taken
 * before any row lock, which keeps lock order consistent (no deadlocks).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {findCompany, findOrCreateCompany} from '../companies/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {normalizeName, promoteDemo} from '../records/find-or-create.ts';
import type {NamedRef} from '../records/find-or-create.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {resolveSlot, storedToLocal, touchesSlot} from '../records/slot.ts';
import type {StoredSlot} from '../records/slot.ts';
import {findOrCreateVenue} from '../venues/service.ts';
import {changedTaskFields, dependencyProblem, normalizeIds} from './domain.ts';
import type {GraphTask, TaskState} from './domain.ts';
import type {CreateTaskBody, UpdateTaskBody} from './schemas.ts';
import type {
  SessionUser,
  Task,
  TaskKind,
  TaskStatus,
} from '../../../shared/logistics/contracts.ts';

interface TaskRow extends MetaRow {
  organization_id: string;
  event_id: string | null;
  venue_id: string | null;
  venue_name: string | null;
  company_id: string | null;
  company_name: string | null;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  local_date: string | null;
  end_date: string | null;
  starts_at: unknown;
  ends_at: unknown;
  timezone: string;
  heavy_load: boolean | null;
  notes: string | null;
  depends_on: unknown;
}

const SELECT_TASK = `
  SELECT ${metaColumns('t')}, t.organization_id, t.event_id,
         t.venue_id, v.name AS venue_name, t.company_id, c.name AS company_name,
         t.title, t.kind, t.status,
         t.local_date::text AS local_date, t.end_date::text AS end_date,
         t.starts_at, t.ends_at, t.timezone, t.heavy_load, t.notes,
         COALESCE((SELECT jsonb_agg(d.depends_on_id ORDER BY d.depends_on_id)
                     FROM task_dependencies d WHERE d.task_id = t.id),
                  '[]'::jsonb) AS depends_on
    FROM tasks t
    LEFT JOIN venues v ON v.id = t.venue_id
    LEFT JOIN companies c ON c.id = t.company_id
    ${authorJoins('t')}`;

/** Namespace of the per-organization dependency-graph lock. */
const GRAPH_LOCK_CLASS = 727_274_002;

export const EVENT_NOT_FOUND =
  'No encontramos ese evento en esta organización: puede que se haya eliminado.';
export const COMPANY_NOT_FOUND =
  'No encontramos esa empresa en esta organización: puede que se haya eliminado.';

function parseIds(value: unknown): string[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list) ? normalizeIds(list.map(String)) : [];
}

function toTask(row: TaskRow): Task {
  return {
    ...toMeta(row),
    organizationId: row.organization_id,
    eventId: row.event_id,
    venue:
      row.venue_id && row.venue_name
        ? {id: row.venue_id, name: row.venue_name}
        : null,
    title: row.title,
    kind: row.kind,
    status: row.status,
    date: row.local_date,
    endDate: row.end_date,
    startsAt: toIsoOrNull(row.starts_at),
    endsAt: toIsoOrNull(row.ends_at),
    timezone: row.timezone,
    company:
      row.company_id && row.company_name
        ? {id: row.company_id, name: row.company_name}
        : null,
    // Contacts arrive in milestone 3.
    contact: null,
    dependsOn: parseIds(row.depends_on),
    heavyLoad: row.heavy_load,
    notes: row.notes,
  };
}

function storedSlot(row: TaskRow): StoredSlot {
  return {
    localDate: row.local_date,
    endDate: row.end_date,
    startsAt: toIsoOrNull(row.starts_at),
    endsAt: toIsoOrNull(row.ends_at),
  };
}

function stateOf(row: TaskRow): TaskState {
  return {
    title: row.title,
    kind: row.kind,
    status: row.status,
    eventId: row.event_id,
    venueId: row.venue_id,
    companyId: row.company_id,
    ...storedSlot(row),
    timezone: row.timezone,
    dependsOn: parseIds(row.depends_on),
    heavyLoad: row.heavy_load,
    notes: row.notes,
    source: row.source,
    verification: row.verification,
  };
}

/**
 * All tasks of the organization, or of one event. Sorted like events: local
 * date, then start, undated last, then title.
 */
export async function listTasks(
  db: Queryable,
  organizationId: string,
  eventId: string | null = null,
): Promise<Task[]> {
  const rows = await db.query<TaskRow>(
    `${SELECT_TASK}
      WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.event_id = $2::uuid)
      ORDER BY t.local_date ASC NULLS LAST, t.starts_at ASC NULLS LAST,
               lower(t.title), t.id`,
    [organizationId, eventId],
  );
  return rows.map(toTask);
}

async function loadTask(
  db: Queryable,
  id: string,
  lock = false,
): Promise<TaskRow | undefined> {
  const rows = await db.query<TaskRow>(
    `${SELECT_TASK} WHERE t.id = $1${lock ? ' FOR UPDATE OF t' : ''}`,
    [id],
  );
  return rows[0];
}

function taskNotFound(): AppError {
  return notFound('No encontramos esa tarea: puede que se haya eliminado.');
}

function staleTask(row: TaskRow): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado esta tarea mientras la editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toTask(row)},
  );
}

async function lockGraph(tx: Queryable, organizationId: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [
    GRAPH_LOCK_CLASS,
    organizationId,
  ]);
}

async function loadGraph(
  tx: Queryable,
  organizationId: string,
): Promise<GraphTask[]> {
  const rows = await tx.query<{id: string; title: string; depends_on: unknown}>(
    `SELECT t.id, t.title,
            COALESCE((SELECT jsonb_agg(d.depends_on_id) FROM task_dependencies d
                       WHERE d.task_id = t.id), '[]'::jsonb) AS depends_on
       FROM tasks t WHERE t.organization_id = $1`,
    [organizationId],
  );
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    dependsOn: parseIds(r.depends_on),
  }));
}

async function findEvent(
  tx: Queryable,
  organizationId: string,
  id: string,
): Promise<{id: string; timezone: string} | undefined> {
  const rows = await tx.query<{id: string; timezone: string}>(
    'SELECT id, timezone FROM events WHERE id = $1 AND organization_id = $2',
    [id, organizationId],
  );
  return rows[0];
}

async function writeDependencies(
  tx: Queryable,
  taskId: string,
  dependsOn: string[],
): Promise<void> {
  await tx.query('DELETE FROM task_dependencies WHERE task_id = $1', [taskId]);
  if (dependsOn.length === 0) return;
  await tx.query(
    `INSERT INTO task_dependencies (task_id, depends_on_id)
     SELECT $1::uuid, value::uuid FROM jsonb_array_elements_text($2::jsonb)`,
    [taskId, JSON.stringify(dependsOn)],
  );
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/** Resolves company input to a reference; `undefined` = unchanged. */
async function resolveCompany(
  tx: Queryable,
  input: {companyId?: string | null; companyName?: string | null},
  args: {organizationId: string; actorId: string; now: Date; isDemo: boolean},
  current: {id: string | null; name: string | null},
  byId: NamedRef | null,
): Promise<NamedRef | null | undefined> {
  if (byId) {
    if (byId.isDemo && !args.isDemo) {
      await promoteDemo(tx, 'companies', byId.id, args.actorId, args.now);
      return {...byId, isDemo: false};
    }
    return byId;
  }
  if (input.companyName !== undefined) {
    const name = normalizeName(input.companyName);
    if (name === null) return null;
    if (current.name && current.name.toLowerCase() === name.toLowerCase()) {
      return undefined;
    }
    return findOrCreateCompany(tx, {...args, name});
  }
  if (input.companyId === null) return null;
  return undefined;
}

export async function createTask(
  db: Db,
  actor: SessionUser,
  input: CreateTaskBody,
  now: Date,
): Promise<Task> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    const dependsOn = input.dependsOn ?? [];
    if (dependsOn.length > 0) await lockGraph(tx, org.id);

    const fields: Record<string, string> = {};
    const event = input.eventId
      ? await findEvent(tx, org.id, input.eventId)
      : undefined;
    if (input.eventId && !event) fields.eventId = EVENT_NOT_FOUND;
    const timezone = event?.timezone ?? org.timezone;
    const resolved = resolveSlot(input, null, timezone);
    const companyById = input.companyId
      ? ((await findCompany(tx, org.id, input.companyId)) ?? null)
      : null;
    if (input.companyId && !companyById) fields.companyId = COMPANY_NOT_FOUND;
    if (dependsOn.length > 0) {
      const problem = dependencyProblem(
        null,
        dependsOn,
        await loadGraph(tx, org.id),
      );
      if (problem) fields.dependsOn = problem;
    }
    if (!resolved.ok) throw validationError({...fields, ...resolved.fields});
    throwIfFields(fields);
    const {slot} = resolved;

    const venueName = normalizeName(input.venueName);
    const venue = venueName
      ? await findOrCreateVenue(tx, {
          organizationId: org.id,
          name: venueName,
          actorId: actor.id,
          now,
        })
      : null;
    const company = await resolveCompany(
      tx,
      input,
      {organizationId: org.id, actorId: actor.id, now, isDemo: false},
      {id: null, name: null},
      companyById,
    );

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO tasks
         (organization_id, event_id, venue_id, company_id, title, kind, status,
          local_date, end_date, starts_at, ends_at, timezone, heavy_load, notes,
          source, verification, created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date,
               $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16,
               $17, $18::timestamptz, $17, $18::timestamptz)
       RETURNING id`,
      [
        org.id,
        event?.id ?? null,
        venue?.id ?? null,
        company?.id ?? null,
        input.title,
        input.kind ?? 'other',
        input.status ?? 'planned',
        slot.localDate,
        slot.endDate,
        slot.startsAt,
        slot.endsAt,
        timezone,
        // Unknown stays unknown: never assume a load is light.
        input.heavyLoad ?? null,
        input.notes ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        actor.id,
        now.toISOString(),
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await writeDependencies(tx, id, dependsOn);
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'task',
      entityId: id,
      entityLabel: input.title,
      action: 'create',
      at: now,
    });
    return toTask((await loadTask(tx, id)) as TaskRow);
  });
}

/** Loads the task and checks membership; foreign tasks are «not found». */
async function loadOwnTask(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<{row: TaskRow; timezone: string}> {
  const row = await loadTask(tx, id);
  if (!row) throw taskNotFound();
  try {
    const org = await requireMembership(tx, actor.id, row.organization_id);
    return {row, timezone: org.timezone};
  } catch {
    throw taskNotFound();
  }
}

export async function updateTask(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateTaskBody,
  now: Date,
): Promise<Task> {
  if (!isUuid(id)) throw taskNotFound();
  return db.transaction(async tx => {
    const {row: unlocked, timezone: orgTimezone} = await loadOwnTask(
      tx,
      actor,
      id,
    );
    const orgId = unlocked.organization_id;
    if (input.dependsOn !== undefined) await lockGraph(tx, orgId);
    const row = await loadTask(tx, id, true);
    if (!row) throw taskNotFound();
    if (row.version !== input.version) throw staleTask(row);

    const before = stateOf(row);
    const after: TaskState = {...before};
    if (input.title !== undefined) after.title = input.title;
    if (input.kind !== undefined) after.kind = input.kind;
    if (input.status !== undefined) after.status = input.status;
    if (input.heavyLoad !== undefined) after.heavyLoad = input.heavyLoad;
    if (input.notes !== undefined) after.notes = input.notes;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }

    const fields: Record<string, string> = {};
    if (input.eventId !== undefined && input.eventId !== before.eventId) {
      if (input.eventId === null) {
        after.eventId = null;
        after.timezone = orgTimezone;
      } else {
        const event = await findEvent(tx, orgId, input.eventId);
        if (event) {
          after.eventId = event.id;
          after.timezone = event.timezone;
        } else {
          fields.eventId = EVENT_NOT_FOUND;
        }
      }
    }
    // A new time zone keeps the wall-clock slot the user typed.
    if (touchesSlot(input) || after.timezone !== before.timezone) {
      const resolved = resolveSlot(
        input,
        storedToLocal(storedSlot(row), row.timezone),
        after.timezone,
      );
      if (resolved.ok) Object.assign(after, resolved.slot);
      else Object.assign(fields, resolved.fields);
    }
    const companyById = input.companyId
      ? ((await findCompany(tx, orgId, input.companyId)) ?? null)
      : null;
    if (input.companyId && !companyById) fields.companyId = COMPANY_NOT_FOUND;
    if (input.dependsOn !== undefined) {
      const problem =
        input.dependsOn.length > 0
          ? dependencyProblem(id, input.dependsOn, await loadGraph(tx, orgId))
          : null;
      if (problem) fields.dependsOn = problem;
      else after.dependsOn = input.dependsOn;
    }
    throwIfFields(fields);

    if (input.venueName !== undefined) {
      const venueName = normalizeName(input.venueName);
      const sameVenue =
        venueName !== null &&
        row.venue_name !== null &&
        venueName.toLowerCase() === row.venue_name.toLowerCase();
      if (venueName === null) {
        after.venueId = null;
      } else if (!sameVenue) {
        const venue = await findOrCreateVenue(tx, {
          organizationId: orgId,
          name: venueName,
          actorId: actor.id,
          now,
          isDemo: row.is_demo,
        });
        after.venueId = venue.id;
      }
    }
    const company = await resolveCompany(
      tx,
      input,
      {organizationId: orgId, actorId: actor.id, now, isDemo: row.is_demo},
      {id: row.company_id, name: row.company_name},
      companyById,
    );
    if (company !== undefined) after.companyId = company?.id ?? null;

    const changed = changedTaskFields(before, after);
    if (changed.length === 0) return toTask(row);

    const updated = await tx.query<{id: string}>(
      `UPDATE tasks
          SET title = $3, kind = $4, status = $5, event_id = $6, venue_id = $7,
              company_id = $8, local_date = $9::date, end_date = $10::date,
              starts_at = $11::timestamptz, ends_at = $12::timestamptz,
              timezone = $13, heavy_load = $14, notes = $15, source = $16,
              verification = $17, version = version + 1,
              updated_by = $18, updated_at = $19::timestamptz
        WHERE id = $1 AND version = $2
        RETURNING id`,
      [
        id,
        input.version,
        after.title,
        after.kind,
        after.status,
        after.eventId,
        after.venueId,
        after.companyId,
        after.localDate,
        after.endDate,
        after.startsAt,
        after.endsAt,
        after.timezone,
        after.heavyLoad,
        after.notes,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    if (updated.length === 0) {
      // Unreachable while the row is locked; kept as a safety net.
      throw staleTask((await loadTask(tx, id)) as TaskRow);
    }
    if (changed.includes('dependsOn')) {
      await writeDependencies(tx, id, after.dependsOn);
    }
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'task',
      entityId: id,
      entityLabel: after.title,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toTask((await loadTask(tx, id)) as TaskRow);
  });
}

/**
 * Deletes a task at the given version. Tasks that depended on it lose that
 * predecessor; their version increases and the change is logged, so anyone
 * editing them sees the conflict instead of silently restoring the link.
 */
export async function deleteTask(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw taskNotFound();
  await db.transaction(async tx => {
    const {row: unlocked} = await loadOwnTask(tx, actor, id);
    const orgId = unlocked.organization_id;
    await lockGraph(tx, orgId);
    const row = await loadTask(tx, id, true);
    if (!row) throw taskNotFound();
    if (row.version !== version) throw staleTask(row);

    const dependents = await tx.query<{
      id: string;
      title: string;
      is_demo: boolean;
    }>(
      `SELECT t.id, t.title, t.is_demo
         FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
        WHERE d.depends_on_id = $1
        ORDER BY t.id
          FOR UPDATE OF t`,
      [id],
    );
    await tx.query('DELETE FROM tasks WHERE id = $1', [id]);
    for (const dep of dependents) {
      await tx.query(
        `UPDATE tasks SET version = version + 1, updated_by = $2,
                updated_at = $3::timestamptz
          WHERE id = $1`,
        [dep.id, actor.id, now.toISOString()],
      );
      await appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType: 'task',
        entityId: dep.id,
        entityLabel: dep.title,
        action: 'update',
        changedFields: ['dependsOn'],
        at: now,
        isDemo: dep.is_demo,
      });
    }
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'task',
      entityId: id,
      entityLabel: row.title,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
