/**
 * Shared plumbing for the command-line tools: configuration, a database
 * connection that is always closed, and readable errors (never the
 * connection string, which carries the database password).
 */
import {ConfigError, loadConfig} from '../config.ts';
import type {Db} from '../db/db.ts';
import {MigrationError} from '../db/migrate.ts';
import {DbLockedError, openDb} from '../db/open.ts';

export async function runCli(task: (db: Db) => Promise<void>): Promise<void> {
  let db: Db | undefined;
  try {
    const config = loadConfig();
    db = await openDb(config.databaseUrl, {max: 2});
    await task(db);
  } catch (err) {
    if (
      err instanceof ConfigError ||
      err instanceof MigrationError ||
      err instanceof DbLockedError
    ) {
      console.error(err.message);
    } else {
      const e = err instanceof Error ? err : new Error(String(err));
      const code = (e as {code?: unknown}).code;
      console.error(
        `Error: ${e.message}${typeof code === 'string' ? ` [${code}]` : ''}`,
      );
      if (code === 'ECONNREFUSED') {
        console.error(
          '¿Está arrancada la base de datos? docker compose -f server/docker-compose.yml up -d',
        );
      }
    }
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
