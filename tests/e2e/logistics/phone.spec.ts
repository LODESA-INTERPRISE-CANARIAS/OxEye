import {expect, test} from '@playwright/test';
import {lxUrlRe} from './address';
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
  {id: 'tareas', title: 'Tareas'},
  {id: 'inventarios', title: 'Inventarios'},
  {id: 'contactos', title: 'Contactos'},
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
      await expect(page).toHaveURL(lxUrlRe(space.id));
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#lx-tab-hoy')).not.toHaveAttribute(
        'aria-current',
      );
    }

    await page.locator('#lx-tab-hoy').click();
    await expect(page.locator('#lx-space-hoy')).toBeVisible();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(page).toHaveURL(lxUrlRe());

    // Five tabs fit with readable labels; «Catálogo» (desk work) lives in
    // the account sheet.
    await expect(page.locator('.lx-tabbar [id^="lx-tab-"]')).toHaveCount(5);
    await expect(page.locator('#lx-tab-catalogo')).toHaveCount(0);
    await page.locator('#lx-account-button').click();
    await page.locator('#lx-account-catalogo').click();
    await expect(page.locator('#lx-space-catalogo')).toBeVisible();
    await expect(page).toHaveURL(lxUrlRe('catalogo'));
    await expect(page.locator('#lx-account-sheet')).toBeHidden();

    // The hash a tab wrote reopens the same space after a reload.
    await page.locator('#lx-tab-inventarios').click();
    await expect(page).toHaveURL(lxUrlRe('inventarios'));
    await page.reload();
    await expect(page.locator('#lx-space-inventarios')).toBeVisible();
    // Milestone 4: Inventarios is a real space, not the placeholder.
    await expect(
      page.locator('#lx-space-inventarios').getByRole('tab', {name: /Propios/}),
    ).toBeVisible();
  });

  test('«Cierre de jornada» opens from the account sheet; the Hoy tab goes back', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    // Milestone 6: «Cierre de jornada» is a real space (no placeholder is
    // left), reached on a phone from the account sheet.
    await page.locator('#lx-account-button').click();
    await page
      .locator('#lx-account-sheet')
      .getByRole('button', {name: 'Cierre de jornada'})
      .click();
    await expect(page).toHaveURL(lxUrlRe('cierre'));
    await expect(page.locator('#lx-space-cierre #lx-day-title')).toBeVisible();
    await expect(
      page.locator('#lx-space-cierre').getByRole('button', {name: 'Ir a Hoy'}),
    ).toHaveCount(0);
    await page.locator('#lx-tab-hoy').click();
    await expect(page.locator('#lx-space-hoy')).toBeVisible();
    await expect(page).toHaveURL(lxUrlRe());
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
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect.poll(() => api.calls('POST', '/auth/logout').length).toBe(1);
  });
});
