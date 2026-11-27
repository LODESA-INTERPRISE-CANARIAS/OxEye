/**
 * Offer versions (Revisión 1 · E6): the terms of each offer, one version per
 * approval. Versions are never edited; a new one supersedes the previous one
 * in the same transaction (one version in force per offer, unique index).
 * Reading them needs `directory.read` (they carry prices).
 */
import type {Queryable} from '../db/db.ts';
import {toIso, toIsoOrNull} from '../db/db.ts';
import {notFound} from '../errors.ts';
import {
  isUuid,
  requireAccess,
  requireMembership,
  checkAccess,
} from '../organizations/service.ts';
import {
  legacyTerms,
  versionStatus,
} from '../../../shared/logistics/offer-terms.ts';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import type {
  LocalDate,
  OfferTerms,
  OfferVersion,
  PriceUnit,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

export interface VersionRow {
  id: string;
  organization_id: string;
  offer_id: string;
  number: number;
  terms: unknown;
  change_note: string | null;
  proposal_id: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  created_by: string;
  created_by_name: string;
  created_at: unknown;
  superseded_at: unknown;
}

export const SELECT_VERSION = `
  SELECT v.id, v.organization_id, v.offer_id, v.number, v.terms, v.change_note,
         v.proposal_id, v.approved_by, ab.display_name AS approved_by_name,
         v.created_by, cb.display_name AS created_by_name, v.created_at,
         v.superseded_at
    FROM offer_versions v
    JOIN users cb ON cb.id = v.created_by
    LEFT JOIN users ab ON ab.id = v.approved_by`;

/** Today in the organization's time zone. */
export function localToday(now: Date, timezone: string): LocalDate {
  return utcToLocal(now.toISOString(), timezone).date;
}

export function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export function toVersion(row: VersionRow, today: LocalDate): OfferVersion {
  const terms = parseJson<OfferTerms>(row.terms);
  return {
    id: row.id,
    organizationId: row.organization_id,
    offerId: row.offer_id,
    number: Number(row.number),
    status: versionStatus(row.superseded_at != null, terms.acceptUntil, today),
    terms,
    changeNote: row.change_note,
    proposalId: row.proposal_id,
    approvedBy:
      row.approved_by && row.approved_by_name
        ? {id: row.approved_by, displayName: row.approved_by_name}
        : null,
    createdBy: {id: row.created_by, displayName: row.created_by_name},
    createdAt: toIso(row.created_at),
    supersededAt: toIsoOrNull(row.superseded_at),
  };
}

function offerNotFound() {
  return notFound('No encontramos esa oferta: puede que se haya eliminado.');
}

/** Every version of an offer, newest first. */
export async function listOfferVersions(
  db: Queryable,
  user: SessionUser,
  offerId: string,
  now: Date,
): Promise<OfferVersion[]> {
  if (!isUuid(offerId)) throw offerNotFound();
  const offer = (
    await db.query<{organization_id: string}>(
      'SELECT organization_id FROM offers WHERE id = $1',
      [offerId],
    )
  )[0];
  if (!offer) throw offerNotFound();
  let membership;
  try {
    membership = await requireMembership(db, user.id, offer.organization_id);
  } catch {
    throw offerNotFound();
  }
  checkAccess(membership, user, 'directory.read');
  const today = localToday(now, membership.timezone);
  const rows = await db.query<VersionRow>(
    `${SELECT_VERSION} WHERE v.offer_id = $1 ORDER BY v.number DESC`,
    [offerId],
  );
  return rows.map(r => toVersion(r, today));
}

/**
 * The version in force of every offer of the organization that has one
 * (current or expired; offers recorded before E6 have none: the UI uses
 * `legacyTerms`).
 */
export async function listCurrentVersions(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
  now: Date,
): Promise<OfferVersion[]> {
  const org = await requireAccess(db, user, organizationId, 'directory.read');
  const today = localToday(now, org.timezone);
  const rows = await db.query<VersionRow>(
    `${SELECT_VERSION}
      WHERE v.organization_id = $1 AND v.superseded_at IS NULL
      ORDER BY v.offer_id`,
    [org.id],
  );
  return rows.map(r => toVersion(r, today));
}

export async function loadVersion(
  q: Queryable,
  id: string,
  today: LocalDate,
): Promise<OfferVersion> {
  const row = (
    await q.query<VersionRow>(`${SELECT_VERSION} WHERE v.id = $1`, [id])
  )[0] as VersionRow;
  return toVersion(row, today);
}

interface LegacyOfferRow {
  id: string;
  organization_id: string;
  price: string | null;
  unit: PriceUnit;
  custom_unit: string | null;
  transport_cost: string | null;
  assembly_cost: string | null;
  maintenance_cost: string | null;
  conditions: string | null;
  vat_included: boolean | null;
  created_by: string;
  updated_at: unknown;
}

const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * The current version of an offer, creating version 1 from its catalogue
 * data first when it has none (an offer recorded before E6), so its history
 * keeps what the catalogue said before the first renegotiation.
 */
export async function currentVersionOf(
  tx: Queryable,
  offerId: string,
): Promise<{id: string; number: number; terms: OfferTerms}> {
  const current = (
    await tx.query<{id: string; number: number; terms: unknown}>(
      `SELECT id, number, terms FROM offer_versions
        WHERE offer_id = $1 AND superseded_at IS NULL FOR UPDATE`,
      [offerId],
    )
  )[0];
  if (current) {
    return {
      id: current.id,
      number: Number(current.number),
      terms: parseJson<OfferTerms>(current.terms),
    };
  }
  const o = (
    await tx.query<LegacyOfferRow>(
      `SELECT id, organization_id, price::text AS price, unit, custom_unit,
              transport_cost::text AS transport_cost,
              assembly_cost::text AS assembly_cost,
              maintenance_cost::text AS maintenance_cost,
              conditions, vat_included, created_by, updated_at
         FROM offers WHERE id = $1`,
      [offerId],
    )
  )[0] as LegacyOfferRow;
  const terms = legacyTerms({
    price: num(o.price),
    unit: o.unit,
    customUnit: o.custom_unit,
    transportCost: num(o.transport_cost),
    assemblyCost: num(o.assembly_cost),
    maintenanceCost: num(o.maintenance_cost),
    conditions: o.conditions,
    vatIncluded: o.vat_included,
  });
  const inserted = (
    await tx.query<{id: string}>(
      `INSERT INTO offer_versions
         (organization_id, offer_id, number, terms, accept_until, change_note,
          created_by, created_at)
       VALUES ($1, $2, 1, $3::jsonb, NULL, $4, $5, $6::timestamptz)
       RETURNING id`,
      [
        o.organization_id,
        o.id,
        JSON.stringify(terms),
        'Datos del catálogo antes de las versiones',
        o.created_by,
        toIso(o.updated_at),
      ],
    )
  )[0] as {id: string};
  return {id: inserted.id, number: 1, terms};
}

/**
 * Appends a version to an offer (holding the catalogue lock): the current
 * one, if any, becomes superseded at `now`. Returns the new version's id and
 * number.
 */
export async function appendVersion(
  tx: Queryable,
  args: {
    organizationId: string;
    offerId: string;
    terms: OfferTerms;
    changeNote: string | null;
    proposalId: string | null;
    approvedBy: string;
    now: Date;
    previous: {id: string; number: number} | null;
  },
): Promise<{id: string; number: number}> {
  const number = (args.previous?.number ?? 0) + 1;
  if (args.previous) {
    await tx.query(
      'UPDATE offer_versions SET superseded_at = $2::timestamptz WHERE id = $1',
      [args.previous.id, args.now.toISOString()],
    );
  }
  const inserted = (
    await tx.query<{id: string}>(
      `INSERT INTO offer_versions
         (organization_id, offer_id, number, terms, accept_until, change_note,
          proposal_id, approved_by, created_by, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::date, $6, $7, $8, $8, $9::timestamptz)
       RETURNING id`,
      [
        args.organizationId,
        args.offerId,
        number,
        JSON.stringify(args.terms),
        args.terms.acceptUntil,
        args.changeNote?.slice(0, 280) ?? null,
        args.proposalId,
        args.approvedBy,
        args.now.toISOString(),
      ],
    )
  )[0] as {id: string};
  return {id: inserted.id, number};
}
