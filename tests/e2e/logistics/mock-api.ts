import {expect, type Page, type Route} from '@playwright/test';
import {slotToInstants} from '../../../shared/logistics/time.ts';

/**
 * Stateful in-memory mock of the Logistics Manager API for behavioural E2E
 * tests (milestone 1). It follows the route table and error bodies of
 * `shared/logistics/contracts.ts` and `server/src`, keeps the event list so
 * refetches after a write see the change, and records every request so tests
 * can assert what the UI actually sent.
 *
 * Only `/api/*` is intercepted: Vite module URLs such as
 * `/src/logistics/api/client.ts` must reach the dev server.
 */

export const ORG = '00000000-0000-4000-8000-000000000001';
export const SESSION_KEY = 'oxeye.logistics.session.v1';
export const TZ = 'Atlantic/Canary';
export const PASSWORD = 'secreto';
export const TOKEN = 'test-token';

/** Today in the organization's time zone, as the app computes it. */
export const today = new Intl.DateTimeFormat('en-CA', {timeZone: TZ}).format(
  new Date(),
);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const elvis = {id: 'u-elvis', displayName: 'Elvis'};
export const dailos = {id: 'u-dailos', displayName: 'Dailos'};

export const LOGIN_USERS = [
  {displayName: 'Elvis', role: 'member'},
  {displayName: 'Dailos', role: 'member'},
  {displayName: 'Yeray', role: 'member'},
  {displayName: 'Equipo', role: 'member'},
  {displayName: 'Invitado', role: 'guest'},
] as const;

type Json = Record<string, unknown>;

/** A contract-shaped event; local slot converted with the shared helper. */
export function makeEvent(
  id: string,
  name: string,
  slot: {date?: string | null; start?: string | null; end?: string | null},
  extra: Json = {},
): Json {
  const date = slot.date ?? null;
  const {startsAt, endsAt} = slotToInstants(date, slot.start, slot.end, TZ);
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    venue: null,
    date,
    startsAt,
    endsAt,
    timezone: TZ,
    status: 'planned',
    notes: null,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
}

export function defaultEvents(): Json[] {
  return [
    makeEvent(
      'e1',
      'Navidad en la Plaza del Cristo',
      {date: today, start: '17:00', end: '21:00'},
      {
        venue: {id: 'v1', name: 'Plaza del Cristo'},
        status: 'confirmed',
        verification: 'validated',
        source: 'document',
      },
    ),
    makeEvent(
      'e2',
      'Concierto de villancicos',
      {date: today, start: '19:30', end: '22:00'},
      {
        venue: {id: 'v2', name: 'Plaza del Adelantado'},
        verification: 'to_verify',
        source: 'reported',
      },
    ),
    makeEvent('e3', 'Mercadillo navideño', {
      date: addDays(today, 1),
      start: '10:00',
    }),
  ];
}

export const demoEvent = (): Json =>
  makeEvent('e-demo', 'Cabalgata de demostración', {}, {isDemo: true});

export interface RecordedRequest {
  method: string;
  /** Path without the `/api` prefix and without the query string. */
  path: string;
  body: unknown;
  authorization: string | null;
}

export interface MockOptions {
  health?: 'ok' | 'down' | 'database';
  events?: Json[];
}

export interface MockApi {
  /** Mutable: flip it during a test to simulate the server changing. */
  health: 'ok' | 'down' | 'database';
  /** When true every authenticated call answers 401 UNAUTHENTICATED. */
  sessionExpired: boolean;
  /** When true writes (POST/PATCH/DELETE) fail at network level. */
  writesOffline: boolean;
  /** Server-side records; tests may edit them to simulate another user. */
  events: Json[];
  requests: RecordedRequest[];
  /** Requests matching a method and a path (string or pattern). */
  calls: (method: string, path: string | RegExp) => RecordedRequest[];
  /** Simulates another person saving an event: bumps its version. */
  editOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
}

const VENUES = [
  {id: 'v1', name: 'Plaza del Cristo'},
  {id: 'v2', name: 'Plaza del Adelantado'},
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const error = (route: Route, status: number, code: string, message: string) =>
  json(route, {code, message}, status);

export async function mockApi(
  page: Page,
  opts: MockOptions = {},
): Promise<MockApi> {
  let currentUser: {id: string; displayName: string; role: string} | null =
    null;
  let seq = 0;

  const state: MockApi = {
    health: opts.health ?? 'ok',
    sessionExpired: false,
    writesOffline: false,
    events: opts.events ?? defaultEvents(),
    requests: [],
    calls: (method, path) =>
      state.requests.filter(
        r =>
          r.method === method &&
          (typeof path === 'string' ? r.path === path : path.test(r.path)),
      ),
    editOnServer: (id, patch, by = dailos) => {
      const event = state.events.find(e => e.id === id);
      if (!event) throw new Error(`No event ${id}`);
      Object.assign(event, patch, {
        version: (event.version as number) + 1,
        updatedBy: by,
        updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      return event;
    },
  };

  const orgs = [{id: ORG, name: 'Ayuntamiento de La Laguna', timezone: TZ}];

  await page.route(
    u => u.pathname.startsWith('/api/'),
    async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api/, '');
      const method = request.method();
      const authorization = request.headers()['authorization'] ?? null;
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      state.requests.push({method, path, body, authorization});

      // ---- public routes
      if (path === '/health') {
        if (state.health === 'down') return route.abort('connectionrefused');
        return json(route, {
          status: state.health === 'ok' ? 'ok' : 'degraded',
          database: state.health === 'ok' ? 'ok' : 'error',
          version: 'test',
        });
      }
      if (path === '/auth/users') return json(route, {items: LOGIN_USERS});
      if (path === '/auth/login' && method === 'POST') {
        const {displayName, password} = (body ?? {}) as Json;
        const option = LOGIN_USERS.find(u => u.displayName === displayName);
        if (!option || password !== PASSWORD) {
          // Same body as server/src/auth/service.ts (BAD_CREDENTIALS).
          return error(
            route,
            401,
            'UNAUTHENTICATED',
            'Usuario o contraseña incorrectos.',
          );
        }
        currentUser = {
          id: `u-${option.displayName.toLowerCase()}`,
          displayName: option.displayName,
          role: option.role,
        };
        state.sessionExpired = false;
        return json(route, {
          token: TOKEN,
          expiresAt: new Date(Date.now() + 86400_000).toISOString(),
          user: currentUser,
          organizations: orgs,
        });
      }

      // ---- authenticated routes
      if (state.writesOffline && method !== 'GET') {
        return route.abort('internetdisconnected');
      }
      if (authorization !== `Bearer ${TOKEN}` || state.sessionExpired) {
        // Same message as server/src/auth/middleware.ts.
        return error(
          route,
          401,
          'UNAUTHENTICATED',
          'Tu sesión ha caducado o se ha cerrado. Vuelve a iniciar sesión.',
        );
      }
      const user = currentUser ?? {
        id: 'u-elvis',
        displayName: 'Elvis',
        role: 'member',
      };
      const isWrite = method !== 'GET';
      if (isWrite && user.role === 'guest' && path !== '/auth/logout') {
        return error(route, 403, 'FORBIDDEN', 'Solo lectura.');
      }

      if (path === '/auth/logout' && method === 'POST') {
        return route.fulfill({status: 204, body: ''});
      }
      if (path === '/me') return json(route, {user, organizations: orgs});
      if (path === `/organizations/${ORG}/events` && method === 'GET') {
        return json(route, {items: state.events});
      }
      if (path === `/organizations/${ORG}/venues`) {
        return json(route, {items: VENUES});
      }
      if (path === `/organizations/${ORG}/activity`) {
        return json(route, {items: []});
      }
      if (path === `/organizations/${ORG}/demo` && method === 'DELETE') {
        const before = state.events.length;
        state.events = state.events.filter(e => !e.isDemo);
        return json(route, {removed: before - state.events.length});
      }
      if (path === '/events' && method === 'POST') {
        const input = (body ?? {}) as Json;
        if (typeof input.name !== 'string' || !input.name.trim()) {
          return json(
            route,
            {
              code: 'VALIDATION',
              message: 'Revisa los datos marcados.',
              fields: {name: 'El nombre es obligatorio.'},
            },
            400,
          );
        }
        const ref = {id: user.id, displayName: user.displayName};
        const created = makeEvent(
          `new-${++seq}`,
          input.name.trim(),
          {
            date: (input.date as string | null) ?? null,
            start: (input.startTime as string | null) ?? null,
            end: (input.endTime as string | null) ?? null,
          },
          {
            venue: input.venueName
              ? {id: `v-new-${seq}`, name: input.venueName}
              : null,
            status: input.status ?? 'planned',
            notes: input.notes ?? null,
            source: input.source ?? null,
            verification: input.verification ?? 'draft',
            createdBy: ref,
            updatedBy: ref,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        );
        state.events.push(created);
        return json(route, created, 201);
      }
      const patchMatch = /^\/events\/([^/]+)$/.exec(path);
      if (patchMatch && method === 'PATCH') {
        const event = state.events.find(e => e.id === patchMatch[1]);
        if (!event) return error(route, 404, 'NOT_FOUND', 'No encontrado');
        const input = (body ?? {}) as Json;
        if (input.version !== event.version) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message: 'Otra persona ha cambiado este evento.',
              current: event,
            },
            409,
          );
        }
        const {
          version: _v,
          venueName,
          date,
          startTime,
          endTime,
          ...changes
        } = input;
        void _v;
        if (venueName !== undefined) {
          event.venue = venueName ? {id: 'v-edit', name: venueName} : null;
        }
        if (date !== undefined) {
          Object.assign(
            event,
            {date: date ?? null},
            slotToInstants(
              date as string | null,
              startTime as string | null,
              endTime as string | null,
              TZ,
            ),
          );
        }
        Object.assign(event, changes, {
          version: (event.version as number) + 1,
          updatedBy: {id: user.id, displayName: user.displayName},
          updatedAt: new Date().toISOString(),
        });
        return json(route, event);
      }
      return error(route, 404, 'NOT_FOUND', 'No encontrado');
    },
  );

  return state;
}

/** Opens the module by deep link and signs in through the real login UI. */
export async function signIn(page: Page, name = 'Elvis', hash = '#logistica') {
  await page.goto(`/${hash}`);
  await page.locator(`.lx-person[data-name="${name}"]`).click();
  await page.locator('#lx-login-password').fill(PASSWORD);
  await page.locator('#lx-login-submit').click();
  await expect(page.locator('#lx-title')).toBeVisible();
}

/** From the people list (e.g. after a session expired), signs in again. */
export async function signInAgain(page: Page, name = 'Elvis') {
  await page.locator(`.lx-person[data-name="${name}"]`).click();
  await page.locator('#lx-login-password').fill(PASSWORD);
  await page.locator('#lx-login-submit').click();
  await expect(page.locator('#lx-title')).toBeVisible();
}

export const RESCUE_KEY = 'oxeye.logistics.rescue.v1';

export const storedRescue = (page: Page) =>
  page.evaluate(key => sessionStorage.getItem(key), RESCUE_KEY);

export const storedSession = (page: Page) =>
  page.evaluate(key => localStorage.getItem(key), SESSION_KEY);
