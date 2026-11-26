/**
 * Db adapter over PGlite (PostgreSQL compiled to WASM, in process). Used by
 * the tests so they exercise the real SQL and migrations without Docker.
 * PGlite is a devDependency: production code must never import this file.
 */
import {PGlite} from '@electric-sql/pglite';
import {normalizeParams} from './db.ts';
import type {Db, Queryable} from './db.ts';

interface PgliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{rows: T[]}>;
  exec(text: string): Promise<unknown>;
}

function wrap(pg: PgliteLike): Queryable {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await pg.query<T>(text, normalizeParams(params));
      return result.rows;
    },
    async exec(text: string): Promise<void> {
      await pg.exec(text);
    },
  };
}

/** In-memory database unless `dataDir` is given. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pg = await PGlite.create(dataDir);
  const base = wrap(pg);
  return {
    ...base,
    transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pg.transaction(tx => fn(wrap(tx)));
    },
    close(): Promise<void> {
      return pg.close();
    },
  };
}
