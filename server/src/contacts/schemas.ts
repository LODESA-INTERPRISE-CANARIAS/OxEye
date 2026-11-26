/**
 * Input schemas for contacts (ContactInput in the shared contract). Unknown
 * keys are ignored, so a newer client can talk to this server.
 */
import {z} from 'zod';
import {optionalText, requiredText, uuid} from '../http/validate.ts';
import {
  email,
  idList,
  NAME_MAX,
  NOTES_MAX,
  optionalUuid,
  phone,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {
  MAX_EVENTS_PER_CONTACT,
  ROLE_MAX,
} from '../../../shared/logistics/rules.ts';

const common = {
  role: optionalText(ROLE_MAX),
  companyId: optionalUuid,
  companyName: optionalText(NAME_MAX),
  phone,
  email,
  description: optionalText(NOTES_MAX),
  notes: optionalText(NOTES_MAX),
  eventIds: idList(MAX_EVENTS_PER_CONTACT, {
    list: 'eventos',
    invalid: 'Alguno de los eventos no es válido.',
  }),
  source,
  verification,
};

export const createContactSchema = z.object({
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  ...common,
});

/** A contact never moves to another organization: `organizationId` is ignored. */
export const updateContactSchema = z.object({
  version: versionField('la ficha de la persona'),
  name: requiredText(NAME_MAX).optional(),
  ...common,
});

export type CreateContactBody = z.output<typeof createContactSchema>;
export type UpdateContactBody = z.output<typeof updateContactSchema>;
