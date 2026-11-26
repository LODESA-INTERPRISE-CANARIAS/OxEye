import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './mock-api';
import {DAY, fixClock, planData, planEvents, planTasks} from './plan-fixtures';

/**
 * Gestor logístico, milestone 2: «Hoy» with today's tasks (since M5 «La
 * jornada»: «Va tarde», «Lo siguiente», «Más tarde», «Sin hora», folded
 * «Terminadas»), «Avisos de hoy» (conflicts before reminders, each opening
 * its task), each task's own warnings and the «Información verificada»
 * count. The clock is fixed at 10:30 on 2 Dec 2026. Quick actions and the
 * «¿Y si…?» sheet are in followup.spec.ts and hypothesis.spec.ts.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const ids = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll(els => els.map(el => el.getAttribute('data-task-id')));

const warningKinds = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-warning]`)
    .evaluateAll(els => els.map(el => el.getAttribute('data-warning')));

async function closeCleanSheet(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
}

test.describe('Gestor logístico · «Hoy» con tareas', () => {
  test('la jornada: late, next, later, untimed and folded finished', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    const card = page.locator('#lx-today-tasks');
    await expect(card).toBeVisible();
    // M5: the card «Tareas de hoy» is now «La jornada».
    await expect(card.locator('.lx-card__title')).toContainText('La jornada');
    await expect(card.locator('.lx-count').first()).toHaveText('5');
    await expect(card.locator('.lx-count--danger')).toHaveText('1 tarde');

    // M5: at 10:30, t1 (confirmed 08:00–13:00) has not been marked started:
    // nobody confirmed it is happening, so it is late, not «Ahora».
    const late = card.locator('#lx-day-late');
    expect(await ids(page, '#lx-day-late li.lx-dayrow [data-task-id]')).toEqual(
      ['t1'],
    );
    const t1 = late.locator('[data-task-id="t1"]');
    await expect(t1.locator('.lx-taskrow__flag')).toHaveText('+2 h 30 min');
    await expect(t1).toHaveAttribute(
      'aria-label',
      /^Va tarde, \+2 h 30 min: Montaje del escenario, montaje, 08:00 – 13:00, Plaza del Cristo/,
    );
    await expect(card.locator('#lx-day-now')).toHaveCount(0);

    // The earliest start still to come is next; the rest by hour.
    expect(await ids(page, '#lx-day-next li.lx-dayrow [data-task-id]')).toEqual(
      ['t2'],
    );
    const t2 = card.locator('#lx-day-next [data-task-id="t2"]');
    await expect(t2.locator('.lx-taskrow__flag')).toHaveText('Siguiente');
    await expect(t2).toHaveAttribute('aria-label', /^Siguiente: Instalación/);
    await expect(card.locator('#lx-day-next-title')).toContainText(
      'en 1 h 30 min',
    );
    expect(
      await ids(page, '#lx-day-later li.lx-dayrow [data-task-id]'),
    ).toEqual(['t3']);
    await expect(
      card.locator('[data-task-id="t3"] .lx-taskrow__flag'),
    ).toHaveCount(0);

    await expect(card.locator('#lx-day-untimed-title')).toContainText(
      'Sin hora',
    );
    expect(
      await ids(page, '#lx-day-untimed li.lx-dayrow [data-task-id]'),
    ).toEqual(['t4']);

    // Only done and cancelled tasks are folded away.
    const past = card.locator('details#lx-day-done');
    await expect(past.locator('summary')).toHaveText('Terminadas (1)');
    await expect(past.locator('[data-task-id="t5"]')).toBeHidden();
    await past.locator('summary').click();
    await expect(past.locator('[data-task-id="t5"]')).toBeVisible();

    for (const other of ['t8', 't10', 't11']) {
      await expect(card.locator(`[data-task-id="${other}"]`)).toHaveCount(0);
    }

    // «Ver el día» opens today in the calendar.
    await page.locator('#lx-today-open-day').click();
    await expect(page).toHaveURL(new RegExp(`#logistica/calendario/${DAY}$`));
  });

  test('«Avisos de hoy»: conflicts first, each link opens its task', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    const card = page.locator('#lx-warnings');
    await expect(card).toBeVisible();
    await expect(card.locator('.lx-count')).toHaveText('5');
    await expect(card.locator('.lx-count')).toHaveClass(/lx-count--danger/);

    expect(await warningKinds(page, '#lx-warnings')).toEqual([
      'venue_overlap',
      'dependency_order',
      'heavy_load',
      'heavy_load_unknown',
      'route_window',
    ]);
    const severities = await card
      .locator('li.lx-warning')
      .evaluateAll(els =>
        els.map(el =>
          el.classList.contains('lx-warning--conflict') ? 'c' : 'r',
        ),
      );
    expect(severities.join('')).toMatch(/^c+r+$/);

    const warning = (kind: string) =>
      card.locator(`[data-warning="${kind}"] button`);
    await expect(warning('venue_overlap')).toHaveAttribute(
      'aria-label',
      /^Conflicto: Coinciden en Plaza del Cristo\..*Abrir «Montaje del escenario»\.$/,
    );
    await expect(warning('dependency_order')).toContainText(
      '«Instalación de sonido» empieza antes de tiempo',
    );

    // The subsoil reminder quotes 500 kg/m² as indicative, never certified.
    const subsoil = card.locator('[data-warning="heavy_load"]');
    await expect(subsoil).toContainText('500 kg/m²');
    await expect(subsoil).toContainText('orientativo');
    await expect(subsoil).toContainText('no un límite certificado');
    // The delivery during the event points to routes A/B/C and the Carpa Amarilla.
    const routes = card.locator('[data-warning="route_window"]');
    await expect(routes).toContainText('«Entrega de vallas» coincide con');
    await expect(routes).toContainText('A (acceso de vehículos)');
    await expect(routes).toContainText('C (evacuación en camilla)');
    await expect(routes).toContainText('Carpa Amarilla');

    const opens: [string, string][] = [
      ['venue_overlap', 'Montaje del escenario'],
      ['heavy_load', 'Montaje del escenario'],
      ['heavy_load_unknown', 'Entrega de vallas'],
      ['route_window', 'Entrega de vallas'],
    ];
    for (const [kind, title] of opens) {
      await warning(kind).click();
      await expect(page.locator('#lx-task-title'), kind).toHaveValue(title);
      await closeCleanSheet(page);
    }
    // The link names the task it opens.
    const dep = warning('dependency_order');
    const label = await dep.getAttribute('aria-label');
    const named = /Abrir «(.+)»\.$/.exec(label ?? '')?.[1];
    expect(named).toBeTruthy();
    await dep.click();
    await expect(page.locator('#lx-task-title')).toHaveValue(named!);
  });

  test('each task sheet shows its own warnings and previews edits', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);

    await page.locator('#lx-today-tasks [data-task-id="t2"]').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    expect(await warningKinds(page, '#lx-task-warnings')).toEqual([
      'venue_overlap',
      'dependency_order',
    ]);
    await expect(page.locator('#lx-task-sheet')).toContainText('2 conflictos');
    await expect(
      page.locator('#lx-task-warnings [data-warning="dependency_order"]'),
    ).toContainText(
      'Depende de «Montaje del escenario», que termina 1 h después.',
    );
    await closeCleanSheet(page);

    await page.locator('#lx-today-tasks [data-task-id="t3"]').click();
    expect(await warningKinds(page, '#lx-task-warnings')).toEqual([
      'heavy_load_unknown',
      'route_window',
    ]);
    const own = page.locator('#lx-task-warnings');
    await expect(own.locator('[data-warning="route_window"]')).toContainText(
      'Carpa Amarilla',
    );
    // Answering the question updates the preview before saving.
    await page.locator('#lx-task-heavy-no').click();
    await expect(
      own.locator('[data-warning="heavy_load_unknown"]'),
    ).toHaveCount(0);
    await page.locator('#lx-task-heavy-yes').click();
    const subsoil = own.locator('[data-warning="heavy_load"]');
    await expect(subsoil).toContainText('orientativo');
    await expect(subsoil).toContainText('no un límite certificado');
  });

  test('without warnings today the card says so', async ({page}) => {
    await mockApi(page, {
      ...planData(),
      tasks: planTasks().filter(t => t.id === 't4' || t.id === 't5'),
    });
    await signIn(page);
    await expect(page.locator('#lx-today-tasks')).toBeVisible();
    await expect(page.locator('#lx-warnings-empty')).toContainText(
      'Sin avisos para hoy',
    );
  });

  test('without tasks today there is no warnings card', async ({page}) => {
    await mockApi(page, {...planData(), tasks: []});
    await signIn(page);
    await expect(page.locator('[data-event-id="e1"]')).toBeVisible();
    await expect(page.locator('#lx-today-tasks')).toHaveCount(0);
    await expect(page.locator('#lx-warnings')).toHaveCount(0);
  });

  test('«Información verificada» counts events, tasks and companies', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    const card = page.locator('#lx-verified');
    // 2 events + 8 tasks + 3 companies (milestone 3: the directory counts
    // too); validated: e1 and t1 → 2 of 13 = 15 %.
    await expect(card.getByRole('img')).toHaveAttribute(
      'aria-label',
      '15 % de los registros validados',
    );
    await expect(card.locator('.lx-verified__legend dd')).toHaveText([
      '2',
      '11',
    ]);
    // Events and tasks come first in «Qué falta»: the day depends on them.
    await expect(card.locator('.lx-missing__row').first()).toHaveAttribute(
      'aria-label',
      /^Completar (el evento|la tarea) /,
    );
    await expect(
      card.getByRole('button', {name: /^Completar la tarea /}).first(),
    ).toBeVisible();

    // Only events (and the companies): the tasks are what moved the figure.
    // 1 of 5 validated = 20 %.
    await page.unrouteAll({behavior: 'ignoreErrors'});
    await mockApi(page, {...planData(), events: planEvents(), tasks: []});
    await page.reload();
    await expect(card.getByRole('img')).toHaveAttribute(
      'aria-label',
      '20 % de los registros validados',
    );

    // Only events, no directory: the wording goes back to events and tasks.
    await page.unrouteAll({behavior: 'ignoreErrors'});
    await mockApi(page, {
      ...planData(),
      events: planEvents(),
      tasks: [],
      companies: [],
    });
    await page.reload();
    await expect(card.getByRole('img')).toHaveAttribute(
      'aria-label',
      '50 % de los eventos y tareas validados',
    );
  });
});
