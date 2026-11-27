/**
 * Revisión 1 · E5: the demo event's budget and expenses, so «Presupuesto»
 * is not empty in a demonstration. Fictitious figures and «Demo» companies
 * only; every row is `is_demo` (the demo removal clears it with its event).
 *
 * It shows every honest case: planned and confirmed, an expense copied from
 * a catalogue offer (with its snapshot), IGIC 7 % «por verificar», no tax
 * («ninguno»), a tax nobody knows yet and an amount nobody knows yet, so the
 * summary reads «incompleto».
 *
 * Called by the seed once, while the demo event is there (also on a database
 * seeded before E5). A demo company or offer the team deleted, or one that
 * is no longer demo data, is simply not linked.
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {findOfferRow, toFullOffer} from '../offers/service.ts';
import {taxParams} from '../budget/tax.ts';
import {
  effectiveTax,
  priceEstimate,
  snapshotOf,
} from '../../../shared/logistics/money.ts';
import type {
  ExpenseStatus,
  TaxInfo,
} from '../../../shared/logistics/contracts.ts';

/** Euros, taxes included (fictitious). */
export const DEMO_BUDGET_AMOUNT = 6000;

const IGIC_TO_VERIFY: TaxInfo = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'to_verify',
};

const DEMO_SUPPLIER = 'Escenarios Demo';

export interface DemoExpense {
  concept: string;
  companyName: string | null;
  /** Copied from this demo offer (name), with its snapshot. */
  offerName?: string;
  /** Before tax; null = unknown. Omitted with an offer: offer price × `units`. */
  amount?: number | null;
  /** With an offer and no amount: how many units of the offer's price. */
  units?: number;
  /** Omitted with an offer: its effective tax. */
  tax?: TaxInfo | null;
  status: ExpenseStatus;
  notes: string | null;
}

export const DEMO_EXPENSES: DemoExpense[] = [
  {
    concept: 'Escenario modular · 2 días',
    companyName: DEMO_SUPPLIER,
    offerName: 'Escenario modular 8 × 6 m',
    units: 2,
    // The demo offer and its company record no tax (seeded before E5); the
    // expense states IGIC «por verificar», the snapshot keeps «sin impuesto».
    tax: IGIC_TO_VERIFY,
    status: 'confirmed',
    notes: 'Dato ficticio. Copiado de la oferta del catálogo.',
  },
  {
    concept: 'Carpas 5 × 5 m · 4 unidades',
    companyName: DEMO_SUPPLIER,
    amount: 720,
    tax: IGIC_TO_VERIFY,
    status: 'planned',
    notes: 'Dato ficticio.',
  },
  {
    concept: 'Préstamo de vallas peatonales',
    companyName: 'Concejalía Demo',
    amount: 0,
    tax: {
      regime: 'none',
      name: null,
      ratePercent: 0,
      verification: 'validated',
    },
    status: 'confirmed',
    notes: 'Dato ficticio. Préstamo municipal sin coste.',
  },
  {
    concept: 'Taller infantil · 3 horas',
    companyName: 'Asociación Vecinal Demo',
    amount: 120,
    // Nobody knows yet whether the association charges a tax.
    tax: {
      regime: 'unknown',
      name: null,
      ratePercent: null,
      verification: 'to_verify',
    },
    status: 'planned',
    notes: 'Dato ficticio.',
  },
  {
    concept: 'Limpieza al terminar',
    companyName: null,
    amount: null,
    tax: null,
    status: 'planned',
    notes: 'Dato ficticio. Pendiente de pedir presupuesto.',
  },
];

/** True when the demo budget was ever seeded (its activity survives until the demo removal). */
export async function hasDemoBudget(
  tx: Queryable,
  organizationId: string,
): Promise<boolean> {
  const rows = await tx.query(
    `SELECT 1 FROM expenses WHERE organization_id = $1 AND is_demo
     UNION ALL
     SELECT 1 FROM event_budgets b JOIN events e ON e.id = b.event_id
      WHERE b.organization_id = $1 AND e.is_demo
     UNION ALL
     SELECT 1 FROM activity_log
      WHERE organization_id = $1 AND entity_type IN ('budget', 'expense')
        AND is_demo
     LIMIT 1`,
    [organizationId],
  );
  return rows.length > 0;
}

/**
 * Creates the demo budget and expenses of `eventId`, each with its activity
 * row (`is_demo`). Companies and offers are only linked, never changed.
 * Returns how many expenses were created. The caller holds the graph and
 * catalogue locks.
 */
export async function seedDemoBudget(
  tx: Queryable,
  args: {
    organizationId: string;
    eventId: string;
    eventName: string;
    actorId: string;
    now: Date;
  },
): Promise<number> {
  const {organizationId, eventId, actorId, now} = args;
  const at = now.toISOString();
  const log = (
    entityType: string,
    entityId: string,
    entityLabel: string,
    action: 'create' | 'update',
    changedFields?: string[],
  ) =>
    appendActivity(tx, {
      organizationId,
      userId: actorId,
      entityType,
      entityId,
      entityLabel,
      action,
      changedFields,
      at: now,
      isDemo: true,
    });

  await tx.query(
    `INSERT INTO event_budgets
       (event_id, organization_id, amount, updated_by, updated_at)
     VALUES ($1, $2, $3::numeric, $4, $5::timestamptz)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, organizationId, DEMO_BUDGET_AMOUNT, actorId, at],
  );
  await log('budget', eventId, args.eventName, 'create', ['amount']);

  const demoCompany = async (name: string | null) =>
    name
      ? ((
          await tx.query<{id: string; name: string}>(
            `SELECT id, name FROM companies
              WHERE organization_id = $1 AND is_demo AND lower(name) = lower($2)`,
            [organizationId, name],
          )
        )[0] ?? null)
      : null;

  let created = 0;
  for (const x of DEMO_EXPENSES) {
    const offerId = x.offerName
      ? (
          await tx.query<{id: string}>(
            `SELECT id FROM offers
              WHERE organization_id = $1 AND is_demo AND lower(name) = lower($2)
              ORDER BY created_at, id LIMIT 1`,
            [organizationId, x.offerName],
          )
        )[0]?.id
      : undefined;
    const row = offerId
      ? await findOfferRow(tx, organizationId, offerId)
      : undefined;
    const offer = row ? toFullOffer(row) : null;
    const company = offer
      ? {id: offer.company.id, name: offer.company.name}
      : await demoCompany(x.companyName);
    const before = offer ? priceEstimate(offer).beforeTax : null;
    const amount =
      x.amount !== undefined
        ? x.amount
        : before !== null
          ? before * (x.units ?? 1)
          : null;
    const tax =
      x.tax !== undefined ? x.tax : offer ? effectiveTax(offer) : null;

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO expenses
         (organization_id, event_id, concept, company_id, company_name, amount,
          tax_regime, tax_name, tax_rate, tax_verification, status,
          offer_snapshot, notes, verification, is_demo,
          created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::numeric, $10, $11,
               $12::jsonb, $13, 'draft', true,
               $14, $15::timestamptz, $14, $15::timestamptz)
       RETURNING id`,
      [
        organizationId,
        eventId,
        x.concept,
        company?.id ?? null,
        company?.name ?? null,
        amount,
        ...taxParams(tax),
        x.status,
        offer ? JSON.stringify(snapshotOf(offer, at)) : null,
        x.notes,
        actorId,
        at,
      ],
    );
    await log('expense', (inserted[0] as {id: string}).id, x.concept, 'create');
    created++;
  }
  return created;
}
