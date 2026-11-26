import {expect, type Page, type Route} from '@playwright/test';
import {
  delayBlocker,
  delayItems,
  sameShift,
  shiftExpectations,
} from '../../../shared/logistics/followup.ts';
import {hypothesisLabel, noteLabel} from '../../../shared/logistics/history.ts';
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  HYPOTHESIS_NOTE_MAX,
  MAX_RESOURCES_PER_TASK,
  NOTE_KINDS,
  NOTE_TEXT_MAX,
  isValidDelay,
  isValidQuantity,
} from '../../../shared/logistics/rules.ts';
import {simulateDelay} from '../../../shared/logistics/schedule.ts';
import type {
  DelayMode,
  NoteKind,
  ShiftExpectation,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {
  daysForInstants,
  slotToInstants,
  utcToLocal,
} from '../../../shared/logistics/time.ts';

/**
 * Stateful in-memory mock of the Logistics Manager API for behavioural E2E
 * tests (milestones 1 to 5). It follows the route table and error bodies of
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
 * Milestone 4 rules mirrored from `server/src/{warehouses,resources,notes}`:
 * warehouse names are unique (409 DUPLICATE with `current`); a resource
 * finds or creates its warehouse (and, when contracted, its company) by
 * name, owned material never has a company or an offer, an offer must be of
 * the resource's company; `taskIds` and `resourceCount` are computed; notes
 * need a kind and a text and point at an event and/or one record. Deleting a
 * warehouse, resource, task, company, contact, offer or category unlinks
 * what pointed at it, bumping versions. Writes to warehouses, resources and
 * notes append to the activity log (a note's label is `noteLabel`, never its
 * text), and `/activity?entityType=&entityId=` returns one record's history.
 *
 * Milestone 5 rules mirrored from `server/src/{tasks,hypotheses}`:
 * `subsoilReviewed` is strict (400 `fields.subsoilReviewed` unless the
 * resulting `heavyLoad` is true); the declared `subsoilReview` is cleared when
 * the venue, `heavyLoad` or `resourceIds` change unless `true` is sent in the
 * same request, and declaring again with nothing relevant changed keeps the
 * original who and when. Delay hypotheses are listed newest first, created
 * (never applied), deleted while open (400 once applied) and applied only
 * when the shift recomputed with the shared `delayItems` / `simulateDelay` /
 * `shiftExpectations` equals the confirmed `expected` (`sameShift`);
 * otherwise 409 with `current` = the involved tasks and nothing changes.
 * `forceApplyConflict` answers the next applies with that 409 regardless.
 * Duplicate ids in `expected` are a 400. Deleting a task deletes its open
 * hypotheses and unlinks applied ones; deleting a resource clears the subsoil
 * mark of the tasks that used it, and changing its quantity, unit or
 * dimensions clears it on the live tasks that use it.
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
    resourceIds: [],
    subsoilReview: null,
    notes: null,
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

/** A contract-shaped delay hypothesis (milestone 5). Fictitious note only. */
export function makeHypothesis(
  id: string,
  task: {id: string; title: string},
  delayMinutes: number,
  extra: Json = {},
): Json {
  return {
    id,
    organizationId: ORG,
    taskId: task.id,
    taskTitle: task.title,
    delayMinutes,
    mode: 'shift',
    estimated: false,
    note: null,
    createdBy: elvis,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    appliedAt: null,
    appliedBy: null,
    restricted: false,
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

/** Stable id of a built-in resource category (M4): `rcat-` + name. */
export const resourceCategoryId = (name: string) => `r${categoryId(name)}`;

/** The built-in service categories, then the resource ones (M4), as seeded. */
export function makeCategories(): Json[] {
  return [
    ...BUILT_IN_CATEGORIES.map(name => ({
      id: categoryId(name),
      organizationId: ORG,
      scope: 'service',
      name,
      builtIn: true,
    })),
    ...BUILT_IN_RESOURCE_CATEGORIES.map(name => ({
      id: resourceCategoryId(name),
      organizationId: ORG,
      scope: 'resource',
      name,
      builtIn: true,
    })),
  ];
}

const meta = (extra: Json = {}): Json => {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    version: 1,
    organizationId: ORG,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
};

/** A contract-shaped warehouse (milestone 4); `resourceCount` is computed. */
export function makeWarehouse(
  id: string,
  name: string,
  extra: Json = {},
): Json {
  return {
    id,
    name,
    address: null,
    notes: null,
    resourceCount: 0,
    restricted: false,
    ...meta(extra),
  };
}

/** A contract-shaped inventory resource (milestone 4); `taskIds` is computed. */
export function makeResource(id: string, name: string, extra: Json = {}): Json {
  return {
    id,
    name,
    ownership: 'owned',
    categoryId: null,
    warehouse: null,
    company: null,
    offerId: null,
    quantity: null,
    unit: 'unidades',
    dimensions: null,
    condition: 'unknown',
    availability: 'unknown',
    location: null,
    toAssess: false,
    notes: null,
    taskIds: [],
    restricted: false,
    ...meta(extra),
  };
}

/** A contract-shaped note (milestone 4). Fictitious text only. */
export function makeNote(
  id: string,
  kind: NoteKind,
  text: string,
  extra: Json = {},
): Json {
  return {
    id,
    kind,
    text,
    event: null,
    ref: null,
    resolved: false,
    restricted: false,
    ...meta(extra),
  };
}

/** A contract-shaped activity entry, for seeding a record's history. */
export function makeActivity(
  id: string,
  entity: {type: string; id: string; label: string},
  action: 'create' | 'update' | 'delete',
  at: string,
  extra: Json = {},
): Json {
  return {
    id,
    user: elvis,
    entityType: entity.type,
    entityId: entity.id,
    entityLabel: entity.label,
    action,
    changedFields: [],
    at,
    ...extra,
  };
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
  /** Milestone 4. */
  warehouses?: Json[];
  resources?: Json[];
  notes?: Json[];
  /** Activity log entries (any order; served newest first). */
  activity?: Json[];
  /** Milestone 5: stored delay hypotheses (any order; served newest first). */
  hypotheses?: Json[];
  /**
   * Fixed time for milestone 4 writes (`createdAt`, activity `at`), to match
   * a page whose clock is fixed (plan-fixtures.ts `NOW`).
   */
  now?: string;
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
  warehouses: Json[];
  resources: Json[];
  notes: Json[];
  activity: Json[];
  /** Milestone 5: stored delay hypotheses. */
  hypotheses: Json[];
  /**
   * Apply requests (`POST /hypotheses/:id/apply`) that answer 409 next with
   * the involved tasks as they are, changing nothing: a plan that changed
   * between the confirmation and the write.
   */
  forceApplyConflict: number;
  /** History requests (`entityType` + `entityId`) that fail with a 500 next. */
  failHistory: number;
  /**
   * Holds every history request until the returned function is called, so a
   * spec can see the loading state without depending on timing.
   */
  holdHistory: () => () => void;
  requests: RecordedRequest[];
  /** Requests matching a method and a path (string or pattern). */
  calls: (method: string, path: string | RegExp) => RecordedRequest[];
  /** Simulates another person saving an event: bumps its version. */
  editOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Simulates another person saving a task: bumps its version. */
  editTaskOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Milestones 3–4: another person saving a directory or inventory record. */
  editDirectoryOnServer: (
    list:
      | 'companies'
      | 'contacts'
      | 'offers'
      | 'warehouses'
      | 'resources'
      | 'notes',
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
  let historyGate: Promise<void> | null = null;
  /** Time of milestone 4 writes: the page's fixed clock when a spec sets it. */
  const clock = () => opts.now ?? new Date().toISOString();

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
    warehouses: opts.warehouses ?? [],
    resources: opts.resources ?? [],
    notes: opts.notes ?? [],
    activity: opts.activity ?? [],
    hypotheses: opts.hypotheses ?? [],
    forceApplyConflict: 0,
    failHistory: 0,
    holdHistory: () => {
      let release = () => {};
      historyGate = new Promise<void>(resolve => {
        release = () => {
          historyGate = null;
          resolve();
        };
      });
      return release;
    },
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
  // Milestone 4: event and task notes, warehouse address and notes, resource
  // location and notes, and the text of every note. Milestone 5: the note of
  // a delay hypothesis.
  const WITHHELD = {
    event: ['notes'],
    task: ['notes'],
    warehouse: ['address', 'notes'],
    resource: ['location', 'notes'],
    note: ['text'],
    hypothesis: ['note'],
  } as const;
  const redact = (
    kind: keyof typeof WITHHELD,
    record: Json,
    role: string,
  ): Json => {
    if (!isGuest(role)) return {...record, restricted: false};
    const out: Json = {...record, restricted: true};
    for (const k of WITHHELD[kind]) out[k] = null;
    return out;
  };
  const viewEvent = (e: Json, role: string) => redact('event', e, role);
  const viewTask = (t: Json, role: string) =>
    redact(
      'task',
      {
        ...t,
        resourceIds: t.resourceIds ?? [],
        subsoilReview: t.subsoilReview ?? null,
      },
      role,
    );
  const viewHypothesis = (h: Json, role: string) =>
    redact('hypothesis', h, role);
  const viewWarehouse = (w: Json, role: string) =>
    redact(
      'warehouse',
      {
        ...w,
        resourceCount: state.resources.filter(
          r => (r.warehouse as Json | null)?.id === w.id,
        ).length,
      },
      role,
    );
  const viewResource = (r: Json, role: string) =>
    redact(
      'resource',
      {
        ...r,
        taskIds: state.tasks
          .filter(t =>
            ((t.resourceIds as string[]) ?? []).includes(r.id as string),
          )
          .map(t => t.id as string)
          .sort(),
      },
      role,
    );
  /** What a note points at, with the record's current name. */
  const refRecord = (type: string, id: string): Json | undefined => {
    const lists: Record<string, Json[]> = {
      task: state.tasks,
      venue: state.venues as unknown as Json[],
      company: state.companies,
      contact: state.contacts,
      offer: state.offers,
      warehouse: state.warehouses,
      resource: state.resources,
    };
    return lists[type]?.find(x => x.id === id);
  };
  const viewNote = (n: Json, role: string) => {
    const ref = n.ref as {type: string; id: string; label: string} | null;
    const target = ref ? refRecord(ref.type, ref.id) : undefined;
    const ev = n.event as {id: string} | null;
    const event = ev ? state.events.find(e => e.id === ev.id) : undefined;
    return redact(
      'note',
      {
        ...n,
        ref: ref
          ? {
              ...ref,
              label: (target?.title ?? target?.name ?? ref.label) as string,
            }
          : null,
        event: ev
          ? {id: ev.id, name: event?.name ?? (n.event as Json).name}
          : null,
      },
      role,
    );
  };
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

  // ---- milestone 4 helpers: activity log and unlinking
  const log = (
    by: Json,
    entity: {type: string; id: string; label: string},
    action: 'create' | 'update' | 'delete',
    changedFields: string[] = [],
  ) => {
    state.activity.push({
      id: `a-new-${++seq}`,
      user: by,
      entityType: entity.type,
      entityId: entity.id,
      entityLabel: entity.label,
      action,
      changedFields,
      at: clock(),
    });
  };
  /** Notes pointing at a deleted record lose the link (new version). */
  const unlinkNotes = (type: string, id: string, by: Json) => {
    for (const n of state.notes) {
      const r = n.ref as {type: string; id: string} | null;
      if (r?.type === type && r.id === id) {
        n.ref = null;
        bump(n, by);
      }
    }
  };
  /** Resources that used a deleted record lose it (new version). */
  const unlinkResources = (
    link: 'warehouse' | 'company' | 'offer' | 'category',
    id: string,
    by: Json,
  ) => {
    for (const r of state.resources) {
      const hit =
        link === 'offer'
          ? r.offerId === id
          : link === 'category'
            ? r.categoryId === id
            : (r[link] as Json | null)?.id === id;
      if (!hit) continue;
      if (link === 'offer') r.offerId = null;
      else if (link === 'category') r.categoryId = null;
      else r[link] = null;
      if (link === 'company') r.offerId = null;
      bump(r, by);
    }
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
    const categoryMatch = /^\/categories\/([^/]+)$/.exec(path);
    if (categoryMatch && method === 'DELETE') {
      const category = state.categories.find(c => c.id === categoryMatch[1]);
      if (!category) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (category.builtIn) {
        return validation(route, {
          id: 'Las categorías que trae OxEye no se pueden borrar.',
        });
      }
      const id = category.id as string;
      state.categories = state.categories.filter(c => c !== category);
      for (const c of state.companies) {
        const ids = c.categoryIds as string[];
        if (!ids.includes(id)) continue;
        c.categoryIds = ids.filter(x => x !== id);
        bump(c, ref);
      }
      for (const o of state.offers) {
        if (o.categoryId !== id) continue;
        o.categoryId = null;
        bump(o, ref);
      }
      unlinkResources('category', id, ref);
      return route.fulfill({status: 204, body: ''});
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
        for (const o of state.offers) {
          if ((o.company as Json).id !== company.id) continue;
          unlinkResources('offer', o.id as string, ref);
          unlinkNotes('offer', o.id as string, ref);
        }
        state.offers = state.offers.filter(
          o => (o.company as Json).id !== company.id,
        );
        unlinkResources('company', company.id as string, ref);
        unlinkNotes('company', company.id as string, ref);
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
        unlinkNotes('contact', contact.id as string, ref);
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
        unlinkResources('offer', offer.id as string, ref);
        unlinkNotes('offer', offer.id as string, ref);
        return route.fulfill({status: 204, body: ''});
      }
    }
    return null;
  };

  // ---- milestone 4: warehouses, resources, notes
  const versionOf = (
    route: Route,
    record: Json,
    version: unknown,
    current: Json,
    message: string,
  ) => {
    if (typeof version !== 'number' || Number.isNaN(version)) {
      return validation(route, {
        version:
          'Falta la versión del registro: recarga y vuelve a intentarlo.',
      });
    }
    if (version !== record.version) {
      return json(route, {code: 'VERSION_CONFLICT', message, current}, 409);
    }
    return null;
  };
  const RESOURCE_CONFLICT =
    'Otra persona ha cambiado este recurso mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.';
  const WAREHOUSE_CONFLICT =
    'Otra persona ha cambiado este almacén mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.';
  const NOTE_CONFLICT =
    'Otra persona ha cambiado esta nota mientras la editabas. Revisa la versión actual antes de guardar tus cambios.';
  const OWNED_WITHOUT_COMPANY =
    'Un recurso propio no tiene empresa: márcalo como contratado para indicar quién lo presta.';
  const OWNED_WITHOUT_OFFER =
    'Un recurso propio no viene de una oferta: márcalo como contratado para vincularla.';
  const OFFER_OF_OTHER_COMPANY =
    'Esa oferta es de otra empresa: elige una oferta de la empresa del recurso o cambia antes la empresa.';
  const duplicateWarehouse = (route: Route, dup: Json, role: string) =>
    json(
      route,
      {
        code: 'DUPLICATE',
        message: `Ya existe el almacén «${dup.name}».`,
        current: viewWarehouse(dup, role),
      },
      409,
    );
  /** Find-or-create by name (warehouseId wins), as resolveWarehouseRef. */
  const warehouseFrom = (input: Json, by: Json): Json | null | undefined => {
    if (typeof input.warehouseId === 'string') {
      return state.warehouses.find(w => w.id === input.warehouseId) ?? null;
    }
    if (input.warehouseId === null && input.warehouseName === undefined) {
      return null;
    }
    if (input.warehouseName === undefined) return undefined;
    const n = text(input.warehouseName);
    if (!n) return null;
    let w = state.warehouses.find(
      x => nameKey(x.name as string) === nameKey(n),
    );
    if (!w) {
      w = makeWarehouse(`w-new-${++seq}`, n, {
        createdBy: by,
        updatedBy: by,
        createdAt: clock(),
        updatedAt: clock(),
      });
      state.warehouses.push(w);
      log(by, {type: 'warehouse', id: w.id as string, label: n}, 'create');
    }
    return w;
  };
  const quantityProblem = (v: unknown) =>
    v === undefined ||
    v === null ||
    (typeof v === 'number' && isValidQuantity(v))
      ? null
      : 'Cantidad no válida: de 0 a 1.000.000, con dos decimales como mucho.';
  /** Applies a resource input to `r` (create or update); returns field errors. */
  const applyResource = (
    r: Json,
    input: Json,
    by: Json,
  ): Record<string, string> => {
    const fields: Record<string, string> = {};
    const ownership = (input.ownership ?? r.ownership) as string;
    if (ownership === 'owned') {
      if (input.companyId) fields.companyId = OWNED_WITHOUT_COMPANY;
      if (input.companyName) fields.companyName = OWNED_WITHOUT_COMPANY;
      if (input.offerId) fields.offerId = OWNED_WITHOUT_OFFER;
    }
    if ('name' in input && !text(input.name)) {
      fields.name = 'El nombre es obligatorio.';
    }
    const q = quantityProblem(input.quantity);
    if (q) fields.quantity = q;
    if (typeof input.categoryId === 'string') {
      const c = state.categories.find(x => x.id === input.categoryId);
      if (!c || c.scope !== 'resource') {
        fields.categoryId =
          'Esa categoría ya no existe o no es de recursos de esta organización.';
      }
    }
    const offer =
      typeof input.offerId === 'string'
        ? state.offers.find(o => o.id === input.offerId)
        : undefined;
    if (ownership === 'contracted' && typeof input.offerId === 'string') {
      if (!offer) {
        fields.offerId =
          'No encontramos esa oferta en esta organización: puede que se haya eliminado.';
      }
    }
    if (Object.keys(fields).length) return fields;

    if ('name' in input) r.name = text(input.name);
    r.ownership = ownership;
    if ('quantity' in input) r.quantity = input.quantity ?? null;
    if ('unit' in input) r.unit = text(input.unit) ?? 'unidades';
    for (const k of ['dimensions', 'location', 'notes']) {
      if (k in input) r[k] = text(input[k]);
    }
    for (const k of [
      'categoryId',
      'condition',
      'availability',
      'toAssess',
      ...PROVENANCE,
    ]) {
      if (k in input) r[k] = input[k];
    }
    const w = warehouseFrom(input, by);
    if (w !== undefined) r.warehouse = refOf(w);
    if (ownership === 'owned') {
      r.company = null;
      r.offerId = null;
      return {};
    }
    const companyGiven = 'companyId' in input || 'companyName' in input;
    const before = (r.company as Json | null)?.id ?? null;
    if (companyGiven) {
      r.company =
        input.companyId === null && !text(input.companyName)
          ? null
          : refOf(companyFrom(input));
    }
    const companyId = (r.company as Json | null)?.id ?? null;
    if (input.offerId === undefined) {
      if (companyId === null || companyId !== before) r.offerId = null;
    } else if (input.offerId === null) {
      r.offerId = null;
    } else if (offer) {
      const offerCompany = (offer.company as Json).id;
      if (companyGiven || companyId !== null) {
        if (offerCompany !== companyId) {
          return {offerId: OFFER_OF_OTHER_COMPANY};
        }
      } else {
        r.company = {...(offer.company as Json)};
      }
      r.offerId = offer.id;
    }
    return {};
  };
  /** Contract field names of an input, for the activity log. */
  const changedOf = (input: Json) => [
    ...new Set(
      Object.keys(input)
        .filter(k => k !== 'version' && k !== 'organizationId')
        .map(k =>
          k === 'warehouseName' || k === 'warehouseId'
            ? 'warehouse'
            : k === 'companyName' || k === 'companyId'
              ? 'company'
              : k === 'eventId'
                ? 'event'
                : k,
        ),
    ),
  ];
  const noteRefProblem = (input: Json): Record<string, string> => {
    const fields: Record<string, string> = {};
    if (typeof input.eventId === 'string') {
      if (!state.events.some(e => e.id === input.eventId)) {
        fields.eventId =
          'No encontramos ese evento en esta organización: puede que se haya eliminado.';
      }
    }
    const r = input.ref as {type?: string; id?: string} | null | undefined;
    if (r && (!r.type || !r.id || !refRecord(r.type, r.id))) {
      fields.ref =
        'No encontramos ese registro en esta organización: puede que se haya eliminado.';
    }
    return fields;
  };
  const applyNoteLinks = (n: Json, input: Json) => {
    if ('eventId' in input) {
      const e = state.events.find(x => x.id === input.eventId);
      n.event = e ? {id: e.id, name: e.name} : null;
    }
    if ('ref' in input) {
      const r = input.ref as {type: string; id: string} | null;
      const target = r ? refRecord(r.type, r.id) : undefined;
      n.ref =
        r && target
          ? {
              type: r.type,
              id: r.id,
              label: (target.title ?? target.name) as string,
            }
          : null;
    }
  };
  const noteEntity = (n: Json) => ({
    type: 'note',
    id: n.id as string,
    label: noteLabel(viewNote(n, 'member') as never),
  });

  const inventoryRoute = async (
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
    const now = clock;
    const role = user.role;
    const deleteVersion = () => Number(url.searchParams.get('version') ?? NaN);

    // warehouses
    if (path === `/organizations/${ORG}/warehouses` && method === 'GET') {
      return json(route, {
        items: byName(state.warehouses).map(w => viewWarehouse(w, role)),
      });
    }
    if (path === '/warehouses' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
      const dup = state.warehouses.find(
        w => nameKey(w.name as string) === nameKey(n),
      );
      if (dup) return duplicateWarehouse(route, dup, role);
      const created = makeWarehouse(`w-new-${++seq}`, n, {
        address: text(input.address),
        notes: text(input.notes),
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.warehouses.push(created);
      log(
        ref,
        {type: 'warehouse', id: created.id as string, label: n},
        'create',
      );
      return json(route, viewWarehouse(created, role), 201);
    }
    const warehouseMatch = /^\/warehouses\/([^/]+)$/.exec(path);
    if (warehouseMatch) {
      const w = state.warehouses.find(x => x.id === warehouseMatch[1]);
      if (!w) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = versionOf(
          route,
          w,
          input.version,
          viewWarehouse(w, role),
          WAREHOUSE_CONFLICT,
        );
        if (bad) return bad;
        if ('name' in input) {
          const n = text(input.name);
          if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
          const dup = state.warehouses.find(
            x => x !== w && nameKey(x.name as string) === nameKey(n),
          );
          if (dup) return duplicateWarehouse(route, dup, role);
          w.name = n;
          for (const r of state.resources) {
            if ((r.warehouse as Json | null)?.id === w.id) {
              r.warehouse = {id: w.id, name: n};
            }
          }
        }
        for (const k of ['address', 'notes']) {
          if (k in input) w[k] = text(input[k]);
        }
        for (const k of PROVENANCE) if (k in input) w[k] = input[k];
        bump(w, ref);
        log(
          ref,
          {type: 'warehouse', id: w.id as string, label: w.name as string},
          'update',
          changedOf(input),
        );
        return json(route, viewWarehouse(w, role));
      }
      if (method === 'DELETE') {
        const bad = versionOf(
          route,
          w,
          deleteVersion(),
          viewWarehouse(w, role),
          WAREHOUSE_CONFLICT,
        );
        if (bad) return bad;
        state.warehouses = state.warehouses.filter(x => x !== w);
        unlinkResources('warehouse', w.id as string, ref);
        unlinkNotes('warehouse', w.id as string, ref);
        log(
          ref,
          {type: 'warehouse', id: w.id as string, label: w.name as string},
          'delete',
        );
        return route.fulfill({status: 204, body: ''});
      }
    }

    // resources
    if (path === `/organizations/${ORG}/resources` && method === 'GET') {
      return json(route, {
        items: byName(state.resources).map(r => viewResource(r, role)),
      });
    }
    if (path === '/resources' && method === 'POST') {
      if (!text(input.name)) {
        return validation(route, {name: 'El nombre es obligatorio.'});
      }
      const created = makeResource(`r-new-${++seq}`, text(input.name)!, {
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      const fields = applyResource(
        created,
        {ownership: 'owned', ...input},
        ref,
      );
      if (Object.keys(fields).length) return validation(route, fields);
      state.resources.push(created);
      log(
        ref,
        {
          type: 'resource',
          id: created.id as string,
          label: created.name as string,
        },
        'create',
      );
      return json(route, viewResource(created, role), 201);
    }
    const resourceMatch = /^\/resources\/([^/]+)$/.exec(path);
    if (resourceMatch) {
      const r = state.resources.find(x => x.id === resourceMatch[1]);
      if (!r) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = versionOf(
          route,
          r,
          input.version,
          viewResource(r, role),
          RESOURCE_CONFLICT,
        );
        if (bad) return bad;
        // Validate on a copy, so a 400 changes nothing.
        const draft = structuredClone(r);
        const fields = applyResource(draft, input, ref);
        if (Object.keys(fields).length) return validation(route, fields);
        // M5: a different quantity, unit or size is different material: the
        // live tasks that use it lose their declared subsoil review.
        const material = (x: Json) =>
          JSON.stringify([x.quantity, x.unit, x.dimensions]);
        if (material(draft) !== material(r)) {
          for (const t of state.tasks) {
            if (
              t.subsoilReview &&
              t.status !== 'done' &&
              t.status !== 'cancelled' &&
              ((t.resourceIds as string[]) ?? []).includes(r.id as string)
            ) {
              t.subsoilReview = null;
              bump(t, ref);
            }
          }
        }
        Object.assign(r, draft);
        bump(r, ref);
        log(
          ref,
          {type: 'resource', id: r.id as string, label: r.name as string},
          'update',
          changedOf(input),
        );
        return json(route, viewResource(r, role));
      }
      if (method === 'DELETE') {
        const bad = versionOf(
          route,
          r,
          deleteVersion(),
          viewResource(r, role),
          RESOURCE_CONFLICT,
        );
        if (bad) return bad;
        state.resources = state.resources.filter(x => x !== r);
        for (const t of state.tasks) {
          const ids = (t.resourceIds as string[]) ?? [];
          if (!ids.includes(r.id as string)) continue;
          t.resourceIds = ids.filter(x => x !== r.id);
          // M5: its material changed, so the declared subsoil review goes.
          t.subsoilReview = null;
          bump(t, ref);
        }
        unlinkNotes('resource', r.id as string, ref);
        log(
          ref,
          {type: 'resource', id: r.id as string, label: r.name as string},
          'delete',
        );
        return route.fulfill({status: 204, body: ''});
      }
    }

    // notes
    if (path === `/organizations/${ORG}/notes` && method === 'GET') {
      const items = [...state.notes]
        .sort(
          (a, b) =>
            Date.parse(b.createdAt as string) -
              Date.parse(a.createdAt as string) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .map(n => viewNote(n, role));
      return json(route, {items});
    }
    if (path === '/notes' && method === 'POST') {
      const fields = noteRefProblem(input);
      if (!NOTE_KINDS.includes(input.kind as NoteKind)) {
        fields.kind = 'Indica qué es: nota, incidencia, decisión…';
      }
      const t = typeof input.text === 'string' ? input.text.trim() : '';
      if (!t || t.length > NOTE_TEXT_MAX) fields.text = 'Escribe el texto.';
      if (Object.keys(fields).length) return validation(route, fields);
      const created = makeNote(`n-new-${++seq}`, input.kind as NoteKind, t, {
        resolved: input.resolved === true,
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      applyNoteLinks(created, input);
      state.notes.push(created);
      log(ref, noteEntity(created), 'create');
      return json(route, viewNote(created, role), 201);
    }
    const noteMatch = /^\/notes\/([^/]+)$/.exec(path);
    if (noteMatch) {
      const n = state.notes.find(x => x.id === noteMatch[1]);
      if (!n) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = versionOf(
          route,
          n,
          input.version,
          viewNote(n, role),
          NOTE_CONFLICT,
        );
        if (bad) return bad;
        const fields = noteRefProblem(input);
        if ('kind' in input && !NOTE_KINDS.includes(input.kind as NoteKind)) {
          fields.kind = 'Indica qué es: nota, incidencia, decisión…';
        }
        if ('text' in input) {
          const t = typeof input.text === 'string' ? input.text.trim() : '';
          if (!t || t.length > NOTE_TEXT_MAX) fields.text = 'Escribe el texto.';
        }
        if (Object.keys(fields).length) return validation(route, fields);
        if ('text' in input) n.text = (input.text as string).trim();
        for (const k of ['kind', 'resolved', ...PROVENANCE]) {
          if (k in input) n[k] = input[k];
        }
        applyNoteLinks(n, input);
        bump(n, ref);
        log(ref, noteEntity(n), 'update', changedOf(input));
        return json(route, viewNote(n, role));
      }
      if (method === 'DELETE') {
        const bad = versionOf(
          route,
          n,
          deleteVersion(),
          viewNote(n, role),
          NOTE_CONFLICT,
        );
        if (bad) return bad;
        state.notes = state.notes.filter(x => x !== n);
        log(ref, noteEntity(n), 'delete');
        return route.fulfill({status: 204, body: ''});
      }
    }
    return null;
  };

  // ---- milestone 5: delay hypotheses (server/src/hypotheses/service.ts)
  const HYPOTHESIS_NOT_FOUND =
    'No encontramos esa hipótesis: puede que se haya descartado o que su tarea se haya eliminado.';
  const ALREADY_APPLIED =
    'Esta hipótesis ya se aplicó al plan: se conserva como registro de la decisión.';
  const PLAN_CHANGED =
    'El plan ha cambiado desde que revisaste esta hipótesis. Mira de nuevo qué tareas se mueven antes de aplicarla.';
  const DELAY_BLOCKED: Record<string, string> = {
    finished: 'Esa tarea ya está hecha: no se puede retrasar.',
    cancelled: 'Esa tarea está cancelada: no se puede retrasar.',
    untimed:
      'Esa tarea no tiene hora de inicio y de fin: ponle horario para poder calcular un retraso.',
  };
  const hypothesisEntity = (h: Json) => ({
    type: 'hypothesis',
    id: h.id as string,
    label: hypothesisLabel(h as never),
  });

  const hypothesisRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const role = user.role;

    if (path === `/organizations/${ORG}/hypotheses` && method === 'GET') {
      const items = [...state.hypotheses]
        .sort(
          (a, b) =>
            Date.parse(b.createdAt as string) -
              Date.parse(a.createdAt as string) ||
            String(b.id).localeCompare(String(a.id)),
        )
        .map(h => viewHypothesis(h, role));
      return json(route, {items});
    }
    if (path === '/hypotheses' && method === 'POST') {
      const fields: Record<string, string> = {};
      const task = state.tasks.find(t => t.id === input.taskId);
      if (!task) {
        fields.taskId =
          'No encontramos esa tarea en esta organización: puede que se haya eliminado.';
      } else {
        const blocker = delayBlocker(task as unknown as Task);
        if (blocker) fields.taskId = DELAY_BLOCKED[blocker];
      }
      if (
        typeof input.delayMinutes !== 'number' ||
        !isValidDelay(input.delayMinutes)
      ) {
        fields.delayMinutes =
          'Indica el retraso en minutos enteros, entre 1 y 1440 (un día).';
      }
      const mode = (input.mode ?? 'shift') as DelayMode;
      if (mode !== 'shift' && mode !== 'extend') {
        fields.mode = 'Tipo de retraso no válido.';
      }
      const note = text(input.note);
      if (note && note.length > HYPOTHESIS_NOTE_MAX) {
        fields.note = `Como mucho ${HYPOTHESIS_NOTE_MAX} caracteres.`;
      }
      if (Object.keys(fields).length) return validation(route, fields);
      const created = makeHypothesis(
        `h-new-${++seq}`,
        {id: task!.id as string, title: task!.title as string},
        input.delayMinutes as number,
        {
          mode,
          estimated: input.estimated === true,
          note,
          createdBy: ref,
          createdAt: clock(),
        },
      );
      state.hypotheses.push(created);
      log(ref, hypothesisEntity(created), 'create');
      return json(route, viewHypothesis(created, role), 201);
    }
    const applyMatch = /^\/hypotheses\/([^/]+)\/apply$/.exec(path);
    const oneMatch = /^\/hypotheses\/([^/]+)$/.exec(path);
    const id = applyMatch?.[1] ?? oneMatch?.[1];
    if (!id) return null;
    const h = state.hypotheses.find(x => x.id === id);
    if (!h) return error(route, 404, 'NOT_FOUND', HYPOTHESIS_NOT_FOUND);

    if (oneMatch && method === 'DELETE') {
      if (h.appliedAt) return error(route, 400, 'VALIDATION', ALREADY_APPLIED);
      state.hypotheses = state.hypotheses.filter(x => x !== h);
      log(ref, hypothesisEntity(h), 'delete');
      return route.fulfill({status: 204, body: ''});
    }
    if (applyMatch && method === 'POST') {
      const expected = input.expected as ShiftExpectation[] | undefined;
      if (!Array.isArray(expected) || expected.length === 0) {
        return validation(route, {
          expected:
            'Falta la lista de tareas que se mueven: vuelve a abrir la hipótesis y confirma de nuevo.',
        });
      }
      if (new Set(expected.map(e => e.id)).size !== expected.length) {
        return validation(route, {
          expected:
            'La misma tarea aparece dos veces en la confirmación: vuelve a abrir la hipótesis y confirma de nuevo.',
        });
      }
      if (h.appliedAt) return error(route, 400, 'VALIDATION', ALREADY_APPLIED);
      const tasks = state.tasks as unknown as Task[];
      const root = h.taskId ? tasks.find(t => t.id === h.taskId) : undefined;
      const impact =
        root && !delayBlocker(root)
          ? simulateDelay(
              delayItems(tasks, root.id),
              root.id,
              h.delayMinutes as number,
              h.mode as DelayMode,
            )
          : null;
      const computed = impact ? shiftExpectations(impact, tasks) : [];
      const forced = state.forceApplyConflict > 0;
      if (forced) state.forceApplyConflict--;
      if (forced || !root || !impact || !sameShift(expected, computed)) {
        const involved = new Set([
          ...expected.map(e => e.id),
          ...computed.map(c => c.id),
          ...(h.taskId ? [h.taskId as string] : []),
        ]);
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: PLAN_CHANGED,
            current: state.tasks
              .filter(t => involved.has(t.id as string))
              .map(t => viewTask(t, role)),
          },
          409,
        );
      }
      const at = clock();
      const moved: Json[] = [];
      for (const s of computed) {
        const t = state.tasks.find(x => x.id === s.id)!;
        const days = daysForInstants(
          s.startsAt,
          s.endsAt,
          (t.timezone as string) || TZ,
        );
        const status =
          s.id === root!.id &&
          input.markDelayed === true &&
          (t.status === 'planned' || t.status === 'confirmed')
            ? 'delayed'
            : t.status;
        const changed = [
          ...(status !== t.status ? ['status'] : []),
          ...(days.date !== t.date ? ['date'] : []),
          ...(days.endDate !== t.endDate ? ['endDate'] : []),
          'startsAt',
          'endsAt',
        ];
        Object.assign(t, {
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          date: days.date,
          endDate: days.endDate,
          status,
          version: (t.version as number) + 1,
          updatedBy: ref,
          updatedAt: at,
        });
        log(
          ref,
          {type: 'task', id: t.id as string, label: t.title as string},
          'update',
          changed,
        );
        moved.push(t);
      }
      Object.assign(h, {appliedAt: at, appliedBy: ref});
      log(ref, hypothesisEntity(h), 'update', ['appliedAt']);
      return json(route, {
        hypothesis: viewHypothesis(h, role),
        tasks: moved.map(t => viewTask(t, role)),
      });
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
        return json(route, {
          items: state.events.map(e => viewEvent(e, user.role)),
        });
      }
      if (path === `/organizations/${ORG}/venues`) {
        return json(route, {items: state.venues});
      }
      if (path === `/organizations/${ORG}/activity`) {
        // Same contract as server/src/activity/routes.ts: the organization's
        // recent activity, or one record's history (both parameters or
        // neither), newest first.
        const entityType = url.searchParams.get('entityType') || null;
        const entityId = url.searchParams.get('entityId') || null;
        if (!entityType !== !entityId) {
          return validation(route, {
            [entityType ? 'entityId' : 'entityType']:
              'Para ver el historial de un registro indica su tipo y su identificador.',
          });
        }
        const limit = Number(url.searchParams.get('limit') || 20);
        if (entityType) {
          if (state.failHistory > 0) {
            state.failHistory--;
            return error(
              route,
              500,
              'INTERNAL',
              'Error interno del servidor. Inténtalo de nuevo.',
            );
          }
          if (historyGate) await historyGate;
        }
        // Newest first; entries with the same time, last logged first.
        const items = state.activity
          .map((a, i) => ({a, i}))
          .filter(
            ({a}) =>
              !entityType ||
              (a.entityType === entityType && a.entityId === entityId),
          )
          .sort(
            (x, y) =>
              Date.parse(y.a.at as string) - Date.parse(x.a.at as string) ||
              y.i - x.i,
          )
          .map(({a}) => a)
          .slice(0, limit);
        return json(route, {items});
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
        // Milestone 4: real tasks lose demo resources; real notes lose links
        // to demo records (and a demo event).
        const demoResources = ids(state.resources);
        for (const t of state.tasks) {
          const res = (t.resourceIds as string[]) ?? [];
          if (t.isDemo || !res.some(r => demoResources.has(r))) continue;
          t.resourceIds = res.filter(r => !demoResources.has(r));
          bump(t, by);
        }
        for (const n of state.notes) {
          if (n.isDemo) continue;
          const r = n.ref as {type: string; id: string} | null;
          const target = r ? refRecord(r.type, r.id) : undefined;
          // Venues, companies and warehouses that real notes use are kept.
          const lostRef =
            !!target?.isDemo &&
            !['warehouse', 'venue', 'company'].includes(r!.type);
          const lostEvent = demoEvents.has(
            (n.event as Json | null)?.id as string,
          );
          if (!lostRef && !lostEvent) continue;
          if (lostRef) n.ref = null;
          if (lostEvent) n.event = null;
          bump(n, by);
        }
        const before =
          state.tasks.length +
          state.offers.length +
          state.contacts.length +
          state.events.length +
          state.companies.length +
          state.notes.length +
          state.resources.length +
          state.warehouses.length;
        // M5: every hypothesis about a demo task goes, applied ones included.
        state.hypotheses = state.hypotheses.filter(
          h => !demoTasks.has(h.taskId as string),
        );
        state.notes = state.notes.filter(n => !n.isDemo);
        state.resources = state.resources.filter(r => !r.isDemo);
        state.warehouses = state.warehouses.filter(
          w =>
            !w.isDemo ||
            state.resources.some(
              r => (r.warehouse as Json | null)?.id === w.id,
            ) ||
            state.notes.some(
              n =>
                (n.ref as Json | null)?.type === 'warehouse' &&
                (n.ref as Json).id === w.id,
            ),
        );
        state.tasks = state.tasks.filter(t => !t.isDemo);
        state.offers = state.offers.filter(o => !o.isDemo);
        state.contacts = state.contacts.filter(c => !c.isDemo);
        state.events = state.events.filter(e => !e.isDemo);
        const usedCompany = (id: unknown) =>
          [
            ...state.tasks,
            ...state.contacts,
            ...state.offers,
            ...state.resources,
          ].some(r => (r.company as Json | null)?.id === id) ||
          state.notes.some(
            n =>
              (n.ref as Json | null)?.type === 'company' &&
              (n.ref as Json).id === id,
          );
        state.companies = state.companies.filter(
          c => !c.isDemo || usedCompany(c.id),
        );
        const after =
          state.tasks.length +
          state.offers.length +
          state.contacts.length +
          state.events.length +
          state.companies.length +
          state.notes.length +
          state.resources.length +
          state.warehouses.length;
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
              current: viewEvent(event, user.role),
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
        return json(route, viewEvent(event, user.role));
      }

      // ---- milestone 2: tasks and companies
      if (path === `/organizations/${ORG}/tasks` && method === 'GET') {
        const eventId = url.searchParams.get('eventId');
        return json(route, {
          items: (eventId
            ? state.tasks.filter(t => t.eventId === eventId)
            : state.tasks
          ).map(t => viewTask(t, user.role)),
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
      const m4 = await inventoryRoute(route, {
        path,
        method,
        body,
        url,
        user,
        ref,
      });
      if (m4 !== null) return m4;
      const m5 = await hypothesisRoute(route, {path, method, body, user, ref});
      if (m5 !== null) return m5;
      /** Same check as server/src/resources/links.ts (`areOwnResources`). */
      const resourceIdsProblem = (ids: unknown): string | null => {
        if (ids === undefined) return null;
        if (!Array.isArray(ids)) return 'Lista de recursos no válida.';
        if (ids.length > MAX_RESOURCES_PER_TASK) {
          return `Como mucho ${MAX_RESOURCES_PER_TASK} recursos por tarea.`;
        }
        return ids.every(id => state.resources.some(r => r.id === id))
          ? null
          : 'Alguno de los recursos ya no existe o no es de esta organización.';
      };
      /** `subsoilReviewed` only with a resulting heavy load (strict both ways). */
      const subsoilProblem = (
        input: Json,
        heavyAfter: boolean | null,
      ): string | null => {
        if (input.subsoilReviewed === undefined) return null;
        if (typeof input.subsoilReviewed !== 'boolean') {
          return 'Indica sí o no: ¿se revisó el subsuelo en el simulador?';
        }
        return heavyAfter === true
          ? null
          : 'Solo se puede declarar en una tarea con carga pesada.';
      };
      /** Venue, heavy load and material: what a subsoil review was for. */
      const placementOf = (t: Json) =>
        JSON.stringify([
          (t.venue as Json | null)?.id ?? null,
          t.heavyLoad ?? null,
          [...((t.resourceIds as string[]) ?? [])].sort(),
        ]);
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
        const resProblem = resourceIdsProblem(input.resourceIds);
        if (resProblem) fields.resourceIds = resProblem;
        const subsoil = subsoilProblem(
          input,
          (input.heavyLoad ?? null) as never,
        );
        if (subsoil) fields.subsoilReviewed = subsoil;
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
            resourceIds: [...new Set((input.resourceIds as string[]) ?? [])],
            subsoilReview:
              input.subsoilReviewed === true ? {by: ref, at: clock()} : null,
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
        return json(route, viewTask(created, user.role), 201);
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
        const resProblem = resourceIdsProblem(input.resourceIds);
        if (resProblem) fields.resourceIds = resProblem;
        const heavyAfter = (
          'heavyLoad' in input ? input.heavyLoad : task.heavyLoad
        ) as boolean | null;
        const subsoil = subsoilProblem(input, heavyAfter);
        if (subsoil) fields.subsoilReviewed = subsoil;
        if (Object.keys(fields).length) return validation(route, fields);
        const placementBefore = placementOf(task);

        if (Array.isArray(input.resourceIds)) {
          task.resourceIds = [...new Set(input.resourceIds as string[])];
        }
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
        // Same rule as nextSubsoilReview (server/src/tasks/domain.ts).
        const placementChanged = placementOf(task) !== placementBefore;
        if (input.subsoilReviewed === false) {
          task.subsoilReview = null;
        } else if (input.subsoilReviewed === true) {
          if (!task.subsoilReview || placementChanged) {
            task.subsoilReview = {by: ref, at: clock()};
          }
        } else if (placementChanged) {
          task.subsoilReview = null;
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
        return json(route, viewTask(task, user.role));
      }
      if (task && method === 'DELETE') {
        const raw = url.searchParams.get('version');
        if (raw === null || raw.trim() === '') {
          return validation(route, {version: VERSION_MISSING});
        }
        if (Number(raw) !== task.version) return taskConflict(route, task);
        state.tasks = state.tasks.filter(t => t !== task);
        unlinkNotes('task', task.id as string, ref);
        // M5: open hypotheses go with it; applied ones keep their label.
        state.hypotheses = state.hypotheses.filter(
          h => h.taskId !== task.id || h.appliedAt,
        );
        for (const h of state.hypotheses) {
          if (h.taskId === task.id) h.taskId = null;
        }
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
