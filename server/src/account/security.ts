/**
 * Security log (Revisión 1 · E4): logins, password and e-mail changes,
 * sessions ended, support sessions, roles. Each entry names the account it
 * happened to and, when someone else did it, the actor.
 *
 * It never stores a password, a token, a hash or an e-mail address, and
 * never a typed username that matches no account (it could be a password
 * typed in the wrong box). `detail` is only the reason of a support session.
 */
import type {Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import type {
  SecurityEvent,
  SecurityEventKind,
} from '../../../shared/logistics/contracts.ts';

export interface SecurityInput {
  userId: string;
  actorId?: string | null;
  kind: SecurityEventKind;
  /** Support reason only. */
  detail?: string | null;
  device?: string | null;
  at: Date;
}

export async function logSecurity(
  q: Queryable,
  input: SecurityInput,
): Promise<void> {
  await q.query(
    `INSERT INTO security_events (user_id, actor_id, kind, detail, device, at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
    [
      input.userId,
      input.actorId && input.actorId !== input.userId ? input.actorId : null,
      input.kind,
      input.detail ?? null,
      input.device ?? null,
      input.at.toISOString(),
    ],
  );
}

interface SecurityRow {
  id: string;
  kind: SecurityEventKind;
  user_id: string;
  user_name: string;
  actor_id: string | null;
  actor_name: string | null;
  at: unknown;
  detail: string | null;
  device: string | null;
}

function toEvent(row: SecurityRow): SecurityEvent {
  return {
    id: row.id,
    kind: row.kind,
    user: {id: row.user_id, displayName: row.user_name},
    actor: row.actor_id
      ? {id: row.actor_id, displayName: row.actor_name ?? ''}
      : null,
    at: toIso(row.at),
    detail: row.detail,
    device: row.device,
  };
}

const SELECT_EVENTS = `
  SELECT e.id, e.kind, e.user_id, u.display_name AS user_name, e.actor_id,
         a.display_name AS actor_name, e.at, e.detail, e.device
    FROM security_events e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN users a ON a.id = e.actor_id`;

/** The account's own history, newest first. */
export async function listOwnSecurity(
  q: Queryable,
  userId: string,
  limit = 100,
): Promise<SecurityEvent[]> {
  const rows = await q.query<SecurityRow>(
    `${SELECT_EVENTS}
      WHERE e.user_id = $1
      ORDER BY e.at DESC, e.id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toEvent);
}

/** Events of the accounts that belong to any of these organizations. */
export async function listSecurityOf(
  q: Queryable,
  organizationIds: readonly string[],
  limit = 200,
): Promise<SecurityEvent[]> {
  if (organizationIds.length === 0) return [];
  const rows = await q.query<SecurityRow>(
    `${SELECT_EVENTS}
      WHERE e.user_id IN (
        SELECT user_id FROM organization_members
         WHERE organization_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)))
      ORDER BY e.at DESC, e.id DESC
      LIMIT $2`,
    [JSON.stringify(organizationIds), limit],
  );
  return rows.map(toEvent);
}
