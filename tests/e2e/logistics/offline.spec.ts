import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {
  RESCUE_KEY,
  SESSION_KEY,
  demoEvent,
  mockApi,
  signIn,
  signInAgain,
  storedRescue,
  type MockApi,
} from './mock-api';
import {fixClock, planData} from './plan-fixtures';
import {ORDER_PRIVATE, followData} from './followup-fixtures';

/**
 * Gestor logístico, milestone 6: «Sin cobertura». What a member saves without
 * coverage stays on the device at once («Pendiente de enviar», an honest
 * chip), goes out by itself in order when the connection is back, and never
 * overwrites someone else's change; a server refusal waits for a person.
 * Deletes, «Aplicar al plan», hypotheses, categories and the demo removal are
 * never queued; guests queue nothing. Leaving with unsent changes asks first,
 * and leaving wipes the device's copy (shared devices).
 *
 * Coverage is cut with `context.setOffline` (navigator.onLine and the
 * `offline` event); «the server does not answer» with the mock's
 * `unreachable` (network errors with the network up). The dev server serves
 * no service worker, so a full page reload without network cannot load the
 * app: the «reopen without coverage» path is tested by booting with the API
 * unreachable, and with `navigator.onLine` false from an init script.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

// Same text as NEEDS_CONNECTION in src/logistics/store/useLogisticsStore.ts.
const NEEDS_CONNECTION =
  'Esto necesita conexión con el servidor. Inténtalo cuando vuelva la cobertura.';

const chip = (page: Page) => page.locator('#lx-sync-chip');
const chipLabel = (page: Page) => chip(page).locator('.lx-sync__label');
const toast = (page: Page, text: string | RegExp) =>
  page.locator('.lx-toast').filter({hasText: text});
const outbox = (page: Page) => page.locator('#lx-outbox-sheet');
/** Writes to the plan (signing in and out are not). */
const writes = (api: MockApi) =>
  api.requests.filter(r => r.method !== 'GET' && !r.path.startsWith('/auth/'));
const bodies = (api: MockApi, method: string, path: string | RegExp) =>
  api.calls(method, path).map(c => c.body as Json);

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect(chip(page)).toHaveAttribute('data-state', 'offline');
}

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await expect(chip(page)).not.toHaveAttribute('data-state', 'offline');
}

/** Everything in the device database, or null when it does not exist. */
async function deviceDump(
  page: Page,
): Promise<Record<string, unknown[]> | null> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'oxeye-logistics')) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('oxeye-logistics');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const out: Record<string, unknown[]> = {};
    for (const name of Array.from(db.objectStoreNames)) {
      out[name] = await new Promise<unknown[]>((resolve, reject) => {
        const q = db.transaction(name, 'readonly').objectStore(name).getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    }
    db.close();
    return out;
  });
}

const deviceText = async (page: Page) => JSON.stringify(await deviceDump(page));

/** Rows of the device's cached lists (none when the database is empty). */
const cachedLists = async (page: Page) =>
  ((await deviceDump(page))?.lists ?? []) as {key: string; items: unknown[]}[];

const webStorageText = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify({
      local: {...localStorage},
      session: {...sessionStorage},
    }),
  );

async function addResource(page: Page, name: string) {
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-resource').click();
  await expect(page.locator('#lx-resource-form')).toBeVisible();
  await page.locator('#lx-resource-name').fill(name);
  await page.locator('#lx-resource-save').click();
  await expect(page.locator('#lx-resource-form')).toHaveCount(0);
  await expect(page.locator('#lx-resource-sheet')).toContainText(name);
}

async function addContact(page: Page, name: string) {
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-contact').click();
  await expect(page.locator('#lx-contact-form')).toBeVisible();
  await page.locator('#lx-contact-name').fill(name);
  await page.locator('#lx-contact-save').click();
  await expect(page.locator('#lx-contact-form')).toHaveCount(0);
}

async function addNote(page: Page, text: string) {
  await page.locator('#lx-add').click();
  await page.locator('#lx-add-note').click();
  await expect(page.locator('#lx-note-form')).toBeVisible();
  await page.locator('#lx-note-text-input').fill(text);
  await page.locator('#lx-note-save').click();
  await expect(page.locator('#lx-note-form')).toHaveCount(0);
}

/**
 * «Enviar ahora» from «Cambios pendientes». The device also retries on its
 * own, so the list may already be empty when it opens.
 */
async function sendNow(page: Page) {
  await chip(page).click();
  const send = page.locator('#lx-outbox-send');
  if (await outbox(page).isVisible()) {
    if (await send.isEnabled()) await send.click();
  }
}

async function closeSheets(page: Page) {
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('.lx-sheet[open], dialog[open]').count()) === 0) {
      return;
    }
    await page.keyboard.press('Escape');
  }
}

test.describe('Gestor logístico · sin cobertura · captura y envío', () => {
  test('an incident, a resource and a person offline: saved at once, sent in order on return', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    const resourcesBefore = api.resources.length;
    const notesBefore = api.notes.length;
    const contactsBefore = api.contacts.length;

    await goOffline(context, page);
    await expect(chipLabel(page)).toHaveText('Sin conexión');

    // A resource first; then an incident about it, from its own sheet.
    await addResource(page, 'Conos Prueba');
    const resourceSheet = page.locator('#lx-resource-sheet');
    await expect(resourceSheet.locator('[data-unsent="pending"]')).toHaveText(
      'Pendiente de enviar',
    );
    await page.locator('#lx-resource-add-note').click();
    await expect(page.locator('#lx-note-form')).toBeVisible();
    await page.locator('#lx-note-kind-incident').click();
    await expect(page.locator('#lx-note-ref')).toContainText('Conos Prueba');
    await page
      .locator('#lx-note-text-input')
      .fill('TEXTO-NOTA-OFFLINE: faltan dos conos.');
    await page.locator('#lx-note-save').click();
    await expect(page.locator('#lx-note-form')).toHaveCount(0);
    await expect(
      page.locator('#lx-note-sheet [data-unsent="pending"]'),
    ).toHaveText('Pendiente de enviar');
    await closeSheets(page);

    await addContact(page, 'Persona Prueba Sin Cobertura');
    await expect(
      page.locator('#lx-contact-sheet [data-unsent="pending"]'),
    ).toHaveText('Pendiente de enviar');
    await closeSheets(page);

    // Nothing left the device; the chip says so, with the count.
    expect(writes(api)).toEqual([]);
    await expect(chipLabel(page)).toHaveText(
      'Sin conexión · 3 cambios pendientes',
    );
    await expect(chip(page)).toHaveAttribute(
      'aria-label',
      /Lo guardado está solo en este dispositivo/,
    );

    // «Cambios pendientes» lists them in the order they will be sent.
    await chip(page).click();
    await expect(outbox(page)).toBeVisible();
    await expect(page.locator('#lx-outbox-send')).toBeDisabled();
    const labels = outbox(page).locator('.lx-outbox__label');
    await expect(labels).toHaveText([
      'Nuevo recurso · Conos Prueba',
      /^Nueva nota · Incidencia/,
      'Nueva persona · Persona Prueba Sin Cobertura',
    ]);
    // Labels never carry the note's text.
    await expect(outbox(page)).not.toContainText('TEXTO-NOTA-OFFLINE');
    await page.locator('#lx-outbox-close').click();

    await goOnline(context, page);
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    await expect(page.locator('[data-unsent]')).toHaveCount(0);

    // In order; the incident points at the resource's device id, which the
    // server created first.
    const posted = writes(api).map(r => r.path);
    expect(posted).toEqual(['/resources', '/notes', '/contacts']);
    const [resource] = bodies(api, 'POST', '/resources');
    const [note] = bodies(api, 'POST', '/notes');
    expect(resource.id).toEqual(expect.any(String));
    expect(note).toMatchObject({
      kind: 'incident',
      ref: {type: 'resource', id: resource.id},
    });
    // No duplicates.
    expect(api.resources).toHaveLength(resourcesBefore + 1);
    expect(api.notes).toHaveLength(notesBefore + 1);
    expect(api.contacts).toHaveLength(contactsBefore + 1);
    expect(api.resources.find(r => r.name === 'Conos Prueba')?.id).toBe(
      resource.id,
    );
  });

  test('a lost response is replayed with the same id: 200, no duplicate', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    const before = api.resources.length;
    await goOffline(context, page);
    await addResource(page, 'Balizas Prueba');
    await closeSheets(page);

    // The server creates it, but its answer never arrives.
    api.loseResponse('POST', '/resources');
    await goOnline(context, page);
    await expect.poll(() => api.calls('POST', '/resources').length).toBe(1);
    await expect(chip(page)).toHaveAttribute('data-state', 'local_only');
    await expect(chipLabel(page)).toHaveText(
      'Solo en este dispositivo · 1 cambio',
    );
    expect(api.resources).toHaveLength(before + 1);

    await chip(page).click();
    const entry = outbox(page).locator('[data-outbox-entry]');
    await expect(entry).toContainText('Se reintentará');
    await entry.getByRole('button', {name: 'Reintentar ahora'}).click();
    await expect(chipLabel(page)).toHaveText('Sincronizado');

    const sent = bodies(api, 'POST', '/resources');
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    expect(api.resources).toHaveLength(before + 1);
    await expect(page.locator('[data-unsent]')).toHaveCount(0);
  });

  test('online, a save whose answer is lost: the error shows, the next save keeps the id', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    const before = api.contacts.length;
    api.loseResponse('POST', '/contacts');
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-contact').click();
    await page.locator('#lx-contact-name').fill('Persona Prueba Perdida');
    await page.locator('#lx-contact-save').click();
    // The first network failure is a form error: the text stays.
    await expect(page.locator('#lx-contact-form')).toBeVisible();
    await expect(page.locator('#lx-contact-name')).toHaveValue(
      'Persona Prueba Perdida',
    );
    await expect(chip(page)).toHaveAttribute('data-state', 'local_only');

    // The next save waits on the device, with the same device id.
    await page.locator('#lx-contact-save').click();
    await expect(page.locator('#lx-contact-form')).toHaveCount(0);
    await expect(page.locator('#lx-contact-sheet')).toContainText(
      'Persona Prueba Perdida',
    );
    await closeSheets(page);
    // The server answers again, so the queued create goes out by itself.
    await expect(chipLabel(page)).toHaveText('Sincronizado');

    const sent = bodies(api, 'POST', '/contacts');
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    expect(
      api.contacts.filter(c => c.name === 'Persona Prueba Perdida'),
    ).toHaveLength(1);
    expect(api.contacts).toHaveLength(before + 1);
  });

  test('server down with the network up: «Solo en este dispositivo», then sent', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    api.unreachable = true;
    // Tapping the chip retries the server.
    await chip(page).click();
    await expect(chip(page)).toHaveAttribute('data-state', 'local_only');
    await expect(chipLabel(page)).toHaveText('Solo en este dispositivo');
    await expect(chip(page)).toHaveAttribute(
      'aria-label',
      /El servidor no responde/,
    );

    await addNote(page, 'TEXTO-NOTA-SERVIDOR-CAIDO: revisar la caseta.');
    await expect(
      page.locator('#lx-note-sheet [data-unsent="pending"]'),
    ).toBeVisible();
    await closeSheets(page);
    await expect(chipLabel(page)).toHaveText(
      'Solo en este dispositivo · 1 cambio',
    );
    // The device keeps knocking, but nothing reached the server.
    const notesBefore = api.notes.length;
    expect(api.notes.some(n => String(n.text).includes('SERVIDOR-CAIDO'))).toBe(
      false,
    );

    api.unreachable = false;
    // The failed attempt waits for its retry; «Reintentar ahora» skips the
    // wait (the page clock is fixed, so the wait would never end here).
    await chip(page).click();
    await outbox(page)
      .locator('[data-outbox-entry]')
      .getByRole('button', {name: 'Reintentar ahora'})
      .click();
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    await expect(page.locator('[data-unsent]')).toHaveCount(0);
    expect(api.notes).toHaveLength(notesBefore + 1);
    const sent = bodies(api, 'POST', '/notes');
    // Every attempt carried the same device id; one record on the server.
    expect(new Set(sent.map(b => b.id)).size).toBe(1);
    expect(sent.at(-1)).toMatchObject({
      text: 'TEXTO-NOTA-SERVIDOR-CAIDO: revisar la caseta.',
    });
  });

  // «Enviar ahora» (here and in the logout confirmation) makes an entry
  // waiting for its retry due at once (`syncNow({now: true})`).
  test('«Enviar ahora» sends a change that waits for its retry', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    api.unreachable = true;
    await chip(page).click();
    await expect(chip(page)).toHaveAttribute('data-state', 'local_only');
    await addNote(page, 'TEXTO-NOTA-REINTENTO: prueba.');
    await closeSheets(page);
    await expect
      .poll(() => api.calls('POST', '/notes').length)
      .toBeGreaterThan(0);
    api.unreachable = false;
    await chip(page).click();
    await page.locator('#lx-outbox-send').click();
    await expect(chipLabel(page)).toHaveText('Sincronizado', {timeout: 8000});
  });

  test('«Hecha» from la jornada without coverage', async ({page, context}) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await goOffline(context, page);
    await page.locator('#lx-quick-done-h6').click();
    await expect(
      toast(page, 'Hecha: «Recogida de material Demo».'),
    ).toBeVisible();
    await expect(page.locator('#lx-day-done summary')).toHaveText(
      'Terminadas (2)',
    );
    expect(api.calls('PATCH', '/tasks/h6')).toHaveLength(0);
    await expect(chipLabel(page)).toHaveText(
      'Sin conexión · 1 cambio pendiente',
    );

    await goOnline(context, page);
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    expect(bodies(api, 'PATCH', '/tasks/h6')).toEqual([
      {version: 1, status: 'done'},
    ]);
    expect(api.tasks.find(t => t.id === 'h6')?.status).toBe('done');
  });
});

test.describe('Gestor logístico · sin cobertura · lo que necesita a una persona', () => {
  test('another person changed the task: nothing is overwritten, «Revisar» merges', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await goOffline(context, page);
    await page.locator('#lx-today-tasks [data-task-id="t3"]').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await page.locator('#lx-task-notes').fill('Prueba: sin cobertura');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    await expect(chipLabel(page)).toHaveText(
      'Sin conexión · 1 cambio pendiente',
    );

    // Meanwhile, Dailos renames it on the server.
    api.editTaskOnServer('t3', {title: 'Entrega de vallas (puerta norte)'});
    await goOnline(context, page);
    await expect(chip(page)).toHaveAttribute('data-state', 'attention');
    await expect(chipLabel(page)).toHaveText('1 cambio por revisar');
    await expect(
      toast(page, /otra persona lo cambió mientras no había conexión/),
    ).toBeVisible();
    // Nothing was overwritten: the server keeps Dailos's version only.
    expect(bodies(api, 'PATCH', '/tasks/t3')).toEqual([
      {version: 1, notes: 'Prueba: sin cobertura'},
    ]);
    const stored = api.tasks.find(t => t.id === 't3')!;
    expect(stored.notes).toBeNull();
    expect(stored.version).toBe(2);
    await expect(
      page.locator(
        '#lx-today-tasks [data-task-id="t3"] [data-unsent="review"]',
      ),
    ).toHaveCount(1);

    await chip(page).click();
    await expect(outbox(page)).toBeVisible();
    await expect(page.locator('#lx-outbox-needs-title')).toHaveText(
      'Necesitan que decidas (1)',
    );
    const entry = outbox(page).locator('[data-outbox-entry]');
    await expect(entry).toHaveAttribute('data-status', 'conflict');
    await expect(entry).toContainText('Otra persona lo cambió');
    await expect(entry).toContainText('Nada se ha sobrescrito');
    await entry.getByRole('button', {name: 'Revisar'}).click();

    // The M5 merge: their title, my observations.
    await expect(page.locator('#lx-task-conflict')).toBeVisible();
    await expect(page.locator('#lx-task-title')).toHaveValue(
      'Entrega de vallas (puerta norte)',
    );
    await expect(page.locator('#lx-task-notes')).toHaveValue(
      'Prueba: sin cobertura',
    );
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    expect(bodies(api, 'PATCH', '/tasks/t3')[1]).toEqual({
      version: 2,
      notes: 'Prueba: sin cobertura',
    });
    expect(api.tasks.find(t => t.id === 't3')).toMatchObject({
      title: 'Entrega de vallas (puerta norte)',
      notes: 'Prueba: sin cobertura',
    });
    await expect(page.locator('[data-unsent]')).toHaveCount(0);
  });

  test('a change the server refuses shows its error; «Descartar» asks first', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    const notesBefore = api.notes.length;
    await goOffline(context, page);
    await addNote(page, 'TEXTO-NOTA-RECHAZADA: prueba.');
    await closeSheets(page);
    api.rejectWrite('POST', '/notes', {text: 'Escribe el texto.'});
    await goOnline(context, page);

    await expect(chipLabel(page)).toHaveText('1 cambio por revisar');
    await expect(toast(page, /^No se ha enviado Nueva nota/)).toBeVisible();
    await chip(page).click();
    const entry = outbox(page).locator('[data-outbox-entry]');
    await expect(entry).toHaveAttribute('data-status', 'rejected');
    await expect(entry).toContainText('El servidor no lo aceptó');
    await expect(entry.locator('.lx-outbox__error')).toHaveText(
      'Revisa los datos marcados.',
    );
    await expect(entry).not.toContainText('TEXTO-NOTA-RECHAZADA');

    await entry.getByRole('button', {name: 'Descartar', exact: true}).click();
    const confirm = entry.locator('.lx-outbox__confirm');
    await expect(confirm).toContainText('¿Descartar «Nueva nota');
    await expect(confirm).toContainText(
      'El registro nuevo no llegará al servidor y desaparecerá de este dispositivo.',
    );
    // «Conservar» keeps it.
    await confirm.getByRole('button', {name: 'Conservar'}).click();
    await expect(entry).toHaveCount(1);
    await entry.getByRole('button', {name: 'Descartar', exact: true}).click();
    await entry.getByRole('button', {name: 'Descartar el cambio'}).click();
    await expect(page.locator('#lx-outbox-empty')).toBeVisible();
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    expect(api.notes).toHaveLength(notesBefore);
    // The device copy is rewritten shortly after (debounced): the discarded
    // note must not come back when the app reopens from it.
    await expect
      .poll(() => deviceText(page))
      .not.toContain('TEXTO-NOTA-RECHAZADA');
  });

  test('a queued «Subsuelo revisado» is dropped when the task moved meanwhile', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await goOffline(context, page);
    await page.locator('#lx-today-tasks [data-task-id="t1"]').click();
    await page.locator('#lx-task-subsoil-reviewed').check();
    await page
      .locator('#lx-task-notes')
      .fill('Prueba: revisado en el simulador');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);

    // Meanwhile the venue changes on the server.
    api.editTaskOnServer('t1', {
      venue: {id: 'v2', name: 'Plaza del Adelantado'},
    });
    await goOnline(context, page);
    await expect.poll(() => api.calls('PATCH', '/tasks/t1').length).toBe(1);
    const [sent] = bodies(api, 'PATCH', '/tasks/t1');
    expect(sent).not.toHaveProperty('subsoilReviewed');
    expect(sent).toMatchObject({notes: 'Prueba: revisado en el simulador'});
    await expect(
      toast(page, /«Subsuelo revisado» se ha retirado de/),
    ).toBeVisible();
    // Never declared on the server.
    expect(api.tasks.find(t => t.id === 't1')?.subsoilReview).toBeNull();
    await chip(page).click();
    await expect(outbox(page).locator('.lx-outbox__note')).toContainText(
      '«Subsuelo revisado» se retiró',
    );
  });
});

test.describe('Gestor logístico · sin cobertura · lo que nunca se pone en cola', () => {
  test('deleting a task needs the server', async ({page, context}) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await goOffline(context, page);
    await page.locator('#lx-today-tasks [data-task-id="t4"]').click();
    await page.locator('#lx-task-delete').click();
    await page.locator('#lx-task-delete-confirm').click();
    // Deletes are never queued: the sheet says so and keeps the task.
    await expect(page.locator('#lx-task-sheet')).toContainText(
      'la tarea no se ha borrado. Vuelve a intentarlo cuando haya conexión.',
    );
    await expect(page.locator('#lx-task-sheet')).toBeVisible();
    await expect(
      page.locator('#lx-today-tasks [data-task-id="t4"]').first(),
    ).toBeVisible();
    expect(api.calls('DELETE', /^\/tasks\//)).toHaveLength(0);
    await expect(chipLabel(page)).toHaveText('Sin conexión');
    await goOnline(context, page);
    expect(api.calls('DELETE', /^\/tasks\//)).toHaveLength(0);
  });

  test('«¿Y si…?» explores offline; saving and «Aplicar al plan» are disabled with the reason', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await goOffline(context, page);
    await page.locator('#lx-quick-delay-h1').click();
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    await page.locator('#lx-hypo-minutes').fill('30');
    const reason = page.locator('#lx-hypo-offline');
    await expect(reason).toHaveText(
      'Sin conexión: la hipótesis se puede explorar, pero guardarla o aplicarla al plan necesita el servidor.',
    );
    for (const id of ['#lx-hypo-apply', '#lx-hypo-save']) {
      await expect(page.locator(id)).toBeDisabled();
      await expect(page.locator(id)).toHaveAttribute(
        'aria-describedby',
        'lx-hypo-offline',
      );
    }
    await goOnline(context, page);
    expect(writes(api)).toEqual([]);
  });

  test('«Aplicar al plan» waits while an affected task has unsent changes', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    // An unsent change of h2 (which a delay of h1 moves), held as a conflict.
    await goOffline(context, page);
    await page.locator('#lx-today-tasks [data-task-id="h2"]').first().click();
    await page.locator('#lx-task-notes').fill('Prueba: cable largo');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    api.editTaskOnServer('h2', {notes: 'Prueba: otra persona'});
    await goOnline(context, page);
    await expect(chipLabel(page)).toHaveText('1 cambio por revisar');

    await page.locator('#lx-quick-delay-h1').click();
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    await page.locator('#lx-hypo-minutes').fill('30');
    await expect(page.locator('#lx-hypo-offline')).toHaveText(
      'Hay cambios de estas tareas guardados solo en este dispositivo: aplica la hipótesis cuando se hayan enviado.',
    );
    await expect(page.locator('#lx-hypo-apply')).toBeDisabled();
    // Saving the hypothesis itself is fine online.
    await expect(page.locator('#lx-hypo-save')).toBeEnabled();
    expect(api.calls('POST', /\/apply$/)).toHaveLength(0);
  });

  test('a new category and the demo removal need the server', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, {
      ...planData(),
      events: [...planData().events, demoEvent()],
    });
    await signIn(page);
    await goOffline(context, page);

    await page.locator('#lx-add').click();
    await page.locator('#lx-add-resource').click();
    await page.locator('#lx-resource-cat-new').click();
    await page.locator('#lx-resource-cat-name').fill('Categoría Prueba');
    await page.locator('#lx-resource-cat-add').click();
    await expect(page.locator('#lx-resource-cat-problem')).toContainText(
      NEEDS_CONNECTION,
    );
    await closeSheets(page);
    // A clean resource form closes on Escape; a dirty one asks: discard it.
    const discard = page.getByRole('button', {name: /Descartar/});
    if (await discard.count()) await discard.first().click();

    await page.locator('#lx-demo-remove').click();
    await page.locator('#lx-demo-confirm-button').click();
    await expect(page.locator('#lx-demo-confirm [role="alert"]')).toHaveText(
      NEEDS_CONNECTION,
    );
    await expect(chipLabel(page)).toHaveText('Sin conexión');
    await goOnline(context, page);
    expect(api.calls('POST', '/categories')).toHaveLength(0);
    expect(api.calls('DELETE', /\/demo$/)).toHaveLength(0);
  });

  test('the guest offline: nothing to write, nothing queued', async ({
    page,
    context,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page, 'Invitado');
    await goOffline(context, page);
    await expect(page.locator('#lx-add')).toHaveCount(0);
    await expect(page.locator('[id^="lx-quick-"]')).toHaveCount(0);
    await expect(chipLabel(page)).toHaveText('Sin conexión');
    await goOnline(context, page);
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    expect(writes(api)).toEqual([]);
    const dump = await deviceDump(page);
    expect(dump?.outbox ?? []).toEqual([]);
  });
});

test.describe('Gestor logístico · sin cobertura · la copia del dispositivo', () => {
  test('reopened while the server does not answer: from the device copy', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect
      .poll(async () => (await cachedLists(page)).length)
      .toBeGreaterThan(5);
    api.unreachable = true;
    await page.reload();
    await expect(page.locator('#lx-title')).toBeVisible();
    await expect(chip(page)).toHaveAttribute('data-state', 'local_only');
    await expect(
      page.locator('#lx-today-tasks [data-task-id="h7"]').first(),
    ).toBeVisible();

    // A save waits on the device; the server comes back; it goes out.
    await addNote(page, 'TEXTO-NOTA-ARRANQUE: llegó la grúa.');
    await closeSheets(page);
    await expect(chipLabel(page)).toHaveText(
      'Solo en este dispositivo · 1 cambio',
    );
    api.unreachable = false;
    await sendNow(page);
    await expect(chipLabel(page)).toHaveText('Sincronizado');
    expect(api.calls('POST', '/notes')).toHaveLength(1);
  });

  test('reopened with the browser offline: «Sin conexión» from the device copy', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect
      .poll(async () => (await cachedLists(page)).length)
      .toBeGreaterThan(5);
    // What a service-worker reload without coverage looks like to the app.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });
    const before = api.requests.length;
    await page.reload();
    await expect(page.locator('#lx-title')).toBeVisible();
    await expect(chip(page)).toHaveAttribute('data-state', 'offline');
    await expect(
      page.locator('#lx-today-tasks [data-task-id="h7"]').first(),
    ).toBeVisible();
    // It did not even ask the server.
    expect(api.requests.slice(before).filter(r => r.path === '/me')).toEqual(
      [],
    );
  });

  test('logout with unsent changes asks first; «Salir y descartarlos» wipes the device', async ({
    page,
    context,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    // A member's copy holds contact phones and notes: that is why it goes.
    await expect
      .poll(() => deviceText(page))
      .toContain(ORDER_PRIVATE.contactPhone);
    await goOffline(context, page);
    await addNote(page, 'TEXTO-NOTA-SALIR: no enviada.');
    await closeSheets(page);
    // A rescued form from an earlier expiry is on the device too.
    await page.evaluate(
      key => sessionStorage.setItem(key, JSON.stringify({kind: 'note'})),
      RESCUE_KEY,
    );

    await page.locator('#lx-logout').click();
    const confirm = page.locator('#lx-leave-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Tienes 1 cambio sin enviar');
    await expect(confirm).toContainText(/^.*Nueva nota/);
    await expect(confirm).not.toContainText('TEXTO-NOTA-SALIR');
    // Without coverage there is no «Enviar ahora», and it says why.
    await expect(page.locator('#lx-leave-send')).toHaveCount(0);
    await expect(confirm).toContainText(
      'Sin conexión no se pueden enviar ahora',
    );
    // «Cancelar» keeps everything.
    await page.locator('#lx-leave-cancel').click();
    await expect(confirm).toHaveCount(0);
    await expect(chipLabel(page)).toHaveText(
      'Sin conexión · 1 cambio pendiente',
    );

    await page.locator('#lx-logout').click();
    await page.locator('#lx-leave-discard').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    await expect
      .poll(async () => {
        const dump = await deviceDump(page);
        return dump
          ? Object.values(dump).reduce((n, rows) => n + rows.length, 0)
          : 0;
      })
      .toBe(0);
    expect(await storedRescue(page)).toBeNull();
    const storage = await webStorageText(page);
    for (const marker of [
      ORDER_PRIVATE.contactPhone,
      ORDER_PRIVATE.personNotes,
      ORDER_PRIVATE.noteText,
      'TEXTO-NOTA-SALIR',
    ]) {
      expect(storage, marker).not.toContain(marker);
      expect(await deviceText(page), marker).not.toContain(marker);
    }
    expect(storage).not.toContain(SESSION_KEY);
  });

  test('another person signing in after an expiry wipes the previous copy first', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect
      .poll(async () => (await cachedLists(page)).map(r => r.key).join(' '))
      .toContain('u-elvis|');
    // The session expires: the device keeps Elvis's copy for Elvis.
    api.sessionExpired = true;
    await chip(page).click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    expect(
      (await cachedLists(page)).some(r => r.key.startsWith('u-elvis|')),
    ).toBe(true);

    await signInAgain(page, 'Dailos');
    await expect
      .poll(async () => (await cachedLists(page)).map(r => r.key).join(' '))
      .toContain('u-dailos|');
    const dump = await deviceDump(page);
    expect(JSON.stringify(dump)).not.toContain('u-elvis|');
    expect(
      (dump?.meta as {key: string}[])
        .map(m => m.key)
        .filter(k => /elvis/.test(k)),
    ).toEqual([]);
  });

  test('a guest’s copy never holds a withheld value, even if the server sent one', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    // A server bug: the guest receives the withheld fields.
    api.leakToGuests = true;
    await signIn(page, 'Invitado');
    await expect
      .poll(async () => (await cachedLists(page)).length)
      .toBeGreaterThan(5);
    // Wait for the lists with private fields to be stored.
    await expect
      .poll(async () =>
        (await cachedLists(page))
          .map(r => r.key.split('|')[2])
          .sort()
          .join(','),
      )
      .toContain('contacts');
    const text = await deviceText(page);
    for (const [name, marker] of Object.entries(ORDER_PRIVATE)) {
      expect(text, name).not.toContain(marker);
    }
  });
});
