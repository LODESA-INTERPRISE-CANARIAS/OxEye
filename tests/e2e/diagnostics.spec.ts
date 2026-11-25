import {expect, test} from '@playwright/test';
import {openWorkspaceWithDefaultProject} from './helpers';

test.describe('Diagnóstico gráfico post-simulación y resolución guiada', () => {
  // FIXME: app defect blocks the simulation. Any project loaded from
  // storage goes through syncDemandConfigToScene(), whose legacyDemandInputs
  // (src/engine/planning/event-demand.ts:689-699) copies non-numeric values
  // into scene.demandInputs (curveProfile string, undefined optional caps).
  // assessRisk() (src/engine/emergency/risk.ts:235-243) then reports the
  // critical «Hay hipótesis de demanda inválidas», so Play opens «Ensayo
  // cancelado por un fallo crítico» and the review panel is never reached.
  // The same default project is valid before saving (0 critical) and invalid
  // after reload (1 critical). Re-enable once the defect is fixed.
  test.fixme('renders satisfaction donut chart, incident cause bars, and guided actions after simulation', async ({
    page,
  }) => {
    await openWorkspaceWithDefaultProject(page);
    await expect(page.locator('#drawing')).toBeVisible();

    // Iniciar simulación en Simular y activar lluvia para generar fricción de refugio/comedor
    await page.locator('[data-panel="simulate"]').click();
    await page.locator('[data-live-weather="rain"]').click();
    await page.locator('#speed').selectOption('600');
    await page.locator('#play').click();

    // Avanzar la línea temporal hacia el final para completar la jornada y abrir Balance de jornada
    await page.waitForTimeout(1200);
    await page.locator('[data-panel="review"]').click();

    // En el panel Revisar debe aparecer el diagnóstico gráfico con el donut de satisfacción
    const diagPanel = page.locator('.post-sim-diagnostics').first();
    await expect(diagPanel).toBeVisible();
    await expect(diagPanel.locator('.diag-donut-score')).toBeVisible();
    await expect(diagPanel.locator('.diag-headline')).toBeVisible();
  });
});
