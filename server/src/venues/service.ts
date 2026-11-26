/**
 * Venues: places where events happen, stored as names and addresses (no map
 * geometry yet, so nothing here can be placed on emergency routes).
 */
import type {Queryable} from '../db/db.ts';
import {findOrCreateByName} from '../records/find-or-create.ts';
import type {NamedRef} from '../records/find-or-create.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import type {Venue} from '../../../shared/logistics/contracts.ts';

export {normalizeName} from '../records/find-or-create.ts';

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
