/**
 * Offer rules as pure functions. No database, no HTTP.
 *
 * Amounts are kept as given: null is unknown (never 0) and nothing is summed.
 * A billing unit (also a custom one such as «por kg») is only a unit: it never
 * derives a load per square metre and never touches a task's heavy-load
 * answer.
 */
import type {PriceUnit} from '../../../shared/logistics/contracts.ts';

/**
 * The unit and custom wording after an edit: the wording exists only for a
 * custom unit, so any other unit clears it; a custom unit keeps its stored
 * wording unless a new one is sent.
 */
export function resolveUnit(
  current: {unit: PriceUnit; customUnit: string | null},
  input: {unit?: PriceUnit; customUnit?: string | null},
): {unit: PriceUnit; customUnit: string | null} {
  const unit = input.unit ?? current.unit;
  if (unit !== 'custom') return {unit, customUnit: null};
  const customUnit =
    input.customUnit !== undefined
      ? input.customUnit
      : current.unit === 'custom'
        ? current.customUnit
        : null;
  return {unit, customUnit};
}

/** A numeric column from either driver (text or number) as euros, or null. */
export function toAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
