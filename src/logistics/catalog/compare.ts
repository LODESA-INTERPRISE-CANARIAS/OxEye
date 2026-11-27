/**
 * «Comparar» for the catalogue (Revisión 1 · E5). The ranking itself is the
 * shared rule in `shared/logistics/catalogue.ts`: same category and unit,
 * ranked together by the estimated unit price with tax, each offer with its
 * own tax (its own, else its company's). An offer whose price with tax
 * cannot be estimated (unknown price, unknown tax or tax treatment) is
 * listed apart with the reason, never ranked with a guessed tax. This file
 * only words it for the screens.
 */
import type {ApartReason} from '../../../shared/logistics/catalogue.ts';
import type {
  LocalDate,
  OfferVersion,
} from '../../../shared/logistics/contracts.ts';
import type {PriceEstimate} from '../../../shared/logistics/money.ts';
import {validityOf} from '../offers/format';

export {
  categoriesWithComparison,
  compareCategory,
} from '../../../shared/logistics/catalogue.ts';
export type {
  ApartReason,
  CategoryComparison,
  CompareOptions,
  RankedGroup,
} from '../../../shared/logistics/catalogue.ts';

const NONE: ReadonlySet<string> = new Set();

/**
 * E6: ids of the offers whose current version can no longer be accepted
 * (marked expired, or its «se puede aceptar hasta» has passed). An offer
 * without versions (recorded before E6) is not in the list: it counts as
 * current.
 */
export function expiredOfferIds(
  versions: readonly OfferVersion[] | null | undefined,
  today: LocalDate,
): ReadonlySet<string> {
  if (!versions?.length) return NONE;
  const out = new Set<string>();
  for (const v of versions) {
    if (
      v.status === 'expired' ||
      validityOf(v.terms.acceptUntil, today).kind === 'expired'
    ) {
      out.add(v.offerId);
    }
  }
  return out;
}

/** Why an offer is not ranked, in a full sentence (lists apart). */
export function apartReasonText(
  reason: ApartReason,
  estimate?: PriceEstimate,
): string {
  switch (reason) {
    case 'expired':
      return 'Caducada: ya no se puede aceptar con estas condiciones.';
    case 'price':
      return 'Sin precio: no se puede situar.';
    case 'unit':
      return 'La unidad de contratación está sin concretar.';
    case 'alone':
      return 'No hay otra oferta igual con la que ordenarla.';
    case 'tax':
      return estimate?.missing === 'treatment'
        ? 'No consta si su precio incluye impuestos.'
        : !estimate?.tax
          ? 'La empresa no tiene impuesto indicado.'
          : 'Falta el porcentaje de su impuesto.';
  }
}

/** The `?` of «Comparar», in the offer sheet and in the catalogue. */
export const COMPARE_HELP =
  'Solo se comparan ofertas de la misma categoría y la misma unidad (€/día con €/día, nunca con €/metro). Se ordenan por el precio por unidad con impuestos, usando el impuesto de cada oferta (el suyo o, si no tiene, el de su empresa): así un precio con IGIC y otro con IVA se comparan de forma justa. Esa cifra es una estimación. Transporte, montaje y mantenimiento van aparte. Las ofertas sin precio o sin impuesto conocido se listan aparte y no se ordenan: sumarles un impuesto que nadie ha indicado sería inventar. Las caducadas también van aparte: ya no se pueden aceptar tal cual. Dos ofertas que cuestan lo mismo comparten puesto. Las medallas solo dicen cuál es más barata por unidad, no cuál conviene más.';

/** «1.º, oro» … for the medals; plain «4.º» after the podium. */
export function positionLabel(position: number): string {
  const medal = MEDAL[position as 1 | 2 | 3];
  return medal ? `${position}.º, ${medal.label}` : `${position}.º`;
}

export const MEDAL: Record<1 | 2 | 3, {tone: string; label: string}> = {
  1: {tone: 'gold', label: 'oro'},
  2: {tone: 'silver', label: 'plata'},
  3: {tone: 'bronze', label: 'bronce'},
};
