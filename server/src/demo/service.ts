/**
 * Demo data: fictitious records flagged `is_demo`, removable in one action
 * before the real field day so the team's data stays clean. Removal is
 * remembered per organization (`organizations.demo_removed_at`), so the seed
 * never brings the demo back.
 */
import type {Db, Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {noteLabels} from '../notes/refs.ts';
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
 * notes, delay hypotheses about demo tasks, tasks, resources, offers,
 * contacts, events, warehouses, venues and companies, and their activity.
 * Demo venues, companies and warehouses still
 * used by real records (including real notes that point at them) are kept.
 *
 * Real records that lose a link to a demo record get a new version,
 * `updated_by`/`updated_at` and an activity entry, so a stale edit cannot
 * restore the link silently and the team sees why the record changed: tasks
 * (their event, a predecessor, their contact or a resource; losing a resource
 * also clears a declared subsoil review), contacts (a demo
 * event), companies (a demo main contact), resources (a demo offer) and notes
 * (a demo event, or the demo task, person, offer or resource they point at).
 * The author is the user who removed the demo, or «Sistema» from the command
 * line. The removal itself is logged once per organization that had demo
 * data, and the organization is marked so the seed skips the demo.
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
    // A real task that loses a demo resource also loses its declared subsoil
    // review: the review was for that material (same rule as a task edit).
    const lostResource = `EXISTS (SELECT 1 FROM task_resources tr
                            JOIN resources s ON s.id = tr.resource_id
                           WHERE tr.task_id = r.id AND s.is_demo)`;
    const bumped = await tx.query<
      Bumped & {
        lost_event: boolean;
        lost_contact: boolean;
        lost_dependency: boolean;
        lost_resource: boolean;
        lost_review: boolean;
      }
    >(
      `UPDATE tasks r
          SET subsoil_reviewed_by = CASE WHEN ${lostResource} THEN NULL
                                         ELSE r.subsoil_reviewed_by END,
              subsoil_reviewed_at = CASE WHEN ${lostResource} THEN NULL
                                         ELSE r.subsoil_reviewed_at END,
              ${touch}
         FROM (SELECT t.id, t.subsoil_reviewed_at IS NOT NULL AS had_review
                 FROM tasks t) old
        WHERE old.id = r.id AND NOT r.is_demo ${inOrg('r')}
          AND (EXISTS (SELECT 1 FROM events e WHERE e.id = r.event_id AND e.is_demo)
               OR EXISTS (SELECT 1 FROM contacts k WHERE k.id = r.contact_id AND k.is_demo)
               OR EXISTS (SELECT 1 FROM task_dependencies d
                            JOIN tasks p ON p.id = d.depends_on_id
                           WHERE d.task_id = r.id AND p.is_demo)
               OR ${lostResource})
        RETURNING r.id, r.organization_id, r.title AS name,
                  EXISTS (SELECT 1 FROM events e
                           WHERE e.id = r.event_id AND e.is_demo) AS lost_event,
                  EXISTS (SELECT 1 FROM contacts k
                           WHERE k.id = r.contact_id AND k.is_demo) AS lost_contact,
                  EXISTS (SELECT 1 FROM task_dependencies d
                            JOIN tasks p ON p.id = d.depends_on_id
                           WHERE d.task_id = r.id AND p.is_demo) AS lost_dependency,
                  ${lostResource} AS lost_resource,
                  (old.had_review AND ${lostResource}) AS lost_review`,
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
    // A demo warehouse or company a real resource uses is kept; a demo offer
    // always goes, so the resource loses it.
    const bumpedResources = await tx.query<Bumped>(
      `UPDATE resources r
          SET offer_id = NULL, ${touch}
        WHERE NOT r.is_demo ${inOrg('r')}
          AND EXISTS (SELECT 1 FROM offers o WHERE o.id = r.offer_id AND o.is_demo)
        RETURNING r.id, r.organization_id, r.name`,
      [...params, now, actorId],
    );
    // Real notes lose a demo event and a demo task, person, offer or resource
    // they point at (a note has at most one of those). Demo venues, companies
    // and warehouses they point at are kept below.
    const bumpedNotes = await tx.query<{
      id: string;
      lost_event: boolean;
      lost_ref: boolean;
    }>(
      `WITH lost AS (
         SELECT n.id,
                EXISTS (SELECT 1 FROM events e
                         WHERE e.id = n.event_id AND e.is_demo) AS lost_event,
                (EXISTS (SELECT 1 FROM tasks t WHERE t.id = n.task_id AND t.is_demo)
                 OR EXISTS (SELECT 1 FROM contacts k WHERE k.id = n.contact_id AND k.is_demo)
                 OR EXISTS (SELECT 1 FROM offers o WHERE o.id = n.offer_id AND o.is_demo)
                 OR EXISTS (SELECT 1 FROM resources s
                             WHERE s.id = n.resource_id AND s.is_demo)) AS lost_ref
           FROM notes n
          WHERE NOT n.is_demo ${inOrg('n')}
       )
       UPDATE notes r
          SET event_id = CASE WHEN lost.lost_event THEN NULL ELSE r.event_id END,
              task_id = CASE WHEN lost.lost_ref THEN NULL ELSE r.task_id END,
              contact_id = CASE WHEN lost.lost_ref THEN NULL ELSE r.contact_id END,
              offer_id = CASE WHEN lost.lost_ref THEN NULL ELSE r.offer_id END,
              resource_id = CASE WHEN lost.lost_ref THEN NULL ELSE r.resource_id END,
              ${touch}
         FROM lost
        WHERE lost.id = r.id AND (lost.lost_event OR lost.lost_ref)
        RETURNING r.id, lost.lost_event, lost.lost_ref`,
      [...params, now, actorId],
    );

    const remove = (sql: string) =>
      tx.query<{organization_id: string}>(sql, params);
    // Children first; real records' links to demo records were cleared above
    // or go with foreign keys (tasks.event_id, tasks.contact_id,
    // contact_events, task_resources).
    const notes = await remove(
      `DELETE FROM notes n WHERE n.is_demo ${inOrg('n')} RETURNING n.organization_id`,
    );
    // Hypotheses about demo tasks are demo data (open or applied). A real
    // hypothesis can only point at a demo task if that task were promoted,
    // which never happens; the rule of a task delete covers it anyway: open
    // ones go, applied ones lose the link and keep their label.
    const hypotheses = await remove(
      `DELETE FROM hypotheses h
        WHERE (h.is_demo
               OR (h.applied_at IS NULL
                   AND EXISTS (SELECT 1 FROM tasks t
                                WHERE t.id = h.task_id AND t.is_demo)))
              ${inOrg('h')}
        RETURNING h.organization_id`,
    );
    await tx.query(
      `UPDATE hypotheses h SET task_id = NULL
        WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.id = h.task_id AND t.is_demo)
              ${inOrg('h')}`,
      params,
    );
    // Revisión 1: conflicts accepted about demo tasks are demo data too.
    const acceptances = await remove(
      `DELETE FROM conflict_acceptances a
        WHERE (a.is_demo
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.windows) w
                            JOIN tasks t ON t.id = (w->>'taskId')::uuid
                           WHERE t.is_demo))
              ${inOrg('a')}
        RETURNING a.organization_id`,
    );
    const tasks = await remove(
      `DELETE FROM tasks t WHERE t.is_demo ${inOrg('t')} RETURNING t.organization_id`,
    );
    // Photos have no foreign key to their resource: they go first.
    await tx.query(
      `DELETE FROM media m
        WHERE m.owner_type = 'resource'
          AND EXISTS (SELECT 1 FROM resources s
                       WHERE s.id = m.owner_id AND s.is_demo)
              ${inOrg('m')}`,
      params,
    );
    const resources = await remove(
      `DELETE FROM resources s WHERE s.is_demo ${inOrg('s')} RETURNING s.organization_id`,
    );
    const offers = await remove(
      `DELETE FROM offers o WHERE o.is_demo ${inOrg('o')} RETURNING o.organization_id`,
    );
    const contacts = await remove(
      `DELETE FROM contacts k WHERE k.is_demo ${inOrg('k')} RETURNING k.organization_id`,
    );
    // Revisión 1 · E5: a demo event's budget and expenses go with it (the
    // foreign keys cascade too; said here so nobody wonders).
    await tx.query(
      `DELETE FROM expenses x
        WHERE EXISTS (SELECT 1 FROM events e WHERE e.id = x.event_id AND e.is_demo)
              ${inOrg('x')}`,
      params,
    );
    const events = await remove(
      `DELETE FROM events e WHERE e.is_demo ${inOrg('e')} RETURNING e.organization_id`,
    );
    const warehouses = await remove(
      `DELETE FROM warehouses w
        WHERE w.is_demo ${inOrg('w')}
          AND NOT EXISTS (SELECT 1 FROM resources s WHERE s.warehouse_id = w.id)
          AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.warehouse_id = w.id)
        RETURNING w.organization_id`,
    );
    const venues = await remove(
      `DELETE FROM venues v
        WHERE v.is_demo ${inOrg('v')}
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.venue_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.venue_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.venue_id = v.id)
        RETURNING v.organization_id`,
    );
    const companies = await remove(
      `DELETE FROM companies c
        WHERE c.is_demo ${inOrg('c')}
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM contacts k WHERE k.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM resources s WHERE s.company_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.company_id = c.id)
          -- E5: a demo company a real expense is paid to stays.
          AND NOT EXISTS (SELECT 1 FROM expenses x WHERE x.company_id = c.id)
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
      ...notes,
      ...hypotheses,
      ...acceptances,
      ...tasks,
      ...resources,
      ...offers,
      ...contacts,
      ...events,
      ...warehouses,
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
      for (const r of bumpedResources) await log('resource', r, ['offerId']);
      // Labelled by kind and what they still point at, never by their text.
      const lostOf = new Map(bumpedNotes.map(n => [n.id, n]));
      for (const n of await noteLabels(
        tx,
        bumpedNotes.map(b => b.id),
      )) {
        const lost = lostOf.get(n.id);
        await log('note', {...n, name: n.label}, [
          ...(lost?.lost_event ? ['event'] : []),
          ...(lost?.lost_ref ? ['ref'] : []),
        ]);
      }
      for (const t of bumped) {
        await log('task', t, [
          ...(t.lost_event ? ['eventId'] : []),
          ...(t.lost_contact ? ['contact'] : []),
          ...(t.lost_dependency ? ['dependsOn'] : []),
          ...(t.lost_resource ? ['resourceIds'] : []),
          ...(t.lost_review ? ['subsoilReview'] : []),
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
