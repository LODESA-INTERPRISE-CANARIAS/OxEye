import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody, REQUIRED} from '../http/validate.ts';
import {listLoginUsers, login, me} from './service.ts';
import {deleteSession} from './sessions.ts';
import type {
  ListResponse,
  LoginUserOption,
} from '../../../shared/logistics/contracts.ts';

const loginSchema = z.object({
  displayName: z
    .string({error: REQUIRED})
    .trim()
    .min(1, {error: 'Elige tu usuario.'})
    .max(80, {error: 'Usuario no válido.'}),
  password: z
    .string({error: REQUIRED})
    .min(1, {error: 'Escribe tu contraseña.'})
    .max(200, {error: 'Contraseña demasiado larga.'}),
});

export function registerAuthRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/auth/users', async c => {
    const body: ListResponse<LoginUserOption> = {
      items: await listLoginUsers(deps.db),
    };
    return c.json(body);
  });

  api.post('/auth/login', async c => {
    const input = await jsonBody(c, loginSchema);
    const result = await login(
      deps.db,
      {...input, ip: deps.clientIp(c)},
      {
        now: deps.now(),
        sessionDays: deps.config.sessionDays,
        limits: deps.limits,
      },
    );
    return c.json(result);
  });

  api.post('/auth/logout', auth, async c => {
    await deleteSession(deps.db, c.get('token'));
    return c.body(null, 204);
  });

  api.get('/me', auth, async c => c.json(await me(deps.db, c.get('user'))));
}
