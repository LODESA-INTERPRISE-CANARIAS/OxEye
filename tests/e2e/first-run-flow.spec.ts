import {expect, test} from '@playwright/test';

test.describe('Flujo inicial obligatorio y tutorial de primera ejecución', () => {
  test('disables Continue when no project exists, auto-starts tutorial on first project, enables Continue on reload, and allows recovering guide from Settings', async ({
    page,
  }) => {
    // 1. Primera ejecución sin proyecto guardado: «Continuar» deshabilitado
    await page.goto('/');
    const continueBtn = page.locator('#game-continue');
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeDisabled();
    await expect(page.locator('#game-new')).toHaveClass(/game-primary/);

    // 2. Crear primer proyecto mediante el asistente
    await page.locator('#game-new').click();
    // Paso 1: Objetivo SMART (rellenar los 6 campos visibles del paso 1)
    const step0Inputs = page.locator('#wizard-form input, #wizard-form textarea');
    const count0 = await step0Inputs.count();
    for (let i = 0; i < count0; i++) {
      const el = step0Inputs.nth(i);
      const t = (await el.getAttribute('type')) || 'text';
      await el.fill(t === 'date' ? '2026-12-20' : 'Meta de prueba');
    }
    const nextBtn = page.locator('#wizard-form button[type="submit"]');
    await nextBtn.click();
    // Paso 2: Lugar y nombre
    await expect(page.locator('#game-menu')).toContainText('2 / 5');
    await nextBtn.click();
    // Paso 3: Fechas y horario
    await expect(page.locator('#game-menu')).toContainText('3 / 5');
    await nextBtn.click();
    // Paso 4: Objetivos
    await expect(page.locator('#game-menu')).toContainText('4 / 5');
    await nextBtn.click();
    // Paso 5: Resumen (tutorial activado por defecto en primera ejecución)
    await expect(page.locator('#game-menu')).toContainText('5 / 5');
    await expect(page.locator('#game-menu')).toContainText(
      'Activado (visita guiada antes de empezar)'
    );
    await nextBtn.click();

    // El tutorial interactivo se inicia automáticamente y puede omitirse
    await expect(page.locator('#drawing')).toBeVisible();
    const tutorialOverlay = page.locator('#tour-title');
    await expect(tutorialOverlay).toBeVisible();
    await page.locator('#tour-close').click();
    await expect(tutorialOverlay).toBeHidden();

    // 3. Al recargar la página, «Continuar» está habilitado y retoma sin repetir tutorial
    await page.reload();
    await expect(page.locator('#game-continue')).toBeEnabled();
    await page.locator('#game-continue').click();
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(tutorialOverlay).toBeHidden();

    // 4. Recuperable desde Menú → Ajustes → Guía de uso
    await page.getByRole('button', {name: 'Menú'}).click();
    await page.locator('#game-settings').click();
    await expect(page.locator('#game-open-tutorial')).toBeEnabled();
    await page.locator('#game-open-tutorial').click();
    await expect(tutorialOverlay).toBeVisible();
  });
});
