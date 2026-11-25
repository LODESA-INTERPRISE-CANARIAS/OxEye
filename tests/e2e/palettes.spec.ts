import {test, expect} from '@playwright/test';
import {persistDefaultProjectAndContinue} from './helpers';

test.describe('Paletas de color en Ajustes', () => {
  test('muestra las 6 paletas predefinidas, aplica cambios en vivo y persiste tras recargar', async ({
    page,
  }) => {
    await page.goto('/');

    // Abrir Ajustes desde el menú principal
    await page.click('#game-settings');

    const picker = page.locator('.palette-picker[role="radiogroup"]');
    await expect(picker).toBeVisible();

    // No deben existir selectores de color personalizables
    await expect(page.locator('input[type="color"]')).toHaveCount(0);

    // Deben mostrarse exactamente las 6 paletas oficiales en orden
    const choices = picker.locator('[data-palette-choice]');
    await expect(choices).toHaveCount(6);
    await expect(choices.nth(0)).toContainText('01 · Ox Eye');
    await expect(choices.nth(1)).toContainText('02 · Atlas');
    await expect(choices.nth(2)).toContainText('03 · Noctis');
    await expect(choices.nth(3)).toContainText('04 · Territorio');
    await expect(choices.nth(4)).toContainText('05 · Vector');
    await expect(choices.nth(5)).toContainText('06 · Bendy');

    // Por defecto debe estar seleccionada Ox Eye
    await expect(
      page.locator('[data-palette-choice="oxeye"]')
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'oxeye'
    );

    // Al seleccionar Noctis se aplica al instante en el DOM y actualiza tokens CSS
    await page.click('[data-palette-choice="noctis"]');
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'noctis'
    );
    await expect(
      page.locator('[data-palette-choice="noctis"]')
    ).toContainText('Seleccionada');

    const noctisBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(noctisBg.toLowerCase()).toBe('#111820');

    // Cambiar a Bendy y guardar preferencias
    await page.click('[data-palette-choice="bendy"]');
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'bendy'
    );
    await page.click('#prefs-save');

    // Volvió al menú principal y sigue en Bendy
    await expect(page.locator('#game-settings')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'bendy'
    );

    // Tras recargar la página se mantiene la paleta guardada
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'bendy'
    );

    const bendyBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bendyBg.toLowerCase()).toBe('#ffffff');

    // También funciona dentro del workspace al abrir el proyecto
    // («Continuar» requiere un proyecto guardado: se guarda la sesión con «Salir»)
    await persistDefaultProjectAndContinue(page);
    await expect(page.locator('#game-menu')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      'bendy'
    );
  });
});
