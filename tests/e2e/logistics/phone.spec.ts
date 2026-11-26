import {expect, test} from '@playwright/test';
import {mockApi, signIn} from './mock-api';

/**
 * Gestor logístico, milestone 1, on a phone (390 × 844): the bottom tab bar
 * switches spaces and keeps the hash in step; the floating «Añadir» opens the
 * event sheet.
 */

test.use({
  locale: 'es-ES',
  timezoneId: 'Atlantic/Canary',
  viewport: {width: 390, height: 844},
});

const SPACES = [
  {id: 'calendario', title: 'Calendario'},
  {id: 'inventarios', title: 'Inventarios'},
  {id: 'contactos', title: 'Contactos'},
  {id: 'catalogo', title: 'Catálogo'},
] as const;

test.describe('Gestor logístico · móvil', () => {
  test('the tab bar switches spaces and updates the hash', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    await expect(page.locator('.lx-tabbar')).toBeVisible();
    // Desktop chrome is hidden on phones.
    await expect(page.locator('.lx-sidebar')).toBeHidden();
    await expect(page.locator('#lx-add')).toBeHidden();
    await expect(page.locator('#lx-tab-hoy')).toHaveAttribute(
      'aria-current',
      'page',
    );

    for (const space of SPACES) {
      const tab = page.locator(`#lx-tab-${space.id}`);
      await tab.click();
      await expect(page.locator(`#lx-space-${space.id}`)).toBeVisible();
      await expect(page.locator('#lx-title')).toHaveText(space.title);
      await expect(page).toHaveURL(new RegExp(`#logistica/${space.id}$`));
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#lx-tab-hoy')).not.toHaveAttribute(
        'aria-current',
      );
    }

    await page.locator('#lx-tab-hoy').click();
    await expect(page.locator('#lx-space-hoy')).toBeVisible();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(page).toHaveURL(/#logistica$/);

    // The hash a tab wrote reopens the same space after a reload.
    await page.locator('#lx-tab-inventarios').click();
    await expect(page).toHaveURL(/#logistica\/inventarios$/);
    await page.reload();
    await expect(page.locator('#lx-space-inventarios')).toBeVisible();
    // Milestone 4: Inventarios is a real space, not the placeholder.
    await expect(
      page.locator('#lx-space-inventarios').getByRole('tab', {name: /Propios/}),
    ).toBeVisible();
  });

  test('«Ir a Hoy» on a placeholder space goes back to Hoy', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    // Catálogo and Contactos are real spaces since milestone 3, Inventarios
    // since milestone 4: «Cierre de jornada» (from the account sheet) is
    // the remaining placeholder.
    await page.locator('#lx-account-button').click();
    await page
      .locator('#lx-account-sheet')
      .getByRole('button', {name: 'Cierre de jornada'})
      .click();
    await expect(page).toHaveURL(/#logistica\/cierre$/);
    await page
      .locator('#lx-space-cierre')
      .getByRole('button', {name: 'Ir a Hoy'})
      .click();
    await expect(page.locator('#lx-space-hoy')).toBeVisible();
    await expect(page).toHaveURL(/#logistica$/);
  });

  test('the floating «Añadir» opens the event sheet', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    const fab = page.locator('#lx-fab');
    await expect(fab).toBeVisible();
    await expect(fab).toBeInViewport();
    await fab.click();
    await page.locator('#lx-fab-event').click();
    await expect(page.locator('#lx-event-form')).toBeVisible();
    await expect(page.locator('#lx-event-name')).toBeFocused();
    await expect(page.locator('#lx-event-save')).toBeInViewport();
  });

  test('the account sheet offers logout', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await page.locator('#lx-account-button').click();
    await expect(page.locator('#lx-account-sheet')).toBeVisible();
    await page.locator('#lx-logout-phone').click();
    await expect(page.locator('#lx-login-users')).toBeVisible();
    await expect.poll(() => api.calls('POST', '/auth/logout').length).toBe(1);
  });
});
