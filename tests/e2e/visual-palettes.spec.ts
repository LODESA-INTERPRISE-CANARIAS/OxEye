import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './logistics/mock-api';

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

/**
 * The hub (`#game-menu`) is a fixed overlay with its own scroll, so a
 * `fullPage` shot shows the document behind it, not the hub's content. Grow
 * the viewport to the hub's scroll height instead, shoot, and restore it.
 * With `fold`, also keep what the first screen shows (`<screen>-fold-…`).
 * With `picker` (Ajustes), choose each palette through the real radio so the
 * «Seleccionada» card matches the palette on screen.
 */
async function captureHub(
  page: Page,
  screen: string,
  {fold = false, picker = false}: {fold?: boolean; picker?: boolean} = {},
) {
  const base = page.viewportSize()!;
  for (const id of PALETTES) {
    if (picker) {
      await page.locator(`[data-palette-choice="${id}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('data-palette', id);
      // Shoot from the top, without the hover/focus left by the click.
      await page.mouse.move(0, 0);
      await page.locator('#game-menu').evaluate(el => (el.scrollTop = 0));
    } else {
      await applyPalette(page, id);
    }
    // Hub buttons transition their colours; let them land before the shot.
    await page.waitForTimeout(250);
    if (fold) {
      await page.screenshot({path: `${OUT}/${screen}-fold-${id}.png`});
    }
    const height = await page
      .locator('#game-menu')
      .evaluate(el => Math.ceil(el.scrollHeight));
    await page.setViewportSize({
      width: base.width,
      height: Math.max(base.height, height),
    });
    await page.waitForTimeout(50);
    await page.screenshot({path: `${OUT}/${screen}-${id}.png`});
    await page.setViewportSize(base);
  }
}

/** Hub viewports: desktop (Playwright default 1280×720) and a phone. */
const HUB_VIEWPORTS = [
  {suffix: '', size: {width: 1280, height: 720}},
  {suffix: '-phone', size: {width: 390, height: 844}},
] as const;

/** Opens a hub address with reduced motion, for stable shots. */
async function openHub(page: Page, path: string, h1: string | RegExp) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(path);
  await expect(page.locator('#game-menu h1')).toHaveText(h1);
}

async function createProject(page: Page) {
  await page.goto('/simulador');
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
  for (const vp of HUB_VIEWPORTS) {
    test.describe(`hub${vp.suffix}`, () => {
      test.use({viewport: vp.size});

      test(`home${vp.suffix}`, async ({page}) => {
        await openHub(page, '/', 'OxEye');
        await captureHub(page, `home${vp.suffix}`, {fold: true});
      });

      test(`simulator${vp.suffix}`, async ({page}) => {
        // Empty: no saved model, «Continuar» disabled with its hint.
        await openHub(page, '/simulador', 'Simulador');
        await expect(page.locator('#game-continue')).toBeDisabled();
        await captureHub(page, `simulator-empty${vp.suffix}`);

        // «Guardar y salir» → in-place «Sesión guardada».
        await page.locator('#game-exit').click();
        await expect(page.locator('#game-menu h1')).toHaveText(
          'Sesión guardada',
        );
        await captureHub(page, `saved${vp.suffix}`);

        // With a saved model: «Continuar» leads with its name. (Reload: the
        // store only learns that a model is saved at start-up, see hub.spec.)
        await page.reload();
        await expect(page.locator('#game-menu h1')).toHaveText('Simulador');
        await expect(page.locator('#game-continue')).toBeEnabled();
        await captureHub(page, `simulator-ready${vp.suffix}`);

        // And the Portada's Simulador card shows that model.
        await page.locator('#hub-back').click();
        await expect(page.locator('#game-menu h1')).toHaveText('OxEye');
        await captureHub(page, `home-ready${vp.suffix}`);
      });

      test(`settings${vp.suffix}`, async ({page}) => {
        await openHub(page, '/ajustes', 'Ajustes');
        await expect(
          page.locator('.palette-picker[role="radiogroup"]'),
        ).toBeVisible();
        await captureHub(page, `settings${vp.suffix}`, {picker: true});
        // Inline «Restablecer» confirmation.
        await page.locator('#prefs-reset').click();
        await expect(page.locator('#prefs-reset-confirm')).toBeVisible();
        await captureHub(page, `settings-confirm${vp.suffix}`, {picker: true});
      });

      test(`about${vp.suffix}`, async ({page}) => {
        await openHub(page, '/acerca', 'Acerca de OxEye');
        await captureHub(page, `about${vp.suffix}`);
      });

      test(`wizard${vp.suffix}`, async ({page}) => {
        await openHub(page, '/simulador/nuevo', /Qué quieres conseguir/);
        await expect(page.locator('#wizard-form')).toBeVisible();
        await captureHub(page, `wizard${vp.suffix}`, {fold: true});
      });
    });
  }

  test('home intro', async ({page}) => {
    // Mid-arrival frames of the symbol (no reduced motion), OxEye palette.
    await page.goto('/');
    await expect(page.locator('#game-menu h1')).toHaveText('OxEye');
    await page.waitForTimeout(400);
    await page.screenshot({path: `${OUT}/home-intro-400ms.png`});
    await page.waitForTimeout(1400);
    await page.screenshot({path: `${OUT}/home-intro-done.png`});
  });

  test('home after gestor', async ({page}) => {
    // Once the Gestor has loaded, its stylesheet also applies to the hub's
    // `.lx` root: the Portada must still look right afterwards.
    await mockApi(page);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/');
    await page.locator('#game-logistics').click();
    await expect(page.locator('#logistics-app')).toBeVisible({timeout: 20_000});
    await expect(page.locator('#lx-gate-exit')).toBeVisible({timeout: 20_000});
    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect(page.locator('#game-logistics')).toBeFocused();
    await captureHub(page, 'home-after-gestor');
    // The Ajustes screen with the same stylesheet loaded.
    await page.locator('#game-settings').click();
    await expect(page.locator('#game-menu h1')).toHaveText('Ajustes');
    await captureHub(page, 'settings-after-gestor');
  });

  test('workspace', async ({page}) => {
    await createProject(page);
    await captureAll(page, 'workspace');
  });

  test('logistics', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    const brand = page.locator('.lx-sidebar .lx-brand');
    await expect(brand).toBeVisible();
    for (const id of PALETTES) {
      await applyPalette(page, id);
      await page.screenshot({path: `${OUT}/logistics-${id}.png`});
      // Close-up of the brand block, to judge the symbol at its real size.
      await brand.screenshot({path: `${OUT}/logistics-brand-${id}.png`});
    }
    // The symbol blown up, to check its geometry against the supplied SVG.
    const mark = page.locator('.lx-sidebar .lx-eyemark');
    await mark.evaluate(el => {
      el.setAttribute('width', '320');
      el.setAttribute('height', '320');
    });
    await mark.screenshot({path: `${OUT}/logistics-symbol-large.png`});
  });

  test('logistics loading', async ({page}) => {
    // Hold the lazy module so the loading layer stays on screen.
    await page.route(/logistics\/LogisticsApp/, () => new Promise(() => {}));
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/#logistica');
    await expect(page.locator('#logistics-loading')).toBeVisible();
    await expect(page.locator('#logistics-loading .lx-boot__title')).toHaveText(
      'OxEye',
    );
    await captureAll(page, 'logistics-loading');
  });
});
