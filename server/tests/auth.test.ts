import {beforeAll, describe, expect, it} from 'vitest';
import {LOGIN_MAX_PER_IP, LOGIN_MAX_PER_NAME} from '../src/app.ts';
import {createRateLimiter} from '../src/auth/rate-limit.ts';
import {login} from '../src/auth/service.ts';
import {hashToken} from '../src/auth/sessions.ts';
import type {Db} from '../src/db/db.ts';
import {createHarness, json, passwordFor} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ApiErrorBody,
  ListResponse,
  LoginResponse,
  LoginUserOption,
  MeResponse,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});

describe('auth', () => {
  it('lists the five pilot users in seed order, without the system author', async () => {
    const res = await h.request('GET', '/auth/users');
    expect(res.status).toBe(200);
    const body = await json<ListResponse<LoginUserOption>>(res);
    expect(body.items).toEqual([
      {displayName: 'Elvis', role: 'member'},
      {displayName: 'Dailos', role: 'member'},
      {displayName: 'Yeray', role: 'member'},
      {displayName: 'Equipo', role: 'member'},
      {displayName: 'Invitado', role: 'guest'},
    ]);
  });

  it('logs in with the right password and returns a session', async () => {
    const res = await h.request('POST', '/auth/login', {
      body: {displayName: 'elvis', password: passwordFor('Elvis')},
    });
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user).toMatchObject({displayName: 'Elvis', role: 'member'});
    expect(body.organizations).toEqual([h.org]);
    expect(body.expiresAt).toBe('2026-12-26T10:00:00.000Z');

    // Only the hash is stored.
    const rows = await h.db.query<{token_hash: string}>(
      'SELECT token_hash FROM sessions',
    );
    expect(rows.map(r => r.token_hash)).toContain(hashToken(body.token));
    expect(rows.map(r => r.token_hash)).not.toContain(body.token);
  });

  it('rejects a wrong password and an unknown user with the same message', async () => {
    const wrong = await h.request('POST', '/auth/login', {
      body: {displayName: 'Yeray', password: 'nope'},
      headers: {'x-test-ip': '10.1.1.1'},
    });
    const unknown = await h.request('POST', '/auth/login', {
      body: {displayName: 'Nadie', password: 'nope'},
      headers: {'x-test-ip': '10.1.1.1'},
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = await json<ApiErrorBody>(wrong);
    const b = await json<ApiErrorBody>(unknown);
    expect(a).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Usuario o contraseña incorrectos.',
    });
    expect(b).toEqual(a);
  });

  it('cannot log in as the system author', async () => {
    const res = await h.request('POST', '/auth/login', {
      body: {displayName: 'Sistema', password: 'anything'},
      headers: {'x-test-ip': '10.1.1.2'},
    });
    expect(res.status).toBe(401);
  });

  it('validates the login body with field messages', async () => {
    const res = await h.request('POST', '/auth/login', {
      body: {displayName: ''},
    });
    expect(res.status).toBe(400);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('VALIDATION');
    expect(body.fields).toMatchObject({
      displayName: 'Elige tu usuario.',
      password: 'Este campo es obligatorio.',
    });
    const notJson = await h.request('POST', '/auth/login', {body: '{oops'});
    expect(notJson.status).toBe(400);
    expect((await json<ApiErrorBody>(notJson)).code).toBe('VALIDATION');
  });

  it('rate-limits repeated failures per display name with 429 and Retry-After', async () => {
    const app = h.newApp();
    const attempt = (password: string, ip: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-test-ip': ip},
        body: JSON.stringify({displayName: 'Equipo', password}),
      });
    for (let i = 0; i < LOGIN_MAX_PER_NAME; i++) {
      // Different IPs: the per-name limit applies on its own.
      expect((await attempt('bad', `10.2.0.${i}`)).status).toBe(401);
    }
    const blocked = await attempt(passwordFor('Equipo'), '10.2.0.99');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('600');
    const body = await json<ApiErrorBody>(blocked);
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.message).toMatch(/Espera 10 minutos/);

    // Other users are not affected.
    const other = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-test-ip': '10.2.0.99'},
      body: JSON.stringify({
        displayName: 'Yeray',
        password: passwordFor('Yeray'),
      }),
    });
    expect(other.status).toBe(200);

    // After the window the right password works again.
    h.clock.advance(10 * 60_000 + 1);
    expect((await attempt(passwordFor('Equipo'), '10.2.0.99')).status).toBe(
      200,
    );
  });

  it('rate-limits repeated failures from one IP across names', async () => {
    const app = h.newApp();
    const attempt = (displayName: string, password: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-test-ip': '10.3.0.1'},
        body: JSON.stringify({displayName, password}),
      });
    for (let i = 0; i < LOGIN_MAX_PER_IP; i++) {
      expect((await attempt(`Usuario${i}`, 'bad')).status).toBe(401);
    }
    expect((await attempt('Elvis', passwordFor('Elvis'))).status).toBe(429);
  });

  it('counts parallel wrong-password attempts before verifying them', async () => {
    const app = h.newApp();
    const attempt = (i: number) =>
      app.request('/api/auth/login', {
        method: 'POST',
        // Different IPs: only the per-name limit can stop them.
        headers: {
          'Content-Type': 'application/json',
          'x-test-ip': `10.4.0.${i}`,
        },
        body: JSON.stringify({displayName: 'Dailos', password: 'bad'}),
      });
    const statuses = (
      await Promise.all(Array.from({length: 8}, (_, i) => attempt(i)))
    ).map(r => r.status);
    // 401 means the password was verified; the rest never reached scrypt.
    expect(statuses.filter(s => s === 401)).toHaveLength(LOGIN_MAX_PER_NAME);
    expect(statuses.filter(s => s === 429)).toHaveLength(
      8 - LOGIN_MAX_PER_NAME,
    );
  });

  it('counts parallel attempts from one IP before verifying them', async () => {
    const app = h.newApp();
    const total = LOGIN_MAX_PER_IP + 5;
    const statuses = (
      await Promise.all(
        Array.from({length: total}, (_, i) =>
          app.request('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-test-ip': '10.5.0.1',
            },
            body: JSON.stringify({displayName: `Usuario${i}`, password: 'bad'}),
          }),
        ),
      )
    ).map(r => r.status);
    expect(statuses.filter(s => s === 401)).toHaveLength(LOGIN_MAX_PER_IP);
    expect(statuses.filter(s => s === 429)).toHaveLength(5);
  });

  it('a correct login after a failure works and clears the name count', async () => {
    const app = h.newApp();
    const attempt = (password: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-test-ip': '10.6.0.1'},
        body: JSON.stringify({displayName: 'Elvis', password}),
      });
    expect((await attempt('bad')).status).toBe(401);
    expect((await attempt(passwordFor('Elvis'))).status).toBe(200);
    // The earlier failure was forgotten: a full set of failures is allowed again.
    for (let i = 0; i < LOGIN_MAX_PER_NAME; i++) {
      expect((await attempt('bad')).status).toBe(401);
    }
    expect((await attempt('bad')).status).toBe(429);
  });

  it('successful logins do not count against the IP limit', async () => {
    const app = h.newApp();
    for (let i = 0; i < LOGIN_MAX_PER_IP + 1; i++) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-test-ip': '10.7.0.1'},
        body: JSON.stringify({
          displayName: 'Yeray',
          password: passwordFor('Yeray'),
        }),
      });
      expect(res.status).toBe(200);
    }
  });

  it('a database fault during login is not counted as a failed attempt', async () => {
    const limits = {
      byName: createRateLimiter({max: 1, windowMs: 60_000, now: () => 0}),
      byIp: createRateLimiter({max: 1, windowMs: 60_000, now: () => 0}),
    };
    const broken = {
      query: () => Promise.reject(new Error('connection lost')),
    } as unknown as Db;
    const input = {displayName: 'Elvis', password: 'x', ip: '10.8.0.1'};
    const options = {now: h.clock.now(), sessionDays: 30, limits};
    await expect(login(broken, input, options)).rejects.toThrow(
      'connection lost',
    );
    await expect(login(broken, input, options)).rejects.toThrow(
      'connection lost',
    );
    expect(limits.byName.retryAfter('name:elvis')).toBe(0);
    expect(limits.byIp.retryAfter('ip:10.8.0.1')).toBe(0);
  });

  it('requires a valid bearer token on protected routes', async () => {
    const none = await h.request('GET', '/me');
    expect(none.status).toBe(401);
    expect((await json<ApiErrorBody>(none)).code).toBe('UNAUTHENTICATED');

    const bogus = await h.request('GET', '/me', {token: 'x'.repeat(43)});
    expect(bogus.status).toBe(401);

    const malformed = await h.request('GET', '/me', {
      headers: {Authorization: 'Basic abc'},
    });
    expect(malformed.status).toBe(401);

    const {token} = await h.login('Dailos');
    const ok = await h.request('GET', '/me', {token});
    expect(ok.status).toBe(200);
    const me = await json<MeResponse>(ok);
    expect(me.user.displayName).toBe('Dailos');
    expect(me.organizations).toEqual([h.org]);
  });

  it('expires sessions after the sliding window and extends them on use', async () => {
    const {token} = await h.login('Yeray');
    h.clock.advance(29 * 86_400_000);
    expect((await h.request('GET', '/me', {token})).status).toBe(200);
    // Used on day 29: valid until day 59.
    h.clock.advance(29 * 86_400_000);
    expect((await h.request('GET', '/me', {token})).status).toBe(200);
    h.clock.advance(31 * 86_400_000);
    const expired = await h.request('GET', '/me', {token});
    expect(expired.status).toBe(401);
  });

  it('logout ends the session', async () => {
    const {token} = await h.login('Elvis');
    const out = await h.request('POST', '/auth/logout', {token});
    expect(out.status).toBe(204);
    expect((await h.request('GET', '/me', {token})).status).toBe(401);
  });

  it('guest is read-only: 403 on every write, reads allowed, can log out', async () => {
    const {token} = await h.login('Invitado');
    expect(
      (await h.request('GET', `/organizations/${h.org.id}/events`, {token}))
        .status,
    ).toBe(200);

    const create = await h.request('POST', '/events', {
      token,
      body: {organizationId: h.org.id, name: 'No debería existir'},
    });
    expect(create.status).toBe(403);
    expect((await json<ApiErrorBody>(create)).code).toBe('FORBIDDEN');

    const patch = await h.request('PATCH', `/events/${crypto.randomUUID()}`, {
      token,
      body: {version: 1, name: 'x'},
    });
    expect(patch.status).toBe(403);

    const demo = await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
      token,
    });
    expect(demo.status).toBe(403);

    const rows = await h.db.query(
      "SELECT 1 FROM events WHERE name = 'No debería existir'",
    );
    expect(rows).toEqual([]);

    expect((await h.request('POST', '/auth/logout', {token})).status).toBe(204);
  });

  it('hides organizations the user does not belong to', async () => {
    const {token} = await h.login('Elvis');
    const other = await h.db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Otra organización') RETURNING id",
    );
    const res = await h.request(
      'GET',
      `/organizations/${other[0]!.id}/events`,
      {token},
    );
    expect(res.status).toBe(404);
    const bad = await h.request('GET', '/organizations/not-a-uuid/events', {
      token,
    });
    expect(bad.status).toBe(404);
  });
});
