/**
 * Domain errors. Services throw AppError with a contract error code and a
 * plain-Spanish message; the HTTP layer maps the code to a status.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
} from '../../shared/logistics/contracts.ts';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly current: unknown;
  /** Seconds the client should wait (RATE_LIMITED). */
  readonly retryAfter: number | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    extra: {
      fields?: Record<string, string>;
      current?: unknown;
      retryAfter?: number;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fields = extra.fields;
    this.current = extra.current;
    this.retryAfter = extra.retryAfter;
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = {code: this.code, message: this.message};
    if (this.fields) body.fields = this.fields;
    if (this.current !== undefined) body.current = this.current;
    return body;
  }
}

export function validationError(
  fields: Record<string, string>,
  message = 'Revisa los campos marcados.',
): AppError {
  return new AppError('VALIDATION', message, {fields});
}

export function notFound(message: string): AppError {
  return new AppError('NOT_FOUND', message);
}
