/**
 * The own account (Revisión 1 · E4): profile, password, recovery e-mail,
 * first-login welcome, open sessions and the own security history; and the
 * people of an organization with their names and photos.
 *
 * None of this is reachable from a support session (auth middleware), and
 * the guest account only reads (it has no profile and cannot change its
 * password).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import type {LoginLimits} from '../auth/service.ts';
import {checkCredentials, setPassword} from '../auth/service.ts';
import {hashPassword} from '../auth/password.ts';
import {
  hashToken,
  loadSessionUser,
  newToken,
  parseMemberships,
} from '../auth/sessions.ts';
import type {SessionContext} from '../auth/sessions.ts';
import {verifyMessage} from '../mail/messages.ts';
import {accountUrl} from '../mail/links.ts';
import type {MailMessage} from '../mail/transport.ts';
import {
  isUuid,
  parseRoles,
  requireMembership,
} from '../organizations/service.ts';
import {logSecurity} from './security.ts';
import {
  EMAIL_LINK_HOURS,
  maskEmail,
  passwordProblem,
} from '../../../shared/logistics/account.ts';
import {
  isSharedAccount,
  normalizeRoles,
} from '../../../shared/logistics/permissions.ts';
import type {
  MemberProfile,
  Profile,
  SessionInfo,
  SessionKind,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

const SHARED_NO_EMAIL =
  'Esta cuenta es compartida: no tiene correo de recuperación. Su contraseña la cambia administración o desarrollo.';
const GUEST_READ_ONLY =
  'La cuenta Invitado no tiene perfil ni puede cambiar su contraseña.';
export const SHARED_NO_PASSWORD =
  'Esta cuenta es compartida: su contraseña la cambia administración o desarrollo, no quien la usa.';
export const SHARED_NO_RENAME =
  'Esta cuenta es compartida: su nombre y su foto los cambia administración.';
const WRONG_CURRENT = 'La contraseña actual no es correcta.';
const SAME_PASSWORD = 'La contraseña nueva debe ser distinta de la actual.';
const NAME_TAKEN =
  'Ya hay otra persona con ese nombre visible. Elige otro (por ejemplo, añade tu apellido).';
const PROFILE_STALE =
  'Tu perfil ha cambiado en otro dispositivo mientras lo editabas. Revisa la versión actual antes de guardar.';
const SESSION_NOT_FOUND =
  'No encontramos esa sesión: puede que ya se haya cerrado.';

interface ProfileRow {
  bio: string | null;
  recovery_email: string | null;
  version: number;
  memberships: unknown;
}

async function pendingEmail(q: Queryable, userId: string, now: Date) {
  const rows = await q.query<{email: string}>(
    `SELECT email FROM account_tokens
      WHERE user_id = $1 AND purpose = 'email_verify' AND used_at IS NULL
        AND expires_at > $2::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [userId, now.toISOString()],
  );
  return rows[0]?.email ?? null;
}

export async function getProfile(
  db: Queryable,
  user: SessionUser,
  now: Date,
): Promise<Profile> {
  const rows = await db.query<ProfileRow>(
    `SELECT u.bio, u.recovery_email, u.version,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'organizationId', om.organization_id, 'roles', om.roles))
                 FROM organization_members om WHERE om.user_id = u.id), '[]'::jsonb)
              AS memberships
       FROM users u WHERE u.id = $1`,
    [user.id],
  );
  const row = rows[0];
  if (!row) throw notFound('No encontramos tu cuenta.');
  const pending = await pendingEmail(db, user.id, now);
  return {
    user,
    bio: row.bio,
    recoveryEmail: row.recovery_email ? maskEmail(row.recovery_email) : null,
    pendingRecoveryEmail: pending ? maskEmail(pending) : null,
    sharedAccount: isSharedAccount(
      user.role,
      parseMemberships(row.memberships).map(m => m.roles),
    ),
    version: Number(row.version),
  };
}

async function freshUser(
  q: Queryable,
  user: SessionUser,
): Promise<SessionUser> {
  const loaded = await loadSessionUser(q, user.id);
  if (!loaded) throw notFound('No encontramos tu cuenta.');
  return {...loaded.user, support: user.support};
}

export async function updateProfile(
  db: Db,
  user: SessionUser,
  input: {
    displayName?: string;
    bio?: string | null;
    accent?: string | null;
    version: number;
  },
  now: Date,
): Promise<Profile> {
  if (user.role === 'guest') throw new AppError('FORBIDDEN', GUEST_READ_ONLY);
  return db.transaction(async tx => {
    const [row] = await tx.query<{
      display_name: string;
      bio: string | null;
      accent: string | null;
      version: number;
    }>(
      'SELECT display_name, bio, accent, version FROM users WHERE id = $1 FOR UPDATE',
      [user.id],
    );
    if (!row) throw notFound('No encontramos tu cuenta.');
    if (
      input.displayName !== undefined &&
      input.displayName !== row.display_name &&
      (await isShared(tx, user))
    ) {
      throw new AppError('FORBIDDEN', SHARED_NO_RENAME, {
        fields: {displayName: SHARED_NO_RENAME},
      });
    }
    if (Number(row.version) !== input.version) {
      throw new AppError('VERSION_CONFLICT', PROFILE_STALE, {
        current: await getProfile(tx, await freshUser(tx, user), now),
      });
    }
    const next = {
      display_name: input.displayName ?? row.display_name,
      bio: input.bio === undefined ? row.bio : input.bio,
      accent: input.accent === undefined ? row.accent : input.accent,
    };
    const changed =
      next.display_name !== row.display_name ||
      next.bio !== row.bio ||
      next.accent !== row.accent;
    if (changed) {
      if (next.display_name.toLowerCase() !== row.display_name.toLowerCase()) {
        await assertDisplayNameFree(tx, next.display_name, user.id);
      }
      await tx.query(
        `UPDATE users
            SET display_name = $2, bio = $3, accent = $4,
                version = version + 1, updated_at = $5::timestamptz
          WHERE id = $1`,
        [user.id, next.display_name, next.bio, next.accent, now.toISOString()],
      );
      await logSecurity(tx, {
        userId: user.id,
        kind: 'profile_changed',
        at: now,
      });
    }
    return getProfile(tx, await freshUser(tx, user), now);
  });
}

export async function changePassword(
  db: Db,
  ctx: SessionContext,
  input: {
    currentPassword: string;
    newPassword: string;
    signOutOthers?: boolean;
  },
  options: {now: Date; limits: LoginLimits; ip: string},
): Promise<void> {
  const user = ctx.user;
  if (user.role === 'guest') throw new AppError('FORBIDDEN', GUEST_READ_ONLY);
  // Before the current password is checked: no attempt is counted.
  if (await isShared(db, user)) {
    throw new AppError('FORBIDDEN', SHARED_NO_PASSWORD);
  }
  const problem = passwordProblem(input.newPassword, user.username);
  if (problem) throw validationError({newPassword: problem}, problem);
  if (input.newPassword === input.currentPassword) {
    throw validationError({newPassword: SAME_PASSWORD}, SAME_PASSWORD);
  }
  const {user: found, ok} = await checkCredentials(
    db,
    {name: user.username, password: input.currentPassword, ip: options.ip},
    options.limits,
  );
  if (!ok || !found || found.id !== user.id) {
    throw validationError({currentPassword: WRONG_CURRENT}, WRONG_CURRENT);
  }
  const hash = await hashPassword(input.newPassword);
  await db.transaction(async tx => {
    await setPassword(tx, user.id, hash, false, options.now);
    // A reset link asked for before is no longer needed.
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [user.id],
    );
    await logSecurity(tx, {
      userId: user.id,
      kind: 'password_changed',
      at: options.now,
    });
    if (input.signOutOthers) {
      const ended = await endOtherSessions(tx, ctx);
      if (ended > 0) {
        await logSecurity(tx, {
          userId: user.id,
          kind: 'sessions_revoked',
          at: options.now,
        });
      }
    }
  });
}

/** Equipo, Invitado: `isSharedAccount` over every organization of the account. */
export async function isShared(
  q: Queryable,
  user: SessionUser,
): Promise<boolean> {
  const rows = await q.query<{roles: unknown}>(
    'SELECT roles FROM organization_members WHERE user_id = $1',
    [user.id],
  );
  const roles = rows.map(r => normalizeRoles(parseRoles(r.roles)));
  return isSharedAccount(user.role, roles);
}

/** 409 DUPLICATE `fields.displayName` when another account has that name. */
export async function assertDisplayNameFree(
  q: Queryable,
  displayName: string,
  userId: string,
): Promise<void> {
  const taken = await q.query<{id: string}>(
    'SELECT id FROM users WHERE lower(display_name) = lower($1) AND id <> $2',
    [displayName, userId],
  );
  if (taken.length > 0) {
    throw new AppError('DUPLICATE', NAME_TAKEN, {
      fields: {displayName: NAME_TAKEN},
    });
  }
}

async function assertMayHaveEmail(q: Queryable, user: SessionUser) {
  if (user.role === 'guest') throw new AppError('FORBIDDEN', GUEST_READ_ONLY);
  if (await isShared(q, user)) {
    throw new AppError('FORBIDDEN', SHARED_NO_EMAIL);
  }
}

/**
 * Starts the verification of a recovery address: a single-use link is
 * mailed to it. The current address (if any) stays until it is verified.
 */
export async function requestEmail(
  db: Db,
  user: SessionUser,
  email: string,
  options: {now: Date; base: string | null},
): Promise<MailMessage | null> {
  return db.transaction(async tx => {
    await assertMayHaveEmail(tx, user);
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'email_verify' AND used_at IS NULL`,
      [user.id],
    );
    if (!options.base) {
      throw new AppError(
        'VALIDATION',
        'No se puede preparar el enlace de verificación: falta la dirección de la web en el servidor (PUBLIC_APP_URL).',
      );
    }
    const token = newToken();
    const expiresAt = new Date(
      options.now.getTime() + EMAIL_LINK_HOURS * 3_600_000,
    );
    await tx.query(
      `INSERT INTO account_tokens (user_id, purpose, token_hash, email, created_at, expires_at)
       VALUES ($1, 'email_verify', $2, $3, $4::timestamptz, $5::timestamptz)`,
      [
        user.id,
        hashToken(token),
        email,
        options.now.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    await logSecurity(tx, {
      userId: user.id,
      kind: 'email_requested',
      at: options.now,
    });
    return verifyMessage(
      email,
      user.displayName,
      accountUrl(options.base, 'verify', token),
    );
  });
}

export async function removeEmail(
  db: Db,
  user: SessionUser,
  now: Date,
): Promise<void> {
  if (user.role === 'guest') throw new AppError('FORBIDDEN', GUEST_READ_ONLY);
  await db.transaction(async tx => {
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'email_verify' AND used_at IS NULL`,
      [user.id],
    );
    const rows = await tx.query<{id: string}>(
      `UPDATE users
          SET recovery_email = NULL, recovery_email_verified_at = NULL,
              version = version + 1, updated_at = $2::timestamptz
        WHERE id = $1 AND recovery_email IS NOT NULL
        RETURNING id`,
      [user.id, now.toISOString()],
    );
    if (rows.length > 0) {
      await logSecurity(tx, {userId: user.id, kind: 'email_removed', at: now});
    }
  });
}

export async function markWelcomed(
  db: Db,
  user: SessionUser,
  now: Date,
): Promise<void> {
  await db.query(
    `UPDATE users SET welcomed_at = $2::timestamptz
      WHERE id = $1 AND welcomed_at IS NULL`,
    [user.id, now.toISOString()],
  );
}

// ---------------------------------------------------------------- sessions

interface SessionRow {
  id: string;
  created_at: unknown;
  last_seen_at: unknown;
  expires_at: unknown;
  device: string | null;
  kind: SessionKind;
  opened_by: string | null;
  opened_by_name: string | null;
}

export async function listSessions(
  db: Queryable,
  ctx: SessionContext,
  now: Date,
): Promise<SessionInfo[]> {
  const rows = await db.query<SessionRow>(
    `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.device, s.kind,
            s.opened_by, ob.display_name AS opened_by_name
       FROM sessions s LEFT JOIN users ob ON ob.id = s.opened_by
      WHERE s.user_id = $1 AND s.expires_at > $2::timestamptz
        AND s.kind <> 'view_as_guest'
      ORDER BY s.created_at DESC, s.id DESC`,
    [ctx.user.id, now.toISOString()],
  );
  return rows.map(r => ({
    id: r.id,
    current: r.id === ctx.sessionId,
    createdAt: toIso(r.created_at),
    lastSeenAt: toIso(r.last_seen_at),
    expiresAt: toIso(r.expires_at),
    device: r.device,
    kind: r.kind,
    openedBy: r.opened_by
      ? {id: r.opened_by, displayName: r.opened_by_name ?? ''}
      : null,
  }));
}

/** Ends one session of the own account (a support session on it too). */
export async function revokeSession(
  db: Db,
  ctx: SessionContext,
  id: string,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw notFound(SESSION_NOT_FOUND);
  await db.transaction(async tx => {
    const rows = await tx.query<{
      id: string;
      kind: SessionKind;
      opened_by: string | null;
    }>(
      `DELETE FROM sessions
        WHERE id = $1 AND user_id = $2 AND kind <> 'view_as_guest'
        RETURNING id, kind, opened_by`,
      [id, ctx.user.id],
    );
    const row = rows[0];
    if (!row) throw notFound(SESSION_NOT_FOUND);
    await logSecurity(tx, {
      userId: ctx.user.id,
      kind: row.kind === 'support' ? 'support_ended' : 'sessions_revoked',
      at: now,
    });
  });
}

async function endOtherSessions(q: Queryable, ctx: SessionContext) {
  const rows = await q.query<{id: string}>(
    `DELETE FROM sessions
      WHERE user_id = $1 AND id <> $2 AND kind <> 'view_as_guest'
      RETURNING id`,
    [ctx.user.id, ctx.sessionId],
  );
  return rows.length;
}

/** Ends every other session of the own account. */
export async function revokeOtherSessions(
  db: Db,
  ctx: SessionContext,
  now: Date,
): Promise<void> {
  if (ctx.user.role === 'guest') {
    // The guest account is shared: one person must not sign everyone out.
    throw new AppError('FORBIDDEN', GUEST_READ_ONLY);
  }
  await db.transaction(async tx => {
    const ended = await endOtherSessions(tx, ctx);
    if (ended > 0) {
      await logSecurity(tx, {
        userId: ctx.user.id,
        kind: 'sessions_revoked',
        at: now,
      });
    }
  });
}

// ---------------------------------------------------------------- members

interface MemberRow {
  id: string;
  display_name: string;
  role: SessionUser['role'];
  accent: string | null;
  bio: string | null;
  roles: unknown;
  avatar_id: string | null;
}

/**
 * People of the organization (names, photos, roles) so they look the same
 * everywhere. The guest account gets no photos or descriptions.
 */
export async function listMembers(
  db: Queryable,
  viewer: SessionUser,
  organizationId: string,
): Promise<MemberProfile[]> {
  const org = await requireMembership(db, viewer.id, organizationId);
  const rows = await db.query<MemberRow>(
    `SELECT u.id, u.display_name, u.role, u.accent, u.bio, m.roles,
            (SELECT pm.id FROM media pm
              WHERE pm.owner_type = 'user' AND pm.owner_id = u.id LIMIT 1) AS avatar_id
       FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND u.is_active
      ORDER BY u.sort_order, lower(u.display_name), u.id`,
    [org.id],
  );
  const guest = viewer.role === 'guest';
  return rows.map(r => ({
    id: r.id,
    displayName: r.display_name,
    role: r.role,
    avatarId: guest ? null : r.avatar_id,
    accent: r.accent,
    bio: guest ? null : r.bio,
    roles: r.role === 'guest' ? [] : normalizeRoles(parseRoles(r.roles)),
    restricted: guest,
  }));
}
