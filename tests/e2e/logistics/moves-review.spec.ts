import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './mock-api';
import {DAY, fixClock, planData, PLAZA_CRISTO} from './plan-fixtures';

/**
 * Visual review of Revisión 1 · E2 moves: a block lifted outside the opening
 * hours, the move preview, the conflict exits and the accepted list, on a PC
 * and on a phone, in a light and a dark palette. Screenshots only; behaviour
 * is covered by moves.spec.ts.
 *
 * Output: test-results/visual/logistics-moves-<screen>-<palette>.png
 * Run: npx playwright test tests/e2e/logistics/moves-review.spec.ts
 */

const PALETTES = ['oxeye', 'noctis'] as const;
const OUT = 'test-results/visual';
const DESKTOP = {width: 1440, height: 900};
const PHONE = {width: 390, height: 844};
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
    await page.screenshot({path: `${OUT}/logistics-moves-${screen}-${id}.png`});
  }
}

const data = () => {
  const d = planData();
  return {
    ...d,
    venues: d.venues.map(v =>
      v.id === PLAZA_CRISTO.id
        ? {...v, openingHours: {opensAt: '08:00', closesAt: '20:00'}}
        : v,
    ),
  };
};

async function open(page: Page, size: {width: number; height: number}) {
  await page.setViewportSize(size);
  await mockApi(page, data());
  if (size === LANDSCAPE) {
    await signIn(page);
    await page.evaluate(h => {
      window.location.hash = h;
    }, `#logistica/calendario/${DAY}`);
  } else {
    await signIn(page, 'Elvis', `#logistica/calendario/${DAY}`);
  }
}

async function scrollTo(page: Page, hour: number) {
  await page.evaluate(h => {
    const el = document.querySelector<HTMLElement>('.lx-tl__scroller');
    if (!el) return;
    const px = parseFloat(
      getComputedStyle(el).getPropertyValue('--lx-hour') || '64',
    );
    el.scrollTop = h * px;
  }, hour);
}

async function lift(page: Page, id: string, presses: number) {
  await page
    .locator(`#lx-timeline .lx-tl__block[data-task-id="${id}"]`)
    .focus();
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Shift+Alt+ArrowDown');
  }
}

async function warnings(page: Page) {
  const box = page.locator('#lx-day-warnings');
  if (!(await box.isVisible())) {
    await page.locator('#lx-day-warnings-toggle').click();
  }
  return box;
}

async function acceptOverlap(page: Page) {
  const box = await warnings(page);
  await box
    .locator('.lx-warning[data-warning="venue_overlap"] [data-exit="keep"]')
    .click();
  await page
    .locator('#lx-keep-reason')
    .fill('El sonido entra por la calle lateral; no coincide con la grúa.');
}

test.describe('Gestor logístico · revisión visual de cambios de hora', () => {
  test('desktop: lifted block, preview, exits, keep and accepted', async ({
    page,
  }) => {
    await open(page, DESKTOP);
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await scrollTo(page, 14);
    await lift(page, 't3', 4);
    await expect(page.locator('.lx-tl__dragtime')).toHaveClass(/is-refused/);
    await scrollTo(page, 14);
    await capture(page, 'drag-refused-desktop');

    await page.keyboard.press('Shift+Alt+ArrowUp');
    await page.keyboard.press('Shift+Alt+ArrowUp');
    await capture(page, 'drag-desktop');
    await page.keyboard.press('Enter');
    await expect(page.locator('#lx-move-sheet')).toBeVisible();
    await capture(page, 'preview-desktop');
    await page.locator('#lx-move-cancel').click();

    await warnings(page);
    await capture(page, 'exits-desktop');
    await page
      .locator('.lx-warning[data-warning="venue_overlap"] [data-exit="delay"]')
      .click();
    await expect(page.locator('#lx-move-sheet')).toBeVisible();
    await capture(page, 'preview-exit-desktop');
    await page.locator('#lx-move-cancel').click();

    await acceptOverlap(page);
    await capture(page, 'keep-desktop');
    await page.locator('#lx-keep-confirm').click();
    await expect(page.locator('#lx-keep-sheet')).toHaveCount(0);
    await warnings(page);
    await page.locator('.lx-warning--accepted').scrollIntoViewIfNeeded();
    await capture(page, 'accepted-desktop');
  });

  test('phone: exits, preview and accepted in the day list', async ({page}) => {
    await open(page, PHONE);
    await warnings(page);
    await capture(page, 'exits-phone');
    await page
      .locator(
        '.lx-warning[data-warning="venue_overlap"] [data-exit="advance"]',
      )
      .click();
    await expect(page.locator('#lx-move-sheet')).toBeVisible();
    await capture(page, 'preview-phone');
    await page.locator('#lx-move-cancel').click();
    await acceptOverlap(page);
    await page.locator('#lx-keep-confirm').click();
    await expect(page.locator('#lx-keep-sheet')).toHaveCount(0);
    await warnings(page);
    await page.locator('.lx-warning--accepted').scrollIntoViewIfNeeded();
    await capture(page, 'accepted-phone');
  });

  test('phone landscape: a lifted block on the timeline', async ({page}) => {
    await open(page, LANDSCAPE);
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await scrollTo(page, 11);
    await lift(page, 't2', 1);
    await scrollTo(page, 11);
    await capture(page, 'drag-landscape');
  });
});
