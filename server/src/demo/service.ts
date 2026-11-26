/**
 * Demo data: fictitious records flagged `is_demo`, removable in one action
 * before the real field day so the team's data stays clean.
 */
import type {Db} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';

/**
 * Deletes every demo record of the organization (or of all organizations when
 * `organizationId` is null) and returns how many records were removed. Demo
 * venues still used by real events are kept. When an actor is given, the
 * removal itself is logged.
 */
export async function clearDemo(
  db: Db,
  args: {organizationId: string | null; actorId: string | null; now: Date},
): Promise<{removed: number}> {
  return db.transaction(async tx => {
    const orgFilter =
      args.organizationId === null ? '' : 'AND organization_id = $1';
    const params = args.organizationId === null ? [] : [args.organizationId];
    const events = await tx.query<{id: string}>(
      `DELETE FROM events WHERE is_demo ${orgFilter} RETURNING id`,
      params,
    );
    const venues = await tx.query<{id: string}>(
      `DELETE FROM venues v
        WHERE v.is_demo ${orgFilter.replace('organization_id', 'v.organization_id')}
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.venue_id = v.id)
        RETURNING v.id`,
      params,
    );
    await tx.query(
      `DELETE FROM activity_log WHERE is_demo ${orgFilter}`,
      params,
    );
    const removed = events.length + venues.length;
    if (removed > 0 && args.actorId && args.organizationId) {
      await appendActivity(tx, {
        organizationId: args.organizationId,
        userId: args.actorId,
        entityType: 'demo',
        entityId: args.organizationId,
        entityLabel: 'Datos de demostración',
        action: 'delete',
        at: args.now,
      });
    }
    return {removed};
  });
}
