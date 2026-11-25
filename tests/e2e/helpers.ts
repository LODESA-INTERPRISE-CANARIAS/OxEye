import {expect, type Page} from '@playwright/test';

/** Submit button of the "Crear nuevo modelo" wizard (label changes per step). */
export const WIZARD_SUBMIT = '#wizard-form button[type="submit"]';

/**
 * Current first-run flow: with empty storage the app still holds the bundled
 * default project in memory (three La Laguna venues, Cristo example layout),
 * but «Continuar» stays disabled until something has been saved
 * (`hasSavedProject`). Choosing «Salir» on the main menu saves that session,
 * so after a reload «Continuar» is enabled and opens the default project.
 *
 * This reproduces, through the real UI, the starting state the workspace
 * specs were written against. It must be called while the main menu screen
 * is visible.
 */
export async function persistDefaultProjectAndContinue(page: Page): Promise<void> {
  const menu = page.locator('#game-menu');
  await expect(menu).toBeVisible();
  await page.locator('#game-exit').click();
  await expect(menu.locator('h1')).toHaveText('Sesión guardada');

  await page.reload();
  const continueBtn = page.locator('#game-continue');
  await expect(continueBtn).toBeEnabled();
  await continueBtn.click();
  await expect(menu).toBeHidden();
}

/** Opens the app from empty storage and enters the workspace with the default project. */
export async function openWorkspaceWithDefaultProject(page: Page): Promise<void> {
  await page.goto('/');
  await persistDefaultProjectAndContinue(page);
}

/**
 * OX-04: switches the editor to «Editar recinto» (venue mode). Venue-only
 * tools (subsoil, accesses, perimeter) are refused in «Editar distribución».
 */
export async function enterVenueMode(page: Page): Promise<void> {
  await page.locator('#ctx-edit-mode').selectOption('venue');
  await expect(page.locator('#ctx-edit-mode')).toHaveAttribute('data-mode', 'venue');
  await expect(page.locator('#venue-mode-banner')).toBeVisible();
}

/**
 * OX-04: leaves venue mode through «Terminar edición del recinto». When the
 * venue changed during the session the affected-layouts dialog opens; it is
 * closed here and its presence is asserted against `venueChanged`.
 */
export async function exitVenueMode(page: Page, venueChanged: boolean): Promise<void> {
  await page.locator('#venue-mode-exit').click();
  await expect(page.locator('#ctx-edit-mode')).toHaveAttribute('data-mode', 'layout');
  await expect(page.locator('#venue-mode-banner')).toHaveCount(0);
  const dialog = page.locator('#affected-dialog');
  if (venueChanged) {
    await expect(dialog).toBeVisible();
    await page.locator('#affected-close').click();
  }
  await expect(dialog).toBeHidden();
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
    wizard.locator('[data-smart-card][aria-pressed="true"]').first()
  ).toBeVisible();

  await page.locator(WIZARD_SUBMIT).click();
  await expect(wizard.locator('#smart-hypotheses')).toBeVisible();

  await page.locator(WIZARD_SUBMIT).click();
  await expect(eyebrow).toContainText('2 / 5');
}
