import {expect, test} from '@playwright/test';

test.describe('Ojo de Buey (OxEye) E2E Application Flow', () => {
  test('renders main launch menu, enters workspace, switches venues, and opens dialogs', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Launch screen should be visible
    const gameMenu = page.locator('#game-menu');
    await expect(gameMenu).toBeVisible();
    await expect(gameMenu.locator('h1')).toHaveText('Ojo de Buey');

    // 2. Click "Continuar" to enter workspace
    await page.locator('#game-continue').click();
    await expect(gameMenu).toBeHidden();

    // 3. Verify main workspace elements & SVG map
    await expect(page.locator('#place-title')).toHaveText('Plaza del Cristo');
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(page.locator('#scenario-layer g.map-item').first()).toBeVisible();

    // 4. Switch venue to Parque de La Vega and back to El Cristo
    await page.locator('[data-venue="vega"]').click();
    await expect(page.locator('#place-title')).toHaveText('Parque de La Vega');
    await page.locator('[data-venue="cristo"]').click();
    await expect(page.locator('#place-title')).toHaveText('Plaza del Cristo');

    // 5. Switch navigation rail panels (Planificar -> Simular -> Revisar)
    await page.locator('[data-panel="simulate"]').click();
    await expect(page.locator('#panel-kicker')).toHaveText('02 / SIMULACIÓN');
    await expect(page.locator('.director-controls')).toBeVisible();

    await page.locator('[data-panel="review"]').click();
    await expect(page.locator('#panel-kicker')).toHaveText('03 / REVISIÓN');

    await page.locator('[data-panel="design"]').click();
    await expect(page.locator('#panel-kicker')).toHaveText('01 / PLANIFICACIÓN');

    // 6. Open Demand dialog and calculate
    await page.locator('#demand').click();
    const demandDialog = page.locator('#demand-dialog');
    await expect(demandDialog).toBeVisible();
    await demandDialog.locator('#demand-form button[type="submit"]').click();
    await expect(demandDialog.locator('#demand-results h3').first()).toHaveText(
      'Primera propuesta para este público'
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
  });
});
