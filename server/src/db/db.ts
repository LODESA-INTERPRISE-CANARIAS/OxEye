/**
 * The small database interface the whole backend uses. Plain parameterised
 * SQL with `$1` placeholders; no ORM. Two adapters implement it: postgres.js
 * for the real server and PGlite (in-process PostgreSQL) for tests.
 *
 * Adapter rules, so both behave the same:
 * - `undefined` parameters are sent as NULL.
 * - Pass instants as ISO strings and cast where the query does not decide the
 *   type (`$1::timestamptz`); `timestamptz` columns come back as `Date`.
 * - Cast counts to `int` (`count(*)::int`): `bigint` differs between drivers.
 * - JSON goes in as a string with `$n::jsonb` and comes back parsed.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  /** Runs one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction; it commits when `fn` resolves, rolls back when it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Normalises a parameter list for the drivers. */
export function normalizeParams(params: readonly unknown[] = []): unknown[] {
  return params.map(p => (p === undefined ? null : p));
}

/** PostgreSQL error code of a driver error, if any (both drivers expose `code`). */
export function pgErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as {code: unknown}).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export const UNIQUE_VIOLATION = '23505';

/** Converts a driver timestamp (Date or string) to an ISO 8601 UTC string. */
export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new TypeError(`Expected a timestamp, got ${typeof value}`);
}

export function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}
