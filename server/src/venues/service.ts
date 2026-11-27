/**
 * Venues: places where events happen, stored as names and addresses (no map
 * geometry yet, so nothing here can be placed on emergency routes).
 *
 * Revisión 1 · E2: a venue also has an acronym (for collapsed calendar
 * columns) and optional daily opening hours, which limit task moves on the
 * calendar only when known. Editing a venue never touches its tasks' heavy
 * load or declared subsoil review (it is still the same place).
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {findOrCreateByName, normalizeName} from '../records/find-or-create.ts';
import type {NamedRef} from '../records/find-or-create.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {
  hoursFromKey,
  hoursKey,
  hoursOf,
  placeColumns,
} from '../records/places.ts';
import type {PlaceColumns} from '../records/places.ts';
import {changedFields} from '../records/slot.ts';
import type {UpdateVenueBody} from './schemas.ts';
import type {
  DataSource,
  SessionUser,
  Venue,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import type {PlaceHours} from '../../../shared/logistics/move.ts';

export {normalizeName} from '../records/find-or-create.ts';

interface VenueRow extends MetaRow, PlaceColumns {
  organization_id: string;
  name: string;
  address: string | null;
}

const SELECT_VENUE = `
  SELECT ${metaColumns('v')}, v.organization_id, v.name, v.address,
         ${placeColumns('v')}
    FROM venues v ${authorJoins('v')}`;

function toVenue(row: VenueRow): Venue {
  return {
    ...toMeta(row),
    organizationId: row.organization_id,
    name: row.name,
    address: row.address,
    acronym: row.acronym,
    openingHours: hoursOf(row),
  };
}

export async function listVenues(
  db: Queryable,
  organizationId: string,
): Promise<Venue[]> {
  const rows = await db.query<VenueRow>(
    `${SELECT_VENUE}
      WHERE v.organization_id = $1
      ORDER BY lower(v.name), v.id`,
    [organizationId],
  );
  return rows.map(toVenue);
}

/** The organization's venues with their opening hours (for moves). */
export async function venueHours(
  db: Queryable,
  organizationId: string,
): Promise<PlaceHours[]> {
  return (await listVenues(db, organizationId)).map(v => ({
    id: v.id,
    name: v.name,
    openingHours: v.openingHours,
  }));
}

export type VenueRef = NamedRef;

/**
 * Finds a venue of the organization by name, ignoring letter case, or creates
 * it (logging the creation). A demo venue used by real data becomes real.
 */
export function findOrCreateVenue(
  tx: Queryable,
  args: {
    organizationId: string;
    name: string;
    actorId: string;
    now: Date;
    isDemo?: boolean;
  },
): Promise<VenueRef> {
  return findOrCreateByName(tx, 'venues', args);
}

async function loadVenue(
  db: Queryable,
  id: string,
  lock = false,
): Promise<VenueRow | undefined> {
  const rows = await db.query<VenueRow>(
    `${SELECT_VENUE} WHERE v.id = $1${lock ? ' FOR UPDATE OF v' : ''}`,
    [id],
  );
  return rows[0];
}

function venueNotFound(): AppError {
  return notFound('No encontramos ese lugar: puede que se haya eliminado.');
}

interface VenueState {
  name: string;
  acronym: string | null;
  /** `hoursKey`, so two windows compare by value. */
  hours: string | null;
  source: DataSource | null;
  verification: Verification;
}

const FIELD_NAMES: readonly (readonly [keyof VenueState, string])[] = [
  ['name', 'name'],
  ['acronym', 'acronym'],
  ['hours', 'openingHours'],
  ['source', 'source'],
  ['verification', 'verification'],
];

/**
 * Edits a venue's name, acronym, opening hours or provenance at the given
 * version (409 VERSION_CONFLICT with `current` otherwise). A name another
 * venue of the organization already has (any case) → 409 DUPLICATE.
 */
export async function updateVenue(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateVenueBody,
  now: Date,
): Promise<Venue> {
  if (!isUuid(id)) throw venueNotFound();
  return db.transaction(async tx => {
    const unlocked = await loadVenue(tx, id);
    if (!unlocked) throw venueNotFound();
    try {
      await requireMembership(tx, actor.id, unlocked.organization_id);
    } catch {
      throw venueNotFound();
    }
    const row = await loadVenue(tx, id, true);
    if (!row) throw venueNotFound();
    if (row.version !== input.version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado este lugar mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.',
        {current: toVenue(row)},
      );
    }
    const before: VenueState = {
      name: row.name,
      acronym: row.acronym,
      hours: hoursKey(hoursOf(row)),
      source: row.source,
      verification: row.verification,
    };
    const after: VenueState = {...before};
    if (input.name !== undefined) {
      after.name = normalizeName(input.name) ?? before.name;
    }
    if (input.acronym !== undefined) after.acronym = input.acronym;
    if (input.openingHours !== undefined) {
      after.hours = hoursKey(input.openingHours);
    }
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }
    if (after.name.toLowerCase() !== before.name.toLowerCase()) {
      const clash = await tx.query<VenueRow>(
        `${SELECT_VENUE}
          WHERE v.organization_id = $1 AND lower(v.name) = lower($2)`,
        [row.organization_id, after.name],
      );
      if (clash[0] && clash[0].id !== id) {
        throw new AppError(
          'DUPLICATE',
          `Ya existe el lugar «${clash[0].name}». Usa ese en lugar de crear otro con el mismo nombre.`,
          {current: toVenue(clash[0])},
        );
      }
    }

    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toVenue(row);
    const hours = hoursFromKey(after.hours);
    await tx.query(
      `UPDATE venues
          SET name = $3, acronym = $4, opens_at = $5::time, closes_at = $6::time,
              source = $7, verification = $8, version = version + 1,
              updated_by = $9, updated_at = $10::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.name,
        after.acronym,
        hours?.opensAt ?? null,
        hours?.closesAt ?? null,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    await appendActivity(tx, {
      organizationId: row.organization_id,
      userId: actor.id,
      entityType: 'venue',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toVenue((await loadVenue(tx, id)) as VenueRow);
  });
}
