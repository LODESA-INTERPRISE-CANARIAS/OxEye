import {expect, type Page, type Route} from '@playwright/test';
import {slotToInstants, utcToLocal} from '../../../shared/logistics/time.ts';

/**
 * Stateful in-memory mock of the Logistics Manager API for behavioural E2E
 * tests (milestones 1 to 3). It follows the route table and error bodies of
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

/** A contract-shaped company (milestone 3 shape; M2 only lists them by name). */
export function makeCompany(id: string, name: string, extra: Json = {}): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    kind: 'supplier',
    contactCount: 0,
    restricted: false,
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

/** Stable id of a built-in category: `cat-` + name without accents. */
export const categoryId = (name: string) =>
  `cat-${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;

/** The built-in service categories, as the server seeds them. */
export const BUILT_IN_CATEGORIES = [
  'Montaje',
  'Estructuras',
  'Carpas',
  'Vallas',
  'Transporte',
  'Catering',
  'Publicidad',
  'Personal',
  'Seguridad',
  'Sonido',
  'Iluminación',
  'Audiovisuales',
  'Limpieza',
  'Ocio',
  'Otros servicios',
];

export function makeCategories(): Json[] {
  return BUILT_IN_CATEGORIES.map(name => ({
    id: categoryId(name),
    organizationId: ORG,
    scope: 'service',
    name,
    builtIn: true,
  }));
}

/** A contract-shaped person (milestone 3). Fictitious data only. */
export function makeContact(id: string, name: string, extra: Json = {}): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    role: null,
    company: null,
    phone: null,
    email: null,
    description: null,
    notes: null,
    eventIds: [],
    restricted: false,
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

/** A contract-shaped catalogue offer (milestone 3). */
export function makeOffer(
  id: string,
  name: string,
  company: {id: string; name: string},
  extra: Json = {},
): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    company: {...company},
    categoryId: null,
    name,
    description: null,
    price: null,
    unit: 'unit',
    customUnit: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    conditions: null,
    vatIncluded: null,
    restricted: false,
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
  /** Milestone 3. Categories default to the built-in service ones. */
  categories?: Json[];
  contacts?: Json[];
  offers?: Json[];
  /** Recent searches of the signed-in member, newest first. */
  recentSearches?: {query: string; at: string}[];
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
  categories: Json[];
  contacts: Json[];
  offers: Json[];
  recentSearches: {query: string; at: string}[];
  requests: RecordedRequest[];
  /** Requests matching a method and a path (string or pattern). */
  calls: (method: string, path: string | RegExp) => RecordedRequest[];
  /** Simulates another person saving an event: bumps its version. */
  editOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Simulates another person saving a task: bumps its version. */
  editTaskOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Milestone 3: another person saving a company, person or offer. */
  editDirectoryOnServer: (
    list: 'companies' | 'contacts' | 'offers',
    id: string,
    patch: Json,
    by?: typeof dailos,
  ) => Json;
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
    categories: opts.categories ?? makeCategories(),
    contacts: opts.contacts ?? [],
    offers: opts.offers ?? [],
    recentSearches: opts.recentSearches ?? [],
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
    editDirectoryOnServer: (list, id, patch, by = dailos) => {
      const record = state[list].find(r => r.id === id);
      if (!record) throw new Error(`No ${list} ${id}`);
      Object.assign(record, patch, {
        version: (record.version as number) + 1,
        updatedBy: by,
        updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      return record;
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

  // ---- milestone 3: people, companies, catalogue, recent searches
  const contactRef = (id: unknown) => {
    if (typeof id !== 'string') return null;
    const c = state.contacts.find(x => x.id === id);
    return c ? {id: c.id as string, name: c.name as string} : null;
  };
  const byName = (list: Json[]) =>
    [...list].sort((a, b) =>
      (a.name as string).localeCompare(b.name as string, 'es', {
        sensitivity: 'base',
      }),
    );
  const isGuest = (role: string) => role === 'guest';
  // Same withholding as server/src/records/redact.ts: guests never receive
  // contact details, prices or free-text observations. The field lists below
  // are a hand-written copy of `WITHHELD_FROM_GUESTS` in that file (the mock
  // cannot import server code): keep them in step when it changes.
  const viewCompany = (c: Json, role: string): Json => {
    const counted = {
      ...c,
      contactCount: state.contacts.filter(
        p => (p.company as Json | null)?.id === c.id,
      ).length,
      offerCount: state.offers.filter(
        o => (o.company as Json | null)?.id === c.id,
      ).length,
    };
    return isGuest(role)
      ? {...counted, phone: null, email: null, notes: null, restricted: true}
      : counted;
  };
  const viewContact = (c: Json, role: string): Json =>
    isGuest(role)
      ? {
          ...c,
          phone: null,
          email: null,
          description: null,
          notes: null,
          restricted: true,
        }
      : c;
  const viewOffer = (o: Json, role: string): Json =>
    isGuest(role)
      ? {
          ...o,
          price: null,
          transportCost: null,
          assemblyCost: null,
          maintenanceCost: null,
          conditions: null,
          restricted: true,
        }
      : o;
  const bump = (record: Json, by: Json) =>
    Object.assign(record, {
      version: (record.version as number) + 1,
      updatedBy: by,
      updatedAt: new Date().toISOString(),
    });
  const conflict = (route: Route, current: Json, what: string) =>
    json(
      route,
      {
        code: 'VERSION_CONFLICT',
        message: `Otra persona ha cambiado ${what} mientras la editabas. Revisa la versión actual antes de guardar tus cambios.`,
        current,
      },
      409,
    );
  const checkVersion = (
    route: Route,
    record: Json,
    version: unknown,
    what: string,
  ) => {
    if (typeof version !== 'number' || Number.isNaN(version)) {
      return validation(route, {
        version:
          'Falta la versión del registro: recarga y vuelve a intentarlo.',
      });
    }
    if (version !== record.version) return conflict(route, record, what);
    return null;
  };
  const companyFrom = (input: Json): Json | null => {
    if (typeof input.companyId === 'string') {
      return state.companies.find(c => c.id === input.companyId) ?? null;
    }
    const n = text(input.companyName);
    if (!n) return null;
    let company = state.companies.find(
      c => nameKey(c.name as string) === nameKey(n),
    );
    if (!company) {
      company = makeCompany(`c-new-${++seq}`, n);
      state.companies.push(company);
    }
    return company;
  };
  const refOf = (c: Json | null) =>
    c ? {id: c.id as string, name: c.name as string} : null;
  const PROVENANCE = ['source', 'verification'];
  const amountKeys = [
    'price',
    'transportCost',
    'assemblyCost',
    'maintenanceCost',
  ];
  const amountProblems = (input: Json) => {
    const fields: Record<string, string> = {};
    for (const k of amountKeys) {
      const v = input[k];
      if (v === undefined || v === null) continue;
      if (
        typeof v !== 'number' ||
        v < 0 ||
        v > 10_000_000 ||
        Math.round(v * 100) !== v * 100
      ) {
        fields[k] = 'Importe no válido: hasta dos decimales.';
      }
    }
    return fields;
  };

  const directoryRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      url: URL;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, url, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const now = () => new Date().toISOString();

    // categories
    if (path === `/organizations/${ORG}/categories` && method === 'GET') {
      return json(route, {items: state.categories});
    }
    if (path === '/categories' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'Escribe el nombre.'});
      const existing = state.categories.find(
        c =>
          c.scope === input.scope && nameKey(c.name as string) === nameKey(n),
      );
      if (existing) return json(route, existing);
      const created = {
        id: `cat-new-${++seq}`,
        organizationId: ORG,
        scope: input.scope ?? 'service',
        name: n,
        builtIn: false,
      };
      state.categories.push(created);
      return json(route, created, 201);
    }

    // recent searches (members only)
    const recentPath = `/organizations/${ORG}/recent-searches`;
    if (path === recentPath) {
      if (method === 'GET') return json(route, {items: state.recentSearches});
      if (isGuest(user.role)) {
        return error(route, 403, 'FORBIDDEN', 'Solo lectura.');
      }
      if (method === 'POST') {
        const q = text(input.query);
        if (!q) return validation(route, {query: 'Búsqueda vacía.'});
        const key = (s: string) =>
          s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        state.recentSearches = [
          {query: q, at: now()},
          ...state.recentSearches.filter(r => key(r.query) !== key(q)),
        ].slice(0, 5);
        return json(route, {items: state.recentSearches});
      }
      if (method === 'DELETE') {
        state.recentSearches = [];
        return route.fulfill({status: 204, body: ''});
      }
    }

    // companies
    if (path === '/companies' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
      const dup = state.companies.find(
        c => nameKey(c.name as string) === nameKey(n),
      );
      if (dup) {
        return json(
          route,
          {
            code: 'DUPLICATE',
            message: `Ya existe «${dup.name}».`,
            current: viewCompany(dup, user.role),
          },
          409,
        );
      }
      const created = makeCompany(`c-new-${++seq}`, n, {
        kind: input.kind ?? 'supplier',
        categoryIds: input.categoryIds ?? [],
        phone: text(input.phone),
        email: text(input.email),
        website: text(input.website),
        notes: text(input.notes),
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.companies.push(created);
      return json(route, viewCompany(created, user.role), 201);
    }
    const companyMatch = /^\/companies\/([^/]+)$/.exec(path);
    if (companyMatch) {
      const company = state.companies.find(c => c.id === companyMatch[1]);
      if (!company) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = checkVersion(route, company, input.version, 'esta empresa');
        if (bad) return bad;
        if ('name' in input) {
          const n = text(input.name);
          if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
          const dup = state.companies.find(
            c => c !== company && nameKey(c.name as string) === nameKey(n),
          );
          if (dup) {
            return json(
              route,
              {
                code: 'DUPLICATE',
                message: `Ya existe «${dup.name}».`,
                current: viewCompany(dup, user.role),
              },
              409,
            );
          }
          company.name = n;
          for (const list of [state.contacts, state.offers, state.tasks]) {
            for (const r of list) {
              const c = r.company as Json | null;
              if (c?.id === company.id) r.company = {id: company.id, name: n};
            }
          }
        }
        for (const k of ['phone', 'email', 'website', 'notes']) {
          if (k in input) company[k] = text(input[k]);
        }
        for (const k of [
          'kind',
          'categoryIds',
          'mainContactId',
          ...PROVENANCE,
        ]) {
          if (k in input) company[k] = input[k];
        }
        bump(company, ref);
        return json(route, viewCompany(company, user.role));
      }
      if (method === 'DELETE') {
        const bad = checkVersion(
          route,
          company,
          Number(url.searchParams.get('version') ?? NaN),
          'esta empresa',
        );
        if (bad) return bad;
        state.companies = state.companies.filter(c => c !== company);
        state.offers = state.offers.filter(
          o => (o.company as Json).id !== company.id,
        );
        for (const list of [state.contacts, state.tasks]) {
          for (const r of list) {
            if ((r.company as Json | null)?.id === company.id) {
              r.company = null;
              bump(r, ref);
            }
          }
        }
        return route.fulfill({status: 204, body: ''});
      }
    }

    // contacts
    if (path === `/organizations/${ORG}/contacts` && method === 'GET') {
      return json(route, {
        items: byName(state.contacts).map(c => viewContact(c, user.role)),
      });
    }
    if (path === '/contacts' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
      const created = makeContact(`p-new-${++seq}`, n, {
        role: text(input.role),
        company: refOf(companyFrom(input)),
        phone: text(input.phone),
        email: text(input.email),
        description: text(input.description),
        notes: text(input.notes),
        eventIds: input.eventIds ?? [],
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.contacts.push(created);
      return json(route, created, 201);
    }
    const contactMatch = /^\/contacts\/([^/]+)$/.exec(path);
    if (contactMatch) {
      const contact = state.contacts.find(c => c.id === contactMatch[1]);
      if (!contact) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = checkVersion(route, contact, input.version, 'esta persona');
        if (bad) return bad;
        if ('name' in input) {
          const n = text(input.name);
          if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
          contact.name = n;
        }
        for (const k of ['role', 'phone', 'email', 'description', 'notes']) {
          if (k in input) contact[k] = text(input[k]);
        }
        for (const k of ['eventIds', ...PROVENANCE]) {
          if (k in input) contact[k] = input[k];
        }
        if ('companyId' in input || 'companyName' in input) {
          const before = (contact.company as Json | null)?.id;
          contact.company = refOf(companyFrom(input));
          const old = state.companies.find(c => c.id === before);
          if (
            old &&
            old.mainContactId === contact.id &&
            before !== (contact.company as Json | null)?.id
          ) {
            old.mainContactId = null;
            bump(old, ref);
          }
        }
        bump(contact, ref);
        return json(route, contact);
      }
      if (method === 'DELETE') {
        const bad = checkVersion(
          route,
          contact,
          Number(url.searchParams.get('version') ?? NaN),
          'esta persona',
        );
        if (bad) return bad;
        state.contacts = state.contacts.filter(c => c !== contact);
        for (const t of state.tasks) {
          if ((t.contact as Json | null)?.id === contact.id) {
            t.contact = null;
            bump(t, ref);
          }
        }
        for (const c of state.companies) {
          if (c.mainContactId === contact.id) {
            c.mainContactId = null;
            bump(c, ref);
          }
        }
        return route.fulfill({status: 204, body: ''});
      }
    }

    // offers
    if (path === `/organizations/${ORG}/offers` && method === 'GET') {
      return json(route, {
        items: [...state.offers]
          .sort(
            (a, b) =>
              ((a.company as Json).name as string).localeCompare(
                (b.company as Json).name as string,
                'es',
              ) || (a.name as string).localeCompare(b.name as string, 'es'),
          )
          .map(o => viewOffer(o, user.role)),
      });
    }
    if (path === '/offers' && method === 'POST') {
      const fields = amountProblems(input);
      const n = text(input.name);
      if (!n) fields.name = 'Escribe qué se ofrece.';
      const company = companyFrom(input);
      if (!company) fields.companyName = 'Indica la empresa que lo ofrece.';
      if (Object.keys(fields).length) return validation(route, fields);
      const created = makeOffer(`o-new-${++seq}`, n!, refOf(company)!, {
        categoryId: input.categoryId ?? null,
        description: text(input.description),
        price: input.price ?? null,
        unit: input.unit ?? 'unit',
        customUnit: input.unit === 'custom' ? text(input.customUnit) : null,
        transportCost: input.transportCost ?? null,
        assemblyCost: input.assemblyCost ?? null,
        maintenanceCost: input.maintenanceCost ?? null,
        conditions: text(input.conditions),
        vatIncluded: input.vatIncluded ?? null,
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.offers.push(created);
      return json(route, created, 201);
    }
    const offerMatch = /^\/offers\/([^/]+)$/.exec(path);
    if (offerMatch) {
      const offer = state.offers.find(o => o.id === offerMatch[1]);
      if (!offer) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = checkVersion(route, offer, input.version, 'esta oferta');
        if (bad) return bad;
        const fields = amountProblems(input);
        if ('name' in input && !text(input.name)) {
          fields.name = 'Escribe qué se ofrece.';
        }
        if (Object.keys(fields).length) return validation(route, fields);
        if ('name' in input) offer.name = text(input.name);
        for (const k of ['description', 'conditions', 'customUnit']) {
          if (k in input) offer[k] = text(input[k]);
        }
        for (const k of [
          'categoryId',
          'unit',
          'vatIncluded',
          ...amountKeys,
          ...PROVENANCE,
        ]) {
          if (k in input) offer[k] = input[k];
        }
        if (offer.unit !== 'custom') offer.customUnit = null;
        if ('companyId' in input || 'companyName' in input) {
          const company = companyFrom(input);
          if (company) offer.company = refOf(company);
        }
        bump(offer, ref);
        return json(route, offer);
      }
      if (method === 'DELETE') {
        const bad = checkVersion(
          route,
          offer,
          Number(url.searchParams.get('version') ?? NaN),
          'esta oferta',
        );
        if (bad) return bad;
        state.offers = state.offers.filter(o => o !== offer);
        return route.fulfill({status: 204, body: ''});
      }
    }
    return null;
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
        // Same contract as server/src/demo/service.ts: demo tasks, offers,
        // contacts and events go; demo companies (and venues) go only when no
        // real record uses them; real records that lose a link to a demo
        // record get a new version and author.
        const by = {id: user.id, displayName: user.displayName};
        const ids = (list: Json[]) =>
          new Set(list.filter(r => r.isDemo).map(r => r.id as string));
        const demoEvents = ids(state.events);
        const demoTasks = ids(state.tasks);
        const demoContacts = ids(state.contacts);
        for (const t of state.tasks) {
          if (t.isDemo) continue;
          const deps = t.dependsOn as string[];
          const lostEvent = demoEvents.has(t.eventId as string);
          const lostContact = demoContacts.has(
            (t.contact as Json | null)?.id as string,
          );
          const lostDependency = deps.some(d => demoTasks.has(d));
          if (!lostEvent && !lostContact && !lostDependency) continue;
          if (lostEvent) t.eventId = null;
          if (lostContact) t.contact = null;
          t.dependsOn = deps.filter(d => !demoTasks.has(d));
          bump(t, by);
        }
        for (const c of state.contacts) {
          const events = c.eventIds as string[];
          if (c.isDemo || !events.some(e => demoEvents.has(e))) continue;
          c.eventIds = events.filter(e => !demoEvents.has(e));
          bump(c, by);
        }
        for (const c of state.companies) {
          const main = c.mainContactId as string;
          if (c.isDemo || !demoContacts.has(main)) continue;
          c.mainContactId = null;
          bump(c, by);
        }
        const before =
          state.tasks.length +
          state.offers.length +
          state.contacts.length +
          state.events.length +
          state.companies.length;
        state.tasks = state.tasks.filter(t => !t.isDemo);
        state.offers = state.offers.filter(o => !o.isDemo);
        state.contacts = state.contacts.filter(c => !c.isDemo);
        state.events = state.events.filter(e => !e.isDemo);
        const usedCompany = (id: unknown) =>
          [...state.tasks, ...state.contacts, ...state.offers].some(
            r => (r.company as Json | null)?.id === id,
          );
        state.companies = state.companies.filter(
          c => !c.isDemo || usedCompany(c.id),
        );
        const after =
          state.tasks.length +
          state.offers.length +
          state.contacts.length +
          state.events.length +
          state.companies.length;
        return json(route, {removed: before - after});
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
        return json(route, {
          items: byName(state.companies).map(c => viewCompany(c, user.role)),
        });
      }
      const ref = {id: user.id, displayName: user.displayName};
      const m3 = await directoryRoute(route, {
        path,
        method,
        body,
        url,
        user,
        ref,
      });
      if (m3 !== null) return m3;
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
            contact: contactRef(input.contactId),
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
        if ('contactId' in input) task.contact = contactRef(input.contactId);
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
