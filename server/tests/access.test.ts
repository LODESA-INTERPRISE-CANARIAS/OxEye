/**
 * Revisión 1 · E4: personal access and roles. Login by username, roles and
 * permissions, provisional passwords, profile, password change, recovery
 * e-mail and reset links, sessions, support sessions, «Ver como Invitado»,
 * profile photos, read-only members and the security log (never a secret).
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {parseAccountLink} from '../../shared/logistics/account.ts';
import {NO_MAIL} from '../src/config.ts';
import {createMemoryTransport} from '../src/mail/transport.ts';
import {seed} from '../src/seed/seed.ts';
import {
  createHarness,
  json,
  passwordFor,
  TEST_ORIGIN,
  testConfig,
} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {
  NO_ACCESS,
  PROVISIONAL_HOLD,
} from '../../shared/logistics/permissions.ts';
import type {
  AdminUser,
  ApiErrorBody,
  ListResponse,
  LoginResponse,
  MediaInfo,
  MemberProfile,
  MeResponse,
  Profile,
  ProvisionalPasswordResponse,
  ResetLinkResponse,
  SecurityEvent,
  SessionInfo,
  SupportSessionResponse,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Every password typed in these tests: none may reach the security log. */
const typed = new Set<string>();

async function loginAs(
  username: string,
  password = passwordFor(username),
  headers: Record<string, string> = {},
): Promise<LoginResponse> {
  typed.add(password);
  // A second apart, so the security log has a stable order.
  h.clock.advance(1000);
  const res = await h.request('POST', '/auth/login', {
    body: {username, password},
    headers: {'x-test-ip': `10.40.${typed.size}.1`, ...headers},
  });
  expect(res.status, `login ${username}`).toBe(200);
  return json<LoginResponse>(res);
}

async function errorOf(res: Response, status: number): Promise<ApiErrorBody> {
  expect(res.status).toBe(status);
  return json<ApiErrorBody>(res);
}

/** Changes the own password (clears the provisional mark). */
async function setOwnPassword(token: string, current: string, next: string) {
  typed.add(next);
  const res = await h.request('POST', '/me/password', {
    token,
    body: {currentPassword: current, newPassword: next},
  });
  expect(res.status).toBe(204);
}

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

const FABIAN_PW = 'nueva-clave-fabian-2026';
/** Replaced by the provisional passwords set in «administration». */
let elvisPassword = passwordFor('Elvis');
let guestPassword = passwordFor('Invitado');
let yerayPassword = 'yeray-nueva-2026';

beforeAll(async () => {
  h = await createHarness();
});

describe('login by username and the session user', () => {
  it('any letter case; the legacy displayName field still works; device label kept', async () => {
    const res = await h.request('POST', '/auth/login', {
      body: {username: 'eLVis', password: passwordFor('Elvis')},
      headers: {'User-Agent': CHROME_WINDOWS},
    });
    const body = await json<LoginResponse>(res);
    expect(res.status).toBe(200);
    expect(body.user.username).toBe('Elvis');
    const legacy = await h.request('POST', '/auth/login', {
      body: {displayName: 'Dailos', password: passwordFor('Dailos')},
    });
    expect(legacy.status).toBe(200);
    const [session] = await h.db.query<{device: string; kind: string}>(
      'SELECT device, kind FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [body.user.id],
    );
    expect(session).toEqual({device: 'Chrome · Windows', kind: 'normal'});
    const [user] = await h.db.query<{last_login_at: unknown}>(
      'SELECT last_login_at FROM users WHERE id = $1',
      [body.user.id],
    );
    expect(user?.last_login_at).not.toBeNull();
  });

  it('an unknown name and a wrong password look the same; only a known account logs the failure', async () => {
    const before = await h.db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM security_events',
    );
    h.clock.advance(1000);
    const wrong = await h.request('POST', '/auth/login', {
      body: {username: 'Yeray', password: 'mal-escrita'},
      headers: {'x-test-ip': '10.41.0.1'},
    });
    const unknown = await h.request('POST', '/auth/login', {
      body: {username: 'mi-contraseña-secreta', password: 'x'},
      headers: {'x-test-ip': '10.41.0.1'},
    });
    expect(await json(wrong)).toEqual(await json(unknown));
    expect(wrong.status).toBe(401);
    const after = await h.db.query<{kind: string; detail: string | null}>(
      'SELECT kind, detail FROM security_events ORDER BY at DESC, id DESC',
    );
    expect(after.length).toBe((before[0]?.n ?? 0) + 1);
    expect(after[0]).toEqual({kind: 'login_failed', detail: null});
    const raw = JSON.stringify(
      await h.db.query('SELECT * FROM security_events'),
    );
    expect(raw).not.toContain('mi-contraseña-secreta');
    expect(raw).not.toContain('mal-escrita');
  });

  it('/me carries roles, effective permissions, provisional and welcome flags', async () => {
    const elvis = await loginAs('Elvis');
    const me = await json<MeResponse>(
      await h.request('GET', '/me', {token: elvis.token}),
    );
    expect(me.user).toMatchObject({
      username: 'Elvis',
      passwordProvisional: true,
      welcomed: false,
      support: null,
    });
    // Administrator, but the password is provisional: sensitive ones withheld.
    expect(me.organizations[0]).toMatchObject({
      roles: ['admin'],
      permissions: ['plan.edit', 'directory.read', 'view_as_guest'],
    });
    const equipo = await loginAs('Equipo');
    expect(equipo.organizations[0]).toMatchObject({
      roles: ['team'],
      permissions: ['plan.edit', 'directory.read'],
    });
    const guest = await loginAs('Invitado');
    expect(guest.user.passwordProvisional).toBe(false);
    expect(guest.organizations[0]).toMatchObject({roles: [], permissions: []});

    expect(
      (await h.request('POST', '/me/welcome', {token: elvis.token})).status,
    ).toBe(204);
    const again = await json<MeResponse>(
      await h.request('GET', '/me', {token: elvis.token}),
    );
    expect(again.user.welcomed).toBe(true);
  });
});

describe('provisional passwords and the own password', () => {
  it('administration is held back until the provisional password is replaced', async () => {
    const fabian = await loginAs('Fabián');
    expect(fabian.organizations[0]?.roles).toEqual(['admin', 'developer']);
    const held = await errorOf(
      await h.request('GET', '/admin/users', {token: fabian.token}),
      403,
    );
    expect(held.message).toBe(PROVISIONAL_HOLD);

    await setOwnPassword(fabian.token, passwordFor('Fabián'), FABIAN_PW);
    const me = await json<MeResponse>(
      await h.request('GET', '/me', {token: fabian.token}),
    );
    expect(me.user.passwordProvisional).toBe(false);
    expect(me.organizations[0]?.permissions).toEqual([
      'plan.edit',
      'directory.read',
      'budget.read',
      'budget.edit',
      'offers.approve',
      'users.manage',
      'support.start',
      'view_as_guest',
      'diagnostics.read',
    ]);
    expect(
      (await h.request('GET', '/admin/users', {token: fabian.token})).status,
    ).toBe(200);
  });

  it('checks the current password, the rules and can sign out the other sessions', async () => {
    const a = await loginAs('Yeray');
    const b = await loginAs('Yeray', passwordFor('Yeray'), {
      'User-Agent': SAFARI_IPHONE,
    });
    const change = (body: object) =>
      h.request('POST', '/me/password', {token: a.token, body});
    expect(
      (
        await errorOf(
          await change({
            currentPassword: 'mala',
            newPassword: 'una-clave-larga',
          }),
          400,
        )
      ).fields,
    ).toEqual({currentPassword: 'La contraseña actual no es correcta.'});
    expect(
      (
        await errorOf(
          await change({
            currentPassword: passwordFor('Yeray'),
            newPassword: 'corta',
          }),
          400,
        )
      ).fields?.newPassword,
    ).toMatch(/al menos 10/);
    expect(
      (
        await errorOf(
          await change({
            currentPassword: passwordFor('Yeray'),
            newPassword: 'YERAY',
          }),
          400,
        )
      ).fields?.newPassword,
    ).toBeTruthy();
    typed.add('yeray-nueva-2026');
    h.clock.advance(1000);
    expect(
      (
        await change({
          currentPassword: passwordFor('Yeray'),
          newPassword: 'yeray-nueva-2026',
          signOutOthers: true,
        })
      ).status,
    ).toBe(204);
    expect((await h.request('GET', '/me', {token: a.token})).status).toBe(200);
    expect((await h.request('GET', '/me', {token: b.token})).status).toBe(401);
    await loginAs('Yeray', 'yeray-nueva-2026');
    const events = await json<ListResponse<SecurityEvent>>(
      await h.request('GET', '/me/security', {token: a.token}),
    );
    // The change and the sign-out happen at the same instant.
    expect(events.items[0]?.kind).toBe('login');
    expect(
      events.items
        .slice(1, 3)
        .map(e => e.kind)
        .sort(),
    ).toEqual(['password_changed', 'sessions_revoked']);
  });

  it('the guest account has no profile and cannot change its password', async () => {
    const guest = await loginAs('Invitado');
    for (const [method, path] of [
      ['GET', '/me/profile'],
      ['POST', '/me/password'],
      ['GET', '/me/sessions'],
      ['GET', '/me/security'],
    ] as const) {
      const res = await h.request(method, path, {
        token: guest.token,
        body:
          method === 'POST'
            ? {
                currentPassword: passwordFor('Invitado'),
                newPassword: 'x'.repeat(12),
              }
            : undefined,
      });
      expect(res.status, path).toBe(403);
    }
    expect((await h.request('GET', '/me', {token: guest.token})).status).toBe(
      200,
    );
  });
});

describe('profile', () => {
  it('edits display name, description and accent with a version; names stay unique', async () => {
    const dailos = await loginAs('Dailos');
    const profile = await json<Profile>(
      await h.request('GET', '/me/profile', {token: dailos.token}),
    );
    expect(profile).toMatchObject({
      bio: null,
      recoveryEmail: null,
      pendingRecoveryEmail: null,
      sharedAccount: false,
    });
    const patch = (body: object) =>
      h.request('PATCH', '/me/profile', {token: dailos.token, body});
    const updated = await json<Profile>(
      await patch({
        version: profile.version,
        displayName: 'Dailos R.',
        bio: '  Producción   técnica ',
        accent: 'teal',
      }),
    );
    expect(updated).toMatchObject({
      bio: 'Producción técnica',
      user: {username: 'Dailos', displayName: 'Dailos R.', accent: 'teal'},
      version: profile.version + 1,
    });
    // The login name never changes.
    await loginAs('Dailos');
    expect(
      (await errorOf(await patch({version: profile.version, bio: 'x'}), 409))
        .code,
    ).toBe('VERSION_CONFLICT');
    const dup = await errorOf(
      await patch({version: updated.version, displayName: 'ELVIS'}),
      409,
    );
    expect(dup).toMatchObject({
      code: 'DUPLICATE',
      fields: {displayName: expect.any(String)},
    });
    expect(
      (
        await errorOf(
          await patch({version: updated.version, bio: 'a'.repeat(281)}),
          400,
        )
      ).fields?.bio,
    ).toBeTruthy();
    expect(
      (
        await errorOf(
          await patch({version: updated.version, accent: 'Rojo!'}),
          400,
        )
      ).fields?.accent,
    ).toBeTruthy();
    // Names look the same everywhere: the members list.
    const members = await json<ListResponse<MemberProfile>>(
      await h.request('GET', `/organizations/${h.org.id}/members`, {
        token: dailos.token,
      }),
    );
    expect(members.items.find(m => m.id === dailos.user.id)).toMatchObject({
      displayName: 'Dailos R.',
      bio: 'Producción técnica',
      roles: ['admin'],
      restricted: false,
    });
  });
});

describe('recovery and verification e-mails', () => {
  const FALLBACK = 'buzon-proyecto@example.org';
  const mailApp = (fallback: string | null, configured = false) => {
    const transport = createMemoryTransport(configured);
    const app = h.newApp({
      config: {
        ...testConfig,
        mail: {...NO_MAIL, recoveryFallback: fallback},
      },
      mail: transport,
    });
    const call = (
      path: string,
      body: object,
      headers: Record<string, string> = {},
    ) =>
      app.request(`/api${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: TEST_ORIGIN,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    return {app, sent: transport.sent, call};
  };
  const tokenOf = (text: string) =>
    /\/gestor-logistico\/cuenta\/(?:restablecer|verificar)#([A-Za-z0-9_-]{43})/.exec(
      text,
    )?.[1] as string;

  it('answers 202 the same for anyone; the link goes to the project inbox without a verified e-mail', async () => {
    const {app, sent, call} = mailApp(FALLBACK);
    const known = await call('/auth/recovery', {username: 'equipo'});
    const unknown = await call('/auth/recovery', {username: 'Nadie'});
    const guest = await call('/auth/recovery', {username: 'Invitado'});
    for (const r of [known, unknown, guest]) {
      expect(r.status).toBe(202);
      expect(await r.text()).toBe('');
    }
    await app.flushMail();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({to: FALLBACK});
    expect(sent[0]?.subject).toContain('«Equipo»');
    expect(sent[0]?.text).toContain(
      `${TEST_ORIGIN}/gestor-logistico/cuenta/restablecer#`,
    );
    // The token travels only in the fragment, never in the path.
    expect(sent[0]?.text).not.toMatch(/\/\/[^\s#]*[A-Za-z0-9_-]{43}/);
    expect(sent[0]?.text).toContain('OxEye');
    expect(sent[0]?.text).not.toMatch(/pw-|contraseña: /);

    // Single use, and every session of the account ends.
    const before = await loginAs('Equipo');
    const token = tokenOf(sent[0]!.text);
    typed.add('equipo-nueva-2026');
    const reset = (newPassword: string) =>
      call('/auth/reset', {token, newPassword});
    expect(
      (await errorOf(await reset('corta'), 400)).fields?.newPassword,
    ).toBeTruthy();
    expect((await reset('equipo-nueva-2026')).status).toBe(204);
    expect(
      (await errorOf(await reset('equipo-otra-2026'), 400)).fields?.token,
    ).toMatch(/ya se ha usado o ha caducado/);
    expect((await h.request('GET', '/me', {token: before.token})).status).toBe(
      401,
    );
    const after = await loginAs('Equipo', 'equipo-nueva-2026');
    expect(after.user.passwordProvisional).toBe(false);
    // The link is kept only as a hash.
    const stored = JSON.stringify(
      await h.db.query('SELECT * FROM account_tokens'),
    );
    expect(stored).not.toContain(token);
  });

  it('a link expires after RESET_LINK_MINUTES; nothing is sent without a trusted address', async () => {
    const {app, sent, call} = mailApp(FALLBACK);
    await call('/auth/recovery', {username: 'Elvis'});
    await app.flushMail();
    const token = tokenOf(sent[0]!.text);
    h.clock.advance(31 * 60_000);
    expect(
      (
        await errorOf(
          await call('/auth/reset', {token, newPassword: 'elvis-nueva-2026'}),
          400,
        )
      ).fields?.token,
    ).toBeTruthy();
    // An Origin the server does not know never becomes a mailed link.
    const evil = await call(
      '/auth/recovery',
      {username: 'Dailos'},
      {Origin: 'https://evil.example'},
    );
    expect(evil.status).toBe(202);
    await app.flushMail();
    expect(sent).toHaveLength(1);
    // No fallback inbox and no verified e-mail: nothing to send, same answer.
    const none = mailApp(null);
    expect(
      (await none.call('/auth/recovery', {username: 'Dailos'})).status,
    ).toBe(202);
    await none.app.flushMail();
    expect(none.sent).toEqual([]);
  });

  it('is rate limited by name and by IP', async () => {
    const {call} = mailApp(FALLBACK);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await call(
            '/auth/recovery',
            {username: 'Yeray'},
            {'x-test-ip': `10.50.0.${i}`},
          )
        ).status,
      );
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it('a recovery e-mail is verified by its link, shown masked, then receives the reset links', async () => {
    const {app, sent, call} = mailApp(FALLBACK);
    const yeray = await loginAs('Yeray', 'yeray-nueva-2026');
    const ask = await app.request('/api/me/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TEST_ORIGIN,
        Authorization: `Bearer ${yeray.token}`,
      },
      body: JSON.stringify({email: 'yeray.personal@example.org'}),
    });
    expect(ask.status).toBe(202);
    await app.flushMail();
    expect(sent[0]?.to).toBe('yeray.personal@example.org');
    const pending = await json<Profile>(
      await h.request('GET', '/me/profile', {token: yeray.token}),
    );
    expect(pending).toMatchObject({
      recoveryEmail: null,
      pendingRecoveryEmail: 'y•••@example.org',
    });
    expect(
      (await call('/auth/verify-email', {token: tokenOf(sent[0]!.text)}))
        .status,
    ).toBe(204);
    const verified = await json<Profile>(
      await h.request('GET', '/me/profile', {token: yeray.token}),
    );
    expect(verified).toMatchObject({
      recoveryEmail: 'y•••@example.org',
      pendingRecoveryEmail: null,
    });
    await call(
      '/auth/recovery',
      {username: 'Yeray'},
      {'x-test-ip': '10.51.0.1'},
    );
    await app.flushMail();
    expect(sent[1]?.to).toBe('yeray.personal@example.org');
    expect(sent[1]?.text).toContain('Hola, Yeray');
    // The shared team account has none.
    const equipo = await loginAs('Equipo', 'equipo-nueva-2026');
    expect(
      (
        await h.request('POST', '/me/email', {
          token: equipo.token,
          body: {email: 'equipo@example.org'},
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.request('DELETE', '/me/email', {token: yeray.token})).status,
    ).toBe(204);
  });
});

describe('sessions', () => {
  it('lists the own sessions with a device label; ends one or all the others', async () => {
    const a = await loginAs('Elvis', passwordFor('Elvis'), {
      'User-Agent': CHROME_WINDOWS,
    });
    const b = await loginAs('Elvis', passwordFor('Elvis'), {
      'User-Agent': SAFARI_IPHONE,
    });
    const list = await json<ListResponse<SessionInfo>>(
      await h.request('GET', '/me/sessions', {token: a.token}),
    );
    const current = list.items.find(s => s.current);
    expect(current).toMatchObject({device: 'Chrome · Windows', kind: 'normal'});
    const phone = list.items.find(s => s.device === 'Safari · iPhone')!;
    expect(
      (await h.request('DELETE', `/me/sessions/${phone.id}`, {token: a.token}))
        .status,
    ).toBe(204);
    expect((await h.request('GET', '/me', {token: b.token})).status).toBe(401);
    // Someone else's session is «not found».
    const dailos = await loginAs('Dailos');
    const theirs = await json<ListResponse<SessionInfo>>(
      await h.request('GET', '/me/sessions', {token: dailos.token}),
    );
    expect(
      (
        await h.request('DELETE', `/me/sessions/${theirs.items[0]!.id}`, {
          token: a.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.request('DELETE', '/me/sessions', {token: a.token})).status,
    ).toBe(204);
    const left = await json<ListResponse<SessionInfo>>(
      await h.request('GET', '/me/sessions', {token: a.token}),
    );
    expect(left.items.map(s => s.current)).toEqual([true]);
  });
});

describe('administration', () => {
  let fabian: string;
  let users: AdminUser[];
  const idOf = (username: string) =>
    users.find(u => u.username === username)!.id;

  beforeAll(async () => {
    fabian = (await loginAs('Fabián', FABIAN_PW)).token;
    users = (
      await json<ListResponse<AdminUser>>(
        await h.request('GET', '/admin/users', {token: fabian}),
      )
    ).items;
  });

  it('lists the people of the managed organizations, without secrets', () => {
    expect(users.map(u => u.username)).toEqual([
      'Elvis',
      'Dailos',
      'Yeray',
      'Equipo',
      'Invitado',
      'Fabián',
    ]);
    expect(users.find(u => u.username === 'Invitado')).toMatchObject({
      role: 'guest',
      memberships: [{organizationId: h.org.id, roles: []}],
      passwordProvisional: false,
    });
    expect(JSON.stringify(users)).not.toMatch(/scrypt|@example/);
  });

  it('only administrators change roles; one administrator always remains', async () => {
    const put = (username: string, roles: string[], token = fabian) =>
      h.request('PUT', `/admin/users/${idOf(username)}/roles`, {
        token,
        body: {organizationId: h.org.id, roles},
      });
    const yeray = await json<AdminUser>(await put('Yeray', ['team', 'team']));
    expect(yeray.memberships).toEqual([
      {organizationId: h.org.id, roles: ['team']},
    ]);
    expect(
      (await errorOf(await put('Invitado', ['team']), 400)).fields?.roles,
    ).toBeTruthy();
    for (const name of ['Elvis', 'Dailos']) {
      expect((await put(name, ['team'])).status).toBe(200);
    }
    // A developer account's roles are fixed, even for itself.
    for (const roles of [['admin'], ['team'], ['admin', 'developer', 'team']]) {
      expect((await errorOf(await put('Fabián', roles), 403)).message).toMatch(
        /sus roles son fijos/,
      );
    }
    // Development is never handed out from the app.
    expect(
      (await errorOf(await put('Dailos', ['admin', 'developer']), 400)).fields
        ?.roles,
    ).toMatch(/lo asigna el equipo técnico/);
    // Fabián stays an administrator whatever happens to the others.
    expect((await put('Dailos', ['admin'])).status).toBe(200);
    const dailos = await loginAs('Dailos');
    await setOwnPassword(
      dailos.token,
      passwordFor('Dailos'),
      'dailos-nueva-2026',
    );
    const provisional = await h.request(
      'POST',
      `/admin/users/${idOf('Yeray')}/provisional-password`,
      {token: dailos.token},
    );
    expect(provisional.status).toBe(200);
    yerayPassword = (await json<ProvisionalPasswordResponse>(provisional))
      .password;
    typed.add(yerayPassword);
    for (const [name, roles] of [
      ['Elvis', ['admin']],
      ['Dailos', ['admin']],
      ['Yeray', ['admin']],
    ] as const) {
      expect((await put(name, [...roles])).status).toBe(200);
    }
    // The team account has no administration at all.
    const equipo = await loginAs('Equipo', 'equipo-nueva-2026');
    expect(
      (
        await errorOf(
          await h.request('GET', '/admin/users', {token: equipo.token}),
          403,
        )
      ).message,
    ).toBe(NO_ACCESS['users.manage']);
    // The seed never undoes what an administrator set.
    await h.db.query(
      `UPDATE organization_members SET roles = ARRAY['team'], roles_set_at = now()
        WHERE user_id = $1`,
      [idOf('Yeray')],
    );
    const again = await seed(h.db, {passwordFor: () => 'no-se-usa'});
    expect(again.users.find(u => u.username === 'Yeray')).toMatchObject({
      roles: ['team'],
      password: null,
    });
    expect((await put('Yeray', ['admin'])).status).toBe(200);
  });

  it('a provisional password: shown once, never the current one, ends the sessions, any account but one’s own', async () => {
    const elvis = await loginAs('Elvis');
    const res = await h.request(
      'POST',
      `/admin/users/${idOf('Elvis')}/provisional-password`,
      {token: fabian},
    );
    const {password} = await json<ProvisionalPasswordResponse>(res);
    typed.add(password);
    expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(password).not.toBe(passwordFor('Elvis'));
    expect((await h.request('GET', '/me', {token: elvis.token})).status).toBe(
      401,
    );
    elvisPassword = password;
    const again = await loginAs('Elvis', password);
    expect(again.user.passwordProvisional).toBe(true);
    expect(
      (
        await h.request(
          'POST',
          `/admin/users/${idOf('Fabián')}/provisional-password`,
          {
            token: fabian,
          },
        )
      ).status,
    ).toBe(400);
    // The guest account too (it never becomes «provisional»).
    const guest = await json<ProvisionalPasswordResponse>(
      await h.request(
        'POST',
        `/admin/users/${idOf('Invitado')}/provisional-password`,
        {
          token: fabian,
        },
      ),
    );
    typed.add(guest.password);
    guestPassword = guest.password;
    expect(
      (await loginAs('Invitado', guest.password)).user.passwordProvisional,
    ).toBe(false);
    const log = await json<ListResponse<SecurityEvent>>(
      await h.request('GET', '/admin/security?limit=20', {token: fabian}),
    );
    expect(
      log.items.find(e => e.kind === 'password_provisional_set'),
    ).toMatchObject({
      actor: {displayName: 'Fabián'},
      detail: null,
    });
  });

  it('a reset link: returned without mail, e-mailed with it; never for the guest account', async () => {
    const link = await json<ResetLinkResponse>(
      await h.request('POST', `/admin/users/${idOf('Equipo')}/reset-link`, {
        token: fabian,
        headers: {Origin: TEST_ORIGIN},
      }),
    );
    expect(link.url).toMatch(
      /^http:\/\/localhost:5173\/gestor-logistico\/cuenta\/restablecer#[A-Za-z0-9_-]{43}$/,
    );
    const linkUrl = new URL(link.url);
    expect(linkUrl.pathname).toBe('/gestor-logistico/cuenta/restablecer');
    expect(parseAccountLink(linkUrl.pathname + linkUrl.hash)).toEqual({
      purpose: 'reset',
      token: linkUrl.hash.slice(1),
    });
    expect(Date.parse(link.expiresAt) - h.clock.now().getTime()).toBe(
      30 * 60_000,
    );
    expect(
      (
        await h.request('POST', `/admin/users/${idOf('Invitado')}/reset-link`, {
          token: fabian,
          headers: {Origin: TEST_ORIGIN},
        })
      ).status,
    ).toBe(400);
    const transport = createMemoryTransport(true);
    const app = h.newApp({
      config: {
        ...testConfig,
        mail: {...NO_MAIL, recoveryFallback: 'buzon-proyecto@example.org'},
      },
      mail: transport,
    });
    const mailed = await app.request(
      `/api/admin/users/${idOf('Equipo')}/reset-link`,
      {
        method: 'POST',
        headers: {Authorization: `Bearer ${fabian}`, Origin: TEST_ORIGIN},
      },
    );
    expect(mailed.status).toBe(202);
    expect(await mailed.text()).toBe('');
    expect(transport.sent[0]?.to).toBe('buzon-proyecto@example.org');
  });
});

describe('support sessions', () => {
  let fabian: string;
  let equipoId: string;

  beforeAll(async () => {
    fabian = (await loginAs('Fabián', FABIAN_PW)).token;
    equipoId = (await loginAs('Equipo', 'equipo-nueva-2026')).user.id;
  });

  const start = (body: object, token = fabian) => {
    if ('password' in body) typed.add(String(body.password));
    return h.request('POST', '/admin/support-sessions', {
      token,
      body: {
        userId: equipoId,
        reason: 'Revisar una tarea que no se guarda',
        password: FABIAN_PW,
        minutes: 15,
        ...body,
      },
    });
  };

  it('needs the administrator’s password again, a reason and 5–30 minutes; never on oneself or the guest', async () => {
    expect(
      (await errorOf(await start({password: 'mala'}), 400)).fields,
    ).toEqual({
      password: 'Tu contraseña no es correcta.',
    });
    expect(
      (await errorOf(await start({reason: 'corto'}), 400)).fields?.reason,
    ).toBeTruthy();
    expect(
      (await errorOf(await start({minutes: 31}), 400)).fields?.minutes,
    ).toBeTruthy();
    const me = await json<MeResponse>(
      await h.request('GET', '/me', {token: fabian}),
    );
    expect((await start({userId: me.user.id})).status).toBe(400);
    const [guest] = await h.db.query<{id: string}>(
      "SELECT id FROM users WHERE username = 'Invitado'",
    );
    expect((await start({userId: guest!.id})).status).toBe(400);
    // An administrator with a provisional password cannot open one.
    const elvis = await loginAs('Elvis', elvisPassword);
    expect(elvis.user.passwordProvisional).toBe(true);
    const refused = await errorOf(
      await start({password: elvisPassword}, elvis.token),
      403,
    );
    expect(refused.message).toBe(PROVISIONAL_HOLD);
  });

  it('acts as the account with a banner, never reaches its settings, expires, and its owner sees and ends it', async () => {
    const res = await start({});
    expect(res.status).toBe(201);
    const support = await json<SupportSessionResponse>(res);
    expect(support.user).toMatchObject({
      id: equipoId,
      support: {
        kind: 'support',
        by: {displayName: 'Fabián'},
        reason: 'Revisar una tarea que no se guarda',
      },
    });
    expect(Date.parse(support.expiresAt) - h.clock.now().getTime()).toBe(
      15 * 60_000,
    );
    const t = support.token;
    const me = await json<MeResponse>(
      await h.request('GET', '/me', {token: t}),
    );
    expect(me.user.support?.kind).toBe('support');
    expect(me.organizations[0]?.permissions).toEqual([
      'plan.edit',
      'directory.read',
    ]);
    // The plan works…
    const task = await h.request('POST', '/tasks', {
      token: t,
      body: {organizationId: h.org.id, title: 'Tarea en soporte'},
    });
    expect(task.status).toBe(201);
    // …the account's own settings and administration never do.
    for (const [method, path] of [
      ['GET', '/me/profile'],
      ['POST', '/me/password'],
      ['POST', '/me/email'],
      ['GET', '/me/sessions'],
      ['GET', '/me/security'],
      ['GET', '/admin/users'],
    ] as const) {
      expect(
        (
          await h.request(method, path, {
            token: t,
            body: method === 'POST' ? {} : undefined,
          })
        ).status,
        path,
      ).toBe(403);
    }
    const photo = await h.request('POST', '/media', {
      token: t,
      body: {
        organizationId: h.org.id,
        ownerType: 'user',
        ownerId: equipoId,
        contentType: 'image/png',
        width: 10,
        height: 10,
        data: png(10, 10),
      },
    });
    expect(photo.status).toBe(403);

    // The owner sees it, with the reason and who.
    const owner = await loginAs('Equipo', 'equipo-nueva-2026');
    const history = await json<ListResponse<SecurityEvent>>(
      await h.request('GET', '/me/security', {token: owner.token}),
    );
    expect(history.items.find(e => e.kind === 'support_started')).toMatchObject(
      {
        actor: {displayName: 'Fabián'},
        detail: 'Revisar una tarea que no se guarda',
      },
    );
    const sessions = await json<ListResponse<SessionInfo>>(
      await h.request('GET', '/me/sessions', {token: owner.token}),
    );
    expect(sessions.items.find(s => s.kind === 'support')).toMatchObject({
      openedBy: {displayName: 'Fabián'},
    });
    // The owner ends it.
    expect(
      (
        await h.request(
          'DELETE',
          `/admin/support-sessions/${support.sessionId}`,
          {
            token: owner.token,
          },
        )
      ).status,
    ).toBe(204);
    expect((await h.request('GET', '/me', {token: t})).status).toBe(401);

    // Another one simply expires (no sliding).
    const second = await json<SupportSessionResponse>(
      await start({minutes: 5}),
    );
    h.clock.advance(4 * 60_000);
    expect((await h.request('GET', '/me', {token: second.token})).status).toBe(
      200,
    );
    h.clock.advance(2 * 60_000);
    expect((await h.request('GET', '/me', {token: second.token})).status).toBe(
      401,
    );
  });
});

describe('«Ver como Invitado»', () => {
  it('is the guest account itself for a short while: same withholding, read-only, logged on the administrator', async () => {
    const fabian = await loginAs('Fabián', FABIAN_PW);
    h.clock.advance(1000);
    const res = await h.request('POST', '/admin/view-as-guest', {
      token: fabian.token,
      body: {},
    });
    expect(res.status).toBe(201);
    const view = await json<SupportSessionResponse>(res);
    expect(view.user).toMatchObject({
      username: 'Invitado',
      role: 'guest',
      support: {
        kind: 'view_as_guest',
        by: {displayName: 'Fabián'},
        reason: null,
      },
    });
    expect(view.organizations[0]).toMatchObject({roles: [], permissions: []});
    const t = view.token;
    expect(
      (
        await h.request('GET', `/organizations/${h.org.id}/contacts`, {
          token: t,
        })
      ).status,
    ).toBe(403);
    const write = await errorOf(
      await h.request('POST', '/events', {
        token: t,
        body: {organizationId: h.org.id, name: 'No'},
      }),
      403,
    );
    expect(write.message).toMatch(/viendo el Gestor como Invitado/);
    const tasks = await json<ListResponse<Task>>(
      await h.request('GET', `/organizations/${h.org.id}/tasks`, {token: t}),
    );
    expect(tasks.items.every(x => x.restricted && x.contact === null)).toBe(
      true,
    );
    expect((await h.request('GET', '/admin/users', {token: t})).status).toBe(
      403,
    );
    const log = await json<ListResponse<SecurityEvent>>(
      await h.request('GET', '/me/security', {token: fabian.token}),
    );
    expect(log.items[0]?.kind).toBe('view_as_guest');
    // Logging out of the view ends it.
    expect((await h.request('POST', '/auth/logout', {token: t})).status).toBe(
      204,
    );
    expect((await h.request('GET', '/me', {token: t})).status).toBe(401);
    // The team account may not.
    const equipo = await loginAs('Equipo', 'equipo-nueva-2026');
    expect(
      (
        await h.request('POST', '/admin/view-as-guest', {
          token: equipo.token,
          body: {},
        })
      ).status,
    ).toBe(403);
  });
});

describe('profile photos', () => {
  it('only the owner sets theirs (one; a new one replaces it); the guest account sees none', async () => {
    const dailos = await loginAs('Dailos', 'dailos-nueva-2026');
    const upload = (token: string, ownerId: string) =>
      h.request('POST', '/media', {
        token,
        body: {
          organizationId: h.org.id,
          ownerType: 'user',
          ownerId,
          contentType: 'image/png',
          width: 400,
          height: 400,
          data: png(400, 400),
        },
      });
    const first = await json<MediaInfo>(
      await upload(dailos.token, dailos.user.id),
    );
    expect(first).toMatchObject({ownerType: 'user', main: true});
    const second = await json<MediaInfo>(
      await upload(dailos.token, dailos.user.id),
    );
    const rows = await h.db.query<{id: string}>(
      "SELECT id FROM media WHERE owner_type = 'user' AND owner_id = $1",
      [dailos.user.id],
    );
    expect(rows.map(r => r.id)).toEqual([second.id]);
    const me = await json<MeResponse>(
      await h.request('GET', '/me', {token: dailos.token}),
    );
    expect(me.user.avatarId).toBe(second.id);

    const yeray = await loginAs('Yeray', yerayPassword);
    expect((await upload(yeray.token, dailos.user.id)).status).toBe(403);
    expect(
      (await h.request('DELETE', `/media/${second.id}`, {token: yeray.token}))
        .status,
    ).toBe(403);
    expect(
      (await h.request('GET', `/media/${second.id}`, {token: yeray.token}))
        .status,
    ).toBe(200);
    // Not in the activity feed: a photo is not plan data.
    const feed = await h.db.query(
      "SELECT 1 FROM activity_log WHERE entity_type = 'user'",
    );
    expect(feed).toEqual([]);

    const guestToken = (await loginAs('Invitado', guestPassword)).token;
    expect(
      (await h.request('GET', `/media/${second.id}`, {token: guestToken}))
        .status,
    ).toBe(404);
    const members = await json<ListResponse<MemberProfile>>(
      await h.request('GET', `/organizations/${h.org.id}/members`, {
        token: guestToken,
      }),
    );
    expect(
      members.items.every(m => m.avatarId === null && m.bio === null),
    ).toBe(true);
    expect(
      (await h.request('DELETE', `/media/${second.id}`, {token: dailos.token}))
        .status,
    ).toBe(204);
  });
});

describe('members without plan.edit only read', () => {
  it('a membership without roles reads the plan but writes nothing (its account settings still work)', async () => {
    const yeray = await loginAs('Yeray', yerayPassword);
    await h.db.query(
      "UPDATE organization_members SET roles = '{}' WHERE user_id = $1",
      [yeray.user.id],
    );
    expect(
      (
        await h.request('GET', `/organizations/${h.org.id}/events`, {
          token: yeray.token,
        })
      ).status,
    ).toBe(200);
    const denied = await errorOf(
      await h.request('POST', '/events', {
        token: yeray.token,
        body: {organizationId: h.org.id, name: 'No'},
      }),
      403,
    );
    expect(denied.message).toBe(NO_ACCESS['plan.edit']);
    expect(
      (
        await h.request('GET', `/organizations/${h.org.id}/contacts`, {
          token: yeray.token,
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.request('POST', '/me/welcome', {token: yeray.token})).status,
    ).toBe(204);
    await h.db.query(
      "UPDATE organization_members SET roles = ARRAY['admin'] WHERE user_id = $1",
      [yeray.user.id],
    );
  });
});

describe('the security log never holds a secret', () => {
  it('no password, token, hash or e-mail address in any entry', async () => {
    const raw = JSON.stringify(
      await h.db.query('SELECT * FROM security_events'),
    );
    expect(raw.length).toBeGreaterThan(100);
    for (const secret of typed) expect(raw).not.toContain(secret);
    expect(raw).not.toMatch(/scrypt\$|@example|[A-Za-z0-9_-]{43}/);
    const kinds = new Set(
      (
        await h.db.query<{kind: string}>('SELECT kind FROM security_events')
      ).map(r => r.kind),
    );
    for (const k of [
      'login',
      'login_failed',
      'password_changed',
      'password_provisional_set',
      'recovery_requested',
      'password_reset',
      'email_requested',
      'email_verified',
      'email_removed',
      'sessions_revoked',
      'support_started',
      'support_ended',
      'view_as_guest',
      'roles_changed',
      'profile_changed',
      'reset_link_created',
    ]) {
      expect(kinds.has(k), k).toBe(true);
    }
  });
});
