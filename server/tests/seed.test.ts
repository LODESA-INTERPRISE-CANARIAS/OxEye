import {describe, expect, it} from 'vitest';
import {createApp} from '../src/app.ts';
import {migrate} from '../src/db/migrate.ts';
import {createPgliteDb} from '../src/db/pglite.ts';
import {
  DEMO_EVENT,
  PILOT_ORGANIZATION,
  PILOT_USERS,
  seed,
} from '../src/seed/seed.ts';
import {createClock, passwordFor, testConfig} from './helpers.ts';

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

    const second = await seed(db, {
      passwordFor: () => 'should-not-be-used',
      now: clock.now(),
    });
    expect(second.organizationCreated).toBe(false);
    expect(second.users.every(u => !u.created && u.password === null)).toBe(
      true,
    );
    expect(second.demoEventCreated).toBe(false);

    const counts = await db.query<{
      orgs: number;
      users: number;
      events: number;
    }>(
      `SELECT (SELECT count(*)::int FROM organizations) AS orgs,
              (SELECT count(*)::int FROM users WHERE is_active) AS users,
              (SELECT count(*)::int FROM events) AS events`,
    );
    expect(counts[0]).toEqual({orgs: 1, users: 5, events: 1});

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
