/**
 * Input schema for moving a task (MoveTaskInput in the shared contract,
 * Revisión 1 · E2). Unknown keys are ignored, so a newer client can talk to
 * this server.
 */
import {z} from 'zod';
import {REQUIRED, uuid} from '../http/validate.ts';
import {
  isValidMove,
  MAX_DELAY_MINUTES,
  MOVE_STEP_MINUTES,
} from '../../../shared/logistics/rules.ts';

export const MOVE_INVALID = `Indica cuánto se mueve en minutos, de ${MOVE_STEP_MINUTES} en ${MOVE_STEP_MINUTES}, hasta ${MAX_DELAY_MINUTES} (un día) antes o después.`;
const ORIGIN_INVALID =
  'Origen del cambio no válido: usa calendar, conflict_delay, conflict_advance o undo.';
const INSTANT_INVALID =
  'Hora no válida: debe ser un instante ISO 8601 en UTC (2026-12-02T09:00:00.000Z).';
const EXPECTED_INVALID =
  'Falta la lista de tareas que se mueven: vuelve a mirar el cambio y confírmalo de nuevo.';
const EXPECTED_DUPLICATE =
  'Una tarea aparece dos veces en la confirmación: vuelve a mirar el cambio y confírmalo de nuevo.';

/** Tasks one confirmation may move; far above any real plan. */
export const MAX_MOVED = 500;

const instant = z
  .string({error: INSTANT_INVALID})
  .refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)), {
    error: INSTANT_INVALID,
  });

export const moveTaskSchema = z.object({
  minutes: z
    .number({error: iss => (iss.input === undefined ? REQUIRED : MOVE_INVALID)})
    .refine(isValidMove, {error: MOVE_INVALID}),
  origin: z.enum(['conflict_delay', 'conflict_advance', 'calendar', 'undo'], {
    error: iss => (iss.input === undefined ? REQUIRED : ORIGIN_INVALID),
  }),
  warningKey: z
    .string({error: 'Debe ser un texto.'})
    .max(200, {error: 'Máximo 200 caracteres.'})
    .nullable()
    .optional(),
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
    .max(MAX_MOVED, {
      error: `Como máximo ${MAX_MOVED} tareas en una confirmación.`,
    })
    .refine(list => new Set(list.map(e => e.id)).size === list.length, {
      error: EXPECTED_DUPLICATE,
    }),
});

export type MoveTaskBody = z.output<typeof moveTaskSchema>;
