import {expect, type Page, type Route} from '@playwright/test';
import {slotToInstants, utcToLocal} from '../../../shared/logistics/time.ts';

/**
 * Stateful in-memory mock of the Logistics Manager API for behavioural E2E
 * tests (milestones 1 and 2). It follows the route table and error bodies of
 * `shared/logistics/contracts.ts` and `server/src`, keeps events, tasks,
 * venues and companies so refetches after a write see the change, and
 * records every request so tests can assert what the UI actually sent.
 *
 * Milestone 2 rules mirrored from `server/src/tasks`: only the title is
 * required; venue and company are found or created by name
 * (case-insensitive); times need a date and `endDate` must be after `date`;
 * `dependsOn` rejects unknown ids, self references and cycles (400
 * VALIDATION `fields.dependsOn`); PATCH and DELETE check `version` (409
 * VERSION_CONFLICT with `current`); DELETE needs `?version=` and removes the
 * task from its dependents' `dependsOn`, bumping their version.
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

export interface LocalSlot {
  date?: string | null;
  /** Last day of a multi-day record. */
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
}

/** A contract-shaped event; local slot converted with the shared helper. */
export function makeEvent(
  id: string,
  name: string,
  slot: LocalSlot,
  extra: Json = {},
): Json {
  const date = slot.date ?? null;
  const endDate = slot.endDate ?? null;
  const {startsAt, endsAt} = slotToInstants(
    date,
    slot.start,
    slot.end,
    TZ,
    endDate,
  );
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    venue: null,
    date,
    endDate,
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

/** A contract-shaped task (milestone 2); same slot rules as events. */
export function makeTask(
  id: string,
  title: string,
  slot: LocalSlot = {},
  extra: Json = {},
): Json {
  const date = slot.date ?? null;
  const endDate = slot.endDate ?? null;
  const {startsAt, endsAt} = slotToInstants(
    date,
    slot.start,
    slot.end,
    TZ,
    endDate,
  );
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    eventId: null,
    venue: null,
    title,
    kind: 'other',
    status: 'planned',
    date,
    endDate,
    startsAt,
    endsAt,
    timezone: TZ,
    company: null,
    contact: null,
    dependsOn: [],
    heavyLoad: null,
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

/** A contract-shaped company (milestone 2 only lists them by name). */
export function makeCompany(id: string, name: string, extra: Json = {}): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    categoryIds: [],
    phone: null,
    email: null,
    website: null,
    notes: null,
    mainContactId: null,
    offerCount: 0,
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

export interface RecordedRequest {
  method: string;
  /** Path without the `/api` prefix and without the query string. */
  path: string;
  /** Query string including the leading `?`, or '' when there is none. */
  query: string;
  body: unknown;
  authorization: string | null;
}

export interface MockOptions {
  health?: 'ok' | 'down' | 'database';
  events?: Json[];
  tasks?: Json[];
  venues?: {id: string; name: string}[];
  companies?: Json[];
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
  tasks: Json[];
  venues: {id: string; name: string}[];
  companies: Json[];
  requests: RecordedRequest[];
  /** Requests matching a method and a path (string or pattern). */
  calls: (method: string, path: string | RegExp) => RecordedRequest[];
  /** Simulates another person saving an event: bumps its version. */
  editOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Simulates another person saving a task: bumps its version. */
  editTaskOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
}

const VENUES = [
  {id: 'v1', name: 'Plaza del Cristo'},
  {id: 'v2', name: 'Plaza del Adelantado'},
];

// Same texts as server/src/tasks (domain.ts, schemas.ts, service.ts).
const TASK_CONFLICT =
  'Otra persona ha cambiado esta tarea mientras la editabas. Revisa la versión actual antes de guardar tus cambios.';
const DEPENDS_ON_SELF = 'Una tarea no puede depender de sí misma.';
const DEPENDS_ON_UNKNOWN =
  'Alguna de las tareas previas ya no existe o no es de esta organización.';
const VERSION_MISSING =
  'Falta la versión del registro: recarga la tarea y vuelve a intentarlo.';

const nameKey = (s: string) => s.trim().toLocaleLowerCase('es-ES');
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Local date and times of a stored record, for partial slot updates. */
function storedSlot(record: Json) {
  const local = (iso: unknown) =>
    typeof iso === 'string' ? utcToLocal(iso, TZ).time : null;
  return {
    date: (record.date as string | null) ?? null,
    endDate: (record.endDate as string | null) ?? null,
    startTime: local(record.startsAt),
    endTime: local(record.endsAt),
  };
}

/** Slot rules of the contract; returns field errors (empty when valid). */
function slotProblems(slot: {
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if ((slot.startTime || slot.endTime) && !slot.date) {
    fields.date = 'Indica la fecha para poder guardar el horario.';
  }
  if (slot.endDate && !slot.date) {
    fields.endDate = 'Indica el primer día para poder guardar varios días.';
  } else if (slot.endDate && slot.date && slot.endDate <= slot.date) {
    fields.endDate = 'El último día tiene que ser posterior al primero.';
  }
  return fields;
}

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
    tasks: opts.tasks ?? [],
    venues: opts.venues ?? VENUES.map(v => ({...v})),
    companies: opts.companies ?? [],
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
    editTaskOnServer: (id, patch, by = dailos) => {
      const task = state.tasks.find(t => t.id === id);
      if (!task) throw new Error(`No task ${id}`);
      Object.assign(task, patch, {
        version: (task.version as number) + 1,
        updatedBy: by,
        updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      return task;
    },
  };

  const orgs = [{id: ORG, name: 'Ayuntamiento de La Laguna', timezone: TZ}];

  /** Find or create by name, case-insensitive, as the server does. */
  const venueRef = (name: unknown) => {
    const n = text(name);
    if (!n) return null;
    let venue = state.venues.find(v => nameKey(v.name) === nameKey(n));
    if (!venue) {
      venue = {id: `v-new-${++seq}`, name: n};
      state.venues.push(venue);
    }
    return {id: venue.id, name: venue.name};
  };
  const companyRef = (input: Json, current: unknown = null) => {
    if (typeof input.companyId === 'string') {
      const c = state.companies.find(x => x.id === input.companyId);
      return c ? {id: c.id, name: c.name} : current;
    }
    if (input.companyId === null && input.companyName === undefined) {
      return null;
    }
    if (input.companyName === undefined) return current;
    const n = text(input.companyName);
    if (!n) return null;
    let company = state.companies.find(
      c => nameKey(c.name as string) === nameKey(n),
    );
    if (!company) {
      company = makeCompany(`c-new-${++seq}`, n);
      state.companies.push(company);
    }
    return {id: company.id, name: company.name};
  };

  /** Path of predecessors from `from` back to `target`, if any. */
  const pathTo = (
    from: string,
    target: string,
    edges: Map<string, string[]>,
    seen = new Set<string>(),
  ): string[] | null => {
    if (from === target) return [from];
    if (seen.has(from)) return null;
    seen.add(from);
    for (const next of edges.get(from) ?? []) {
      const rest = pathTo(next, target, edges, seen);
      if (rest) return [from, ...rest];
    }
    return null;
  };
  /** Same checks and message as server/src/tasks/domain.ts. */
  const dependencyProblem = (
    taskId: string | null,
    dependsOn: string[],
  ): string | null => {
    if (taskId && dependsOn.includes(taskId)) return DEPENDS_ON_SELF;
    if (dependsOn.some(id => !state.tasks.some(t => t.id === id))) {
      return DEPENDS_ON_UNKNOWN;
    }
    if (!taskId) return null;
    const edges = new Map(
      state.tasks.map(t => [t.id as string, t.dependsOn as string[]]),
    );
    for (const dep of dependsOn) {
      const back = pathTo(dep, taskId, edges);
      if (back) {
        const title = (id: string) =>
          `«${state.tasks.find(t => t.id === id)?.title ?? id}»`;
        const cycle = [taskId, ...back].map(title).join(' → ');
        return `Esa dependencia crearía un ciclo: ${cycle}. Cada tarea esperaría a la siguiente y ninguna podría empezar.`;
      }
    }
    return null;
  };
  const validation = (route: Route, fields: Record<string, string>) =>
    json(
      route,
      {code: 'VALIDATION', message: 'Revisa los datos marcados.', fields},
      400,
    );
  const taskConflict = (route: Route, task: Json) =>
    json(
      route,
      {code: 'VERSION_CONFLICT', message: TASK_CONFLICT, current: task},
      409,
    );

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
      state.requests.push({
        method,
        path,
        query: url.search,
        body,
        authorization,
      });

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
          // Far ahead: specs that fix the browser clock must still restore
          // the stored session after a reload.
          expiresAt: '2099-01-01T00:00:00.000Z',
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
        return json(route, {items: state.venues});
      }
      if (path === `/organizations/${ORG}/activity`) {
        return json(route, {items: []});
      }
      if (path === `/organizations/${ORG}/demo` && method === 'DELETE') {
        const before = state.events.length + state.tasks.length;
        state.events = state.events.filter(e => !e.isDemo);
        state.tasks = state.tasks.filter(t => !t.isDemo);
        return json(route, {
          removed: before - state.events.length - state.tasks.length,
        });
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
          endDate,
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
            {date: date ?? null, endDate: date ? (endDate ?? null) : null},
            slotToInstants(
              date as string | null,
              startTime as string | null,
              endTime as string | null,
              TZ,
              date ? ((endDate as string | null) ?? null) : null,
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

      // ---- milestone 2: tasks and companies
      if (path === `/organizations/${ORG}/tasks` && method === 'GET') {
        const eventId = url.searchParams.get('eventId');
        return json(route, {
          items: eventId
            ? state.tasks.filter(t => t.eventId === eventId)
            : state.tasks,
        });
      }
      if (path === `/organizations/${ORG}/companies` && method === 'GET') {
        return json(route, {items: state.companies});
      }
      const ref = {id: user.id, displayName: user.displayName};
      if (path === '/tasks' && method === 'POST') {
        const input = (body ?? {}) as Json;
        const slot = {
          date: (input.date as string | null) ?? null,
          endDate: (input.endDate as string | null) ?? null,
          startTime: (input.startTime as string | null) ?? null,
          endTime: (input.endTime as string | null) ?? null,
        };
        const fields = slotProblems(slot);
        if (!text(input.title)) fields.title = 'El título es obligatorio.';
        const dependsOn = (input.dependsOn as string[] | undefined) ?? [];
        const depProblem = dependencyProblem(null, dependsOn);
        if (depProblem) fields.dependsOn = depProblem;
        if (Object.keys(fields).length) return validation(route, fields);
        const now = new Date().toISOString();
        const created = makeTask(
          `t-new-${++seq}`,
          text(input.title)!,
          {
            date: slot.date,
            endDate: slot.endDate,
            start: slot.startTime,
            end: slot.endTime,
          },
          {
            eventId: (input.eventId as string | null) ?? null,
            venue: venueRef(input.venueName),
            company: companyRef(input),
            kind: input.kind ?? 'other',
            status: input.status ?? 'planned',
            dependsOn,
            heavyLoad: input.heavyLoad ?? null,
            notes: text(input.notes),
            source: input.source ?? null,
            verification: input.verification ?? 'draft',
            createdBy: ref,
            updatedBy: ref,
            createdAt: now,
            updatedAt: now,
          },
        );
        state.tasks.push(created);
        return json(route, created, 201);
      }
      const taskMatch = /^\/tasks\/([^/]+)$/.exec(path);
      const task = taskMatch
        ? state.tasks.find(t => t.id === taskMatch[1])
        : undefined;
      if (taskMatch && !task && (method === 'PATCH' || method === 'DELETE')) {
        return error(route, 404, 'NOT_FOUND', 'No encontrado');
      }
      if (task && method === 'PATCH') {
        const input = (body ?? {}) as Json;
        if (typeof input.version !== 'number') {
          return validation(route, {version: VERSION_MISSING});
        }
        if (input.version !== task.version) return taskConflict(route, task);
        const fields: Record<string, string> = {};
        if ('title' in input && !text(input.title)) {
          fields.title = 'El título es obligatorio.';
        }
        const slotKeys = ['date', 'endDate', 'startTime', 'endTime'];
        const touchesSlot = slotKeys.some(k => k in input);
        const slot = {...storedSlot(task)};
        for (const k of slotKeys) {
          if (k in input) {
            (slot as Record<string, string | null>)[k] =
              (input[k] as string | null) ?? null;
          }
        }
        if (touchesSlot) Object.assign(fields, slotProblems(slot));
        if (Array.isArray(input.dependsOn)) {
          const problem = dependencyProblem(
            task.id as string,
            input.dependsOn as string[],
          );
          if (problem) fields.dependsOn = problem;
        }
        if (Object.keys(fields).length) return validation(route, fields);

        for (const k of [
          'title',
          'kind',
          'status',
          'eventId',
          'heavyLoad',
          'source',
          'verification',
          'dependsOn',
        ]) {
          if (k in input) task[k] = k === 'title' ? text(input[k]) : input[k];
        }
        if ('notes' in input) task.notes = text(input.notes);
        if ('venueName' in input) task.venue = venueRef(input.venueName);
        if ('companyName' in input || 'companyId' in input) {
          task.company = companyRef(input, task.company);
        }
        if (touchesSlot) {
          Object.assign(
            task,
            {date: slot.date, endDate: slot.endDate},
            slotToInstants(
              slot.date,
              slot.startTime,
              slot.endTime,
              TZ,
              slot.endDate,
            ),
          );
        }
        Object.assign(task, {
          version: (task.version as number) + 1,
          updatedBy: ref,
          updatedAt: new Date().toISOString(),
        });
        return json(route, task);
      }
      if (task && method === 'DELETE') {
        const raw = url.searchParams.get('version');
        if (raw === null || raw.trim() === '') {
          return validation(route, {version: VERSION_MISSING});
        }
        if (Number(raw) !== task.version) return taskConflict(route, task);
        state.tasks = state.tasks.filter(t => t !== task);
        for (const t of state.tasks) {
          const deps = t.dependsOn as string[];
          if (!deps.includes(task.id as string)) continue;
          Object.assign(t, {
            dependsOn: deps.filter(d => d !== task.id),
            version: (t.version as number) + 1,
            updatedBy: ref,
            updatedAt: new Date().toISOString(),
          });
        }
        return route.fulfill({status: 204, body: ''});
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
