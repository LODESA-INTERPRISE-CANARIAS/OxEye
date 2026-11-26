/**
 * Venues: places where events happen, stored as names and addresses (no map
 * geometry yet, so nothing here can be placed on emergency routes).
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import type {Venue} from '../../../shared/logistics/contracts.ts';

/** Trims and collapses inner whitespace; empty becomes null. */
export function normalizeName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name === '' ? null : name;
}

interface VenueRow extends MetaRow {
  organization_id: string;
  name: string;
  address: string | null;
}

function toVenue(row: VenueRow): Venue {
  return {
    ...toMeta(row),
    organizationId: row.organization_id,
    name: row.name,
    address: row.address,
  };
}

export async function listVenues(
  db: Queryable,
  organizationId: string,
): Promise<Venue[]> {
  const rows = await db.query<VenueRow>(
    `SELECT ${metaColumns('v')}, v.organization_id, v.name, v.address
       FROM venues v ${authorJoins('v')}
      WHERE v.organization_id = $1
      ORDER BY lower(v.name), v.id`,
    [organizationId],
  );
  return rows.map(toVenue);
}

export interface VenueRef {
  id: string;
  name: string;
  isDemo: boolean;
}

/**
 * Finds a venue of the organization by name, ignoring letter case, or creates
 * it (logging the creation). Run it inside the transaction of the write that
 * needs it. A demo venue used by real data becomes real, so removing the demo
 * never takes it away.
 */
export async function findOrCreateVenue(
  tx: Queryable,
  args: {
    organizationId: string;
    name: string;
    actorId: string;
    now: Date;
    isDemo?: boolean;
  },
): Promise<VenueRef> {
  const isDemo = args.isDemo ?? false;
  const inserted = await tx.query<{id: string; name: string}>(
    `INSERT INTO venues (organization_id, name, created_by, created_at, updated_by, updated_at, is_demo)
     VALUES ($1, $2, $3, $4::timestamptz, $3, $4::timestamptz, $5)
     ON CONFLICT (organization_id, (lower(name))) DO NOTHING
     RETURNING id, name`,
    [
      args.organizationId,
      args.name,
      args.actorId,
      args.now.toISOString(),
      isDemo,
    ],
  );
  const created = inserted[0];
  if (created) {
    await appendActivity(tx, {
      organizationId: args.organizationId,
      userId: args.actorId,
      entityType: 'venue',
      entityId: created.id,
      entityLabel: created.name,
      action: 'create',
      at: args.now,
      isDemo,
    });
    return {id: created.id, name: created.name, isDemo};
  }
  const existing = await tx.query<{id: string; name: string; is_demo: boolean}>(
    `SELECT id, name, is_demo FROM venues
      WHERE organization_id = $1 AND lower(name) = lower($2)`,
    [args.organizationId, args.name],
  );
  const venue = existing[0];
  if (!venue) throw new Error('Venue vanished during find-or-create');
  if (venue.is_demo && !isDemo) {
    await tx.query(
      `UPDATE venues
          SET is_demo = false, version = version + 1,
              updated_by = $2, updated_at = $3::timestamptz
        WHERE id = $1`,
      [venue.id, args.actorId, args.now.toISOString()],
    );
    await tx.query(
      `UPDATE activity_log SET is_demo = false
        WHERE entity_type = 'venue' AND entity_id = $1`,
      [venue.id],
    );
    return {id: venue.id, name: venue.name, isDemo: false};
  }
  return {id: venue.id, name: venue.name, isDemo: venue.is_demo};
}
