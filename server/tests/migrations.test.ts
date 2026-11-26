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
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  BUILT_IN_SERVICE_CATEGORIES,
} from '../../shared/logistics/rules.ts';

const ALL_MIGRATIONS = [
  '0001_init.sql',
  '0002_tasks.sql',
  '0003_demo_removed.sql',
  '0004_contacts_catalogue.sql',
  '0005_inventories.sql',
  '0006_followup.sql',
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
      'categories',
      'companies',
      'company_categories',
      'contact_events',
      'contacts',
      'events',
      'hypotheses',
      'notes',
      'offers',
      'organization_members',
      'organizations',
      'recent_searches',
      'resources',
      'schema_migrations',
      'sessions',
      'task_dependencies',
      'task_resources',
      'tasks',
      'users',
      'venues',
      'warehouses',
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

  it('0004 applies on top of a milestone-2 database with tasks and companies, and gives every organization the built-in categories', async () => {
    const [m1, m2, m3, m4] = readMigrations();
    const dir = tempMigrations({
      [m1!.file]: m1!.sql,
      [m2!.file]: m2!.sql,
      [m3!.file]: m3!.sql,
    });
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(3);

    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash)
       VALUES ('Ana', 'member', 'x') RETURNING id`,
    );
    const orgIds: string[] = [];
    for (const name of ['Org A', 'Org B']) {
      orgIds.push(
        (
          await db.query<{id: string}>(
            'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
            [name],
          )
        )[0]!.id,
      );
    }
    // A milestone-2 company (with a stray main_contact_id: no contacts existed)
    // and a task that uses it.
    const [company] = await db.query<{id: string}>(
      `INSERT INTO companies (organization_id, name, main_contact_id, created_by, updated_by)
       VALUES ($1, 'Sonido Prueba', gen_random_uuid(), $2, $2) RETURNING id`,
      [orgIds[0], user!.id],
    );
    await db.query(
      `INSERT INTO tasks (organization_id, company_id, title, heavy_load, created_by, updated_by)
       VALUES ($1, $2, 'Prueba de sonido', NULL, $3, $3)`,
      [orgIds[0], company!.id, user!.id],
    );

    writeFileSync(join(dir, m4!.file), m4!.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0004_contacts_catalogue.sql',
    ]);

    // Existing rows are kept; the company is a supplier with no main contact.
    const [c] = await db.query<{
      kind: string;
      main_contact_id: string | null;
      version: number;
    }>('SELECT kind, main_contact_id, version FROM companies');
    expect(c).toEqual({kind: 'supplier', main_contact_id: null, version: 1});
    const [t] = await db.query<{
      contact_id: string | null;
      heavy_load: boolean | null;
      company_id: string;
    }>('SELECT contact_id, heavy_load, company_id FROM tasks');
    expect(t).toEqual({
      contact_id: null,
      heavy_load: null,
      company_id: company!.id,
    });

    // The SQL copy of the built-in list matches the shared constant, in order,
    // for every organization that already existed.
    for (const orgId of orgIds) {
      const cats = await db.query<{name: string; position: number}>(
        `SELECT name, position FROM categories
          WHERE organization_id = $1 AND scope = 'service' AND built_in
          ORDER BY position`,
        [orgId],
      );
      expect(cats.map(r => r.name)).toEqual([...BUILT_IN_SERVICE_CATEGORIES]);
      expect(cats.map(r => r.position)).toEqual(
        BUILT_IN_SERVICE_CATEGORIES.map((_, i) => i + 1),
      );
    }

    // The new constraints hold.
    const bad = [
      "UPDATE companies SET kind = 'shop'",
      'UPDATE companies SET main_contact_id = gen_random_uuid()',
      'UPDATE tasks SET contact_id = gen_random_uuid()',
      `INSERT INTO offers (organization_id, company_id, name, price, created_by, updated_by)
       VALUES ('${orgIds[0]}', '${company!.id}', 'x', -1, '${user!.id}', '${user!.id}')`,
      `INSERT INTO offers (organization_id, company_id, name, price, created_by, updated_by)
       VALUES ('${orgIds[0]}', '${company!.id}', 'x', 10000000.01, '${user!.id}', '${user!.id}')`,
      `INSERT INTO offers (organization_id, company_id, name, unit, custom_unit, created_by, updated_by)
       VALUES ('${orgIds[0]}', '${company!.id}', 'x', 'day', 'por escenario', '${user!.id}', '${user!.id}')`,
      `INSERT INTO categories (organization_id, scope, name, created_by)
       VALUES ('${orgIds[0]}', 'service', 'montaje', '${user!.id}')`,
      `INSERT INTO categories (organization_id, scope, name) VALUES ('${orgIds[0]}', 'service', 'Sin autor')`,
    ];
    for (const sql of bad) await expect(db.query(sql)).rejects.toThrow();
    await db.close();
  });

  it('0005 applies on top of a milestone-3 database with data, gives every organization the built-in resource categories and enforces the inventory rules', async () => {
    const [m1, m2, m3, m4, m5] = readMigrations();
    const dir = tempMigrations({
      [m1!.file]: m1!.sql,
      [m2!.file]: m2!.sql,
      [m3!.file]: m3!.sql,
      [m4!.file]: m4!.sql,
    });
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(4);

    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash)
       VALUES ('Ana', 'member', 'x') RETURNING id`,
    );
    const u = user!.id;
    const orgIds: string[] = [];
    for (const name of ['Org A', 'Org B']) {
      orgIds.push(
        (
          await db.query<{id: string}>(
            'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
            [name],
          )
        )[0]!.id,
      );
    }
    const [orgA, orgB] = orgIds as [string, string];
    // Milestone-3 data: a company with an offer, a task, an event, and in
    // Org B a custom resource category that has a built-in's name.
    const [company] = await db.query<{id: string}>(
      `INSERT INTO companies (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Carpas Prueba', $2, $2) RETURNING id`,
      [orgA, u],
    );
    const [offer] = await db.query<{id: string}>(
      `INSERT INTO offers (organization_id, company_id, name, created_by, updated_by)
       VALUES ($1, $2, 'Carpa 5 × 5', $3, $3) RETURNING id`,
      [orgA, company!.id, u],
    );
    const [task] = await db.query<{id: string}>(
      `INSERT INTO tasks (organization_id, title, heavy_load, created_by, updated_by)
       VALUES ($1, 'Montaje Prueba', NULL, $2, $2) RETURNING id`,
      [orgA, u],
    );
    const [event] = await db.query<{id: string}>(
      `INSERT INTO events (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Evento Prueba', $2, $2) RETURNING id`,
      [orgA, u],
    );
    await db.query(
      `INSERT INTO categories (organization_id, scope, name, created_by)
       VALUES ($1, 'resource', 'carpas', $2)`,
      [orgB, u],
    );

    writeFileSync(join(dir, m5!.file), m5!.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0005_inventories.sql',
    ]);

    // The SQL copy of the built-in list matches the shared constant, in order.
    const resourceCategories = (orgId: string) =>
      db.query<{name: string; position: number | null; built_in: boolean}>(
        `SELECT name, position, built_in FROM categories
          WHERE organization_id = $1 AND scope = 'resource'
          ORDER BY position NULLS LAST, name`,
        [orgId],
      );
    const a = await resourceCategories(orgA);
    expect(a.map(r => r.name)).toEqual([...BUILT_IN_RESOURCE_CATEGORIES]);
    expect(a.map(r => r.position)).toEqual(
      BUILT_IN_RESOURCE_CATEGORIES.map((_, i) => i + 1),
    );
    // Org B keeps its own «carpas»; the other built-ins arrive.
    const b = await resourceCategories(orgB);
    expect(b.filter(r => r.built_in).map(r => r.name)).toEqual(
      BUILT_IN_RESOURCE_CATEGORIES.filter(n => n !== 'Carpas'),
    );
    expect(b.filter(r => !r.built_in).map(r => r.name)).toEqual(['carpas']);
    // Existing rows are untouched.
    const [t] = await db.query<{version: number; heavy_load: boolean | null}>(
      'SELECT version, heavy_load FROM tasks',
    );
    expect(t).toEqual({version: 1, heavy_load: null});

    // A valid inventory and its links.
    const [warehouse] = await db.query<{id: string}>(
      `INSERT INTO warehouses (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Nave Prueba', $2, $2) RETURNING id`,
      [orgA, u],
    );
    const [contracted] = await db.query<{
      id: string;
      unit: string;
      condition: string;
      availability: string;
      to_assess: boolean;
      quantity: string | null;
    }>(
      `INSERT INTO resources (organization_id, name, ownership, company_id, offer_id,
                              warehouse_id, created_by, updated_by)
       VALUES ($1, 'Carpa Prueba', 'contracted', $2, $3, $4, $5, $5)
       RETURNING id, unit, condition, availability, to_assess, quantity::text AS quantity`,
      [orgA, company!.id, offer!.id, warehouse!.id, u],
    );
    // Defaults: «unidades», unknown condition and availability, not counted.
    expect(contracted).toMatchObject({
      unit: 'unidades',
      condition: 'unknown',
      availability: 'unknown',
      to_assess: false,
      quantity: null,
    });
    await db.query(
      'INSERT INTO task_resources (task_id, resource_id) VALUES ($1, $2)',
      [task!.id, contracted!.id],
    );
    await db.query(
      `INSERT INTO notes (organization_id, kind, text, event_id, task_id, created_by, updated_by)
       VALUES ($1, 'incident', 'Texto Prueba', $2, $3, $4, $4)`,
      [orgA, event!.id, task!.id, u],
    );

    const bad = [
      // Owned material never has a company or an offer.
      `INSERT INTO resources (organization_id, name, company_id, created_by, updated_by)
       VALUES ('${orgA}', 'x', '${company!.id}', '${u}', '${u}')`,
      `UPDATE resources SET ownership = 'owned' WHERE id = '${contracted!.id}'`,
      `INSERT INTO resources (organization_id, name, quantity, created_by, updated_by)
       VALUES ('${orgA}', 'x', -1, '${u}', '${u}')`,
      `INSERT INTO resources (organization_id, name, quantity, created_by, updated_by)
       VALUES ('${orgA}', 'x', 1000000.01, '${u}', '${u}')`,
      `INSERT INTO resources (organization_id, name, unit, created_by, updated_by)
       VALUES ('${orgA}', 'x', ' ', '${u}', '${u}')`,
      `INSERT INTO resources (organization_id, name, condition, created_by, updated_by)
       VALUES ('${orgA}', 'x', 'broken', '${u}', '${u}')`,
      `INSERT INTO warehouses (organization_id, name, created_by, updated_by)
       VALUES ('${orgA}', 'NAVE PRUEBA', '${u}', '${u}')`,
      // A note points at one record at most, has text and a known kind.
      `INSERT INTO notes (organization_id, kind, text, task_id, company_id, created_by, updated_by)
       VALUES ('${orgA}', 'note', 'x', '${task!.id}', '${company!.id}', '${u}', '${u}')`,
      `INSERT INTO notes (organization_id, kind, text, created_by, updated_by)
       VALUES ('${orgA}', 'note', '   ', '${u}', '${u}')`,
      `INSERT INTO notes (organization_id, kind, text, created_by, updated_by)
       VALUES ('${orgA}', 'gossip', 'x', '${u}', '${u}')`,
      // Deleting what resources and notes point at without unlinking fails.
      `DELETE FROM offers WHERE id = '${offer!.id}'`,
      `DELETE FROM warehouses WHERE id = '${warehouse!.id}'`,
      `DELETE FROM tasks WHERE id = '${task!.id}'`,
    ];
    for (const sql of bad) await expect(db.query(sql)).rejects.toThrow();
    await db.close();
  });

  it('0006 applies on top of a milestone-4 database with data, leaves tasks unreviewed and enforces the hypothesis rules', async () => {
    const all = readMigrations();
    const m6 = all[5];
    expect(m6?.file).toBe('0006_followup.sql');
    const dir = tempMigrations(
      Object.fromEntries(all.slice(0, 5).map(m => [m.file, m.sql])),
    );
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(5);

    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash)
       VALUES ('Prueba', 'member', 'x') RETURNING id`,
    );
    const u = user!.id;
    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org Prueba') RETURNING id",
    );
    const o = org!.id;
    const [task] = await db.query<{id: string}>(
      `INSERT INTO tasks (organization_id, title, heavy_load, created_by, updated_by)
       VALUES ($1, 'Escenario Prueba', true, $2, $2) RETURNING id`,
      [o, u],
    );

    writeFileSync(join(dir, m6!.file), m6!.sql);
    expect((await migrate(db, {dir})).applied).toEqual(['0006_followup.sql']);

    // Existing tasks keep their data; nothing declares a review for them.
    const [t] = await db.query<{
      version: number;
      heavy_load: boolean | null;
      subsoil_reviewed_by: string | null;
      subsoil_reviewed_at: unknown;
    }>(
      'SELECT version, heavy_load, subsoil_reviewed_by, subsoil_reviewed_at FROM tasks',
    );
    expect(t).toEqual({
      version: 1,
      heavy_load: true,
      subsoil_reviewed_by: null,
      subsoil_reviewed_at: null,
    });

    // A valid hypothesis: shift by default, not estimated, open.
    const [h] = await db.query<{
      id: string;
      mode: string;
      estimated: boolean;
      applied_at: unknown;
      is_demo: boolean;
    }>(
      `INSERT INTO hypotheses (organization_id, task_id, task_title, delay_minutes, created_by)
       VALUES ($1, $2, 'Escenario Prueba', 15, $3)
       RETURNING id, mode, estimated, applied_at, is_demo`,
      [o, task!.id, u],
    );
    expect(h).toMatchObject({
      mode: 'shift',
      estimated: false,
      applied_at: null,
      is_demo: false,
    });

    const hyp = (cols: string, values: string) =>
      `INSERT INTO hypotheses (organization_id, task_id, task_title, delay_minutes, created_by${cols})
       VALUES ('${o}', '${task!.id}', 'x', ${values}, '${u}'${cols ? ", 'late'" : ''})`;
    const bad = [
      // Both or neither: who declared the review and when.
      `UPDATE tasks SET subsoil_reviewed_by = '${u}' WHERE id = '${task!.id}'`,
      `UPDATE tasks SET subsoil_reviewed_at = now() WHERE id = '${task!.id}'`,
      // Delay between 1 minute and one day; known modes; short notes.
      hyp('', '0'),
      hyp('', '1441'),
      hyp(', mode', '15'),
      `INSERT INTO hypotheses (organization_id, task_title, delay_minutes, created_by, note)
       VALUES ('${o}', 'x', 15, '${u}', repeat('a', 1001))`,
      `INSERT INTO hypotheses (organization_id, task_title, delay_minutes, created_by)
       VALUES ('${o}', '  ', 15, '${u}')`,
      // Applied: both or neither.
      `UPDATE hypotheses SET applied_at = now() WHERE id = '${h!.id}'`,
      `UPDATE hypotheses SET applied_by = '${u}' WHERE id = '${h!.id}'`,
      // Deleting a task without detaching its hypotheses fails.
      `DELETE FROM tasks WHERE id = '${task!.id}'`,
    ];
    for (const sql of bad) await expect(db.query(sql)).rejects.toThrow();

    await db.query(
      `UPDATE tasks SET subsoil_reviewed_by = $1, subsoil_reviewed_at = now()
        WHERE id = $2`,
      [u, task!.id],
    );
    await db.query(
      'UPDATE hypotheses SET applied_by = $1, applied_at = now() WHERE id = $2',
      [u, h!.id],
    );
    await db.close();
  });

  it('every migration file is LF only (checksums hash raw bytes)', () => {
    for (const m of readMigrations()) expect(m.sql).not.toContain('\r');
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
