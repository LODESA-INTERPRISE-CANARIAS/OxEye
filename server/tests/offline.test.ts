/**
 * Milestone 6, «Sin cobertura»: the cheap refresh (`GET …/changes`), the
 * activity of a time range (the day close) and creates with a device id, so
 * an offline outbox can replay a create without duplicating the record.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {AppError} from '../src/errors.ts';
import {createOnce, ID_IN_USE} from '../src/records/device-id.ts';
import type {DeviceCreate, DeviceIdTable} from '../src/records/device-id.ts';
import type {Queryable} from '../src/db/db.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {
  ACTIVITY_RANGE_MAX,
  ACTIVITY_RANGE_MAX_DAYS,
  CHANGES_OVERLAP_SECONDS,
} from '../../shared/logistics/rules.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  ChangesResponse,
  ListResponse,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;
let guest: string;
let elvisId: string;
let dailosId: string;
/** A second organization Elvis belongs to; it starts with an empty log. */
let orgB: string;
/** An organization nobody of the pilot belongs to. */
let foreignOrg: string;

beforeAll(async () => {
  h = await createHarness();
  const elvis = await h.login('Elvis');
  token = elvis.token;
  elvisId = elvis.user.id;
  const d = await h.login('Dailos');
  dailos = d.token;
  dailosId = d.user.id;
  guest = (await h.login('Invitado')).token;

  const [b] = await h.db.query<{id: string}>(
    "INSERT INTO organizations (name) VALUES ('Organización Prueba B') RETURNING id",
  );
  orgB = b!.id;
  await h.db.query(
    'INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)',
    [orgB, elvisId],
  );
  const [f] = await h.db.query<{id: string}>(
    "INSERT INTO organizations (name) VALUES ('Organización Prueba Ajena') RETURNING id",
  );
  foreignOrg = f!.id;
});

function post(path: string, body: Record<string, unknown>, t = token) {
  return h.request('POST', path, {
    token: t,
    body: {organizationId: h.org.id, ...body},
  });
}

async function changes(
  query = '',
  t = token,
  org = h.org.id,
): Promise<ChangesResponse> {
  const res = await h.request('GET', `/organizations/${org}/changes${query}`, {
    token: t,
  });
  expect(res.status).toBe(200);
  return json<ChangesResponse>(res);
}

async function activityCount(where = 'TRUE', params: unknown[] = []) {
  const [row] = await h.db.query<{n: number}>(
    `SELECT count(*)::int AS n FROM activity_log WHERE ${where}`,
    params,
  );
  return row!.n;
}

describe('GET /organizations/:orgId/changes', () => {
  it('an empty log has cursor "0": no cursor → full, "0" → nothing changed', async () => {
    expect(await changes('', token, orgB)).toEqual({
      cursor: '0',
      types: [],
      full: true,
    });
    expect(await changes('?since=0', token, orgB)).toEqual({
      cursor: '0',
      types: [],
      full: false,
    });
  });

  it('moves the cursor on every write and reports the types written since', async () => {
    // The seed's own activity falls out of the overlap window.
    h.clock.advance(10 * 60_000);
    const first = await changes();
    expect(first.full).toBe(true);
    expect(first.types).toEqual([]);
    expect(first.cursor).toMatch(/^[1-9][0-9]*$/);
    expect(await changes(`?since=${first.cursor}`)).toEqual({
      cursor: first.cursor,
      types: [],
      full: false,
    });

    expect(
      (await post('/events', {name: 'Evento Prueba Cambios'})).status,
    ).toBe(201);
    expect((await post('/tasks', {title: 'Tarea Prueba Cambios'})).status).toBe(
      201,
    );
    const after = await changes(`?since=${first.cursor}`);
    expect(after.full).toBe(false);
    expect(after.types).toEqual(['event', 'task']);
    expect(BigInt(after.cursor)).toBeGreaterThan(BigInt(first.cursor));

    // At the new cursor those writes are still reported while they are in
    // the overlap window (a lower seq may commit after a higher one)…
    expect((await changes(`?since=${after.cursor}`)).types).toEqual([
      'event',
      'task',
    ]);
    // …and no longer once it has passed.
    h.clock.advance((CHANGES_OVERLAP_SECONDS + 1) * 1000);
    expect(await changes(`?since=${after.cursor}`)).toEqual({
      cursor: after.cursor,
      types: [],
      full: false,
    });
  });

  it('the overlap window reports a row with a lower seq written in the last CHANGES_OVERLAP_SECONDS', async () => {
    const {cursor} = await changes();
    const now = h.clock.now().getTime();
    const insert = (type: string, secondsAgo: number) =>
      h.db.query(
        `INSERT INTO activity_log (organization_id, user_id, entity_type,
           entity_id, entity_label, action, at)
         VALUES ($1, $2, $3, gen_random_uuid(), 'Prueba', 'update', $4::timestamptz)`,
        [
          h.org.id,
          elvisId,
          type,
          new Date(now - secondsAgo * 1000).toISOString(),
        ],
      );
    await insert('contact', CHANGES_OVERLAP_SECONDS);
    await insert('offer', CHANGES_OVERLAP_SECONDS + 1);
    const later = await changes();
    // Pretend the device already holds the newest cursor: only the window
    // can report these rows.
    const res = await changes(`?since=${later.cursor}`);
    expect(res.types).toEqual(['contact']);
    expect(BigInt(later.cursor)).toBeGreaterThan(BigInt(cursor));
  });

  it('without since the cursor is still the organization’s largest seq', async () => {
    expect((await post('/events', {name: 'Evento Prueba Cursor'})).status).toBe(
      201,
    );
    const [row] = await h.db.query<{max: string}>(
      'SELECT max(seq)::text AS max FROM activity_log WHERE organization_id = $1',
      [h.org.id],
    );
    expect(await changes()).toEqual({
      cursor: row!.max,
      types: [],
      full: true,
    });
    // Another organization's newer rows never move this cursor.
    await h.db.query(
      `INSERT INTO activity_log (organization_id, user_id, entity_type,
         entity_id, entity_label, action)
       VALUES ($1, $2, 'event', gen_random_uuid(), 'Prueba', 'create')`,
      [orgB, elvisId],
    );
    expect((await changes()).cursor).toBe(row!.max);
    expect(BigInt((await changes('', token, orgB)).cursor)).toBeGreaterThan(
      BigInt(row!.max),
    );
  });

  it('a missing, malformed or ahead cursor means «reload everything»', async () => {
    const {cursor} = await changes();
    const ahead = (BigInt(cursor) + 1n).toString();
    for (const since of [
      '',
      'abc',
      '-1',
      '1.5',
      '01',
      ' 1',
      '1e3',
      '99999999999999999999',
      ahead,
    ]) {
      expect(
        await changes(`?since=${encodeURIComponent(since)}`),
        since,
      ).toEqual({cursor, types: [], full: true});
    }
  });

  it('hides other organizations (404), needs a session and lets guests read types', async () => {
    for (const org of [foreignOrg, 'not-a-uuid']) {
      const res = await h.request('GET', `/organizations/${org}/changes`, {
        token,
      });
      expect(res.status).toBe(404);
    }
    expect(
      (await h.request('GET', `/organizations/${h.org.id}/changes`)).status,
    ).toBe(401);

    h.clock.advance((CHANGES_OVERLAP_SECONDS + 1) * 1000);
    const {cursor} = await changes('', guest);
    expect(
      (await post('/notes', {kind: 'note', text: 'Texto Prueba'})).status,
    ).toBe(201);
    const res = await h.request(
      'GET',
      `/organizations/${h.org.id}/changes?since=${cursor}`,
      {token: guest},
    );
    const raw = await res.text();
    expect(JSON.parse(raw)).toMatchObject({types: ['note'], full: false});
    expect(raw).not.toContain('Texto Prueba');
  });
});

describe('GET /organizations/:orgId/activity with from and to', () => {
  const range = (from: string, to: string, extra = '') =>
    `/organizations/${h.org.id}/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`;

  async function items(path: string, t = token): Promise<ActivityEntry[]> {
    const res = await h.request('GET', path, {token: t});
    expect(res.status, path).toBe(200);
    return (await json<ListResponse<ActivityEntry>>(res)).items;
  }

  async function fields(path: string): Promise<Record<string, string>> {
    const res = await h.request('GET', path, {token});
    expect(res.status, path).toBe(400);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('VALIDATION');
    return body.fields ?? {};
  }

  it('returns from ≤ at < to, newest first, for members and guests', async () => {
    const at = async (iso: string, name: string) => {
      h.clock.set(iso);
      expect((await post('/events', {name})).status).toBe(201);
    };
    await at('2026-12-02T00:00:00.000Z', 'Evento Prueba Medianoche');
    await at('2026-12-02T08:00:00.000Z', 'Evento Prueba Mañana');
    await at('2026-12-02T18:30:00.000Z', 'Evento Prueba Tarde');
    await at('2026-12-03T00:00:00.000Z', 'Evento Prueba Día Siguiente');
    await at('2026-12-01T23:59:59.999Z', 'Evento Prueba Día Anterior');

    const day = range('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z');
    for (const t of [token, guest]) {
      expect((await items(day, t)).map(e => e.entityLabel)).toEqual([
        'Evento Prueba Tarde',
        'Evento Prueba Mañana',
        'Evento Prueba Medianoche',
      ]);
    }
    // An instant with an offset is accepted (01:00+01:00 is 00:00 UTC).
    expect(
      (
        await items(range('2026-12-02T01:00:00+01:00', '2026-12-02T09:00:00Z'))
      ).map(e => e.entityLabel),
    ).toEqual(['Evento Prueba Mañana', 'Evento Prueba Medianoche']);
    expect(
      await items(range('2026-12-02T08:00:00Z', '2026-12-02T08:00:00.001Z')),
    ).toHaveLength(1);
    expect(await items(`${day}&limit=1`)).toHaveLength(1);
  });

  it(`defaults to and caps at ACTIVITY_RANGE_MAX (${ACTIVITY_RANGE_MAX})`, async () => {
    await h.db.query(
      `INSERT INTO activity_log (organization_id, user_id, entity_type,
         entity_id, entity_label, action, at)
       SELECT $1, $2, 'task', gen_random_uuid(), 'Tarea Prueba ' || g, 'update',
              '2026-12-20T10:00:00Z'::timestamptz + g * interval '1 second'
         FROM generate_series(1, $3::int) g`,
      [h.org.id, elvisId, ACTIVITY_RANGE_MAX + 5],
    );
    const window = range('2026-12-20T00:00:00Z', '2026-12-21T00:00:00Z');
    const all = await items(window);
    expect(all).toHaveLength(ACTIVITY_RANGE_MAX);
    expect(all[0]!.entityLabel).toBe(`Tarea Prueba ${ACTIVITY_RANGE_MAX + 5}`);
    expect(await items(`${window}&limit=${ACTIVITY_RANGE_MAX}`)).toHaveLength(
      ACTIVITY_RANGE_MAX,
    );
    expect(
      (await fields(`${window}&limit=${ACTIVITY_RANGE_MAX + 1}`)).limit,
    ).toBe(`Indica un número entero entre 1 y ${ACTIVITY_RANGE_MAX}.`);
    // Without a range the M1 rules stay: 20 by default, at most 100.
    const recent = `/organizations/${h.org.id}/activity`;
    expect(await items(recent)).toHaveLength(20);
    expect((await fields(`${recent}?limit=101`)).limit).toBe(
      'Indica un número entero entre 1 y 100.',
    );
  });

  it('validates the range with Spanish messages on the field', async () => {
    const base = `/organizations/${h.org.id}/activity`;
    expect((await fields(`${base}?from=2026-12-02T00:00:00Z`)).to).toMatch(
      /inicio y su final/,
    );
    expect((await fields(`${base}?to=2026-12-02T00:00:00Z`)).from).toMatch(
      /inicio y su final/,
    );
    expect(
      (await fields(range('2026-12-02T00:00:00Z', '2026-12-02T00:00:00Z'))).to,
    ).toMatch(/posterior/);
    expect(
      (await fields(range('2026-12-03T00:00:00Z', '2026-12-02T00:00:00Z'))).to,
    ).toMatch(/posterior/);
    expect(
      (await fields(range('2026-12-01T00:00:00Z', '2026-12-09T00:00:00.001Z')))
        .to,
    ).toBe(
      `El periodo puede abarcar como máximo ${ACTIVITY_RANGE_MAX_DAYS} días.`,
    );
    // Exactly eight days is fine.
    await items(range('2026-12-01T00:00:00Z', '2026-12-09T00:00:00Z'));
    for (const bad of [
      'mañana',
      '2026-12-02',
      '2026-12-02T00:00:00',
      '2026-13-40T00:00:00Z',
    ]) {
      expect(
        (await fields(range(bad, '2026-12-03T00:00:00Z'))).from,
        bad,
      ).toMatch(/Instante no válido/);
    }
    const note = crypto.randomUUID();
    expect(
      (
        await fields(
          range(
            '2026-12-02T00:00:00Z',
            '2026-12-03T00:00:00Z',
            `&entityType=note&entityId=${note}`,
          ),
        )
      ).from,
    ).toMatch(/no se puede combinar/);
  });
});

/** The eight record types a device may create offline. */
const TYPES: {
  table: DeviceIdTable;
  path: string;
  entity: string;
  body: (label: string) => Record<string, unknown>;
}[] = [
  {
    table: 'events',
    path: '/events',
    entity: 'event',
    body: l => ({name: `Evento Prueba ${l}`}),
  },
  {
    table: 'tasks',
    path: '/tasks',
    entity: 'task',
    body: l => ({title: `Tarea Prueba ${l}`}),
  },
  {
    table: 'companies',
    path: '/companies',
    entity: 'company',
    body: l => ({name: `Empresa Prueba ${l}`}),
  },
  {
    table: 'contacts',
    path: '/contacts',
    entity: 'contact',
    body: l => ({name: `Persona Prueba ${l}`, phone: '+34 000 000 011'}),
  },
  {
    table: 'offers',
    path: '/offers',
    entity: 'offer',
    body: l => ({
      name: `Oferta Prueba ${l}`,
      companyName: `Empresa Prueba Ofertas ${l}`,
    }),
  },
  {
    table: 'warehouses',
    path: '/warehouses',
    entity: 'warehouse',
    body: l => ({name: `Almacén Prueba ${l}`}),
  },
  {
    table: 'resources',
    path: '/resources',
    entity: 'resource',
    body: l => ({name: `Recurso Prueba ${l}`}),
  },
  {
    table: 'notes',
    path: '/notes',
    entity: 'note',
    body: l => ({kind: 'incident', text: `Nota Prueba ${l}`}),
  },
];

describe('creates with a device id', () => {
  for (const type of TYPES) {
    describe(type.path, () => {
      it('creates with the id; a replay is 200 with the record as it is, writing nothing', async () => {
        const id = crypto.randomUUID();
        const res = await post(type.path, {id, ...type.body(`Offline ${id}`)});
        expect(res.status).toBe(201);
        const created = await json<Record<string, unknown>>(res);
        expect(created.id).toBe(id);
        expect(
          await activityCount('entity_id = $1 AND entity_type = $2', [
            id,
            type.entity,
          ]),
        ).toBe(1);

        const before = await activityCount();
        // Same body, then a different one: both are replays of the same create.
        for (const label of [`Offline ${id}`, `Cambiado ${id}`]) {
          const replay = await post(type.path, {id, ...type.body(label)});
          expect(replay.status).toBe(200);
          expect(await json(replay)).toEqual(created);
        }
        // Upper-case is the same id.
        const upper = await post(type.path, {
          id: id.toUpperCase(),
          ...type.body(`Offline ${id}`),
        });
        expect(upper.status).toBe(200);
        expect(await activityCount()).toBe(before);
        const [count] = await h.db.query<{n: number}>(
          `SELECT count(*)::int AS n FROM ${type.table} WHERE id = $1`,
          [id],
        );
        expect(count!.n).toBe(1);
      });

      it('an id used by another user or in another organization is a 400 on the field, revealing nothing', async () => {
        const id = crypto.randomUUID();
        const secret = `Reservado ${id}`;
        expect((await post(type.path, {id, ...type.body(secret)})).status).toBe(
          201,
        );
        const before = await activityCount();
        const attempts = [
          // Another member of the same organization.
          await post(type.path, {id, ...type.body('Otra persona')}, dailos),
          // The same user, in another organization.
          await post(type.path, {
            id,
            ...type.body('Otra organización'),
            organizationId: orgB,
          }),
        ];
        for (const res of attempts) {
          expect(res.status).toBe(400);
          const raw = await res.text();
          const body = JSON.parse(raw) as ApiErrorBody;
          expect(body).toMatchObject({
            code: 'VALIDATION',
            fields: {id: ID_IN_USE},
          });
          expect(raw).not.toContain(secret);
          expect(raw).not.toContain('+34');
        }
        expect(await activityCount()).toBe(before);
      });

      it('a malformed id is a 400 on the field', async () => {
        for (const id of ['abc', 42, null, `${crypto.randomUUID()}x`]) {
          const res = await post(type.path, {id, ...type.body('Mal')});
          expect(res.status).toBe(400);
          expect((await json<ApiErrorBody>(res)).fields?.id).toBe(
            'Identificador no válido.',
          );
        }
      });
    });
  }

  it('a replay that changed meanwhile returns the current version', async () => {
    const id = crypto.randomUUID();
    await post('/events', {id, name: 'Evento Prueba Editado'});
    const patched = await h.request('PATCH', `/events/${id}`, {
      token: dailos,
      body: {version: 1, status: 'confirmed'},
    });
    expect(patched.status).toBe(200);
    const replay = await post('/events', {id, name: 'Evento Prueba Editado'});
    expect(replay.status).toBe(200);
    expect(await json(replay)).toMatchObject({
      id,
      version: 2,
      status: 'confirmed',
      updatedBy: {id: dailosId},
    });
  });

  it('a replay never repeats find-or-create side effects', async () => {
    const id = crypto.randomUUID();
    const warehouseName = `Almacén Prueba Lateral ${id}`;
    const res = await post('/resources', {
      id,
      name: 'Recurso Prueba Lateral',
      warehouseName,
    });
    expect(res.status).toBe(201);
    const resource = await json<{version: number; warehouse: {id: string}}>(
      res,
    );
    // Unlink and delete the warehouse the create made.
    const unlinked = await h.request('PATCH', `/resources/${id}`, {
      token,
      body: {version: resource.version, warehouseId: null},
    });
    expect(unlinked.status).toBe(200);
    expect(
      (
        await h.request(
          'DELETE',
          `/warehouses/${resource.warehouse.id}?version=1`,
          {token},
        )
      ).status,
    ).toBe(204);

    const replay = await post('/resources', {
      id,
      name: 'Recurso Prueba Lateral',
      warehouseName,
    });
    expect(replay.status).toBe(200);
    expect(await json(replay)).toMatchObject({warehouse: null});
    const found = await h.db.query(
      'SELECT id FROM warehouses WHERE name = $1',
      [warehouseName],
    );
    expect(found).toEqual([]);
  });

  it('companies and warehouses: a replay wins before the name check; a new id with a taken name is DUPLICATE', async () => {
    for (const [path, name] of [
      ['/companies', 'Empresa Prueba Nombre Único'],
      ['/warehouses', 'Almacén Prueba Nombre Único'],
    ] as const) {
      const id = crypto.randomUUID();
      const first = await post(path, {id, name});
      expect(first.status).toBe(201);
      const replay = await post(path, {id, name: name.toUpperCase()});
      expect(replay.status).toBe(200);
      expect(await json(replay)).toEqual(await json(first));

      const other = crypto.randomUUID();
      const dup = await post(path, {id: other, name});
      expect(dup.status).toBe(409);
      const body = await json<ApiErrorBody>(dup);
      expect(body.code).toBe('DUPLICATE');
      expect(body.current).toMatchObject({id});
      expect((await post(path, {name})).status).toBe(409);
      // The refused id stays free for a real create.
      const [none] = await h.db.query<{n: number}>(
        `SELECT count(*)::int AS n FROM ${path.slice(1)} WHERE id = $1`,
        [other],
      );
      expect(none!.n).toBe(0);
    }
  });

  it('two replays sent together create one record', async () => {
    const id = crypto.randomUUID();
    const body = {id, name: 'Evento Prueba Simultáneo'};
    const [a, b] = await Promise.all([
      post('/events', body),
      post('/events', body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await json(a)).toEqual(await json(b));
    expect(await activityCount('entity_id = $1', [id])).toBe(1);
  });

  it('PATCH ignores an id in the body', async () => {
    const id = crypto.randomUUID();
    await post('/notes', {id, kind: 'note', text: 'Nota Prueba Patch'});
    const res = await h.request('PATCH', `/notes/${id}`, {
      token,
      body: {version: 1, id: crypto.randomUUID(), resolved: true},
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({id, resolved: true});
  });
});

describe('createOnce: a create that lost the race to a concurrent replay', () => {
  const uniqueViolation = () =>
    Object.assign(new Error('duplicate key value'), {code: '23505'});

  async function existingEvent(): Promise<string> {
    const id = crypto.randomUUID();
    expect(
      (await post('/events', {id, name: 'Evento Prueba Carrera'})).status,
    ).toBe(201);
    return id;
  }

  const spec = (
    id: string | undefined,
    actorId: string,
  ): DeviceCreate<{id: string}> => ({
    table: 'events',
    id,
    // Compared without letter case.
    organizationId: h.org.id.toUpperCase(),
    actorId,
    load: async (q: Queryable, rowId: string) =>
      (
        await q.query<{id: string}>('SELECT id FROM events WHERE id = $1', [
          rowId,
        ])
      )[0],
  });

  it('answers as the replay when the row is now the actor’s', async () => {
    const id = await existingEvent();
    const outcome = await createOnce(h.db, spec(id, elvisId), () =>
      Promise.reject(uniqueViolation()),
    );
    expect(outcome).toEqual({record: {id}, replayed: true});
  });

  it('is a 400 on the field when the row is someone else’s', async () => {
    const id = await existingEvent();
    await expect(
      createOnce(h.db, spec(id, dailosId), () =>
        Promise.reject(uniqueViolation()),
      ),
    ).rejects.toMatchObject({code: 'VALIDATION', fields: {id: ID_IN_USE}});
  });

  it('rethrows any other failure', async () => {
    const id = await existingEvent();
    const other = new AppError('VALIDATION', 'otra cosa');
    await expect(
      createOnce(h.db, spec(id, elvisId), () => Promise.reject(other)),
    ).rejects.toBe(other);
    // A unique violation without a device id, or with an id still free.
    const err = uniqueViolation();
    await expect(
      createOnce(h.db, spec(undefined, elvisId), () => Promise.reject(err)),
    ).rejects.toBe(err);
    await expect(
      createOnce(h.db, spec(crypto.randomUUID(), elvisId), () =>
        Promise.reject(err),
      ),
    ).rejects.toBe(err);
  });
});
