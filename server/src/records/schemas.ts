/**
 * Input fields shared by every mutable record: provenance, the optimistic
 * concurrency version and common text limits.
 */
import {z} from 'zod';
import {oneOf} from '../http/validate.ts';

export const NAME_MAX = 200;
export const NOTES_MAX = 5000;

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
