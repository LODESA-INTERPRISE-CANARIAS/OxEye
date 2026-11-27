/**
 * Safety audit: directory names (people, companies, offers) only reach
 * viewers with `directory.read`. The guest account and a member without
 * roles see what a link is («Empresa», «Persona de contacto», «Oferta del
 * catálogo»), never whose name, on tasks, resources and note links; the
 * activity label of a note on a company or an offer never names it either.
 * Fictitious data only.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {
  DIRECTORY_REF_LABEL,
  withholdFor,
} from '../../shared/logistics/redaction.ts';
import {ROLE_PERMISSIONS} from '../../shared/logistics/permissions.ts';
import type {
  ActivityEntry,
  Company,
  Contact,
  ListResponse,
  Note,
  Offer,
  Resource,
  Task,
} from '../../shared/logistics/contracts.ts';

const COMPANY = 'Proveedor Secreto Prueba';
const OFFER = 'Oferta Secreta Prueba';
const PERSON = 'Persona Secreta Prueba';

let h: Harness;
let admin: string;
let guest: string;
let noRoles: string;
let task: Task;
let resource: Resource;
const notes: Record<'company' | 'offer' | 'contact', Note> = {} as never;

async function post<T>(path: string, body: object): Promise<T> {
  const res = await h.request('POST', path, {
    token: admin,
    body: {organizationId: h.org.id, ...body},
  });
  expect(res.status, path).toBe(201);
  return json<T>(res);
}

const list = async <T>(what: string, token: string) =>
  (
    await json<ListResponse<T>>(
      await h.request('GET', `/organizations/${h.org.id}/${what}`, {token}),
    )
  ).items;

beforeAll(async () => {
  h = await createHarness();
  admin = (await h.login('Elvis')).token;
  guest = (await h.login('Invitado')).token;
  // Yeray keeps the membership but loses every role: no directory.read.
  await h.db.query(
    `UPDATE organization_members SET roles = '{}'
      WHERE user_id = (SELECT id FROM users WHERE username = 'Yeray')`,
  );
  noRoles = (await h.login('Yeray')).token;

  const company = await post<Company>('/companies', {name: COMPANY});
  const offer = await post<Offer>('/offers', {
    companyId: company.id,
    name: OFFER,
  });
  const contact = await post<Contact>('/contacts', {
    name: PERSON,
    companyId: company.id,
  });
  task = await post<Task>('/tasks', {
    title: 'Montaje Prueba Directorio',
    companyId: company.id,
    contactId: contact.id,
  });
  resource = await post<Resource>('/resources', {
    name: 'Generador Prueba Directorio',
    ownership: 'contracted',
    companyId: company.id,
  });
  for (const [type, id] of [
    ['company', company.id],
    ['offer', offer.id],
    ['contact', contact.id],
  ] as const) {
    notes[type] = await post<Note>('/notes', {
      kind: 'incident',
      text: 'Texto Prueba',
      ref: {type, id},
    });
  }
});

describe('directory names without directory.read', () => {
  it('every role that writes reads the directory (writes answer with names)', () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      if (permissions.includes('plan.edit')) {
        expect(permissions).toContain('directory.read');
      }
    }
  });

  it('the guest and a member without roles get generic names on tasks, resources and note links', async () => {
    for (const token of [guest, noRoles]) {
      const t = (await list<Task>('tasks', token)).find(x => x.id === task.id)!;
      expect(t.company).toEqual({id: task.company!.id, name: 'Empresa'});
      expect(t.contact).toBeNull();
      expect(t.restricted).toBe(true);
      const r = (await list<Resource>('resources', token)).find(
        x => x.id === resource.id,
      )!;
      expect(r.company?.name).toBe('Empresa');
      const ns = await list<Note>('notes', token);
      for (const type of ['company', 'offer', 'contact'] as const) {
        const n = ns.find(x => x.id === notes[type].id)!;
        expect(n.ref?.label).toBe(DIRECTORY_REF_LABEL[type]);
        expect(n.text).toBeNull();
      }
      const text = JSON.stringify([
        await list<Task>('tasks', token),
        await list<Resource>('resources', token),
        ns,
      ]);
      for (const name of [COMPANY, OFFER, PERSON]) {
        expect(text).not.toContain(name);
      }
    }
    // Members who read the directory see the names.
    const t = (await list<Task>('tasks', admin)).find(x => x.id === task.id)!;
    expect(t.company?.name).toBe(COMPANY);
    expect(t.contact?.name).toBe(PERSON);
    const ns = await list<Note>('notes', admin);
    expect(ns.find(x => x.id === notes.offer.id)?.ref?.label).toBe(OFFER);
  });

  it('activity labels of notes never name a company, an offer or a person', async () => {
    const items = (
      await json<ListResponse<ActivityEntry>>(
        await h.request(
          'GET',
          `/organizations/${h.org.id}/activity?limit=100`,
          {token: guest},
        ),
      )
    ).items;
    const labels = items
      .filter(e => e.entityType === 'note')
      .map(e => e.entityLabel);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Incidencia · Empresa',
        'Incidencia · Oferta del catálogo',
      ]),
    );
    const text = JSON.stringify(items);
    for (const name of [COMPANY, OFFER, PERSON]) {
      expect(text).not.toContain(name);
    }
  });

  it('the shared withholding (device cache too) applies the same names, and keeps them for members', () => {
    const t = {company: {id: 'c', name: COMPANY}, contact: null, notes: 'x'};
    expect(withholdFor('task', t, 'guest').company).toEqual({
      id: 'c',
      name: 'Empresa',
    });
    expect(withholdFor('task', t, 'member', false).company?.name).toBe(
      'Empresa',
    );
    expect(withholdFor('task', t, 'member').company?.name).toBe(COMPANY);
    const n = {ref: {type: 'task', id: 't', label: 'Montaje'}, text: 'x'};
    expect(withholdFor('note', n, 'guest').ref.label).toBe('Montaje');
  });
});
