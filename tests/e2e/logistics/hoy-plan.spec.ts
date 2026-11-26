import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './mock-api';
import {DAY, fixClock, planData, planEvents, planTasks} from './plan-fixtures';

/**
 * Gestor logístico, milestone 2: «Hoy» with today's tasks («Ahora»,
 * «Siguiente», «Sin hora», folded past), «Avisos de hoy» (conflicts before
 * reminders, each opening its task), each task's own warnings and the
 * «Información verificada» count. The clock is fixed at 10:30 on 2 Dec 2026.
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
  test('today’s tasks: now, next, the rest by hour, untimed and folded past', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    const card = page.locator('#lx-today-tasks');
    await expect(card).toBeVisible();
    await expect(card.locator('.lx-count')).toHaveText('5');

    // Running first, then by start time; other days never leak in.
    expect(
      await ids(
        page,
        '#lx-today-tasks .lx-tasklist >> nth=0 >> [data-task-id]',
      ),
    ).toEqual(['t1', 't2', 't3']);
    const t1 = card.locator('[data-task-id="t1"]');
    const t2 = card.locator('[data-task-id="t2"]');
    await expect(t1.locator('.lx-taskrow__flag')).toHaveText('Ahora');
    await expect(t1).toHaveAttribute(
      'aria-label',
      /^Ahora: Montaje del escenario, montaje, 08:00 – 13:00, Plaza del Cristo/,
    );
    await expect(t2.locator('.lx-taskrow__flag')).toHaveText('Siguiente');
    await expect(t2).toHaveAttribute('aria-label', /^Siguiente: Instalación/);
    await expect(
      card.locator('[data-task-id="t3"] .lx-taskrow__flag'),
    ).toHaveCount(0);

    await expect(card.locator('.lx-tasklist__label')).toHaveText('Sin hora');
    expect(
      await ids(
        page,
        '#lx-today-tasks .lx-tasklist__label + .lx-tasklist [data-task-id]',
      ),
    ).toEqual(['t4']);

    const past = card.locator('details.lx-todaytasks__past');
    await expect(past.locator('summary')).toContainText(
      'Ya terminadas o pasadas (1)',
    );
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

  test('«Información verificada» counts events and tasks', async ({page}) => {
    await mockApi(page, planData());
    await signIn(page);
    const card = page.locator('#lx-verified');
    // 2 events + 8 tasks; validated: e1 and t1.
    await expect(card.getByRole('img')).toHaveAttribute(
      'aria-label',
      '20 % de los eventos y tareas validados',
    );
    await expect(card.locator('.lx-verified__legend dd')).toHaveText([
      '2',
      '8',
    ]);
    await expect(
      card.getByRole('button', {name: /^Completar la tarea /}).first(),
    ).toBeVisible();

    // Only events: the tasks are what moved the figure.
    await page.unrouteAll({behavior: 'ignoreErrors'});
    await mockApi(page, {...planData(), events: planEvents(), tasks: []});
    await page.reload();
    await expect(card.getByRole('img')).toHaveAttribute(
      'aria-label',
      '50 % de los eventos y tareas validados',
    );
  });
});
