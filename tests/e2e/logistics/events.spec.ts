import {expect, test, type Page} from '@playwright/test';
import {
  ORG,
  addDays,
  dailos,
  defaultEvents,
  demoEvent,
  mockApi,
  signIn,
  today,
  type MockApi,
} from './mock-api';
import {expectValue} from './controls';

/**
 * Gestor logístico, milestone 1: creating and editing events, the version
 * conflict (409), the guest's read-only mode and removing demo data.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

const PHONE = {width: 390, height: 844};

const sheet = (page: Page) => page.locator('#lx-event-sheet');
const card = (page: Page, id: string) =>
  page.locator(`[data-event-id="${id}"]`);

async function openCreate(page: Page) {
  // «Añadir» opens a menu (Evento / Tarea) since milestone 2.
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-event').click();
  await expect(page.locator('#lx-event-form')).toBeVisible();
  await expect(page.locator('#lx-event-name')).toBeFocused();
}

function lastCreateBody(api: MockApi): Record<string, unknown> {
  const call = api.calls('POST', '/events').at(-1);
  expect(call, 'a POST /events was sent').toBeTruthy();
  return call!.body as Record<string, unknown>;
}

test.describe('Gestor logístico · crear evento', () => {
  test('without a name shows a field error and sends nothing', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);

    await page.locator('#lx-event-save').click();
    const nameError = page.locator('#lx-event-name-error');
    await expect(nameError).toHaveText(
      'Escribe un nombre, aunque sea provisional.',
    );
    const name = page.locator('#lx-event-name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toBeFocused();
    await expect(sheet(page)).toBeVisible();
    expect(api.calls('POST', '/events')).toHaveLength(0);

    // Only spaces count as empty too.
    await name.fill('   ');
    await page.locator('#lx-event-save').click();
    await expect(nameError).toBeVisible();
    expect(api.calls('POST', '/events')).toHaveLength(0);
  });

  test('times without a date are refused before sending', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Prueba de sonido');
    await page.locator('#lx-event-start').fill('18:00');
    await page.locator('#lx-event-save').click();
    await expect(page.locator('#lx-event-date-error')).toHaveText(
      'Indica la fecha para poder guardar el horario.',
    );
    await expect(page.locator('#lx-event-date')).toBeFocused();
    expect(api.calls('POST', '/events')).toHaveLength(0);
  });

  test('with only a name it saves, sends no times and shows the event', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('  Montaje de escenario  ');
    await page.locator('#lx-event-save').click();

    await expect(sheet(page)).toHaveCount(0);
    const body = lastCreateBody(api);
    expect(body.organizationId).toBe(ORG);
    expect(body.name).toBe('Montaje de escenario');
    expect(body.date ?? null).toBeNull();
    expect(body.startTime ?? null).toBeNull();
    expect(body.endTime ?? null).toBeNull();
    expect(body.venueName ?? null).toBeNull();
    expect(api.calls('POST', '/events')[0].authorization).toMatch(/^Bearer /);

    // Undated events are listed under «Sin fecha», with nothing invented.
    const created = page.locator('#lx-undated').getByRole('article', {
      name: 'Montaje de escenario',
    });
    await expect(created).toBeVisible();
    await expect(created).toContainText('Lugar pendiente de verificar');
    await expect(created).toContainText('Horario pendiente de verificar');
    await expect(
      page.getByRole('status').filter({hasText: 'Evento guardado'}),
    ).toContainText('Montaje de escenario');

    // Still there after the background refetch the store triggers.
    await expect
      .poll(() => api.calls('GET', /\/events$/).length)
      .toBeGreaterThan(1);
    await expect(created).toBeVisible();
  });

  test('a date without times is allowed and lands in «Hoy»', async ({page}) => {
    const api = await mockApi(page, {events: []});
    await signIn(page);
    await expect(page.locator('#lx-today-empty')).toBeVisible();
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Reparto de vallas');
    await page.locator('#lx-event-date').fill(today);
    await page.locator('#lx-event-venue').fill('Plaza del Cristo');
    await page.locator('#lx-event-save').click();

    await expect(sheet(page)).toHaveCount(0);
    const body = lastCreateBody(api);
    expect(body.date).toBe(today);
    expect(body.startTime ?? null).toBeNull();
    expect(body.endTime ?? null).toBeNull();
    expect(body.venueName).toBe('Plaza del Cristo');

    const created = page.locator('#lx-today').getByRole('article', {
      name: 'Reparto de vallas',
    });
    await expect(created).toBeVisible();
    await expect(created).toContainText('Plaza del Cristo');
    await expect(created).toContainText('Horario pendiente de verificar');
    await expect(page.locator('#lx-today-empty')).toHaveCount(0);
  });

  test('«Guardar y seguir» keeps the sheet open with a notice and the date', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    const tomorrow = addDays(today, 1);
    const name = page.locator('#lx-event-name');
    await name.fill('Vallas lado norte');
    await page.locator('#lx-event-date').fill(tomorrow);
    await page.locator('#lx-event-save-next').click();

    await expect(page.locator('#lx-event-saved')).toContainText(
      'Guardado «Vallas lado norte»',
    );
    await expect(sheet(page)).toBeVisible();
    await expect(name).toHaveValue('');
    await expect(name).toBeFocused();
    await expectValue(page, 'lx-event-date', tomorrow);
    expect(lastCreateBody(api).name).toBe('Vallas lado norte');

    // Typing the next one hides the notice; «Guardar» then closes.
    await name.fill('Vallas lado sur');
    await expect(page.locator('#lx-event-saved')).toHaveCount(0);
    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);

    const posts = api.calls('POST', '/events');
    expect(posts).toHaveLength(2);
    expect((posts[1].body as Record<string, unknown>).date).toBe(tomorrow);
    const upcoming = page.locator('#lx-upcoming');
    await expect(
      upcoming.getByRole('article', {name: 'Vallas lado norte'}),
    ).toBeVisible();
    await expect(
      upcoming.getByRole('article', {name: 'Vallas lado sur'}),
    ).toBeVisible();
  });

  test('no connection while saving keeps the draft and can be retried', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Generador de apoyo');
    api.writesOffline = true;
    await page.locator('#lx-event-save').click();

    const formError = page.locator('#lx-event-error');
    await expect(formError).toContainText('Servidor no disponible');
    await expect(formError).toBeFocused();
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#lx-event-name')).toHaveValue(
      'Generador de apoyo',
    );
    await expect(page.locator('#lx-event-save')).toBeEnabled();

    api.writesOffline = false;
    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(
      page.getByRole('article', {name: 'Generador de apoyo'}),
    ).toBeVisible();
  });

  test('a 401 while saving returns to login with the expiry message', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Guardado tras caducar');
    api.sessionExpired = true;
    await page.locator('#lx-event-save').click();
    await expect(page.locator('#lx-session-notice')).toContainText(
      'Tu sesión ha caducado',
    );
    await expect(page.locator('#lx-login-form')).toBeVisible();
    expect(api.calls('POST', '/events')).toHaveLength(1);
    expect(api.events.some(e => e.name === 'Guardado tras caducar')).toBe(
      false,
    );
  });

  test('closing with unsaved text asks before discarding', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Algo a medias');
    await page.locator('#lx-event-cancel').click();
    await expect(page.locator('#lx-discard-text')).toBeVisible();
    await page.locator('#lx-discard-keep').click();
    await expect(page.locator('#lx-event-name')).toHaveValue('Algo a medias');
    await page.locator('#lx-event-cancel').click();
    await page.locator('#lx-discard-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(api.calls('POST', '/events')).toHaveLength(0);
  });
});

test.describe('Gestor logístico · editar con conflicto de versión', () => {
  for (const [label, viewport] of [
    ['desktop', {width: 1280, height: 900}],
    ['phone', PHONE],
  ] as const) {
    test(`409 shows who changed it, merges and «Descartar mis cambios» loads theirs (${label})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const api = await mockApi(page);
      await signIn(page);
      await expect(card(page, 'e2')).toBeVisible();

      // Dailos saves the same event after we loaded the list.
      api.editOnServer('e2', {notes: 'Sonido confirmado por Dailos'}, dailos);

      await card(page, 'e2')
        .getByRole('button', {name: 'Editar Concierto de villancicos'})
        .click();
      await expect(page.locator('#lx-event-form')).toBeVisible();
      const notes = page.locator('#lx-event-notes');
      await notes.fill('Confirmar sonido');
      const save = page.locator('#lx-event-save');
      await save.click();

      const conflict = page.locator('#lx-event-conflict');
      await expect(conflict).toBeVisible();
      await expect(conflict).toBeFocused();
      await expect(conflict).toBeInViewport();
      await expect(conflict.locator('.lx-conflict__title')).toHaveText(
        'Otra persona ha cambiado este evento',
      );
      await expect(conflict).toContainText('Dailos lo guardó');
      await expect(conflict).not.toContainText('Lo guardaste tú');
      // M5: merged, not blocked. Both changed the notes: a clash, mine kept
      // by default, and «Guardar» stays available.
      await expect(page.locator('#lx-event-merge-clashes')).toBeVisible();
      await expect(page.locator('#lx-event-clash-notes-mine')).toBeChecked();
      await expect(save).toBeEnabled();
      // Our text is not thrown away until we choose to load the server copy.
      await expect(notes).toHaveValue('Confirmar sonido');
      const firstPatch = api.calls('PATCH', '/events/e2')[0];
      expect((firstPatch.body as Record<string, unknown>).version).toBe(1);

      await page.locator('#lx-event-load-current').click();
      await expect(conflict).toHaveCount(0);
      await expect(page.locator('#lx-event-current-loaded')).toBeVisible();
      await expect(notes).toHaveValue('Sonido confirmado por Dailos');
      await expect(save).toBeEnabled();

      // Re-applying the change saves on top of version 2.
      await notes.fill('Sonido confirmado por Dailos. Revisar cableado.');
      await save.click();
      await expect(sheet(page)).toHaveCount(0);
      const patches = api.calls('PATCH', '/events/e2');
      expect(patches).toHaveLength(2);
      expect(patches[1].body).toEqual({
        version: 2,
        notes: 'Sonido confirmado por Dailos. Revisar cableado.',
      });
      await expect(
        page.getByRole('status').filter({hasText: 'Cambios guardados'}),
      ).toBeVisible();
    });
  }

  test('saving without changes does not send a request', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await card(page, 'e1').locator('.lx-event__action').click();
    await expect(page.locator('#lx-event-form')).toBeVisible();
    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(api.calls('PATCH', /^\/events\//)).toHaveLength(0);
  });
});

test.describe('Gestor logístico · invitado (solo lectura)', () => {
  test('sees everything, can change nothing', async ({page}) => {
    const api = await mockApi(page, {
      events: [...defaultEvents(), demoEvent()],
    });
    await signIn(page, 'Invitado');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Invitado');
    await expect(page.locator('#lx-readonly')).toBeVisible();
    await expect(page.locator('#lx-readonly')).toContainText('Solo lectura');
    await expect(page.locator('#lx-add')).toHaveCount(0);
    await expect(page.locator('#lx-fab')).toHaveCount(0);

    // Demo notice informs but offers no removal.
    await expect(page.locator('#lx-demo-notice')).toContainText(
      'Solo el equipo puede quitarlos.',
    );
    await expect(page.locator('#lx-demo-remove')).toHaveCount(0);

    // Cards offer «Ver detalle», never «Editar».
    const e1 = card(page, 'e1');
    await expect(e1.locator('.lx-event__action')).toHaveText('Ver detalle');
    await expect(
      page.locator('.lx-event__action', {hasText: 'Editar'}),
    ).toHaveCount(0);
    await e1
      .getByRole('button', {
        name: 'Ver detalle de Navidad en la Plaza del Cristo',
      })
      .click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText('modo solo lectura');
    await expect(sheet(page)).toContainText('Plaza del Cristo');
    await expect(page.locator('#lx-event-form')).toHaveCount(0);
    await expect(page.locator('#lx-event-save')).toHaveCount(0);
    await page.locator('#lx-event-close').click();
    await expect(sheet(page)).toHaveCount(0);

    expect(
      api.requests.filter(r => r.method !== 'GET' && r.path !== '/auth/login'),
    ).toEqual([]);
  });

  test('the phone layout has no floating «Añadir» either', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page);
    await signIn(page, 'Invitado');
    await expect(page.locator('#lx-readonly')).toBeVisible();
    await expect(page.locator('#lx-fab')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · datos de demostración', () => {
  test('a member removes them after confirming', async ({page}) => {
    const api = await mockApi(page, {
      events: [...defaultEvents(), demoEvent()],
    });
    await signIn(page);
    const notice = page.locator('#lx-demo-notice');
    await expect(notice).toBeVisible();
    await expect(card(page, 'e-demo')).toBeVisible();

    // Cancel first: nothing is deleted.
    await page.locator('#lx-demo-remove').click();
    const confirm = page.locator('#lx-demo-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAttribute('role', 'alertdialog');
    await page.locator('#lx-demo-cancel').click();
    await expect(confirm).toBeHidden();
    expect(api.calls('DELETE', /\/demo$/)).toHaveLength(0);

    await page.locator('#lx-demo-remove').click();
    await page.locator('#lx-demo-confirm-button').click();
    await expect(notice).toHaveCount(0);
    await expect(card(page, 'e-demo')).toHaveCount(0);
    await expect(card(page, 'e1')).toBeVisible();

    const deletes = api.calls('DELETE', `/organizations/${ORG}/demo`);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].authorization).toMatch(/^Bearer /);
    await expect(
      page.getByRole('status').filter({hasText: 'demostración'}),
    ).toContainText('Se ha quitado 1 registro de demostración.');
  });

  test('no notice when there is no demo data', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    await expect(card(page, 'e1')).toBeVisible();
    await expect(page.locator('#lx-demo-notice')).toHaveCount(0);
  });
});
