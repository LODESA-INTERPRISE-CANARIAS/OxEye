/**
 * The supplier's side (Revisión 1 · E7), without an account. A personal
 * link reaches exactly one request of one company: the answer holds only
 * that request's need, the company's name and the organization's name. An
 * unknown, expired, replaced or closed link gets the same 404 after the same
 * single lookup. Whatever arrives enters the inbox as a pending proposal;
 * nothing a company sends is ever shown to another one.
 *
 * The open «presentar oferta» form exists only while an administrator keeps
 * its link on (off by default).
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {hashToken} from '../auth/sessions.ts';
import {lockCatalogue} from '../records/locks.ts';
import {ensureSystemUser} from '../seed/seed.ts';
import {findOpenForm} from '../offer-terms/renewals.ts';
import type {ProposalBody} from '../offer-terms/schemas.ts';
import {localToday} from '../offer-terms/versions.ts';
import {deadlineProblem, insertProposal, toContent} from './proposals.ts';
import {
  LINK_TOKEN_RE,
  SUPPLIER_PRIVACY_VERSION,
} from '../../../shared/logistics/proposals.ts';
import type {
  PublicOpenForm,
  PublicProposalReceipt,
  PublicQuoteRequest,
  QuoteLinkStatus,
} from '../../../shared/logistics/contracts.ts';

/** One message for every link that does not work (never says why). */
export const LINK_GONE =
  'Este enlace no funciona: puede que haya caducado o que ya no sea válido. Pide uno nuevo a quien te lo envió.';
const ALREADY =
  'Ya has respondido a esta solicitud por este enlace. Si quieres cambiar algo, escribe a quien te lo envió.';

interface LinkLookupRow {
  link_id: string;
  link_status: QuoteLinkStatus;
  expires_at: unknown;
  opened_at: unknown;
  company_name: string;
  request_id: string;
  request_status: 'open' | 'closed';
  title: string;
  quantity: string;
  unit_label: string | null;
  days: number;
  hours_per_day: string | null;
  date_from: string | null;
  date_to: string | null;
  note: string | null;
  offer_id: string | null;
  category_name: string | null;
  organization_id: string;
  organization_name: string;
  timezone: string;
}

/** The working link for a token, or null (same path for every failure). */
async function lookup(
  q: Queryable,
  token: string,
  now: Date,
  lock = false,
): Promise<LinkLookupRow | null> {
  // A malformed token still costs one lookup, so timing says nothing.
  const hash = hashToken(LINK_TOKEN_RE.test(token) ? token : `x${token}`);
  const row = (
    await q.query<LinkLookupRow>(
      `SELECT l.id AS link_id, l.status AS link_status, l.expires_at, l.opened_at,
              l.company_name, r.id AS request_id, r.status AS request_status,
              r.title, r.quantity::text AS quantity, r.unit_label, r.days,
              r.hours_per_day::text AS hours_per_day, r.date_from::text AS date_from,
              r.date_to::text AS date_to, r.note, r.offer_id, k.name AS category_name,
              o.id AS organization_id, o.name AS organization_name, o.timezone
         FROM quote_request_links l
         JOIN quote_requests r ON r.id = l.request_id
         JOIN organizations o ON o.id = l.organization_id
         LEFT JOIN categories k ON k.id = r.category_id
        WHERE l.token_hash = $1${lock ? ' FOR UPDATE OF l' : ''}`,
      [hash],
    )
  )[0];
  if (!row || !LINK_TOKEN_RE.test(token)) return null;
  if (row.link_status === 'revoked' || row.request_status === 'closed')
    {return null;}
  if (Date.parse(toIso(row.expires_at)) <= now.getTime()) return null;
  return row;
}

function publicStatus(s: QuoteLinkStatus): PublicQuoteRequest['status'] {
  if (s === 'waiting') return 'open';
  return s === 'declined' ? 'declined' : 'answered';
}

export async function readPublicRequest(
  db: Db,
  token: string,
  now: Date,
): Promise<PublicQuoteRequest> {
  const row = await lookup(db, token, now);
  if (!row) throw notFound(LINK_GONE);
  if (row.opened_at == null) {
    await db.query(
      'UPDATE quote_request_links SET opened_at = $2::timestamptz WHERE id = $1 AND opened_at IS NULL',
      [row.link_id, now.toISOString()],
    );
  }
  return {
    organization: {name: row.organization_name},
    company: {name: row.company_name},
    need: {
      title: row.title,
      categoryName: row.category_name,
      quantity: Number(row.quantity),
      unitLabel: row.unit_label,
      days: Number(row.days),
      hoursPerDay:
        row.hours_per_day === null ? null : Number(row.hours_per_day),
      dateFrom: row.date_from,
      dateTo: row.date_to,
      note: row.note,
    },
    expiresAt: toIso(row.expires_at),
    status: publicStatus(row.link_status),
  };
}

async function logReceived(
  tx: Queryable,
  args: {
    organizationId: string;
    proposalId: string;
    companyName: string;
    now: Date;
  },
): Promise<void> {
  // A public submission has no account: «Sistema» signs the activity entry.
  const systemId = await ensureSystemUser(tx, args.now);
  await appendActivity(tx, {
    organizationId: args.organizationId,
    userId: systemId,
    entityType: 'proposal',
    entityId: args.proposalId,
    entityLabel: args.companyName,
    action: 'create',
    at: args.now,
  });
}

/** A company answers its request: a pending proposal (one per link). */
export async function submitByLink(
  db: Db,
  token: string,
  body: ProposalBody,
  now: Date,
): Promise<PublicProposalReceipt> {
  return db.transaction(async tx => {
    const peek = await lookup(tx, token, now);
    if (!peek) throw notFound(LINK_GONE);
    await lockCatalogue(tx, peek.organization_id);
    const row = await lookup(tx, token, now, true);
    if (!row) throw notFound(LINK_GONE);
    if (row.link_status !== 'waiting')
      {throw new AppError('VALIDATION', ALREADY);}
    const problems = deadlineProblem(
      body.acceptUntil,
      localToday(now, row.timezone),
    );
    if (Object.keys(problems).length > 0) throw validationError(problems);
    // The company is the one the link was made for, whatever was typed.
    const content = toContent(
      {...body, company: {...body.company, name: row.company_name}},
      SUPPLIER_PRIVACY_VERSION,
    );
    const id = await insertProposal(tx, {
      organizationId: row.organization_id,
      via: 'link',
      requestId: row.request_id,
      linkId: row.link_id,
      offerId: row.offer_id,
      content,
      origin: null,
      createdBy: null,
      now,
    });
    await tx.query(
      `UPDATE quote_request_links SET status = 'answered', answered_at = $2::timestamptz
        WHERE id = $1`,
      [row.link_id, now.toISOString()],
    );
    await logReceived(tx, {
      organizationId: row.organization_id,
      proposalId: id,
      companyName: row.company_name,
      now,
    });
    return {receivedAt: now.toISOString()};
  });
}

/** The company says it cannot offer it (no proposal). */
export async function declineByLink(
  db: Db,
  token: string,
  reason: string | null,
  now: Date,
): Promise<void> {
  await db.transaction(async tx => {
    const row = await lookup(tx, token, now, true);
    if (!row) throw notFound(LINK_GONE);
    if (row.link_status !== 'waiting')
      {throw new AppError('VALIDATION', ALREADY);}
    await tx.query(
      `UPDATE quote_request_links
          SET status = 'declined', answered_at = $2::timestamptz, decline_reason = $3
        WHERE id = $1`,
      [row.link_id, now.toISOString(), reason],
    );
  });
}

export async function readOpenForm(
  db: Db,
  token: string,
): Promise<PublicOpenForm> {
  const form = await findOpenForm(
    db,
    LINK_TOKEN_RE.test(token) ? token : `x${token}`,
  );
  if (!form || !LINK_TOKEN_RE.test(token)) throw notFound(LINK_GONE);
  return {organization: {name: form.name}};
}

/** A free offer through the organization's open link (while it is on). */
export async function submitOpen(
  db: Db,
  token: string,
  body: ProposalBody,
  now: Date,
): Promise<PublicProposalReceipt> {
  return db.transaction(async tx => {
    const form = await findOpenForm(
      tx,
      LINK_TOKEN_RE.test(token) ? token : `x${token}`,
    );
    if (!form || !LINK_TOKEN_RE.test(token)) throw notFound(LINK_GONE);
    await lockCatalogue(tx, form.organizationId);
    const problems = deadlineProblem(
      body.acceptUntil,
      localToday(now, form.timezone),
    );
    if (Object.keys(problems).length > 0) throw validationError(problems);
    const content = toContent(body, SUPPLIER_PRIVACY_VERSION);
    const id = await insertProposal(tx, {
      organizationId: form.organizationId,
      via: 'open',
      requestId: null,
      linkId: null,
      offerId: null,
      content,
      origin: null,
      createdBy: null,
      now,
    });
    await logReceived(tx, {
      organizationId: form.organizationId,
      proposalId: id,
      companyName: content.company.name,
      now,
    });
    return {receivedAt: now.toISOString()};
  });
}
