/**
 * Contacts: the people the team calls on site. Only the name is required;
 * two people may share a name (the UI warns about look-alikes). Every write
 * holds the organization's catalogue lock and appends to the activity log in
 * the same transaction. Guests never receive phone, e-mail, description or
 * notes (see records/redact.ts).
 *
 * A company's main contact is always one of its own contacts: moving a
 * contact to another company (or none), or deleting it, clears it as main
 * contact of the old company, whose version increases.
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {
  COMPANY_NOT_FOUND,
  findCompany,
  resolveCompanyRef,
  unlinkTasks,
} from '../companies/service.ts';
import {unlinkNotes} from '../notes/refs.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {promoteDemo} from '../records/find-or-create.ts';
import {byId, parseIds} from '../records/ids.ts';
import {lockCatalogue, lockGraph} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {changedFields} from '../records/slot.ts';
import type {CreateContactBody, UpdateContactBody} from './schemas.ts';
import type {
  Contact,
  DataSource,
  SessionUser,
  Verification,
} from '../../../shared/logistics/contracts.ts';

interface ContactRow extends MetaRow {
  organization_id: string;
  name: string;
  role: string | null;
  company_id: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  notes: string | null;
  event_ids: unknown;
}

const SELECT_CONTACT = `
  SELECT ${metaColumns('k')}, k.organization_id, k.name, k.role,
         k.company_id, c.name AS company_name, k.phone, k.email,
         k.description, k.notes,
         COALESCE((SELECT jsonb_agg(ce.event_id ORDER BY ce.event_id)
                     FROM contact_events ce WHERE ce.contact_id = k.id),
                  '[]'::jsonb) AS event_ids
    FROM contacts k
    LEFT JOIN companies c ON c.id = k.company_id
    ${authorJoins('k')}`;

export const CONTACT_NOT_FOUND =
  'No encontramos esa persona en esta organización: puede que se haya eliminado.';
const EVENTS_UNKNOWN =
  'Alguno de los eventos ya no existe o no es de esta organización.';

/** The single row → record mapping; the viewer decides what is withheld. */
function toContact(row: ContactRow, viewer: Viewer): Contact {
  return forViewer(
    'contact',
    {
      ...toMeta(row),
      organizationId: row.organization_id,
      name: row.name,
      role: row.role,
      company:
        row.company_id && row.company_name
          ? {id: row.company_id, name: row.company_name}
          : null,
      phone: row.phone,
      email: row.email,
      description: row.description,
      notes: row.notes,
      eventIds: parseIds(row.event_ids),
    },
    viewer,
  );
}

/** The editable state of a contact, in comparable form. */
interface ContactState {
  name: string;
  role: string | null;
  companyId: string | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  notes: string | null;
  /** Sorted ids. */
  eventIds: string[];
  source: DataSource | null;
  verification: Verification;
}

const FIELD_NAMES: readonly (readonly [keyof ContactState, string])[] = [
  ['name', 'name'],
  ['role', 'role'],
  ['companyId', 'company'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['description', 'description'],
  ['notes', 'notes'],
  ['eventIds', 'eventIds'],
  ['source', 'source'],
  ['verification', 'verification'],
];

function stateOf(row: ContactRow): ContactState {
  return {
    name: row.name,
    role: row.role,
    companyId: row.company_id,
    phone: row.phone,
    email: row.email,
    description: row.description,
    notes: row.notes,
    eventIds: parseIds(row.event_ids),
    source: row.source,
    verification: row.verification,
  };
}

/** Sorted by name, ignoring letter case. */
export async function listContacts(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<Contact[]> {
  const rows = await db.query<ContactRow>(
    `${SELECT_CONTACT}
      WHERE k.organization_id = $1
      ORDER BY lower(k.name), k.id`,
    [organizationId],
  );
  return rows.map(r => toContact(r, viewer));
}

async function loadContact(
  db: Queryable,
  id: string,
  lock = false,
): Promise<ContactRow | undefined> {
  const rows = await db.query<ContactRow>(
    `${SELECT_CONTACT} WHERE k.id = $1${lock ? ' FOR UPDATE OF k' : ''}`,
    [id],
  );
  return rows[0];
}

export interface ContactRef {
  id: string;
  name: string;
  isDemo: boolean;
  companyId: string | null;
}

/** The contact if it belongs to the organization. */
export async function findContact(
  db: Queryable,
  organizationId: string,
  id: string,
): Promise<ContactRef | undefined> {
  const rows = await db.query<{
    id: string;
    name: string;
    is_demo: boolean;
    company_id: string | null;
  }>(
    `SELECT id, name, is_demo, company_id FROM contacts
      WHERE id = $1 AND organization_id = $2`,
    [id, organizationId],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        isDemo: row.is_demo,
        companyId: row.company_id,
      }
    : undefined;
}

/**
 * A demo contact used by real data (a task) becomes real, and so does its
 * demo company, so removing the demo never takes them away.
 */
export async function promoteContact(
  tx: Queryable,
  contact: ContactRef,
  actorId: string,
  now: Date,
): Promise<void> {
  if (!contact.isDemo) return;
  if (contact.companyId) {
    await promoteDemo(tx, 'companies', contact.companyId, actorId, now);
  }
  await promoteDemo(tx, 'contacts', contact.id, actorId, now);
}

/** True when every id is an event of the organization. */
async function areOwnEvents(
  tx: Queryable,
  organizationId: string,
  ids: readonly string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await tx.query<{n: number}>(
    `SELECT count(*)::int AS n FROM events
      WHERE organization_id = $1
        AND id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))`,
    [organizationId, JSON.stringify(ids)],
  );
  return rows[0]?.n === ids.length;
}

async function writeEvents(
  tx: Queryable,
  contactId: string,
  eventIds: readonly string[],
): Promise<void> {
  await tx.query('DELETE FROM contact_events WHERE contact_id = $1', [
    contactId,
  ]);
  if (eventIds.length === 0) return;
  await tx.query(
    `INSERT INTO contact_events (contact_id, event_id)
     SELECT $1::uuid, value::uuid FROM jsonb_array_elements_text($2::jsonb)`,
    [contactId, JSON.stringify(eventIds)],
  );
}

/**
 * Clears the contact as main contact of whichever company has it (bumping
 * that company and logging the change).
 */
async function releaseMainContact(
  tx: Queryable,
  args: {
    organizationId: string;
    contactId: string;
    actorId: string;
    now: Date;
  },
): Promise<void> {
  const companies = await tx.query<{
    id: string;
    name: string;
    is_demo: boolean;
  }>(
    `UPDATE companies
        SET main_contact_id = NULL, version = version + 1,
            updated_by = $2, updated_at = $3::timestamptz
      WHERE main_contact_id = $1
      RETURNING id, name, is_demo`,
    [args.contactId, args.actorId, args.now.toISOString()],
  );
  for (const c of [...companies].sort(byId)) {
    await appendActivity(tx, {
      organizationId: args.organizationId,
      userId: args.actorId,
      entityType: 'company',
      entityId: c.id,
      entityLabel: c.name,
      action: 'update',
      changedFields: ['mainContactId'],
      at: args.now,
      isDemo: c.is_demo,
    });
  }
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

export async function createContact(
  db: Db,
  actor: SessionUser,
  input: CreateContactBody,
  now: Date,
): Promise<Contact> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    const eventIds = input.eventIds ?? [];

    const fields: Record<string, string> = {};
    const companyById = input.companyId
      ? ((await findCompany(tx, org.id, input.companyId)) ?? null)
      : null;
    if (input.companyId && !companyById) fields.companyId = COMPANY_NOT_FOUND;
    if (!(await areOwnEvents(tx, org.id, eventIds))) {
      fields.eventIds = EVENTS_UNKNOWN;
    }
    throwIfFields(fields);

    const company = await resolveCompanyRef(
      tx,
      input,
      {organizationId: org.id, actorId: actor.id, now, isDemo: false},
      {id: null, name: null},
      companyById,
    );
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO contacts
         (organization_id, company_id, name, role, phone, email, description,
          notes, source, verification, created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz,
               $11, $12::timestamptz)
       RETURNING id`,
      [
        org.id,
        company?.id ?? null,
        input.name,
        input.role ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.description ?? null,
        input.notes ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        actor.id,
        now.toISOString(),
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await writeEvents(tx, id, eventIds);
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'contact',
      entityId: id,
      entityLabel: input.name,
      action: 'create',
      at: now,
    });
    return toContact((await loadContact(tx, id)) as ContactRow, actor);
  });
}

function contactNotFound(): AppError {
  return notFound('No encontramos esa persona: puede que se haya eliminado.');
}

function staleContact(row: ContactRow, viewer: Viewer): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado esta ficha mientras la editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toContact(row, viewer)},
  );
}

/** Loads the contact and checks membership; foreign contacts are «not found». */
async function loadOwnContact(
  tx: Queryable,
  actor: SessionUser,
  id: string,
): Promise<ContactRow> {
  const row = await loadContact(tx, id);
  if (!row) throw contactNotFound();
  try {
    await requireMembership(tx, actor.id, row.organization_id);
  } catch {
    throw contactNotFound();
  }
  return row;
}

export async function updateContact(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateContactBody,
  now: Date,
): Promise<Contact> {
  if (!isUuid(id)) throw contactNotFound();
  return db.transaction(async tx => {
    const orgId = (await loadOwnContact(tx, actor, id)).organization_id;
    await lockCatalogue(tx, orgId);
    const row = await loadContact(tx, id, true);
    if (!row) throw contactNotFound();
    if (row.version !== input.version) throw staleContact(row, actor);

    const before = stateOf(row);
    const after: ContactState = {...before};
    if (input.name !== undefined) after.name = input.name;
    if (input.role !== undefined) after.role = input.role;
    if (input.phone !== undefined) after.phone = input.phone;
    if (input.email !== undefined) after.email = input.email;
    if (input.description !== undefined) {
      after.description = input.description;
    }
    if (input.notes !== undefined) after.notes = input.notes;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }

    const fields: Record<string, string> = {};
    const companyById = input.companyId
      ? ((await findCompany(tx, orgId, input.companyId)) ?? null)
      : null;
    if (input.companyId && !companyById) fields.companyId = COMPANY_NOT_FOUND;
    if (input.eventIds !== undefined) {
      if (await areOwnEvents(tx, orgId, input.eventIds)) {
        after.eventIds = input.eventIds;
      } else {
        fields.eventIds = EVENTS_UNKNOWN;
      }
    }
    throwIfFields(fields);

    const company = await resolveCompanyRef(
      tx,
      input,
      {organizationId: orgId, actorId: actor.id, now, isDemo: row.is_demo},
      {id: row.company_id, name: row.company_name},
      companyById,
    );
    if (company !== undefined) after.companyId = company?.id ?? null;

    const changed = changedFields(before, after, FIELD_NAMES);
    if (changed.length === 0) return toContact(row, actor);

    await tx.query(
      `UPDATE contacts
          SET name = $3, role = $4, company_id = $5, phone = $6, email = $7,
              description = $8, notes = $9, source = $10, verification = $11,
              version = version + 1, updated_by = $12, updated_at = $13::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.name,
        after.role,
        after.companyId,
        after.phone,
        after.email,
        after.description,
        after.notes,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    if (changed.includes('eventIds')) await writeEvents(tx, id, after.eventIds);
    if (changed.includes('company')) {
      await releaseMainContact(tx, {
        organizationId: orgId,
        contactId: id,
        actorId: actor.id,
        now,
      });
    }
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'contact',
      entityId: id,
      entityLabel: after.name,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toContact((await loadContact(tx, id)) as ContactRow, actor);
  });
}

/**
 * Deletes a contact at the given version. Tasks lose it as their contact, a
 * company that had it as main contact loses it and notes lose the link; their
 * versions increase and the changes are logged.
 */
export async function deleteContact(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw contactNotFound();
  await db.transaction(async tx => {
    const orgId = (await loadOwnContact(tx, actor, id)).organization_id;
    // It updates several tasks: graph lock first, then the catalogue lock.
    await lockGraph(tx, orgId);
    await lockCatalogue(tx, orgId);
    const row = await loadContact(tx, id, true);
    if (!row) throw contactNotFound();
    if (row.version !== version) throw staleContact(row, actor);

    await releaseMainContact(tx, {
      organizationId: orgId,
      contactId: id,
      actorId: actor.id,
      now,
    });
    await unlinkNotes(tx, {link: 'contact', ids: [id], actorId: actor.id, now});
    const tasks = await unlinkTasks(tx, 'contact_id', id, actor.id, now);
    for (const t of tasks) {
      await appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType: 'task',
        entityId: t.id,
        entityLabel: t.name,
        action: 'update',
        changedFields: ['contact'],
        at: now,
        isDemo: t.is_demo,
      });
    }
    // contact_events rows go with the contact (ON DELETE CASCADE).
    await tx.query('DELETE FROM contacts WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'contact',
      entityId: id,
      entityLabel: row.name,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
