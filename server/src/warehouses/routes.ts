import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {viewerIn} from '../records/redact.ts';
import {parseVersionParam} from '../records/schemas.ts';
import {createWarehouseSchema, updateWarehouseSchema} from './schemas.ts';
import {
  createWarehouse,
  deleteWarehouse,
  listWarehouses,
  updateWarehouse,
} from './service.ts';
import type {
  ListResponse,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';

export function registerWarehouseRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/warehouses', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<Warehouse> = {
      items: await listWarehouses(deps.db, org.id, viewerIn(user, org)),
    };
    return c.json(body);
  });

  api.post('/warehouses', auth, async c => {
    const input = await jsonBody(c, createWarehouseSchema);
    const created = await createWarehouse(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/warehouses/:id', auth, async c => {
    const input = await jsonBody(c, updateWarehouseSchema);
    const warehouse = await updateWarehouse(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(warehouse);
  });

  api.delete('/warehouses/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'), 'el almacén');
    await deleteWarehouse(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
