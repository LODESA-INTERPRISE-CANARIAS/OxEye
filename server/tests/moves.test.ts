/**
 * Revisión 1 · E2 on the server: venue and warehouse acronyms and opening
 * hours, the organization's acronym, task moves (calendar drag, conflict
 * exits, «Deshacer») and accepted conflicts («Mantener ambas»). A move is
 * recomputed with the shared functions and written only when it matches what
 * the member confirmed; it changes times only. Fictitious data only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {acceptanceApplies} from '../../shared/logistics/acceptance.ts';
import {planWarnings} from '../../shared/logistics/conflicts.ts';
import type {PlanWarning} from '../../shared/logistics/conflicts.ts';
import {shiftExpectations} from '../../shared/logistics/followup.ts';
import {moveItems} from '../../shared/logistics/move.ts';
import {simulateMove} from '../../shared/logistics/schedule.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  ChangesResponse,
  ConflictAcceptance,
  ListResponse,
  MeResponse,
  MoveTaskResponse,
  Organization,
  ShiftExpectation,
  Task,
  Venue,
  Warehouse,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let guest: string;
let foreignTaskId: string;

beforeAll(async () => {
  h = await createHarness();
  token = (await h.login('Elvis')).token;
  guest = (await h.login('Invitado')).token;
  const [org] = await h.db.query<{id: string}>(
    "INSERT INTO organizations (name) VALUES ('Otra organización Prueba') RETURNING id",
  );
  const [user] = await h.db.query<{id: string}>(
    "SELECT id FROM users WHERE display_name = 'Sistema'",
  );
  const [task] = await h.db.query<{id: string}>(
    `INSERT INTO tasks (organization_id, title, local_date, starts_at, ends_at,
                        created_by, updated_by)
     VALUES ($1, 'Tarea ajena Prueba', '2026-12-02', '2026-12-02T09:00:00Z',
             '2026-12-02T10:00:00Z', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  foreignTaskId = task!.id;
});

afterAll(async () => {
  await h.db.close();
});

const orgPath = (what: string) => `/organizations/${h.org.id}/${what}`;

function post(path: string, body: Record<string, unknown>, t = token) {
  return h.request('POST', path, {
    token: t,
    body: {organizationId: h.org.id, ...body},
  });
}

function patch(path: string, body: Record<string, unknown>, t = token) {
  return h.request('PATCH', path, {token: t, body});
}

async function ok<T>(res: Response, status = 200): Promise<T> {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, got ${res.status}: ${await res.text()}`,
    );
  }
  return json<T>(res);
}

async function errorOf(res: Response, status: number): Promise<ApiErrorBody> {
  expect(res.status).toBe(status);
  return json<ApiErrorBody>(res);
}

async function listOf<T>(what: string, t = token): Promise<T[]> {
  return (
    await ok<ListResponse<T>>(await h.request('GET', orgPath(what), {token: t}))
  ).items;
}

const tasks = () => listOf<Task>('tasks');

async function task(body: Record<string, unknown>): Promise<Task> {
  return ok<Task>(await post('/tasks', body), 201);
}

async function venueNamed(name: string): Promise<Venue> {
  return (await listOf<Venue>('venues')).find(v => v.name === name)!;
}

/** What the confirmation sends: the shared computation on the current plan. */
async function expectedFor(rootId: string, minutes: number) {
  const plan = await tasks();
  return shiftExpectations(
    simulateMove(moveItems(plan), rootId, minutes),
    plan,
  );
}

function move(
  id: string,
  minutes: number,
  expected: ShiftExpectation[],
  origin = 'calendar',
  t = token,
) {
  return h.request('POST', `/tasks/${id}/move`, {
    token: t,
    body: {minutes, origin, expected},
  });
}

async function historyOf(id: string): Promise<ActivityEntry[]> {
  return listOf<ActivityEntry>(`activity?entityType=task&entityId=${id}`);
}

describe('venues: acronym and opening hours', () => {
  it('a member sets them; history and /changes report it; the venue stays the same place', async () => {
    await task({title: 'Montaje Prueba V', venueName: 'Plaza Prueba V'});
    const venue = await venueNamed('Plaza Prueba V');
    expect(venue).toMatchObject({acronym: null, openingHours: null});
    const since = (
      await ok<ChangesResponse>(
        await h.request('GET', orgPath('changes'), {token}),
      )
    ).cursor;

    const updated = await ok<Venue>(
      await patch(`/venues/${venue.id}`, {
        version: venue.version,
        acronym: ' P.P.V. ',
        openingHours: {opensAt: '08:00', closesAt: '20:00'},
      }),
    );
    expect(updated).toMatchObject({
      acronym: 'P.P.V.',
      openingHours: {opensAt: '08:00', closesAt: '20:00'},
      version: venue.version + 1,
    });
    const [entry] = await listOf<ActivityEntry>(
      `activity?entityType=venue&entityId=${venue.id}`,
    );
    expect(entry).toMatchObject({
      action: 'update',
      changedFields: ['acronym', 'openingHours'],
    });
    const changes = await ok<ChangesResponse>(
      await h.request('GET', orgPath(`changes?since=${since}`), {token}),
    );
    expect(changes.types).toContain('venue');

    // Sending the same values changes nothing; blank acronym and null hours clear.
    const same = await ok<Venue>(
      await patch(`/venues/${venue.id}`, {
        version: updated.version,
        acronym: 'P.P.V.',
        openingHours: {opensAt: '08:00', closesAt: '20:00'},
      }),
    );
    expect(same.version).toBe(updated.version);
    const cleared = await ok<Venue>(
      await patch(`/venues/${venue.id}`, {
        version: updated.version,
        acronym: '  ',
        openingHours: null,
      }),
    );
    expect(cleared).toMatchObject({acronym: null, openingHours: null});
  });

  it('rejects bad acronyms and hours with Spanish field messages', async () => {
    const venue = await venueNamed('Plaza Prueba V');
    const bad = async (body: Record<string, unknown>, field: string) => {
      const err = await errorOf(
        await patch(`/venues/${venue.id}`, {version: venue.version, ...body}),
        400,
      );
      expect(err.fields?.[field]).toMatch(/[a-záéíóú]/);
    };
    await bad({acronym: 'P P'}, 'acronym');
    await bad({acronym: 'ABCDEFGHIJKLM'}, 'acronym');
    await bad(
      {openingHours: {opensAt: '20:00', closesAt: '08:00'}},
      'openingHours',
    );
    await bad(
      {openingHours: {opensAt: '8', closesAt: '20:00'}},
      'openingHours',
    );
    await bad({openingHours: '08:00-20:00'}, 'openingHours');
  });

  it('409 on a stale version, DUPLICATE on another venue’s name, 403 for guests, 404 abroad', async () => {
    await task({title: 'Montaje Prueba W', venueName: 'Plaza Prueba W'});
    const venue = await venueNamed('Plaza Prueba V');
    const stale = await errorOf(
      await patch(`/venues/${venue.id}`, {
        version: venue.version - 1,
        acronym: 'X',
      }),
      409,
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(stale.current).toMatchObject({id: venue.id});
    const dup = await errorOf(
      await patch(`/venues/${venue.id}`, {
        version: venue.version,
        name: 'plaza prueba w',
      }),
      409,
    );
    expect(dup.code).toBe('DUPLICATE');
    expect(dup.current).toMatchObject({name: 'Plaza Prueba W'});
    expect(
      (
        await patch(
          `/venues/${venue.id}`,
          {version: venue.version, acronym: 'X'},
          guest,
        )
      ).status,
    ).toBe(403);
    const [foreign] = await h.db.query<{id: string}>(
      'SELECT v.id FROM venues v WHERE v.organization_id <> $1 LIMIT 1',
      [h.org.id],
    );
    const unknown = foreign?.id ?? '00000000-0000-4000-8000-000000000000';
    expect((await patch(`/venues/${unknown}`, {version: 1})).status).toBe(404);
  });

  it('warehouses take acronym and opening hours on create and update', async () => {
    const created = await ok<Warehouse>(
      await post('/warehouses', {
        name: 'Almacén Prueba E2',
        acronym: 'A.P.',
        openingHours: {opensAt: '07:30', closesAt: '15:00'},
      }),
      201,
    );
    expect(created).toMatchObject({
      acronym: 'A.P.',
      openingHours: {opensAt: '07:30', closesAt: '15:00'},
    });
    const updated = await ok<Warehouse>(
      await patch(`/warehouses/${created.id}`, {
        version: created.version,
        openingHours: null,
      }),
    );
    expect(updated).toMatchObject({acronym: 'A.P.', openingHours: null});
    const err = await errorOf(
      await patch(`/warehouses/${created.id}`, {
        version: updated.version,
        openingHours: {opensAt: '10:00', closesAt: '10:00'},
      }),
      400,
    );
    expect(err.fields?.openingHours).toBeTruthy();
    // Guests still see the hours and the acronym (not free text).
    const asGuest = (await listOf<Warehouse>('warehouses', guest)).find(
      w => w.id === created.id,
    );
    expect(asGuest).toMatchObject({acronym: 'A.P.', restricted: true});
  });
});

describe('organization acronym', () => {
  it('members edit it with a version; /me shows it; history and /changes report it', async () => {
    const me = await ok<MeResponse>(await h.request('GET', '/me', {token}));
    const org = me.organizations.find(o => o.id === h.org.id)!;
    expect(org).toMatchObject({acronym: null, version: 1});
    const since = (
      await ok<ChangesResponse>(
        await h.request('GET', orgPath('changes'), {token}),
      )
    ).cursor;

    const updated = await ok<Organization>(
      await patch(`/organizations/${h.org.id}`, {
        version: org.version,
        acronym: 'SCLL',
      }),
    );
    expect(updated).toMatchObject({acronym: 'SCLL', version: 2});
    const again = await ok<MeResponse>(
      await h.request('GET', '/me', {token: guest}),
    );
    expect(again.organizations.find(o => o.id === h.org.id)?.acronym).toBe(
      'SCLL',
    );

    const changes = await ok<ChangesResponse>(
      await h.request('GET', orgPath(`changes?since=${since}`), {token}),
    );
    expect(changes.types).toContain('organization');
    const [entry] = await listOf<ActivityEntry>('activity?limit=1');
    expect(entry).toMatchObject({
      entityType: 'organization',
      changedFields: ['acronym'],
    });

    const stale = await errorOf(
      await patch(`/organizations/${h.org.id}`, {version: 1, acronym: 'X'}),
      409,
    );
    expect(stale.current).toMatchObject({acronym: 'SCLL', version: 2});
    const bad = await errorOf(
      await patch(`/organizations/${h.org.id}`, {version: 2, acronym: 'S C'}),
      400,
    );
    expect(bad.fields?.acronym).toBeTruthy();
    expect(
      (
        await patch(
          `/organizations/${h.org.id}`,
          {version: 2, acronym: 'X'},
          guest,
        )
      ).status,
    ).toBe(403);
    const [foreign] = await h.db.query<{id: string}>(
      'SELECT id FROM organizations WHERE id <> $1 LIMIT 1',
      [h.org.id],
    );
    expect(
      (await patch(`/organizations/${foreign!.id}`, {version: 1, acronym: 'X'}))
        .status,
    ).toBe(404);
  });
});

describe('moving a task', () => {
  it('later: the dependants that run out of slack move too, in one write, signed with the origin', async () => {
    const a = await task({
      title: 'Descarga Prueba M1',
      venueName: 'Recinto Prueba M',
      date: '2026-12-10',
      startTime: '09:00',
      endTime: '10:00',
    });
    const b = await task({
      title: 'Montaje Prueba M1',
      venueName: 'Recinto Prueba M',
      date: '2026-12-10',
      startTime: '10:00',
      endTime: '11:00',
      dependsOn: [a.id],
    });
    const expected = await expectedFor(a.id, 30);
    expect(expected.map(e => e.id).sort()).toEqual([a.id, b.id].sort());
    const res = await ok<MoveTaskResponse>(await move(a.id, 30, expected));
    const byId = new Map(res.tasks.map(t => [t.id, t]));
    expect(byId.get(a.id)).toMatchObject({
      startsAt: '2026-12-10T09:30:00.000Z',
      endsAt: '2026-12-10T10:30:00.000Z',
      version: a.version + 1,
    });
    expect(byId.get(b.id)).toMatchObject({
      startsAt: '2026-12-10T10:30:00.000Z',
      endsAt: '2026-12-10T11:30:00.000Z',
    });
    const [entry] = await historyOf(b.id);
    expect(entry).toMatchObject({
      action: 'update',
      changedFields: ['startsAt', 'endsAt'],
      origin: 'calendar',
    });
  });

  it('earlier: only the task moves; its dependants are never pulled earlier', async () => {
    const a = await task({
      title: 'Descarga Prueba M2',
      date: '2026-12-11',
      startTime: '09:00',
      endTime: '10:00',
    });
    const b = await task({
      title: 'Montaje Prueba M2',
      date: '2026-12-11',
      startTime: '10:00',
      endTime: '11:00',
      dependsOn: [a.id],
    });
    const expected = await expectedFor(a.id, -60);
    expect(expected.map(e => e.id)).toEqual([a.id]);
    const res = await ok<MoveTaskResponse>(
      await move(a.id, -60, expected, 'conflict_advance'),
    );
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]).toMatchObject({
      startsAt: '2026-12-11T08:00:00.000Z',
      endsAt: '2026-12-11T09:00:00.000Z',
    });
    const after = (await tasks()).find(t => t.id === b.id)!;
    expect(after).toMatchObject({startsAt: b.startsAt, version: b.version});
    expect((await historyOf(a.id))[0]?.origin).toBe('conflict_advance');
  });

  it('changes the local day when a move crosses midnight', async () => {
    const t = await task({
      title: 'Recogida Prueba M3',
      date: '2026-12-12',
      startTime: '23:00',
      endTime: '23:30',
    });
    const res = await ok<MoveTaskResponse>(
      await move(t.id, 90, await expectedFor(t.id, 90)),
    );
    expect(res.tasks[0]).toMatchObject({date: '2026-12-13', endDate: null});
    expect((await historyOf(t.id))[0]?.changedFields).toEqual([
      'date',
      'startsAt',
      'endsAt',
    ]);
  });

  it('is refused outside the venue’s known opening hours, with the reason', async () => {
    const t = await task({
      title: 'Carga Prueba M4',
      venueName: 'Nave Prueba Horario',
      date: '2026-12-14',
      startTime: '18:00',
      endTime: '19:00',
    });
    // Unknown hours limit nothing.
    const free = await ok<MoveTaskResponse>(
      await move(t.id, 60, await expectedFor(t.id, 60)),
    );
    expect(free.tasks[0]?.endsAt).toBe('2026-12-14T20:00:00.000Z');
    const venue = await venueNamed('Nave Prueba Horario');
    await ok<Venue>(
      await patch(`/venues/${venue.id}`, {
        version: venue.version,
        openingHours: {opensAt: '08:00', closesAt: '20:00'},
      }),
    );
    const err = await errorOf(
      await move(t.id, 5, await expectedFor(t.id, 5)),
      400,
    );
    expect(err.code).toBe('VALIDATION');
    expect(err.fields?.minutes).toContain('08:00 a 20:00');
    expect(err.fields?.minutes).toContain('Nave Prueba Horario');
    const unchanged = (await tasks()).find(x => x.id === t.id)!;
    expect(unchanged.endsAt).toBe('2026-12-14T20:00:00.000Z');
    // Back inside is fine.
    await ok<MoveTaskResponse>(
      await move(t.id, -60, await expectedFor(t.id, -60)),
    );
  });

  it('never moves a fixed task: under way or done dependants stay; an under-way root is refused', async () => {
    const a = await task({
      title: 'Descarga Prueba M5',
      date: '2026-12-15',
      startTime: '09:00',
      endTime: '10:00',
    });
    const b = await task({
      title: 'Montaje Prueba M5',
      date: '2026-12-15',
      startTime: '10:00',
      endTime: '11:00',
      status: 'in_progress',
      dependsOn: [a.id],
    });
    const expected = await expectedFor(a.id, 30);
    expect(expected.map(e => e.id)).toEqual([a.id]);
    await ok<MoveTaskResponse>(await move(a.id, 30, expected));
    expect((await tasks()).find(t => t.id === b.id)?.startsAt).toBe(b.startsAt);

    const err = await errorOf(
      await move(b.id, 15, [
        {
          id: b.id,
          version: b.version,
          startsAt: b.startsAt!,
          endsAt: b.endsAt!,
        },
      ]),
      400,
    );
    expect(err.fields?.minutes).toMatch(/en marcha/);
    const untimed = await task({
      title: 'Sin hora Prueba M5',
      date: '2026-12-15',
    });
    const err2 = await errorOf(
      await move(untimed.id, 15, [
        {
          id: untimed.id,
          version: 1,
          startsAt: '2026-12-15T09:00:00Z',
          endsAt: '2026-12-15T10:00:00Z',
        },
      ]),
      400,
    );
    expect(err2.fields?.minutes).toMatch(/horario/);
  });

  it('409 with the involved tasks when the plan changed since the confirmation', async () => {
    const a = await task({
      title: 'Descarga Prueba M6',
      date: '2026-12-16',
      startTime: '09:00',
      endTime: '10:00',
    });
    const b = await task({
      title: 'Montaje Prueba M6',
      date: '2026-12-16',
      startTime: '10:00',
      endTime: '11:00',
      dependsOn: [a.id],
    });
    const expected = await expectedFor(a.id, 30);
    // Someone edits the dependant in between.
    await ok<Task>(
      await patch(`/tasks/${b.id}`, {
        version: b.version,
        title: 'Montaje Prueba M6 bis',
      }),
    );
    const err = await errorOf(await move(a.id, 30, expected), 409);
    expect(err.code).toBe('VERSION_CONFLICT');
    expect((err.current as Task[]).map(t => t.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect((await tasks()).find(t => t.id === a.id)?.version).toBe(a.version);
    // Only part of what moves confirmed → 409 too.
    const fresh = await expectedFor(a.id, 30);
    expect((await move(a.id, 30, fresh.slice(0, 1))).status).toBe(409);
    // A different amount than confirmed → 409.
    expect((await move(a.id, 15, fresh)).status).toBe(409);
  });

  it('keeps heavy load and the declared subsoil review: same venue, same material', async () => {
    const t = await task({
      title: 'Escenario Prueba M7',
      kind: 'assembly',
      venueName: 'Plaza Prueba Subsuelo',
      date: '2026-12-17',
      startTime: '09:00',
      endTime: '12:00',
      heavyLoad: true,
      subsoilReviewed: true,
    });
    expect(t.subsoilReview).not.toBeNull();
    const res = await ok<MoveTaskResponse>(
      await move(t.id, 45, await expectedFor(t.id, 45)),
    );
    expect(res.tasks[0]).toMatchObject({
      heavyLoad: true,
      subsoilReview: t.subsoilReview,
      venue: t.venue,
      resourceIds: t.resourceIds,
      status: t.status,
    });
    // And a heavy task without review keeps its subsoil reminder after the move.
    const u = await task({
      title: 'Generador Prueba M7',
      kind: 'delivery',
      date: '2026-12-17',
      startTime: '13:00',
      endTime: '14:00',
      heavyLoad: true,
    });
    await ok<MoveTaskResponse>(
      await move(u.id, 30, await expectedFor(u.id, 30)),
    );
    expect(
      planWarnings(await tasks()).some(w => w.key === `heavy:${u.id}`),
    ).toBe(true);
  });

  it('«Deshacer» puts every moved task back if none changed since; otherwise 409', async () => {
    const a = await task({
      title: 'Descarga Prueba M8',
      date: '2026-12-18',
      startTime: '09:00',
      endTime: '10:00',
    });
    const b = await task({
      title: 'Montaje Prueba M8',
      date: '2026-12-18',
      startTime: '10:00',
      endTime: '11:00',
      dependsOn: [a.id],
    });
    const moved = await ok<MoveTaskResponse>(
      await move(a.id, 20, await expectedFor(a.id, 20), 'conflict_delay'),
    );
    const back = moved.tasks.map(t => {
      const before = t.id === a.id ? a : b;
      return {
        id: t.id,
        version: t.version,
        startsAt: before.startsAt!,
        endsAt: before.endsAt!,
      };
    });
    const undone = await ok<MoveTaskResponse>(
      await move(a.id, -20, back, 'undo'),
    );
    const byId = new Map(undone.tasks.map(t => [t.id, t]));
    expect(byId.get(a.id)?.startsAt).toBe(a.startsAt);
    expect(byId.get(b.id)?.startsAt).toBe(b.startsAt);
    expect((await historyOf(b.id))[0]?.origin).toBe('undo');
    // A second undo with the old versions: they changed → 409, nothing written.
    expect((await move(a.id, -20, back, 'undo')).status).toBe(409);
    // A window that changes the duration is not an undo.
    const now = (await tasks()).find(t => t.id === a.id)!;
    const stretched = [
      {
        id: a.id,
        version: now.version,
        startsAt: now.startsAt!,
        endsAt: '2026-12-18T12:00:00.000Z',
      },
    ];
    expect((await move(a.id, -20, stretched, 'undo')).status).toBe(409);
  });

  it('validates the amount, 403 for guests, 404 for unknown or foreign tasks', async () => {
    const t = await task({
      title: 'Prueba M9',
      date: '2026-12-19',
      startTime: '09:00',
      endTime: '10:00',
    });
    const exp = await expectedFor(t.id, 5);
    for (const minutes of [0, 7, 1445, 2.5]) {
      const err = await errorOf(await move(t.id, minutes, exp), 400);
      expect(err.fields?.minutes).toMatch(/minutos/);
    }
    expect((await move(t.id, 5, exp, 'drag')).status).toBe(400);
    expect((await move(t.id, 5, [])).status).toBe(400);
    expect((await move(t.id, 5, exp, 'calendar', guest)).status).toBe(403);
    expect((await move(foreignTaskId, 5, exp)).status).toBe(404);
    expect((await move('no-es-un-id', 5, exp)).status).toBe(404);
  });
});

describe('accepted conflicts («Mantener ambas»)', () => {
  let a: Task;
  let b: Task;
  let warning: PlanWarning;
  const windows = (list: Task[]) =>
    list.map(t => ({taskId: t.id, startsAt: t.startsAt, endsAt: t.endsAt}));

  beforeAll(async () => {
    const slot = {
      venueName: 'Plaza Prueba Aceptada',
      date: '2026-12-20',
      startTime: '09:00',
      endTime: '11:00',
    };
    a = await task({title: 'Carpa Prueba A1', ...slot});
    b = await task({
      title: 'Carpa Prueba B1',
      ...slot,
      startTime: '10:00',
      endTime: '12:00',
    });
    warning = planWarnings(await tasks()).find(
      w =>
        w.kind === 'venue_overlap' &&
        w.taskIds.includes(a.id) &&
        w.taskIds.includes(b.id),
    )!;
    expect(warning).toBeTruthy();
  });

  it('accepts a current conflict with a reason, signed and logged; it applies until a task moves', async () => {
    const since = (
      await ok<ChangesResponse>(
        await h.request('GET', orgPath('changes'), {token}),
      )
    ).cursor;
    const created = await ok<ConflictAcceptance>(
      await post('/conflict-acceptances', {
        warningKey: warning.key,
        windows: windows([b, a]),
        reason: '  Comparten   la carpa  ',
      }),
      201,
    );
    expect(created).toMatchObject({
      warningKey: warning.key,
      reason: 'Comparten la carpa',
      acceptedBy: {displayName: 'Elvis'},
      restricted: false,
    });
    expect(acceptanceApplies(created, await tasks())).toBe(true);
    const list = await listOf<ConflictAcceptance>('conflict-acceptances');
    expect(list[0]?.id).toBe(created.id);
    const changes = await ok<ChangesResponse>(
      await h.request('GET', orgPath(`changes?since=${since}`), {token}),
    );
    expect(changes.types).toContain('conflict_acceptance');
    const [entry] = await listOf<ActivityEntry>('activity?limit=1');
    expect(entry).toMatchObject({
      entityType: 'conflict_acceptance',
      entityId: created.id,
      entityLabel: warning.title,
      action: 'create',
    });

    // The same warning again while it applies → DUPLICATE with it.
    const dup = await errorOf(
      await post('/conflict-acceptances', {
        warningKey: warning.key,
        windows: windows([a, b]),
        reason: 'Otra vez',
      }),
      409,
    );
    expect(dup.code).toBe('DUPLICATE');
    expect(dup.current).toMatchObject({id: created.id});

    // One task moves: the acceptance no longer applies (kept as a record).
    const moved = await ok<MoveTaskResponse>(
      await move(b.id, 15, await expectedFor(b.id, 15), 'conflict_delay'),
    );
    expect(acceptanceApplies(created, await tasks())).toBe(false);
    expect(
      (await listOf<ConflictAcceptance>('conflict-acceptances')).some(
        x => x.id === created.id,
      ),
    ).toBe(true);
    // The old windows no longer match the plan → 409; the new ones can be accepted.
    const stale = await errorOf(
      await post('/conflict-acceptances', {
        warningKey: warning.key,
        windows: windows([a, b]),
        reason: 'Seguimos',
      }),
      409,
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect((stale.current as Task[]).map(t => t.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    b = moved.tasks.find(t => t.id === b.id)!;
    const renewed = await ok<ConflictAcceptance>(
      await post('/conflict-acceptances', {
        warningKey: warning.key,
        windows: windows([a, b]),
        reason: 'Seguimos compartiendo',
      }),
      201,
    );
    expect(acceptanceApplies(renewed, await tasks())).toBe(true);

    // Withdraw: 204, logged; then 404.
    expect(
      (
        await h.request('DELETE', `/conflict-acceptances/${renewed.id}`, {
          token,
        })
      ).status,
    ).toBe(204);
    const [gone] = await listOf<ActivityEntry>('activity?limit=1');
    expect(gone).toMatchObject({
      entityType: 'conflict_acceptance',
      action: 'delete',
      entityLabel: warning.title,
    });
    expect(
      (
        await h.request('DELETE', `/conflict-acceptances/${renewed.id}`, {
          token,
        })
      ).status,
    ).toBe(404);
  });

  it('only conflicts: a reminder (routes, subsoil) is never accepted; unknown warnings are 409', async () => {
    const heavy = await task({
      title: 'Generador Prueba A2',
      kind: 'delivery',
      date: '2026-12-21',
      startTime: '09:00',
      endTime: '10:00',
      heavyLoad: true,
    });
    const err = await errorOf(
      await post('/conflict-acceptances', {
        warningKey: `heavy:${heavy.id}`,
        windows: windows([heavy]),
        reason: 'No hace falta',
      }),
      400,
    );
    expect(err.fields?.warningKey).toMatch(/recordatorios/);
    const gone = await errorOf(
      await post('/conflict-acceptances', {
        warningKey: `venue:${heavy.id}:${a.id}`,
        windows: windows([heavy, a]),
        reason: 'No existe',
      }),
      409,
    );
    expect(gone.code).toBe('VERSION_CONFLICT');
  });

  it('validates the reason and the key; 403 for guests, who read it without the reason', async () => {
    const bad = async (body: Record<string, unknown>, field: string) => {
      const res = await post('/conflict-acceptances', {
        warningKey: warning.key,
        windows: windows([a, b]),
        reason: 'Motivo válido',
        ...body,
      });
      const err = await errorOf(res, 400);
      expect(err.fields?.[field]).toBeTruthy();
    };
    await bad({reason: ' a '}, 'reason');
    await bad({reason: 'x'.repeat(281)}, 'reason');
    await bad({warningKey: 'cualquier cosa'}, 'warningKey');
    await bad({windows: []}, 'windows');
    expect(
      (
        await post(
          '/conflict-acceptances',
          {
            warningKey: warning.key,
            windows: windows([a, b]),
            reason: 'Invitado',
          },
          guest,
        )
      ).status,
    ).toBe(403);
    const asGuest = await listOf<ConflictAcceptance>(
      'conflict-acceptances',
      guest,
    );
    expect(asGuest.length).toBeGreaterThan(0);
    expect(asGuest.every(x => x.reason === null && x.restricted)).toBe(true);
  });
});
