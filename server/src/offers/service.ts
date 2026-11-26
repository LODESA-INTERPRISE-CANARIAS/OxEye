/**
 * Offers: what a company offers and on what terms. Only the name and the
 * company are required; an unknown price stays null («Pendiente de
 * verificar»), costs stay apart and VAT may be unknown. Every write holds the
 * organization's catalogue lock and appends to the activity log in the same
 * transaction. Guests never receive prices, costs or conditions (see
 * records/redact.ts).
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {areServiceCategories} from '../categories/service.ts';
import {
  COMPANY_NOT_FOUND,
  findCompany,
  resolveCompanyRef,
} from '../companies/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {normalizeName} from '../records/find-or-create.ts';
import {lockCatalogue} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {changedFields} from '../records/slot.ts';
import {resolveUnit, toAmount} from './domain.ts';
import type {CreateOfferBody, UpdateOfferBody} from './schemas.ts';
import type {
  DataSource,
  Offer,
  PriceUnit,
  SessionUser,
  Verification,
} from '../../../shared/logistics/contracts.ts';

interface OfferRow extends MetaRow {
  organization_id: string;
  company_id: string;
  company_name: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: unknown;
  unit: PriceUnit;
  custom_unit: string | null;
  transport_cost: unknown;
  assembly_cost: unknown;
  maintenance_cost: unknown;
  conditions: string | null;
  vat_included: boolean | null;
}

// Amounts come back as text so both drivers agree; toAmount makes numbers.
const SELECT_OFFER = `
  SELECT ${metaColumns('o')}, o.organization_id, o.company_id,
         c.name AS company_name, o.category_id, o.name, o.description,
         o.price::text AS price, o.unit, o.custom_unit,
         o.transport_cost::text AS transport_cost,
         o.assembly_cost::text AS assembly_cost,
         o.maintenance_cost::text AS maintenance_cost,
         o.conditions, o.vat_included
    FROM offers o
    JOIN companies c ON c.id = o.company_id
    ${authorJoins('o')}`;

const COMPANY_REQUIRED = 'Indica la empresa o entidad que hace la oferta.';
const CATEGORY_UNKNOWN =
  'Esa categoría ya no existe o no es de servicios de esta organización.';

/** The single row → record mapping; the viewer decides what is withheld. */
function toOffer(row: OfferRow, viewer: Viewer): Offer {
  return forViewer(
    'offer',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      company: {id: row.company_id, name: row.company_name},
      categoryId: row.category_id,
      name: row.name,
      description: row.description,
      price: toAmount(row.price),
      unit: row.unit,
      customUnit: row.custom_unit,
      transportCost: toAmount(row.transport_cost),
      assemblyCost: toAmount(row.assembly_cost),
      maintenanceCost: toAmount(row.maintenance_cost),
      conditions: row.conditions,
      vatIncluded: row.vat_included,
    },
    viewer,
  );
}

/** The editable state of an offer, in comparable form. */
interface OfferState {
  name: string;
  companyId: string;
  categoryId: string | null;
  description: string | null;
  price: number | null;
  unit: PriceUnit;
  customUnit: string | null;
  transportCost: number | null;
  assemblyCost: number | null;
  maintenanceCost: number | null;
  conditions: string | null;
  vatIncluded: boolean | null;
  source: DataSource | null;
  verification: Verification;
}

const FIELD_NAMES: readonly (readonly [keyof OfferState, string])[] = [
  ['name', 'name'],
  ['companyId', 'company'],
  ['categoryId', 'categoryId'],
  ['description', 'description'],
  ['price', 'price'],
  ['unit', 'unit'],
  ['customUnit', 'customUnit'],
  ['transportCost', 'transportCost'],
  ['assemblyCost', 'assemblyCost'],
  ['maintenanceCost', 'maintenanceCost'],
  ['conditions', 'conditions'],
  ['vatIncluded', 'vatIncluded'],
  ['source', 'source'],
  ['verification', 'verification'],
];

function stateOf(row: OfferRow): OfferState {
  return {
    name: row.name,
    companyId: row.company_id,
    categoryId: row.category_id,
    description: row.description,
    price: toAmount(row.price),
    unit: row.unit,
    customUnit: row.custom_unit,
    transportCost: toAmount(row.transport_cost),
    assemblyCost: toAmount(row.assembly_cost),
    maintenanceCost: toAmount(row.maintenance_cost),
    conditions: row.conditions,
    vatIncluded: row.vat_included,
    source: row.source,
    verification: row.verification,
  };
}

/** Sorted by company, then name, ignoring letter case. */
export async function listOffers(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<Offer[]> {
  const rows = await db.query<OfferRow>(
    `${SELECT_OFFER}
      WHERE o.organization_id = $1
      ORDER BY lower(c.name), c.id, lower(o.name), o.id`,
    [organizationId],
  );
  return rows.map(r => toOffer(r, viewer));
}

async function loadOffer(
  db: Queryable,
  id: string,
  lock = false,
): Promise<OfferRow | undefined> {
  const rows = await db.query<OfferRow>(
    `${SELECT_OFFER} WHERE o.id = $1${lock ? ' FOR UPDATE OF o' : ''}`,
    [id],
  );
  return rows[0];
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

async function checkCategory(
  tx: Queryable,
  organizationId: string,
  categoryId: string | null | undefined,
  fields: Record<string, string>,
): Promise<void> {
  if (!categoryId) return;
  if (!(await areServiceCategories(tx, organizationId, [categoryId]))) {
    fields.categoryId = CATEGORY_UNKNOWN;
  }
}

export async function createOffer(
  db: Db,
  actor: SessionUser,
  input: CreateOfferBody,
  now: Date,
): Promise<Offer> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);

    const fields: Record<string, string> = {};
    const companyById = input.companyId
      ? ((await findCompany(tx, org.id, input.companyId)) ?? null)
      : null;
    if (input.companyId && !companyById) fields.companyId = COMPANY_NOT_FOUND;
    if (!input.companyId && !normalizeName(input.companyName)) {
      fields.companyName = COMPANY_REQUIRED;
    }
    await checkCategory(tx, org.id, input.categoryId, fields);
    throwIfFields(fields);

    const company = await resolveCompanyRef(
      tx,
      {companyName: input.companyName},
      {organizationId: org.id, actorId: actor.id, now, isDemo: false},
      {id: null, name: null},
      companyById,
    );
    if (!company) throw validationError({companyName: COMPANY_REQUIRED});
    const {unit, customUnit} = resolveUnit(
      {unit: 'unit', customUnit: null},
      input,
    );

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO offers
         (organization_id, company_id, category_id, name, description, price,
          unit, custom_unit, transport_cost, assembly_cost, maintenance_cost,
          conditions, vat_included, source, verification,
          created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::numeric,
               $10::numeric, $11::numeric, $12, $13, $14, $15,
               $16, $17::timestamptz, $16, $17::timestamptz)
       RETURNING id`,
      [
        org.id,
        company.id,
        input.categoryId ?? null,
        input.name,
        input.description ?? null,
        input.price ?? null,
        unit,
        customUnit,
        input.transportCost ?? null,
        input.assemblyCost ?? null,
        input.maintenanceCost ?? null,
        input.conditions ?? null,
        input.vatIncluded ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        actor.id,
        now.toISOString(),
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'offer',
      entityId: id,
      entityLabel: input.name,
      action: 'create',
      at: now,
    });
    return toOffer((await loadOffer(tx, id)) as OfferRow, actor);
  });
}

function offerNotFound(): AppError {
  return notFound('No encontramos esa oferta: puede que se haya eliminado.');
}

function staleOffer(row: OfferRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado esta oferta mientras la editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toOffer(row, viewer)},
  );
}

/** Loads the offer and checks membership; foreign offers are «not found». */
async function loadOwnOffer(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<OfferRow> {
  const row = await loadOffer(tx, id);
  if (!row) throw offerNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw offerNotFound();
  }
  return row;
}

export async function updateOffer(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateOfferBody,
  now: Date,
): Promise<Offer> {
  if (!isUuid(id)) throw offerNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnOffer(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadOffer(tx, id, true);
    if (!row) throw offerNotFound();
    if (row.version !== input.version) throw staleOffer(row, actor);

    const before = stateOf(row);
    const after: OfferState = {...before};
    if (input.name !== undefined) after.name = input.name;
    if (input.description !== undefined) after.description = input.description;
    if (input.price !== undefined) after.price = input.price;
    if (input.transportCost !== undefined) {
      after.transportCost = input.transportCost;
    }
    if (input.assemblyCost !== undefined) {
      after.assemblyCost = input.assemblyCost;
    }
    if (input.maintenanceCost !== undefined) {
      after.maintenanceCost = input.maintenanceCost;
    }
    if (input.conditions !== undefined) after.conditions = input.conditions;
    if (input.vatIncluded !== undefined) after.vatIncluded = input.vatIncluded;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }
    Object.assign(after, resolveUnit(before, input));

    const fields: Record<string, string> = {};
    const companyById = input.companyId
      ? ((await findCompany(tx, orgId, input.companyId)) ?? null)
      : null;
    if (input.companyId && !companyById) fields.companyId = COMPANY_NOT_FOUND;
    // An offer always has a company: it can change, never be cleared.
    const clearsCompany =
      !input.companyId &&
      (input.companyName !== undefined
        ? !normalizeName(input.companyName)
        : input.companyId === null);
    if (clearsCompany) fields.companyName = COMPANY_REQUIRED;
    if (input.categoryId !== undefined) {
      await checkCategory(tx, orgId, input.categoryId, fields);
      after.categoryId = input.categoryId;
    }
    throwIfFields(fields);

    const company = await resolveCompanyRef(
      tx,
      {companyName: input.companyName},
      {organizationId: orgId, actorId: actor.id, now, isDemo: row.is_demo},
      {id: row.company_id, name: row.company_name},
      companyById,
    );
    if (company) after.companyId = company.id;

    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toOffer(row, actor);

    await tx.query(
      `UPDATE offers
          SET name = $3, company_id = $4, category_id = $5, description = $6,
              price = $7::numeric, unit = $8, custom_unit = $9,
              transport_cost = $10::numeric, assembly_cost = $11::numeric,
              maintenance_cost = $12::numeric, conditions = $13,
              vat_included = $14, source = $15, verification = $16,
              version = version + 1, updated_by = $17, updated_at = $18::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.name,
        after.companyId,
        after.categoryId,
        after.description,
        after.price,
        after.unit,
        after.customUnit,
        after.transportCost,
        after.assemblyCost,
        after.maintenanceCost,
        after.conditions,
        after.vatIncluded,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'offer',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toOffer((await loadOffer(tx, id)) as OfferRow, actor);
  });
}

export async function deleteOffer(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw offerNotFound();
  await db.transaction(async tx => {
    const orgId = (await loadOwnOffer(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadOffer(tx, id, true);
    if (!row) throw offerNotFound();
    if (row.version !== version) throw staleOffer(row, actor);
    await tx.query('DELETE FROM offers WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'offer',
      entityId: id,
      entityLabel: row.name,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
