import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {createOfferSchema, updateOfferSchema} from './schemas.ts';
import {createOffer, deleteOffer, listOffers, updateOffer} from './service.ts';
import type {ListResponse, Offer} from '../../../shared/logistics/contracts.ts';

export function registerOfferRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/offers', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Offer> = {
      items: await listOffers(deps.db, org.id, user),
    };
    return c.json(body);
  });

  api.post('/offers', auth, async c => {
    const input = await jsonBody(c, createOfferSchema);
    const offer = await createOffer(deps.db, c.get('user'), input, deps.now());
    return c.json(offer, 201);
  });

  api.patch('/offers/:id', auth, async c => {
    const input = await jsonBody(c, updateOfferSchema);
    const offer = await updateOffer(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(offer);
  });

  api.delete('/offers/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'), 'la oferta');
    await deleteOffer(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
