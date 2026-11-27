/**
 * Safety review of Revisión 1 · E4 (account access): no privilege escalation
 * through provisional passwords or reset links, recovery that answers before
 * any database work, anonymous recovery never cancelling an administrator's
 * link, and verification e-mails rate limited per account.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {NO_MAIL} from '../src/config.ts';
import type {Db} from '../src/db/db.ts';
import {createMemoryTransport} from '../src/mail/transport.ts';
import {RECOVERY_MAX_PER_NAME} from '../src/app.ts';
import {createHarness, json, TEST_ORIGIN, testConfig} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {SHARED_NO_PASSWORD, SHARED_NO_RENAME} from '../src/account/service.ts';
import type {
  AdminUser,
  ApiErrorBody,
  ListResponse,
  LoginResponse,
  Profile,
  ProvisionalPasswordResponse,
  ResetLinkResponse,
  SecurityEvent,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let admin: string;
let developer: string;
const ids: Record<string, string> = {};

const FALLBACK = 'buzon-proyecto@example.org';

beforeAll(async () => {
  h = await createHarness();
  await h.db.query(
    `UPDATE users SET password_provisional = false
      WHERE username IN ('Elvis', 'Yeray')`,
  );
  for (const name of ['Elvis', 'Yeray', 'Dailos', 'Equipo', 'Invitado']) {
    ids[name] = (
      await h.db.query<{id: string}>(
        'SELECT id FROM users WHERE username = $1',
        [name],
      )
    )[0]!.id;
  }
  // Yeray: developer only (helps people get back in, is no administrator).
  await h.db.query(
    "UPDATE organization_members SET roles = ARRAY['developer'] WHERE user_id = $1",
    [ids.Yeray],
  );
  admin = (await h.login('Elvis')).token;
  developer = (await h.login('Yeray')).token;
});

const adminCall = (token: string, userId: string, what: string) =>
  h.request('POST', `/admin/users/${userId}/${what}`, {
    token,
    headers: {Origin: TEST_ORIGIN},
  });

describe('no escalation through another account’s password', () => {
  it('a developer cannot take over an administrator, but still helps the team account', async () => {
    for (const what of ['provisional-password', 'reset-link']) {
      const res = await adminCall(developer, ids.Elvis!, what);
      expect(res.status, what).toBe(403);
      expect((await json<ApiErrorBody>(res)).message).toContain(
        'permisos que tú no tienes',
      );
    }
    // Nothing happened to the administrator's account.
    expect((await h.request('GET', '/me', {token: admin})).status).toBe(200);
    expect(
      (await adminCall(developer, ids.Equipo!, 'provisional-password')).status,
    ).toBe(200);
    expect(
      (await adminCall(developer, ids.Invitado!, 'provisional-password'))
        .status,
    ).toBe(200);
  });

  it('an administrator outranks every role', async () => {
    expect((await adminCall(admin, ids.Yeray!, 'reset-link')).status).toBe(200);
  });
});

describe('password recovery', () => {
  it('answers before looking the name up: the link and the security log come after, in the mail queue', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const gated: Db = {
      query: (sql, params) => h.db.query(sql, params),
      exec: sql => h.db.exec(sql),
      transaction: async fn => {
        await gate;
        return h.db.transaction(fn);
      },
      close: () => Promise.resolve(),
    };
    const transport = createMemoryTransport();
    const app = h.newApp({
      db: gated,
      config: {...testConfig, mail: {...NO_MAIL, recoveryFallback: FALLBACK}},
      mail: transport,
    });
    const ask = (username: string, ip: string) =>
      app.request('/api/auth/recovery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: TEST_ORIGIN,
          'x-test-ip': ip,
        },
        body: JSON.stringify({username}),
      });
    const before = await h.db.query<{n: number}>(
      "SELECT count(*)::int AS n FROM security_events WHERE kind = 'recovery_requested'",
    );
    // While the database work is held back, both answers are already there.
    const timeout = new Promise<'blocked'>(resolve =>
      setTimeout(() => resolve('blocked'), 2000),
    );
    const known = await Promise.race([ask('Dailos', '10.90.0.1'), timeout]);
    const unknown = await Promise.race([ask('Nadie', '10.90.0.2'), timeout]);
    expect(known).not.toBe('blocked');
    expect(unknown).not.toBe('blocked');
    expect((known as Response).status).toBe(202);
    expect((unknown as Response).status).toBe(202);
    expect(transport.sent).toEqual([]);

    release();
    await app.flushMail();
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe(FALLBACK);
    const after = await h.db.query<{n: number}>(
      "SELECT count(*)::int AS n FROM security_events WHERE kind = 'recovery_requested'",
    );
    expect(after[0]!.n).toBe(before[0]!.n + 1);
  });

  it('an anonymous request never cancels a link an administrator created', async () => {
    const res = await adminCall(admin, ids.Dailos!, 'reset-link');
    expect(res.status).toBe(200);
    const link = await json<ResetLinkResponse>(res);
    const token = /restablecer\/([A-Za-z0-9_-]{43})/.exec(link.url)![1]!;

    const transport = createMemoryTransport();
    const app = h.newApp({
      config: {...testConfig, mail: {...NO_MAIL, recoveryFallback: FALLBACK}},
      mail: transport,
    });
    const asked = await app.request('/api/auth/recovery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TEST_ORIGIN,
        'x-test-ip': '10.91.0.1',
      },
      body: JSON.stringify({username: 'Dailos'}),
    });
    expect(asked.status).toBe(202);
    await app.flushMail();
    expect(transport.sent).toHaveLength(1);
    const live = await h.db.query<{by_admin: boolean}>(
      `SELECT created_by IS NOT NULL AS by_admin FROM account_tokens
        WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL
        ORDER BY by_admin`,
      [ids.Dailos],
    );
    expect(live).toEqual([{by_admin: false}, {by_admin: true}]);
    // The administrator's link still works.
    const reset = await h.request('POST', '/auth/reset', {
      body: {token, newPassword: 'dailos-nueva-2026'},
    });
    expect(reset.status).toBe(204);
  });
});

describe('verification e-mails', () => {
  it('are rate limited per account', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= RECOVERY_MAX_PER_NAME; i++) {
      const res = await h.request('POST', '/me/email', {
        token: admin,
        body: {email: `elvis.${i}@example.org`},
        headers: {Origin: TEST_ORIGIN, 'x-test-ip': `10.92.0.${i}`},
      });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get('Retry-After')).not.toBeNull();
      }
    }
    expect(statuses).toEqual([...Array(RECOVERY_MAX_PER_NAME).fill(202), 429]);
    // Another account is not affected.
    const other = await h.request('POST', '/me/email', {
      token: developer,
      body: {email: 'yeray.otro@example.org'},
      headers: {Origin: TEST_ORIGIN},
    });
    expect(other.status).toBe(202);
  });
});

/** A PNG header the image check accepts (as in access.test.ts). */
function png(width: number, height: number): string {
  const b = new Uint8Array(49);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(
    [...'IHDR'].map(c => c.charCodeAt(0)),
    12,
  );
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return Buffer.from(b).toString('base64');
}

describe('shared accounts (Equipo, Invitado) are edited from administration', () => {
  let equipo: string;
  let guest: string;

  /** Signs a shared account in with a password set from administration. */
  async function signInShared(name: string, ip: string): Promise<string> {
    const set = await adminCall(admin, ids[name]!, 'provisional-password');
    expect(set.status).toBe(200);
    const {password} = await json<ProvisionalPasswordResponse>(set);
    const res = await h.request('POST', '/auth/login', {
      body: {username: name, password},
      headers: {'x-test-ip': ip},
    });
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    // Set by someone else, but it is its password: never «provisional».
    expect(body.user.passwordProvisional).toBe(false);
    return body.token;
  }

  beforeAll(async () => {
    equipo = await signInShared('Equipo', '10.93.0.1');
    guest = await signInShared('Invitado', '10.93.0.2');
  });

  const patchShared = (token: string, userId: string, body: object) =>
    h.request('PATCH', `/admin/users/${userId}/profile`, {token, body});

  const adminUser = async (userId: string) =>
    (
      await json<ListResponse<AdminUser>>(
        await h.request('GET', '/admin/users', {token: admin}),
      )
    ).items.find(u => u.id === userId)!;

  it('cannot change their own password, before any attempt is counted', async () => {
    const res = await h.request('POST', '/me/password', {
      token: equipo,
      body: {currentPassword: 'mal-escrita', newPassword: 'una-clave-larga'},
    });
    expect(res.status).toBe(403);
    expect((await json<ApiErrorBody>(res)).message).toBe(SHARED_NO_PASSWORD);
    const failures = await h.db.query<{n: number}>(
      "SELECT count(*)::int AS n FROM security_events WHERE user_id = $1 AND kind = 'login_failed'",
      [ids.Equipo],
    );
    expect(failures[0]!.n).toBe(0);
    expect(
      (
        await h.request('POST', '/me/password', {
          token: guest,
          body: {currentPassword: 'x', newPassword: 'una-clave-larga'},
        })
      ).status,
    ).toBe(403);
  });

  it('cannot rename themselves; the rest of the profile stays theirs', async () => {
    const profile = await json<Profile>(
      await h.request('GET', '/me/profile', {token: equipo}),
    );
    expect(profile.sharedAccount).toBe(true);
    const renamed = await h.request('PATCH', '/me/profile', {
      token: equipo,
      body: {version: profile.version, displayName: 'Equipo B'},
    });
    expect(renamed.status).toBe(403);
    const error = await json<ApiErrorBody>(renamed);
    expect(error.message).toBe(SHARED_NO_RENAME);
    expect(error.fields).toEqual({displayName: SHARED_NO_RENAME});
    // The same name sent back with a description is fine.
    const kept = await h.request('PATCH', '/me/profile', {
      token: equipo,
      body: {
        version: profile.version,
        displayName: 'Equipo',
        bio: 'Montaje y desmontaje',
      },
    });
    expect(kept.status).toBe(200);
    expect((await json<Profile>(kept)).user.displayName).toBe('Equipo');
  });

  it('cannot upload their own profile photo either', async () => {
    const res = await h.request('POST', '/media', {
      token: equipo,
      body: {
        organizationId: h.org.id,
        ownerType: 'user',
        ownerId: ids.Equipo,
        contentType: 'image/png',
        width: 400,
        height: 400,
        data: png(400, 400),
      },
    });
    expect(res.status).toBe(403);
    expect((await json<ApiErrorBody>(res)).message).toBe(SHARED_NO_RENAME);
  });

  it('administration knows which accounts are shared, with their version', async () => {
    expect(await adminUser(ids.Equipo!)).toMatchObject({
      sharedAccount: true,
      passwordProvisional: false,
      version: expect.any(Number),
    });
    expect((await adminUser(ids.Invitado!)).sharedAccount).toBe(true);
    expect((await adminUser(ids.Elvis!)).sharedAccount).toBe(false);
  });

  it('an administrator or developer sets their name and photo', async () => {
    const before = await adminUser(ids.Equipo!);
    const res = await patchShared(developer, ids.Equipo!, {
      version: before.version,
      displayName: 'Equipo de montaje',
      photo: {
        contentType: 'image/png',
        width: 64,
        height: 64,
        data: png(64, 64),
      },
    });
    expect(res.status).toBe(200);
    const after = await json<AdminUser>(res);
    expect(after.displayName).toBe('Equipo de montaje');
    expect(after.avatarId).not.toBeNull();
    expect(after.version).toBe(before.version + 1);
    // The account sees it at once.
    const me = await json<{user: {displayName: string; avatarId: string}}>(
      await h.request('GET', '/me', {token: equipo}),
    );
    expect(me.user).toMatchObject({
      displayName: 'Equipo de montaje',
      avatarId: after.avatarId,
    });

    // A stale version is refused with the current account.
    const stale = await patchShared(admin, ids.Equipo!, {
      version: before.version,
      displayName: 'Equipo C',
    });
    expect(stale.status).toBe(409);
    const conflict = await json<ApiErrorBody>(stale);
    expect(conflict.code).toBe('VERSION_CONFLICT');
    expect(conflict.current).toMatchObject({displayName: 'Equipo de montaje'});

    // Names stay unique.
    const taken = await patchShared(admin, ids.Equipo!, {
      version: after.version,
      displayName: 'elvis',
    });
    expect(taken.status).toBe(409);
    expect((await json<ApiErrorBody>(taken)).fields).toHaveProperty(
      'displayName',
    );

    // A bad image is refused on the photo's fields; nothing changes.
    const bad = await patchShared(admin, ids.Equipo!, {
      version: after.version,
      photo: {contentType: 'image/png', width: 64, height: 64, data: 'AAAA'},
    });
    expect(bad.status).toBe(400);
    expect((await json<ApiErrorBody>(bad)).fields).toHaveProperty('photo.data');

    // Removing the photo keeps the version (as a photo of its owner).
    const removed = await patchShared(admin, ids.Equipo!, {
      version: after.version,
      photo: null,
    });
    expect(removed.status).toBe(200);
    expect(await json<AdminUser>(removed)).toMatchObject({
      avatarId: null,
      version: after.version,
    });

    const log = await json<ListResponse<SecurityEvent>>(
      await h.request('GET', '/admin/security?limit=50', {token: admin}),
    );
    const changes = log.items.filter(
      e => e.kind === 'profile_changed' && e.user.id === ids.Equipo,
    );
    // Removal (Elvis), name and photo (Yeray), and the account's own
    // description change (no actor); same instant, so compared as a set.
    expect(changes.map(e => e.actor?.displayName ?? '(propia)').sort()).toEqual(
      ['(propia)', 'Elvis', 'Yeray'],
    );
  });

  it('only shared accounts, never a photo for the guest, never without users.manage', async () => {
    const elvis = await adminUser(ids.Elvis!);
    const personal = await patchShared(developer, ids.Elvis!, {
      version: elvis.version,
      displayName: 'El jefe',
    });
    expect(personal.status).toBe(403);
    expect((await json<ApiErrorBody>(personal)).message).toContain(
      'Esta cuenta es personal',
    );

    const invitado = await adminUser(ids.Invitado!);
    const photo = await patchShared(admin, ids.Invitado!, {
      version: invitado.version,
      photo: {contentType: 'image/png', width: 8, height: 8, data: png(8, 8)},
    });
    expect(photo.status).toBe(400);
    expect((await json<ApiErrorBody>(photo)).fields).toHaveProperty('photo');

    // The shared account itself has no users.manage.
    const self = await patchShared(equipo, ids.Equipo!, {
      version: (await adminUser(ids.Equipo!)).version,
      displayName: 'Nosotros',
    });
    expect(self.status).toBe(403);
    expect((await adminUser(ids.Equipo!)).displayName).toBe(
      'Equipo de montaje',
    );
  });
});
