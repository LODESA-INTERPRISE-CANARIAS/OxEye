import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {viewerIn} from '../records/redact.ts';
import {createAcceptanceSchema} from './schemas.ts';
import {
  createAcceptance,
  deleteAcceptance,
  listAcceptances,
} from './service.ts';
import type {
  ConflictAcceptance,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';

/**
 * Accepted conflicts (Revisión 1 · E2). Guests read them without the reason;
 * writes are members only (guests get 403 from auth).
 */
export function registerAcceptanceRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/conflict-acceptances', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<ConflictAcceptance> = {
      items: await listAcceptances(deps.db, org.id, viewerIn(user, org)),
    };
    return c.json(body);
  });

  api.post('/conflict-acceptances', auth, async c => {
    const input = await jsonBody(c, createAcceptanceSchema);
    const acceptance = await createAcceptance(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(acceptance, 201);
  });

  api.delete('/conflict-acceptances/:id', auth, async c => {
    await deleteAcceptance(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      deps.now(),
    );
    return c.body(null, 204);
  });
}
