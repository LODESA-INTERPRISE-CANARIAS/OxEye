import {beforeAll, describe, expect, it} from 'vitest';
import {planWarnings} from '../../shared/logistics/conflicts.ts';
import {DEMO_EVENT, DEMO_TASKS} from '../src/seed/seed.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  Company,
  ListResponse,
  LogisticsEvent,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;
let guest: string;
let demoEventId: string;
/** Another organization the pilot users do not belong to. */
let foreign: {
  orgId: string;
  taskId: string;
  companyId: string;
  eventId: string;
};

beforeAll(async () => {
  h = await createHarness();
  token = (await h.login('Elvis')).token;
  dailos = (await h.login('Dailos')).token;
  guest = (await h.login('Invitado')).token;
  const events = await json<ListResponse<LogisticsEvent>>(
    await h.request('GET', `/organizations/${h.org.id}/events`, {token}),
  );
  demoEventId = events.items.find(e => e.name === DEMO_EVENT.name)!.id;

  const [org] = await h.db.query<{id: string}>(
    "INSERT INTO organizations (name) VALUES ('Otra organización') RETURNING id",
  );
  const [user] = await h.db.query<{id: string}>(
    "SELECT id FROM users WHERE display_name = 'Sistema'",
  );
  const [company] = await h.db.query<{id: string}>(
    `INSERT INTO companies (organization_id, name, created_by, updated_by)
     VALUES ($1, 'Empresa ajena', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  const [task] = await h.db.query<{id: string}>(
    `INSERT INTO tasks (organization_id, title, created_by, updated_by)
     VALUES ($1, 'Tarea ajena', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  const [event] = await h.db.query<{id: string}>(
    `INSERT INTO events (organization_id, name, created_by, updated_by)
     VALUES ($1, 'Evento ajeno', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  foreign = {
    orgId: org!.id,
    taskId: task!.id,
    companyId: company!.id,
    eventId: event!.id,
  };
});

function create(body: Record<string, unknown>, t = token) {
  return h.request('POST', '/tasks', {
    token: t,
    body: {organizationId: h.org.id, ...body},
  });
}

async function createOk(body: Record<string, unknown>): Promise<Task> {
  const res = await create(body);
  expect(res.status).toBe(201);
  return json<Task>(res);
}

function patch(id: string, body: Record<string, unknown>, t = token) {
  return h.request('PATCH', `/tasks/${id}`, {token: t, body});
}

async function list(query = ''): Promise<Task[]> {
  const res = await h.request(
    'GET',
    `/organizations/${h.org.id}/tasks${query}`,
    {token},
  );
  expect(res.status).toBe(200);
  return (await json<ListResponse<Task>>(res)).items;
}

async function activity(limit = 5): Promise<ActivityEntry[]> {
  const res = await h.request(
    'GET',
    `/organizations/${h.org.id}/activity?limit=${limit}`,
    {token},
  );
  return (await json<ListResponse<ActivityEntry>>(res)).items;
}

async function fieldsOf(res: Response): Promise<Record<string, string>> {
  expect(res.status).toBe(400);
  const body = await json<ApiErrorBody>(res);
  expect(body.code).toBe('VALIDATION');
  return body.fields ?? {};
}

describe('tasks · demo day', () => {
  it('seeds the demo tasks on 2 Dec 2026, Canary time, linked to the demo event', async () => {
    const tasks = await list(`?eventId=${demoEventId}`);
    expect(tasks.map(t => t.title).sort()).toEqual(
      DEMO_TASKS.map(t => t.title).sort(),
    );
    expect(tasks.every(t => t.isDemo && t.date === '2026-12-02')).toBe(true);
    const delivery = tasks.find(t => t.title === 'Entrega de vallas')!;
    const stage = tasks.find(t => t.title === 'Montaje del escenario')!;
    expect(delivery).toMatchObject({
      kind: 'delivery',
      heavyLoad: null,
      startsAt: '2026-12-02T08:00:00.000Z',
      endsAt: '2026-12-02T08:45:00.000Z',
      venue: {name: 'Plaza del Cristo'},
      createdBy: {displayName: 'Sistema'},
    });
    expect(stage).toMatchObject({
      heavyLoad: true,
      company: {name: 'Escenarios Demo'},
      contact: {name: 'Ana Demo'},
      dependsOn: [delivery.id],
    });
  });

  it('shows every kind of calendar warning', async () => {
    const tasks = await list();
    const events = await json<ListResponse<LogisticsEvent>>(
      await h.request('GET', `/organizations/${h.org.id}/events`, {token}),
    );
    const kinds = new Set(
      planWarnings(
        tasks.filter(t => t.isDemo),
        events.items,
      ).map(w => w.kind),
    );
    expect([...kinds].sort()).toEqual([
      'heavy_load',
      'heavy_load_unknown',
      'route_window',
      'venue_overlap',
    ]);
  });
});

describe('tasks · create', () => {
  it('creates a task with only a title; unknown stays unknown', async () => {
    const t = await createOk({title: '  Recoger vallas del almacén '});
    expect(t).toMatchObject({
      organizationId: h.org.id,
      eventId: null,
      venue: null,
      title: 'Recoger vallas del almacén',
      kind: 'other',
      status: 'planned',
      date: null,
      endDate: null,
      startsAt: null,
      endsAt: null,
      timezone: 'Atlantic/Canary',
      company: null,
      contact: null,
      dependsOn: [],
      heavyLoad: null,
      notes: null,
      version: 1,
      source: null,
      verification: 'draft',
      isDemo: false,
    });
    expect(t.createdBy.displayName).toBe('Elvis');
    const [row] = await activity(1);
    expect(row).toMatchObject({
      entityType: 'task',
      entityId: t.id,
      entityLabel: 'Recoger vallas del almacén',
      action: 'create',
    });
  });

  it('creates a full task: event, venue, company, times, load and predecessor', async () => {
    const before = await createOk({title: 'Descarga de tarimas'});
    const person = await json<{id: string}>(
      await h.request('POST', '/contacts', {
        token,
        body: {organizationId: h.org.id, name: 'Persona Prueba'},
      }),
    );
    const t = await createOk({
      title: 'Montaje de carpas',
      kind: 'assembly',
      status: 'confirmed',
      eventId: demoEventId,
      venueName: 'plaza del cristo',
      companyName: 'Carpas Prueba',
      contactId: person.id,
      date: '2026-12-01',
      startTime: '07:30',
      endTime: '10:00',
      heavyLoad: true,
      dependsOn: [before.id.toUpperCase(), before.id],
      notes: 'Llevan lastre de agua',
      source: 'reported',
      verification: 'to_verify',
    });
    expect(t).toMatchObject({
      eventId: demoEventId,
      venue: {name: 'Plaza del Cristo'},
      company: {name: 'Carpas Prueba'},
      contact: {id: person.id, name: 'Persona Prueba'},
      kind: 'assembly',
      status: 'confirmed',
      date: '2026-12-01',
      startsAt: '2026-12-01T07:30:00.000Z',
      endsAt: '2026-12-01T10:00:00.000Z',
      heavyLoad: true,
      dependsOn: [before.id],
      source: 'reported',
      verification: 'to_verify',
    });
    // A real task at a demo venue makes the venue real.
    const venues = await json<ListResponse<{name: string; isDemo: boolean}>>(
      await h.request('GET', `/organizations/${h.org.id}/venues`, {token}),
    );
    expect(venues.items.find(v => v.name === 'Plaza del Cristo')?.isDemo).toBe(
      false,
    );
  });

  it('spans several days with an end date', async () => {
    const t = await createOk({
      title: 'Montaje de la feria',
      kind: 'assembly',
      date: '2026-12-03',
      endDate: '2026-12-05',
      startTime: '08:00',
      endTime: '13:00',
    });
    expect(t).toMatchObject({
      date: '2026-12-03',
      endDate: '2026-12-05',
      startsAt: '2026-12-03T08:00:00.000Z',
      endsAt: '2026-12-05T13:00:00.000Z',
    });
    expect(
      await fieldsOf(
        await create({title: 'x', date: '2026-12-03', endDate: '2026-12-03'}),
      ),
    ).toEqual({endDate: 'La fecha de fin debe ser posterior a la de inicio.'});
  });

  it('finds or creates companies by name, ignoring case; companyId wins', async () => {
    const a = await createOk({title: 'A', companyName: 'Sonido Prueba'});
    const b = await createOk({
      title: 'B',
      companyName: '  SONIDO   prueba ',
    });
    expect(b.company).toEqual(a.company);
    const c = await createOk({
      title: 'C',
      companyId: a.company!.id,
      companyName: 'Otra empresa',
    });
    expect(c.company).toEqual(a.company);

    const companies = await json<ListResponse<Company>>(
      await h.request('GET', `/organizations/${h.org.id}/companies`, {token}),
    );
    const names = companies.items.map(x => x.name);
    expect(names.filter(n => /sonido prueba/i.test(n))).toHaveLength(1);
    expect(names).not.toContain('Otra empresa');
    expect(names).not.toContain('Empresa ajena');
    expect([...names].sort((x, y) => x.localeCompare(y, 'es'))).toEqual(names);
    expect(companies.items.find(x => x.name === 'Sonido Prueba')).toMatchObject(
      {
        kind: 'supplier',
        categoryIds: [],
        contactCount: 0,
        restricted: false,
        phone: null,
        email: null,
        website: null,
        notes: null,
        mainContactId: null,
        offerCount: 0,
        isDemo: false,
        version: 1,
        createdBy: {displayName: 'Elvis'},
      },
    );
  });

  it('rejects references to another organization or to nothing', async () => {
    const fields = await fieldsOf(
      await create({
        title: 'x',
        eventId: foreign.eventId,
        companyId: foreign.companyId,
        dependsOn: [foreign.taskId],
      }),
    );
    expect(fields.eventId).toMatch(/No encontramos ese evento/);
    expect(fields.companyId).toMatch(/No encontramos esa empresa/);
    expect(fields.dependsOn).toMatch(/no existe o no es de esta organización/);

    const missing = await fieldsOf(
      await create({title: 'x', dependsOn: [crypto.randomUUID()]}),
    );
    expect(missing.dependsOn).toMatch(/no existe/);
  });

  it('validates fields at the boundary with Spanish messages', async () => {
    const fields = await fieldsOf(
      await create({
        title: '',
        kind: 'party',
        status: 'finished',
        heavyLoad: 'quizás',
        dependsOn: ['no-es-un-id'],
        date: '2026-13-01',
        companyId: 'abc',
      }),
    );
    expect(fields).toMatchObject({
      title: 'Este campo es obligatorio.',
      date: 'Fecha no válida: usa el formato AAAA-MM-DD.',
      companyId: 'Identificador no válido.',
      dependsOn: 'Alguna de las tareas previas no es válida.',
    });
    expect(fields.kind).toMatch(/^Tipo no válido/);
    expect(fields.status).toMatch(/^Estado no válido/);
    expect(fields.heavyLoad).toMatch(/sí, no/);

    expect(
      (await fieldsOf(await create({title: 'x', dependsOn: 'abc'}))).dependsOn,
    ).toBe('Debe ser una lista de tareas.');
    expect(
      await fieldsOf(await create({title: 'x', startTime: '09:00'})),
    ).toEqual({date: 'Indica la fecha para poder guardar la hora.'});
  });

  it('returns 404 for an organization the user cannot see', async () => {
    const res = await create({organizationId: foreign.orgId, title: 'x'});
    expect(res.status).toBe(404);
  });
});

describe('tasks · list', () => {
  it('sorts by local date, then start, undated last, then title', async () => {
    const items = await list();
    const dated = items.filter(t => t.date);
    const undated = items.filter(t => !t.date);
    expect(items).toEqual([...dated, ...undated]);
    const keys = dated.map(t => `${t.date} ${t.startsAt ?? '~'}`);
    expect([...keys].sort()).toEqual(keys);
    const titles = undated.map(t => t.title.toLowerCase());
    expect([...titles].sort((x, y) => x.localeCompare(y))).toEqual(titles);
  });

  it('filters by event and validates the filter', async () => {
    const items = await list(`?eventId=${demoEventId}`);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(t => t.eventId === demoEventId)).toBe(true);
    expect(await list(`?eventId=${foreign.eventId}`)).toEqual([]);
    const bad = await h.request(
      'GET',
      `/organizations/${h.org.id}/tasks?eventId=nope`,
      {token},
    );
    expect((await fieldsOf(bad)).eventId).toBe('Identificador no válido.');
  });

  it('hides other organizations (404) and lets guests read', async () => {
    const res = await h.request(
      'GET',
      `/organizations/${foreign.orgId}/tasks`,
      {
        token,
      },
    );
    expect(res.status).toBe(404);
    const companies = await h.request(
      'GET',
      `/organizations/${foreign.orgId}/companies`,
      {token},
    );
    expect(companies.status).toBe(404);
    const asGuest = await h.request('GET', `/organizations/${h.org.id}/tasks`, {
      token: guest,
    });
    expect(asGuest.status).toBe(200);
  });
});

describe('tasks · update', () => {
  it('patches with the current version, bumps it and logs the changed fields', async () => {
    const t = await createOk({title: 'Colocar señalética'});
    h.clock.advance(60_000);
    const res = await patch(
      t.id,
      {
        version: 1,
        status: 'in_progress',
        date: '2026-12-02',
        startTime: '07:00',
        endTime: '07:30',
        venueName: 'Calle Herradores',
        companyName: 'Rótulos Prueba',
        heavyLoad: false,
        eventId: demoEventId,
      },
      dailos,
    );
    expect(res.status).toBe(200);
    const u = await json<Task>(res);
    expect(u).toMatchObject({
      version: 2,
      status: 'in_progress',
      startsAt: '2026-12-02T07:00:00.000Z',
      endsAt: '2026-12-02T07:30:00.000Z',
      venue: {name: 'Calle Herradores'},
      company: {name: 'Rótulos Prueba'},
      heavyLoad: false,
      eventId: demoEventId,
      updatedBy: {displayName: 'Dailos'},
    });
    const [latest] = await activity(1);
    expect(latest).toMatchObject({
      entityType: 'task',
      entityId: t.id,
      entityLabel: 'Colocar señalética',
      action: 'update',
      changedFields: [
        'status',
        'eventId',
        'venue',
        'company',
        'date',
        'startsAt',
        'endsAt',
        'heavyLoad',
      ],
      user: {displayName: 'Dailos'},
    });

    // Back to unknown: null is stored, not false.
    const unknown = await json<Task>(
      await patch(t.id, {version: 2, heavyLoad: null, companyId: null}),
    );
    expect(unknown).toMatchObject({version: 3, heavyLoad: null, company: null});
  });

  it('a patch that changes nothing keeps the version and logs nothing', async () => {
    const t = await createOk({
      title: 'Revisar extintores',
      venueName: 'Teatro Leal',
      companyName: 'Extintores Prueba',
    });
    const before = (await activity(1))[0];
    const res = await patch(t.id, {
      version: 1,
      title: 'Revisar extintores',
      venueName: 'teatro leal',
      companyName: 'EXTINTORES PRUEBA',
      dependsOn: [],
      contactId: null,
    });
    expect(res.status).toBe(200);
    expect((await json<Task>(res)).version).toBe(1);
    expect((await activity(1))[0]?.id).toBe(before?.id);
  });

  it('rejects a stale version with 409 VERSION_CONFLICT and the current task', async () => {
    const t = await createOk({title: 'Montar camerinos'});
    expect(
      (await patch(t.id, {version: 1, title: 'Montar camerinos (2)'}, dailos))
        .status,
    ).toBe(200);
    const stale = await patch(t.id, {version: 1, status: 'cancelled'});
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.message).toMatch(/Otra persona/);
    expect(body.current).toMatchObject({
      id: t.id,
      version: 2,
      title: 'Montar camerinos (2)',
      status: 'planned',
    });
  });

  it('requires a version and returns 404 for unknown or foreign tasks', async () => {
    const t = await createOk({title: 'Charla de seguridad'});
    expect((await fieldsOf(await patch(t.id, {title: 'x'}))).version).toMatch(
      /Falta la versión/,
    );
    for (const id of [crypto.randomUUID(), 'not-a-uuid', foreign.taskId]) {
      expect((await patch(id, {version: 1, title: 'x'})).status).toBe(404);
    }
  });

  it('replaces predecessors; refuses self reference and cycles', async () => {
    const a = await createOk({title: 'Llegada del camión'});
    const b = await createOk({title: 'Descarga', dependsOn: [a.id]});
    const c = await createOk({title: 'Montaje', dependsOn: [b.id]});

    expect(
      (await fieldsOf(await patch(a.id, {version: 1, dependsOn: [a.id]})))
        .dependsOn,
    ).toBe('Una tarea no puede depender de sí misma.');

    const cycle = (
      await fieldsOf(await patch(a.id, {version: 1, dependsOn: [c.id]}))
    ).dependsOn;
    expect(cycle).toMatch(/ciclo/);
    expect(cycle).toContain('«Llegada del camión»');
    expect(cycle).toContain('«Montaje»');

    const replaced = await json<Task>(
      await patch(c.id, {version: 1, dependsOn: [a.id, b.id]}),
    );
    expect(replaced.version).toBe(2);
    expect(replaced.dependsOn).toEqual([a.id, b.id].sort());
    expect((await activity(1))[0]?.changedFields).toEqual(['dependsOn']);

    const cleared = await json<Task>(
      await patch(c.id, {version: 2, dependsOn: []}),
    );
    expect(cleared.dependsOn).toEqual([]);
  });

  it('keeps an end date when the start moves and rejects moving past it', async () => {
    const t = await createOk({
      title: 'Exposición',
      date: '2026-12-10',
      endDate: '2026-12-12',
    });
    const moved = await json<Task>(
      await patch(t.id, {version: 1, date: '2026-12-11'}),
    );
    expect(moved).toMatchObject({date: '2026-12-11', endDate: '2026-12-12'});
    expect(
      (await fieldsOf(await patch(t.id, {version: 2, date: '2026-12-12'})))
        .endDate,
    ).toMatch(/posterior/);
  });
});

describe('tasks · delete', () => {
  it('deletes at the current version and unlinks dependents, bumping their version', async () => {
    const a = await createOk({title: 'Corte de calle'});
    const b = await createOk({title: 'Entrada de grúa', dependsOn: [a.id]});
    const c = await createOk({
      title: 'Izado de truss',
      dependsOn: [a.id, b.id],
    });

    const stale = await h.request('DELETE', `/tasks/${a.id}?version=7`, {
      token,
    });
    expect(stale.status).toBe(409);
    expect((await json<ApiErrorBody>(stale)).current).toMatchObject({
      id: a.id,
      version: 1,
    });

    const res = await h.request('DELETE', `/tasks/${a.id}?version=1`, {token});
    expect(res.status).toBe(204);

    const items = await list();
    expect(items.find(t => t.id === a.id)).toBeUndefined();
    expect(items.find(t => t.id === b.id)).toMatchObject({
      dependsOn: [],
      version: 2,
    });
    expect(items.find(t => t.id === c.id)).toMatchObject({
      dependsOn: [b.id],
      version: 2,
    });

    const log = await activity(3);
    expect(log.map(e => [e.entityLabel, e.action, e.changedFields])).toEqual([
      ['Corte de calle', 'delete', []],
      [expect.any(String), 'update', ['dependsOn']],
      [expect.any(String), 'update', ['dependsOn']],
    ]);

    // An edit made with the old version of a dependent is now a conflict.
    expect((await patch(b.id, {version: 1, dependsOn: [c.id]})).status).toBe(
      409,
    );
  });

  it('requires a version and hides unknown or foreign tasks', async () => {
    const t = await createOk({title: 'Retirar vallas'});
    const noVersion = await h.request('DELETE', `/tasks/${t.id}`, {token});
    expect((await fieldsOf(noVersion)).version).toMatch(/Falta la versión/);
    const badVersion = await h.request('DELETE', `/tasks/${t.id}?version=x`, {
      token,
    });
    expect((await fieldsOf(badVersion)).version).toMatch(/entero positivo/);
    for (const id of [crypto.randomUUID(), foreign.taskId]) {
      const res = await h.request('DELETE', `/tasks/${id}?version=1`, {token});
      expect(res.status).toBe(404);
    }
    const [row] = await h.db.query('SELECT 1 FROM tasks WHERE id = $1', [
      foreign.taskId,
    ]);
    expect(row).toBeDefined();
  });
});

describe('tasks · guests', () => {
  it('a guest cannot create, edit or delete tasks', async () => {
    const t = await createOk({title: 'Prueba de luces'});
    const attempts = [
      await create({title: 'x'}, guest),
      await patch(t.id, {version: 1, title: 'x'}, guest),
      await h.request('DELETE', `/tasks/${t.id}?version=1`, {token: guest}),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect((await json<ApiErrorBody>(res)).code).toBe('FORBIDDEN');
    }
    expect((await list()).find(x => x.id === t.id)?.version).toBe(1);
  });
});
