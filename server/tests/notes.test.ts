import {beforeAll, describe, expect, it} from 'vitest';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  ListResponse,
  LogisticsEvent,
  Note,
  Resource,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let guest: string;
let eventId: string;
let eventName: string;
/** Records of another organization the pilot users do not belong to. */
let foreign: {orgId: string; eventId: string; taskId: string; noteId: string};

/** Free text that must never appear in a label, an activity entry or a guest response. */
const MARKER = 'MARCA-TEXTO-PRIVADO-7Q';

beforeAll(async () => {
  h = await createHarness();
  token = (await h.login('Elvis')).token;
  guest = (await h.login('Invitado')).token;
  const events = await json<ListResponse<LogisticsEvent>>(
    await h.request('GET', `/organizations/${h.org.id}/events`, {token}),
  );
  eventId = events.items[0]!.id;
  eventName = events.items[0]!.name;

  const [org] = await h.db.query<{id: string}>(
    "INSERT INTO organizations (name) VALUES ('Otra organización') RETURNING id",
  );
  const [user] = await h.db.query<{id: string}>(
    "SELECT id FROM users WHERE display_name = 'Sistema'",
  );
  const insert = async (sql: string) =>
    (await h.db.query<{id: string}>(sql, [org!.id, user!.id]))[0]!.id;
  foreign = {
    orgId: org!.id,
    eventId: await insert(
      `INSERT INTO events (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Evento ajeno', $2, $2) RETURNING id`,
    ),
    taskId: await insert(
      `INSERT INTO tasks (organization_id, title, created_by, updated_by)
       VALUES ($1, 'Tarea ajena', $2, $2) RETURNING id`,
    ),
    noteId: await insert(
      `INSERT INTO notes (organization_id, kind, text, created_by, updated_by)
       VALUES ($1, 'note', 'Nota ajena', $2, $2) RETURNING id`,
    ),
  };
});

const orgPath = (what: string) => `/organizations/${h.org.id}/${what}`;

async function listOf<T>(what: string, t = token): Promise<T[]> {
  const res = await h.request('GET', orgPath(what), {token: t});
  expect(res.status).toBe(200);
  return (await json<ListResponse<T>>(res)).items;
}

function post(path: string, body: Record<string, unknown>, t = token) {
  return h.request('POST', path, {
    token: t,
    body: {organizationId: h.org.id, ...body},
  });
}

async function created<T>(res: Response): Promise<T> {
  expect(res.status).toBe(201);
  return json<T>(res);
}

function patch(path: string, body: Record<string, unknown>, t = token) {
  return h.request('PATCH', path, {token: t, body});
}

async function fieldsOf(res: Response): Promise<Record<string, string>> {
  expect(res.status).toBe(400);
  const body = await json<ApiErrorBody>(res);
  expect(body.code).toBe('VALIDATION');
  return body.fields ?? {};
}

async function activityRaw(query: string, t = token): Promise<Response> {
  return h.request('GET', `${orgPath('activity')}${query}`, {token: t});
}

async function history(type: string, id: string): Promise<ActivityEntry[]> {
  const res = await activityRaw(`?entityType=${type}&entityId=${id}`);
  expect(res.status).toBe(200);
  return (await json<ListResponse<ActivityEntry>>(res)).items;
}

describe('notes', () => {
  it('requires kind and text, with Spanish messages', async () => {
    const fields = await fieldsOf(await post('/notes', {}));
    expect(fields.kind).toBe('Este campo es obligatorio.');
    expect(fields.text).toBe('Este campo es obligatorio.');
    const bad = await fieldsOf(
      await post('/notes', {kind: 'chisme', text: '   ', resolved: 'sí'}),
    );
    expect(bad.kind).toMatch(/Tipo no válido/);
    expect(bad.text).toBe('Este campo es obligatorio.');
    expect(bad.resolved).toMatch(/sí o no/);
    expect(
      (
        await fieldsOf(
          await post('/notes', {kind: 'note', text: 'x'.repeat(5001)}),
        )
      ).text,
    ).toBe('Máximo 5000 caracteres.');
  });

  it('links an event and one record; the label is the record’s current name, never note text', async () => {
    const task = await created<Task>(
      await post('/tasks', {title: 'Montaje de carpas Prueba'}),
    );
    const note = await created<Note>(
      await post('/notes', {
        kind: 'incident',
        text: `  El camión no llega. ${MARKER} `,
        eventId,
        ref: {type: 'task', id: task.id.toUpperCase()},
        source: 'observed',
      }),
    );
    expect(note).toMatchObject({
      organizationId: h.org.id,
      kind: 'incident',
      text: `El camión no llega. ${MARKER}`,
      event: {id: eventId, name: eventName},
      ref: {type: 'task', id: task.id, label: 'Montaje de carpas Prueba'},
      resolved: false,
      source: 'observed',
      verification: 'draft',
      version: 1,
      restricted: false,
    });
    // The label follows the record's current name.
    await patch(`/tasks/${task.id}`, {version: 1, title: 'Montaje Prueba 2'});
    const listed = (await listOf<Note>('notes')).find(n => n.id === note.id)!;
    expect(listed.ref?.label).toBe('Montaje Prueba 2');

    // Activity names the note by kind and what it points at.
    const [created_] = await history('note', note.id);
    expect(created_).toMatchObject({
      action: 'create',
      entityLabel: 'Incidencia · Montaje de carpas Prueba',
    });
  });

  it('rejects an unknown or foreign event or record, and a malformed link, on the field', async () => {
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{eventId: foreign.eventId}, 'eventId', /evento/],
      [{eventId: 'x'}, 'eventId', /Identificador no válido/],
      [{ref: {type: 'task', id: foreign.taskId}}, 'ref', /registro/],
      [
        {ref: {type: 'resource', id: '00000000-0000-4000-8000-000000000000'}},
        'ref',
        /registro/,
      ],
      [{ref: {type: 'person', id: foreign.taskId}}, 'ref', /Vínculo no válido/],
      [{ref: {type: 'task'}}, 'ref', /Vínculo no válido/],
      [{ref: 'tarea'}, 'ref', /Vínculo no válido/],
    ];
    for (const [body, field, message] of cases) {
      const fields = await fieldsOf(
        await post('/notes', {kind: 'note', text: 'x', ...body}),
      );
      expect(fields[field], JSON.stringify(body)).toMatch(message);
    }
  });

  it('patches with the current version (resolved, text, link), keeps it on a no-op and rejects a stale one', async () => {
    const r = await created<Resource>(
      await post('/resources', {name: 'Generador Prueba Notas'}),
    );
    const note = await created<Note>(
      await post('/notes', {
        kind: 'open_question',
        text: `¿Cabe en la furgoneta? ${MARKER}`,
        ref: {type: 'resource', id: r.id},
      }),
    );
    const same = await json<Note>(
      await patch(`/notes/${note.id}`, {version: 1, kind: 'open_question'}),
    );
    expect(same.version).toBe(1);
    const res = await patch(`/notes/${note.id}`, {
      version: 1,
      resolved: true,
      text: `Sí cabe. ${MARKER}`,
      ref: null,
      eventId,
    });
    expect(res.status).toBe(200);
    expect(await json<Note>(res)).toMatchObject({
      resolved: true,
      ref: null,
      event: {id: eventId},
      version: 2,
    });
    const [updated] = await history('note', note.id);
    expect(updated).toMatchObject({
      action: 'update',
      changedFields: ['text', 'event', 'ref', 'resolved'],
      entityLabel: `Pregunta abierta · ${eventName}`,
    });
    const stale = await patch(`/notes/${note.id}`, {
      version: 1,
      resolved: false,
    });
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.current).toMatchObject({version: 2, resolved: true});
    expect(
      (await fieldsOf(await patch(`/notes/${note.id}`, {version: 2, text: ''})))
        .text,
    ).toBe('Este campo es obligatorio.');
    expect(
      (await fieldsOf(await patch(`/notes/${note.id}`, {}))).version,
    ).toMatch(/Falta la versión/);
  });

  it('lists newest first and deletes at the current version; other organizations are not found', async () => {
    const first = await created<Note>(
      await post('/notes', {kind: 'decision', text: 'Primera'}),
    );
    h.clock.advance(60_000);
    const second = await created<Note>(
      await post('/notes', {kind: 'feature_idea', text: 'Segunda'}),
    );
    const ids = (await listOf<Note>('notes')).map(n => n.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

    expect(
      (await h.request('DELETE', `/notes/${first.id}?version=2`, {token}))
        .status,
    ).toBe(409);
    expect(
      (await h.request('DELETE', `/notes/${first.id}`, {token})).status,
    ).toBe(400);
    expect(
      (await h.request('DELETE', `/notes/${first.id}?version=1`, {token}))
        .status,
    ).toBe(204);
    expect((await history('note', first.id))[0]).toMatchObject({
      action: 'delete',
      entityLabel: 'Decisión',
    });

    expect(
      (await h.request('GET', `/organizations/${foreign.orgId}/notes`, {token}))
        .status,
    ).toBe(404);
    expect(
      (await patch(`/notes/${foreign.noteId}`, {version: 1, text: 'x'})).status,
    ).toBe(404);
    expect(
      (await h.request('DELETE', `/notes/${foreign.noteId}?version=1`, {token}))
        .status,
    ).toBe(404);
    const note = await created<Note>(
      await post('/notes', {kind: 'note', text: 'Para invitado'}),
    );
    for (const [method, path, body] of [
      ['PATCH', `/notes/${note.id}`, {version: 1, text: 'x'}],
      ['DELETE', `/notes/${note.id}?version=1`, undefined],
    ] as const) {
      expect((await h.request(method, path, {token: guest, body})).status).toBe(
        403,
      );
    }
  });

  it('never puts note text in any activity label', async () => {
    const all = await activityRaw('?limit=100');
    expect(await all.text()).not.toContain(MARKER);
    const rows = await h.db.query<{label: string}>(
      'SELECT entity_label AS label FROM activity_log WHERE entity_type = \'note\'',
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(r.label).not.toContain(MARKER);
  });
});

describe('history of one record', () => {
  it('returns only that record’s entries, newest first, with the usual limit', async () => {
    const task = await created<Task>(
      await post('/tasks', {title: 'Tarea Prueba Historial'}),
    );
    for (let v = 1; v <= 3; v++) {
      h.clock.advance(1_000);
      await patch(`/tasks/${task.id}`, {
        version: v,
        status: v % 2 ? 'confirmed' : 'planned',
      });
    }
    const entries = await history('task', task.id);
    expect(entries.map(e => e.action)).toEqual([
      'update',
      'update',
      'update',
      'create',
    ]);
    expect(entries.every(e => e.entityId === task.id)).toBe(true);
    const limited = await json<ListResponse<ActivityEntry>>(
      await activityRaw(`?entityType=task&entityId=${task.id}&limit=2`),
    );
    expect(limited.items).toHaveLength(2);
    // Another type with the same id has no history.
    expect(await history('resource', task.id)).toEqual([]);
  });

  it('needs both parameters or neither, a known type and a valid id', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(
      (await fieldsOf(await activityRaw('?entityType=task'))).entityId,
    ).toMatch(/tipo y su identificador/);
    expect(
      (await fieldsOf(await activityRaw(`?entityId=${id}`))).entityType,
    ).toMatch(/tipo y su identificador/);
    expect(
      (await fieldsOf(await activityRaw(`?entityType=user&entityId=${id}`)))
        .entityType,
    ).toBe('Tipo de registro no válido.');
    expect(
      (await fieldsOf(await activityRaw('?entityType=task&entityId=nope')))
        .entityId,
    ).toBe('Identificador no válido.');
    expect(
      (
        await h.request(
          'GET',
          `/organizations/${foreign.orgId}/activity?entityType=note&entityId=${foreign.noteId}`,
          {token},
        )
      ).status,
    ).toBe(404);
    // Guests read histories too: labels are names, never free text.
    expect(
      (await activityRaw(`?entityType=task&entityId=${id}`, guest)).status,
    ).toBe(200);
  });
});
