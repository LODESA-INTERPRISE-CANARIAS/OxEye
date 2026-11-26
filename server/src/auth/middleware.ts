/**
 * Bearer authentication and the read-only rule for guests.
 */
import type {MiddlewareHandler} from 'hono';
import {AppError} from '../errors.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {resolveSession} from './sessions.ts';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes a guest may still do: ending their own session. */
const GUEST_WRITES = new Set(['/api/auth/logout']);

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? (m[1] as string) : null;
}

export function requireAuth(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token) {
      throw new AppError('UNAUTHENTICATED', 'Inicia sesión para continuar.');
    }
    const user = await resolveSession(
      deps.db,
      token,
      deps.now(),
      deps.config.sessionDays,
    );
    if (!user) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Tu sesión ha caducado o se ha cerrado. Vuelve a iniciar sesión.',
      );
    }
    if (
      user.role === 'guest' &&
      !READ_METHODS.has(c.req.method) &&
      !GUEST_WRITES.has(c.req.path)
    ) {
      throw new AppError(
        'FORBIDDEN',
        'El usuario Invitado solo puede consultar. Entra con tu usuario para hacer cambios.',
      );
    }
    c.set('user', user);
    c.set('token', token);
    await next();
  };
}
