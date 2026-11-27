import {expect, test, type Page} from '@playwright/test';
import {persistDefaultProjectAndContinue} from './helpers';

/** Steps 1–3: launch menu, enter workspace, main workspace elements. */
async function enterWorkspaceFromLaunchMenu(page: Page): Promise<void> {
  await page.goto('/');

  // 1. Launch screen should be visible
  const gameMenu = page.locator('#game-menu');
  await expect(gameMenu).toBeVisible();
  await expect(gameMenu.locator('h1')).toHaveText('OxEye');

  // 2. Save the default session («Salir»), reload and click "Continuar" to
  // enter the workspace («Continuar» is disabled until a project is saved)
  await persistDefaultProjectAndContinue(page);
  await expect(gameMenu).toBeHidden();

  // 3. Verify main workspace elements & SVG map
  await expect(page.locator('#place-title')).toHaveText('Plaza del Cristo');
  await expect(page.locator('#drawing')).toBeVisible();
  await expect(page.locator('#scenario-layer g.map-item').first()).toBeVisible();
}

/** Steps 5–7: navigation rail panels and dialogs. */
async function switchPanelsAndOpenDialogs(page: Page): Promise<void> {
  // 5. Switch navigation rail panels (Planificar -> Simular -> Revisar)
  await page.locator('[data-panel="simulate"]').click();
  await expect(page.locator('#panel-kicker')).toHaveText('02 / SIMULACIÓN');
  await expect(page.locator('.director-controls')).toBeVisible();

  await page.locator('[data-panel="review"]').click();
  await expect(page.locator('#panel-kicker')).toHaveText('03 / REVISIÓN');

  await page.locator('[data-panel="design"]').click();
  await expect(page.locator('#panel-kicker')).toHaveText('01 / PLANIFICACIÓN');

  // 6. Open Demand dialog and calculate.
  // The dialog is now tabbed: submitting #demand-form switches to the
  // «Necesidades» tab, whose results heading replaced the former
  // «Primera propuesta para este público» (DemandDialog.tsx).
  await page.locator('#demand').click();
  const demandDialog = page.locator('#demand-dialog');
  await expect(demandDialog).toBeVisible();
  await expect(demandDialog.locator('#demand-results')).toHaveCount(0);
  await demandDialog.locator('#demand-form button[type="submit"]').click();
  await expect(demandDialog.locator('#demand-results h3').first()).toHaveText(
    'Necesidades calculadas y balance frente al inventario'
  );
  await demandDialog.locator('form[method="dialog"] button').click();
  await expect(demandDialog).toBeHidden();

  // 7. Verify Reference Edition 21 features: safety banner, risk dialog, programme dialog, developer reference
  await expect(page.locator('#safety-banner')).toBeVisible();
  await page.locator('#risk-button').click();
  const riskDialog = page.locator('#risk-dialog');
  await expect(riskDialog).toBeVisible();
  await expect(riskDialog.locator('h2')).toHaveText('Revisión de riesgos');
  await riskDialog.locator('#risk-close').click();
  await expect(riskDialog).toBeHidden();

  await page.locator('#programme').click();
  const progDialog = page.locator('#programme-dialog');
  await expect(progDialog).toBeVisible();
  await progDialog.locator('#programme-plan').click();
  await expect(progDialog.locator('#programme-result h3')).toHaveText(
    'Propuesta de programa'
  );
  await progDialog.locator('form[method="dialog"] button').click();
  await expect(progDialog).toBeHidden();
}

test.describe('Ojo de Buey (OxEye) E2E Application Flow', () => {
  // FIXME: obsolete by product decision (2026-11-25). Plaza del Cristo is
  // always the default venue; other locations are chosen as a custom map when
  // creating a new model, not by switching between preset venues. `VenueTabs`
  // (the only producer of `[data-venue]`) is not rendered and `#venue-select`
  // (PhaseStrip.tsx) only offers «cristo». Kept as fixme until its removal is
  // decided; the remaining steps are covered by the test below, and custom-map
  // creation by onboarding-spawns.spec.ts.
  test.fixme(
    'renders main launch menu, enters workspace, switches venues, and opens dialogs',
    async ({page}) => {
      await enterWorkspaceFromLaunchMenu(page);

      // 4. Switch venue to Parque de La Vega and back to El Cristo
      await page.locator('[data-venue="vega"]').click();
      await expect(page.locator('#place-title')).toHaveText('Parque de La Vega');
      await page.locator('[data-venue="cristo"]').click();
      await expect(page.locator('#place-title')).toHaveText('Plaza del Cristo');

      await switchPanelsAndOpenDialogs(page);
    }
  );

  test('renders main launch menu, enters workspace, and opens dialogs (single venue)', async ({
    page,
  }) => {
    await enterWorkspaceFromLaunchMenu(page);
    await switchPanelsAndOpenDialogs(page);
  });
});
