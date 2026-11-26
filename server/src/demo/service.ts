/**
 * Demo data: fictitious records flagged `is_demo`, removable in one action
 * before the real field day so the team's data stays clean. Removal is
 * remembered per organization (`organizations.demo_removed_at`), so the seed
 * never brings the demo back.
 */
import type {Db, Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {SYSTEM_USER} from '../seed/seed.ts';

/**
 * Deletes every demo record of the organization (or of all organizations when
 * `organizationId` is null) and returns how many records were removed: demo
 * tasks, events, venues and companies, and their activity. Demo venues and
 * companies still used by real records are kept.
 *
 * Real tasks that lose a link to a demo record (their event or a predecessor)
 * get a new version, `updated_by`/`updated_at` and an activity entry, so a
 * stale edit cannot restore the link silently and the team sees why the task
 * changed. The author is the user who removed the demo, or «Sistema» from the
 * command line. The removal itself is logged once per organization that had
 * demo data, and the organization is marked so the seed skips the demo.
 */
export async function clearDemo(
  db: Db,
  args: {organizationId: string | null; actorId: string | null; now: Date},
): Promise<{removed: number}> {
  return db.transaction(async tx => {
    const all = args.organizationId === null;
    const params: unknown[] = all ? [] : [args.organizationId];
    /** Organization filter for table alias `t`. */
    const inOrg = (t: string) => (all ? '' : `AND ${t}.organization_id = $1`);
    const now = args.now.toISOString();
    const actorId = args.actorId ?? (await systemUserId(tx));

    const bumped = await tx.query<{
      id: string;
      organization_id: string;
      title: string;
      lost_event: boolean;
      lost_dependency: boolean;
    }>(
      `UPDATE tasks r
          SET version = version + 1,
              updated_at = $${params.length + 1}::timestamptz,
              updated_by = COALESCE($${params.length + 2}::uuid, r.updated_by)
        WHERE NOT r.is_demo ${inOrg('r')}
          AND (EXISTS (SELECT 1 FROM events e WHERE e.id = r.event_id AND e.is_demo)
               OR EXISTS (SELECT 1 FROM task_dependencies d
                            JOIN tasks p ON p.id = d.depends_on_id
                           WHERE d.task_id = r.id AND p.is_demo))
        RETURNING r.id, r.organization_id, r.title,
                  EXISTS (SELECT 1 FROM events e
                           WHERE e.id = r.event_id AND e.is_demo) AS lost_event,
                  EXISTS (SELECT 1 FROM task_dependencies d
                            JOIN tasks p ON p.id = d.depends_on_id
                           WHERE d.task_id = r.id AND p.is_demo) AS lost_dependency`,
      [...params, now, actorId],
    );
    const tasks = await tx.query<{organization_id: string}>(
      `DELETE FROM tasks t WHERE t.is_demo ${inOrg('t')} RETURNING t.organization_id`,
      params,
    );
    const events = await tx.query<{organization_id: string}>(
      `DELETE FROM events e WHERE e.is_demo ${inOrg('e')} RETURNING e.organization_id`,
      params,
    );
    const venues = await tx.query<{organization_id: string}>(
      `DELETE FROM venues v
        WHERE v.is_demo ${inOrg('v')}
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.venue_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.venue_id = v.id)
        RETURNING v.organization_id`,
      params,
    );
    const companies = await tx.query<{organization_id: string}>(
      `DELETE FROM companies c
        WHERE c.is_demo ${inOrg('c')}
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.company_id = c.id)
        RETURNING c.organization_id`,
      params,
    );
    await tx.query(
      `DELETE FROM activity_log a WHERE a.is_demo ${inOrg('a')}`,
      params,
    );
    // Remembered even when nothing was left: asking to remove the demo means
    // the team does not want it back. The first removal time is kept.
    await tx.query(
      `UPDATE organizations o
          SET demo_removed_at = COALESCE(o.demo_removed_at, $${params.length + 1}::timestamptz)
        WHERE true ${all ? '' : 'AND o.id = $1'}`,
      [...params, now],
    );

    if (actorId) {
      for (const t of bumped) {
        await appendActivity(tx, {
          organizationId: t.organization_id,
          userId: actorId,
          entityType: 'task',
          entityId: t.id,
          entityLabel: t.title,
          action: 'update',
          changedFields: [
            ...(t.lost_event ? ['eventId'] : []),
            ...(t.lost_dependency ? ['dependsOn'] : []),
          ],
          at: args.now,
        });
      }
      const touched = new Set(
        [...tasks, ...events, ...venues, ...companies].map(
          r => r.organization_id,
        ),
      );
      for (const organizationId of [...touched].sort()) {
        await appendActivity(tx, {
          organizationId,
          userId: actorId,
          entityType: 'demo',
          entityId: organizationId,
          entityLabel: 'Datos de demostración',
          action: 'delete',
          at: args.now,
        });
      }
    }
    return {
      removed: tasks.length + events.length + venues.length + companies.length,
    };
  });
}

/** The seed's «Sistema» author; null if the database was never seeded. */
async function systemUserId(tx: Queryable): Promise<string | null> {
  const rows = await tx.query<{id: string}>(
    'SELECT id FROM users WHERE lower(display_name) = lower($1)',
    [SYSTEM_USER],
  );
  return rows[0]?.id ?? null;
}
