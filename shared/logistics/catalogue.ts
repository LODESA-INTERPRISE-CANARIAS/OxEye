/**
 * Catalogue presentation rules shared by the UI and the tests: labels, price
 * units, cost lines and like-for-like comparison of offers.
 *
 * Honesty rules: an unknown amount stays unknown (never 0, never summed into
 * a total), and offers are only compared when they share category and unit,
 * so «€/día» is never ranked against «€/metro». A billing unit such as «kg»
 * never derives a load per square metre or answers a heavy-load question.
 *
 * Revisión 1 · E5: offers with different taxes are ranked together by their
 * estimated unit price with tax, each with its own effective tax (its own,
 * else its company's: `priceEstimate` in money.ts). An offer whose price with
 * tax cannot be derived (tax treatment or rate unknown) stays apart.
 */
import type {Offer, PriceUnit} from './contracts.ts';
import {priceEstimate} from './money.ts';
import type {PriceEstimate} from './money.ts';
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

/** What an offer needs to be compared (E5: its tax and its company's). */
export type Comparable = Pick<
  Offer,
  | 'id'
  | 'name'
  | 'categoryId'
  | 'unit'
  | 'customUnit'
  | 'price'
  | 'vatIncluded'
  | 'tax'
  | 'companyTax'
>;

export interface Comparison<T> {
  /**
   * Every offer of the same category and unit whose unit price with tax can
   * be estimated, cheapest first by that estimate (ties by name), whatever
   * their tax. Includes this offer when it is ranked.
   */
  peers: T[];
  /** 1-based position of the offer among `peers`; null when it is not ranked. */
  position: number | null;
  /**
   * The estimate of every offer of the group (this one included), by id:
   * before tax, with tax («estimación»), the tax used and whether it is
   * still «por verificar».
   */
  estimates: Readonly<Record<string, PriceEstimate>>;
  /**
   * Same category and unit, known price, but its price with tax cannot be
   * estimated (nobody knows whether it includes tax, or the rate is
   * unknown): listed apart by name, never ranked (`estimates[id].missing`
   * says which).
   */
  unknownTax: T[];
  /** @deprecated E5: the same list as `unknownTax` (kept while the UI moves over). */
  otherTax: T[];
  /** Same category and unit, price unknown: listed apart, never ranked. */
  unpriced: T[];
}

const byName = <T extends Pick<Offer, 'name'>>(a: T, b: T) =>
  a.name.localeCompare(b.name, 'es');

/** Ranking order: estimate with tax, then name. */
function byEstimate<T extends Comparable>(
  estimates: Readonly<Record<string, PriceEstimate>>,
) {
  return (a: T, b: T) =>
    (estimates[a.id]?.withTax as number) -
      (estimates[b.id]?.withTax as number) || byName(a, b);
}

/** Ranks one like-for-like group (same comparison key). */
function rankGroup<T extends Comparable>(same: readonly T[]) {
  const estimates: Record<string, PriceEstimate> = {};
  for (const o of same) estimates[o.id] = priceEstimate(o);
  const peers = same
    .filter(o => estimates[o.id]?.withTax !== null)
    .sort(byEstimate(estimates));
  const unknownTax = same
    .filter(o => o.price !== null && estimates[o.id]?.withTax === null)
    .sort(byName);
  const unpriced = same.filter(o => o.price === null);
  return {estimates, peers, unknownTax, unpriced};
}

/**
 * Like-for-like comparison for one offer: the offers of the same category
 * and unit, ranked by their unit price with tax (an estimate), each with its
 * own effective tax, so «100 € con IGIC» and «95 € + 21 % IVA» are compared
 * fairly. An offer whose price with tax cannot be estimated is listed apart.
 * Returns null when the offer has no category or its custom unit is still
 * unknown (nothing honest to compare against).
 */
export function compareOffer<T extends Comparable>(
  offer: T,
  offers: readonly T[],
): Comparison<T> | null {
  const key = comparisonKey(offer);
  if (!key) return null;
  const same = offers.filter(o => comparisonKey(o) === key);
  if (!same.some(o => o.id === offer.id)) same.push(offer);
  const {estimates, peers, unknownTax, unpriced} = rankGroup(same);
  const others = (list: T[]) => list.filter(o => o.id !== offer.id);
  const index = peers.findIndex(o => o.id === offer.id);
  const apart = others(unknownTax);
  return {
    peers,
    position: index >= 0 ? index + 1 : null,
    estimates,
    unknownTax: apart,
    otherTax: apart,
    unpriced: others(unpriced),
  };
}

export interface RankedGroup<T> {
  /** The comparison key (category + unit): stable across renders. */
  key: string;
  /** Cheapest first by the estimate with tax (ties by name), at least two. */
  peers: T[];
  estimates: Readonly<Record<string, PriceEstimate>>;
}

/** Why an offer of the category is not in any ranked group. */
export type ApartReason = 'price' | 'tax' | 'unit' | 'alone';

export interface CategoryComparison<T> {
  groups: RankedGroup<T>[];
  /** Offers of the category that no group ranks, and why. */
  apart: {offer: T; reason: ApartReason; estimate: PriceEstimate}[];
}

/**
 * «Comparar» for a whole category: one ranked group per unit (carpas por
 * día, carpas por unidad), never ranked across groups; the rest apart with
 * the reason (`price` unknown, `tax` = the price with tax cannot be
 * estimated, `unit` not concrete, `alone` = nothing like it to rank with).
 */
export function compareCategory<T extends Comparable>(
  categoryId: string,
  offers: readonly T[],
): CategoryComparison<T> {
  const inCategory = offers.filter(o => o.categoryId === categoryId);
  const byKey = new Map<string, T[]>();
  for (const o of inCategory) {
    const key = comparisonKey(o);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), o]);
  }
  const groups: RankedGroup<T>[] = [];
  const ranked = new Set<string>();
  const estimates: Record<string, PriceEstimate> = {};
  for (const [key, same] of byKey) {
    const group = rankGroup(same);
    Object.assign(estimates, group.estimates);
    if (group.peers.length < 2) continue;
    groups.push({key, peers: group.peers, estimates: group.estimates});
    for (const p of group.peers) ranked.add(p.id);
  }
  groups.sort(
    (a, b) => b.peers.length - a.peers.length || a.key.localeCompare(b.key),
  );
  const apart = inCategory
    .filter(o => !ranked.has(o.id))
    .map(offer => {
      const estimate = estimates[offer.id] ?? priceEstimate(offer);
      const reason: ApartReason =
        offer.price === null
          ? 'price'
          : !comparisonKey(offer)
            ? 'unit'
            : estimate.withTax === null
              ? 'tax'
              : 'alone';
      return {offer, reason, estimate};
    });
  return {groups, apart};
}

/** Categories where «Comparar» has something to rank. */
export function categoriesWithComparison<T extends Comparable>(
  offers: readonly T[],
): Set<string> {
  const out = new Set<string>();
  const ids = new Set(
    offers.map(o => o.categoryId).filter((x): x is string => !!x),
  );
  for (const id of ids) {
    if (compareCategory(id, offers).groups.length) out.add(id);
  }
  return out;
}
