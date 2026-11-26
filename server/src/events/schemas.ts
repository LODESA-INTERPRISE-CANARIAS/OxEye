/**
 * Input schemas for events (CreateEventInput / UpdateEventInput in the
 * shared contract). Unknown keys are ignored, so a newer client can talk to
 * this server.
 */
import {z} from 'zod';
import {
  localDate,
  localTime,
  oneOf,
  optionalText,
  requiredText,
  uuid,
} from '../http/validate.ts';

const status = oneOf(
  ['planned', 'confirmed', 'delayed', 'cancelled'],
  'Estado no válido: usa previsto, confirmado, retrasado o cancelado.',
);
const source = oneOf(
  ['observed', 'reported', 'document'],
  'Origen no válido: usa observado, comunicado o documento.',
)
  .nullable()
  .optional();
const verification = oneOf(
  ['draft', 'to_verify', 'validated'],
  'Verificación no válida: usa borrador, por verificar o validado.',
).optional();

export const NAME_MAX = 200;
export const NOTES_MAX = 5000;

export const createEventSchema = z.object({
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  venueName: optionalText(NAME_MAX),
  date: localDate,
  startTime: localTime,
  endTime: localTime,
  status: status.optional(),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
});

export const updateEventSchema = z.object({
  version: z
    .number({
      error: iss =>
        iss.input === undefined
          ? 'Falta la versión del registro: recarga el evento y vuelve a intentarlo.'
          : 'La versión debe ser un número entero.',
    })
    .int({error: 'La versión debe ser un número entero.'})
    .min(1, {error: 'La versión debe ser un número entero positivo.'}),
  name: requiredText(NAME_MAX).optional(),
  venueName: optionalText(NAME_MAX),
  date: localDate,
  startTime: localTime,
  endTime: localTime,
  status: status.optional(),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
});

export type CreateEventBody = z.output<typeof createEventSchema>;
export type UpdateEventBody = z.output<typeof updateEventSchema>;
