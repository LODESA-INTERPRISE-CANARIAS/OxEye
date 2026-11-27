/**
 * Opaque bearer sessions. The client keeps a random 32-byte token; the
 * database keeps only its SHA-256, so a database leak does not leak usable
 * sessions. Expiry of a normal session slides: each use extends it (at most
 * one write per hour).
 *
 * Revisión 1 · E4: a session also records a short device label, and may be
 * a support session (an administrator acting on someone's account, with a
 * reason) or «Ver como Invitado» (an administrator on the guest account).
 * Those two have a fixed end and never slide; they end with the opener's
 * account too.
 */
import {createHash, randomBytes} from 'node:crypto';
import type {Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {
  isSharedAccount,
  normalizeRoles,
} from '../../../shared/logistics/permissions.ts';
import type {
  OrgRole,
  Role,
  SessionKind,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

const DAY_MS = 86_400_000;
const TOUCH_EVERY_MS = 3_600_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export interface NewSessionOptions {
  device?: string | null;
  kind?: SessionKind;
  openedBy?: string | null;
  reason?: string | null;
  /** Fixed end (support sessions); default: now + sessionDays. */
  expiresAt?: Date;
}

export async function createSession(
  db: Queryable,
  userId: string,
  now: Date,
  sessionDays: number,
  options: NewSessionOptions = {},
): Promise<{id: string; token: string; expiresAt: string}> {
  const token = newToken();
  const expiresAt =
    options.expiresAt ?? new Date(now.getTime() + sessionDays * DAY_MS);
  // Housekeeping: drop this user's expired sessions.
  await db.query(
    'DELETE FROM sessions WHERE user_id = $1 AND expires_at <= $2::timestamptz',
    [userId, now.toISOString()],
  );
  const rows = await db.query<{id: string}>(
    `INSERT INTO sessions
       (user_id, token_hash, created_at, last_seen_at, expires_at, device,
        kind, opened_by, reason)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $4::timestamptz, $5,
             $6, $7, $8)
     RETURNING id`,
    [
      userId,
      hashToken(token),
      now.toISOString(),
      expiresAt.toISOString(),
      options.device ?? null,
      options.kind ?? 'normal',
      options.openedBy ?? null,
      options.reason ?? null,
    ],
  );
  return {
    id: (rows[0] as {id: string}).id,
    token,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Columns of alias `u` that make a `SessionUser` (without `support`). */
export const SESSION_USER_COLUMNS = `u.id AS user_id, u.username, u.display_name,
  u.role, u.accent, u.password_provisional, u.welcomed_at,
  (SELECT pm.id FROM media pm
    WHERE pm.owner_type = 'user' AND pm.owner_id = u.id LIMIT 1) AS avatar_id,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'organizationId', om.organization_id, 'roles', om.roles)
              ORDER BY om.organization_id)
       FROM organization_members om WHERE om.user_id = u.id), '[]'::jsonb)
    AS memberships`;

export interface SessionUserRow {
  user_id: string;
  username: string;
  display_name: string;
  role: Role;
  accent: string | null;
  password_provisional: boolean;
  welcomed_at: unknown;
  avatar_id: string | null;
  memberships: unknown;
}

export interface MembershipRoles {
  organizationId: string;
  roles: OrgRole[];
}

export function parseMemberships(value: unknown): MembershipRoles[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    const o = item as {organizationId: unknown; roles: unknown};
    return {
      organizationId: String(o.organizationId),
      roles: normalizeRoles(Array.isArray(o.roles) ? o.roles : []),
    };
  });
}

export function toSessionUser(
  row: SessionUserRow,
  support: SessionUser['support'] = null,
): SessionUser {
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    avatarId: row.avatar_id,
    accent: row.accent,
    // Shared accounts (Equipo, Invitado) cannot change their password:
    // never nagged, nothing withheld for it.
    passwordProvisional:
      Boolean(row.password_provisional) &&
      !isSharedAccount(
        row.role,
        parseMemberships(row.memberships).map(m => m.roles),
      ),
    welcomed: row.welcomed_at !== null && row.welcomed_at !== undefined,
    support,
  };
}

/** The account as a `SessionUser` (login, support sessions). */
export async function loadSessionUser(
  db: Queryable,
  userId: string,
): Promise<{user: SessionUser; memberships: MembershipRoles[]} | null> {
  const rows = await db.query<SessionUserRow>(
    `SELECT ${SESSION_USER_COLUMNS} FROM users u WHERE u.id = $1 AND u.is_active`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    user: toSessionUser(row),
    memberships: parseMemberships(row.memberships),
  };
}

/** What the auth middleware knows about the request's session. */
export interface SessionContext {
  sessionId: string;
  kind: SessionKind;
  user: SessionUser;
  memberships: MembershipRoles[];
  /** The administrator behind a support / «Ver como Invitado» session. */
  openedBy: string | null;
}

interface SessionRow extends SessionUserRow {
  session_id: string;
  kind: SessionKind;
  last_seen_at: unknown;
  expires_at: unknown;
  reason: string | null;
  opened_by: string | null;
  opened_by_name: string | null;
}

/** The session behind a token, or null if it is unknown, expired or disabled. */
export async function resolveSession(
  db: Queryable,
  token: string,
  now: Date,
  sessionDays: number,
): Promise<SessionContext | null> {
  if (!isWellFormedToken(token)) return null;
  const rows = await db.query<SessionRow>(
    `SELECT s.id AS session_id, s.kind, s.last_seen_at, s.expires_at, s.reason,
            s.opened_by, ob.display_name AS opened_by_name,
            ${SESSION_USER_COLUMNS}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users ob ON ob.id = s.opened_by
      WHERE s.token_hash = $1 AND s.expires_at > $2::timestamptz
        AND u.is_active AND (s.opened_by IS NULL OR ob.is_active)`,
    [hashToken(token), now.toISOString()],
  );
  const row = rows[0];
  if (!row) return null;
  const lastSeen = Date.parse(toIso(row.last_seen_at));
  if (now.getTime() - lastSeen >= TOUCH_EVERY_MS) {
    // Support sessions keep their fixed end; only normal ones slide.
    await db.query(
      `UPDATE sessions
          SET last_seen_at = $2::timestamptz,
              expires_at = CASE WHEN kind = 'normal' THEN $3::timestamptz ELSE expires_at END
        WHERE id = $1`,
      [
        row.session_id,
        now.toISOString(),
        new Date(now.getTime() + sessionDays * DAY_MS).toISOString(),
      ],
    );
  }
  const support: SessionUser['support'] =
    row.kind === 'normal' || !row.opened_by
      ? null
      : {
          kind: row.kind,
          by: {id: row.opened_by, displayName: row.opened_by_name ?? ''},
          reason: row.reason,
          endsAt: toIso(row.expires_at),
        };
  return {
    sessionId: row.session_id,
    kind: row.kind,
    user: toSessionUser(row, support),
    memberships: parseMemberships(row.memberships),
    openedBy: row.opened_by,
  };
}

export async function deleteSession(
  db: Queryable,
  token: string,
): Promise<void> {
  if (!isWellFormedToken(token)) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [
    hashToken(token),
  ]);
}

/**
 * Ends every session of the account, and every support or «Ver como
 * Invitado» session it opened (a new password closes them all).
 */
export async function deleteUserSessions(
  db: Queryable,
  userId: string,
): Promise<number> {
  const rows = await db.query<{id: string}>(
    'DELETE FROM sessions WHERE user_id = $1 OR opened_by = $1 RETURNING id',
    [userId],
  );
  return rows.length;
}
