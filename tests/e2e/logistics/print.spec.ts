import {expect, test, type Locator, type Page} from '@playwright/test';
import {addDays, makeCompany, makeTask, mockApi, signIn} from './mock-api';
import {DAY, PLAZA_CRISTO, fixClock} from './plan-fixtures';
import {followCompanies, followData, followTasks} from './followup-fixtures';

/**
 * Gestor logístico, Revisión 1 (note 21, CAP2): printed pages on A4.
 * - A task over several days has a long time («07:00 → jue 3 dic, 22:30»):
 *   it wraps inside its column and never runs over the task title, in the
 *   work order and in the day close.
 * - While printing, the page title (the saved PDF's name) is
 *   `SIGLAS_Tipo_YYYY-MM-DD_HH-mm`, and it comes back afterwards.
 * The organization of the mock is «Ayuntamiento de La Laguna» → «LL».
 * Writes the PDFs and print screenshots to `test-results/visual/` for review.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
});

/** A4 at 96 dpi. */
const A4 = {width: 794, height: 1123};

const NOVA = {id: 'c9', name: 'Nova Staff Demo'};
const LONG_TITLE =
  'Montaje de la carpa principal, del escenario y de la iluminación de la Plaza del Cristo Demo';

const printData = () =>
  followData({
    companies: [...followCompanies(), makeCompany(NOVA.id, NOVA.name)],
    tasks: [
      ...followTasks(),
      // CAP2: confirmed (solid pill), from 07:00 today to 22:30 tomorrow.
      makeTask(
        'm1',
        LONG_TITLE,
        {date: DAY, endDate: addDays(DAY, 1), start: '07:00', end: '22:30'},
        {
          kind: 'assembly',
          status: 'confirmed',
          company: {...NOVA},
          venue: {...PLAZA_CRISTO},
        },
      ),
      // Planned (outlined pill), three days.
      makeTask(
        'm2',
        'Personal de control de accesos y acomodación durante todo el montaje Demo',
        {date: DAY, endDate: addDays(DAY, 2), start: '08:00', end: '20:00'},
        {kind: 'other', company: {...NOVA}, venue: {...PLAZA_CRISTO}},
      ),
    ],
  });

type Box = {x: number; y: number; width: number; height: number};

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** For every row, the time and the text next to it never share a pixel. */
async function expectApart(rows: Locator, time: string, title: string) {
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const t = await row.locator(time).first().boundingBox();
    const h = await row.locator(title).first().boundingBox();
    expect(t, `time box of row ${i}`).not.toBeNull();
    expect(h, `title box of row ${i}`).not.toBeNull();
    expect(overlaps(t!, h!), `row ${i}: time over the title`).toBe(false);
    expect(
      t!.x + t!.width,
      `row ${i}: time past its column`,
    ).toBeLessThanOrEqual(h!.x + 0.5);
  }
}

async function beforePrint(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
}
async function afterPrint(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
}
const footProperty = (page: Page) =>
  page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--lx-print-foot'),
  );

test.describe('Gestor logístico · impresión en A4', () => {
  test('work order: a multi-day time never covers the title (CAP2)', async ({
    page,
  }) => {
    await page.setViewportSize(A4);
    await mockApi(page, printData());
    await signIn(page, 'Elvis', '#logistica/contactos');
    await page.locator('#lx-contacts-tab-companies').click();
    await page
      .locator(`[data-company-id="${NOVA.id}"] .lx-dirrow__main`)
      .click();
    await page.locator('#lx-company-work-order').click();
    await expect(page.locator('#lx-order-sheet')).toBeVisible();
    const printed = page.locator('body > .lx-print-root');
    await expect(printed.locator('.lx-order__item')).toHaveCount(2);
    await expect(printed.locator('.lx-order__time').first()).toHaveText(
      '07:00 → jue 3 dic, 22:30',
    );

    // On screen (the preview) and on paper.
    await expectApart(
      page.locator('#lx-order-preview .lx-order__row'),
      '.lx-order__time',
      '.lx-order__task',
    );
    await page.emulateMedia({media: 'print'});
    await expectApart(
      printed.locator('.lx-order__row'),
      '.lx-order__time',
      '.lx-order__task',
    );

    const title = await page.title();
    await beforePrint(page);
    await expect(page).toHaveTitle(
      'LL_Ficha-de-trabajo_Nova-Staff-Demo_2026-12-02_10-30',
    );
    expect(await footProperty(page)).toContain(
      'Generado por OxEye · 2 dic 2026, 10:30',
    );
    await page.screenshot({
      path: 'test-results/visual/logistics-print-work-order.png',
      fullPage: true,
    });
    await page.pdf({
      path: 'test-results/visual/logistics-print-work-order.pdf',
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    await afterPrint(page);
    await expect(page).toHaveTitle(title);
    expect(await footProperty(page)).toBe('');
  });

  test('work order button: named while printing, title back when the sheet closes', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {__titles: string[]};
      w.__titles = [];
      window.print = () => {
        w.__titles.push(document.title);
      };
    });
    await mockApi(page, printData());
    await signIn(page, 'Elvis', '#logistica/contactos');
    const before = await page.title();
    await page.locator('#lx-contacts-tab-companies').click();
    await page
      .locator(`[data-company-id="${NOVA.id}"] .lx-dirrow__main`)
      .click();
    await page.locator('#lx-company-work-order').click();
    await page.locator('#lx-order-print').click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as {__titles: string[]}).__titles,
        ),
      )
      .toEqual(['LL_Ficha-de-trabajo_Nova-Staff-Demo_2026-12-02_10-30']);
    // No `afterprint` here (some phones never send it): closing restores it.
    await page.locator('#lx-order-close').click();
    await expect(page.locator('#lx-order-sheet')).toHaveCount(0);
    await expect(page).toHaveTitle(before);
  });

  test('day close: long windows wrap in their column; the file is named', async ({
    page,
  }) => {
    await page.setViewportSize(A4);
    await mockApi(page, printData());
    await signIn(page, 'Elvis', '#logistica/cierre');
    const printed = page.locator('body > .lx-day-root');
    await expect(printed.locator('.lx-dayp')).toHaveCount(1);
    const rows = printed.locator('.lx-dayp__tasks > li');
    await expect(
      rows.filter({hasText: 'Montaje de la carpa principal'}).first(),
    ).toBeAttached();

    await page.emulateMedia({media: 'print'});
    await expect(printed).toBeVisible();
    await expectApart(rows, '.lx-dayp__time', ':scope > span:nth-child(2)');

    await beforePrint(page);
    await expect(page).toHaveTitle('LL_Cierre-de-jornada_2026-12-02_10-30');
    await page.screenshot({
      path: 'test-results/visual/logistics-print-day-close.png',
      fullPage: true,
    });
    await page.pdf({
      path: 'test-results/visual/logistics-print-day-close.pdf',
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    await afterPrint(page);
    await expect(page).not.toHaveTitle(/Cierre-de-jornada/);
  });

  test('day close of a past day says which day in the name', async ({page}) => {
    await mockApi(page, printData());
    await signIn(page, 'Elvis', `#logistica/cierre/${addDays(DAY, -1)}`);
    await expect(page.locator('body > .lx-day-root .lx-dayp')).toHaveCount(1);
    await beforePrint(page);
    await expect(page).toHaveTitle(
      'LL_Cierre-de-jornada_del-2026-12-01_2026-12-02_10-30',
    );
    await afterPrint(page);
  });
});
