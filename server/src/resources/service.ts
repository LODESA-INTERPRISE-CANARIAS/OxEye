/**
 * Inventory resources: owned material (fences, tents, a van) or a service
 * contracted from a company. Only the name is required; what was not counted
 * or checked stays unknown. Every write holds the organization's catalogue
 * lock and appends to the activity log in the same transaction. Guests never
 * receive the location or the notes (see records/redact.ts).
 *
 * Quantity, unit (even «kg») and dimensions are descriptive only: nothing
 * here computes a load per area or touches a task's heavy-load answer.
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {areCategoriesOfScope} from '../categories/service.ts';
import {
  COMPANY_NOT_FOUND,
  findCompany,
  resolveCompanyRef,
} from '../companies/service.ts';
import {unlinkNotes} from '../notes/refs.ts';
import {toAmount} from '../offers/domain.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {createOnce, findReplay, fresh} from '../records/device-id.ts';
import type {Created, DeviceCreate} from '../records/device-id.ts';
import {normalizeName, promoteDemo} from '../records/find-or-create.ts';
import {parseIds} from '../records/ids.ts';
import {lockCatalogue, lockGraph} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {changedFields} from '../records/slot.ts';
import {
  findWarehouse,
  resolveWarehouseRef,
  WAREHOUSE_NOT_FOUND,
} from '../warehouses/service.ts';
import {ownershipProblems, resolveOffer} from './domain.ts';
import type {
  CreateResourceBody,
  ResourceBody,
  UpdateResourceBody,
} from './schemas.ts';
import type {
  DataSource,
  Resource,
  ResourceAvailability,
  ResourceCondition,
  ResourceOwnership,
  SessionUser,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {DEFAULT_RESOURCE_UNIT} from '../../../shared/logistics/rules.ts';

interface ResourceRow extends MetaRow {
  organization_id: string;
  name: string;
  ownership: ResourceOwnership;
  category_id: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  company_id: string | null;
  company_name: string | null;
  offer_id: string | null;
  quantity: unknown;
  unit: string;
  dimensions: string | null;
  condition: ResourceCondition;
  availability: ResourceAvailability;
  location: string | null;
  to_assess: boolean;
  notes: string | null;
  task_ids: unknown;
}

// The quantity comes back as text so both drivers agree; toAmount makes a number.
const SELECT_RESOURCE = `
  SELECT ${metaColumns('r')}, r.organization_id, r.name, r.ownership,
         r.category_id, r.warehouse_id, w.name AS warehouse_name,
         r.company_id, c.name AS company_name, r.offer_id,
         r.quantity::text AS quantity, r.unit, r.dimensions, r.condition,
         r.availability, r.location, r.to_assess, r.notes,
         COALESCE((SELECT jsonb_agg(tr.task_id ORDER BY tr.task_id)
                     FROM task_resources tr WHERE tr.resource_id = r.id),
                  '[]'::jsonb) AS task_ids
    FROM resources r
    LEFT JOIN warehouses w ON w.id = r.warehouse_id
    LEFT JOIN companies c ON c.id = r.company_id
    ${authorJoins('r')}`;

const CATEGORY_UNKNOWN =
  'Esa categoría ya no existe o no es de recursos de esta organización.';
const OFFER_NOT_FOUND =
  'No encontramos esa oferta en esta organización: puede que se haya eliminado.';

/** The single row → record mapping; the viewer decides what is withheld. */
function toResource(row: ResourceRow, viewer: Viewer): Resource {
  return forViewer(
    'resource',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      name: row.name,
      ownership: row.ownership,
      categoryId: row.category_id,
      warehouse:
        row.warehouse_id && row.warehouse_name
          ? {id: row.warehouse_id, name: row.warehouse_name}
          : null,
      company:
        row.company_id && row.company_name
          ? {id: row.company_id, name: row.company_name}
          : null,
      offerId: row.offer_id,
      quantity: toAmount(row.quantity),
      unit: row.unit,
      dimensions: row.dimensions,
      condition: row.condition,
      availability: row.availability,
      location: row.location,
      toAssess: Boolean(row.to_assess),
      notes: row.notes,
      taskIds: parseIds(row.task_ids),
    },
    viewer,
  );
}

/** The editable state of a resource, in comparable form. */
interface ResourceState {
  name: string;
  ownership: ResourceOwnership;
  categoryId: string | null;
  warehouseId: string | null;
  companyId: string | null;
  offerId: string | null;
  quantity: number | null;
  unit: string;
  dimensions: string | null;
  condition: ResourceCondition;
  availability: ResourceAvailability;
  location: string | null;
  toAssess: boolean;
  notes: string | null;
  source: DataSource | null;
  verification: Verification;
}

/** Contract field names, in a stable order, for the activity log. */
const FIELD_NAMES: readonly (readonly [keyof ResourceState, string])[] = [
  ['name', 'name'],
  ['ownership', 'ownership'],
  ['categoryId', 'categoryId'],
  ['warehouseId', 'warehouse'],
  ['companyId', 'company'],
  ['offerId', 'offerId'],
  ['quantity', 'quantity'],
  ['unit', 'unit'],
  ['dimensions', 'dimensions'],
  ['condition', 'condition'],
  ['availability', 'availability'],
  ['location', 'location'],
  ['toAssess', 'toAssess'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

const EMPTY: ResourceState = {
  name: '',
  ownership: 'owned',
  categoryId: null,
  warehouseId: null,
  companyId: null,
  offerId: null,
  quantity: null,
  unit: DEFAULT_RESOURCE_UNIT,
  dimensions: null,
  condition: 'unknown',
  availability: 'unknown',
  location: null,
  toAssess: false,
  notes: null,
  source: null,
  verification: 'draft',
};

function stateOf(row: ResourceRow): ResourceState {
  return {
    name: row.name,
    ownership: row.ownership,
    categoryId: row.category_id,
    warehouseId: row.warehouse_id,
    companyId: row.company_id,
    offerId: row.offer_id,
    quantity: toAmount(row.quantity),
    unit: row.unit,
    dimensions: row.dimensions,
    condition: row.condition,
    availability: row.availability,
    location: row.location,
    toAssess: Boolean(row.to_assess),
    notes: row.notes,
    source: row.source,
    verification: row.verification,
  };
}

/** Sorted by name, ignoring letter case. */
export async function listResources(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<Resource[]> {
  const rows = await db.query<ResourceRow>(
    `${SELECT_RESOURCE}
      WHERE r.organization_id = $1
      ORDER BY lower(r.name), r.id`,
    [organizationId],
  );
  return rows.map(r => toResource(r, viewer));
}

async function loadResource(
  db: Queryable,
  id: string,
  lock = false,
): Promise<ResourceRow | undefined> {
  const rows = await db.query<ResourceRow>(
    `${SELECT_RESOURCE} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`,
    [id],
  );
  return rows[0];
}

function resourceNotFound(): AppError {
  return notFound('No encontramos ese recurso: puede que se haya eliminado.');
}

function staleResource(row: ResourceRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado este recurso mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toResource(row, viewer)},
  );
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/**
 * Applies an input to a state (`before` = EMPTY when creating): plain fields,
 * category, warehouse, ownership, company and offer. Validates every link
 * against the organization first (400 with all field problems at once), then
 * finds or creates the warehouse and the company by name.
 */
async function applyInput(
  tx: Queryable,
  args: {
    organizationId: string;
    actorId: string;
    now: Date;
    /** The resource is demo data (its links never promote demo records). */
    isDemo: boolean;
    before: ResourceState;
    current: {warehouseName: string | null; companyName: string | null};
  },
  input: ResourceBody,
): Promise<ResourceState> {
  const {organizationId: orgId, before} = args;
  const after: ResourceState = {...before};
  if (input.name !== undefined) {
    after.name = normalizeName(input.name) ?? before.name;
  }
  if (input.ownership !== undefined) after.ownership = input.ownership;
  if (input.quantity !== undefined) after.quantity = input.quantity;
  if (input.unit !== undefined) after.unit = input.unit;
  if (input.dimensions !== undefined) after.dimensions = input.dimensions;
  if (input.condition !== undefined) after.condition = input.condition;
  if (input.availability !== undefined) {
    after.availability = input.availability;
  }
  if (input.location !== undefined) after.location = input.location;
  if (input.toAssess !== undefined) after.toAssess = input.toAssess;
  if (input.notes !== undefined) after.notes = input.notes;
  if (input.source !== undefined) after.source = input.source;
  if (input.verification !== undefined) {
    after.verification = input.verification;
  }

  const fields: Record<string, string> = ownershipProblems(
    after.ownership,
    input,
  );
  if (input.categoryId !== undefined) {
    if (
      input.categoryId &&
      !(await areCategoriesOfScope(tx, orgId, 'resource', [input.categoryId]))
    ) {
      fields.categoryId = CATEGORY_UNKNOWN;
    }
    after.categoryId = input.categoryId;
  }
  const warehouseById = input.warehouseId
    ? ((await findWarehouse(tx, orgId, input.warehouseId)) ?? null)
    : null;
  if (input.warehouseId && !warehouseById) {
    fields.warehouseId = WAREHOUSE_NOT_FOUND;
  }
  const contracted = after.ownership === 'contracted';
  const companyById =
    contracted && input.companyId
      ? ((await findCompany(tx, orgId, input.companyId)) ?? null)
      : null;
  if (contracted && input.companyId && !companyById) {
    fields.companyId = COMPANY_NOT_FOUND;
  }
  let offer: {id: string; companyId: string} | null | undefined;
  if (contracted && input.offerId !== undefined) {
    offer = null;
    if (input.offerId) {
      const found = (
        await tx.query<{id: string; company_id: string}>(
          'SELECT id, company_id FROM offers WHERE id = $1 AND organization_id = $2',
          [input.offerId, orgId],
        )
      )[0];
      if (found) offer = {id: found.id, companyId: found.company_id};
      else fields.offerId = OFFER_NOT_FOUND;
    }
  }
  throwIfFields(fields);

  const link = {
    organizationId: orgId,
    actorId: args.actorId,
    now: args.now,
    isDemo: args.isDemo,
  };
  const warehouse = await resolveWarehouseRef(
    tx,
    input,
    link,
    {id: before.warehouseId, name: args.current.warehouseName},
    warehouseById,
  );
  if (warehouse !== undefined) after.warehouseId = warehouse?.id ?? null;

  if (!contracted) {
    // Owned material: no company, no offer (also when it was contracted).
    after.companyId = null;
    after.offerId = null;
    return after;
  }
  const company = await resolveCompanyRef(
    tx,
    input,
    link,
    {id: before.companyId, name: args.current.companyName},
    companyById,
  );
  const companyId =
    company === undefined ? before.companyId : (company?.id ?? null);
  const resolved = resolveOffer({
    before: {companyId: before.companyId, offerId: before.offerId},
    companyId,
    companyGiven:
      input.companyId !== undefined || input.companyName !== undefined,
    offer,
  });
  if (!resolved.ok) throw validationError({offerId: resolved.message});
  after.companyId = resolved.companyId;
  after.offerId = resolved.offerId;
  // A demo company reached through its offer by a real resource becomes real.
  if (resolved.companyId && resolved.companyId !== companyId && !args.isDemo) {
    await promoteDemo(
      tx,
      'companies',
      resolved.companyId,
      args.actorId,
      args.now,
    );
  }
  return after;
}

export async function createResource(
  db: Db,
  actor: SessionUser,
  input: CreateResourceBody,
  now: Date,
): Promise<Created<Resource>> {
  const device: DeviceCreate<Resource> = {
    table: 'resources',
    id: input.id,
    organizationId: input.organizationId,
    actorId: actor.id,
    load: async (q, id) => {
      const row = await loadResource(q, id);
      return row && toResource(row, actor);
    },
  };
  return createOnce(db, device, async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    // Before applyInput: a replay must not find or create a warehouse again.
    const replay = await findReplay(tx, device, org.id);
    if (replay) return replay;
    const state = await applyInput(
      tx,
      {
        organizationId: org.id,
        actorId: actor.id,
        now,
        isDemo: false,
        before: EMPTY,
        current: {warehouseName: null, companyName: null},
      },
      input,
    );
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO resources
         (organization_id, name, ownership, category_id, warehouse_id,
          company_id, offer_id, quantity, unit, dimensions, condition,
          availability, location, to_assess, notes, source, verification,
          created_by, created_at, updated_by, updated_at, id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19::timestamptz, $18,
               $19::timestamptz, COALESCE($20::uuid, gen_random_uuid()))
       RETURNING id`,
      [
        org.id,
        state.name,
        state.ownership,
        state.categoryId,
        state.warehouseId,
        state.companyId,
        state.offerId,
        state.quantity,
        state.unit,
        state.dimensions,
        state.condition,
        state.availability,
        state.location,
        state.toAssess,
        state.notes,
        state.source,
        state.verification,
        actor.id,
        now.toISOString(),
        input.id ?? null,
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'resource',
      entityId: id,
      entityLabel: state.name,
      action: 'create',
      at: now,
    });
    return fresh(
      toResource((await loadResource(tx, id)) as ResourceRow, actor),
    );
  });
}

/** Loads the resource and checks membership; foreign ones are «not found». */
async function loadOwnResource(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<ResourceRow> {
  const row = await loadResource(tx, id);
  if (!row) throw resourceNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw resourceNotFound();
  }
  return row;
}

export async function updateResource(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateResourceBody,
  now: Date,
): Promise<Resource> {
  if (!isUuid(id)) throw resourceNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnResource(tx, actor, id)).organization_id;
    // A change of quantity, unit or dimensions may update several tasks (their
    // subsoil review is cleared): graph lock first, then the catalogue lock.
    const touchesMaterial =
      input.quantity !== undefined ||
      input.unit !== undefined ||
      input.dimensions !== undefined;
    if (touchesMaterial) await lockGraph(tx, orgId);
    await lockCatalogue(tx, orgId);
    const row = await loadResource(tx, id, true);
    if (!row) throw resourceNotFound();
    if (row.version !== input.version) throw staleResource(row, actor);

    const before = stateOf(row);
    const after = await applyInput(
      tx,
      {
        organizationId: orgId,
        actorId: actor.id,
        now,
        isDemo: row.is_demo,
        before,
        current: {
          warehouseName: row.warehouse_name,
          companyName: row.company_name,
        },
      },
      input,
    );
    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toResource(row, actor);

    await tx.query(
      `UPDATE resources
          SET name = $3, ownership = $4, category_id = $5, warehouse_id = $6,
              company_id = $7, offer_id = $8, quantity = $9::numeric,
              unit = $10, dimensions = $11, condition = $12,
              availability = $13, location = $14, to_assess = $15,
              notes = $16, source = $17, verification = $18,
              version = version + 1, updated_by = $19,
              updated_at = $20::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.name,
        after.ownership,
        after.categoryId,
        after.warehouseId,
        after.companyId,
        after.offerId,
        after.quantity,
        after.unit,
        after.dimensions,
        after.condition,
        after.availability,
        after.location,
        after.toAssess,
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
      entityType: 'resource',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    if (changed.some(f => MATERIAL_FIELDS.has(f))) {
      await clearSubsoilReviews(tx, {
        organizationId: orgId,
        resourceId: id,
        actorId: actor.id,
        now,
      });
    }
    return toResource((await loadResource(tx, id)) as ResourceRow, actor);
  });
}

/** Resource fields that describe the material a subsoil review was made for. */
const MATERIAL_FIELDS: ReadonlySet<string> = new Set([
  'quantity',
  'unit',
  'dimensions',
]);

/**
 * The material of a resource changed (quantity, unit or dimensions): the live
 * tasks that use it (not done or cancelled) lose their declared subsoil
 * review, with a new version, author and time and an activity entry, as when
 * a task's own resources change. Finished tasks keep it: the review was for
 * what was placed then. Never sets a review. The caller holds the graph and
 * catalogue locks (in that order).
 */
async function clearSubsoilReviews(
  tx: Queryable,
  args: {
    organizationId: string;
    resourceId: string;
    actorId: string;
    now: Date;
  },
): Promise<void> {
  const tasks = await tx.query<{id: string; title: string; is_demo: boolean}>(
    `SELECT t.id, t.title, t.is_demo
       FROM task_resources tr JOIN tasks t ON t.id = tr.task_id
      WHERE tr.resource_id = $1
        AND t.subsoil_reviewed_at IS NOT NULL
        AND t.status NOT IN ('done', 'cancelled')
      ORDER BY t.id
        FOR UPDATE OF t`,
    [args.resourceId],
  );
  for (const t of tasks) {
    await tx.query(
      `UPDATE tasks SET subsoil_reviewed_by = NULL, subsoil_reviewed_at = NULL,
              version = version + 1, updated_by = $2,
              updated_at = $3::timestamptz
        WHERE id = $1`,
      [t.id, args.actorId, args.now.toISOString()],
    );
    await appendActivity(tx, {
      organizationId: args.organizationId,
      userId: args.actorId,
      entityType: 'task',
      entityId: t.id,
      entityLabel: t.title,
      action: 'update',
      changedFields: ['subsoilReview'],
      at: args.now,
      isDemo: t.is_demo,
    });
  }
}

/**
 * Deletes a resource at the given version. Tasks that used it and notes that
 * pointed at it lose it: their versions increase and the changes are logged.
 */
export async function deleteResource(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw resourceNotFound();
  await db.transaction(async tx => {
    const orgId = (await loadOwnResource(tx, actor, id)).organization_id;
    // It updates several tasks: graph lock first, then the catalogue lock.
    await lockGraph(tx, orgId);
    await lockCatalogue(tx, orgId);
    const row = await loadResource(tx, id, true);
    if (!row) throw resourceNotFound();
    if (row.version !== version) throw staleResource(row, actor);

    const at = now.toISOString();
    const tasks = await tx.query<{
      id: string;
      title: string;
      is_demo: boolean;
      had_review: boolean;
    }>(
      `SELECT t.id, t.title, t.is_demo,
              t.subsoil_reviewed_at IS NOT NULL AS had_review
         FROM task_resources tr JOIN tasks t ON t.id = tr.task_id
        WHERE tr.resource_id = $1
        ORDER BY t.id
          FOR UPDATE OF t`,
      [id],
    );
    for (const t of tasks) {
      // The task's material changes, so a declared subsoil review (made for
      // that material) is cleared, as on a task edit.
      await tx.query(
        `UPDATE tasks SET version = version + 1, updated_by = $2,
                updated_at = $3::timestamptz,
                subsoil_reviewed_by = NULL, subsoil_reviewed_at = NULL
          WHERE id = $1`,
        [t.id, actor.id, at],
      );
    }
    await unlinkNotes(tx, {
      link: 'resource',
      ids: [id],
      actorId: actor.id,
      now,
    });
    // task_resources rows go with the resource (ON DELETE CASCADE).
    await tx.query('DELETE FROM resources WHERE id = $1', [id]);
    for (const t of tasks) {
      await appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType: 'task',
        entityId: t.id,
        entityLabel: t.title,
        action: 'update',
        changedFields: t.had_review
          ? ['resourceIds', 'subsoilReview']
          : ['resourceIds'],
        at: now,
        isDemo: t.is_demo,
      });
    }
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'resource',
      entityId: id,
      entityLabel: row.name,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
