import {z} from 'zod';
import type {Hono, MiddlewareHandler} from 'hono';
import {deviceOf} from '../auth/routes.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody, parseWith, REQUIRED, uuid} from '../http/validate.ts';
import {requestBase} from '../mail/links.ts';
import {
  createResetLink,
  endSupportSession,
  listAdminSecurity,
  listAdminUsers,
  listSupportSessions,
  setProvisionalPassword,
  setRoles,
  startSupport,
  updateSharedProfile,
  viewAsGuest,
} from './service.ts';
import {uploadMediaSchema} from '../media/schemas.ts';
import {versionField} from '../records/schemas.ts';
import {
  DISPLAY_NAME_MAX,
  PASSWORD_MAX,
  SUPPORT_MINUTES_MAX,
  SUPPORT_MINUTES_MIN,
  SUPPORT_REASON_MAX,
  SUPPORT_REASON_MIN,
} from '../../../shared/logistics/account.ts';
import {ORG_ROLES} from '../../../shared/logistics/permissions.ts';
import type {
  AdminUser,
  ListResponse,
  ResetLinkResponse,
  SecurityEvent,
  SupportSession,
} from '../../../shared/logistics/contracts.ts';

const rolesSchema = z.object({
  organizationId: uuid.transform(v => v.toLowerCase()),
  roles: z
    .array(z.enum(ORG_ROLES, {error: 'Rol no válido.'}), {
      error: 'Indica la lista de roles (puede estar vacía).',
    })
    .max(ORG_ROLES.length * 2, {error: 'Demasiados roles.'}),
});

const MINUTES = `Indica entre ${SUPPORT_MINUTES_MIN} y ${SUPPORT_MINUTES_MAX} minutos.`;
const REASON = `Explica el motivo en ${SUPPORT_REASON_MIN}–${SUPPORT_REASON_MAX} caracteres: la persona lo verá en su historial.`;

const supportSchema = z.object({
  userId: uuid.transform(v => v.toLowerCase()),
  reason: z
    .string({error: REQUIRED})
    .transform(v => v.trim().replace(/\s+/g, ' '))
    .refine(
      v =>
        [...v].length >= SUPPORT_REASON_MIN &&
        [...v].length <= SUPPORT_REASON_MAX,
      {error: REASON},
    ),
  password: z
    .string({error: REQUIRED})
    .min(1, {error: 'Escribe tu contraseña para confirmar que eres tú.'})
    .max(PASSWORD_MAX, {error: 'Tu contraseña no es correcta.'}),
  minutes: z
    .number({error: MINUTES})
    .int({error: MINUTES})
    .min(SUPPORT_MINUTES_MIN, {error: MINUTES})
    .max(SUPPORT_MINUTES_MAX, {error: MINUTES}),
});

/** PATCH /admin/users/:id/profile (AdminProfileInput); shared accounts only. */
const adminProfileSchema = z.object({
  version: versionField('la cuenta'),
  displayName: z
    .string({error: 'Debe ser un texto.'})
    .trim()
    .min(1, {error: 'Escribe el nombre que verán los demás.'})
    .max(DISPLAY_NAME_MAX, {error: `Máximo ${DISPLAY_NAME_MAX} caracteres.`})
    .optional(),
  photo: uploadMediaSchema
    .pick({contentType: true, width: true, height: true, data: true})
    .nullable()
    .optional(),
});

const viewAsGuestSchema = z.object({
  organizationId: uuid.transform(v => v.toLowerCase()).optional(),
});

const securityLimit = z.object({
  limit: z.coerce
    .number({error: 'Indica un número entero entre 1 y 200.'})
    .int()
    .min(1)
    .max(200)
    .default(200),
});

/**
 * Administration (Revisión 1 · E4). Each service checks its permission in
 * the organizations involved; a support session never reaches these routes
 * (auth middleware).
 */
export function registerAdminRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  api.get('/admin/users', auth, async c => {
    const body: ListResponse<AdminUser> = {
      items: await listAdminUsers(deps.db, c.get('user'), deps.now()),
    };
    return c.json(body);
  });

  api.put('/admin/users/:id/roles', auth, async c => {
    const input = await jsonBody(c, rolesSchema);
    return c.json(
      await setRoles(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input,
        deps.now(),
      ),
    );
  });

  api.patch('/admin/users/:id/profile', auth, async c => {
    const input = await jsonBody(c, adminProfileSchema);
    return c.json(
      await updateSharedProfile(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input,
        deps.now(),
      ),
    );
  });

  api.post('/admin/users/:id/provisional-password', auth, async c =>
    c.json(
      await setProvisionalPassword(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        deps.now(),
      ),
    ),
  );

  api.post('/admin/users/:id/reset-link', auth, async c => {
    const link = await createResetLink(
      deps.db,
      c.get('user'),
      c.req.param('id'),
      {
        now: deps.now(),
        base: requestBase(deps.config, c.req.header('Origin')),
        fallback: deps.config.mail.recoveryFallback,
        mailConfigured: deps.mail.configured,
      },
    );
    if (link.message) {
      await deps.mail.send(link.message);
      return c.body(null, 202);
    }
    const body: ResetLinkResponse = {url: link.url, expiresAt: link.expiresAt};
    return c.json(body);
  });

  api.post('/admin/support-sessions', auth, async c => {
    const input = await jsonBody(c, supportSchema);
    const session = await startSupport(deps.db, c.get('user'), input, {
      now: deps.now(),
      limits: deps.limits,
      ip: deps.clientIp(c),
      device: deviceOf(c),
      sessionDays: deps.config.sessionDays,
    });
    return c.json(session, 201);
  });

  api.post('/admin/view-as-guest', auth, async c => {
    const input = await jsonBody(c, viewAsGuestSchema);
    const session = await viewAsGuest(deps.db, c.get('user'), input, {
      now: deps.now(),
      device: deviceOf(c),
      sessionDays: deps.config.sessionDays,
    });
    return c.json(session, 201);
  });

  api.get('/admin/support-sessions', auth, async c => {
    const body: ListResponse<SupportSession> = {
      items: await listSupportSessions(deps.db, c.get('user'), deps.now()),
    };
    return c.json(body);
  });

  api.delete('/admin/support-sessions/:id', auth, async c => {
    await endSupportSession(
      deps.db,
      c.get('session'),
      c.req.param('id'),
      deps.now(),
    );
    return c.body(null, 204);
  });

  api.get('/admin/security', auth, async c => {
    const {limit} = parseWith(securityLimit, {
      limit: c.req.query('limit') || undefined,
    });
    const body: ListResponse<SecurityEvent> = {
      items: await listAdminSecurity(deps.db, c.get('user'), limit),
    };
    return c.json(body);
  });
}
