import {expect, test, type Page} from '@playwright/test';
import {addDays, loginAs, mockApi, signIn} from './mock-api';
import {DAY, fixClock} from './plan-fixtures';
import {ESCENARIOS, followData} from './followup-fixtures';

/**
 * Gestor logístico, Revisión 1 (note 29): the browser's Back / Forward and
 * the phone's back gesture move between spaces, calendar days and open
 * sheets; each record sheet has its own address; a form with unsaved
 * changes is never closed by Back without asking; leaving the Gestor still
 * returns to the hub. Fixed clock and fictitious data.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
});

const hash = (page: Page) => new URL(page.url()).hash;
const historyLength = (page: Page) => page.evaluate(() => history.length);

async function openCompanySheet(page: Page) {
  await page.locator('#lx-contacts-tab-companies').click();
  await page
    .locator(`[data-company-id="${ESCENARIOS.id}"] .lx-dirrow__main`)
    .click();
  await expect(page.locator('#lx-company-sheet')).toBeVisible();
}

test.describe('Gestor logístico · Atrás y Adelante', () => {
  test('spaces and calendar days are steps of Back and Forward', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-nav-calendario').click();
    await expect(page).toHaveURL(/#logistica\/calendario$/);
    await page.locator('#lx-nav-contactos').click();
    await expect(page).toHaveURL(/#logistica\/contactos$/);

    await page.goBack();
    await expect(page).toHaveURL(/#logistica\/calendario$/);
    await expect(page.locator('#lx-title')).toHaveText('Calendario');
    await expect(page.locator('#lx-nav-calendario')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goBack();
    await expect(page).toHaveURL(/#logistica$/);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await page.goForward();
    await expect(page.locator('#lx-title')).toHaveText('Calendario');

    // A day, then the next one: Back returns to the first day.
    await page.evaluate(h => {
      window.location.hash = h;
    }, `#logistica/calendario/${DAY}`);
    await expect(page.locator('#lx-cal-title')).toContainText('2 de diciembre');
    await page.locator('#lx-cal-next').click();
    await expect(page).toHaveURL(
      new RegExp(`#logistica/calendario/${addDays(DAY, 1)}$`),
    );
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#logistica/calendario/${DAY}$`));
    await expect(page.locator('#lx-cal-title')).toContainText('2 de diciembre');
    await expect(page.locator('#logistics-app')).toBeVisible();
  });

  test('a sheet has its own address; Back closes it, Forward reopens it', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-nav-contactos').click();
    await openCompanySheet(page);
    await expect(page).toHaveURL(
      new RegExp(`#logistica/contactos/ficha/empresa/${ESCENARIOS.id}$`),
    );

    await page.goBack();
    await expect(page.locator('#lx-company-sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica\/contactos$/);
    await expect(page.locator('#lx-title')).toHaveText('Contactos');

    await page.goForward();
    await expect(page.locator('#lx-company-sheet')).toBeVisible();
    await expect(page).toHaveURL(/\/ficha\/empresa\/c1$/);

    // Closing it with its own button steps back: Back does not reopen it.
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-company-sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica\/contactos$/);
    await page.goBack();
    await expect(page.locator('#lx-company-sheet')).toHaveCount(0);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
  });

  test('a sheet opened inside another is one more step of Back', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', '#logistica/contactos');
    await openCompanySheet(page);
    await page.locator('#lx-company-work-order').click();
    await expect(page.locator('#lx-order-sheet')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#lx-order-sheet')).toHaveCount(0);
    await expect(page.locator('#lx-company-sheet')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#lx-company-sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica\/contactos$/);
  });

  test('a shared sheet link opens after signing in; Back stays in the Gestor', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await page.goto('/#logistica/calendario/2026-12-02/ficha/tarea/h1');
    await loginAs(page, 'Elvis');
    const sheet = page.locator('#lx-task-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Montaje del escenario Demo');
    await expect(page).toHaveURL(
      /#logistica\/calendario\/2026-12-02\/ficha\/tarea\/h1$/,
    );

    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica\/calendario\/2026-12-02$/);
    await expect(page.locator('#lx-cal-title')).toContainText('2 de diciembre');
    await expect(page.locator('#logistics-app')).toBeVisible();
  });

  test('a link to a record that is not there says so and keeps the space', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', '#logistica/inventarios/ficha/recurso/nope');
    await expect(page.locator('.lx-toast')).toContainText(
      'No se encuentra esa ficha',
    );
    await expect(page.locator('#lx-resource-sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica\/inventarios$/);
    await expect(page.locator('#lx-title')).toHaveText('Inventarios');
  });

  test('Back on a form with unsaved changes asks first and keeps the place', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-contact').click();
    const sheet = page.locator('#lx-contact-sheet');
    await expect(sheet).toBeVisible();
    await page.locator('#lx-contact-name').fill('Persona a medias Demo');
    const length = await historyLength(page);
    const where = hash(page);

    await page.goBack();
    // Not closed: «¿Descartarlos?» and the history position back in place.
    await expect(page.locator('#lx-contact-discard-text')).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(page.locator('#lx-contact-name')).toHaveValue(
      'Persona a medias Demo',
    );
    await expect.poll(() => hash(page)).toBe(where);
    expect(await historyLength(page)).toBe(length);

    // «Descartar» closes it and steps the history back.
    await page.locator('#lx-contact-discard-confirm').click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica$/);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
  });

  test('«Volver a OxEye» after moving around returns to the hub', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await page.goto('/?entrada=1');
    await page.goto('/');
    await page.locator('#game-logistics').click();
    await loginAs(page, 'Elvis');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await page.locator('#lx-nav-calendario').click();
    await page.locator('#lx-nav-inventarios').click();
    await expect(page).toHaveURL(/#logistica\/inventarios$/);

    await page.locator('#lx-back-to-oxeye').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => hash(page)).toBe('');
    await expect(page.locator('#game-menu')).not.toHaveAttribute('inert');
    // It stays closed (no flash back into the Gestor).
    await page.waitForTimeout(300);
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    // And Back leaves the hub for the page before it.
    await page.goBack();
    await expect(page).toHaveURL(/\/\?entrada=1$/);
  });

  test('the phone back gesture closes the account menu, then changes space', async ({
    page,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-tab-inventarios').click();
    await expect(page).toHaveURL(/#logistica\/inventarios$/);
    await page.locator('#lx-account-button').click();
    await expect(page.locator('#lx-account-sheet')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#lx-account-sheet')).toBeHidden();
    await expect(page).toHaveURL(/#logistica\/inventarios$/);
    await page.goBack();
    await expect(page).toHaveURL(/#logistica$/);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
  });
});

test.describe('Gestor logístico · maquetas (solo desarrollo)', () => {
  test('«Maquetas» opens the mock-ups without the server and comes back', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-nav-maquetas').click();
    await expect(page).toHaveURL(/#logistica\/maquetas$/);
    await expect(page.locator('#lx-mockups')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#lx-mockups')).toHaveCount(0);
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
  });

  test('a direct link needs no sign-in', async ({page}) => {
    const api = await mockApi(page);
    await page.goto('/#logistica/maquetas');
    await expect(page.locator('#lx-mockups')).toBeVisible();
    await expect(page.locator('#lx-login-form')).toHaveCount(0);
    expect(api.requests.filter(r => r.path.startsWith('/auth'))).toHaveLength(
      0,
    );
  });
});
