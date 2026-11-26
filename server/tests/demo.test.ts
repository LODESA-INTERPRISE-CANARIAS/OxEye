import {describe, expect, it} from 'vitest';
import {clearDemo} from '../src/demo/service.ts';
import {DEMO_TASKS} from '../src/seed/seed.ts';
import {createHarness, json} from './helpers.ts';
import type {
  ActivityEntry,
  Company,
  ListResponse,
  LogisticsEvent,
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
    // Demo tasks, the event, two venues and one company.
    expect(await json(res)).toEqual({removed: DEMO_TASKS.length + 4});

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
    // Everything demo except the venue: tasks, event, warehouse, company.
    expect(result).toEqual({removed: DEMO_TASKS.length + 3});
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
