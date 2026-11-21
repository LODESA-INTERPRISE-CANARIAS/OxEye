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

    // 5b. Shift+clic en varias columnas las mueve juntas al arrastrar una sola y soporta Ctrl+G / Mayús+G
    await test.step('5b. Arrastrar varias columnas seleccionadas y agrupar con Ctrl+G / Mayús+G', async () => {
      await page.locator('[data-action="xray:column"]').click();
      await page.mouse.click(cx - 10, cy - 5);
      await expect(xrayLayer.locator('.xray-column')).toHaveCount(2);

      // Shift+clic para seleccionar ambas columnas
      await page.keyboard.down('Shift');
      await page.mouse.click(cx - 45, cy - 5);
      await page.keyboard.up('Shift');
      await expect(page.locator('#multi-select-title')).toHaveText(
        '2 elementos seleccionados'
      );

      // Guardar posiciones iniciales de ambos círculos de calor
      const colHeats = xrayLayer.locator('[data-xray-heat-column]');
      const x0Before = Number(await colHeats.nth(0).getAttribute('cx'));
      const x1Before = Number(await colHeats.nth(1).getAttribute('cx'));

      // Arrastrar solo la segunda columna: ambas deben desplazarse juntas
      await page.mouse.move(cx - 10, cy - 5);
      await page.mouse.down();
      await page.mouse.move(cx + 20, cy + 5, {steps: 5});
      await page.mouse.up();

      const x0After = Number(await colHeats.nth(0).getAttribute('cx'));
      const x1After = Number(await colHeats.nth(1).getAttribute('cx'));
      expect(x0After - x0Before).toBeGreaterThan(2);
      expect(x1After - x1Before).toBeCloseTo(x0After - x0Before, 1);

      // Agrupar con Ctrl+G y desagrupar con Mayús+G
      await page.keyboard.press('Control+g');
      await expect(page.locator('#inspector')).toContainText('GRUPO · NIVEL 1');
      await page.keyboard.press('Shift+G');
      await expect(page.locator('#inspector')).not.toContainText('GRUPO · NIVEL');
    });

    // 6. Al apagar Rayos X desaparece toda la capa
    await test.step('6. Apagar Rayos X', async () => {
      await page.locator('#layers').click();
      await page.locator('#xray-visible').uncheck();
      await expect(xrayLayer.locator('*')).toHaveCount(0);
      await expect(xrayLayer).toHaveAttribute('pointer-events', 'none');
    });
  });

  test('triggers critical risk when a heavy load sits on unsupported garage slab and allows selecting/deleting the garage perimeter', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-continue').click();
    await expect(page.locator('#drawing')).toBeVisible();

    const mapBox = (await page.locator('#map').boundingBox())!;
    const cx = mapBox.x + mapBox.width * 0.55;
    const cy = mapBox.y + mapBox.height * 0.42;

    // 1. Dibujar un perímetro amplio de garaje subterráneo
    await page.locator('[data-action="xray:boundary"]').click();
    await page.mouse.click(cx - 70, cy - 45);
    await page.mouse.click(cx + 80, cy - 45);
    await page.mouse.click(cx + 80, cy + 25);
    await page.mouse.click(cx - 70, cy + 25);
    await page.locator('#finish-draw').click();
    await expect(page.locator('#xray-layer .xray-polygon')).toHaveCount(1);
    await expect(
      page.locator('#xray-layer [data-xray-heat-perimeter]')
    ).toHaveCount(4);

    // 2. Colocar una carga pesada (Escenario) en el vano hueco central del garaje (sin pilares)
    await page.locator('[data-place="stage"]').click();
    await page.mouse.click(cx + 5, cy - 10);
    await expect(page.locator('#heavy-load-toggle')).toBeChecked();
    await expect(page.locator('#subsoil-load-warning')).toBeVisible();

    // 3. Pulsar Play abre automáticamente el diálogo de riesgos con el bloqueo por forjado sin apoyo
    await page.locator('#play').click();
    const riskDialog = page.locator('#risk-dialog');
    await expect(riskDialog).toBeVisible();
    await expect(riskDialog).toContainText(
      'Elemento pesado sobre forjado sin apoyo: Escenario'
    );
    await expect(riskDialog).toContainText('Perímetro del subsuelo');
    await expect(
      riskDialog.getByRole('button', {
        name: 'Ver en Rayos X y seleccionar pieza',
      })
    ).toBeVisible();
    await riskDialog
      .getByRole('button', {name: 'Desmarcar carga pesada'})
      .click();
    await expect(
      riskDialog.locator('[data-risk-id^="subsoil-load-"]')
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(riskDialog).toBeHidden();

    // 4. Seleccionar el perímetro del garaje haciendo clic sobre su contorno y eliminarlo
    await page.mouse.click(cx + 80, cy - 10);
    await expect(page.locator('#inspector')).toContainText(
      'Perímetro del subsuelo'
    );
    await page.locator('#delete-object').click();
    await expect(page.locator('#xray-layer .xray-polygon')).toHaveCount(0);
  });

  test('supports Solo subsuelo view and locking any element against dragging', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#game-continue').click();
    await expect(page.locator('#drawing')).toBeVisible();

    const mapBox = (await page.locator('#map').boundingBox())!;
    const cx = mapBox.x + mapBox.width * 0.52;
    const cy = mapBox.y + mapBox.height * 0.45;

    // 1. Colocar una columna de subsuelo y activar «Solo subsuelo» desde la barra de fases
    await page.locator('[data-action="xray:column"]').click();
    await page.mouse.click(cx - 40, cy);
    await expect(page.locator('#xray-layer .xray-column')).toHaveCount(1);

    await page.locator('#phase-subsoil-only').click();
    await expect(page.locator('#phase-subsoil-only')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('.map-shell')).toHaveClass(/subsoil-only/);
    await expect(page.locator('#scenario-layer')).toBeHidden();
    await expect(page.locator('#xray-layer .xray-column')).toBeVisible();

    // Volver a fase Evento restaura la capa de superficie y oculta el subsuelo
    await page.locator('[data-phase="event"]').click();
    await expect(page.locator('#phase-subsoil-only')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.locator('#scenario-layer')).toBeVisible();
    await expect(page.locator('#xray-layer .xray-column')).toHaveCount(0);

    // 2. Colocar un elemento, bloquearlo con el botón verde y comprobar que no se mueve al arrastrar
    await page.locator('[data-place="stage"]').click();
    await page.mouse.click(cx, cy);
    await expect(page.locator('#inspector')).toBeVisible();

    const lockButton = page.locator('#lock-piece');
    await expect(lockButton).toBeVisible();
    await expect(lockButton).toHaveAttribute('aria-pressed', 'false');
    await expect(lockButton).not.toHaveClass(/is-locked/);

    // Guardar coordenada X inicial
    await page.locator('.coordinate-details summary').click();
    const initialX = await page.locator('#edit-x').inputValue();

    // Bloquear elemento
    await lockButton.click();
    await expect(lockButton).toHaveAttribute('aria-pressed', 'true');
    await expect(lockButton).toHaveClass(/is-locked/);
    await expect(page.locator('#edit-x')).toBeDisabled();
    await expect(page.locator('.transform-controls')).toHaveCount(0);

    // Intentar arrastrar el elemento bloqueado: no debe cambiar su coordenada X
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 40, {steps: 6});
    await page.mouse.up();

    expect(await page.locator('#edit-x').inputValue()).toBe(initialX);
  });
});
