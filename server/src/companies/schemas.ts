/**
 * Input schemas for «Empresas y entidades» (CompanyInput in the shared
 * contract). Unknown keys are ignored, so a newer client can talk to this
 * server.
 */
import {z} from 'zod';
import {oneOf, optionalText, requiredText, uuid} from '../http/validate.ts';
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
import {deviceIdField} from '../records/device-id.ts';
import {
  COMPANY_KINDS,
  MAX_CATEGORIES_PER_COMPANY,
  WEBSITE_MAX,
} from '../../../shared/logistics/rules.ts';

const kind = oneOf(
  COMPANY_KINDS,
  'Tipo no válido: usa proveedor, organismo público, asociación u otra entidad.',
);

const common = {
  kind: kind.optional(),
  categoryIds: idList(MAX_CATEGORIES_PER_COMPANY, {
    list: 'categorías',
    invalid: 'Alguna de las categorías no es válida.',
  }),
  phone,
  email,
  website: optionalText(WEBSITE_MAX),
  notes: optionalText(NOTES_MAX),
  mainContactId: optionalUuid,
  source,
  verification,
};

export const createCompanySchema = z.object({
  id: deviceIdField,
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  ...common,
});

/** A company never moves to another organization: `organizationId` is ignored. */
export const updateCompanySchema = z.object({
  version: versionField('la empresa'),
  name: requiredText(NAME_MAX).optional(),
  ...common,
});

export type CreateCompanyBody = z.output<typeof createCompanySchema>;
export type UpdateCompanyBody = z.output<typeof updateCompanySchema>;
