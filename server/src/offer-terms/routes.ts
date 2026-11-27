import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requestBase} from '../mail/links.ts';
import {renewalSchema, settingsSchema} from './schemas.ts';
import {
  getSettings,
  listRenewals,
  runRenewals,
  updateRenewal,
  updateSettings,
} from './renewals.ts';
import {listCurrentVersions, listOfferVersions} from './versions.ts';
import type {
  ListResponse,
  OfferRenewal,
  OfferVersion,
} from '../../../shared/logistics/contracts.ts';

/**
 * Offer versions, offer settings and renegotiation tasks (Revisión 1 · E6).
 * Reads need `directory.read`; settings, reassigning and running the
 * renewals need `offers.approve` (administrators).
 */
export function registerOfferTermsRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/offers/:id/versions', auth, async c => {
    const body: ListResponse<OfferVersion> = {
      items: await listOfferVersions(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        deps.now(),
      ),
    };
    return c.json(body);
  });

  api.get('/organizations/:orgId/offer-versions', auth, async c => {
    const body: ListResponse<OfferVersion> = {
      items: await listCurrentVersions(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
        deps.now(),
      ),
    };
    return c.json(body);
  });

  api.get('/organizations/:orgId/offer-settings', auth, async c =>
    c.json(await getSettings(deps.db, c.get('user'), c.req.param('orgId'))),
  );

  api.patch('/organizations/:orgId/offer-settings', auth, async c => {
    const input = await jsonBody(c, settingsSchema);
    return c.json(
      await updateSettings(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
        input,
        deps.now(),
        requestBase(deps.config, c.req.header('Origin')),
      ),
    );
  });

  api.get('/organizations/:orgId/offer-renewals', auth, async c => {
    const body: ListResponse<OfferRenewal> = {
      items: await listRenewals(deps.db, c.get('user'), c.req.param('orgId')),
    };
    return c.json(body);
  });

  api.post('/organizations/:orgId/offer-renewals/run', auth, async c =>
    c.json(
      await runRenewals(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
        deps.now(),
      ),
    ),
  );

  api.patch('/offer-renewals/:id', auth, async c => {
    const input = await jsonBody(c, renewalSchema);
    return c.json(
      await updateRenewal(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input,
        deps.now(),
      ),
    );
  });
}
