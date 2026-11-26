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
import {deviceIdField} from '../records/device-id.ts';
import {
  NAME_MAX,
  NOTES_MAX,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {EVENT_STATUSES} from '../../../shared/logistics/rules.ts';

const status = oneOf(
  EVENT_STATUSES,
  'Estado no válido: usa previsto, confirmado, retrasado o cancelado.',
);

export const createEventSchema = z.object({
  id: deviceIdField,
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  venueName: optionalText(NAME_MAX),
  date: localDate,
  endDate: localDate,
  startTime: localTime,
  endTime: localTime,
  status: status.optional(),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
});

export const updateEventSchema = z.object({
  version: versionField('el evento'),
  name: requiredText(NAME_MAX).optional(),
  venueName: optionalText(NAME_MAX),
  date: localDate,
  endDate: localDate,
  startTime: localTime,
  endTime: localTime,
  status: status.optional(),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
});

export type CreateEventBody = z.output<typeof createEventSchema>;
export type UpdateEventBody = z.output<typeof updateEventSchema>;
