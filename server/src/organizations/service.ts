/**
 * Organizations and membership. A user sees and changes only the data of the
 * organizations they belong to; any other organization is reported as not
 * found, so its existence is not revealed.
 */
import type {Queryable} from '../db/db.ts';
import {notFound} from '../errors.ts';
import type {Organization} from '../../../shared/logistics/contracts.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export async function listUserOrganizations(
  db: Queryable,
  userId: string,
): Promise<Organization[]> {
  return db.query<Organization>(
    `SELECT o.id, o.name, o.timezone
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = $1
      ORDER BY lower(o.name), o.id`,
    [userId],
  );
}

/** The organization if the user is a member of it; NOT_FOUND otherwise. */
export async function requireMembership(
  db: Queryable,
  userId: string,
  organizationId: string,
): Promise<Organization> {
  if (!isUuid(organizationId)) throw orgNotFound();
  const rows = await db.query<Organization>(
    `SELECT o.id, o.name, o.timezone
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
      WHERE o.id = $1 AND m.user_id = $2`,
    [organizationId, userId],
  );
  const org = rows[0];
  if (!org) throw orgNotFound();
  return org;
}

function orgNotFound() {
  return notFound('No encontramos esa organización o no tienes acceso a ella.');
}
