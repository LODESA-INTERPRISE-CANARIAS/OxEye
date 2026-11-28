import {expect, test} from '@playwright/test';
import {completeObjectivesStep} from './helpers';

test.describe('Custom Real Map, Mandatory Perimeter -> Inventory Onboarding & Access Flows', () => {
  test('creates custom-location scenario, requires perimeter first, auto-detects spawns, opens inventory, and edits access flow', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 800});

    // Stub Overpass & Nominatim so the E2E test is fast and deterministic offline
    await page.route('**/nominatim.openstreetmap.org/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            display_name: 'Plaza de España, Santa Cruz de Tenerife, España',
            lat: '28.4671',
            lon: '-16.2473',
          },
        ]),
      });
    });

    const osmPayload = JSON.stringify({
      elements: [
        {type: 'node', id: 1, lat: 28.4671, lon: -16.249},
        {type: 'node', id: 2, lat: 28.4671, lon: -16.2455},
        {type: 'node', id: 3, lat: 28.4685, lon: -16.2473},
        {type: 'node', id: 4, lat: 28.4657, lon: -16.2473},
        {type: 'node', id: 5, lat: 28.4676, lon: -16.2478},
        {type: 'node', id: 6, lat: 28.4676, lon: -16.2474},
        {type: 'node', id: 7, lat: 28.4673, lon: -16.2474},
        {type: 'node', id: 8, lat: 28.4673, lon: -16.2478},
        {
          type: 'way',
          id: 10,
          nodes: [1, 2],
          tags: {highway: 'pedestrian', name: 'Paseo Marítimo'},
        },
        {
          type: 'way',
          id: 11,
          nodes: [3, 4],
          tags: {highway: 'secondary', name: 'Av. Marítima'},
        },
        {
          type: 'way',
          id: 12,
          nodes: [5, 6, 7, 8, 5],
          tags: {building: 'yes'},
        },
      ],
    });

    await page.route(
      '**/api.openstreetmap.org/api/0.6/map.json**',
      async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: osmPayload,
        });
      },
    );

    await page.route('**/overpass-api.de/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: osmPayload,
      });
    });

    // Deep link to the hub's «Simulador» screen.
    await page.goto('/simulador');
    await page.click('#game-new');

    // Step 1: objectives picker (replaces the former free-text SMART form)
    await completeObjectivesStep(page);

    // Step 2: Choose real map & search address
    await page.click('#location-mode-custom');
    await expect(page.locator('#location-picker')).toBeVisible();
    await page.fill('#location-search-input', 'Plaza de España Tenerife');
    await page.click('#location-search-btn');
    await expect(
      page.locator('#location-search-results button').first(),
    ).toBeVisible();
    await page.click('#location-search-results button >> nth=0');
    await page.locator('#location-size-slider').fill('350');
    await expect(page.locator('#location-size-readout')).toContainText(
      '350 × 350 m',
    );
    // With empty storage the guided tutorial is pre-checked (first run) and is
    // shown before the perimeter banner; this spec covers the onboarding
    // without the tour (the tour is covered by tutorial.spec.ts).
    await page.uncheck('#wizard-tutorial');
    await page.click('#wizard-form button[type="submit"]');

    // Step 3: Dates
    await page.click('#wizard-form button[type="submit"]');
    // Step 4: Goals
    await page.click('#wizard-form button[type="submit"]');
    // Step 5: Confirm & enter perimeter step
    await expect(page.locator('#wizard-form')).toContainText('350 × 350 m');
    await page.click('#wizard-form button[type="submit"]');

    // Step 1 of onboarding: mandatory perimeter drawing + clean vector base map (no raster tiles in plan mode)
    await expect(page.locator('#onboarding-perimeter-banner')).toBeVisible();
    await expect(page.locator('#place-title')).toContainText('Plaza de España');
    await expect(page.locator('#venue-select option')).toContainText(
      'Plaza de España',
    );
    await expect(page.locator('#inventory')).toBeDisabled();
    await expect(page.locator('#base-layer image')).toHaveCount(0);
    await expect(page.locator('#base-layer polygon')).toHaveCount(1);
    await expect(
      page.locator('#base-layer .street-label').first(),
    ).toBeVisible();

    // Draw a 4-point perimeter polygon on the map
    const mapBox = await page.locator('#map').boundingBox();
    expect(mapBox).not.toBeNull();
    const cx = mapBox!.x + mapBox!.width * 0.5;
    const cy = mapBox!.y + mapBox!.height * 0.45;
    await page.mouse.click(cx - 80, cy - 50);
    await page.mouse.click(cx + 80, cy - 50);
    await page.mouse.click(cx + 80, cy + 40);
    await page.mouse.click(cx - 80, cy + 40);
    await page.click('#finish-draw');

    // Step 2 of onboarding: Inventory opens automatically!
    await expect(page.locator('#inventory-dialog')).toBeVisible();
    await expect(page.locator('#onboarding-inventory-step')).toBeVisible();
    await page.click(
      '#inventory-dialog button[type="submit"]:has-text("Cerrar")',
    );

    // Now normal editing is unlocked and coherent spawns were created
    await expect(page.locator('#onboarding-perimeter-banner')).toBeHidden();
    await expect(page.locator('#inventory')).toBeEnabled();

    // Select one of the auto-generated spawns from the Elements list and inspect flow controls
    const accessBtn = page
      .locator('.object-list button')
      .filter({hasText: /Acceso/i})
      .first();
    await expect(accessBtn).toBeVisible();
    await accessBtn.click();

    await expect(page.locator('#spawn-flow-card')).toBeVisible();
    await expect(page.locator('#edit-spawnType')).toBeVisible();
    await expect(page.locator('#edit-entryWeight')).toBeVisible();
    await expect(page.locator('#edit-exitWeight')).toBeVisible();
    await expect(page.locator('#edit-maxRatePerHour')).toBeVisible();

    await page.locator('#edit-maxRatePerHour').fill('150');
    await page.locator('#edit-maxRatePerHour').blur();
    await expect(page.locator('#readout-entry-volume')).toBeVisible();
  });
});
