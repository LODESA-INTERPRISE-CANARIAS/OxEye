/**
 * Demo data: fictitious records flagged `is_demo`, removable in one action
 * before the real field day so the team's data stays clean. Removal is
 * remembered per organization (`organizations.demo_removed_at`), so the seed
 * never brings the demo back.
 */
import type {Db, Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {lockCatalogue, lockGraph} from '../records/locks.ts';
import {SYSTEM_USER} from '../seed/seed.ts';

interface Bumped {
  id: string;
  organization_id: string;
  name: string;
}

/**
 * Deletes every demo record of the organization (or of all organizations when
 * `organizationId` is null) and returns how many records were removed: demo
 * tasks, offers, contacts, events, venues and companies, and their activity.
 * Demo venues and companies still used by real records are kept.
 *
 * Real records that lose a link to a demo record get a new version,
 * `updated_by`/`updated_at` and an activity entry, so a stale edit cannot
 * restore the link silently and the team sees why the record changed: tasks
 * (their event, a predecessor or their contact), contacts (a demo event) and
 * companies (a demo main contact). The author is the user who removed the
 * demo, or «Sistema» from the command line. The removal itself is logged once
 * per organization that had demo data, and the organization is marked so the
 * seed skips the demo.
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

    // Same lock order as every other writer: graph, then catalogue, per
    // organization in id order, before any row lock.
    const orgIds = all
      ? (
          await tx.query<{id: string}>(
            'SELECT id FROM organizations ORDER BY id',
          )
        ).map(o => o.id)
      : [args.organizationId as string];
    for (const id of orgIds) await lockGraph(tx, id);
    for (const id of orgIds) await lockCatalogue(tx, id);

    const touch = `version = version + 1,
              updated_at = $${params.length + 1}::timestamptz,
              updated_by = COALESCE($${params.length + 2}::uuid, r.updated_by)`;
    const bumped = await tx.query<
      Bumped & {
        lost_event: boolean;
        lost_contact: boolean;
        lost_dependency: boolean;
      }
    >(
      `UPDATE tasks r
          SET ${touch}
        WHERE NOT r.is_demo ${inOrg('r')}
          AND (EXISTS (SELECT 1 FROM events e WHERE e.id = r.event_id AND e.is_demo)
               OR EXISTS (SELECT 1 FROM contacts k WHERE k.id = r.contact_id AND k.is_demo)
               OR EXISTS (SELECT 1 FROM task_dependencies d
                            JOIN tasks p ON p.id = d.depends_on_id
                           WHERE d.task_id = r.id AND p.is_demo))
        RETURNING r.id, r.organization_id, r.title AS name,
                  EXISTS (SELECT 1 FROM events e
                           WHERE e.id = r.event_id AND e.is_demo) AS lost_event,
                  EXISTS (SELECT 1 FROM contacts k
                           WHERE k.id = r.contact_id AND k.is_demo) AS lost_contact,
                  EXISTS (SELECT 1 FROM task_dependencies d
                            JOIN tasks p ON p.id = d.depends_on_id
                           WHERE d.task_id = r.id AND p.is_demo) AS lost_dependency`,
      [...params, now, actorId],
    );
    const bumpedContacts = await tx.query<Bumped>(
      `UPDATE contacts r
          SET ${touch}
        WHERE NOT r.is_demo ${inOrg('r')}
          AND EXISTS (SELECT 1 FROM contact_events ce
                        JOIN events e ON e.id = ce.event_id
                       WHERE ce.contact_id = r.id AND e.is_demo)
        RETURNING r.id, r.organization_id, r.name`,
      [...params, now, actorId],
    );
    const bumpedCompanies = await tx.query<Bumped>(
      `UPDATE companies r
          SET main_contact_id = NULL, ${touch}
        WHERE NOT r.is_demo ${inOrg('r')}
          AND EXISTS (SELECT 1 FROM contacts k
                       WHERE k.id = r.main_contact_id AND k.is_demo)
        RETURNING r.id, r.organization_id, r.name`,
      [...params, now, actorId],
    );

    const remove = (sql: string) =>
      tx.query<{organization_id: string}>(sql, params);
    // Children first; foreign keys clear the links of real records
    // (tasks.event_id, tasks.contact_id, contact_events) bumped above.
    const tasks = await remove(
      `DELETE FROM tasks t WHERE t.is_demo ${inOrg('t')} RETURNING t.organization_id`,
    );
    const offers = await remove(
      `DELETE FROM offers o WHERE o.is_demo ${inOrg('o')} RETURNING o.organization_id`,
    );
    const contacts = await remove(
      `DELETE FROM contacts k WHERE k.is_demo ${inOrg('k')} RETURNING k.organization_id`,
    );
    const events = await remove(
      `DELETE FROM events e WHERE e.is_demo ${inOrg('e')} RETURNING e.organization_id`,
    );
    const venues = await remove(
      `DELETE FROM venues v
        WHERE v.is_demo ${inOrg('v')}
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.venue_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.venue_id = v.id)
        RETURNING v.organization_id`,
    );
    const companies = await remove(
      `DELETE FROM companies c
        WHERE c.is_demo ${inOrg('c')}
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM contacts k WHERE k.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.company_id = c.id)
        RETURNING c.organization_id`,
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

    const removedRows = [
      ...tasks,
      ...offers,
      ...contacts,
      ...events,
      ...venues,
      ...companies,
    ];
    if (actorId) {
      const log = (entityType: string, r: Bumped, changedFields: string[]) =>
        appendActivity(tx, {
          organizationId: r.organization_id,
          userId: actorId,
          entityType,
          entityId: r.id,
          entityLabel: r.name,
          action: 'update',
          changedFields,
          at: args.now,
        });
      for (const c of bumpedCompanies) {
        await log('company', c, ['mainContactId']);
      }
      for (const c of bumpedContacts) await log('contact', c, ['eventIds']);
      for (const t of bumped) {
        await log('task', t, [
          ...(t.lost_event ? ['eventId'] : []),
          ...(t.lost_contact ? ['contact'] : []),
          ...(t.lost_dependency ? ['dependsOn'] : []),
        ]);
      }
      const touched = new Set(removedRows.map(r => r.organization_id));
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
    return {removed: removedRows.length};
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
