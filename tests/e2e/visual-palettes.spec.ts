import {expect, test, type Page} from '@playwright/test';

/**
 * Visual review harness: captures key screens in all six palettes so that
 * agents and reviewers can inspect layout, contrast and states as images.
 *
 * Output: test-results/visual/<screen>-<palette>.png (git-ignored).
 * Run one screen with: npx playwright test tests/e2e/visual-palettes.spec.ts -g "workspace"
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

async function applyPalette(page: Page, id: string) {
  await page.evaluate(p => {
    document.documentElement.dataset.palette = p;
  }, id);
  await expect(page.locator('html')).toHaveAttribute('data-palette', id);
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  );
  expect(bg, `--bg must be defined for palette ${id}`).not.toBe('');
}

async function captureAll(page: Page, screen: string) {
  for (const id of PALETTES) {
    await applyPalette(page, id);
    await page.screenshot({path: `${OUT}/${screen}-${id}.png`, fullPage: true});
  }
}

async function createProject(page: Page) {
  await page.goto('/');
  await expect(page.locator('#game-new')).toBeVisible();
  await page.locator('#game-new').click();
  // Default SMART priorities are preselected; keep them and walk the wizard.
  await expect(page.locator('#wizard-form')).toBeVisible();
  const next = page.locator('#wizard-form button[type="submit"]');
  const menu = page.locator('#game-menu');
  // Walk the wizard (it has sub-steps) until the workspace opens.
  for (let i = 0; i < 15 && (await menu.isVisible()); i++) {
    if (await next.isVisible()) await next.click();
    await page.waitForTimeout(200);
  }
  await expect(menu).toBeHidden();
  await expect(page.locator('#drawing')).toBeVisible();
  const tour = page.locator('#tour-close');
  if (await tour.isVisible()) await tour.click();
}

test.describe('Revisión visual por paleta', () => {
  test('menu', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('#game-new')).toBeVisible();
    await captureAll(page, 'menu');
  });

  test('settings', async ({page}) => {
    await page.goto('/');
    await page.click('#game-settings');
    await expect(
      page.locator('.palette-picker[role="radiogroup"]'),
    ).toBeVisible();
    await captureAll(page, 'settings');
  });

  test('wizard', async ({page}) => {
    await page.goto('/');
    await page.locator('#game-new').click();
    await expect(page.locator('#wizard-form')).toBeVisible();
    await captureAll(page, 'wizard');
  });

  test('workspace', async ({page}) => {
    await createProject(page);
    await captureAll(page, 'workspace');
  });
});
