/**
 * Activity log: one row per write, appended in the same transaction as the
 * change it describes. Feeds «Actividad reciente» and the day close.
 */
import type {Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import type {
  ActivityAction,
  ActivityEntry,
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
}

export async function appendActivity(
  db: Queryable,
  entry: ActivityInput,
): Promise<void> {
  await db.query(
    `INSERT INTO activity_log
       (organization_id, user_id, entity_type, entity_id, entity_label, action,
        changed_fields, at, is_demo)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9)`,
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
    ],
  );
}

interface ActivityRow {
  id: string;
  user_id: string;
  display_name: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: ActivityAction;
  changed_fields: unknown;
  at: unknown;
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
] as const;

export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];

/**
 * Newest first: the organization's recent activity, or the history of one
 * record when `entity` is given.
 */
export async function listActivity(
  db: Queryable,
  organizationId: string,
  limit = ACTIVITY_DEFAULT_LIMIT,
  entity: {type: HistoryEntityType; id: string} | null = null,
): Promise<ActivityEntry[]> {
  const rows = await db.query<ActivityRow>(
    `SELECT a.id, a.user_id, u.display_name, a.entity_type, a.entity_id,
            a.entity_label, a.action, a.changed_fields, a.at
       FROM activity_log a JOIN users u ON u.id = a.user_id
      WHERE a.organization_id = $1
        AND ($3::text IS NULL OR (a.entity_type = $3 AND a.entity_id = $4::uuid))
      ORDER BY a.at DESC, a.seq DESC
      LIMIT $2`,
    [organizationId, limit, entity?.type ?? null, entity?.id ?? null],
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
  }));
}

function parseFields(value: unknown): string[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list) ? list.map(String) : [];
}
