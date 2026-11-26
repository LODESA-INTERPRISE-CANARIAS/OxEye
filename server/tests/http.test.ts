import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createApp} from '../src/app.ts';
import type {Db} from '../src/db/db.ts';
import {createHarness, json, TEST_ORIGIN, testConfig} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ApiErrorBody,
  HealthResponse,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.db.close();
});

describe('health', () => {
  it('reports ok when the database answers', async () => {
    const res = await h.request('GET', '/health');
    expect(res.status).toBe(200);
    const body = await json<HealthResponse>(res);
    expect(body).toEqual({status: 'ok', database: 'ok', version: '0.1.0'});
  });

  it('reports degraded with 503 when the database fails', async () => {
    const broken: Db = {
      query: () => Promise.reject(new Error('down')),
      exec: () => Promise.reject(new Error('down')),
      transaction: () => Promise.reject(new Error('down')),
      close: () => Promise.resolve(),
    };
    const app = createApp({db: broken, config: testConfig});
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    expect(await json<HealthResponse>(res)).toMatchObject({
      status: 'degraded',
      database: 'error',
    });
  });

  it('hides internal errors behind a generic Spanish message and logs no secrets', async () => {
    const lines: string[] = [];
    const broken: Db = {
      query: () => Promise.reject(new Error('connection lost')),
      exec: () => Promise.reject(new Error('down')),
      transaction: () => Promise.reject(new Error('down')),
      close: () => Promise.resolve(),
    };
    const app = createApp({
      db: broken,
      config: testConfig,
      log: l => lines.push(l),
    });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({displayName: 'Elvis', password: 'secreto-123'}),
    });
    expect(res.status).toBe(500);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toMatch(/Inténtalo de nuevo/);
    expect(lines.join('\n')).not.toContain('secreto-123');
  });
});

describe('http', () => {
  it('unknown routes answer 404 with the error body', async () => {
    const res = await h.request('GET', '/nothing-here');
    expect(res.status).toBe(404);
    expect((await json<ApiErrorBody>(res)).code).toBe('NOT_FOUND');
  });

  it('API responses are not cached', async () => {
    const res = await h.request('GET', '/health');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects oversized bodies', async () => {
    const {token} = await h.login('Elvis');
    const res = await h.request('POST', '/events', {
      token,
      body: {organizationId: h.org.id, name: 'x', notes: 'a'.repeat(200_000)},
    });
    expect(res.status).toBe(400);
    expect((await json<ApiErrorBody>(res)).message).toMatch(/demasiado grande/);
  });
});

describe('CORS', () => {
  it('allows the configured origin, including preflight', async () => {
    const res = await h.request('GET', '/health', {
      headers: {Origin: TEST_ORIGIN},
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN);

    const pre = await h.request('OPTIONS', '/events', {
      headers: {
        Origin: TEST_ORIGIN,
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    expect(
      pre.headers.get('Access-Control-Allow-Headers')?.toLowerCase(),
    ).toContain('authorization');
  });

  it('keeps CORS headers on error responses', async () => {
    const res = await h.request('GET', '/me', {headers: {Origin: TEST_ORIGIN}});
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN);
  });

  it('gives unknown origins no CORS headers', async () => {
    const res = await h.request('GET', '/health', {
      headers: {Origin: 'https://evil.example'},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const pre = await h.request('OPTIONS', '/events', {
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('route surface', () => {
  // The API serves logistics data only. A new route must be added here on
  // purpose, so nothing from the simulation slips out unnoticed.
  it('exposes exactly the documented logistics routes', () => {
    const app = createApp({db: h.db, config: testConfig});
    const routes = [
      ...new Set(
        app.routes
          .filter(r => r.method !== 'ALL')
          .map(r => `${r.method} ${r.path}`),
      ),
    ].sort();
    expect(routes).toEqual(
      [
        'DELETE /api/organizations/:orgId/demo',
        'DELETE /api/tasks/:id',
        'GET /api/auth/users',
        'GET /api/health',
        'GET /api/me',
        'GET /api/organizations/:orgId/activity',
        'GET /api/organizations/:orgId/companies',
        'GET /api/organizations/:orgId/events',
        'GET /api/organizations/:orgId/tasks',
        'GET /api/organizations/:orgId/venues',
        'PATCH /api/events/:id',
        'PATCH /api/tasks/:id',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/events',
        'POST /api/tasks',
        // Milestone 3: contacts and catalogue.
        'GET /api/organizations/:orgId/categories',
        'POST /api/categories',
        'DELETE /api/categories/:id',
        'POST /api/companies',
        'PATCH /api/companies/:id',
        'DELETE /api/companies/:id',
        'GET /api/organizations/:orgId/contacts',
        'POST /api/contacts',
        'PATCH /api/contacts/:id',
        'DELETE /api/contacts/:id',
        'GET /api/organizations/:orgId/offers',
        'POST /api/offers',
        'PATCH /api/offers/:id',
        'DELETE /api/offers/:id',
        'GET /api/organizations/:orgId/recent-searches',
        'POST /api/organizations/:orgId/recent-searches',
        'DELETE /api/organizations/:orgId/recent-searches',
        // Milestone 4: inventories and notes (the history is the activity
        // route with entityType and entityId).
        'GET /api/organizations/:orgId/warehouses',
        'POST /api/warehouses',
        'PATCH /api/warehouses/:id',
        'DELETE /api/warehouses/:id',
        'GET /api/organizations/:orgId/resources',
        'POST /api/resources',
        'PATCH /api/resources/:id',
        'DELETE /api/resources/:id',
        'GET /api/organizations/:orgId/notes',
        'POST /api/notes',
        'PATCH /api/notes/:id',
        'DELETE /api/notes/:id',
        // Milestone 5: delay hypotheses (work orders have no route).
        'GET /api/organizations/:orgId/hypotheses',
        'POST /api/hypotheses',
        'DELETE /api/hypotheses/:id',
        'POST /api/hypotheses/:id/apply',
      ].sort(),
    );
  });
});
