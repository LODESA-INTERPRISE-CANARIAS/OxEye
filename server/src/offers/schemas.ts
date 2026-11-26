/**
 * Input schemas for offers (OfferInput in the shared contract). Unknown keys
 * are ignored, so a newer client can talk to this server.
 */
import {z} from 'zod';
import {oneOf, optionalText, requiredText, uuid} from '../http/validate.ts';
import {
  amount,
  NAME_MAX,
  NOTES_MAX,
  optionalUuid,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {CUSTOM_UNIT_MAX, PRICE_UNITS} from '../../../shared/logistics/rules.ts';

const unit = oneOf(
  PRICE_UNITS,
  'Unidad no válida: usa unidad, metro, hora, día, kilómetro, paquete u otra.',
);

const common = {
  // The company is required: null is answered with a clear message by the service.
  companyId: optionalUuid,
  companyName: optionalText(NAME_MAX),
  categoryId: optionalUuid,
  description: optionalText(NOTES_MAX),
  price: amount,
  unit: unit.optional(),
  customUnit: optionalText(CUSTOM_UNIT_MAX),
  transportCost: amount,
  assemblyCost: amount,
  maintenanceCost: amount,
  conditions: optionalText(NOTES_MAX),
  vatIncluded: z
    .boolean({
      error: 'Indica si el IVA está incluido, no incluido o déjalo sin saber.',
    })
    .nullable()
    .optional(),
  source,
  verification,
};

export const createOfferSchema = z.object({
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  ...common,
});

/** An offer never moves to another organization: `organizationId` is ignored. */
export const updateOfferSchema = z.object({
  version: versionField('la oferta'),
  name: requiredText(NAME_MAX).optional(),
  ...common,
});

export type CreateOfferBody = z.output<typeof createOfferSchema>;
export type UpdateOfferBody = z.output<typeof updateOfferSchema>;
