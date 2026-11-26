import {expect, test, type Page} from '@playwright/test';
import {
  dailos,
  elvis,
  mockApi,
  signIn,
  signInAgain,
  storedRescue,
  type MockApi,
} from './mock-api';

/**
 * Gestor logístico, milestone 1: how the event sheet behaves around the
 * edges. Rescue of a form after the session expires, toasts while a modal
 * sheet is open, focus return, conflicts with one's own other session and the
 * discard confirmation.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

const sheet = (page: Page) => page.locator('#lx-event-sheet');
const card = (page: Page, id: string) =>
  page.locator(`[data-event-id="${id}"]`);
/** The live region outside any sheet (direct child of the module root). */
const outerToasts = (page: Page) =>
  page.locator('#logistics-app > .lx-toaster');

async function openCreate(page: Page) {
  // «Añadir» opens a menu (Evento / Tarea) since milestone 2.
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-event').click();
  await expect(page.locator('#lx-event-form')).toBeVisible();
  await expect(page.locator('#lx-event-name')).toBeFocused();
}

/** Makes the next authenticated call fail with 401 and waits for login. */
async function expireOnSave(page: Page, api: MockApi) {
  api.sessionExpired = true;
  await page.locator('#lx-event-save').click();
  await expect(page.locator('#lx-session-notice')).toContainText(
    'Tu sesión ha caducado',
  );
  await expect(page.locator('#lx-login-users')).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
}

test.describe('Gestor logístico · rescate tras caducar la sesión', () => {
  test('a new event typed before a 401 reopens for the same person', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Montaje rescatado');
    await page.locator('#lx-event-venue').fill('Plaza del Cristo');
    await expireOnSave(page, api);
    expect(await storedRescue(page)).not.toBeNull();

    await signInAgain(page, 'Elvis');
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#lx-event-rescued')).toContainText(
      'Hemos recuperado lo que estabas escribiendo',
    );
    await expect(page.locator('#lx-event-name')).toHaveValue(
      'Montaje rescatado',
    );
    await expect(page.locator('#lx-event-venue')).toHaveValue(
      'Plaza del Cristo',
    );

    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);
    const posts = api.calls('POST', '/events');
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toMatchObject({
      name: 'Montaje rescatado',
      venueName: 'Plaza del Cristo',
    });
    expect(await storedRescue(page)).toBeNull();
    await expect(
      page.getByRole('article', {name: 'Montaje rescatado'}),
    ).toBeVisible();
  });

  test('a form open during a background 401 is rescued too', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Escrito sin guardar');
    api.sessionExpired = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#lx-login-users')).toBeVisible();
    expect(api.calls('POST', '/events')).toHaveLength(0);

    await signInAgain(page, 'Elvis');
    await expect(page.locator('#lx-event-rescued')).toBeVisible();
    await expect(page.locator('#lx-event-name')).toHaveValue(
      'Escrito sin guardar',
    );
  });

  test('another person signing in never sees it and the rescue is dropped', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Solo para Elvis');
    await expireOnSave(page, api);
    expect(await storedRescue(page)).not.toBeNull();

    await signInAgain(page, 'Dailos');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Dailos');
    await expect.poll(() => storedRescue(page)).toBeNull();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByText('Solo para Elvis')).toHaveCount(0);

    // Elvis coming back later gets nothing either: it was discarded.
    await page.locator('#lx-logout').click();
    await signInAgain(page, 'Elvis');
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('discarding a rescued form spends the rescue', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Ya no hace falta');
    await expireOnSave(page, api);
    await signInAgain(page, 'Elvis');
    await expect(page.locator('#lx-event-rescued')).toBeVisible();

    await page.locator('#lx-event-cancel').click();
    await page.locator('#lx-discard-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(await storedRescue(page)).toBeNull();
    // A reload does not bring it back.
    await page.reload();
    await expect(page.locator('#lx-title')).toHaveText('Hola, Elvis');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('a rescued edit keeps the version it was based on', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await card(page, 'e2').locator('.lx-event__action').click();
    await page.locator('#lx-event-notes').fill('Confirmar sonido');
    await expireOnSave(page, api);

    await signInAgain(page, 'Elvis');
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText('Editar evento');
    await expect(page.locator('#lx-event-rescued')).toBeVisible();
    await expect(page.locator('#lx-event-notes')).toHaveValue(
      'Confirmar sonido',
    );

    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);
    const patches = api.calls('PATCH', '/events/e2');
    expect(patches).toHaveLength(2);
    expect(patches[1].body).toEqual({version: 1, notes: 'Confirmar sonido'});
    expect(await storedRescue(page)).toBeNull();
  });

  test('a rescued edit that went stale meanwhile still gets the 409 flow', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await card(page, 'e2').locator('.lx-event__action').click();
    await page.locator('#lx-event-notes').fill('Confirmar sonido');
    await expireOnSave(page, api);
    // While Elvis was signed out, Dailos saved the same event.
    api.editOnServer('e2', {notes: 'Sonido confirmado por Dailos'}, dailos);

    await signInAgain(page, 'Elvis');
    await expect(page.locator('#lx-event-notes')).toHaveValue(
      'Confirmar sonido',
    );
    await page.locator('#lx-event-save').click();

    const conflict = page.locator('#lx-event-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('Dailos lo guardó');
    // M5: the rescued text is merged with Dailos's copy (a clash on the
    // notes, mine kept); nothing is saved until «Guardar» again.
    await expect(page.locator('#lx-event-clash-notes-mine')).toBeChecked();
    await expect(page.locator('#lx-event-notes')).toHaveValue(
      'Confirmar sonido',
    );
    await expect(page.locator('#lx-event-save')).toBeEnabled();
    expect(
      (api.calls('PATCH', '/events/e2').at(-1)?.body as {version: number})
        .version,
    ).toBe(1);
    expect(api.events.find(e => e.id === 'e2')?.notes).toBe(
      'Sonido confirmado por Dailos',
    );

    await page.locator('#lx-event-load-current').click();
    await expect(page.locator('#lx-event-notes')).toHaveValue(
      'Sonido confirmado por Dailos',
    );
    await expect(page.locator('#lx-event-rescued')).toHaveCount(0);
    await expect(page.locator('#lx-event-save')).toBeEnabled();
  });
});

test.describe('Gestor logístico · avisos con una hoja abierta', () => {
  test('«Guardar y seguir» shows the toast inside the open sheet', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Vallas');
    await page.locator('#lx-event-save-next').click();

    const inSheet = sheet(page).locator('.lx-toast');
    await expect(inSheet).toBeVisible();
    await expect(inSheet).toHaveText('Evento guardado: Vallas');
    await expect(inSheet).toHaveAttribute('role', 'status');
    await expect(sheet(page).locator('.lx-toaster--in-sheet')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await expect(outerToasts(page).locator('.lx-toast')).toHaveCount(0);

    // It sits above the modal: its own close button works.
    await inSheet.getByRole('button', {name: 'Cerrar aviso'}).click();
    await expect(inSheet).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
  });

  test('a toast still showing moves to the page when the sheet closes', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Escenario B');
    await page.locator('#lx-event-save-next').click();
    await expect(sheet(page).locator('.lx-toast')).toBeVisible();
    // The form is clean again (no date kept), so Cancel closes at once.
    await page.locator('#lx-event-cancel').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(outerToasts(page).locator('.lx-toast')).toHaveText(
      'Evento guardado: Escenario B',
    );
  });

  test('closing on save announces «Cambios guardados» in the page region', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    await card(page, 'e1').locator('.lx-event__action').click();
    await page.locator('#lx-event-notes').fill('Revisar iluminación');
    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);

    const region = outerToasts(page);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    const toast = region.locator('.lx-toast');
    await expect(toast).toHaveText(
      'Cambios guardados: Navidad en la Plaza del Cristo',
    );
    await expect(toast).toHaveAttribute('role', 'status');
  });
});

test.describe('Gestor logístico · foco al cerrar la hoja', () => {
  test('Escape on a clean sheet closes it and focus returns to «Añadir»', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#lx-add')).toBeFocused();
  });

  test('after a successful save focus returns to «Añadir»', async ({page}) => {
    await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Carpa de acreditaciones');
    await page.locator('#lx-event-save').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#lx-add')).toBeFocused();
  });

  test('closing an edit returns focus to that card’s «Editar»', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    const edit = card(page, 'e1').locator('.lx-event__action');
    await edit.click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(edit).toBeFocused();
  });
});

test.describe('Gestor logístico · conflicto con otra sesión propia', () => {
  test('a 409 saved by the same user says it was you', async ({page}) => {
    const api = await mockApi(page);
    await signIn(page);
    await expect(card(page, 'e2')).toBeVisible();
    // Elvis himself saved it from another tab or device.
    api.editOnServer('e2', {notes: 'Desde el móvil'}, elvis);

    await card(page, 'e2').locator('.lx-event__action').click();
    await page.locator('#lx-event-notes').fill('Desde el portátil');
    await page.locator('#lx-event-save').click();

    const conflict = page.locator('#lx-event-conflict');
    await expect(conflict.locator('.lx-conflict__title')).toHaveText(
      'Este evento ha cambiado desde otra sesión tuya',
    );
    await expect(conflict).toContainText('Lo guardaste tú');
    await expect(conflict).not.toContainText('Otra persona');
    // M5: the clash names the other session, not another person.
    await expect(page.locator('#lx-event-merge-clashes')).toContainText(
      'Usar el de la otra sesión',
    );
    await expect(page.locator('#lx-event-save')).toBeEnabled();
    await page.locator('#lx-event-load-current').click();
    await expect(page.locator('#lx-event-notes')).toHaveValue('Desde el móvil');
  });
});

test.describe('Gestor logístico · confirmar descarte', () => {
  test('Escape asks, a second Escape goes back, only «Descartar» discards', async ({
    page,
  }) => {
    const api = await mockApi(page);
    await signIn(page);
    await openCreate(page);
    const name = page.locator('#lx-event-name');
    await name.fill('Plan de vallas');
    const strip = page.locator('#lx-discard-text');

    await page.keyboard.press('Escape');
    await expect(strip).toHaveText(
      'Tienes cambios sin guardar. ¿Descartarlos?',
    );
    await expect(sheet(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(strip).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    await expect(name).toHaveValue('Plan de vallas');

    // The header close button asks the same way; «Seguir editando» goes back.
    await sheet(page)
      .getByRole('button', {name: 'Cerrar', exact: true})
      .click();
    await expect(strip).toBeVisible();
    await page.locator('#lx-discard-keep').click();
    await expect(strip).toHaveCount(0);
    await expect(name).toHaveValue('Plan de vallas');

    // «Cancelar» asks too; only «Descartar» closes without saving.
    await page.locator('#lx-event-cancel').click();
    await expect(strip).toBeVisible();
    expect(api.calls('POST', '/events')).toHaveLength(0);
    await page.locator('#lx-discard-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(api.calls('POST', '/events')).toHaveLength(0);
  });

  test('repeated Escapes never close a dirty sheet or lose the text', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page);
    await openCreate(page);
    const name = page.locator('#lx-event-name');
    await name.fill('Plan de vallas');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Escape');
      // Let a native close (and the Sheet's re-show) settle before checking.
      await page.waitForTimeout(300);
      await expect(sheet(page)).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            (document.getElementById('lx-event-sheet') as HTMLDialogElement)
              .open,
        ),
      ).toBe(true);
      await expect(name).toHaveValue('Plan de vallas');
    }
  });

  test('every Escape toggles the discard question', async ({page}) => {
    // Regression: Chromium delivers repeated Escapes as a non-cancelable
    // `cancel` followed by a native `close`; the Sheet must ask the parent
    // only once per Escape.
    await mockApi(page);
    await signIn(page);
    await openCreate(page);
    await page.locator('#lx-event-name').fill('Plan de vallas');
    const strip = page.locator('#lx-discard-text');
    for (let i = 1; i <= 4; i++) {
      await page.keyboard.press('Escape');
      // The faulty Escape shows the question and removes it a moment later,
      // so check the settled state, not the first matching frame.
      await page.waitForTimeout(400);
      expect(await strip.count(), `after Escape ${i}`).toBe(i % 2);
    }
  });
});
