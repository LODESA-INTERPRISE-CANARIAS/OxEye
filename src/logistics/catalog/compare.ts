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
import type {PriceEstimate} from '../../../shared/logistics/money.ts';

export {
  categoriesWithComparison,
  compareCategory,
} from '../../../shared/logistics/catalogue.ts';
export type {
  ApartReason,
  CategoryComparison,
  RankedGroup,
} from '../../../shared/logistics/catalogue.ts';

export const APART_REASON_LABEL: Record<ApartReason, string> = {
  price: 'sin precio',
  tax: 'sin impuesto conocido',
  unit: 'unidad sin concretar',
  alone: 'ninguna otra igual',
};

/** Why an offer is not ranked, in a full sentence (lists apart). */
export function apartReasonText(
  reason: ApartReason,
  estimate?: PriceEstimate,
): string {
  switch (reason) {
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
  'Solo se comparan ofertas de la misma categoría y la misma unidad (€/día con €/día, nunca con €/metro). Se ordenan por el precio por unidad con impuestos, usando el impuesto de cada oferta (el suyo o, si no tiene, el de su empresa): así un precio con IGIC y otro con IVA se comparan de forma justa. Esa cifra es una estimación. Transporte, montaje y mantenimiento van aparte. Las ofertas sin precio o sin impuesto conocido se listan aparte y no se ordenan: sumarles un impuesto que nadie ha indicado sería inventar. Las medallas solo dicen cuál es más barata por unidad, no cuál conviene más.';

/** Taxes as an old offer declares them, never assumed. */
export function vatText(vatIncluded: boolean | null): string {
  if (vatIncluded === true) return 'Impuestos incluidos';
  if (vatIncluded === false) return 'Sin impuestos';
  return 'Impuestos sin verificar';
}

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
