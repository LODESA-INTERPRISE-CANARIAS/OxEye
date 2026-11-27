/**
 * Accepted conflicts («Mantener ambas», Revisión 1 · E2): a conflict warning
 * the team decided to live with, with a short reason, signed and logged.
 *
 * Creating one recomputes the plan warnings on the server (`planWarnings`
 * over the organization's tasks, events and resources) and stores it only if
 * that warning exists now with exactly the windows the member saw;
 * otherwise 409 with the involved tasks as they are now. Only conflicts can
 * be accepted: reminders (routes A/B/C and Carpa Amarilla, subsoil,
 * resources to check) always stay open. Whether an acceptance still applies
 * is computed by the clients (`acceptanceApplies`): it lapses as soon as one
 * of its tasks moves, and stays as a record.
 *
 * Writes hold the organization's graph lock (moves and hypothesis applies
 * hold it too). The reason is withheld from guests (records/redact.ts); the
 * activity label is the warning title, built from names only.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {supportByOf} from '../http/acting.ts';
import {listEvents} from '../events/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {lockGraph} from '../records/locks.ts';
import {forViewer} from '../records/redact.ts';
import type {Viewer} from '../records/redact.ts';
import {listResources} from '../resources/service.ts';
import {loadTasksByIds, loadTasksForPlan} from '../tasks/service.ts';
import type {CreateAcceptanceBody} from './schemas.ts';
import {
  acceptanceApplies,
  isAcceptable,
  sameWindows,
  windowsFor,
} from '../../../shared/logistics/acceptance.ts';
import {planWarnings} from '../../../shared/logistics/conflicts.ts';
import type {
  AcceptedWindow,
  ConflictAcceptance,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

interface AcceptanceRow {
  id: string;
  organization_id: string;
  warning_key: string;
  windows: unknown;
  reason: string;
  accepted_by: string;
  accepted_by_name: string;
  accepted_at: unknown;
  is_demo: boolean;
  label: string;
  support_by: string | null;
  support_by_name: string | null;
}

const SELECT_ACCEPTANCE = `
  SELECT a.id, a.organization_id, a.warning_key, a.windows, a.reason,
         a.accepted_by, u.display_name AS accepted_by_name, a.accepted_at,
         a.is_demo, a.label, a.support_by, su.display_name AS support_by_name
    FROM conflict_acceptances a
    JOIN users u ON u.id = a.accepted_by
    LEFT JOIN users su ON su.id = a.support_by`;

export const WARNING_GONE =
  'Este aviso ha cambiado o ya no está en el plan: revísalo de nuevo antes de mantener ambas tareas.';
export const NOT_A_CONFLICT =
  'Solo se pueden aceptar conflictos. Los recordatorios (rutas de emergencia, Carpa Amarilla, subsuelo, recursos) siguen a la vista.';
export const ALREADY_ACCEPTED =
  'Este conflicto ya está aceptado con las horas actuales.';

function parseWindows(value: unknown): AcceptedWindow[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list)
    ? list.map(w => {
        const o = w as Record<string, unknown>;
        return {
          taskId: String(o.taskId),
          startsAt: String(o.startsAt),
          endsAt: String(o.endsAt),
        };
      })
    : [];
}

/** The single row → record mapping; the viewer decides what is withheld. */
function toAcceptance(row: AcceptanceRow, viewer: Viewer): ConflictAcceptance {
  return forViewer(
    'acceptance',
    {
      id: row.id,
      organizationId: row.organization_id,
      warningKey: row.warning_key,
      windows: parseWindows(row.windows),
      reason: row.reason,
      acceptedBy: {id: row.accepted_by, displayName: row.accepted_by_name},
      acceptedAt: toIso(row.accepted_at),
      // Safety audit: signed during a support session.
      ...(row.support_by && row.support_by_name !== null
        ? {
            acceptedBySupport: {
              id: row.support_by,
              displayName: row.support_by_name,
            },
          }
        : {}),
    },
    viewer,
  );
}

function acceptanceNotFound(): AppError {
  return notFound(
    'No encontramos esa aceptación: puede que otra persona ya la haya retirado.',
  );
}

/** Newest first. */
export async function listAcceptances(
  db: Queryable,
  organizationId: string,
  viewer: Viewer,
): Promise<ConflictAcceptance[]> {
  const rows = await db.query<AcceptanceRow>(
    `${SELECT_ACCEPTANCE}
      WHERE a.organization_id = $1
      ORDER BY a.accepted_at DESC, a.id DESC`,
    [organizationId],
  );
  return rows.map(r => toAcceptance(r, viewer));
}

async function loadAcceptance(
  db: Queryable,
  id: string,
  lock = false,
): Promise<AcceptanceRow | undefined> {
  const rows = await db.query<AcceptanceRow>(
    `${SELECT_ACCEPTANCE} WHERE a.id = $1${lock ? ' FOR UPDATE OF a' : ''}`,
    [id],
  );
  return rows[0];
}

/**
 * Accepts a conflict warning of the current plan with the windows the
 * member saw (see the file comment for the rules).
 */
export async function createAcceptance(
  db: Db,
  actor: SessionUser,
  input: CreateAcceptanceBody,
  now: Date,
): Promise<ConflictAcceptance> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockGraph(tx, org.id);
    const member = {role: 'member' as const};
    const tasks = await loadTasksForPlan(tx, org.id);
    const warnings = planWarnings(
      tasks,
      await listEvents(tx, org.id, member),
      await listResources(tx, org.id, member),
    );
    const warning = warnings.find(w => w.key === input.warningKey);
    if (warning && !isAcceptable(warning)) {
      throw validationError({warningKey: NOT_A_CONFLICT}, NOT_A_CONFLICT);
    }
    const windows = warning ? windowsFor(warning, tasks) : null;
    if (!warning || !windows || !sameWindows(input.windows, windows)) {
      const own = new Set(tasks.map(t => t.id));
      const involved = [
        ...new Set([
          ...input.windows.map(w => w.taskId),
          ...(warning?.taskIds ?? []),
        ]),
      ].filter(id => own.has(id));
      throw new AppError('VERSION_CONFLICT', WARNING_GONE, {
        current: await loadTasksByIds(tx, org.id, involved, actor),
      });
    }
    const existing = (await listAcceptances(tx, org.id, actor)).find(
      a => a.warningKey === warning.key && acceptanceApplies(a, tasks),
    );
    if (existing) {
      throw new AppError('DUPLICATE', ALREADY_ACCEPTED, {current: existing});
    }

    const isDemo = tasks.some(t => warning.taskIds.includes(t.id) && t.isDemo);
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO conflict_acceptances
         (organization_id, warning_key, windows, reason, accepted_by,
          accepted_at, is_demo, label, support_by)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::timestamptz, $7, $8, $9)
       RETURNING id`,
      [
        org.id,
        warning.key,
        // Stored as the server sees them now (canonical instants, its order).
        JSON.stringify(windows),
        input.reason,
        actor.id,
        now.toISOString(),
        isDemo,
        warning.title.slice(0, 300),
        supportByOf(actor),
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'conflict_acceptance',
      entityId: id,
      entityLabel: warning.title.slice(0, 300),
      action: 'create',
      at: now,
      isDemo,
    });
    return toAcceptance((await loadAcceptance(tx, id)) as AcceptanceRow, actor);
  });
}

/** Withdraws an acceptance: the warning is open again. */
export async function deleteAcceptance(
  db: Db,
  actor: SessionUser,
  id: string,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw acceptanceNotFound();
  await db.transaction(async tx => {
    const unlocked = await loadAcceptance(tx, id);
    if (!unlocked) throw acceptanceNotFound();
    try {
      await requireMembership(tx, actor.id, unlocked.organization_id);
    } catch {
      throw acceptanceNotFound();
    }
    await lockGraph(tx, unlocked.organization_id);
    const row = await loadAcceptance(tx, id, true);
    if (!row) throw acceptanceNotFound();
    await tx.query('DELETE FROM conflict_acceptances WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: row.organization_id,
      userId: actor.id,
      entityType: 'conflict_acceptance',
      entityId: id,
      entityLabel: row.label,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
