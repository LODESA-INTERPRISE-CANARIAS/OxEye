import {expect, test} from '@playwright/test';

test.describe('Capa Rayos X (subsuelo, mapa de calor y multiselección)', () => {
  test('toggles X-Ray layer, draws subsoil perimeter/column/wall, and tests multi-selection + shortcuts', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-continue').click();
    await expect(page.locator('#drawing')).toBeVisible();

    // 1. Rayos X está apagado por defecto: #xray-layer vacío y pointer-events="none"
    const xrayLayer = page.locator('#xray-layer');
    await test.step('1. Toggle Rayos X en panel Capas', async () => {
      await expect(xrayLayer).toHaveAttribute('pointer-events', 'none');
      await expect(xrayLayer.locator('*')).toHaveCount(0);

      await page.locator('#layers').click();
      const xrayCheckbox = page.locator('#xray-visible');
      await expect(xrayCheckbox).not.toBeChecked();
      await xrayCheckbox.check();
      await expect(xrayCheckbox).toBeChecked();
      await page.locator('#layers').click();
    });

    // Guardar puntos actuales del perímetro del evento para verificar que no se altera
    const eventBoundaryBefore = await page
      .locator('#scenario-layer > polygon')
      .first()
      .getAttribute('points');

    // 2. Dibujar perímetro del subsuelo (clic normal), sumar área (Shift) y restar área (Ctrl)
    const mapBox = (await page.locator('#map').boundingBox())!;
    const cx = mapBox.x + mapBox.width * 0.55;
    const cy = mapBox.y + mapBox.height * 0.42;

    await test.step('2. Dibujar perímetro subsuelo (+ Shift / − Ctrl)', async () => {
      await page.locator('[data-action="xray:boundary"]').click();
      await expect(xrayLayer).toHaveAttribute('pointer-events', 'auto');
      await page.mouse.click(cx - 70, cy - 40);
      await page.mouse.click(cx + 70, cy - 40);
      await page.mouse.click(cx + 70, cy + 25);
      await page.mouse.click(cx - 70, cy + 25);
      await page.locator('#finish-draw').click();
      await expect(xrayLayer.locator('.xray-polygon')).toHaveCount(1);

      // 2b) Sumar área con Shift en el primer clic
      await page.locator('[data-action="xray:boundary"]').click();
      await page.keyboard.down('Shift');
      await page.mouse.click(cx + 50, cy - 30);
      await page.keyboard.up('Shift');
      await expect(page.locator('#draw-mode-badge')).toContainText('+');
      await page.mouse.click(cx + 110, cy - 30);
      await page.mouse.click(cx + 110, cy + 20);
      await page.locator('#finish-draw').click();
      await expect(xrayLayer.locator('.xray-polygon')).toHaveCount(2);

      // 2c) Restar área con Ctrl en el primer clic
      await page.locator('[data-action="xray:boundary"]').click();
      await page.keyboard.down('Control');
      await page.mouse.click(cx - 25, cy - 15);
      await page.keyboard.up('Control');
      await expect(page.locator('#draw-mode-badge')).toContainText('−');
      await page.mouse.click(cx + 25, cy - 15);
      await page.mouse.click(cx + 25, cy + 15);
      await page.locator('#finish-draw').click();
      await expect(xrayLayer.locator('.xray-polygon')).toHaveCount(3);
    });

    // El perímetro del evento no debe haberse alterado
    const eventBoundaryAfter = await page
      .locator('#scenario-layer > polygon')
      .first()
      .getAttribute('points');
    expect(eventBoundaryAfter).toBe(eventBoundaryBefore);

    // 3. Colocar una columna y verificar círculo + calor circular
    await test.step('3. Colocar columna', async () => {
      await page.locator('[data-action="xray:column"]').click();
      await page.mouse.click(cx - 45, cy - 5);
      await expect(xrayLayer.locator('.xray-column')).toHaveCount(1);
      await expect(xrayLayer.locator('[data-xray-heat-column]')).toHaveCount(1);
      await expect(page.locator('#edit-col-diameter')).toBeVisible();
      await expect(page.locator('#edit-col-influence')).toBeVisible();
    });

    // 4. Dibujar un muro de carga y verificar calor simétrico + rotación en vivo
    await test.step('4. Dibujar y rotar muro de carga', async () => {
      await page.locator('[data-action="xray:wall"]').click();
      await page.mouse.click(cx, cy - 25);
      await page.mouse.click(cx + 65, cy - 25);
      await page.locator('#finish-draw').click();
      await expect(xrayLayer.locator('.xray-wall')).toHaveCount(1);
      const wallHeatEl = xrayLayer.locator('[data-xray-heat-wall]').first();
      await expect(wallHeatEl).toBeVisible();
      const transformBefore = await wallHeatEl.getAttribute('transform');

      const rotInput = page.locator('#edit-wall-rotation');
      await expect(rotInput).toBeVisible();
      await rotInput.fill('45');
      await rotInput.press('Enter');
      const transformAfter = await wallHeatEl.getAttribute('transform');
      expect(transformAfter).not.toBe(transformBefore);
      expect(transformAfter).toContain('rotate(45');
    });

    // 5. Multiselección con Shift + clic, Ctrl+C / Ctrl+V, Supr y Ctrl+Z / Ctrl+Y
    await test.step('5. Multiselección y atajos', async () => {
      await page.mouse.click(cx - 45, cy - 5);
      await expect(page.locator('#edit-col-diameter')).toBeVisible();
      await page.keyboard.down('Shift');
      await page.mouse.click(cx + 32, cy - 25);
      await page.keyboard.up('Shift');
      await expect(page.locator('#multi-select-title')).toHaveText(
        '2 elementos seleccionados'
      );

      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');
      await expect(xrayLayer.locator('.xray-column')).toHaveCount(2);
      await expect(xrayLayer.locator('.xray-wall')).toHaveCount(2);

      await page.keyboard.press('Delete');
      await expect(xrayLayer.locator('.xray-column')).toHaveCount(1);
      await expect(xrayLayer.locator('.xray-wall')).toHaveCount(1);

      await page.keyboard.press('Control+z');
      await expect(xrayLayer.locator('.xray-column')).toHaveCount(2);
      await expect(xrayLayer.locator('.xray-wall')).toHaveCount(2);
      await page.keyboard.press('Control+y');
      await expect(xrayLayer.locator('.xray-column')).toHaveCount(1);
      await expect(xrayLayer.locator('.xray-wall')).toHaveCount(1);
    });

    // 6. Al apagar Rayos X desaparece toda la capa
    await test.step('6. Apagar Rayos X', async () => {
      await page.locator('#layers').click();
      await page.locator('#xray-visible').uncheck();
      await expect(xrayLayer.locator('*')).toHaveCount(0);
      await expect(xrayLayer).toHaveAttribute('pointer-events', 'none');
    });
  });
});
