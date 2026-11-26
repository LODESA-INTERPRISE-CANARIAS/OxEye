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

const ALL_MIGRATIONS = [
  '0001_init.sql',
  '0002_tasks.sql',
  '0003_demo_removed.sql',
];

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
    expect(first.applied).toEqual(ALL_MIGRATIONS);
    expect(first.alreadyApplied).toEqual([]);

    const tables = await db.query<{table_name: string}>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map(t => t.table_name)).toEqual([
      'activity_log',
      'companies',
      'events',
      'organization_members',
      'organizations',
      'schema_migrations',
      'sessions',
      'task_dependencies',
      'tasks',
      'users',
      'venues',
    ]);

    const second = await migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(ALL_MIGRATIONS);
    expect(await pendingMigrations(db)).toEqual([]);
    const rows = await db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM schema_migrations',
    );
    expect(rows[0]?.n).toBe(ALL_MIGRATIONS.length);
    await db.close();
  });

  it('0002 applies on top of a 0001 database that already has data', async () => {
    const [m1, m2] = readMigrations();
    const dir = tempMigrations({[m1!.file]: m1!.sql});
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toEqual(['0001_init.sql']);

    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org') RETURNING id",
    );
    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash)
       VALUES ('Ana', 'member', 'x') RETURNING id`,
    );
    await db.query(
      `INSERT INTO events (organization_id, name, local_date, starts_at, ends_at, created_by, updated_by)
       VALUES ($1, 'Evento existente', '2026-12-02', '2026-12-02T09:00:00Z', '2026-12-02T14:00:00Z', $2, $2)`,
      [org!.id, user!.id],
    );

    writeFileSync(join(dir, m2!.file), m2!.sql);
    expect((await migrate(db, {dir})).applied).toEqual(['0002_tasks.sql']);

    const [event] = await db.query<{id: string; end_date: string | null}>(
      'SELECT id, end_date::text AS end_date FROM events',
    );
    expect(event?.end_date).toBeNull();

    // The new constraints hold.
    await expect(
      db.query("UPDATE events SET end_date = '2026-12-01'"),
    ).rejects.toThrow();
    await db.query("UPDATE events SET end_date = '2026-12-04'");
    const [task] = await db.query<{heavy_load: boolean | null; kind: string}>(
      `INSERT INTO tasks (organization_id, event_id, title, created_by, updated_by)
       VALUES ($1, $2, 'Montaje', $3, $3) RETURNING heavy_load, kind`,
      [org!.id, event!.id, user!.id],
    );
    // Unknown load stays unknown.
    expect(task).toEqual({heavy_load: null, kind: 'other'});
    await expect(
      db.query(
        `INSERT INTO tasks (organization_id, title, kind, created_by, updated_by)
         VALUES ($1, 'x', 'party', $2, $2)`,
        [org!.id, user!.id],
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it('0003 applies on top of a 0002 database with data and marks the organizations that removed their demo', async () => {
    const [m1, m2, m3] = readMigrations();
    const dir = tempMigrations({[m1!.file]: m1!.sql, [m2!.file]: m2!.sql});
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toEqual([
      '0001_init.sql',
      '0002_tasks.sql',
    ]);

    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash)
       VALUES ('Ana', 'member', 'x') RETURNING id`,
    );
    const org = async (name: string) =>
      (
        await db.query<{id: string}>(
          'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
          [name],
        )
      )[0]!.id;
    // Still has its demo event (and a real task hanging from it).
    const withDemo = await org('Con demo');
    const [demoEvent] = await db.query<{id: string}>(
      `INSERT INTO events (organization_id, name, is_demo, created_by, updated_by)
       VALUES ($1, 'Demo', true, $2, $2) RETURNING id`,
      [withDemo, user!.id],
    );
    await db.query(
      `INSERT INTO tasks (organization_id, event_id, title, created_by, updated_by)
       VALUES ($1, $2, 'Montaje real', $3, $3)`,
      [withDemo, demoEvent!.id, user!.id],
    );
    // Removed through the API: the removal was logged.
    const viaApi = await org('Borrada desde la app');
    await db.query(
      `INSERT INTO activity_log (organization_id, user_id, entity_type, entity_id,
                                 entity_label, action, at)
       VALUES ($1, $2, 'demo', $1, 'Datos de demostración', 'delete',
               '2026-12-01T18:00:00Z')`,
      [viaApi, user!.id],
    );
    // Removed with db:clear-demo before 0003: nothing was logged.
    await org('Borrada por consola');

    writeFileSync(join(dir, m3!.file), m3!.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0003_demo_removed.sql',
    ]);

    const rows = await db.query<{name: string; removed: Date | null}>(
      'SELECT name, demo_removed_at AS removed FROM organizations ORDER BY name',
    );
    const byName = new Map(rows.map(r => [r.name, r.removed]));
    expect(byName.get('Con demo')).toBeNull();
    expect(byName.get('Borrada desde la app')?.toISOString()).toBe(
      '2026-12-01T18:00:00.000Z',
    );
    expect(byName.get('Borrada por consola')).toBeInstanceOf(Date);
    // Nothing else changed.
    const counts = await db.query<{events: number; tasks: number}>(
      `SELECT (SELECT count(*)::int FROM events) AS events,
              (SELECT count(*)::int FROM tasks) AS tasks`,
    );
    expect(counts[0]).toEqual({events: 1, tasks: 1});
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
