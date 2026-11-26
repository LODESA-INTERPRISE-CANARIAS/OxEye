/**
 * Tasks: list, create (only the title is required), edit and delete with
 * optimistic concurrency. Every write appends to the activity log in the same
 * transaction.
 *
 * Writes that change the dependency graph of an organization take a
 * transaction-level advisory lock first, so two people linking tasks at the
 * same time cannot build a cycle between them. Writes that link a company, a
 * contact or resources also take the catalogue lock, after the graph lock, and
 * so does a delete (it unlinks the notes that point at the task). Both are
 * always taken before any row lock, which keeps lock order consistent (no
 * deadlocks; see records/locks.ts).
 *
 * Guests never receive a task's notes (see records/redact.ts). The resources a
 * task uses never answer its heavy-load question.
 *
 * «Subsuelo revisado en el simulador» (M5) is declared by a member with
 * `subsoilReviewed`; nothing infers it. It is cleared when the venue, the heavy
 * load or the resources change (see `nextSubsoilReview`). Deleting a task
 * deletes its open delay hypotheses and unlinks the applied ones.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso, toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {
  COMPANY_NOT_FOUND,
  findCompany,
  resolveCompanyRef,
} from '../companies/service.ts';
import {
  CONTACT_NOT_FOUND,
  findContact,
  promoteContact,
} from '../contacts/service.ts';
import type {ContactRef} from '../contacts/service.ts';
import {unlinkNotes} from '../notes/refs.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {normalizeName} from '../records/find-or-create.ts';
import {parseIds} from '../records/ids.ts';
import {lockCatalogue, lockGraph} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {areOwnResources, RESOURCES_UNKNOWN} from '../resources/links.ts';
import {resolveSlot, storedToLocal, touchesSlot} from '../records/slot.ts';
import type {StoredSlot} from '../records/slot.ts';
import {findOrCreateVenue} from '../venues/service.ts';
import {detachHypotheses} from '../hypotheses/links.ts';
import {
  changedTaskFields,
  dependencyProblem,
  nextSubsoilReview,
  SUBSOIL_NEEDS_HEAVY_LOAD,
} from './domain.ts';
import type {GraphTask, TaskState} from './domain.ts';
import type {CreateTaskBody, UpdateTaskBody} from './schemas.ts';
import type {
  SessionUser,
  SubsoilReview,
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
  contact_id: string | null;
  contact_name: string | null;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  local_date: string | null;
  end_date: string | null;
  starts_at: unknown;
  ends_at: unknown;
  timezone: string;
  heavy_load: boolean | null;
  subsoil_reviewed_by: string | null;
  subsoil_reviewed_by_name: string | null;
  subsoil_reviewed_at: unknown;
  notes: string | null;
  depends_on: unknown;
  resource_ids: unknown;
}

const SELECT_TASK = `
  SELECT ${metaColumns('t')}, t.organization_id, t.event_id,
         t.venue_id, v.name AS venue_name, t.company_id, c.name AS company_name,
         t.contact_id, k.name AS contact_name,
         t.title, t.kind, t.status,
         t.local_date::text AS local_date, t.end_date::text AS end_date,
         t.starts_at, t.ends_at, t.timezone, t.heavy_load, t.notes,
         t.subsoil_reviewed_by, sr.display_name AS subsoil_reviewed_by_name,
         t.subsoil_reviewed_at,
         COALESCE((SELECT jsonb_agg(d.depends_on_id ORDER BY d.depends_on_id)
                     FROM task_dependencies d WHERE d.task_id = t.id),
                  '[]'::jsonb) AS depends_on,
         COALESCE((SELECT jsonb_agg(tr.resource_id ORDER BY tr.resource_id)
                     FROM task_resources tr WHERE tr.task_id = t.id),
                  '[]'::jsonb) AS resource_ids
    FROM tasks t
    LEFT JOIN venues v ON v.id = t.venue_id
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN contacts k ON k.id = t.contact_id
    LEFT JOIN users sr ON sr.id = t.subsoil_reviewed_by
    ${authorJoins('t')}`;

export const EVENT_NOT_FOUND =
  'No encontramos ese evento en esta organización: puede que se haya eliminado.';

/** The declared subsoil review of a row; never inferred from anything else. */
function subsoilReviewOf(row: TaskRow): SubsoilReview | null {
  if (!row.subsoil_reviewed_by || row.subsoil_reviewed_at == null) return null;
  return {
    by: {
      id: row.subsoil_reviewed_by,
      displayName: row.subsoil_reviewed_by_name ?? '',
    },
    at: toIso(row.subsoil_reviewed_at),
  };
}

/** The single row → record mapping; the viewer decides what is withheld. */
function toTask(row: TaskRow, viewer: Viewer): Task {
  return forViewer(
    'task',
    {
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
      contact:
        row.contact_id && row.contact_name
          ? {id: row.contact_id, name: row.contact_name}
          : null,
      dependsOn: parseIds(row.depends_on),
      heavyLoad: row.heavy_load,
      resourceIds: parseIds(row.resource_ids),
      subsoilReview: subsoilReviewOf(row),
      notes: row.notes,
    },
    viewer,
  );
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
    contactId: row.contact_id,
    ...storedSlot(row),
    timezone: row.timezone,
    dependsOn: parseIds(row.depends_on),
    heavyLoad: row.heavy_load,
    resourceIds: parseIds(row.resource_ids),
    subsoilReviewedBy: row.subsoil_reviewed_by,
    subsoilReviewedAt: toIsoOrNull(row.subsoil_reviewed_at),
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
  viewer: Viewer,
  eventId: string | null = null,
): Promise<Task[]> {
  const rows = await db.query<TaskRow>(
    `${SELECT_TASK}
      WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.event_id = $2::uuid)
      ORDER BY t.local_date ASC NULLS LAST, t.starts_at ASC NULLS LAST,
               lower(t.title), t.id`,
    [organizationId, eventId],
  );
  return rows.map(r => toTask(r, viewer));
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

function staleTask(row: TaskRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado esta tarea mientras la editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toTask(row, viewer)},
  );
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

async function writeResources(
  tx: Queryable,
  taskId: string,
  resourceIds: string[],
): Promise<void> {
  await tx.query('DELETE FROM task_resources WHERE task_id = $1', [taskId]);
  if (resourceIds.length === 0) return;
  await tx.query(
    `INSERT INTO task_resources (task_id, resource_id)
     SELECT $1::uuid, value::uuid FROM jsonb_array_elements_text($2::jsonb)`,
    [taskId, JSON.stringify(resourceIds)],
  );
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/**
 * True when the input links a company, a contact or resources (catalogue
 * lock needed: those records are deleted under it).
 */
function touchesCatalogue(input: {
  companyId?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  resourceIds?: string[];
}): boolean {
  return (
    input.companyId !== undefined ||
    input.companyName !== undefined ||
    input.contactId !== undefined ||
    input.resourceIds !== undefined
  );
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
    if (touchesCatalogue(input)) await lockCatalogue(tx, org.id);

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
    const contact = input.contactId
      ? await findContact(tx, org.id, input.contactId)
      : undefined;
    if (input.contactId && !contact) fields.contactId = CONTACT_NOT_FOUND;
    if (dependsOn.length > 0) {
      const problem = dependencyProblem(
        null,
        dependsOn,
        await loadGraph(tx, org.id),
      );
      if (problem) fields.dependsOn = problem;
    }
    const resourceIds = input.resourceIds ?? [];
    if (!(await areOwnResources(tx, org.id, resourceIds))) {
      fields.resourceIds = RESOURCES_UNKNOWN;
    }
    // Declared only on a heavy task; never set by default.
    const review = nextSubsoilReview({
      before: {venueId: null, heavyLoad: null, resourceIds: [], review: null},
      after: {venueId: null, heavyLoad: input.heavyLoad ?? null, resourceIds},
      requested: input.subsoilReviewed,
      actorId: actor.id,
      now: now.toISOString(),
    });
    if (!review.ok) fields.subsoilReviewed = review.message;
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
    const company = await resolveCompanyRef(
      tx,
      input,
      {organizationId: org.id, actorId: actor.id, now, isDemo: false},
      {id: null, name: null},
      companyById,
    );
    if (contact) await promoteContact(tx, contact, actor.id, now);

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO tasks
         (organization_id, event_id, venue_id, company_id, title, kind, status,
          local_date, end_date, starts_at, ends_at, timezone, heavy_load, notes,
          source, verification, created_by, created_at, updated_by, updated_at,
          contact_id, subsoil_reviewed_by, subsoil_reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date,
               $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16,
               $17, $18::timestamptz, $17, $18::timestamptz, $19, $20,
               $21::timestamptz)
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
        contact?.id ?? null,
        review.ok ? (review.review?.by ?? null) : null,
        review.ok ? (review.review?.at ?? null) : null,
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await writeDependencies(tx, id, dependsOn);
    await writeResources(tx, id, resourceIds);
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'task',
      entityId: id,
      entityLabel: input.title,
      action: 'create',
      at: now,
    });
    return toTask((await loadTask(tx, id)) as TaskRow, actor);
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
    if (touchesCatalogue(input)) await lockCatalogue(tx, orgId);
    const row = await loadTask(tx, id, true);
    if (!row) throw taskNotFound();
    if (row.version !== input.version) throw staleTask(row, actor);

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
    let contact: ContactRef | undefined;
    if (input.contactId !== undefined && input.contactId !== before.contactId) {
      if (input.contactId === null) {
        after.contactId = null;
      } else {
        contact = await findContact(tx, orgId, input.contactId);
        if (contact) after.contactId = contact.id;
        else fields.contactId = CONTACT_NOT_FOUND;
      }
    }
    if (input.dependsOn !== undefined) {
      const problem =
        input.dependsOn.length > 0
          ? dependencyProblem(id, input.dependsOn, await loadGraph(tx, orgId))
          : null;
      if (problem) fields.dependsOn = problem;
      else after.dependsOn = input.dependsOn;
    }
    if (input.resourceIds !== undefined) {
      if (await areOwnResources(tx, orgId, input.resourceIds)) {
        after.resourceIds = input.resourceIds;
      } else {
        fields.resourceIds = RESOURCES_UNKNOWN;
      }
    }
    if (input.subsoilReviewed !== undefined && after.heavyLoad !== true) {
      fields.subsoilReviewed = SUBSOIL_NEEDS_HEAVY_LOAD;
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
    const company = await resolveCompanyRef(
      tx,
      input,
      {organizationId: orgId, actorId: actor.id, now, isDemo: row.is_demo},
      {id: row.company_id, name: row.company_name},
      companyById,
    );
    if (company !== undefined) after.companyId = company?.id ?? null;
    // A demo person linked from a real task becomes real.
    if (contact && !row.is_demo) {
      await promoteContact(tx, contact, actor.id, now);
    }
    // The declared subsoil review: cleared when the placement or the material
    // changes, unless declared again in this request.
    const review = nextSubsoilReview({
      before: {
        ...before,
        review:
          before.subsoilReviewedBy && before.subsoilReviewedAt
            ? {by: before.subsoilReviewedBy, at: before.subsoilReviewedAt}
            : null,
      },
      after,
      requested: input.subsoilReviewed,
      actorId: actor.id,
      now: now.toISOString(),
    });
    if (!review.ok) throw validationError({subsoilReviewed: review.message});
    after.subsoilReviewedBy = review.review?.by ?? null;
    after.subsoilReviewedAt = review.review?.at ?? null;

    const changed = changedTaskFields(before, after);
    if (changed.length === 0) return toTask(row, actor);

    const updated = await tx.query<{id: string}>(
      `UPDATE tasks
          SET title = $3, kind = $4, status = $5, event_id = $6, venue_id = $7,
              company_id = $8, local_date = $9::date, end_date = $10::date,
              starts_at = $11::timestamptz, ends_at = $12::timestamptz,
              timezone = $13, heavy_load = $14, notes = $15, source = $16,
              verification = $17, version = version + 1,
              updated_by = $18, updated_at = $19::timestamptz, contact_id = $20,
              subsoil_reviewed_by = $21,
              subsoil_reviewed_at = $22::timestamptz
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
        after.contactId,
        after.subsoilReviewedBy,
        after.subsoilReviewedAt,
      ],
    );
    if (updated.length === 0) {
      // Unreachable while the row is locked; kept as a safety net.
      throw staleTask((await loadTask(tx, id)) as TaskRow, actor);
    }
    if (changed.includes('dependsOn')) {
      await writeDependencies(tx, id, after.dependsOn);
    }
    if (changed.includes('resourceIds')) {
      await writeResources(tx, id, after.resourceIds);
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
    return toTask((await loadTask(tx, id)) as TaskRow, actor);
  });
}

/**
 * Every task of the organization with full data, for server-side computations
 * (delay hypotheses). The caller decides what a viewer receives.
 */
export async function loadTasksForPlan(
  tx: Queryable,
  organizationId: string,
): Promise<Task[]> {
  return listTasks(tx, organizationId, {role: 'member'});
}

/**
 * Tasks of one organization by id, as `viewer` may see them, sorted by id.
 * Ids of other organizations are ignored, so client-sent ids never reveal
 * another organization's tasks.
 */
export async function loadTasksByIds(
  tx: Queryable,
  organizationId: string,
  ids: readonly string[],
  viewer: Viewer,
): Promise<Task[]> {
  if (ids.length === 0) return [];
  const rows = await tx.query<TaskRow>(
    `${SELECT_TASK}
      WHERE t.organization_id = $1
        AND t.id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))
      ORDER BY t.id`,
    [organizationId, JSON.stringify(ids)],
  );
  return rows.map(r => toTask(r, viewer));
}

/**
 * Deletes a task at the given version. Tasks that depended on it lose that
 * predecessor and notes that pointed at it lose the link; their versions
 * increase and the changes are logged, so anyone editing them sees the
 * conflict instead of silently restoring the link.
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
    // Graph lock (its dependants change), then the catalogue lock (its notes).
    await lockGraph(tx, orgId);
    await lockCatalogue(tx, orgId);
    const row = await loadTask(tx, id, true);
    if (!row) throw taskNotFound();
    if (row.version !== version) throw staleTask(row, actor);

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
    await unlinkNotes(tx, {link: 'task', ids: [id], actorId: actor.id, now});
    // Open hypotheses about it go; applied ones stay with their label.
    await detachHypotheses(tx, {taskIds: [id], actorId: actor.id, now});
    // Dependencies and task_resources rows go with the task (ON DELETE CASCADE).
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
