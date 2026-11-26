import {expect, test, type Page, type Route} from '@playwright/test';
import {mockApi as qaMock, signIn as qaSignIn} from './mock-api';
import {fixClock, planData} from './plan-fixtures';
import {followData, openHypothesis} from './followup-fixtures';

/**
 * Visual review harness for the Logistics Manager (milestones 1–5), written by
 * the UI engineer to look at the screens while building them. It mocks the
 * API with page.route, so no server is needed, and only takes screenshots:
 * behavioural assertions belong to the QA suite. The milestone 5 shots reuse
 * the QA mock and its fixed clock (follow-up needs a known «now»).
 *
 * Output: test-results/visual/logistics-<screen>-<palette>.png
 * Run: npx playwright test tests/e2e/logistics/ui-review.spec.ts
 */

const PALETTES = [
  'oxeye',
  'atlas',
  'noctis',
  'territorio',
  'vector',
  'bendy',
] as const;
const OUT = 'test-results/visual';
const ORG = '00000000-0000-4000-8000-000000000001';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Atlantic/Canary',
}).format(new Date());

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Canary winter time is UTC+0; good enough for screenshots.
const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

const elvis = {id: 'u-elvis', displayName: 'Elvis'};
const dailos = {id: 'u-dailos', displayName: 'Dailos'};

function event(
  id: string,
  name: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    venue: null,
    startsAt: null,
    endsAt: null,
    timezone: 'Atlantic/Canary',
    status: 'planned',
    notes: null,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: at(today, '08:10'),
    updatedBy: elvis,
    updatedAt: at(today, '08:10'),
    endDate: null,
    ...extra,
    // The local day mirrors startsAt (UTC+0 in winter) unless given.
    date:
      (extra.date as string | undefined) ??
      (typeof extra.startsAt === 'string' ? extra.startsAt.slice(0, 10) : null),
  };
}

const PLAZA_CRISTO = {id: 'v1', name: 'Plaza del Cristo'};
const PLAZA_ADELANTADO = {id: 'v2', name: 'Plaza del Adelantado'};
const RECINTO = {id: 'v4', name: 'Recinto ferial'};
const ALMACEN = {id: 'v5', name: 'Almacén municipal'};

// Fictitious names only («Demo»): never attach contact details or people to
// names that could be real businesses or municipal units.
const ESCENARIOS = {id: 'c1', name: 'Escenarios Demo'};
const SONIDO = {id: 'c2', name: 'Sonido Demo'};
const VALLAS = {id: 'c3', name: 'Vallas Demo'};

const EVENTS = [
  event('e1', 'Navidad en la Plaza del Cristo', {
    venue: {id: 'v1', name: 'Plaza del Cristo'},
    startsAt: at(today, '17:00'),
    endsAt: at(today, '21:00'),
    status: 'confirmed',
    verification: 'validated',
    source: 'document',
  }),
  event('e2', 'Concierto de villancicos', {
    venue: {id: 'v2', name: 'Plaza del Adelantado'},
    startsAt: at(today, '19:30'),
    endsAt: at(today, '22:00'),
    verification: 'to_verify',
    source: 'reported',
  }),
  event('e3', 'Mercadillo navideño', {
    startsAt: at(addDays(today, 1), '10:00'),
  }),
  event('e4', 'Encendido del alumbrado', {
    venue: {id: 'v3', name: 'Calle de la Herradores'},
    startsAt: at(addDays(today, 3), '18:00'),
    endsAt: at(addDays(today, 3), '19:00'),
    status: 'delayed',
    verification: 'to_verify',
  }),
  event('e5', 'Feria de artesanía', {
    venue: {id: 'v1', name: 'Plaza del Cristo'},
    startsAt: at(addDays(today, 6), '11:00'),
    endsAt: at(addDays(today, 6), '14:00'),
    status: 'cancelled',
    verification: 'validated',
  }),
  event('e6', 'Cabalgata de demostración', {isDemo: true}),
  // Multi-day: bars in the month view, a band in the day view.
  event('e7', 'Feria de Navidad', {
    venue: RECINTO,
    date: addDays(today, -1),
    endDate: addDays(today, 2),
    startsAt: at(addDays(today, -1), '10:00'),
    endsAt: at(addDays(today, 2), '20:00'),
    status: 'confirmed',
    verification: 'validated',
  }),
];

function task(
  id: string,
  title: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    version: 1,
    organizationId: ORG,
    eventId: null,
    venue: null,
    title,
    kind: 'other',
    status: 'planned',
    endDate: null,
    startsAt: null,
    endsAt: null,
    timezone: 'Atlantic/Canary',
    company: null,
    contact: null,
    dependsOn: [],
    heavyLoad: null,
    notes: null,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: at(today, '08:10'),
    updatedBy: dailos,
    updatedAt: at(today, '08:20'),
    ...extra,
    date:
      'date' in extra
        ? extra.date
        : typeof extra.startsAt === 'string'
          ? extra.startsAt.slice(0, 10)
          : today,
  };
}

// Today's plan: a venue overlap and a dependency that starts too early
// (conflicts), heavy load known and unknown, a delivery during a public event
// (routes reminder), an open end, an overnight task, an untimed one, a
// cancelled one, a multi-day one and one without a date.
const TASKS = [
  task('t1', 'Montaje del escenario', {
    eventId: 'e1',
    kind: 'assembly',
    venue: PLAZA_CRISTO,
    startsAt: at(today, '08:00'),
    endsAt: at(today, '13:00'),
    status: 'confirmed',
    company: ESCENARIOS,
    contact: {id: 'p1', name: 'Ana Demo'},
    heavyLoad: true,
    verification: 'validated',
    source: 'document',
  }),
  task('t2', 'Instalación de sonido', {
    eventId: 'e1',
    kind: 'assembly',
    venue: PLAZA_CRISTO,
    startsAt: at(today, '12:00'),
    endsAt: at(today, '15:00'),
    company: SONIDO,
    contact: {id: 'p2', name: 'Bruno Demo'},
    heavyLoad: false,
    dependsOn: ['t1'],
  }),
  task('t3', 'Entrega de vallas', {
    eventId: 'e2',
    kind: 'delivery',
    venue: PLAZA_ADELANTADO,
    startsAt: at(today, '18:00'),
    endsAt: at(today, '19:45'),
    company: VALLAS,
    verification: 'to_verify',
    source: 'reported',
  }),
  task('t4', 'Prueba de luces', {
    eventId: 'e1',
    kind: 'activity',
    venue: PLAZA_CRISTO,
    startsAt: at(today, '16:00'),
    endsAt: at(today, '17:00'),
    status: 'in_progress',
    heavyLoad: false,
  }),
  task('t5', 'Transporte del generador', {
    kind: 'transport',
    startsAt: at(today, '07:00'),
    status: 'delayed',
    company: ESCENARIOS,
    heavyLoad: true,
  }),
  task('t6', 'Revisar extintores', {kind: 'other'}),
  task('t7', 'Desmontaje del escenario', {
    eventId: 'e1',
    kind: 'dismantling',
    venue: PLAZA_CRISTO,
    startsAt: at(today, '22:00'),
    endsAt: at(addDays(today, 1), '01:00'),
    company: ESCENARIOS,
    heavyLoad: true,
    dependsOn: ['t4'],
  }),
  task('t8', 'Recogida de vallas en el almacén', {
    kind: 'transport',
    venue: ALMACEN,
    startsAt: at(today, '10:00'),
    endsAt: at(today, '11:00'),
    status: 'cancelled',
    company: VALLAS,
    heavyLoad: false,
  }),
  task('t9', 'Vigilancia del recinto', {
    eventId: 'e7',
    kind: 'activity',
    venue: RECINTO,
    date: addDays(today, -1),
    endDate: today,
    startsAt: at(addDays(today, -1), '20:00'),
    endsAt: at(today, '08:00'),
    status: 'confirmed',
    heavyLoad: false,
  }),
  task('t10', 'Montaje de casetas', {
    eventId: 'e3',
    kind: 'assembly',
    venue: RECINTO,
    startsAt: at(addDays(today, 1), '08:00'),
    endsAt: at(addDays(today, 1), '12:00'),
    company: ESCENARIOS,
  }),
  task('t11', 'Confirmar grúa con la empresa', {date: null}),
];

// ---- milestone 3: people, companies and catalogue (fictitious data only)
const CATEGORY_NAMES = [
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
const cat = (name: string) =>
  `cat-${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
const CATEGORIES = CATEGORY_NAMES.map(name => ({
  id: cat(name),
  organizationId: ORG,
  scope: 'service',
  name,
  builtIn: true,
}));

const CARPAS = {id: 'c4', name: 'Carpas Demo'};
const FIESTAS = {id: 'c5', name: 'Concejalía Demo'};
const VECINOS = {id: 'c6', name: 'Asociación Vecinal Demo'};

const meta = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  organizationId: ORG,
  source: null,
  verification: 'draft',
  isDemo: false,
  createdBy: elvis,
  createdAt: at(today, '08:00'),
  updatedBy: dailos,
  updatedAt: at(today, '09:15'),
  ...extra,
});

function company(
  ref: {id: string; name: string},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...ref,
    ...meta(),
    kind: 'supplier',
    categoryIds: [],
    phone: null,
    email: null,
    website: null,
    notes: null,
    mainContactId: null,
    contactCount: 0,
    offerCount: 0,
    restricted: false,
    ...extra,
  };
}

const COMPANIES = [
  company(ESCENARIOS, {
    categoryIds: [cat('Montaje'), cat('Estructuras'), cat('Carpas')],
    phone: '+34 000 000 001',
    email: 'escenarios@example.com',
    website: 'https://example.com/escenarios',
    mainContactId: 'p1',
    contactCount: 1,
    offerCount: 2,
    verification: 'validated',
    source: 'document',
    notes: 'Llegan siempre por la calle de atrás.',
  }),
  company(SONIDO, {
    categoryIds: [cat('Sonido'), cat('Iluminación')],
    phone: '000 000 002',
    contactCount: 1,
    offerCount: 1,
    mainContactId: 'p2',
  }),
  company(VALLAS, {
    categoryIds: [cat('Vallas')],
    contactCount: 1,
    offerCount: 1,
  }),
  company(CARPAS, {
    categoryIds: [cat('Carpas')],
    email: 'carpas@example.com',
    offerCount: 2,
    verification: 'to_verify',
  }),
  company(FIESTAS, {
    kind: 'public_body',
    phone: '+34 000 000 004',
    contactCount: 1,
    mainContactId: 'p3',
  }),
  company(VECINOS, {kind: 'association'}),
];

function contact(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    ...meta(),
    name,
    role: null,
    company: null,
    phone: null,
    email: null,
    description: null,
    notes: null,
    eventIds: [],
    restricted: false,
    ...extra,
  };
}

const CONTACTS = [
  contact('p1', 'Ana Demo', {
    role: 'Jefa de montaje',
    company: ESCENARIOS,
    phone: '+34 000 000 001',
    email: 'ana@example.com',
    description: 'Coordina el montaje de escenarios y carpas.',
    notes: 'Prefiere WhatsApp antes de las 9:00.',
    eventIds: ['e1', 'e7'],
    verification: 'validated',
    source: 'reported',
  }),
  contact('p2', 'Bruno Demo', {
    role: 'Técnico de sonido',
    company: SONIDO,
    phone: '000 000 002',
  }),
  contact('p3', 'Carla Demo', {
    role: 'Técnica de cultura',
    company: FIESTAS,
    email: 'carla@example.com',
    verification: 'to_verify',
  }),
  contact('p4', 'Diego Demo'),
  contact('p5', 'Elena Demo', {
    role: 'Responsable de almacén',
    company: VALLAS,
    phone: '+34 000 000 005',
  }),
  contact('p6', 'Óscar Demo', {
    role: 'Voluntario',
    company: VECINOS,
    phone: '+34 000 000 006',
  }),
];

function offer(
  id: string,
  name: string,
  by: {id: string; name: string},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    ...meta(),
    company: by,
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
    ...extra,
  };
}

const OFFERS = [
  offer('o1', 'Carpa 6 × 3 m', CARPAS, {
    categoryId: cat('Carpas'),
    price: 180,
    unit: 'day',
    transportCost: 60,
    vatIncluded: false,
    conditions: 'Mínimo dos días. Montaje incluido en la Plaza del Cristo.',
    verification: 'validated',
    source: 'document',
  }),
  offer('o2', 'Carpa 6 × 3 m reforzada', ESCENARIOS, {
    categoryId: cat('Carpas'),
    price: 210.5,
    unit: 'day',
    assemblyCost: 90,
    vatIncluded: true,
  }),
  offer('o3', 'Carpa 3 × 3 m', CARPAS, {
    categoryId: cat('Carpas'),
    unit: 'day',
  }),
  offer('o4', 'Valla tipo ayuntamiento', VALLAS, {
    categoryId: cat('Vallas'),
    price: 4.2,
    transportCost: 120,
    assemblyCost: 0,
    maintenanceCost: null,
  }),
  offer('o5', 'Escenario modular 8 × 6 m', ESCENARIOS, {
    categoryId: cat('Estructuras'),
    price: 1250,
    unit: 'custom',
    customUnit: 'montaje',
    transportCost: 300,
    assemblyCost: 400,
    maintenanceCost: 0,
    vatIncluded: false,
  }),
  offer('o6', 'Equipo de sonido 2 kW', SONIDO, {
    categoryId: cat('Sonido'),
    price: 450,
    unit: 'day',
    vatIncluded: true,
    maintenanceCost: 40,
  }),
];

const RECENT = [
  {query: 'carpas', at: new Date(Date.now() - 20 * 60_000).toISOString()},
  {query: 'Ana', at: new Date(Date.now() - 3 * 3600_000).toISOString()},
  {
    query: 'Plaza del Cristo',
    at: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
];

// ---- milestone 4: warehouses, resources and notes (fictitious data only)
const RESOURCE_CATEGORY_NAMES = [
  'Carpas',
  'Vallas',
  'Mesas',
  'Sillas y bancos',
  'Escenarios y tarimas',
  'Vehículos',
  'Generadores y electricidad',
  'Sonido e iluminación',
  'Señalización',
  'Otros materiales',
];
const rcat = (name: string) => `r${cat(name)}`;
const RESOURCE_CATEGORIES = RESOURCE_CATEGORY_NAMES.map(name => ({
  id: rcat(name),
  organizationId: ORG,
  scope: 'resource',
  name,
  builtIn: true,
}));

const NORTE = {id: 'w1', name: 'Almacén Demo Norte'};
const SUR = {id: 'w2', name: 'Almacén Demo Sur'};
const ALQUILERES = {id: 'c7', name: 'Alquileres Demo'};

const WAREHOUSES = [
  {
    ...NORTE,
    ...meta({verification: 'validated'}),
    address: 'Calle Ficticia Demo, 1',
    notes: 'La llave la tiene el conserje.',
    resourceCount: 3,
    restricted: false,
  },
  {
    ...SUR,
    ...meta(),
    address: null,
    notes: null,
    resourceCount: 1,
    restricted: false,
  },
];

function resource(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    ...meta(),
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
    ...extra,
  };
}

const RESOURCES = [
  resource('r1', 'Carpa 3 × 6 Demo', {
    categoryId: rcat('Carpas'),
    warehouse: NORTE,
    quantity: 4,
    dimensions: '3 × 6 m',
    condition: 'good',
    availability: 'available',
    location: 'Nave 2, estantería 3',
    notes: 'Falta una piqueta.',
    verification: 'validated',
    source: 'observed',
    taskIds: ['t1'],
  }),
  resource('r2', 'Vallas Demo', {
    categoryId: rcat('Vallas'),
    warehouse: NORTE,
    quantity: 200,
    condition: 'fair',
    availability: 'available',
  }),
  resource('r7', 'Tarima modular Demo', {
    categoryId: rcat('Escenarios y tarimas'),
    warehouse: NORTE,
    quantity: 12,
    unit: 'juegos',
    dimensions: '1 × 2 m',
    condition: 'damaged',
    availability: 'maintenance',
  }),
  resource('r3', 'Mesas plegables Demo', {
    categoryId: rcat('Mesas'),
    warehouse: SUR,
    quantity: 40,
    toAssess: true,
  }),
  resource('r4', 'Furgoneta Demo', {
    categoryId: rcat('Vehículos'),
    quantity: 1,
    condition: 'good',
    availability: 'available',
  }),
  resource('r5', 'Aseos portátiles Demo', {
    ownership: 'contracted',
    company: ALQUILERES,
    quantity: 6,
  }),
  resource('r6', 'Generador Demo', {
    ownership: 'contracted',
    categoryId: rcat('Generadores y electricidad'),
  }),
];

function note(
  id: string,
  kind: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    ...meta(),
    kind,
    text,
    event: null,
    ref: null,
    resolved: false,
    restricted: false,
    ...extra,
  };
}

const NOTES = [
  note('n1', 'incident', 'La furgoneta no arranca; buscamos otra.', {
    createdAt: at(addDays(today, -1), '16:00'),
    createdBy: dailos,
    event: {id: 'e1', name: 'Navidad en la Plaza del Cristo'},
    ref: {type: 'resource', id: 'r4', label: 'Furgoneta Demo'},
  }),
  note('n2', 'open_question', '¿Quién abre el almacén el sábado?', {
    createdAt: at(addDays(today, -2), '12:00'),
    ref: {type: 'warehouse', id: 'w1', label: NORTE.name},
  }),
  note('n3', 'note', 'Revisar las lonas antes de cargar.', {
    createdAt: at(today, '09:00'),
    ref: {type: 'resource', id: 'r1', label: 'Carpa 3 × 6 Demo'},
  }),
  note('n4', 'decision', 'Las vallas salen a las 12 desde el almacén norte.', {
    createdAt: at(today, '10:00'),
    createdBy: dailos,
    event: {id: 'e1', name: 'Navidad en la Plaza del Cristo'},
  }),
];

const HISTORY = [
  {
    id: 'h2',
    user: dailos,
    entityType: 'resource',
    entityId: 'r1',
    entityLabel: 'Carpa 3 × 6 Demo',
    action: 'update',
    changedFields: ['quantity', 'condition'],
    at: new Date(Date.now() - 40 * 60_000).toISOString(),
  },
  {
    id: 'h1',
    user: elvis,
    entityType: 'resource',
    entityId: 'r1',
    entityLabel: 'Carpa 3 × 6 Demo',
    action: 'create',
    changedFields: [],
    at: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
];

/** What a guest receives: same records, details withheld (server redact). */
const asGuest = {
  event: (e: Record<string, unknown>) => ({
    ...e,
    notes: null,
    restricted: true,
  }),
  task: (t: Record<string, unknown>) => ({...t, notes: null, restricted: true}),
  warehouse: (w: Record<string, unknown>) => ({
    ...w,
    address: null,
    notes: null,
    restricted: true,
  }),
  resource: (r: Record<string, unknown>) => ({
    ...r,
    location: null,
    notes: null,
    restricted: true,
  }),
  note: (n: Record<string, unknown>) => ({...n, text: null, restricted: true}),
  company: (c: Record<string, unknown>) => ({
    ...c,
    phone: null,
    email: null,
    notes: null,
    restricted: true,
  }),
  contact: (c: Record<string, unknown>) => ({
    ...c,
    phone: null,
    email: null,
    description: null,
    notes: null,
    restricted: true,
  }),
  offer: (o: Record<string, unknown>) => ({
    ...o,
    price: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    conditions: null,
    restricted: true,
  }),
};

const ACTIVITY = [
  {
    id: 'a1',
    user: dailos,
    entityType: 'event',
    entityId: 'e2',
    entityLabel: 'Concierto de villancicos',
    action: 'update',
    changedFields: ['startsAt', 'endsAt', 'venueName'],
    at: new Date(Date.now() - 6 * 60_000).toISOString(),
  },
  {
    id: 'a2',
    user: elvis,
    entityType: 'event',
    entityId: 'e1',
    entityLabel: 'Navidad en la Plaza del Cristo',
    action: 'create',
    changedFields: [],
    at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
];

interface MockOptions {
  role?: 'member' | 'guest';
  health?: 'ok' | 'down';
  events?: unknown[];
  tasks?: unknown[];
  conflict?: boolean;
  /** false: no people, companies or offers yet. */
  directory?: boolean;
  /** false: no warehouses, resources or notes yet (milestone 4). */
  inventory?: boolean;
}

async function mockApi(page: Page, opts: MockOptions = {}) {
  const role = opts.role ?? 'member';
  const user = {
    id: 'u-1',
    displayName: role === 'guest' ? 'Invitado' : 'Elvis',
    role,
  };
  const orgs = [
    {id: ORG, name: 'Ayuntamiento de La Laguna', timezone: 'Atlantic/Canary'},
  ];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  // Match the API only, not Vite module URLs such as /src/logistics/api/*.
  await page.route(
    u => u.pathname.startsWith('/api/'),
    async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, '');
      const method = route.request().method();
      if (path === '/health') {
        if (opts.health === 'down') return route.abort('connectionrefused');
        return json(route, {status: 'ok', database: 'ok', version: 'test'});
      }
      if (path === '/auth/users') {
        return json(route, {
          items: [
            {displayName: 'Elvis', role: 'member'},
            {displayName: 'Dailos', role: 'member'},
            {displayName: 'Yeray', role: 'member'},
            {displayName: 'Equipo', role: 'member'},
            {displayName: 'Invitado', role: 'guest'},
          ],
        });
      }
      if (path === '/auth/login') {
        return json(route, {
          token: 'test-token',
          expiresAt: new Date(Date.now() + 86400_000).toISOString(),
          user,
          organizations: orgs,
        });
      }
      if (path === '/me') return json(route, {user, organizations: orgs});
      const guest = role === 'guest';
      if (path.endsWith('/events') && method === 'GET') {
        const items = (opts.events ?? EVENTS) as Record<string, unknown>[];
        return json(route, {items: guest ? items.map(asGuest.event) : items});
      }
      if (path.endsWith('/tasks') && method === 'GET') {
        const items = ((opts.tasks ?? TASKS) as Record<string, unknown>[]).map(
          t => ({resourceIds: [], ...t}),
        );
        return json(route, {items: guest ? items.map(asGuest.task) : items});
      }
      const noStock = opts.inventory === false;
      if (path.endsWith('/warehouses') && method === 'GET') {
        return json(route, {
          items: noStock
            ? []
            : guest
              ? WAREHOUSES.map(asGuest.warehouse)
              : WAREHOUSES,
        });
      }
      if (path.endsWith('/resources') && method === 'GET') {
        return json(route, {
          items: noStock
            ? []
            : guest
              ? RESOURCES.map(asGuest.resource)
              : RESOURCES,
        });
      }
      if (path.endsWith('/notes') && method === 'GET') {
        return json(route, {
          items: noStock ? [] : guest ? NOTES.map(asGuest.note) : NOTES,
        });
      }
      const none = opts.directory === false;
      if (path.endsWith('/companies') && method === 'GET') {
        return json(route, {
          items: none ? [] : guest ? COMPANIES.map(asGuest.company) : COMPANIES,
        });
      }
      if (path.endsWith('/categories') && method === 'GET') {
        return json(route, {items: [...CATEGORIES, ...RESOURCE_CATEGORIES]});
      }
      if (path.endsWith('/contacts') && method === 'GET') {
        return json(route, {
          items: none ? [] : guest ? CONTACTS.map(asGuest.contact) : CONTACTS,
        });
      }
      if (path.endsWith('/offers') && method === 'GET') {
        return json(route, {
          items: none ? [] : guest ? OFFERS.map(asGuest.offer) : OFFERS,
        });
      }
      if (path.endsWith('/recent-searches')) {
        if (method === 'GET') return json(route, {items: guest ? [] : RECENT});
        if (method === 'POST') return json(route, {items: RECENT});
        return route.fulfill({status: 204, body: ''});
      }
      if (path.endsWith('/venues')) {
        return json(route, {
          items: [PLAZA_CRISTO, PLAZA_ADELANTADO, RECINTO, ALMACEN],
        });
      }
      if (path.endsWith('/activity')) {
        const entityId = url.searchParams.get('entityId');
        if (entityId) {
          return json(route, {
            items: HISTORY.filter(h => h.entityId === entityId),
          });
        }
        return json(route, {items: opts.events?.length === 0 ? [] : ACTIVITY});
      }
      if (path.startsWith('/events/') && method === 'PATCH' && opts.conflict) {
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: 'Otra persona ha cambiado este evento.',
            current: {
              ...EVENTS[1],
              version: 2,
              updatedBy: dailos,
              updatedAt: new Date(Date.now() - 60_000).toISOString(),
            },
          },
          409,
        );
      }
      return json(route, {code: 'NOT_FOUND', message: 'No encontrado'}, 404);
    },
  );
}

async function signIn(page: Page, name = 'Elvis') {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/#logistica');
  await page.locator(`.lx-person[data-name="${name}"]`).click();
  await page.locator('#lx-login-password').fill('secreto');
  await page.locator('#lx-login-submit').click();
  await expect(page.locator('#lx-title')).toBeVisible();
}

async function capture(page: Page, screen: string) {
  // Without this, colour transitions blend the previous palette into the shot.
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(400);
    await page.screenshot({path: `${OUT}/logistics-${screen}-${id}.png`});
  }
}

const PHONE = {width: 390, height: 844};

/** Changes the hash in place, keeping the signed-in session. */
async function goToHash(page: Page, hash: string) {
  await page.evaluate(h => {
    window.location.hash = h;
  }, hash);
}

/** Scrolls the day timeline to an hour, so shots do not depend on the clock. */
async function scrollTimelineTo(page: Page, hour: number) {
  // Let the timeline's own first scroll (to now or the first task) happen.
  await page.waitForTimeout(150);
  await page.evaluate(h => {
    const el = document.querySelector<HTMLElement>('.lx-tl__scroller');
    if (!el) return;
    const px = parseFloat(
      getComputedStyle(el).getPropertyValue('--lx-hour') || '64',
    );
    el.scrollTop = h * px;
  }, hour);
}

// Native date and time inputs follow the browser locale; show what users see.
test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
// Each capture is six palettes; tests with several captures need the time.
test.describe.configure({timeout: 120_000});

test.describe('Gestor logístico · revisión visual', () => {
  test('server unreachable', async ({page}) => {
    await mockApi(page, {health: 'down'});
    await page.goto('/#logistica');
    await expect(page.locator('#lx-gate-unreachable')).toBeVisible();
    await capture(page, 'unreachable');
  });

  test('login people and password', async ({page}) => {
    await mockApi(page);
    await page.goto('/#logistica');
    await expect(page.locator('#lx-login-users')).toBeVisible();
    await capture(page, 'login');
    await page.locator('.lx-person[data-name="Elvis"]').click();
    await capture(page, 'password');
  });

  test('hoy desktop', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await expect(page.locator('#lx-verified')).toBeVisible();
    await expect(page.locator('#lx-warnings')).toBeVisible();
    await capture(page, 'hoy-desktop');
    await page.locator('#lx-today-tasks').scrollIntoViewIfNeeded();
    await page.locator('#lx-today-tasks').evaluate(el => el.scrollIntoView());
    await capture(page, 'hoy-desktop-lower');
  });

  test('hoy tablet', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await mockApi(page);
    await signIn(page);
    await expect(page.locator('#lx-verified')).toBeVisible();
    await capture(page, 'hoy-tablet');
  });

  test('hoy phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    await expect(page.locator('#lx-fab')).toBeVisible();
    await capture(page, 'hoy-phone');
  });

  test('hoy empty phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, {events: [], tasks: []});
    await signIn(page);
    await expect(page.locator('#lx-today-empty')).toBeVisible();
    await capture(page, 'hoy-empty-phone');
  });

  test('guest phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, {role: 'guest'});
    await signIn(page, 'Invitado');
    await expect(page.locator('#lx-readonly')).toBeVisible();
    await capture(page, 'guest-phone');
  });

  test('new event sheet desktop and phone', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-add').click();
    await expect(page.locator('#lx-add-task')).toBeVisible();
    await capture(page, 'add-menu');
    await page.locator('#lx-add-event').click();
    await expect(page.locator('#lx-event-form')).toBeVisible();
    await page.locator('#lx-event-save').click();
    await capture(page, 'sheet-desktop');
    await page.setViewportSize(PHONE);
    await capture(page, 'sheet-phone');
  });

  test('conflict', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page, {conflict: true});
    await signIn(page);
    await page.locator('[data-event-id="e2"] .lx-event__action').click();
    await page.locator('#lx-event-notes').fill('Confirmar sonido');
    await page.locator('#lx-event-save').click();
    await expect(page.locator('#lx-event-conflict')).toBeVisible();
    await capture(page, 'conflict');
  });

  test('calendar month desktop and phone', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/calendario');
    await expect(page.locator('#lx-month')).toBeVisible();
    await capture(page, 'calendar-month-desktop');
    await page.setViewportSize(PHONE);
    await capture(page, 'calendar-month-phone');
  });

  test('calendar day timeline desktop', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, `#logistica/calendario/${today}`);
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await scrollTimelineTo(page, 7);
    await capture(page, 'calendar-day-desktop');
  });

  test('calendar day tablet', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, `#logistica/calendario/${today}`);
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await scrollTimelineTo(page, 7);
    await capture(page, 'calendar-day-tablet');
  });

  test('calendar day phone portrait list', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    await goToHash(page, `#logistica/calendario/${today}`);
    await expect(page.locator('#lx-hour-list')).toBeVisible();
    await capture(page, 'calendar-day-phone');
    await page.locator('#lx-hour-list').scrollIntoViewIfNeeded();
    await capture(page, 'calendar-day-phone-list');
  });

  test('calendar day phone landscape timeline', async ({page}) => {
    await page.setViewportSize({width: 844, height: 390});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, `#logistica/calendario/${today}`);
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await scrollTimelineTo(page, 7);
    await capture(page, 'calendar-day-landscape');
  });

  test('task sheet desktop and phone', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, `#logistica/calendario/${today}`);
    await scrollTimelineTo(page, 7);
    await page.locator('#lx-timeline [data-task-id="t2"]').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await capture(page, 'task-sheet-desktop');
    await page.locator('#lx-task-title').focus();
    await page.locator('#lx-task-deps').scrollIntoViewIfNeeded();
    await capture(page, 'task-sheet-desktop-lower');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-task-title').scrollIntoViewIfNeeded();
    await capture(page, 'task-sheet-phone');
  });

  test('new task sheet phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-fab').click();
    await page.locator('#lx-fab-task').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    // No `force`: wait until the sheet has settled and the option takes it.
    await page.locator('#lx-task-kind-delivery').check();
    await capture(page, 'task-new-phone');
  });

  test('placeholder phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    // Inventarios is real since milestone 4; «Cierre de jornada» remains.
    await goToHash(page, '#logistica/cierre');
    await expect(page.locator('#lx-space-cierre')).toBeVisible();
    await capture(page, 'placeholder-phone');
  });
});

test.describe('Gestor logístico · contactos y catálogo', () => {
  test('contactos desktop: people and companies', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/contactos');
    await expect(page.locator('#lx-space-contactos .lx-dirrow')).toHaveCount(6);
    await capture(page, 'contacts-people-desktop');
    await page.locator('#lx-contacts-tab-companies').click();
    await expect(page.locator('[data-company-id="c1"]')).toBeVisible();
    await capture(page, 'contacts-companies-desktop');
    await page.locator('#lx-contacts-search').fill('sonido');
    await capture(page, 'contacts-search-desktop');
  });

  test('contactos phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-tab-contactos').click();
    await expect(page.locator('[data-contact-id="p1"]')).toBeVisible();
    await capture(page, 'contacts-people-phone');
    await page.locator('#lx-contacts-tab-companies').click();
    await capture(page, 'contacts-companies-phone');
  });

  test('contactos empty', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, {directory: false});
    await signIn(page);
    await page.locator('#lx-tab-contactos').click();
    await expect(page.locator('#lx-contacts-empty')).toBeVisible();
    await capture(page, 'contacts-empty-phone');
  });

  test('contact sheet, reach out and share (desktop)', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/contactos');
    await page.locator('[data-contact-id="p1"] .lx-dirrow__main').click();
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    await capture(page, 'contact-sheet-desktop');
    await page.locator('#lx-contact-reach-call').click();
    await expect(page.locator('#lx-reach-sheet')).toBeVisible();
    await capture(page, 'reach-call-desktop');
    await page.locator('#lx-reach-cancel').click();
    await page.locator('#lx-contact-share').click();
    await expect(page.locator('#lx-share-sheet')).toBeVisible();
    await capture(page, 'share-sheet-desktop');
    await page.keyboard.press('Escape');
    await page.locator('#lx-contact-edit').click();
    await expect(page.locator('#lx-contact-form')).toBeVisible();
    await capture(page, 'contact-form-desktop');
  });

  test('contact without prefix: WhatsApp explained', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/contactos');
    await page.locator('[data-contact-id="p2"] .lx-dirrow__main').click();
    await page.locator('#lx-contact-reach-whatsapp').click();
    await expect(page.locator('#lx-reach-sheet')).toBeVisible();
    await capture(page, 'reach-whatsapp-noprefix');
  });

  test('company sheet desktop and look-alike', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/contactos');
    await page.locator('#lx-contacts-tab-companies').click();
    await page.locator('[data-company-id="c1"] .lx-dirrow__main').click();
    await expect(page.locator('#lx-company-sheet')).toBeVisible();
    await capture(page, 'company-sheet-desktop');
    await page.locator('#lx-company-people-title').scrollIntoViewIfNeeded();
    await capture(page, 'company-sheet-desktop-lower');
    await page.keyboard.press('Escape');
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-company-name').fill('Escenarios Dmo');
    await expect(page.locator('.lx-lookalike')).toBeVisible();
    await capture(page, 'company-form-lookalike');
  });

  test('catálogo desktop with filter', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/catalogo');
    await expect(page.locator('.lx-offerrow')).toHaveCount(6);
    await capture(page, 'catalog-desktop');
    await page
      .locator(`#lx-catalog-filters [data-category-id="${cat('Carpas')}"]`)
      .click();
    await expect(page.locator('.lx-offerrow')).toHaveCount(3);
    await capture(page, 'catalog-filter-desktop');
  });

  test('catálogo phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-tab-catalogo').click();
    await expect(page.locator('.lx-offerrow').first()).toBeVisible();
    await capture(page, 'catalog-phone');
  });

  test('offer sheet with comparison and form', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/catalogo');
    await page.locator('[data-offer-id="o1"]').click();
    await expect(page.locator('#lx-offer-sheet')).toBeVisible();
    await capture(page, 'offer-sheet-desktop');
    await page.locator('#lx-offer-compare').scrollIntoViewIfNeeded();
    await capture(page, 'offer-sheet-compare');
    await page.locator('#lx-offer-edit').click();
    await expect(page.locator('#lx-offer-form')).toBeVisible();
    await capture(page, 'offer-form-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-offer-price').scrollIntoViewIfNeeded();
    await capture(page, 'offer-form-phone');
  });

  test('search sheet: recents and results', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-main').click({position: {x: 5, y: 5}});
    await page.keyboard.press('/');
    await expect(page.locator('#lx-search-sheet')).toBeVisible();
    await expect(page.locator('#lx-search-recent .lx-recent__row')).toHaveCount(
      3,
    );
    await capture(page, 'search-recent-desktop');
    await page.locator('#lx-search-input').fill('carpa');
    await page.keyboard.press('ArrowDown');
    await capture(page, 'search-results-desktop');
    await page.locator('#lx-search-input').fill('zzzz');
    await expect(page.locator('#lx-search-noresults')).toBeVisible();
    await capture(page, 'search-noresults-desktop');
  });

  test('search sheet phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-search-phone').click();
    await page.locator('#lx-search-input').fill('ana');
    await capture(page, 'search-phone');
  });

  test('task with contact person', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, `#logistica/calendario/${today}`);
    await scrollTimelineTo(page, 7);
    await page.locator('#lx-timeline [data-task-id="t1"]').click();
    await expect(page.locator('#lx-task-contact')).toBeVisible();
    await page.locator('#lx-task-contact').scrollIntoViewIfNeeded();
    await capture(page, 'task-contact-desktop');
  });

  test('guest: contact, company and offer withheld', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, {role: 'guest'});
    await signIn(page, 'Invitado');
    await page.locator('#lx-tab-contactos').click();
    await capture(page, 'guest-contacts-phone');
    await page.locator('[data-contact-id="p1"] .lx-dirrow__main').click();
    await expect(page.locator('#lx-contact-reach-withheld')).toBeVisible();
    await capture(page, 'guest-contact-sheet');
    await page.keyboard.press('Escape');
    await page.locator('#lx-tab-catalogo').click();
    await capture(page, 'guest-catalog-phone');
    await page.locator('[data-offer-id="o1"]').click();
    await expect(page.locator('#lx-offer-sheet')).toBeVisible();
    await capture(page, 'guest-offer-sheet');
  });
});

test.describe('Gestor logístico · inventarios y captura rápida', () => {
  test('inventarios: propios, contratados and empty (desktop and phone)', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/inventarios');
    await expect(page.locator('[data-resource-id="r1"]')).toBeVisible();
    await capture(page, 'inventory-owned-desktop');
    await page.locator('#lx-inventory-tab-contracted').click();
    await expect(page.locator('[data-resource-id="r5"]')).toBeVisible();
    await capture(page, 'inventory-contracted-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-inventory-tab-owned').click();
    await capture(page, 'inventory-owned-phone');
    await page.locator('#lx-inventory-tab-contracted').click();
    await capture(page, 'inventory-contracted-phone');
  });

  test('inventarios empty phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, {inventory: false});
    await signIn(page);
    await page.locator('#lx-tab-inventarios').click();
    await page.locator('#lx-inventory-tab-owned').click();
    await expect(page.locator('#lx-inventory-empty')).toBeVisible();
    await capture(page, 'inventory-empty-phone');
  });

  test('resource sheet view and form, warehouse sheet', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await mockApi(page);
    await signIn(page);
    await goToHash(page, '#logistica/inventarios');
    await page.locator('#lx-inventory-tab-owned').click();
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-sheet')).toBeVisible();
    await capture(page, 'resource-sheet-desktop');
    await page.locator('#lx-resource-history-toggle').click();
    await expect(
      page.locator('#lx-resource-history .lx-history__item'),
    ).toHaveCount(2);
    await page.locator('#lx-resource-history').scrollIntoViewIfNeeded();
    await capture(page, 'resource-sheet-history');
    await page.locator('#lx-resource-edit').click();
    await expect(page.locator('#lx-resource-form')).toBeVisible();
    await capture(page, 'resource-form-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-resource-quantity').scrollIntoViewIfNeeded();
    await capture(page, 'resource-form-phone');
    await page.locator('#lx-resource-unit').fill('kg');
    await expect(page.locator('#lx-resource-load-note')).toBeVisible();
    await page.locator('#lx-resource-load-note').scrollIntoViewIfNeeded();
    await capture(page, 'resource-form-loadnote-phone');
    await page.locator('#lx-resource-cancel').click();
    await page.locator('#lx-resource-discard-confirm').click();
    await page.setViewportSize({width: 1280, height: 900});
    await page.keyboard.press('Escape');
    await page.locator('[data-warehouse-id="w1"] .lx-whgroup__open').click();
    await expect(page.locator('#lx-warehouse-sheet')).toBeVisible();
    await capture(page, 'warehouse-sheet-desktop');
    await page.setViewportSize(PHONE);
    await capture(page, 'warehouse-sheet-phone');
  });

  test('incident form, filled Hoy notes card and grouped add menu', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockApi(page);
    await signIn(page);
    await expect(page.locator('#lx-hoy-notes [data-note-id]')).toHaveCount(4);
    await page.locator('#lx-hoy-notes').scrollIntoViewIfNeeded();
    await capture(page, 'hoy-notes-desktop');
    await page.locator('#lx-add').click();
    await expect(page.locator('#lx-add-incident')).toBeFocused();
    await capture(page, 'add-menu-grouped-desktop');
    await page.locator('#lx-add-incident').click();
    await expect(page.locator('#lx-note-scope')).toBeVisible();
    await capture(page, 'incident-form-desktop');
    await page.keyboard.press('Escape');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-hoy-notes').scrollIntoViewIfNeeded();
    await capture(page, 'hoy-notes-phone');
    await page.locator('#lx-fab').click();
    await expect(page.locator('#lx-fab-incident')).toBeFocused();
    await capture(page, 'add-menu-grouped-phone');
    await page.locator('#lx-fab-incident').click();
    await expect(page.locator('#lx-note-scope')).toBeVisible();
    await capture(page, 'incident-form-phone');
  });

  test('note sheet and inventory as the guest', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, {role: 'guest'});
    await signIn(page, 'Invitado');
    await page
      .locator('#lx-hoy-notes [data-note-id="n1"] .lx-noteitem__open')
      .click();
    await expect(page.locator('#lx-note-sheet')).toBeVisible();
    await capture(page, 'guest-note-sheet');
    await page.keyboard.press('Escape');
    await page.locator('#lx-tab-inventarios').click();
    await page.locator('#lx-inventory-tab-owned').click();
    await capture(page, 'guest-inventory-phone');
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-sheet')).toBeVisible();
    await capture(page, 'guest-resource-sheet');
  });

  test('task form with resources and a resource conflict in Avisos', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    // The only van in two overlapping tasks (t1 08:00–13:00, t2 12:00–15:00).
    const tasks = TASKS.map(t =>
      t.id === 't1' || t.id === 't2' ? {...t, resourceIds: ['r4']} : t,
    );
    await mockApi(page, {tasks});
    await signIn(page);
    const conflict = page.locator(
      '#lx-warnings [data-warning="resource_overlap"]',
    );
    await expect(conflict).toBeVisible();
    await page.locator('#lx-warnings').scrollIntoViewIfNeeded();
    await capture(page, 'resource-conflict-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-warnings').scrollIntoViewIfNeeded();
    await capture(page, 'resource-conflict-phone');
    await page.setViewportSize({width: 1280, height: 900});
    await goToHash(page, `#logistica/calendario/${today}`);
    await scrollTimelineTo(page, 7);
    await page.locator('#lx-timeline [data-task-id="t1"]').click();
    await expect(page.locator('#lx-task-resources')).toBeVisible();
    await page.locator('#lx-task-resources').scrollIntoViewIfNeeded();
    await capture(page, 'task-resources-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-task-resources').scrollIntoViewIfNeeded();
    await capture(page, 'task-resources-phone');
  });
});

test.describe('Gestor logístico · seguimiento y órdenes de trabajo', () => {
  // Fixed clock at 10:30 with the follow-up plan (followup-fixtures.ts).
  test.beforeEach(async ({page}) => fixClock(page));
  const DESKTOP = {width: 1280, height: 900};

  test('la jornada with late rows, desktop and phone', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await qaMock(page, followData());
    await qaSignIn(page);
    await expect(page.locator('#lx-day-late')).toBeVisible();
    await capture(page, 'jornada-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-today-tasks').scrollIntoViewIfNeeded();
    await capture(page, 'jornada-phone');
  });

  test('hypothesis sheet with results, apply confirmation', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await qaMock(page, followData());
    await qaSignIn(page);
    await page.locator('#lx-quick-delay-h1').click();
    await page.locator('#lx-hypo-minutes').fill('120');
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    await expect(page.locator('#lx-hypo-summary')).toContainText('2 h');
    await capture(page, 'hypothesis-desktop');
    await page.locator('#lx-hypo-apply').click();
    await expect(page.locator('#lx-hypo-confirm')).toBeVisible();
    await capture(page, 'hypothesis-confirm-desktop');
    await page.locator('#lx-hypo-back').click();
    await page.setViewportSize(PHONE);
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    await capture(page, 'hypothesis-phone');
  });

  test('saved hypothesis chip in Hoy (phone)', async ({page}) => {
    await page.setViewportSize(PHONE);
    await qaMock(page, followData({hypotheses: [openHypothesis()]}));
    await qaSignIn(page);
    await expect(page.locator('[id^="lx-hypo-chip-"]').first()).toBeVisible();
    await page.locator('#lx-today-tasks').scrollIntoViewIfNeeded();
    await capture(page, 'hypothesis-chip-phone');
  });

  test('work order with preview (desktop), print copy and send (phone)', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await qaMock(page, followData());
    await qaSignIn(page, 'Elvis', '#logistica/contactos');
    await page.locator('#lx-contacts-tab-companies').click();
    await page.locator('[data-company-id="c1"] .lx-dirrow__main').click();
    await page.locator('#lx-company-work-order').click();
    await expect(page.locator('#lx-order-preview')).toBeVisible();
    await capture(page, 'order-desktop');
    await page.locator('#lx-order-field-observations').check();
    await page.locator('#lx-order-field-contactPhone').check();
    await page.locator('#lx-order-preview').scrollIntoViewIfNeeded();
    await capture(page, 'order-desktop-extra');
    // What goes on paper.
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.locator('#lx-order-print').click();
    await page.emulateMedia({media: 'print'});
    await page.screenshot({
      path: `${OUT}/logistics-order-print-oxeye.png`,
      fullPage: true,
    });
    await page.emulateMedia({media: 'screen'});
    await page.setViewportSize(PHONE);
    await page.locator('#lx-order-send').click();
    await expect(page.locator('#lx-order-send-sheet')).toBeVisible();
    await capture(page, 'order-send-phone');
  });

  test('send sheet for a person without phone (phone)', async ({page}) => {
    await page.setViewportSize(PHONE);
    await qaMock(page, followData());
    await qaSignIn(page, 'Elvis', '#logistica/contactos');
    await page.locator('[data-contact-id="p2"] .lx-dirrow__main').click();
    await page.locator('#lx-contact-work-order').click();
    await page.locator('#lx-order-send').click();
    await expect(page.locator('#lx-order-send-whatsapp')).toBeDisabled();
    await capture(page, 'order-send-nophone-phone');
  });

  test('merge notice with a clash and the subsoil note', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    const api = await qaMock(page, planData());
    await qaSignIn(page);
    await page.locator('#lx-today-tasks [data-task-id="t1"]').click();
    await page.locator('#lx-task-subsoil-reviewed').check();
    await page
      .locator('#lx-task-notes')
      .fill('Prueba: revisado en el simulador');
    api.editTaskOnServer('t1', {
      venue: {id: 'v2', name: 'Plaza del Adelantado'},
      notes: 'Prueba: grúa a las 9',
    });
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-conflict')).toBeFocused();
    await expect(page.locator('#lx-task-clash-notes')).toBeVisible();
    await capture(page, 'merge-desktop');
    await page.setViewportSize(PHONE);
    await page.locator('#lx-task-conflict').scrollIntoViewIfNeeded();
    await capture(page, 'merge-phone');
  });

  test('subsoil field: empty, declared and stale', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await qaMock(page, followData());
    await qaSignIn(page);
    // h1 was declared by Dailos at 08:45.
    await page.locator('#lx-today-tasks [data-task-id="h1"]').click();
    await page.locator('#lx-task-subsoil').scrollIntoViewIfNeeded();
    await capture(page, 'subsoil-declared');
    await page.locator('#lx-task-venue').fill('Plaza del Adelantado');
    await expect(page.locator('#lx-task-subsoil')).toHaveClass(/is-stale/);
    await page.locator('#lx-task-subsoil').scrollIntoViewIfNeeded();
    await capture(page, 'subsoil-stale');
  });
});

test.describe('Gestor logístico · llamar desde el móvil', () => {
  test.use({hasTouch: true, isMobile: true, viewport: PHONE});

  test('reach out on a touch phone', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-tab-contactos').click();
    await page.locator('[data-contact-id="p1"] .lx-dirrow__main').click();
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    await capture(page, 'contact-sheet-phone');
    await page.locator('#lx-contact-reach-call').click();
    await expect(page.locator('#lx-reach-sheet')).toBeVisible();
    await capture(page, 'reach-call-phone');
  });
});
