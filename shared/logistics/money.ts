/**
 * Money rules shared by the server and the UI (Revisión 1 · E5): taxes,
 * estimates with tax, offer snapshots and budget sums. Pure; numbers only,
 * no formatting (formatting lives with the UI and `formatEuros`).
 *
 * Honesty rules:
 * - a tax nobody stated stays unknown (null): no percentage is ever assumed;
 * - an amount with tax is always an estimate («estimación») and is null
 *   when the rate or the price treatment is not known;
 * - unknown amounts and taxes are counted apart, never as 0;
 * - prices are stored before tax; an old offer whose written price includes
 *   tax (`vatIncluded: true`) keeps it as written.
 */
import type {
  EventBudget,
  Expense,
  ExpenseTotals,
  BudgetSummary,
  IsoInstant,
  Offer,
  OfferSnapshot,
  TaxInfo,
  TaxInput,
} from './contracts.ts';
import {
  DEFAULT_TAX_RATE,
  TAX_NAME_MAX,
  TAX_RATE_MAX,
  TAX_REGIMES,
} from './rules.ts';

// ---------------------------------------------------------------- taxes

const TAX_REGIME_INVALID =
  'Impuesto no válido: elige IGIC, IVA, otro, ninguno o sin saber.';
const TAX_NAME_REQUIRED = 'Escribe el nombre del impuesto (por ejemplo, IPSI).';
const TAX_NAME_TOO_LONG = `Máximo ${TAX_NAME_MAX} caracteres.`;
const TAX_RATE_INVALID = `Porcentaje no válido: entre 0 y ${TAX_RATE_MAX}, con dos decimales como máximo. Si aún no lo sabes, déjalo vacío.`;
const TAX_RATE_NONE = 'Sin impuesto el porcentaje es 0.';
const TAX_RATE_UNKNOWN =
  'Con «sin saber» no hay porcentaje: elige el impuesto para indicarlo.';
const TAX_VERIFICATION_INVALID =
  'Verificación no válida: usa por verificar o validado.';

/** True for 0–TAX_RATE_MAX with at most two decimals. */
export function isValidRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= TAX_RATE_MAX &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-6
  );
}

export type TaxResult =
  | {ok: true; tax: TaxInfo | null}
  /** Field problems keyed by the TaxInput key (`regime`, `name`, `ratePercent`, `verification`). */
  | {ok: false; fields: Record<string, string>};

/**
 * A tax as sent → as stored. Null stays null («nadie lo ha dicho»).
 * `igic` / `iva` without `ratePercent` take DEFAULT_TAX_RATE; `none` is 0;
 * `unknown` has no rate; `other` needs a name. `verification` defaults to
 * `to_verify`. Unknown keys are ignored.
 */
export function normalizeTax(input: unknown): TaxResult {
  if (input === null) return {ok: true, tax: null};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {ok: false, fields: {regime: TAX_REGIME_INVALID}};
  }
  const raw = input as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const regime = raw.regime;
  if (!(TAX_REGIMES as readonly unknown[]).includes(regime)) {
    return {ok: false, fields: {regime: TAX_REGIME_INVALID}};
  }
  const r = regime as TaxInfo['regime'];

  let verification: TaxInfo['verification'] = 'to_verify';
  if (raw.verification !== undefined) {
    if (raw.verification === 'to_verify' || raw.verification === 'validated') {
      verification = raw.verification;
    } else {
      fields.verification = TAX_VERIFICATION_INVALID;
    }
  }

  let name: string | null = null;
  if (r === 'other') {
    const typed =
      typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
    if (
      raw.name !== undefined &&
      raw.name !== null &&
      typeof raw.name !== 'string'
    ) {
      fields.name = TAX_NAME_REQUIRED;
    } else if (!typed) {
      fields.name = TAX_NAME_REQUIRED;
    } else if (typed.length > TAX_NAME_MAX) {
      fields.name = TAX_NAME_TOO_LONG;
    } else {
      name = typed;
    }
  }

  let ratePercent: number | null = null;
  const rate = raw.ratePercent;
  if (rate !== undefined && rate !== null && !isValidRate(rate)) {
    fields.ratePercent = TAX_RATE_INVALID;
  } else if (r === 'none') {
    if (rate !== undefined && rate !== null && rate !== 0) {
      fields.ratePercent = TAX_RATE_NONE;
    }
    ratePercent = 0;
  } else if (r === 'unknown') {
    if (rate !== undefined && rate !== null) {
      fields.ratePercent = TAX_RATE_UNKNOWN;
    }
  } else if (rate === undefined) {
    ratePercent = r === 'igic' || r === 'iva' ? DEFAULT_TAX_RATE[r] : null;
  } else {
    ratePercent = rate as number | null;
  }

  if (Object.keys(fields).length > 0) return {ok: false, fields};
  return {ok: true, tax: {regime: r, name, ratePercent, verification}};
}

/**
 * The tax a form prefills when a regime is picked: 7 % / 21 % for IGIC / IVA,
 * 0 for none, no rate otherwise, always «por verificar». For `other` the name
 * is still to be typed (null), so it is not yet a valid TaxInfo to send.
 */
export function defaultTax(regime: TaxInfo['regime']): TaxInfo {
  return {
    regime,
    name: null,
    ratePercent:
      regime === 'igic' || regime === 'iva'
        ? DEFAULT_TAX_RATE[regime]
        : regime === 'none'
          ? 0
          : null,
    verification: 'to_verify',
  };
}

/** The TaxInput that sends a stored tax back unchanged. */
export function taxInputOf(tax: TaxInfo | null): TaxInput | null {
  return tax
    ? {
        regime: tax.regime,
        name: tax.name,
        ratePercent: tax.ratePercent,
        verification: tax.verification,
      }
    : null;
}

/** Same tax (regime, name, rate and verification). */
export function sameTax(a: TaxInfo | null, b: TaxInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.regime === b.regime &&
    a.name === b.name &&
    a.ratePercent === b.ratePercent &&
    a.verification === b.verification
  );
}

/**
 * The percentage that applies, or null when it is not known: `none` is 0;
 * `unknown`, a missing rate or no tax at all is null.
 */
export function taxRate(tax: TaxInfo | null): number | null {
  if (!tax) return null;
  if (tax.regime === 'none') return 0;
  if (tax.regime === 'unknown') return null;
  return tax.ratePercent;
}

/**
 * The tax that applies to an offer: its own, else its company's, else null
 * (unknown). `company` may be omitted for an `Offer` record, which carries
 * its company's tax (`companyTax`).
 */
export function effectiveTax(
  offer: Pick<Offer, 'tax'> & Partial<Pick<Offer, 'companyTax'>>,
  company?: {tax: TaxInfo | null} | null,
): TaxInfo | null {
  if (offer.tax) return offer.tax;
  if (company !== undefined) return company?.tax ?? null;
  return offer.companyTax ?? null;
}

/** True when the offer has no tax of its own and takes its company's. */
export function inheritsTax(offer: Pick<Offer, 'tax'>): boolean {
  return offer.tax === null;
}

/** Euros rounded to cents (half away from zero). */
export function roundCents(value: number): number {
  const cents = Math.round(Math.abs(value) * 100 + 1e-9);
  return (Math.sign(value) * cents) / 100;
}

/**
 * The amount with tax («estimación»), rounded to cents; null when the amount
 * or the rate is not known.
 */
export function withTax(
  amount: number | null,
  tax: TaxInfo | null,
): number | null {
  const rate = taxRate(tax);
  if (amount === null || rate === null) return null;
  return roundCents(amount * (1 + rate / 100));
}

/**
 * The amount before tax of a price that includes it, rounded to cents; null
 * when the price or the rate is not known.
 */
export function withoutTax(
  amount: number | null,
  tax: TaxInfo | null,
): number | null {
  const rate = taxRate(tax);
  if (amount === null || rate === null) return null;
  return roundCents(amount / (1 + rate / 100));
}

// ---------------------------------------------------------------- offers

export interface PriceEstimate {
  /** Price per unit before tax; null when unknown or not derivable. */
  beforeTax: number | null;
  /** Price per unit with tax («estimación»); null when not derivable. */
  withTax: number | null;
  /** The tax used (the offer's own or its company's); null = unknown. */
  tax: TaxInfo | null;
  /** The tax came from the company. */
  inherited: boolean;
  /** The tax used is still «por verificar». */
  toVerify: boolean;
  /**
   * Why `withTax` is null with a known price: `treatment` = nobody knows
   * whether the written price includes tax; `rate` = the rate is not known.
   * Null when `withTax` is known or the price is not.
   */
  missing: 'treatment' | 'rate' | null;
}

export type PricedOffer = Pick<
  Offer,
  'price' | 'vatIncluded' | 'tax' | 'companyTax'
>;

/**
 * Both sides of an offer's unit price. The written price is taken as the
 * offer records it (`vatIncluded`):
 * - before tax (false): with tax = price × (1 + rate);
 * - tax included (true): with tax = the price itself, whatever the rate;
 *   before tax = price ÷ (1 + rate) when the rate is known;
 * - not known (null): nothing is derived, unless the tax is `none` (no tax:
 *   both sides are the price).
 */
export function priceEstimate(offer: PricedOffer): PriceEstimate {
  const tax = effectiveTax(offer);
  const base = {
    tax,
    inherited: offer.tax === null && tax !== null,
    toVerify: tax?.verification === 'to_verify',
  };
  if (offer.price === null) {
    return {...base, beforeTax: null, withTax: null, missing: null};
  }
  const rate = taxRate(tax);
  if (offer.vatIncluded === true) {
    return {
      ...base,
      beforeTax: withoutTax(offer.price, tax),
      withTax: offer.price,
      missing: null,
    };
  }
  if (offer.vatIncluded === false || rate === 0) {
    const w = withTax(offer.price, tax);
    return {
      ...base,
      beforeTax: offer.price,
      withTax: w,
      missing: w === null ? 'rate' : null,
    };
  }
  return {...base, beforeTax: null, withTax: null, missing: 'treatment'};
}

/**
 * The copy an expense keeps of the offer it came from. `offer` must be the
 * full record (as stored, before any withholding).
 */
export function snapshotOf(
  offer: Pick<
    Offer,
    | 'id'
    | 'name'
    | 'company'
    | 'price'
    | 'unit'
    | 'customUnit'
    | 'vatIncluded'
    | 'tax'
    | 'companyTax'
    | 'transportCost'
    | 'assemblyCost'
    | 'maintenanceCost'
  >,
  at: IsoInstant,
): OfferSnapshot {
  const tax = effectiveTax(offer);
  return {
    offerId: offer.id,
    offerName: offer.name,
    companyName: offer.company.name,
    price: offer.price,
    unit: offer.unit,
    customUnit: offer.customUnit,
    vatIncluded: offer.vatIncluded,
    tax: tax ? {...tax} : null,
    taxInherited: offer.tax === null && tax !== null,
    transportCost: offer.transportCost,
    assemblyCost: offer.assemblyCost,
    maintenanceCost: offer.maintenanceCost,
    at,
  };
}

// ---------------------------------------------------------------- budget

type Costed = Pick<Expense, 'amount' | 'tax' | 'status'>;

/** Sums of a list of expenses; unknown amounts and taxes counted apart. */
export function expenseTotals(expenses: readonly Costed[]): ExpenseTotals {
  // Integer cents, so sums never drift.
  let before = 0;
  let after = 0;
  const out = {
    count: expenses.length,
    unknownAmount: 0,
    unknownTax: 0,
    taxToVerify: 0,
  };
  for (const e of expenses) {
    if (e.amount === null) {
      out.unknownAmount++;
      continue;
    }
    before += Math.round(e.amount * 100);
    const w = withTax(e.amount, e.tax);
    if (w === null) {
      out.unknownTax++;
      continue;
    }
    after += Math.round(w * 100);
    if (e.tax?.verification === 'to_verify') out.taxToVerify++;
  }
  return {...out, beforeTax: before / 100, withTax: after / 100};
}

/**
 * An event's budget at a glance: planned, confirmed and both, before tax
 * and with tax («estimación»), and what remains of the budget (which counts
 * taxes in) against the estimate with tax. `incomplete` when an expense is
 * missing from that estimate (unknown amount or tax): the remaining figure
 * is then optimistic.
 */
export function budgetSummary(
  budget: Pick<EventBudget, 'eventId' | 'amount'>,
  expenses: readonly Costed[],
): BudgetSummary {
  const planned = expenseTotals(expenses.filter(e => e.status === 'planned'));
  const confirmed = expenseTotals(
    expenses.filter(e => e.status === 'confirmed'),
  );
  const total = expenseTotals(expenses);
  return {
    eventId: budget.eventId,
    amount: budget.amount,
    planned,
    confirmed,
    total,
    remaining:
      budget.amount === null
        ? null
        : (Math.round(budget.amount * 100) - Math.round(total.withTax * 100)) /
          100,
    incomplete: total.unknownAmount + total.unknownTax > 0,
  };
}

/**
 * Share of the budget used by an amount (0–1+, for the gauge); null without
 * a budget or with a zero budget.
 */
export function budgetShare(
  amount: number,
  budget: number | null,
): number | null {
  if (budget === null || budget <= 0) return null;
  return amount / budget;
}
