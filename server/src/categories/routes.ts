import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {hasAccess, requireMembership} from '../organizations/service.ts';
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
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    // E4: without the directory only the inventory's categories are listed.
    const all = await listCategories(deps.db, org.id);
    const body: ListResponse<Category> = {
      items: hasAccess(org, user, 'directory.read')
        ? all
        : all.filter(cat => cat.scope === 'resource'),
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
