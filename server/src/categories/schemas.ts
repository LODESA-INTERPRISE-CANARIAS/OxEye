/**
 * Input schema for categories (CategoryInput in the shared contract).
 */
import {z} from 'zod';
import {oneOf, requiredText, uuid} from '../http/validate.ts';
import {CATEGORY_NAME_MAX} from '../../../shared/logistics/rules.ts';
import type {CategoryScope} from '../../../shared/logistics/contracts.ts';

export const CATEGORY_SCOPES = [
  'service',
  'resource',
] as const satisfies readonly CategoryScope[];

export const createCategorySchema = z.object({
  organizationId: uuid,
  scope: oneOf(
    CATEGORY_SCOPES,
    'Tipo de categoría no válido: usa servicio o recurso.',
  ),
  name: requiredText(CATEGORY_NAME_MAX),
});

export type CreateCategoryBody = z.output<typeof createCategorySchema>;
