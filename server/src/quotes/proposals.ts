/**
 * Supplier proposals (Revisión 1 · E6–E7): the inbox. A proposal arrives by
 * a personal link, the open form or by hand, always `pending`. Reading needs
 * `directory.read`; approving or rejecting needs `offers.approve`.
 *
 * Approving turns each product into an offer of the catalogue: a new offer,
 * or a new version of an existing one (renegotiation: the previous version
 * becomes superseded, an expense keeps its own snapshot). The company is
 * found or created by name; the stated tax enters «por verificar» unless it
 * is the company's validated one: a company without a tax takes it, a
 * company with another one leaves it on the offer (E5 columns). Everything
 * runs under the catalogue lock, in one transaction, logged in the activity.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso, toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {supportByOf} from '../http/acting.ts';
import {taxColumns, taxParams, toTax} from '../budget/tax.ts';
import type {TaxRow} from '../budget/tax.ts';
import {areServiceCategories} from '../categories/service.ts';
import {findOrCreateCompany} from '../companies/service.ts';
import {listOffers} from '../offers/service.ts';
import {
  checkAccess,
  isUuid,
  requireAccess,
  requireMembership,
} from '../organizations/service.ts';
import type {Membership} from '../organizations/service.ts';
import {normalizeName} from '../records/find-or-create.ts';
import {lockCatalogue} from '../records/locks.ts';
import type {ProposalBody} from '../offer-terms/schemas.ts';
import {
  appendVersion,
  currentVersionOf,
  loadVersion,
  localToday,
  parseJson,
} from '../offer-terms/versions.ts';
import {resolveRenewals} from '../offer-terms/renewals.ts';
import {sameTax} from '../../../shared/logistics/money.ts';
import {
  ACCEPT_UNTIL_MAX_DAYS,
  PRICE_BASIS_LABEL,
} from '../../../shared/logistics/offer-terms.ts';
import {
  proposalFlags,
  proposalTax,
  proposalTerms,
} from '../../../shared/logistics/proposals.ts';
import {addDays} from '../../../shared/logistics/time.ts';
import type {
  LocalDate,
  OfferTerms,
  PriceUnit,
  Proposal,
  ProposalApproveInput,
  ProposalApproveResponse,
  ProposalContent,
  ProposalProductInput,
  ProposalResult,
  ProposalState,
  ProposalVia,
  SessionUser,
  TaxInfo,
} from '../../../shared/logistics/contracts.ts';

interface ProposalRow {
  id: string;
  organization_id: string;
  via: ProposalVia;
  state: ProposalState;
  received_at: unknown;
  request_id: string | null;
  request_title: string | null;
  request_category_id: string | null;
  link_id: string | null;
  offer_id: string | null;
  offer_name: string | null;
  company_id: string | null;
  company_name: string;
  matched_company_name: string | null;
  content: unknown;
  origin: string | null;
  created_by: string | null;
  created_by_name: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_support_by: string | null;
  decided_support_by_name: string | null;
  decided_at: unknown;
  reject_reason: string | null;
  result: unknown;
  version: number;
}

const SELECT_PROPOSAL = `
  SELECT p.id, p.organization_id, p.via, p.state, p.received_at, p.request_id,
         r.title AS request_title, r.category_id AS request_category_id,
         p.link_id, p.offer_id, o.name AS offer_name,
         c.id AS company_id, p.company_name, c.name AS matched_company_name,
         p.content, p.origin, p.created_by, cb.display_name AS created_by_name,
         p.decided_by, db.display_name AS decided_by_name,
         p.decided_support_by, dsb.display_name AS decided_support_by_name,
         p.decided_at,
         p.reject_reason, p.result, p.version
    FROM proposals p
    LEFT JOIN quote_requests r ON r.id = p.request_id
    LEFT JOIN offers o ON o.id = p.offer_id
    LEFT JOIN companies c
      ON c.organization_id = p.organization_id AND lower(c.name) = lower(p.company_name)
    LEFT JOIN users cb ON cb.id = p.created_by
    LEFT JOIN users db ON db.id = p.decided_by
    LEFT JOIN users dsb ON dsb.id = p.decided_support_by`;

function toProposal(row: ProposalRow, today: LocalDate): Proposal {
  const content = parseJson<ProposalContent>(row.content);
  const ref = (id: string | null, name: string | null) =>
    id && name ? {id, name} : null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    via: row.via,
    state: row.state,
    receivedAt: toIso(row.received_at),
    request:
      row.request_id && row.request_title
        ? {id: row.request_id, title: row.request_title}
        : null,
    offer: ref(row.offer_id, row.offer_name),
    company: ref(row.company_id, row.matched_company_name),
    content,
    origin: row.origin,
    flags: row.state === 'pending' ? proposalFlags(content, today) : [],
    createdBy:
      row.created_by && row.created_by_name
        ? {id: row.created_by, displayName: row.created_by_name}
        : null,
    decidedBy:
      row.decided_by && row.decided_by_name
        ? {id: row.decided_by, displayName: row.decided_by_name}
        : null,
    ...(row.decided_support_by && row.decided_support_by_name
      ? {
          decidedBySupport: {
            id: row.decided_support_by,
            displayName: row.decided_support_by_name,
          },
        }
      : {}),
    decidedAt: toIsoOrNull(row.decided_at),
    rejectReason: row.reject_reason,
    result: parseJson<ProposalResult[]>(row.result),
    version: Number(row.version),
  };
}

function proposalNotFound(): AppError {
  return notFound('No encontramos esa propuesta: puede que se haya eliminado.');
}

async function loadRow(
  q: Queryable,
  id: string,
  lock = false,
): Promise<ProposalRow | undefined> {
  return (
    await q.query<ProposalRow>(
      `${SELECT_PROPOSAL} WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`,
      [id],
    )
  )[0];
}

async function loadOwn(
  q: Queryable,
  user: SessionUser,
  id: string,
): Promise<{row: ProposalRow; org: Membership}> {
  if (!isUuid(id)) throw proposalNotFound();
  const row = await loadRow(q, id);
  if (!row) throw proposalNotFound();
  let org: Membership;
  try {
    org = await requireMembership(q, user.id, row.organization_id);
  } catch {
    throw proposalNotFound();
  }
  checkAccess(org, user, 'directory.read');
  return {row, org};
}

/** Newest first; `state` filters. */
export async function listProposals(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
  state: ProposalState | null,
  now: Date,
): Promise<Proposal[]> {
  const org = await requireAccess(db, user, organizationId, 'directory.read');
  const rows = await db.query<ProposalRow>(
    `${SELECT_PROPOSAL}
      WHERE p.organization_id = $1 AND ($2::text IS NULL OR p.state = $2::text)
      ORDER BY p.received_at DESC, p.id`,
    [org.id, state],
  );
  const today = localToday(now, org.timezone);
  return rows.map(r => toProposal(r, today));
}

export async function getProposal(
  db: Queryable,
  user: SessionUser,
  id: string,
  now: Date,
): Promise<Proposal> {
  const {row, org} = await loadOwn(db, user, id);
  return toProposal(row, localToday(now, org.timezone));
}

/** Plain-Spanish problems with the deadline, checked against today. */
export function deadlineProblem(
  acceptUntil: LocalDate | null,
  today: LocalDate,
): Record<string, string> {
  if (acceptUntil === null) return {};
  if (acceptUntil < today) {
    return {
      acceptUntil:
        'Esa fecha ya ha pasado: indica hasta cuándo se puede aceptar.',
    };
  }
  if (acceptUntil > addDays(today, ACCEPT_UNTIL_MAX_DAYS)) {
    return {acceptUntil: 'Como mucho cinco años desde hoy.'};
  }
  return {};
}

/** The stored form of a validated proposal. */
export function toContent(
  body: ProposalBody,
  privacyVersion: string | null,
): ProposalContent {
  const {privacyAccepted: _accepted, tax, ...rest} = body;
  return {
    ...rest,
    tax: tax ? {...tax, verification: 'to_verify'} : null,
    privacyVersion,
  };
}

/** Inserts a pending proposal; returns its id. */
export async function insertProposal(
  tx: Queryable,
  args: {
    organizationId: string;
    via: ProposalVia;
    requestId: string | null;
    linkId: string | null;
    offerId: string | null;
    content: ProposalContent;
    origin: string | null;
    createdBy: string | null;
    now: Date;
  },
): Promise<string> {
  const id = (
    (
      await tx.query<{id: string}>(
        `INSERT INTO proposals
           (organization_id, via, request_id, link_id, offer_id, company_name,
            content, origin, received_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz, $10)
         RETURNING id`,
        [
          args.organizationId,
          args.via,
          args.requestId,
          args.linkId,
          args.offerId,
          normalizeName(args.content.company.name) ?? args.content.company.name,
          JSON.stringify(args.content),
          args.origin,
          args.now.toISOString(),
          args.createdBy,
        ],
      )
    )[0] as {id: string}
  ).id;
  return id;
}

/** A member records a proposal received outside the form (by phone, by e-mail). */
export async function createManualProposal(
  db: Db,
  user: SessionUser,
  body: {
    organizationId: string;
    offerId?: string | null;
    requestId?: string | null;
    origin: string;
    proposal: ProposalBody;
  },
  now: Date,
): Promise<Proposal> {
  return db.transaction(async tx => {
    const org = await requireAccess(
      tx,
      user,
      body.organizationId,
      'directory.read',
    );
    await lockCatalogue(tx, org.id);
    const today = localToday(now, org.timezone);
    const fields: Record<string, string> = {
      ...prefix('proposal.', deadlineProblem(body.proposal.acceptUntil, today)),
    };
    const own = async (table: 'offers' | 'quote_requests', id: string) =>
      (
        await tx.query(
          `SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2`,
          [id, org.id],
        )
      ).length > 0;
    if (body.offerId && !(await own('offers', body.offerId))) {
      fields.offerId = 'Esa oferta ya no existe en esta organización.';
    }
    if (body.requestId && !(await own('quote_requests', body.requestId))) {
      fields.requestId = 'Esa solicitud ya no existe en esta organización.';
    }
    if (Object.keys(fields).length > 0) throw validationError(fields);
    const content = toContent(body.proposal, null);
    const id = await insertProposal(tx, {
      organizationId: org.id,
      via: 'manual',
      requestId: body.requestId ?? null,
      linkId: null,
      offerId: body.offerId ?? null,
      content,
      origin: body.origin,
      createdBy: user.id,
      now,
    });
    await appendActivity(tx, {
      organizationId: org.id,
      userId: user.id,
      entityType: 'proposal',
      entityId: id,
      entityLabel: content.company.name,
      action: 'create',
      at: now,
    });
    return toProposal((await loadRow(tx, id)) as ProposalRow, today);
  });
}

function prefix(
  p: string,
  fields: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [p + k, v]));
}

// ---------------------------------------------------------------- deciding

async function lockPending(
  tx: Queryable,
  user: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<{row: ProposalRow; org: Membership; today: LocalDate}> {
  const {org} = await loadOwn(tx, user, id);
  checkAccess(org, user, 'offers.approve');
  await lockCatalogue(tx, org.id);
  const row = (await loadRow(tx, id, true)) as ProposalRow;
  const today = localToday(now, org.timezone);
  if (Number(row.version) !== version) {
    throw new AppError(
      'VERSION_CONFLICT',
      'Otra persona ha decidido o cambiado esta propuesta. Revisa la versión actual.',
      {current: toProposal(row, today)},
    );
  }
  if (row.state !== 'pending') {
    throw new AppError(
      'VALIDATION',
      row.state === 'approved'
        ? 'Esta propuesta ya está aprobada.'
        : 'Esta propuesta ya está rechazada.',
    );
  }
  return {row, org, today};
}

async function markDecided(
  tx: Queryable,
  row: ProposalRow,
  user: SessionUser,
  state: 'approved' | 'rejected',
  now: Date,
  extra: {reason?: string; result?: ProposalResult[]},
): Promise<void> {
  await tx.query(
    `UPDATE proposals
        SET state = $2, decided_by = $3, decided_at = $4::timestamptz,
            reject_reason = $5, result = $6::jsonb, decided_support_by = $7,
            version = version + 1
      WHERE id = $1`,
    [
      row.id,
      state,
      user.id,
      now.toISOString(),
      extra.reason ?? null,
      JSON.stringify(extra.result ?? []),
      // The administrator behind a support session on `user`, if any.
      supportByOf(user),
    ],
  );
  if (row.link_id) {
    await tx.query('UPDATE quote_request_links SET status = $2 WHERE id = $1', [
      row.link_id,
      state,
    ]);
  }
  await appendActivity(tx, {
    organizationId: row.organization_id,
    userId: user.id,
    entityType: 'proposal',
    entityId: row.id,
    entityLabel: row.company_name,
    action: 'update',
    changedFields: ['state'],
    at: now,
  });
}

export async function rejectProposal(
  db: Db,
  user: SessionUser,
  id: string,
  body: {version: number; reason: string},
  now: Date,
): Promise<Proposal> {
  return db.transaction(async tx => {
    const {row, today} = await lockPending(tx, user, id, body.version, now);
    await markDecided(tx, row, user, 'rejected', now, {reason: body.reason});
    return toProposal((await loadRow(tx, id)) as ProposalRow, today);
  });
}

/** The catalogue unit an offer row shows for a price basis. */
export function catalogueUnit(
  terms: Pick<OfferTerms, 'basis' | 'customUnit'>,
): {unit: PriceUnit; customUnit: string | null} {
  switch (terms.basis) {
    case 'unit_day':
    case 'person_day':
      return {unit: 'day', customUnit: null};
    case 'unit_event':
      return {unit: 'unit', customUnit: null};
    case 'hour_person':
    case 'hour':
      return {unit: 'hour', customUnit: null};
    case 'pack':
      return {unit: 'pack', customUnit: null};
    case 'order':
    case 'service':
      return {unit: 'custom', customUnit: PRICE_BASIS_LABEL[terms.basis]};
    default:
      return {
        unit: 'custom',
        customUnit: (terms.customUnit ?? PRICE_BASIS_LABEL.custom).slice(0, 60),
      };
  }
}

/** The per-order cost of a supplement kind, as the M3 catalogue columns hold it. */
function catalogueCost(
  terms: OfferTerms,
  kind: 'transport' | 'assembly' | 'maintenance',
): number | null {
  const s = terms.supplements.find(
    x => x.kind === kind && x.applies === 'always',
  );
  if (!s) return null;
  if (s.included) return 0;
  return s.per === 'order' ? s.amount : null;
}

/** «170 € → 180 € por unidad y jornada», or what changed in words. */
function changeNote(before: OfferTerms, after: OfferTerms): string {
  const parts: string[] = [];
  const eur = (n: number | null) => (n === null ? 'sin precio' : `${n} €`);
  if (before.price !== after.price || before.basis !== after.basis) {
    parts.push(
      `${eur(before.price)} → ${eur(after.price)} ${PRICE_BASIS_LABEL[after.basis]}`,
    );
  }
  if (before.acceptUntil !== after.acceptUntil && after.acceptUntil) {
    parts.push(`se puede aceptar hasta el ${after.acceptUntil}`);
  }
  if (after.seasonal.length > 0 && before.seasonal.length === 0) {
    parts.push('añade tarifas de temporada');
  }
  if (after.commitment && !before.commitment) {
    parts.push(`compromiso de ${after.commitment.years} años`);
  }
  return (parts.join('; ') || 'Condiciones renovadas').slice(0, 280);
}

async function companyTaxOf(
  tx: Queryable,
  companyId: string,
): Promise<TaxInfo | null> {
  const row = (
    await tx.query<TaxRow>(
      `SELECT ${taxColumns('c')} FROM companies c WHERE c.id = $1`,
      [companyId],
    )
  )[0];
  return row ? toTax(row) : null;
}

const DATA_SOURCE = 'reported';

/**
 * Approves a pending proposal: each product (unless skipped) becomes a new
 * offer or a new version of the offer it renegotiates.
 */
export async function approveProposal(
  db: Db,
  user: SessionUser,
  id: string,
  body: ProposalApproveInput,
  now: Date,
): Promise<ProposalApproveResponse> {
  return db.transaction(async tx => {
    const {row, org, today} = await lockPending(
      tx,
      user,
      id,
      body.version,
      now,
    );
    const content = parseJson<ProposalContent>(row.content);
    if (content.acceptUntil !== null && content.acceptUntil < today) {
      throw new AppError(
        'VALIDATION',
        'Esta propuesta ya ha vencido: no se puede aprobar. Pide una nueva o recházala.',
      );
    }
    const choices = new Map((body.products ?? []).map(p => [p.key, p]));
    const unknownKey = [...choices.keys()].find(
      k => !content.products.some(p => p.key === k),
    );
    if (unknownKey) {
      throw validationError({
        products: `No hay ningún producto «${unknownKey}» en la propuesta.`,
      });
    }
    const chosen = content.products.filter(p => !choices.get(p.key)?.skip);
    if (chosen.length === 0) {
      throw validationError({
        products: 'Elige al menos un producto para aprobar.',
      });
    }

    // The company: found or created by name; a new one takes the stated contact data.
    const name = normalizeName(content.company.name) ?? row.company_name;
    const existed =
      (
        await tx.query(
          'SELECT 1 FROM companies WHERE organization_id = $1 AND lower(name) = lower($2)',
          [org.id, name],
        )
      ).length > 0;
    const company = await findOrCreateCompany(tx, {
      organizationId: org.id,
      name,
      actorId: user.id,
      now,
    });
    const companyTax = await companyTaxOf(tx, company.id);
    const stated = content.tax;
    const versionTax = proposalTax(stated, companyTax);
    let offerTax: TaxInfo | null = null;
    const companyChanges: string[] = [];
    if (!existed) {
      await tx.query(
        'UPDATE companies SET phone = $2, email = $3 WHERE id = $1',
        [
          company.id,
          content.company.phone ?? null,
          content.company.email ?? null,
        ],
      );
      if (content.company.phone) companyChanges.push('phone');
      if (content.company.email) companyChanges.push('email');
    }
    if (stated && !companyTax) {
      const [r, n, rate, v] = taxParams({...stated, verification: 'to_verify'});
      await tx.query(
        `UPDATE companies SET tax_regime = $2, tax_name = $3, tax_rate = $4::numeric,
                tax_verification = $5 WHERE id = $1`,
        [company.id, r, n, rate, v],
      );
      companyChanges.push('tax');
    } else if (
      stated &&
      companyTax &&
      !sameTax(
        {...stated, verification: 'to_verify'},
        {...companyTax, verification: 'to_verify'},
      )
    ) {
      offerTax = {...stated, verification: 'to_verify'};
    }
    if (companyChanges.length > 0) {
      await tx.query(
        `UPDATE companies SET version = version + 1, updated_by = $2,
                updated_at = $3::timestamptz WHERE id = $1`,
        [company.id, user.id, now.toISOString()],
      );
      await appendActivity(tx, {
        organizationId: org.id,
        userId: user.id,
        entityType: 'company',
        entityId: company.id,
        entityLabel: company.name,
        action: 'update',
        changedFields: companyChanges,
        at: now,
      });
    }
    await addContact(tx, org.id, company.id, content, user.id, now);

    const fields: Record<string, string> = {};
    const result: ProposalResult[] = [];
    const versionIds: string[] = [];
    for (const [index, product] of content.products.entries()) {
      const choice = choices.get(product.key);
      if (choice?.skip) continue;
      const targetId =
        choice?.offerId !== undefined
          ? choice.offerId
          : content.products.length === 1
            ? row.offer_id
            : null;
      let categoryId: string | null | undefined = choice?.categoryId;
      if (
        categoryId &&
        !(await areServiceCategories(tx, org.id, [categoryId]))
      ) {
        fields[`products.${index}.categoryId`] =
          'Esa categoría ya no existe o no es de servicios de esta organización.';
        continue;
      }
      const terms = {...proposalTerms(content, product), tax: versionTax};
      if (targetId) {
        const target = (
          await tx.query<{company_id: string; name: string; is_demo: boolean}>(
            'SELECT company_id, name, is_demo FROM offers WHERE id = $1 AND organization_id = $2 FOR UPDATE',
            [targetId, org.id],
          )
        )[0];
        if (!target) {
          fields[`products.${index}.offerId`] =
            'Esa oferta ya no existe en esta organización.';
          continue;
        }
        if (target.company_id !== company.id) {
          fields[`products.${index}.offerId`] =
            'Esa oferta es de otra empresa: elige una de la empresa que propone.';
          continue;
        }
        const previous = await currentVersionOf(tx, targetId);
        const added = await appendVersion(tx, {
          organizationId: org.id,
          offerId: targetId,
          terms,
          changeNote: changeNote(previous.terms, terms),
          proposalId: row.id,
          approvedBy: user.id,
          now,
          previous,
        });
        await writeOfferRow(tx, {
          id: targetId,
          terms,
          product,
          offerTax,
          categoryId,
          actorId: user.id,
          now,
        });
        await appendActivity(tx, {
          organizationId: org.id,
          userId: user.id,
          entityType: 'offer',
          entityId: targetId,
          entityLabel: target.name,
          action: 'update',
          changedFields: ['terms', 'price', 'unit', 'conditions'],
          at: now,
          isDemo: target.is_demo,
        });
        await resolveRenewals(tx, {
          previousVersionId: previous.id,
          newVersionId: added.id,
          actorId: user.id,
          now,
        });
        result.push({
          productKey: product.key,
          offerId: targetId,
          versionNumber: added.number,
          created: false,
        });
        versionIds.push(added.id);
      } else {
        if (categoryId === undefined) {
          categoryId =
            content.products.length === 1 ? row.request_category_id : null;
        }
        const offerId = await insertOfferRow(tx, {
          organizationId: org.id,
          companyId: company.id,
          categoryId: categoryId ?? null,
          terms,
          product,
          offerTax,
          actorId: user.id,
          now,
        });
        const added = await appendVersion(tx, {
          organizationId: org.id,
          offerId,
          terms,
          changeNote: VIA_NOTE[row.via],
          proposalId: row.id,
          approvedBy: user.id,
          now,
          previous: null,
        });
        await appendActivity(tx, {
          organizationId: org.id,
          userId: user.id,
          entityType: 'offer',
          entityId: offerId,
          entityLabel: product.name,
          action: 'create',
          at: now,
        });
        result.push({
          productKey: product.key,
          offerId,
          versionNumber: added.number,
          created: true,
        });
        versionIds.push(added.id);
      }
    }
    if (Object.keys(fields).length > 0) throw validationError(fields);
    await markDecided(tx, row, user, 'approved', now, {result});

    const ids = new Set(result.map(r => r.offerId));
    const offers = (await listOffers(tx, org.id, user)).filter(o =>
      ids.has(o.id),
    );
    const versions = [];
    for (const vid of versionIds) {
      versions.push(await loadVersion(tx, vid, today));
    }
    return {
      proposal: toProposal((await loadRow(tx, id)) as ProposalRow, today),
      offers,
      versions,
    };
  });
}

const VIA_NOTE: Record<ProposalVia, string> = {
  link: 'Aprobada desde una propuesta por enlace',
  open: 'Aprobada desde una propuesta del formulario abierto',
  manual: 'Aprobada desde una propuesta registrada a mano',
};

async function addContact(
  tx: Queryable,
  organizationId: string,
  companyId: string,
  content: ProposalContent,
  actorId: string,
  now: Date,
): Promise<void> {
  const name = normalizeName(content.company.contactName);
  if (!name) return;
  const known = await tx.query(
    'SELECT 1 FROM contacts WHERE company_id = $1 AND lower(name) = lower($2)',
    [companyId, name],
  );
  if (known.length > 0) return;
  const id = (
    (
      await tx.query<{id: string}>(
        `INSERT INTO contacts
           (organization_id, company_id, name, phone, email, source, verification,
            created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'reported', 'to_verify', $6, $7::timestamptz,
                 $6, $7::timestamptz)
         RETURNING id`,
        [
          organizationId,
          companyId,
          name.slice(0, 200),
          content.company.phone ?? null,
          content.company.email ?? null,
          actorId,
          now.toISOString(),
        ],
      )
    )[0] as {id: string}
  ).id;
  await appendActivity(tx, {
    organizationId,
    userId: actorId,
    entityType: 'contact',
    entityId: id,
    entityLabel: name,
    action: 'create',
    at: now,
  });
}

async function insertOfferRow(
  tx: Queryable,
  args: {
    organizationId: string;
    companyId: string;
    categoryId: string | null;
    terms: OfferTerms;
    product: ProposalProductInput;
    offerTax: TaxInfo | null;
    actorId: string;
    now: Date;
  },
): Promise<string> {
  const {unit, customUnit} = catalogueUnit(args.terms);
  const [r, n, rate, v] = taxParams(args.offerTax);
  return (
    (
      await tx.query<{id: string}>(
        `INSERT INTO offers
           (organization_id, company_id, category_id, name, description, price,
            unit, custom_unit, transport_cost, assembly_cost, maintenance_cost,
            conditions, vat_included, source, verification,
            tax_regime, tax_name, tax_rate, tax_verification,
            created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::numeric,
                 $10::numeric, $11::numeric, $12, $13, $14, 'to_verify',
                 $15, $16, $17::numeric, $18,
                 $19, $20::timestamptz, $19, $20::timestamptz)
         RETURNING id`,
        [
          args.organizationId,
          args.companyId,
          args.categoryId,
          args.product.name,
          args.product.description ?? null,
          args.terms.price,
          unit,
          customUnit,
          catalogueCost(args.terms, 'transport'),
          catalogueCost(args.terms, 'assembly'),
          catalogueCost(args.terms, 'maintenance'),
          args.terms.conditions,
          args.terms.pricesIncludeTax,
          DATA_SOURCE,
          r,
          n,
          rate,
          v,
          args.actorId,
          args.now.toISOString(),
        ],
      )
    )[0] as {id: string}
  ).id;
}

/** The catalogue row shows the version now in force. */
async function writeOfferRow(
  tx: Queryable,
  args: {
    id: string;
    terms: OfferTerms;
    product: ProposalProductInput;
    offerTax: TaxInfo | null;
    categoryId: string | null | undefined;
    actorId: string;
    now: Date;
  },
): Promise<void> {
  const {unit, customUnit} = catalogueUnit(args.terms);
  const [r, n, rate, v] = taxParams(args.offerTax);
  await tx.query(
    `UPDATE offers
        SET price = $2::numeric, unit = $3, custom_unit = $4,
            transport_cost = $5::numeric, assembly_cost = $6::numeric,
            maintenance_cost = $7::numeric, conditions = $8, vat_included = $9,
            tax_regime = $10, tax_name = $11, tax_rate = $12::numeric,
            tax_verification = $13,
            category_id = CASE WHEN $14::boolean THEN $15::uuid ELSE category_id END,
            source = $16, verification = 'to_verify',
            version = version + 1, updated_by = $17, updated_at = $18::timestamptz
      WHERE id = $1`,
    [
      args.id,
      args.terms.price,
      unit,
      customUnit,
      catalogueCost(args.terms, 'transport'),
      catalogueCost(args.terms, 'assembly'),
      catalogueCost(args.terms, 'maintenance'),
      args.terms.conditions,
      args.terms.pricesIncludeTax,
      r,
      n,
      rate,
      v,
      args.categoryId !== undefined,
      args.categoryId ?? null,
      DATA_SOURCE,
      args.actorId,
      args.now.toISOString(),
    ],
  );
}
