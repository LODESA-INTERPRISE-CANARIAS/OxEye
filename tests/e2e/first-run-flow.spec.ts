import {expect, test} from '@playwright/test';
import {
  completeObjectivesStep,
  openSimulatorSection,
  WIZARD_SUBMIT,
} from './helpers';

test.describe('Flujo inicial obligatorio y tutorial de primera ejecución', () => {
  test('disables Continue when no project exists, auto-starts tutorial on first project, enables Continue on reload, and allows recovering guide from Settings', async ({
    page,
  }) => {
    // 1. Primera ejecución sin proyecto guardado: «Continuar» deshabilitado
    // (Portada → «Simulador»; «Continuar» lives on the Simulador screen.)
    await page.goto('/');
    await openSimulatorSection(page);
    const continueBtn = page.locator('#game-continue');
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeDisabled();
    await expect(page.locator('#game-continue-hint')).toHaveText(
      'Crea o carga primero un modelo',
    );
    // Without a model, «Crear nuevo modelo» is the highlighted action.
    await expect(page.locator('#game-new')).toHaveClass(/hub-tile--primary/);

    // 2. Crear primer proyecto mediante el asistente
    await page.locator('#game-new').click();
    // Paso 1: Objetivos (selector de tarjetas + jerarquía; sustituye al antiguo
    // formulario SMART de texto libre). Se mantienen los objetivos por defecto.
    await completeObjectivesStep(page);
    const nextBtn = page.locator(WIZARD_SUBMIT);
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
      'Activado (visita guiada antes de empezar)',
    );
    await nextBtn.click();

    // El tutorial interactivo se inicia automáticamente y puede omitirse
    await expect(page.locator('#drawing')).toBeVisible();
    const tutorialOverlay = page.locator('#tour-title');
    await expect(tutorialOverlay).toBeVisible();
    await page.locator('#tour-close').click();
    await expect(tutorialOverlay).toBeHidden();

    // 3. Al recargar la página, «Continuar» está habilitado y retoma sin repetir tutorial
    // (The workspace now has its own address, /simulador/modelo, and a reload
    // there resumes the saved model; «Continuar» is checked from /simulador.)
    await page.goto('/simulador');
    await expect(page.locator('#game-continue')).toBeEnabled();
    await page.locator('#game-continue').click();
    await expect(page.locator('#drawing')).toBeVisible();
    await expect(tutorialOverlay).toBeHidden();

    // 4. Recuperable desde Menú → Portada → Ajustes → Guía de uso
    await page.getByRole('button', {name: 'Menú'}).click();
    await expect(page).toHaveURL(/\/simulador$/);
    await page.locator('#hub-back').click();
    await page.locator('#game-settings').click();
    await expect(page.locator('#game-open-tutorial')).toBeEnabled();
    await page.locator('#game-open-tutorial').click();
    await expect(tutorialOverlay).toBeVisible();
  });
});
