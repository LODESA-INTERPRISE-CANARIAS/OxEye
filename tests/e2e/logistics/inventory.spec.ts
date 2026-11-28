import {expect, test, type Page} from '@playwright/test';
import {lxUrl} from './address';
import {ORG, loginAs, mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {choose, optionValues} from './controls';
import {
  ALQUILERES,
  NORTE,
  RCAT,
  SUR,
  inventoryData,
} from './inventory-fixtures';

/**
 * Gestor logístico, milestone 4: «Inventarios». Owned material grouped by
 * warehouse («Sin almacén» last) and contracted services grouped by company;
 * category chips and a text filter that never reads locations or notes;
 * empty states; quick capture of a resource with only its name; a warehouse
 * created by typing its name; Spanish quantities; a contracted service with
 * company and offer; «Aún por evaluar»; deleting a warehouse keeps its
 * material; deleting a custom resource category from «Gestionar».
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const space = (page: Page) => page.locator('#lx-space-inventarios');
const group = (page: Page, id: string) =>
  page.locator(`#lx-inventory-panel [data-warehouse-id="${id}"]`);
const companyGroup = (page: Page, id: string) =>
  page.locator(`#lx-inventory-panel [data-company-id="${id}"]`);
const rows = (page: Page, scope = '#lx-inventory-panel') =>
  page
    .locator(`${scope} .lx-resrow`)
    .evaluateAll(els => els.map(el => el.getAttribute('data-resource-id')));
const groupIds = (page: Page, attr: string) =>
  page
    .locator(`#lx-inventory-panel [${attr}]`)
    .evaluateAll((els, a) => els.map(el => el.getAttribute(a)), attr);
const resourceForm = (page: Page) => page.locator('#lx-resource-form');
const posts = (api: MockApi) =>
  api.calls('POST', '/resources').map(c => c.body as Record<string, unknown>);

async function openInventory(page: Page, name = 'Elvis') {
  await signIn(page, name, lxUrl('inventarios'));
  await expect(space(page)).toBeVisible();
}

async function addResourceFromMenu(page: Page) {
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-resource').click();
  await expect(resourceForm(page)).toBeVisible();
  await expect(page.locator('#lx-resource-name')).toBeFocused();
}

test.describe('Gestor logístico · Inventarios', () => {
  test('Propios by warehouse, «Sin almacén» last; Contratados by company', async ({
    page,
  }) => {
    await mockApi(page, inventoryData());
    await openInventory(page);
    const owned = page.locator('#lx-inventory-tab-owned');
    const contracted = page.locator('#lx-inventory-tab-contracted');
    await expect(owned).toHaveAttribute('aria-selected', 'true');
    await expect(owned).toContainText('4');
    await expect(contracted).toContainText('2');
    await expect(
      page.locator('#lx-inventory-panel [role="status"]'),
    ).toHaveText('4 recursos propios · 2 almacenes');

    expect(await groupIds(page, 'data-warehouse-id')).toEqual([
      NORTE.id,
      SUR.id,
      'none',
    ]);
    expect(await rows(page, `[data-warehouse-id="${NORTE.id}"]`)).toEqual([
      'r1',
      'r2',
    ]);
    expect(await rows(page, `[data-warehouse-id="${SUR.id}"]`)).toEqual(['r3']);
    await expect(group(page, 'none')).toContainText('Sin almacén');
    expect(await rows(page, '[data-warehouse-id="none"]')).toEqual(['r4']);
    // The warehouse header shows its address; the count is the server's.
    await expect(group(page, NORTE.id)).toContainText('Calle Ficticia Prueba');
    await expect(group(page, SUR.id)).toContainText(
      'Dirección pendiente de verificar',
    );
    // A validated count is solid, a provisional one is «≈ … · por evaluar».
    await expect(page.locator('[data-resource-id="r3"]')).toContainText(
      '≈ 40 unidades · por evaluar',
    );
    // Contracted material is never listed among owned material.
    await expect(page.locator('[data-resource-id="r5"]')).toHaveCount(0);

    // Arrow keys move between the tabs.
    await owned.focus();
    await page.keyboard.press('ArrowRight');
    await expect(contracted).toBeFocused();
    await expect(contracted).toHaveAttribute('aria-selected', 'true');
    expect(await groupIds(page, 'data-company-id')).toEqual([
      ALQUILERES.id,
      'none',
    ]);
    const aseos = companyGroup(page, ALQUILERES.id);
    await expect(aseos).toContainText('Alquileres Prueba');
    await expect(aseos.locator('[data-resource-id="r5"]')).toContainText(
      'Oferta: Aseo portátil Prueba por día',
    );
    await expect(companyGroup(page, 'none')).toContainText('Sin empresa');
    await expect(
      companyGroup(page, 'none').locator('[data-resource-id="r6"]'),
    ).toContainText('Falta');
    await expect(page.locator('#lx-inventory-add')).toHaveText(
      /Añadir servicio/,
    );
    await page.keyboard.press('ArrowLeft');
    await expect(owned).toHaveAttribute('aria-selected', 'true');
  });

  test('category chips and the text filter; never by location or notes', async ({
    page,
  }) => {
    await mockApi(page, inventoryData());
    await openInventory(page);
    const chips = page.locator('#lx-inventory-filters');
    await chips.locator(`[data-category-id="${RCAT.vallas}"]`).click();
    await expect(
      chips.locator(`[data-category-id="${RCAT.vallas}"]`),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await rows(page)).toEqual(['r2']);
    await expect(
      page.locator('#lx-inventory-panel [role="status"]'),
    ).toHaveText('1 recurso de 4');
    await chips.getByRole('button', {name: /Todas/}).click();
    expect((await rows(page)).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);

    const search = page.locator('#lx-inventory-search');
    await search.fill('mesas');
    expect(await rows(page)).toEqual(['r3']);
    // A warehouse that matches by name shows whole.
    await search.fill('norte');
    expect(await rows(page)).toEqual(['r1', 'r2']);
    // Locations and observations are not searched.
    for (const q of ['UBICACION', 'nave 2', 'piqueta', 'OBS-RECURSO']) {
      await search.fill(q);
      await expect(page.locator('#lx-inventory-noresults')).toBeVisible();
    }
    await search.fill('zzz');
    const none = page.locator('#lx-inventory-noresults');
    await expect(none).toContainText('Nada coincide con «zzz»');
    await expect(
      none.getByRole('button', {name: 'Añadir «zzz»'}),
    ).toBeVisible();
    await none.getByRole('button', {name: 'Quitar filtros'}).click();
    await expect(search).toHaveValue('');
    expect((await rows(page)).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);

    // «Añadir «…»» from no results starts a resource with that name.
    await search.fill('Conos Prueba');
    await none.getByRole('button', {name: 'Añadir «Conos Prueba»'}).click();
    await expect(page.locator('#lx-resource-name')).toHaveValue('Conos Prueba');
  });

  test('empty states for the team and for the guest', async ({page}) => {
    await mockApi(page, {});
    await openInventory(page);
    const empty = page.locator('#lx-inventory-empty');
    await expect(empty).toContainText('Aún no hay almacenes ni recursos');
    await expect(
      page.locator('#lx-inventory-empty-add-warehouse'),
    ).toBeVisible();
    await page.locator('#lx-inventory-empty-add').click();
    await expect(resourceForm(page)).toBeVisible();
    await expect(page.locator('#lx-resource-ownership-owned')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(resourceForm(page)).toHaveCount(0);

    await page.locator('#lx-inventory-tab-contracted').click();
    await expect(page.locator('#lx-inventory-empty-contracted')).toContainText(
      'Aún no hay servicios contratados',
    );
    await page.locator('#lx-inventory-empty-add-contracted').click();
    await expect(
      page.locator('#lx-resource-ownership-contracted'),
    ).toBeChecked();
    await page.keyboard.press('Escape');

    await page.locator('#lx-logout').click();
    await loginAs(page, 'Invitado');
    await page.locator('#lx-nav-inventarios').click();
    await page.locator('#lx-inventory-tab-owned').click();
    await expect(page.locator('#lx-inventory-empty')).toContainText(
      'Cuando el equipo registre almacenes y material, aparecerán aquí.',
    );
    await expect(page.locator('#lx-inventory-empty-add')).toHaveCount(0);
    await expect(page.locator('#lx-inventory-add')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · captura rápida de recursos', () => {
  test('only the name from «+ Añadir», then «Guardar y seguir»', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await addResourceFromMenu(page);
    await expect(page.locator('#lx-resource-ownership-owned')).toBeChecked();
    await page.locator('#lx-resource-name').fill('Conos Prueba');
    await page.locator('#lx-resource-save-next').click();
    await expect(page.locator('#lx-resource-saved')).toContainText(
      'Guardado «Conos Prueba»',
    );
    // A clean form for the next one, focused on the name.
    await expect(page.locator('#lx-resource-name')).toHaveValue('');
    await expect(page.locator('#lx-resource-name')).toBeFocused();
    await page.locator('#lx-resource-name').fill('Balizas Prueba');
    await page.keyboard.press('Enter');
    // Saved: the same sheet shows the record.
    await expect(resourceForm(page)).toHaveCount(0);
    await expect(page.locator('#lx-resource-sheet')).toContainText(
      'Balizas Prueba',
    );
    await expect(page.locator('#lx-resource-missing')).toContainText(
      'cantidad, estado, almacén, dimensiones, categoría',
    );

    const bodies = posts(api);
    expect(bodies.map(b => b.name)).toEqual(['Conos Prueba', 'Balizas Prueba']);
    expect(bodies[0]).toMatchObject({
      organizationId: ORG,
      ownership: 'owned',
      quantity: null,
      unit: 'unidades',
      condition: 'unknown',
      availability: 'unknown',
      toAssess: false,
    });
    // Nothing invented: no warehouse, company or offer was sent.
    for (const b of bodies) {
      expect(b).not.toHaveProperty('warehouseName');
      expect(b).not.toHaveProperty('companyName');
      expect(b).not.toHaveProperty('offerId');
    }

    await page.keyboard.press('Escape');
    await page.locator('#lx-nav-inventarios').click();
    const loose = group(page, 'none');
    await expect(loose).toContainText('Conos Prueba');
    await expect(loose).toContainText('Balizas Prueba');
  });

  test('a warehouse typed by name is created on save; a known one is linked', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await page.locator('#lx-inventory-add').click();
    await page.locator('#lx-resource-name').fill('Sillas Prueba');
    const wh = page.locator('#lx-resource-warehouseName');
    await wh.fill('Almacén Prueba Este');
    await expect(
      page.locator('#lx-resource-warehouseName-status'),
    ).toContainText('Se creará el almacén «Almacén Prueba Este»');
    await wh.fill('almacén prueba norte');
    await expect(
      page.locator('#lx-resource-warehouseName-status'),
    ).toContainText('Se enlazará con «Almacén Prueba Norte»');
    await wh.fill('Almacén Prueba Este');
    await page.locator('#lx-resource-save-next').click();
    await expect(page.locator('#lx-resource-saved')).toContainText(
      'de Almacén Prueba Este',
    );
    // The warehouse carries over to the next item.
    await expect(wh).toHaveValue('Almacén Prueba Este');
    await page.locator('#lx-resource-name').fill('Bancos Prueba');
    await page.locator('#lx-resource-save').click();
    await page.keyboard.press('Escape');

    expect(posts(api).map(b => b.warehouseName)).toEqual([
      'Almacén Prueba Este',
      'Almacén Prueba Este',
    ]);
    // Created once, by name, and listed with both items.
    const created = api.warehouses.filter(
      w => w.name === 'Almacén Prueba Este',
    );
    expect(created).toHaveLength(1);
    const g = group(page, created[0].id as string);
    await expect(g).toContainText('Sillas Prueba');
    await expect(g).toContainText('Bancos Prueba');
    await expect(g).toContainText('Dirección pendiente de verificar');
  });

  test('quantities: «muchas» is refused, «1.000», «2,5» and «0.500» read the Spanish way', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await addResourceFromMenu(page);
    const name = page.locator('#lx-resource-name');
    const qty = page.locator('#lx-resource-quantity');
    await name.fill('Cuerda Prueba');
    await qty.fill('muchas');
    await qty.blur();
    await expect(page.locator('#lx-resource-quantity-error')).toContainText(
      'Escribe solo la cifra, sin unidades',
    );
    await page.locator('#lx-resource-save').click();
    await expect(qty).toBeFocused();
    expect(posts(api)).toEqual([]);
    for (const bad of ['12 m', '-3', '1,234']) {
      await qty.fill(bad);
      await page.locator('#lx-resource-save').click();
      await expect(page.locator('#lx-resource-quantity-error')).toBeVisible();
    }
    expect(posts(api)).toEqual([]);

    const cases: [string, string, number][] = [
      ['Cuerda Prueba', '1.000', 1000],
      ['Lona Prueba', '2,5', 2.5],
      ['Pintura Prueba', '0.500', 0.5],
      ['Bridas Prueba', '12.500', 12500],
    ];
    for (const [n, typed] of cases) {
      await name.fill(n);
      await qty.fill(typed);
      await page.locator('#lx-resource-save-next').click();
      await expect(page.locator('#lx-resource-saved')).toContainText(n);
    }
    expect(posts(api).map(b => [b.name, b.quantity])).toEqual(
      cases.map(([n, , v]) => [n, v]),
    );
    // A unit chip fills the unit; «Guardar y seguir» keeps it.
    await page
      .locator('#lx-resource-unit-suggestions')
      .getByText('m', {exact: true})
      .click();
    await expect(page.locator('#lx-resource-unit')).toHaveValue('m');
  });

  test('a contracted service with its company and an offer of that company', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await page.locator('#lx-inventory-tab-contracted').click();
    await page.locator('#lx-inventory-add').click();
    await expect(
      page.locator('#lx-resource-ownership-contracted'),
    ).toBeChecked();
    await page.locator('#lx-resource-name').fill('Cabinas Prueba');
    // No company yet: every offer, with its company.
    expect(await optionValues(page, 'lx-resource-offerId')).toHaveLength(4);
    await page.locator('#lx-resource-companyName').fill('alquileres prueba');
    await expect(page.locator('#lx-resource-companyName-status')).toContainText(
      'Se enlazará con «Alquileres Prueba»',
    );
    // Only that company's offers.
    expect(await optionValues(page, 'lx-resource-offerId')).toEqual([
      '',
      'o10',
      'o11',
    ]);
    await choose(page, 'lx-resource-offerId', 'o11');
    await page.locator('#lx-resource-quantity').fill('2');
    await page.locator('#lx-resource-save').click();
    await expect(resourceForm(page)).toHaveCount(0);

    expect(posts(api)[0]).toMatchObject({
      name: 'Cabinas Prueba',
      ownership: 'contracted',
      companyName: 'alquileres prueba',
      offerId: 'o11',
      quantity: 2,
    });
    await expect(page.locator('#lx-resource-company-link')).toHaveText(
      ALQUILERES.name,
    );
    await expect(page.locator('#lx-resource-offer-link')).toHaveText(
      'Cabina accesible Prueba',
    );
    await page.keyboard.press('Escape');
    await expect(
      companyGroup(page, ALQUILERES.id).locator('.lx-resrow'),
    ).toHaveCount(2);

    // Picking an offer with no company typed fills its company.
    await page.locator('#lx-inventory-add').click();
    await page.locator('#lx-resource-name').fill('Escenario alquilado Prueba');
    await choose(page, 'lx-resource-offerId', 'o12');
    await expect(page.locator('#lx-resource-companyName')).toHaveValue(
      'Escenarios Prueba',
    );
    // Switching to owned before saving sends no company or offer.
    await page.locator('#lx-resource-ownership-owned').click();
    await expect(page.locator('#lx-resource-provider')).toHaveCount(0);
    await page.locator('#lx-resource-save').click();
    await expect(resourceForm(page)).toHaveCount(0);
    const owned = posts(api)[1];
    expect(owned.ownership).toBe('owned');
    expect(owned).not.toHaveProperty('companyName');
    expect(owned).not.toHaveProperty('offerId');
  });

  test('«Aún por evaluar» keeps quantity and state provisional', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await page.locator('[data-resource-id="r3"] .lx-resrow__main').click();
    const facts = page.locator('#lx-resource-facts');
    await expect(facts).toContainText('≈ 40 unidades · por evaluar');
    await expect(facts).toContainText('Estado sin revisar');
    await expect(page.locator('#lx-resource-missing')).toContainText(
      'Falta: cantidad, estado, dimensiones',
    );
    // Unknown origin is pending, never invented.
    await expect(page.locator('#lx-resource-detail')).toContainText(
      'Pendiente de verificar',
    );
    await page.keyboard.press('Escape');

    // A new item marked «Aún por evaluar» without a figure: «Por evaluar».
    await page.locator('#lx-inventory-add').click();
    await page.locator('#lx-resource-name').fill('Lonas Prueba');
    await page.locator('#lx-resource-toAssess').check();
    await expect(page.locator('#lx-resource-quantity-hint')).toContainText(
      'aproximada',
    );
    await page.locator('#lx-resource-save').click();
    await expect(page.locator('#lx-resource-facts')).toContainText(
      'Por evaluar',
    );
    expect(posts(api)[0]).toMatchObject({toAssess: true, quantity: null});
  });

  test('deleting a warehouse keeps its material «Sin almacén» and unlinks notes', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await group(page, NORTE.id).locator('.lx-whgroup__open').click();
    const sheet = page.locator('#lx-warehouse-sheet');
    await expect(sheet).toContainText(NORTE.name);
    await expect(page.locator('#lx-warehouse-resources .lx-count')).toHaveText(
      '2',
    );
    await page.locator('#lx-warehouse-edit').click();
    await page.locator('#lx-warehouse-delete').click();
    await expect(page.locator('#lx-warehouse-delete-detail')).toContainText(
      '2 recursos se quedan en el inventario, sin almacén: no se borra ninguno.',
    );
    await page.locator('#lx-warehouse-delete-confirm').click();
    await expect(sheet).toHaveCount(0);

    const del = api.calls('DELETE', `/warehouses/${NORTE.id}`);
    expect(del.map(c => c.query)).toEqual(['?version=1']);
    expect(await groupIds(page, 'data-warehouse-id')).toEqual([SUR.id, 'none']);
    expect((await rows(page, '[data-warehouse-id="none"]')).sort()).toEqual([
      'r1',
      'r2',
      'r4',
    ]);
    expect(api.resources.map(r => r.id).sort()).toEqual(
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].sort(),
    );
    // Notes that pointed at it stay, without the link.
    expect(api.notes.find(n => n.id === 'n3')?.ref).toBeNull();
  });

  test('a warehouse name that exists is offered, not duplicated', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await openInventory(page);
    await page.locator('#lx-inventory-add-warehouse').click();
    await page.locator('#lx-warehouse-name').fill('almacén prueba sur');
    await page.locator('#lx-warehouse-save').click();
    await expect(page.locator('#lx-warehouse-duplicate')).toContainText(
      SUR.name,
    );
    expect(api.warehouses).toHaveLength(2);
    await page.locator('#lx-warehouse-open-existing').click();
    await expect(page.locator('#lx-warehouse-sheet')).toContainText(SUR.name);
    await expect(page.locator('#lx-warehouse-form')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · categorías de recursos', () => {
  test('«Gestionar» deletes a custom resource category after confirming', async ({
    page,
  }) => {
    const data = inventoryData();
    const custom = {
      id: 'rcat-custom-1',
      organizationId: ORG,
      scope: 'resource',
      name: 'Material de limpieza Prueba',
      builtIn: false,
    };
    const api = await mockApi(page, data);
    api.categories.push(custom);
    const r2 = api.resources.find(r => r.id === 'r2')!;
    r2.categoryId = custom.id;
    await openInventory(page);
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await page.locator('#lx-resource-edit').click();
    const manage = page.locator('#lx-resource-cat-manage');
    await manage.click();
    // The same chips switch mode: no separate list.
    await expect(manage).toHaveText('Hecho');
    await expect(manage).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lx-catmanage__list')).toHaveCount(0);
    const picker = page.locator('#lx-resource-categories');
    // Only the organization's own categories turn red with a ×; built-ins
    // stay as they are.
    await expect(picker.locator('.lx-catpick__chip.is-removable')).toHaveCount(
      1,
    );
    await expect(picker.locator('.lx-catpick__remove')).toHaveCount(1);
    const remove = page.locator(`#lx-resource-cat-delete-${custom.id}`);
    await expect(remove).toHaveAccessibleName(
      'Borrar la categoría Material de limpieza Prueba',
    );
    // Keyboard: the × is a real button.
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.locator(`#lx-resource-cat-ask-${custom.id}`),
    ).toContainText(
      '¿Borrar «Material de limpieza Prueba»? La perderán 1 recurso; no se borra nada más.',
    );
    // The safe answer has the focus; «No borrar» keeps it and goes back.
    const keep = page.locator(`#lx-resource-cat-keep-${custom.id}`);
    await expect(keep).toBeFocused();
    await keep.click();
    await expect(remove).toBeFocused();
    expect(api.calls('DELETE', `/categories/${custom.id}`)).toHaveLength(0);
    await remove.click();
    await page.locator(`#lx-resource-cat-confirm-${custom.id}`).click();
    await expect(
      page.getByRole('status').filter({hasText: 'Categoría borrada'}),
    ).toContainText('Material de limpieza Prueba');
    expect(api.calls('DELETE', `/categories/${custom.id}`)).toHaveLength(1);
    await expect(page.locator(`#lx-resource-cat-${custom.id}`)).toHaveCount(0);
    // Nothing of the organization's own is left: the mode ends by itself.
    await expect(picker.locator('.lx-catpick__remove')).toHaveCount(0);
    await expect(page.locator('#lx-resource-cat-managed')).toHaveCount(0);
    // The resource that used it lost it (the server unlinked it).
    expect(r2.categoryId).toBeNull();
    expect(r2.version).toBe(2);
  });

  test('a category the saved record holds cannot be deleted from its own form', async ({
    page,
  }) => {
    const custom = {
      id: 'rcat-custom-2',
      organizationId: ORG,
      scope: 'resource',
      name: 'Toldos Prueba',
      builtIn: false,
    };
    const api = await mockApi(page, inventoryData());
    api.categories.push(custom);
    api.resources.find(r => r.id === 'r2')!.categoryId = custom.id;
    await openInventory(page);
    await page.locator('[data-resource-id="r2"] .lx-resrow__main').click();
    await page.locator('#lx-resource-edit').click();
    await page.locator('#lx-resource-cat-manage').click();
    await expect(
      page.locator(`#lx-resource-cat-delete-${custom.id}`),
    ).toBeDisabled();
    await expect(
      page.locator(`#lx-resource-cat-locked-${custom.id}`),
    ).toHaveText('Quítala de esta ficha y guarda antes de borrarla.');
    expect(api.calls('DELETE', `/categories/${custom.id}`)).toHaveLength(0);
  });
});

test.describe('Gestor logístico · fichas apiladas del inventario', () => {
  test('«Añadir recurso aquí» then «Cancelar» brings back the resource card', async ({
    page,
  }) => {
    await mockApi(page, inventoryData());
    await openInventory(page);
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await page.locator('#lx-resource-warehouse-link').click();
    await expect(page.locator('#lx-warehouse-sheet')).toContainText(NORTE.name);
    await page.locator('#lx-warehouse-add-resource').click();
    await expect(resourceForm(page)).toBeVisible();
    await expect(page.locator('#lx-resource-warehouseName')).toHaveValue(
      NORTE.name,
    );
    await page.locator('#lx-resource-cancel').click();
    await expect(resourceForm(page)).toHaveCount(0);
    await expect(page.locator('#lx-resource-sheet')).toContainText(
      'Carpa 3 × 6 Prueba',
    );
    await expect(page.locator('#lx-resource-edit')).toBeVisible();
  });
});
