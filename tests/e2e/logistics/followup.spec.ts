import {expect, test, type Page} from '@playwright/test';
import {dailos, makeTask, mockApi, signIn, type MockApi} from './mock-api';
import {DAY, NOW, fixClock} from './plan-fixtures';
import {followData, followTasks} from './followup-fixtures';

/**
 * Gestor logístico, milestone 5: «La jornada» in Hoy. Today's tasks grouped
 * at a fixed clock (10:30, 2 Dec 2026: followup-fixtures.ts), one-tap
 * «Empezar» / «Hecha» with «Deshacer», a toast that waits while it has focus
 * or the pointer, a 409 retried when only other fields changed and reported
 * when someone else already moved the task on, and the guest's read-only
 * day.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

type Json = Record<string, unknown>;

const ids = (page: Page, group: string) =>
  page
    .locator(`#lx-day-${group} li.lx-dayrow [data-task-id]`)
    .evaluateAll(els => els.map(el => el.getAttribute('data-task-id')));

const toast = (page: Page, text: string) =>
  page.locator('.lx-toast').filter({hasText: text});

const patches = (api: MockApi, id: string) =>
  api.calls('PATCH', `/tasks/${id}`).map(c => c.body as Json);

test.describe('Gestor logístico · la jornada', () => {
  test.beforeEach(async ({page}) => fixClock(page));

  test('late, now, next, later, untimed and finished at 10:30', async ({
    page,
  }) => {
    // h10 started three minutes ago: within the grace, «Debería empezar».
    const tasks = [
      ...followTasks(),
      makeTask(
        'h10',
        'Montaje de carpa Demo',
        {date: DAY, start: '10:27', end: '11:30'},
        {kind: 'other'},
      ),
    ];
    await mockApi(page, followData({tasks}));
    await signIn(page);
    const card = page.locator('#lx-today-tasks');
    await expect(card.locator('.lx-card__title')).toContainText('La jornada');
    await expect(card.locator('.lx-count--danger')).toHaveText('1 tarde');

    expect(await ids(page, 'late')).toEqual(['h1']);
    const h1 = card.locator('[data-task-id="h1"]');
    await expect(h1.locator('.lx-taskrow__flag')).toHaveText('+1 h 30 min');
    await expect(h1).toHaveAttribute('aria-label', /^Va tarde, \+1 h 30 min: /);

    // Under way first, then «Debería empezar».
    expect(await ids(page, 'now')).toEqual(['h6', 'h10']);
    await expect(
      card.locator('[data-task-id="h6"] .lx-taskrow__flag'),
    ).toHaveText('Ahora');
    await expect(
      card.locator('[data-task-id="h10"] .lx-taskrow__flag'),
    ).toHaveText('Debería empezar');

    expect(await ids(page, 'next')).toEqual(['h7']);
    await expect(page.locator('#lx-day-next-title')).toContainText('en 30 min');
    expect(await ids(page, 'later')).toEqual(['h2', 'h4', 'h3', 'h9']);
    expect(await ids(page, 'untimed')).toEqual(['h5']);
    await expect(page.locator('#lx-day-done summary')).toHaveText(
      'Terminadas (1)',
    );
    await expect(page.locator('#lx-day-done [data-task-id="h8"]')).toBeHidden();

    // Quick actions where a person on site acts: not on «Más tarde» or
    // «Terminadas», and no delay for a task without hours.
    await expect(page.locator('#lx-quick-start-h1')).toHaveText('Empezar');
    await expect(page.locator('#lx-quick-delay-h1')).toHaveText('Retraso…');
    await expect(page.locator('#lx-quick-done-h6')).toHaveText('Hecha');
    await expect(page.locator('#lx-quick-delay-h6')).toHaveText('Se alarga…');
    await expect(page.locator('#lx-quick-start-h7')).toBeVisible();
    await expect(page.locator('#lx-quick-start-h5')).toBeVisible();
    await expect(page.locator('#lx-quick-delay-h5')).toHaveCount(0);
    for (const later of ['h2', 'h4', 'h3', 'h9', 'h8']) {
      await expect(
        page.locator(`[id^="lx-quick-"][id$="-${later}"]`),
        later,
      ).toHaveCount(0);
    }
    await expect(
      page.getByRole('group', {
        name: 'Acciones rápidas: Reparto de mesas Demo',
      }),
    ).toBeVisible();
  });

  test('«Empezar» then «Hecha», and «Deshacer» puts it back', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);

    await page.locator('#lx-quick-start-h7').click();
    await expect(
      toast(page, 'En curso: «Reparto de mesas Demo».'),
    ).toBeVisible();
    expect(patches(api, 'h7')).toEqual([{version: 1, status: 'in_progress'}]);
    await expect(page.locator('#lx-day-now [data-task-id="h7"]')).toBeVisible();
    await expect(page.locator('#lx-day-next [data-task-id="h7"]')).toHaveCount(
      0,
    );

    await page.locator('#lx-quick-done-h7').click();
    const done = toast(page, 'Hecha: «Reparto de mesas Demo».');
    await expect(done).toBeVisible();
    expect(patches(api, 'h7')[1]).toEqual({version: 2, status: 'done'});
    await expect(page.locator('#lx-day-done summary')).toHaveText(
      'Terminadas (2)',
    );
    // h7 had no heavy load: no subsoil sentence.
    await expect(done).not.toContainText('subsuelo');

    await done.locator('.lx-toast__action').click();
    await expect(done).toHaveCount(0);
    await expect(
      toast(page, 'Deshecho: «Reparto de mesas Demo» vuelve a estar en curso.'),
    ).toBeVisible();
    expect(patches(api, 'h7')[2]).toEqual({version: 3, status: 'in_progress'});
    expect(api.tasks.find(t => t.id === 'h7')?.status).toBe('in_progress');
    await expect(page.locator('#lx-day-now [data-task-id="h7"]')).toBeVisible();
  });

  test('finishing a heavy task without a declared review keeps the reminder', async ({
    page,
  }) => {
    const tasks = followTasks().map(t =>
      t.id === 'h1' ? {...t, subsoilReview: null, status: 'in_progress'} : t,
    );
    await mockApi(page, followData({tasks}));
    await signIn(page);
    await page.locator('#lx-quick-done-h1').click();
    await expect(
      toast(
        page,
        'El recordatorio del subsuelo sigue: nadie ha declarado la revisión en el simulador.',
      ),
    ).toBeVisible();
    // Finishing is not reviewing: the reminder stays in «Avisos de hoy».
    await expect(
      page.locator('#lx-warnings [data-warning="heavy_load"]'),
    ).toContainText('Montaje del escenario Demo');
  });

  test('a 409 with the same status is retried with the current version', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect(page.locator('#lx-quick-start-h7')).toBeVisible();
    // Dailos only edited the notes: the status the user acted on is unchanged.
    api.editTaskOnServer('h7', {notes: 'Mesas en la puerta de atrás'}, dailos);

    await page.locator('#lx-quick-start-h7').click();
    await expect(
      toast(page, 'En curso: «Reparto de mesas Demo».'),
    ).toBeVisible();
    expect(patches(api, 'h7')).toEqual([
      {version: 1, status: 'in_progress'},
      {version: 2, status: 'in_progress'},
    ]);
    const stored = api.tasks.find(t => t.id === 'h7')!;
    expect(stored.status).toBe('in_progress');
    expect(stored.notes).toBe('Mesas en la puerta de atrás');
  });

  test('a 409 where someone moved it on says who, and never overwrites', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect(page.locator('#lx-quick-start-h7')).toBeVisible();
    api.editTaskOnServer('h7', {status: 'done'}, dailos);

    await page.locator('#lx-quick-start-h7').click();
    await expect(
      toast(page, '«Reparto de mesas Demo»: Dailos ya la marcó como Hecha.'),
    ).toBeVisible();
    expect(patches(api, 'h7')).toHaveLength(1);
    expect(api.tasks.find(t => t.id === 'h7')?.status).toBe('done');
    // The day shows the server copy: it is finished now.
    await expect(page.locator('#lx-day-done summary')).toHaveText(
      'Terminadas (2)',
    );
    await expect(page.locator('#lx-quick-start-h7')).toHaveCount(0);
  });

  test('a second 409 in a row says someone is changing it, and stops', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    // Someone keeps saving h7 (other fields): every write finds a newer copy.
    await page.route(
      u => u.pathname === '/api/tasks/h7',
      async route => {
        if (route.request().method() === 'PATCH') {
          api.editTaskOnServer('h7', {notes: 'Otra edición de Dailos'}, dailos);
        }
        await route.fallback();
      },
    );
    await signIn(page);
    await page.locator('#lx-quick-start-h7').click();
    await expect(
      toast(
        page,
        'No se pudo guardar: alguien la está cambiando. Inténtalo de nuevo.',
      ),
    ).toBeVisible();
    // One retry only, never a loop, and the status was not forced through.
    expect(patches(api, 'h7')).toHaveLength(2);
    expect(api.tasks.find(t => t.id === 'h7')?.status).toBe('planned');
    await expect(page.locator('#lx-quick-start-h7')).toBeEnabled();
  });

  test('toasts do not survive a logout (shared logins)', async ({page}) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-quick-start-h7').click();
    const started = toast(page, 'En curso: «Reparto de mesas Demo».');
    await expect(started).toBeVisible();
    await page.locator('#lx-logout').click();
    await expect(page.locator('#lx-login-users')).toBeVisible();
    await expect(page.locator('.lx-toast')).toHaveCount(0);
    // The next person does not get the previous one's «Deshacer».
    await page.locator('.lx-person[data-name="Dailos"]').click();
    await page.locator('#lx-login-password').fill('secreto');
    await page.locator('#lx-login-submit').click();
    await expect(page.locator('#lx-title')).toBeVisible();
    await expect(page.locator('.lx-toast__action')).toHaveCount(0);
  });

  test('«Deshacer» is a 44 px target on touch', async ({browser}) => {
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: {width: 390, height: 844},
      locale: 'es-ES',
      timezoneId: 'Atlantic/Canary',
    });
    const page = await context.newPage();
    await fixClock(page);
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-quick-start-h7').tap();
    const action = toast(page, 'En curso: «Reparto de mesas Demo».').locator(
      '.lx-toast__action',
    );
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test('the guest sees the day without quick actions', async ({page}) => {
    await mockApi(page, followData());
    await signIn(page, 'Invitado');
    await expect(
      page.locator('#lx-day-late [data-task-id="h1"]'),
    ).toBeVisible();
    await expect(page.locator('.lx-dayrow__actions')).toHaveCount(0);
    await expect(page.locator('[id^="lx-quick-"]')).toHaveCount(0);
    await expect(page.locator('#lx-today-add-task')).toHaveCount(0);
    // Exploring a delay changes nothing, so the guest may still ask «¿Y si…?».
    await expect(page.locator('#lx-today-whatif')).toBeVisible();
  });
});

test.describe('Gestor logístico · la jornada · aviso con «Deshacer»', () => {
  // Fake timers (from 10:30) so the toast's 6 s can be run without waiting.
  test.beforeEach(async ({page}) => {
    await page.clock.install({time: new Date(NOW)});
  });

  test('the undo toast waits while focused or hovered, then goes', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);

    // Left alone, a toast with an action goes after about 6 s.
    await page.locator('#lx-quick-start-h7').click();
    const started = toast(page, 'En curso: «Reparto de mesas Demo».');
    await expect(started).toBeVisible();
    await page.clock.runFor(6500);
    await expect(started).toHaveCount(0);

    // Keyboard: focus on «Deshacer» keeps it as long as needed.
    await page.locator('#lx-quick-done-h7').click();
    const done = toast(page, 'Hecha: «Reparto de mesas Demo».');
    await expect(done).toBeVisible();
    await done.locator('.lx-toast__action').focus();
    await page.clock.runFor(15_000);
    await expect(done).toBeVisible();
    await expect(done.locator('.lx-toast__action')).toBeFocused();

    // Once focus leaves, it goes a few seconds later.
    await page.locator('#lx-today-open-day').focus();
    await page.clock.runFor(4500);
    await expect(done).toHaveCount(0);
    // Nothing was undone by the wait.
    expect(api.tasks.find(t => t.id === 'h7')?.status).toBe('done');

    // Pointer: hovering keeps a toast too.
    await page.locator('#lx-quick-done-h6').click();
    const h6 = toast(page, 'Hecha: «Recogida de material Demo».');
    await expect(h6).toBeVisible();
    // The clicked row left the DOM under the pointer; start from elsewhere so
    // the browser sends a full leave/enter pair, as a moving hand does.
    await page.mouse.move(0, 0);
    await h6.hover();
    await page.clock.runFor(15_000);
    await expect(h6).toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(4500);
    await expect(h6).toHaveCount(0);
  });

  // Hover and focus hold a toast independently: the mouse passing over it
  // must not release it while a keyboard user is on «Deshacer».
  test('a pointer passing over does not release a toast that has focus', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-quick-start-h7').click();
    const started = toast(page, 'En curso: «Reparto de mesas Demo».');
    await expect(started).toBeVisible();
    await started.locator('.lx-toast__action').focus();
    await page.mouse.move(0, 0);
    await started.hover();
    await page.mouse.move(0, 0);
    await page.clock.runFor(15_000);
    await expect(started).toBeVisible({timeout: 1000});
    await expect(started.locator('.lx-toast__action')).toBeFocused();
  });
});
