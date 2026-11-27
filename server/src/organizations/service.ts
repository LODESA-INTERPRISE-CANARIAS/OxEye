/**
 * Organizations and membership. A user sees and changes only the data of the
 * organizations they belong to; any other organization is reported as not
 * found, so its existence is not revealed.
 *
 * Revisión 1 · E2: members edit the organization's acronym (it names saved
 * PDFs, «SCLL_Cierre-de-jornada_…») and its time zone (Canarias or
 * Península), with optimistic concurrency. The name is not editable.
 *
 * Revisión 1 · E4: a membership carries roles; what they allow is computed
 * by `effectivePermissions` (shared/logistics/permissions.ts) with the
 * account's state (provisional password, support session). `requireAccess`
 * is the one place a route asks for a permission.
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {
  effectivePermissions,
  heldByProvisional,
  NO_ACCESS,
  normalizeRoles,
  PROVISIONAL_HOLD,
} from '../../../shared/logistics/permissions.ts';
import type {
  Organization,
  OrganizationTimezone,
  OrgRole,
  Permission,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** The organization record itself, without the viewer's access. */
export type OrgRecord = Omit<Organization, 'roles' | 'permissions'>;

/** An organization of the user, with the user's roles there. */
export interface Membership extends OrgRecord {
  roles: OrgRole[];
}

/** Organization columns of alias `o`, in contract shape. */
export const ORGANIZATION_COLUMNS =
  'o.id, o.name, o.timezone, o.acronym, o.version';

interface OrganizationRow {
  id: string;
  name: string;
  timezone: string;
  acronym: string | null;
  version: number;
}

interface MembershipRow extends OrganizationRow {
  roles: unknown;
}

export function toOrgRecord(row: OrganizationRow): OrgRecord {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    acronym: row.acronym,
    version: Number(row.version),
  };
}

function toMembership(row: MembershipRow): Membership {
  return {
    ...toOrgRecord(row),
    roles: normalizeRoles(parseRoles(row.roles)),
  };
}

/** A text[] as either driver returns it (array, or `{a,b}` text). */
export function parseRoles(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const inner = value.replace(/^\{|\}$/g, '');
    return inner === '' ? [] : inner.split(',');
  }
  return [];
}

/** The account's state that withholds permissions. */
export function permissionState(user: SessionUser): {
  provisional: boolean;
  support: boolean;
} {
  return {
    provisional: user.passwordProvisional,
    support: user.support?.kind === 'support',
  };
}

/** The viewer's effective permissions in a membership. */
export function permissionsIn(
  user: SessionUser,
  roles: readonly OrgRole[],
): Permission[] {
  // The guest account only reads, whatever a membership row says.
  if (user.role === 'guest') return [];
  return effectivePermissions(roles, permissionState(user));
}

/** The contract shape: the organization with the viewer's roles and permissions. */
export function toOrganization(
  membership: Membership,
  user: SessionUser,
): Organization {
  const roles = user.role === 'guest' ? [] : membership.roles;
  return {
    id: membership.id,
    name: membership.name,
    timezone: membership.timezone,
    acronym: membership.acronym,
    version: membership.version,
    roles,
    permissions: permissionsIn(user, roles),
  };
}

const MEMBERSHIP_SELECT = `SELECT ${ORGANIZATION_COLUMNS}, m.roles
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id`;

export async function listMemberships(
  db: Queryable,
  userId: string,
): Promise<Membership[]> {
  const rows = await db.query<MembershipRow>(
    `${MEMBERSHIP_SELECT}
      WHERE m.user_id = $1
      ORDER BY lower(o.name), o.id`,
    [userId],
  );
  return rows.map(toMembership);
}

export async function listUserOrganizations(
  db: Queryable,
  user: SessionUser,
): Promise<Organization[]> {
  return (await listMemberships(db, user.id)).map(m => toOrganization(m, user));
}

/** The organization if the user is a member of it; NOT_FOUND otherwise. */
export async function requireMembership(
  db: Queryable,
  userId: string,
  organizationId: string,
  lock = false,
): Promise<Membership> {
  if (!isUuid(organizationId)) throw orgNotFound();
  const rows = await db.query<MembershipRow>(
    `${MEMBERSHIP_SELECT}
      WHERE o.id = $1 AND m.user_id = $2${lock ? ' FOR UPDATE OF o' : ''}`,
    [organizationId, userId],
  );
  const org = rows[0];
  if (!org) throw orgNotFound();
  return toMembership(org);
}

/** 403 with the reason the UI shows («Sin acceso», or «cambia tu contraseña»). */
export function forbiddenFor(
  permission: Permission,
  roles: readonly OrgRole[],
  user: SessionUser,
): AppError {
  const held =
    user.role !== 'guest' &&
    user.passwordProvisional &&
    heldByProvisional(roles, permission);
  return new AppError(
    'FORBIDDEN',
    held ? PROVISIONAL_HOLD : NO_ACCESS[permission],
  );
}

/**
 * The membership if the user may use `permission` in that organization:
 * NOT_FOUND when not a member, FORBIDDEN when the permission is missing.
 */
export async function requireAccess(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
  permission: Permission,
  lock = false,
): Promise<Membership> {
  const membership = await requireMembership(db, user.id, organizationId, lock);
  checkAccess(membership, user, permission);
  return membership;
}

/** Throws FORBIDDEN unless the user has `permission` in this membership. */
export function checkAccess(
  membership: Membership,
  user: SessionUser,
  permission: Permission,
): void {
  if (!permissionsIn(user, membership.roles).includes(permission)) {
    throw forbiddenFor(permission, membership.roles, user);
  }
}

/** True when the user has `permission` in this membership. */
export function hasAccess(
  membership: Membership,
  user: SessionUser,
  permission: Permission,
): boolean {
  return permissionsIn(user, membership.roles).includes(permission);
}

function orgNotFound() {
  return notFound('No encontramos esa organización o no tienes acceso a ella.');
}

/**
 * Sets or clears the acronym and/or changes the time zone at the given version (409 VERSION_CONFLICT
 * with `current` otherwise). Logged as entityType `organization`.
 */
export async function updateOrganization(
  db: Db,
  actor: SessionUser,
  organizationId: string,
  input: {
    acronym?: string | null;
    timezone?: OrganizationTimezone;
    version: number;
  },
  now: Date,
): Promise<Organization> {
  return db.transaction(async tx => {
    const org = await requireAccess(
      tx,
      actor,
      organizationId,
      'plan.edit',
      true,
    );
    if (org.version !== input.version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado los datos de la organización mientras los editabas. Revisa la versión actual antes de guardar.',
        {current: toOrganization(org, actor)},
      );
    }
    const changedFields: Array<'acronym' | 'timezone'> = [];
    if (input.acronym !== undefined && input.acronym !== org.acronym) {
      changedFields.push('acronym');
    }
    if (input.timezone !== undefined && input.timezone !== org.timezone) {
      changedFields.push('timezone');
    }
    if (changedFields.length === 0) return toOrganization(org, actor);
    // Existing events and tasks keep the zone they were created with; only
    // records created from now on read the new one.
    const acronym = changedFields.includes('acronym')
      ? (input.acronym ?? null)
      : org.acronym;
    const timezone = changedFields.includes('timezone')
      ? (input.timezone as string)
      : org.timezone;
    const rows = await tx.query<OrganizationRow>(
      `UPDATE organizations o
          SET acronym = $2, timezone = $3, version = version + 1,
              updated_at = $4::timestamptz
        WHERE o.id = $1
        RETURNING ${ORGANIZATION_COLUMNS}`,
      [org.id, acronym, timezone, now.toISOString()],
    );
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'organization',
      entityId: org.id,
      entityLabel: org.name,
      action: 'update',
      changedFields,
      at: now,
    });
    return toOrganization(
      {...toOrgRecord(rows[0] as OrganizationRow), roles: org.roles},
      actor,
    );
  });
}
