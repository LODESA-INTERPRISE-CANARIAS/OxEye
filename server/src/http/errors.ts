/**
 * Maps errors to contract `ApiErrorBody` responses. Unexpected errors are
 * logged without request data (no bodies, tokens or passwords) and answered
 * with a generic message.
 */
import type {Context} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {AppError} from '../errors.ts';
import type {
  ApiErrorBody,
  ApiErrorCode,
} from '../../../shared/logistics/contracts.ts';

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function errorResponse(c: Context, err: AppError): Response {
  if (err.retryAfter !== undefined) {
    c.header('Retry-After', String(err.retryAfter));
  }
  return c.json(err.toBody(), STATUS[err.code]);
}

export function handleError(
  err: unknown,
  c: Context,
  log: (line: string) => void,
): Response {
  if (err instanceof AppError) return errorResponse(c, err);
  const e = err instanceof Error ? err : new Error(String(err));
  const code = (e as {code?: unknown}).code;
  // Driver errors may carry row values in `detail`: log only name, code and message.
  log(
    `Error interno en ${c.req.method} ${c.req.path}: ${e.name}${typeof code === 'string' ? ` [${code}]` : ''}: ${e.message}`,
  );
  const body: ApiErrorBody = {
    code: 'INTERNAL',
    message:
      'Algo ha fallado en el servidor. Inténtalo de nuevo en unos segundos.',
  };
  return c.json(body, 500);
}

export function notFoundResponse(c: Context): Response {
  const body: ApiErrorBody = {
    code: 'NOT_FOUND',
    message: 'Esta dirección no existe en el servidor del Gestor logístico.',
  };
  return c.json(body, 404);
}
