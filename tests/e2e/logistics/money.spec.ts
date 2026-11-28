import {expect, test, type Page} from '@playwright/test';
import {choose} from './controls';
import {goToAddress, lxUrl} from './address';
import {mockApi, signIn, type MockApi} from './mock-api';
import {moneyData, withBudget} from './money-fixtures';
import {fixClock} from './plan-fixtures';

/**
 * Revisión 1 · E5 «Dinero»: taxes on companies and offers (prices before
 * tax, estimate with tax said as such), the catalogue comparison with each
 * offer's own tax, and an event's budget (only with `budget.read`, changes
 * with `budget.edit`, never offline, never overwritten on a conflict).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const budgetCalls = (api: MockApi) =>
  api.requests.filter(
    r => /\/budget$|\/budgets$/.test(r.path) || r.path.startsWith('/expenses'),
  );

async function openBudget(page: Page) {
  await expect(page.locator('#lx-event-budget')).toBeVisible();
  await page.locator('#lx-event-budget-open').click();
  await expect(page.locator('#lx-budget-sheet')).toBeVisible();
}

test.describe('Gestor logístico · impuestos y comparación', () => {
  test('a company tax: IGIC prefilled at 7 % «por verificar», sent as TaxInput', async ({
    page,
  }) => {
    const data = moneyData();
    const api = await mockApi(page, data);
    await signIn(page, 'Elvis', lxUrl('contactos/ficha/empresa/c2'));
    await expect(page.locator('#lx-company-tax-view')).toContainText(
      'Impuesto sin indicar',
    );
    await page.locator('#lx-company-edit').click();
    await choose(page, 'lx-company-tax', 'igic');
    await expect(page.locator('#lx-company-tax-rate')).toHaveValue('7');
    await page.locator('#lx-company-save').click();
    await expect(page.locator('#lx-company-tax-view')).toContainText(
      'IGIC 7 %',
    );
    await expect(page.locator('#lx-company-tax-view')).toContainText(
      'por verificar',
    );
    const patch = api.calls('PATCH', '/companies/c2')[0].body as Json;
    expect(patch.tax).toEqual({
      regime: 'igic',
      ratePercent: 7,
      verification: 'to_verify',
    });
  });

  test('an offer inherits its company tax and shows the estimate as such', async ({
    page,
  }) => {
    await mockApi(page, moneyData());
    await signIn(page, 'Elvis', lxUrl('catalogo/ficha/oferta/o1'));
    await expect(page.locator('#lx-offer-price')).toContainText(
      'sin impuestos',
    );
    const estimate = page.locator('#lx-offer-estimate');
    await expect(estimate).toHaveAttribute('data-estimate', 'estimate');
    await expect(estimate).toContainText('128,4');
    await expect(estimate).toContainText('estimación');
    await expect(page.locator('#lx-offer-tax-view')).toContainText(
      'heredado de la empresa',
    );
  });

  test('«Comparar» ranks different taxes by the estimate; an unknown tax goes apart', async ({
    page,
  }) => {
    await mockApi(page, moneyData());
    await signIn(page, 'Elvis', lxUrl('catalogo'));
    const compare = page.locator('[id^="lx-catgroup-compare-"]').first();
    await compare.click();
    const ranked = page.locator(
      '.lx-catcompare .lx-compare:not(.lx-compare--apart) > li',
    );
    // 120 + IGIC ≈ 128,40; 115 + IVA ≈ 139,15; 150 + IVA ≈ 181,50.
    await expect(ranked).toHaveCount(3);
    await expect(ranked.nth(0)).toHaveAttribute('data-offer-id', 'o1');
    await expect(ranked.nth(1)).toHaveAttribute('data-offer-id', 'o2');
    await expect(ranked.nth(2)).toHaveAttribute('data-offer-id', 'o4');
    await expect(ranked.nth(0).locator('.lx-medal--gold')).toHaveCount(1);
    await expect(ranked.nth(1)).toContainText('IVA 21 %');
    const apart = page.locator('.lx-catcompare [data-reason="tax"]');
    await expect(apart).toHaveAttribute('data-offer-id', 'o3');
    await expect(apart.locator('.lx-medal')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · presupuesto del evento', () => {
  test('set the budget, add an expense from the catalogue, the copy stays', async ({
    page,
  }) => {
    const api = await mockApi(page, moneyData());
    await signIn(page, 'Elvis', lxUrl('ficha/evento/e1'));
    await openBudget(page);
    await expect(page.locator('#lx-budget-empty')).toBeVisible();

    // First time: version 0.
    await page.locator('#lx-budget-edit').click();
    await page.locator('#lx-budget-input').fill('2.000');
    await page.locator('#lx-budget-save').click();
    await expect(page.locator('#lx-budget-amount')).toContainText('2000');
    expect(api.calls('PUT', '/events/e1/budget')[0].body).toEqual({
      amount: 2000,
      version: 0,
    });

    // From the catalogue: 3 days of «Carpa 3x3» at 120 € before tax.
    await page.locator('#lx-budget-from-catalog').click();
    await page.locator('#lx-offerpick-sheet [data-offer-id="o1"]').click();
    await expect(page.locator('#lx-expense-offer-copy')).toContainText(
      'Se copiará el precio de hoy',
    );
    await expect(page.locator('#lx-expense-amount')).toHaveValue('120');
    await page.locator('#lx-expense-quantity').fill('3');
    await expect(page.locator('#lx-expense-amount')).toHaveValue('360');
    await expect(page.locator('#lx-expense-estimate')).toContainText('385,2');
    await page.locator('#lx-expense-save').click();
    await expect(page.locator('#lx-expense-sheet')).toHaveCount(0);

    const post = api.calls('POST', '/expenses')[0].body as Json;
    expect(post).toMatchObject({
      eventId: 'e1',
      offerId: 'o1',
      amount: 360,
      concept: 'Carpa 3x3',
      tax: {regime: 'igic', ratePercent: 7, verification: 'to_verify'},
    });
    const row = page.locator('#lx-budget-sheet .lx-expense').first();
    await expect(row).toContainText('Precio copiado el');
    await expect(page.locator('#lx-budget-headline')).toContainText('Quedan');
    await expect(page.locator('#lx-budget-headline')).toContainText('1614,8');

    // Someone changes the offer later: the expense keeps its copy.
    api.editDirectoryOnServer('offers', 'o1', {price: 200});
    expect(api.expenses[0].snapshot).toMatchObject({price: 120});
    expect(api.expenses[0].amount).toBe(360);
  });

  test('the budget at a glance, its caveats, and a conflict never overwritten', async ({
    page,
  }) => {
    const api = await mockApi(page, withBudget());
    await signIn(page, 'Elvis', lxUrl('ficha/evento/e1'));
    // The card: what is left, as an incomplete estimate.
    await expect(page.locator('#lx-event-budget')).toContainText('Quedan');
    await expect(page.locator('#lx-event-budget')).toContainText('incompleta');
    await openBudget(page);
    await expect(page.locator('#lx-budget-ribbon')).toBeVisible();
    await expect(page.locator('#lx-budget-caveats')).toContainText(
      '1 gasto sin importe',
    );
    await expect(
      page.locator('#lx-budget-group-confirmed .lx-expense'),
    ).toHaveCount(1);
    await expect(
      page.locator('#lx-budget-group-planned .lx-expense'),
    ).toHaveCount(2);

    // Another person changed the budget meanwhile.
    api.budgets[0].amount = 2500;
    api.budgets[0].version = 2;
    await page.locator('#lx-budget-edit').click();
    await page.locator('#lx-budget-input').fill('1800');
    await page.locator('#lx-budget-save').click();
    await expect(page.locator('#lx-budget-conflict')).toContainText('2500');
    expect(api.budgets[0].amount).toBe(2500);
    await page.locator('#lx-budget-use-mine').click();
    await expect(page.locator('#lx-budget-amount')).toContainText('1800');
    expect(api.calls('PUT', '/events/e1/budget').at(-1)?.body).toEqual({
      amount: 1800,
      version: 2,
    });
  });

  test('editing and deleting an expense; its tax picker and status', async ({
    page,
  }) => {
    const api = await mockApi(page, withBudget());
    await signIn(page, 'Elvis', lxUrl('ficha/evento/e1'));
    await openBudget(page);
    await page.locator('[data-expense-id="x3"]').click();
    await page.locator('#lx-expense-amount').fill('300');
    await choose(page, 'lx-expense-tax', 'igic');
    await page.locator('#lx-expense-status-confirmed').check();
    await page.locator('#lx-expense-save').click();
    await expect(page.locator('#lx-expense-sheet')).toHaveCount(0);
    expect(api.calls('PATCH', '/expenses/x3')[0].body).toEqual({
      version: 1,
      amount: 300,
      tax: {regime: 'igic', ratePercent: 7, verification: 'to_verify'},
      status: 'confirmed',
    });
    await expect(
      page.locator('#lx-budget-group-confirmed [data-expense-id="x3"]'),
    ).toBeVisible();

    await page.locator('[data-expense-id="x2"]').click();
    await page.locator('#lx-expense-delete').click();
    await page.locator('#lx-expense-delete-confirm').click();
    await expect(page.locator('[data-expense-id="x2"]')).toHaveCount(0);
    expect(api.calls('DELETE', '/expenses/x2')[0].query).toBe('?version=1');
  });

  test('the team role never sees the budget nor asks for it', async ({
    page,
  }) => {
    const api = await mockApi(page, withBudget());
    await signIn(page, 'Equipo', lxUrl('ficha/evento/e1'));
    await expect(page.locator('#lx-event-sheet')).toBeVisible();
    await expect(page.locator('#lx-event-budget')).toHaveCount(0);
    expect(budgetCalls(api)).toEqual([]);
  });

  test('a developer reads the budget without the edit controls', async ({
    page,
  }) => {
    await mockApi(page, {
      ...withBudget(),
      accounts: {Fabián: {roles: ['developer']}},
    });
    await signIn(page, 'Fabián', lxUrl('ficha/evento/e1'));
    await openBudget(page);
    await expect(page.locator('#lx-budget-amount')).toContainText('2000');
    await expect(page.locator('#lx-budget-edit')).toHaveCount(0);
    await expect(page.locator('#lx-budget-add')).toHaveCount(0);
    await expect(page.locator('#lx-budget-readonly')).toBeVisible();
    // Rows read; they do not open a form.
    await expect(page.locator('button.lx-expense')).toHaveCount(0);
  });

  test('a failed load can be retried', async ({page}) => {
    const api = await mockApi(page, withBudget());
    // The card's load and the budget sheet's own load (it has its own
    // address and asks again when it opens) both fail.
    api.failBudget = 2;
    await signIn(page, 'Elvis', lxUrl('ficha/evento/e1'));
    await expect(page.locator('#lx-event-budget')).toContainText(
      'Error interno',
    );
    await page.locator('#lx-event-budget-open').click();
    await page.locator('#lx-budget-sheet').getByText('Reintentar').click();
    await expect(page.locator('#lx-budget-amount')).toContainText('2000');
    // Back on the event, the card no longer shows the old error.
    await page.locator('#lx-budget-close').click();
    await expect(page.locator('#lx-event-budget')).toContainText('Quedan');
  });

  test('without connection: «Necesita conexión», nothing asked, nothing kept', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, withBudget());
    await signIn(page, 'Elvis');
    await expect(page.locator('#lx-space-hoy')).toBeVisible();
    await context.setOffline(true);
    await goToAddress(page, lxUrl('ficha/evento/e1'));
    await expect(page.locator('#lx-event-budget')).toContainText(
      'Necesita conexión',
    );
    await page.locator('#lx-event-budget-open').click();
    await expect(page.locator('#lx-budget-offline')).toContainText(
      'no se guarda en este dispositivo',
    );
    expect(budgetCalls(api)).toEqual([]);
    // Budget data never reaches the device's storage.
    const stored = await page.evaluate(() => JSON.stringify({...localStorage}));
    expect(stored).not.toContain('Carpas para el escenario');
  });
});
