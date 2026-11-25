import {expect, test} from '@playwright/test';
import {openWorkspaceWithDefaultProject} from './helpers';

test.describe('Lastres como subcomponentes de carpa y agrupación', () => {
  test('adds ballast subcomponents directly from tent, moves tent+subcomponents together, edits ballast independently, groups/ungroups and undoes', async ({
    page,
  }) => {
    await openWorkspaceWithDefaultProject(page);
    await expect(page.locator('#drawing')).toBeVisible();

    const mapBox = (await page.locator('#map').boundingBox())!;
    const cx = mapBox.x + mapBox.width * 0.54;
    const cy = mapBox.y + mapBox.height * 0.44;

    // 1. Colocar una carpa y configurar dotación de lastres (2 por cada tramo de 5 m -> 4 necesarios)
    await page.locator('[data-place="cover"]').click();
    await page.mouse.click(cx, cy);
    await expect(page.locator('#cover-ballast-config')).toBeVisible();
    await expect(page.locator('#heavy-load-toggle')).not.toBeChecked();

    await page.locator('#edit-ballast-span').fill('5');
    await page.locator('#edit-ballast-span').press('Enter');
    await page.locator('#edit-ballasts-per-span').fill('2');
    await page.locator('#edit-ballasts-per-span').press('Enter');
    await expect(page.locator('#cover-ballast-warning')).toContainText(
      'Faltan 4 lastre(s)'
    );

    // 2. Añadir 1 lastre como subcomponente desde la propia carpa -> faltan 3
    await page.locator('#add-cover-ballast').click();
    await expect(page.locator('#cover-ballast-warning')).toContainText(
      'Faltan 3 lastre(s)'
    );
    await expect(page.locator('#cover-ballast-list li')).toHaveCount(1);

    // 3. Generar los 3 lastres faltantes en un clic -> dotación completa (4/4), sin aviso
    await page.locator('#generate-missing-ballasts').click();
    await expect(page.locator('#cover-ballast-list li')).toHaveCount(4);
    await expect(page.locator('#cover-ballast-warning')).toHaveCount(0);

    // 4. Mover la carpa arrastra sus 4 lastres subcomponente manteniendo posiciones relativas
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 35, cy + 15, {steps: 6});
    await page.mouse.up();
    await expect(page.locator('#cover-ballast-list li')).toHaveCount(4);

    // 5. Seleccionar un lastre subcomponente desde la lista de la carpa y editarlo por separado
    await page.locator('#cover-ballast-list li button').first().click();
    await expect(page.locator('#ballast-properties')).toBeVisible();
    await expect(page.locator('#ballast-parent-cover')).toContainText(
      'Subcomponente de'
    );
    await expect(page.locator('#ballast-surface-load')).toContainText('500 kg/m²');
    await expect(page.locator('#heavy-load-toggle')).toBeChecked();

    await page.locator('#edit-ballast-mass').fill('300');
    await page.locator('#edit-ballast-mass').press('Enter');
    await expect(page.locator('#ballast-surface-load')).toContainText('300 kg/m²');
    await expect(page.locator('#heavy-load-toggle')).not.toBeChecked();

    // 6. Deshacer con Ctrl+Z recupera los 500 kg y vuelve a marcar Elemento pesado
    await page.keyboard.press('Control+z');
    await page.mouse.click(cx + 35, cy + 15);
    await page.locator('#cover-ballast-list li button').first().click();
    await expect(page.locator('#edit-ballast-mass')).toHaveValue('500');
    await expect(page.locator('#heavy-load-toggle')).toBeChecked();
  });
});
