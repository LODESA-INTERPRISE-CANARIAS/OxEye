import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import {rateLimited} from '../auth/service.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody, REQUIRED} from '../http/validate.ts';
import {requestBase} from '../mail/links.ts';
import {versionField} from '../records/schemas.ts';
import {
  changePassword,
  getProfile,
  listMembers,
  listSessions,
  markWelcomed,
  removeEmail,
  requestEmail,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
} from './service.ts';
import {listOwnSecurity} from './security.ts';
import {
  ACCENT_RE,
  BIO_MAX,
  DISPLAY_NAME_MAX,
  isEmailAddress,
  PASSWORD_MAX,
} from '../../../shared/logistics/account.ts';
import type {
  ListResponse,
  MemberProfile,
  SecurityEvent,
  SessionInfo,
} from '../../../shared/logistics/contracts.ts';

const profileSchema = z.object({
  version: versionField('tu perfil'),
  displayName: z
    .string({error: 'Debe ser un texto.'})
    .trim()
    .min(1, {error: 'Escribe el nombre que verán los demás.'})
    .max(DISPLAY_NAME_MAX, {error: `Máximo ${DISPLAY_NAME_MAX} caracteres.`})
    .optional(),
  bio: z
    .string({error: 'Debe ser un texto.'})
    .max(BIO_MAX * 2, {error: `Máximo ${BIO_MAX} caracteres.`})
    .transform(v => v.trim().replace(/\s+/g, ' '))
    .refine(v => [...v].length <= BIO_MAX, {
      error: `Máximo ${BIO_MAX} caracteres.`,
    })
    .transform(v => (v === '' ? null : v))
    .nullable()
    .optional(),
  accent: z
    .string({error: 'Color no válido.'})
    .regex(ACCENT_RE, {error: 'Color no válido.'})
    .nullable()
    .optional(),
});

const passwordSchema = z.object({
  currentPassword: z
    .string({error: REQUIRED})
    .min(1, {error: 'Escribe tu contraseña actual.'})
    .max(PASSWORD_MAX, {error: 'La contraseña actual no es correcta.'}),
  newPassword: z
    .string({error: REQUIRED})
    .max(PASSWORD_MAX * 4, {error: 'Contraseña demasiado larga.'}),
  signOutOthers: z
    .boolean({error: 'Indica sí o no: ¿cerrar las demás sesiones?'})
    .optional(),
});

const emailSchema = z.object({
  email: z.string({error: REQUIRED}).trim().refine(isEmailAddress, {
    error: 'Escribe una dirección de correo válida (nombre@dominio.es).',
  }),
});

/** The own account (none of it during a support session; see middleware). */
export function registerAccountRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/me/profile', auth, async c =>
    c.json(await getProfile(deps.db, c.get('user'), deps.now())),
  );

  api.patch('/me/profile', auth, async c => {
    const input = await jsonBody(c, profileSchema);
    return c.json(
      await updateProfile(deps.db, c.get('user'), input, deps.now()),
    );
  });

  api.post('/me/password', auth, async c => {
    const input = await jsonBody(c, passwordSchema);
    await changePassword(deps.db, c.get('session'), input, {
      now: deps.now(),
      limits: deps.limits,
      ip: deps.clientIp(c),
    });
    return c.body(null, 204);
  });

  api.post('/me/email', auth, async c => {
    const input = await jsonBody(c, emailSchema);
    // Each request mails a link to a typed address: per account, as recovery.
    const key = `user:${c.get('user').id}`;
    const wait = deps.recoveryLimits.byName.retryAfter(key);
    if (wait > 0) throw rateLimited(wait, 'envíos de verificación');
    deps.recoveryLimits.byName.hit(key);
    const message = await requestEmail(deps.db, c.get('user'), input.email, {
      now: deps.now(),
      base: requestBase(deps.config, c.req.header('Origin')),
    });
    if (message) deps.mail.queue(message);
    return c.body(null, 202);
  });

  api.delete('/me/email', auth, async c => {
    await removeEmail(deps.db, c.get('user'), deps.now());
    return c.body(null, 204);
  });

  api.post('/me/welcome', auth, async c => {
    await markWelcomed(deps.db, c.get('user'), deps.now());
    return c.body(null, 204);
  });

  api.get('/me/sessions', auth, async c => {
    const body: ListResponse<SessionInfo> = {
      items: await listSessions(deps.db, c.get('session'), deps.now()),
    };
    return c.json(body);
  });

  api.delete('/me/sessions/:id', auth, async c => {
    await revokeSession(
      deps.db,
      c.get('session'),
      c.req.param('id'),
      deps.now(),
    );
    return c.body(null, 204);
  });

  api.delete('/me/sessions', auth, async c => {
    await revokeOtherSessions(deps.db, c.get('session'), deps.now());
    return c.body(null, 204);
  });

  api.get('/me/security', auth, async c => {
    const body: ListResponse<SecurityEvent> = {
      items: await listOwnSecurity(deps.db, c.get('user').id),
    };
    return c.json(body);
  });

  api.get('/organizations/:orgId/members', auth, async c => {
    const body: ListResponse<MemberProfile> = {
      items: await listMembers(deps.db, c.get('user'), c.req.param('orgId')),
    };
    return c.json(body);
  });
}
