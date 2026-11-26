/**
 * Inventory helpers shared by the server and the UI: reading and writing
 * quantities the way people type them on site, and the short labels of a
 * resource. Quantity, unit and dimensions are descriptive only: nothing here
 * multiplies them into a weight or a load per area (that question belongs to
 * the simulator's X-ray check).
 */
import type {Resource} from './contracts.ts';
import {DEFAULT_RESOURCE_UNIT, isValidQuantity} from './rules.ts';

const QUANTITY_FORMAT = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 2,
  useGrouping: true,
});

/** 1500 → «1500», 2.5 → «2,5» (Spanish style, at most two decimals). */
export function formatQuantity(value: number): string {
  return QUANTITY_FORMAT.format(value);
}

/**
 * A quantity typed in a form: «200», «2,5», «1.000» (thousands) or «0.5».
 * Dots that split groups of three digits after a non-zero lead are
 * thousands separators, as in Spanish writing («1.000», «12.500»); otherwise
 * a dot is a decimal point («0.500» = 0,5, as for euros). Returns null for an
 * empty field and NaN for anything that is not a valid quantity.
 */
export function parseQuantity(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return null;
  let normalized: string;
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) {
    normalized = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+(,\d+)?$/.test(t)) {
    normalized = t.replace(',', '.');
  } else if (/^\d+\.\d+$/.test(t) || /^\d+$/.test(t)) {
    normalized = t;
  } else {
    return NaN;
  }
  const value = Number(normalized);
  return isValidQuantity(value) ? value : NaN;
}

/**
 * The unit as recorded, except the default «unidades» reads «unidad» for
 * exactly one. Other units are free text and stay as typed («1 juegos» is
 * the user's wording, not ours to guess).
 */
export function unitFor(quantity: number, unit: string): string {
  return quantity === 1 && unit.trim() === DEFAULT_RESOURCE_UNIT
    ? 'unidad'
    : unit;
}

/**
 * «200 unidades», «≈ 40 unidades · por evaluar», «Sin contar».
 * A provisional figure under «aún por evaluar» is marked as approximate.
 */
export function quantityLabel(
  r: Pick<Resource, 'quantity' | 'unit' | 'toAssess'>,
): string {
  if (r.quantity === null) return r.toAssess ? 'Por evaluar' : 'Sin contar';
  const figure = `${formatQuantity(r.quantity)} ${unitFor(r.quantity, r.unit)}`;
  return r.toAssess ? `≈ ${figure} · por evaluar` : figure;
}
