/**
 * Opens the database named by DATABASE_URL.
 *
 * - `postgres://…` / `postgresql://…`: PostgreSQL (local Docker or the
 *   external server).
 * - `pglite:<dir>`: embedded PostgreSQL in a local folder, for laptops without
 *   Docker. Development only (config refuses it in production). PGlite is
 *   single-process, so a lock file stops the API and a db:* command from
 *   opening the same folder at once.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import type {Db} from './db.ts';
import {createPostgresDb} from './postgres.ts';

export const PGLITE_PREFIX = 'pglite:';
export const DEFAULT_PGLITE_DIR = './pgdata/pglite';

export class DbLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbLockedError';
  }
}

export function isPgliteUrl(url: string): boolean {
  return url.startsWith(PGLITE_PREFIX);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but belongs to someone else.
    return (err as {code?: string}).code === 'EPERM';
  }
}

/** Takes an exclusive lock file next to the data folder; returns its release. */
export function lockDataDir(dataDir: string): () => void {
  const lockPath = `${resolve(dataDir)}.lock`;
  mkdirSync(dirname(lockPath), {recursive: true});
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(lockPath, {force: true});
    } catch (err) {
      if ((err as {code?: string}).code !== 'EEXIST') throw err;
      const owner = Number(readFileSync(lockPath, 'utf8').trim());
      if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) {
        throw new DbLockedError(
          `La base de datos local (${dataDir}) está en uso por otro proceso (pid ${owner}). ` +
            'Para la API (Ctrl+C) antes de ejecutar db:migrate, db:seed o db:clear-demo.',
        );
      }
      // Stale lock from a crashed process.
      rmSync(lockPath, {force: true});
    }
  }
  throw new DbLockedError(`No se pudo bloquear ${lockPath}.`);
}

export async function openDb(
  url: string,
  options: {max?: number} = {},
): Promise<Db> {
  if (!isPgliteUrl(url)) return createPostgresDb(url, options);
  const dataDir = url.slice(PGLITE_PREFIX.length).trim() || DEFAULT_PGLITE_DIR;
  const release = lockDataDir(dataDir);
  try {
    mkdirSync(dataDir, {recursive: true});
    // Loaded on demand: the production image never needs PGlite.
    const {createPgliteDb} = await import('./pglite.ts');
    const db = await createPgliteDb(dataDir);
    return {
      ...db,
      async close() {
        try {
          await db.close();
        } finally {
          release();
        }
      },
    };
  } catch (err) {
    release();
    throw err;
  }
}
