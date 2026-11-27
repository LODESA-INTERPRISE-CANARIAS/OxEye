/**
 * Input schema for accepting a conflict (ConflictAcceptanceInput in the
 * shared contract, Revisión 1 · E2). Unknown keys are ignored, so a newer
 * client can talk to this server.
 */
import {z} from 'zod';
import {REQUIRED, uuid} from '../http/validate.ts';
import {
  ACCEPT_REASON_MAX,
  ACCEPT_REASON_MIN,
} from '../../../shared/logistics/rules.ts';

const KEY_INVALID =
  'Aviso no válido: vuelve a abrir el aviso y elige «Mantener ambas» de nuevo.';
const REASON_INVALID = `Escribe un motivo breve, de ${ACCEPT_REASON_MIN} a ${ACCEPT_REASON_MAX} caracteres.`;
const WINDOWS_INVALID =
  'Faltan las horas de las tareas del aviso: vuelve a abrirlo y confírmalo de nuevo.';
const INSTANT_INVALID =
  'Hora no válida: debe ser un instante ISO 8601 en UTC (2026-12-02T09:00:00.000Z).';

/** Same shape as `PlanWarning.key` (kind, then one to three task or resource ids). */
const WARNING_KEY_RE = /^[a-z_-]{1,40}(:[0-9a-f-]{36}){1,3}$/;

const instant = z
  .string({error: INSTANT_INVALID})
  .refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)), {
    error: INSTANT_INVALID,
  });

export const createAcceptanceSchema = z.object({
  organizationId: uuid,
  warningKey: z
    .string({error: iss => (iss.input === undefined ? REQUIRED : KEY_INVALID)})
    .transform(v => v.toLowerCase())
    .refine(v => WARNING_KEY_RE.test(v), {error: KEY_INVALID}),
  windows: z
    .array(
      z.object({
        taskId: uuid.transform(v => v.toLowerCase()),
        startsAt: instant,
        endsAt: instant,
      }),
      {error: WINDOWS_INVALID},
    )
    .min(1, {error: WINDOWS_INVALID})
    .max(10, {error: WINDOWS_INVALID})
    .refine(list => new Set(list.map(w => w.taskId)).size === list.length, {
      error: WINDOWS_INVALID,
    }),
  reason: z
    .string({
      error: iss => (iss.input === undefined ? REQUIRED : REASON_INVALID),
    })
    .transform(v => v.trim().replace(/\s+/g, ' '))
    .refine(
      v => v.length >= ACCEPT_REASON_MIN && v.length <= ACCEPT_REASON_MAX,
      {error: REASON_INVALID},
    ),
});

export type CreateAcceptanceBody = z.output<typeof createAcceptanceSchema>;
