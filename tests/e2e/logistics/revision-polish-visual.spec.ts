import {test, expect, type Page} from '@playwright/test';
import {
  ORG,
  addDays,
  makeActivity,
  makeEvent,
  makeTask,
  mockApi,
  signIn,
} from './mock-api';
import {CAT, directoryData} from './directory-fixtures';
import {IGIC} from './money-fixtures';
import {followData, openHypothesis} from './followup-fixtures';
import {
  DAY,
  ESCENARIOS,
  PLAZA_ADELANTADO,
  RECINTO,
  SONIDO,
  VALLAS,
  fixClock,
  planData,
} from './plan-fixtures';

/**
 * Screenshots of the Revisión 1 · E1 «Pulido» screens for the UI review
 * (no behavioural assertions: those live in revision-polish.spec.ts).
 * Output: test-results/visual/logistics-r1-<screen>-<palette>.png
 */

const PALETTES = [
  'oxeye',
  'atlas',
  'noctis',
  'territorio',
  'vector',
  'bendy',
] as const;
const OUT = 'test-results/visual';
const DESKTOP = {width: 1440, height: 1000};
const PHONE = {width: 390, height: 844};

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.describe.configure({timeout: 120_000});
test.beforeEach(async ({page}) => fixClock(page));

async function capture(
  page: Page,
  screen: string,
  opts: {fullPage?: boolean; palettes?: readonly string[]} = {},
) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of opts.palettes ?? PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/logistics-r1-${screen}-${id}.png`,
      fullPage: opts.fullPage,
    });
  }
}

function hoyData() {
  const base = planData();
  const day3 = addDays(DAY, 3);
  const events = [
    ...base.events,
    makeEvent(
      'e8',
      'Cabalgata de Reyes Demo',
      {date: day3, start: '17:00', end: '21:00'},
      {venue: {...PLAZA_ADELANTADO}, status: 'confirmed'},
    ),
    makeEvent(
      'e9',
      'Concierto de Año Nuevo Demo',
      {date: addDays(DAY, 8), start: '20:00', end: '23:30'},
      {venue: {...RECINTO}},
    ),
    makeEvent(
      'e10',
      'Mercadillo solidario Demo',
      {date: addDays(DAY, 10)},
      {verification: 'to_verify'},
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
      'Vallas de la cabalgata',
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
      'Equipo de sonido de la cabalgata',
      {date: day3, start: '13:00', end: '15:00'},
      {
        eventId: 'e8',
        kind: 'delivery',
        venue: {...PLAZA_ADELANTADO},
        company: {...SONIDO},
      },
    ),
  ];
  const activity = Array.from({length: 26}, (_, i) =>
    makeActivity(
      `a${i}`,
      {type: 'task', id: 't1', label: `Montaje del escenario ${i + 1}`},
      i % 3 ? 'update' : 'create',
      new Date(
        Date.parse(`${DAY}T10:20:00.000Z`) - i * 47 * 60_000,
      ).toISOString(),
      {changedFields: i % 3 ? ['status', 'startsAt'] : []},
    ),
  );
  return {...base, events, tasks, activity};
}

test.describe('Gestor logístico · revisión 1 · capturas', () => {
  test('Hoy on desktop and phone', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, hoyData());
    await signIn(page);
    await expect(page.locator('#lx-upcoming article').first()).toBeVisible();
    await expect(page.locator('#lx-activity-list li').first()).toBeVisible();
    // The page scrolls inside the app, not the document: scroll the parts.
    await page.locator('#lx-upcoming').scrollIntoViewIfNeeded();
    await capture(page, 'hoy-desktop');
    await page.locator('#lx-activity').scrollIntoViewIfNeeded();
    await capture(page, 'hoy-desktop-activity', {
      palettes: ['oxeye', 'noctis', 'vector'],
    });
    await page.setViewportSize({width: 1920, height: 1080});
    await page.locator('#lx-upcoming').scrollIntoViewIfNeeded();
    await capture(page, 'hoy-wide', {palettes: ['oxeye', 'noctis']});
    await page.setViewportSize(PHONE);
    await page.locator('#lx-upcoming').scrollIntoViewIfNeeded();
    await capture(page, 'hoy-upcoming-phone');
    await page.locator('#lx-activity').scrollIntoViewIfNeeded();
    await page.locator('#lx-activity-older').click();
    await expect(page.locator('#lx-activity-list li')).toHaveCount(26);
    await capture(page, 'hoy-activity-phone');
  });

  test('catalogue «Comparar» and «Gestionar»', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    // E5: offers rank by their estimate with tax, so their companies need one.
    const data = directoryData();
    for (const c of data.companies ?? []) c.tax = IGIC;
    const api = await mockApi(page, data);
    api.categories.push({
      id: 'scat-custom-1',
      organizationId: ORG,
      scope: 'service',
      name: 'Aseos portátiles Prueba',
      builtIn: false,
    });
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await page.locator(`#lx-catgroup-compare-${CAT.carpas}`).click();
    await expect(page.locator(`#lx-catcompare-${CAT.carpas}`)).toBeVisible();
    await capture(page, 'catalog-compare-desktop');
    await page.setViewportSize(PHONE);
    await page.locator(`#lx-catcompare-${CAT.carpas}`).scrollIntoViewIfNeeded();
    await capture(page, 'catalog-compare-phone', {
      palettes: ['oxeye', 'noctis', 'bendy'],
    });
    await page.setViewportSize(DESKTOP);
    await page.locator('#lx-catalog-add').click();
    await page.locator('#lx-offer-cat-manage').click();
    await page.locator('#lx-offer-categories').scrollIntoViewIfNeeded();
    await capture(page, 'category-manage-desktop');
    await page.locator('#lx-offer-cat-delete-scat-custom-1').click();
    await capture(page, 'category-manage-confirm-desktop', {
      palettes: ['oxeye', 'noctis', 'vector'],
    });
    await page.setViewportSize(PHONE);
    await page.locator('#lx-offer-categories').scrollIntoViewIfNeeded();
    await capture(page, 'category-manage-confirm-phone', {
      palettes: ['oxeye', 'noctis', 'bendy'],
    });
  });

  test('hypothesis chips and analysis without the hatch', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, followData({hypotheses: [openHypothesis()]}));
    await signIn(page);
    await expect(page.locator('[id^="lx-hypo-chip-"]').first()).toBeVisible();
    await page.locator('#lx-today-hypotheses').scrollIntoViewIfNeeded();
    await capture(page, 'hypothesis-chip-phone');
    await page.locator('[id^="lx-hypo-chip-"]').first().click();
    await expect(page.locator('#lx-hypo-results')).toBeVisible();
    await capture(page, 'hypothesis-sheet-phone');
  });

  test('task sheet: the chain that would close a loop', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, planData());
    await signIn(page);
    await page.locator('#lx-today-tasks [data-task-id="t1"]').first().click();
    await page.locator('#lx-task-dep-t3-why').scrollIntoViewIfNeeded();
    await capture(page, 'task-cycle-desktop', {
      palettes: ['oxeye', 'noctis', 'territorio'],
    });
  });
});
