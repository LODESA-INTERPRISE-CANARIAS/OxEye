import {expect, test, type Page} from '@playwright/test';
import {hashOf, lxUrlRe, pathOf} from './address';
import {dayCloseData} from './day-close-fixtures';
import {ESCENARIOS, followData} from './followup-fixtures';
import {
  OPEN_TOKEN,
  RESET_TOKEN,
  SUPPLIER_TOKEN,
  VERIFY_TOKEN,
  loginAs,
  mockApi,
} from './mock-api';
import {offersData} from './offers-fixtures';
import {DAY, fixClock, planData} from './plan-fixtures';

/**
 * Gestor logístico at `/gestor-logistico` (plan `gestor-logistico-ruta`):
 * every link made before 2026-11-28 (`/#logistica…`, in mails, installed
 * phones and bookmarks) still opens the same screen and ends on the new
 * address. The rewrite replaces the history entry (Back never returns to the
 * legacy form). Account and supplier tokens are read, never put in a path,
 * and removed from the address once read. Fixed clock and fictitious data.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

/** The token is nowhere in the address bar, path or fragment. */
async function expectTokenGone(page: Page, token: string) {
  await expect.poll(() => page.url()).not.toContain(token);
  expect(pathOf(page)).not.toContain(token);
}

test.describe('Gestor logístico · enlaces antiguos #logistica', () => {
  test('/#logistica opens the Gestor and is rewritten in place', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/#logistica');
    await expect(page.locator('#logistics-app')).toBeVisible();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect(page).toHaveURL(lxUrlRe());
    expect(hashOf(page)).toBe('');

    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    // replaceState, not a new entry: Back leaves for the page before.
    await page.goBack();
    expect(page.url()).toBe('about:blank');
  });

  test('a calendar day link opens that day', async ({page}) => {
    await mockApi(page, planData());
    await page.goto(`/#logistica/calendario/${DAY}`);
    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-space-calendario')).toBeVisible();
    await expect(page.locator('#lx-cal-title')).toContainText('2 de diciembre');
    await expect(page).toHaveURL(lxUrlRe(`calendario/${DAY}`));
    expect(hashOf(page)).toBe('');
  });

  test('a record sheet link opens the sheet over its space', async ({page}) => {
    await mockApi(page, followData());
    await page.goto(`/#logistica/contactos/ficha/empresa/${ESCENARIOS.id}`);
    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-company-sheet')).toBeVisible();
    await expect(page.locator('#lx-space-contactos')).toBeVisible();
    await expect(page).toHaveURL(
      lxUrlRe(`contactos/ficha/empresa/${ESCENARIOS.id}`),
    );
    // Back closes the sheet and stays on Contactos at the new address.
    await page.goBack();
    await expect(page.locator('#lx-company-sheet')).toHaveCount(0);
    await expect(page).toHaveURL(lxUrlRe('contactos'));
  });

  test('a day close link opens that day', async ({page}) => {
    await mockApi(page, dayCloseData());
    await page.goto('/#logistica/cierre/2026-12-01');
    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-day-title')).toHaveText(
      /1 de diciembre de 2026/,
    );
    await expect(page).toHaveURL(lxUrlRe('cierre/2026-12-01'));
    expect(hashOf(page)).toBe('');
  });

  test('a trailing slash still lands on the Gestor root', async ({page}) => {
    await mockApi(page);
    await page.goto('/#logistica/');
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect(page).toHaveURL(lxUrlRe());
  });

  test('a reset link reads the token and removes it from the address', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await page.goto(`/#logistica/cuenta/restablecer/${RESET_TOKEN}`);
    await expect(page.locator('#lx-reset-form')).toContainText(
      'Elige una contraseña nueva',
    );
    await expectTokenGone(page, RESET_TOKEN);
    await expect(page).toHaveURL(lxUrlRe());

    await page.locator('#lx-reset-password').fill('mi frase nueva y larga');
    await page.locator('#lx-reset-submit').click();
    await expect(page.locator('#lx-reset-done')).toContainText(
      'Contraseña cambiada',
    );
    // The token travelled in the request body, never in a request path.
    expect(api.calls('POST', '/auth/reset')[0]?.body).toMatchObject({
      token: RESET_TOKEN,
    });
    expect(api.requests.some(r => r.path.includes(RESET_TOKEN))).toBe(false);
  });

  test('a verification link confirms the e-mail and leaves no token', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto(`/#logistica/cuenta/verificar/${VERIFY_TOKEN}`);
    await expect(page.locator('#lx-verify-done')).toContainText(
      'Correo verificado',
    );
    await expectTokenGone(page, VERIFY_TOKEN);
  });

  test('a personal supplier link opens only the form and leaves no token', async ({
    page,
  }) => {
    const mock = await mockApi(page, offersData());
    await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
    await expect(page.locator('#lx-supplier-request')).toContainText(
      '4 carpas de 6 × 6 m',
    );
    await expect(page.locator('#lx-login-username')).toHaveCount(0);
    await expect(page.locator('#game-menu')).toHaveCount(0);
    await expectTokenGone(page, SUPPLIER_TOKEN);
    expect(pathOf(page)).toMatch(/^\/gestor-logistico(\/|$)/);
    expect(mock.requests.some(r => r.path.includes(SUPPLIER_TOKEN))).toBe(
      false,
    );
    expect(mock.calls('POST', '/public/requests/lookup')[0].body).toEqual({
      token: SUPPLIER_TOKEN,
    });
  });

  test('the open supplier link opens the form and leaves no token', async ({
    page,
  }) => {
    const data = offersData();
    data.supplierLinks!.push({
      token: OPEN_TOKEN,
      requestId: null,
      linkId: null,
    });
    data.offerSettings = {
      openLink: {enabled: true, createdAt: null},
      version: 1,
    };
    await mockApi(page, data);
    await page.goto(`/#logistica/proveedor/abierto/${OPEN_TOKEN}`);
    await expect(page.locator('#lx-sf-form')).toHaveAttribute(
      'data-step',
      'company',
    );
    await expectTokenGone(page, OPEN_TOKEN);
    expect(pathOf(page)).toMatch(/^\/gestor-logistico(\/|$)/);
  });
});
