import {expect, test, type Page} from '@playwright/test';
import {
  ORG,
  addDays,
  makeActivity,
  makeEvent,
  makeTask,
  mockApi,
  signIn,
} from './mock-api';
import {lxUrl} from './address';
import {CAT, directoryData} from './directory-fixtures';
import {IGIC} from './money-fixtures';
import {
  DAY,
  ESCENARIOS,
  PLAZA_ADELANTADO,
  SONIDO,
  VALLAS,
  fixClock,
  planData,
} from './plan-fixtures';

/**
 * Revisión 1 · E1 «Pulido» (front end): «Próximos eventos» across the whole
 * width with cards that say what each event needs; «Actividad reciente» with
 * a fixed height and «Ver anteriores»; the form group title that names the
 * record; «Gestionar» categories in place; «Comparar» next to a category and
 * medals for the three cheapest. The last tests also write screenshots to
 * test-results/visual/logistics-r1-<screen>-<palette>.png for review.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const DESKTOP = {width: 1440, height: 1000};
const WIDE = {width: 1920, height: 1080};
const PHONE = {width: 390, height: 844};

/**
 * planData plus e8 in three days with three tasks (two clash at the same
 * venue, one is done) and seven more upcoming events without tasks, so there
 * are nine upcoming events in all.
 */
function hoyData() {
  const base = planData();
  const day3 = addDays(DAY, 3);
  const events = [
    ...base.events,
    makeEvent(
      'e8',
      'Cabalgata Demo',
      {date: day3, start: '17:00', end: '21:00'},
      {venue: {...PLAZA_ADELANTADO}, status: 'confirmed'},
    ),
    ...[6, 8, 9, 10, 12, 13, 14].map((d, i) =>
      makeEvent(
        `ex${i}`,
        `Evento Prueba ${i + 1}`,
        {date: addDays(DAY, d), start: '10:00', end: '12:00'},
        {venue: {...PLAZA_ADELANTADO}},
      ),
    ),
  ];
  const tasks = [
    ...base.tasks,
    makeTask(
      't20',
      'Montaje de gradas',
      {date: day3, start: '08:00', end: '12:00'},
      {
        eventId: 'e8',
        kind: 'assembly',
        venue: {...PLAZA_ADELANTADO},
        company: {...ESCENARIOS},
        heavyLoad: false,
      },
    ),
    makeTask(
      't21',
      'Montaje de vallas de la cabalgata',
      {date: day3, start: '10:00', end: '11:00'},
      {
        eventId: 'e8',
        kind: 'assembly',
        venue: {...PLAZA_ADELANTADO},
        company: {...VALLAS},
        heavyLoad: false,
      },
    ),
    makeTask(
      't22',
      'Prueba de sonido de la cabalgata',
      {date: day3, start: '15:00', end: '16:00'},
      {
        eventId: 'e8',
        kind: 'other',
        venue: {...PLAZA_ADELANTADO},
        company: {...SONIDO},
        status: 'done',
      },
    ),
  ];
  return {...base, events, tasks};
}

const card = (page: Page, id: string) =>
  page.locator(`#lx-upcoming [data-event-id="${id}"]`);

/** Number of columns of a CSS grid, from its computed tracks. */
const columns = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);

test.describe('Gestor logístico · Hoy · «Próximos eventos»', () => {
  test('in the day column, three per row, with what each event needs', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await mockApi(page, hoyData());
    await signIn(page);
    const section = page.locator('#lx-upcoming');
    await expect(page.locator('#lx-upcoming-title')).toContainText(
      'Próximos eventos',
    );
    await expect(page.locator('#lx-upcoming-title .lx-count')).toHaveText('9');
    // It lives in the day column (so the side column never leaves a gap)
    // and fills it with three cards per row.
    const col = await page.locator('.lx-hoy__col--main').boundingBox();
    const box = await section.boundingBox();
    expect(Math.round(box!.width)).toBe(Math.round(col!.width));
    expect(await columns(page, '#lx-upcoming .lx-event-grid')).toBe(3);
    // Eight shown, the rest one tap away.
    await expect(section.locator('article')).toHaveCount(8);
    await expect(page.locator('#lx-upcoming-more')).toContainText('Y 1 más.');

    // What e8 needs, without opening it.
    const e8 = card(page, 'e8');
    await expect(e8.locator('.lx-event__fact--tasks')).toHaveText(
      '3 tareas · 2 por hacer',
    );
    const warnings = e8.locator('.lx-event__fact--warnings');
    await expect(warnings).toContainText('1 conflicto');
    await expect(warnings).toHaveClass(/is-conflict/);
    // Live tasks' companies only (the finished sound check is not one).
    await expect(e8.locator('.lx-event__long')).toHaveText(
      'Escenarios Demo y Vallas Demo',
    );
    await expect(e8.locator('.lx-event__long')).toBeVisible();
    // An upcoming event with nothing planned says so.
    await expect(
      card(page, 'ex0').locator('.lx-event__fact--tasks'),
    ).toHaveText('Sin tareas registradas');
    await expect(
      card(page, 'ex0').locator('.lx-event__fact--warnings'),
    ).toHaveCount(0);
    // The card's name is still only the event's name.
    await expect(
      section.getByRole('article', {name: 'Cabalgata Demo'}),
    ).toBeVisible();
  });

  test('narrow cards keep the same facts in a shorter form', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, hoyData());
    await signIn(page);
    const e8 = card(page, 'e8');
    await expect(e8).toBeVisible();
    const width = (await e8.boundingBox())!.width;
    if (width < 300) {
      await expect(e8.locator('.lx-event__short')).toBeVisible();
      await expect(e8.locator('.lx-event__short')).toHaveText('2 empresas');
      await expect(e8.locator('.lx-event__long')).toBeHidden();
    } else {
      await expect(e8.locator('.lx-event__long')).toBeVisible();
    }
    await expect(e8.locator('.lx-event__fact--warnings')).toContainText(
      '1 conflicto',
    );
  });

  test('one column on a portrait phone, four cards before «Y N más»', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, hoyData());
    await signIn(page);
    await expect(page.locator('#lx-upcoming article')).toHaveCount(4);
    expect(await columns(page, '#lx-upcoming .lx-event-grid')).toBe(1);
    await expect(page.locator('#lx-upcoming-more')).toContainText('Y 5 más.');
    // Wide enough on a phone to spell the companies out.
    await expect(card(page, 'e8').locator('.lx-event__long')).toBeVisible();
  });
});

/** 20 entries this morning, 5 three days ago and 5 twelve days ago. */
function activityLog() {
  const at = (date: string, minutes: number) =>
    new Date(
      Date.parse(`${date}T10:00:00.000Z`) - minutes * 60_000,
    ).toISOString();
  const entry = (id: string, label: string, when: string) =>
    makeActivity(id, {type: 'task', id: 't1', label}, 'update', when, {
      changedFields: ['status'],
    });
  return [
    ...Array.from({length: 20}, (_, i) =>
      entry(`a${i}`, `Reciente ${i + 1}`, at(DAY, i * 5)),
    ),
    ...Array.from({length: 5}, (_, i) =>
      entry(`b${i}`, `Hace tres días ${i + 1}`, at(addDays(DAY, -3), i * 5)),
    ),
    ...Array.from({length: 5}, (_, i) =>
      entry(`c${i}`, `Hace doce días ${i + 1}`, at(addDays(DAY, -12), i * 5)),
    ),
  ];
}

test.describe('Gestor logístico · Hoy · «Actividad reciente»', () => {
  test('fixed height with inner scroll; «Ver anteriores» reaches older entries', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const api = await mockApi(page, {...planData(), activity: activityLog()});
    await signIn(page);
    const list = page.locator('#lx-activity-list');
    await expect(list).toHaveAttribute('role', 'region');
    await expect(list).toHaveAttribute('tabindex', '0');
    await expect(list).toHaveAccessibleName(/Actividad reciente/);
    await expect(list.locator('li')).toHaveCount(20);
    // Newest first.
    await expect(list.locator('li').first()).toContainText('«Reciente 1»');
    // It scrolls inside instead of growing.
    const size = await list.evaluate(el => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
    }));
    expect(size.client).toBeLessThanOrEqual(420);
    expect(size.scroll).toBeGreaterThan(size.client);
    // Keyboard: the region takes focus and scrolls with the arrows.
    await list.focus();
    await page.keyboard.press('End');
    await expect
      .poll(() => list.evaluate(el => el.scrollTop))
      .toBeGreaterThan(0);

    const older = page.locator('#lx-activity-older');
    await expect(older).toHaveText('Ver anteriores');
    await older.click();
    await expect(list.locator('li')).toHaveCount(25);
    await expect(list.locator('li').nth(20)).toContainText(
      '«Hace tres días 1»',
    );
    await expect(
      page.getByRole('status').filter({hasText: 'anteriores'}),
    ).toHaveText('Se han añadido 5 entradas anteriores al final de la lista.');
    // A second press goes back another week (and skips empty ones).
    await older.click();
    await expect(list.locator('li')).toHaveCount(30);
    await expect(list.locator('li').last()).toContainText('«Hace doce días 5»');
    // Nothing older: it says so and offers to look further back.
    await older.click();
    await expect(page.locator('#lx-activity-quiet')).toHaveText(
      'Sin actividad anterior en los 28 días previos.',
    );
    await expect(older).toHaveText('Buscar más atrás');
    // Each request stays within the route's eight days.
    const ranges = api
      .calls('GET', /\/activity$/)
      .map(c => new URLSearchParams(c.query))
      .filter(q => q.has('from'));
    expect(ranges.length).toBeGreaterThanOrEqual(3);
    for (const r of ranges) {
      const span = Date.parse(r.get('to')!) - Date.parse(r.get('from')!);
      expect(span).toBeLessThanOrEqual(8 * 86_400_000);
    }
    // The card never pushes the rest of Hoy down.
    const card = await page.locator('#lx-activity').boundingBox();
    expect(card!.height).toBeLessThan(620);
  });

  test('a failed page says so and can be retried', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    const api = await mockApi(page, {...planData(), activity: activityLog()});
    await signIn(page);
    api.failActivityRange = 1;
    await page.locator('#lx-activity-older').click();
    await expect(
      page.locator('#lx-activity-more [role="alert"]'),
    ).toContainText('No se han podido cargar las anteriores.');
    await expect(page.locator('#lx-activity-older')).toHaveText('Reintentar');
    await page.locator('#lx-activity-older').click();
    await expect(page.locator('#lx-activity-list li')).toHaveCount(25);
    await expect(page.locator('#lx-activity-more [role="alert"]')).toHaveCount(
      0,
    );
  });

  test('with fewer than twenty entries there is nothing older to ask for', async ({
    page,
  }) => {
    await mockApi(page, {...planData(), activity: activityLog().slice(0, 6)});
    await signIn(page);
    await expect(page.locator('#lx-activity-list li')).toHaveCount(6);
    await expect(page.locator('#lx-activity-older')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · forms · the quality group names the record', () => {
  test('a task', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await expect(page.locator('#lx-task-quality-title')).toHaveText(
      'Calidad de la tarea',
    );
    await expect(page.getByText('Calidad del dato')).toHaveCount(0);
  });

  test('an offer', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('catalogo'));
    await page.locator('#lx-catalog-add').click();
    await expect(page.locator('#lx-offer-quality-title')).toHaveText(
      'Calidad de la oferta',
    );
  });
});

test.describe('Gestor logístico · Catálogo · «Comparar» junto a la categoría', () => {
  test('appears only with two comparable offers and opens the ranking in place', async ({
    page,
  }) => {
    // E5: offers rank by their estimate with tax, so their companies need
    // one; without it they would all be listed apart.
    const data = directoryData();
    for (const c of data.companies ?? []) c.tax = IGIC;
    await mockApi(page, data);
    await signIn(page, 'Elvis', lxUrl('catalogo'));
    const compare = page.locator(`#lx-catgroup-compare-${CAT.carpas}`);
    await expect(compare).toHaveText('Comparar');
    await expect(compare).toHaveAccessibleName(
      'Comparar las ofertas de Carpas',
    );
    // Sonido has one offer: nothing to compare.
    await expect(
      page.locator(`#lx-catgroup-compare-${CAT.sonido}`),
    ).toHaveCount(0);
    await compare.click();
    await expect(compare).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator(`#lx-catcompare-${CAT.carpas}`);
    await expect(panel).toBeVisible();
    await expect(page.locator('#lx-offer-sheet')).toHaveCount(0);
    const rows = panel.locator('.lx-compare:not(.lx-compare--apart) > li');
    await expect(rows).toHaveCount(2);
    // Cheapest first, with gold and silver said in words.
    await expect(rows.nth(0)).toContainText('Carpa Prueba 6 × 3 m');
    await expect(rows.nth(0).locator('.lx-medal--gold')).toBeVisible();
    await expect(rows.nth(1).locator('.lx-medal--silver')).toBeVisible();
    await expect(rows.nth(0).getByRole('button')).toHaveAccessibleName(
      /^1\.º, oro/,
    );
    await expect(rows.nth(1).getByRole('button')).toHaveAccessibleName(
      /^2\.º, plata/,
    );
    await expect(panel).toContainText('€ / día');
    await expect(panel).toContainText('con el impuesto de cada una');
    // The rest of the category is listed apart, with the reason.
    await expect(
      page.locator(
        `#lx-catcompare-${CAT.carpas}-apart [data-offer-id="o3"][data-reason="price"]`,
      ),
    ).toContainText('Carpa Prueba 3 × 3 m');
    await expect(
      page.locator(`#lx-catcompare-${CAT.carpas}-apart`),
    ).toContainText('Carpa Prueba por metro');
    // Tapping a ranked offer opens it.
    await rows.nth(1).getByRole('button').click();
    await expect(page.locator('#lx-offer-sheet')).toBeVisible();
    await expect(page.locator('#lx-offer-price')).toContainText(
      '210,50 € / día',
    );
    // The offer sheet's own comparison has the medals too.
    await expect(
      page
        .locator('#lx-offer-compare-list li')
        .nth(0)
        .locator('.lx-medal--gold'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-offer-sheet')).toHaveCount(0);
    // Closing the comparison.
    await compare.click();
    await expect(panel).toHaveCount(0);
    await expect(compare).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Gestor logístico · categorías · «Gestionar» en el sitio', () => {
  test('own categories turn red with a ×; built-ins stay; «Hecho» leaves', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    const custom = {
      id: 'scat-custom-1',
      organizationId: ORG,
      scope: 'service',
      name: 'Aseos portátiles Prueba',
      builtIn: false,
    };
    api.categories.push(custom);
    await signIn(page, 'Elvis', lxUrl('catalogo'));
    await page.locator('#lx-catalog-add').click();
    const picker = page.locator('#lx-offer-categories');
    await expect(picker.locator('.lx-catpick__remove')).toHaveCount(0);
    const manage = page.locator('#lx-offer-cat-manage');
    await manage.click();
    await expect(manage).toHaveText('Hecho');
    await expect(picker.locator('.lx-catpick__chip.is-removable')).toHaveCount(
      1,
    );
    await expect(
      picker.locator('.lx-catpick__chip.is-removable label'),
    ).toHaveText('Aseos portátiles Prueba');
    // «Nueva categoría» steps aside while managing.
    await expect(page.locator('#lx-offer-cat-new')).toHaveCount(0);
    await expect(page.locator('#lx-offer-cat-managed')).toContainText(
      'Las que trae OxEye no se pueden borrar.',
    );
    await manage.click();
    await expect(manage).toHaveText('Gestionar');
    await expect(picker.locator('.lx-catpick__remove')).toHaveCount(0);
    await expect(page.locator('#lx-offer-cat-new')).toBeVisible();
    expect(api.calls('DELETE', `/categories/${custom.id}`)).toHaveLength(0);
  });
});
