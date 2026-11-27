/**
 * Login, the current user, password recovery and e-mail verification.
 * Plain functions over the database so tests can call them without HTTP.
 *
 * Revisión 1 · E4: login by username (any letter case), no public list of
 * users; an unknown name and a wrong password get the same answer in the
 * same time. Recovery always answers the same, whether the account exists
 * or not; its single-use link is kept only as a hash.
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, validationError} from '../errors.ts';
import {logSecurity} from '../account/security.ts';
import {fallbackResetMessage, resetMessage} from '../mail/messages.ts';
import {accountUrl} from '../mail/links.ts';
import type {MailMessage} from '../mail/transport.ts';
import {listUserOrganizations} from '../organizations/service.ts';
import {hashPassword, verifyAgainstDummy, verifyPassword} from './password.ts';
import type {RateLimiter} from './rate-limit.ts';
import {
  createSession,
  deleteUserSessions,
  hashToken,
  isWellFormedToken,
  loadSessionUser,
  newToken,
} from './sessions.ts';
import {
  passwordProblem,
  RESET_LINK_MINUTES,
} from '../../../shared/logistics/account.ts';
import type {
  LoginResponse,
  MeResponse,
  Role,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

export interface LoginLimits {
  byName: RateLimiter;
  byIp: RateLimiter;
}

const BAD_CREDENTIALS = 'Usuario o contraseña incorrectos.';
export const LINK_INVALID =
  'El enlace no es válido, ya se ha usado o ha caducado. Pide uno nuevo.';

export function rateLimited(
  seconds: number,
  what = 'intentos fallidos',
): AppError {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new AppError(
    'RATE_LIMITED',
    `Demasiados ${what}. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} y vuelve a intentarlo.`,
    {retryAfter: seconds},
  );
}

/** Rate-limit key of a typed name (letter case and spacing ignored). */
export function nameKey(name: string): string {
  return `name:${name.normalize('NFC').trim().toLowerCase()}`;
}

interface UserRow {
  id: string;
  username: string;
  role: Role;
  password_hash: string | null;
}

async function findLoginUser(
  db: Queryable,
  name: string,
  legacyDisplayName: boolean,
): Promise<UserRow | undefined> {
  const rows = await db.query<UserRow>(
    `SELECT id, username, role, password_hash
       FROM users
      WHERE is_active
        AND (lower(username) = lower($1)
             OR ($2::boolean AND lower(display_name) = lower($1)))
      ORDER BY (lower(username) = lower($1)) DESC
      LIMIT 1`,
    [name, legacyDisplayName],
  );
  return rows[0];
}

/**
 * Checks a password against an account by name with the login limits: the
 * attempt counts before scrypt runs (parallel requests see each other) and
 * is given back on success or on a server fault. Unknown names spend the
 * same time. `user` is the account found by that name (null when none);
 * `ok` whether the password matched it.
 */
export async function checkCredentials(
  db: Queryable,
  input: {name: string; password: string; ip: string; legacy?: boolean},
  limits: LoginLimits,
): Promise<{user: UserRow | null; ok: boolean}> {
  const {byName, byIp} = limits;
  const nk = nameKey(input.name);
  const ipKey = `ip:${input.ip}`;
  const wait = Math.max(byName.retryAfter(nk), byIp.retryAfter(ipKey));
  if (wait > 0) throw rateLimited(wait);
  const nameHit = byName.hit(nk);
  const ipHit = byIp.hit(ipKey);
  let user: UserRow | undefined;
  let ok: boolean;
  try {
    user = await findLoginUser(
      db,
      input.name.normalize('NFC').trim(),
      input.legacy ?? false,
    );
    ok =
      user && user.password_hash
        ? await verifyPassword(input.password, user.password_hash)
        : await verifyAgainstDummy(input.password);
  } catch (err) {
    // A server fault is not a wrong password: do not hold it against the user.
    byName.refund(nk, nameHit);
    byIp.refund(ipKey, ipHit);
    throw err;
  }
  if (!ok || !user) return {user: user ?? null, ok: false};
  // Success clears the name's failures and does not count against the IP.
  byName.reset(nk);
  byIp.refund(ipKey, ipHit);
  return {user, ok: true};
}

export async function login(
  db: Db,
  input: {
    username: string;
    password: string;
    ip: string;
    device: string | null;
    legacy?: boolean;
  },
  options: {now: Date; sessionDays: number; limits: LoginLimits},
): Promise<LoginResponse> {
  const {user, ok} = await checkCredentials(
    db,
    {
      name: input.username,
      password: input.password,
      ip: input.ip,
      legacy: input.legacy ?? false,
    },
    options.limits,
  );
  if (!ok || !user) {
    // A known account gets the failure in its own security history; an
    // unknown name is never stored (it may be a password typed in the
    // wrong box).
    if (user) {
      await logSecurity(db, {
        userId: user.id,
        kind: 'login_failed',
        device: input.device,
        at: options.now,
      });
    }
    throw new AppError('UNAUTHENTICATED', BAD_CREDENTIALS);
  }

  const session = await db.transaction(async tx => {
    const created = await createSession(
      tx,
      user.id,
      options.now,
      options.sessionDays,
      {device: input.device},
    );
    await tx.query(
      'UPDATE users SET last_login_at = $2::timestamptz WHERE id = $1',
      [user.id, options.now.toISOString()],
    );
    await logSecurity(tx, {
      userId: user.id,
      kind: 'login',
      device: input.device,
      at: options.now,
    });
    return created;
  });
  const loaded = await loadSessionUser(db, user.id);
  if (!loaded) throw new AppError('UNAUTHENTICATED', BAD_CREDENTIALS);
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: loaded.user,
    organizations: await listUserOrganizations(db, loaded.user),
  };
}

export async function me(db: Db, user: SessionUser): Promise<MeResponse> {
  return {user, organizations: await listUserOrganizations(db, user)};
}

// ---------------------------------------------------------------- recovery

interface RecoveryTarget {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  recovery_email: string | null;
}

/**
 * Creates a single-use reset link for the account and returns the e-mail to
 * send, or null when there is no address to send it to. The caller decides
 * where the link points. An older unused link stops working, except that an
 * anonymous request (`createdBy` null: anyone can type a name) never removes
 * a link an administrator created.
 */
export async function issueResetLink(
  q: Queryable,
  target: RecoveryTarget,
  args: {
    base: string;
    fallback: string | null;
    createdBy: string | null;
    now: Date;
  },
): Promise<{url: string; expiresAt: string; message: MailMessage | null}> {
  const token = newToken();
  const expiresAt = new Date(args.now.getTime() + RESET_LINK_MINUTES * 60_000);
  await q.query(
    `DELETE FROM account_tokens
      WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL
        AND ($2::boolean OR created_by IS NULL)`,
    [target.id, args.createdBy !== null],
  );
  await q.query(
    `INSERT INTO account_tokens (user_id, purpose, token_hash, created_by, created_at, expires_at)
     VALUES ($1, 'password_reset', $2, $3, $4::timestamptz, $5::timestamptz)`,
    [
      target.id,
      hashToken(token),
      args.createdBy,
      args.now.toISOString(),
      expiresAt.toISOString(),
    ],
  );
  const url = accountUrl(args.base, 'reset', token);
  const message = target.recovery_email
    ? resetMessage(target.recovery_email, target.display_name, url)
    : args.fallback
      ? fallbackResetMessage(args.fallback, target.username, url)
      : null;
  return {url, expiresAt: expiresAt.toISOString(), message};
}

export async function findRecoveryTarget(
  q: Queryable,
  where: {userId: string} | {name: string},
): Promise<RecoveryTarget | undefined> {
  const byId = 'userId' in where;
  const rows = await q.query<RecoveryTarget>(
    `SELECT id, username, display_name, role, recovery_email
       FROM users
      WHERE is_active AND ${byId ? 'id = $1' : 'lower(username) = lower($1)'}`,
    [byId ? where.userId : where.name.normalize('NFC').trim()],
  );
  return rows[0];
}

/**
 * POST /auth/recovery, the part the caller waits for: only the rate limits
 * (no database), so a known name and an unknown one answer in the same time.
 * Throws RATE_LIMITED.
 */
export function admitRecovery(
  input: {username: string; ip: string},
  limits: LoginLimits,
): void {
  const {byName, byIp} = limits;
  const nk = nameKey(input.username);
  const ipKey = `ip:${input.ip}`;
  const wait = Math.max(byName.retryAfter(nk), byIp.retryAfter(ipKey));
  if (wait > 0) throw rateLimited(wait, 'intentos');
  byName.hit(nk);
  byIp.hit(ipKey);
}

/**
 * POST /auth/recovery, the part that runs after the answer (in the mail
 * queue): finds the account, issues the link, writes the security log and
 * returns the e-mail to send (null when there is none). Never for the guest
 * account (its password is set by a developer).
 */
export async function prepareRecovery(
  db: Db,
  input: {username: string; device: string | null},
  options: {
    now: Date;
    base: string | null;
    fallback: string | null;
    log: (line: string) => void;
  },
): Promise<MailMessage | null> {
  return db.transaction(async tx => {
    const target = await findRecoveryTarget(tx, {name: input.username});
    if (!target || target.role === 'guest') return null;
    if (!options.base) {
      options.log(
        'Recuperación de contraseña sin enlace: configura PUBLIC_APP_URL o CORS_ORIGINS con la dirección de la web.',
      );
      return null;
    }
    const issued = await issueResetLink(tx, target, {
      base: options.base,
      fallback: options.fallback,
      createdBy: null,
      now: options.now,
    });
    if (!issued.message) {
      options.log(
        'Recuperación de contraseña sin destino: la cuenta no tiene correo verificado y falta RECOVERY_FALLBACK_EMAIL.',
      );
    }
    await logSecurity(tx, {
      userId: target.id,
      kind: 'recovery_requested',
      device: input.device,
      at: options.now,
    });
    return issued.message;
  });
}

interface TokenRow {
  id: string;
  user_id: string;
  username: string;
  role: Role;
  email: string | null;
}

async function findLiveToken(
  q: Queryable,
  token: string,
  purpose: 'password_reset' | 'email_verify',
  now: Date,
  lock = false,
): Promise<TokenRow | undefined> {
  if (!isWellFormedToken(token)) return undefined;
  const rows = await q.query<TokenRow>(
    `SELECT t.id, t.user_id, u.username, u.role, t.email
       FROM account_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL
        AND t.expires_at > $3::timestamptz AND u.is_active${lock ? ' FOR UPDATE OF t' : ''}`,
    [hashToken(token), purpose, now.toISOString()],
  );
  return rows[0];
}

/** POST /auth/reset: a new password from a reset link; ends every session. */
export async function resetPassword(
  db: Db,
  input: {
    token: string;
    newPassword: string;
    ip: string;
    device: string | null;
  },
  options: {now: Date; limits: LoginLimits},
): Promise<void> {
  const ipKey = `ip:${input.ip}`;
  const wait = options.limits.byIp.retryAfter(ipKey);
  if (wait > 0) throw rateLimited(wait);
  const found = await findLiveToken(
    db,
    input.token,
    'password_reset',
    options.now,
  );
  if (!found || found.role === 'guest') {
    options.limits.byIp.hit(ipKey);
    throw validationError({token: LINK_INVALID}, LINK_INVALID);
  }
  const problem = passwordProblem(input.newPassword, found.username);
  if (problem) throw validationError({newPassword: problem}, problem);
  const hash = await hashPassword(input.newPassword);
  await db.transaction(async tx => {
    const row = await findLiveToken(
      tx,
      input.token,
      'password_reset',
      options.now,
      true,
    );
    if (!row) throw validationError({token: LINK_INVALID}, LINK_INVALID);
    await tx.query(
      'UPDATE account_tokens SET used_at = $2::timestamptz WHERE id = $1',
      [row.id, options.now.toISOString()],
    );
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [row.user_id],
    );
    await setPassword(tx, row.user_id, hash, false, options.now);
    await deleteUserSessions(tx, row.user_id);
    await logSecurity(tx, {
      userId: row.user_id,
      kind: 'password_reset',
      device: input.device,
      at: options.now,
    });
  });
}

/** Stores a new password hash; `provisional` when someone else chose it. */
export async function setPassword(
  q: Queryable,
  userId: string,
  hash: string,
  provisional: boolean,
  now: Date,
): Promise<void> {
  await q.query(
    `UPDATE users
        SET password_hash = $2, password_provisional = $3,
            password_changed_at = $4::timestamptz,
            version = version + 1, updated_at = $4::timestamptz
      WHERE id = $1`,
    [userId, hash, provisional, now.toISOString()],
  );
}

/** POST /auth/verify-email: the address of the link becomes the recovery e-mail. */
export async function verifyEmail(
  db: Db,
  input: {token: string; ip: string},
  options: {now: Date; limits: LoginLimits},
): Promise<void> {
  const ipKey = `ip:${input.ip}`;
  const wait = options.limits.byIp.retryAfter(ipKey);
  if (wait > 0) throw rateLimited(wait);
  await db.transaction(async tx => {
    const row = await findLiveToken(
      tx,
      input.token,
      'email_verify',
      options.now,
      true,
    );
    if (!row || !row.email) {
      options.limits.byIp.hit(ipKey);
      throw validationError({token: LINK_INVALID}, LINK_INVALID);
    }
    await tx.query(
      'UPDATE account_tokens SET used_at = $2::timestamptz WHERE id = $1',
      [row.id, options.now.toISOString()],
    );
    await tx.query(
      `DELETE FROM account_tokens
        WHERE user_id = $1 AND purpose = 'email_verify' AND used_at IS NULL`,
      [row.user_id],
    );
    await tx.query(
      `UPDATE users
          SET recovery_email = $2, recovery_email_verified_at = $3::timestamptz,
              version = version + 1, updated_at = $3::timestamptz
        WHERE id = $1`,
      [row.user_id, row.email, options.now.toISOString()],
    );
    await logSecurity(tx, {
      userId: row.user_id,
      kind: 'email_verified',
      at: options.now,
    });
  });
}
