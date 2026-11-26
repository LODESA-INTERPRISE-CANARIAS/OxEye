import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {requireMembership} from '../organizations/service.ts';
import {listVenues} from './service.ts';
import type {ListResponse, Venue} from '../../../shared/logistics/contracts.ts';

export function registerVenueRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/venues', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const body: ListResponse<Venue> = {
      items: await listVenues(deps.db, org.id),
    };
    return c.json(body);
  });
}
