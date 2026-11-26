/**
 * Events: list, create (only the name is required) and edit with optimistic
 * concurrency. Every write appends to the activity log in the same
 * transaction. Guests never receive an event's notes (see records/redact.ts).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {createOnce, findReplay, fresh} from '../records/device-id.ts';
import type {Created, DeviceCreate} from '../records/device-id.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {findOrCreateVenue, normalizeName} from '../venues/service.ts';
import {
  changedEventFields,
  resolveSlot,
  storedToLocal,
  touchesSlot,
} from './domain.ts';
import type {EventState, StoredSlot} from './domain.ts';
import type {CreateEventBody, UpdateEventBody} from './schemas.ts';
import type {
  EventStatus,
  LogisticsEvent,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

interface EventRow extends MetaRow {
  organization_id: string;
  name: string;
  venue_id: string | null;
  venue_name: string | null;
  local_date: string | null;
  end_date: string | null;
  starts_at: unknown;
  ends_at: unknown;
  timezone: string;
  status: EventStatus;
  notes: string | null;
}

const SELECT_EVENT = `
  SELECT ${metaColumns('e')}, e.organization_id, e.name, e.venue_id,
         v.name AS venue_name, e.local_date::text AS local_date,
         e.end_date::text AS end_date, e.starts_at, e.ends_at, e.timezone, e.status, e.notes
    FROM events e
    LEFT JOIN venues v ON v.id = e.venue_id
    ${authorJoins('e')}`;

/** The single row → record mapping; the viewer decides what is withheld. */
function toEvent(row: EventRow, viewer: Viewer): LogisticsEvent {
  return forViewer(
    'event',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      name: row.name,
      venue:
        row.venue_id && row.venue_name
          ? {id: row.venue_id, name: row.venue_name}
          : null,
      date: row.local_date,
      endDate: row.end_date,
      startsAt: toIsoOrNull(row.starts_at),
      endsAt: toIsoOrNull(row.ends_at),
      timezone: row.timezone,
      status: row.status,
      notes: row.notes,
    },
    viewer,
  );
}

function storedSlot(row: EventRow): StoredSlot {
  return {
    localDate: row.local_date,
    endDate: row.end_date,
    startsAt: toIsoOrNull(row.starts_at),
    endsAt: toIsoOrNull(row.ends_at),
  };
}

function stateOf(row: EventRow): EventState {
  return {
    name: row.name,
    venueId: row.venue_id,
    ...storedSlot(row),
    status: row.status,
    notes: row.notes,
    source: row.source,
    verification: row.verification,
  };
}

/** Sorted by start ascending, undated last, then by name. */
export async function listEvents(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<LogisticsEvent[]> {
  const rows = await db.query<EventRow>(
    `${SELECT_EVENT}
      WHERE e.organization_id = $1
      ORDER BY e.local_date ASC NULLS LAST, e.starts_at ASC NULLS LAST,
               lower(e.name), e.id`,
    [organizationId],
  );
  return rows.map(r => toEvent(r, viewer));
}

async function loadEvent(
  db: Queryable,
  id: string,
  lock = false,
): Promise<EventRow | undefined> {
  const rows = await db.query<EventRow>(
    `${SELECT_EVENT} WHERE e.id = $1${lock ? ' FOR UPDATE OF e' : ''}`,
    [id],
  );
  return rows[0];
}

function eventNotFound(): AppError {
  return notFound('No encontramos ese evento: puede que se haya eliminado.');
}

export async function createEvent(
  db: Db,
  actor: SessionUser,
  input: CreateEventBody,
  now: Date,
): Promise<Created<LogisticsEvent>> {
  const device: DeviceCreate<LogisticsEvent> = {
    table: 'events',
    id: input.id,
    organizationId: input.organizationId,
    actorId: actor.id,
    load: async (q, id) => {
      const row = await loadEvent(q, id);
      return row && toEvent(row, actor);
    },
  };
  return createOnce(db, device, async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    const replay = await findReplay(tx, device, org.id);
    if (replay) return replay;
    const resolved = resolveSlot(input, null, org.timezone);
    if (!resolved.ok) throw validationError(resolved.fields);
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

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO events
         (organization_id, name, venue_id, local_date, end_date, starts_at, ends_at,
          timezone, status, notes, source, verification,
          created_by, created_at, updated_by, updated_at, id)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::timestamptz, $7::timestamptz,
               $8, $9, $10, $11, $12, $13, $14::timestamptz, $13, $14::timestamptz,
               COALESCE($15::uuid, gen_random_uuid()))
       RETURNING id`,
      [
        org.id,
        input.name,
        venue?.id ?? null,
        slot.localDate,
        slot.endDate,
        slot.startsAt,
        slot.endsAt,
        org.timezone,
        input.status ?? 'planned',
        input.notes ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        actor.id,
        now.toISOString(),
        input.id ?? null,
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'event',
      entityId: id,
      entityLabel: input.name,
      action: 'create',
      at: now,
    });
    return fresh(toEvent((await loadEvent(tx, id)) as EventRow, actor));
  });
}

export async function updateEvent(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateEventBody,
  now: Date,
): Promise<LogisticsEvent> {
  if (!isUuid(id)) throw eventNotFound();
  return db.transaction(async tx => {
    const row = await loadEvent(tx, id, true);
    if (!row) throw eventNotFound();
    try {
      await requireMembership(tx, actor.id, row.organization_id);
    } catch {
      throw eventNotFound();
    }
    if (row.version !== input.version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado este evento mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.',
        {current: toEvent(row, actor)},
      );
    }

    const before = stateOf(row);
    const after: EventState = {...before};
    if (input.name !== undefined) after.name = input.name;
    if (input.status !== undefined) after.status = input.status;
    if (input.notes !== undefined) after.notes = input.notes;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }
    if (touchesSlot(input)) {
      const resolved = resolveSlot(
        input,
        storedToLocal(storedSlot(row), row.timezone),
        row.timezone,
      );
      if (!resolved.ok) throw validationError(resolved.fields);
      Object.assign(after, resolved.slot);
    }
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
          organizationId: row.organization_id,
          name: venueName,
          actorId: actor.id,
          now,
          isDemo: row.is_demo,
        });
        after.venueId = venue.id;
      }
    }

    const changed = changedEventFields(before, after);
    if (changed.length === 0) return toEvent(row, actor);

    const updated = await tx.query<{id: string}>(
      `UPDATE events
          SET name = $3, venue_id = $4, local_date = $5::date, end_date = $6::date,
              starts_at = $7::timestamptz, ends_at = $8::timestamptz,
              status = $9, notes = $10, source = $11, verification = $12,
              version = version + 1, updated_by = $13, updated_at = $14::timestamptz
        WHERE id = $1 AND version = $2
        RETURNING id`,
      [
        id,
        input.version,
        after.name,
        after.venueId,
        after.localDate,
        after.endDate,
        after.startsAt,
        after.endsAt,
        after.status,
        after.notes,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    if (updated.length === 0) {
      // Unreachable while the row is locked; kept as a safety net.
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado este evento mientras lo editabas.',
        {current: toEvent((await loadEvent(tx, id)) as EventRow, actor)},
      );
    }
    await appendActivity(tx, {
      organizationId: row.organization_id,
      userId: actor.id,
      entityType: 'event',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toEvent((await loadEvent(tx, id)) as EventRow, actor);
  });
}
