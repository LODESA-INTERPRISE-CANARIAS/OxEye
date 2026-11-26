import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {parseWith} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  listActivity,
} from './service.ts';
import type {
  ActivityEntry,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

const LIMIT_MESSAGE = `Indica un número entero entre 1 y ${ACTIVITY_MAX_LIMIT}.`;

const querySchema = z.object({
  limit: z.coerce
    .number({error: LIMIT_MESSAGE})
    .int({error: LIMIT_MESSAGE})
    .min(1, {error: LIMIT_MESSAGE})
    .max(ACTIVITY_MAX_LIMIT, {error: LIMIT_MESSAGE})
    .default(ACTIVITY_DEFAULT_LIMIT),
});

export function registerActivityRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/activity', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const {limit} = parseWith(querySchema, {
      limit: c.req.query('limit') || undefined,
    });
    const body: ListResponse<ActivityEntry> = {
      items: await listActivity(deps.db, org.id, limit),
    };
    return c.json(body);
  });
}
