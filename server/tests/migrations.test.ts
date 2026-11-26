import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {createPgliteDb} from '../src/db/pglite.ts';
import {
  migrate,
  MigrationError,
  pendingMigrations,
  readMigrations,
} from '../src/db/migrate.ts';

const tempDirs: string[] = [];
function tempMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'oxeye-migrations-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) rmSync(d, {recursive: true, force: true});
});

describe('migrations', () => {
  it('apply cleanly from an empty database and re-running is a no-op', async () => {
    const db = await createPgliteDb();
    const first = await migrate(db);
    expect(first.applied).toEqual(['0001_init.sql']);
    expect(first.alreadyApplied).toEqual([]);

    const tables = await db.query<{table_name: string}>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map(t => t.table_name)).toEqual([
      'activity_log',
      'events',
      'organization_members',
      'organizations',
      'schema_migrations',
      'sessions',
      'users',
      'venues',
    ]);

    const second = await migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(['0001_init.sql']);
    expect(await pendingMigrations(db)).toEqual([]);
    const rows = await db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM schema_migrations',
    );
    expect(rows[0]?.n).toBe(1);
    await db.close();
  });

  it('uses only timestamptz for instants (no naive timestamps)', async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const naive = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`,
    );
    expect(naive).toEqual([]);
    await db.close();
  });

  it('refuses to continue when an applied migration was edited', async () => {
    const db = await createPgliteDb();
    const dir = tempMigrations({'0001_a.sql': 'CREATE TABLE a (id int);'});
    await migrate(db, {dir});
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (id bigint);');
    await expect(migrate(db, {dir})).rejects.toBeInstanceOf(MigrationError);
    await db.close();
  });

  it('applies new migrations in order and rolls back a failing one', async () => {
    const db = await createPgliteDb();
    const dir = tempMigrations({
      '0002_b.sql': 'CREATE TABLE b (a_id int REFERENCES a (id));',
      '0001_a.sql': 'CREATE TABLE a (id int PRIMARY KEY);',
    });
    expect((await migrate(db, {dir})).applied).toEqual([
      '0001_a.sql',
      '0002_b.sql',
    ]);

    writeFileSync(
      join(dir, '0003_bad.sql'),
      'CREATE TABLE c (id int); SELECT * FROM missing_table;',
    );
    await expect(migrate(db, {dir})).rejects.toThrow();
    const c = await db.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'c'",
    );
    expect(c).toEqual([]);
    expect((await pendingMigrations(db, dir)).map(m => m.file)).toEqual([
      '0003_bad.sql',
    ]);
    await db.close();
  });

  it('rejects badly named migration files', () => {
    const dir = tempMigrations({'1_init.sql': 'SELECT 1;'});
    expect(() => readMigrations(dir)).toThrow(MigrationError);
  });
});
