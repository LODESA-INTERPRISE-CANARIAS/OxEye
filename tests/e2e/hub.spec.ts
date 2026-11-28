import {expect, test, type Page} from '@playwright/test';
import {
  completeObjectivesStep,
  openWorkspaceWithDefaultProject,
  WIZARD_SUBMIT,
} from './helpers';
import {lxUrl, lxUrlRe} from './logistics/address';
import {mockApi} from './logistics/mock-api';

/**
 * OxEye hub (plan `portada-oxeye`): clean addresses for Portada, Simulador,
 * wizard, workspace, Ajustes and Acerca de; Back / Forward; canonical paths;
 * the workspace address; the Gestor entry; Ajustes persistence and reset;
 * reduced motion on the Portada symbol.
 */

const menu = (page: Page) => page.locator('#game-menu');
const title = (page: Page) => page.locator('#game-menu h1');
const pathOf = (page: Page) => new URL(page.url()).pathname;

/** Saves the in-memory default model through «Guardar y salir». */
async function saveDefaultModel(page: Page): Promise<void> {
  await page.goto('/simulador');
  await page.locator('#game-exit').click();
  await expect(title(page)).toHaveText('Sesión guardada');
}

test.describe('Hub · direcciones', () => {
  const SCREENS = [
    {path: '/', h1: 'OxEye', tab: 'OxEye', route: 'home'},
    {
      path: '/simulador',
      h1: 'Simulador',
      tab: 'Simulador · OxEye',
      route: 'simulator',
    },
    {
      path: '/simulador/nuevo',
      h1: '¿Qué quieres conseguir con este evento?',
      tab: 'Nuevo modelo · OxEye',
      route: 'new-model',
    },
    {
      path: '/ajustes',
      h1: 'Ajustes',
      tab: 'Ajustes · OxEye',
      route: 'settings',
    },
    {
      path: '/acerca',
      h1: 'Acerca de OxEye',
      tab: 'Acerca de OxEye',
      route: 'about',
    },
  ];

  for (const s of SCREENS) {
    test(`opening ${s.path} directly shows that screen`, async ({page}) => {
      await page.goto(s.path);
      await expect(menu(page)).toBeVisible();
      await expect(menu(page)).toHaveAttribute('data-hub-route', s.route);
      await expect(title(page)).toHaveText(s.h1);
      await expect(page).toHaveTitle(s.tab);
      expect(pathOf(page)).toBe(s.path);
    });
  }

  test('Back / Forward move between Portada, Simulador and Ajustes', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(title(page)).toHaveText('OxEye');

    await page.locator('#game-simulator').click();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(title(page)).toHaveText('Simulador');
    // Focus moves to the new screen's title.
    await expect(title(page)).toBeFocused();

    await page.locator('#hub-back').click();
    await expect(page).toHaveURL(/\/$/);
    await page.locator('#game-settings').click();
    await expect(page).toHaveURL(/\/ajustes$/);
    await expect(title(page)).toHaveText('Ajustes');
    await expect(title(page)).toBeFocused();
    await expect(page).toHaveTitle('Ajustes · OxEye');

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(title(page)).toHaveText('OxEye');
    await page.goBack();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(title(page)).toHaveText('Simulador');
    await expect(title(page)).toBeFocused();
    await expect(page).toHaveTitle('Simulador · OxEye');

    await page.goForward();
    await expect(title(page)).toHaveText('OxEye');
    await page.goForward();
    await expect(page).toHaveURL(/\/ajustes$/);
    await expect(title(page)).toHaveText('Ajustes');
  });

  test('Acerca de opens from the Portada footer and «Volver» returns', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-about').click();
    await expect(page).toHaveURL(/\/acerca$/);
    await expect(title(page)).toHaveText('Acerca de OxEye');
    // Methodological honesty stays visible on this screen.
    await expect(menu(page)).toContainText('no certifica');
    await page.locator('#game-back').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(title(page)).toHaveText('OxEye');
  });

  test('an unknown address is replaced by the Portada', async ({page}) => {
    await page.goto('/no-existe/de-verdad?x=1');
    await expect(title(page)).toHaveText('OxEye');
    expect(pathOf(page)).toBe('/');
    // The query string survives the rewrite.
    expect(new URL(page.url()).search).toBe('?x=1');
  });

  for (const [from, to, h1] of [
    ['/ajustes/', '/ajustes', 'Ajustes'],
    ['/AJUSTES', '/ajustes', 'Ajustes'],
    ['/simulador//', '/simulador', 'Simulador'],
    ['/index.html', '/', 'OxEye'],
  ] as const) {
    test(`${from} is canonicalised to ${to}`, async ({page}) => {
      await page.goto(from);
      await expect(title(page)).toHaveText(h1);
      expect(pathOf(page)).toBe(to);
    });
  }

  test('«Volver al simulador» on the wizard returns to /simulador', async ({
    page,
  }) => {
    await page.goto('/simulador');
    await page.locator('#game-new').click();
    await expect(page).toHaveURL(/\/simulador\/nuevo$/);
    const back = page.locator('#wizard-back');
    await expect(back).toHaveText(/Volver al simulador/);
    await back.click();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(title(page)).toHaveText('Simulador');
    // It stepped back instead of pushing: Forward reopens the wizard and
    // Back from /simulador does not.
    await page.goForward();
    await expect(page).toHaveURL(/\/simulador\/nuevo$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/simulador$/);
  });

  test('«Volver al simulador» after a direct link replaces the wizard entry', async ({
    page,
  }) => {
    await page.goto('/');
    await page.goto('/simulador/nuevo');
    await page.locator('#wizard-back').click();
    await expect(page).toHaveURL(/\/simulador$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Hub · espacio de trabajo (/simulador/modelo)', () => {
  test('reload without a saved model goes to /simulador', async ({page}) => {
    await page.goto('/simulador/modelo');
    await expect(menu(page)).toBeVisible();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(title(page)).toHaveText('Simulador');
    await expect(page.locator('#game-continue')).toBeDisabled();
  });

  test('loading /simulador/modelo with a saved model opens the workspace', async ({
    page,
  }) => {
    await saveDefaultModel(page);
    await page.goto('/simulador/modelo');
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(page).toHaveURL(/\/simulador\/modelo$/);

    // And a reload there keeps it open.
    await page.reload();
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#drawing')).toBeVisible();
  });

  test('Back from the workspace shows Simulador; Forward resumes the model', async ({
    page,
  }) => {
    await openWorkspaceWithDefaultProject(page);
    await expect(page.locator('#drawing')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(menu(page)).toBeVisible();
    await expect(title(page)).toHaveText('Simulador');
    await expect(page.locator('#game-continue')).toBeEnabled();

    await page.goForward();
    await expect(page).toHaveURL(/\/simulador\/modelo$/);
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#drawing')).toBeVisible();
  });

  test('«Menú» in the workspace header lands on /simulador', async ({page}) => {
    await openWorkspaceWithDefaultProject(page);
    await page.locator('#main-menu').click();
    await expect(menu(page)).toBeVisible();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(title(page)).toHaveText('Simulador');
    await expect(title(page)).toBeFocused();
  });

  test('«Cargar modelo» opens the file picker and an exported model opens the workspace', async ({
    page,
  }) => {
    await saveDefaultModel(page);
    // Export a real project file from «Sesión guardada».
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#game-export').click(),
    ]);
    const file = await download.path();
    expect(file).toBeTruthy();
    await page.locator('#game-back').click();
    await expect(title(page)).toHaveText('Simulador');

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#game-load').click(),
    ]);
    await chooser.setFiles(file!);
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(page).toHaveURL(/\/simulador\/modelo$/);
  });

  test('«Guardar y salir» then «Volver» offers «Continuar» without a reload', async ({
    page,
  }) => {
    // An explicit save marks the project as saved (SimulatorSection), so the
    // Simulador offers «Continuar» straight away.
    await saveDefaultModel(page);
    await page.locator('#game-back').click();
    await expect(title(page)).toHaveText('Simulador');
    await expect(page.locator('#game-continue')).toBeEnabled({timeout: 2000});
  });

  test('creating a model replaces the wizard entry: Back lands on /simulador', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-simulator').click();
    await page.locator('#game-new').click();
    await expect(page).toHaveURL(/\/simulador\/nuevo$/);

    await completeObjectivesStep(page);
    const next = page.locator(WIZARD_SUBMIT);
    for (const step of ['3 / 5', '4 / 5', '5 / 5']) {
      await next.click();
      await expect(page.locator('#game-menu .game-eyebrow')).toContainText(
        step,
      );
    }
    await next.click();
    await expect(menu(page)).toBeHidden();
    await expect(page).toHaveURL(/\/simulador\/modelo$/);
    // First model: the guided tour starts; close it.
    await page.locator('#tour-close').click();

    await page.goBack();
    await expect(page).toHaveURL(/\/simulador$/);
    await expect(menu(page)).toBeVisible();
    await expect(title(page)).toHaveText('Simulador');
    await expect(page.locator('#game-continue')).toBeEnabled();
  });
});

test.describe('Hub · Gestor logístico', () => {
  test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

  test('opens from the Portada and closing returns to / with focus on the card', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#game-logistics').click();
    // The Gestor is a lazy chunk; a cold dev server compiles it on demand.
    await expect(page.locator('#logistics-app')).toBeVisible({timeout: 15000});
    await expect(page).toHaveURL(lxUrlRe());
    await expect(page).toHaveTitle('Gestor logístico · OxEye');

    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    expect(pathOf(page)).toBe('/');
    await expect(title(page)).toHaveText('OxEye');
    await expect(page.locator('#game-logistics')).toBeFocused();
    await expect(page).toHaveTitle('OxEye');
  });

  test('a legacy #logistica on any hub path opens the Gestor at its new address', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/ajustes#logistica');
    // The Gestor is a lazy chunk; a cold dev server compiles it on demand.
    await expect(page.locator('#logistics-app')).toBeVisible({timeout: 15000});
    await expect(menu(page)).toHaveAttribute('inert', '');
    await expect(page).toHaveURL(lxUrlRe());

    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => pathOf(page)).toBe('/');
    expect(new URL(page.url()).hash).toBe('');
    await expect(title(page)).toHaveText('OxEye');
  });

  test('/gestor-logistico opens the Gestor directly; closing returns to /', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto(lxUrl());
    await expect(page.locator('#logistics-app')).toBeVisible({timeout: 15000});
    await expect(menu(page)).toHaveAttribute('inert', '');
    await expect(page).toHaveTitle('Gestor logístico · OxEye');

    await page.locator('#lx-gate-exit').click();
    await expect(page.locator('#logistics-app')).toHaveCount(0);
    await expect.poll(() => pathOf(page)).toBe('/');
    expect(new URL(page.url()).hash).toBe('');
    await expect(title(page)).toHaveText('OxEye');
  });
});

test.describe('Hub · Ajustes', () => {
  test('changes apply at once and persist after a reload', async ({page}) => {
    await page.goto('/ajustes');
    await page.locator('[data-palette-choice="noctis"]').click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'noctis',
    );
    await page.locator('#game-motion').check();
    await page.locator('#game-help').uncheck();
    await page.locator('#game-speed').selectOption('10');
    await expect(page.locator('.hub-status')).toContainText(
      'Cambios guardados en este dispositivo',
    );

    await page.reload();
    await expect(title(page)).toHaveText('Ajustes');
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'noctis',
    );
    await expect(
      page.locator('[data-palette-choice="noctis"]'),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#game-motion')).toBeChecked();
    await expect(page.locator('#game-help')).not.toBeChecked();
    await expect(page.locator('#game-speed')).toHaveValue('10');

    // «Listo» goes back to the Portada.
    await page.locator('#prefs-save').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(title(page)).toHaveText('OxEye');
  });

  test('«Restablecer ajustes» asks first, can be cancelled, and resets to defaults', async ({
    page,
  }) => {
    await page.goto('/ajustes');
    await page.locator('[data-palette-choice="bendy"]').click();
    await page.locator('#game-motion').check();
    await page.locator('#game-speed').selectOption('600');

    // Cancel: nothing changes and focus returns to the button.
    await page.locator('#prefs-reset').click();
    await expect(page.locator('#prefs-reset-confirm')).toBeVisible();
    await expect(page.locator('#prefs-reset-cancel')).toBeFocused();
    await page.locator('#prefs-reset-cancel').click();
    await expect(page.locator('#prefs-reset-confirm')).toHaveCount(0);
    await expect(page.locator('#prefs-reset')).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'bendy');

    // Confirm: palette and preferences back to defaults.
    await page.locator('#prefs-reset').click();
    await page.locator('#prefs-reset-confirm').click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'oxeye');
    await expect(page.locator('#game-motion')).not.toBeChecked();
    await expect(page.locator('#game-help')).toBeChecked();
    await expect(page.locator('#game-speed')).toHaveValue('60');
    await expect(page.locator('.hub-status')).toContainText(
      'Ajustes restablecidos',
    );

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'oxeye');
    await expect(page.locator('#game-motion')).not.toBeChecked();
    await expect(page.locator('#game-speed')).toHaveValue('60');
  });

  test('a saved model survives «Restablecer ajustes»', async ({page}) => {
    await saveDefaultModel(page);
    await page.goto('/ajustes');
    await page.locator('#prefs-reset').click();
    await page.locator('#prefs-reset-confirm').click();
    await page.goto('/simulador');
    await expect(page.locator('#game-continue')).toBeEnabled();
  });
});

test.describe('Hub · movimiento reducido', () => {
  const irisAnimation = (page: Page) =>
    page
      .locator('.hub-symbol__iris')
      .evaluate(el => getComputedStyle(el).animationName);

  test('the Portada symbol animates by default', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('.hub-symbol__iris')).toBeAttached();
    expect(await irisAnimation(page)).not.toBe('none');
  });

  test('«Movimiento reducido» sets body.reduce-motion and stops the symbol', async ({
    page,
  }) => {
    await page.goto('/ajustes');
    await expect(page.locator('body')).not.toHaveClass(/reduce-motion/);
    await page.locator('#game-motion').check();
    await expect(page.locator('#game-motion')).toHaveAttribute(
      'role',
      'switch',
    );
    await expect(page.locator('body')).toHaveClass(/reduce-motion/);

    await page.locator('#hub-back').click();
    await expect(title(page)).toHaveText('OxEye');
    expect(await irisAnimation(page)).toBe('none');

    // Also after a reload (the preference is persisted).
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/reduce-motion/);
    expect(await irisAnimation(page)).toBe('none');
  });

  test('the system setting prefers-reduced-motion stops the symbol too', async ({
    page,
  }) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/');
    await expect(page.locator('.hub-symbol__iris')).toBeAttached();
    expect(await irisAnimation(page)).toBe('none');
  });
});
