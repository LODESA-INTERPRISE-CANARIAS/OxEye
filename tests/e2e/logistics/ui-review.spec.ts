import {expect, test, type Page, type Route} from '@playwright/test';

/**
 * Visual review harness for the Logistics Manager (milestone 1), written by
 * the UI engineer to look at the screens while building them. It mocks the
 * API with page.route, so no server is needed, and only takes screenshots:
 * behavioural assertions belong to the QA suite.
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

const ESCENARIOS = {id: 'c1', name: 'Escenarios Teide'};
const SONIDO = {id: 'c2', name: 'Sonido Atlántico'};
const VALLAS = {id: 'c3', name: 'Vallas Canarias'};

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

const COMPANIES = [ESCENARIOS, SONIDO, VALLAS].map(c => ({
  ...c,
  version: 1,
  organizationId: ORG,
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
  createdAt: at(today, '08:00'),
  updatedBy: elvis,
  updatedAt: at(today, '08:00'),
}));

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
      if (path.endsWith('/events') && method === 'GET') {
        return json(route, {items: opts.events ?? EVENTS});
      }
      if (path.endsWith('/tasks') && method === 'GET') {
        return json(route, {items: opts.tasks ?? TASKS});
      }
      if (path.endsWith('/companies') && method === 'GET') {
        return json(route, {items: COMPANIES});
      }
      if (path.endsWith('/venues')) {
        return json(route, {
          items: [PLAZA_CRISTO, PLAZA_ADELANTADO, RECINTO, ALMACEN],
        });
      }
      if (path.endsWith('/activity')) {
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
    await page.locator('#lx-tab-contactos').click();
    await expect(page.locator('#lx-space-contactos')).toBeVisible();
    await capture(page, 'placeholder-phone');
  });
});
