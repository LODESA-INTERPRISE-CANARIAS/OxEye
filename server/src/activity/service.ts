/**
 * Activity log: one row per write, appended in the same transaction as the
 * change it describes. Feeds «Actividad reciente» and the day close.
 */
import type {Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {supportByFor} from '../http/acting.ts';
import type {
  ActivityAction,
  ActivityEntry,
  ChangesResponse,
  MoveOrigin,
} from '../../../shared/logistics/contracts.ts';

export interface ActivityInput {
  organizationId: string;
  userId: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: ActivityAction;
  changedFields?: string[];
  at: Date;
  isDemo?: boolean;
  /** Revisión 1 · E2: the confirmed move that wrote this task update. */
  origin?: MoveOrigin;
}

/**
 * Safety audit: a row signed by the account of a support session also keeps
 * the administrator behind it (`support_by`, from the request; see
 * http/acting.ts), so no caller can forget it.
 */
export async function appendActivity(
  db: Queryable,
  entry: ActivityInput,
): Promise<void> {
  await db.query(
    `INSERT INTO activity_log
       (organization_id, user_id, entity_type, entity_id, entity_label, action,
        changed_fields, at, is_demo, move_origin, support_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9, $10, $11)`,
    [
      entry.organizationId,
      entry.userId,
      entry.entityType,
      entry.entityId,
      entry.entityLabel.slice(0, 300),
      entry.action,
      JSON.stringify(entry.changedFields ?? []),
      entry.at.toISOString(),
      entry.isDemo ?? false,
      entry.origin ?? null,
      supportByFor(entry.userId),
    ],
  );
}

interface ActivityRow {
  id: string;
  user_id: string;
  display_name: string;
  support_by: string | null;
  support_by_name: string | null;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: ActivityAction;
  changed_fields: unknown;
  at: unknown;
  move_origin: MoveOrigin | null;
}

export const ACTIVITY_DEFAULT_LIMIT = 20;
export const ACTIVITY_MAX_LIMIT = 100;

/** Record types whose history can be asked for (`entityType` of the log). */
export const HISTORY_ENTITY_TYPES = [
  'event',
  'task',
  'venue',
  'company',
  'contact',
  'offer',
  'category',
  'warehouse',
  'resource',
  'note',
  'hypothesis',
  // Revisión 1 · E5 (only with `budget.read`).
  'budget',
  'expense',
] as const;

export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];

/** E4: entries hidden from viewers without `directory.read` (people, suppliers, prices). */
export const DIRECTORY_ENTITY_TYPES = [
  'company',
  'contact',
  'offer',
  // Revisión 1 · E6–E7: quote requests, proposals and offer terms.
  'quote_request',
  'proposal',
  'offer_settings',
  'offer_renewal',
] as const;

/** A `from` ≤ at < `to` window of the log (M6, the day close). */
export interface ActivityRange {
  from: Date;
  to: Date;
}

/**
 * Newest first: the organization's recent activity, the history of one
 * record when `entity` is given, or the entries of a time range (M6).
 */
export async function listActivity(
  db: Queryable,
  organizationId: string,
  limit = ACTIVITY_DEFAULT_LIMIT,
  entity: {type: HistoryEntityType; id: string} | null = null,
  range: ActivityRange | null = null,
  /** E4: entity types this viewer may not see (the directory without `directory.read`). */
  excludeTypes: readonly string[] = [],
): Promise<ActivityEntry[]> {
  const rows = await db.query<ActivityRow>(
    `SELECT a.id, a.user_id, u.display_name, a.entity_type, a.entity_id,
            a.entity_label, a.action, a.changed_fields, a.at, a.move_origin,
            a.support_by, su.display_name AS support_by_name
       FROM activity_log a JOIN users u ON u.id = a.user_id
       LEFT JOIN users su ON su.id = a.support_by
      WHERE a.organization_id = $1
        AND ($3::text IS NULL OR (a.entity_type = $3 AND a.entity_id = $4::uuid))
        AND ($5::timestamptz IS NULL OR a.at >= $5::timestamptz)
        AND ($6::timestamptz IS NULL OR a.at < $6::timestamptz)
        AND NOT (a.entity_type IN (SELECT jsonb_array_elements_text($7::jsonb)))
      ORDER BY a.at DESC, a.seq DESC
      LIMIT $2`,
    [
      organizationId,
      limit,
      entity?.type ?? null,
      entity?.id ?? null,
      range?.from.toISOString() ?? null,
      range?.to.toISOString() ?? null,
      JSON.stringify(excludeTypes),
    ],
  );
  return rows.map(r => ({
    id: r.id,
    user: {id: r.user_id, displayName: r.display_name},
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    action: r.action,
    changedFields: parseFields(r.changed_fields),
    at: toIso(r.at),
    ...(r.move_origin ? {origin: r.move_origin} : {}),
    ...(r.support_by && r.support_by_name !== null
      ? {supportBy: {id: r.support_by, displayName: r.support_by_name}}
      : {}),
  }));
}

/** Largest `seq` PostgreSQL can hold (bigint). */
const MAX_SEQ = 9_223_372_036_854_775_807n;

/**
 * The cursor sent back as `since`, or null when it is missing or malformed
 * (not a canonical non-negative integer that fits a bigint).
 */
export function parseCursor(raw: string | undefined): bigint | null {
  if (raw === undefined || !/^(0|[1-9][0-9]{0,18})$/.test(raw)) return null;
  const value = BigInt(raw);
  return value <= MAX_SEQ ? value : null;
}

/**
 * M6 cheap refresh: the organization's cursor (its largest activity `seq`,
 * "0" for an empty log) and which record types were written after `since`
 * or in the last `overlapSeconds` (a transaction that took a lower `seq` but
 * committed later is still reported). No cursor, or one ahead of the log
 * (the log shrinks when the demo is removed) → `full`.
 *
 * With a cursor, one statement, so the cursor and the types come from the
 * same snapshot: a row committed after it is above the cursor and shows up
 * on the next poll. Without one only the cursor is read (a full reload needs
 * no types).
 */
export async function changesSince(
  db: Queryable,
  organizationId: string,
  since: bigint | null,
  now: Date,
  overlapSeconds: number,
): Promise<ChangesResponse> {
  if (since === null) {
    const [only] = await db.query<{max_seq: string | null}>(
      `SELECT max(seq)::text AS max_seq FROM activity_log
        WHERE organization_id = $1`,
      [organizationId],
    );
    return {
      cursor: BigInt(only?.max_seq ?? '0').toString(),
      types: [],
      full: true,
    };
  }
  const rows = await db.query<{max_seq: string | null; types: unknown}>(
    `SELECT (SELECT max(seq) FROM activity_log WHERE organization_id = $1)::text
              AS max_seq,
            (SELECT COALESCE(json_agg(t.entity_type ORDER BY t.entity_type), '[]'::json)
               FROM (SELECT DISTINCT entity_type FROM activity_log
                      WHERE organization_id = $1
                        AND (seq > $2::bigint OR at >= $3::timestamptz)) t)
              AS types`,
    [
      organizationId,
      since.toString(),
      new Date(now.getTime() - overlapSeconds * 1000).toISOString(),
    ],
  );
  const row = rows[0];
  const max = BigInt(row?.max_seq ?? '0');
  const cursor = max.toString();
  if (since > max) return {cursor, types: [], full: true};
  return {cursor, types: parseFields(row?.types), full: false};
}

function parseFields(value: unknown): string[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list) ? list.map(String) : [];
}
