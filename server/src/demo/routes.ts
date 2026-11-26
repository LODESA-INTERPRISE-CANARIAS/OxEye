import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {requireMembership} from '../organizations/service.ts';
import {clearDemo} from './service.ts';

export function registerDemoRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.delete('/organizations/:orgId/demo', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const result = await clearDemo(deps.db, {
      organizationId: org.id,
      actorId: user.id,
      now: deps.now(),
    });
    return c.json(result);
  });
}
