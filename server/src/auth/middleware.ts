/**
 * Bearer authentication and the request-wide access rules:
 * - the guest account (and «Ver como Invitado», which is a session of it)
 *   only reads; it may still log out;
 * - a support session never reaches the account's own settings (/me/…:
 *   password, e-mail, sessions, profile, security history) nor
 *   administration (/admin/…); GET /me stays, for the banner;
 * - other writes need `plan.edit` (E4), except the account and
 *   administration routes, personal searches and images, which check their
 *   own rules.
 */
import type {MiddlewareHandler} from 'hono';
import {AppError} from '../errors.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {permissionsIn} from '../organizations/service.ts';
import {NO_ACCESS} from '../../../shared/logistics/permissions.ts';
import {resolveSession} from './sessions.ts';
import type {SessionContext} from './sessions.ts';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes a guest may still do: ending their own session. */
const GUEST_WRITES = new Set(['/api/auth/logout']);

const SUPPORT_BLOCKED =
  'Durante una sesión de soporte no se puede entrar en la cuenta personal ni en la administración.';
const GUEST_NO_ACCOUNT =
  'La cuenta Invitado es compartida: no tiene perfil, sesiones ni historial propios.';

/** Writes that are not plan edits; they check their own rules. */
const NOT_PLAN_WRITES = [
  /^\/api\/auth\//,
  /^\/api\/me(\/|$)/,
  /^\/api\/admin\//,
  /^\/api\/organizations\/[^/]+\/recent-searches$/,
  /^\/api\/media(\/|$)/,
];

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? (m[1] as string) : null;
}

/** True when the path is the own account's settings or administration. */
export function isSupportBlocked(path: string): boolean {
  return path.startsWith('/api/me/') || path.startsWith('/api/admin/');
}

function mayEditPlan(session: SessionContext): boolean {
  return session.memberships.some(m =>
    permissionsIn(session.user, m.roles).includes('plan.edit'),
  );
}

export function requireAuth(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token) {
      throw new AppError('UNAUTHENTICATED', 'Inicia sesión para continuar.');
    }
    const session = await resolveSession(
      deps.db,
      token,
      deps.now(),
      deps.config.sessionDays,
    );
    if (!session) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Tu sesión ha caducado o se ha cerrado. Vuelve a iniciar sesión.',
      );
    }
    const {user} = session;
    const path = c.req.path;
    const write = !READ_METHODS.has(c.req.method);
    if (user.role === 'guest' && write && !GUEST_WRITES.has(path)) {
      throw new AppError(
        'FORBIDDEN',
        user.support?.kind === 'view_as_guest'
          ? 'Estás viendo el Gestor como Invitado: solo se puede consultar. Sal de esta vista para hacer cambios.'
          : 'El usuario Invitado solo puede consultar. Entra con tu usuario para hacer cambios.',
      );
    }
    if (session.kind !== 'normal' && isSupportBlocked(path)) {
      throw new AppError('FORBIDDEN', SUPPORT_BLOCKED);
    }
    // The shared guest account has no profile, sessions list or history of
    // its own: those would show other people's use of it.
    if (user.role === 'guest' && path.startsWith('/api/me/')) {
      throw new AppError('FORBIDDEN', GUEST_NO_ACCOUNT);
    }
    if (
      write &&
      user.role !== 'guest' &&
      !NOT_PLAN_WRITES.some(re => re.test(path)) &&
      !mayEditPlan(session)
    ) {
      throw new AppError('FORBIDDEN', NO_ACCESS['plan.edit']);
    }
    c.set('user', user);
    c.set('token', token);
    c.set('session', session);
    await next();
  };
}
