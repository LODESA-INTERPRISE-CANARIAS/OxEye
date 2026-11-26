import {expect, test, type Page} from '@playwright/test';
import {
  makeContact,
  makeNote,
  mockApi,
  signIn,
  signInAgain,
  type MockOptions,
} from './mock-api';
import {DAY, fixClock} from './plan-fixtures';
import {M4_WITHHELD, NORTE, inventoryData} from './inventory-fixtures';

/**
 * Gestor logístico, milestone 4, privacy:
 * - the guest (Invitado) never receives event and task observations, a
 *   warehouse's address and observations, a resource's location and
 *   observations, or the text of any note: no marker is anywhere in the
 *   markup, across Hoy, Calendario, Inventarios, every sheet, search and the
 *   activity feed; «Visible para el equipo» is shown instead;
 * - for the team, a note's text appears only in the note itself and in notes
 *   lists: never in activity, search, accessible names, tooltips, toasts or
 *   the document title; and a note about a person is never labelled with the
 *   person's name outside the note.
 * Search finds warehouses and resources and never notes.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const ANA = {id: 'p1', name: 'Ana Prueba'};

/** Inventory data plus a person and an open incident about her. */
function privacyData(): MockOptions {
  const data = inventoryData();
  data.contacts = [makeContact(ANA.id, ANA.name, {role: 'Montadora'})];
  data.notes!.push(
    makeNote(
      'n7',
      'incident',
      'TEXTO-NOTA-PERSONA: se ha torcido un tobillo.',
      {
        createdAt: `${DAY}T08:00:00.000Z`,
        updatedAt: `${DAY}T08:00:00.000Z`,
        ref: {type: 'contact', id: ANA.id, label: ANA.name},
      },
    ),
  );
  return data;
}

/** No withheld marker anywhere in the module's markup or the page title. */
async function expectNothingWithheld(page: Page, where: string) {
  const html = await page
    .locator('#logistics-app')
    .evaluate(el => el.outerHTML);
  for (const v of [...M4_WITHHELD, 'Calle Ficticia']) {
    expect(html, `«${v}» in the DOM (${where})`).not.toContain(v);
  }
  expect(await page.title()).not.toContain('TEXTO-NOTA');
}

/** Accessible names, tooltips, toasts and the title never carry note text. */
async function expectNoNoteTextInLabels(page: Page, where: string) {
  const labels = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[aria-label], [title], [aria-description], [aria-roledescription]',
      ),
    ].flatMap(el =>
      ['aria-label', 'title', 'aria-description', 'aria-roledescription']
        .map(a => el.getAttribute(a))
        .filter((v): v is string => !!v),
    ),
  );
  for (const l of labels) {
    expect(l, `note text in a label (${where})`).not.toContain('TEXTO-NOTA');
  }
  expect(await page.title()).not.toContain('TEXTO-NOTA');
  await expect(
    page.getByRole('status').filter({hasText: 'TEXTO-NOTA'}),
  ).toHaveCount(0);
  if (await page.locator('#lx-activity').count()) {
    await expect(page.locator('#lx-activity')).not.toContainText('TEXTO-NOTA');
  }
}

async function openSearch(page: Page) {
  await page.locator('#lx-search').click();
  await expect(page.locator('#lx-search-input')).toBeFocused();
}

const hitTypes = (page: Page) =>
  page
    .locator('#lx-search-results [role="option"]')
    .evaluateAll(els => els.map(el => el.getAttribute('data-hit-type')));

test.describe('Gestor logístico · inventario y notas para el invitado', () => {
  test('never receives observations, addresses, locations or note text', async ({
    page,
  }) => {
    const api = await mockApi(page, privacyData());
    await signIn(page, 'Invitado');
    await expect(page.locator('#lx-readonly')).toBeVisible();

    // Hoy: notes card without capture buttons, every text withheld.
    const notes = page.locator('#lx-hoy-notes');
    await expect(notes.locator('[data-note-id]')).toHaveCount(5);
    await expect(notes.locator('.lx-noteitem__text').first()).toHaveText(
      'Visible para el equipo',
    );
    await expect(page.locator('#lx-hoy-add-incident')).toHaveCount(0);
    // A note about a person is not labelled with her name for the guest.
    await expect(notes.locator('[data-note-id="n7"]')).not.toContainText(
      ANA.name,
    );
    await expect(
      notes.locator('[data-note-id="n7"] .lx-noteitem__open'),
    ).not.toHaveAttribute('aria-label', new RegExp(ANA.name));
    await expectNothingWithheld(page, 'Hoy');

    // The incident itself: text withheld, scope in sight, nothing to edit.
    await notes.locator('[data-note-id="n1"] .lx-noteitem__open').click();
    const note = page.locator('#lx-note-sheet');
    await expect(page.locator('#lx-note-text')).toContainText(
      'Visible para el equipo',
    );
    await expect(page.locator('#lx-note-scope')).toBeVisible();
    await expect(page.locator('#lx-note-edit')).toHaveCount(0);
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveCount(0);
    await page.locator('#lx-note-history-toggle').click();
    await expect(page.locator('#lx-note-history')).toBeVisible();
    await expectNothingWithheld(page, 'note sheet');
    await page.locator('#lx-note-close').click();
    await expect(note).toHaveCount(0);

    // Event and task observations.
    await page
      .locator('[data-event-id="e1"]')
      .getByRole('button', {name: /Ver detalle/})
      .click();
    await expect(page.locator('#lx-event-sheet')).toContainText(
      'Visible para el equipo',
    );
    await expectNothingWithheld(page, 'event sheet');
    await page.locator('#lx-event-close').click();
    await page.locator('#lx-today-tasks [data-task-id="tA"]').click();
    const task = page.locator('#lx-task-sheet');
    await expect(task.locator('.lx-detail__notes')).toHaveText(
      'Visible para el equipo',
    );
    await expect(task).toContainText('Furgoneta Prueba');
    await expectNothingWithheld(page, 'task sheet');
    await page.locator('#lx-task-close').click();

    await page.locator('#lx-nav-calendario').click();
    await expect(page.locator('#lx-month')).toBeVisible();
    await expectNothingWithheld(page, 'Calendario');

    // Inventarios: names, quantities and states; never where or what notes.
    await page.locator('#lx-nav-inventarios').click();
    const north = page.locator(`[data-warehouse-id="${NORTE.id}"]`);
    await expect(north).toContainText('Visible para el equipo');
    await expect(north).not.toContainText('pendiente');
    await expect(page.locator('[data-resource-id="r1"]')).toContainText(
      '4 unidades',
    );
    await expectNothingWithheld(page, 'Inventarios');
    await north.locator('.lx-whgroup__open').click();
    await expect(page.locator('#lx-warehouse-detail')).toContainText(
      'Visible para el equipo',
    );
    // Withheld is not missing.
    await expect(page.locator('#lx-warehouse-missing')).toHaveCount(0);
    await expect(page.locator('#lx-warehouse-edit')).toHaveCount(0);
    await expectNothingWithheld(page, 'warehouse sheet');
    await page
      .locator(
        '#lx-warehouse-resources [data-resource-id="r1"] .lx-resrow__main',
      )
      .click();
    const detail = page.locator('#lx-resource-detail');
    await expect(detail).toContainText('Ubicación en el almacén');
    await expect(
      detail.locator('dd').filter({hasText: 'Visible para el equipo'}),
    ).toHaveCount(2);
    await expect(page.locator('#lx-resource-notelist')).toContainText(
      'Visible para el equipo',
    );
    await expect(page.locator('#lx-resource-edit')).toHaveCount(0);
    await expect(page.locator('#lx-resource-add-note')).toHaveCount(0);
    await expectNothingWithheld(page, 'resource sheet');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#lx-inventory-tab-contracted').click();
    await expectNothingWithheld(page, 'Contratados');

    // Search: inventory yes, notes and withheld text never.
    await openSearch(page);
    await page.locator('#lx-search-input').fill('prueba');
    await expect(page.locator('#lx-search-results')).toBeVisible();
    expect(await hitTypes(page)).not.toContain('note');
    await expectNothingWithheld(page, 'search');
    for (const q of ['TEXTO-NOTA', 'tobillo', 'Calle Ficticia', 'nave 2']) {
      await page.locator('#lx-search-input').fill(q);
      await expect(page.locator('#lx-search-noresults')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    expect(
      api.requests.filter(r => r.method !== 'GET' && r.path !== '/auth/login'),
    ).toEqual([]);
  });

  test('after a member logs out, the guest inherits none of it', async ({
    page,
  }) => {
    await mockApi(page, privacyData());
    await signIn(page, 'Elvis', '#logistica/inventarios');
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await expect(page.locator('#lx-resource-detail')).toContainText(
      'UBICACION-PRIVADA',
    );
    await page.keyboard.press('Escape');
    await page.locator('#lx-logout').click();
    await signInAgain(page, 'Invitado');
    await page.locator('#lx-nav-hoy').click();
    await expect(page.locator('#lx-hoy-notes [data-note-id]')).toHaveCount(5);
    await expectNothingWithheld(page, 'Hoy after logout');
    await page.locator('#lx-nav-inventarios').click();
    await expect(page.locator('[data-resource-id="r1"]')).toBeVisible();
    await expectNothingWithheld(page, 'Inventarios after logout');
  });
});

test.describe('Gestor logístico · el texto de las notas para el equipo', () => {
  test('only in the note and notes lists: never activity, search or labels', async ({
    page,
  }) => {
    await mockApi(page, privacyData());
    await signIn(page);
    // Hoy lists them (members read the first line)…
    await expect(page.locator('#lx-hoy-notes')).toContainText(
      'TEXTO-NOTA-HOY-2',
    );
    // …but the activity feed names notes by kind and link only.
    await expect(page.locator('#lx-activity')).toContainText(
      'la nota «Incidencia · Furgoneta Prueba»',
    );
    await expectNoNoteTextInLabels(page, 'Hoy');

    await openSearch(page);
    for (const q of ['TEXTO-NOTA', 'no arranca', 'tobillo', 'lonas']) {
      await page.locator('#lx-search-input').fill(q);
      await expect(page.locator('#lx-search-noresults')).toBeVisible();
    }
    await page.locator('#lx-search-input').fill('furgoneta');
    expect(await hitTypes(page)).toEqual(['resource']);
    await expect(page.locator('#lx-search-results')).not.toContainText(
      'TEXTO-NOTA',
    );
    await expectNoNoteTextInLabels(page, 'search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // In the note itself it is readable, and nowhere in labels or title.
    await page
      .locator('#lx-hoy-notes [data-note-id="n1"] .lx-noteitem__open')
      .click();
    await expect(page.locator('#lx-note-text')).toContainText(
      'TEXTO-NOTA-INCIDENCIA',
    );
    await expect(page.locator('#lx-note-sheet h2').first()).not.toContainText(
      'TEXTO-NOTA',
    );
    await expectNoNoteTextInLabels(page, 'note sheet');
    await page.locator('#lx-note-edit').click();
    await expect(page.locator('#lx-note-scope')).toBeVisible();
    await expectNoNoteTextInLabels(page, 'note form');
  });

  test('a note about a person is labelled without her name', async ({page}) => {
    const api = await mockApi(page, privacyData());
    await signIn(page, 'Elvis', '#logistica/contactos');
    await page
      .locator(`[data-contact-id="${ANA.id}"] .lx-dirrow__main`)
      .click();
    await expect(page.locator('#lx-contact-notelist')).toContainText(
      'TEXTO-NOTA-PERSONA',
    );
    await page.locator('#lx-contact-add-note').click();
    await expect(page.locator('#lx-note-ref')).toContainText(ANA.name);
    await page
      .locator('#lx-note-text-input')
      .fill('TEXTO-NOTA-ANA: confirma el turno de tarde.');
    await page.locator('#lx-note-save').click();
    await expect(page.locator('#lx-note-form')).toHaveCount(0);
    const toast = page.getByRole('status').filter({hasText: 'Guardada'});
    await expect(toast).toHaveText(/Guardada: Nota$/);
    expect(api.calls('POST', '/notes')[0].body).toMatchObject({
      ref: {type: 'contact', id: ANA.id},
    });
    await expectNoNoteTextInLabels(page, 'after saving');

    // The activity of the new note, as logged, never names her.
    const logged = api.activity.filter(a => a.entityType === 'note');
    expect(logged.map(a => a.entityLabel)).not.toContain(
      expect.stringContaining(ANA.name),
    );
    await page.locator('#lx-note-close').click();
    await page.keyboard.press('Escape');
    await page.locator('#lx-nav-hoy').click();
    await expect(page.locator('#lx-activity')).toContainText('la nota «Nota»');
    await expect(page.locator('#lx-activity')).not.toContainText(ANA.name);
    await expectNoNoteTextInLabels(page, 'Hoy after saving');
  });
});

test.describe('Gestor logístico · búsqueda en el inventario', () => {
  test('finds warehouses and resources and opens them', async ({page}) => {
    await mockApi(page, privacyData());
    await signIn(page);
    await openSearch(page);
    // Accent-insensitive; the warehouses and what is kept in them.
    await page.locator('#lx-search-input').fill('almacen prueba');
    await expect(
      page.locator('#lx-search-results [data-hit-type="warehouse"]'),
    ).toHaveCount(2);
    expect(new Set(await hitTypes(page))).toEqual(
      new Set(['warehouse', 'resource']),
    );
    await page.locator('#lx-search-input').fill('mesas');
    expect(await hitTypes(page)).toEqual(['resource']);
    // By warehouse name too, and by category.
    await page.locator('#lx-search-input').fill('norte');
    expect(new Set(await hitTypes(page))).toEqual(
      new Set(['warehouse', 'resource']),
    );
    await page.locator('#lx-search-type-resource').click();
    expect(new Set(await hitTypes(page))).toEqual(new Set(['resource']));
    await page
      .locator('#lx-search-results [role="option"]', {hasText: 'Vallas Prueba'})
      .click();
    await expect(page.locator('#lx-resource-sheet')).toContainText(
      'Vallas Prueba',
    );
    await page.keyboard.press('Escape');

    await openSearch(page);
    await page.locator('#lx-search-input').fill('almacen prueba sur');
    await page.locator('#lx-search-results [role="option"]').first().click();
    await expect(page.locator('#lx-warehouse-sheet')).toContainText(
      'Almacén Prueba Sur',
    );
  });
});
