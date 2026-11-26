/**
 * Login, logout and the current user. Plain functions over the database so
 * tests can call them without HTTP.
 */
import type {Db} from '../db/db.ts';
import {AppError} from '../errors.ts';
import {listUserOrganizations} from '../organizations/service.ts';
import {verifyAgainstDummy, verifyPassword} from './password.ts';
import type {RateLimiter} from './rate-limit.ts';
import {createSession} from './sessions.ts';
import type {
  LoginResponse,
  LoginUserOption,
  MeResponse,
  Role,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

export async function listLoginUsers(db: Db): Promise<LoginUserOption[]> {
  return db.query<LoginUserOption>(
    `SELECT display_name AS "displayName", role
       FROM users
      WHERE is_active
      ORDER BY sort_order, lower(display_name)`,
  );
}

export interface LoginLimits {
  byName: RateLimiter;
  byIp: RateLimiter;
}

const BAD_CREDENTIALS = 'Usuario o contraseña incorrectos.';

function rateLimited(seconds: number): AppError {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new AppError(
    'RATE_LIMITED',
    `Demasiados intentos fallidos. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} y vuelve a intentarlo.`,
    {retryAfter: seconds},
  );
}

interface UserRow {
  id: string;
  display_name: string;
  role: Role;
  password_hash: string | null;
}

export async function login(
  db: Db,
  input: {displayName: string; password: string; ip: string},
  options: {now: Date; sessionDays: number; limits: LoginLimits},
): Promise<LoginResponse> {
  const {byName, byIp} = options.limits;
  const nameKey = `name:${input.displayName.trim().toLowerCase()}`;
  const ipKey = `ip:${input.ip}`;
  const wait = Math.max(byName.retryAfter(nameKey), byIp.retryAfter(ipKey));
  if (wait > 0) throw rateLimited(wait);
  // Count the attempt before the first await: parallel requests then see each
  // other and cannot all slip past the check while scrypt runs. It stays as a
  // failure unless refunded below.
  const nameHit = byName.hit(nameKey);
  const ipHit = byIp.hit(ipKey);

  let user: UserRow | undefined;
  let ok: boolean;
  try {
    const rows = await db.query<UserRow>(
      `SELECT id, display_name, role, password_hash
         FROM users
        WHERE lower(display_name) = lower($1) AND is_active`,
      [input.displayName.trim()],
    );
    user = rows[0];
    ok =
      user && user.password_hash
        ? await verifyPassword(input.password, user.password_hash)
        : await verifyAgainstDummy(input.password);
  } catch (err) {
    // A server fault is not a wrong password: do not hold it against the user.
    byName.refund(nameKey, nameHit);
    byIp.refund(ipKey, ipHit);
    throw err;
  }
  if (!ok || !user) throw new AppError('UNAUTHENTICATED', BAD_CREDENTIALS);
  // Success clears the name's failures and does not count against the IP.
  byName.reset(nameKey);
  byIp.refund(ipKey, ipHit);

  const session = await createSession(
    db,
    user.id,
    options.now,
    options.sessionDays,
  );
  const sessionUser: SessionUser = {
    id: user.id,
    displayName: user.display_name,
    role: user.role,
  };
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: sessionUser,
    organizations: await listUserOrganizations(db, user.id),
  };
}

export async function me(db: Db, user: SessionUser): Promise<MeResponse> {
  return {user, organizations: await listUserOrganizations(db, user.id)};
}
