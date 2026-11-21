import {test, expect} from '@playwright/test';

test.describe('Herramientas de vallas (encadenadas y sueltas)', () => {
  test('permite trazar vallas encadenadas, terminar con Escape y colocar/editar/duplicar una valla suelta', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-continue').click();
    await expect(page.locator('#drawing')).toBeVisible();

    const initialFenceCount = await page
      .locator('#scenario-layer .map-fence')
      .count();

    const mapBox = (await page.locator('#map').boundingBox())!;
    const x0 = mapBox.x + mapBox.width * 0.44;
    const y0 = mapBox.y + mapBox.height * 0.45;

    // 1. Activar herramienta «Vallas encadenadas» y verificar largo editable (3,5 m por defecto)
    await page.locator('[data-action="fence:chain"]').click();
    await expect(page.locator('#fence-length-input')).toHaveValue('3.5');
    await page.locator('#fence-length-input').fill('4');

    // Primer clic fija vértice inicial; mover muestra fantasma; 2 clics colocan 2 tramos encadenados
    await page.mouse.click(x0, y0);
    await page.mouse.move(x0 + 60, y0);
    await expect(page.locator('#draft-layer .fence-ghost')).toBeVisible();

    await page.mouse.click(x0 + 60, y0);
    await page.mouse.move(x0 + 120, y0 + 25);
    await page.mouse.click(x0 + 120, y0 + 25);

    // Terminar cadena con Escape (el último fantasma no se coloca)
    await page.keyboard.press('Escape');
    await expect(page.locator('#draft-layer .fence-ghost')).toHaveCount(0);
    await expect(page.locator('#scenario-layer .map-fence')).toHaveCount(
      initialFenceCount + 2
    );

    // 2. Activar herramienta «Valla suelta», colocar una y editar su ángulo en el Inspector
    await page.locator('[data-action="fence:loose"]').click();
    await page.mouse.click(x0, y0 + 70);
    await page.mouse.move(x0 + 50, y0 + 70);
    await page.mouse.click(x0 + 50, y0 + 70);

    await expect(page.locator('#scenario-layer .map-fence')).toHaveCount(
      initialFenceCount + 3
    );
    await expect(page.locator('#inspector')).toBeVisible();
    await expect(page.locator('#edit-fence-length')).toBeVisible();
    await expect(page.locator('#edit-fence-angle')).toBeVisible();

    // Editar ángulo y duplicar valla suelta
    await page.locator('#edit-fence-angle').fill('45');
    await page.locator('#edit-fence-angle').press('Enter');
    await page.locator('#duplicate-object').click();
    await expect(page.locator('#scenario-layer .map-fence')).toHaveCount(
      initialFenceCount + 4
    );

    // 3. Comprobar parámetro de rebeldes en la Ficha de producción
    await page.getByRole('button', {name: /Ficha de producción/i}).click();
    await expect(page.locator('#param-rebel-share')).toHaveValue('1');
    await page.locator('#param-rebel-share').fill('0');
    await page.locator('#parameter-form button[type="submit"]').click();
  });
});
