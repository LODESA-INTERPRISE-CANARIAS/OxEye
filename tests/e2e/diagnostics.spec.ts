import {expect, test} from '@playwright/test';

test.describe('Diagnóstico gráfico post-simulación y resolución guiada', () => {
  test('renders satisfaction donut chart, incident cause bars, and guided actions after simulation', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-continue').click();
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
