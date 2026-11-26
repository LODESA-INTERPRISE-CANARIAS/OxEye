/**
 * Boundary validation helpers: zod schemas with plain-Spanish messages and the
 * conversion of a zod error into the contract's `fields` map.
 */
import {z} from 'zod';
import type {Context} from 'hono';
import {isLocalDate, isLocalTime} from '../../../shared/logistics/time.ts';
import {AppError, validationError} from '../errors.ts';

export const REQUIRED = 'Este campo es obligatorio.';

/** Required text, trimmed, 1..max characters. */
export function requiredText(max: number) {
  return z
    .string({
      error: iss => (iss.input === undefined ? REQUIRED : 'Debe ser un texto.'),
    })
    .trim()
    .min(1, {error: REQUIRED})
    .max(max, {error: `Máximo ${max} caracteres.`});
}

/** Optional text; empty or blank becomes null. */
export function optionalText(max: number) {
  return z
    .string({error: 'Debe ser un texto.'})
    .max(max, {error: `Máximo ${max} caracteres.`})
    .transform(v => (v.trim() === '' ? null : v.trim()))
    .nullable()
    .optional();
}

export const localDate = z
  .string({error: 'Debe ser una fecha (AAAA-MM-DD).'})
  .refine(isLocalDate, {error: 'Fecha no válida: usa el formato AAAA-MM-DD.'})
  .nullable()
  .optional();

export const localTime = z
  .string({error: 'Debe ser una hora (HH:MM).'})
  .refine(isLocalTime, {
    error: 'Hora no válida: usa el formato HH:MM (00:00–23:59).',
  })
  .nullable()
  .optional();

export function oneOf<const T extends readonly [string, ...string[]]>(
  values: T,
  message: string,
) {
  return z.enum(values, {error: message});
}

export const uuid = z
  .string({
    error: iss =>
      iss.input === undefined ? REQUIRED : 'Identificador no válido.',
  })
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    error: 'Identificador no válido.',
  });

/** Contract `fields` from a zod error: first message per field path. */
export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function parseWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = zodFields(result.error);
    const general = fields._;
    delete fields._;
    throw validationError(fields, general ?? 'Revisa los campos marcados.');
  }
  return result.data;
}

/** Reads and validates a JSON body. */
export async function jsonBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(
      'VALIDATION',
      'La petición no tiene un cuerpo JSON válido.',
    );
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('VALIDATION', 'La petición debe enviar un objeto JSON.');
  }
  return parseWith(schema, raw);
}
