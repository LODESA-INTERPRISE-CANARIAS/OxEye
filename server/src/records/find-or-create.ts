/**
 * Find-or-create by name for small named records (venues, companies): the
 * quick capture types a name, and the same name (any letter case) always
 * resolves to the same record of the organization.
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';

/** Tables with `organization_id`, `name`, record meta and a unique (organization_id, lower(name)) index. */
type NamedTable = 'venues' | 'companies';
/** Demo records real data can start using (and so make real). */
type PromotableTable = NamedTable | 'contacts';

const ENTITY_TYPE: Record<PromotableTable, string> = {
  venues: 'venue',
  companies: 'company',
  contacts: 'contact',
};

export interface NamedRef {
  id: string;
  name: string;
  isDemo: boolean;
}

/** Trims and collapses inner whitespace; empty becomes null. */
export function normalizeName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name === '' ? null : name;
}

/**
 * Finds a record of the organization by name, ignoring letter case, or
 * creates it (logging the creation). Run it inside the transaction of the
 * write that needs it. A demo record used by real data becomes real, so
 * removing the demo never takes it away.
 */
export async function findOrCreateByName(
  tx: Queryable,
  table: NamedTable,
  args: {
    organizationId: string;
    name: string;
    actorId: string;
    now: Date;
    isDemo?: boolean;
  },
): Promise<NamedRef> {
  const isDemo = args.isDemo ?? false;
  const entityType = ENTITY_TYPE[table];
  const inserted = await tx.query<{id: string; name: string}>(
    `INSERT INTO ${table} (organization_id, name, created_by, created_at, updated_by, updated_at, is_demo)
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
      entityType,
      entityId: created.id,
      entityLabel: created.name,
      action: 'create',
      at: args.now,
      isDemo,
    });
    return {id: created.id, name: created.name, isDemo};
  }
  const existing = await tx.query<{id: string; name: string; is_demo: boolean}>(
    `SELECT id, name, is_demo FROM ${table}
      WHERE organization_id = $1 AND lower(name) = lower($2)`,
    [args.organizationId, args.name],
  );
  const found = existing[0];
  if (!found) throw new Error(`${entityType} vanished during find-or-create`);
  if (found.is_demo && !isDemo) {
    await promoteDemo(tx, table, found.id, args.actorId, args.now);
    return {id: found.id, name: found.name, isDemo: false};
  }
  return {id: found.id, name: found.name, isDemo: found.is_demo};
}

/** Turns a demo record used by real data into a real one (with its activity). */
export async function promoteDemo(
  tx: Queryable,
  table: PromotableTable,
  id: string,
  actorId: string,
  now: Date,
): Promise<void> {
  const promoted = await tx.query(
    `UPDATE ${table}
        SET is_demo = false, version = version + 1,
            updated_by = $2, updated_at = $3::timestamptz
      WHERE id = $1 AND is_demo
      RETURNING id`,
    [id, actorId, now.toISOString()],
  );
  if (promoted.length === 0) return;
  await tx.query(
    `UPDATE activity_log SET is_demo = false
      WHERE entity_type = $1 AND entity_id = $2`,
    [ENTITY_TYPE[table], id],
  );
}
