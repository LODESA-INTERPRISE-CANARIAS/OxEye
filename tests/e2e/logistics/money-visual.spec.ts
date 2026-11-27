import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './mock-api';
import {moneyData, withBudget} from './money-fixtures';
import {fixClock} from './plan-fixtures';

/**
 * Screenshots of the Revisión 1 · E5 «Dinero» screens for the UI review;
 * behaviour lives in money.spec.ts.
 * Output: test-results/visual/logistics-r1-e5-<screen>-<palette>.png
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
    await page.screenshot({path: `${OUT}/logistics-r1-e5-${screen}-${id}.png`});
  }
}

test('E5 · budget sheet (desktop)', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, withBudget());
  await signIn(page, 'Elvis', '#logistica/ficha/evento/e1');
  await page.locator('#lx-event-budget-open').click();
  await expect(page.locator('#lx-budget-ribbon')).toBeVisible();
  await capture(page, 'budget');
});

test('E5 · budget over (phone)', async ({page}) => {
  await page.setViewportSize(PHONE);
  const data = withBudget();
  data.budgets[0].amount = 1200;
  await mockApi(page, data);
  await signIn(page, 'Elvis', '#logistica/ficha/evento/e1');
  await page.locator('#lx-event-budget-open').click();
  await expect(page.locator('#lx-budget-ribbon')).toBeVisible();
  await capture(page, 'budget-over-phone');
});

test('E5 · event sheet card', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, withBudget());
  await signIn(page, 'Elvis', '#logistica/ficha/evento/e1');
  const card = page.locator('#lx-event-budget');
  await expect(card).toContainText('Quedan');
  await card.scrollIntoViewIfNeeded();
  await capture(page, 'event-card');
});

test('E5 · expense from the catalogue', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, withBudget());
  await signIn(page, 'Elvis', '#logistica/ficha/evento/e1');
  await page.locator('#lx-event-budget-open').click();
  await page.locator('#lx-budget-from-catalog').click();
  await page.locator('#lx-offerpick-sheet [data-offer-id="o1"]').click();
  await page.locator('#lx-expense-quantity').fill('3');
  await capture(page, 'expense-form');
});

test('E5 · catalogue comparison', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, moneyData());
  await signIn(page, 'Elvis', '#logistica/catalogo');
  await page.locator('[id^="lx-catgroup-compare-"]').first().click();
  await expect(page.locator('.lx-catcompare')).toBeVisible();
  await capture(page, 'compare');
});

test('E5 · offer sheet and its tax', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, moneyData());
  await signIn(page, 'Elvis', '#logistica/catalogo/ficha/oferta/o1');
  await expect(page.locator('#lx-offer-estimate')).toBeVisible();
  await capture(page, 'offer');
  await page.locator('#lx-offer-edit').click();
  await page.locator('#lx-offer-tax-group').scrollIntoViewIfNeeded();
  await capture(page, 'offer-form');
});
