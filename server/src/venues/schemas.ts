/**
 * Input schema for editing a venue (VenueInput in the shared contract,
 * Revisión 1 · E2). Unknown keys are ignored, so a newer client can talk to
 * this server. Venues are still created by name from events and tasks.
 */
import {z} from 'zod';
import {requiredText} from '../http/validate.ts';
import {
  acronym,
  NAME_MAX,
  openingHours,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';

export const updateVenueSchema = z.object({
  version: versionField('el lugar'),
  name: requiredText(NAME_MAX).optional(),
  acronym,
  openingHours,
  source,
  verification,
});

export type UpdateVenueBody = z.output<typeof updateVenueSchema>;
