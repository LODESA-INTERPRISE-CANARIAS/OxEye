import {expect, test, type Page} from '@playwright/test';
import {lxUrl} from './address';
import {mockApi, signIn, type MockApi} from './mock-api';
import {DAY, fixClock} from './plan-fixtures';
import {RCAT, inventoryData} from './inventory-fixtures';

/**
 * Gestor logístico, milestone 4: tasks count on inventory resources. The
 * «Recursos» picker in the task form; the same resource in two overlapping
 * live tasks is a conflict when exactly one exists and a reminder that
 * states the stock otherwise; damaged material is a reminder. Inventory
 * figures never answer «Carga pesada» and never compute a load: the resource
 * form points to the simulator's X-ray check instead.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const warnings = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-warning]`)
    .evaluateAll(els =>
      els.map(
        el =>
          `${el.getAttribute('data-warning')}:${
            el.classList.contains('lx-warning--conflict') ? 'c' : 'r'
          }`,
      ),
    );
const taskPosts = (api: MockApi) =>
  api.calls('POST', '/tasks').map(c => c.body as Record<string, unknown>);

test.describe('Gestor logístico · tareas con recursos', () => {
  test('a resource picked in the task form; the only van twice is a conflict', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    // Before: only the fences reminder (200 of them in two tasks).
    expect(await warnings(page, '#lx-warnings')).toEqual([
      'resource_overlap:r',
    ]);

    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await page.locator('#lx-task-title').fill('Reparto de mesas Prueba');
    await page.locator('#lx-task-kind-other').click();
    await page.locator('#lx-task-start').fill('10:00');
    await page.locator('#lx-task-end').fill('12:00');
    const field = page.locator('#lx-task-resources');
    // Owned and contracted apart, with the recorded quantity.
    await expect(field.locator('#lx-task-res-group-owned')).toHaveText(
      'Propios',
    );
    await expect(field.locator('#lx-task-res-group-contracted')).toHaveText(
      'Contratados',
    );
    await expect(field.locator('label[for="lx-task-res-r3"]')).toContainText(
      '≈ 40 unidades · por evaluar',
    );
    await expect(field.locator('label[for="lx-task-res-r1"]')).toContainText(
      'Almacén Prueba Norte',
    );
    await expect(field.locator('label[for="lx-task-res-r5"]')).toContainText(
      'Alquileres Prueba',
    );
    await page.locator('#lx-task-res-r4').check();
    await expect(field.locator('[role="status"]')).toHaveText(
      '1 recurso elegido',
    );
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(taskPosts(api)[0]).toMatchObject({
      title: 'Reparto de mesas Prueba',
      resourceIds: ['r4'],
      date: DAY,
      heavyLoad: null,
    });

    // Hoy: the conflict first, then the fences reminder.
    expect(await warnings(page, '#lx-warnings')).toEqual([
      'resource_overlap:c',
      'resource_overlap:r',
    ]);
    const conflict = page.locator(
      '#lx-warnings .lx-warning--conflict[data-warning="resource_overlap"]',
    );
    await expect(conflict).toContainText(
      '«Furgoneta Prueba» está en dos tareas a la vez',
    );
    await expect(conflict).toContainText(
      '«Recogida de vallas Prueba» y «Reparto de mesas Prueba» se solapan 1 h y solo hay uno.',
    );

    // The other task's sheet shows it too.
    await page.locator('#lx-today-tasks [data-task-id="tA"]').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await expect(page.locator('#lx-task-res-r4')).toBeChecked();
    expect(await warnings(page, '#lx-task-warnings')).toEqual([
      'resource_overlap:c',
    ]);
    await page.keyboard.press('Escape');

    // The van's sheet lists both tasks.
    await page.locator('#lx-nav-inventarios').click();
    await page.locator('[data-resource-id="r4"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-tasks-title .lx-count')).toHaveText(
      '2',
    );
  });

  test('with 200 in stock it is a reminder that states the stock', async ({
    page,
  }) => {
    await mockApi(page, inventoryData());
    await signIn(page);
    const reminder = page.locator(
      '#lx-warnings .lx-warning--reminder[data-warning="resource_overlap"]',
    );
    await expect(reminder).toContainText(
      'Dos tareas usan «Vallas Prueba» a la vez',
    );
    await expect(reminder).toContainText(
      'Constan 200 unidades. Comprueba que hay suficientes para las dos.',
    );
  });

  test('stock not counted yet, and damaged material, are reminders', async ({
    page,
  }) => {
    const data = inventoryData();
    const r2 = data.resources!.find(r => r.id === 'r2')!;
    r2.quantity = null;
    const r1 = data.resources!.find(r => r.id === 'r1')!;
    r1.condition = 'damaged';
    data.tasks!.find(t => t.id === 'tC')!.resourceIds = ['r2', 'r1'];
    await mockApi(page, data);
    await signIn(page);
    await expect(
      page.locator('#lx-warnings [data-warning="resource_overlap"]'),
    ).toContainText('Aún no consta cuántos hay.');
    const damaged = page.locator(
      '#lx-warnings [data-warning="resource_unavailable"]',
    );
    await expect(damaged).toHaveClass(/lx-warning--reminder/);
    await expect(damaged).toContainText('«Carpa 3 × 6 Prueba»: con daños');
    await expect(damaged).toContainText(
      '«Vallado Prueba A» cuenta con este recurso.',
    );
  });

  test('one only when counted in «unidades»; none at all is a conflict too', async ({
    page,
  }) => {
    const data = inventoryData();
    const van = data.resources!.find(r => r.id === 'r4')!;
    // tA (09:00–11:00) and a new tB (10:00–12:00) both take the van.
    data.tasks!.push({
      ...data.tasks!.find(t => t.id === 'tA')!,
      id: 'tB',
      title: 'Reparto de mesas Prueba',
      startsAt: `${DAY}T10:00:00.000Z`,
      endsAt: `${DAY}T12:00:00.000Z`,
      venue: {id: 'v2', name: 'Plaza del Adelantado'},
      notes: null,
    });
    van.unit = 'juegos';
    const api = await mockApi(page, data);
    await signIn(page);
    const van2 = page.locator(
      '#lx-warnings [data-warning="resource_overlap"]',
      {hasText: 'Furgoneta Prueba'},
    );
    // «1 juegos» is not «exactly one item»: a reminder with the stock.
    await expect(van2).toHaveClass(/lx-warning--reminder/);
    await expect(van2).toContainText('Constan 1 juegos.');

    // None in stock: both tasks cannot have it.
    api.editDirectoryOnServer('resources', 'r4', {
      quantity: 0,
      unit: 'unidades',
    });
    await page.reload();
    await expect(van2).toHaveClass(/lx-warning--conflict/);
  });

  test('Enter in the resources filter picks the only match, never saves', async ({
    page,
  }) => {
    const data = inventoryData();
    for (const [id, name] of [
      ['r8', 'Conos Prueba'],
      ['r9', 'Balizas Prueba'],
    ]) {
      data.resources!.push({
        ...data.resources!.find(r => r.id === 'r2')!,
        id,
        name,
      });
    }
    const api = await mockApi(page, data);
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await page.locator('#lx-task-title').fill('Balizar Prueba');
    const filter = page.locator('#lx-task-resources-search');
    await filter.fill('balizas');
    await page.keyboard.press('Enter');
    await expect(page.locator('#lx-task-res-r9')).toBeChecked();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    // Several matches: Enter does nothing (and never submits).
    await filter.fill('prueba');
    await page.keyboard.press('Enter');
    await expect(page.locator('#lx-task-form')).toBeVisible();
    expect(api.calls('POST', '/tasks')).toHaveLength(0);
    await page.locator('#lx-task-save').click();
    expect(taskPosts(api)[0]).toMatchObject({resourceIds: ['r9']});
  });

  test('editing the list sends it whole; «Añadir tarea» from a resource starts with it', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await page.locator('#lx-today-tasks [data-task-id="tA"]').click();
    await page.locator('#lx-task-res-r4').uncheck();
    await page.locator('#lx-task-res-r1').check();
    await page.locator('#lx-task-res-r5').check();
    await expect(page.locator('#lx-task-resources [role="status"]')).toHaveText(
      '2 recursos elegidos',
    );
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    const patch = api.calls('PATCH', '/tasks/tA')[0].body as Record<
      string,
      unknown
    >;
    expect(patch).toMatchObject({version: 1});
    expect([...(patch.resourceIds as string[])].sort()).toEqual(['r1', 'r5']);
    // The van is free again: no conflict, the fences reminder stays.
    expect(await warnings(page, '#lx-warnings')).toEqual([
      'resource_overlap:r',
    ]);

    await page.locator('#lx-nav-inventarios').click();
    await page.locator('[data-resource-id="r2"] .lx-resrow__main').click();
    await page.locator('#lx-resource-add-task').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await expect(page.locator('#lx-task-res-r2')).toBeChecked();
    await page.locator('#lx-task-title').fill('Vallado Prueba C');
    await page.locator('#lx-task-save').click();
    expect(taskPosts(api)[0]).toMatchObject({resourceIds: ['r2']});
  });
});

test.describe('Gestor logístico · inventario y carga sobre el suelo', () => {
  test('kg or heavy categories point to the X-ray check; nothing is computed', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await page.locator('#lx-inventory-add').click();
    const note = page.locator('#lx-resource-load-note');
    await page.locator('#lx-resource-name').fill('Lastres Prueba');
    await expect(note).toHaveCount(0);
    await page.locator('#lx-resource-quantity').fill('1.000');
    await page.locator('#lx-resource-unit').fill('kg');
    await expect(note).toBeVisible();
    await expect(note).toContainText('no calculan la carga sobre el suelo');
    await expect(note).toContainText('Carga pesada');
    await expect(note).toContainText('rayos X');
    // No load per area or weight total is shown anywhere in the form.
    await expect(page.locator('#lx-resource-form')).not.toContainText(
      /kg\/m|kg por m|toneladas en total/,
    );
    await page.locator('#lx-resource-unit').fill('unidades');
    await expect(note).toHaveCount(0);
    const stage = `#lx-resource-cat-${'rcat-escenarios-y-tarimas'}`;
    await page.locator(stage).click();
    await expect(note).toBeVisible();
    await page.locator(`#lx-resource-cat-${RCAT.carpas}`).click();
    await expect(note).toHaveCount(0);
    await page.locator('#lx-resource-unit').fill('kg');
    await page.locator('#lx-resource-save').click();
    await expect(page.locator('#lx-resource-form')).toHaveCount(0);

    // A task using it still asks «¿Lleva carga pesada?» and sends null.
    const created = api.resources.find(r => r.name === 'Lastres Prueba')!;
    await page.locator('#lx-resource-add-task').click();
    await page.locator('#lx-task-title').fill('Montaje de lastres Prueba');
    await expect(page.locator(`#lx-task-res-${created.id}`)).toBeChecked();
    await expect(page.locator('#lx-task-heavy')).toBeVisible();
    await page.locator('#lx-task-save').click();
    expect(taskPosts(api)[0]).toMatchObject({
      resourceIds: [created.id],
      heavyLoad: null,
    });
  });
});
