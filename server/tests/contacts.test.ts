import {beforeAll, describe, expect, it} from 'vitest';
import {DEMO_EVENT} from '../src/seed/seed.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  Company,
  Contact,
  ListResponse,
  LogisticsEvent,
  RecentSearch,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;
let guest: string;
let demoEventId: string;
/** Records of another organization the pilot users do not belong to. */
let foreign: {orgId: string; contactId: string; eventId: string};

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
  const [contact] = await h.db.query<{id: string}>(
    `INSERT INTO contacts (organization_id, name, created_by, updated_by)
     VALUES ($1, 'Persona ajena', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  const [event] = await h.db.query<{id: string}>(
    `INSERT INTO events (organization_id, name, created_by, updated_by)
     VALUES ($1, 'Evento ajeno', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  foreign = {orgId: org!.id, contactId: contact!.id, eventId: event!.id};
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

async function activity(limit = 10): Promise<ActivityEntry[]> {
  const res = await h.request('GET', `${orgPath('activity')}?limit=${limit}`, {
    token,
  });
  return (await json<ListResponse<ActivityEntry>>(res)).items;
}

async function company(id: string): Promise<Company> {
  return (await listOf<Company>('companies')).find(c => c.id === id)!;
}

describe('contacts', () => {
  it('creates with only a name; two people may share it', async () => {
    const a = await created<Contact>(
      await post('/contacts', {name: 'María Prueba'}),
    );
    const b = await created<Contact>(
      await post('/contacts', {name: 'María Prueba'}),
    );
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({
      name: 'María Prueba',
      role: null,
      company: null,
      phone: null,
      email: null,
      description: null,
      notes: null,
      eventIds: [],
      restricted: false,
      version: 1,
      isDemo: false,
      createdBy: {displayName: 'Elvis'},
    });
    expect((await activity(1))[0]).toMatchObject({
      entityType: 'contact',
      entityId: b.id,
      entityLabel: 'María Prueba',
      action: 'create',
    });
  });

  it('creates a full record: company by name or id (id wins), events of the organization', async () => {
    const c = await created<Contact>(
      await post('/contacts', {
        name: 'Carmen Prueba',
        role: 'Jefa de producción',
        companyName: 'Producciones Prueba',
        phone: '+34 (000) 000-00.14',
        email: 'carmen@example.com',
        description: 'Lleva la producción técnica',
        notes: 'Prefiere WhatsApp',
        eventIds: [demoEventId.toUpperCase()],
        source: 'observed',
      }),
    );
    expect(c).toMatchObject({
      role: 'Jefa de producción',
      company: {name: 'Producciones Prueba'},
      phone: '+34 (000) 000-00.14',
      email: 'carmen@example.com',
      eventIds: [demoEventId],
      source: 'observed',
    });
    const byId = await created<Contact>(
      await post('/contacts', {
        name: 'Otro',
        companyId: c.company!.id,
        companyName: 'Ignorada',
      }),
    );
    expect(byId.company).toEqual(c.company);
    expect(
      (await listOf<Company>('companies')).some(x => x.name === 'Ignorada'),
    ).toBe(false);
    expect((await company(c.company!.id)).contactCount).toBe(2);
  });

  it('validates with Spanish messages and refuses foreign references', async () => {
    const fields = await fieldsOf(
      await post('/contacts', {
        name: ' ',
        phone: 'mañana lo paso',
        email: 'no-es-correo',
        eventIds: 'x',
        role: 'r'.repeat(121),
      }),
    );
    expect(fields.name).toBe('Este campo es obligatorio.');
    expect(fields.phone).toMatch(
      /^Teléfono no válido.*Si aún no lo tienes, déjalo vacío\.$/,
    );
    expect(fields.email).toMatch(/^Correo no válido/);
    expect(fields.eventIds).toBe('Debe ser una lista de eventos.');
    expect(fields.role).toBe('Máximo 120 caracteres.');
    // Short public numbers are valid.
    expect(
      (await post('/contacts', {name: 'Emergencias', phone: '112'})).status,
    ).toBe(201);

    const refs = await fieldsOf(
      await post('/contacts', {
        name: 'x',
        companyId: crypto.randomUUID(),
        eventIds: [foreign.eventId],
      }),
    );
    expect(refs.companyId).toMatch(/No encontramos esa empresa/);
    expect(refs.eventIds).toMatch(/no existe o no es de esta organización/);
    expect(
      (await post('/contacts', {organizationId: foreign.orgId, name: 'x'}))
        .status,
    ).toBe(404);
    expect(
      (
        await h.request('GET', `/organizations/${foreign.orgId}/contacts`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (await listOf<Contact>('contacts')).some(c => c.name === 'Persona ajena'),
    ).toBe(false);
  });

  it('patches with the current version; stale writes get 409 with the current record', async () => {
    const c = await created<Contact>(
      await post('/contacts', {name: 'Pedro Prueba'}),
    );
    const res = await patch(`/contacts/${c.id}`, {
      version: 1,
      role: 'Electricista',
      eventIds: [demoEventId],
    });
    expect(await json<Contact>(res)).toMatchObject({
      role: 'Electricista',
      eventIds: [demoEventId],
      version: 2,
    });
    expect((await activity(1))[0]?.changedFields).toEqual(['role', 'eventIds']);
    const noop = await json<Contact>(
      await patch(`/contacts/${c.id}`, {
        version: 2,
        role: 'Electricista',
        eventIds: [demoEventId],
      }),
    );
    expect(noop.version).toBe(2);

    const stale = await patch(
      `/contacts/${c.id}`,
      {version: 1, notes: 'x'},
      dailos,
    );
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.current).toMatchObject({
      id: c.id,
      version: 2,
      restricted: false,
    });
    expect(
      (await patch(`/contacts/${foreign.contactId}`, {version: 1, name: 'x'}))
        .status,
    ).toBe(404);
    expect(
      (await patch(`/contacts/${c.id}`, {version: 2, name: 'x'}, guest)).status,
    ).toBe(403);
  });

  it('moving a contact to another company clears it as main contact of the old one', async () => {
    const old = await created<Company>(
      await post('/companies', {name: 'Sonido Uno Prueba'}),
    );
    const c = await created<Contact>(
      await post('/contacts', {name: 'Iván Prueba', companyId: old.id}),
    );
    await patch(`/companies/${old.id}`, {version: 1, mainContactId: c.id});
    h.clock.advance(60_000);
    const moved = await json<Contact>(
      await patch(
        `/contacts/${c.id}`,
        {version: 1, companyName: 'Sonido Dos Prueba'},
        dailos,
      ),
    );
    expect(moved.company?.name).toBe('Sonido Dos Prueba');
    expect(await company(old.id)).toMatchObject({
      mainContactId: null,
      contactCount: 0,
      version: 3,
      updatedBy: {displayName: 'Dailos'},
    });
    expect(
      (await activity(2)).map(a => [
        a.entityType,
        a.entityLabel,
        a.changedFields,
      ]),
    ).toEqual([
      ['contact', 'Iván Prueba', ['company']],
      ['company', 'Sonido Uno Prueba', ['mainContactId']],
    ]);
    // Leaving with no company at all works the same way.
    const back = await created<Contact>(
      await post('/contacts', {name: 'Eva Prueba', companyId: old.id}),
    );
    await patch(`/companies/${old.id}`, {version: 3, mainContactId: back.id});
    await patch(`/contacts/${back.id}`, {version: 1, companyId: null});
    expect((await company(old.id)).mainContactId).toBeNull();
  });

  it('deleting a contact unlinks its tasks and its company, with new versions', async () => {
    const co = await created<Company>(
      await post('/companies', {name: 'Carpas Prueba'}),
    );
    const c = await created<Contact>(
      await post('/contacts', {name: 'Nerea Prueba', companyId: co.id}),
    );
    await patch(`/companies/${co.id}`, {version: 1, mainContactId: c.id});
    const task = await created<Task>(
      await post('/tasks', {title: 'Montaje de carpas', contactId: c.id}),
    );
    expect(task.contact).toEqual({id: c.id, name: 'Nerea Prueba'});

    expect(
      (await h.request('DELETE', `/contacts/${c.id}?version=2`, {token}))
        .status,
    ).toBe(409);
    expect(
      (await h.request('DELETE', `/contacts/${c.id}?version=1`, {token: guest}))
        .status,
    ).toBe(403);
    expect(
      (
        await h.request('DELETE', `/contacts/${foreign.contactId}?version=1`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.request('DELETE', `/contacts/${c.id}?version=1`, {token}))
        .status,
    ).toBe(204);
    expect(
      (await listOf<Task>('tasks')).find(t => t.id === task.id),
    ).toMatchObject({
      contact: null,
      version: task.version + 1,
    });
    expect(await company(co.id)).toMatchObject({
      mainContactId: null,
      version: 3,
    });
    expect(
      (await activity(3)).map(a => [a.entityType, a.action, a.changedFields]),
    ).toEqual([
      ['contact', 'delete', []],
      ['task', 'update', ['contact']],
      ['company', 'update', ['mainContactId']],
    ]);
  });
});

describe('tasks · contact', () => {
  it('links a contact of the organization and returns its name in every task response', async () => {
    const c = await created<Contact>(
      await post('/contacts', {name: 'Toni Prueba'}),
    );
    const t = await created<Task>(await post('/tasks', {title: 'Descarga'}));
    const linked = await json<Task>(
      await patch(`/tasks/${t.id}`, {version: 1, contactId: c.id}),
    );
    expect(linked).toMatchObject({
      contact: {id: c.id, name: 'Toni Prueba'},
      version: 2,
    });
    expect((await activity(1))[0]?.changedFields).toEqual(['contact']);
    expect(
      (await listOf<Task>('tasks')).find(x => x.id === t.id)?.contact?.name,
    ).toBe('Toni Prueba');
    // A renamed contact shows its new name.
    await patch(`/contacts/${c.id}`, {version: 1, name: 'Antonio Prueba'});
    expect(
      (await listOf<Task>('tasks')).find(x => x.id === t.id)?.contact?.name,
    ).toBe('Antonio Prueba');
    const stale = await patch(`/tasks/${t.id}`, {version: 1, title: 'x'});
    expect((await json<ApiErrorBody>(stale)).current).toMatchObject({
      contact: {name: 'Antonio Prueba'},
    });
    const cleared = await json<Task>(
      await patch(`/tasks/${t.id}`, {version: 2, contactId: null}),
    );
    expect(cleared).toMatchObject({contact: null, version: 3});
  });

  it('refuses an unknown or foreign contact', async () => {
    expect(
      (
        await fieldsOf(
          await post('/tasks', {title: 'x', contactId: foreign.contactId}),
        )
      ).contactId,
    ).toMatch(/No encontramos esa persona/);
    const t = await created<Task>(await post('/tasks', {title: 'y'}));
    expect(
      (
        await fieldsOf(
          await patch(`/tasks/${t.id}`, {
            version: 1,
            contactId: crypto.randomUUID(),
          }),
        )
      ).contactId,
    ).toMatch(/No encontramos esa persona/);
  });

  it('a demo person used by a real task becomes real, with their demo company', async () => {
    const ana = (await listOf<Contact>('contacts')).find(
      c => c.name === 'Ana Demo',
    )!;
    expect(ana.isDemo).toBe(true);
    const t = await created<Task>(
      await post('/tasks', {title: 'Revisar anclajes', contactId: ana.id}),
    );
    expect(t.contact?.id).toBe(ana.id);
    const after = (await listOf<Contact>('contacts')).find(
      c => c.id === ana.id,
    )!;
    expect(after).toMatchObject({isDemo: false, version: ana.version + 1});
    expect((await company(ana.company!.id)).isDemo).toBe(false);
  });

  it('never touches the heavy-load answer', async () => {
    const c = await created<Contact>(
      await post('/contacts', {name: 'Grúa Prueba'}),
    );
    const t = await created<Task>(
      await post('/tasks', {
        title: 'Generador',
        kind: 'delivery',
        contactId: c.id,
      }),
    );
    expect(t.heavyLoad).toBeNull();
  });
});

describe('recent searches', () => {
  const path = () => orgPath('recent-searches');
  const push = (query: unknown, t = token) =>
    h.request('POST', path(), {token: t, body: {query}});

  it('keeps one entry per accent- and case-insensitive query, newest first, at most five', async () => {
    expect(await listOf<RecentSearch>('recent-searches')).toEqual([]);
    const first = await push('  Escenarios  ');
    expect(first.status).toBe(200);
    expect((await json<ListResponse<RecentSearch>>(first)).items).toEqual([
      {query: 'Escenarios', at: h.clock.now().toISOString()},
    ]);
    await push('vallas');
    h.clock.advance(1000);
    const again = await json<ListResponse<RecentSearch>>(
      await push('ESCENÁRIOS'),
    );
    expect(again.items.map(r => r.query)).toEqual(['ESCENÁRIOS', 'vallas']);
    expect(again.items[0]?.at).toBe(h.clock.now().toISOString());

    for (const q of ['a1', 'a2', 'a3', 'a4', 'a5']) await push(q);
    expect(
      (await listOf<RecentSearch>('recent-searches')).map(r => r.query),
    ).toEqual(['a5', 'a4', 'a3', 'a2', 'a1']);
    const rows = await h.db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM recent_searches',
    );
    expect(rows[0]?.n).toBe(5);
  });

  it('are per user, cleared on request and never written to the activity log', async () => {
    expect(await listOf<RecentSearch>('recent-searches', dailos)).toEqual([]);
    await push('Teatro', dailos);
    expect(
      (await listOf<RecentSearch>('recent-searches', dailos)).map(r => r.query),
    ).toEqual(['Teatro']);
    expect((await activity(20)).some(a => a.entityLabel === 'Teatro')).toBe(
      false,
    );
    expect((await h.request('DELETE', path(), {token: dailos})).status).toBe(
      204,
    );
    expect(await listOf<RecentSearch>('recent-searches', dailos)).toEqual([]);
    // Elvis keeps his.
    expect((await listOf<RecentSearch>('recent-searches')).length).toBe(5);
  });

  it('validates the query, hides other organizations and refuses guests', async () => {
    expect((await fieldsOf(await push(''))).query).toBe(
      'Este campo es obligatorio.',
    );
    expect((await fieldsOf(await push('¿?'))).query).toMatch(
      /al menos una letra/,
    );
    expect((await fieldsOf(await push('x'.repeat(101)))).query).toBe(
      'Máximo 100 caracteres.',
    );
    expect(
      (
        await h.request(
          'POST',
          `/organizations/${foreign.orgId}/recent-searches`,
          {
            token,
            body: {query: 'x'},
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          'GET',
          `/organizations/${foreign.orgId}/recent-searches`,
          {token},
        )
      ).status,
    ).toBe(404);
    expect((await push('vallas', guest)).status).toBe(403);
    expect((await h.request('DELETE', path(), {token: guest})).status).toBe(
      403,
    );
    expect(await listOf<RecentSearch>('recent-searches', guest)).toEqual([]);
  });
});
