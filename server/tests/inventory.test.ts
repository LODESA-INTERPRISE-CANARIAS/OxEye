import {beforeAll, describe, expect, it} from 'vitest';
import {planWarnings} from '../../shared/logistics/conflicts.ts';
import {FIELD_LABEL} from '../../shared/logistics/history.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  Category,
  Company,
  ListResponse,
  LogisticsEvent,
  Note,
  Offer,
  Resource,
  Task,
  Warehouse,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;
let guest: string;
/** Records of another organization the pilot users do not belong to. */
let foreign: {
  orgId: string;
  warehouseId: string;
  resourceId: string;
  companyId: string;
  offerId: string;
  categoryId: string;
};

beforeAll(async () => {
  h = await createHarness();
  token = (await h.login('Elvis')).token;
  dailos = (await h.login('Dailos')).token;
  guest = (await h.login('Invitado')).token;

  const [org] = await h.db.query<{id: string}>(
    "INSERT INTO organizations (name) VALUES ('Otra organización') RETURNING id",
  );
  const [user] = await h.db.query<{id: string}>(
    "SELECT id FROM users WHERE display_name = 'Sistema'",
  );
  const insert = async (sql: string, params: unknown[]) =>
    (await h.db.query<{id: string}>(sql, params))[0]!.id;
  const companyId = await insert(
    `INSERT INTO companies (organization_id, name, created_by, updated_by)
     VALUES ($1, 'Empresa ajena', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  foreign = {
    orgId: org!.id,
    companyId,
    offerId: await insert(
      `INSERT INTO offers (organization_id, company_id, name, created_by, updated_by)
       VALUES ($1, $2, 'Oferta ajena', $3, $3) RETURNING id`,
      [org!.id, companyId, user!.id],
    ),
    warehouseId: await insert(
      `INSERT INTO warehouses (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Almacén ajeno', $2, $2) RETURNING id`,
      [org!.id, user!.id],
    ),
    resourceId: await insert(
      `INSERT INTO resources (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Recurso ajeno', $2, $2) RETURNING id`,
      [org!.id, user!.id],
    ),
    categoryId: await insert(
      `INSERT INTO categories (organization_id, scope, name, created_by)
       VALUES ($1, 'resource', 'Ajena', $2) RETURNING id`,
      [org!.id, user!.id],
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

async function ok<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200);
  return json<T>(res);
}

function patch(path: string, body: Record<string, unknown>, t = token) {
  return h.request('PATCH', path, {token: t, body});
}

function del(path: string, version: number, t = token) {
  return h.request('DELETE', `${path}?version=${version}`, {token: t});
}

async function fieldsOf(res: Response): Promise<Record<string, string>> {
  expect(res.status).toBe(400);
  const body = await json<ApiErrorBody>(res);
  expect(body.code).toBe('VALIDATION');
  return body.fields ?? {};
}

async function history(type: string, id: string): Promise<ActivityEntry[]> {
  const res = await h.request(
    'GET',
    `${orgPath('activity')}?entityType=${type}&entityId=${id}`,
    {token},
  );
  return (await json<ListResponse<ActivityEntry>>(res)).items;
}

async function categoryId(name: string, scope = 'resource'): Promise<string> {
  const all = await listOf<Category>('categories');
  return all.find(c => c.name === name && c.scope === scope)!.id;
}

const newWarehouse = async (name: string, body = {}) =>
  created<Warehouse>(await post('/warehouses', {name, ...body}));
const newResource = async (name: string, body = {}) =>
  created<Resource>(await post('/resources', {name, ...body}));
const resourceById = async (id: string) =>
  (await listOf<Resource>('resources')).find(r => r.id === id)!;

describe('warehouses', () => {
  it('creates with only a name: nothing invented, logged by name', async () => {
    const w = await newWarehouse('  Nave   Prueba Norte ');
    expect(w).toMatchObject({
      organizationId: h.org.id,
      name: 'Nave Prueba Norte',
      address: null,
      notes: null,
      resourceCount: 0,
      version: 1,
      verification: 'draft',
      source: null,
      isDemo: false,
      restricted: false,
      createdBy: {displayName: 'Elvis'},
    });
    expect(await history('warehouse', w.id)).toMatchObject([
      {action: 'create', entityLabel: 'Nave Prueba Norte'},
    ]);
  });

  it('answers 409 DUPLICATE with the existing warehouse for the same name in any case', async () => {
    const first = await newWarehouse('Nave Prueba Duplicada', {
      address: 'Calle Prueba, 2',
    });
    const res = await post('/warehouses', {name: 'nave prueba DUPLICADA'});
    expect(res.status).toBe(409);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('DUPLICATE');
    expect(body.message).toMatch(/Ya existe el almacén/);
    expect(body.current).toMatchObject({
      id: first.id,
      address: 'Calle Prueba, 2',
      restricted: false,
    });

    // Renaming onto it is a DUPLICATE too.
    const other = await newWarehouse('Nave Prueba Otra');
    const rename = await patch(`/warehouses/${other.id}`, {
      version: 1,
      name: 'NAVE PRUEBA DUPLICADA',
    });
    expect(rename.status).toBe(409);
    expect((await json<ApiErrorBody>(rename)).code).toBe('DUPLICATE');
  });

  it('validates with Spanish messages and ignores unknown keys', async () => {
    const fields = await fieldsOf(
      await post('/warehouses', {name: ' ', address: 'x'.repeat(301)}),
    );
    expect(fields.name).toBe('Este campo es obligatorio.');
    expect(fields.address).toBe('Máximo 300 caracteres.');
    const w = await newWarehouse('Nave Prueba Claves', {geometry: [1, 2]});
    expect(w).not.toHaveProperty('geometry');
  });

  it('patches with the current version, logs the field names and rejects a stale version with current', async () => {
    const w = await newWarehouse('Nave Prueba Versiones');
    const same = await ok<Warehouse>(
      await patch(`/warehouses/${w.id}`, {version: 1, name: w.name}),
    );
    expect(same.version).toBe(1);
    const updated = await ok<Warehouse>(
      await patch(
        `/warehouses/${w.id}`,
        {version: 1, address: 'Calle Prueba, 9', notes: 'Llave en conserjería'},
        dailos,
      ),
    );
    expect(updated).toMatchObject({
      version: 2,
      address: 'Calle Prueba, 9',
      updatedBy: {displayName: 'Dailos'},
    });
    expect((await history('warehouse', w.id))[0]).toMatchObject({
      action: 'update',
      changedFields: ['address', 'notes'],
    });
    const stale = await patch(`/warehouses/${w.id}`, {version: 1, notes: null});
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.current).toMatchObject({
      version: 2,
      notes: 'Llave en conserjería',
    });
    expect((await del(`/warehouses/${w.id}`, 1)).status).toBe(409);
  });

  it('hides other organizations (404)', async () => {
    expect(
      (
        await h.request('GET', `/organizations/${foreign.orgId}/warehouses`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (await patch(`/warehouses/${foreign.warehouseId}`, {version: 1})).status,
    ).toBe(404);
    expect((await del(`/warehouses/${foreign.warehouseId}`, 1)).status).toBe(
      404,
    );
    expect(
      (
        await h.request('POST', '/warehouses', {
          token,
          body: {organizationId: foreign.orgId, name: 'x'},
        })
      ).status,
    ).toBe(404);
    expect((await patch('/warehouses/not-a-uuid', {version: 1})).status).toBe(
      404,
    );
  });

  it('deleting a warehouse unlinks its resources and notes with new versions and activity', async () => {
    const w = await newWarehouse('Nave Prueba Borrable');
    const r = await newResource('Mesas Prueba', {warehouseId: w.id});
    expect(r.warehouse).toEqual({id: w.id, name: w.name});
    const note = await created<Note>(
      await post('/notes', {
        kind: 'note',
        text: 'Nota de almacén',
        ref: {type: 'warehouse', id: w.id},
      }),
    );
    const current = (await listOf<Warehouse>('warehouses')).find(
      x => x.id === w.id,
    )!;
    expect(current.resourceCount).toBe(1);

    h.clock.advance(60_000);
    expect(
      (await del(`/warehouses/${w.id}`, current.version, dailos)).status,
    ).toBe(204);
    const after = await resourceById(r.id);
    expect(after).toMatchObject({
      warehouse: null,
      version: r.version + 1,
      updatedBy: {displayName: 'Dailos'},
      updatedAt: h.clock.now().toISOString(),
    });
    expect((await history('resource', r.id))[0]).toMatchObject({
      action: 'update',
      changedFields: ['warehouse'],
      user: {displayName: 'Dailos'},
    });
    const n = (await listOf<Note>('notes')).find(x => x.id === note.id)!;
    expect(n).toMatchObject({ref: null, version: 2});
    expect((await history('note', note.id))[0]).toMatchObject({
      changedFields: ['ref'],
      entityLabel: 'Nota',
    });
    expect((await history('warehouse', w.id))[0]).toMatchObject({
      action: 'delete',
    });
  });
});

describe('resources', () => {
  it('creates with only a name: owned, «unidades», state unknown, not counted', async () => {
    const r = await newResource('Bancos Prueba');
    expect(r).toMatchObject({
      name: 'Bancos Prueba',
      ownership: 'owned',
      categoryId: null,
      warehouse: null,
      company: null,
      offerId: null,
      quantity: null,
      unit: 'unidades',
      dimensions: null,
      condition: 'unknown',
      availability: 'unknown',
      location: null,
      toAssess: false,
      notes: null,
      taskIds: [],
      version: 1,
      restricted: false,
    });
  });

  it('creates a full owned record; the warehouse is found or created by name and the quantity is a number', async () => {
    const carpas = await categoryId('Carpas');
    const first = await newResource('Carpas Prueba', {
      categoryId: carpas,
      warehouseName: 'Nave Prueba Sur',
      quantity: 12.5,
      unit: ' m² ',
      dimensions: '3 × 6 m',
      condition: 'fair',
      availability: 'in_use',
      location: 'Estantería 3',
      toAssess: true,
      notes: 'Revisar lonas',
      source: 'observed',
    });
    expect(first).toMatchObject({
      categoryId: carpas,
      warehouse: {name: 'Nave Prueba Sur'},
      quantity: 12.5,
      unit: 'm²',
      condition: 'fair',
      availability: 'in_use',
      location: 'Estantería 3',
      toAssess: true,
      source: 'observed',
    });
    expect(typeof first.quantity).toBe('number');
    // Same warehouse by name in any case; warehouseId wins over a name.
    const second = await newResource('Sillas Prueba', {
      warehouseName: 'NAVE PRUEBA SUR',
      quantity: 0,
      unit: '',
    });
    expect(second.warehouse?.id).toBe(first.warehouse?.id);
    expect(second).toMatchObject({quantity: 0, unit: 'unidades'});
    const other = await newWarehouse('Nave Prueba Este');
    const third = await newResource('Mesas Prueba Este', {
      warehouseId: other.id,
      warehouseName: 'Nave Prueba Sur',
    });
    expect(third.warehouse?.id).toBe(other.id);
    expect(
      (await listOf<Warehouse>('warehouses')).filter(w =>
        w.name.toLowerCase().startsWith('nave prueba sur'),
      ),
    ).toHaveLength(1);
  });

  it('validates quantities, enums, categories and links with Spanish messages', async () => {
    const serviceCategory = await categoryId('Montaje', 'service');
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{quantity: -1}, 'quantity', /entre 0 y 1\.000\.000/],
      [{quantity: 1.234}, 'quantity', /dos decimales/],
      [{quantity: 1_000_001}, 'quantity', /entre 0 y 1\.000\.000/],
      [{quantity: '4'}, 'quantity', /un número/],
      [{condition: 'broken'}, 'condition', /Estado no válido/],
      [{availability: 'lost'}, 'availability', /Disponibilidad no válida/],
      [{ownership: 'rented'}, 'ownership', /propio o contratado/],
      [{toAssess: 'sí'}, 'toAssess', /sí o no/],
      [{unit: 'x'.repeat(31)}, 'unit', /Máximo 30/],
      [{location: 'x'.repeat(201)}, 'location', /Máximo 200/],
      [{dimensions: 'x'.repeat(121)}, 'dimensions', /Máximo 120/],
      [{categoryId: serviceCategory}, 'categoryId', /no es de recursos/],
      [{categoryId: foreign.categoryId}, 'categoryId', /no es de recursos/],
      [{warehouseId: foreign.warehouseId}, 'warehouseId', /almacén/],
      [{companyName: 'Prueba SL'}, 'companyName', /recurso propio/],
      [{offerId: foreign.offerId}, 'offerId', /recurso propio/],
      [
        {ownership: 'contracted', companyId: foreign.companyId},
        'companyId',
        /empresa/,
      ],
      [
        {ownership: 'contracted', offerId: foreign.offerId},
        'offerId',
        /oferta/,
      ],
    ];
    for (const [body, field, message] of cases) {
      const fields = await fieldsOf(
        await post('/resources', {name: 'x', ...body}),
      );
      expect(fields[field], `${field} ${JSON.stringify(body)}`).toMatch(
        message,
      );
    }
    expect((await fieldsOf(await post('/resources', {}))).name).toBe(
      'Este campo es obligatorio.',
    );
  });

  it('contracted: company by name (supplier), offer sets the company, offers must match, owned clears both', async () => {
    const r = await newResource('Generador Prueba', {
      ownership: 'contracted',
      companyName: 'Energía Prueba SL',
    });
    expect(r.company?.name).toBe('Energía Prueba SL');
    const company = (await listOf<Company>('companies')).find(
      c => c.id === r.company!.id,
    )!;
    expect(company.kind).toBe('supplier');

    const offer = await created<Offer>(
      await post('/offers', {
        name: 'Generador 20 kVA',
        companyId: company.id,
      }),
    );
    const otherOffer = await created<Offer>(
      await post('/offers', {name: 'Otra cosa', companyName: 'Otra Prueba SL'}),
    );
    // An offer without a company in the input: a resource with no company takes the offer's.
    const fromOffer = await newResource('Generador Prueba 2', {
      ownership: 'contracted',
      offerId: offer.id,
    });
    expect(fromOffer).toMatchObject({
      company: {id: company.id},
      offerId: offer.id,
    });
    // An offer of another company → 400.
    expect(
      (
        await fieldsOf(
          await patch(`/resources/${fromOffer.id}`, {
            version: 1,
            offerId: otherOffer.id,
          }),
        )
      ).offerId,
    ).toMatch(/otra empresa/);
    expect(
      (
        await fieldsOf(
          await post('/resources', {
            name: 'x',
            ownership: 'contracted',
            companyId: company.id,
            offerId: otherOffer.id,
          }),
        )
      ).offerId,
    ).toMatch(/otra empresa/);

    // Changing the company drops an offer of the old one.
    const moved = await ok<Resource>(
      await patch(`/resources/${fromOffer.id}`, {
        version: 1,
        companyId: otherOffer.company.id,
      }),
    );
    expect(moved).toMatchObject({
      company: {id: otherOffer.company.id},
      offerId: null,
      version: 2,
    });
    expect((await history('resource', fromOffer.id))[0]?.changedFields).toEqual(
      ['company', 'offerId'],
    );

    // Sending a company with owned is a 400; turning it owned clears both.
    expect(
      (
        await fieldsOf(
          await patch(`/resources/${r.id}`, {
            version: 1,
            ownership: 'owned',
            companyId: company.id,
          }),
        )
      ).companyId,
    ).toMatch(/recurso propio/);
    const owned = await ok<Resource>(
      await patch(`/resources/${r.id}`, {version: 1, ownership: 'owned'}),
    );
    expect(owned).toMatchObject({
      ownership: 'owned',
      company: null,
      offerId: null,
      version: 2,
    });
    expect((await history('resource', r.id))[0]?.changedFields).toEqual([
      'ownership',
      'company',
    ]);
  });

  it('patches with the current version, keeps it on a no-op and rejects a stale one with current', async () => {
    const r = await newResource('Focos Prueba', {quantity: 6});
    const same = await ok<Resource>(
      await patch(`/resources/${r.id}`, {
        version: 1,
        quantity: 6,
        name: r.name,
      }),
    );
    expect(same.version).toBe(1);
    const updated = await ok<Resource>(
      await patch(`/resources/${r.id}`, {
        version: 1,
        quantity: null,
        toAssess: true,
        condition: 'damaged',
      }),
    );
    expect(updated).toMatchObject({version: 2, quantity: null, toAssess: true});
    const stale = await patch(`/resources/${r.id}`, {version: 1, quantity: 3});
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.current).toMatchObject({version: 2, condition: 'damaged'});
    expect((await history('resource', r.id))[0]?.changedFields).toEqual([
      'quantity',
      'condition',
      'toAssess',
    ]);
    expect(
      (await patch(`/resources/${foreign.resourceId}`, {version: 1})).status,
    ).toBe(404);
    expect((await del(`/resources/${foreign.resourceId}`, 1)).status).toBe(404);
  });

  it('deleting a resource removes it from tasks and notes with new versions and activity', async () => {
    const r = await newResource('Furgoneta Prueba', {quantity: 1});
    const task = await created<Task>(
      await post('/tasks', {title: 'Reparto Prueba', resourceIds: [r.id]}),
    );
    expect(task.resourceIds).toEqual([r.id]);
    const note = await created<Note>(
      await post('/notes', {
        kind: 'incident',
        text: 'Pinchazo',
        ref: {type: 'resource', id: r.id},
      }),
    );
    expect((await resourceById(r.id)).taskIds).toEqual([task.id]);

    expect((await del(`/resources/${r.id}`, 2)).status).toBe(409);
    expect((await del(`/resources/${r.id}`, 1)).status).toBe(204);
    const t = (await listOf<Task>('tasks')).find(x => x.id === task.id)!;
    expect(t).toMatchObject({resourceIds: [], version: 2});
    expect((await history('task', task.id))[0]).toMatchObject({
      changedFields: ['resourceIds'],
    });
    const n = (await listOf<Note>('notes')).find(x => x.id === note.id)!;
    expect(n).toMatchObject({ref: null, version: 2});
  });

  it('a guest can write none of the inventory records', async () => {
    const w = await newWarehouse('Nave Prueba Invitado');
    const r = await newResource('Recurso Prueba Invitado');
    const writes: [string, string, unknown?][] = [
      ['POST', '/warehouses', {organizationId: h.org.id, name: 'x'}],
      ['PATCH', `/warehouses/${w.id}`, {version: 1, name: 'x'}],
      ['DELETE', `/warehouses/${w.id}?version=1`],
      ['POST', '/resources', {organizationId: h.org.id, name: 'x'}],
      ['PATCH', `/resources/${r.id}`, {version: 1, name: 'x'}],
      ['DELETE', `/resources/${r.id}?version=1`],
      ['POST', '/notes', {organizationId: h.org.id, kind: 'note', text: 'x'}],
    ];
    for (const [method, path, body] of writes) {
      expect((await h.request(method, path, {token: guest, body})).status).toBe(
        403,
      );
    }
  });
});

describe('tasks · resources', () => {
  it('stores the resources a task uses, sorted; unknown, foreign or malformed ids are a 400', async () => {
    const a = await newResource('Vallas Prueba A');
    const b = await newResource('Vallas Prueba B');
    const task = await created<Task>(
      await post('/tasks', {
        title: 'Vallado Prueba',
        resourceIds: [b.id, a.id, a.id],
      }),
    );
    expect(task.resourceIds).toEqual([a.id, b.id].sort());
    // Never answers the heavy-load question.
    expect(task.heavyLoad).toBeNull();
    expect((await resourceById(a.id)).taskIds).toEqual([task.id]);

    for (const resourceIds of [
      [foreign.resourceId],
      ['00000000-0000-4000-8000-000000000000'],
    ]) {
      expect(
        (await fieldsOf(await post('/tasks', {title: 'x', resourceIds})))
          .resourceIds,
      ).toMatch(/recursos ya no existe/);
    }
    expect(
      (await fieldsOf(await post('/tasks', {title: 'x', resourceIds: ['x']})))
        .resourceIds,
    ).toMatch(/no es válido/);
    const many = Array.from(
      {length: 51},
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(
      (await fieldsOf(await post('/tasks', {title: 'x', resourceIds: many})))
        .resourceIds,
    ).toMatch(/Como máximo 50/);

    // Replaces the whole list; the same set in another order is a no-op.
    const same = await ok<Task>(
      await patch(`/tasks/${task.id}`, {version: 1, resourceIds: [b.id, a.id]}),
    );
    expect(same.version).toBe(1);
    const updated = await ok<Task>(
      await patch(`/tasks/${task.id}`, {version: 1, resourceIds: [b.id]}),
    );
    expect(updated).toMatchObject({resourceIds: [b.id], version: 2});
    expect((await history('task', task.id))[0]?.changedFields).toEqual([
      'resourceIds',
    ]);
    expect(
      (
        await fieldsOf(
          await patch(`/tasks/${task.id}`, {
            version: 2,
            resourceIds: [foreign.resourceId],
          }),
        )
      ).resourceIds,
    ).toMatch(/recursos ya no existe/);
  });
});

describe('unlink on delete', () => {
  it('deleting a company unlinks its resources (company and offer) and the notes on it or its offers', async () => {
    const r = await newResource('Escenario Prueba', {
      ownership: 'contracted',
      companyName: 'Tarimas Prueba SL',
    });
    const offer = await created<Offer>(
      await post('/offers', {name: 'Tarima 4 × 2', companyId: r.company!.id}),
    );
    const withOffer = await ok<Resource>(
      await patch(`/resources/${r.id}`, {version: 1, offerId: offer.id}),
    );
    const onCompany = await created<Note>(
      await post('/notes', {
        kind: 'decision',
        text: 'Contratar a esta',
        ref: {type: 'company', id: r.company!.id},
      }),
    );
    const onOffer = await created<Note>(
      await post('/notes', {
        kind: 'open_question',
        text: '¿Incluye montaje?',
        ref: {type: 'offer', id: offer.id},
      }),
    );
    const company = (await listOf<Company>('companies')).find(
      c => c.id === r.company!.id,
    )!;
    expect(
      (await del(`/companies/${company.id}`, company.version)).status,
    ).toBe(204);

    expect(await resourceById(r.id)).toMatchObject({
      company: null,
      offerId: null,
      ownership: 'contracted',
      version: withOffer.version + 1,
    });
    expect((await history('resource', r.id))[0]?.changedFields).toEqual([
      'company',
      'offerId',
    ]);
    const notes = await listOf<Note>('notes');
    for (const id of [onCompany.id, onOffer.id]) {
      expect(notes.find(n => n.id === id)).toMatchObject({
        ref: null,
        version: 2,
      });
    }
  });

  it('deleting an offer, or moving it to another company, drops it from resources', async () => {
    const r = await newResource('Sonido Prueba', {
      ownership: 'contracted',
      companyName: 'Sonido Prueba SL',
    });
    const offer = await created<Offer>(
      await post('/offers', {name: 'Equipo básico', companyId: r.company!.id}),
    );
    await ok(
      await patch(`/resources/${r.id}`, {version: 1, offerId: offer.id}),
    );
    const moved = await ok<Offer>(
      await patch(`/offers/${offer.id}`, {
        version: 1,
        companyName: 'Otra Sonido Prueba SL',
      }),
    );
    expect(await resourceById(r.id)).toMatchObject({
      company: {id: r.company!.id},
      offerId: null,
      version: 3,
    });

    await ok(
      await patch(`/resources/${r.id}`, {
        version: 3,
        companyId: moved.company.id,
        offerId: offer.id,
      }),
    );
    expect((await resourceById(r.id)).offerId).toBe(offer.id);
    expect((await del(`/offers/${offer.id}`, moved.version)).status).toBe(204);
    expect(await resourceById(r.id)).toMatchObject({offerId: null, version: 5});
    expect((await history('resource', r.id))[0]?.changedFields).toEqual([
      'offerId',
    ]);
  });

  it('deleting a custom resource category unlinks resources; built-ins stay', async () => {
    const cat = await created<Category>(
      await post('/categories', {scope: 'resource', name: 'Hinchables Prueba'}),
    );
    const r = await newResource('Castillo Prueba', {categoryId: cat.id});
    expect(
      (await h.request('DELETE', `/categories/${cat.id}`, {token})).status,
    ).toBe(204);
    expect(await resourceById(r.id)).toMatchObject({
      categoryId: null,
      version: 2,
    });
    expect((await history('resource', r.id))[0]?.changedFields).toEqual([
      'categoryId',
    ]);
    const builtIn = await categoryId('Mesas');
    const res = await h.request('DELETE', `/categories/${builtIn}`, {token});
    expect(res.status).toBe(400);
    expect((await json<ApiErrorBody>(res)).message).toMatch(/cada recurso/);
  });

  it('deleting a contact or a task unlinks the notes that point at it', async () => {
    const contact = await created<{id: string; version: number}>(
      await post('/contacts', {name: 'Persona Prueba Notas'}),
    );
    const task = await created<Task>(
      await post('/tasks', {title: 'Tarea Prueba Notas'}),
    );
    const onContact = await created<Note>(
      await post('/notes', {
        kind: 'note',
        text: 'Llamar mañana',
        ref: {type: 'contact', id: contact.id},
      }),
    );
    const onTask = await created<Note>(
      await post('/notes', {
        kind: 'incident',
        text: 'Llegó tarde',
        ref: {type: 'task', id: task.id},
      }),
    );
    expect((await del(`/contacts/${contact.id}`, 1)).status).toBe(204);
    expect((await del(`/tasks/${task.id}`, 1)).status).toBe(204);
    const notes = await listOf<Note>('notes');
    for (const id of [onContact.id, onTask.id]) {
      expect(notes.find(n => n.id === id)).toMatchObject({
        ref: null,
        version: 2,
      });
      expect((await history('note', id))[0]?.changedFields).toEqual(['ref']);
    }
  });

  it('every field name logged for inventory, notes and task resources has a Spanish label', async () => {
    const rows = await h.db.query<{fields: string[]}>(
      `SELECT changed_fields AS fields FROM activity_log
        WHERE entity_type IN ('warehouse', 'resource', 'note', 'task')`,
    );
    const names = new Set(rows.flatMap(r => r.fields));
    expect(names.size).toBeGreaterThan(5);
    for (const name of names) expect(FIELD_LABEL, name).toHaveProperty(name);
  });
});

describe('demo inventory', () => {
  it('is fictitious and shows a resource conflict: one van in two overlapping tasks', async () => {
    const d = await createHarness();
    const t = (await d.login('Elvis')).token;
    const get = async <T>(what: string) =>
      (
        await json<ListResponse<T>>(
          await d.request('GET', `/organizations/${d.org.id}/${what}`, {
            token: t,
          }),
        )
      ).items;
    const resources = await get<Resource>('resources');
    const warehouses = await get<Warehouse>('warehouses');
    const notes = await get<Note>('notes');
    const tasks = await get<Task>('tasks');
    const events = await get<LogisticsEvent>('events');

    expect(warehouses.map(w => [w.name, w.isDemo, w.resourceCount])).toEqual([
      ['Almacén Demo', true, 3],
    ]);
    expect(resources.every(r => r.isDemo && / Demo$/.test(r.name))).toBe(true);
    expect(notes.map(n => n.kind).sort()).toEqual([
      'decision',
      'incident',
      'open_question',
    ]);
    expect(
      notes.every(n => n.isDemo && n.text?.startsWith('Dato ficticio')),
    ).toBe(true);
    const toilets = resources.find(r => r.name === 'Aseos portátiles Demo')!;
    expect(toilets).toMatchObject({
      ownership: 'contracted',
      company: {name: 'Escenarios Demo'},
      unit: 'unidades',
    });
    expect(resources.find(r => r.name === 'Vallas Demo')).toMatchObject({
      quantity: 200,
      toAssess: true,
    });

    const van = resources.find(r => r.name === 'Furgoneta Demo')!;
    expect(van.quantity).toBe(1);
    expect(van.taskIds).toHaveLength(2);
    const warnings = planWarnings(tasks, events, resources).filter(
      w => w.kind === 'resource_overlap',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({severity: 'conflict'});
    expect(new Set(warnings[0]!.taskIds)).toEqual(new Set(van.taskIds));
    await d.db.close();
  });

  it('removing the demo unlinks real records from demo inventory and notes, and keeps demo places real records use', async () => {
    const d = await createHarness();
    const t = (await d.login('Elvis')).token;
    const get = async <T>(what: string) =>
      (
        await json<ListResponse<T>>(
          await d.request('GET', `/organizations/${d.org.id}/${what}`, {
            token: t,
          }),
        )
      ).items;
    const send = (method: string, path: string, body: object) =>
      d.request(method, path, {
        token: t,
        body: {organizationId: d.org.id, ...body},
      });
    const resources = await get<Resource>('resources');
    const van = resources.find(r => r.name === 'Furgoneta Demo')!;
    const tasks = await get<Task>('tasks');
    const stage = tasks.find(x => x.title === 'Montaje del escenario')!;
    const offers = await get<Offer>('offers');
    const demoOffer = offers.find(o => o.company.name === 'Escenarios Demo')!;
    const demoWarehouse = (await get<Warehouse>('warehouses'))[0]!;

    // Real records pointing at demo ones.
    const realTask = await json<Task>(
      await send('POST', '/tasks', {
        title: 'Tarea real',
        resourceIds: [van.id],
      }),
    );
    const realNote = await json<Note>(
      await send('POST', '/notes', {
        kind: 'incident',
        text: 'Texto real reservado',
        eventId: stage.eventId,
        ref: {type: 'task', id: stage.id},
      }),
    );
    const noteOnWarehouse = await json<Note>(
      await send('POST', '/notes', {
        kind: 'note',
        text: 'Otro texto real',
        ref: {type: 'warehouse', id: demoWarehouse.id},
      }),
    );
    const realResource = await json<Resource>(
      await send('POST', '/resources', {
        name: 'Recurso real',
        ownership: 'contracted',
        offerId: demoOffer.id,
      }),
    );
    expect(realResource.company?.name).toBe('Escenarios Demo');
    const inDemoWarehouse = await json<Resource>(
      await send('POST', '/resources', {
        name: 'Mesas reales',
        warehouseName: 'almacén demo',
      }),
    );

    d.clock.advance(3_600_000);
    expect(
      (await d.request('DELETE', `/organizations/${d.org.id}/demo`, {token: t}))
        .status,
    ).toBe(200);

    expect(
      (await get<Task>('tasks')).find(x => x.id === realTask.id),
    ).toMatchObject({resourceIds: [], version: 2});
    const notesAfter = await get<Note>('notes');
    expect(notesAfter.map(n => n.id).sort()).toEqual(
      [realNote.id, noteOnWarehouse.id].sort(),
    );
    expect(notesAfter.find(n => n.id === realNote.id)).toMatchObject({
      event: null,
      ref: null,
      version: 2,
    });
    // A demo warehouse a real note or resource uses stays (made real by the
    // resource that named it).
    expect(notesAfter.find(n => n.id === noteOnWarehouse.id)).toMatchObject({
      ref: {type: 'warehouse', id: demoWarehouse.id, label: 'Almacén Demo'},
      version: 1,
    });
    const left = await get<Resource>('resources');
    expect(left.map(r => r.name).sort()).toEqual([
      'Mesas reales',
      'Recurso real',
    ]);
    expect(left.find(r => r.id === realResource.id)).toMatchObject({
      offerId: null,
      company: {name: 'Escenarios Demo'},
      version: 2,
    });
    expect(left.find(r => r.id === inDemoWarehouse.id)?.warehouse?.name).toBe(
      'Almacén Demo',
    );
    expect((await get<Company>('companies')).map(c => c.name)).toEqual([
      'Escenarios Demo',
    ]);

    const activity = await json<ListResponse<ActivityEntry>>(
      await d.request('GET', `/organizations/${d.org.id}/activity?limit=10`, {
        token: t,
      }),
    );
    // Newest entry per record (the list is newest first).
    const byId = new Map(
      [...activity.items].reverse().map(a => [a.entityId, a]),
    );
    expect(byId.get(realTask.id)?.changedFields).toEqual(['resourceIds']);
    expect(byId.get(realResource.id)?.changedFields).toEqual(['offerId']);
    expect(byId.get(realNote.id)).toMatchObject({
      changedFields: ['event', 'ref'],
      entityLabel: 'Incidencia',
    });
    expect(JSON.stringify(activity)).not.toContain('Texto real reservado');
    await d.db.close();
  });
});
