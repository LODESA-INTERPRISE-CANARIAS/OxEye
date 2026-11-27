import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {updateVenueSchema} from './schemas.ts';
import {listVenues, updateVenue} from './service.ts';
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

  // Revisión 1 · E2: name, acronym and opening hours (guests get 403 from auth).
  api.patch('/venues/:id', auth, async c => {
    const input = await jsonBody(c, updateVenueSchema);
    const venue = await updateVenue(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(venue);
  });
}
