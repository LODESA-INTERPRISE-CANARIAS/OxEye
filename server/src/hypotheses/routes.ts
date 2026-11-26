import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {applyHypothesisSchema, createHypothesisSchema} from './schemas.ts';
import {
  applyHypothesis,
  createHypothesis,
  deleteHypothesis,
  listHypotheses,
} from './service.ts';
import type {
  DelayHypothesis,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

/** Delay hypotheses (M5). Writes are members only (guests get 403 from auth). */
export function registerHypothesisRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/hypotheses', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<DelayHypothesis> = {
      items: await listHypotheses(deps.db, org.id, user),
    };
    return c.json(body);
  });

  api.post('/hypotheses', auth, async c => {
    const input = await jsonBody(c, createHypothesisSchema);
    const hypothesis = await createHypothesis(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(hypothesis, 201);
  });

  api.delete('/hypotheses/:id', auth, async c => {
    await deleteHypothesis(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      deps.now(),
    );
    return c.body(null, 204);
  });

  api.post('/hypotheses/:id/apply', auth, async c => {
    const input = await jsonBody(c, applyHypothesisSchema);
    const result = await applyHypothesis(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(result);
  });
}
