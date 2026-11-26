import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {createCategorySchema} from './schemas.ts';
import {createCategory, deleteCategory, listCategories} from './service.ts';
import type {
  Category,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

export function registerCategoryRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/categories', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const body: ListResponse<Category> = {
      items: await listCategories(deps.db, org.id),
    };
    return c.json(body);
  });

  api.post('/categories', auth, async c => {
    const input = await jsonBody(c, createCategorySchema);
    const {category, created} = await createCategory(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(category, created ? 201 : 200);
  });

  api.delete('/categories/:id', auth, async c => {
    await deleteCategory(deps.db, c.get('user'), c.req.param('id'), deps.now());
    return c.body(null, 204);
  });
}
