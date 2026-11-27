/**
 * Minimal typed HTTP client for the Logistics Manager API.
 *
 * Every failure becomes an `ApiError` with a code the UI can branch on and a
 * plain Spanish message. Network failures, timeouts and proxy errors without a
 * contract body map to `UNAVAILABLE` («Servidor no disponible»).
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
} from '../../../shared/logistics/contracts.ts';

export type ClientErrorCode = ApiErrorCode | 'UNAVAILABLE' | 'NOT_CONFIGURED';

const REQUEST_TIMEOUT_MS = 15_000;

const FALLBACK_MESSAGES: Record<ClientErrorCode, string> = {
  VALIDATION: 'Revisa los datos marcados.',
  UNAUTHENTICATED: 'Tu sesión ha caducado. Vuelve a entrar.',
  FORBIDDEN: 'No tienes permiso para hacer este cambio.',
  NOT_FOUND: 'No se ha encontrado lo que buscabas.',
  VERSION_CONFLICT: 'Otra persona ha cambiado este registro.',
  DUPLICATE: 'Ya existe un registro con ese nombre.',
  RATE_LIMITED: 'Demasiados intentos. Espera un momento y vuelve a probar.',
  INTERNAL: 'El servidor ha tenido un problema. Inténtalo de nuevo.',
  UNAVAILABLE: 'Servidor no disponible.',
  NOT_CONFIGURED: 'El Gestor logístico no tiene servidor configurado.',
};

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'VERSION_CONFLICT',
  422: 'VALIDATION',
  429: 'RATE_LIMITED',
};

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly current?: unknown;
  /** Seconds to wait, from the `Retry-After` header of a 429. */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    code: ClientErrorCode;
    status: number;
    message?: string;
    fields?: Record<string, string>;
    current?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(init.message || FALLBACK_MESSAGES[init.code]);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.fields = init.fields;
    this.current = init.current;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** True when the server could not be reached at all. */
  get isUnavailable(): boolean {
    return this.code === 'UNAVAILABLE';
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Plain Spanish message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (isApiError(err)) return err.message;
  return FALLBACK_MESSAGES.INTERNAL;
}

/**
 * Base URL of the API. `VITE_LOGISTICS_API_URL` wins; in development the
 * relative `/api` goes through the Vite proxy. A production build without the
 * variable has no server to talk to, which the UI shows as «not configured».
 */
export function resolveApiBaseUrl(): string | null {
  const configured = (import.meta.env.VITE_LOGISTICS_API_URL ?? '') as string;
  const trimmed = configured.trim();
  if (trimmed) return trimmed.replace(/\/+$/, '');
  if (import.meta.env.DEV) return '/api';
  return null;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).code === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Told when the server refuses a session token (401), whoever made the
 * call: the store's own calls, a screen's direct `api.*` call or a photo.
 * The store ends the session only if it is still the one in use.
 */
let onTokenRejected: ((token: string) => void) | null = null;

export function setTokenRejectedHandler(
  handler: ((token: string) => void) | null,
): void {
  onTokenRejected = handler;
}

/** Report a 401 for `token` (also used by calls outside `apiRequest`). */
export function reportTokenRejected(token: string | null | undefined): void {
  if (token) onTokenRejected?.(token);
}

export interface RequestOptions {
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const base = resolveApiBaseUrl();
  if (!base) throw new ApiError({code: 'NOT_CONFIGURED', status: 0});

  const headers: Record<string, string> = {Accept: 'application/json'};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError({code: 'UNAVAILABLE', status: 0});
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }

  if (response.status === 204) return undefined as T;
  if (response.status === 401) reportTokenRejected(options.token);

  let payload: unknown = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (response.ok) {
    if (payload === null && text) {
      // A static host answered instead of the API (e.g. an HTML page).
      throw new ApiError({code: 'UNAVAILABLE', status: response.status});
    }
    return payload as T;
  }

  if (isErrorBody(payload)) {
    throw new ApiError({
      code: payload.code,
      status: response.status,
      message: payload.message,
      fields: payload.fields,
      current: payload.current,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    });
  }

  // No contract body: a proxy or host error rather than the API itself.
  const mapped = STATUS_CODES[response.status];
  if (!mapped) {
    throw new ApiError({code: 'UNAVAILABLE', status: response.status});
  }
  throw new ApiError({
    code: mapped,
    status: response.status,
    retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
  });
}
