/**
 * Companies (suppliers, installers, transport). Milestone 2 needs only the
 * list and find-or-create by name from a task; milestone 3 adds editing,
 * categories, contacts and offers.
 */
import type {Queryable} from '../db/db.ts';
import {findOrCreateByName} from '../records/find-or-create.ts';
import type {NamedRef} from '../records/find-or-create.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import type {Company} from '../../../shared/logistics/contracts.ts';

interface CompanyRow extends MetaRow {
  organization_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  main_contact_id: string | null;
}

function toCompany(row: CompanyRow): Company {
  return {
    ...toMeta(row),
    organizationId: row.organization_id,
    name: row.name,
    // Categories and offers arrive in milestone 3.
    categoryIds: [],
    phone: row.phone,
    email: row.email,
    website: row.website,
    notes: row.notes,
    mainContactId: row.main_contact_id,
    offerCount: 0,
  };
}

/** Sorted by name, ignoring letter case. */
export async function listCompanies(
  db: Queryable,
  organizationId: string,
): Promise<Company[]> {
  const rows = await db.query<CompanyRow>(
    `SELECT ${metaColumns('c')}, c.organization_id, c.name, c.phone, c.email,
            c.website, c.notes, c.main_contact_id
       FROM companies c ${authorJoins('c')}
      WHERE c.organization_id = $1
      ORDER BY lower(c.name), c.id`,
    [organizationId],
  );
  return rows.map(toCompany);
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
 * creates it (logging the creation). A demo company used by real data
 * becomes real.
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
