/**
 * Guest redaction for milestone 4: Invitado never receives event and task
 * notes, a warehouse's address and notes, a resource's location and notes, or
 * the text of a note. Every route is checked, and so is every mapping path
 * (single records, 409 `current`, DUPLICATE `current`) by calling the services
 * with a guest viewer: guests cannot write over HTTP, but the mapping must not
 * depend on that.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {AppError} from '../src/errors.ts';
import {updateEvent} from '../src/events/service.ts';
import {applyHypothesis, createHypothesis} from '../src/hypotheses/service.ts';
import {
  createAnswer,
  createNote,
  listAnswers,
  updateNote,
} from '../src/notes/service.ts';
import {planWarnings} from '../../shared/logistics/conflicts.ts';
import {forViewer, WITHHELD_FROM_GUESTS} from '../src/records/redact.ts';
import {
  WITHHELD_FROM_GUESTS as SHARED_WITHHELD,
  withholdFor,
} from '../../shared/logistics/redaction.ts';
import {createResource, updateResource} from '../src/resources/service.ts';
import {createTask, updateTask} from '../src/tasks/service.ts';
import {createWarehouse, updateWarehouse} from '../src/warehouses/service.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ApiErrorBody,
  ConflictAcceptance,
  DelayHypothesis,
  ListResponse,
  LogisticsEvent,
  Note,
  NoteAnswer,
  Resource,
  SessionUser,
  Task,
  Warehouse,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let guest: string;
let guestUser: SessionUser;

/** Withheld values; none may appear in anything a guest receives. */
const SECRET = {
  eventNotes: 'SECRETO-EVENTO-41',
  taskNotes: 'SECRETO-TAREA-42',
  address: 'SECRETO-DIRECCION-43',
  warehouseNotes: 'SECRETO-ALMACEN-44',
  location: 'SECRETO-UBICACION-45',
  resourceNotes: 'SECRETO-RECURSO-46',
  noteText: 'SECRETO-NOTA-47',
  hypothesisNote: 'SECRETO-HIPOTESIS-48',
  // Revisión 1.
  answerText: 'SECRETO-RESPUESTA-49',
  acceptReason: 'SECRETO-MOTIVO-50',
  // E4: guests have no Contactos, so not even a person's name.
  contactName: 'SECRETO-CONTACTO-51',
};

let ids: {
  event: LogisticsEvent;
  task: Task;
  warehouse: Warehouse;
  resource: Resource;
  note: Note;
  timedTask: Task;
  hypothesis: DelayHypothesis;
  question: Note;
  answer: NoteAnswer;
  acceptance: ConflictAcceptance;
};

beforeAll(async () => {
  h = await createHarness();
  token = (await h.login('Elvis')).token;
  const g = await h.login('Invitado');
  guest = g.token;
  guestUser = g.user;

  const post = async <T>(path: string, body: object) => {
    const res = await h.request('POST', path, {
      token,
      body: {organizationId: h.org.id, ...body},
    });
    expect(res.status).toBe(201);
    return json<T>(res);
  };
  const event = await post<LogisticsEvent>('/events', {
    name: 'Evento Prueba Reservado',
    notes: SECRET.eventNotes,
  });
  const warehouse = await post<Warehouse>('/warehouses', {
    name: 'Almacén Prueba Reservado',
    address: SECRET.address,
    notes: SECRET.warehouseNotes,
  });
  const resource = await post<Resource>('/resources', {
    name: 'Recurso Prueba Reservado',
    warehouseId: warehouse.id,
    quantity: 3,
    location: SECRET.location,
    notes: SECRET.resourceNotes,
  });
  const contact = await post<{id: string}>('/contacts', {
    name: SECRET.contactName,
  });
  const task = await post<Task>('/tasks', {
    title: 'Tarea Prueba Reservada',
    eventId: event.id,
    notes: SECRET.taskNotes,
    resourceIds: [resource.id],
    contactId: contact.id,
    companyName: 'Empresa Prueba Visible',
  });
  await post<Note>('/notes', {
    kind: 'note',
    text: 'Llamar',
    ref: {type: 'contact', id: contact.id},
  });
  const note = await post<Note>('/notes', {
    kind: 'incident',
    text: SECRET.noteText,
    eventId: event.id,
    ref: {type: 'resource', id: resource.id},
  });
  const timedTask = await post<Task>('/tasks', {
    title: 'Montaje Prueba Reservado',
    date: '2026-12-02',
    startTime: '09:00',
    endTime: '10:00',
    notes: SECRET.taskNotes,
  });
  const hypothesis = await post<DelayHypothesis>('/hypotheses', {
    taskId: timedTask.id,
    delayMinutes: 30,
    note: SECRET.hypothesisNote,
  });
  // Revisión 1: an answered open question and an accepted conflict.
  const question = await post<Note>('/notes', {
    kind: 'open_question',
    text: '¿Quién abre la nave?',
  });
  const answered = await h.request('POST', `/notes/${question.id}/answers`, {
    token,
    body: {text: SECRET.answerText, replaces: null},
  });
  expect(answered.status).toBe(201);
  const answer = await json<NoteAnswer>(answered);
  const clash = async (title: string) =>
    post<Task>('/tasks', {
      title,
      venueName: 'Plaza Prueba Reservada',
      date: '2026-12-03',
      startTime: '09:00',
      endTime: '11:00',
    });
  const [a, b] = [await clash('Carpa Prueba A'), await clash('Carpa Prueba B')];
  const warning = planWarnings(await listOf<Task>('tasks', token)).find(
    w => w.kind === 'venue_overlap' && w.taskIds.includes(a.id),
  )!;
  const acceptance = await post<ConflictAcceptance>('/conflict-acceptances', {
    warningKey: warning.key,
    windows: [a, b].map(t => ({
      taskId: t.id,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
    })),
    reason: SECRET.acceptReason,
  });
  ids = {
    event,
    task,
    warehouse,
    resource,
    note,
    timedTask,
    hypothesis,
    question,
    answer,
    acceptance,
  };
});

const orgPath = (what: string) => `/organizations/${h.org.id}/${what}`;

async function listOf<T>(what: string, t: string): Promise<T[]> {
  const res = await h.request('GET', orgPath(what), {token: t});
  expect(res.status).toBe(200);
  return (await json<ListResponse<T>>(res)).items;
}

function expectNoSecret(raw: string): void {
  for (const secret of Object.values(SECRET)) expect(raw).not.toContain(secret);
}

/** The AppError a service call throws. */
async function thrown(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected an error');
}

describe('guests never receive notes, addresses, locations or note text', () => {
  it('the server applies the shared list (one list for server and device cache)', () => {
    expect(WITHHELD_FROM_GUESTS).toBe(SHARED_WITHHELD);
    const record = ids.note as Omit<Note, 'restricted'>;
    expect(forViewer('note', record, {role: 'guest'})).toEqual(
      withholdFor('note', record, 'guest'),
    );
    expect(forViewer('note', record, {role: 'member'})).toEqual(
      withholdFor('note', record, 'member'),
    );
  });

  it('withholds exactly the agreed fields', () => {
    expect(WITHHELD_FROM_GUESTS).toMatchObject({
      event: ['notes'],
      // E4: a task's contact person (guests have no Contactos).
      task: ['notes', 'contact'],
      warehouse: ['address', 'notes'],
      resource: ['location', 'notes'],
      note: ['text'],
      hypothesis: ['note'],
      answer: ['text'],
      acceptance: ['reason'],
    });
  });

  it('answers and accepted conflicts: guests get the record without the free text, on every path', async () => {
    // A note carries its current answer: both texts go for a guest.
    const notes = await listOf<Note>('notes', guest);
    expect(notes.find(n => n.id === ids.question.id)).toMatchObject({
      text: null,
      restricted: true,
      answer: {id: ids.answer.id, text: null, restricted: true},
    });
    const answers = await h.request(
      'GET',
      `/notes/${ids.question.id}/answers`,
      {
        token: guest,
      },
    );
    expect(answers.status).toBe(200);
    const answerRaw = await answers.text();
    expectNoSecret(answerRaw);
    expect(JSON.parse(answerRaw).items[0]).toMatchObject({
      id: ids.answer.id,
      text: null,
      answeredBy: {displayName: 'Elvis'},
      restricted: true,
    });
    const accepted = await listOf<ConflictAcceptance>(
      'conflict-acceptances',
      guest,
    );
    expect(accepted.find(a => a.id === ids.acceptance.id)).toMatchObject({
      reason: null,
      restricted: true,
      acceptedBy: {displayName: 'Elvis'},
    });
    // Members see both.
    expect(
      (await listOf<Note>('notes', token)).find(n => n.id === ids.question.id)
        ?.answer,
    ).toMatchObject({text: SECRET.answerText, restricted: false});
    expect(
      (await listOf<ConflictAcceptance>('conflict-acceptances', token)).find(
        a => a.id === ids.acceptance.id,
      ),
    ).toMatchObject({reason: SECRET.acceptReason, restricted: false});

    // Service paths with a guest viewer (guests cannot write over HTTP).
    const listed = await listAnswers(h.db, guestUser, ids.question.id);
    expect(listed.every(a => a.text === null && a.restricted)).toBe(true);
    const stale = await thrown(
      createAnswer(
        h.db,
        guestUser,
        ids.question.id,
        {text: 'x', replaces: null},
        h.clock.now(),
      ),
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(stale.current).toMatchObject({text: null, restricted: true});
    expectNoSecret(JSON.stringify(stale.toBody()));
    // The shared withholding reaches the nested answer (device cache).
    const member = (await listOf<Note>('notes', token)).find(
      n => n.id === ids.question.id,
    )!;
    const cached = withholdFor('note', member, 'guest');
    expect(cached.answer).toMatchObject({text: null, restricted: true});
    expectNoSecret(JSON.stringify(cached));
    expectNoSecret(
      JSON.stringify(withholdFor('acceptance', ids.acceptance, 'guest')),
    );
  });

  it('hypotheses: the list withholds the note and keeps the label; members see it', async () => {
    const asGuest = await listOf<DelayHypothesis>('hypotheses', guest);
    expect(asGuest.length).toBeGreaterThan(0);
    expect(asGuest.every(x => x.note === null && x.restricted)).toBe(true);
    expect(asGuest.find(x => x.id === ids.hypothesis.id)).toMatchObject({
      taskTitle: 'Montaje Prueba Reservado',
      delayMinutes: 30,
      note: null,
      restricted: true,
    });
    const asMember = await listOf<DelayHypothesis>('hypotheses', token);
    expect(asMember.find(x => x.id === ids.hypothesis.id)).toMatchObject({
      note: SECRET.hypothesisNote,
      restricted: false,
    });
  });

  it('hypotheses: every mapping path redacts for a guest viewer (create, apply, 409 current)', async () => {
    const now = h.clock.now();
    const raw: string[] = [];
    const created = await createHypothesis(
      h.db,
      guestUser,
      {
        organizationId: h.org.id,
        taskId: ids.timedTask.id,
        delayMinutes: 15,
        mode: 'shift',
        estimated: false,
        note: SECRET.hypothesisNote,
      },
      now,
    );
    expect(created).toMatchObject({note: null, restricted: true});
    raw.push(JSON.stringify(created));

    const conflict = await thrown(
      applyHypothesis(
        h.db,
        guestUser,
        created.id,
        {
          expected: [
            {
              id: ids.timedTask.id,
              version: 99,
              startsAt: '2026-12-02T09:15:00.000Z',
              endsAt: '2026-12-02T10:15:00.000Z',
            },
          ],
          markDelayed: false,
        },
        now,
      ),
    );
    expect(conflict.code).toBe('VERSION_CONFLICT');
    const current = conflict.current as Task[];
    expect(current.length).toBeGreaterThan(0);
    expect(current.every(t => t.notes === null && t.restricted)).toBe(true);
    raw.push(JSON.stringify(current));

    const applied = await applyHypothesis(
      h.db,
      guestUser,
      created.id,
      {
        expected: current.map(t => ({
          id: t.id,
          version: t.version,
          startsAt: new Date(
            Date.parse(t.startsAt!) + 15 * 60_000,
          ).toISOString(),
          endsAt: new Date(Date.parse(t.endsAt!) + 15 * 60_000).toISOString(),
        })),
        markDelayed: false,
      },
      now,
    );
    expect(applied.hypothesis).toMatchObject({note: null, restricted: true});
    expect(applied.tasks.every(t => t.notes === null && t.restricted)).toBe(
      true,
    );
    raw.push(JSON.stringify(applied));
    expectNoSecret(raw.join('\n'));
  });

  it('events: the list has notes null and restricted true; members see them', async () => {
    const asGuest = await listOf<LogisticsEvent>('events', guest);
    expect(asGuest.every(e => e.notes === null && e.restricted)).toBe(true);
    expect(asGuest.find(e => e.id === ids.event.id)).toMatchObject({
      name: 'Evento Prueba Reservado',
      notes: null,
      restricted: true,
    });
    const asMember = await listOf<LogisticsEvent>('events', token);
    expect(asMember.find(e => e.id === ids.event.id)).toMatchObject({
      notes: SECRET.eventNotes,
      restricted: false,
    });
  });

  it('tasks: both lists withhold notes; resources stay visible', async () => {
    for (const query of ['', `?eventId=${ids.event.id}`]) {
      const res = await h.request('GET', `${orgPath('tasks')}${query}`, {
        token: guest,
      });
      const items = (await json<ListResponse<Task>>(res)).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every(t => t.notes === null && t.restricted)).toBe(true);
      expect(items.find(t => t.id === ids.task.id)).toMatchObject({
        title: 'Tarea Prueba Reservada',
        resourceIds: [ids.resource.id],
        // Safety audit: the company stays linked but reads «Empresa»; no contact.
        company: {name: 'Empresa'},
        contact: null,
        restricted: true,
      });
    }
    const asMember = await listOf<Task>('tasks', token);
    expect(asMember.find(t => t.id === ids.task.id)).toMatchObject({
      notes: SECRET.taskNotes,
      company: {name: 'Empresa Prueba Visible'},
      contact: {name: SECRET.contactName},
      restricted: false,
    });
    // A note pointing at the person says what it is, not who.
    const notes = await listOf<Note>('notes', guest);
    expect(notes.find(n => n.ref?.type === 'contact')?.ref?.label).toBe(
      'Persona de contacto',
    );
    const memberNotes = await listOf<Note>('notes', token);
    expect(memberNotes.find(n => n.ref?.type === 'contact')?.ref?.label).toBe(
      SECRET.contactName,
    );
  });

  it('warehouses, resources and notes: names and figures stay, free text goes', async () => {
    const w = (await listOf<Warehouse>('warehouses', guest)).find(
      x => x.id === ids.warehouse.id,
    );
    expect(w).toMatchObject({
      name: 'Almacén Prueba Reservado',
      address: null,
      notes: null,
      resourceCount: 1,
      restricted: true,
    });
    const r = (await listOf<Resource>('resources', guest)).find(
      x => x.id === ids.resource.id,
    );
    expect(r).toMatchObject({
      name: 'Recurso Prueba Reservado',
      quantity: 3,
      unit: 'unidades',
      warehouse: {name: 'Almacén Prueba Reservado'},
      location: null,
      notes: null,
      restricted: true,
    });
    const n = (await listOf<Note>('notes', guest)).find(
      x => x.id === ids.note.id,
    );
    expect(n).toMatchObject({
      kind: 'incident',
      text: null,
      event: {name: 'Evento Prueba Reservado'},
      ref: {type: 'resource', label: 'Recurso Prueba Reservado'},
      restricted: true,
    });
    const asMember = (await listOf<Note>('notes', token)).find(
      x => x.id === ids.note.id,
    );
    expect(asMember).toMatchObject({text: SECRET.noteText, restricted: false});
  });

  it('nothing a guest can read contains a withheld value', async () => {
    const paths = [
      'events',
      'tasks',
      'warehouses',
      'resources',
      'notes',
      'activity?limit=100',
      `activity?entityType=note&entityId=${ids.note.id}`,
      'hypotheses',
      `activity?entityType=hypothesis&entityId=${ids.hypothesis.id}`,
      'venues',
      'categories',
      'conflict-acceptances',
      `activity?entityType=note&entityId=${ids.question.id}`,
      'members',
    ];
    const raw: string[] = [];
    for (const p of paths) {
      const res = await h.request('GET', orgPath(p), {token: guest});
      expect(res.status, p).toBe(200);
      raw.push(await res.text());
    }
    // E4: the directory is not the guest account's at all.
    for (const p of ['companies', 'contacts', 'offers']) {
      const res = await h.request('GET', orgPath(p), {token: guest});
      expect(res.status, p).toBe(403);
      raw.push(await res.text());
    }
    const answers = await h.request(
      'GET',
      `/notes/${ids.question.id}/answers`,
      {
        token: guest,
      },
    );
    raw.push(await answers.text());
    expectNoSecret(raw.join('\n'));
  });

  it('a member’s 409 current and DUPLICATE current carry the withheld values', async () => {
    const stale = await h.request('PATCH', `/events/${ids.event.id}`, {
      token,
      body: {version: 99, name: 'x'},
    });
    expect(stale.status).toBe(409);
    expect((await json<ApiErrorBody>(stale)).current).toMatchObject({
      notes: SECRET.eventNotes,
      restricted: false,
    });
    const staleTask = await h.request('PATCH', `/tasks/${ids.task.id}`, {
      token,
      body: {version: 99, title: 'x'},
    });
    expect((await json<ApiErrorBody>(staleTask)).current).toMatchObject({
      notes: SECRET.taskNotes,
      restricted: false,
    });
    const dup = await h.request('POST', '/warehouses', {
      token,
      body: {organizationId: h.org.id, name: 'almacén prueba reservado'},
    });
    expect(dup.status).toBe(409);
    expect((await json<ApiErrorBody>(dup)).current).toMatchObject({
      address: SECRET.address,
      restricted: false,
    });
  });

  it('every mapping path redacts for a guest viewer: single records, 409 current and DUPLICATE current', async () => {
    const now = h.clock.now();
    const raw: string[] = [];
    const stale = async (promise: Promise<unknown>) => {
      const err = await thrown(promise);
      expect(err.code).toBe('VERSION_CONFLICT');
      expect(err.current).toMatchObject({restricted: true});
      raw.push(JSON.stringify(err.current));
    };
    await stale(updateEvent(h.db, guestUser, ids.event.id, {version: 99}, now));
    await stale(updateTask(h.db, guestUser, ids.task.id, {version: 99}, now));
    await stale(
      updateWarehouse(h.db, guestUser, ids.warehouse.id, {version: 99}, now),
    );
    await stale(
      updateResource(h.db, guestUser, ids.resource.id, {version: 99}, now),
    );
    await stale(updateNote(h.db, guestUser, ids.note.id, {version: 99}, now));

    const dup = await thrown(
      createWarehouse(
        h.db,
        guestUser,
        {organizationId: h.org.id, name: 'ALMACÉN PRUEBA RESERVADO'},
        now,
      ),
    );
    expect(dup.code).toBe('DUPLICATE');
    expect(dup.current).toMatchObject({address: null, restricted: true});
    raw.push(JSON.stringify(dup.current));

    // Single records returned by a write (unchanged no-op updates too).
    const single = [
      await updateWarehouse(
        h.db,
        guestUser,
        ids.warehouse.id,
        {version: ids.warehouse.version},
        now,
      ),
      await updateResource(
        h.db,
        guestUser,
        ids.resource.id,
        {version: ids.resource.version},
        now,
      ),
      await updateNote(
        h.db,
        guestUser,
        ids.note.id,
        {version: ids.note.version},
        now,
      ),
      await updateTask(
        h.db,
        guestUser,
        ids.task.id,
        {version: ids.task.version},
        now,
      ),
      await updateEvent(
        h.db,
        guestUser,
        ids.event.id,
        {version: ids.event.version},
        now,
      ),
      (
        await createTask(
          h.db,
          guestUser,
          {organizationId: h.org.id, title: 'x', notes: SECRET.taskNotes},
          now,
        )
      ).record,
      (
        await createResource(
          h.db,
          guestUser,
          {organizationId: h.org.id, name: 'x', location: SECRET.location},
          now,
        )
      ).record,
      (
        await createNote(
          h.db,
          guestUser,
          {organizationId: h.org.id, kind: 'note', text: SECRET.noteText},
          now,
        )
      ).record,
    ];
    for (const record of single) {
      expect(record).toMatchObject({restricted: true});
      raw.push(JSON.stringify(record));
    }
    expectNoSecret(raw.join('\n'));
  });
});
