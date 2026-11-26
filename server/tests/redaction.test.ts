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
import {createNote, updateNote} from '../src/notes/service.ts';
import {WITHHELD_FROM_GUESTS} from '../src/records/redact.ts';
import {createResource, updateResource} from '../src/resources/service.ts';
import {createTask, updateTask} from '../src/tasks/service.ts';
import {createWarehouse, updateWarehouse} from '../src/warehouses/service.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ApiErrorBody,
  ListResponse,
  LogisticsEvent,
  Note,
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
};

let ids: {
  event: LogisticsEvent;
  task: Task;
  warehouse: Warehouse;
  resource: Resource;
  note: Note;
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
  const task = await post<Task>('/tasks', {
    title: 'Tarea Prueba Reservada',
    eventId: event.id,
    notes: SECRET.taskNotes,
    resourceIds: [resource.id],
  });
  const note = await post<Note>('/notes', {
    kind: 'incident',
    text: SECRET.noteText,
    eventId: event.id,
    ref: {type: 'resource', id: resource.id},
  });
  ids = {event, task, warehouse, resource, note};
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
  it('withholds exactly the agreed fields', () => {
    expect(WITHHELD_FROM_GUESTS).toMatchObject({
      event: ['notes'],
      task: ['notes'],
      warehouse: ['address', 'notes'],
      resource: ['location', 'notes'],
      note: ['text'],
    });
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
        restricted: true,
      });
    }
    const asMember = await listOf<Task>('tasks', token);
    expect(asMember.find(t => t.id === ids.task.id)).toMatchObject({
      notes: SECRET.taskNotes,
      restricted: false,
    });
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
      'venues',
      'companies',
      'contacts',
      'offers',
      'categories',
    ];
    const raw: string[] = [];
    for (const p of paths) {
      const res = await h.request('GET', orgPath(p), {token: guest});
      expect(res.status, p).toBe(200);
      raw.push(await res.text());
    }
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
      await createTask(
        h.db,
        guestUser,
        {organizationId: h.org.id, title: 'x', notes: SECRET.taskNotes},
        now,
      ),
      await createResource(
        h.db,
        guestUser,
        {organizationId: h.org.id, name: 'x', location: SECRET.location},
        now,
      ),
      await createNote(
        h.db,
        guestUser,
        {organizationId: h.org.id, kind: 'note', text: SECRET.noteText},
        now,
      ),
    ];
    for (const record of single) {
      expect(record).toMatchObject({restricted: true});
      raw.push(JSON.stringify(record));
    }
    expectNoSecret(raw.join('\n'));
  });
});
