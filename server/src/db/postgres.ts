/**
 * Db adapter over postgres.js v4. Every query goes through `unsafe(text,
 * params)`: the text is always a constant written in this repository and the
 * values travel separately as `$n` parameters, never inside the string.
 */
import postgres from 'postgres';
import type {ISql} from 'postgres';
import {normalizeParams} from './db.ts';
import type {Db, Queryable} from './db.ts';

export interface PostgresDbOptions {
  /** Pool size. */
  max?: number;
}

function wrap(sql: ISql): Queryable {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const rows = await sql.unsafe(text, normalizeParams(params) as never[]);
      return Array.from(rows) as T[];
    },
    async exec(text: string): Promise<void> {
      // Without parameters postgres.js uses the simple protocol, which
      // accepts several statements in one string.
      await sql.unsafe(text);
    },
  };
}

export function createPostgresDb(
  url: string,
  options: PostgresDbOptions = {},
): Db {
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 60,
    connect_timeout: 10,
    onnotice: () => {},
    connection: {application_name: 'oxeye-logistics'},
  });
  const base = wrap(sql);
  return {
    ...base,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const result = await sql.begin(tx => fn(wrap(tx)));
      return result as T;
    },
    async close(): Promise<void> {
      await sql.end({timeout: 5});
    },
  };
}
