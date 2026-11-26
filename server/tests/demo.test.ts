import {describe, expect, it} from 'vitest';
import {clearDemo} from '../src/demo/service.ts';
import {
  DEMO_COMPANIES,
  DEMO_CONTACTS,
  DEMO_OFFERS,
  DEMO_TASKS,
} from '../src/seed/seed.ts';
import {createHarness, json} from './helpers.ts';
import type {
  ActivityEntry,
  Category,
  Company,
  Contact,
  ListResponse,
  LogisticsEvent,
  Offer,
  Task,
  Venue,
} from '../../shared/logistics/contracts.ts';

describe('demo data', () => {
  it('DELETE /demo removes demo event, venue and their activity, and logs the removal', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const real = await json<LogisticsEvent>(
      await h.request('POST', '/events', {
        token,
        body: {
          organizationId: h.org.id,
          name: 'Evento real',
          venueName: 'Plaza de la Concepción',
        },
      }),
    );

    const res = await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
      token,
    });
    expect(res.status).toBe(200);
    // Demo tasks, offers, contacts, the event, two venues and the companies.
    expect(await json(res)).toEqual({
      removed:
        DEMO_TASKS.length +
        DEMO_OFFERS.length +
        DEMO_CONTACTS.length +
        DEMO_COMPANIES.length +
        3,
    });

    const tasks = await json<ListResponse<Task>>(
      await h.request('GET', `/organizations/${h.org.id}/tasks`, {token}),
    );
    expect(tasks.items).toEqual([]);
    const companies = await json<ListResponse<Company>>(
      await h.request('GET', `/organizations/${h.org.id}/companies`, {token}),
    );
    expect(companies.items).toEqual([]);

    const events = await json<ListResponse<LogisticsEvent>>(
      await h.request('GET', `/organizations/${h.org.id}/events`, {token}),
    );
    expect(events.items.map(e => e.id)).toEqual([real.id]);

    const venues = await json<ListResponse<Venue>>(
      await h.request('GET', `/organizations/${h.org.id}/venues`, {token}),
    );
    expect(venues.items.map(v => v.name)).toEqual(['Plaza de la Concepción']);

    const activity = await json<ListResponse<ActivityEntry>>(
      await h.request('GET', `/organizations/${h.org.id}/activity`, {token}),
    );
    expect(activity.items[0]).toMatchObject({
      entityType: 'demo',
      action: 'delete',
      entityLabel: 'Datos de demostración',
      user: {displayName: 'Elvis'},
    });
    expect(
      activity.items.some(
        a =>
          a.entityLabel === 'Navidad en la Plaza del Cristo' ||
          a.entityLabel === 'Montaje del escenario',
      ),
    ).toBe(false);

    // Second call: nothing left, nothing logged.
    const again = await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
      token,
    });
    expect(await json(again)).toEqual({removed: 0});
    await h.db.close();
  });

  it('keeps a demo venue that real events use', async () => {
    const h = await createHarness();
    // Simulate a demo venue referenced by a real event without promotion.
    const [venue] = await h.db.query<{id: string}>(
      "SELECT id FROM venues WHERE name = 'Plaza del Cristo'",
    );
    const [user] = await h.db.query<{id: string}>(
      "SELECT id FROM users WHERE display_name = 'Elvis'",
    );
    await h.db.query(
      `INSERT INTO events (organization_id, name, venue_id, created_by, updated_by)
       VALUES ($1, 'Real', $2, $3, $3)`,
      [h.org.id, venue!.id, user!.id],
    );
    const result = await clearDemo(h.db, {
      organizationId: null,
      actorId: null,
      now: h.clock.now(),
    });
    // Everything demo except the venue: tasks, offers, contacts, event,
    // warehouse and companies.
    expect(result).toEqual({
      removed:
        DEMO_TASKS.length +
        DEMO_OFFERS.length +
        DEMO_CONTACTS.length +
        DEMO_COMPANIES.length +
        2,
    });
    const left = await h.db.query(
      "SELECT 1 FROM venues WHERE name = 'Plaza del Cristo'",
    );
    expect(left).toHaveLength(1);
    await h.db.close();
  });

  it('keeps real tasks: they lose demo links with a new version, and a demo company they use stays', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const demoTasks = await json<ListResponse<Task>>(
      await h.request('GET', `/organizations/${h.org.id}/tasks`, {token}),
    );
    const stage = demoTasks.items.find(
      t => t.title === 'Montaje del escenario',
    );
    expect(stage?.isDemo).toBe(true);

    const real = await json<Task>(
      await h.request('POST', '/tasks', {
        token,
        body: {
          organizationId: h.org.id,
          title: 'Revisión de anclajes',
          eventId: stage!.eventId,
          companyName: 'escenarios demo',
          dependsOn: [stage!.id],
        },
      }),
    );
    expect(real.isDemo).toBe(false);
    expect(real.company?.name).toBe('Escenarios Demo');

    // Another member removes the demo later.
    const yeray = await h.login('Yeray');
    h.clock.advance(3_600_000);
    await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
      token: yeray.token,
    });

    const after = await json<ListResponse<Task>>(
      await h.request('GET', `/organizations/${h.org.id}/tasks`, {token}),
    );
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({
      id: real.id,
      eventId: null,
      dependsOn: [],
      version: real.version + 1,
      company: {name: 'Escenarios Demo'},
      updatedBy: {displayName: 'Yeray'},
      updatedAt: h.clock.now().toISOString(),
    });

    // The change is visible in the activity, right before the removal.
    const activity = await json<ListResponse<ActivityEntry>>(
      await h.request('GET', `/organizations/${h.org.id}/activity`, {token}),
    );
    expect(activity.items.slice(0, 2)).toMatchObject([
      {entityType: 'demo', action: 'delete', user: {displayName: 'Yeray'}},
      {
        entityType: 'task',
        entityId: real.id,
        entityLabel: 'Revisión de anclajes',
        action: 'update',
        changedFields: ['eventId', 'dependsOn'],
        user: {displayName: 'Yeray'},
        at: h.clock.now().toISOString(),
      },
    ]);
    const companies = await json<ListResponse<Company>>(
      await h.request('GET', `/organizations/${h.org.id}/companies`, {token}),
    );
    expect(companies.items.map(c => [c.name, c.isDemo])).toEqual([
      ['Escenarios Demo', false],
    ]);
    await h.db.close();
  });

  it('seeds fictitious companies, people and offers that show every catalogue case', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const get = async <T>(what: string) =>
      (
        await json<ListResponse<T>>(
          await h.request('GET', `/organizations/${h.org.id}/${what}`, {
            token,
          }),
        )
      ).items;
    const categories = await get<Category>('categories');
    const nameOf = new Map(categories.map(c => [c.id, c.name]));
    const companies = await get<Company>('companies');
    const contacts = await get<Contact>('contacts');
    const offers = await get<Offer>('offers');
    const tasks = await get<Task>('tasks');

    expect(companies.map(c => [c.name, c.kind, c.isDemo]).sort()).toEqual(
      DEMO_COMPANIES.map(c => [c.name, c.kind, true]).sort(),
    );
    const stageCo = companies.find(c => c.name === 'Escenarios Demo')!;
    expect(stageCo.categoryIds.map(id => nameOf.get(id))).toEqual([
      'Montaje',
      'Estructuras',
      'Carpas',
      'Sonido',
    ]);
    const ana = contacts.find(c => c.name === 'Ana Demo')!;
    expect(stageCo.mainContactId).toBe(ana.id);
    const events = await get<LogisticsEvent>('events');
    const marta = contacts.find(c => c.name === 'Marta Demo')!;
    expect(marta.eventIds).toEqual([events[0]!.id]);
    expect(
      tasks.find(t => t.title === 'Montaje del escenario')?.contact?.id,
    ).toBe(ana.id);

    // Safety: obviously fictitious people, never-assigned numbers, example.com.
    expect(contacts.every(c => c.isDemo && /Demo$/.test(c.name))).toBe(true);
    expect(
      contacts.every(
        c => c.phone === null || /^\+34 000 000 00\d$/.test(c.phone),
      ),
    ).toBe(true);
    expect(
      contacts.every(c => c.email === null || c.email.endsWith('@example.com')),
    ).toBe(true);

    // The catalogue cases the UI must show honestly.
    expect(offers).toHaveLength(DEMO_OFFERS.length);
    expect(offers.every(o => o.isDemo)).toBe(true);
    expect(offers.some(o => o.unit === 'day' && o.price !== null)).toBe(true);
    expect(offers.some(o => o.price === null)).toBe(true);
    expect(offers.some(o => o.unit === 'custom' && o.customUnit === null)).toBe(
      true,
    );
    expect(
      offers.some(o => o.transportCost === null && o.assemblyCost !== null),
    ).toBe(true);
    expect(offers.some(o => o.vatIncluded === null)).toBe(true);
    expect(offers.some(o => o.price === 0)).toBe(true);
    // Billing units only: nothing about weight, and the demo tasks' heavy-load
    // answers are exactly the seeded ones.
    expect(offers.some(o => /kg/i.test(`${o.customUnit} ${o.name}`))).toBe(
      false,
    );
    expect(
      Object.fromEntries(
        tasks.filter(t => t.isDemo).map(t => [t.title, t.heavyLoad]),
      ),
    ).toEqual(Object.fromEntries(DEMO_TASKS.map(t => [t.title, t.heavyLoad])));
    await h.db.close();
  });

  it('removal deletes demo people and offers; real records that lose a demo link get a new version and activity', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const get = async <T>(what: string) =>
      (
        await json<ListResponse<T>>(
          await h.request('GET', `/organizations/${h.org.id}/${what}`, {
            token,
          }),
        )
      ).items;
    const events = await get<LogisticsEvent>('events');
    const ana = (await get<Contact>('contacts')).find(
      c => c.name === 'Ana Demo',
    )!;
    // A real person linked to the demo event.
    const real = await json<Contact>(
      await h.request('POST', '/contacts', {
        token,
        body: {
          organizationId: h.org.id,
          name: 'Persona real',
          eventIds: [events[0]!.id],
        },
      }),
    );
    // A real company and task still pointing at a demo person (only possible
    // without the API, which promotes; the removal must cope anyway).
    const company = await json<Company>(
      await h.request('POST', '/companies', {
        token,
        body: {organizationId: h.org.id, name: 'Empresa real'},
      }),
    );
    const task = await json<Task>(
      await h.request('POST', '/tasks', {
        token,
        body: {organizationId: h.org.id, title: 'Tarea real'},
      }),
    );
    await h.db.query(
      'UPDATE companies SET main_contact_id = $2 WHERE id = $1',
      [company.id, ana.id],
    );
    await h.db.query('UPDATE tasks SET contact_id = $2 WHERE id = $1', [
      task.id,
      ana.id,
    ]);

    const yeray = await h.login('Yeray');
    h.clock.advance(3_600_000);
    expect(
      (
        await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
          token: yeray.token,
        })
      ).status,
    ).toBe(200);

    expect((await get<Offer>('offers')).length).toBe(0);
    const contacts = await get<Contact>('contacts');
    expect(contacts.map(c => c.name)).toEqual(['Persona real']);
    const touched = {
      updatedBy: {displayName: 'Yeray'},
      updatedAt: h.clock.now().toISOString(),
    };
    expect(contacts[0]).toMatchObject({
      eventIds: [],
      version: real.version + 1,
      ...touched,
    });
    expect(
      (await get<Company>('companies')).find(c => c.id === company.id),
    ).toMatchObject({mainContactId: null, version: 2, ...touched});
    expect(
      (await get<Task>('tasks')).find(t => t.id === task.id),
    ).toMatchObject({contact: null, version: 2, ...touched});
    const activity = await json<ListResponse<ActivityEntry>>(
      await h.request('GET', `/organizations/${h.org.id}/activity`, {token}),
    );
    expect(
      activity.items
        .slice(0, 4)
        .map(a => [a.entityType, a.entityLabel, a.changedFields]),
    ).toEqual([
      ['demo', 'Datos de demostración', []],
      ['task', 'Tarea real', ['contact']],
      ['contact', 'Persona real', ['eventIds']],
      ['company', 'Empresa real', ['mainContactId']],
    ]);
    // Built-in categories are not demo data: they stay.
    expect((await get<Category>('categories')).length).toBeGreaterThan(0);
    await h.db.close();
  });

  it('a demo person made real by a real task survives the removal, with their company', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const contacts = await json<ListResponse<Contact>>(
      await h.request('GET', `/organizations/${h.org.id}/contacts`, {token}),
    );
    const ana = contacts.items.find(c => c.name === 'Ana Demo')!;
    await h.request('POST', '/tasks', {
      token,
      body: {
        organizationId: h.org.id,
        title: 'Llamar a Ana',
        contactId: ana.id,
      },
    });
    await h.request('DELETE', `/organizations/${h.org.id}/demo`, {token});
    const after = await json<ListResponse<Contact>>(
      await h.request('GET', `/organizations/${h.org.id}/contacts`, {token}),
    );
    expect(after.items.map(c => [c.name, c.isDemo])).toEqual([
      ['Ana Demo', false],
    ]);
    const companies = await json<ListResponse<Company>>(
      await h.request('GET', `/organizations/${h.org.id}/companies`, {token}),
    );
    expect(companies.items.map(c => [c.name, c.isDemo, c.offerCount])).toEqual([
      ['Escenarios Demo', false, 0],
    ]);
    await h.db.close();
  });

  it('from the command line, «Sistema» signs the bumped real tasks and the removal', async () => {
    const h = await createHarness();
    const {token} = await h.login('Elvis');
    const demoTasks = await json<ListResponse<Task>>(
      await h.request('GET', `/organizations/${h.org.id}/tasks`, {token}),
    );
    const stage = demoTasks.items.find(
      t => t.title === 'Montaje del escenario',
    )!;
    // No event, only a demo predecessor.
    const real = await json<Task>(
      await h.request('POST', '/tasks', {
        token,
        body: {
          organizationId: h.org.id,
          title: 'Revisión de anclajes',
          dependsOn: [stage.id],
        },
      }),
    );

    await clearDemo(h.db, {
      organizationId: null,
      actorId: null,
      now: h.clock.now(),
    });

    const after = await json<ListResponse<Task>>(
      await h.request('GET', `/organizations/${h.org.id}/tasks`, {token}),
    );
    expect(after.items[0]).toMatchObject({
      id: real.id,
      dependsOn: [],
      version: real.version + 1,
      updatedBy: {displayName: 'Sistema'},
    });
    const activity = await json<ListResponse<ActivityEntry>>(
      await h.request('GET', `/organizations/${h.org.id}/activity`, {token}),
    );
    expect(activity.items.slice(0, 2)).toMatchObject([
      {entityType: 'demo', action: 'delete', user: {displayName: 'Sistema'}},
      {
        entityId: real.id,
        action: 'update',
        changedFields: ['dependsOn'],
        user: {displayName: 'Sistema'},
      },
    ]);
    await h.db.close();
  });
});
