/**
 * Safety audit: a change made in a support session is signed with the
 * account's owner and the administrator behind the session (migration 0012),
 * in the activity log and on «Mantener ambas»; a normal session of the same
 * account signs alone.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {createHarness, json, passwordFor} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {planWarnings} from '../../shared/logistics/conflicts.ts';
import {signatureLabel} from '../../shared/logistics/history.ts';
import type {
  ActivityEntry,
  ConflictAcceptance,
  ListResponse,
  SupportSessionResponse,
  Task,
} from '../../shared/logistics/contracts.ts';

let h: Harness;
let elvis: string;
let equipo: string;
let support: string;

async function post<T>(token: string, path: string, body: object): Promise<T> {
  const res = await h.request('POST', path, {token, body});
  expect(res.status, path).toBeLessThan(300);
  return json<T>(res);
}

const activity = async (token: string) =>
  (
    await json<ListResponse<ActivityEntry>>(
      await h.request('GET', `/organizations/${h.org.id}/activity?limit=100`, {
        token,
      }),
    )
  ).items;

beforeAll(async () => {
  h = await createHarness();
  await h.db.query(
    `UPDATE users SET password_provisional = false
      WHERE username IN ('Elvis', 'Equipo')`,
  );
  elvis = (await h.login('Elvis')).token;
  equipo = (await h.login('Equipo')).token;
  const [target] = await h.db.query<{id: string}>(
    "SELECT id FROM users WHERE username = 'Equipo'",
  );
  const res = await h.request('POST', '/admin/support-sessions', {
    token: elvis,
    body: {
      userId: target!.id,
      reason: 'Revisar una tarea que no se guarda',
      password: passwordFor('Elvis'),
      minutes: 15,
    },
  });
  expect(res.status).toBe(201);
  support = (await json<SupportSessionResponse>(res)).token;
});

describe('support attribution', () => {
  it('signs activity written in a support session with the administrator behind it', async () => {
    const own = await post<Task>(equipo, '/tasks', {
      organizationId: h.org.id,
      title: 'Tarea propia Prueba',
    });
    const helped = await post<Task>(support, '/tasks', {
      organizationId: h.org.id,
      title: 'Tarea con soporte Prueba',
    });
    const items = await activity(elvis);
    const ownEntry = items.find(e => e.entityId === own.id)!;
    const helpedEntry = items.find(e => e.entityId === helped.id)!;
    expect(ownEntry.user.displayName).toBe('Equipo');
    expect(ownEntry.supportBy).toBeUndefined();
    expect(helpedEntry.user.displayName).toBe('Equipo');
    expect(helpedEntry.supportBy).toMatchObject({displayName: 'Elvis'});
    expect(signatureLabel(helpedEntry.user, helpedEntry.supportBy)).toBe(
      'Equipo (soporte: Elvis)',
    );
    expect(signatureLabel(ownEntry.user, ownEntry.supportBy)).toBe('Equipo');

    // The record's own history says the same.
    const history = await json<ListResponse<ActivityEntry>>(
      await h.request(
        'GET',
        `/organizations/${h.org.id}/activity?entityType=task&entityId=${helped.id}`,
        {token: equipo},
      ),
    );
    expect(history.items[0]?.supportBy?.displayName).toBe('Elvis');

    // Updates and deletes too, from any service.
    const patched = await h.request('PATCH', `/tasks/${helped.id}`, {
      token: support,
      body: {version: helped.version, status: 'confirmed'},
    });
    expect(patched.status).toBe(200);
    const [update] = (await activity(elvis)).filter(
      e => e.entityId === helped.id && e.action === 'update',
    );
    expect(update?.supportBy?.displayName).toBe('Elvis');
    const [row] = await h.db.query<{n: number}>(
      `SELECT count(*)::int AS n FROM activity_log
        WHERE entity_id = $1 AND support_by IS NOT NULL`,
      [helped.id],
    );
    expect(row?.n).toBe(2);
  });

  it('signs «Mantener ambas» accepted in a support session', async () => {
    const slot = {
      organizationId: h.org.id,
      venueName: 'Plaza Prueba Soporte',
      date: '2026-12-21',
      startTime: '09:00',
      endTime: '11:00',
    };
    const a = await post<Task>(equipo, '/tasks', {title: 'Carpa S1', ...slot});
    const b = await post<Task>(equipo, '/tasks', {
      title: 'Carpa S2',
      ...slot,
      startTime: '10:00',
      endTime: '12:00',
    });
    const all = (
      await json<ListResponse<Task>>(
        await h.request('GET', `/organizations/${h.org.id}/tasks`, {
          token: equipo,
        }),
      )
    ).items;
    const warning = planWarnings(all).find(
      w => w.taskIds.includes(a.id) && w.taskIds.includes(b.id),
    )!;
    expect(warning).toBeTruthy();
    const created = await post<ConflictAcceptance>(
      support,
      '/conflict-acceptances',
      {
        organizationId: h.org.id,
        warningKey: warning.key,
        windows: [a, b].map(t => ({
          taskId: t.id,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
        })),
        reason: 'Comparten la carpa',
      },
    );
    expect(created.acceptedBy.displayName).toBe('Equipo');
    expect(created.acceptedBySupport?.displayName).toBe('Elvis');
    const listed = (
      await json<ListResponse<ConflictAcceptance>>(
        await h.request(
          'GET',
          `/organizations/${h.org.id}/conflict-acceptances`,
          {token: equipo},
        ),
      )
    ).items.find(x => x.id === created.id);
    expect(listed?.acceptedBySupport?.displayName).toBe('Elvis');
    const entry = (await activity(elvis)).find(e => e.entityId === created.id);
    expect(entry?.supportBy?.displayName).toBe('Elvis');
  });
});
