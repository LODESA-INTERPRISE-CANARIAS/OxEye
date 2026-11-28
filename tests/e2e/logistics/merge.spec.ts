import {expect, test, type Page} from '@playwright/test';
import {slotToInstants} from '../../../shared/logistics/time.ts';
import {lxUrl} from './address';
import {TZ, mockApi, signIn, type MockApi} from './mock-api';
import {DAY, fixClock, planData, planTasks} from './plan-fixtures';
import {directoryData} from './directory-fixtures';

/**
 * Gestor logístico, milestone 5: after a save hits a newer version (409) the
 * form merges instead of blocking. What only the other person changed is
 * taken from their copy, what only the user changed is kept, and each field
 * both changed is a choice («Usar el mío» by default, «Usar el suyo»). Date
 * and times are one choice, never a mix of two schedules. Nothing is saved
 * until «Guardar» again, and that save carries the current version and only
 * the user's own changes. Fixed clock (plan-fixtures.ts).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const patches = (api: MockApi, path: string) =>
  api.calls('PATCH', path).map(c => c.body as Json);

async function openTask(page: Page, id: string) {
  await page.locator(`#lx-today-tasks [data-task-id="${id}"]`).click();
  await expect(page.locator('#lx-task-form')).toBeVisible();
}

const conflictNotice = (page: Page, prefix: string) =>
  page.locator(`#${prefix}-conflict`);

test.describe('Gestor logístico · juntar cambios tras un 409', () => {
  test('a task: their other field is taken, mine kept, both saved', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't3');
    api.editTaskOnServer('t3', {title: 'Entrega de vallas (puerta norte)'});

    await page.locator('#lx-task-notes').fill('Prueba: confirmar acceso');
    await page.locator('#lx-task-save').click();

    const notice = conflictNotice(page, 'lx-task');
    await expect(notice).toBeFocused();
    await expect(notice).toContainText('Dailos lo guardó');
    await expect(notice).toContainText('Aún no se ha guardado nada');
    await expect(page.locator('#lx-task-merge-theirs')).toContainText(
      'Qué hay que hacer',
    );
    await expect(page.locator('#lx-task-merge-mine')).toContainText(
      'Lo que tú has cambiado se mantiene',
    );
    await expect(page.locator('#lx-task-merge-clashes')).toHaveCount(0);
    // Pre-filled with theirs; mine untouched.
    await expect(page.locator('#lx-task-title')).toHaveValue(
      'Entrega de vallas (puerta norte)',
    );
    await expect(page.locator('#lx-task-notes')).toHaveValue(
      'Prueba: confirmar acceso',
    );
    await expect(page.locator('#lx-task-save')).toBeEnabled();
    expect(patches(api, '/tasks/t3')).toHaveLength(1);

    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, '/tasks/t3')[1]).toEqual({
      version: 2,
      notes: 'Prueba: confirmar acceso',
    });
    const stored = api.tasks.find(t => t.id === 't3')!;
    expect(stored.title).toBe('Entrega de vallas (puerta norte)');
    expect(stored.notes).toBe('Prueba: confirmar acceso');
  });

  test('a clash: «Usar el suyo» takes their value, my other change is kept', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't3');
    api.editTaskOnServer('t3', {notes: 'Llegan por la calle Herradores'});

    await page.locator('#lx-task-notes').fill('Prueba: llegan por detrás');
    await page.locator('#lx-task-status-confirmed').click();
    await page.locator('#lx-task-save').click();

    const clash = page.locator('#lx-task-clash-notes');
    await expect(clash).toContainText('Observaciones');
    await expect(page.locator('#lx-task-clash-notes-mine')).toBeChecked();
    await expect(clash).toContainText('«Prueba: llegan por detrás»');
    await expect(clash).toContainText('«Llegan por la calle Herradores»');
    await page.locator('#lx-task-clash-notes-theirs').check();
    await expect(page.locator('#lx-task-clash-notes-theirs')).toBeChecked();
    await expect(page.locator('#lx-task-notes')).toHaveValue(
      'Llegan por la calle Herradores',
    );
    // Changing one's mind is possible until saving.
    await page.locator('#lx-task-clash-notes-mine').check();
    await expect(page.locator('#lx-task-notes')).toHaveValue(
      'Prueba: llegan por detrás',
    );
    await page.locator('#lx-task-clash-notes-theirs').check();
    await expect(page.locator('#lx-task-status-confirmed')).toBeChecked();

    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, '/tasks/t3')[1]).toEqual({
      version: 2,
      status: 'confirmed',
    });
    const stored = api.tasks.find(t => t.id === 't3')!;
    expect(stored.notes).toBe('Llegan por la calle Herradores');
    expect(stored.status).toBe('confirmed');
  });

  test('date and times are one choice, never a mix of two schedules', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't3');
    // t3 is 17:30–18:30. Dailos moves the start; I move the end.
    api.editTaskOnServer('t3', slotToInstants(DAY, '17:00', '18:30', TZ));
    await page.locator('#lx-task-end').fill('19:00');
    await page.locator('#lx-task-save').click();

    const clash = page.locator('#lx-task-clash-slot');
    await expect(clash).toContainText('Fecha y horario');
    await expect(clash).toContainText('17:30–19:00');
    await expect(clash).toContainText('17:00–18:30');
    // Mine by default: my start and my end, not their start with my end.
    await expect(page.locator('#lx-task-start')).toHaveValue('17:30');
    await expect(page.locator('#lx-task-end')).toHaveValue('19:00');
    await page.locator('#lx-task-clash-slot-theirs').check();
    await expect(page.locator('#lx-task-start')).toHaveValue('17:00');
    await expect(page.locator('#lx-task-end')).toHaveValue('18:30');
    // Nothing of mine is left: «Guardar» has nothing to send.
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, '/tasks/t3')).toHaveLength(1);
  });

  test('the notice is scrolled into view when it appears (desktop)', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 900});
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't1');
    await page.locator('#lx-task-subsoil-reviewed').check();
    await page.locator('#lx-task-notes').fill('Prueba: revisado');
    api.editTaskOnServer('t1', {
      venue: {id: 'v2', name: 'Plaza del Adelantado'},
      notes: 'Prueba: grúa a las 9',
    });
    await page.locator('#lx-task-save').click();
    const notice = conflictNotice(page, 'lx-task');
    await expect(notice).toBeFocused();
    // Its opening line («… ha cambiado esta tarea», who and when) is visible,
    // and stays so once any scrolling has settled.
    const heading = notice.getByText('Otra persona ha cambiado esta tarea');
    await expect(heading).toBeInViewport({ratio: 1});
    await page.waitForTimeout(1000);
    await expect(heading).toBeInViewport({ratio: 1});
  });

  test('the sheet keeps its header in place when the notice takes focus', async ({
    page,
  }) => {
    // The notice scrolls only the sheet body: the clipped `.lx-sheet` frame
    // must not scroll, or its header slides out of view.
    await page.setViewportSize({width: 1280, height: 900});
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't1');
    const title = page.locator('#lx-task-sheet h2').first();
    await expect(title).toBeInViewport({ratio: 1});
    await page.locator('#lx-task-notes').fill('Prueba: revisado');
    api.editTaskOnServer('t1', {notes: 'Prueba: grúa a las 9'});
    await page.locator('#lx-task-save').click();
    await expect(conflictNotice(page, 'lx-task')).toBeFocused();
    await page.waitForTimeout(1000);
    const scrolled = await page.locator('#lx-task-sheet').evaluate(el => {
      const out: string[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.scrollTop && getComputedStyle(n).overflowY === 'hidden') {
          out.push(`${n.className}:${n.scrollTop}`);
        }
      }
      el.querySelectorAll('*').forEach(n => {
        if (n.scrollTop && getComputedStyle(n).overflowY === 'hidden') {
          out.push(`${n.className}:${n.scrollTop}`);
        }
      });
      return out;
    });
    expect(scrolled).toEqual([]);
    await expect(title).toBeInViewport({ratio: 1});
  });

  test('their venue change resets my subsoil tick and says why', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't1');
    await page.locator('#lx-task-subsoil-reviewed').check();
    await page.locator('#lx-task-notes').fill('Prueba: revisado');
    // Meanwhile Dailos moves t1 to another venue.
    api.editTaskOnServer('t1', {
      venue: {id: 'v2', name: 'Plaza del Adelantado'},
    });
    await page.locator('#lx-task-save').click();

    await expect(page.locator('#lx-task-merge-theirs')).toContainText('Lugar');
    await expect(page.locator('#lx-task-merge-note')).toContainText(
      'vuelve a marcar la revisión del subsuelo solo si revisaste el plan nuevo en el simulador',
    );
    // The tick goes back to the server's (none), and it is not a choice.
    await expect(page.locator('#lx-task-subsoil-reviewed')).not.toBeChecked();
    await expect(page.locator('[id^="lx-task-clash-subsoil"]')).toHaveCount(0);
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, '/tasks/t1')[1]).toEqual({
      version: 2,
      notes: 'Prueba: revisado',
    });
    expect(api.tasks.find(t => t.id === 't1')?.subsoilReview).toBeNull();
  });

  test('a change by someone else that does not touch the placement keeps my tick', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      ...planData(),
      tasks: planTasks(),
    });
    await signIn(page);
    await openTask(page, 't1');
    await page.locator('#lx-task-subsoil-reviewed').check();
    api.editTaskOnServer('t1', {notes: 'Prueba: grúa a las 9'});
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-merge-note')).toHaveCount(0);
    await expect(page.locator('#lx-task-subsoil-reviewed')).toBeChecked();
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, '/tasks/t1')[1]).toEqual({
      version: 2,
      subsoilReviewed: true,
    });
  });

  test('a delete 409 is unchanged: nothing is merged or deleted', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openTask(page, 't4');
    api.editTaskOnServer('t4', {notes: 'Prueba: lo hace Dailos'});
    await page.locator('#lx-task-delete').click();
    await page.locator('#lx-task-delete-confirm').click();
    const notice = conflictNotice(page, 'lx-task');
    await expect(notice).toContainText('No se ha borrado');
    await expect(page.locator('#lx-task-merge-mine')).toHaveCount(0);
    await expect(page.locator('#lx-task-save')).toBeDisabled();
    expect(api.tasks.some(t => t.id === 't4')).toBe(true);
  });

  test('a person: their role is taken, my phone kept, both saved', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('[data-contact-id="p3"] .lx-dirrow__main').click();
    await page.locator('#lx-contact-edit').click();
    await page.locator('#lx-contact-phone').fill('+34 000 000 033');
    api.editDirectoryOnServer('contacts', 'p3', {role: 'Electricista'});
    await page.locator('#lx-contact-save').click();

    await expect(conflictNotice(page, 'lx-contact')).toContainText(
      'Dailos lo guardó',
    );
    await expect(page.locator('#lx-contact-merge-theirs')).toContainText(
      'Cargo',
    );
    await expect(page.locator('#lx-contact-role')).toHaveValue('Electricista');
    await expect(page.locator('#lx-contact-phone')).toHaveValue(
      '+34 000 000 033',
    );
    await page.locator('#lx-contact-save').click();
    await expect.poll(() => patches(api, '/contacts/p3').length).toBe(2);
    expect(patches(api, '/contacts/p3')[1]).toEqual({
      version: 2,
      phone: '+34 000 000 033',
    });
    const stored = api.contacts.find(c => c.id === 'p3')!;
    expect(stored.role).toBe('Electricista');
    expect(stored.phone).toBe('+34 000 000 033');
  });
});
