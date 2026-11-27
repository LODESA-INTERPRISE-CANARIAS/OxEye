/**
 * Mock-up only: total cost of a concrete need for one offer (quantity × days
 * + extras + tax), with its breakdown. The real calculation will live in
 * `shared/logistics/` (E6) and be tested there; this file only gives the
 * mock-up believable numbers.
 */
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import type {MockOffer, NeedDef, OfferExtra} from './data';
import {MOCK_TODAY, TAX_LABEL} from './data';

export interface CostLine {
  label: string;
  detail?: string;
  amount: number | null;
}

export interface NeedCost {
  offer: MockOffer;
  lines: CostLine[];
  /** Base price used, after picking the seasonal rate. */
  unitPrice: number;
  seasonNote: string | null;
  minimumNote: string | null;
  beforeTax: number;
  /** Extras whose price nobody has given yet. */
  unpricedExtras: string[];
  tax: {label: string; amount: number} | null;
  /** Null when the tax is unknown: never ranked as a total. */
  total: number | null;
  expired: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function eur(n: number): string {
  return formatEuros(round2(n));
}

export function isExpired(offer: MockOffer): boolean {
  return offer.acceptUntil < MOCK_TODAY;
}

function extraAmount(extra: OfferExtra, need: NeedDef): number | null {
  if (extra.amount === null) return null;
  return extra.per === 'unit' ? extra.amount * need.quantity : extra.amount;
}

export function needCost(offer: MockOffer, need: NeedDef): NeedCost {
  const seasonal = offer.seasonal?.find(s => s.season === need.season);
  const unitPrice = seasonal?.price ?? offer.unitPrice;
  const seasonNote = seasonal
    ? `${seasonal.label} (${seasonal.months}): ${eur(seasonal.price)} en vez de ${eur(offer.unitPrice)}`
    : null;
  const days = Math.max(need.days, offer.minimumDays ?? 0);
  const minimumNote =
    offer.minimumDays && offer.minimumDays > need.days
      ? `Mínimo ${offer.minimumDays} jornadas: se cobran ${days} aunque el evento dure ${need.days}`
      : null;
  const [one, many] = need.quantityUnit;
  const qty = `${need.quantity} ${need.quantity === 1 ? one : many}`;

  let base: number;
  let detail: string;
  switch (offer.priceUnit) {
    case 'hour_person':
      base = need.quantity * (need.hours ?? 8) * days * unitPrice;
      detail = `${qty} × ${need.hours ?? 8} h × ${days} jornadas × ${eur(unitPrice)}`;
      break;
    case 'unit_event':
      base = need.quantity * unitPrice;
      detail = `${qty} × ${eur(unitPrice)}`;
      break;
    default:
      base = need.quantity * days * unitPrice;
      detail = `${qty} × ${days} jornadas × ${eur(unitPrice)}`;
  }

  const lines: CostLine[] = [{label: 'Precio', detail, amount: base}];
  const unpricedExtras: string[] = [];
  let beforeTax = base;
  for (const extra of offer.extras) {
    const included = offer.included.some(i =>
      extra.label.toLowerCase().startsWith(i.toLowerCase()),
    );
    if (included) {
      lines.push({label: extra.label, detail: 'Incluido', amount: 0});
      continue;
    }
    const amount = extraAmount(extra, need);
    if (amount === null) {
      unpricedExtras.push(extra.label.toLowerCase());
      lines.push({label: extra.label, detail: 'Sin precio', amount: null});
      continue;
    }
    beforeTax += amount;
    lines.push({
      label: extra.label,
      detail:
        extra.per === 'unit'
          ? `${qty} × ${eur(extra.amount ?? 0)}`
          : 'Por pedido',
      amount,
    });
  }

  let tax: NeedCost['tax'] = null;
  let total: number | null = null;
  if (offer.tax.kind === 'igic' || offer.tax.kind === 'iva') {
    const rate = offer.tax.rate ?? 0;
    tax = {
      label: `${TAX_LABEL[offer.tax.kind]} ${rate} %`,
      amount: round2((beforeTax * rate) / 100),
    };
    total = round2(beforeTax + tax.amount);
  } else if (offer.tax.kind === 'none') {
    tax = {label: 'Sin impuesto', amount: 0};
    total = round2(beforeTax);
  }

  return {
    offer,
    lines,
    unitPrice,
    seasonNote,
    minimumNote,
    beforeTax: round2(beforeTax),
    unpricedExtras,
    tax,
    total,
    expired: isExpired(offer),
  };
}

export interface Ranking {
  ranked: NeedCost[];
  unknownTax: NeedCost[];
  expired: NeedCost[];
}

/** Current offers with a known tax ranked by estimated total. */
export function rankNeed(offers: MockOffer[], need: NeedDef): Ranking {
  const costs = offers
    .filter(o => o.needIds.includes(need.id))
    .map(o => needCost(o, need));
  const expired = costs.filter(c => c.expired);
  const live = costs.filter(c => !c.expired);
  const ranked = live
    .filter(c => c.total !== null)
    .sort((a, b) => (a.total ?? 0) - (b.total ?? 0));
  const unknownTax = live.filter(c => c.total === null);
  return {ranked, unknownTax, expired};
}
