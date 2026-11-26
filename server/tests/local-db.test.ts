import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {ConfigError, loadConfig} from '../src/config.ts';
import {migrate, readMigrations} from '../src/db/migrate.ts';
import {DbLockedError, openDb} from '../src/db/open.ts';
import {
  DEMO_EVENT,
  DEMO_TASKS,
  PILOT_ORGANIZATION,
  seed,
} from '../src/seed/seed.ts';
import type {Queryable} from '../src/db/db.ts';

/** The milestone-1 demo event, as `db:seed` left it before 0002. */
async function insertM1DemoEvent(db: Queryable, orgId: string, userId: string) {
  await db.query(
    `INSERT INTO events (organization_id, name, local_date, starts_at, ends_at,
                         is_demo, created_by, updated_by)
     VALUES ($1, $2, '2026-12-02', '2026-12-02T09:00:00Z', '2026-12-02T14:00:00Z',
             true, $3, $3)`,
    [orgId, DEMO_EVENT.name, userId],
  );
}

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

  it('upgrades a seeded milestone-1 folder in place: 0002 applies and the demo tasks arrive', async () => {
    // A folder migrated and seeded with 0001 only, as the team has it today.
    const [m1] = readMigrations();
    const dir = join(root, 'm1-migrations');
    mkdirSync(dir);
    writeFileSync(join(dir, m1!.file), m1!.sql);
    const url = `pglite:${join(root, 'm1-data')}`;
    const old = await openDb(url);
    await migrate(old, {dir});
    const [org] = await old.query<{id: string}>(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [PILOT_ORGANIZATION.name],
    );
    const [user] = await old.query<{id: string}>(
      `INSERT INTO users (display_name, role, password_hash, is_active)
       VALUES ('Sistema', 'guest', NULL, false) RETURNING id`,
    );
    await insertM1DemoEvent(old, org!.id, user!.id);
    await old.close();

    const db = await openDb(url);
    expect((await migrate(db)).applied).toEqual([
      '0002_tasks.sql',
      '0003_demo_removed.sql',
      '0004_contacts_catalogue.sql',
      '0005_inventories.sql',
      '0006_followup.sql',
    ]);
    const seeded = await seed(db, {passwordFor: n => `pw-${n}-1234`});
    expect(seeded.organizationCreated).toBe(false);
    expect(seeded.demoEventCreated).toBe(false);
    expect(seeded.demoTasksCreated).toBe(DEMO_TASKS.length);
    // The tasks hang from the existing demo event; nothing is duplicated.
    const rows = await db.query<{events: number; linked: number}>(
      `SELECT (SELECT count(*)::int FROM events) AS events,
              (SELECT count(*)::int FROM tasks t JOIN events e ON e.id = t.event_id
                WHERE e.name = $1) AS linked`,
      [DEMO_EVENT.name],
    );
    expect(rows[0]).toEqual({events: 1, linked: DEMO_TASKS.length});
    // Milestone 3's demo contacts and offers arrive in the same run.
    expect(seeded.demoContactsCreated).toBeGreaterThan(0);
    expect(seeded.demoOffersCreated).toBeGreaterThan(0);
    // And milestone 4's inventory and notes.
    expect(seeded.demoResourcesCreated).toBeGreaterThan(0);
    expect(seeded.demoNotesCreated).toBeGreaterThan(0);
    const again = await seed(db, {passwordFor: n => n});
    expect(again.demoTasksCreated).toBe(0);
    expect(again.demoContactsCreated + again.demoOffersCreated).toBe(0);
    expect(again.demoResourcesCreated + again.demoNotesCreated).toBe(0);
    await db.close();
  }, 60_000);

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
