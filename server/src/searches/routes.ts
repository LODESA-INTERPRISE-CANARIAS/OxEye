import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody, requiredText} from '../http/validate.ts';
import {RECENT_SEARCH_MAX_LENGTH} from '../../../shared/logistics/rules.ts';
import {
  clearRecentSearches,
  listRecentSearches,
  pushRecentSearch,
} from './service.ts';
import type {
  ListResponse,
  RecentSearch,
} from '../../../shared/logistics/contracts.ts';

/** RecentSearchInput in the shared contract. */
const recentSearchSchema = z.object({
  query: requiredText(RECENT_SEARCH_MAX_LENGTH),
});

export function registerSearchRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  const path = '/organizations/:orgId/recent-searches';

  api.get(path, auth, async c => {
    const body: ListResponse<RecentSearch> = {
      items: await listRecentSearches(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
      ),
    };
    return c.json(body);
  });

  api.post(path, auth, async c => {
    const input = await jsonBody(c, recentSearchSchema);
    const body: ListResponse<RecentSearch> = {
      items: await pushRecentSearch(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
        input.query,
        deps.now(),
      ),
    };
    return c.json(body);
  });

  api.delete(path, auth, async c => {
    await clearRecentSearches(deps.db, c.get('user'), c.req.param('orgId'));
    return c.body(null, 204);
  });
}
