import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {createResourceSchema, updateResourceSchema} from './schemas.ts';
import {
  createResource,
  deleteResource,
  listResources,
  updateResource,
} from './service.ts';
import type {
  ListResponse,
  Resource,
} from '../../../shared/logistics/contracts.ts';

export function registerResourceRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/resources', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Resource> = {
      items: await listResources(deps.db, org.id, user),
    };
    return c.json(body);
  });

  api.post('/resources', auth, async c => {
    const input = await jsonBody(c, createResourceSchema);
    const created = await createResource(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/resources/:id', auth, async c => {
    const input = await jsonBody(c, updateResourceSchema);
    const resource = await updateResource(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(resource);
  });

  api.delete('/resources/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'), 'el recurso');
    await deleteResource(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
