import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import {validationError} from '../errors.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {parseWith, uuid} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  HISTORY_ENTITY_TYPES,
  listActivity,
} from './service.ts';
import type {
  ActivityEntry,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

const LIMIT_MESSAGE = `Indica un número entero entre 1 y ${ACTIVITY_MAX_LIMIT}.`;
const BOTH_OR_NEITHER =
  'Para ver el historial de un registro indica su tipo y su identificador.';

const querySchema = z.object({
  limit: z.coerce
    .number({error: LIMIT_MESSAGE})
    .int({error: LIMIT_MESSAGE})
    .min(1, {error: LIMIT_MESSAGE})
    .max(ACTIVITY_MAX_LIMIT, {error: LIMIT_MESSAGE})
    .default(ACTIVITY_DEFAULT_LIMIT),
  entityType: z
    .enum(HISTORY_ENTITY_TYPES, {error: 'Tipo de registro no válido.'})
    .optional(),
  entityId: uuid.optional(),
});

export function registerActivityRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  // Recent activity of the organization, or the history of one record
  // (`entityType` and `entityId` together). Labels are names, never free
  // text, so guests read it too.
  api.get('/organizations/:orgId/activity', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const {limit, entityType, entityId} = parseWith(querySchema, {
      limit: c.req.query('limit') || undefined,
      entityType: c.req.query('entityType') || undefined,
      entityId: c.req.query('entityId') || undefined,
    });
    if ((entityType === undefined) !== (entityId === undefined)) {
      throw validationError({
        [entityType === undefined ? 'entityType' : 'entityId']: BOTH_OR_NEITHER,
      });
    }
    const entity =
      entityType && entityId
        ? {type: entityType, id: entityId.toLowerCase()}
        : null;
    const body: ListResponse<ActivityEntry> = {
      items: await listActivity(deps.db, org.id, limit, entity),
    };
    return c.json(body);
  });
}
