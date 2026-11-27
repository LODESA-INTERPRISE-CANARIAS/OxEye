import {expect, test, type Page} from '@playwright/test';
import {
  DIRECTORY_REF_LABEL,
  WITHHELD_FROM_GUESTS,
} from '../../../shared/logistics/redaction.ts';
import {
  MOCK_DIRECTORY_REF_LABEL,
  MOCK_WITHHELD,
  ORG,
  TOKEN,
  makeActivity,
  makeContact,
  mockApi,
  signIn,
} from './mock-api';

/**
 * The E2E mock against the M6 contract: its hand-written guest withholding
 * equals the shared list, device ids replay safely, `…/changes` hands out
 * cursors, and the activity range answers the day close. These keep the
 * behavioural specs honest: a mock that drifted from the server would let
 * them pass against something the server never does.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

const DEVICE_ID = '6f1c1a52-1d2b-4c8e-9a3f-0b5d7e2c4a10';

/** One API call from the page (so the mock's route handles it). */
async function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{status: number; json: Record<string, unknown> | null}> {
  return page.evaluate(
    async ({method, path, body, token}) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return {status: res.status, json: text ? JSON.parse(text) : null};
    },
    {method, path, body, token: TOKEN},
  );
}

test.describe('Gestor logístico · el mock sigue el contrato M6', () => {
  test('guest withholding is the shared WITHHELD_FROM_GUESTS', () => {
    const norm = (o: Record<string, readonly string[]>) =>
      Object.fromEntries(
        Object.entries(o)
          .map(([k, v]) => [k, [...v].sort()] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    expect(norm(MOCK_WITHHELD)).toEqual(norm(WITHHELD_FROM_GUESTS));
    // Safety audit: the generic directory names too.
    expect(MOCK_DIRECTORY_REF_LABEL).toEqual(DIRECTORY_REF_LABEL);
  });

  test('device ids: 201, the same user again is 200 without a duplicate, anyone else is 400', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      contacts: [
        makeContact('7d3e2b10-0a4f-4c1e-8b2d-9e6f5a4c3b21', 'Persona Prueba', {
          createdBy: {id: 'u-dailos', displayName: 'Dailos'},
        }),
      ],
    });
    await signIn(page);
    const body = {organizationId: ORG, id: DEVICE_ID, name: 'Recurso Prueba'};
    const first = await call(page, 'POST', '/resources', body);
    expect(first.status).toBe(201);
    expect(first.json?.id).toBe(DEVICE_ID);
    const activity = api.activity.length;

    const again = await call(page, 'POST', '/resources', {
      ...body,
      name: 'Otro nombre',
    });
    expect(again.status).toBe(200);
    // The record as it is: the replay changes nothing.
    expect(again.json?.name).toBe('Recurso Prueba');
    expect(api.resources.filter(r => r.id === DEVICE_ID)).toHaveLength(1);
    expect(api.activity).toHaveLength(activity);

    // Another user's record with that id: 400 `fields.id`, nothing revealed.
    const taken = await call(page, 'POST', '/contacts', {
      organizationId: ORG,
      id: '7d3e2b10-0a4f-4c1e-8b2d-9e6f5a4c3b21',
      name: 'Persona Prueba',
    });
    expect(taken.status).toBe(400);
    expect(taken.json).toMatchObject({
      code: 'VALIDATION',
      fields: {id: expect.any(String)},
    });
    expect(JSON.stringify(taken.json)).not.toContain('Dailos');
  });

  test('…/changes: full without or with an unknown cursor, then the types written', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    const path = `/organizations/${ORG}/changes`;
    const fresh = await call(page, 'GET', path);
    expect(fresh.json).toMatchObject({full: true, types: []});
    const cursor = fresh.json?.cursor as string;
    expect(cursor).toMatch(/^\d+$/);

    const none = await call(page, 'GET', `${path}?since=${cursor}`);
    expect(none.json).toMatchObject({full: false, types: []});

    // Another person changes an event behind the device's back.
    api.editOnServer('e1', {name: 'Navidad en la Plaza del Cristo (cambio)'});
    const changed = await call(
      page,
      'GET',
      `${path}?since=${none.json?.cursor as string}`,
    );
    expect(changed.json).toMatchObject({full: false, types: ['event']});

    for (const bad of ['abc', '-1', '01', '999999']) {
      const res = await call(page, 'GET', `${path}?since=${bad}`);
      expect(res.json, bad).toMatchObject({full: true});
    }
  });

  test('activity range: from ≤ at < to, newest first, and the contract 400s', async ({
    page,
  }) => {
    const entity = {type: 'resource', id: 'r1', label: 'Carpa Prueba'};
    await mockApi(page, {
      activity: [
        makeActivity('a1', entity, 'create', '2026-12-01T23:59:59.000Z'),
        makeActivity('a2', entity, 'update', '2026-12-02T00:00:00.000Z'),
        makeActivity('a3', entity, 'update', '2026-12-02T18:00:00.000Z'),
        makeActivity('a4', entity, 'update', '2026-12-03T00:00:00.000Z'),
      ],
    });
    await signIn(page);
    const base = `/organizations/${ORG}/activity`;
    const day = await call(
      page,
      'GET',
      `${base}?from=2026-12-02T00:00:00.000Z&to=2026-12-03T00:00:00.000Z`,
    );
    expect((day.json?.items as {id: string}[]).map(a => a.id)).toEqual([
      'a3',
      'a2',
    ]);

    const cases: [string, string][] = [
      ['?from=2026-12-02T00:00:00.000Z', 'to'],
      ['?from=2026-12-02T00:00&to=2026-12-03T00:00:00.000Z', 'from'],
      ['?from=2026-12-03T00:00:00.000Z&to=2026-12-02T00:00:00.000Z', 'to'],
      ['?from=2026-11-01T00:00:00.000Z&to=2026-12-02T00:00:00.000Z', 'to'],
      [
        '?from=2026-12-02T00:00:00.000Z&to=2026-12-03T00:00:00.000Z&entityType=resource&entityId=r1',
        'from',
      ],
    ];
    for (const [query, field] of cases) {
      const res = await call(page, 'GET', `${base}${query}`);
      expect(res.status, query).toBe(400);
      expect(Object.keys(res.json?.fields as object), query).toEqual([field]);
    }
  });
});
