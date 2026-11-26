import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createApp} from '../src/app.ts';
import {migrate, readMigrations} from '../src/db/migrate.ts';
import {createPgliteDb} from '../src/db/pglite.ts';
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  BUILT_IN_SERVICE_CATEGORIES,
} from '../../shared/logistics/rules.ts';
import {
  DEMO_COMPANIES,
  DEMO_CONTACTS,
  DEMO_EVENT,
  DEMO_NOTES,
  DEMO_OFFERS,
  DEMO_RESOURCES,
  DEMO_TASKS,
  PILOT_ORGANIZATION,
  PILOT_USERS,
  seed,
} from '../src/seed/seed.ts';
import {clearDemo} from '../src/demo/service.ts';
import type {Queryable} from '../src/db/db.ts';
import {
  createClock,
  createHarness,
  json,
  passwordFor,
  testConfig,
} from './helpers.ts';
import type {ListResponse, Task} from '../../shared/logistics/contracts.ts';

/** Demo rows left in the database. */
async function demoCounts(db: Queryable) {
  const rows = await db.query<{
    events: number;
    tasks: number;
    activity: number;
    catalogue: number;
    inventory: number;
  }>(
    `SELECT (SELECT count(*)::int FROM events WHERE is_demo) AS events,
            (SELECT count(*)::int FROM tasks WHERE is_demo) AS tasks,
            (SELECT count(*)::int FROM activity_log WHERE is_demo) AS activity,
            (SELECT count(*)::int FROM contacts WHERE is_demo)
              + (SELECT count(*)::int FROM offers WHERE is_demo)
              + (SELECT count(*)::int FROM companies WHERE is_demo) AS catalogue,
            (SELECT count(*)::int FROM warehouses WHERE is_demo)
              + (SELECT count(*)::int FROM resources WHERE is_demo)
              + (SELECT count(*)::int FROM notes WHERE is_demo) AS inventory`,
  );
  return rows[0];
}

async function loginStatus(
  app: ReturnType<typeof createApp>,
  displayName: string,
  password: string,
): Promise<number> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({displayName, password}),
  });
  return res.status;
}

describe('seed', () => {
  it('creates the organization, five users and one demo event, idempotently', async () => {
    const clock = createClock();
    const db = await createPgliteDb();
    await migrate(db);

    const first = await seed(db, {passwordFor, now: clock.now()});
    expect(first.organizationCreated).toBe(true);
    expect(first.organization.name).toBe(PILOT_ORGANIZATION.name);
    expect(first.organization.timezone).toBe('Atlantic/Canary');
    expect(first.users.map(u => u.displayName)).toEqual(
      PILOT_USERS.map(u => u.displayName),
    );
    expect(first.users.every(u => u.created && u.password)).toBe(true);
    expect(first.demoEventCreated).toBe(true);
    expect(first.demoTasksCreated).toBe(DEMO_TASKS.length);

    const second = await seed(db, {
      passwordFor: () => 'should-not-be-used',
      now: clock.now(),
    });
    expect(second.organizationCreated).toBe(false);
    expect(second.users.every(u => !u.created && u.password === null)).toBe(
      true,
    );
    expect(second.demoEventCreated).toBe(false);
    expect(second.demoTasksCreated).toBe(0);
    expect(first.demoContactsCreated).toBe(DEMO_CONTACTS.length);
    expect(first.demoOffersCreated).toBe(DEMO_OFFERS.length);
    expect(second.demoContactsCreated + second.demoOffersCreated).toBe(0);
    expect(first.demoResourcesCreated).toBe(DEMO_RESOURCES.length);
    expect(first.demoNotesCreated).toBe(DEMO_NOTES.length);
    expect(second.demoResourcesCreated + second.demoNotesCreated).toBe(0);
    const [inventory] = await db.query<{
      warehouses: number;
      resources: number;
      notes: number;
      links: number;
    }>(
      `SELECT (SELECT count(*)::int FROM warehouses) AS warehouses,
              (SELECT count(*)::int FROM resources) AS resources,
              (SELECT count(*)::int FROM notes) AS notes,
              (SELECT count(*)::int FROM task_resources) AS links`,
    );
    expect(inventory).toEqual({
      warehouses: 1,
      resources: DEMO_RESOURCES.length,
      notes: DEMO_NOTES.length,
      links: 2,
    });

    const counts = await db.query<{
      orgs: number;
      users: number;
      events: number;
      tasks: number;
      companies: number;
    }>(
      `SELECT (SELECT count(*)::int FROM organizations) AS orgs,
              (SELECT count(*)::int FROM users WHERE is_active) AS users,
              (SELECT count(*)::int FROM events) AS events,
              (SELECT count(*)::int FROM tasks) AS tasks,
              (SELECT count(*)::int FROM companies) AS companies`,
    );
    expect(counts[0]).toEqual({
      orgs: 1,
      users: 5,
      events: 1,
      tasks: DEMO_TASKS.length,
      companies: DEMO_COMPANIES.length,
    });

    // Passwords survive a second run.
    const app = createApp({db, config: testConfig, now: clock.now});
    expect(await loginStatus(app, 'Elvis', passwordFor('Elvis'))).toBe(200);
    expect(await loginStatus(app, 'Elvis', 'should-not-be-used')).toBe(401);
    await db.close();
  });

  it('stores only scrypt hashes, never the clear password', async () => {
    const db = await createPgliteDb();
    await migrate(db);
    await seed(db, {passwordFor});
    const rows = await db.query<{password_hash: string}>(
      'SELECT password_hash FROM users WHERE is_active',
    );
    for (const r of rows) {
      expect(r.password_hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
      expect(r.password_hash).not.toContain('pw-');
    }
    await db.close();
  });

  it('--reset-passwords replaces passwords and closes open sessions', async () => {
    const clock = createClock();
    const db = await createPgliteDb();
    await migrate(db);
    await seed(db, {passwordFor, now: clock.now()});
    const app = createApp({db, config: testConfig, now: clock.now});
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        displayName: 'Dailos',
        password: passwordFor('Dailos'),
      }),
    });
    const {token} = (await res.json()) as {token: string};

    const reset = await seed(db, {
      resetPasswords: true,
      passwordFor: name => `new-${name}`,
      now: clock.now(),
    });
    expect(reset.users.find(u => u.displayName === 'Dailos')?.password).toBe(
      'new-Dailos',
    );
    expect(await loginStatus(app, 'Dailos', passwordFor('Dailos'))).toBe(401);
    expect(await loginStatus(app, 'Dailos', 'new-Dailos')).toBe(200);
    const me = await app.request('/api/me', {
      headers: {Authorization: `Bearer ${token}`},
    });
    expect(me.status).toBe(401);
    await db.close();
  });

  it('a fresh database gets the demo and reports it was never removed', async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const result = await seed(db, {passwordFor});
    expect(result.demoEventCreated).toBe(true);
    expect(result.demoTasksCreated).toBe(DEMO_TASKS.length);
    expect(result.demoRemovedAt).toBeNull();
    await db.close();
  });

  it('never re-creates the demo after the team removed it from the app, even with --reset-passwords', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    h.clock.set('2026-12-01T18:00:00.000Z');
    const res = await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
      token,
    });
    expect(res.status).toBe(200);

    h.clock.set('2026-12-02T07:30:00.000Z');
    const again = await seed(h.db, {
      resetPasswords: true,
      passwordFor: n => `new-${n}`,
      now: h.clock.now(),
    });
    expect(again.demoEventCreated).toBe(false);
    expect(again.demoTasksCreated).toBe(0);
    expect(again.demoRemovedAt).toBe('2026-12-01T18:00:00.000Z');
    // Passwords were still reset.
    expect(again.users.every(u => u.password?.startsWith('new-'))).toBe(true);
    expect(await demoCounts(h.db)).toEqual({
      events: 0,
      tasks: 0,
      activity: 0,
      catalogue: 0,
      inventory: 0,
    });
    await h.db.close();
  });

  it('never re-creates the demo after db:clear-demo (all organizations, no actor)', async () => {
    const h = await createHarness();
    await clearDemo(h.db, {
      organizationId: null,
      actorId: null,
      now: h.clock.now(),
    });
    const again = await seed(h.db, {passwordFor, now: h.clock.now()});
    expect(again.demoEventCreated).toBe(false);
    expect(again.demoTasksCreated).toBe(0);
    expect(again.demoRemovedAt).toBe(h.clock.now().toISOString());
    expect(await demoCounts(h.db)).toEqual({
      events: 0,
      tasks: 0,
      activity: 0,
      catalogue: 0,
      inventory: 0,
    });

    // A second removal keeps the first date.
    h.clock.advance(60_000);
    await clearDemo(h.db, {
      organizationId: null,
      actorId: null,
      now: h.clock.now(),
    });
    expect((await seed(h.db, {passwordFor})).demoRemovedAt).toBe(
      again.demoRemovedAt,
    );
    await h.db.close();
  });

  it('does not bring back demo tasks deleted one by one while the demo event stays', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const list = async () =>
      (
        await json<ListResponse<Task>>(
          await h.request('GET', `/organizations/${h.org.id}/tasks`, {token}),
        )
      ).items;
    // Re-read each time: deleting a predecessor bumps its successors.
    for (let items = await list(); items.length > 0; items = await list()) {
      const t = items[0]!;
      const res = await h.request(
        'DELETE',
        `/tasks/${t.id}?version=${t.version}`,
        {token},
      );
      expect(res.status).toBe(204);
    }
    const again = await seed(h.db, {passwordFor, now: h.clock.now()});
    expect(again.demoTasksCreated).toBe(0);
    expect(again.demoRemovedAt).toBeNull();
    expect((await demoCounts(h.db)).tasks).toBe(0);
    await h.db.close();
  });

  it('adds the demo people and offers, once, to a database seeded in milestone 2', async () => {
    // Milestone-2 state: 0001–0003 applied, the demo event, the demo company
    // and the stage assembly that uses it, as db:seed left them.
    const dir = mkdtempSync(join(tmpdir(), 'oxeye-m2-'));
    const [m1, m2, m3] = readMigrations();
    for (const m of [m1!, m2!, m3!]) writeFileSync(join(dir, m.file), m.sql);
    const db = await createPgliteDb();
    await migrate(db, {dir});
    const [org] = await db.query<{id: string}>(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [PILOT_ORGANIZATION.name],
    );
    const [system] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash, is_active)
       VALUES ('Sistema', 'guest', NULL, false) RETURNING id`,
    );
    await db.query(
      `INSERT INTO events (organization_id, name, local_date, is_demo, created_by, updated_by)
       VALUES ($1, $2, '2026-12-02', true, $3, $3)`,
      [org!.id, DEMO_EVENT.name, system!.id],
    );
    const [company] = await db.query<{id: string}>(
      `INSERT INTO companies (organization_id, name, is_demo, created_by, updated_by)
       VALUES ($1, 'Escenarios Demo', true, $2, $2) RETURNING id`,
      [org!.id, system!.id],
    );
    const [stage] = await db.query<{id: string}>(
      `INSERT INTO tasks (organization_id, company_id, title, heavy_load, is_demo,
                          created_by, updated_by)
       VALUES ($1, $2, 'Montaje del escenario', true, true, $3, $3) RETURNING id`,
      [org!.id, company!.id, system!.id],
    );
    rmSync(dir, {recursive: true, force: true});

    expect((await migrate(db)).applied).toEqual([
      '0004_contacts_catalogue.sql',
      '0005_inventories.sql',
    ]);
    const first = await seed(db, {passwordFor});
    expect(first.demoTasksCreated).toBe(0);
    expect(first.demoContactsCreated).toBe(DEMO_CONTACTS.length);
    expect(first.demoOffersCreated).toBe(DEMO_OFFERS.length);

    // The existing demo company and task changed: new version, logged. The
    // task changed twice: its contact (M3) and the demo van it uses (M4).
    const [co] = await db.query<{version: number; main: string | null}>(
      'SELECT version, main_contact_id AS main FROM companies WHERE id = $1',
      [company!.id],
    );
    expect(co?.version).toBe(2);
    expect(co?.main).not.toBeNull();
    const [task] = await db.query<{
      version: number;
      contact: string;
      heavy_load: boolean;
    }>(
      `SELECT t.version, k.name AS contact, t.heavy_load
         FROM tasks t JOIN contacts k ON k.id = t.contact_id WHERE t.id = $1`,
      [stage!.id],
    );
    // Linking a resource never answers the heavy-load question.
    expect(task).toEqual({version: 3, contact: 'Ana Demo', heavy_load: true});
    const log = await db.query<{type: string; fields: string[]}>(
      `SELECT entity_type AS type, changed_fields AS fields FROM activity_log
        WHERE action = 'update' ORDER BY seq`,
    );
    expect(log).toEqual([
      {type: 'task', fields: ['contact']},
      {type: 'company', fields: ['categoryIds', 'mainContactId']},
      {type: 'task', fields: ['resourceIds']},
    ]);

    const again = await seed(db, {passwordFor});
    expect(again.demoContactsCreated + again.demoOffersCreated).toBe(0);
    const [counts] = await db.query<{contacts: number; offers: number}>(
      `SELECT (SELECT count(*)::int FROM contacts) AS contacts,
              (SELECT count(*)::int FROM offers) AS offers`,
    );
    expect(counts).toEqual({
      contacts: DEMO_CONTACTS.length,
      offers: DEMO_OFFERS.length,
    });
    await db.close();
  });

  it('adds the demo inventory and notes, once, to a database seeded in milestone 3', async () => {
    // Milestone-3 state: 0001–0004 applied; the demo event, its tasks, the
    // demo company and a demo person, as db:seed left them.
    const dir = mkdtempSync(join(tmpdir(), 'oxeye-m3-'));
    for (const m of readMigrations().slice(0, 4)) {
      writeFileSync(join(dir, m.file), m.sql);
    }
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(4);
    rmSync(dir, {recursive: true, force: true});
    const [org] = await db.query<{id: string}>(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [PILOT_ORGANIZATION.name],
    );
    const [system] = await db.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash, is_active)
       VALUES ('Sistema', 'guest', NULL, false) RETURNING id`,
    );
    const [event] = await db.query<{id: string}>(
      `INSERT INTO events (organization_id, name, local_date, is_demo, created_by, updated_by)
       VALUES ($1, $2, '2026-12-02', true, $3, $3) RETURNING id`,
      [org!.id, DEMO_EVENT.name, system!.id],
    );
    const [company] = await db.query<{id: string}>(
      `INSERT INTO companies (organization_id, name, is_demo, created_by, updated_by)
       VALUES ($1, 'Escenarios Demo', true, $2, $2) RETURNING id`,
      [org!.id, system!.id],
    );
    for (const t of DEMO_TASKS) {
      await db.query(
        `INSERT INTO tasks (organization_id, event_id, title, heavy_load, is_demo,
                            created_by, updated_by)
         VALUES ($1, $2, $3, $4, true, $5, $5)`,
        [org!.id, event!.id, t.title, t.heavyLoad, system!.id],
      );
    }
    await db.query(
      `INSERT INTO contacts (organization_id, company_id, name, is_demo, created_by, updated_by)
       VALUES ($1, $2, 'Ana Demo', true, $3, $3)`,
      [org!.id, company!.id, system!.id],
    );

    expect((await migrate(db)).applied).toEqual(['0005_inventories.sql']);
    const first = await seed(db, {passwordFor});
    expect(first.demoTasksCreated).toBe(0);
    expect(first.demoContactsCreated + first.demoOffersCreated).toBe(0);
    expect(first.demoResourcesCreated).toBe(DEMO_RESOURCES.length);
    expect(first.demoNotesCreated).toBe(DEMO_NOTES.length);

    // The two tasks the van serves changed: new version, logged. No heavy-load
    // answer changed, and no resource carries a weight.
    const tasks = await db.query<{
      title: string;
      version: number;
      heavy_load: boolean | null;
      resources: number;
    }>(
      `SELECT t.title, t.version, t.heavy_load,
              (SELECT count(*)::int FROM task_resources tr WHERE tr.task_id = t.id) AS resources
         FROM tasks t ORDER BY t.title`,
    );
    for (const t of tasks) {
      const linked = [
        'Montaje del escenario',
        'Traslado del generador',
      ].includes(t.title);
      expect(t, t.title).toEqual({
        title: t.title,
        version: linked ? 2 : 1,
        heavy_load: DEMO_TASKS.find(d => d.title === t.title)!.heavyLoad,
        resources: linked ? 1 : 0,
      });
    }
    const log = await db.query<{type: string; label: string; fields: string[]}>(
      `SELECT entity_type AS type, entity_label AS label, changed_fields AS fields
         FROM activity_log WHERE action = 'update' ORDER BY seq`,
    );
    expect(log.map(l => [l.type, l.fields])).toEqual([
      ['task', ['resourceIds']],
      ['task', ['resourceIds']],
    ]);
    // Notes are logged by kind and what they point at, never by their text.
    const noteLabels = await db.query<{label: string}>(
      `SELECT entity_label AS label FROM activity_log
        WHERE entity_type = 'note' ORDER BY seq`,
    );
    expect(noteLabels.map(n => n.label)).toEqual([
      'Incidencia · Entrega de vallas',
      `Decisión · ${DEMO_EVENT.name}`,
      'Pregunta abierta · Montaje del escenario',
    ]);
    const units = await db.query<{unit: string}>(
      'SELECT DISTINCT unit FROM resources',
    );
    expect(units.map(u => u.unit)).toEqual(['unidades']);
    // The contracted resource uses the existing demo supplier, not a copy.
    const [{n: companies} = {n: 0}] = await db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM companies',
    );
    expect(companies).toBe(1);

    const again = await seed(db, {passwordFor});
    expect(again.demoResourcesCreated + again.demoNotesCreated).toBe(0);
    const [counts] = await db.query<{
      warehouses: number;
      resources: number;
      notes: number;
    }>(
      `SELECT (SELECT count(*)::int FROM warehouses) AS warehouses,
              (SELECT count(*)::int FROM resources) AS resources,
              (SELECT count(*)::int FROM notes) AS notes`,
    );
    expect(counts).toEqual({
      warehouses: 1,
      resources: DEMO_RESOURCES.length,
      notes: DEMO_NOTES.length,
    });
    await db.close();
  });

  it('gives a new organization the built-in categories and never duplicates them', async () => {
    const db = await createPgliteDb();
    await migrate(db);
    await seed(db, {passwordFor});
    await seed(db, {passwordFor});
    const builtIns = async (scope: string) =>
      (
        await db.query<{name: string}>(
          'SELECT name FROM categories WHERE built_in AND scope = $1 ORDER BY position',
          [scope],
        )
      ).map(r => r.name);
    expect(await builtIns('service')).toEqual([...BUILT_IN_SERVICE_CATEGORIES]);
    expect(await builtIns('resource')).toEqual([
      ...BUILT_IN_RESOURCE_CATEGORIES,
    ]);
    await db.close();
  });

  it('seeds the demo event as planned draft on 2 Dec 2026 09:00–14:00 Canary time', async () => {
    const db = await createPgliteDb();
    await migrate(db);
    await seed(db, {passwordFor});
    const rows = await db.query<{
      name: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      verification: string;
      is_demo: boolean;
      venue: string;
      author: string;
    }>(
      `SELECT e.name, e.starts_at, e.ends_at, e.status, e.verification, e.is_demo,
              v.name AS venue, u.display_name AS author
         FROM events e JOIN venues v ON v.id = e.venue_id JOIN users u ON u.id = e.created_by`,
    );
    expect(rows).toHaveLength(1);
    const e = rows[0]!;
    expect(e.name).toBe(DEMO_EVENT.name);
    expect(e.venue).toBe('Plaza del Cristo');
    // December: Canary time is UTC+0.
    expect(e.starts_at.toISOString()).toBe('2026-12-02T09:00:00.000Z');
    expect(e.ends_at.toISOString()).toBe('2026-12-02T14:00:00.000Z');
    expect(e.status).toBe('planned');
    expect(e.verification).toBe('draft');
    expect(e.is_demo).toBe(true);
    // Signed by the non-login system author, not by a pilot user.
    expect(e.author).toBe('Sistema');
    await db.close();
  });
});
