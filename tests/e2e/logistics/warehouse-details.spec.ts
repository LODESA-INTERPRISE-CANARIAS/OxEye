import {expect, test, type Page} from '@playwright/test';
import {makeMedia, mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {NORTE, inventoryData} from './inventory-fixtures';

/**
 * Revisión 1: a warehouse's acronym and opening hours. The acronym starts
 * from a proposal and follows the name until someone writes their own; the
 * hours are optional (both times or none, opening before closing) and read
 * «Pendiente de verificar» when unknown. Known hours show on the warehouse
 * card in Inventarios. Also: the task «Recursos» picker shows each item's
 * main photo or its category icon.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const card = (page: Page, id: string) =>
  page.locator(`#lx-inventory-panel [data-warehouse-id="${id}"]`);
const acronym = (page: Page) => page.locator('#lx-warehouse-acronym');
const posts = (api: MockApi) =>
  api.calls('POST', '/warehouses').map(c => c.body as Json);
const patches = (api: MockApi, id: string) =>
  api.calls('PATCH', `/warehouses/${id}`).map(c => c.body as Json);

async function openInventory(page: Page, name = 'Elvis') {
  await signIn(page, name, '#logistica/inventarios');
  await expect(page.locator('#lx-space-inventarios')).toBeVisible();
}

test.describe('Gestor logístico · siglas y horario del almacén', () => {
  test('a new warehouse: proposed acronym, hours checked, shown on its card', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await page.locator('#lx-inventory-add-warehouse').click();

    await page.locator('#lx-warehouse-name').fill('Almacén Municipal');
    await expect(acronym(page)).toHaveValue('A.M.');
    // Still the proposal: it follows the name.
    await page.locator('#lx-warehouse-name').fill('Almacén Municipal Este');
    await expect(acronym(page)).toHaveValue('A.M.E.');

    // Only one time: refused here, before the server.
    await page.locator('#lx-warehouse-opensAt').fill('07:30');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-hours-error')).toHaveText(
      'Indica la hora de apertura y la de cierre (HH:MM), o deja el horario vacío si no se sabe.',
    );
    await expect(page.locator('#lx-warehouse-opensAt')).toBeFocused();

    // Closing before opening.
    await page.locator('#lx-warehouse-closesAt').fill('06:00');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-hours-error')).toContainText(
      'La apertura debe ser anterior al cierre',
    );
    expect(posts(api)).toEqual([]);

    await page.locator('#lx-warehouse-closesAt').fill('15:00');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-hours-view')).toHaveText(
      '07:30–15:00 · cada día',
    );
    await expect(page.locator('#lx-warehouse-acronym-view')).toHaveText(
      'A.M.E.',
    );
    expect(posts(api)[0]).toMatchObject({
      name: 'Almacén Municipal Este',
      acronym: 'A.M.E.',
      openingHours: {opensAt: '07:30', closesAt: '15:00'},
    });

    await page.keyboard.press('Escape');
    const created = api.warehouses.find(
      w => w.name === 'Almacén Municipal Este',
    )!;
    await expect(
      card(page, created.id as string).locator('[data-warehouse-hours]'),
    ).toHaveText('Abre 07:30–15:00');
    // Unknown hours add nothing to the card.
    await expect(
      card(page, NORTE.id).locator('[data-warehouse-hours]'),
    ).toHaveCount(0);
  });

  test('editing: an own acronym is kept on rename; hours can be removed', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await card(page, NORTE.id).locator('.lx-whgroup__open').click();
    // Nothing stored: the proposal, said as such; hours unknown.
    await expect(page.locator('#lx-warehouse-acronym-view')).toHaveText(
      'A.P.N. · propuesta',
    );
    await expect(page.locator('#lx-warehouse-hours-view')).toHaveText(
      'Pendiente de verificar',
    );

    await page.locator('#lx-warehouse-edit').click();
    await expect(acronym(page)).toHaveValue('A.P.N.');
    await acronym(page).fill('A M');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-acronym-error')).toHaveText(
      'Solo letras, números y puntos, sin espacios.',
    );
    await expect(acronym(page)).toBeFocused();

    await acronym(page).fill('NORTE');
    await page.locator('#lx-warehouse-name').fill('Almacén Prueba Norte 2');
    await expect(acronym(page)).toHaveValue('NORTE');
    await page.locator('#lx-warehouse-opensAt').fill('08:00');
    await page.locator('#lx-warehouse-closesAt').fill('20:00');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-hours-view')).toHaveText(
      '08:00–20:00 · cada día',
    );
    expect(patches(api, NORTE.id)[0]).toMatchObject({
      version: 1,
      name: 'Almacén Prueba Norte 2',
      acronym: 'NORTE',
      openingHours: {opensAt: '08:00', closesAt: '20:00'},
    });

    await page.locator('#lx-warehouse-edit').click();
    await page.locator('#lx-warehouse-hours-clear').click();
    await expect(page.locator('#lx-warehouse-opensAt')).toHaveValue('');
    await expect(page.locator('#lx-warehouse-opensAt')).toBeFocused();
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-hours-view')).toHaveText(
      'Pendiente de verificar',
    );
    // Only what changed is sent.
    expect(patches(api, NORTE.id)[1]).toEqual({version: 2, openingHours: null});
  });

  test('the task «Recursos» picker shows the main photo or the category icon', async ({
    page,
  }) => {
    const data = inventoryData();
    data.resources!.find(r => r.id === 'r1')!.media = [
      makeMedia('m1', 'r1', {main: true}),
    ];
    await mockApi(page, data);
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    const field = page.locator('#lx-task-resources');
    // Thumbnails load lazily once near the screen; the field sits below the
    // fold of «Añadir tarea».
    await field.locator('label[for="lx-task-res-r1"]').scrollIntoViewIfNeeded();
    await expect(
      field.locator('label[for="lx-task-res-r1"] .lx-thumb'),
    ).toHaveAttribute('data-photo', 'stored');
    await expect(
      field.locator('label[for="lx-task-res-r1"] .lx-thumb img'),
    ).toHaveAttribute('src', /^blob:/);
    await expect(
      field.locator('label[for="lx-task-res-r3"] .lx-thumb'),
    ).toHaveAttribute('data-photo', 'none');
    // The checkbox still answers to a click on the whole label.
    await field.locator('label[for="lx-task-res-r3"]').click();
    await expect(page.locator('#lx-task-res-r3')).toBeChecked();
  });
});
