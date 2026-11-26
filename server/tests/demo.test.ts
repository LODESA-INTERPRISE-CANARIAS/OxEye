import {describe, expect, it} from 'vitest';
import {clearDemo} from '../src/demo/service.ts';
import {createHarness, json} from './helpers.ts';
import type {
  ActivityEntry,
  ListResponse,
  LogisticsEvent,
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
    expect(await json(res)).toEqual({removed: 2});

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
        a => a.entityLabel === 'Navidad en la Plaza del Cristo',
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
    expect(result).toEqual({removed: 1});
    const left = await h.db.query(
      "SELECT 1 FROM venues WHERE name = 'Plaza del Cristo'",
    );
    expect(left).toHaveLength(1);
    await h.db.close();
  });
});
