/**
 * Offer settings and renegotiation tasks (Revisión 1 · E6).
 *
 * Settings (per organization): the renewal notice (15/30/60/90 days, 30 by
 * default) and the open «presentar oferta» link (off by default; only its
 * hash is stored; enabling or rotating it shows the address once).
 *
 * Renewals: from `noticeDays` before a version's acceptance deadline until
 * the deadline itself, Ox Eye creates one ordinary task without event
 * («Renegociar oferta con …», company = the offer's, date = the deadline),
 * written by the inactive «Sistema» author and marked by an `offer_renewals`
 * row («Generada por Ox Eye») that holds the assignee: whoever approved the
 * version, changeable by administrators. At most one per version (unique
 * key, checked under the catalogue lock), so running it again creates
 * nothing; a task deleted by somebody is not created again. Approving a
 * newer version resolves the renewal and marks its open task done.
 * Generation runs at server start, every hour, and on demand (route).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso, toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {hashToken, newToken} from '../auth/sessions.ts';
import {
  checkAccess,
  isUuid,
  requireAccess,
  requireMembership,
} from '../organizations/service.ts';
import {lockCatalogue} from '../records/locks.ts';
import {ensureSystemUser} from '../seed/seed.ts';
import {localToday} from './versions.ts';
import {
  DEFAULT_RENEWAL_NOTICE_DAYS,
  renewalStart,
} from '../../../shared/logistics/offer-terms.ts';
import {openOfferLinkHash} from '../../../shared/logistics/proposals.ts';
import type {
  OfferRenewal,
  OfferSettings,
  OfferSettingsResponse,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

// ---------------------------------------------------------------- settings

interface SettingsRow {
  renewal_notice_days: number;
  open_link_created_at: unknown;
  version: number;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: unknown;
}

async function settingsRow(
  q: Queryable,
  organizationId: string,
  lock = false,
): Promise<SettingsRow | undefined> {
  return (
    await q.query<SettingsRow>(
      `SELECT s.renewal_notice_days, s.open_link_created_at, s.version,
              s.updated_by, u.display_name AS updated_by_name, s.updated_at
         FROM offer_settings s LEFT JOIN users u ON u.id = s.updated_by
        WHERE s.organization_id = $1${lock ? ' FOR UPDATE OF s' : ''}`,
      [organizationId],
    )
  )[0];
}

function toSettings(
  organizationId: string,
  row: SettingsRow | undefined,
): OfferSettings {
  if (!row) {
    return {
      organizationId,
      renewalNoticeDays: DEFAULT_RENEWAL_NOTICE_DAYS,
      openLink: {enabled: false, createdAt: null},
      version: 0,
      updatedBy: null,
      updatedAt: null,
    };
  }
  return {
    organizationId,
    renewalNoticeDays: Number(row.renewal_notice_days),
    openLink: {
      enabled: row.open_link_created_at != null,
      createdAt: toIsoOrNull(row.open_link_created_at),
    },
    version: Number(row.version),
    updatedBy:
      row.updated_by && row.updated_by_name
        ? {id: row.updated_by, displayName: row.updated_by_name}
        : null,
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function getSettings(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
): Promise<OfferSettings> {
  const org = await requireAccess(db, user, organizationId, 'directory.read');
  return toSettings(org.id, await settingsRow(db, org.id));
}

/** Administrators only (`offers.approve`). */
export async function updateSettings(
  db: Db,
  user: SessionUser,
  organizationId: string,
  body: {
    version: number;
    renewalNoticeDays?: number;
    openLinkEnabled?: boolean;
    rotateOpenLink?: boolean;
  },
  now: Date,
  base: string | null,
): Promise<OfferSettingsResponse> {
  return db.transaction(async tx => {
    const org = await requireAccess(tx, user, organizationId, 'offers.approve');
    await lockCatalogue(tx, org.id);
    const row = await settingsRow(tx, org.id, true);
    const current = toSettings(org.id, row);
    if (current.version !== body.version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado estos ajustes. Revisa los actuales.',
        {current},
      );
    }
    const enable = body.openLinkEnabled ?? current.openLink.enabled;
    const issue =
      enable && (!current.openLink.enabled || body.rotateOpenLink === true);
    if (body.rotateOpenLink && !enable) {
      throw validationError({
        rotateOpenLink: 'Activa el enlace abierto antes de cambiarlo.',
      });
    }
    if (issue && !base) {
      throw new AppError(
        'VALIDATION',
        'No se puede preparar el enlace: abre el Gestor desde su dirección web y vuelve a intentarlo.',
      );
    }
    const token = issue ? newToken() : null;
    const notice = body.renewalNoticeDays ?? current.renewalNoticeDays;
    const linkHash = token ? hashToken(token) : undefined;
    await tx.query(
      `INSERT INTO offer_settings
         (organization_id, renewal_notice_days, open_link_hash, open_link_created_at,
          version, updated_by, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, 1, $5, $6::timestamptz)
       ON CONFLICT (organization_id) DO UPDATE
         SET renewal_notice_days = EXCLUDED.renewal_notice_days,
             open_link_hash = CASE WHEN $7::boolean THEN EXCLUDED.open_link_hash
                                   ELSE offer_settings.open_link_hash END,
             open_link_created_at = CASE WHEN $7::boolean THEN EXCLUDED.open_link_created_at
                                         ELSE offer_settings.open_link_created_at END,
             version = offer_settings.version + 1,
             updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [
        org.id,
        notice,
        enable ? (linkHash ?? null) : null,
        enable && linkHash ? now.toISOString() : null,
        user.id,
        now.toISOString(),
        // Replace the link columns when a link is issued or turned off.
        issue || !enable,
      ],
    );
    await appendActivity(tx, {
      organizationId: org.id,
      userId: user.id,
      entityType: 'offer_settings',
      entityId: org.id,
      entityLabel: 'Ajustes de ofertas',
      action: 'update',
      changedFields: [
        ...(notice !== current.renewalNoticeDays ? ['renewalNoticeDays'] : []),
        ...(issue || enable !== current.openLink.enabled ? ['openLink'] : []),
      ],
      at: now,
    });
    return {
      settings: toSettings(org.id, await settingsRow(tx, org.id)),
      openLinkUrl: token && base ? `${base}/${openOfferLinkHash(token)}` : null,
    };
  });
}

/** The organization of an open-form token, while the link is on. */
export async function findOpenForm(
  q: Queryable,
  token: string,
): Promise<{organizationId: string; name: string; timezone: string} | null> {
  const row = (
    await q.query<{organization_id: string; name: string; timezone: string}>(
      `SELECT s.organization_id, o.name, o.timezone
         FROM offer_settings s JOIN organizations o ON o.id = s.organization_id
        WHERE s.open_link_hash = $1`,
      [hashToken(token)],
    )
  )[0];
  return row
    ? {
        organizationId: row.organization_id,
        name: row.name,
        timezone: row.timezone,
      }
    : null;
}

// ---------------------------------------------------------------- renewals

interface RenewalRow {
  id: string;
  organization_id: string;
  task_id: string | null;
  offer_id: string;
  offer_name: string;
  company_id: string;
  company_name: string;
  version_number: number;
  accept_until: string;
  notice_days: number;
  assignee_id: string | null;
  assignee_name: string | null;
  generated_at: unknown;
  resolved_at: unknown;
  resolved_number: number | null;
  version: number;
}

const SELECT_RENEWAL = `
  SELECT r.id, r.organization_id, r.task_id, o.id AS offer_id, o.name AS offer_name,
         c.id AS company_id, c.name AS company_name, v.number AS version_number,
         r.accept_until::text AS accept_until, r.notice_days, r.assignee_id,
         a.display_name AS assignee_name, r.generated_at, r.resolved_at,
         rv.number AS resolved_number, r.version
    FROM offer_renewals r
    JOIN offer_versions v ON v.id = r.offer_version_id
    JOIN offers o ON o.id = v.offer_id
    JOIN companies c ON c.id = o.company_id
    LEFT JOIN users a ON a.id = r.assignee_id
    LEFT JOIN offer_versions rv ON rv.id = r.resolved_by_version_id`;

function toRenewal(row: RenewalRow): OfferRenewal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    taskId: row.task_id,
    offer: {id: row.offer_id, name: row.offer_name},
    company: {id: row.company_id, name: row.company_name},
    versionNumber: Number(row.version_number),
    acceptUntil: row.accept_until,
    noticeDays: Number(row.notice_days),
    assignee:
      row.assignee_id && row.assignee_name
        ? {id: row.assignee_id, displayName: row.assignee_name}
        : null,
    generatedBy: 'ox_eye',
    generatedAt: toIso(row.generated_at),
    resolvedAt: toIsoOrNull(row.resolved_at),
    resolvedByVersion:
      row.resolved_number === null ? null : Number(row.resolved_number),
    version: Number(row.version),
  };
}

/** Deadline first. */
export async function listRenewals(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
): Promise<OfferRenewal[]> {
  const org = await requireAccess(db, user, organizationId, 'directory.read');
  const rows = await db.query<RenewalRow>(
    `${SELECT_RENEWAL} WHERE r.organization_id = $1 ORDER BY r.accept_until, r.id`,
    [org.id],
  );
  return rows.map(toRenewal);
}

function renewalNotFound(): AppError {
  return notFound(
    'No encontramos esa renegociación: puede que la oferta se haya eliminado.',
  );
}

/** Administrators reassign a renegotiation (or leave it unassigned). */
export async function updateRenewal(
  db: Db,
  user: SessionUser,
  id: string,
  body: {version: number; assigneeId: string | null},
  now: Date,
): Promise<OfferRenewal> {
  if (!isUuid(id)) throw renewalNotFound();
  return db.transaction(async tx => {
    const found = (
      await tx.query<{organization_id: string}>(
        'SELECT organization_id FROM offer_renewals WHERE id = $1',
        [id],
      )
    )[0];
    if (!found) throw renewalNotFound();
    let org;
    try {
      org = await requireMembership(tx, user.id, found.organization_id);
    } catch {
      throw renewalNotFound();
    }
    checkAccess(org, user, 'offers.approve');
    await lockCatalogue(tx, org.id);
    const row = (
      await tx.query<RenewalRow>(
        `${SELECT_RENEWAL} WHERE r.id = $1 FOR UPDATE OF r`,
        [id],
      )
    )[0] as RenewalRow;
    if (Number(row.version) !== body.version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado esta renegociación. Revisa la actual.',
        {current: toRenewal(row)},
      );
    }
    if (body.assigneeId) {
      const member = await tx.query(
        `SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.user_id = $2
            AND u.role <> 'guest' AND u.is_active`,
        [org.id, body.assigneeId],
      );
      if (member.length === 0) {
        throw validationError({
          assigneeId:
            'Elige a una persona de la organización (no la cuenta Invitado).',
        });
      }
    }
    await tx.query(
      `UPDATE offer_renewals
          SET assignee_id = $2, version = version + 1, updated_by = $3,
              updated_at = $4::timestamptz
        WHERE id = $1`,
      [id, body.assigneeId, user.id, now.toISOString()],
    );
    await appendActivity(tx, {
      organizationId: org.id,
      userId: user.id,
      entityType: 'offer_renewal',
      entityId: id,
      entityLabel: row.company_name,
      action: 'update',
      changedFields: ['assignee'],
      at: now,
    });
    return toRenewal(
      (
        await tx.query<RenewalRow>(`${SELECT_RENEWAL} WHERE r.id = $1`, [id])
      )[0] as RenewalRow,
    );
  });
}

const OPEN_TASK = ['planned', 'confirmed', 'in_progress', 'delayed'];

/**
 * A newer version was approved: the previous version's renewal is resolved
 * and its task, if still open, marked done (logged as the approver's).
 */
export async function resolveRenewals(
  tx: Queryable,
  args: {
    previousVersionId: string;
    newVersionId: string;
    actorId: string;
    now: Date;
  },
): Promise<void> {
  const rows = await tx.query<{task_id: string | null}>(
    `UPDATE offer_renewals
        SET resolved_at = $3::timestamptz, resolved_by_version_id = $2,
            version = version + 1
      WHERE offer_version_id = $1 AND resolved_at IS NULL
      RETURNING task_id`,
    [args.previousVersionId, args.newVersionId, args.now.toISOString()],
  );
  for (const r of rows) {
    if (!r.task_id) continue;
    const done = await tx.query<{
      id: string;
      organization_id: string;
      title: string;
      is_demo: boolean;
    }>(
      `UPDATE tasks SET status = 'done', version = version + 1, updated_by = $2,
              updated_at = $3::timestamptz
        WHERE id = $1 AND status IN (SELECT value FROM jsonb_array_elements_text($4::jsonb))
        RETURNING id, organization_id, title, is_demo`,
      [
        r.task_id,
        args.actorId,
        args.now.toISOString(),
        JSON.stringify(OPEN_TASK),
      ],
    );
    for (const t of done) {
      await appendActivity(tx, {
        organizationId: t.organization_id,
        userId: args.actorId,
        entityType: 'task',
        entityId: t.id,
        entityLabel: t.title,
        action: 'update',
        changedFields: ['status'],
        at: args.now,
        isDemo: t.is_demo,
      });
    }
  }
}

interface CandidateRow {
  version_id: string;
  number: number;
  accept_until: string;
  approved_by: string | null;
  offer_name: string;
  company_id: string;
  company_name: string;
  is_demo: boolean;
}

const dateLabel = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const month = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ][m - 1];
  return `${day} de ${month} de ${y}`;
};

/** Creates the renegotiation tasks due today in one organization. */
async function generateFor(
  db: Db,
  org: {id: string; timezone: string},
  now: Date,
): Promise<number> {
  return db.transaction(async tx => {
    await lockCatalogue(tx, org.id);
    const today = localToday(now, org.timezone);
    const notice = Number(
      (await settingsRow(tx, org.id))?.renewal_notice_days ??
        DEFAULT_RENEWAL_NOTICE_DAYS,
    );
    const due = await tx.query<CandidateRow>(
      `SELECT v.id AS version_id, v.number, v.accept_until::text AS accept_until,
              v.approved_by, o.name AS offer_name, c.id AS company_id,
              c.name AS company_name, o.is_demo
         FROM offer_versions v
         JOIN offers o ON o.id = v.offer_id
         JOIN companies c ON c.id = o.company_id
        WHERE v.organization_id = $1 AND v.superseded_at IS NULL
          AND v.accept_until IS NOT NULL
          AND v.accept_until >= $2::date
          AND v.accept_until - $3::integer <= $2::date
          AND NOT EXISTS (SELECT 1 FROM offer_renewals r WHERE r.offer_version_id = v.id)
        ORDER BY v.accept_until, v.id`,
      [org.id, today, notice],
    );
    if (due.length === 0) return 0;
    const systemId = await ensureSystemUser(tx, now);
    for (const d of due) {
      const title = `Renegociar oferta con ${d.company_name}`.slice(0, 200);
      const notes =
        `Oferta «${d.offer_name}» (versión ${d.number}): se puede aceptar hasta el ${dateLabel(d.accept_until)}. ` +
        `Generada por Ox Eye ${notice} días antes del vencimiento (desde el ${dateLabel(renewalStart(d.accept_until, notice))}).`;
      const task = (
        await tx.query<{id: string}>(
          `INSERT INTO tasks
             (organization_id, company_id, title, kind, status, local_date,
              timezone, notes, source, verification, is_demo,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1, $2, $3, 'other', 'planned', $4::date, $5, $6, 'document',
                   'validated', $7, $8, $9::timestamptz, $8, $9::timestamptz)
           RETURNING id`,
          [
            org.id,
            d.company_id,
            title,
            d.accept_until,
            org.timezone,
            notes.slice(0, 5000),
            d.is_demo,
            systemId,
            now.toISOString(),
          ],
        )
      )[0] as {id: string};
      await tx.query(
        `INSERT INTO offer_renewals
           (organization_id, offer_version_id, task_id, accept_until, notice_days,
            assignee_id, generated_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7::timestamptz)`,
        [
          org.id,
          d.version_id,
          task.id,
          d.accept_until,
          notice,
          d.approved_by,
          now.toISOString(),
        ],
      );
      await appendActivity(tx, {
        organizationId: org.id,
        userId: systemId,
        entityType: 'task',
        entityId: task.id,
        entityLabel: title,
        action: 'create',
        at: now,
        isDemo: d.is_demo,
      });
    }
    return due.length;
  });
}

/** Every organization (or one): the number of tasks created. */
export async function generateRenewals(
  db: Db,
  now: Date,
  organizationId?: string,
): Promise<number> {
  const orgs = await db.query<{id: string; timezone: string}>(
    `SELECT id, timezone FROM organizations
      WHERE $1::uuid IS NULL OR id = $1::uuid ORDER BY id`,
    [organizationId ?? null],
  );
  let created = 0;
  for (const org of orgs) created += await generateFor(db, org, now);
  return created;
}

/** On demand (administrators): `{created}`. */
export async function runRenewals(
  db: Db,
  user: SessionUser,
  organizationId: string,
  now: Date,
): Promise<{created: number}> {
  const org = await requireAccess(db, user, organizationId, 'offers.approve');
  return {created: await generateRenewals(db, now, org.id)};
}

export const RENEWAL_INTERVAL_MS = 60 * 60_000;

/**
 * Runs the generation now and every `intervalMs` (no external scheduler).
 * Failures are logged (no personal data) and retried at the next tick.
 * Returns a function that stops the timer.
 */
export function startRenewalTimer(
  db: Db,
  log: (line: string) => void,
  now: () => Date = () => new Date(),
  intervalMs = RENEWAL_INTERVAL_MS,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const created = await generateRenewals(db, now());
      if (created > 0) {
        log(
          `Renegociaciones: ${created} ${created === 1 ? 'tarea nueva generada' : 'tareas nuevas generadas'} por Ox Eye.`,
        );
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log(
        `Renegociaciones: no se pudieron generar (${e.name}); se reintenta en la próxima hora.`,
      );
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
