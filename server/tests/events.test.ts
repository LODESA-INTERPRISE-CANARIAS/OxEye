import {beforeAll, describe, expect, it} from 'vitest';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  ListResponse,
  LogisticsEvent,
  Venue,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;

beforeAll(async () => {
  h = await createHarness();
  token = (await h.login('Elvis')).token;
  dailos = (await h.login('Dailos')).token;
});

async function create(body: Record<string, unknown>, t = token) {
  return h.request('POST', '/events', {
    token: t,
    body: {organizationId: h.org.id, ...body},
  });
}

async function activity(limit?: number): Promise<ActivityEntry[]> {
  const q = limit ? `?limit=${limit}` : '';
  const res = await h.request(
    'GET',
    `/organizations/${h.org.id}/activity${q}`,
    {
      token,
    },
  );
  return (await json<ListResponse<ActivityEntry>>(res)).items;
}

describe('events · create', () => {
  it('creates an incomplete event with only a name', async () => {
    const res = await create({name: '  Mercadillo de artesanía  '});
    expect(res.status).toBe(201);
    const e = await json<LogisticsEvent>(res);
    expect(e).toMatchObject({
      organizationId: h.org.id,
      name: 'Mercadillo de artesanía',
      venue: null,
      startsAt: null,
      endsAt: null,
      timezone: 'Atlantic/Canary',
      status: 'planned',
      notes: null,
      version: 1,
      source: null,
      verification: 'draft',
      isDemo: false,
      createdAt: '2026-11-26T10:00:00.000Z',
    });
    expect(e.createdBy.displayName).toBe('Elvis');
    expect(e.updatedBy.displayName).toBe('Elvis');
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('converts winter local times (WET, UTC+0) to UTC', async () => {
    const res = await create({
      name: 'Belén viviente',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '14:00',
    });
    const e = await json<LogisticsEvent>(res);
    expect(e.startsAt).toBe('2026-12-02T09:00:00.000Z');
    expect(e.endsAt).toBe('2026-12-02T14:00:00.000Z');
  });

  it('converts summer local times (WEST, UTC+1) to UTC', async () => {
    const res = await create({
      name: 'Fiestas del Cristo',
      date: '2026-09-14',
      startTime: '20:00',
      endTime: '23:30',
      status: 'confirmed',
      source: 'reported',
      verification: 'to_verify',
      notes: 'Comunicado por teléfono',
    });
    expect(res.status).toBe(201);
    const e = await json<LogisticsEvent>(res);
    expect(e.startsAt).toBe('2026-09-14T19:00:00.000Z');
    expect(e.endsAt).toBe('2026-09-14T22:30:00.000Z');
    expect(e).toMatchObject({
      status: 'confirmed',
      source: 'reported',
      verification: 'to_verify',
      notes: 'Comunicado por teléfono',
    });
  });

  it('an end time at or before the start ends the next day', async () => {
    const e = await json<LogisticsEvent>(
      await create({
        name: 'Concierto nocturno',
        date: '2026-12-05',
        startTime: '22:00',
        endTime: '02:00',
      }),
    );
    expect(e.startsAt).toBe('2026-12-05T22:00:00.000Z');
    expect(e.endsAt).toBe('2026-12-06T02:00:00.000Z');
  });

  it('a date without times keeps its local day', async () => {
    const e = await json<LogisticsEvent>(
      await create({name: 'Mercadillo', date: '2026-12-02'}),
    );
    expect(e).toMatchObject({date: '2026-12-02', startsAt: null, endsAt: null});
    const winter = await json<LogisticsEvent>(
      await create({name: 'Belén', date: '2026-12-03', startTime: '09:00'}),
    );
    expect(winter.date).toBe('2026-12-03');
  });

  it('a time without a date is a validation error with fields', async () => {
    const res = await create({name: 'Sin fecha', startTime: '10:00'});
    expect(res.status).toBe(400);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('VALIDATION');
    expect(body.fields).toEqual({
      date: 'Indica la fecha para poder guardar la hora.',
    });
  });

  it('validates fields at the boundary with Spanish messages', async () => {
    const res = await create({
      name: '',
      date: '2026-02-30',
      startTime: '25:00',
      status: 'unknown',
      source: 'rumour',
    });
    expect(res.status).toBe(400);
    const body = await json<ApiErrorBody>(res);
    expect(body.fields).toMatchObject({
      name: 'Este campo es obligatorio.',
      date: 'Fecha no válida: usa el formato AAAA-MM-DD.',
      startTime: 'Hora no válida: usa el formato HH:MM (00:00–23:59).',
    });
    expect(body.fields?.status).toMatch(/^Estado no válido/);
    expect(body.fields?.source).toMatch(/^Origen no válido/);

    const missing = await h.request('POST', '/events', {token, body: {}});
    const m = await json<ApiErrorBody>(missing);
    expect(m.fields).toMatchObject({
      organizationId: 'Este campo es obligatorio.',
      name: 'Este campo es obligatorio.',
    });
  });

  it('returns 404 for an organization the user cannot see', async () => {
    const res = await create({
      organizationId: '00000000-0000-4000-8000-000000000000',
      name: 'x',
    });
    expect(res.status).toBe(404);
  });

  it('finds or creates venues by name, ignoring case and extra spaces', async () => {
    const a = await json<LogisticsEvent>(
      await create({
        name: 'Feria del libro',
        venueName: 'Plaza del Adelantado',
      }),
    );
    const b = await json<LogisticsEvent>(
      await create({
        name: 'Cine de verano',
        venueName: '  plaza   DEL adelantado ',
      }),
    );
    expect(a.venue?.name).toBe('Plaza del Adelantado');
    expect(b.venue).toEqual(a.venue);

    // The seeded demo venue is reused, case-insensitively.
    const c = await json<LogisticsEvent>(
      await create({name: 'Mercado navideño', venueName: 'PLAZA DEL CRISTO'}),
    );
    expect(c.venue?.name).toBe('Plaza del Cristo');

    const venues = await json<ListResponse<Venue>>(
      await h.request('GET', `/organizations/${h.org.id}/venues`, {token}),
    );
    const names = venues.items.map(v => v.name);
    expect(
      names.filter(n => n.toLowerCase() === 'plaza del adelantado'),
    ).toHaveLength(1);
    expect(
      names.filter(n => n.toLowerCase() === 'plaza del cristo'),
    ).toHaveLength(1);
    // Real data now uses the demo venue, so it is no longer demo.
    expect(venues.items.find(v => v.name === 'Plaza del Cristo')?.isDemo).toBe(
      false,
    );
  });
});

describe('events · list', () => {
  it('sorts by local date, then start, undated last, then by name', async () => {
    const res = await h.request('GET', `/organizations/${h.org.id}/events`, {
      token,
    });
    expect(res.status).toBe(200);
    const items = (await json<ListResponse<LogisticsEvent>>(res)).items;
    const dated = items.filter(e => e.date);
    const undated = items.filter(e => !e.date);
    expect(items).toEqual([...dated, ...undated]);
    // Within the dated block: date ascending, then timed before untimed.
    const keys = dated.map(e => `${e.date} ${e.startsAt ?? '~'}`);
    expect([...keys].sort()).toEqual(keys);
    const undatedNames = undated.map(e => e.name.toLowerCase());
    expect([...undatedNames].sort((x, y) => x.localeCompare(y))).toEqual(
      undatedNames,
    );
    expect(dated[0]?.name).toBe('Fiestas del Cristo');
    expect(items.some(e => e.isDemo)).toBe(true);
  });
});

describe('events · update', () => {
  it('patches with the current version, bumps it and logs the changed fields', async () => {
    const created = await json<LogisticsEvent>(
      await create({name: 'Pasacalles'}),
    );
    h.clock.advance(60_000);
    const res = await h.request('PATCH', `/events/${created.id}`, {
      token: dailos,
      body: {
        version: 1,
        date: '2026-12-02',
        startTime: '11:00',
        venueName: 'Calle Herradores',
        verification: 'validated',
      },
    });
    expect(res.status).toBe(200);
    const e = await json<LogisticsEvent>(res);
    expect(e.version).toBe(2);
    expect(e.startsAt).toBe('2026-12-02T11:00:00.000Z');
    expect(e.endsAt).toBeNull();
    expect(e.venue?.name).toBe('Calle Herradores');
    expect(e.verification).toBe('validated');
    expect(e.updatedBy.displayName).toBe('Dailos');
    expect(e.createdBy.displayName).toBe('Elvis');
    expect(e.updatedAt).toBe('2026-11-26T10:01:00.000Z');

    const [latest, venueCreated] = await activity(2);
    expect(latest).toMatchObject({
      entityType: 'event',
      entityId: created.id,
      entityLabel: 'Pasacalles',
      action: 'update',
      changedFields: ['venue', 'date', 'startsAt', 'verification'],
      user: {displayName: 'Dailos'},
      at: '2026-11-26T10:01:00.000Z',
    });
    expect(venueCreated).toMatchObject({
      entityType: 'venue',
      entityLabel: 'Calle Herradores',
      action: 'create',
    });

    // Changing only the end time keeps the stored date and start.
    const again = await json<LogisticsEvent>(
      await h.request('PATCH', `/events/${created.id}`, {
        token,
        body: {version: 2, endTime: '13:00'},
      }),
    );
    expect(again.version).toBe(3);
    expect(again.startsAt).toBe('2026-12-02T11:00:00.000Z');
    expect(again.endsAt).toBe('2026-12-02T13:00:00.000Z');
    expect((await activity(1))[0]?.changedFields).toEqual(['endsAt']);
  });

  it('rejects a stale version with 409 VERSION_CONFLICT and the current record', async () => {
    const created = await json<LogisticsEvent>(
      await create({name: 'Taller infantil'}),
    );
    const first = await h.request('PATCH', `/events/${created.id}`, {
      token: dailos,
      body: {version: 1, name: 'Taller infantil de Navidad'},
    });
    expect(first.status).toBe(200);

    const stale = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {version: 1, status: 'cancelled'},
    });
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.message).toMatch(/Otra persona/);
    const current = body.current as LogisticsEvent;
    expect(current).toMatchObject({
      id: created.id,
      version: 2,
      name: 'Taller infantil de Navidad',
      status: 'planned',
    });

    // Nothing was applied silently.
    const list = await json<ListResponse<LogisticsEvent>>(
      await h.request('GET', `/organizations/${h.org.id}/events`, {token}),
    );
    expect(list.items.find(e => e.id === created.id)?.status).toBe('planned');
  });

  it('requires a version and validates the patch', async () => {
    const created = await json<LogisticsEvent>(await create({name: 'Charla'}));
    const noVersion = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {name: 'Charla 2'},
    });
    expect(noVersion.status).toBe(400);
    expect((await json<ApiErrorBody>(noVersion)).fields?.version).toMatch(
      /Falta la versión/,
    );

    const emptyName = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {version: 1, name: '   '},
    });
    expect((await json<ApiErrorBody>(emptyName)).fields?.name).toBe(
      'Este campo es obligatorio.',
    );

    const timeOnUndated = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {version: 1, startTime: '10:00'},
    });
    expect(timeOnUndated.status).toBe(400);
    expect((await json<ApiErrorBody>(timeOnUndated)).fields).toEqual({
      date: 'Indica la fecha para poder guardar la hora.',
    });
  });

  it('a patch that changes nothing keeps the version and logs nothing', async () => {
    const created = await json<LogisticsEvent>(
      await create({name: 'Recital', venueName: 'Teatro Leal'}),
    );
    const before = (await activity(1))[0];
    const res = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {version: 1, name: 'Recital', venueName: 'teatro leal'},
    });
    expect(res.status).toBe(200);
    expect((await json<LogisticsEvent>(res)).version).toBe(1);
    expect((await activity(1))[0]?.id).toBe(before?.id);
  });

  it('clearing the date clears the times', async () => {
    const created = await json<LogisticsEvent>(
      await create({name: 'Ensayo', date: '2026-12-03', startTime: '18:00'}),
    );
    const e = await json<LogisticsEvent>(
      await h.request('PATCH', `/events/${created.id}`, {
        token,
        body: {version: 1, date: null},
      }),
    );
    expect(e.startsAt).toBeNull();
    expect(e.endsAt).toBeNull();
  });

  it('returns 404 for unknown or foreign events', async () => {
    const unknown = await h.request('PATCH', `/events/${crypto.randomUUID()}`, {
      token,
      body: {version: 1, name: 'x'},
    });
    expect(unknown.status).toBe(404);
    const bad = await h.request('PATCH', '/events/not-a-uuid', {
      token,
      body: {version: 1, name: 'x'},
    });
    expect(bad.status).toBe(404);
  });
});

describe('activity', () => {
  it('lists newest first with a default and a maximum limit', async () => {
    const all = await activity();
    expect(all).toHaveLength(20);
    const ats = all.map(a => a.at);
    expect([...ats].sort().reverse()).toEqual(ats);

    const tooMany = await h.request(
      'GET',
      `/organizations/${h.org.id}/activity?limit=500`,
      {token},
    );
    expect(tooMany.status).toBe(400);
    expect((await json<ApiErrorBody>(tooMany)).fields?.limit).toMatch(
      /entre 1 y 100/,
    );
  });

  it('writes one create row per new event, signed by its author', async () => {
    const created = await json<LogisticsEvent>(
      await create({name: 'Batucada'}, dailos),
    );
    const [row] = await activity(1);
    expect(row).toMatchObject({
      entityType: 'event',
      entityId: created.id,
      entityLabel: 'Batucada',
      action: 'create',
      changedFields: [],
      user: {displayName: 'Dailos'},
    });
  });
});

describe('events · multi-day', () => {
  it('creates an event spanning several days, the end time on the last day', async () => {
    const res = await create({
      name: 'Feria de artesanía',
      date: '2026-12-04',
      endDate: '2026-12-06',
      startTime: '10:00',
      endTime: '21:00',
    });
    expect(res.status).toBe(201);
    const e = await json<LogisticsEvent>(res);
    expect(e).toMatchObject({
      date: '2026-12-04',
      endDate: '2026-12-06',
      startsAt: '2026-12-04T10:00:00.000Z',
      endsAt: '2026-12-06T21:00:00.000Z',
    });
    const single = await json<LogisticsEvent>(
      await create({name: 'Un día', date: '2026-12-04'}),
    );
    expect(single.endDate).toBeNull();
  });

  it('rejects an end date without a start date or not after it', async () => {
    const noDate = await create({name: 'x', endDate: '2026-12-06'});
    expect(noDate.status).toBe(400);
    expect((await json<ApiErrorBody>(noDate)).fields).toEqual({
      endDate: 'Indica la fecha de inicio para poder guardar la fecha de fin.',
    });
    for (const endDate of ['2026-12-04', '2026-12-03']) {
      const bad = await create({name: 'x', date: '2026-12-04', endDate});
      expect(bad.status).toBe(400);
      expect((await json<ApiErrorBody>(bad)).fields).toEqual({
        endDate: 'La fecha de fin debe ser posterior a la de inicio.',
      });
    }
    const badFormat = await create({
      name: 'x',
      date: '2026-12-04',
      endDate: '6/12/2026',
    });
    expect((await json<ApiErrorBody>(badFormat)).fields?.endDate).toBe(
      'Fecha no válida: usa el formato AAAA-MM-DD.',
    );
  });

  it('extends and shortens an event, logging endDate and endsAt', async () => {
    const created = await json<LogisticsEvent>(
      await create({
        name: 'Montaje del belén',
        date: '2026-12-07',
        startTime: '08:00',
        endTime: '18:00',
      }),
    );
    const longer = await json<LogisticsEvent>(
      await h.request('PATCH', `/events/${created.id}`, {
        token,
        body: {version: 1, endDate: '2026-12-09'},
      }),
    );
    expect(longer).toMatchObject({
      version: 2,
      endDate: '2026-12-09',
      startsAt: '2026-12-07T08:00:00.000Z',
      endsAt: '2026-12-09T18:00:00.000Z',
    });
    expect((await activity(1))[0]?.changedFields).toEqual([
      'endDate',
      'endsAt',
    ]);

    // Moving the start past the end date is refused, nothing changes.
    const tooLate = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {version: 2, date: '2026-12-10'},
    });
    expect(tooLate.status).toBe(400);
    expect((await json<ApiErrorBody>(tooLate)).fields?.endDate).toMatch(
      /posterior/,
    );

    const back = await json<LogisticsEvent>(
      await h.request('PATCH', `/events/${created.id}`, {
        token,
        body: {version: 2, endDate: null},
      }),
    );
    expect(back).toMatchObject({
      version: 3,
      endDate: null,
      endsAt: '2026-12-07T18:00:00.000Z',
    });

    // A date cleared in the same edit as a new end date is an error.
    const clearedDate = await h.request('PATCH', `/events/${created.id}`, {
      token,
      body: {version: 3, endDate: '2026-12-08', date: null},
    });
    expect(clearedDate.status).toBe(400);
    expect((await json<ApiErrorBody>(clearedDate)).fields?.endDate).toMatch(
      /fecha de inicio/,
    );
  });
});
