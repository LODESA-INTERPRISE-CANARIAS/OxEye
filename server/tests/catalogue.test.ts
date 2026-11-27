import {beforeAll, describe, expect, it} from 'vitest';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  BUILT_IN_SERVICE_CATEGORIES,
} from '../../shared/logistics/rules.ts';
import {NO_ACCESS} from '../../shared/logistics/permissions.ts';
import {withholdFor} from '../../shared/logistics/redaction.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  Category,
  Company,
  Contact,
  ListResponse,
  Offer,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let token: string;
let dailos: string;
let guest: string;
/** Records of another organization the pilot users do not belong to. */
let foreign: {
  orgId: string;
  companyId: string;
  categoryId: string;
  offerId: string;
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
  const [company] = await h.db.query<{id: string}>(
    `INSERT INTO companies (organization_id, name, created_by, updated_by)
     VALUES ($1, 'Empresa ajena', $2, $2) RETURNING id`,
    [org!.id, user!.id],
  );
  const [category] = await h.db.query<{id: string}>(
    `INSERT INTO categories (organization_id, scope, name, created_by)
     VALUES ($1, 'service', 'Ajena', $2) RETURNING id`,
    [org!.id, user!.id],
  );
  const [offer] = await h.db.query<{id: string}>(
    `INSERT INTO offers (organization_id, company_id, name, created_by, updated_by)
     VALUES ($1, $2, 'Oferta ajena', $3, $3) RETURNING id`,
    [org!.id, company!.id, user!.id],
  );
  foreign = {
    orgId: org!.id,
    companyId: company!.id,
    categoryId: category!.id,
    offerId: offer!.id,
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

async function activity(limit = 10): Promise<ActivityEntry[]> {
  const res = await h.request('GET', `${orgPath('activity')}?limit=${limit}`, {
    token,
  });
  return (await json<ListResponse<ActivityEntry>>(res)).items;
}

async function categoryId(name: string): Promise<string> {
  const all = await listOf<Category>('categories');
  return all.find(c => c.name === name)!.id;
}

describe('categories', () => {
  it('lists the built-ins in their order, then custom ones by name, services before resources', async () => {
    await created(await post('/categories', {scope: 'service', name: 'Zumos'}));
    await created(await post('/categories', {scope: 'service', name: 'agua'}));
    await created(
      await post('/categories', {scope: 'resource', name: 'Mobiliario'}),
    );
    const all = await listOf<Category>('categories');
    const builtIns = all.slice(0, BUILT_IN_SERVICE_CATEGORIES.length);
    expect(builtIns.map(c => c.name)).toEqual([...BUILT_IN_SERVICE_CATEGORIES]);
    expect(builtIns.every(c => c.builtIn && c.scope === 'service')).toBe(true);
    expect(all.filter(c => !c.builtIn).map(c => [c.name, c.scope])).toEqual([
      ['agua', 'service'],
      ['Zumos', 'service'],
      ['Mobiliario', 'resource'],
    ]);
    // Order: service built-ins, custom service, resource built-ins (M4),
    // custom resource.
    const resourceBuiltIns = all.filter(
      c => c.builtIn && c.scope === 'resource',
    );
    expect(resourceBuiltIns.map(c => c.name)).toEqual([
      ...BUILT_IN_RESOURCE_CATEGORIES,
    ]);
    expect(all.map(c => c.name).slice(-1)).toEqual(['Mobiliario']);
    expect(all[0]).toEqual({
      id: expect.any(String),
      organizationId: h.org.id,
      scope: 'service',
      name: 'Montaje',
      builtIn: true,
    });
  });

  it('finds an existing name in the same scope (200) instead of creating another', async () => {
    const first = await created<Category>(
      await post('/categories', {
        scope: 'service',
        name: '  Grúas   y  plataformas ',
      }),
    );
    expect(first).toMatchObject({name: 'Grúas y plataformas', builtIn: false});
    expect((await activity(1))[0]).toMatchObject({
      entityType: 'category',
      entityId: first.id,
      entityLabel: 'Grúas y plataformas',
      action: 'create',
    });
    const again = await post('/categories', {
      scope: 'service',
      name: 'GRÚAS Y PLATAFORMAS',
    });
    expect(again.status).toBe(200);
    expect((await json<Category>(again)).id).toBe(first.id);
    // A built-in is found too.
    const builtIn = await post('/categories', {
      scope: 'service',
      name: 'montaje',
    });
    expect(builtIn.status).toBe(200);
    expect(await json<Category>(builtIn)).toMatchObject({
      name: 'Montaje',
      builtIn: true,
    });
    // Same name in the other scope is another category.
    const resource = await created<Category>(
      await post('/categories', {
        scope: 'resource',
        name: 'Grúas y plataformas',
      }),
    );
    expect(resource.id).not.toBe(first.id);
  });

  it('validates the input with Spanish messages', async () => {
    expect(
      await fieldsOf(await post('/categories', {scope: 'x', name: ''})),
    ).toEqual({
      scope: 'Tipo de categoría no válido: usa servicio o recurso.',
      name: 'Este campo es obligatorio.',
    });
    expect(
      (
        await fieldsOf(
          await post('/categories', {scope: 'service', name: 'x'.repeat(61)}),
        )
      ).name,
    ).toBe('Máximo 60 caracteres.');
  });

  it('hides other organizations and is read-only for guests', async () => {
    expect(
      (
        await h.request('GET', `/organizations/${foreign.orgId}/categories`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post('/categories', {
          organizationId: foreign.orgId,
          scope: 'service',
          name: 'x',
        })
      ).status,
    ).toBe(404);
    expect(
      (await listOf<Category>('categories', guest)).length,
    ).toBeGreaterThan(0);
    expect(
      (await post('/categories', {scope: 'service', name: 'Invitada'}, guest))
        .status,
    ).toBe(403);
    expect(
      (
        await h.request('DELETE', `/categories/${await categoryId('Zumos')}`, {
          token: guest,
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.request('DELETE', `/categories/${foreign.categoryId}`, {token}))
        .status,
    ).toBe(404);
    expect(
      (await h.request('DELETE', `/categories/${crypto.randomUUID()}`, {token}))
        .status,
    ).toBe(404);
  });

  it('never deletes a built-in', async () => {
    const res = await h.request(
      'DELETE',
      `/categories/${await categoryId('Vallas')}`,
      {
        token,
      },
    );
    expect(res.status).toBe(400);
    expect((await json<ApiErrorBody>(res)).message).toMatch(
      /«Vallas» es una categoría de serie/,
    );
  });

  it('deleting a custom category unlinks companies and offers with a new version and activity', async () => {
    const cat = await created<Category>(
      await post('/categories', {
        scope: 'service',
        name: 'Fuegos artificiales',
      }),
    );
    const company = await created<Company>(
      await post('/companies', {
        name: 'Pirotecnia Prueba',
        categoryIds: [cat.id, await categoryId('Seguridad')],
      }),
    );
    const offer = await created<Offer>(
      await post('/offers', {
        name: 'Castillo de fuegos',
        companyId: company.id,
        categoryId: cat.id,
      }),
    );
    h.clock.advance(60_000);
    const res = await h.request('DELETE', `/categories/${cat.id}`, {
      token: dailos,
    });
    expect(res.status).toBe(204);

    const after = (await listOf<Company>('companies')).find(
      c => c.id === company.id,
    )!;
    expect(after.categoryIds).toEqual([await categoryId('Seguridad')]);
    expect(after).toMatchObject({
      version: company.version + 1,
      updatedBy: {displayName: 'Dailos'},
      updatedAt: h.clock.now().toISOString(),
    });
    const afterOffer = (await listOf<Offer>('offers')).find(
      o => o.id === offer.id,
    )!;
    expect(afterOffer).toMatchObject({
      categoryId: null,
      version: offer.version + 1,
    });
    expect(
      (await activity(3)).map(a => [a.entityType, a.action, a.changedFields]),
    ).toEqual([
      ['category', 'delete', []],
      ['offer', 'update', ['categoryId']],
      ['company', 'update', ['categoryIds']],
    ]);
    expect(
      (await listOf<Category>('categories')).some(c => c.id === cat.id),
    ).toBe(false);
  });
});

describe('companies', () => {
  it('creates with only a name: a supplier, nothing invented', async () => {
    const c = await created<Company>(
      await post('/companies', {name: '  Limpiezas   Prueba  '}),
    );
    expect(c).toMatchObject({
      name: 'Limpiezas Prueba',
      kind: 'supplier',
      categoryIds: [],
      phone: null,
      email: null,
      website: null,
      notes: null,
      mainContactId: null,
      contactCount: 0,
      offerCount: 0,
      restricted: false,
      version: 1,
      isDemo: false,
      verification: 'draft',
      createdBy: {displayName: 'Elvis'},
    });
    expect((await activity(1))[0]).toMatchObject({
      entityType: 'company',
      entityId: c.id,
      entityLabel: 'Limpiezas Prueba',
      action: 'create',
    });
  });

  it('creates a full record; categories come back in category order', async () => {
    const c = await created<Company>(
      await post('/companies', {
        name: 'Organismo Prueba',
        kind: 'public_body',
        categoryIds: [
          await categoryId('Seguridad'),
          await categoryId('Montaje'),
        ],
        phone: '+34 000 000 010',
        email: 'organismo.prueba@example.com',
        website: 'https://example.com',
        notes: 'Atienden por la mañana',
        source: 'reported',
        verification: 'to_verify',
      }),
    );
    expect(c).toMatchObject({
      kind: 'public_body',
      categoryIds: [await categoryId('Montaje'), await categoryId('Seguridad')],
      phone: '+34 000 000 010',
      email: 'organismo.prueba@example.com',
      website: 'https://example.com',
      notes: 'Atienden por la mañana',
      source: 'reported',
      verification: 'to_verify',
    });
  });

  it('answers 409 DUPLICATE with the existing company for the same name in any case', async () => {
    const existing = await created<Company>(
      await post('/companies', {
        name: 'Sonido Prueba Norte',
        phone: '+34 000 000 011',
      }),
    );
    const res = await post('/companies', {name: 'sonido   PRUEBA norte'});
    expect(res.status).toBe(409);
    const body = await json<ApiErrorBody>(res);
    expect(body.code).toBe('DUPLICATE');
    expect(body.message).toMatch(/Ya existe «Sonido Prueba Norte»/);
    expect(body.current).toMatchObject({
      id: existing.id,
      phone: '+34 000 000 011',
      restricted: false,
    });
  });

  it('validates contact details, kind, categories and main contact with Spanish messages', async () => {
    const fields = await fieldsOf(
      await post('/companies', {
        name: '',
        kind: 'shop',
        phone: 'mañana lo paso',
        email: 'ana@',
        categoryIds: ['nope'],
      }),
    );
    expect(fields.name).toBe('Este campo es obligatorio.');
    expect(fields.kind).toMatch(/^Tipo no válido/);
    expect(fields.phone).toMatch(/^Teléfono no válido/);
    expect(fields.email).toMatch(/^Correo no válido/);
    expect(fields.categoryIds).toBe('Alguna de las categorías no es válida.');

    const resource = await created<Category>(
      await post('/categories', {scope: 'resource', name: 'Generadores'}),
    );
    const refs = await fieldsOf(
      await post('/companies', {
        name: 'x',
        categoryIds: [resource.id, foreign.categoryId],
        mainContactId: crypto.randomUUID(),
      }),
    );
    expect(refs.categoryIds).toMatch(/no existe o no es de esta organización/);
    expect(refs.mainContactId).toMatch(
      /Una empresa nueva aún no tiene personas/,
    );
    // Blank contact details mean «not known yet».
    const blank = await created<Company>(
      await post('/companies', {name: 'En blanco', phone: '  ', email: ''}),
    );
    expect(blank).toMatchObject({phone: null, email: null});
    expect(
      (await post('/companies', {organizationId: foreign.orgId, name: 'x'}))
        .status,
    ).toBe(404);
  });

  it('patches with the current version, logs the changed fields and keeps the version on a no-op', async () => {
    const c = await created<Company>(
      await post('/companies', {name: 'Toldos Prueba'}),
    );
    const res = await patch(`/companies/${c.id}`, {
      version: 1,
      kind: 'other',
      phone: '+34 000 000 012',
      categoryIds: [await categoryId('Carpas')],
    });
    expect(res.status).toBe(200);
    const updated = await json<Company>(res);
    expect(updated).toMatchObject({
      version: 2,
      kind: 'other',
      phone: '+34 000 000 012',
      categoryIds: [await categoryId('Carpas')],
    });
    expect((await activity(1))[0]).toMatchObject({
      entityType: 'company',
      action: 'update',
      changedFields: ['kind', 'categoryIds', 'phone'],
    });
    const same = await patch(`/companies/${c.id}`, {
      version: 2,
      name: 'Toldos Prueba',
      categoryIds: [await categoryId('Carpas')],
      phone: '+34 000 000 012',
    });
    expect((await json<Company>(same)).version).toBe(2);
    // A case-only rename is not a clash with itself.
    const renamed = await json<Company>(
      await patch(`/companies/${c.id}`, {version: 2, name: 'TOLDOS PRUEBA'}),
    );
    expect(renamed).toMatchObject({name: 'TOLDOS PRUEBA', version: 3});
  });

  it('rejects a stale version with 409 and a rename onto another company with DUPLICATE', async () => {
    const a = await created<Company>(
      await post('/companies', {name: 'Vallas Uno Prueba'}),
    );
    const b = await created<Company>(
      await post('/companies', {name: 'Vallas Dos Prueba'}),
    );
    await patch(`/companies/${a.id}`, {version: 1, notes: 'Primera'}, dailos);
    const stale = await patch(`/companies/${a.id}`, {
      version: 1,
      notes: 'Segunda',
    });
    expect(stale.status).toBe(409);
    const body = await json<ApiErrorBody>(stale);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.current).toMatchObject({
      id: a.id,
      version: 2,
      notes: 'Primera',
    });

    const clash = await patch(`/companies/${b.id}`, {
      version: 1,
      name: 'vallas uno prueba',
    });
    expect(clash.status).toBe(409);
    const dup = await json<ApiErrorBody>(clash);
    expect(dup.code).toBe('DUPLICATE');
    expect((dup.current as Company).id).toBe(a.id);

    expect(
      (await patch(`/companies/${foreign.companyId}`, {version: 1, name: 'x'}))
        .status,
    ).toBe(404);
    expect(
      (await fieldsOf(await patch(`/companies/${a.id}`, {name: 'x'}))).version,
    ).toMatch(/Falta la versión/);
  });

  it('accepts as main contact only a person of the company', async () => {
    const c = await created<Company>(
      await post('/companies', {name: 'Catering Prueba'}),
    );
    const own = await created<Contact>(
      await post('/contacts', {name: 'Rosa Prueba', companyId: c.id}),
    );
    const other = await created<Contact>(
      await post('/contacts', {name: 'Pepe Prueba'}),
    );
    expect(
      (
        await fieldsOf(
          await patch(`/companies/${c.id}`, {
            version: 1,
            mainContactId: other.id,
          }),
        )
      ).mainContactId,
    ).toMatch(/no es de esta empresa/);
    const ok = await json<Company>(
      await patch(`/companies/${c.id}`, {version: 1, mainContactId: own.id}),
    );
    expect(ok).toMatchObject({
      mainContactId: own.id,
      contactCount: 1,
      version: 2,
    });
    const cleared = await json<Company>(
      await patch(`/companies/${c.id}`, {version: 2, mainContactId: null}),
    );
    expect(cleared.mainContactId).toBeNull();
  });

  it('deleting a company removes its offers and unlinks its contacts and tasks with new versions', async () => {
    const c = await created<Company>(
      await post('/companies', {name: 'Grúas Prueba'}),
    );
    const person = await created<Contact>(
      await post('/contacts', {name: 'Luis Prueba', companyId: c.id}),
    );
    await patch(`/companies/${c.id}`, {version: 1, mainContactId: person.id});
    const offer = await created<Offer>(
      await post('/offers', {
        name: 'Grúa 30 t',
        companyId: c.id,
        price: 900,
        unit: 'day',
      }),
    );
    const task = await created<Task>(
      await post('/tasks', {title: 'Izado de focos', companyId: c.id}),
    );
    const listed = (await listOf<Company>('companies')).find(
      x => x.id === c.id,
    )!;
    expect(listed).toMatchObject({contactCount: 1, offerCount: 1, version: 2});

    expect(
      (await fieldsOf(await h.request('DELETE', `/companies/${c.id}`, {token})))
        .version,
    ).toMatch(/Falta la versión/);
    expect(
      (await h.request('DELETE', `/companies/${c.id}?version=1`, {token}))
        .status,
    ).toBe(409);
    expect(
      (
        await h.request('DELETE', `/companies/${c.id}?version=2`, {
          token: guest,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.request('DELETE', `/companies/${foreign.companyId}?version=1`, {
          token,
        })
      ).status,
    ).toBe(404);

    const res = await h.request('DELETE', `/companies/${c.id}?version=2`, {
      token,
    });
    expect(res.status).toBe(204);
    expect((await listOf<Company>('companies')).some(x => x.id === c.id)).toBe(
      false,
    );
    expect((await listOf<Offer>('offers')).some(o => o.id === offer.id)).toBe(
      false,
    );
    expect(
      (await listOf<Contact>('contacts')).find(k => k.id === person.id),
    ).toMatchObject({
      company: null,
      version: person.version + 1,
    });
    expect(
      (await listOf<Task>('tasks')).find(t => t.id === task.id),
    ).toMatchObject({
      company: null,
      version: task.version + 1,
    });
    expect(
      (await activity(4)).map(a => [
        a.entityType,
        a.entityLabel,
        a.action,
        a.changedFields,
      ]),
    ).toEqual([
      ['company', 'Grúas Prueba', 'delete', []],
      ['task', 'Izado de focos', 'update', ['company']],
      ['offer', 'Grúa 30 t', 'delete', []],
      ['contact', 'Luis Prueba', 'update', ['company']],
    ]);
  });

  it('a guest cannot create or edit companies', async () => {
    expect(
      (await post('/companies', {name: 'Invitada Prueba'}, guest)).status,
    ).toBe(403);
    const c = (await listOf<Company>('companies'))[0]!;
    expect(
      (
        await patch(
          `/companies/${c.id}`,
          {version: c.version, name: 'x'},
          guest,
        )
      ).status,
    ).toBe(403);
  });
});

describe('offers', () => {
  it('creates with a name and a company by name; amounts are numbers, unknown stays null', async () => {
    const o = await created<Offer>(
      await post('/offers', {
        name: 'Escenario 6 × 4 m',
        companyName: 'Tarimas Prueba',
        categoryId: await categoryId('Estructuras'),
        price: 350.5,
        unit: 'day',
        customUnit: 'ignorada',
        assemblyCost: 120,
        vatIncluded: false,
        conditions: 'Pago a 30 días',
      }),
    );
    expect(o).toMatchObject({
      name: 'Escenario 6 × 4 m',
      company: {name: 'Tarimas Prueba'},
      categoryId: await categoryId('Estructuras'),
      price: 350.5,
      unit: 'day',
      customUnit: null,
      transportCost: null,
      assemblyCost: 120,
      maintenanceCost: null,
      vatIncluded: false,
      conditions: 'Pago a 30 días',
      restricted: false,
      version: 1,
    });
    expect(typeof o.price).toBe('number');
    // The company was created by name, as a supplier.
    const company = (await listOf<Company>('companies')).find(
      c => c.id === o.company.id,
    )!;
    expect(company).toMatchObject({kind: 'supplier', offerCount: 1});

    const minimal = await created<Offer>(
      await post('/offers', {name: 'Sin precio', companyId: o.company.id}),
    );
    expect(minimal).toMatchObject({
      price: null,
      unit: 'unit',
      customUnit: null,
      // E5: a new offer is before tax unless it says otherwise; no tax of its own.
      vatIncluded: false,
      tax: null,
      categoryId: null,
    });
    const free = await created<Offer>(
      await post('/offers', {
        name: 'Gratis',
        companyId: o.company.id,
        price: 0,
      }),
    );
    expect(free.price).toBe(0);
    const custom = await created<Offer>(
      await post('/offers', {
        name: 'Carpa',
        companyId: o.company.id,
        unit: 'custom',
        customUnit: 'por escenario',
      }),
    );
    expect(custom).toMatchObject({unit: 'custom', customUnit: 'por escenario'});
    expect((await activity(1))[0]).toMatchObject({
      entityType: 'offer',
      entityLabel: 'Carpa',
      action: 'create',
    });
  });

  it('requires a company and validates amounts, unit and category', async () => {
    expect(await fieldsOf(await post('/offers', {name: 'x'}))).toEqual({
      companyName: 'Indica la empresa o entidad que hace la oferta.',
    });
    const fields = await fieldsOf(
      await post('/offers', {
        name: '',
        companyId: foreign.companyId,
        price: -1,
        transportCost: 1.005,
        assemblyCost: 'cien',
        maintenanceCost: 10_000_000.01,
        unit: 'kg',
        vatIncluded: 'no sé',
      }),
    );
    expect(fields.name).toBe('Este campo es obligatorio.');
    expect(fields.price).toMatch(/^Importe no válido/);
    expect(fields.transportCost).toMatch(/dos decimales/);
    expect(fields.assemblyCost).toMatch(/^Debe ser un importe/);
    expect(fields.maintenanceCost).toMatch(/^Importe no válido/);
    expect(fields.unit).toMatch(/^Unidad no válida/);
    expect(fields.vatIncluded).toMatch(/IVA/);

    const refs = await fieldsOf(
      await post('/offers', {
        name: 'x',
        companyId: foreign.companyId,
        categoryId: foreign.categoryId,
      }),
    );
    expect(refs.companyId).toMatch(/No encontramos esa empresa/);
    expect(refs.categoryId).toMatch(/no es de servicios de esta organización/);
    expect(
      (
        await post('/offers', {
          organizationId: foreign.orgId,
          name: 'x',
          companyName: 'y',
        })
      ).status,
    ).toBe(404);
  });

  it('patches: a unit other than custom clears its wording; the company can change but not go', async () => {
    const o = await created<Offer>(
      await post('/offers', {
        name: 'Pantalla LED',
        companyName: 'Audiovisuales Prueba',
        unit: 'custom',
        customUnit: 'por pase',
        price: 1200,
      }),
    );
    const unknown = await json<Offer>(
      await patch(`/offers/${o.id}`, {version: 1, price: null, unit: 'day'}),
    );
    expect(unknown).toMatchObject({
      price: null,
      unit: 'day',
      customUnit: null,
      version: 2,
    });
    expect((await activity(1))[0]?.changedFields).toEqual([
      'price',
      'unit',
      'customUnit',
    ]);
    expect(
      (
        await fieldsOf(
          await patch(`/offers/${o.id}`, {version: 2, companyId: null}),
        )
      ).companyName,
    ).toMatch(/Indica la empresa/);
    expect(
      (
        await fieldsOf(
          await patch(`/offers/${o.id}`, {version: 2, companyName: ' '}),
        )
      ).companyName,
    ).toMatch(/Indica la empresa/);
    const moved = await json<Offer>(
      await patch(`/offers/${o.id}`, {
        version: 2,
        companyName: 'Pantallas Dos Prueba',
      }),
    );
    expect(moved).toMatchObject({
      company: {name: 'Pantallas Dos Prueba'},
      version: 3,
    });
    const noop = await json<Offer>(
      await patch(`/offers/${o.id}`, {
        version: 3,
        companyName: 'PANTALLAS DOS PRUEBA',
        unit: 'day',
        price: null,
      }),
    );
    expect(noop.version).toBe(3);

    const stale = await patch(
      `/offers/${o.id}`,
      {version: 1, name: 'x'},
      dailos,
    );
    expect(stale.status).toBe(409);
    expect((await json<ApiErrorBody>(stale)).current).toMatchObject({
      id: o.id,
      version: 3,
      restricted: false,
    });
    expect(
      (await patch(`/offers/${foreign.offerId}`, {version: 1, name: 'x'}))
        .status,
    ).toBe(404);
    expect(
      (await patch(`/offers/${o.id}`, {version: 3, name: 'x'}, guest)).status,
    ).toBe(403);
  });

  it('deletes at the current version and lists by company, then name', async () => {
    const a = await created<Offer>(
      await post('/offers', {name: 'b-oferta', companyName: 'AAA Primera'}),
    );
    await created(
      await post('/offers', {name: 'A-oferta', companyName: 'aaa primera'}),
    );
    const names = (await listOf<Offer>('offers')).map(
      o => `${o.company.name}/${o.name}`,
    );
    expect(names.indexOf('AAA Primera/A-oferta')).toBe(
      names.indexOf('AAA Primera/b-oferta') - 1,
    );
    expect(
      (await h.request('DELETE', `/offers/${a.id}?version=2`, {token})).status,
    ).toBe(409);
    expect(
      (await h.request('DELETE', `/offers/${a.id}?version=1`, {token: guest}))
        .status,
    ).toBe(403);
    expect(
      (
        await h.request('DELETE', `/offers/${foreign.offerId}?version=1`, {
          token,
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.request('DELETE', `/offers/${a.id}?version=1`, {token})).status,
    ).toBe(204);
    expect((await activity(1))[0]).toMatchObject({
      entityType: 'offer',
      entityLabel: 'b-oferta',
      action: 'delete',
    });
  });
});

describe('guests never receive contact details, observations or prices', () => {
  const SECRETS = {
    phone: '+34 000 000 013',
    email: 'secreto@example.com',
    notes: 'Nota interna sensible',
    description: 'Descripción interna',
    conditions: 'Condiciones internas',
  };

  beforeAll(async () => {
    const company = await created<Company>(
      await post('/companies', {
        name: 'Empresa Reservada',
        phone: SECRETS.phone,
        email: SECRETS.email,
        website: 'https://example.com/reservada',
        notes: SECRETS.notes,
      }),
    );
    await created(
      await post('/contacts', {
        name: 'Persona Reservada',
        role: 'Gerente',
        companyId: company.id,
        phone: SECRETS.phone,
        email: SECRETS.email,
        description: SECRETS.description,
        notes: SECRETS.notes,
      }),
    );
    await created(
      await post('/offers', {
        name: 'Oferta Reservada',
        companyId: company.id,
        description: 'Visible para todos',
        price: 777.77,
        transportCost: 11,
        assemblyCost: 22,
        maintenanceCost: 33,
        conditions: SECRETS.conditions,
        unit: 'hour',
        vatIncluded: true,
      }),
    );
  });

  it('E4: the guest account has no Contactos or Catálogo at all (403, nothing in the body)', async () => {
    for (const list of ['companies', 'contacts', 'offers']) {
      const res = await h.request('GET', orgPath(list), {token: guest});
      expect(res.status).toBe(403);
      const raw = await res.text();
      expect(JSON.parse(raw)).toEqual({
        code: 'FORBIDDEN',
        message: NO_ACCESS['directory.read'],
      });
      for (const secret of [
        ...Object.values(SECRETS),
        '777.77',
        'Empresa Reservada',
        'Persona Reservada',
        'Oferta Reservada',
      ]) {
        expect(raw).not.toContain(secret);
      }
    }
    // Inventory categories stay (materials are part of the plan); service
    // categories belong to the directory.
    const categories = await listOf<Category>('categories', guest);
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.every(c => c.scope === 'resource')).toBe(true);
    // The directory's history is not the guest's either.
    const company = (await listOf<Company>('companies')).find(
      c => c.name === 'Empresa Reservada',
    )!;
    const history = await h.request(
      'GET',
      `${orgPath('activity')}?entityType=company&entityId=${company.id}`,
      {token: guest},
    );
    expect(history.status).toBe(403);
    const feed = await listOf<ActivityEntry>('activity?limit=100', guest);
    expect(
      feed.filter(e => ['company', 'contact', 'offer'].includes(e.entityType)),
    ).toEqual([]);
    const memberFeed = await listOf<ActivityEntry>('activity?limit=100');
    expect(memberFeed.some(e => e.entityType === 'contact')).toBe(true);
  });

  it('the single withholding path still blanks directory fields for a guest viewer (defence in depth)', () => {
    expect(
      withholdFor(
        'company',
        {name: 'Empresa Reservada', phone: SECRETS.phone, notes: SECRETS.notes},
        'guest',
      ),
    ).toEqual({
      name: 'Empresa Reservada',
      phone: null,
      email: null,
      notes: null,
      restricted: true,
    });
    expect(
      withholdFor('offer', {price: 777.77, conditions: 'x'}, 'guest'),
    ).toMatchObject({price: null, conditions: null, restricted: true});
  });

  it('members see everything, with restricted false', async () => {
    const company = (await listOf<Company>('companies')).find(
      c => c.name === 'Empresa Reservada',
    )!;
    expect(company).toMatchObject({phone: SECRETS.phone, restricted: false});
    const contact = (await listOf<Contact>('contacts')).find(
      c => c.name === 'Persona Reservada',
    )!;
    expect(contact).toMatchObject({notes: SECRETS.notes, restricted: false});
    const offer = (await listOf<Offer>('offers')).find(
      o => o.name === 'Oferta Reservada',
    )!;
    expect(offer).toMatchObject({price: 777.77, restricted: false});
  });

  it('the activity a guest reads names records, never their withheld values', async () => {
    const res = await h.request('GET', `${orgPath('activity')}?limit=100`, {
      token: guest,
    });
    const raw = await res.text();
    for (const secret of Object.values(SECRETS)) {
      expect(raw).not.toContain(secret);
    }
  });

  it('a guest can write none of them', async () => {
    const company = (await listOf<Company>('companies')).find(
      c => c.name === 'Empresa Reservada',
    )!;
    const contact = (await listOf<Contact>('contacts')).find(
      c => c.name === 'Persona Reservada',
    )!;
    const writes: [string, string, unknown?][] = [
      ['POST', '/contacts', {organizationId: h.org.id, name: 'x'}],
      [
        'PATCH',
        `/contacts/${contact.id}`,
        {version: contact.version, name: 'x'},
      ],
      ['DELETE', `/contacts/${contact.id}?version=${contact.version}`],
      [
        'POST',
        '/offers',
        {organizationId: h.org.id, name: 'x', companyId: company.id},
      ],
      ['DELETE', `/companies/${company.id}?version=${company.version}`],
    ];
    for (const [method, path, body] of writes) {
      expect((await h.request(method, path, {token: guest, body})).status).toBe(
        403,
      );
    }
  });
});
