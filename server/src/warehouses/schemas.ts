/**
 * Input schemas for warehouses (WarehouseInput in the shared contract).
 * Unknown keys are ignored, so a newer client can talk to this server.
 */
import {z} from 'zod';
import {optionalText, requiredText, uuid} from '../http/validate.ts';
import {
  NAME_MAX,
  NOTES_MAX,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {ADDRESS_MAX} from '../../../shared/logistics/rules.ts';

const common = {
  address: optionalText(ADDRESS_MAX),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
};

export const createWarehouseSchema = z.object({
  organizationId: uuid,
  name: requiredText(NAME_MAX),
  ...common,
});

/** A warehouse never moves to another organization: `organizationId` is ignored. */
export const updateWarehouseSchema = z.object({
  version: versionField('el almacén'),
  name: requiredText(NAME_MAX).optional(),
  ...common,
});

export type CreateWarehouseBody = z.output<typeof createWarehouseSchema>;
export type UpdateWarehouseBody = z.output<typeof updateWarehouseSchema>;
