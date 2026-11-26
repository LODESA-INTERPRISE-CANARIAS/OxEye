/**
 * Warehouses: where the organization keeps material. Name and address only,
 * no map geometry (a storage area on the venue map needs its own plan,
 * because it must never block routes A/B/C or accessibility services).
 * Created by name from a resource or in full here; names are unique per
 * organization (any letter case). Every write holds the organization's
 * catalogue lock and appends to the activity log in the same transaction.
 * Guests never receive the address or the notes (see records/redact.ts).
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {unlinkNotes} from '../notes/refs.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {createOnce, findReplay, fresh} from '../records/device-id.ts';
import type {Created, DeviceCreate} from '../records/device-id.ts';
import {
  findOrCreateByName,
  normalizeName,
  promoteDemo,
} from '../records/find-or-create.ts';
import type {NamedRef} from '../records/find-or-create.ts';
import {lockCatalogue} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {changedFields} from '../records/slot.ts';
import {unlinkResources} from '../resources/links.ts';
import type {CreateWarehouseBody, UpdateWarehouseBody} from './schemas.ts';
import type {
  DataSource,
  SessionUser,
  Verification,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';

interface WarehouseRow extends MetaRow {
  organization_id: string;
  name: string;
  address: string | null;
  notes: string | null;
  resource_count: number;
}

const SELECT_WAREHOUSE = `
  SELECT ${metaColumns('w')}, w.organization_id, w.name, w.address, w.notes,
         (SELECT count(*)::int FROM resources r WHERE r.warehouse_id = w.id) AS resource_count
    FROM warehouses w ${authorJoins('w')}`;

export const WAREHOUSE_NOT_FOUND =
  'No encontramos ese almacén en esta organización: puede que se haya eliminado.';

/** The single row → record mapping; the viewer decides what is withheld. */
function toWarehouse(row: WarehouseRow, viewer: Viewer): Warehouse {
  return forViewer(
    'warehouse',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      name: row.name,
      address: row.address,
      notes: row.notes,
      resourceCount: Number(row.resource_count),
    },
    viewer,
  );
}

interface WarehouseState {
  name: string;
  address: string | null;
  notes: string | null;
  source: DataSource | null;
  verification: Verification;
}

const FIELD_NAMES: readonly (readonly [keyof WarehouseState, string])[] = [
  ['name', 'name'],
  ['address', 'address'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

function stateOf(row: WarehouseRow): WarehouseState {
  return {
    name: row.name,
    address: row.address,
    notes: row.notes,
    source: row.source,
    verification: row.verification,
  };
}

/** Sorted by name, ignoring letter case. */
export async function listWarehouses(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<Warehouse[]> {
  const rows = await db.query<WarehouseRow>(
    `${SELECT_WAREHOUSE}
      WHERE w.organization_id = $1
      ORDER BY lower(w.name), w.id`,
    [organizationId],
  );
  return rows.map(r => toWarehouse(r, viewer));
}

async function loadWarehouse(
  db: Queryable,
  id: string,
  lock = false,
): Promise<WarehouseRow | undefined> {
  const rows = await db.query<WarehouseRow>(
    `${SELECT_WAREHOUSE} WHERE w.id = $1${lock ? ' FOR UPDATE OF w' : ''}`,
    [id],
  );
  return rows[0];
}

/** The warehouse if it belongs to the organization. */
export async function findWarehouse(
  db: Queryable,
  organizationId: string,
  id: string,
): Promise<NamedRef | undefined> {
  const rows = await db.query<{id: string; name: string; is_demo: boolean}>(
    'SELECT id, name, is_demo FROM warehouses WHERE id = $1 AND organization_id = $2',
    [id, organizationId],
  );
  const row = rows[0];
  return row ? {id: row.id, name: row.name, isDemo: row.is_demo} : undefined;
}

/**
 * Resolves `warehouseId` / `warehouseName` of a resource to a warehouse;
 * `undefined` = unchanged, null = none. `warehouseId` wins (pass the
 * warehouse it found as `byId`); a name finds or creates. A demo warehouse
 * used by a real resource becomes real, so removing the demo never takes it.
 */
export async function resolveWarehouseRef(
  tx: Queryable,
  input: {warehouseId?: string | null; warehouseName?: string | null},
  args: {organizationId: string; actorId: string; now: Date; isDemo: boolean},
  current: {id: string | null; name: string | null},
  byId: NamedRef | null,
): Promise<NamedRef | null | undefined> {
  if (byId) {
    if (byId.isDemo && !args.isDemo) {
      await promoteDemo(tx, 'warehouses', byId.id, args.actorId, args.now);
      return {...byId, isDemo: false};
    }
    return byId;
  }
  if (input.warehouseName !== undefined) {
    const name = normalizeName(input.warehouseName);
    if (name === null) return null;
    if (current.name && current.name.toLowerCase() === name.toLowerCase()) {
      return undefined;
    }
    return findOrCreateByName(tx, 'warehouses', {...args, name});
  }
  if (input.warehouseId === null) return null;
  return undefined;
}

function warehouseNotFound(): AppError {
  return notFound('No encontramos ese almacén: puede que se haya eliminado.');
}

function staleWarehouse(row: WarehouseRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado este almacén mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toWarehouse(row, viewer)},
  );
}

function duplicateWarehouse(row: WarehouseRow, viewer: Viewer): AppError {
  return new AppError(
    'DUPLICATE',
    `Ya existe el almacén «${row.name}». Ábrelo para completarlo en lugar de crear otro.`,
    {current: toWarehouse(row, viewer)},
  );
}

async function findByName(
  tx: Queryable,
  organizationId: string,
  name: string,
): Promise<WarehouseRow | undefined> {
  const rows = await tx.query<WarehouseRow>(
    `${SELECT_WAREHOUSE}
      WHERE w.organization_id = $1 AND lower(w.name) = lower($2)`,
    [organizationId, name],
  );
  return rows[0];
}

export async function createWarehouse(
  db: Db,
  actor: SessionUser,
  input: CreateWarehouseBody,
  now: Date,
): Promise<Created<Warehouse>> {
  const device: DeviceCreate<Warehouse> = {
    table: 'warehouses',
    id: input.id,
    organizationId: input.organizationId,
    actorId: actor.id,
    load: async (q, id) => {
      const row = await loadWarehouse(q, id);
      return row && toWarehouse(row, actor);
    },
  };
  return createOnce(db, device, async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    // A replay wins before the name check: it is this very warehouse.
    const replay = await findReplay(tx, device, org.id);
    if (replay) return replay;
    const name = normalizeName(input.name) as string;
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO warehouses
         (organization_id, name, address, notes, source, verification,
          created_by, created_at, updated_by, updated_at, id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $7, $8::timestamptz,
               COALESCE($9::uuid, gen_random_uuid()))
       ON CONFLICT (organization_id, (lower(name))) DO NOTHING
       RETURNING id`,
      [
        org.id,
        name,
        input.address ?? null,
        input.notes ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        actor.id,
        now.toISOString(),
        input.id ?? null,
      ],
    );
    const created = inserted[0];
    if (!created) {
      const existing = await findByName(tx, org.id, name);
      if (!existing) throw new Error('warehouse vanished during create');
      throw duplicateWarehouse(existing, actor);
    }
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'warehouse',
      entityId: created.id,
      entityLabel: name,
      action: 'create',
      at: now,
    });
    return fresh(
      toWarehouse((await loadWarehouse(tx, created.id)) as WarehouseRow, actor),
    );
  });
}

/** Loads the warehouse and checks membership; foreign ones are «not found». */
async function loadOwnWarehouse(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<WarehouseRow> {
  const row = await loadWarehouse(tx, id);
  if (!row) throw warehouseNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw warehouseNotFound();
  }
  return row;
}

export async function updateWarehouse(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateWarehouseBody,
  now: Date,
): Promise<Warehouse> {
  if (!isUuid(id)) throw warehouseNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnWarehouse(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadWarehouse(tx, id, true);
    if (!row) throw warehouseNotFound();
    if (row.version !== input.version) throw staleWarehouse(row, actor);

    const before = stateOf(row);
    const after: WarehouseState = {...before};
    if (input.name !== undefined) {
      after.name = normalizeName(input.name) ?? before.name;
    }
    if (input.address !== undefined) after.address = input.address;
    if (input.notes !== undefined) after.notes = input.notes;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }

    if (after.name.toLowerCase() !== before.name.toLowerCase()) {
      const clash = await findByName(tx, orgId, after.name);
      if (clash && clash.id !== id) throw duplicateWarehouse(clash, actor);
    }

    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toWarehouse(row, actor);

    await tx.query(
      `UPDATE warehouses
          SET name = $3, address = $4, notes = $5, source = $6,
              verification = $7, version = version + 1,
              updated_by = $8, updated_at = $9::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.name,
        after.address,
        after.notes,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'warehouse',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toWarehouse((await loadWarehouse(tx, id)) as WarehouseRow, actor);
  });
}

/**
 * Deletes a warehouse at the given version. Its resources stay without a
 * warehouse and notes lose the link: their versions increase and the changes
 * are logged.
 */
export async function deleteWarehouse(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw warehouseNotFound();
  await db.transaction(async tx => {
    const orgId = (await loadOwnWarehouse(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadWarehouse(tx, id, true);
    if (!row) throw warehouseNotFound();
    if (row.version !== version) throw staleWarehouse(row, actor);

    const unlink = {ids: [id], actorId: actor.id, now};
    await unlinkResources(tx, {
      ...unlink,
      organizationId: orgId,
      link: 'warehouse',
    });
    await unlinkNotes(tx, {...unlink, link: 'warehouse'});
    await tx.query('DELETE FROM warehouses WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'warehouse',
      entityId: id,
      entityLabel: row.name,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
