import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {viewerIn} from '../records/redact.ts';
import {createEventSchema, updateEventSchema} from './schemas.ts';
import {createEvent, listEvents, updateEvent} from './service.ts';
import type {
  ListResponse,
  LogisticsEvent,
} from '../../../shared/logistics/contracts.ts';

export function registerEventRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/events', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const body: ListResponse<LogisticsEvent> = {
      items: await listEvents(deps.db, org.id, viewerIn(user, org)),
    };
    return c.json(body);
  });

  api.post('/events', auth, async c => {
    const input = await jsonBody(c, createEventSchema);
    const created = await createEvent(
      deps.db,
      c.get('user'),
      input,
      deps.now(),
    );
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/events/:id', auth, async c => {
    const input = await jsonBody(c, updateEventSchema);
    const event = await updateEvent(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(event);
  });
}
