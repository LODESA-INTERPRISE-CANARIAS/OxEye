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
  '0007_moves_acceptances.sql',
  '0008_answers_media.sql',
  '0009_roles_access.sql',
  // Revisión 1 · E5 (its own test from a 0009 database: money.test.ts).
  '0010_money.sql',
  // Revisión 1 · E6–E7 (its own test from a 0010 database: offer-terms.test.ts).
  '0011_offer_terms.sql',
  // Safety audit (support attribution: support-attribution.test.ts).
  '0012_support_attribution.sql',
  // Developer ⇒ admin (its own test from a 0012 database: developer-roles.test.ts).
  '0013_developer_fixed_roles.sql',
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
      'account_tokens',
      'activity_log',
      'categories',
      'companies',
      'company_categories',
      'conflict_acceptances',
      'contact_events',
      'contacts',
      'event_budgets',
      'events',
      'expenses',
      'hypotheses',
      'media',
      'note_answers',
      'notes',
      'offer_renewals',
      'offer_settings',
      'offer_versions',
      'offers',
      'organization_members',
      'organizations',
      'proposals',
      'quote_request_links',
      'quote_requests',
      'recent_searches',
      'resources',
      'schema_migrations',
      'security_events',
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

  it('0007 and 0008 apply on top of a milestone-6 database with data: existing rows keep working and the new rules hold', async () => {
    const all = readMigrations();
    expect(all.slice(6, 8).map(m => m.file)).toEqual([
      '0007_moves_acceptances.sql',
      '0008_answers_media.sql',
    ]);
    const dir = tempMigrations(
      Object.fromEntries(all.slice(0, 6).map(m => [m.file, m.sql])),
    );
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(6);

    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash)
       VALUES ('Prueba', 'member', 'x') RETURNING id`,
    );
    const u = user!.id;
    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org Prueba') RETURNING id",
    );
    const o = org!.id;
    const [venue] = await db.query<{id: string}>(
      `INSERT INTO venues (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Plaza Prueba', $2, $2) RETURNING id`,
      [o, u],
    );
    const [warehouse] = await db.query<{id: string}>(
      `INSERT INTO warehouses (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Almacén Prueba', $2, $2) RETURNING id`,
      [o, u],
    );
    const [task] = await db.query<{id: string}>(
      `INSERT INTO tasks (organization_id, title, venue_id, created_by, updated_by)
       VALUES ($1, 'Montaje Prueba', $2, $3, $3) RETURNING id`,
      [o, venue!.id, u],
    );
    const [question] = await db.query<{id: string}>(
      `INSERT INTO notes (organization_id, kind, text, resolved, created_by, updated_by)
       VALUES ($1, 'open_question', '¿Pregunta de prueba?', true, $2, $2) RETURNING id`,
      [o, u],
    );
    const [resource] = await db.query<{id: string}>(
      `INSERT INTO resources (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Vallas Prueba', $2, $2) RETURNING id`,
      [o, u],
    );

    for (const m of all.slice(6, 8)) writeFileSync(join(dir, m.file), m.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0007_moves_acceptances.sql',
      '0008_answers_media.sql',
    ]);

    // Existing rows: no acronym, no hours, nobody invented as resolver.
    expect(
      await db.query(
        'SELECT acronym, version FROM organizations WHERE id = $1',
        [o],
      ),
    ).toEqual([{acronym: null, version: 1}]);
    expect(
      await db.query(
        'SELECT acronym, opens_at, closes_at, version FROM venues WHERE id = $1',
        [venue!.id],
      ),
    ).toEqual([{acronym: null, opens_at: null, closes_at: null, version: 1}]);
    expect(
      await db.query(
        'SELECT acronym, opens_at, closes_at FROM warehouses WHERE id = $1',
        [warehouse!.id],
      ),
    ).toEqual([{acronym: null, opens_at: null, closes_at: null}]);
    expect(
      await db.query(
        'SELECT resolved, resolved_by, resolved_at, version FROM notes WHERE id = $1',
        [question!.id],
      ),
    ).toEqual([
      {resolved: true, resolved_by: null, resolved_at: null, version: 1},
    ]);
    expect(
      await db.query('SELECT count(*)::int AS n FROM note_answers'),
    ).toEqual([{n: 0}]);

    // Valid new data.
    await db.query(
      "UPDATE venues SET acronym = 'P.P.', opens_at = '08:00', closes_at = '20:00' WHERE id = $1",
      [venue!.id],
    );
    const accept = (key: string, windows: string, reason: string) =>
      db.query(
        `INSERT INTO conflict_acceptances
           (organization_id, warning_key, windows, label, reason, accepted_by)
         VALUES ($1, $2, $3::jsonb, 'Coinciden en Plaza Prueba', $4, $5)`,
        [o, key, windows, reason, u],
      );
    const key = `venue:${task!.id}:${task!.id}`;
    const windows = JSON.stringify([
      {
        taskId: task!.id,
        startsAt: '2026-12-02T09:00:00.000Z',
        endsAt: '2026-12-02T10:00:00.000Z',
      },
    ]);
    await accept(key, windows, 'Lo hablamos');
    const [first] = await db.query<{id: string}>(
      `INSERT INTO note_answers (note_id, text, answered_by)
       VALUES ($1, 'Primera', $2) RETURNING id`,
      [question!.id, u],
    );
    const [second] = await db.query<{id: string}>(
      `INSERT INTO note_answers (note_id, text, answered_by, replaces_id)
       VALUES ($1, 'Segunda', $2, $3) RETURNING id`,
      [question!.id, u, first!.id],
    );
    const media = (main: boolean, bytes = 3, data = "'\\x010203'::bytea") =>
      `INSERT INTO media (organization_id, owner_type, owner_id, content_type,
                          bytes, width, height, is_main, data, created_by)
       VALUES ('${o}', 'resource', '${resource!.id}', 'image/png', ${bytes},
               10, 10, ${main}, ${data}, '${u}')`;
    await db.query(media(true));
    await db.query(media(false));

    const [other] = await db.query<{id: string}>(
      `INSERT INTO notes (organization_id, kind, text, created_by, updated_by)
       VALUES ($1, 'open_question', 'Otra', $2, $2) RETURNING id`,
      [o, u],
    );
    const bad = [
      // Acronyms: no spaces, at most 12 characters.
      `UPDATE organizations SET acronym = 'S C' WHERE id = '${o}'`,
      `UPDATE venues SET acronym = repeat('A', 13) WHERE id = '${venue!.id}'`,
      `UPDATE warehouses SET acronym = '' WHERE id = '${warehouse!.id}'`,
      // Opening hours: both or neither, opening before closing.
      `UPDATE venues SET opens_at = NULL WHERE id = '${venue!.id}'`,
      `UPDATE warehouses SET opens_at = '20:00', closes_at = '08:00' WHERE id = '${warehouse!.id}'`,
      `UPDATE warehouses SET opens_at = '08:00', closes_at = '08:00' WHERE id = '${warehouse!.id}'`,
      // Acceptances: a warning key, one to ten windows, a reason of 3–280.
      `INSERT INTO conflict_acceptances (organization_id, warning_key, windows, label, reason, accepted_by)
       VALUES ('${o}', 'not a key', '${windows}', 'x', 'Motivo', '${u}')`,
      `INSERT INTO conflict_acceptances (organization_id, warning_key, windows, label, reason, accepted_by)
       VALUES ('${o}', '${key}', '[]', 'x', 'Motivo', '${u}')`,
      `INSERT INTO conflict_acceptances (organization_id, warning_key, windows, label, reason, accepted_by)
       VALUES ('${o}', '${key}', '${windows}', 'x', '  a ', '${u}')`,
      `INSERT INTO conflict_acceptances (organization_id, warning_key, windows, label, reason, accepted_by)
       VALUES ('${o}', '${key}', '${windows}', 'x', repeat('a', 281), '${u}')`,
      // Answers: one first answer per note, each replaced once, same note only.
      `INSERT INTO note_answers (note_id, text, answered_by) VALUES ('${question!.id}', 'Otra primera', '${u}')`,
      `INSERT INTO note_answers (note_id, text, answered_by, replaces_id)
       VALUES ('${question!.id}', 'Rama', '${u}', '${first!.id}')`,
      `INSERT INTO note_answers (note_id, text, answered_by, replaces_id)
       VALUES ('${other!.id}', 'Ajena', '${u}', '${second!.id}')`,
      `INSERT INTO note_answers (note_id, text, answered_by) VALUES ('${other!.id}', '  ', '${u}')`,
      // Who resolved: both or neither, and only on a resolved note.
      `UPDATE notes SET resolved_by = '${u}' WHERE id = '${question!.id}'`,
      `UPDATE notes SET resolved_by = '${u}', resolved_at = now() WHERE id = '${other!.id}'`,
      // Media: one main per record, the declared size, known types, sides.
      media(true),
      media(false, 4),
      media(false, 700000, "decode(repeat('00', 700000), 'hex')"),
      `INSERT INTO media (organization_id, owner_type, owner_id, content_type, bytes, width, height, data, created_by)
       VALUES ('${o}', 'resource', '${resource!.id}', 'image/gif', 3, 10, 10, '\\x010203'::bytea, '${u}')`,
      `INSERT INTO media (organization_id, owner_type, owner_id, content_type, bytes, width, height, data, created_by)
       VALUES ('${o}', 'resource', '${resource!.id}', 'image/png', 3, 0, 10, '\\x010203'::bytea, '${u}')`,
      `INSERT INTO media (organization_id, owner_type, owner_id, content_type, bytes, width, height, data, created_by)
       VALUES ('${o}', 'event', '${resource!.id}', 'image/png', 3, 10, 10, '\\x010203'::bytea, '${u}')`,
      // The move origin in the history is one of the four.
      `INSERT INTO activity_log (organization_id, user_id, entity_type, entity_id, entity_label, action, move_origin)
       VALUES ('${o}', '${u}', 'task', '${task!.id}', 'x', 'update', 'drag')`,
    ];
    for (const sql of bad) await expect(db.query(sql)).rejects.toThrow();

    // Deleting the question takes its answers with it.
    await db.query('DELETE FROM notes WHERE id = $1', [question!.id]);
    expect(
      await db.query('SELECT count(*)::int AS n FROM note_answers'),
    ).toEqual([{n: 0}]);
    await db.close();
  });

  it('0009 applies on top of an E3 database with data: logins keep working and the access rules hold', async () => {
    const all = readMigrations();
    expect(all[8]?.file).toBe('0009_roles_access.sql');
    const dir = tempMigrations(
      Object.fromEntries(all.slice(0, 8).map(m => [m.file, m.sql])),
    );
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(8);

    const user = async (name: string, role: string) =>
      (
        await db.query<{id: string}>(
          `INSERT INTO users (display_name, role, password_hash)
           VALUES ($1, $2, 'scrypt$1$1$1$a$b') RETURNING id`,
          [name, role],
        )
      )[0]!.id;
    const member = await user('Elvis', 'member');
    const guest = await user('Invitado', 'guest');
    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org Prueba') RETURNING id",
    );
    const o = org!.id;
    await db.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [o, member, guest],
    );
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, repeat('a', 64), now() + interval '1 day')`,
      [member],
    );

    writeFileSync(join(dir, all[8]!.file), all[8]!.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0009_roles_access.sql',
    ]);

    // Existing accounts: login name = display name, provisional password,
    // members keep editing (team), the guest has no roles, sessions are normal.
    expect(
      await db.query(
        `SELECT u.username, u.password_provisional, u.recovery_email, m.roles
           FROM users u JOIN organization_members m ON m.user_id = u.id
          ORDER BY u.username`,
      ),
    ).toEqual([
      {
        username: 'Elvis',
        password_provisional: true,
        recovery_email: null,
        roles: ['team'],
      },
      {
        username: 'Invitado',
        password_provisional: true,
        recovery_email: null,
        roles: [],
      },
    ]);
    expect(
      await db.query('SELECT kind, device, opened_by, reason FROM sessions'),
    ).toEqual([{kind: 'normal', device: null, opened_by: null, reason: null}]);

    // Valid new data.
    await db.query(
      `UPDATE users SET accent = 'teal', bio = 'Coordinación',
              recovery_email = 'e@example.org', recovery_email_verified_at = now()
        WHERE id = $1`,
      [member],
    );
    await db.query(
      `UPDATE organization_members SET roles = ARRAY['admin', 'developer']
        WHERE user_id = $1`,
      [member],
    );
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, kind, opened_by, reason)
       VALUES ($1, repeat('b', 64), now() + interval '10 minutes', 'support', $2,
               'Ayuda con una tarea')`,
      [guest, member],
    );
    await db.query(
      `INSERT INTO account_tokens (user_id, purpose, token_hash, email, expires_at)
       VALUES ($1, 'email_verify', repeat('c', 64), 'e@example.org', now() + interval '1 day')`,
      [member],
    );
    const photo = (owner: string) =>
      `INSERT INTO media (organization_id, owner_type, owner_id, content_type,
                          bytes, width, height, is_main, data, created_by)
       VALUES ('${o}', 'user', '${owner}', 'image/png', 3, 10, 10, true,
               '\\x010203'::bytea, '${member}')`;
    await db.query(photo(member));

    const bad = [
      // Login names: unique whatever the case, trimmed, never empty.
      `UPDATE users SET username = 'elvis' WHERE id = '${guest}'`,
      `UPDATE users SET username = ' Invitado' WHERE id = '${guest}'`,
      `UPDATE users SET username = NULL WHERE id = '${guest}'`,
      // Accent keys, short bios, only verified recovery e-mails.
      `UPDATE users SET accent = 'Teal!' WHERE id = '${member}'`,
      `UPDATE users SET bio = repeat('a', 281) WHERE id = '${member}'`,
      `UPDATE users SET recovery_email_verified_at = NULL WHERE id = '${member}'`,
      `UPDATE users SET recovery_email = 'no es correo' WHERE id = '${member}'`,
      // Roles: known ones only.
      `UPDATE organization_members SET roles = ARRAY['root'] WHERE user_id = '${member}'`,
      // Sessions: support needs who opened it and a reason; normal ones neither.
      `INSERT INTO sessions (user_id, token_hash, expires_at, kind)
       VALUES ('${guest}', repeat('d', 64), now() + interval '1 day', 'support')`,
      `INSERT INTO sessions (user_id, token_hash, expires_at, opened_by)
       VALUES ('${guest}', repeat('e', 64), now() + interval '1 day', '${member}')`,
      `INSERT INTO sessions (user_id, token_hash, expires_at, kind, opened_by, reason)
       VALUES ('${guest}', repeat('f', 64), now() + interval '1 day', 'support', '${member}', 'corto')`,
      // Account links: a hash, an address only to verify, a future end.
      `INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ('${member}', 'email_verify', repeat('1', 64), now() + interval '1 day')`,
      `INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ('${member}', 'password_reset', 'clear-token', now() + interval '1 day')`,
      `INSERT INTO account_tokens (user_id, purpose, token_hash, email, expires_at)
       VALUES ('${member}', 'password_reset', repeat('2', 64), 'e@example.org', now() + interval '1 day')`,
      `INSERT INTO account_tokens (user_id, purpose, token_hash, created_at, expires_at)
       VALUES ('${member}', 'password_reset', repeat('3', 64), now(), now() - interval '1 minute')`,
      // Security log: a short detail, a kind key.
      `INSERT INTO security_events (user_id, kind, detail) VALUES ('${member}', 'login', repeat('a', 281))`,
      `INSERT INTO security_events (user_id, kind) VALUES ('${member}', 'Login!')`,
      // One profile photo per account.
      photo(member).replace('true', 'false'),
    ];
    for (const sql of bad) await expect(db.query(sql)).rejects.toThrow();
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
