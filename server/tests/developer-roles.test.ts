/**
 * Developer accounts (fix/desarrollo-roles-fijos): migration 0013 from a 0012
 * database (developer ⇒ admin, enforced by the database), the seed
 * reasserting the fixed roles on every run, and `cuenta:recuperar`
 * (recovering one account from the server, without e-mail).
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createPgliteDb} from '../src/db/pglite.ts';
import {migrate, readMigrations} from '../src/db/migrate.ts';
import {seed} from '../src/seed/seed.ts';
import {
  recoverAccount,
  RECOVERED_ON_SERVER,
  RecoverError,
} from '../src/account/recover.ts';
import {verifyPassword} from '../src/auth/password.ts';
import {createHarness, passwordFor} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {normalizeRoles} from '../../shared/logistics/permissions.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, {recursive: true, force: true});
});

const rolesOf = async (h: Harness, username: string) => {
  const [row] = await h.db.query<{roles: string[]}>(
    `SELECT m.roles FROM organization_members m
       JOIN users u ON u.id = m.user_id WHERE u.username = $1`,
    [username],
  );
  return normalizeRoles(row?.roles ?? []);
};

describe('migration 0013', () => {
  it('adds administration to every developer membership and then refuses a developer without it', async () => {
    const all = readMigrations();
    const at = all.findIndex(m => m.file === '0013_developer_fixed_roles.sql');
    expect(at).toBe(12);
    const dir = mkdtempSync(join(tmpdir(), 'oxeye-developer-'));
    tempDirs.push(dir);
    for (const m of all.slice(0, at)) writeFileSync(join(dir, m.file), m.sql);
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(12);

    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org Prueba') RETURNING id",
    );
    const members: Record<string, string[]> = {
      Dev: ['developer'],
      DevTeam: ['developer', 'team'],
      Admin: ['admin'],
      Team: ['team'],
    };
    for (const [name, roles] of Object.entries(members)) {
      const [user] = await db.query<{id: string}>(
        `INSERT INTO users (username, display_name, role, password_hash)
         VALUES ($1, $1, 'member', 'scrypt$1$1$1$a$b') RETURNING id`,
        [name],
      );
      await db.query(
        `INSERT INTO organization_members (organization_id, user_id, roles)
         VALUES ($1, $2, ARRAY(SELECT jsonb_array_elements_text($3::jsonb)))`,
        [org!.id, user!.id, JSON.stringify(roles)],
      );
    }

    writeFileSync(join(dir, all[at]!.file), all[at]!.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0013_developer_fixed_roles.sql',
    ]);
    const rows = await db.query<{username: string; roles: string[]}>(
      `SELECT u.username, m.roles FROM organization_members m
         JOIN users u ON u.id = m.user_id ORDER BY u.username`,
    );
    expect(rows.map(r => [r.username, normalizeRoles(r.roles)])).toEqual([
      ['Admin', ['admin']],
      ['Dev', ['admin', 'developer']],
      ['DevTeam', ['admin', 'developer', 'team']],
      ['Team', ['team']],
    ]);
    await expect(
      db.query(
        `UPDATE organization_members SET roles = ARRAY['developer']
          WHERE user_id = (SELECT id FROM users WHERE username = 'Dev')`,
      ),
    ).rejects.toThrow();
    await db.close();
  });
});

describe('fixed roles of a developer account', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });

  it('the seed gives them back on every run, keeping any other role', async () => {
    await h.db.query(
      `UPDATE organization_members SET roles = ARRAY['team'], roles_set_at = now()
        WHERE user_id = (SELECT id FROM users WHERE username = 'Fabián')`,
    );
    const again = await seed(h.db, {passwordFor: () => 'no-se-usa'});
    expect(again.users.find(u => u.username === 'Fabián')?.roles).toEqual([
      'admin',
      'developer',
      'team',
    ]);
    expect(await rolesOf(h, 'Fabián')).toEqual(['admin', 'developer', 'team']);
    // Other accounts keep what an administrator set.
    await h.db.query(
      `UPDATE organization_members SET roles = ARRAY['team'], roles_set_at = now()
        WHERE user_id = (SELECT id FROM users WHERE username = 'Yeray')`,
    );
    await seed(h.db, {passwordFor: () => 'no-se-usa'});
    expect(await rolesOf(h, 'Yeray')).toEqual(['team']);
  });
});

describe('cuenta:recuperar', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });

  it('gives one account a new provisional password, ends its sessions and logs it without secrets', async () => {
    await h.db.query(
      "UPDATE users SET password_provisional = false WHERE username = 'Fabián'",
    );
    const session = await h.login('Fabián');
    const elvisBefore = await h.db.query<{password_hash: string}>(
      "SELECT password_hash FROM users WHERE username = 'Elvis'",
    );
    await h.db.query(
      `INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at)
       SELECT id, 'password_reset', repeat('d', 64), now() + interval '1 hour'
         FROM users WHERE username = 'Fabián'`,
    );

    h.clock.advance(1000);
    const result = await recoverAccount(h.db, 'fabián', h.clock.now());
    expect(result).toMatchObject({
      username: 'Fabián',
      provisional: true,
      developer: true,
    });
    expect(result.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const [fabian] = await h.db.query<{
      id: string;
      password_hash: string;
      password_provisional: boolean;
    }>(
      "SELECT id, password_hash, password_provisional FROM users WHERE username = 'Fabián'",
    );
    expect(fabian!.password_provisional).toBe(true);
    expect(await verifyPassword(result.password, fabian!.password_hash)).toBe(
      true,
    );
    expect(
      await verifyPassword(passwordFor('Fabián'), fabian!.password_hash),
    ).toBe(false);
    // The old session is gone, the pending link too; nobody else changed.
    expect((await h.request('GET', '/me', {token: session.token})).status).toBe(
      401,
    );
    const tokens = await h.db.query(
      'SELECT 1 FROM account_tokens WHERE user_id = $1 AND used_at IS NULL',
      [fabian!.id],
    );
    expect(tokens).toEqual([]);
    expect(
      await h.db.query(
        "SELECT password_hash FROM users WHERE username = 'Elvis'",
      ),
    ).toEqual(elvisBefore);
    expect(await rolesOf(h, 'Fabián')).toEqual(['admin', 'developer']);

    const events = await h.db.query<{
      kind: string;
      actor_id: string | null;
      detail: string | null;
    }>(
      `SELECT kind, actor_id, detail FROM security_events
        WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT 1`,
      [fabian!.id],
    );
    expect(events).toEqual([
      {
        kind: 'password_provisional_set',
        actor_id: null,
        detail: RECOVERED_ON_SERVER,
      },
    ]);
    const raw = JSON.stringify(
      await h.db.query('SELECT * FROM security_events'),
    );
    expect(raw).not.toContain(result.password);
  });

  it('the guest account gets its password, never provisional', async () => {
    const result = await recoverAccount(h.db, 'Invitado', h.clock.now());
    expect(result).toMatchObject({provisional: false, developer: false});
  });

  it('the shared team account gets its password, never provisional (it cannot change it)', async () => {
    const result = await recoverAccount(h.db, 'Equipo', h.clock.now());
    expect(result).toMatchObject({provisional: false, developer: false});
    const [row] = await h.db.query<{password_provisional: boolean}>(
      `SELECT password_provisional FROM users WHERE username = 'Equipo'`,
    );
    expect(row?.password_provisional).toBe(false);
  });

  it('an unknown name changes nothing', async () => {
    const before = await h.db.query(
      'SELECT id, password_hash FROM users ORDER BY id',
    );
    await expect(
      recoverAccount(h.db, 'Nadie', h.clock.now()),
    ).rejects.toBeInstanceOf(RecoverError);
    await expect(recoverAccount(h.db, '  ', h.clock.now())).rejects.toThrow(
      RecoverError,
    );
    expect(
      await h.db.query('SELECT id, password_hash FROM users ORDER BY id'),
    ).toEqual(before);
  });
});
