/**
 * Administration of accounts (Revisión 1 · E4): the people of the
 * organizations one manages, their roles, provisional passwords, reset
 * links, support sessions, «Ver como Invitado» and the security log.
 *
 * Rules:
 * - `users.manage` in an organization lets one see and help its people
 *   (provisional password, reset link, security log); changing roles needs
 *   the `admin` role there too; at least one administrator always remains;
 * - nobody ever sees a current password: a provisional one is generated,
 *   shown once and every session of that account ends;
 * - a support session needs `support.start`, the administrator's own
 *   password again and a reason; it lasts 5–30 minutes, never reaches the
 *   account's password, e-mail, sessions, profile or administration, and
 *   the account's owner sees it in their security history and sessions;
 * - «Ver como Invitado» is a short session of the guest account itself, so
 *   it gets exactly the guest's withholding and is read-only.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {listSecurityOf, logSecurity} from '../account/security.ts';
import {generatePassword, hashPassword} from '../auth/password.ts';
import type {LoginLimits} from '../auth/service.ts';
import {
  checkCredentials,
  findRecoveryTarget,
  issueResetLink,
  setPassword,
} from '../auth/service.ts';
import {
  createSession,
  deleteUserSessions,
  loadSessionUser,
} from '../auth/sessions.ts';
import type {SessionContext} from '../auth/sessions.ts';
import type {MailMessage} from '../mail/transport.ts';
import {
  forbiddenFor,
  isUuid,
  listMemberships,
  parseRoles,
  permissionsIn,
  toOrganization,
} from '../organizations/service.ts';
import type {Membership} from '../organizations/service.ts';
import {VIEW_AS_GUEST_MINUTES} from '../../../shared/logistics/account.ts';
import {
  isDeveloper,
  isSharedAccount,
  normalizeRoles,
  rolePermissions,
} from '../../../shared/logistics/permissions.ts';
import {assertDisplayNameFree} from '../account/service.ts';
import {checkImage} from '../media/service.ts';
import type {
  AdminProfileInput,
  AdminUser,
  OrgRole,
  Permission,
  SecurityEvent,
  SessionKind,
  SessionUser,
  SupportSession,
  SupportSessionResponse,
} from '../../../shared/logistics/contracts.ts';

const USER_NOT_FOUND =
  'No encontramos esa cuenta entre las personas que gestionas.';
const NOT_YOURSELF =
  'Para tu propia cuenta usa «Cambiar contraseña» en tu perfil.';
const GUEST_NO_ROLES =
  'La cuenta Invitado no tiene roles: siempre es de solo lectura.';
const GUEST_NO_RESET =
  'La cuenta Invitado no recupera su contraseña por enlace: ponle una provisional.';
const GUEST_NO_SUPPORT = 'Para ver lo que ve Invitado usa «Ver como Invitado».';
const LAST_ADMIN =
  'Tiene que quedar al menos una persona con el rol de administración en la organización.';
const ONLY_ADMINS_ROLES = 'Solo administración cambia los roles.';
const DEVELOPER_FIXED =
  'Es una cuenta de desarrollo: sus roles son fijos (administración y desarrollo) y no se cambian desde la aplicación.';
const DEVELOPER_NOT_ASSIGNABLE =
  'El rol de desarrollo no se da ni se quita desde la aplicación: lo asigna el equipo técnico.';
const DEVELOPER_ACCOUNT =
  'Es una cuenta de desarrollo: su contraseña y su acceso solo los gestiona desarrollo.';
const WRONG_PASSWORD = 'Tu contraseña no es correcta.';
const NO_GUEST_ACCOUNT =
  'Esta organización no tiene cuenta Invitado que mostrar.';
const SUPPORT_NOT_FOUND =
  'No encontramos esa sesión de soporte: puede que ya haya terminado.';

/** Memberships of the actor where it has `permission` (403 when none). */
async function managedMemberships(
  db: Queryable,
  actor: SessionUser,
  permission: Permission,
): Promise<Membership[]> {
  const all = await listMemberships(db, actor.id);
  const allowed = all.filter(m =>
    permissionsIn(actor, m.roles).includes(permission),
  );
  if (allowed.length === 0) {
    throw forbiddenFor(
      permission,
      all.flatMap(m => m.roles),
      actor,
    );
  }
  return allowed;
}

interface AdminUserRow {
  id: string;
  username: string;
  display_name: string;
  role: SessionUser['role'];
  avatar_id: string | null;
  memberships: unknown;
  password_provisional: boolean;
  has_email: boolean;
  last_login_at: unknown;
  open_sessions: number | string;
  /** Roles in every organization of the account (not only managed ones). */
  all_roles: unknown;
  version: number | string;
}

function adminUserQuery(where: string): string {
  return `SELECT u.id, u.username, u.display_name, u.role,
                 (SELECT pm.id FROM media pm
                   WHERE pm.owner_type = 'user' AND pm.owner_id = u.id LIMIT 1) AS avatar_id,
                 (SELECT jsonb_agg(jsonb_build_object(
                           'organizationId', om.organization_id, 'roles', om.roles)
                           ORDER BY om.organization_id)
                    FROM organization_members om
                   WHERE om.user_id = u.id
                     AND om.organization_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)))
                   AS memberships,
                 u.password_provisional, u.recovery_email IS NOT NULL AS has_email,
                 u.last_login_at, u.version,
                 COALESCE((SELECT jsonb_agg(to_jsonb(om.roles))
                             FROM organization_members om WHERE om.user_id = u.id),
                          '[]'::jsonb) AS all_roles,
                 (SELECT count(*) FROM sessions s
                   WHERE s.user_id = u.id AND s.expires_at > $2::timestamptz) AS open_sessions
            FROM users u
           WHERE u.is_active
             AND EXISTS (SELECT 1 FROM organization_members om
                          WHERE om.user_id = u.id
                            AND om.organization_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)))
             ${where}`;
}

function toAdminUser(row: AdminUserRow): AdminUser {
  const list =
    typeof row.memberships === 'string'
      ? (JSON.parse(row.memberships) as unknown)
      : row.memberships;
  const memberships = (Array.isArray(list) ? list : []).map(item => {
    const o = item as {organizationId: unknown; roles: unknown};
    return {
      organizationId: String(o.organizationId),
      roles:
        row.role === 'guest'
          ? []
          : normalizeRoles(Array.isArray(o.roles) ? o.roles : []),
    };
  });
  const allRoles =
    typeof row.all_roles === 'string'
      ? (JSON.parse(row.all_roles) as unknown)
      : row.all_roles;
  const shared = isSharedAccount(
    row.role,
    (Array.isArray(allRoles) ? allRoles : []).map(r =>
      normalizeRoles(parseRoles(r)),
    ),
  );
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    avatarId: row.avatar_id,
    memberships,
    // A shared account cannot change its password: never provisional.
    passwordProvisional: !shared && Boolean(row.password_provisional),
    hasRecoveryEmail: Boolean(row.has_email),
    lastLoginAt: row.last_login_at ? toIso(row.last_login_at) : null,
    openSessions: Number(row.open_sessions),
    sharedAccount: shared,
    version: Number(row.version),
  };
}

export async function listAdminUsers(
  db: Queryable,
  actor: SessionUser,
  now: Date,
): Promise<AdminUser[]> {
  const orgs = await managedMemberships(db, actor, 'users.manage');
  const rows = await db.query<AdminUserRow>(
    `${adminUserQuery('')} ORDER BY u.sort_order, lower(u.display_name), u.id`,
    [JSON.stringify(orgs.map(o => o.id)), now.toISOString()],
  );
  return rows.map(toAdminUser);
}

/** A managed account by id (404 for anyone outside the managed organizations). */
async function loadManagedUser(
  db: Queryable,
  orgIds: readonly string[],
  userId: string,
  now: Date,
): Promise<AdminUser> {
  if (!isUuid(userId)) throw notFound(USER_NOT_FOUND);
  const rows = await db.query<AdminUserRow>(
    `${adminUserQuery('AND u.id = $3')}`,
    [JSON.stringify(orgIds), now.toISOString(), userId],
  );
  const row = rows[0];
  if (!row) throw notFound(USER_NOT_FOUND);
  return toAdminUser(row);
}

export async function setRoles(
  db: Db,
  actor: SessionUser,
  userId: string,
  input: {organizationId: string; roles: OrgRole[]},
  now: Date,
): Promise<AdminUser> {
  return db.transaction(async tx => {
    const orgs = await managedMemberships(tx, actor, 'users.manage');
    const org = orgs.find(o => o.id === input.organizationId);
    if (!org) {
      throw notFound('No encontramos esa organización o no la gestionas.');
    }
    if (!org.roles.includes('admin')) {
      throw new AppError('FORBIDDEN', ONLY_ADMINS_ROLES);
    }
    const target = await loadManagedUser(tx, [org.id], userId, now);
    if (target.role === 'guest') {
      throw validationError({roles: GUEST_NO_ROLES}, GUEST_NO_ROLES);
    }
    // Developer accounts keep their roles; development is never handed out
    // here (it would create accounts nobody could downgrade).
    const held =
      target.memberships.find(m => m.organizationId === org.id)?.roles ?? [];
    if (isDeveloper(held)) {
      throw new AppError('FORBIDDEN', DEVELOPER_FIXED);
    }
    const roles = normalizeRoles(input.roles);
    if (isDeveloper(roles)) {
      throw validationError(
        {roles: DEVELOPER_NOT_ASSIGNABLE},
        DEVELOPER_NOT_ASSIGNABLE,
      );
    }
    // Lock the organization's memberships: two administrators removing each
    // other at once must not leave nobody.
    const members = await tx.query<{user_id: string; roles: unknown}>(
      `SELECT m.user_id, m.roles FROM organization_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND u.is_active AND u.role = 'member'
        ORDER BY m.user_id FOR UPDATE OF m`,
      [org.id],
    );
    const othersAdmin = members.some(
      m =>
        m.user_id !== target.id &&
        normalizeRoles(parseRoles(m.roles)).includes('admin'),
    );
    if (!roles.includes('admin') && !othersAdmin) {
      throw validationError({roles: LAST_ADMIN}, LAST_ADMIN);
    }
    await tx.query(
      `UPDATE organization_members
          SET roles = ARRAY(SELECT jsonb_array_elements_text($3::jsonb)),
              roles_set_at = $4::timestamptz, roles_set_by = $5
        WHERE organization_id = $1 AND user_id = $2`,
      [org.id, target.id, JSON.stringify(roles), now.toISOString(), actor.id],
    );
    await logSecurity(tx, {
      userId: target.id,
      actorId: actor.id,
      kind: 'roles_changed',
      at: now,
    });
    return loadManagedUser(
      tx,
      orgs.map(o => o.id),
      target.id,
      now,
    );
  });
}

const OUTRANKED =
  'Esta cuenta tiene permisos que tú no tienes: solo administración puede darle una contraseña provisional o un enlace.';
const OUTRANKED_SUPPORT =
  'Esta cuenta tiene permisos que tú no tienes en otra organización: no puedes abrir una sesión de soporte en ella.';

/**
 * Taking over an account through its password must never give the actor
 * more than it has. In every organization where the target is a member (the
 * password is the same everywhere), what the target's roles give must be
 * within what the actor's roles give there (so a developer still helps the
 * shared «Equipo» account); a developer outranks every account, an
 * administrator every account but a developer one (nobody takes over the
 * technical owner of the pilot). 403 otherwise.
 */
async function requireOutranks(
  q: Queryable,
  actor: SessionUser,
  targetId: string,
  outranked: string = OUTRANKED,
): Promise<void> {
  const rows = await q.query<{target_roles: unknown; actor_roles: unknown}>(
    `SELECT t.roles AS target_roles, a.roles AS actor_roles
       FROM organization_members t
       LEFT JOIN organization_members a
         ON a.organization_id = t.organization_id AND a.user_id = $2
      WHERE t.user_id = $1`,
    [targetId, actor.id],
  );
  for (const row of rows) {
    const mine = normalizeRoles(parseRoles(row.actor_roles));
    const target = normalizeRoles(parseRoles(row.target_roles));
    if (isDeveloper(mine)) continue;
    if (isDeveloper(target)) {
      throw new AppError('FORBIDDEN', DEVELOPER_ACCOUNT);
    }
    if (mine.includes('admin')) continue;
    const given = new Set(rolePermissions(mine));
    const theirs = rolePermissions(target);
    if (theirs.some(p => !given.has(p))) {
      throw new AppError('FORBIDDEN', outranked);
    }
  }
}

export async function setProvisionalPassword(
  db: Db,
  actor: SessionUser,
  userId: string,
  now: Date,
): Promise<{password: string}> {
  const orgs = await managedMemberships(db, actor, 'users.manage');
  const target = await loadManagedUser(
    db,
    orgs.map(o => o.id),
    userId,
    now,
  );
  if (target.id === actor.id) {
    throw validationError({userId: NOT_YOURSELF}, NOT_YOURSELF);
  }
  if (target.role !== 'guest') await requireOutranks(db, actor, target.id);
  const password = generatePassword();
  const hash = await hashPassword(password);
  await db.transaction(async tx => {
    // A shared account (Equipo, Invitado) cannot change its password: this
    // is its password, never provisional.
    await setPassword(tx, target.id, hash, !target.sharedAccount, now);
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [target.id],
    );
    await deleteUserSessions(tx, target.id);
    await logSecurity(tx, {
      userId: target.id,
      actorId: actor.id,
      kind: 'password_provisional_set',
      at: now,
    });
  });
  return {password};
}

const PERSONAL_PROFILE =
  'Esta cuenta es personal: su nombre y su foto los cambia la propia persona en su perfil.';
const GUEST_NO_PHOTO = 'La cuenta Invitado no tiene foto de perfil.';
const ADMIN_PROFILE_STALE =
  'Esta cuenta ha cambiado mientras la editabas. Revisa la versión actual antes de guardar.';

/** `checkImage` of POST /media, its fields under `photo.` as in the body. */
function checkPhoto(photo: NonNullable<AdminProfileInput['photo']>) {
  try {
    return checkImage(photo);
  } catch (e) {
    if (e instanceof AppError && e.fields) {
      throw new AppError(e.code, e.message, {
        fields: Object.fromEntries(
          Object.entries(e.fields).map(([k, v]) => [`photo.${k}`, v]),
        ),
      });
    }
    throw e;
  }
}

/**
 * Name and photo of a shared account (Equipo, Invitado), which cannot edit
 * them itself. `users.manage` in an organization of the account; a personal
 * account → 403. The name keeps the profile rules (unique, case-insensitive)
 * and bumps the account's version; the photo replaces the current one (or
 * `null` removes it) without changing the version, as a photo uploaded by
 * its owner. Logged as `profile_changed` with the administrator as actor.
 */
export async function updateSharedProfile(
  db: Db,
  actor: SessionUser,
  userId: string,
  input: AdminProfileInput,
  now: Date,
): Promise<AdminUser> {
  return db.transaction(async tx => {
    const orgs = await managedMemberships(tx, actor, 'users.manage');
    const orgIds = orgs.map(o => o.id);
    const target = await loadManagedUser(tx, orgIds, userId, now);
    if (!target.sharedAccount) {
      throw new AppError('FORBIDDEN', PERSONAL_PROFILE);
    }
    const [row] = await tx.query<{display_name: string; version: number}>(
      'SELECT display_name, version FROM users WHERE id = $1 FOR UPDATE',
      [target.id],
    );
    if (!row) throw notFound(USER_NOT_FOUND);
    if (Number(row.version) !== input.version) {
      throw new AppError('VERSION_CONFLICT', ADMIN_PROFILE_STALE, {
        current: await loadManagedUser(tx, orgIds, target.id, now),
      });
    }
    if (input.photo && target.role === 'guest') {
      throw validationError({photo: GUEST_NO_PHOTO}, GUEST_NO_PHOTO);
    }
    let changed = false;
    if (
      input.displayName !== undefined &&
      input.displayName !== row.display_name
    ) {
      if (input.displayName.toLowerCase() !== row.display_name.toLowerCase()) {
        await assertDisplayNameFree(tx, input.displayName, target.id);
      }
      await tx.query(
        `UPDATE users SET display_name = $2, version = version + 1,
                updated_at = $3::timestamptz
          WHERE id = $1`,
        [target.id, input.displayName, now.toISOString()],
      );
      changed = true;
    }
    if (input.photo !== undefined) {
      const bytes = input.photo ? checkPhoto(input.photo) : null;
      const removed = await tx.query<{id: string}>(
        "DELETE FROM media WHERE owner_type = 'user' AND owner_id = $1 RETURNING id",
        [target.id],
      );
      if (bytes && input.photo) {
        // Stored in an organization of the account that the actor manages.
        const orgId = target.memberships[0]?.organizationId;
        if (!orgId) throw notFound(USER_NOT_FOUND);
        await tx.query(
          `INSERT INTO media
             (id, organization_id, owner_type, owner_id, content_type, bytes,
              width, height, is_main, data, created_by, created_at, is_demo)
           VALUES (gen_random_uuid(), $1, 'user', $2, $3, $4, $5, $6, true,
                   decode($7, 'base64'), $8, $9::timestamptz, false)`,
          [
            orgId,
            target.id,
            input.photo.contentType,
            bytes.length,
            input.photo.width,
            input.photo.height,
            Buffer.from(bytes).toString('base64'),
            actor.id,
            now.toISOString(),
          ],
        );
      }
      if (bytes || removed.length > 0) changed = true;
    }
    if (changed) {
      await logSecurity(tx, {
        userId: target.id,
        actorId: actor.id,
        kind: 'profile_changed',
        at: now,
      });
    }
    return loadManagedUser(tx, orgIds, target.id, now);
  });
}

/**
 * A reset link for a managed account. Returned to the administrator when it
 * cannot be e-mailed (no mail transport, or no address); otherwise the
 * message to send.
 */
export async function createResetLink(
  db: Db,
  actor: SessionUser,
  userId: string,
  options: {
    now: Date;
    base: string | null;
    fallback: string | null;
    mailConfigured: boolean;
  },
): Promise<{url: string; expiresAt: string; message: MailMessage | null}> {
  const orgs = await managedMemberships(db, actor, 'users.manage');
  const target = await loadManagedUser(
    db,
    orgs.map(o => o.id),
    userId,
    options.now,
  );
  if (target.role === 'guest') {
    throw validationError({userId: GUEST_NO_RESET}, GUEST_NO_RESET);
  }
  await requireOutranks(db, actor, target.id);
  if (!options.base) {
    throw new AppError(
      'VALIDATION',
      'No se puede preparar el enlace: falta la dirección de la web en el servidor (PUBLIC_APP_URL).',
    );
  }
  const base = options.base;
  return db.transaction(async tx => {
    const recovery = await findRecoveryTarget(tx, {userId: target.id});
    if (!recovery) throw notFound(USER_NOT_FOUND);
    const issued = await issueResetLink(tx, recovery, {
      base,
      fallback: options.fallback,
      createdBy: actor.id,
      now: options.now,
    });
    await logSecurity(tx, {
      userId: target.id,
      actorId: actor.id,
      kind: 'reset_link_created',
      at: options.now,
    });
    return {
      url: issued.url,
      expiresAt: issued.expiresAt,
      message: options.mailConfigured ? issued.message : null,
    };
  });
}

async function sessionResponse(
  db: Queryable,
  userId: string,
  session: {id: string; token: string; expiresAt: string},
): Promise<SupportSessionResponse> {
  const loaded = await loadSessionUser(db, userId);
  if (!loaded) throw notFound(USER_NOT_FOUND);
  const rows = await db.query<{
    kind: SessionKind;
    reason: string | null;
    opened_by: string;
    opened_by_name: string;
  }>(
    `SELECT s.kind, s.reason, s.opened_by, ob.display_name AS opened_by_name
       FROM sessions s JOIN users ob ON ob.id = s.opened_by WHERE s.id = $1`,
    [session.id],
  );
  const row = rows[0];
  const user: SessionUser = {
    ...loaded.user,
    support:
      row && row.kind !== 'normal'
        ? {
            kind: row.kind,
            by: {id: row.opened_by, displayName: row.opened_by_name},
            reason: row.reason,
            endsAt: session.expiresAt,
          }
        : null,
  };
  const memberships = await listMemberships(db, userId);
  return {
    sessionId: session.id,
    token: session.token,
    expiresAt: session.expiresAt,
    user,
    organizations: memberships.map(m => toOrganization(m, user)),
  };
}

export async function startSupport(
  db: Db,
  actor: SessionUser,
  input: {userId: string; reason: string; password: string; minutes: number},
  options: {
    now: Date;
    limits: LoginLimits;
    ip: string;
    device: string | null;
    sessionDays: number;
  },
): Promise<SupportSessionResponse> {
  const orgs = await managedMemberships(db, actor, 'support.start');
  const target = await loadManagedUser(
    db,
    orgs.map(o => o.id),
    input.userId,
    options.now,
  );
  if (target.id === actor.id) {
    throw validationError({userId: NOT_YOURSELF}, NOT_YOURSELF);
  }
  if (target.role === 'guest') {
    throw validationError({userId: GUEST_NO_SUPPORT}, GUEST_NO_SUPPORT);
  }
  // The session acts in every organization of the account.
  await requireOutranks(db, actor, target.id, OUTRANKED_SUPPORT);
  const {user: me, ok} = await checkCredentials(
    db,
    {name: actor.username, password: input.password, ip: options.ip},
    options.limits,
  );
  if (!ok || !me || me.id !== actor.id) {
    throw validationError({password: WRONG_PASSWORD}, WRONG_PASSWORD);
  }
  const expiresAt = new Date(options.now.getTime() + input.minutes * 60_000);
  return db.transaction(async tx => {
    const session = await createSession(
      tx,
      target.id,
      options.now,
      options.sessionDays,
      {
        kind: 'support',
        openedBy: actor.id,
        reason: input.reason,
        device: options.device,
        expiresAt,
      },
    );
    await logSecurity(tx, {
      userId: target.id,
      actorId: actor.id,
      kind: 'support_started',
      detail: input.reason,
      device: options.device,
      at: options.now,
    });
    return sessionResponse(tx, target.id, session);
  });
}

export async function viewAsGuest(
  db: Db,
  actor: SessionUser,
  input: {organizationId?: string | undefined},
  options: {now: Date; device: string | null; sessionDays: number},
): Promise<SupportSessionResponse> {
  const orgs = await managedMemberships(db, actor, 'view_as_guest');
  const candidates = input.organizationId
    ? orgs.filter(o => o.id === input.organizationId)
    : orgs;
  if (candidates.length === 0) {
    throw notFound(
      'No encontramos esa organización o no puedes verla como Invitado.',
    );
  }
  const guests = await db.query<{id: string}>(
    `SELECT u.id FROM users u
       JOIN organization_members m ON m.user_id = u.id
      WHERE u.role = 'guest' AND u.is_active
        AND m.organization_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))
      ORDER BY u.sort_order, u.id LIMIT 1`,
    [JSON.stringify(candidates.map(o => o.id))],
  );
  const guest = guests[0];
  if (!guest) throw notFound(NO_GUEST_ACCOUNT);
  const expiresAt = new Date(
    options.now.getTime() + VIEW_AS_GUEST_MINUTES * 60_000,
  );
  return db.transaction(async tx => {
    const session = await createSession(
      tx,
      guest.id,
      options.now,
      options.sessionDays,
      {
        kind: 'view_as_guest',
        openedBy: actor.id,
        device: options.device,
        expiresAt,
      },
    );
    // Logged on the administrator: the guest account is shared.
    await logSecurity(tx, {
      userId: actor.id,
      kind: 'view_as_guest',
      device: options.device,
      at: options.now,
    });
    return sessionResponse(tx, guest.id, session);
  });
}

interface SupportRow {
  id: string;
  kind: 'support' | 'view_as_guest';
  user_id: string;
  user_name: string;
  opened_by: string;
  opened_by_name: string;
  reason: string | null;
  created_at: unknown;
  expires_at: unknown;
}

const SELECT_SUPPORT = `
  SELECT s.id, s.kind, s.user_id, u.display_name AS user_name, s.opened_by,
         ob.display_name AS opened_by_name, s.reason, s.created_at, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN users ob ON ob.id = s.opened_by
   WHERE s.kind <> 'normal' AND s.expires_at > $1::timestamptz`;

function toSupport(r: SupportRow): SupportSession {
  return {
    id: r.id,
    kind: r.kind,
    user: {id: r.user_id, displayName: r.user_name},
    by: {id: r.opened_by, displayName: r.opened_by_name},
    reason: r.reason,
    startedAt: toIso(r.created_at),
    endsAt: toIso(r.expires_at),
  };
}

/** Open support sessions: the ones the actor opened, and any on managed accounts. */
export async function listSupportSessions(
  db: Queryable,
  actor: SessionUser,
  now: Date,
): Promise<SupportSession[]> {
  const orgs = await managedMemberships(db, actor, 'users.manage').catch(
    () => [] as Membership[],
  );
  const rows = await db.query<SupportRow>(
    `${SELECT_SUPPORT}
       AND (s.opened_by = $2
            OR s.user_id IN (SELECT user_id FROM organization_members
                              WHERE organization_id IN (SELECT value::uuid FROM jsonb_array_elements_text($3::jsonb))))
     ORDER BY s.created_at DESC, s.id DESC`,
    [now.toISOString(), actor.id, JSON.stringify(orgs.map(o => o.id))],
  );
  return rows.map(toSupport);
}

/**
 * Ends a support or «Ver como Invitado» session: allowed to who opened it
 * and, for a support session, to the account's owner.
 */
export async function endSupportSession(
  db: Db,
  ctx: SessionContext,
  id: string,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw notFound(SUPPORT_NOT_FOUND);
  const actor = ctx.user;
  await db.transaction(async tx => {
    const rows = await tx.query<SupportRow>(
      `DELETE FROM sessions s
        WHERE s.id = $1 AND s.kind <> 'normal'
          AND (s.opened_by = $2 OR (s.kind = 'support' AND s.user_id = $2))
        RETURNING s.id, s.kind, s.user_id, '' AS user_name, s.opened_by,
                  '' AS opened_by_name, s.reason, s.created_at, s.expires_at`,
      [id, actor.id],
    );
    const row = rows[0];
    if (!row) throw notFound(SUPPORT_NOT_FOUND);
    await logSecurity(tx, {
      userId: row.kind === 'support' ? row.user_id : row.opened_by,
      actorId: actor.id,
      kind: 'support_ended',
      at: now,
    });
  });
}

export async function listAdminSecurity(
  db: Queryable,
  actor: SessionUser,
  limit: number,
): Promise<SecurityEvent[]> {
  const orgs = await managedMemberships(db, actor, 'users.manage');
  return listSecurityOf(
    db,
    orgs.map(o => o.id),
    limit,
  );
}
