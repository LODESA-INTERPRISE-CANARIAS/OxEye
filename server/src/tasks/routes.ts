import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {viewerIn} from '../records/redact.ts';
import {
  createTaskSchema,
  parseEventIdParam,
  parseVersionParam,
  updateTaskSchema,
} from './schemas.ts';
import {createTask, deleteTask, listTasks, updateTask} from './service.ts';
import {moveTask} from './move.ts';
import {moveTaskSchema} from './move-schemas.ts';
import type {ListResponse, Task} from '../../../shared/logistics/contracts.ts';

export function registerTaskRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/tasks', auth, async c => {
    const user = c.get('user');
    const org = await requireMembership(deps.db, user.id, c.req.param('orgId'));
    const eventId = parseEventIdParam(c.req.query('eventId'));
    const body: ListResponse<Task> = {
      items: await listTasks(deps.db, org.id, viewerIn(user, org), eventId),
    };
    return c.json(body);
  });

  api.post('/tasks', auth, async c => {
    const input = await jsonBody(c, createTaskSchema);
    const created = await createTask(deps.db, c.get('user'), input, deps.now());
    return c.json(created.record, created.replayed ? 200 : 201);
  });

  api.patch('/tasks/:id', auth, async c => {
    const input = await jsonBody(c, updateTaskSchema);
    const task = await updateTask(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(task);
  });

  // Revisión 1 · E2: calendar drag, conflict exits and «Deshacer».
  api.post('/tasks/:id/move', auth, async c => {
    const input = await jsonBody(c, moveTaskSchema);
    const result = await moveTask(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      input,
      deps.now(),
    );
    return c.json(result);
  });

  api.delete('/tasks/:id', auth, async c => {
    const version = parseVersionParam(c.req.query('version'));
    await deleteTask(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      version,
      deps.now(),
    );
    return c.body(null, 204);
  });
}
