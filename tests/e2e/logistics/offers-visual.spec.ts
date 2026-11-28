import {expect, test, type Page} from '@playwright/test';
import {lxUrl} from './address';
import {SUPPLIER_TOKEN, mockApi, signIn} from './mock-api';
import {offersData} from './offers-fixtures';

/**
 * Screenshots of the Revisión 1 · E6–E7 «Ofertas» screens for the UI
 * review; behaviour lives in offers.spec.ts and supplier.spec.ts.
 * Output: test-results/visual/logistics-r1-e7-<screen>-<palette>.png
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

async function capture(page: Page, screen: string, fullPage = false) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${OUT}/logistics-r1-e7-${screen}-${id}.png`,
      fullPage,
    });
  }
}

/** Scrolls the open sheet so `selector` is at its top. */
async function scrollSheetTo(page: Page, selector: string) {
  await page
    .locator(selector)
    .evaluate(el => el.scrollIntoView({block: 'start'}));
}

test('E6 · offer terms and the cost of a need (desktop)', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, offersData());
  await signIn(page, 'Elvis', lxUrl('catalogo/ficha/oferta/o1'));
  await expect(page.locator('#lx-offer-terms')).toBeVisible();
  await scrollSheetTo(page, '#lx-offer-terms');
  await capture(page, 'terms');
  await scrollSheetTo(page, '#lx-offer-need');
  await page.locator('#lx-offer-versions-box > summary').click();
  await capture(page, 'need-cost');
});

test('E7 · request detail with the comparison (desktop)', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, offersData());
  await signIn(page, 'Elvis', lxUrl('catalogo'));
  await page.locator('#lx-ctab-requests').click();
  await capture(page, 'requests');
  await page.locator('[data-request-id="qr1"]').click();
  await expect(page.locator('#lx-request-compare')).toBeVisible();
  await capture(page, 'request-detail');
});

test('E7 · inbox and a proposal to check (desktop)', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, offersData());
  await signIn(page, 'Elvis', lxUrl('catalogo'));
  await page.locator('#lx-ctab-inbox').click();
  await expect(page.locator('#lx-inbox-list')).toBeVisible();
  await capture(page, 'inbox');
  await page.locator('[data-proposal-id="p2"]').click();
  await expect(page.locator('#lx-proposal-company')).toBeVisible();
  await capture(page, 'proposal-open');
});

test('E6 · renewals (desktop)', async ({page}) => {
  await page.setViewportSize(DESKTOP);
  await mockApi(page, offersData());
  await signIn(page, 'Elvis', lxUrl('catalogo'));
  await page.locator('#lx-ctab-renewals').click();
  await expect(page.locator('#lx-renewals-list')).toBeVisible();
  await page.locator('#lx-open-link-on').click();
  await expect(page.locator('#lx-open-link .lx-sharelink__url')).toBeVisible();
  await capture(page, 'renewals');
});

test('E7 · links to share after asking (phone)', async ({page}) => {
  await page.setViewportSize(PHONE);
  await mockApi(page, offersData());
  await signIn(page, 'Elvis', lxUrl('catalogo'));
  await page.locator('#lx-request-new').click();
  await page.locator('#lx-qr-title').fill('2 escenarios de 8 × 6 m');
  await page.locator('#lx-qr-companyIds').click();
  await page
    .locator('#lx-qr-companyIds-listbox [role="option"][data-value="c1"]')
    .click();
  await page
    .locator('#lx-qr-companyIds-listbox [role="option"][data-value="c2"]')
    .click();
  await page.keyboard.press('Escape');
  await capture(page, 'request-form-phone');
  await page.locator('#lx-request-submit').click();
  await expect(page.locator('#lx-request-created-links')).toBeVisible();
  await capture(page, 'request-links-phone');
});

test('E7 · proposal sheet as the team (phone)', async ({page}) => {
  await page.setViewportSize(PHONE);
  await mockApi(page, offersData());
  await signIn(page, 'Equipo', lxUrl('catalogo'));
  await page.locator('#lx-ctab-inbox').click();
  await page.locator('[data-proposal-id="p1"]').click();
  await expect(page.locator('#lx-proposal-locked')).toBeVisible();
  await capture(page, 'proposal-team-phone');
});

test.describe('supplier page (needs the mount in LogisticsApp)', () => {
  test('E7 · supplier form steps (phone)', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, offersData());
    await page.goto(`${lxUrl('proveedor')}#${SUPPLIER_TOKEN}`);
    await expect(page.locator('#lx-supplier-request')).toBeVisible();
    await capture(page, 'supplier-start-phone');
    await page.locator('#lx-sf-intent .lx-choice[data-value="yes"]').click();
    for (const step of ['company', 'price:0', 'extras:0']) {
      await page.locator('#lx-sf-next').click();
      await expect(page.locator('#lx-sf-form')).toHaveAttribute(
        'data-step',
        step,
      );
    }
    await capture(page, 'supplier-extras-phone');
    for (const step of ['products', 'tax', 'dates']) {
      await page.locator('#lx-sf-next').click();
      await expect(page.locator('#lx-sf-form')).toHaveAttribute(
        'data-step',
        step,
      );
    }
    await page.locator('#lx-sf-service-months').click();
    await capture(page, 'supplier-dates-phone');
    await page.locator('#lx-sf-service-all').click();
    await page.locator('#lx-sf-next').click();
    await expect(page.locator('#lx-sf-form')).toHaveAttribute(
      'data-step',
      'review',
    );
    // The form scrolls inside its own window: show the privacy note.
    await page
      .locator('#lx-sf-privacy')
      .evaluate(el => el.scrollIntoView({block: 'center'}));
    await capture(page, 'supplier-review-phone');
    await page.locator('#lx-sf-privacy').check();
    await page.locator('#lx-sf-next').click();
    await expect(page.locator('#lx-supplier-sent')).toBeVisible();
    await capture(page, 'supplier-sent-phone');
  });

  test('E7 · link no longer available (desktop)', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, offersData());
    await page.goto(`${lxUrl('proveedor')}#${'z'.repeat(43)}`);
    await expect(page.locator('#lx-supplier-gone')).toBeVisible();
    await capture(page, 'supplier-gone');
  });
});
