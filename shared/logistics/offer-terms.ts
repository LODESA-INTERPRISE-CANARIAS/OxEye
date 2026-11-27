/**
 * Offer terms (Revisión 1 · E6): the total cost of a concrete need for one
 * offer version, comparison of offers by that total, expiry and renewal
 * dates. Pure; shared by the server and the UI.
 *
 * Honesty rules (same as money.ts):
 * - a part nobody priced stays unknown: it is listed apart and the total is
 *   null, never an invented figure; the priced parts are still summed
 *   (`knownBeforeTax`) so the UI can say «al menos»;
 * - a total with tax is always an estimate («estimación»);
 * - an expired offer (past `acceptUntil`) is history: never ranked as current;
 * - a pending proposal is shown where its total falls, without a position.
 */
import type {
  LocalDate,
  Offer,
  OfferTerms,
  OfferVersionStatus,
  PriceBasis,
  QuoteNeed,
  SeasonRate,
  Supplement,
  SupplementPer,
  TaxInfo,
} from './contracts.ts';
import {formatEuros} from './catalogue.ts';
import {effectiveTax, roundCents, taxRate} from './money.ts';
import {addDays, eachDate} from './time.ts';

// ---------------------------------------------------------------- limits and labels

export const TERMS_LABEL_MAX = 80;
export const TERMS_TEXT_MAX = 2000;
export const MAX_SEASON_RATES = 4;
export const MAX_SUPPLEMENTS = 12;
export const MAX_NOT_INCLUDED = 12;
export const COMMITMENT_YEARS_MIN = 2;
export const COMMITMENT_YEARS_MAX = 10;
export const MAX_NEED_QUANTITY = 100_000;
export const MAX_NEED_DAYS = 366;
/** An acceptance deadline is at most this far ahead (5 years). */
export const ACCEPT_UNTIL_MAX_DAYS = 5 * 366;

export const RENEWAL_NOTICE_OPTIONS = [15, 30, 60, 90] as const;
export const DEFAULT_RENEWAL_NOTICE_DAYS = 30;

/** The form's default seasons; each company may define its own. */
export const DEFAULT_SEASONS: readonly {
  key: 'verano' | 'lluvias';
  label: string;
  months: readonly number[];
}[] = [
  {key: 'verano', label: 'Verano', months: [6, 7, 8, 9]},
  {key: 'lluvias', label: 'Temporada de lluvias', months: [11, 12, 1, 2, 3]},
];

export const PRICE_BASES: readonly PriceBasis[] = [
  'unit_day',
  'person_day',
  'unit_event',
  'hour_person',
  'hour',
  'order',
  'service',
  'pack',
  'custom',
];

export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = {
  unit_day: 'por unidad y jornada',
  person_day: 'por persona y jornada',
  unit_event: 'por unidad, todo el evento',
  hour_person: 'por hora y persona',
  hour: 'por hora',
  order: 'por todo el pedido',
  service: 'por servicio',
  pack: 'por paquete',
  custom: 'otra unidad',
};

const MONTH_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** «jun – sep», «nov – mar», «todo el año», «ene, mar, may». */
export function monthsLabel(months: readonly number[] | null): string {
  if (months === null) return 'Pendiente de verificar';
  const set = [...new Set(months)].filter(m => m >= 1 && m <= 12);
  if (set.length === 12) return 'todo el año';
  if (set.length === 0) return 'ningún mes';
  // A run that may wrap the year end (nov – mar).
  const has = (m: number) => set.includes(((m - 1 + 12) % 12) + 1);
  const starts = set.filter(m => !has(m - 1));
  if (starts.length === 1) {
    const start = starts[0] as number;
    const end = ((start - 1 + set.length - 1) % 12) + 1;
    return set.length === 1
      ? (MONTH_SHORT[start - 1] as string)
      : `${MONTH_SHORT[start - 1]} – ${MONTH_SHORT[end - 1]}`;
  }
  return [...set]
    .sort((a, b) => a - b)
    .map(m => MONTH_SHORT[m - 1])
    .join(', ');
}

// ---------------------------------------------------------------- dates

const monthOf = (date: LocalDate) => Number(date.slice(5, 7));

/** Past its acceptance deadline (the deadline day itself still counts). */
export function isExpired(
  acceptUntil: LocalDate | null,
  today: LocalDate,
): boolean {
  return acceptUntil !== null && acceptUntil < today;
}

export function versionStatus(
  superseded: boolean,
  acceptUntil: LocalDate | null,
  today: LocalDate,
): OfferVersionStatus {
  if (superseded) return 'superseded';
  return isExpired(acceptUntil, today) ? 'expired' : 'current';
}

/**
 * Whether the company can serve on the need's dates: true / false, or null
 * when its months or the dates are not known.
 */
export function coversDates(
  serviceMonths: readonly number[] | null,
  dateFrom: LocalDate | null,
  dateTo: LocalDate | null,
): boolean | null {
  if (serviceMonths === null || dateFrom === null) return null;
  const dates = eachDate(dateFrom, dateTo ?? dateFrom);
  return dates.every(d => serviceMonths.includes(monthOf(d)));
}

/** First day a renegotiation task is due: `noticeDays` before the deadline. */
export function renewalStart(
  acceptUntil: LocalDate,
  noticeDays: number,
): LocalDate {
  return addDays(acceptUntil, -noticeDays);
}

/** A renegotiation task is due from `renewalStart` until the deadline itself. */
export function renewalDue(
  acceptUntil: LocalDate | null,
  noticeDays: number,
  today: LocalDate,
): boolean {
  if (acceptUntil === null) return false;
  return today >= renewalStart(acceptUntil, noticeDays) && today <= acceptUntil;
}

/** The first month that belongs to two seasons, or null. */
export function overlappingMonth(rates: readonly SeasonRate[]): number | null {
  const seen = new Set<number>();
  for (const r of rates) {
    for (const m of new Set(r.months)) {
      if (seen.has(m)) return m;
      seen.add(m);
    }
  }
  return null;
}

// ---------------------------------------------------------------- cost of a need

/** What `offerCost` needs to know about the need. */
export type NeedSpec = Pick<
  QuoteNeed,
  'quantity' | 'days' | 'hoursPerDay' | 'dateFrom' | 'dateTo'
>;

export type CostPartState = 'priced' | 'included' | 'unknown';

export interface CostPart {
  /** `base`, `minimum_order` or `supplement:<n>`. */
  key: string;
  label: string;
  /** «3 carpas × 4 jornadas × 195,00 €», «Incluido», «Sin precio». */
  detail: string | null;
  /** Euros before tax (or as written when `pricesIncludeTax`); null = unknown. */
  amount: number | null;
  state: CostPartState;
}

export interface CostTax {
  label: string;
  ratePercent: number | null;
  /** Null when the rate is not known. */
  amount: number | null;
  verified: boolean;
  /** The written prices include it. */
  included: boolean;
}

export interface OfferCost {
  /** Parts added to the total (base, supplements that always apply, minimum order). */
  parts: CostPart[];
  /** Supplements charged only if asked for: shown apart, never added. */
  onRequest: CostPart[];
  /** Labels of what has no price yet (including «Impuesto»): the total is null. */
  unknown: string[];
  /** Sum of the priced parts («al menos»). */
  knownSum: number;
  /** Before tax; null when a part or the tax treatment is unknown. */
  beforeTax: number | null;
  tax: CostTax | null;
  /** With tax («estimación»); null when anything is unknown. */
  total: number | null;
  /** Minimums, seasons and other reasons the figures are what they are. */
  notes: string[];
  billedDays: number;
  billedQuantity: number;
  /** The company serves on those dates (null = not known). */
  covers: boolean | null;
  /** The same need under the multi-year deal, if any (same rules). */
  commitment: {
    years: number;
    total: number | null;
    beforeTax: number | null;
  } | null;
}

const DAY_BASED: ReadonlySet<PriceBasis> = new Set([
  'unit_day',
  'person_day',
  'hour_person',
  'hour',
]);
const QUANTITY_BASED: ReadonlySet<PriceBasis> = new Set([
  'unit_day',
  'person_day',
  'unit_event',
  'hour_person',
]);

const euro = (n: number) => formatEuros(roundCents(n));

interface Base {
  amount: number | null;
  detail: string | null;
  reason: string | null;
  notes: string[];
  /** Base price used (the uniform one), for percent supplements. */
  unitPrice: number | null;
}

/**
 * Unit price of each charged day, or null when the season cannot be known.
 * Day `i` of the need is the `i`-th day from `dateFrom`; days beyond the
 * dates (a minimum) take the last day's price.
 */
function dayPrices(
  terms: OfferTerms,
  need: NeedSpec,
  billedDays: number,
): {prices: number[]; notes: string[]} | {reason: string} {
  const price = terms.price as number;
  if (terms.seasonal.length === 0) {
    return {prices: Array(billedDays).fill(price), notes: []};
  }
  if (!need.dateFrom) {
    return {
      reason:
        'Tiene tarifas de temporada y la necesidad no tiene fechas: no se sabe cuál aplica.',
    };
  }
  const rateOf = (d: LocalDate) =>
    terms.seasonal.find(r => r.months.includes(monthOf(d)));
  const dates = eachDate(need.dateFrom, need.dateTo ?? need.dateFrom);
  const perDate = dates.map(d => rateOf(d));
  const uniform = perDate.every(r => r === perDate[0]);
  let picked: (SeasonRate | undefined)[];
  if (uniform) {
    picked = Array(billedDays).fill(perDate[0]);
  } else if (dates.length === need.days) {
    picked = Array.from(
      {length: billedDays},
      (_, i) => perDate[Math.min(i, perDate.length - 1)],
    );
  } else {
    return {
      reason:
        'Las fechas caen en dos temporadas y no se sabe qué jornadas son: falta concretarlas.',
    };
  }
  const used = [...new Set(picked.filter((r): r is SeasonRate => !!r))];
  const notes = used.map(
    r =>
      `${r.label} (${monthsLabel(r.months)}): ${euro(r.price)} en vez de ${euro(price)}`,
  );
  return {prices: picked.map(r => r?.price ?? price), notes};
}

function baseCost(
  terms: OfferTerms,
  need: NeedSpec,
  days: number,
  qty: number,
): Base {
  const empty = {notes: [] as string[], unitPrice: null};
  if (terms.price === null) {
    return {...empty, amount: null, detail: 'Sin precio', reason: null};
  }
  if (terms.basis === 'pack' || terms.basis === 'custom') {
    return {
      ...empty,
      amount: null,
      detail: `Precio ${terms.basis === 'pack' ? 'por paquete' : (terms.customUnit ?? 'en otra unidad')}: no se puede calcular para esta necesidad`,
      reason: null,
    };
  }
  const hourly = terms.basis === 'hour_person' || terms.basis === 'hour';
  if (hourly && need.hoursPerDay === null) {
    return {
      ...empty,
      amount: null,
      detail: 'Precio por hora: faltan las horas por jornada',
      reason: null,
    };
  }
  const priced = DAY_BASED.has(terms.basis)
    ? dayPrices(terms, need, days)
    : dayPrices(terms, need, 1);
  if ('reason' in priced) {
    return {
      ...empty,
      amount: null,
      detail: priced.reason,
      reason: priced.reason,
    };
  }
  const prices = priced.prices;
  const unitPrice = prices.every(p => p === prices[0])
    ? (prices[0] ?? null)
    : null;
  const priceText =
    unitPrice !== null ? euro(unitPrice) : 'tarifas de temporada';
  const factor = QUANTITY_BASED.has(terms.basis) ? qty : 1;
  const hours = hourly ? (need.hoursPerDay as number) : 1;
  const sum = DAY_BASED.has(terms.basis)
    ? prices.reduce((s, p) => s + p * factor * hours, 0)
    : (prices[0] as number) * factor;
  const pieces: string[] = [];
  if (QUANTITY_BASED.has(terms.basis)) pieces.push(`${qty}`);
  if (hourly) pieces.push(`${hours} h`);
  if (DAY_BASED.has(terms.basis)) {
    pieces.push(`${days} ${days === 1 ? 'jornada' : 'jornadas'}`);
  }
  pieces.push(priceText);
  return {
    amount: roundCents(sum),
    detail: pieces.join(' × '),
    reason: null,
    notes: priced.notes,
    unitPrice,
  };
}

function supplementAmount(
  s: Supplement,
  base: Base,
  days: number,
  qty: number,
): number | null {
  if (s.amount === null) return null;
  const per: Record<SupplementPer, () => number | null> = {
    order: () => s.amount,
    unit: () => (s.amount as number) * qty,
    unit_day: () => (s.amount as number) * qty * days,
    day: () => (s.amount as number) * days,
    percent: () =>
      base.amount === null ? null : (base.amount * (s.amount as number)) / 100,
  };
  const v = per[s.per]();
  return v === null ? null : roundCents(v);
}

const SUPPLEMENT_DETAIL: Record<SupplementPer, (a: number) => string> = {
  order: () => 'Por pedido',
  unit: a => `Por unidad (${euro(a)})`,
  unit_day: a => `Por unidad y jornada (${euro(a)})`,
  day: a => `Por jornada (${euro(a)})`,
  percent: a => `${a.toLocaleString('es-ES')} % del precio`,
};

function supplementPart(
  s: Supplement,
  i: number,
  amount: number | null,
): CostPart {
  if (s.included) {
    return {
      key: `supplement:${i}`,
      label: s.label,
      detail: 'Incluido',
      amount: 0,
      state: 'included',
    };
  }
  return {
    key: `supplement:${i}`,
    label: s.label,
    detail:
      s.amount === null ? 'Sin precio' : SUPPLEMENT_DETAIL[s.per](s.amount),
    amount,
    state: amount === null ? 'unknown' : 'priced',
  };
}

function taxLabel(tax: TaxInfo): string {
  const name =
    tax.regime === 'igic'
      ? 'IGIC'
      : tax.regime === 'iva'
        ? 'IVA'
        : tax.regime === 'other'
          ? (tax.name ?? 'Impuesto')
          : tax.regime === 'none'
            ? 'Sin impuesto'
            : 'Impuesto sin saber';
  const rate = taxRate(tax);
  return rate !== null && tax.regime !== 'none'
    ? `${name} ${rate.toLocaleString('es-ES')} %`
    : name;
}

/**
 * The cost of `need` under `terms`, with its breakdown. `tax` is the tax that
 * applies (the version's own, else the offer's effective one: see
 * `termsTax`). Nothing unknown is invented: such parts are listed in
 * `unknown` and the totals are null.
 */
export function offerCost(
  terms: OfferTerms,
  need: NeedSpec,
  tax: TaxInfo | null,
): OfferCost {
  const notes: string[] = [];
  const dayBased = DAY_BASED.has(terms.basis);
  const qtyBased = QUANTITY_BASED.has(terms.basis);
  const billedDays =
    dayBased && terms.minimumDays !== null
      ? Math.max(need.days, terms.minimumDays)
      : need.days;
  const billedQuantity =
    qtyBased && terms.minimumQuantity !== null
      ? Math.max(need.quantity, terms.minimumQuantity)
      : need.quantity;
  if (billedDays > need.days) {
    notes.push(
      `Mínimo ${terms.minimumDays} jornadas: se cobran ${billedDays} aunque se necesiten ${need.days}.`,
    );
  }
  if (billedQuantity > need.quantity) {
    notes.push(
      `Mínimo ${terms.minimumQuantity} unidades: se cobran ${billedQuantity} aunque se necesiten ${need.quantity}.`,
    );
  }

  const base = baseCost(terms, need, billedDays, billedQuantity);
  notes.push(...base.notes);
  const parts: CostPart[] = [
    {
      key: 'base',
      label: 'Precio',
      detail: base.detail,
      amount: base.amount,
      state: base.amount === null ? 'unknown' : 'priced',
    },
  ];
  const onRequest: CostPart[] = [];
  terms.supplements.forEach((s, i) => {
    const amount = s.included
      ? 0
      : supplementAmount(s, base, billedDays, billedQuantity);
    const part = supplementPart(s, i, amount);
    (s.applies === 'on_request' && !s.included ? onRequest : parts).push(part);
  });

  let knownSum = parts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const unknown = parts.filter(p => p.state === 'unknown').map(p => p.label);
  if (terms.minimumOrder !== null) {
    if (unknown.length === 0 && knownSum < terms.minimumOrder) {
      const topUp = roundCents(terms.minimumOrder - knownSum);
      parts.push({
        key: 'minimum_order',
        label: 'Pedido mínimo',
        detail: `Se cobra al menos ${euro(terms.minimumOrder)}`,
        amount: topUp,
        state: 'priced',
      });
      knownSum += topUp;
    } else if (unknown.length > 0) {
      notes.push(`Pedido mínimo de ${euro(terms.minimumOrder)}.`);
    }
  }
  knownSum = roundCents(knownSum);

  const sum = unknown.length === 0 ? knownSum : null;
  const rate = taxRate(tax);
  let beforeTax: number | null = null;
  let total: number | null = null;
  let costTax: CostTax | null = null;
  if (tax) {
    costTax = {
      label: taxLabel(tax),
      ratePercent: rate,
      amount: null,
      verified: tax.verification === 'validated',
      included: terms.pricesIncludeTax === true,
    };
  }
  if (sum !== null) {
    if (terms.pricesIncludeTax === true) {
      total = sum;
      beforeTax = rate === null ? null : roundCents(sum / (1 + rate / 100));
    } else if (terms.pricesIncludeTax === false || rate === 0) {
      beforeTax = sum;
      total = rate === null ? null : roundCents(sum * (1 + rate / 100));
    }
    if (costTax && beforeTax !== null && total !== null) {
      costTax.amount = roundCents(total - beforeTax);
    }
  }
  if (rate === null && terms.pricesIncludeTax !== true)
    {unknown.push('Impuesto');}
  if (terms.pricesIncludeTax === null && rate !== 0) {
    unknown.push('Si el precio incluye impuesto');
  }

  let commitment: OfferCost['commitment'] = null;
  if (terms.commitment) {
    if (terms.commitment.price === null) {
      commitment = {
        years: terms.commitment.years,
        total: null,
        beforeTax: null,
      };
    } else {
      const c = offerCost(
        {
          ...terms,
          price: terms.commitment.price,
          seasonal: [],
          commitment: null,
        },
        need,
        tax,
      );
      commitment = {
        years: terms.commitment.years,
        total: c.total,
        beforeTax: c.beforeTax,
      };
    }
  }

  return {
    parts,
    onRequest,
    unknown,
    knownSum,
    beforeTax,
    tax: costTax,
    total,
    notes,
    billedDays,
    billedQuantity,
    covers: coversDates(terms.serviceMonths, need.dateFrom, need.dateTo),
    commitment,
  };
}

// ---------------------------------------------------------------- terms of offers without versions

const LEGACY_BASIS: Record<Offer['unit'], PriceBasis> = {
  unit: 'unit_event',
  day: 'unit_day',
  hour: 'hour',
  pack: 'pack',
  metre: 'custom',
  km: 'custom',
  custom: 'custom',
};

const LEGACY_UNIT_WORDING: Partial<Record<Offer['unit'], string>> = {
  metre: 'por metro',
  km: 'por kilómetro',
};

/**
 * The terms an offer recorded before E6 implies: its price and unit, and its
 * known costs as supplements per order. Unknown costs (null) are left out:
 * M3 never said whether they exist. No dates are known.
 */
export function legacyTerms(
  offer: Pick<
    Offer,
    | 'price'
    | 'unit'
    | 'customUnit'
    | 'transportCost'
    | 'assemblyCost'
    | 'maintenanceCost'
    | 'conditions'
    | 'vatIncluded'
  >,
): OfferTerms {
  const supplements: Supplement[] = [];
  const add = (
    label: string,
    kind: Supplement['kind'],
    amount: number | null,
  ) => {
    if (amount === null) return;
    supplements.push({
      label,
      kind,
      included: amount === 0,
      amount,
      per: 'order',
      applies: 'always',
    });
  };
  add('Transporte', 'transport', offer.transportCost);
  add('Montaje', 'assembly', offer.assemblyCost);
  add('Mantenimiento', 'maintenance', offer.maintenanceCost);
  return {
    basis: LEGACY_BASIS[offer.unit],
    customUnit:
      offer.unit === 'custom'
        ? offer.customUnit
        : (LEGACY_UNIT_WORDING[offer.unit] ?? null),
    price: offer.price,
    pricesIncludeTax: offer.vatIncluded,
    seasonal: [],
    supplements,
    notIncluded: [],
    minimumDays: null,
    minimumQuantity: null,
    minimumOrder: null,
    acceptUntil: null,
    serviceMonths: null,
    serviceNote: null,
    commitment: null,
    conditions: offer.conditions,
    available: null,
    tax: null,
  };
}

/** The tax a version's cost uses: its own, else the offer's effective one (E5). */
export function termsTax(
  terms: Pick<OfferTerms, 'tax'>,
  offer: (Pick<Offer, 'tax'> & Partial<Pick<Offer, 'companyTax'>>) | null,
): TaxInfo | null {
  if (terms.tax) return terms.tax;
  return offer ? effectiveTax(offer) : null;
}

// ---------------------------------------------------------------- comparison

export interface Candidate<T> {
  item: T;
  terms: OfferTerms;
  tax: TaxInfo | null;
  /** A proposal still waiting for approval. */
  pending: boolean;
}

export interface ComparedRow<T> {
  item: T;
  cost: OfferCost;
  /** 1, 2, 3… among approved offers (equal totals share it); null for pending. */
  rank: number | null;
  pending: boolean;
}

export interface NeedComparison<T> {
  /** Known total, current and able to serve the dates: cheapest first. */
  ranked: ComparedRow<T>[];
  /** Current, but its total is unknown (a price or the tax is missing). */
  unknown: ComparedRow<T>[];
  /** Current, but the company does not serve on those dates. */
  unavailable: ComparedRow<T>[];
  /** Past their acceptance deadline: history only. */
  expired: ComparedRow<T>[];
}

/**
 * Compares candidates by the total cost of one need. Expired ones are never
 * compared as current; pending proposals appear where their total falls,
 * without a position (and so never with a medal).
 */
export function compareNeed<T>(
  candidates: readonly Candidate<T>[],
  need: NeedSpec,
  today: LocalDate,
): NeedComparison<T> {
  const out: NeedComparison<T> = {
    ranked: [],
    unknown: [],
    unavailable: [],
    expired: [],
  };
  for (const c of candidates) {
    const row: ComparedRow<T> = {
      item: c.item,
      cost: offerCost(c.terms, need, c.tax),
      rank: null,
      pending: c.pending,
    };
    if (isExpired(c.terms.acceptUntil, today)) out.expired.push(row);
    else if (row.cost.covers === false) out.unavailable.push(row);
    else if (row.cost.total === null) out.unknown.push(row);
    else out.ranked.push(row);
  }
  out.ranked.sort(
    (a, b) => (a.cost.total as number) - (b.cost.total as number),
  );
  let position = 0;
  let lastTotal: number | null = null;
  let lastRank = 0;
  for (const row of out.ranked) {
    if (row.pending) continue;
    position++;
    if (row.cost.total !== lastTotal) lastRank = position;
    row.rank = lastRank;
    lastTotal = row.cost.total;
  }
  return out;
}
