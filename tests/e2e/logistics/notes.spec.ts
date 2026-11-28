import {expect, test, type Page} from '@playwright/test';
import {
  INCIDENT_SCOPE_NOTE,
  NOTE_PRIVACY_HINT,
} from '../../../shared/logistics/rules.ts';
import {lxUrl} from './address';
import {ORG, makeNote, mockApi, signIn, type MockApi} from './mock-api';
import {DAY, fixClock} from './plan-fixtures';
import {choose} from './controls';
import {inventoryData} from './inventory-fixtures';

/**
 * Gestor logístico, milestone 4: quick capture of notes and incidents, the
 * «Notas» of every record, Hoy «Notas e incidencias», resolving an incident,
 * and the «Historial» of a record (loaded when opened, with loading, error
 * and empty states).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const noteSheet = (page: Page) => page.locator('#lx-note-sheet');
const notePosts = (api: MockApi) =>
  api.calls('POST', '/notes').map(c => c.body as Record<string, unknown>);
const noteIds = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-note-id]`)
    .evaluateAll(els => els.map(el => el.getAttribute('data-note-id')));

test.describe('Gestor logístico · incidencias y notas', () => {
  test('an incident from «+ Añadir» says what is not recorded here', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await page.locator('#lx-add').click();
    await expect(page.locator('#lx-add-incident')).toContainText(
      'Algo ha salido mal en la logística',
    );
    await page.locator('#lx-add-incident').click();
    await expect(page.locator('#lx-note-form')).toBeVisible();
    await expect(page.locator('#lx-note-kind-incident')).toBeChecked();
    const scope = page.locator('#lx-note-scope');
    await expect(scope).toHaveText(INCIDENT_SCOPE_NOTE);
    await expect(scope).toContainText('Punto Violeta');
    await expect(scope).toContainText('personas atendidas');
    await expect(page.locator('#lx-note-privacy')).toHaveText(
      NOTE_PRIVACY_HINT,
    );
    const text = page.locator('#lx-note-text-input');
    await expect(text).toBeFocused();
    // Both hints are read with the field.
    await expect(text).toHaveAttribute('aria-describedby', /lx-note-scope/);
    await expect(text).toHaveAttribute('aria-describedby', /lx-note-privacy/);

    // The text is the only required field.
    await page.locator('#lx-note-save').click();
    await expect(text).toBeFocused();
    expect(notePosts(api)).toEqual([]);

    const body = 'TEXTO-NOTA-NUEVA: el camión de vallas no llega.';
    await text.fill(body);
    await choose(page, 'lx-note-event', 'e1');
    await page.locator('#lx-note-save').click();
    await expect(page.locator('#lx-note-form')).toHaveCount(0);
    expect(notePosts(api)).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        kind: 'incident',
        text: body,
        eventId: 'e1',
        ref: null,
        resolved: false,
      }),
    ]);

    // The read view keeps the scope in sight; the title is what it is about.
    await expect(noteSheet(page)).toBeVisible();
    await expect(scope).toBeVisible();
    await expect(page.locator('#lx-note-text')).toContainText(body);
    await expect(noteSheet(page).locator('h2').first()).toHaveText(
      'Navidad en la Plaza del Cristo',
    );
    const toast = page
      .getByRole('status')
      .filter({hasText: 'Guardada'})
      .first();
    await expect(toast).toContainText(
      'Incidencia · Navidad en la Plaza del Cristo',
    );
    await expect(toast).not.toContainText('TEXTO-NOTA');

    // And in the edit form; another kind drops it.
    await page.locator('#lx-note-edit').click();
    await expect(scope).toBeVisible();
    await page.locator('#lx-note-kind-note').click();
    await expect(scope).toHaveCount(0);
    await expect(page.locator('#lx-note-privacy')).toBeVisible();
  });

  test('«Añadir nota» in a record’s sheet starts linked to that record', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    const list = page.locator('#lx-resource-notelist');
    await expect(
      list.locator('#lx-resource-notelist-title .lx-count'),
    ).toHaveText('1');
    await page.locator('#lx-resource-add-note').click();
    await expect(page.locator('#lx-note-form')).toBeVisible();
    await expect(page.locator('#lx-note-kind-note')).toBeChecked();
    await expect(page.locator('#lx-note-ref')).toContainText(
      'Carpa 3 × 6 Prueba',
    );
    await page
      .locator('#lx-note-text-input')
      .fill('TEXTO-NOTA-CARPA: la lona tiene un roce.');
    await page.locator('#lx-note-save').click();
    await expect(page.locator('#lx-note-form')).toHaveCount(0);
    expect(notePosts(api)[0]).toMatchObject({
      kind: 'note',
      ref: {type: 'resource', id: 'r1'},
    });
    await page.locator('#lx-note-close').click();

    // The resource sheet underneath lists it, newest first.
    await expect(
      list.locator('#lx-resource-notelist-title .lx-count'),
    ).toHaveText('2');
    await expect(list.locator('.lx-noteitem').first()).toContainText(
      'TEXTO-NOTA-CARPA',
    );
    await page.keyboard.press('Escape');

    // From a task, the note starts linked to the task.
    await page.locator('#lx-nav-hoy').click();
    await page.locator('#lx-today-tasks [data-task-id="tC"]').click();
    await expect(page.locator('#lx-task-notelist')).toContainText(
      'TEXTO-NOTA-HOY-2',
    );
    await page.locator('#lx-task-add-note').click();
    await expect(page.locator('#lx-note-ref')).toContainText(
      'Vallado Prueba A',
    );
  });

  test('Hoy: open incidents and questions first, then today’s notes', async ({
    page,
  }) => {
    await mockApi(page, inventoryData());
    await signIn(page);
    const card = page.locator('#lx-hoy-notes');
    await expect(card).toContainText('Notas e incidencias');
    expect(await noteIds(page, '#lx-hoy-notes')).toEqual([
      'n2',
      'n1',
      'n4',
      'n3',
    ]);
    await expect(page.locator('#lx-hoy-notes-open .lx-count')).toHaveText('2');
    await expect(page.locator('#lx-hoy-notes-today .lx-count')).toHaveText('2');
    await expect(card.locator('[data-note-id="n1"]')).toContainText('Abierta');
    await expect(card.locator('[data-note-id="n2"]')).toContainText(
      'Sin responder',
    );
    // Members read the first line here.
    await expect(card.locator('[data-note-id="n4"]')).toContainText(
      'TEXTO-NOTA-HOY-2',
    );
    // The open buttons are named by kind, link, status and author.
    await expect(
      card.locator('[data-note-id="n1"] .lx-noteitem__open'),
    ).toHaveAttribute(
      'aria-label',
      /^Abrir: Incidencia · Navidad en la Plaza del Cristo · Furgoneta Prueba · Abierta · Dailos, /,
    );

    // Two taps to capture from Hoy.
    await page.locator('#lx-hoy-add-note').click();
    await expect(page.locator('#lx-note-kind-note')).toBeChecked();
    await page.keyboard.press('Escape');
    await page.locator('#lx-hoy-add-incident').click();
    await expect(page.locator('#lx-note-kind-incident')).toBeChecked();
  });

  test('Hoy shows five and «Ver N más»; nothing today is an empty state', async ({
    page,
  }) => {
    const data = inventoryData();
    for (let i = 0; i < 6; i++) {
      data.notes!.push(
        makeNote(`m${i}`, 'note', `TEXTO-NOTA-EXTRA-${i}`, {
          createdAt: `${DAY}T0${i}:30:00.000Z`,
          updatedAt: `${DAY}T0${i}:30:00.000Z`,
        }),
      );
    }
    await mockApi(page, data);
    await signIn(page);
    // 2 open + 3 of the 8 written today.
    await expect(page.locator('#lx-hoy-notes [data-note-id]')).toHaveCount(5);
    const more = page.locator('#lx-hoy-notes-more');
    await expect(more).toHaveText('Ver 5 más');
    await more.click();
    await expect(page.locator('#lx-hoy-notes [data-note-id]')).toHaveCount(10);
    await expect(more).toHaveAttribute('aria-expanded', 'true');
  });

  test('no notes today: an empty state that invites capture', async ({
    page,
  }) => {
    const data = inventoryData();
    data.notes = [];
    await mockApi(page, data);
    await signIn(page);
    await expect(page.locator('#lx-hoy-notes-empty')).toContainText(
      'Nada pendiente ni apuntado hoy',
    );
  });

  test('resolving an incident takes it off Hoy; it can be reopened', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page);
    await page
      .locator('#lx-hoy-notes [data-note-id="n1"] .lx-noteitem__open')
      .click();
    await expect(noteSheet(page)).toContainText('Abierta');
    await expect(page.locator('#lx-note-scope')).toBeVisible();
    const toggle = page.locator('#lx-note-toggle-resolved');
    await expect(toggle).toHaveText('Marcar como resuelta');
    await toggle.click();
    await expect(toggle).toHaveText('Reabrir');
    expect(api.calls('PATCH', '/notes/n1').map(c => c.body)).toEqual([
      {version: 1, resolved: true},
    ]);
    const toast = page.getByRole('status').filter({hasText: 'resuelta'});
    await expect(toast).toContainText(
      'Incidencia · Furgoneta Prueba: resuelta',
    );
    await expect(toast).not.toContainText('TEXTO-NOTA');
    await page.keyboard.press('Escape');
    // Written yesterday and now resolved: no longer on Hoy.
    await expect(page.locator('#lx-hoy-notes [data-note-id="n1"]')).toHaveCount(
      0,
    );
    await expect(page.locator('#lx-hoy-notes-open .lx-count')).toHaveText('1');

    // Reopen from the resource it points at.
    await page.locator('#lx-nav-inventarios').click();
    await page.locator('[data-resource-id="r4"] .lx-resrow__main').click();
    await page
      .locator('#lx-resource-notelist [data-note-id="n1"] .lx-noteitem__open')
      .click();
    await page.locator('#lx-note-toggle-resolved').click();
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveText(
      'Marcar como resuelta',
    );
    expect(api.notes.find(n => n.id === 'n1')).toMatchObject({
      resolved: false,
      version: 3,
    });
  });
});

test.describe('Gestor logístico · historial de un registro', () => {
  test('loaded when opened: loading, then who changed what', async ({page}) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    const history = page.locator('#lx-resource-history');
    const toggle = page.locator('#lx-resource-history-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Nothing is fetched until it is opened.
    const historyCalls = () =>
      api
        .calls('GET', `/organizations/${ORG}/activity`)
        .filter(c => c.query.includes('entityType='));
    expect(historyCalls()).toHaveLength(0);

    const release = api.holdHistory();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(history.getByLabel('Cargando el historial')).toBeVisible();
    release();
    const items = history.locator('.lx-history__item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Dailos Cambió cantidad y estado');
    await expect(items.nth(1)).toContainText('Elvis Creó el registro');
    expect(historyCalls()[0].query).toContain('entityType=resource');
    expect(historyCalls()[0].query).toContain('entityId=r1');
    // Field names only, never values.
    await expect(history).not.toContainText('UBICACION');
    // Tapping the time shows the exact date.
    await items.nth(1).locator('.lx-history__time').click();
    await expect(items.nth(1).locator('.lx-history__time')).toContainText(
      'diciembre de 2026, 09:00',
    );
  });

  test('an error offers to retry; an empty history says so', async ({page}) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    api.failHistory = 1;
    await page.locator('#lx-resource-history-toggle').click();
    const err = page.locator('#lx-resource-history-error');
    await expect(err).toContainText('No se ha podido cargar el historial.');
    await page.locator('#lx-resource-history-retry').click();
    await expect(err).toHaveCount(0);
    await expect(
      page.locator('#lx-resource-history .lx-history__item'),
    ).toHaveCount(2);
    await page.keyboard.press('Escape');

    await page.locator('[data-resource-id="r2"] .lx-resrow__main').click();
    await page.locator('#lx-resource-history-toggle').click();
    await expect(page.locator('#lx-resource-history-empty')).toHaveText(
      'Aún no hay cambios registrados.',
    );
  });

  test('a saved change shows up in the history', async ({page}) => {
    await mockApi(page, inventoryData());
    await signIn(page, 'Elvis', lxUrl('inventarios'));
    await page.locator('[data-resource-id="r2"] .lx-resrow__main').click();
    await page.locator('#lx-resource-edit').click();
    await page.locator('#lx-resource-quantity').fill('180');
    await page
      .locator('#lx-resource-notes')
      .fill('OBS-NUEVA: dos vallas dobladas.');
    await page.locator('#lx-resource-save').click();
    await expect(page.locator('#lx-resource-form')).toHaveCount(0);
    await expect(page.locator('#lx-resource-facts')).toContainText(
      '180 unidades',
    );
    await page.locator('#lx-resource-history-toggle').click();
    // Field names only (`notes` reads «observaciones»), never the values.
    const last = page.locator('#lx-resource-history .lx-history__item').first();
    await expect(last).toContainText('Elvis Cambió cantidad y observaciones');
    await expect(page.locator('#lx-resource-history')).not.toContainText(
      'OBS-NUEVA',
    );

    // Every record sheet has one: a task and a warehouse too.
    await page.keyboard.press('Escape');
    await page.locator('[data-warehouse-id="w1"] .lx-whgroup__open').click();
    await expect(page.locator('#lx-warehouse-history-toggle')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#lx-nav-hoy').click();
    await page.locator('#lx-today-tasks [data-task-id="tA"]').click();
    await page.locator('#lx-task-history-toggle').click();
    await expect(page.locator('#lx-task-history-empty')).toBeVisible();
  });
});
