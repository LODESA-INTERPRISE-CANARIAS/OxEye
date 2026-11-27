import {expect, test, type Page} from '@playwright/test';
import {dailos, mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {choose, expectValue} from './controls';
import {
  ORDER_PRIVATE,
  SUBSOIL_DECLARED,
  followData,
  followTasks,
  openHypothesis,
  today,
} from './followup-fixtures';

/**
 * Gestor logístico, milestone 5: «¿Y si…?». Exploring a delay never writes;
 * the sheet shows what moves, what absorbs it, the margin before the event,
 * route reminders (A/B/C, Carpa Amarilla) and the warnings re-run on the
 * hypothetical plan; saving shows a dashed «Hipótesis» chip in Hoy; «Aplicar al plan»
 * asks first, moves only times (and marks the task «Con retraso» if ticked)
 * and refuses when the plan changed; discarding, the applied read-only view,
 * the guest and «Se alarga». Fixed clock 10:30 (followup-fixtures.ts).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const sheet = (page: Page) => page.locator('#lx-hypo-sheet');
/** Writes to the plan (signing in and out are not). */
const writes = (api: MockApi) =>
  api.requests.filter(r => r.method !== 'GET' && !r.path.startsWith('/auth/'));
const toast = (page: Page, text: string) =>
  page.locator('.lx-toast').filter({hasText: text});
/** The new times of a moved task in a list («Se mueven», confirmation). */
const movedTo = (page: Page, list: string, title: string) =>
  page
    .locator(`${list} li.lx-hypo-moved`)
    .filter({hasText: title})
    .locator('strong');
const task = (api: MockApi, id: string) => api.tasks.find(t => t.id === id)!;
const ms = (iso: unknown) => Date.parse(iso as string);

async function openDelay(page: Page, id: string) {
  await page.locator(`#lx-quick-delay-${id}`).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#lx-hypo-results')).toBeVisible();
}

/** Opens «Retraso…» on h1 with a given delay. */
async function delayH1(page: Page, minutes: number) {
  await openDelay(page, 'h1');
  await page.locator('#lx-hypo-minutes').fill(String(minutes));
  await expect(page.locator('#lx-hypo-summary')).toContainText(
    minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`,
  );
}

test.describe('Gestor logístico · ¿Y si…? · explorar', () => {
  test('exploring writes nothing: figures, modes, a note, Enter, closing', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    const before = JSON.stringify(api.tasks);

    // From Hoy: choose the task, late and running ones first.
    await page.locator('#lx-today-whatif').click();
    await expect(sheet(page)).toBeVisible();
    await expectValue(page, 'lx-hypo-task', 'h1');
    // h1 is 1 h 30 min late: that is the delay proposed.
    await expect(page.locator('#lx-hypo-minutes')).toHaveValue('90');
    await expect(page.locator('#lx-hypo-label')).toHaveText(
      'Hipótesis: no cambia el plan',
    );
    for (const m of [5, 15, 30, 60]) {
      await page.locator(`#lx-hypo-quick-${m}`).click();
      await expect(page.locator(`#lx-hypo-quick-${m}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    await page.locator('#lx-hypo-minutes').fill('0');
    await expect(page.locator('#lx-hypo-minutes-error')).toContainText(
      'entre 1 y 1440',
    );
    await expect(page.locator('#lx-hypo-results')).toHaveCount(0);
    await expect(page.locator('#lx-hypo-apply')).toBeDisabled();
    await page.locator('#lx-hypo-minutes').fill('45');
    await page.locator('#lx-hypo-minutes').press('Enter');
    await page
      .locator('input[name="lx-hypo-mode"][value="extend"]')
      .check({force: true});
    await page.locator('#lx-hypo-estimated').check();
    await expect(page.locator('#lx-hypo-summary')).toContainText('≈ 45 min');
    await page.locator('#lx-hypo-note').fill('Prueba: no se guarda');
    await choose(page, 'lx-hypo-task', 'h7');
    await expect(sheet(page).locator('.lx-sheet__title')).toHaveText(
      'Reparto de mesas Demo',
    );
    await page.locator('#lx-hypo-close').click();
    await expect(sheet(page)).toHaveCount(0);

    // From a task sheet: Enter in the minutes never submits the task form.
    await page.locator('#lx-day-later [data-task-id="h2"]').click();
    await page.locator('#lx-task-whatif-open').click();
    await expect(sheet(page).locator('.lx-sheet__title')).toHaveText(
      'Instalación de sonido Demo',
    );
    await page.locator('#lx-hypo-minutes').fill('20');
    await page.locator('#lx-hypo-minutes').press('Enter');
    await expect(page.locator('#lx-hypo-summary')).toContainText('20 min');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#lx-task-sheet')).toBeVisible();

    expect(writes(api)).toEqual([]);
    expect(JSON.stringify(api.tasks)).toBe(before);
  });

  test('30 min: what moves, what absorbs it, the unknown and the margin', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await delayH1(page, 30);
    await expect(page.locator('#lx-hypo-summary')).toHaveText(
      'Si «Montaje del escenario Demo» empieza 30 min más tarde, se mueve 1 tarea más. No tenía margen: lo que va después empieza en cuanto termina.',
    );
    const shifted = page.locator('#lx-hypo-shifted li.lx-hypo-moved');
    await expect(shifted).toHaveCount(2);
    await expect(
      movedTo(page, '#lx-hypo-shifted', 'Montaje del escenario Demo'),
    ).toHaveText('09:30–13:30');
    await expect(
      movedTo(page, '#lx-hypo-shifted', 'Instalación de sonido Demo'),
    ).toHaveText('13:30–15:30');
    await expect(
      shifted.filter({hasText: 'Instalación'}).locator('s'),
    ).toHaveText('13:00–15:00');

    const absorbed = page.locator('#lx-hypo-absorbed');
    await expect(absorbed.locator('li')).toHaveCount(2);
    await expect(
      absorbed.locator('li').filter({hasText: 'Pruebas de luces Demo'}),
    ).toContainText('le quedan 30 min de margen');
    await expect(
      absorbed.locator('li').filter({hasText: 'Entrega de vallas Demo'}),
    ).toContainText('0 min de margen');
    await expect(page.locator('#lx-hypo-unknown')).toContainText(
      'Limpieza Demo',
    );
    await expect(page.locator('#lx-hypo-margins')).toContainText(
      '«Navidad en la Plaza del Cristo»: quedan 1 h 30 min antes de que empiece (antes, 2 h).',
    );
    // Nothing reaches the event, but both moved assembly tasks still get the
    // routes A/B/C and Carpa Amarilla reminder. No new warnings.
    const routes = page.locator('#lx-hypo-routes');
    await expect(routes).toContainText(
      '«Montaje del escenario Demo» cambia de hora: revisa las rutas',
    );
    await expect(routes).toContainText(
      '«Instalación de sonido Demo» cambia de hora: revisa las rutas',
    );
    await expect(routes).toContainText('Carpa Amarilla');
    await expect(routes).not.toContainText('Entrega de vallas Demo');
    await expect(page.locator('#lx-hypo-new')).toHaveCount(0);
  });

  test('2 h: the delivery runs into the event — routes A/B/C and Carpa Amarilla', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await delayH1(page, 120);
    await expect(page.locator('#lx-hypo-shifted li.lx-hypo-moved')).toHaveCount(
      4,
    );
    await expect(
      movedTo(page, '#lx-hypo-shifted', 'Entrega de vallas Demo'),
    ).toHaveText('17:00–18:15');

    const routes = page.locator('#lx-hypo-routes');
    await expect(routes).toContainText('Rutas de emergencia y Carpa Amarilla');
    await expect(routes).toContainText(
      '«Entrega de vallas Demo» coincide con «Navidad en la Plaza del Cristo»',
    );
    await expect(routes).toContainText('A (acceso de vehículos)');
    await expect(routes).toContainText('B (sanitarios a pie)');
    await expect(routes).toContainText('C (evacuación en camilla)');
    await expect(routes).toContainText('Carpa Amarilla');
    // h9 does not move: its own reminder is not repeated here.
    await expect(routes).not.toContainText('Entrega de generador Demo');

    await expect(page.locator('#lx-hypo-margins .is-over')).toHaveText(
      'Entra 1 h 15 min en el horario de «Navidad en la Plaza del Cristo».',
    );
    // A clash that only exists under the hypothesis.
    await expect(page.locator('#lx-hypo-new')).toContainText(
      'Coinciden en Plaza del Cristo',
    );

    // The confirmation repeats the real reminders, title and full detail.
    await page.locator('#lx-hypo-apply').click();
    const confirmRoutes = page.locator('#lx-hypo-confirm-routes');
    await expect(confirmRoutes).toContainText(
      '«Entrega de vallas Demo» coincide con «Navidad en la Plaza del Cristo»',
    );
    await expect(confirmRoutes).toContainText('C (evacuación en camilla)');
    await expect(confirmRoutes).toContainText('Carpa Amarilla');
    await expect(page.locator('[id^="lx-hypo-confirm-over-"]')).toContainText(
      'Entra 1 h 15 min',
    );
  });

  test('a delay that takes a delivery past the event never «clears» its routes reminder', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page);
    await page.locator('#lx-today-whatif').click();
    await choose(page, 'lx-hypo-task', 'h9');
    await page.locator('#lx-hypo-minutes').fill('180');
    const relabelled =
      '«Entrega de generador Demo»: Ya no coincide con el evento; revísalo igualmente en el simulador.';
    const routes = page.locator('#lx-hypo-routes');
    await expect(routes).toContainText(relabelled);
    await expect(routes).toContainText('C (evacuación en camilla)');
    await expect(routes).toContainText('Carpa Amarilla');
    // A delay does not solve a route risk: it is not under «Dejarían de aparecer».
    await expect(page.locator('#lx-hypo-cleared')).toHaveCount(0);
    // The confirmation repeats it.
    await page.locator('#lx-hypo-apply').click();
    await expect(page.locator('#lx-hypo-confirm')).toBeVisible();
    const confirmRoutes = page.locator('#lx-hypo-confirm-routes');
    await expect(confirmRoutes).toContainText(relabelled);
    await expect(confirmRoutes).toContainText('Carpa Amarilla');
  });

  test('«Se alarga» on a task under way keeps its start', async ({page}) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect(page.locator('#lx-quick-delay-h6')).toHaveText('Se alarga…');
    await openDelay(page, 'h6');
    await expect(
      page.locator('input[name="lx-hypo-mode"][value="extend"]'),
    ).toBeChecked();
    await expect(page.locator('#lx-hypo-minutes')).toHaveValue('15');
    await expect(page.locator('#lx-hypo-summary')).toContainText(
      'Si «Recogida de material Demo» se alarga 15 min, se mueve 1 tarea más.',
    );
    await expect(
      movedTo(page, '#lx-hypo-shifted', 'Recogida de material Demo'),
    ).toHaveText('10:00–11:15');
    await expect(
      movedTo(page, '#lx-hypo-shifted', 'Reparto de mesas Demo'),
    ).toHaveText('11:15–12:15');

    await page.locator('#lx-hypo-apply').click();
    // Under way: there is no «Con retraso» to set.
    await expect(page.locator('#lx-hypo-mark-delayed')).toHaveCount(0);
    await page.locator('#lx-hypo-apply-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(api.calls('POST', '/hypotheses')[0].body).toMatchObject({
      taskId: 'h6',
      delayMinutes: 15,
      mode: 'extend',
    });
    const h6 = task(api, 'h6');
    expect(ms(h6.startsAt)).toBe(ms(today('10:00')));
    expect(ms(h6.endsAt)).toBe(ms(today('11:15')));
    expect(h6.status).toBe('in_progress');
    expect(ms(task(api, 'h7').startsAt)).toBe(ms(today('11:15')));
  });
});

test.describe('Gestor logístico · ¿Y si…? · guardar y aplicar', () => {
  test('saving stores it for the team and shows a chip in Hoy', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await openDelay(page, 'h1');
    await page.locator('#lx-hypo-quick-30').click();
    await page.locator('#lx-hypo-estimated').check();
    await page.locator('#lx-hypo-note').fill('Prueba: la grúa sale tarde');
    await page.locator('#lx-hypo-save').click();

    await expect(
      toast(
        page,
        'Hipótesis guardada: Retraso ≈ 30 min · Montaje del escenario Demo. El plan no cambia.',
      ),
    ).toBeVisible();
    expect(writes(api).map(r => `${r.method} ${r.path}`)).toEqual([
      'POST /hypotheses',
    ]);
    expect(api.calls('POST', '/hypotheses')[0].body).toEqual({
      organizationId: expect.any(String),
      taskId: 'h1',
      delayMinutes: 30,
      mode: 'shift',
      estimated: true,
      note: 'Prueba: la grúa sale tarde',
    });
    await expect(sheet(page)).toContainText('Hipótesis guardada');
    await expect(page.locator('#lx-hypo-saved')).toContainText(
      'Prueba: la grúa sale tarde',
    );
    await expect(page.locator('#lx-hypo-save')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const chip = page.locator('#lx-today-hypotheses [id^="lx-hypo-chip-"]');
    // Every chip says «Hipótesis» in words, not only with its dashed line.
    await expect(chip).toHaveText(
      'Hipótesis Retraso ≈ 30 min · Montaje del escenario Demo · Elvis, 10:30',
    );
    await expect(chip).toHaveAccessibleName(
      'Hipótesis Retraso ≈ 30 min · Montaje del escenario Demo · Elvis, 10:30',
    );
    await expect(page.locator('#lx-today-hypotheses')).toContainText(
      'no cambian el plan',
    );
    // The plan did not move.
    expect(ms(task(api, 'h1').startsAt)).toBe(ms(today('09:00')));
    expect(api.calls('PATCH', /^\/tasks\//)).toHaveLength(0);
    // It also shows in the task sheet.
    await page.locator('#lx-day-late [data-task-id="h1"]').click();
    await expect(page.locator('#lx-task-hypotheses')).toContainText(
      'Retraso ≈ 30 min',
    );
    await expect(
      page.locator('#lx-task-hypotheses .lx-hypotag').first(),
    ).toHaveText('Hipótesis');
  });

  test('«Aplicar al plan» confirms, moves the tasks and marks «Con retraso»; load, subsoil and resources stay', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await delayH1(page, 30);
    await page.locator('#lx-hypo-apply').click();

    const confirm = page.locator('#lx-hypo-confirm');
    await expect(confirm).toBeVisible();
    await expect(page.locator('#lx-hypo-confirm-title')).toBeFocused();
    await expect(confirm).toContainText('cambiará el horario de 2 tareas');
    await expect(
      page.locator('#lx-hypo-confirm-list li.lx-hypo-moved'),
    ).toHaveCount(2);
    await expect(
      movedTo(page, '#lx-hypo-confirm-list', 'Montaje del escenario Demo'),
    ).toHaveText('09:30–13:30');
    await expect(page.locator('#lx-hypo-mark-delayed')).toBeChecked();
    await expect(confirm).toContainText(
      'Marcar «Montaje del escenario Demo» como Con retraso',
    );
    await expect(page.locator('#lx-hypo-confirm-keep')).toHaveText(
      'La carga pesada, los recursos y la revisión del subsuelo no cambian.',
    );
    // Both moved assembly tasks carry the routes reminder into the confirmation.
    await expect(page.locator('#lx-hypo-confirm-routes')).toContainText(
      '«Montaje del escenario Demo» cambia de hora: revisa las rutas',
    );
    await expect(page.locator('#lx-hypo-apply-confirm')).toHaveText(
      'Aplicar: mover 2 tareas',
    );
    // Still nothing written: only the confirmation writes.
    expect(writes(api)).toEqual([]);
    // «Volver» goes back to exploring without writing.
    await page.locator('#lx-hypo-back').click();
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    expect(writes(api)).toEqual([]);

    await page.locator('#lx-hypo-apply').click();
    await page.locator('#lx-hypo-apply-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(
      toast(page, 'Plan actualizado: 2 tareas movidas.'),
    ).toBeVisible();

    expect(writes(api).map(r => r.path)).toEqual([
      '/hypotheses',
      expect.stringMatching(/^\/hypotheses\/[^/]+\/apply$/),
    ]);
    const body = writes(api)[1].body as {
      expected: Json[];
      markDelayed: boolean;
    };
    expect(body.markDelayed).toBe(true);
    expect(
      body.expected.map(e => [e.id, e.version, ms(e.startsAt), ms(e.endsAt)]),
    ).toEqual([
      ['h1', 1, ms(today('09:30')), ms(today('13:30'))],
      ['h2', 1, ms(today('13:30')), ms(today('15:30'))],
    ]);

    const h1 = task(api, 'h1');
    expect(h1.status).toBe('delayed');
    expect(ms(h1.startsAt)).toBe(ms(today('09:30')));
    expect(ms(h1.endsAt)).toBe(ms(today('13:30')));
    expect(h1.date).toBe('2026-12-02');
    expect(ms(task(api, 'h2').startsAt)).toBe(ms(today('13:30')));
    expect(task(api, 'h2').status).toBe('planned');
    // Absorbing tasks did not move.
    expect(ms(task(api, 'h4').startsAt)).toBe(ms(today('15:30')));
    // Only times (and the root's status): never the load, the declared
    // subsoil review, the resources or the dependencies.
    const original = followTasks().find(t => t.id === 'h1')!;
    expect(h1.heavyLoad).toBe(true);
    expect(h1.subsoilReview).toEqual(SUBSOIL_DECLARED);
    expect(h1.resourceIds).toEqual(['r1']);
    expect(h1.dependsOn).toEqual(original.dependsOn);
    expect(h1.notes).toBe(original.notes);
    expect(api.calls('PATCH', /^\/tasks\//)).toHaveLength(0);
    expect(api.hypotheses[0].appliedAt).toBeTruthy();

    // Hoy reflects it: still late (09:30 passed), «Con retraso», no chip
    // (applied hypotheses are a record, not an open one).
    const row = page.locator('#lx-day-late [data-task-id="h1"]');
    await expect(row.locator('.lx-taskrow__flag')).toHaveText('+1 h');
    await expect(row).toContainText('09:30');
    await expect(page.locator('#lx-today-hypotheses')).toHaveCount(0);
    await row.click();
    await expect(page.locator('#lx-task-subsoil-state')).toContainText(
      'Declarado por Dailos',
    );
  });

  test('a plan changed before the write: 409 notice, nothing moves, retry works', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await delayH1(page, 30);
    await page.locator('#lx-hypo-apply').click();
    await expect(page.locator('#lx-hypo-confirm')).toBeVisible();
    // Dailos saves h2 (another field) while the confirmation is open.
    api.editTaskOnServer('h2', {notes: 'Prueba: cables nuevos'}, dailos);
    await page.locator('#lx-hypo-apply-confirm').click();

    const notice = page.locator('#lx-hypo-notice');
    await expect(notice).toContainText(
      'El plan ha cambiado mientras lo mirabas: revisa la hipótesis y vuelve a confirmar. No se ha movido nada.',
    );
    await expect(notice).toContainText('Se ha guardado como hipótesis abierta');
    await expect(notice).toBeFocused();
    await expect(page.locator('#lx-hypo-confirm')).toHaveCount(0);
    expect(ms(task(api, 'h1').startsAt)).toBe(ms(today('09:00')));
    expect(task(api, 'h1').status).toBe('confirmed');
    expect(api.hypotheses[0].appliedAt).toBeNull();

    // The sheet now knows h2's new version: confirming again goes through.
    await page.locator('#lx-hypo-apply').click();
    await page.locator('#lx-hypo-apply-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    const last = api.calls('POST', /\/apply$/).at(-1)!.body as {
      expected: Json[];
    };
    expect(last.expected.find(e => e.id === 'h2')?.version).toBe(2);
    expect(ms(task(api, 'h1').startsAt)).toBe(ms(today('09:30')));
    expect(task(api, 'h2').notes).toBe('Prueba: cables nuevos');
  });

  test('a forced 409 at apply shows the notice and applies nothing', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    api.forceApplyConflict = 1;
    await signIn(page);
    await delayH1(page, 30);
    await page.locator('#lx-hypo-apply').click();
    await page.locator('#lx-hypo-apply-confirm').click();
    await expect(page.locator('#lx-hypo-notice')).toContainText(
      'No se ha movido nada',
    );
    expect(api.calls('POST', /\/apply$/)).toHaveLength(1);
    expect(ms(task(api, 'h1').startsAt)).toBe(ms(today('09:00')));
    expect(ms(task(api, 'h2').startsAt)).toBe(ms(today('13:00')));
    expect(task(api, 'h1').version).toBe(1);
    expect(api.hypotheses.every(h => !h.appliedAt)).toBe(true);
  });

  test('the moved list changing while confirming goes back to exploring', async ({
    page,
  }) => {
    const api = await mockApi(page, followData());
    await signIn(page);
    await delayH1(page, 30);
    await page.locator('#lx-hypo-apply').click();
    await expect(page.locator('#lx-hypo-confirm')).toBeVisible();
    // Dailos moves h2 half an hour later; a background refresh brings it in.
    api.editTaskOnServer(
      'h2',
      {startsAt: today('13:30'), endsAt: today('15:30')},
      dailos,
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(page.locator('#lx-hypo-confirm')).toHaveCount(0);
    await expect(page.locator('#lx-hypo-notice')).toContainText(
      'El plan ha cambiado mientras lo mirabas',
    );
    // Now only h1 moves (h2 already starts at 13:30): seen before confirming.
    await expect(page.locator('#lx-hypo-shifted li.lx-hypo-moved')).toHaveCount(
      1,
    );
    expect(writes(api)).toEqual([]);
  });
});

test.describe('Gestor logístico · ¿Y si…? · guardadas', () => {
  test('discarding an open hypothesis asks first and leaves the plan alone', async ({
    page,
  }) => {
    const api = await mockApi(
      page,
      followData({hypotheses: [openHypothesis()]}),
    );
    await signIn(page);
    const chip = page.locator('#lx-hypo-chip-hy1');
    await expect(chip).toHaveText(
      'Hipótesis Retraso ≈ 30 min · Montaje del escenario Demo · Dailos, 10:10',
    );
    // The chip is a label: never the note.
    await expect(chip).not.toContainText(ORDER_PRIVATE.hypothesisNote);
    await chip.click();
    await expect(sheet(page)).toContainText('Hipótesis guardada');
    await expect(page.locator('#lx-hypo-saved')).toContainText(
      ORDER_PRIVATE.hypothesisNote,
    );
    // Recomputed on the current plan, figures locked.
    await expect(page.locator('#lx-hypo-minutes')).toHaveCount(0);
    await expect(
      movedTo(page, '#lx-hypo-shifted', 'Montaje del escenario Demo'),
    ).toHaveText('09:30–13:30');

    await page.locator('#lx-hypo-discard').click();
    await expect(page.locator('#lx-hypo-discard-text')).toContainText(
      '¿Descartar esta hipótesis?',
    );
    await page.locator('#lx-hypo-discard-keep').click();
    expect(writes(api)).toEqual([]);
    await page.locator('#lx-hypo-discard').click();
    await page.locator('#lx-hypo-discard-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(toast(page, 'Hipótesis descartada')).toBeVisible();
    expect(writes(api).map(r => `${r.method} ${r.path}`)).toEqual([
      'DELETE /hypotheses/hy1',
    ]);
    expect(api.hypotheses).toEqual([]);
    await expect(page.locator('#lx-today-hypotheses')).toHaveCount(0);
    expect(ms(task(api, 'h1').startsAt)).toBe(ms(today('09:00')));
  });

  test('a stored «empieza más tarde» on a task that started says so', async ({
    page,
  }) => {
    const tasks = followTasks().map(t =>
      t.id === 'h1' ? {...t, status: 'in_progress'} : t,
    );
    await mockApi(page, followData({tasks, hypotheses: [openHypothesis()]}));
    await signIn(page);
    await page.locator('#lx-hypo-chip-hy1').click();
    await expect(page.locator('#lx-hypo-outdated')).toBeVisible();
    await page.locator('#lx-hypo-detach').click();
    await expect(
      page.locator('input[name="lx-hypo-mode"][value="extend"]'),
    ).toBeChecked();
  });

  test('an applied hypothesis is read-only', async ({page}) => {
    const api = await mockApi(
      page,
      followData({hypotheses: [openHypothesis()]}),
    );
    await signIn(page);
    await page.locator('#lx-hypo-chip-hy1').click();
    await expect(page.locator('#lx-hypo-discard')).toBeVisible();
    // Meanwhile Dailos applied it: discarding is refused and the sheet
    // switches to the record of the decision.
    Object.assign(api.hypotheses[0], {
      appliedAt: today('10:25'),
      appliedBy: dailos,
    });
    await page.locator('#lx-hypo-discard').click();
    await page.locator('#lx-hypo-discard-confirm').click();

    const applied = page.locator('#lx-hypo-applied');
    await expect(applied).toContainText('Aplicada por Dailos a las 10:25');
    await expect(sheet(page)).toContainText('Hipótesis aplicada');
    for (const id of [
      'lx-hypo-apply',
      'lx-hypo-save',
      'lx-hypo-discard',
      'lx-hypo-minutes',
      'lx-hypo-detach',
      'lx-hypo-note',
    ]) {
      await expect(page.locator(`#${id}`), id).toHaveCount(0);
    }
    await expect(page.locator('#lx-hypo-close')).toBeVisible();
    expect(api.hypotheses).toHaveLength(1);
  });

  test('the guest explores but cannot save or apply, and never sees the note', async ({
    page,
  }) => {
    const api = await mockApi(
      page,
      followData({hypotheses: [openHypothesis()]}),
    );
    await signIn(page, 'Invitado');
    await page.locator('#lx-today-whatif').click();
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    await page.locator('#lx-hypo-quick-30').click();
    await expect(page.locator('#lx-hypo-summary')).toContainText('30 min');
    for (const id of [
      'lx-hypo-save',
      'lx-hypo-apply',
      'lx-hypo-note',
      'lx-hypo-discard',
    ]) {
      await expect(page.locator(`#${id}`), id).toHaveCount(0);
    }
    await page.locator('#lx-hypo-close').click();

    await page.locator('#lx-hypo-chip-hy1').click();
    await expect(page.locator('#lx-hypo-saved')).toContainText(
      'Visible para el equipo',
    );
    await expect(page.locator('#lx-hypo-discard')).toHaveCount(0);
    await expect(page.locator('#lx-hypo-apply')).toHaveCount(0);
    expect(await page.content()).not.toContain(ORDER_PRIVATE.hypothesisNote);
    expect(writes(api).filter(r => r.path !== '/auth/logout')).toEqual([]);
  });
});
