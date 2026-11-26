/**
 * Opaque bearer sessions. The client keeps a random 32-byte token; the
 * database keeps only its SHA-256, so a database leak does not leak usable
 * sessions. Expiry slides: each use extends it (at most one write per hour).
 */
import {createHash, randomBytes} from 'node:crypto';
import type {Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import type {Role, SessionUser} from '../../../shared/logistics/contracts.ts';

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

export async function createSession(
  db: Queryable,
  userId: string,
  now: Date,
  sessionDays: number,
): Promise<{token: string; expiresAt: string}> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + sessionDays * DAY_MS);
  // Housekeeping: drop this user's expired sessions.
  await db.query(
    'DELETE FROM sessions WHERE user_id = $1 AND expires_at <= $2::timestamptz',
    [userId, now.toISOString()],
  );
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $4::timestamptz)`,
    [userId, hashToken(token), now.toISOString(), expiresAt.toISOString()],
  );
  return {token, expiresAt: expiresAt.toISOString()};
}

interface SessionRow {
  session_id: string;
  last_seen_at: unknown;
  user_id: string;
  display_name: string;
  role: Role;
}

/** The user behind a token, or null if it is unknown, expired or disabled. */
export async function resolveSession(
  db: Queryable,
  token: string,
  now: Date,
  sessionDays: number,
): Promise<SessionUser | null> {
  if (!isWellFormedToken(token)) return null;
  const rows = await db.query<SessionRow>(
    `SELECT s.id AS session_id, s.last_seen_at, u.id AS user_id, u.display_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2::timestamptz AND u.is_active`,
    [hashToken(token), now.toISOString()],
  );
  const row = rows[0];
  if (!row) return null;
  const lastSeen = Date.parse(toIso(row.last_seen_at));
  if (now.getTime() - lastSeen >= TOUCH_EVERY_MS) {
    await db.query(
      `UPDATE sessions SET last_seen_at = $2::timestamptz, expires_at = $3::timestamptz
        WHERE id = $1`,
      [
        row.session_id,
        now.toISOString(),
        new Date(now.getTime() + sessionDays * DAY_MS).toISOString(),
      ],
    );
  }
  return {id: row.user_id, displayName: row.display_name, role: row.role};
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

export async function deleteUserSessions(
  db: Queryable,
  userId: string,
): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}
