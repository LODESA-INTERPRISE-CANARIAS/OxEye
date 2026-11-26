import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {ConfigError, loadConfig} from '../src/config.ts';
import {migrate} from '../src/db/migrate.ts';
import {DbLockedError, openDb} from '../src/db/open.ts';

const root = mkdtempSync(join(tmpdir(), 'oxeye-pglite-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));

describe('local database without Docker (pglite:)', () => {
  it('persists data in a folder across restarts', async () => {
    const url = `pglite:${join(root, 'data')}`;
    const first = await openDb(url);
    await migrate(first);
    await first.close();

    const again = await openDb(url);
    const rows = await again.query<{n: number}>(
      'SELECT count(*)::int AS n FROM organizations',
    );
    expect(rows[0].n).toBe(0);
    const result = await migrate(again);
    expect(result.applied).toEqual([]);
    await again.close();
  }, 30_000);

  it('refuses a second process while the folder is in use, then frees it', async () => {
    const url = `pglite:${join(root, 'locked')}`;
    const holder = await openDb(url);
    await expect(openDb(url)).rejects.toBeInstanceOf(DbLockedError);
    await holder.close();
    const next = await openDb(url);
    await next.close();
  }, 30_000);

  it('is accepted in development and refused in production', () => {
    expect(
      loadConfig({DATABASE_URL: 'pglite:./pgdata/pglite'}).databaseUrl,
    ).toBe('pglite:./pgdata/pglite');
    expect(() =>
      loadConfig({
        DATABASE_URL: 'pglite:./pgdata/pglite',
        NODE_ENV: 'production',
      }),
    ).toThrow(ConfigError);
  });
});
