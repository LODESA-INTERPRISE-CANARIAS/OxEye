/**
 * Catalogue presentation rules shared by the UI and the tests: labels, price
 * units, cost lines and like-for-like comparison of offers.
 *
 * Honesty rules: an unknown amount stays unknown (never 0, never summed into
 * a total), and offers are only compared when they share category and unit,
 * so «€/día» is never ranked against «€/metro». A billing unit such as «kg»
 * never derives a load per square metre or answers a heavy-load question.
 */
import type {Offer, PriceUnit} from './contracts.ts';
import {normalize} from './search.ts';

export {COMPANY_KIND_LABEL} from './rules.ts';

/** Names of the units in pickers. */
export const PRICE_UNIT_LABEL: Record<PriceUnit, string> = {
  unit: 'Unidad',
  metre: 'Metro',
  hour: 'Hora',
  day: 'Día',
  km: 'Kilómetro',
  pack: 'Paquete',
  custom: 'Otra',
};

const PER_UNIT: Record<Exclude<PriceUnit, 'custom'>, string> = {
  unit: 'unidad',
  metre: 'm',
  hour: 'hora',
  day: 'día',
  km: 'km',
  pack: 'paquete',
};

/** «día», «m», or the custom wording («escenario»); null for a custom unit not yet known. */
export function perUnitLabel(
  offer: Pick<Offer, 'unit' | 'customUnit'>,
): string | null {
  if (offer.unit !== 'custom') return PER_UNIT[offer.unit];
  const custom = offer.customUnit?.trim();
  return custom ? custom.replace(/^por\s+/i, '') : null;
}

const EUROS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const EUROS_CENTS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** «1.250 €», «12,50 €» (cents only when there are any). */
export function formatEuros(amount: number): string {
  return Number.isInteger(amount)
    ? EUROS.format(amount)
    : EUROS_CENTS.format(amount);
}

/** «120 € / día»; null when the price is unknown or withheld. */
export function priceLabel(
  offer: Pick<Offer, 'price' | 'unit' | 'customUnit'>,
): string | null {
  if (offer.price === null) return null;
  const per = perUnitLabel(offer);
  return per
    ? `${formatEuros(offer.price)} / ${per}`
    : formatEuros(offer.price);
}

export type CostKey = 'price' | 'transport' | 'assembly' | 'maintenance';

export interface CostLine {
  key: CostKey;
  label: string;
  /** null = unknown («Pendiente de verificar») or withheld (`restricted`). */
  amount: number | null;
}

/**
 * The price and the three separate costs, in display order. They are never
 * added up: the price is per unit and the extras are per offer, and an
 * unknown extra would make any total false.
 */
export function costLines(
  offer: Pick<
    Offer,
    | 'price'
    | 'unit'
    | 'customUnit'
    | 'transportCost'
    | 'assemblyCost'
    | 'maintenanceCost'
  >,
): CostLine[] {
  const per = perUnitLabel(offer);
  return [
    {
      key: 'price',
      label: per ? `Precio por ${per}` : 'Precio',
      amount: offer.price,
    },
    {key: 'transport', label: 'Transporte', amount: offer.transportCost},
    {key: 'assembly', label: 'Montaje', amount: offer.assemblyCost},
    {key: 'maintenance', label: 'Mantenimiento', amount: offer.maintenanceCost},
  ];
}

/** Extras still unknown, as «transporte», «montaje»… for «+ transporte pendiente». */
export function pendingExtras(
  offer: Pick<
    Offer,
    'transportCost' | 'assemblyCost' | 'maintenanceCost' | 'restricted'
  >,
): string[] {
  if (offer.restricted) return [];
  const out: string[] = [];
  if (offer.transportCost === null) out.push('transporte');
  if (offer.assemblyCost === null) out.push('montaje');
  if (offer.maintenanceCost === null) out.push('mantenimiento');
  return out;
}

/** Key under which two offers are comparable: same category and same unit wording. */
export function comparisonKey(
  offer: Pick<Offer, 'categoryId' | 'unit' | 'customUnit'>,
): string | null {
  if (!offer.categoryId) return null;
  if (offer.unit === 'custom') {
    const custom = offer.customUnit
      ? normalize(offer.customUnit).replace(/^por /, '')
      : '';
    if (!custom) return null;
    return `${offer.categoryId}|custom:${custom}`;
  }
  return `${offer.categoryId}|${offer.unit}`;
}

export interface Comparison<T> {
  /**
   * Ranked offers: known price and the same known tax treatment
   * (`vatIncluded`) as this offer, cheapest first (ties by name). Includes
   * this offer when it is ranked. Empty when this offer's tax treatment or
   * price is unknown.
   */
  peers: T[];
  /** 1-based position of the offer among `peers`; null when it is not ranked. */
  position: number | null;
  /**
   * Same category and unit with a known price but a different or unknown tax
   * treatment: shown for reference (cheapest first), never ranked against
   * this offer («IGIC/IVA distinto o sin verificar»).
   */
  otherTax: T[];
  /** Same category and unit, price unknown: listed apart, never ranked. */
  unpriced: T[];
}

const byPrice = <T extends Pick<Offer, 'name' | 'price'>>(a: T, b: T) =>
  (a.price as number) - (b.price as number) ||
  a.name.localeCompare(b.name, 'es');

/**
 * Like-for-like comparison for one offer: the other offers of the same
 * category and unit. Prices are only ranked when both sides declare the same
 * tax treatment (taxes included, or not included): «100 € con impuestos» is
 * never called dearer than «95 € sin impuestos». Returns null when the offer
 * has no category or its custom unit is still unknown (nothing honest to
 * compare against).
 */
export function compareOffer<
  T extends Pick<
    Offer,
    | 'id'
    | 'name'
    | 'categoryId'
    | 'unit'
    | 'customUnit'
    | 'price'
    | 'vatIncluded'
  >,
>(offer: T, offers: T[]): Comparison<T> | null {
  const key = comparisonKey(offer);
  if (!key) return null;
  const same = offers.filter(o => comparisonKey(o) === key);
  const basis = offer.price === null ? null : offer.vatIncluded;
  const ranked = (o: T) =>
    basis !== null && o.price !== null && o.vatIncluded === basis;
  const peers = same.filter(ranked).sort(byPrice);
  const otherTax = same
    .filter(o => o.price !== null && o.id !== offer.id && !ranked(o))
    .sort(byPrice);
  const unpriced = same.filter(o => o.price === null && o.id !== offer.id);
  const index = peers.findIndex(o => o.id === offer.id);
  return {peers, position: index >= 0 ? index + 1 : null, otherTax, unpriced};
}
