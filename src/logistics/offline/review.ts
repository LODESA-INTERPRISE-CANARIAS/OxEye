/**
 * «Revisar» a change that the server did not accept (M6): what a sheet needs
 * to reopen it as the user left it, with the server's answer replayed into
 * the form (the M5 merge for a 409, the duplicate notice, field errors).
 */
import type {OutboxEntry} from '../../../shared/logistics/outbox.ts';
import {ApiError, type ClientErrorCode} from '../api/client';
import {queuedRecord} from '../store/useLogisticsStore';

export interface FormReview {
  /** The outbox entry the next save resolves (`WriteOptions.replaces`). */
  entryId: string;
  /** The record as the user queued it; the form starts from its values. */
  mine: unknown;
  /** The server's answer, applied once when the form opens. */
  error: ApiError | null;
}

/** The server's answer of an entry as the error the forms already handle. */
export function entryError(entry: OutboxEntry): ApiError | null {
  if (!entry.error) return null;
  return new ApiError({
    code: entry.error.code as ClientErrorCode,
    status: entry.status === 'conflict' ? 409 : 400,
    message: entry.error.message,
    fields: entry.error.fields,
    current: entry.current ?? undefined,
  });
}

export function reviewOf(entry: OutboxEntry): FormReview {
  return {
    entryId: entry.id,
    mine: queuedRecord(entry),
    error: entryError(entry),
  };
}

/** The store's write options for a save made from a review. */
export const replacing = (review: FormReview | undefined) =>
  review ? {replaces: review.entryId} : undefined;
