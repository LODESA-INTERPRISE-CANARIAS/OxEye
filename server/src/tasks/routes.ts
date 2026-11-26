import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requireMembership} from '../organizations/service.ts';
import {
  createTaskSchema,
  parseEventIdParam,
  parseVersionParam,
  updateTaskSchema,
} from './schemas.ts';
import {createTask, deleteTask, listTasks, updateTask} from './service.ts';
import type {ListResponse, Task} from '../../../shared/logistics/contracts.ts';

export function registerTaskRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/organizations/:orgId/tasks', auth, async c => {
    const org = await requireMembership(
      deps.db,
      c.get('user').id,
      c.req.param('orgId'),
    );
    const eventId = parseEventIdParam(c.req.query('eventId'));
    const body: ListResponse<Task> = {
      items: await listTasks(deps.db, org.id, eventId),
    };
    return c.json(body);
  });

  api.post('/tasks', auth, async c => {
    const input = await jsonBody(c, createTaskSchema);
    const task = await createTask(deps.db, c.get('user'), input, deps.now());
    return c.json(task, 201);
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
