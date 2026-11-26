/**
 * Milestone 5 on the server: the declared «Subsuelo revisado en el simulador»
 * mark on tasks, and delay hypotheses (store, discard, apply). Applying is
 * recomputed by the server with the shared functions and written only when it
 * matches what the member confirmed; otherwise 409 and nothing changes.
 * Fictitious data only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Db, Queryable} from '../src/db/db.ts';
import {clearDemo} from '../src/demo/service.ts';
import {AppError} from '../src/errors.ts';
import {applyHypothesis} from '../src/hypotheses/service.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {
  delayItems,
  shiftExpectations,
} from '../../shared/logistics/followup.ts';
import {hypothesisLabel} from '../../shared/logistics/history.ts';
import {simulateDelay} from '../../shared/logistics/schedule.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  ApplyHypothesisResponse,
  DelayHypothesis,
  DelayMode,
  ListResponse,
  Resource,
  SessionUser,
  ShiftExpectation,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;
let guest: string;
let elvis: SessionUser;
let foreign: {orgId: string; taskId: string; hypothesisId: string};

/** Free text that must never appear in a label or an activity entry. */
const MARKER = 'MARCA-HIPOTESIS-PRIVADA-9K';

beforeAll(async () => {
  h = await createHarness();
  const login = await h.login('Elvis');
  token = login.token;
  elvis = login.user;
  dailos = (await h.login('Dailos')).token;
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
  const [hyp] = await h.db.query<{id: string}>(
    `INSERT INTO hypotheses (organization_id, task_id, task_title, delay_minutes, created_by)
     VALUES ($1, $2, 'Tarea ajena Prueba', 15, $3) RETURNING id`,
    [org!.id, task!.id, user!.id],
  );
  foreign = {orgId: org!.id, taskId: task!.id, hypothesisId: hyp!.id};
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

async function fieldsOf(res: Response): Promise<Record<string, string>> {
  expect(res.status).toBe(400);
  const body = await json<ApiErrorBody>(res);
  expect(body.code).toBe('VALIDATION');
  return body.fields ?? {};
}

async function createTask(body: Record<string, unknown>): Promise<Task> {
  return ok<Task>(await post('/tasks', body), 201);
}

async function updateTask(
  task: Task,
  body: Record<string, unknown>,
  t = token,
): Promise<Task> {
  return ok<Task>(
    await patch(`/tasks/${task.id}`, {version: task.version, ...body}, t),
  );
}

async function createHypothesis(
  body: Record<string, unknown>,
): Promise<DelayHypothesis> {
  return ok<DelayHypothesis>(await post('/hypotheses', body), 201);
}

async function tasks(): Promise<Task[]> {
  return (
    await ok<ListResponse<Task>>(
      await h.request('GET', orgPath('tasks'), {token}),
    )
  ).items;
}

async function taskById(id: string): Promise<Task | undefined> {
  return (await tasks()).find(t => t.id === id);
}

async function hypotheses(t = token): Promise<DelayHypothesis[]> {
  return (
    await ok<ListResponse<DelayHypothesis>>(
      await h.request('GET', orgPath('hypotheses'), {token: t}),
    )
  ).items;
}

async function history(type: string, id: string): Promise<ActivityEntry[]> {
  return (
    await ok<ListResponse<ActivityEntry>>(
      await h.request(
        'GET',
        `${orgPath('activity')}?entityType=${type}&entityId=${id}`,
        {token},
      ),
    )
  ).items;
}

/** What the UI shows and the member confirms: the shift on the current plan. */
async function expectedFor(
  rootId: string,
  minutes: number,
  mode: DelayMode = 'shift',
): Promise<ShiftExpectation[]> {
  const plan = await tasks();
  const impact = simulateDelay(delayItems(plan, rootId), rootId, minutes, mode);
  return shiftExpectations(impact, plan);
}

function apply(
  id: string,
  body: {expected: ShiftExpectation[]; markDelayed?: boolean},
  t = token,
) {
  return h.request('POST', `/hypotheses/${id}/apply`, {token: t, body});
}

/** A finish-to-start chain A → B → C with 30 minutes of slack before C. */
async function chain(prefix: string, date = '2026-12-02') {
  const venueName = `Plaza ${prefix} Prueba`;
  const a = await createTask({
    title: `${prefix} A`,
    kind: 'delivery',
    venueName,
    date,
    startTime: '09:00',
    endTime: '10:00',
  });
  const b = await createTask({
    title: `${prefix} B`,
    kind: 'assembly',
    venueName,
    date,
    startTime: '10:00',
    endTime: '11:00',
    dependsOn: [a.id],
    heavyLoad: true,
    subsoilReviewed: true,
  });
  const c = await createTask({
    title: `${prefix} C`,
    venueName,
    date,
    startTime: '11:30',
    endTime: '12:00',
    dependsOn: [b.id],
  });
  return {a, b, c};
}

// ================================================================ subsoil mark

describe('subsoil review · declared mark', () => {
  it('is declared only on a heavy task, with a Spanish message on the field', async () => {
    for (const heavyLoad of [undefined, null, false]) {
      const fields = await fieldsOf(
        await post('/tasks', {
          title: 'Escenario Prueba',
          heavyLoad,
          subsoilReviewed: true,
        }),
      );
      expect(fields.subsoilReviewed).toBe(
        'Solo se puede declarar en una tarea con carga pesada.',
      );
    }
    const light = await createTask({title: 'Vallas Prueba', heavyLoad: false});
    expect(light.subsoilReview).toBeNull();
    for (const subsoilReviewed of [true, false]) {
      const fields = await fieldsOf(
        await patch(`/tasks/${light.id}`, {
          version: light.version,
          subsoilReviewed,
        }),
      );
      expect(fields.subsoilReviewed).toMatch(/carga pesada/);
    }
    // Clearing the heavy load in the same request as declaring is refused too.
    const heavy = await createTask({title: 'Grupo Prueba', heavyLoad: true});
    const fields = await fieldsOf(
      await patch(`/tasks/${heavy.id}`, {
        version: heavy.version,
        heavyLoad: null,
        subsoilReviewed: true,
      }),
    );
    expect(fields.subsoilReviewed).toMatch(/carga pesada/);
    expect(
      (
        await fieldsOf(
          await patch(`/tasks/${heavy.id}`, {
            version: heavy.version,
            subsoilReviewed: 'sí',
          }),
        )
      ).subsoilReviewed,
    ).toMatch(/sí o no/);
  });

  it('is never set by default: heavy tasks start without it', async () => {
    const t = await createTask({title: 'Generador Prueba', heavyLoad: true});
    expect(t.subsoilReview).toBeNull();
    const seeded = (await tasks()).filter(x => x.isDemo);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every(x => x.subsoilReview === null)).toBe(true);
  });

  it('declares on create with heavy load as the current user now', async () => {
    const t = await createTask({
      title: 'Escenario Prueba',
      heavyLoad: true,
      subsoilReviewed: true,
    });
    expect(t.subsoilReview).toEqual({
      by: {id: elvis.id, displayName: 'Elvis'},
      at: h.clock.now().toISOString(),
    });
  });

  it('declares and withdraws on update; both are logged as subsoilReview', async () => {
    let t = await createTask({title: 'Depósito Prueba', heavyLoad: true});
    t = await updateTask(t, {subsoilReviewed: true});
    expect(t.subsoilReview?.by.displayName).toBe('Elvis');
    expect(t.version).toBe(2);
    const declaredAt = t.subsoilReview?.at;

    // Declaring again with nothing else changed is not a change.
    h.clock.advance(60_000);
    const again = await updateTask(t, {subsoilReviewed: true}, dailos);
    expect(again.version).toBe(2);
    expect(again.subsoilReview).toEqual(t.subsoilReview);

    t = await updateTask(t, {subsoilReviewed: false});
    expect(t.subsoilReview).toBeNull();
    const log = await history('task', t.id);
    expect(log[0]!.changedFields).toEqual(['subsoilReview']);
    expect(log[1]!.changedFields).toEqual(['subsoilReview']);
    expect(declaredAt).toBeDefined();
  });

  it('keeps the mark on time, status, company or notes changes', async () => {
    let t = await createTask({
      title: 'Lastre Prueba',
      heavyLoad: true,
      venueName: 'Plaza del Adelantado',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
      subsoilReviewed: true,
    });
    const review = t.subsoilReview;
    expect(review).not.toBeNull();
    t = await updateTask(t, {startTime: '11:00', endTime: '12:00'});
    t = await updateTask(t, {status: 'confirmed', notes: 'Prueba'});
    t = await updateTask(t, {companyName: 'Grúas Demo Prueba'});
    t = await updateTask(t, {venueName: 'PLAZA DEL ADELANTADO'});
    expect(t.subsoilReview).toEqual(review);
    for (const entry of (await history('task', t.id)).slice(0, 3)) {
      expect(entry.changedFields).not.toContain('subsoilReview');
    }
  });

  it('clears the mark when the venue, the heavy load or the resources change, and logs it', async () => {
    const resource = await ok<Resource>(
      await post('/resources', {name: 'Tarima Prueba', quantity: 4}),
      201,
    );
    let t = await createTask({
      title: 'Tarima del grupo Prueba',
      heavyLoad: true,
      venueName: 'Plaza de la Concepción',
      subsoilReviewed: true,
    });

    t = await updateTask(t, {venueName: 'Plaza del Cristo'});
    expect(t.subsoilReview).toBeNull();
    expect((await history('task', t.id))[0]!.changedFields).toEqual([
      'venue',
      'subsoilReview',
    ]);

    t = await updateTask(t, {subsoilReviewed: true});
    t = await updateTask(t, {resourceIds: [resource.id]});
    expect(t.subsoilReview).toBeNull();
    expect((await history('task', t.id))[0]!.changedFields).toEqual([
      'resourceIds',
      'subsoilReview',
    ]);

    t = await updateTask(t, {subsoilReviewed: true});
    t = await updateTask(t, {heavyLoad: null});
    expect(t.subsoilReview).toBeNull();
    expect((await history('task', t.id))[0]!.changedFields).toEqual([
      'heavyLoad',
      'subsoilReview',
    ]);
  });

  it('a new placement declared in the same request renews the mark to that person', async () => {
    let t = await createTask({
      title: 'Carpa grande Prueba',
      heavyLoad: true,
      venueName: 'Plaza de la Concepción',
      subsoilReviewed: true,
    });
    h.clock.advance(60_000);
    t = await updateTask(
      t,
      {venueName: 'Plaza del Cristo', subsoilReviewed: true},
      dailos,
    );
    expect(t.venue?.name).toBe('Plaza del Cristo');
    expect(t.subsoilReview).toEqual({
      by: {id: expect.any(String), displayName: 'Dailos'},
      at: h.clock.now().toISOString(),
    });
  });

  it('deleting a resource a task uses clears the mark (the material changed)', async () => {
    const resource = await ok<Resource>(
      await post('/resources', {name: 'Generador Prueba 2'}),
      201,
    );
    const t = await createTask({
      title: 'Generador del escenario Prueba',
      heavyLoad: true,
      resourceIds: [resource.id],
      subsoilReviewed: true,
    });
    expect(t.subsoilReview).not.toBeNull();
    const res = await h.request(
      'DELETE',
      `/resources/${resource.id}?version=${resource.version}`,
      {token},
    );
    expect(res.status).toBe(204);
    const after = await taskById(t.id);
    expect(after).toMatchObject({resourceIds: [], subsoilReview: null});
    expect((await history('task', t.id))[0]!.changedFields).toEqual([
      'resourceIds',
      'subsoilReview',
    ]);
  });

  it('editing a resource’s quantity, unit or dimensions clears the mark on the live tasks that use it; name or notes keep it', async () => {
    let resource = await ok<Resource>(
      await post('/resources', {
        name: 'Depósito de agua Prueba',
        quantity: 2,
        dimensions: '1 × 1 m',
      }),
      201,
    );
    const live = await createTask({
      title: 'Depósito vivo Prueba',
      heavyLoad: true,
      resourceIds: [resource.id],
      subsoilReviewed: true,
    });
    const doneRaw = await createTask({
      title: 'Depósito terminado Prueba',
      heavyLoad: true,
      resourceIds: [resource.id],
      subsoilReviewed: true,
    });
    const done = await updateTask(doneRaw, {status: 'done'});
    const editResource = async (body: Record<string, unknown>) => {
      resource = await ok<Resource>(
        await patch(`/resources/${resource.id}`, {
          version: resource.version,
          ...body,
        }),
      );
    };

    // Name and notes describe the record, not the material: the mark stays.
    await editResource({name: 'Depósito de agua grande Prueba', notes: 'x'});
    expect(await taskById(live.id)).toEqual(live);

    for (const change of [
      {quantity: 3},
      {unit: 'litros'},
      {dimensions: '2 × 1 m'},
    ]) {
      let t = (await taskById(live.id))!;
      if (!t.subsoilReview) t = await updateTask(t, {subsoilReviewed: true});
      await editResource(change);
      const after = (await taskById(live.id))!;
      expect(after.subsoilReview, JSON.stringify(change)).toBeNull();
      expect(after.version).toBe(t.version + 1);
      expect(after.resourceIds).toEqual([resource.id]);
      expect((await history('task', live.id))[0]).toMatchObject({
        action: 'update',
        changedFields: ['subsoilReview'],
      });
    }
    // A finished task keeps its declaration (the review was for what was placed).
    expect(await taskById(done.id)).toEqual(done);

    // An edit that sends the same figures changes nothing.
    const t = await updateTask((await taskById(live.id))!, {
      subsoilReviewed: true,
    });
    await editResource({quantity: 3, unit: 'litros'});
    expect(await taskById(live.id)).toEqual(t);
  });

  it('guests cannot declare it', async () => {
    const t = await createTask({title: 'Escenario Prueba 3', heavyLoad: true});
    const res = await patch(
      `/tasks/${t.id}`,
      {version: t.version, subsoilReviewed: true},
      guest,
    );
    expect(res.status).toBe(403);
    expect((await taskById(t.id))?.subsoilReview).toBeNull();
  });
});

// ================================================================ hypotheses

describe('hypotheses · store and discard', () => {
  it('stores a hypothesis without changing the plan; defaults, trimmed note, label without the note', async () => {
    const t = await createTask({
      title: 'Camión del escenario Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
    });
    const hyp = await createHypothesis({
      taskId: t.id,
      delayMinutes: 15,
      note: `  Atasco en la autopista. ${MARKER}  `,
    });
    expect(hyp).toMatchObject({
      organizationId: h.org.id,
      taskId: t.id,
      taskTitle: 'Camión del escenario Prueba',
      delayMinutes: 15,
      mode: 'shift',
      estimated: false,
      note: `Atasco en la autopista. ${MARKER}`,
      createdBy: {id: elvis.id, displayName: 'Elvis'},
      createdAt: h.clock.now().toISOString(),
      appliedAt: null,
      appliedBy: null,
      restricted: false,
    });
    expect(await taskById(t.id)).toEqual(t);

    const blank = await createHypothesis({
      taskId: t.id,
      delayMinutes: 30,
      mode: 'extend',
      estimated: true,
      note: '   ',
    });
    expect(blank).toMatchObject({mode: 'extend', estimated: true, note: null});

    const log = await history('hypothesis', hyp.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: 'create',
      entityType: 'hypothesis',
      entityLabel: hypothesisLabel(hyp),
    });
    expect(JSON.stringify(log)).not.toContain(MARKER);
    expect(hypothesisLabel(blank)).toBe(
      'Se alarga ≈ 30 min · Camión del escenario Prueba',
    );
  });

  it('lists newest first', async () => {
    const t = await createTask({
      title: 'Orden Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
    });
    h.clock.advance(1000);
    const first = await createHypothesis({taskId: t.id, delayMinutes: 5});
    h.clock.advance(1000);
    const second = await createHypothesis({taskId: t.id, delayMinutes: 10});
    const ids = (await hypotheses()).map(x => x.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(ids[0]).toBe(second.id);
  });

  it('validates the delay, the mode, the note and the task, in Spanish', async () => {
    const t = await createTask({
      title: 'Validación Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
    });
    const missing = await fieldsOf(await post('/hypotheses', {}));
    expect(missing.taskId).toBe('Este campo es obligatorio.');
    expect(missing.delayMinutes).toBe('Este campo es obligatorio.');
    for (const delayMinutes of [0, -5, 1441, 1.5, '15']) {
      expect(
        (
          await fieldsOf(
            await post('/hypotheses', {taskId: t.id, delayMinutes}),
          )
        ).delayMinutes,
      ).toMatch(/entre 1 y 1440/);
    }
    expect(
      (
        await fieldsOf(
          await post('/hypotheses', {
            taskId: t.id,
            delayMinutes: 15,
            mode: 'later',
          }),
        )
      ).mode,
    ).toMatch(/Tipo de retraso no válido/);
    expect(
      (
        await fieldsOf(
          await post('/hypotheses', {
            taskId: t.id,
            delayMinutes: 15,
            note: 'x'.repeat(1001),
          }),
        )
      ).note,
    ).toBe('Máximo 1000 caracteres.');
    // The limits themselves are accepted.
    await createHypothesis({taskId: t.id, delayMinutes: 1});
    await createHypothesis({
      taskId: t.id,
      delayMinutes: 1440,
      note: 'x'.repeat(1000),
    });

    for (const taskId of [foreign.taskId, crypto.randomUUID()]) {
      expect(
        (await fieldsOf(await post('/hypotheses', {taskId, delayMinutes: 5})))
          .taskId,
      ).toMatch(/No encontramos esa tarea/);
    }
    expect(
      (
        await fieldsOf(
          await post('/hypotheses', {taskId: 'tarea', delayMinutes: 5}),
        )
      ).taskId,
    ).toBe('Identificador no válido.');
  });

  it('refuses a task that cannot be delayed, with the reason', async () => {
    const untimed = await createTask({title: 'Sin hora Prueba'});
    const dateOnly = await createTask({
      title: 'Solo fecha Prueba',
      date: '2026-12-02',
      startTime: '09:00',
    });
    const done = await createTask({
      title: 'Hecha Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
      status: 'done',
    });
    const cancelled = await createTask({
      title: 'Cancelada Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
      status: 'cancelled',
    });
    const cases: [Task, RegExp][] = [
      [untimed, /no tiene hora de inicio y de fin/],
      [dateOnly, /no tiene hora de inicio y de fin/],
      [done, /ya está hecha/],
      [cancelled, /está cancelada/],
    ];
    for (const [task, reason] of cases) {
      expect(
        (
          await fieldsOf(
            await post('/hypotheses', {taskId: task.id, delayMinutes: 15}),
          )
        ).taskId,
      ).toMatch(reason);
    }
  });

  it('discards an open hypothesis and logs it', async () => {
    const t = await createTask({
      title: 'Descartar Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
    });
    const hyp = await createHypothesis({taskId: t.id, delayMinutes: 20});
    const res = await h.request('DELETE', `/hypotheses/${hyp.id}`, {token});
    expect(res.status).toBe(204);
    expect((await hypotheses()).some(x => x.id === hyp.id)).toBe(false);
    expect((await history('hypothesis', hyp.id)).map(e => e.action)).toEqual([
      'delete',
      'create',
    ]);
    for (const id of [hyp.id, crypto.randomUUID(), 'nada']) {
      expect(
        (await h.request('DELETE', `/hypotheses/${id}`, {token})).status,
      ).toBe(404);
    }
  });

  it('hides other organizations (404) and keeps guests read-only (403)', async () => {
    expect(
      (
        await h.request('GET', `/organizations/${foreign.orgId}/hypotheses`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request('POST', '/hypotheses', {
          token,
          body: {
            organizationId: foreign.orgId,
            taskId: foreign.taskId,
            delayMinutes: 5,
          },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request('DELETE', `/hypotheses/${foreign.hypothesisId}`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await apply(foreign.hypothesisId, {
          expected: [
            {
              id: foreign.taskId,
              version: 1,
              startsAt: '2026-12-02T09:15:00.000Z',
              endsAt: '2026-12-02T10:15:00.000Z',
            },
          ],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          'GET',
          `/organizations/${foreign.orgId}/activity?entityType=hypothesis&entityId=${foreign.hypothesisId}`,
          {token},
        )
      ).status,
    ).toBe(404);
    const [stillThere] = await h.db.query(
      'SELECT applied_at FROM hypotheses WHERE id = $1',
      [foreign.hypothesisId],
    );
    expect(stillThere).toEqual({applied_at: null});

    const t = await createTask({
      title: 'Invitado Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
    });
    const hyp = await createHypothesis({taskId: t.id, delayMinutes: 15});
    expect((await hypotheses(guest)).some(x => x.id === hyp.id)).toBe(true);
    const expected = await expectedFor(t.id, 15);
    for (const res of [
      await post('/hypotheses', {taskId: t.id, delayMinutes: 5}, guest),
      await h.request('DELETE', `/hypotheses/${hyp.id}`, {token: guest}),
      await apply(hyp.id, {expected}, guest),
    ]) {
      expect(res.status).toBe(403);
      expect((await json<ApiErrorBody>(res)).code).toBe('FORBIDDEN');
    }
    expect(await taskById(t.id)).toEqual(t);
    expect((await hypotheses()).find(x => x.id === hyp.id)?.appliedAt).toBe(
      null,
    );
  });

  it('the history filter accepts hypothesis', async () => {
    const res = await h.request(
      'GET',
      `${orgPath('activity')}?entityType=hypothesis&entityId=${crypto.randomUUID()}`,
      {token},
    );
    expect(res.status).toBe(200);
  });
});

// ================================================================ apply

describe('hypotheses · apply', () => {
  it('moves the delayed task and its dependants in one go; absorbed tasks stay; heavy load and subsoil untouched', async () => {
    const {a, b, c} = await chain('Aplicar');
    expect(b.subsoilReview).not.toBeNull();
    const hyp = await createHypothesis({
      taskId: a.id,
      delayMinutes: 20,
      note: MARKER,
    });
    const expected = await expectedFor(a.id, 20);
    expect(expected.map(e => e.id).sort()).toEqual([a.id, b.id].sort());

    h.clock.advance(60_000);
    const result = await ok<ApplyHypothesisResponse>(
      await apply(hyp.id, {expected, markDelayed: true}),
    );
    expect(result.hypothesis).toMatchObject({
      id: hyp.id,
      appliedAt: h.clock.now().toISOString(),
      appliedBy: {id: elvis.id, displayName: 'Elvis'},
    });
    expect(result.tasks.map(t => t.id).sort()).toEqual([a.id, b.id].sort());

    const A = (await taskById(a.id))!;
    const B = (await taskById(b.id))!;
    const C = (await taskById(c.id))!;
    expect(A).toMatchObject({
      startsAt: '2026-12-02T09:20:00.000Z',
      endsAt: '2026-12-02T10:20:00.000Z',
      date: '2026-12-02',
      endDate: null,
      status: 'delayed',
      version: a.version + 1,
      updatedBy: {displayName: 'Elvis'},
    });
    expect(B).toMatchObject({
      startsAt: '2026-12-02T10:20:00.000Z',
      endsAt: '2026-12-02T11:20:00.000Z',
      status: 'planned',
      version: b.version + 1,
      // Never touched by a hypothesis.
      heavyLoad: true,
      subsoilReview: b.subsoilReview,
      dependsOn: [a.id],
      venue: b.venue,
    });
    // C had 30 minutes of slack: it absorbs the delay and does not change.
    expect(C).toEqual(c);
    expect(result.tasks).toEqual([A, B].sort((x, y) => (x.id < y.id ? -1 : 1)));

    expect((await history('task', a.id))[0]).toMatchObject({
      action: 'update',
      changedFields: ['status', 'startsAt', 'endsAt'],
    });
    expect((await history('task', b.id))[0]).toMatchObject({
      action: 'update',
      changedFields: ['startsAt', 'endsAt'],
    });
    const log = await history('hypothesis', hyp.id);
    expect(log[0]).toMatchObject({
      action: 'update',
      changedFields: ['appliedAt'],
      entityLabel: 'Retraso 20 min · Aplicar A',
    });
    expect(JSON.stringify(log)).not.toContain(MARKER);
  });

  it('marks «Con retraso» only when asked and only a task that has not started', async () => {
    const {a} = await chain('Sin marca');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 10});
    await ok(await apply(hyp.id, {expected: await expectedFor(a.id, 10)}));
    expect((await taskById(a.id))?.status).toBe('planned');
    expect((await history('task', a.id))[0]!.changedFields).toEqual([
      'startsAt',
      'endsAt',
    ]);
  });

  it('«se alarga»: an under-way task keeps its start and its status, and only its end moves', async () => {
    const {a, b} = await chain('Alarga');
    const running = await updateTask(a, {status: 'in_progress'});
    const hyp = await createHypothesis({
      taskId: a.id,
      delayMinutes: 45,
      mode: 'extend',
    });
    const expected = await expectedFor(a.id, 45, 'extend');
    await ok(await apply(hyp.id, {expected, markDelayed: true}));
    expect(await taskById(a.id)).toMatchObject({
      startsAt: running.startsAt,
      endsAt: '2026-12-02T10:45:00.000Z',
      status: 'in_progress',
      version: running.version + 1,
    });
    expect((await history('task', a.id))[0]!.changedFields).toEqual(['endsAt']);
    expect(await taskById(b.id)).toMatchObject({
      startsAt: '2026-12-02T10:45:00.000Z',
      endsAt: '2026-12-02T11:45:00.000Z',
    });
  });

  it('applying twice is refused (400); an applied hypothesis cannot be discarded (400)', async () => {
    const {a} = await chain('Dos veces');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 5});
    const expected = await expectedFor(a.id, 5);
    await ok(await apply(hyp.id, {expected}));
    const moved = await taskById(a.id);

    const twice = await apply(hyp.id, {expected: await expectedFor(a.id, 5)});
    expect(twice.status).toBe(400);
    expect((await json<ApiErrorBody>(twice)).message).toMatch(
      /ya se aplicó al plan/,
    );
    const del = await h.request('DELETE', `/hypotheses/${hyp.id}`, {token});
    expect(del.status).toBe(400);
    expect((await json<ApiErrorBody>(del)).message).toMatch(
      /se conserva como registro/,
    );
    expect(await taskById(a.id)).toEqual(moved);
    expect((await hypotheses()).find(x => x.id === hyp.id)?.appliedAt).not.toBe(
      null,
    );
  });

  it('validates the confirmation body', async () => {
    const {a} = await chain('Cuerpo');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 5});
    const empty = await fieldsOf(await apply(hyp.id, {expected: []}));
    expect(empty.expected).toMatch(/Falta la lista de tareas/);
    const bad = await fieldsOf(
      await h.request('POST', `/hypotheses/${hyp.id}/apply`, {
        token,
        body: {
          expected: [{id: a.id, version: 0, startsAt: 'mañana', endsAt: 5}],
          markDelayed: 'sí',
        },
      }),
    );
    expect(bad['expected.0.version']).toMatch(/positivo/);
    expect(bad['expected.0.startsAt']).toMatch(/Hora no válida/);
    expect(bad['expected.0.endsAt']).toMatch(/Hora no válida/);
    expect(bad.markDelayed).toMatch(/sí o no/);
  });

  it('refuses a task listed twice in the confirmation (400), whatever the letter case', async () => {
    const {a} = await chain('Duplicada');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 5});
    const [root] = await expectedFor(a.id, 5);
    for (const twin of [root!, {...root!, id: root!.id.toUpperCase()}]) {
      const fields = await fieldsOf(
        await apply(hyp.id, {expected: [root!, twin]}),
      );
      expect(fields.expected).toMatch(/aparece dos veces/);
    }
    expect(await taskById(a.id)).toEqual(a);
  });

  it('never reveals another organization’s tasks in the 409 current', async () => {
    const {a, b} = await chain('Ajena');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 20});
    const intruder = {
      id: foreign.taskId,
      version: 1,
      startsAt: '2026-12-02T09:20:00.000Z',
      endsAt: '2026-12-02T10:20:00.000Z',
    };
    for (const expected of [
      [...(await expectedFor(a.id, 20)), intruder],
      [intruder],
    ]) {
      const res = await apply(hyp.id, {expected});
      expect(res.status).toBe(409);
      const raw = await res.text();
      expect(raw).not.toContain(foreign.taskId);
      expect(raw).not.toContain('Tarea ajena Prueba');
      const current = (JSON.parse(raw) as ApiErrorBody).current as Task[];
      expect(current.map(t => t.id).sort()).toEqual([a.id, b.id].sort());
      expect(current.every(t => t.organizationId === h.org.id)).toBe(true);
    }
    expect(await taskById(a.id)).toEqual(a);
    const [stranger] = await h.db.query<{version: number}>(
      'SELECT version FROM tasks WHERE id = $1',
      [foreign.taskId],
    );
    expect(stranger).toEqual({version: 1});
  });

  it('a stale version: 409 with the involved tasks as they are now, and nothing changes', async () => {
    const {a, b, c} = await chain('Versión');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 20});
    const expected = await expectedFor(a.id, 20);
    // Someone edits a moved task in between (not its times).
    const edited = await updateTask(b, {notes: 'Cambio de Prueba'}, dailos);

    const res = await apply(hyp.id, {expected, markDelayed: true});
    expect(res.status).toBe(409);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.message).toMatch(/El plan ha cambiado/);
    const current = body.current as Task[];
    expect(current.map(t => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(current.find(t => t.id === b.id)).toEqual(edited);

    expect(await taskById(a.id)).toEqual(a);
    expect(await taskById(b.id)).toEqual(edited);
    expect(await taskById(c.id)).toEqual(c);
    expect((await hypotheses()).find(x => x.id === hyp.id)?.appliedAt).toBe(
      null,
    );

    // Recomputed on the current plan, the same hypothesis applies.
    await ok(await apply(hyp.id, {expected: await expectedFor(a.id, 20)}));
    expect((await taskById(b.id))?.startsAt).toBe('2026-12-02T10:20:00.000Z');
  });

  it('a plan changed in between (different tasks or times): 409 and nothing changes', async () => {
    const {a, b, c} = await chain('Plan');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 45});
    const expected = await expectedFor(a.id, 45);
    // A, B and C would move. Then C is pushed later, so it absorbs the delay.
    expect(expected).toHaveLength(3);
    const later = await updateTask(c, {startTime: '13:00', endTime: '13:30'});
    const res = await apply(hyp.id, {expected});
    expect(res.status).toBe(409);
    const current = (await json<ApiErrorBody>(res)).current as Task[];
    expect(current.map(t => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(await taskById(a.id)).toEqual(a);
    expect(await taskById(b.id)).toEqual(b);
    expect(await taskById(c.id)).toEqual(later);

    // Times the member never saw are refused too.
    const tampered = (await expectedFor(a.id, 45)).map(e => ({
      ...e,
      endsAt: new Date(Date.parse(e.endsAt) + 60_000).toISOString(),
    }));
    expect((await apply(hyp.id, {expected: tampered})).status).toBe(409);
    expect(await taskById(a.id)).toEqual(a);
  });

  it('a task that can no longer be delayed: 409 and nothing changes', async () => {
    const {a, b} = await chain('Hecha');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 15});
    const expected = await expectedFor(a.id, 15);
    const done = await updateTask(a, {status: 'done'});
    const res = await apply(hyp.id, {expected});
    expect(res.status).toBe(409);
    const current = (await json<ApiErrorBody>(res)).current as Task[];
    expect(current.find(t => t.id === a.id)).toEqual(done);
    expect(await taskById(a.id)).toEqual(done);
    expect(await taskById(b.id)).toEqual(b);
  });

  it('is atomic: a failure on the second task write leaves every task as it was', async () => {
    const {a, b} = await chain('Atómico');
    const hyp = await createHypothesis({taskId: a.id, delayMinutes: 20});
    const expected = await expectedFor(a.id, 20);
    let writes = 0;
    const failing = (tx: Queryable): Queryable => ({
      query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        if (/^\s*UPDATE tasks\s/.test(sql) && ++writes === 2) {
          return Promise.reject(new Error('fallo simulado'));
        }
        return tx.query<T>(sql, params);
      },
      exec: sql => tx.exec(sql),
    });
    const db: Db = {
      query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        return h.db.query<T>(sql, params);
      },
      exec: sql => h.db.exec(sql),
      close: () => Promise.resolve(),
      transaction: fn => h.db.transaction(tx => fn(failing(tx))),
    };
    await expect(
      applyHypothesis(
        db,
        elvis,
        hyp.id,
        {expected, markDelayed: true},
        h.clock.now(),
      ),
    ).rejects.toThrow('fallo simulado');
    expect(writes).toBe(2);
    expect(await taskById(a.id)).toEqual(a);
    expect(await taskById(b.id)).toEqual(b);
    expect((await hypotheses()).find(x => x.id === hyp.id)?.appliedAt).toBe(
      null,
    );
    expect(
      (await history('task', a.id)).filter(e => e.action === 'update'),
    ).toEqual([]);
  });

  it('keeps the stored days consistent across midnight', async () => {
    // 22:00–23:30 + 60 min → 23:00–00:30: an overnight slot, no end date.
    const late = await createTask({
      title: 'Desmontaje nocturno Prueba',
      date: '2026-12-02',
      startTime: '22:00',
      endTime: '23:30',
    });
    let hyp = await createHypothesis({taskId: late.id, delayMinutes: 60});
    await ok(await apply(hyp.id, {expected: await expectedFor(late.id, 60)}));
    let t = (await taskById(late.id))!;
    expect(t).toMatchObject({
      date: '2026-12-02',
      endDate: null,
      startsAt: '2026-12-02T23:00:00.000Z',
      endsAt: '2026-12-03T00:30:00.000Z',
    });
    expect((await history('task', late.id))[0]!.changedFields).toEqual([
      'startsAt',
      'endsAt',
    ]);

    // Another 90 min: it now starts the next day.
    hyp = await createHypothesis({taskId: late.id, delayMinutes: 90});
    await ok(await apply(hyp.id, {expected: await expectedFor(late.id, 90)}));
    t = (await taskById(late.id))!;
    expect(t).toMatchObject({
      date: '2026-12-03',
      endDate: null,
      startsAt: '2026-12-03T00:30:00.000Z',
      endsAt: '2026-12-03T02:00:00.000Z',
    });
    expect((await history('task', late.id))[0]!.changedFields).toEqual([
      'date',
      'startsAt',
      'endsAt',
    ]);
  });

  it('uses the task’s time zone for the stored day (summer time in Canarias)', async () => {
    // 2027-07-10 23:00 local is 22:00 UTC; +90 min is 00:30 local on the 11th.
    const t0 = await createTask({
      title: 'Traslado de verano Prueba',
      date: '2027-07-10',
      startTime: '23:00',
      endTime: '23:45',
    });
    expect(t0.startsAt).toBe('2027-07-10T22:00:00.000Z');
    const hyp = await createHypothesis({taskId: t0.id, delayMinutes: 90});
    await ok(await apply(hyp.id, {expected: await expectedFor(t0.id, 90)}));
    expect(await taskById(t0.id)).toMatchObject({
      date: '2027-07-11',
      endDate: null,
      startsAt: '2027-07-10T23:30:00.000Z',
      endsAt: '2027-07-11T00:15:00.000Z',
    });
  });

  it('keeps a multi-day task’s last day, and moves it when the end crosses into another day', async () => {
    const fair = await createTask({
      title: 'Feria Prueba',
      date: '2026-12-01',
      endDate: '2026-12-03',
      startTime: '08:00',
      endTime: '18:00',
    });
    let hyp = await createHypothesis({taskId: fair.id, delayMinutes: 120});
    await ok(await apply(hyp.id, {expected: await expectedFor(fair.id, 120)}));
    expect(await taskById(fair.id)).toMatchObject({
      date: '2026-12-01',
      endDate: '2026-12-03',
      startsAt: '2026-12-01T10:00:00.000Z',
      endsAt: '2026-12-03T20:00:00.000Z',
    });
    // Se alarga 300 min: it now ends at 01:00 on the 4th.
    hyp = await createHypothesis({
      taskId: fair.id,
      delayMinutes: 300,
      mode: 'extend',
    });
    await ok(
      await apply(hyp.id, {
        expected: await expectedFor(fair.id, 300, 'extend'),
      }),
    );
    const t = (await taskById(fair.id))!;
    expect(t).toMatchObject({
      date: '2026-12-01',
      endDate: '2026-12-04',
      startsAt: '2026-12-01T10:00:00.000Z',
      endsAt: '2026-12-04T01:00:00.000Z',
    });
    expect((await history('task', fair.id))[0]!.changedFields).toEqual([
      'endDate',
      'endsAt',
    ]);
  });
});

// ================================================================ deletes

describe('hypotheses · when their task goes', () => {
  it('deleting a task deletes its open hypotheses and keeps the applied ones with their label', async () => {
    const {a} = await chain('Borrar');
    const open = await createHypothesis({taskId: a.id, delayMinutes: 30});
    const applied = await createHypothesis({taskId: a.id, delayMinutes: 5});
    await ok(await apply(applied.id, {expected: await expectedFor(a.id, 5)}));
    const current = (await taskById(a.id))!;

    const res = await h.request(
      'DELETE',
      `/tasks/${a.id}?version=${current.version}`,
      {token},
    );
    expect(res.status).toBe(204);
    const list = await hypotheses();
    expect(list.some(x => x.id === open.id)).toBe(false);
    expect(list.find(x => x.id === applied.id)).toMatchObject({
      taskId: null,
      taskTitle: 'Borrar A',
      appliedBy: {displayName: 'Elvis'},
    });
    expect((await history('hypothesis', open.id)).map(e => e.action)).toEqual([
      'delete',
      'create',
    ]);
  });

  it('removing the demo removes hypotheses about demo tasks and keeps the team’s', async () => {
    const demo = (await tasks()).find(
      t => t.isDemo && t.startsAt && t.endsAt && t.status === 'planned',
    )!;
    expect(demo).toBeDefined();
    const demoOpen = await createHypothesis({
      taskId: demo.id,
      delayMinutes: 15,
    });
    const demoApplied = await createHypothesis({
      taskId: demo.id,
      delayMinutes: 5,
    });
    await ok(
      await apply(demoApplied.id, {expected: await expectedFor(demo.id, 5)}),
    );
    const real = await createTask({
      title: 'Real Prueba',
      date: '2026-12-02',
      startTime: '09:00',
      endTime: '10:00',
    });
    const realHyp = await createHypothesis({taskId: real.id, delayMinutes: 15});
    const before = (
      await h.db.query<{n: number}>(
        'SELECT count(*)::int AS n FROM hypotheses WHERE organization_id = $1',
        [h.org.id],
      )
    )[0]!.n;

    const res = await h.request('DELETE', orgPath('demo'), {token});
    expect(res.status).toBe(200);
    const list = await hypotheses();
    expect(list.some(x => x.id === demoOpen.id)).toBe(false);
    expect(list.some(x => x.id === demoApplied.id)).toBe(false);
    expect(list.find(x => x.id === realHyp.id)?.taskId).toBe(real.id);
    expect(list).toHaveLength(before - 2);
    // Their activity was demo activity: gone with it.
    expect(await history('hypothesis', demoOpen.id)).toEqual([]);
    const dangling = await h.db.query(
      `SELECT h.id FROM hypotheses h
        WHERE h.task_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = h.task_id)`,
    );
    expect(dangling).toEqual([]);
  });
});

describe('hypotheses · db:clear-demo', () => {
  it('clears hypotheses about demo tasks in every organization', async () => {
    const other = await createHarness();
    try {
      const {token: t, user} = await other.login('Elvis');
      const plan = (
        await json<ListResponse<Task>>(
          await other.request('GET', `/organizations/${other.org.id}/tasks`, {
            token: t,
          }),
        )
      ).items;
      const demo = plan.find(x => x.isDemo && x.startsAt && x.endsAt)!;
      const res = await other.request('POST', '/hypotheses', {
        token: t,
        body: {organizationId: other.org.id, taskId: demo.id, delayMinutes: 10},
      });
      expect(res.status).toBe(201);
      expect(user.displayName).toBe('Elvis');

      const {removed} = await clearDemo(other.db, {
        organizationId: null,
        actorId: null,
        now: other.clock.now(),
      });
      expect(removed).toBeGreaterThan(0);
      expect(await other.db.query('SELECT id FROM hypotheses')).toEqual([]);
    } finally {
      await other.db.close();
    }
  });
});

describe('hypotheses · service errors', () => {
  it('a 409 is an AppError with the tasks as current', async () => {
    const {a} = await chain('Servicio');
    const [row] = await h.db.query<{id: string}>(
      `INSERT INTO hypotheses (organization_id, task_id, task_title, delay_minutes, created_by)
       VALUES ($1, $2, 'Servicio A', 10, $3) RETURNING id`,
      [h.org.id, a.id, elvis.id],
    );
    const err = await applyHypothesis(
      h.db,
      elvis,
      row!.id,
      {
        expected: [
          {
            id: a.id,
            version: a.version,
            startsAt: a.startsAt!,
            endsAt: a.endsAt!,
          },
        ],
        markDelayed: false,
      },
      h.clock.now(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VERSION_CONFLICT');
    expect(Array.isArray((err as AppError).current)).toBe(true);
  });
});
