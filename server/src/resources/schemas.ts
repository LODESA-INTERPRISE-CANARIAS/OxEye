/**
 * Input schemas for inventory resources (ResourceInput in the shared
 * contract). Unknown keys are ignored, so a newer client can talk to this
 * server.
 */
import {z} from 'zod';
import {oneOf, optionalText, requiredText, uuid} from '../http/validate.ts';
import {normalizeName} from '../records/find-or-create.ts';
import {
  NAME_MAX,
  NOTES_MAX,
  optionalUuid,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {deviceIdField} from '../records/device-id.ts';
import {
  DEFAULT_RESOURCE_UNIT,
  DIMENSIONS_MAX,
  isValidQuantity,
  LOCATION_MAX,
  RESOURCE_AVAILABILITIES,
  RESOURCE_CONDITIONS,
  RESOURCE_OWNERSHIPS,
  RESOURCE_UNIT_MAX,
} from '../../../shared/logistics/rules.ts';

const ownership = oneOf(
  RESOURCE_OWNERSHIPS,
  'Indica si el recurso es propio o contratado.',
);
const condition = oneOf(
  RESOURCE_CONDITIONS,
  'Estado no válido: usa buen estado, con desgaste, con daños o sin revisar.',
);
const availability = oneOf(
  RESOURCE_AVAILABILITIES,
  'Disponibilidad no válida: usa disponible, en uso, en reparación o sin confirmar.',
);

/** Null = not counted yet (never 0); at most two decimals. */
const quantity = z
  .number({error: 'Debe ser una cantidad (un número) o vacío si no se sabe.'})
  .refine(isValidQuantity, {
    error:
      'Cantidad no válida: entre 0 y 1.000.000, con dos decimales como máximo.',
  })
  .nullable()
  .optional();

/** Any wording («m²», «juegos», «kg»); blank or null goes back to «unidades». */
const unit = z
  .string({error: 'Debe ser un texto.'})
  .max(RESOURCE_UNIT_MAX, {error: `Máximo ${RESOURCE_UNIT_MAX} caracteres.`})
  .nullable()
  .transform(v => normalizeName(v) ?? DEFAULT_RESOURCE_UNIT)
  .optional();

const common = {
  ownership: ownership.optional(),
  categoryId: optionalUuid,
  warehouseId: optionalUuid,
  warehouseName: optionalText(NAME_MAX),
  companyId: optionalUuid,
  companyName: optionalText(NAME_MAX),
  offerId: optionalUuid,
  quantity,
  unit,
  dimensions: optionalText(DIMENSIONS_MAX),
  condition: condition.optional(),
  availability: availability.optional(),
  location: optionalText(LOCATION_MAX),
  toAssess: z
    .boolean({error: 'Indica sí o no: ¿está aún por evaluar?'})
    .optional(),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
};

export const createResourceSchema = z.object({
  id: deviceIdField,
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  ...common,
});

/** A resource never moves to another organization: `organizationId` is ignored. */
export const updateResourceSchema = z.object({
  version: versionField('el recurso'),
  name: requiredText(NAME_MAX).optional(),
  ...common,
});

export type CreateResourceBody = z.output<typeof createResourceSchema>;
export type UpdateResourceBody = z.output<typeof updateResourceSchema>;
export type ResourceBody = CreateResourceBody | UpdateResourceBody;
