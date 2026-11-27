import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import type {Context} from 'hono';
import {logSecurity} from '../account/security.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody, REQUIRED} from '../http/validate.ts';
import {trustedBase} from '../mail/links.ts';
import {
  admitRecovery,
  login,
  me,
  prepareRecovery,
  resetPassword,
  verifyEmail,
} from './service.ts';
import {deleteSession} from './sessions.ts';
import {
  deviceLabel,
  PASSWORD_MAX,
  USERNAME_MAX,
} from '../../../shared/logistics/account.ts';

const ASK_USERNAME = 'Escribe tu nombre de usuario.';

const usernameField = z
  .string({error: REQUIRED})
  .trim()
  .min(1, {error: ASK_USERNAME})
  .max(USERNAME_MAX, {error: 'Usuario no válido.'});

const loginSchema = z
  .object({
    username: usernameField.optional(),
    /** Pre-E4 clients, for one release. */
    displayName: usernameField.optional(),
    password: z
      .string({error: REQUIRED})
      .min(1, {error: 'Escribe tu contraseña.'})
      .max(PASSWORD_MAX, {error: 'Contraseña demasiado larga.'}),
  })
  .transform((v, ctx) => {
    const name = v.username ?? v.displayName;
    if (!name) {
      ctx.addIssue({code: 'custom', path: ['username'], message: ASK_USERNAME});
      return z.NEVER;
    }
    return {
      username: name,
      password: v.password,
      legacy: v.username === undefined,
    };
  });

const recoverySchema = z.object({username: usernameField});

const tokenField = z.string({error: REQUIRED}).regex(/^[A-Za-z0-9_-]{43}$/, {
  error:
    'El enlace no es válido, ya se ha usado o ha caducado. Pide uno nuevo.',
});

const newPasswordField = z
  .string({error: REQUIRED})
  .max(PASSWORD_MAX * 4, {error: 'Contraseña demasiado larga.'});

const resetSchema = z.object({
  token: tokenField,
  newPassword: newPasswordField,
});
const verifySchema = z.object({token: tokenField});

export function deviceOf(c: Context): string | null {
  return deviceLabel(c.req.header('User-Agent'));
}

export function registerAuthRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  // GET /auth/users is gone (E4): there is no public list of accounts.

  api.post('/auth/login', async c => {
    const input = await jsonBody(c, loginSchema);
    const result = await login(
      deps.db,
      {...input, ip: deps.clientIp(c), device: deviceOf(c)},
      {
        now: deps.now(),
        sessionDays: deps.config.sessionDays,
        limits: deps.limits,
      },
    );
    return c.json(result);
  });

  api.post('/auth/logout', auth, async c => {
    const session = c.get('session');
    await deleteSession(deps.db, c.get('token'));
    if (session.kind !== 'normal' && session.openedBy) {
      await logSecurity(deps.db, {
        userId: session.kind === 'support' ? session.user.id : session.openedBy,
        actorId: session.openedBy,
        kind: 'support_ended',
        at: deps.now(),
      });
    } else if (session.user.role !== 'guest') {
      await logSecurity(deps.db, {
        userId: session.user.id,
        kind: 'logout',
        device: deviceOf(c),
        at: deps.now(),
      });
    }
    return c.body(null, 204);
  });

  api.get('/me', auth, async c => c.json(await me(deps.db, c.get('user'))));

  // Always 202 with no body, whether the account exists or not. Only the
  // rate limits run before the answer; looking the name up, issuing the link,
  // the security log and the e-mail all run after it, in the mail queue.
  api.post('/auth/recovery', async c => {
    const input = await jsonBody(c, recoverySchema);
    admitRecovery(
      {username: input.username, ip: deps.clientIp(c)},
      deps.recoveryLimits,
    );
    const request = {username: input.username, device: deviceOf(c)};
    const options = {
      now: deps.now(),
      base: trustedBase(deps.config, c.req.header('Origin')),
      fallback: deps.config.mail.recoveryFallback,
      log: deps.log,
    };
    deps.mail.defer(() => prepareRecovery(deps.db, request, options));
    return c.body(null, 202);
  });

  api.post('/auth/reset', async c => {
    const input = await jsonBody(c, resetSchema);
    await resetPassword(
      deps.db,
      {...input, ip: deps.clientIp(c), device: deviceOf(c)},
      {now: deps.now(), limits: deps.recoveryLimits},
    );
    return c.body(null, 204);
  });

  api.post('/auth/verify-email', async c => {
    const input = await jsonBody(c, verifySchema);
    await verifyEmail(
      deps.db,
      {token: input.token, ip: deps.clientIp(c)},
      {now: deps.now(), limits: deps.recoveryLimits},
    );
    return c.body(null, 204);
  });
}
