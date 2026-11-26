/**
 * «Empresas y entidades»: suppliers, public bodies, associations and other
 * counterparts in one list. Created by name from anywhere (tasks, contacts,
 * offers) or in full here; edited and deleted with optimistic concurrency.
 * Every write holds the organization's catalogue lock and appends to the
 * activity log in the same transaction. Guests never receive phone, e-mail
 * or notes (see records/redact.ts).
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {
  areServiceCategories,
  categoryOrder,
  CATEGORIES_UNKNOWN,
} from '../categories/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {
  findOrCreateByName,
  normalizeName,
  promoteDemo,
} from '../records/find-or-create.ts';
import type {NamedRef} from '../records/find-or-create.ts';
import {byId, normalizeIds, parseOrderedIds} from '../records/ids.ts';
import {lockCatalogue, lockGraph} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {changedFields} from '../records/slot.ts';
import type {CreateCompanyBody, UpdateCompanyBody} from './schemas.ts';
import type {
  Company,
  CompanyKind,
  DataSource,
  SessionUser,
  Verification,
} from '../../../shared/logistics/contracts.ts';

interface CompanyRow extends MetaRow {
  organization_id: string;
  name: string;
  kind: CompanyKind;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  main_contact_id: string | null;
  category_ids: unknown;
  contact_count: number;
  offer_count: number;
}

const SELECT_COMPANY = `
  SELECT ${metaColumns('c')}, c.organization_id, c.name, c.kind, c.phone,
         c.email, c.website, c.notes, c.main_contact_id,
         COALESCE((SELECT jsonb_agg(cc.category_id ORDER BY ${categoryOrder('cat')})
                     FROM company_categories cc
                     JOIN categories cat ON cat.id = cc.category_id
                    WHERE cc.company_id = c.id), '[]'::jsonb) AS category_ids,
         (SELECT count(*)::int FROM contacts k WHERE k.company_id = c.id) AS contact_count,
         (SELECT count(*)::int FROM offers o WHERE o.company_id = c.id) AS offer_count
    FROM companies c ${authorJoins('c')}`;

export const COMPANY_NOT_FOUND =
  'No encontramos esa empresa en esta organización: puede que se haya eliminado.';
export const MAIN_CONTACT_NOT_OF_COMPANY =
  'Esa persona no es de esta empresa o entidad: asígnale antes la empresa en su ficha.';
const MAIN_CONTACT_ON_CREATE =
  'Una empresa nueva aún no tiene personas: guárdala y después elige su contacto principal.';

/** The single row → record mapping; the viewer decides what is withheld. */
function toCompany(row: CompanyRow, viewer: Viewer): Company {
  return forViewer(
    'company',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      name: row.name,
      kind: row.kind,
      categoryIds: parseOrderedIds(row.category_ids),
      phone: row.phone,
      email: row.email,
      website: row.website,
      notes: row.notes,
      mainContactId: row.main_contact_id,
      contactCount: Number(row.contact_count),
      offerCount: Number(row.offer_count),
    },
    viewer,
  );
}

/** The editable state of a company, in comparable form. */
interface CompanyState {
  name: string;
  kind: CompanyKind;
  /** Sorted ids. */
  categoryIds: string[];
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  mainContactId: string | null;
  source: DataSource | null;
  verification: Verification;
}

const FIELD_NAMES: readonly (readonly [keyof CompanyState, string])[] = [
  ['name', 'name'],
  ['kind', 'kind'],
  ['categoryIds', 'categoryIds'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['website', 'website'],
  ['notes', 'notes'],
  ['mainContactId', 'mainContactId'],
  ['source', 'source'],
  ['verification', 'verification'],
];

function stateOf(row: CompanyRow): CompanyState {
  return {
    name: row.name,
    kind: row.kind,
    categoryIds: normalizeIds(parseOrderedIds(row.category_ids)),
    phone: row.phone,
    email: row.email,
    website: row.website,
    notes: row.notes,
    mainContactId: row.main_contact_id,
    source: row.source,
    verification: row.verification,
  };
}

/** Sorted by name, ignoring letter case. */
export async function listCompanies(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<Company[]> {
  const rows = await db.query<CompanyRow>(
    `${SELECT_COMPANY}
      WHERE c.organization_id = $1
      ORDER BY lower(c.name), c.id`,
    [organizationId],
  );
  return rows.map(r => toCompany(r, viewer));
}

async function loadCompany(
  db: Queryable,
  id: string,
  lock = false,
): Promise<CompanyRow | undefined> {
  const rows = await db.query<CompanyRow>(
    `${SELECT_COMPANY} WHERE c.id = $1${lock ? ' FOR UPDATE OF c' : ''}`,
    [id],
  );
  return rows[0];
}

/** The company if it belongs to the organization. */
export async function findCompany(
  db: Queryable,
  organizationId: string,
  id: string,
): Promise<NamedRef | undefined> {
  const rows = await db.query<{id: string; name: string; is_demo: boolean}>(
    'SELECT id, name, is_demo FROM companies WHERE id = $1 AND organization_id = $2',
    [id, organizationId],
  );
  const row = rows[0];
  return row ? {id: row.id, name: row.name, isDemo: row.is_demo} : undefined;
}

/**
 * Finds a company of the organization by name, ignoring letter case, or
 * creates it as a supplier (logging the creation). A demo company used by
 * real data becomes real.
 */
export function findOrCreateCompany(
  tx: Queryable,
  args: {
    organizationId: string;
    name: string;
    actorId: string;
    now: Date;
    isDemo?: boolean;
  },
): Promise<NamedRef> {
  return findOrCreateByName(tx, 'companies', args);
}

/**
 * Resolves `companyId` / `companyName` of a task, contact or offer to a
 * company; `undefined` = unchanged, null = none. `companyId` wins (pass the
 * company it found as `byId`); a name finds or creates. A demo company used
 * by a real record becomes real.
 */
export async function resolveCompanyRef(
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

function companyNotFound(): AppError {
  return notFound(
    'No encontramos esa empresa o entidad: puede que se haya eliminado.',
  );
}

function staleCompany(row: CompanyRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado esta empresa mientras la editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toCompany(row, viewer)},
  );
}

function duplicateCompany(row: CompanyRow, viewer: Viewer): AppError {
  return new AppError(
    'DUPLICATE',
    `Ya existe «${row.name}» en Empresas y entidades. Ábrela para completarla en lugar de crear otra.`,
    {current: toCompany(row, viewer)},
  );
}

async function findByName(
  tx: Queryable,
  organizationId: string,
  name: string,
): Promise<CompanyRow | undefined> {
  const rows = await tx.query<CompanyRow>(
    `${SELECT_COMPANY}
      WHERE c.organization_id = $1 AND lower(c.name) = lower($2)`,
    [organizationId, name],
  );
  return rows[0];
}

async function writeCategories(
  tx: Queryable,
  companyId: string,
  categoryIds: readonly string[],
): Promise<void> {
  await tx.query('DELETE FROM company_categories WHERE company_id = $1', [
    companyId,
  ]);
  if (categoryIds.length === 0) return;
  await tx.query(
    `INSERT INTO company_categories (company_id, category_id)
     SELECT $1::uuid, value::uuid FROM jsonb_array_elements_text($2::jsonb)`,
    [companyId, JSON.stringify(categoryIds)],
  );
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

export async function createCompany(
  db: Db,
  actor: SessionUser,
  input: CreateCompanyBody,
  now: Date,
): Promise<Company> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    const name = normalizeName(input.name) as string;
    const categoryIds = input.categoryIds ?? [];

    const fields: Record<string, string> = {};
    if (!(await areServiceCategories(tx, org.id, categoryIds))) {
      fields.categoryIds = CATEGORIES_UNKNOWN;
    }
    if (input.mainContactId) fields.mainContactId = MAIN_CONTACT_ON_CREATE;
    throwIfFields(fields);

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO companies
         (organization_id, name, kind, phone, email, website, notes, source,
          verification, created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz,
               $10, $11::timestamptz)
       ON CONFLICT (organization_id, (lower(name))) DO NOTHING
       RETURNING id`,
      [
        org.id,
        name,
        input.kind ?? 'supplier',
        input.phone ?? null,
        input.email ?? null,
        input.website ?? null,
        input.notes ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        actor.id,
        now.toISOString(),
      ],
    );
    const created = inserted[0];
    if (!created) {
      const existing = await findByName(tx, org.id, name);
      if (!existing) throw new Error('company vanished during create');
      throw duplicateCompany(existing, actor);
    }
    await writeCategories(tx, created.id, categoryIds);
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'company',
      entityId: created.id,
      entityLabel: name,
      action: 'create',
      at: now,
    });
    return toCompany((await loadCompany(tx, created.id)) as CompanyRow, actor);
  });
}

/** Loads the company and checks membership; foreign companies are «not found». */
async function loadOwnCompany(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<CompanyRow> {
  const row = await loadCompany(tx, id);
  if (!row) throw companyNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw companyNotFound();
  }
  return row;
}

export async function updateCompany(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateCompanyBody,
  now: Date,
): Promise<Company> {
  if (!isUuid(id)) throw companyNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnCompany(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadCompany(tx, id, true);
    if (!row) throw companyNotFound();
    if (row.version !== input.version) throw staleCompany(row, actor);

    const before = stateOf(row);
    const after: CompanyState = {...before};
    if (input.name !== undefined) {
      after.name = normalizeName(input.name) ?? before.name;
    }
    if (input.kind !== undefined) after.kind = input.kind;
    if (input.phone !== undefined) after.phone = input.phone;
    if (input.email !== undefined) after.email = input.email;
    if (input.website !== undefined) after.website = input.website;
    if (input.notes !== undefined) after.notes = input.notes;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }

    const fields: Record<string, string> = {};
    if (input.categoryIds !== undefined) {
      if (await areServiceCategories(tx, orgId, input.categoryIds)) {
        after.categoryIds = input.categoryIds;
      } else {
        fields.categoryIds = CATEGORIES_UNKNOWN;
      }
    }
    let mainContact: {id: string; is_demo: boolean} | undefined;
    if (
      input.mainContactId !== undefined &&
      input.mainContactId !== before.mainContactId
    ) {
      if (input.mainContactId === null) {
        after.mainContactId = null;
      } else {
        mainContact = (
          await tx.query<{id: string; is_demo: boolean}>(
            `SELECT id, is_demo FROM contacts
              WHERE id = $1 AND organization_id = $2 AND company_id = $3`,
            [input.mainContactId, orgId, id],
          )
        )[0];
        if (mainContact) after.mainContactId = mainContact.id;
        else fields.mainContactId = MAIN_CONTACT_NOT_OF_COMPANY;
      }
    }
    throwIfFields(fields);

    if (after.name.toLowerCase() !== before.name.toLowerCase()) {
      const clash = await findByName(tx, orgId, after.name);
      if (clash && clash.id !== id) throw duplicateCompany(clash, actor);
    }

    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toCompany(row, actor);

    await tx.query(
      `UPDATE companies
          SET name = $3, kind = $4, phone = $5, email = $6, website = $7,
              notes = $8, main_contact_id = $9, source = $10, verification = $11,
              version = version + 1, updated_by = $12, updated_at = $13::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.name,
        after.kind,
        after.phone,
        after.email,
        after.website,
        after.notes,
        after.mainContactId,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    if (changed.includes('categoryIds')) {
      await writeCategories(tx, id, after.categoryIds);
    }
    // A demo person chosen as main contact of a real company becomes real.
    if (mainContact?.is_demo && !row.is_demo) {
      await promoteDemo(tx, 'contacts', mainContact.id, actor.id, now);
    }
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'company',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toCompany((await loadCompany(tx, id)) as CompanyRow, actor);
  });
}

/**
 * Deletes a company at the given version, with its offers. Its contacts and
 * tasks stay without a company: their version increases and the change is
 * logged, so a stale edit cannot restore the link silently.
 */
export async function deleteCompany(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw companyNotFound();
  await db.transaction(async tx => {
    const orgId = (await loadOwnCompany(tx, actor, id)).organization_id;
    // It updates several tasks: graph lock first, then the catalogue lock.
    await lockGraph(tx, orgId);
    await lockCatalogue(tx, orgId);
    const row = await loadCompany(tx, id, true);
    if (!row) throw companyNotFound();
    if (row.version !== version) throw staleCompany(row, actor);

    const at = now.toISOString();
    const contacts = await tx.query<{
      id: string;
      name: string;
      is_demo: boolean;
    }>(
      `UPDATE contacts
          SET company_id = NULL, version = version + 1,
              updated_by = $2, updated_at = $3::timestamptz
        WHERE company_id = $1
        RETURNING id, name, is_demo`,
      [id, actor.id, at],
    );
    const offers = await tx.query<{id: string; name: string; is_demo: boolean}>(
      'DELETE FROM offers WHERE company_id = $1 RETURNING id, name, is_demo',
      [id],
    );
    const tasks = await unlinkTasks(tx, 'company_id', id, actor.id, now);
    await tx.query('DELETE FROM companies WHERE id = $1', [id]);

    const log = (
      entityType: string,
      r: {id: string; name: string; is_demo: boolean},
      action: 'update' | 'delete',
      changedFields?: string[],
    ) =>
      appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType,
        entityId: r.id,
        entityLabel: r.name,
        action,
        changedFields,
        at: now,
        isDemo: r.is_demo,
      });
    for (const c of [...contacts].sort(byId)) {
      await log('contact', c, 'update', ['company']);
    }
    for (const o of [...offers].sort(byId)) await log('offer', o, 'delete');
    for (const t of tasks) await log('task', t, 'update', ['company']);
    await log('company', row, 'delete');
  });
}

/**
 * Removes a company or contact link from every task that has it, locking the
 * tasks by id first (the caller holds the graph lock). Returns the tasks
 * changed, by id, with their title as `name` for the activity log.
 */
export async function unlinkTasks(
  tx: Queryable,
  column: 'company_id' | 'contact_id',
  id: string,
  actorId: string,
  now: Date,
): Promise<{id: string; name: string; is_demo: boolean}[]> {
  const rows = await tx.query<{id: string; name: string; is_demo: boolean}>(
    `SELECT id, title AS name, is_demo FROM tasks
      WHERE ${column} = $1 ORDER BY id FOR UPDATE`,
    [id],
  );
  if (rows.length === 0) return [];
  await tx.query(
    `UPDATE tasks SET ${column} = NULL, version = version + 1,
            updated_by = $2, updated_at = $3::timestamptz
      WHERE ${column} = $1`,
    [id, actorId, now.toISOString()],
  );
  return rows;
}
