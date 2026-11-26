/**
 * Input schemas for delay hypotheses (HypothesisInput and ApplyHypothesisInput
 * in the shared contract). Unknown keys are ignored, so a newer client can
 * talk to this server.
 */
import {z} from 'zod';
import {optionalText, REQUIRED, uuid} from '../http/validate.ts';
import {
  HYPOTHESIS_NOTE_MAX,
  isValidDelay,
  MAX_DELAY_MINUTES,
} from '../../../shared/logistics/rules.ts';

export const DELAY_INVALID = `Indica el retraso en minutos enteros, entre 1 y ${MAX_DELAY_MINUTES} (un día).`;
const MODE_INVALID =
  'Tipo de retraso no válido: usa «empieza más tarde» (shift) o «se alarga» (extend).';

/** Tasks one confirmation may move; far above any real plan. */
export const MAX_EXPECTED = 500;

const delayMinutes = z
  .number({
    error: iss => (iss.input === undefined ? REQUIRED : DELAY_INVALID),
  })
  .refine(isValidDelay, {error: DELAY_INVALID});

export const createHypothesisSchema = z.object({
  organizationId: uuid,
  taskId: uuid,
  delayMinutes,
  mode: z.enum(['shift', 'extend'], {error: MODE_INVALID}).default('shift'),
  estimated: z
    .boolean({error: 'Indica sí o no: ¿es una estimación?'})
    .default(false),
  note: optionalText(HYPOTHESIS_NOTE_MAX),
});

const INSTANT_INVALID =
  'Hora no válida: debe ser un instante ISO 8601 en UTC (2026-12-02T09:00:00.000Z).';
const instant = z
  .string({error: INSTANT_INVALID})
  .refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)), {
    error: INSTANT_INVALID,
  });

const EXPECTED_INVALID =
  'Falta la lista de tareas que se mueven: vuelve a abrir la hipótesis y confirma de nuevo.';
export const EXPECTED_DUPLICATE =
  'Una tarea aparece dos veces en la confirmación: vuelve a abrir la hipótesis y confirma de nuevo.';

export const applyHypothesisSchema = z.object({
  expected: z
    .array(
      z.object({
        id: uuid.transform(v => v.toLowerCase()),
        version: z
          .number({error: 'La versión debe ser un número entero.'})
          .int({error: 'La versión debe ser un número entero.'})
          .min(1, {error: 'La versión debe ser un número entero positivo.'}),
        startsAt: instant,
        endsAt: instant,
      }),
      {error: EXPECTED_INVALID},
    )
    .min(1, {error: EXPECTED_INVALID})
    .max(MAX_EXPECTED, {
      error: `Como máximo ${MAX_EXPECTED} tareas en una confirmación.`,
    })
    .refine(list => new Set(list.map(e => e.id)).size === list.length, {
      error: EXPECTED_DUPLICATE,
    }),
  markDelayed: z
    .boolean({error: 'Indica sí o no: ¿marcar la tarea como retrasada?'})
    .default(false),
});

export type CreateHypothesisBody = z.output<typeof createHypothesisSchema>;
export type ApplyHypothesisBody = z.output<typeof applyHypothesisSchema>;
