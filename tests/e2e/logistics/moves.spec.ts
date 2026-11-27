import {expect, test, type Page} from '@playwright/test';
import {windowsFor} from '../../../shared/logistics/acceptance.ts';
import {planWarnings} from '../../../shared/logistics/conflicts.ts';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {
  elvis,
  mockApi,
  ORG,
  signIn,
  type MockApi,
  type MockOptions,
} from './mock-api';
import {DAY, fixClock, planData, PLAZA_CRISTO} from './plan-fixtures';

/**
 * Revisión 1 · E2 «Tareas y conflictos», moves: a block moved on the
 * calendar (keyboard and mouse hold), the move preview, «Deshacer», the
 * refusal outside opening hours, the conflict exits («¿Retrasar…?»,
 * «¿Adelantar…?», «Mantener ambas»), accepted conflicts that reopen by
 * themselves and a guest who sees the warnings without exits. Also the
 * venue's acronym and opening hours.
 *
 * Plan (plan-fixtures.ts): at Plaza del Cristo t1 «Montaje del escenario»
 * 08:00–13:00 and t2 «Instalación de sonido» 12:00–15:00, which waits for t1
 * (a venue overlap and a dependency conflict); t3 «Entrega de vallas»
 * 17:30–18:30 waits for t2; t5 is done.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const block = (page: Page, id: string) =>
  page.locator(`#lx-timeline .lx-tl__block[data-task-id="${id}"]`);
const sheet = (page: Page) => page.locator('#lx-move-sheet');
const toast = (page: Page, text: string | RegExp) =>
  page.locator('.lx-toast').filter({hasText: text});
const moves = (api: MockApi, id: string) =>
  api.calls('POST', `/tasks/${id}/move`);

async function openDay(
  page: Page,
  data: MockOptions = planData(),
  who = 'Elvis',
) {
  await page.setViewportSize({width: 1280, height: 900});
  const api = await mockApi(page, data);
  await signIn(page, who, `#logistica/calendario/${DAY}`);
  await expect(page.locator('#lx-timeline')).toBeVisible();
  return api;
}

async function scrollTo(page: Page, hour: number) {
  await page.evaluate(h => {
    const el = document.querySelector<HTMLElement>('.lx-tl__scroller');
    if (!el) return;
    const px = parseFloat(
      getComputedStyle(el).getPropertyValue('--lx-hour') || '64',
    );
    el.scrollTop = h * px;
  }, hour);
}

async function openDayWarnings(page: Page) {
  const box = page.locator('#lx-day-warnings');
  if (!(await box.evaluate(d => (d as HTMLDetailsElement).open))) {
    await box.locator('summary').click();
  }
  return box;
}

const withHours = (opensAt: string, closesAt: string) => {
  const data = planData();
  return {
    ...data,
    venues: data.venues.map(v =>
      v.id === PLAZA_CRISTO.id
        ? {...v, openingHours: {opensAt, closesAt}, version: 3}
        : v,
    ),
  };
};

test.describe('Gestor logístico · mover tareas en el calendario', () => {
  test('keyboard: Alt + arrows, the preview, confirm and «Deshacer»', async ({
    page,
  }) => {
    const api = await openDay(page);
    await scrollTo(page, 11);
    const t2 = block(page, 't2');
    await t2.focus();
    await page.keyboard.press('Shift+Alt+ArrowDown');
    await page.keyboard.press('Shift+Alt+ArrowDown');
    await expect(t2).toHaveClass(/is-lifted/);
    await expect(page.locator('.lx-tl__dragtime')).toContainText('13:00–16:00');
    await expect(page.locator('.lx-tl__origin')).toHaveCount(1);
    await expect(page.locator('#lx-tl-live')).toContainText(
      'Intro para revisar el cambio',
    );
    await page.keyboard.press('Enter');

    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#lx-move-summary')).toContainText(
      '1 h más tarde',
    );
    await expect(page.locator('#lx-move-summary')).toContainText('13:00–16:00');
    // The delivery that waits has slack: nothing else moves.
    await expect(page.locator('#lx-move-alone')).toContainText(
      'margen suficiente',
    );
    // Both conflicts with t1 go away.
    await expect(page.locator('#lx-move-cleared .lx-warning')).toHaveCount(2);
    await expect(page.locator('#lx-move-keep')).toContainText('no certifica');
    await page.locator('#lx-move-confirm').click();

    await expect(sheet(page)).toHaveCount(0);
    expect(moves(api, 't2')).toHaveLength(1);
    expect(moves(api, 't2')[0].body).toMatchObject({
      minutes: 60,
      origin: 'calendar',
      expected: [{id: 't2', version: 1}],
    });
    await expect(t2).toHaveAttribute('aria-label', /13:00 – 16:00/);
    await expect(t2).not.toHaveClass(/is-lifted|is-pending/);

    await toast(page, 'Hora cambiada')
      .getByRole('button', {name: 'Deshacer'})
      .click();
    await expect(toast(page, 'Cambio deshecho')).toBeVisible();
    expect(moves(api, 't2')[1].body).toMatchObject({
      minutes: -60,
      origin: 'undo',
      expected: [
        {
          id: 't2',
          version: 2,
          startsAt: '2026-12-02T12:00:00.000Z',
          endsAt: '2026-12-02T15:00:00.000Z',
        },
      ],
    });
    await expect(t2).toHaveAttribute('aria-label', /12:00 – 15:00/);
  });

  test('Escape cancels a keyboard move and nothing is sent', async ({page}) => {
    const api = await openDay(page);
    await scrollTo(page, 11);
    const t2 = block(page, 't2');
    await t2.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('.lx-tl__dragtime')).toContainText('11:55–14:55');
    await page.keyboard.press('Escape');
    await expect(t2).not.toHaveClass(/is-lifted/);
    await expect(sheet(page)).toHaveCount(0);
    expect(moves(api, 't2')).toHaveLength(0);
  });

  test('mouse: hold to lift, drag half an hour, cancel the preview', async ({
    page,
  }) => {
    const api = await openDay(page);
    await scrollTo(page, 16);
    const t3 = block(page, 't3');
    const box = (await t3.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await expect(t3).toHaveClass(/is-lifted/);
    // 64 px an hour: 32 px is half an hour.
    await page.mouse.move(x, y + 16, {steps: 3});
    await page.mouse.move(x, y + 32, {steps: 3});
    await expect(page.locator('.lx-tl__dragtime')).toContainText('18:00–19:00');
    await page.mouse.up();

    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#lx-move-summary')).toContainText(
      '30 min más tarde',
    );
    // A delivery during its event: the routes reminder is always listed.
    await expect(page.locator('#lx-move-routes')).toBeVisible();
    await expect(page.locator('#lx-move-routes')).toContainText(
      'Rutas de emergencia y Carpa Amarilla',
    );
    await page.locator('#lx-move-cancel').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(moves(api, 't3')).toHaveLength(0);
    await expect(t3).not.toHaveClass(/is-lifted|is-pending/);
    await expect(t3).toHaveAttribute('aria-label', /17:30 – 18:30/);
  });

  test('a quick click still opens the task; a done task explains why it cannot move', async ({
    page,
  }) => {
    await openDay(page);
    await scrollTo(page, 6.5);
    const t5 = block(page, 't5');
    await t5.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(toast(page, 'ya está hecha')).toBeVisible();
    await expect(t5).not.toHaveClass(/is-lifted/);
    await t5.click();
    await expect(page.locator('#lx-task-sheet')).toBeVisible();
  });

  test('outside the venue’s opening hours the time is refused', async ({
    page,
  }) => {
    const api = await openDay(page, withHours('08:00', '20:00'));
    await scrollTo(page, 16);
    const t3 = block(page, 't3');
    await t3.focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Alt+ArrowDown');
    }
    await expect(page.locator('.lx-tl__dragtime')).toHaveClass(/is-refused/);
    await expect(page.locator('.lx-tl__dragtime')).toContainText(
      'Fuera de horario · 08:00–20:00',
    );
    await expect(page.locator('.lx-tl__closed--after')).toContainText(
      'Cerrado · desde 20:00',
    );
    await page.keyboard.press('Enter');
    await expect(toast(page, 'abre de 08:00 a 20:00')).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    expect(moves(api, 't3')).toHaveLength(0);
    // Back inside the hours, it goes through.
    await page.keyboard.press('Shift+Alt+ArrowUp');
    await page.keyboard.press('Shift+Alt+ArrowUp');
    await expect(page.locator('.lx-tl__dragtime')).not.toHaveClass(
      /is-refused/,
    );
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#lx-move-summary')).toContainText(
      'Horario de «Plaza del Cristo»: 08:00–20:00',
    );
  });

  test('a plan changed meanwhile: nothing moves, recompute and confirm', async ({
    page,
  }) => {
    const api = await openDay(page);
    await scrollTo(page, 11);
    await block(page, 't2').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Enter');
    api.forceMoveConflict = 1;
    await page.locator('#lx-move-confirm').click();
    await expect(page.locator('#lx-move-notice')).toContainText(
      'El plan ha cambiado',
    );
    await page.locator('#lx-move-recompute').click();
    await expect(page.locator('#lx-move-notice')).toHaveCount(0);
    await page.locator('#lx-move-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(toast(page, 'Hora cambiada')).toBeVisible();
    expect(moves(api, 't2')).toHaveLength(2);
  });

  test('dependencies: a focused block shows what it waits for', async ({
    page,
  }) => {
    await openDay(page);
    await scrollTo(page, 7);
    await block(page, 't2').focus();
    await scrollTo(page, 7);
    await expect(block(page, 't1')).toHaveClass(/is-pred/);
    await expect(block(page, 't3')).toHaveClass(/is-succ/);
    // Both on screen: a thin line joins them.
    await expect(page.locator('.lx-tl__links path')).toHaveCount(1);
    await expect(block(page, 't2').locator('.lx-tl__block-link')).toHaveCount(
      1,
    );
    await expect(block(page, 't2')).toHaveAttribute(
      'aria-label',
      /Espera a: Montaje del escenario \(08:00\)\. La espera: Entrega de vallas \(17:30\)/,
    );
    // The delivery at 17:30 is off screen: it shows as a chip.
    await expect(page.locator('#lx-tl-deps')).toContainText(
      'La espera:Entrega de vallas · 17:30',
    );
  });
});

test.describe('Gestor logístico · salidas de un conflicto', () => {
  test('«¿Retrasar…?» opens the preview and moves the second task', async ({
    page,
  }) => {
    const api = await openDay(page);
    const box = await openDayWarnings(page);
    const overlap = box.locator('.lx-warning[data-warning="venue_overlap"]');
    await expect(overlap.locator('[data-exit]')).toHaveCount(3);
    await overlap.locator('[data-exit="delay"]').click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText('Resolver un conflicto · retrasar');
    await expect(page.locator('#lx-move-summary')).toContainText('13:00–16:00');
    await page.locator('#lx-move-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(moves(api, 't2')[0].body).toMatchObject({
      minutes: 60,
      origin: 'conflict_delay',
    });
    expect(
      (moves(api, 't2')[0].body as {warningKey: string}).warningKey,
    ).toMatch(/^venue:/);
  });

  test('«¿Adelantar…?» moves the first task earlier', async ({page}) => {
    const api = await openDay(page);
    const box = await openDayWarnings(page);
    await box
      .locator(
        '.lx-warning[data-warning="venue_overlap"] [data-exit="advance"]',
      )
      .click();
    await expect(page.locator('#lx-move-summary')).toContainText('1 h antes');
    await expect(page.locator('#lx-move-summary')).toContainText('07:00–12:00');
    await page.locator('#lx-move-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(moves(api, 't1')[0].body).toMatchObject({
      minutes: -60,
      origin: 'conflict_advance',
    });
  });

  test('«Mantener ambas»: a reason, listed apart, reopens when a task moves', async ({
    page,
  }) => {
    const api = await openDay(page);
    let box = await openDayWarnings(page);
    await box
      .locator('.lx-warning[data-warning="venue_overlap"] [data-exit="keep"]')
      .click();
    const keep = page.locator('#lx-keep-sheet');
    await expect(keep).toBeVisible();
    await page.locator('#lx-keep-confirm').click();
    await expect(page.locator('#lx-keep-reason-error')).toContainText(
      'al menos 3',
    );
    await page
      .locator('#lx-keep-reason')
      .fill('El sonido entra por la calle lateral.');
    await page.locator('#lx-keep-confirm').click();
    await expect(keep).toHaveCount(0);
    expect(api.calls('POST', '/conflict-acceptances')).toHaveLength(1);

    box = await openDayWarnings(page);
    await expect(
      box.locator(
        '.lx-warning[data-warning="venue_overlap"]:not(.lx-warning--accepted)',
      ),
    ).toHaveCount(0);
    const accepted = box.locator('.lx-warning--accepted');
    await expect(accepted).toHaveCount(1);
    await expect(accepted).toContainText('Aceptado');
    await expect(accepted).toContainText(
      '«El sonido entra por la calle lateral.»',
    );
    await expect(accepted).toContainText('Elvis');
    await expect(box.locator('summary')).toContainText('1 aceptado');

    // Moving one of the tasks reopens it by itself.
    await scrollTo(page, 11);
    await block(page, 't2').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('#lx-move-confirm').click();
    await expect(sheet(page)).toHaveCount(0);
    box = await openDayWarnings(page);
    await expect(box.locator('.lx-warning--accepted')).toHaveCount(0);
    await expect(
      box.locator('.lx-warning[data-warning="venue_overlap"]'),
    ).toHaveCount(1);
  });

  test('«Retirar» an acceptance opens the conflict again', async ({page}) => {
    const api = await openDay(page);
    let box = await openDayWarnings(page);
    await box
      .locator('.lx-warning[data-warning="venue_overlap"] [data-exit="keep"]')
      .click();
    await page.locator('#lx-keep-reason').fill('Revisado con producción.');
    await page.locator('#lx-keep-confirm').click();
    box = await openDayWarnings(page);
    await box.getByRole('button', {name: /Retirar la aceptación/}).click();
    await expect(toast(page, 'Aceptación retirada')).toBeVisible();
    expect(api.calls('DELETE', /^\/conflict-acceptances\//)).toHaveLength(1);
    await expect(box.locator('.lx-warning--accepted')).toHaveCount(0);
    await expect(
      box.locator('.lx-warning[data-warning="venue_overlap"]'),
    ).toHaveCount(1);
  });

  test('a guest sees warnings and accepted conflicts but no exits or moves', async ({
    page,
  }) => {
    // One conflict accepted by a member beforehand (its reason is withheld).
    const data = planData();
    const tasks = data.tasks as unknown as Task[];
    const warning = planWarnings(
      tasks,
      data.events as unknown as LogisticsEvent[],
    ).find(w => w.kind === 'dependency_order')!;
    await openDay(
      page,
      {
        ...data,
        acceptances: [
          {
            id: 'ca1',
            organizationId: ORG,
            warningKey: warning.key,
            windows: windowsFor(warning, tasks),
            reason: 'Se coordina en obra.',
            acceptedBy: elvis,
            acceptedAt: '2026-12-02T09:00:00.000Z',
          },
        ],
      },
      'Invitado',
    );
    const box = await openDayWarnings(page);
    await expect(box.locator('.lx-warning').first()).toBeVisible();
    await expect(box.locator('[data-exit]')).toHaveCount(0);
    const accepted = box.locator('.lx-warning--accepted');
    await expect(accepted).toHaveCount(1);
    await expect(accepted).toContainText('Motivo visible para el equipo');
    await expect(accepted).not.toContainText('Se coordina en obra');
    await expect(
      box.getByRole('button', {name: /Retirar la aceptación/}),
    ).toHaveCount(0);

    await scrollTo(page, 11);
    await block(page, 't2').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(block(page, 't2')).not.toHaveClass(/is-lifted/);
    await expect(page.locator('.lx-tl__dragtime')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · siglas y horario de un lugar', () => {
  test('a member sets the acronym and the opening hours', async ({page}) => {
    const api = await openDay(page);
    await page.locator('#lx-search').click();
    await page.locator('#lx-search-input').fill('cristo');
    await page
      .locator('#lx-search-results [data-hit-type="venue"]')
      .first()
      .click();
    const venue = page.locator('#lx-venue-sheet');
    await expect(venue).toBeVisible();
    await expect(page.locator('#lx-venue-acronym')).toContainText('P.C.');
    await expect(page.locator('#lx-venue-acronym')).toContainText('propuesta');
    await expect(page.locator('#lx-venue-hours')).toContainText(
      'Pendiente de verificar',
    );

    await page.locator('#lx-venue-edit').click();
    // The proposal is only a placeholder: saving the hours alone never
    // stores it as the venue's own acronym.
    await expect(page.locator('#lx-venue-acronym-input')).toHaveValue('');
    await expect(page.locator('#lx-venue-acronym-input')).toHaveAttribute(
      'placeholder',
      'P.C.',
    );
    await page.locator('#lx-venue-acronym-input').fill('PL CR');
    await page.locator('#lx-venue-opens').fill('08:00');
    await page.locator('#lx-venue-save').click();
    await expect(page.locator('#lx-venue-acronym-input-error')).toBeVisible();
    await expect(page.locator('#lx-venue-hours-error')).toContainText(
      'apertura y la de cierre',
    );
    await page.locator('#lx-venue-acronym-input').fill('PCR');
    await page.locator('#lx-venue-closes').fill('20:00');
    await page.locator('#lx-venue-save').click();
    await expect(page.locator('#lx-venue-hours')).toContainText('08:00–20:00');
    await expect(page.locator('#lx-venue-acronym')).toContainText('PCR');
    const patch = api.calls('PATCH', '/venues/v1');
    expect(patch).toHaveLength(1);
    expect(patch[0].body).toMatchObject({
      version: 1,
      acronym: 'PCR',
      openingHours: {opensAt: '08:00', closesAt: '20:00'},
    });
  });

  test('someone else changed the venue: their values are shown', async ({
    page,
  }) => {
    const api = await openDay(page);
    await page.locator('#lx-search').click();
    await page.locator('#lx-search-input').fill('cristo');
    await page
      .locator('#lx-search-results [data-hit-type="venue"]')
      .first()
      .click();
    await page.locator('#lx-venue-edit').click();
    const v = api.venues.find(x => x.id === 'v1')!;
    Object.assign(v, {
      version: 2,
      acronym: 'PDC',
      openingHours: {opensAt: '07:00', closesAt: '22:00'},
    });
    await page.locator('#lx-venue-acronym-input').fill('PLC');
    await page.locator('#lx-venue-save').click();
    await expect(page.locator('#lx-venue-notice')).toContainText(
      'Otra persona ha cambiado este lugar',
    );
    await expect(page.locator('#lx-venue-acronym-input')).toHaveValue('PDC');
    await expect(page.locator('#lx-venue-opens')).toHaveValue('07:00');
  });
});
