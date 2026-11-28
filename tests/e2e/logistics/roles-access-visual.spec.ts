import {expect, test, type Page} from '@playwright/test';
import {lxUrl, lxUrlRe} from './address';
import {PASSWORD, RESET_TOKEN, mockApi, signIn} from './mock-api';
import {fixClock} from './plan-fixtures';

/**
 * Screenshots of the Revisión 1 · E4 screens (roles and access) for the UI
 * review; behaviour lives in roles-access.spec.ts.
 * Output: test-results/visual/logistics-r1-e4-<screen>-<palette>.png
 */

const PALETTES = [
  'oxeye',
  'atlas',
  'noctis',
  'territorio',
  'vector',
  'bendy',
] as const;
const OUT = 'test-results/visual';
const DESKTOP = {width: 1440, height: 1000};
const PHONE = {width: 390, height: 844};

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.describe.configure({timeout: 120_000});
test.beforeEach(async ({page}) => fixClock(page));

async function capture(page: Page, screen: string) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(250);
    await page.screenshot({path: `${OUT}/logistics-r1-e4-${screen}-${id}.png`});
  }
}

test.describe('Gestor logístico · E4 · revisión visual', () => {
  test('welcome, then the provisional banner', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, {
      accounts: {Yeray: {welcomed: false, passwordProvisional: true}},
    });
    await signIn(page, 'Yeray');
    await expect(page.locator('#lx-welcome-sheet')).toBeVisible();
    await capture(page, 'welcome');
    await page.locator('#lx-welcome-keep').click();
    await expect(page.locator('#lx-welcome-profile-step')).toBeVisible();
    await capture(page, 'welcome-profile');
    await page.locator('#lx-welcome-skip').click();
    await expect(page.locator('#lx-provisional-banner')).toBeVisible();
    await capture(page, 'provisional');
  });

  test('profile and security', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page);
    await signIn(page, 'Dailos');
    await page.locator('#lx-user-open').click();
    await expect(page.locator('#lx-profile-edit-name')).toBeVisible();
    await capture(page, 'profile');
    await page.locator('#lx-profile-tab-seguridad').click();
    await page.locator('#lx-profile-password-new').fill('carpas de la plaza');
    await expect(page.locator('#lx-profile-sessions')).toContainText(
      'Esta sesión',
    );
    await capture(page, 'security');
  });

  test('users and the support session', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const dailos = page.locator('#lx-users-list [data-user="Dailos"]');
    await dailos.locator('.lx-users__head').click();
    await page.locator('#lx-users-link-Dailos').click();
    await expect(page.locator('#lx-users-secret')).toBeVisible();
    await capture(page, 'users');
    await page.locator('#lx-users-tab-registro').click();
    await expect(page.locator('#lx-users-log')).toBeVisible();
    await capture(page, 'users-log');
    await page.locator('#lx-users-tab-personas').click();
    await dailos.locator('.lx-users__head').click();
    await dailos.getByRole('button', {name: 'Abrir sesión de soporte'}).click();
    await page
      .locator('#lx-support-reason')
      .fill('No ve las tareas de mañana en el calendario');
    await capture(page, 'support-form');
    await page.locator('#lx-support-password').fill('secreto');
    await page.locator('#lx-support-start').click();
    await expect(page.locator('#lx-support-banner')).toBeVisible();
    await capture(page, 'support-banner');
  });

  test('a developer account seen by an administrator: fixed roles, locked help', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const fabian = page.locator('#lx-users-list [data-user="Fabián"]');
    await fabian.locator('.lx-users__head').click();
    await expect(page.locator('#lx-users-help-blocked-Fabián')).toBeVisible();
    await fabian.scrollIntoViewIfNeeded();
    await capture(page, 'users-developer');
  });

  test('the shared Equipo account: from «Usuarios» and from itself', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-nav-usuarios').click();
    const equipo = page.locator('#lx-users-list [data-user="Equipo"]');
    await equipo.locator('.lx-users__head').click();
    await expect(page.locator('#lx-users-shared-Equipo')).toBeVisible();
    await equipo.scrollIntoViewIfNeeded();
    await capture(page, 'users-shared');

    await page.keyboard.press('Escape');
    await page.locator('#lx-logout').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await page.locator('#lx-login-username').fill('Equipo');
    await page.locator('#lx-login-password').fill(PASSWORD);
    await page.locator('#lx-login-submit').click();
    await page.locator('#lx-user-open').click();
    await page.locator('#lx-profile-tab-seguridad').click();
    await expect(page.locator('#lx-profile-password-shared')).toBeVisible();
    await capture(page, 'security-shared');
  });

  test('guest: Contactos locked, on a phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page, 'Invitado', lxUrl('contactos'));
    await expect(page.locator('#lx-contactos-noaccess')).toBeVisible();
    await capture(page, 'noaccess-phone');
  });

  test('guest: Contactos locked, on desktop', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await mockApi(page);
    await signIn(page, 'Invitado', lxUrl('contactos'));
    const locked = page.locator('#lx-contactos-noaccess');
    await expect(locked).toContainText('Solo para el equipo');
    await expect(locked).toContainText('Lo que el equipo hace aquí');
    await capture(page, 'noaccess-desktop');
    await locked.getByRole('button', {name: 'Ir a Hoy'}).click();
    await expect(page).toHaveURL(lxUrlRe());
  });

  test('phone account sheet and reset link', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page, 'Elvis');
    await page.locator('#lx-account-button').click();
    await expect(page.locator('#lx-account-profile')).toBeVisible();
    await capture(page, 'account-phone');
    await page.locator('#lx-logout-phone').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    // A fresh load, as when the link is opened from an e-mail.
    await page.goto('about:blank');
    await page.goto(`${lxUrl('cuenta/restablecer')}#${RESET_TOKEN}`);
    await page.locator('#lx-reset-password').fill('mi frase nueva');
    await expect(page.locator('#lx-reset-form')).toBeVisible();
    await capture(page, 'reset-phone');
  });
});
