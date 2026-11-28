import {expect, type Page} from '@playwright/test';

/** Submit button of the "Crear nuevo modelo" wizard (label changes per step). */
export const WIZARD_SUBMIT = '#wizard-form button[type="submit"]';

/**
 * Goes to the hub's «Simulador» screen (`/simulador`) through the real UI:
 * from the Portada with «Simulador», from another inner screen (Ajustes,
 * Acerca de) via «Portada» first. Must be called while the hub is visible.
 */
export async function openSimulatorSection(page: Page): Promise<void> {
  const menu = page.locator('#game-menu');
  await expect(menu).toBeVisible();
  const route = await menu.getAttribute('data-hub-route');
  if (route === 'simulator') return;
  if (route !== 'home') {
    await page.locator('#hub-back').click();
    await expect(menu).toHaveAttribute('data-hub-route', 'home');
  }
  await page.locator('#game-simulator').click();
  await expect(menu).toHaveAttribute('data-hub-route', 'simulator');
  await expect(page).toHaveURL(/\/simulador$/);
}

/**
 * Current first-run flow: with empty storage the app still holds the bundled
 * default project in memory (three La Laguna venues, Cristo example layout),
 * but «Continuar» stays disabled until something has been saved
 * (`hasSavedProject`). «Guardar y salir» on the Simulador screen saves that
 * session, so after a reload «Continuar» is enabled and opens the default
 * project.
 *
 * This reproduces, through the real UI, the starting state the workspace
 * specs were written against. It must be called while the hub is visible
 * (any screen but the wizard); it walks to «Simulador» first.
 */
export async function persistDefaultProjectAndContinue(
  page: Page,
): Promise<void> {
  const menu = page.locator('#game-menu');
  await openSimulatorSection(page);
  await page.locator('#game-exit').click();
  await expect(menu.locator('h1')).toHaveText('Sesión guardada');

  await page.reload();
  const continueBtn = page.locator('#game-continue');
  await expect(continueBtn).toBeEnabled();
  await continueBtn.click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/\/simulador\/modelo$/);
}

/** Opens the app from empty storage and enters the workspace with the default project. */
export async function openWorkspaceWithDefaultProject(
  page: Page,
): Promise<void> {
  await page.goto('/');
  await persistDefaultProjectAndContinue(page);
}

/**
 * Wizard step 1/5 («¿Qué quieres conseguir con este evento?»). The free-text
 * SMART form (`#smart-specific`, …) was replaced by an objective-card picker
 * with two sub-steps: cards (three objectives preselected by default) and
 * «Jerarquía e hipótesis». The submit button advances the sub-step first and
 * then the wizard step. Keeps the default objective selection.
 */
export async function completeObjectivesStep(page: Page): Promise<void> {
  const eyebrow = page.locator('#game-menu .game-eyebrow');
  await expect(eyebrow).toContainText('1 / 5');
  // Scoped to the wizard: ObjectivesConfigurator is also mounted in
  // #objectives-dialog, so ids such as #smart-cards-grid are duplicated.
  const wizard = page.locator('#wizard-form');
  await expect(wizard.locator('#smart-cards-grid')).toBeVisible();
  await expect(
    wizard.locator('[data-smart-card][aria-pressed="true"]').first(),
  ).toBeVisible();

  await page.locator(WIZARD_SUBMIT).click();
  await expect(wizard.locator('#smart-hypotheses')).toBeVisible();

  await page.locator(WIZARD_SUBMIT).click();
  await expect(eyebrow).toContainText('2 / 5');
}
