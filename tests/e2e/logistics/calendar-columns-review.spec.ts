import {expect, test, type Page} from '@playwright/test';
import {fiveVenueData} from './calendar-columns-fixtures';
import {mockApi, signIn} from './mock-api';
import {DAY, fixClock, planData} from './plan-fixtures';

/**
 * Visual review of the day view by venue (Revisión 1): two and five venues,
 * expanded and folded, a venue's warnings open, on a PC and on a phone in
 * landscape, in a light and a dark palette (plus one more). Screenshots only;
 * behaviour is covered by calendar-columns.spec.ts.
 *
 * Output: test-results/visual/logistics-columns-<screen>-<palette>.png
 * Run: npx playwright test tests/e2e/logistics/calendar-columns-review.spec.ts
 */

const PALETTES = ['oxeye', 'noctis', 'territorio'] as const;
const OUT = 'test-results/visual';
const DESKTOP = {width: 1440, height: 900};
const LANDSCAPE = {width: 844, height: 390};

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.describe.configure({timeout: 120_000});
test.beforeEach(async ({page}) => fixClock(page));

async function capture(page: Page, screen: string) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/logistics-columns-${screen}-${id}.png`,
    });
  }
}

async function scrollTo(page: Page, hour: number) {
  await page.waitForTimeout(150);
  await page.evaluate(h => {
    const el = document.querySelector<HTMLElement>('.lx-tl__scroller');
    if (!el) return;
    const px = parseFloat(
      getComputedStyle(el).getPropertyValue('--lx-hour') || '64',
    );
    el.scrollTop = h * px;
  }, hour);
}

async function openDay(
  page: Page,
  data: ReturnType<typeof planData>,
  landscape = false,
) {
  await page.setViewportSize(landscape ? LANDSCAPE : DESKTOP);
  await mockApi(page, data);
  if (landscape) {
    await signIn(page);
    await page.evaluate(h => {
      window.location.hash = h;
    }, `#logistica/calendario/${DAY}`);
  } else {
    await signIn(page, 'Elvis', `#logistica/calendario/${DAY}`);
  }
  await expect(page.locator('#lx-timeline')).toBeVisible();
  await scrollTo(page, 7.5);
}

/** Folds a venue; Playwright's click scrolls the sticky header, so re-scroll. */
async function fold(page: Page, key: string) {
  await page
    .locator(`#lx-timeline .lx-tl__head[data-col="${key}"] .lx-tl__fold`)
    .click();
  await scrollTo(page, 7.5);
}

test.describe('Gestor logístico · revisión visual de columnas', () => {
  test('two venues, desktop', async ({page}) => {
    await openDay(page, planData());
    await capture(page, 'two-desktop');
    await fold(page, 'v5');
    await capture(page, 'two-desktop-folded');
  });

  test('five venues, desktop', async ({page}) => {
    await openDay(page, fiveVenueData());
    await capture(page, 'five-desktop');
    await fold(page, 'v5');
    await fold(page, 'none');
    await capture(page, 'five-desktop-folded');
    await page
      .locator('#lx-timeline .lx-tl__head[data-col="v1"] .lx-tl__warnbadge')
      .click();
    await expect(page.locator('#lx-tl-warnpop')).toBeVisible();
    await capture(page, 'five-desktop-warnings');
  });

  test('five venues, phone landscape', async ({page}) => {
    await openDay(page, fiveVenueData(), true);
    await capture(page, 'five-landscape');
    await page.locator('#lx-tl-next').click();
    await page.waitForTimeout(400);
    await capture(page, 'five-landscape-next');
    await page
      .locator('.lx-tl__scroller')
      .evaluate(el => el.scrollTo({left: 0}));
    await fold(page, 'v5');
    await fold(page, 'v2');
    await capture(page, 'five-landscape-folded');
    await page
      .locator('#lx-timeline .lx-tl__head[data-col="v1"] .lx-tl__warnbadge')
      .click();
    await capture(page, 'five-landscape-warnings');
  });

  test('five venues, phone landscape, smallest scale', async ({page}) => {
    await openDay(page, fiveVenueData(), true);
    const out = page.locator('#lx-cal-zoom-out');
    while (await out.isEnabled()) await out.click();
    await scrollTo(page, 7);
    await capture(page, 'five-landscape-small-scale');
  });
});
