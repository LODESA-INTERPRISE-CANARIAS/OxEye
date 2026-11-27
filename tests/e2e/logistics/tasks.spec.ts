import {expect, test, type Page} from '@playwright/test';
import {ORG, addDays, dailos, mockApi, signIn, type MockApi} from './mock-api';
import {DAY, fixClock, planData} from './plan-fixtures';
import {choose, expectValue} from './controls';

/**
 * Gestor logístico, milestone 2: the «Añadir» menu, creating tasks (only the
 * title is required), the heavy-load question, «Empieza cuando termine…»,
 * editing with a version conflict, deleting, and the guest's read-only view.
 * The browser clock is fixed (see plan-fixtures.ts).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const PHONE = {width: 390, height: 844};

const taskSheet = (page: Page) => page.locator('#lx-task-sheet');
const todayRow = (page: Page, id: string) =>
  page.locator(`#lx-today-tasks [data-task-id="${id}"]`);
/**
 * Clicks a native radio, checkbox or switch. The input itself lies over its
 * styled label and receives the pointer, so click it (never with `force`:
 * that skips the wait for the sheet's opening animation).
 */
const pick = (page: Page, id: string) => page.locator(`#${id}`).click();

async function openAddTask(page: Page) {
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-task').click();
  await expect(page.locator('#lx-task-form')).toBeVisible();
  await expect(page.locator('#lx-task-title')).toBeFocused();
}

async function openTaskFromHoy(page: Page, id: string) {
  await todayRow(page, id).click();
  await expect(page.locator('#lx-task-form')).toBeVisible();
}

function postBodies(api: MockApi): Record<string, unknown>[] {
  return api
    .calls('POST', '/tasks')
    .map(c => c.body as Record<string, unknown>);
}

test.describe('Gestor logístico · menú «Añadir»', () => {
  test('pointer: Evento opens the event sheet, Tarea the task sheet', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    const add = page.locator('#lx-add');
    await expect(add).toHaveAttribute('aria-haspopup', 'menu');
    await add.click();
    await expect(
      page.getByRole('menu', {name: 'Qué quieres añadir'}),
    ).toBeVisible();
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    // Milestone 4: quick capture first, so «Incidencia» takes the focus.
    await expect(page.locator('#lx-add-incident')).toBeFocused();
    await page.locator('#lx-add-event').click();
    await expect(page.locator('#lx-event-form')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-event-sheet')).toHaveCount(0);

    await add.click();
    await page.locator('#lx-add-task').click();
    await expect(taskSheet(page)).toContainText('Nueva tarea');
    await expect(page.locator('#lx-task-title')).toBeFocused();
    // Added from «Hoy»: the day starts as today.
    await expectValue(page, 'lx-task-date', DAY);
    // A clean sheet closes on Escape and focus returns to «Añadir».
    await page.keyboard.press('Escape');
    await expect(taskSheet(page)).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('keyboard: Enter opens, arrows move, Escape closes returning focus', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    const add = page.locator('#lx-add');
    // Milestone 4: «Captura rápida» (Incidencia, Nota, Recurso, Persona),
    // then «Planificación» (Tarea, Evento, Empresa o entidad, Oferta).
    const incident = page.locator('#lx-add-incident');
    const note = page.locator('#lx-add-note');
    const task = page.locator('#lx-add-task');
    const offer = page.locator('#lx-add-offer');
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(incident).toBeFocused();
    const menu = page.getByRole('menu', {name: 'Qué quieres añadir'});
    await expect(menu.getByRole('menuitem')).toHaveCount(8);
    expect(
      await menu
        .getByRole('menuitem')
        .evaluateAll(els => els.map(el => el.id.replace('lx-add-', ''))),
    ).toEqual([
      'incident',
      'note',
      'resource',
      'contact',
      'task',
      'event',
      'company',
      'offer',
    ]);
    await expect(
      menu.getByRole('group', {name: 'Captura rápida'}).getByRole('menuitem'),
    ).toHaveCount(4);
    await expect(
      menu.getByRole('group', {name: 'Planificación'}).getByRole('menuitem'),
    ).toHaveCount(4);
    await page.keyboard.press('ArrowDown');
    await expect(note).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(incident).toBeFocused();
    // Arrows wrap at both ends.
    await page.keyboard.press('ArrowUp');
    await expect(offer).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(incident).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(task).toBeHidden();
    await expect(add).toBeFocused();
    await expect(add).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Enter');
    await expect(incident).toBeFocused();
    await page.keyboard.press('End');
    await expect(offer).toBeFocused();
    await page.keyboard.press('Home');
    await expect(incident).toBeFocused();
    // Down through the quick-capture group into «Planificación».
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(task).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await expect(page.locator('#lx-task-title')).toBeFocused();
  });

  test('phone: the floating «Añadir» offers both and Escape returns to it', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, planData());
    await signIn(page);
    const fab = page.locator('#lx-fab');
    await fab.click();
    // Milestone 4: quick capture first; the planning tiles still fit.
    await expect(page.locator('#lx-fab-incident')).toBeFocused();
    await expect(page.locator('#lx-fab-task')).toBeInViewport();
    await expect(page.locator('#lx-fab-offer')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-fab-task')).toBeHidden();
    await expect(fab).toBeFocused();

    await fab.click();
    await page.locator('#lx-fab-task').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await expect(page.locator('#lx-task-title')).toBeFocused();
    await expect(page.locator('#lx-task-save')).toBeInViewport();
  });
});

test.describe('Gestor logístico · crear tarea', () => {
  test('without a title shows a field error and sends nothing', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    const title = page.locator('#lx-task-title');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-title-error')).toHaveText(
      'Escribe qué hay que hacer, aunque sea provisional.',
    );
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toBeFocused();
    await title.fill('   ');
    await page.locator('#lx-task-save-next').click();
    await expect(page.locator('#lx-task-title-error')).toBeVisible();
    await expect(taskSheet(page)).toBeVisible();
    expect(api.calls('POST', '/tasks')).toHaveLength(0);
  });

  test('a title alone saves with nulls and lands under «Tareas sin fecha»', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    // From a space without a day, nothing is prefilled.
    await signIn(page, 'Elvis', '#logistica/contactos');
    await openAddTask(page);
    await expect(page.locator('#lx-task-date')).toHaveValue('');
    await page.locator('#lx-task-title').fill('  Comprar bridas  ');
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);

    expect(postBodies(api)).toEqual([
      {
        // M6: every create carries a device id (replay-safe outbox).
        id: expect.any(String),
        organizationId: ORG,
        title: 'Comprar bridas',
        kind: 'assembly',
        status: 'planned',
        eventId: null,
        venueName: null,
        companyName: null,
        date: null,
        endDate: null,
        startTime: null,
        endTime: null,
        dependsOn: [],
        heavyLoad: null,
        notes: null,
        source: null,
        verification: 'draft',
      },
    ]);
    expect(api.calls('POST', '/tasks')[0].authorization).toMatch(/^Bearer /);
    await expect(
      page.getByRole('status').filter({hasText: 'Tarea guardada'}),
    ).toContainText('Comprar bridas');

    await page.locator('#lx-nav-calendario').click();
    await expect(page.locator('#lx-cal-undated')).toContainText(
      'Comprar bridas',
    );
  });

  test('«Añadir tarea» in an event prefills event, day and venue', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await page.locator('[data-event-id="e1"] .lx-event__action').click();
    const eventTasks = page.locator('#lx-event-tasks');
    await expect(eventTasks.locator('.lx-count')).toHaveText('3');
    await page.locator('#lx-event-add-task').click();

    await expect(page.locator('#lx-task-form')).toBeVisible();
    await expectValue(page, 'lx-task-event', 'e1');
    await expectValue(page, 'lx-task-date', DAY);
    await expect(page.locator('#lx-task-venue')).toHaveValue(
      'Plaza del Cristo',
    );
    await page.locator('#lx-task-title').fill('Carpa de prensa');
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);

    expect(postBodies(api)[0]).toMatchObject({
      title: 'Carpa de prensa',
      eventId: 'e1',
      date: DAY,
      venueName: 'Plaza del Cristo',
    });
    // The event sheet underneath lists it straight away.
    await expect(page.locator('#lx-event-sheet')).toBeVisible();
    await expect(eventTasks.locator('.lx-count')).toHaveText('4');
    await expect(eventTasks).toContainText('Carpa de prensa');
  });

  test('venue and company typed by name are sent by name and resolved', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    await page.locator('#lx-task-title').fill('Entrega del generador');
    await page.locator('#lx-task-venue').fill('plaza del cristo');
    await page.locator('#lx-task-company').fill('Personal Prueba');
    await page.locator('#lx-task-start').fill('09:00');
    await page.locator('#lx-task-end').fill('10:00');
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);

    expect(postBodies(api)[0]).toMatchObject({
      venueName: 'plaza del cristo',
      companyName: 'Personal Prueba',
      date: DAY,
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(postBodies(api)[0]).not.toHaveProperty('venueId');
    // Existing venue matched case-insensitively; the company was created.
    expect(api.venues).toHaveLength(4);
    expect(api.companies.map(c => c.name)).toContain('Personal Prueba');

    const row = page.locator('#lx-today-tasks .lx-taskrow', {
      hasText: 'Entrega del generador',
    });
    await expect(row).toContainText('Plaza del Cristo');
    await expect(row).toContainText('Personal Prueba');

    // After the refresh the new company is offered by name.
    await expect
      .poll(() => api.calls('GET', /\/companies$/).length)
      .toBeGreaterThan(1);
    await openAddTask(page);
    await expect(
      page.locator('#lx-task-companies option[value="Personal Prueba"]'),
    ).toHaveCount(1);
  });

  test('times without a date are refused before sending', async ({page}) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    await page.locator('#lx-task-title').fill('Prueba de sonido');
    await page.locator('#lx-task-date').fill('');
    await page.locator('#lx-task-start').fill('18:00');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-date-error')).toHaveText(
      'Indica la fecha para poder guardar el horario.',
    );
    await expect(page.locator('#lx-task-date')).toBeFocused();

    await page.locator('#lx-task-start').fill('');
    await page.locator('#lx-task-end').fill('19:00');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-date-error')).toBeVisible();
    expect(api.calls('POST', '/tasks')).toHaveLength(0);
  });

  test('«Varios días» sends endDate and refuses a last day not after the first', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    await page.locator('#lx-task-title').fill('Vigilancia nocturna');
    await pick(page, 'lx-task-multiday');
    const end = page.locator('#lx-task-enddate');
    await expectValue(page, 'lx-task-enddate', addDays(DAY, 1));

    await end.fill(DAY);
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-enddate-error')).toHaveText(
      'El último día tiene que ser posterior al primero.',
    );
    await expect(end).toBeFocused();
    await end.fill(addDays(DAY, -1));
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-enddate-error')).toBeVisible();
    expect(api.calls('POST', '/tasks')).toHaveLength(0);

    await end.fill(addDays(DAY, 2));
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);
    expect(postBodies(api)[0]).toMatchObject({
      date: DAY,
      endDate: addDays(DAY, 2),
    });

    // It shows on every day it covers.
    await page.evaluate(
      h => {
        window.location.hash = h;
      },
      `#logistica/calendario/${addDays(DAY, 1)}`,
    );
    await expect(page.locator('#lx-day')).toContainText('Vigilancia nocturna');
  });

  test('«Guardar y seguir» keeps kind, event, venue and day', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    await pick(page, 'lx-task-kind-delivery');
    await choose(page, 'lx-task-event', 'e1');
    // Choosing the event fills the empty venue; the day was already today.
    await expect(page.locator('#lx-task-venue')).toHaveValue(
      'Plaza del Cristo',
    );
    const title = page.locator('#lx-task-title');
    await title.fill('Entrega de sillas');
    await page.locator('#lx-task-save-next').click();

    await expect(page.locator('#lx-task-saved')).toContainText(
      'Guardada «Entrega de sillas»',
    );
    await expect(title).toHaveValue('');
    await expect(title).toBeFocused();
    await expect(page.locator('#lx-task-kind-delivery')).toBeChecked();
    await expectValue(page, 'lx-task-event', 'e1');
    await expect(page.locator('#lx-task-venue')).toHaveValue(
      'Plaza del Cristo',
    );
    await expectValue(page, 'lx-task-date', DAY);

    await title.fill('Entrega de mesas');
    await expect(page.locator('#lx-task-saved')).toHaveCount(0);
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);
    const bodies = postBodies(api);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toMatchObject({
        kind: 'delivery',
        eventId: 'e1',
        venueName: 'Plaza del Cristo',
        date: DAY,
      });
    }
    expect(bodies.map(b => b.title)).toEqual([
      'Entrega de sillas',
      'Entrega de mesas',
    ]);
  });
});

test.describe('Gestor logístico · carga pesada', () => {
  test('asked for set-up, delivery, transport and dismantling only', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    const question = page.locator('#lx-task-heavy');
    for (const kind of ['assembly', 'delivery', 'transport', 'dismantling']) {
      await pick(page, `lx-task-kind-${kind}`);
      await expect(question, kind).toBeVisible();
      await expect(question.locator('legend')).toContainText(
        '¿Lleva carga pesada?',
      );
    }
    // «No lo sé» by default, shown as pending, never assumed light.
    await expect(page.locator('#lx-task-heavy-unknown')).toBeChecked();
    await expect(page.locator('.lx-heavyq__note')).toContainText(
      'no se da por ligera',
    );
    for (const kind of ['activity', 'other']) {
      await pick(page, `lx-task-kind-${kind}`);
      await expect(question, kind).toHaveCount(0);
    }

    // A «Sí» stays visible on any kind, so it can still be corrected.
    await pick(page, 'lx-task-kind-assembly');
    await pick(page, 'lx-task-heavy-yes');
    await pick(page, 'lx-task-kind-activity');
    await expect(question).toBeVisible();
    await expect(page.locator('#lx-task-heavy-yes')).toBeChecked();
    await pick(page, 'lx-task-heavy-no');
    await expect(question).toHaveCount(0);
  });

  test('Sí, No and No lo sé are sent as true, false and null', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    const title = page.locator('#lx-task-title');
    await expect(page.locator('#lx-task-kind-assembly')).toBeChecked();

    await title.fill('Escenario principal');
    await pick(page, 'lx-task-heavy-yes');
    await page.locator('#lx-task-save-next').click();
    await expect(page.locator('#lx-task-saved')).toBeVisible();

    await title.fill('Carpa de acreditación');
    await pick(page, 'lx-task-heavy-no');
    await page.locator('#lx-task-save-next').click();
    await expect(page.locator('#lx-task-saved')).toContainText(
      'Carpa de acreditación',
    );

    // The answer is not carried over to the next task.
    await expect(page.locator('#lx-task-heavy-unknown')).toBeChecked();
    await title.fill('Depósitos de agua');
    await page.locator('#lx-task-save-next').click();
    await expect(page.locator('#lx-task-saved')).toContainText(
      'Depósitos de agua',
    );

    // Without the question, nothing is assumed either.
    await pick(page, 'lx-task-kind-activity');
    await title.fill('Ensayo general');
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);

    expect(postBodies(api).map(b => [b.title, b.kind, b.heavyLoad])).toEqual([
      ['Escenario principal', 'assembly', true],
      ['Carpa de acreditación', 'assembly', false],
      ['Depósitos de agua', 'assembly', null],
      ['Ensayo general', 'activity', null],
    ]);
  });

  test('the «?» help is indicative and never certifies', async ({page}) => {
    await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    const help = page.locator('#lx-task-heavy .lx-help');
    await expect(help).toHaveAttribute('aria-label', /^¿Qué significa/);
    await help.click();
    const pop = page.locator('#lx-task-heavy .lx-help__pop');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('500 kg/m²');
    await expect(pop).toContainText('orientativo');
    await expect(pop).toContainText('no un límite certificado');
    const words = (await pop.innerText()).toLocaleLowerCase('es-ES');
    expect(words).not.toMatch(/\b(apto|apta|segur[oa]|admisible)\b/);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();

    // Answering «Sí» adds the subsoil reminder to this task's warnings.
    await page.locator('#lx-task-title').fill('Escenario principal');
    await pick(page, 'lx-task-heavy-yes');
    const reminder = page.locator(
      '#lx-task-warnings [data-warning="heavy_load"]',
    );
    await expect(reminder).toContainText('orientativo');
    await expect(reminder).toContainText('no un límite certificado');
  });
});

test.describe('Gestor logístico · «Empieza cuando termine…»', () => {
  test('a choice that would close a loop is disabled; others can be linked', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTaskFromHoy(page, 't1');
    // t2 waits for t1 directly, t3 through t2.
    const t2 = page.locator('#lx-task-dep-t2');
    const t3 = page.locator('#lx-task-dep-t3');
    await expect(t2).toBeDisabled();
    await expect(t3).toBeDisabled();
    // The reason names the real chain with the tasks' titles.
    await expect(page.locator('#lx-task-dep-t2-why')).toHaveText(
      '«Instalación de sonido» ya depende de esta tarea.',
    );
    await expect(page.locator('#lx-task-dep-t3-why')).toHaveText(
      '«Entrega de vallas» ya depende de «Instalación de sonido», que a su vez depende de esta tarea.',
    );
    await expect(t2).toHaveAttribute('aria-describedby', 'lx-task-dep-t2-why');
    await expect(t3).toHaveAttribute('aria-describedby', 'lx-task-dep-t3-why');
    await expect(page.locator('#lx-task-dependents')).toContainText(
      '«Instalación de sonido»',
    );

    const t4 = page.locator('#lx-task-dep-t4');
    await expect(t4).toBeEnabled();
    await pick(page, 'lx-task-dep-t4');
    await expect(t4).toBeChecked();
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);
    expect(api.calls('PATCH', '/tasks/t1')[0].body).toEqual({
      version: 1,
      dependsOn: ['t4'],
    });
  });

  test('a new task can wait for any task of the day', async ({page}) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    await expect(
      page.locator('#lx-task-deps input[type="checkbox"]'),
    ).toHaveCount(5);
    await expect(page.locator('#lx-task-deps input:disabled')).toHaveCount(0);
    await page.locator('#lx-task-title').fill('Prueba de luces');
    await pick(page, 'lx-task-dep-t1');
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);
    expect(postBodies(api)[0].dependsOn).toEqual(['t1']);
  });

  test('a cycle the server finds is shown on the field, nothing is lost', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTaskFromHoy(page, 't4');
    // Meanwhile someone made t5 wait for t4; this copy does not know yet.
    api.editTaskOnServer('t5', {dependsOn: ['t4']}, dailos);
    await pick(page, 'lx-task-dep-t5');
    await page.locator('#lx-task-save').click();

    const error = page.locator('#lx-task-deps .lx-field__error');
    await expect(error).toContainText('Esa dependencia crearía un ciclo');
    await expect(error).toContainText(
      '«Revisar extintores» → «Recogida de material en el almacén» → «Revisar extintores»',
    );
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(taskSheet(page)).toBeVisible();
    await expect(page.locator('#lx-task-dep-t5')).toBeChecked();
    await expect(page.locator('#lx-task-save')).toBeEnabled();
    expect(api.tasks.find(t => t.id === 't4')?.dependsOn).toEqual([]);

    await pick(page, 'lx-task-dep-t5');
    await expect(error).toHaveCount(0);
  });
});

test.describe('Gestor logístico · editar y borrar tareas', () => {
  test('409 keeps my text, shows who changed it and lets me discard mine', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTaskFromHoy(page, 't3');
    api.editTaskOnServer('t3', {notes: 'Llegan por la calle Herradores'});

    const notes = page.locator('#lx-task-notes');
    await notes.fill('Confirmar acceso');
    const save = page.locator('#lx-task-save');
    await save.click();

    const conflict = page.locator('#lx-task-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toBeFocused();
    await expect(conflict.locator('.lx-conflict__title')).toHaveText(
      'Otra persona ha cambiado esta tarea',
    );
    await expect(conflict).toContainText('Dailos lo guardó');
    // M5: the two copies are merged instead of blocking the form. Both
    // changed «Observaciones», so it is a clash, mine kept until I choose.
    await expect(conflict).toContainText('Aún no se ha guardado nada');
    await expect(page.locator('#lx-task-merge-clashes')).toContainText(
      'Observaciones',
    );
    await expect(page.locator('#lx-task-clash-notes-mine')).toBeChecked();
    await expect(save).toBeEnabled();
    await expect(notes).toHaveValue('Confirmar acceso');
    expect(
      (api.calls('PATCH', '/tasks/t3')[0].body as {version: number}).version,
    ).toBe(1);
    expect(api.calls('PATCH', '/tasks/t3')).toHaveLength(1);

    // «Descartar mis cambios» (the old «Ver versión actual» id).
    await expect(page.locator('#lx-task-load-current')).toHaveText(
      'Descartar mis cambios',
    );
    await page.locator('#lx-task-load-current').click();
    await expect(conflict).toHaveCount(0);
    await expect(page.locator('#lx-task-current-loaded')).toBeVisible();
    await expect(notes).toHaveValue('Llegan por la calle Herradores');
    await expect(save).toBeEnabled();
    await notes.fill('Llegan por la calle Herradores. Confirmar acceso.');
    await save.click();
    await expect(taskSheet(page)).toHaveCount(0);
    expect(api.calls('PATCH', '/tasks/t3')[1].body).toEqual({
      version: 2,
      notes: 'Llegan por la calle Herradores. Confirmar acceso.',
    });
  });

  test('delete names the dependents, sends the version and unlinks them', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTaskFromHoy(page, 't1');
    await page.locator('#lx-task-delete').click();
    await expect(page.locator('#lx-task-delete-text')).toHaveText(
      '¿Borrar «Montaje del escenario»?',
    );
    await expect(page.locator('#lx-task-delete-detail')).toHaveText(
      '«Instalación de sonido» empieza cuando termina esta y perderá ese enlace. No se puede deshacer.',
    );
    await page.locator('#lx-task-delete-keep').click();
    await expect(page.locator('#lx-task-delete-text')).toHaveCount(0);
    expect(api.calls('DELETE', '/tasks/t1')).toHaveLength(0);

    await page.locator('#lx-task-delete').click();
    const refreshed = page.waitForResponse(
      r =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname.endsWith('/tasks'),
    );
    await page.locator('#lx-task-delete-confirm').click();
    await expect(taskSheet(page)).toHaveCount(0);
    const deletes = api.calls('DELETE', '/tasks/t1');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].query).toBe('?version=1');
    await expect(
      page.getByRole('status').filter({hasText: 'Tarea borrada'}),
    ).toContainText('Montaje del escenario');
    await expect(todayRow(page, 't1')).toHaveCount(0);
    expect(api.tasks.find(t => t.id === 't2')).toMatchObject({
      dependsOn: [],
      version: 2,
    });
    await refreshed;

    // t2 no longer waits for anything and saves on top of its new version.
    await openTaskFromHoy(page, 't2');
    await expect(page.locator('#lx-task-dep-t1')).toHaveCount(0);
    await expect(page.locator('#lx-task-deps input:checked')).toHaveCount(0);
    await expect(
      page.locator('#lx-task-warnings [data-warning="dependency_order"]'),
    ).toHaveCount(0);
    await page.locator('#lx-task-notes').fill('Ya no espera al escenario');
    await page.locator('#lx-task-save').click();
    await expect(taskSheet(page)).toHaveCount(0);
    expect(api.calls('PATCH', '/tasks/t2')[0].body).toEqual({
      version: 2,
      notes: 'Ya no espera al escenario',
    });
  });

  test('a stale delete shows the conflict and deletes nothing', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTaskFromHoy(page, 't4');
    api.editTaskOnServer('t4', {notes: 'Revisados ayer'});
    await page.locator('#lx-task-delete').click();
    await expect(page.locator('#lx-task-delete-detail')).toHaveText(
      'No se puede deshacer.',
    );
    await page.locator('#lx-task-delete-confirm').click();

    const conflict = page.locator('#lx-task-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('No se ha borrado');
    await expect(conflict).toContainText('Dailos lo guardó');
    expect(api.calls('DELETE', '/tasks/t4')[0].query).toBe('?version=1');
    expect(api.tasks.some(t => t.id === 't4')).toBe(true);
    await expect(taskSheet(page)).toBeVisible();

    await page.locator('#lx-task-load-current').click();
    await expect(page.locator('#lx-task-notes')).toHaveValue('Revisados ayer');
    await page.locator('#lx-task-delete').click();
    await page.locator('#lx-task-delete-confirm').click();
    await expect(taskSheet(page)).toHaveCount(0);
    expect(api.calls('DELETE', '/tasks/t4')[1].query).toBe('?version=2');
    expect(api.tasks.some(t => t.id === 't4')).toBe(false);
    await expect(todayRow(page, 't4')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · tareas para el invitado', () => {
  test('no add menu, read-only task sheet, no delete', async ({page}) => {
    const api = await mockApi(page, planData());
    await signIn(page, 'Invitado');
    await expect(page.locator('#lx-readonly')).toBeVisible();
    await expect(page.locator('#lx-add')).toHaveCount(0);
    await expect(page.locator('#lx-fab')).toHaveCount(0);
    await expect(page.locator('#lx-today-add-task')).toHaveCount(0);

    await todayRow(page, 't1').click();
    const sheet = taskSheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('modo solo lectura');
    await expect(sheet).toContainText('Montaje del escenario');
    // Guests have no directory: the company reads generically (Revisión 1).
    await expect(sheet).not.toContainText('Escenarios Demo');
    await expect(sheet).toContainText('EmpresaEmpresa');
    await expect(page.locator('#lx-task-form')).toHaveCount(0);
    await expect(page.locator('#lx-task-save')).toHaveCount(0);
    await expect(page.locator('#lx-task-delete')).toHaveCount(0);
    await expect(sheet.locator('input, select, textarea')).toHaveCount(0);
    // Warnings are still there to read.
    await expect(
      page.locator('#lx-task-warnings [data-warning="venue_overlap"]'),
    ).toBeVisible();
    await page.locator('#lx-task-close').click();
    await expect(sheet).toHaveCount(0);

    // The event's task list offers no «Añadir tarea» either.
    await page.locator('[data-event-id="e1"] .lx-event__action').click();
    await expect(page.locator('#lx-event-tasks')).toContainText(
      'Instalación de sonido',
    );
    await expect(page.locator('#lx-event-add-task')).toHaveCount(0);
    await page.locator('#lx-event-close').click();

    await page.evaluate(h => {
      window.location.hash = h;
    }, `#logistica/calendario/${DAY}`);
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await expect(page.locator('#lx-cal-add-task')).toHaveCount(0);

    expect(
      api.requests.filter(r => r.method !== 'GET' && r.path !== '/auth/login'),
    ).toEqual([]);
  });
});
