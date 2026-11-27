/**
 * Input fields shared by every mutable record: provenance, the optimistic
 * concurrency version and common text limits.
 */
import {z} from 'zod';
import {validationError} from '../errors.ts';
import {isUuid} from '../organizations/service.ts';
import {oneOf, uuid} from '../http/validate.ts';
import {normalizeIds} from './ids.ts';
import {
  EMAIL_MAX,
  isPlausibleEmail,
  isPlausiblePhone,
  isValidAmount,
  PHONE_MAX,
} from '../../../shared/logistics/rules.ts';
import {
  ACRONYM_MAX,
  acronymProblem,
} from '../../../shared/logistics/acronym.ts';
import {
  OPENING_HOURS_INVALID,
  openingHoursProblem,
} from '../../../shared/logistics/move.ts';
import type {OpeningHours} from '../../../shared/logistics/contracts.ts';

export const NAME_MAX = 200;
export const NOTES_MAX = 5000;

/** Optional text that must pass `check` when given; empty or blank becomes null. */
function checkedText(
  max: number,
  check: (value: string) => boolean,
  message: string,
) {
  return z
    .string({error: 'Debe ser un texto.'})
    .max(max, {error: `Máximo ${max} caracteres.`})
    .transform(v => (v.trim() === '' ? null : v.trim()))
    .refine(v => v === null || check(v), {error: message})
    .nullable()
    .optional();
}

/** A phone as typed on site; free text («mañana lo paso») is rejected. */
export const phone = checkedText(
  PHONE_MAX,
  isPlausiblePhone,
  'Teléfono no válido: escribe solo el número (por ejemplo, +34 000 000 000). Si aún no lo tienes, déjalo vacío.',
);

export const email = checkedText(
  EMAIL_MAX,
  isPlausibleEmail,
  'Correo no válido: escribe una dirección como nombre@dominio.es. Si aún no lo tienes, déjalo vacío.',
);

/** Euros, at most two decimals; null = unknown (never 0). */
export const amount = z
  .number({
    error: 'Debe ser un importe en euros (un número) o vacío si no se sabe.',
  })
  .refine(isValidAmount, {
    error:
      'Importe no válido: entre 0 y 10.000.000 €, con dos decimales como máximo.',
  })
  .nullable()
  .optional();

/** A nullable reference to another record. */
export const optionalUuid = uuid.nullable().optional();

/**
 * A list of ids that replaces the stored one: at most `max`, every entry a
 * UUID; returned lower-case, de-duplicated and sorted.
 */
export function idList(max: number, what: {list: string; invalid: string}) {
  return z
    .array(z.unknown(), {error: `Debe ser una lista de ${what.list}.`})
    .max(max, {error: `Como máximo ${max} ${what.list}.`})
    .refine(list => list.every(isUuid), {error: what.invalid})
    .transform(list => normalizeIds(list as string[]))
    .optional();
}

/** `?version=N` of DELETE routes; `what` names the record («la tarea»). */
export function parseVersionParam(
  raw: string | undefined,
  what: string,
): number {
  if (raw === undefined || raw.trim() === '') {
    throw validationError({
      version: `Falta la versión del registro: recarga ${what} y vuelve a intentarlo.`,
    });
  }
  if (!/^\d{1,9}$/.test(raw.trim()) || Number(raw) < 1) {
    throw validationError({
      version: 'La versión debe ser un número entero positivo.',
    });
  }
  return Number(raw);
}

export const source = oneOf(
  ['observed', 'reported', 'document'],
  'Origen no válido: usa observado, comunicado o documento.',
)
  .nullable()
  .optional();

export const verification = oneOf(
  ['draft', 'to_verify', 'validated'],
  'Verificación no válida: usa borrador, por verificar o validado.',
).optional();

/**
 * Revisión 1 · E2: an acronym as edited («SCLL», «A.M.»); blank becomes null
 * (the UI then proposes one). Same rule as the forms (`acronymProblem`).
 */
export const acronym = z
  .string({error: 'Debe ser un texto.'})
  .max(100, {error: `Como mucho ${ACRONYM_MAX} caracteres.`})
  .transform(v => v.trim())
  .superRefine((v, ctx) => {
    const problem = acronymProblem(v);
    if (problem) ctx.addIssue({code: 'custom', message: problem});
  })
  .transform(v => (v === '' ? null : v))
  .nullable()
  .optional();

/**
 * Revisión 1 · E2: daily opening hours {opensAt, closesAt} (HH:MM, opening
 * before closing) or null when not known. Any problem is reported on the
 * field itself (`openingHoursProblem`).
 */
export const openingHours = z
  .unknown()
  .transform((value, ctx): OpeningHours | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const shape = z
      .object({opensAt: z.string(), closesAt: z.string()})
      .safeParse(value);
    if (!shape.success) {
      ctx.addIssue({code: 'custom', message: OPENING_HOURS_INVALID});
      return z.NEVER;
    }
    const hours = {
      opensAt: shape.data.opensAt,
      closesAt: shape.data.closesAt,
    };
    const problem = openingHoursProblem(hours);
    if (problem) {
      ctx.addIssue({code: 'custom', message: problem});
      return z.NEVER;
    }
    return hours;
  })
  .optional();

const VERSION_INT = 'La versión debe ser un número entero.';

/** Required on every update; `what` names the record («el evento»). */
export function versionField(what: string) {
  return z
    .number({
      error: iss =>
        iss.input === undefined
          ? `Falta la versión del registro: recarga ${what} y vuelve a intentarlo.`
          : VERSION_INT,
    })
    .int({error: VERSION_INT})
    .min(1, {error: 'La versión debe ser un número entero positivo.'});
}
