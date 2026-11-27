/**
 * Quote requests (Revisión 1 · E6): a concrete need sent to one or more
 * companies, one personal link each. The server never writes to a company:
 * each issued link is returned once, and the UI prepares an e-mail the user
 * sends from their own mail. Only the SHA-256 of a link's token is stored.
 *
 * Requests need `directory.read` (the team can ask for quotes). Writes hold
 * the organization's catalogue lock (they reference companies, offers and
 * categories) and are logged as entityType `quote_request`.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso, toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {hashToken, newToken} from '../auth/sessions.ts';
import {areServiceCategories} from '../categories/service.ts';
import {
  isUuid,
  requireAccess,
  requireMembership,
  checkAccess,
} from '../organizations/service.ts';
import type {Membership} from '../organizations/service.ts';
import {lockCatalogue} from '../records/locks.ts';
import {
  QUOTE_LINK_DAYS_DEFAULT,
  supplierLinkHash,
} from '../../../shared/logistics/proposals.ts';
import type {CreateRequestBody, NeedBody} from '../offer-terms/schemas.ts';
import type {
  IssuedQuoteLink,
  QuoteLinkStatus,
  QuoteRequest,
  QuoteRequestCreated,
  QuoteRequestLink,
  QuoteRequestStatus,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

const DAY_MS = 24 * 60 * 60_000;

export const NO_LINK_BASE =
  'No se puede preparar el enlace: abre el Gestor desde su dirección web y vuelve a intentarlo.';
const COMPANIES_UNKNOWN =
  'Alguna empresa ya no existe o no es de esta organización.';
const CATEGORY_UNKNOWN =
  'Esa categoría ya no existe o no es de servicios de esta organización.';
const EVENT_UNKNOWN = 'Ese evento ya no existe en esta organización.';
const OFFER_UNKNOWN = 'Esa oferta ya no existe en esta organización.';

interface RequestRow {
  id: string;
  organization_id: string;
  title: string;
  category_id: string | null;
  quantity: string;
  unit_label: string | null;
  days: number;
  hours_per_day: string | null;
  date_from: string | null;
  date_to: string | null;
  note: string | null;
  event_id: string | null;
  offer_id: string | null;
  status: QuoteRequestStatus;
  created_by: string;
  created_by_name: string;
  created_at: unknown;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: unknown;
  version: number;
}

interface LinkRow {
  id: string;
  request_id: string;
  company_id: string | null;
  company_name: string;
  status: QuoteLinkStatus;
  expires_at: unknown;
  opened_at: unknown;
  answered_at: unknown;
  decline_reason: string | null;
  proposal_id: string | null;
}

const SELECT_REQUEST = `
  SELECT r.id, r.organization_id, r.title, r.category_id, r.quantity::text AS quantity,
         r.unit_label, r.days, r.hours_per_day::text AS hours_per_day,
         r.date_from::text AS date_from, r.date_to::text AS date_to, r.note,
         r.event_id, r.offer_id, r.status, r.created_by,
         cb.display_name AS created_by_name, r.created_at, r.closed_by,
         xb.display_name AS closed_by_name, r.closed_at, r.version
    FROM quote_requests r
    JOIN users cb ON cb.id = r.created_by
    LEFT JOIN users xb ON xb.id = r.closed_by`;

const SELECT_LINKS = `
  SELECT l.id, l.request_id, l.company_id, l.company_name, l.status,
         l.expires_at, l.opened_at, l.answered_at, l.decline_reason,
         p.id AS proposal_id
    FROM quote_request_links l
    LEFT JOIN proposals p ON p.link_id = l.id`;

function toLink(row: LinkRow, now: Date): QuoteRequestLink {
  const expiresAt = toIso(row.expires_at);
  return {
    id: row.id,
    company: {id: row.company_id, name: row.company_name},
    status: row.status,
    expiresAt,
    expired: Date.parse(expiresAt) <= now.getTime(),
    openedAt: toIsoOrNull(row.opened_at),
    answeredAt: toIsoOrNull(row.answered_at),
    declineReason: row.decline_reason,
    proposalId: row.proposal_id,
  };
}

function toRequest(row: RequestRow, links: LinkRow[], now: Date): QuoteRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    need: {
      title: row.title,
      categoryId: row.category_id,
      quantity: Number(row.quantity),
      unitLabel: row.unit_label,
      days: Number(row.days),
      hoursPerDay:
        row.hours_per_day === null ? null : Number(row.hours_per_day),
      dateFrom: row.date_from,
      dateTo: row.date_to,
      note: row.note,
    },
    eventId: row.event_id,
    offerId: row.offer_id,
    status: row.status,
    links: links.filter(l => l.request_id === row.id).map(l => toLink(l, now)),
    createdBy: {id: row.created_by, displayName: row.created_by_name},
    createdAt: toIso(row.created_at),
    closedBy:
      row.closed_by && row.closed_by_name
        ? {id: row.closed_by, displayName: row.closed_by_name}
        : null,
    closedAt: toIsoOrNull(row.closed_at),
    version: Number(row.version),
  };
}

async function loadLinks(
  q: Queryable,
  requestIds: string[],
): Promise<LinkRow[]> {
  if (requestIds.length === 0) return [];
  return q.query<LinkRow>(
    `${SELECT_LINKS}
      WHERE l.request_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))
      ORDER BY lower(l.company_name), l.id`,
    [JSON.stringify(requestIds)],
  );
}

export async function loadRequest(
  q: Queryable,
  id: string,
  now: Date,
): Promise<QuoteRequest | undefined> {
  const row = (
    await q.query<RequestRow>(`${SELECT_REQUEST} WHERE r.id = $1`, [id])
  )[0];
  if (!row) return undefined;
  return toRequest(row, await loadLinks(q, [id]), now);
}

/** Newest first. */
export async function listRequests(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
  now: Date,
): Promise<QuoteRequest[]> {
  const org = await requireAccess(db, user, organizationId, 'directory.read');
  const rows = await db.query<RequestRow>(
    `${SELECT_REQUEST} WHERE r.organization_id = $1
      ORDER BY r.created_at DESC, r.id`,
    [org.id],
  );
  const links = await loadLinks(
    db,
    rows.map(r => r.id),
  );
  return rows.map(r => toRequest(r, links, now));
}

function requestNotFound(): AppError {
  return notFound('No encontramos esa solicitud: puede que se haya eliminado.');
}

/** The request, if the user may work with it (directory.read); 404 if foreign. */
async function loadOwnRequest(
  tx: Queryable,
  user: SessionUser,
  id: string,
): Promise<{row: RequestRow; org: Membership}> {
  if (!isUuid(id)) throw requestNotFound();
  const row = (
    await tx.query<RequestRow>(`${SELECT_REQUEST} WHERE r.id = $1`, [id])
  )[0];
  if (!row) throw requestNotFound();
  let org: Membership;
  try {
    org = await requireMembership(tx, user.id, row.organization_id);
  } catch {
    throw requestNotFound();
  }
  checkAccess(org, user, 'directory.read');
  return {row, org};
}

async function checkNeedRefs(
  tx: Queryable,
  organizationId: string,
  refs: {need: NeedBody; eventId: string | null; offerId: string | null},
): Promise<void> {
  const fields: Record<string, string> = {};
  if (
    refs.need.categoryId &&
    !(await areServiceCategories(tx, organizationId, [refs.need.categoryId]))
  ) {
    fields['need.categoryId'] = CATEGORY_UNKNOWN;
  }
  const exists = async (table: 'events' | 'offers', id: string) =>
    (
      await tx.query(
        `SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      )
    ).length > 0;
  if (refs.eventId && !(await exists('events', refs.eventId))) {
    fields.eventId = EVENT_UNKNOWN;
  }
  if (refs.offerId && !(await exists('offers', refs.offerId))) {
    fields.offerId = OFFER_UNKNOWN;
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

interface CompanyContact {
  id: string;
  name: string;
  email: string | null;
}

async function loadCompanies(
  tx: Queryable,
  organizationId: string,
  ids: string[],
): Promise<CompanyContact[]> {
  const rows = await tx.query<CompanyContact>(
    `SELECT id, name, email FROM companies
      WHERE organization_id = $1
        AND id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))
      ORDER BY lower(name), id`,
    [organizationId, JSON.stringify(ids)],
  );
  if (rows.length !== ids.length) {
    throw validationError({companyIds: COMPANIES_UNKNOWN});
  }
  return rows;
}

/** Inserts (or replaces the token of) one company's link; returns it as issued. */
async function issueLink(
  tx: Queryable,
  args: {
    organizationId: string;
    requestId: string;
    company: CompanyContact;
    linkDays: number;
    actorId: string;
    now: Date;
    base: string;
  },
): Promise<IssuedQuoteLink> {
  const token = newToken();
  const expiresAt = new Date(args.now.getTime() + args.linkDays * DAY_MS);
  const rows = await tx.query<{id: string}>(
    `INSERT INTO quote_request_links
       (organization_id, request_id, company_id, company_name, token_hash,
        expires_at, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::timestamptz)
     ON CONFLICT (request_id, company_id) WHERE company_id IS NOT NULL
     DO UPDATE SET token_hash = EXCLUDED.token_hash,
                   expires_at = EXCLUDED.expires_at,
                   created_at = EXCLUDED.created_at,
                   status = CASE WHEN quote_request_links.status IN ('waiting', 'revoked')
                                 THEN 'waiting' ELSE quote_request_links.status END
     RETURNING id`,
    [
      args.organizationId,
      args.requestId,
      args.company.id,
      args.company.name,
      hashToken(token),
      expiresAt.toISOString(),
      args.actorId,
      args.now.toISOString(),
    ],
  );
  return {
    linkId: (rows[0] as {id: string}).id,
    company: args.company,
    url: `${args.base}/${supplierLinkHash(token)}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function createRequest(
  db: Db,
  user: SessionUser,
  body: CreateRequestBody,
  now: Date,
  base: string | null,
): Promise<QuoteRequestCreated> {
  return db.transaction(async tx => {
    const org = await requireAccess(
      tx,
      user,
      body.organizationId,
      'directory.read',
    );
    if (!base) throw new AppError('VALIDATION', NO_LINK_BASE);
    await lockCatalogue(tx, org.id);
    await checkNeedRefs(tx, org.id, body);
    const companies = await loadCompanies(tx, org.id, body.companyIds);
    const n = body.need;
    const id = (
      (
        await tx.query<{id: string}>(
          `INSERT INTO quote_requests
             (organization_id, title, category_id, quantity, unit_label, days,
              hours_per_day, date_from, date_to, note, event_id, offer_id,
              created_by, created_at)
           VALUES ($1, $2, $3, $4::numeric, $5, $6, $7::numeric, $8::date,
                   $9::date, $10, $11, $12, $13, $14::timestamptz)
           RETURNING id`,
          [
            org.id,
            n.title,
            n.categoryId,
            n.quantity,
            n.unitLabel,
            n.days,
            n.hoursPerDay,
            n.dateFrom,
            n.dateTo,
            n.note,
            body.eventId,
            body.offerId,
            user.id,
            now.toISOString(),
          ],
        )
      )[0] as {id: string}
    ).id;
    const links: IssuedQuoteLink[] = [];
    for (const company of companies) {
      links.push(
        await issueLink(tx, {
          organizationId: org.id,
          requestId: id,
          company,
          linkDays: body.linkDays ?? QUOTE_LINK_DAYS_DEFAULT,
          actorId: user.id,
          now,
          base,
        }),
      );
    }
    await appendActivity(tx, {
      organizationId: org.id,
      userId: user.id,
      entityType: 'quote_request',
      entityId: id,
      entityLabel: n.title,
      action: 'create',
      at: now,
    });
    return {request: (await loadRequest(tx, id, now)) as QuoteRequest, links};
  });
}

/** Personal links for more companies (or new ones for the same companies). */
export async function addLinks(
  db: Db,
  user: SessionUser,
  id: string,
  body: {companyIds: string[]; linkDays?: number},
  now: Date,
  base: string | null,
): Promise<QuoteRequestCreated> {
  return db.transaction(async tx => {
    const {row, org} = await loadOwnRequest(tx, user, id);
    if (!base) throw new AppError('VALIDATION', NO_LINK_BASE);
    await lockCatalogue(tx, org.id);
    if (row.status === 'closed') {
      throw new AppError(
        'VALIDATION',
        'La solicitud está cerrada: crea una nueva.',
      );
    }
    const companies = await loadCompanies(tx, org.id, body.companyIds);
    const answered = await tx.query<{company_id: string}>(
      `SELECT company_id FROM quote_request_links
        WHERE request_id = $1 AND status NOT IN ('waiting', 'revoked')
          AND company_id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))`,
      [id, JSON.stringify(body.companyIds)],
    );
    if (answered.length > 0) {
      throw validationError({
        companyIds:
          'Alguna de esas empresas ya ha respondido a esta solicitud: su enlace no se puede renovar.',
      });
    }
    const links: IssuedQuoteLink[] = [];
    for (const company of companies) {
      links.push(
        await issueLink(tx, {
          organizationId: org.id,
          requestId: id,
          company,
          linkDays: body.linkDays ?? QUOTE_LINK_DAYS_DEFAULT,
          actorId: user.id,
          now,
          base,
        }),
      );
    }
    await tx.query(
      'UPDATE quote_requests SET version = version + 1 WHERE id = $1',
      [id],
    );
    await appendActivity(tx, {
      organizationId: org.id,
      userId: user.id,
      entityType: 'quote_request',
      entityId: id,
      entityLabel: row.title,
      action: 'update',
      changedFields: ['links'],
      at: now,
    });
    return {request: (await loadRequest(tx, id, now)) as QuoteRequest, links};
  });
}

/** A new token for one link (the old address stops working at once). */
export async function renewLink(
  db: Db,
  user: SessionUser,
  id: string,
  linkId: string,
  body: {linkDays?: number},
  now: Date,
  base: string | null,
): Promise<QuoteRequestCreated> {
  if (!isUuid(linkId)) throw notFound('No encontramos ese enlace.');
  const companyId = (
    await db.query<{company_id: string | null}>(
      'SELECT company_id FROM quote_request_links WHERE id = $1 AND request_id = $2',
      [linkId, isUuid(id) ? id : null],
    )
  )[0];
  if (!companyId) throw notFound('No encontramos ese enlace.');
  if (!companyId.company_id) {
    throw new AppError(
      'VALIDATION',
      'Esa empresa ya no está en el catálogo: no se puede renovar su enlace.',
    );
  }
  return addLinks(
    db,
    user,
    id,
    {companyIds: [companyId.company_id], ...body},
    now,
    base,
  );
}

/** Closes the request: links still waiting stop working. */
export async function closeRequest(
  db: Db,
  user: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<QuoteRequest> {
  return db.transaction(async tx => {
    const {row, org} = await loadOwnRequest(tx, user, id);
    await lockCatalogue(tx, org.id);
    const fresh = (
      await tx.query<{version: number; status: string}>(
        'SELECT version, status FROM quote_requests WHERE id = $1 FOR UPDATE',
        [id],
      )
    )[0] as {version: number; status: string};
    if (Number(fresh.version) !== version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado esta solicitud. Revisa la versión actual.',
        {current: await loadRequest(tx, id, now)},
      );
    }
    if (fresh.status === 'closed')
      {return (await loadRequest(tx, id, now)) as QuoteRequest;}
    await tx.query(
      `UPDATE quote_requests
          SET status = 'closed', closed_by = $2, closed_at = $3::timestamptz,
              version = version + 1
        WHERE id = $1`,
      [id, user.id, now.toISOString()],
    );
    await tx.query(
      `UPDATE quote_request_links SET status = 'revoked'
        WHERE request_id = $1 AND status = 'waiting'`,
      [id],
    );
    await appendActivity(tx, {
      organizationId: org.id,
      userId: user.id,
      entityType: 'quote_request',
      entityId: id,
      entityLabel: row.title,
      action: 'update',
      changedFields: ['status'],
      at: now,
    });
    return (await loadRequest(tx, id, now)) as QuoteRequest;
  });
}
