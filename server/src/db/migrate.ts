/**
 * Forward-only SQL migrations. Files `server/migrations/NNNN_name.sql` are
 * applied in order, each in its own transaction, and recorded with a SHA-256
 * checksum in `schema_migrations`. An applied migration must never change:
 * the runner refuses to continue if its checksum differs (add a new one
 * instead). Running it again is a no-op.
 */
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Db} from './db.ts';

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
);

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
/** Serialises concurrent runners (two API instances starting at once). */
const LOCK_KEY = 727_274_001;

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function readMigrations(dir = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  const seen = new Set<string>();
  return files.map(file => {
    const m = FILE_RE.exec(file);
    if (!m) {
      throw new MigrationError(
        `Nombre de migración no válido: ${file} (usa NNNN_nombre.sql en minúsculas)`,
      );
    }
    const version = m[1] as string;
    if (seen.has(version)) {
      throw new MigrationError(`Hay dos migraciones con el número ${version}`);
    }
    seen.add(version);
    const sql = readFileSync(join(dir, file), 'utf8');
    return {
      version,
      name: m[2] as string,
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
}

async function appliedMigrations(db: Db): Promise<Map<string, AppliedRow>> {
  await db.exec(CREATE_TABLE);
  const rows = await db.query<AppliedRow>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map(r => [r.version, r]));
}

function checkUnchanged(file: MigrationFile, row: AppliedRow): void {
  if (row.checksum !== file.checksum) {
    throw new MigrationError(
      `La migración ${file.file} ya se aplicó y su contenido ha cambiado. ` +
        'No se editan migraciones aplicadas: deshaz el cambio y añade una migración nueva.',
    );
  }
}

/** Migrations present in the directory and not yet applied. */
export async function pendingMigrations(
  db: Db,
  dir = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationFile[]> {
  const files = readMigrations(dir);
  const applied = await appliedMigrations(db);
  return files.filter(f => {
    const row = applied.get(f.version);
    if (row) checkUnchanged(f, row);
    return !row;
  });
}

export async function migrate(
  db: Db,
  options: {dir?: string; log?: (line: string) => void} = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});
  const files = readMigrations(options.dir);
  const applied = await appliedMigrations(db);
  const known = new Set(files.map(f => f.version));
  for (const version of applied.keys()) {
    if (!known.has(version)) {
      log(
        `Aviso: la base de datos tiene la migración ${version}, que no está en este código (¿versión antigua del servidor?).`,
      );
    }
  }

  const result: MigrateResult = {applied: [], alreadyApplied: []};
  for (const file of files) {
    const row = applied.get(file.version);
    if (row) {
      checkUnchanged(file, row);
      result.alreadyApplied.push(file.file);
      continue;
    }
    const didApply = await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [LOCK_KEY]);
      // Another runner may have applied it while we waited for the lock.
      const again = await tx.query<{checksum: string}>(
        'SELECT checksum FROM schema_migrations WHERE version = $1',
        [file.version],
      );
      if (again.length > 0) return false;
      await tx.exec(file.sql);
      await tx.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [file.version, file.name, file.checksum],
      );
      return true;
    });
    if (didApply) {
      result.applied.push(file.file);
      log(`Aplicada ${file.file}`);
    } else {
      result.alreadyApplied.push(file.file);
    }
  }
  return result;
}
