/**
 * Revisión 1 · E5: taxes per company and offer, event budgets and expenses.
 * Migration 0010 from a 0009 database with data, tax inheritance and
 * override, old offers untouched, budget access per role (administrator,
 * developer read-only, team, guest, provisional password), snapshots that
 * never change, activity without amounts, `/changes` privacy, and what
 * deleting a company or the demo does to expenses.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createPgliteDb} from '../src/db/pglite.ts';
import {migrate, readMigrations} from '../src/db/migrate.ts';
import {createHarness, json, passwordFor} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {seed} from '../src/seed/seed.ts';
import {DEMO_BUDGET_AMOUNT, DEMO_EXPENSES} from '../src/seed/demo-budget.ts';
import {
  NO_ACCESS,
  PROVISIONAL_HOLD,
} from '../../shared/logistics/permissions.ts';
import type {
  ActivityEntry,
  ApiErrorBody,
  BudgetSummary,
  ChangesResponse,
  Company,
  EventBudget,
  EventBudgetResponse,
  Expense,
  ListResponse,
  LogisticsEvent,
  Offer,
} from '../../shared/logistics/contracts.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, {recursive: true, force: true});
});

describe('migration 0010', () => {
  it('applies on top of a 0009 database with data: old offers keep vat_included and get no tax', async () => {
    const all = readMigrations();
    const at = all.findIndex(m => m.file === '0010_money.sql');
    expect(at).toBe(9);
    const dir = mkdtempSync(join(tmpdir(), 'oxeye-money-'));
    tempDirs.push(dir);
    for (const m of all.slice(0, at)) writeFileSync(join(dir, m.file), m.sql);
    const db = await createPgliteDb();
    expect((await migrate(db, {dir})).applied).toHaveLength(9);

    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (username, display_name, role, password_hash)
       VALUES ('Elvis', 'Elvis', 'member', 'scrypt$1$1$1$a$b') RETURNING id`,
    );
    const u = user!.id;
    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org Prueba') RETURNING id",
    );
    const o = org!.id;
    const [company] = await db.query<{id: string}>(
      `INSERT INTO companies (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Carpas Demo', $2, $2) RETURNING id`,
      [o, u],
    );
    const c = company!.id;
    for (const [name, vat] of [
      ['Incluido', true],
      ['Sin impuestos', false],
      ['Sin saber', null],
    ] as const) {
      await db.query(
        `INSERT INTO offers (organization_id, company_id, name, price, vat_included,
                             created_by, updated_by)
         VALUES ($1, $2, $3, 100, $4, $5, $5)`,
        [o, c, name, vat, u],
      );
    }
    const [event] = await db.query<{id: string}>(
      `INSERT INTO events (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Fiesta Prueba', $2, $2) RETURNING id`,
      [o, u],
    );
    const e = event!.id;

    writeFileSync(join(dir, all[at]!.file), all[at]!.sql);
    expect((await migrate(db, {dir})).applied).toEqual(['0010_money.sql']);

    // Nothing invented: no tax anywhere, vat_included exactly as it was.
    expect(
      await db.query(
        `SELECT name, vat_included, tax_regime, tax_rate, tax_verification
           FROM offers ORDER BY name`,
      ),
    ).toEqual([
      {
        name: 'Incluido',
        vat_included: true,
        tax_regime: null,
        tax_rate: null,
        tax_verification: null,
      },
      {
        name: 'Sin impuestos',
        vat_included: false,
        tax_regime: null,
        tax_rate: null,
        tax_verification: null,
      },
      {
        name: 'Sin saber',
        vat_included: null,
        tax_regime: null,
        tax_rate: null,
        tax_verification: null,
      },
    ]);
    expect(
      await db.query('SELECT tax_regime, tax_name FROM companies'),
    ).toEqual([{tax_regime: null, tax_name: null}]);

    // Valid new data.
    await db.query(
      `UPDATE companies SET tax_regime = 'igic', tax_rate = 7,
              tax_verification = 'to_verify' WHERE id = $1`,
      [c],
    );
    await db.query(
      `UPDATE offers SET tax_regime = 'other', tax_name = 'IPSI', tax_rate = 4,
              tax_verification = 'validated' WHERE name = 'Incluido'`,
    );
    await db.query(
      `INSERT INTO event_budgets (event_id, organization_id, amount, updated_by)
       VALUES ($1, $2, 20000, $3)`,
      [e, o, u],
    );
    await db.query(
      `INSERT INTO expenses (organization_id, event_id, concept, company_id,
                             company_name, amount, tax_regime, tax_rate,
                             tax_verification, created_by, updated_by)
       VALUES ($1, $2, 'Carpas', $3, 'Carpas Demo', 1500, 'none', 0,
               'to_verify', $4, $4)`,
      [o, e, c, u],
    );

    const bad = [
      // A tax needs its verification; «otro» needs a name and only «otro» has one.
      `UPDATE companies SET tax_verification = NULL WHERE id = '${c}'`,
      `UPDATE companies SET tax_regime = 'other' WHERE id = '${c}'`,
      `UPDATE companies SET tax_name = 'IGIC' WHERE id = '${c}'`,
      // «Ninguno» is 0 %, «sin saber» has no rate, 0–100 only.
      `UPDATE offers SET tax_regime = 'none', tax_name = NULL, tax_rate = 7
        WHERE name = 'Incluido'`,
      `UPDATE offers SET tax_regime = 'unknown', tax_name = NULL, tax_rate = 7
        WHERE name = 'Incluido'`,
      "UPDATE offers SET tax_rate = 101 WHERE name = 'Incluido'",
      "UPDATE offers SET tax_regime = 'vat' WHERE name = 'Incluido'",
      // A rate without a regime.
      "UPDATE offers SET tax_rate = 7 WHERE name = 'Sin saber'",
      // Expenses: a concept, known statuses, a linked company has its name.
      "UPDATE expenses SET concept = ' '",
      "UPDATE expenses SET status = 'paid'",
      'UPDATE expenses SET company_name = NULL',
      'UPDATE expenses SET amount = -1',
      "UPDATE expenses SET offer_snapshot = '[1]'::jsonb",
      // One budget per event; never negative.
      `INSERT INTO event_budgets (event_id, organization_id, amount, updated_by)
       VALUES ('${e}', '${o}', 1, '${u}')`,
      'UPDATE event_budgets SET amount = -5',
      // A company with expenses cannot vanish without the API unlinking them.
      `DELETE FROM companies WHERE id = '${c}'`,
    ];
    for (const sql of bad) await expect(db.query(sql)).rejects.toThrow();

    // Deleting the event takes its budget and expenses with it.
    await db.query('DELETE FROM offers');
    await db.query('DELETE FROM events WHERE id = $1', [e]);
    expect(
      await db.query(
        `SELECT (SELECT count(*)::int FROM expenses) AS expenses,
                (SELECT count(*)::int FROM event_budgets) AS budgets`,
      ),
    ).toEqual([{expenses: 0, budgets: 0}]);
    await db.close();
  });
});

// ---------------------------------------------------------------- API

let h: Harness;
/** Administrator with a password of their own. */
let admin: string;
/** Developer only (reads budgets, never edits them). */
let developer: string;
/** The shared team account. */
let team: string;
let guest: string;
/** Administrator whose password is still provisional. */
let provisional: string;
let event: LogisticsEvent;

async function errorOf(res: Response, status: number): Promise<ApiErrorBody> {
  expect(res.status).toBe(status);
  return json<ApiErrorBody>(res);
}

const userId = async (username: string) =>
  (
    await h.db.query<{id: string}>(
      'SELECT id FROM users WHERE lower(username) = lower($1)',
      [username],
    )
  )[0]!.id;

async function post<T>(token: string, path: string, body: unknown) {
  const res = await h.request('POST', path, {token, body});
  expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(201);
  return json<T>(res);
}

beforeAll(async () => {
  h = await createHarness();
  // Own passwords for everyone but Dailos, who stays provisional.
  await h.db.query(
    `UPDATE users SET password_provisional = false
      WHERE username IN ('Elvis', 'Yeray', 'Equipo')`,
  );
  await h.db.query(
    `UPDATE organization_members SET roles = ARRAY['developer']
      WHERE user_id = $1`,
    [await userId('Yeray')],
  );
  admin = (await h.login('Elvis')).token;
  developer = (await h.login('Yeray')).token;
  team = (await h.login('Equipo')).token;
  guest = (await h.login('Invitado')).token;
  provisional = (await h.login('Dailos')).token;
  event = await post<LogisticsEvent>(admin, '/events', {
    organizationId: h.org.id,
    name: 'Fiestas de Prueba',
    date: '2026-12-05',
  });
});

describe('taxes on companies and offers', () => {
  it('prefills IGIC at 7 % «por verificar», never assumes a tax and validates the rest', async () => {
    const none = await post<Company>(admin, '/companies', {
      organizationId: h.org.id,
      name: 'Sin Impuesto Dicho Prueba',
    });
    expect(none.tax).toBeNull();

    const igic = await post<Company>(admin, '/companies', {
      organizationId: h.org.id,
      name: 'Carpas IGIC Prueba',
      tax: {regime: 'igic'},
    });
    expect(igic.tax).toEqual({
      regime: 'igic',
      name: null,
      ratePercent: 7,
      verification: 'to_verify',
    });

    const iva = await post<Company>(admin, '/companies', {
      organizationId: h.org.id,
      name: 'Sonido IVA Prueba',
      tax: {regime: 'iva', verification: 'validated'},
    });
    expect(iva.tax).toMatchObject({ratePercent: 21, verification: 'validated'});

    for (const [tax, field] of [
      [{regime: 'other'}, 'tax.name'],
      [{regime: 'none', ratePercent: 5}, 'tax.ratePercent'],
      [{regime: 'unknown', ratePercent: 7}, 'tax.ratePercent'],
      [{regime: 'igic', ratePercent: 7.123}, 'tax.ratePercent'],
      [{regime: 'vat'}, 'tax.regime'],
      [{regime: 'iva', verification: 'draft'}, 'tax.verification'],
    ] as const) {
      const res = await h.request('POST', '/companies', {
        token: admin,
        body: {organizationId: h.org.id, name: `Mal ${field} Prueba`, tax},
      });
      const err = await errorOf(res, 400);
      expect(err.fields, JSON.stringify(tax)).toHaveProperty([field]);
    }

    // Confirming it: a PATCH logs the field name, never the rate.
    const res = await h.request('PATCH', `/companies/${igic.id}`, {
      token: admin,
      body: {
        version: igic.version,
        tax: {regime: 'igic', ratePercent: 7, verification: 'validated'},
      },
    });
    expect(res.status).toBe(200);
    expect((await json<Company>(res)).tax?.verification).toBe('validated');
    const history = await json<ListResponse<ActivityEntry>>(
      await h.request(
        'GET',
        `/organizations/${h.org.id}/activity?entityType=company&entityId=${igic.id}`,
        {token: admin},
      ),
    );
    expect(history.items[0]?.changedFields).toEqual(['tax']);
  });

  it('offers inherit their company’s tax, may override it, and new ones are before tax', async () => {
    const company = await post<Company>(admin, '/companies', {
      organizationId: h.org.id,
      name: 'Vallas Herencia Prueba',
      tax: {regime: 'igic'},
    });
    const inherits = await post<Offer>(admin, '/offers', {
      organizationId: h.org.id,
      companyId: company.id,
      name: 'Valla estándar',
      price: 10,
    });
    expect(inherits.vatIncluded).toBe(false);
    expect(inherits.tax).toBeNull();
    expect(inherits.companyTax).toMatchObject({regime: 'igic', ratePercent: 7});

    const own = await post<Offer>(admin, '/offers', {
      organizationId: h.org.id,
      companyId: company.id,
      name: 'Valla importada',
      price: 12,
      tax: {regime: 'iva'},
      vatIncluded: null,
    });
    expect(own.tax).toMatchObject({regime: 'iva', ratePercent: 21});
    expect(own.vatIncluded).toBeNull();

    // The company's tax changes: the inheriting offer follows, the other not.
    await h.request('PATCH', `/companies/${company.id}`, {
      token: admin,
      body: {version: company.version, tax: {regime: 'none'}},
    });
    const offers = await json<ListResponse<Offer>>(
      await h.request('GET', `/organizations/${h.org.id}/offers`, {
        token: admin,
      }),
    );
    const byId = new Map(offers.items.map(o => [o.id, o]));
    expect(byId.get(inherits.id)?.companyTax?.regime).toBe('none');
    expect(byId.get(own.id)?.tax?.regime).toBe('iva');

    // Clearing the override goes back to inheriting.
    const cleared = await h.request('PATCH', `/offers/${own.id}`, {
      token: admin,
      body: {version: own.version, tax: null},
    });
    expect((await json<Offer>(cleared)).tax).toBeNull();
  });

  it('offers recorded before E5 keep their tax treatment untouched by unrelated edits', async () => {
    const seeded = await json<ListResponse<Offer>>(
      await h.request('GET', `/organizations/${h.org.id}/offers`, {
        token: admin,
      }),
    );
    const old = seeded.items.find(o => o.isDemo);
    expect(old).toBeDefined();
    expect(old!.tax).toBeNull();
    const before = old!.vatIncluded;
    const res = await h.request('PATCH', `/offers/${old!.id}`, {
      token: admin,
      body: {version: old!.version, description: 'Revisada'},
    });
    const after = await json<Offer>(res);
    expect(after.vatIncluded).toBe(before);
    expect(after.tax).toBeNull();
  });
});

describe('budget access', () => {
  it('administrators read and edit; developers only read; team, guests and provisional passwords get 403', async () => {
    const path = `/events/${event.id}/budget`;
    const overview = `/organizations/${h.org.id}/budgets`;
    for (const token of [admin, developer]) {
      expect((await h.request('GET', path, {token})).status).toBe(200);
      expect((await h.request('GET', overview, {token})).status).toBe(200);
    }
    const read = NO_ACCESS['budget.read'];
    const edit = NO_ACCESS['budget.edit'];
    for (const token of [team, guest]) {
      expect(
        (await errorOf(await h.request('GET', path, {token}), 403)).message,
      ).toBe(read);
      expect(
        (await errorOf(await h.request('GET', overview, {token}), 403)).message,
      ).toBe(read);
    }
    // Provisional: the UI asks for a new password instead of «Sin acceso».
    expect(
      (await errorOf(await h.request('GET', path, {token: provisional}), 403))
        .message,
    ).toBe(PROVISIONAL_HOLD);

    const put = (token: string) =>
      h.request('PUT', path, {token, body: {amount: 100, version: 0}});
    expect((await errorOf(await put(developer), 403)).message).toBe(edit);
    expect((await errorOf(await put(team), 403)).message).toBe(edit);
    expect((await put(guest)).status).toBe(403);
    expect((await put(provisional)).status).toBe(403);
    const expense = (token: string) =>
      h.request('POST', '/expenses', {
        token,
        body: {eventId: event.id, concept: 'Prueba'},
      });
    for (const token of [developer, team, guest, provisional]) {
      expect((await expense(token)).status).toBe(403);
    }
    // Nothing was written by any of them.
    const body = await json<EventBudgetResponse>(
      await h.request('GET', path, {token: admin}),
    );
    expect(body.budget.version).toBe(0);
    expect(body.expenses).toEqual([]);
  });

  it('an event of another organization or an unknown one is «not found»', async () => {
    const res = await h.request(
      'GET',
      '/events/00000000-0000-4000-8000-000000000000/budget',
      {token: admin},
    );
    expect(res.status).toBe(404);
    expect(
      (await h.request('GET', '/events/no-uuid/budget', {token: admin})).status,
    ).toBe(404);
  });
});

describe('budget and expenses', () => {
  it('sets the budget with optimistic concurrency (version 0 = not set yet)', async () => {
    const path = `/events/${event.id}/budget`;
    const first = await h.request('PUT', path, {
      token: admin,
      body: {amount: 20000, version: 0},
    });
    expect(first.status).toBe(200);
    const set = await json<EventBudget>(first);
    expect(set).toMatchObject({amount: 20000, version: 1});
    expect(set.updatedBy?.displayName).toBe('Elvis');

    const stale = await errorOf(
      await h.request('PUT', path, {
        token: admin,
        body: {amount: 1, version: 0},
      }),
      409,
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect((stale.current as EventBudget).amount).toBe(20000);

    const missing = await errorOf(
      await h.request('PUT', path, {token: admin, body: {version: 1}}),
      400,
    );
    expect(missing.fields).toHaveProperty('amount');
    const bad = await errorOf(
      await h.request('PUT', path, {
        token: admin,
        body: {amount: 10.555, version: 1},
      }),
      400,
    );
    expect(bad.fields).toHaveProperty('amount');
  });

  it('an expense from an offer copies it, and later offer edits never change the expense', async () => {
    const company = await post<Company>(admin, '/companies', {
      organizationId: h.org.id,
      name: 'Escenarios Copia Prueba',
      tax: {regime: 'igic', ratePercent: 7},
    });
    const offer = await post<Offer>(admin, '/offers', {
      organizationId: h.org.id,
      companyId: company.id,
      name: 'Escenario 8 × 6',
      price: 1070,
      vatIncluded: true,
      unit: 'day',
      transportCost: 150,
    });
    const expense = await post<Expense>(admin, '/expenses', {
      eventId: event.id,
      offerId: offer.id,
    });
    expect(expense).toMatchObject({
      concept: 'Escenario 8 × 6',
      company: {id: company.id, name: 'Escenarios Copia Prueba'},
      // The price includes 7 % IGIC: 1070 / 1.07.
      amount: 1000,
      tax: {regime: 'igic', ratePercent: 7, verification: 'to_verify'},
      status: 'planned',
    });
    expect(expense.snapshot).toMatchObject({
      offerId: offer.id,
      offerName: 'Escenario 8 × 6',
      companyName: 'Escenarios Copia Prueba',
      price: 1070,
      unit: 'day',
      vatIncluded: true,
      taxInherited: true,
      transportCost: 150,
      at: h.clock.now().toISOString(),
    });

    // Renegotiated: new price, own tax, new name; the company renamed.
    h.clock.advance(60_000);
    const changed = await h.request('PATCH', `/offers/${offer.id}`, {
      token: admin,
      body: {
        version: offer.version,
        price: 900,
        name: 'Escenario renegociado',
        tax: {regime: 'iva'},
      },
    });
    expect(changed.status).toBe(200);
    const after = await json<EventBudgetResponse>(
      await h.request('GET', `/events/${event.id}/budget`, {token: admin}),
    );
    const kept = after.expenses.find(e => e.id === expense.id)!;
    expect(kept.snapshot).toEqual(expense.snapshot);
    expect(kept.amount).toBe(1000);
    expect(kept.tax).toEqual(expense.tax);
    expect(kept.version).toBe(1);

    // Deleting the offer leaves the copy too.
    const fresh = await json<ListResponse<Offer>>(
      await h.request('GET', `/organizations/${h.org.id}/offers`, {
        token: admin,
      }),
    );
    const now = fresh.items.find(o => o.id === offer.id)!;
    expect(
      (
        await h.request(
          'DELETE',
          `/offers/${offer.id}?version=${now.version}`,
          {
            token: admin,
          },
        )
      ).status,
    ).toBe(204);
    const later = await json<EventBudgetResponse>(
      await h.request('GET', `/events/${event.id}/budget`, {token: admin}),
    );
    expect(later.expenses.find(e => e.id === expense.id)?.snapshot).toEqual(
      expense.snapshot,
    );
  });

  it('validates expenses and keeps the snapshot out of updates', async () => {
    const noConcept = await errorOf(
      await h.request('POST', '/expenses', {
        token: admin,
        body: {eventId: event.id},
      }),
      400,
    );
    expect(noConcept.fields).toHaveProperty('concept');
    const unknownCompany = await errorOf(
      await h.request('POST', '/expenses', {
        token: admin,
        body: {
          eventId: event.id,
          concept: 'Algo',
          companyId: '00000000-0000-4000-8000-000000000000',
        },
      }),
      400,
    );
    expect(unknownCompany.fields).toHaveProperty('companyId');
    const unknownOffer = await errorOf(
      await h.request('POST', '/expenses', {
        token: admin,
        body: {
          eventId: event.id,
          offerId: '00000000-0000-4000-8000-000000000000',
        },
      }),
      400,
    );
    expect(unknownOffer.fields).toHaveProperty('offerId');
    const badStatus = await errorOf(
      await h.request('POST', '/expenses', {
        token: admin,
        body: {eventId: event.id, concept: 'Algo', status: 'paid'},
      }),
      400,
    );
    expect(badStatus.fields).toHaveProperty('status');

    const created = await post<Expense>(admin, '/expenses', {
      eventId: event.id,
      concept: 'Limpieza',
      amount: 300,
    });
    expect(created.tax).toBeNull();
    expect(created.snapshot).toBeNull();
    const res = await h.request('PATCH', `/expenses/${created.id}`, {
      token: admin,
      body: {
        version: created.version,
        status: 'confirmed',
        offerId: '00000000-0000-4000-8000-000000000000',
        snapshot: {offerId: 'x'},
      },
    });
    const updated = await json<Expense>(res);
    expect(updated).toMatchObject({status: 'confirmed', version: 2});
    expect(updated.snapshot).toBeNull();

    const stale = await errorOf(
      await h.request('PATCH', `/expenses/${created.id}`, {
        token: admin,
        body: {version: 1, amount: 1},
      }),
      409,
    );
    expect((stale.current as Expense).version).toBe(2);
    expect(
      (
        await h.request('DELETE', `/expenses/${created.id}?version=1`, {
          token: admin,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.request('DELETE', `/expenses/${created.id}?version=2`, {
          token: admin,
        })
      ).status,
    ).toBe(204);
  });

  it('a device id makes a retried create a replay', async () => {
    const id = '7b0f6b4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    const body = {id, eventId: event.id, concept: 'Reintento', amount: 5};
    const first = await h.request('POST', '/expenses', {token: admin, body});
    expect(first.status).toBe(201);
    const again = await h.request('POST', '/expenses', {token: admin, body});
    expect(again.status).toBe(200);
    expect((await json<Expense>(again)).id).toBe(id);
    const del = await h.request('DELETE', `/expenses/${id}?version=1`, {
      token: admin,
    });
    expect(del.status).toBe(204);
  });

  it('sums planned and confirmed before and with tax, unknown amounts and taxes apart', async () => {
    const other = await post<LogisticsEvent>(admin, '/events', {
      organizationId: h.org.id,
      name: 'Sumas Prueba',
      date: '2026-12-10',
    });
    const add = (body: Record<string, unknown>) =>
      post<Expense>(admin, '/expenses', {eventId: other.id, ...body});
    await add({concept: 'A', amount: 100, tax: {regime: 'igic'}});
    await add({
      concept: 'B',
      amount: 200,
      tax: {regime: 'iva', verification: 'validated'},
      status: 'confirmed',
    });
    await add({concept: 'C', amount: null, tax: {regime: 'igic'}});
    await add({concept: 'D', amount: 50, tax: {regime: 'unknown'}});
    await add({concept: 'E', amount: 10});
    await h.request('PUT', `/events/${other.id}/budget`, {
      token: admin,
      body: {amount: 1000, version: 0},
    });

    const list = await json<ListResponse<BudgetSummary>>(
      await h.request('GET', `/organizations/${h.org.id}/budgets`, {
        token: developer,
      }),
    );
    const sum = list.items.find(s => s.eventId === other.id)!;
    expect(sum.amount).toBe(1000);
    expect(sum.planned).toEqual({
      count: 4,
      beforeTax: 160,
      withTax: 107,
      unknownAmount: 1,
      unknownTax: 2,
      taxToVerify: 1,
    });
    expect(sum.confirmed).toEqual({
      count: 1,
      beforeTax: 200,
      withTax: 242,
      unknownAmount: 0,
      unknownTax: 0,
      taxToVerify: 0,
    });
    expect(sum.total.withTax).toBe(349);
    expect(sum.remaining).toBe(651);
    expect(sum.incomplete).toBe(true);
    // Sorted like events: the first event (5 Dec) before this one (10 Dec).
    const order = list.items.map(s => s.eventId);
    expect(order.indexOf(event.id)).toBeLessThan(order.indexOf(other.id));
  });
});

describe('privacy of the budget in activity and /changes', () => {
  it('logs field names and concepts, never amounts, and hides it all from viewers without budget.read', async () => {
    const since = await json<ChangesResponse>(
      await h.request('GET', `/organizations/${h.org.id}/changes`, {
        token: admin,
      }),
    );
    h.clock.advance(10 * 60_000);
    const expense = await post<Expense>(admin, '/expenses', {
      eventId: event.id,
      concept: 'Generadores',
      amount: 4321.98,
    });
    await h.request('PATCH', `/expenses/${expense.id}`, {
      token: admin,
      body: {version: 1, amount: 5555.55},
    });

    const feed = (token: string) =>
      h.request('GET', `/organizations/${h.org.id}/activity?limit=100`, {
        token,
      });
    const adminFeed = await json<ListResponse<ActivityEntry>>(
      await feed(admin),
    );
    const mine = adminFeed.items.filter(e => e.entityId === expense.id);
    expect(mine.map(e => [e.action, e.changedFields])).toEqual([
      ['update', ['amount']],
      ['create', []],
    ]);
    expect(adminFeed.items.some(e => e.entityType === 'budget')).toBe(true);
    const text = JSON.stringify(adminFeed);
    for (const amount of ['4321.98', '4321,98', '5555.55', '5555,55']) {
      expect(text).not.toContain(amount);
    }

    for (const token of [team, guest, provisional]) {
      const items = (await json<ListResponse<ActivityEntry>>(await feed(token)))
        .items;
      expect(
        items.filter(e => ['budget', 'expense'].includes(e.entityType)),
      ).toEqual([]);
      const history = await h.request(
        'GET',
        `/organizations/${h.org.id}/activity?entityType=expense&entityId=${expense.id}`,
        {token},
      );
      expect(history.status).toBe(403);
    }

    const changes = (token: string) =>
      h.request(
        'GET',
        `/organizations/${h.org.id}/changes?since=${since.cursor}`,
        {token},
      );
    const forAdmin = await json<ChangesResponse>(await changes(admin));
    expect(forAdmin.types).toContain('expense');
    for (const token of [team, guest, provisional]) {
      const types = (await json<ChangesResponse>(await changes(token))).types;
      expect(types).not.toContain('expense');
      expect(types).not.toContain('budget');
    }
  });
});

describe('the demo budget', () => {
  it('is seeded once on the demo event, fictitious, with every honest case, and never re-created', async () => {
    expect(h.seeded.demoExpensesCreated).toBe(DEMO_EXPENSES.length);
    const demo = (
      await json<ListResponse<LogisticsEvent>>(
        await h.request('GET', `/organizations/${h.org.id}/events`, {
          token: admin,
        }),
      )
    ).items.find(e => e.isDemo)!;
    const body = await json<EventBudgetResponse>(
      await h.request('GET', `/events/${demo.id}/budget`, {token: developer}),
    );
    expect(body.budget).toMatchObject({
      amount: DEMO_BUDGET_AMOUNT,
      version: 1,
    });
    expect(body.expenses).toHaveLength(DEMO_EXPENSES.length);
    expect(body.expenses.every(x => x.isDemo)).toBe(true);
    expect(new Set(body.expenses.map(x => x.status))).toEqual(
      new Set(['planned', 'confirmed']),
    );
    for (const x of body.expenses) {
      if (x.company) expect(x.company.name).toMatch(/Demo/);
    }
    // One copied from the catalogue (two days of its price), with IGIC
    // «por verificar»; the snapshot keeps the offer as it was (no tax).
    const fromOffer = body.expenses.filter(x => x.snapshot);
    expect(fromOffer).toHaveLength(1);
    expect(fromOffer[0]).toMatchObject({
      amount: 900,
      tax: {regime: 'igic', ratePercent: 7, verification: 'to_verify'},
      snapshot: {offerName: 'Escenario modular 8 × 6 m', tax: null},
    });
    expect(body.expenses.some(x => x.tax?.regime === 'unknown')).toBe(true);

    const summary = (
      await json<ListResponse<BudgetSummary>>(
        await h.request('GET', `/organizations/${h.org.id}/budgets`, {
          token: admin,
        }),
      )
    ).items.find(s => s.eventId === demo.id)!;
    expect(summary.total.withTax).toBe(1733.4);
    expect(summary.remaining).toBe(4266.6);
    expect(summary.total.unknownTax).toBe(1);
    expect(summary.total.unknownAmount).toBe(1);
    expect(summary.incomplete).toBe(true);

    // Companies and offers are only linked, never changed by it.
    const companies = (
      await json<ListResponse<Company>>(
        await h.request('GET', `/organizations/${h.org.id}/companies`, {
          token: admin,
        }),
      )
    ).items.filter(c => c.isDemo);
    expect(companies.every(c => c.version === 1 && c.tax === null)).toBe(true);

    // Idempotent: a second run adds nothing, and an expense deleted by the
    // team is not brought back.
    const gone = body.expenses.find(x => !x.snapshot)!;
    expect(
      (
        await h.request(
          'DELETE',
          `/expenses/${gone.id}?version=${gone.version}`,
          {
            token: admin,
          },
        )
      ).status,
    ).toBe(204);
    const again = await seed(h.db, {passwordFor, now: h.clock.now()});
    expect(again.demoExpensesCreated).toBe(0);
    const count = await h.db.query<{n: number}>(
      'SELECT count(*)::int AS n FROM expenses WHERE event_id = $1',
      [demo.id],
    );
    expect(count).toEqual([{n: DEMO_EXPENSES.length - 1}]);
  });
});

describe('deleting what expenses point at', () => {
  it('a company delete keeps its expenses with its name and no link', async () => {
    const company = await post<Company>(admin, '/companies', {
      organizationId: h.org.id,
      name: 'Catering Borrado Prueba',
    });
    const expense = await post<Expense>(admin, '/expenses', {
      eventId: event.id,
      concept: 'Catering',
      companyId: company.id,
      amount: 800,
    });
    // Renamed before it goes: the expense keeps the last name.
    const renamed = await json<Company>(
      await h.request('PATCH', `/companies/${company.id}`, {
        token: admin,
        body: {version: company.version, name: 'Catering Final Prueba'},
      }),
    );
    const del = await h.request(
      'DELETE',
      `/companies/${company.id}?version=${renamed.version}`,
      {token: admin},
    );
    expect(del.status).toBe(204);
    const body = await json<EventBudgetResponse>(
      await h.request('GET', `/events/${event.id}/budget`, {token: admin}),
    );
    const kept = body.expenses.find(e => e.id === expense.id)!;
    expect(kept.company).toEqual({id: null, name: 'Catering Final Prueba'});
    expect(kept.version).toBe(2);
    expect(kept.amount).toBe(800);
    const history = await json<ListResponse<ActivityEntry>>(
      await h.request(
        'GET',
        `/organizations/${h.org.id}/activity?entityType=expense&entityId=${expense.id}`,
        {token: admin},
      ),
    );
    expect(history.items[0]).toMatchObject({
      action: 'update',
      changedFields: ['company'],
    });

    // Editing it afterwards keeps the name.
    const patched = await json<Expense>(
      await h.request('PATCH', `/expenses/${expense.id}`, {
        token: admin,
        body: {version: 2, status: 'confirmed'},
      }),
    );
    expect(patched.company).toEqual({id: null, name: 'Catering Final Prueba'});
  });

  it('removing the demo removes its event’s budget and expenses, and keeps a demo company a real expense uses', async () => {
    const events = await json<ListResponse<LogisticsEvent>>(
      await h.request('GET', `/organizations/${h.org.id}/events`, {
        token: admin,
      }),
    );
    const demo = events.items.find(e => e.isDemo)!;
    await post<Expense>(admin, '/expenses', {
      eventId: demo.id,
      concept: 'Gasto de demostración',
    });
    await h.request('PUT', `/events/${demo.id}/budget`, {
      token: admin,
      body: {amount: 50, version: 0},
    });
    const companies = await json<ListResponse<Company>>(
      await h.request('GET', `/organizations/${h.org.id}/companies`, {
        token: admin,
      }),
    );
    const demoCompany = companies.items.find(c => c.isDemo)!;
    const real = await post<Expense>(admin, '/expenses', {
      eventId: event.id,
      concept: 'Con empresa de demostración',
      companyId: demoCompany.id,
    });

    const res = await h.request('DELETE', `/organizations/${h.org.id}/demo`, {
      token: admin,
    });
    expect(res.status).toBe(200);
    expect(
      await h.db.query(
        `SELECT (SELECT count(*)::int FROM expenses WHERE event_id = $1) AS expenses,
                (SELECT count(*)::int FROM event_budgets WHERE event_id = $1) AS budgets`,
        [demo.id],
      ),
    ).toEqual([{expenses: 0, budgets: 0}]);
    const body = await json<EventBudgetResponse>(
      await h.request('GET', `/events/${event.id}/budget`, {token: admin}),
    );
    expect(body.expenses.find(e => e.id === real.id)?.company).toEqual({
      id: demoCompany.id,
      name: demoCompany.name,
    });
  });
});
