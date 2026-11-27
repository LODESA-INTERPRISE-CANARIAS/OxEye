import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './mock-api';
import {DAY, fixClock, planData} from './plan-fixtures';

/**
 * Revisión 1 · E2 (note 6): the «Tareas» space. Every task of the
 * organization, searchable and filterable (filters kept on this device),
 * as a list by day or grouped by event, venue or company; dependencies
 * marked and highlighted as a chain; a task opens its sheet with its own
 * address. The plan of plan-fixtures.ts, fixed clock (10:30, 2 Dec 2026):
 *   t1 → t2 → t3 (a chain); t1 × t2 overlap at Plaza del Cristo (conflict);
 *   t3 only has reminders; t4 has a day but no time and no venue; t11 has
 *   nothing yet; t5 is done; t8 tomorrow; t10 in five days.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const PHONE = {width: 390, height: 844};
const row = (page: Page, id: string) =>
  page.locator(`#lx-tasks-list [data-task-id="${id}"]`);
const count = (page: Page) => page.locator('#lx-tasks-count');

async function openTareas(page: Page, name = 'Elvis') {
  await signIn(page, name, '#logistica/tareas');
  await expect(page.locator('#lx-space-tareas')).toBeVisible();
  await expect(page.locator('#lx-title')).toHaveText('Tareas');
}

/** Opens the multi-value filter `#id`, picks `values` and closes it. */
async function pickMany(page: Page, id: string, values: string[]) {
  await page.locator(`#${id}`).click();
  for (const v of values) {
    await page
      .locator(`#${id}-listbox [role="option"][data-value="${v}"]`)
      .click();
  }
  await page.locator(`#${id}-done`).click();
  await expect(page.locator(`#${id}`)).toHaveAttribute(
    'data-value',
    values.join(','),
  );
}

/** A horizontal touch swipe on the content area (same as calendar.spec). */
async function swipe(page: Page, from: number, to: number) {
  await page.locator('#lx-main').evaluate(
    (el, [a, b]) => {
      const at = (x: number): PointerEventInit => ({
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: 300,
      });
      el.dispatchEvent(new PointerEvent('pointerdown', at(a)));
      el.dispatchEvent(
        new PointerEvent('pointermove', at(a + (b > a ? 20 : -20))),
      );
      el.dispatchEvent(new PointerEvent('pointermove', at(b)));
      el.dispatchEvent(new PointerEvent('pointerup', at(b)));
    },
    [from, to],
  );
}

test.describe('Gestor logístico · Tareas', () => {
  test('a space of its own: every task by day, marks and «Espera a»', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    await page.locator('#lx-nav-tareas').click();
    await expect(page).toHaveURL(/#logistica\/tareas$/);
    await expect(page.locator('#lx-nav-tareas')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(count(page)).toHaveText('8 tareas');

    // By day, «Hoy» marked, undated last.
    const days = page.locator('#lx-tasks-list .lx-tlgroup--day');
    await expect(days).toHaveCount(4);
    await expect(days.first()).toHaveAttribute('data-day', DAY);
    await expect(days.first().locator('.lx-tlgroup__today')).toHaveText('Hoy');
    await expect(days.last()).toHaveAttribute('data-day', 'none');
    await expect(days.last()).toContainText('Sin fecha');
    await expect(days.first().locator('[data-task-id]')).toHaveCount(5);

    // Status, warning dot (conflicts apart from reminders), «Sin lugar».
    await expect(row(page, 't1').locator('.lx-tlrow__warn')).toHaveClass(
      /is-conflict/,
    );
    await expect(row(page, 't3').locator('.lx-tlrow__warn')).not.toHaveClass(
      /is-conflict/,
    );
    await expect(row(page, 't4').locator('.lx-tlrow__warn')).toHaveCount(0);
    await expect(row(page, 't4')).toContainText('Sin lugar');
    await expect(row(page, 't1')).toContainText('Escenarios Demo');
    await expect(row(page, 't5')).toContainText('Hecha');

    // Dependencies: «Espera a» and the chain button on linked tasks only.
    await expect(row(page, 't2').locator('.lx-tlrow__waits')).toHaveText(
      'Espera a: Montaje del escenario',
    );
    await expect(row(page, 't1').locator('.lx-tlrow__waits')).toHaveCount(0);
    await expect(row(page, 't1').locator('.lx-tlrow__chain')).toBeVisible();
    await expect(row(page, 't4').locator('.lx-tlrow__chain')).toHaveCount(0);
  });

  test('quick filters, search and «Quitar filtros»', async ({page}) => {
    await mockApi(page, planData());
    await openTareas(page);
    const warnings = page.locator('#lx-tasks-filter-warnings');
    // The chip counts the tasks it keeps (t1–t3 today, plus any other day's).
    const flagged = Number(
      await warnings.locator('.lx-num').textContent({timeout: 5000}),
    );
    expect(flagged).toBeGreaterThanOrEqual(3);
    await warnings.click();
    await expect(warnings).toHaveAttribute('aria-pressed', 'true');
    await expect(count(page)).toContainText(`${flagged} tareas de 8`);
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(
      flagged,
    );
    for (const id of ['t1', 't2', 't3']) {
      await expect(row(page, id)).toBeVisible();
    }
    await expect(row(page, 't4')).toHaveCount(0);

    await warnings.click();
    await page.locator('#lx-tasks-filter-notime').click();
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(2);
    await expect(row(page, 't4')).toBeVisible();
    await expect(row(page, 't11')).toBeVisible();

    await page.locator('#lx-tasks-clear').click();
    await expect(count(page)).toHaveText('8 tareas');

    // Accents and case do not matter; nothing found says so.
    await page.locator('#lx-tasks-search').fill('instalacion');
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(1);
    await expect(row(page, 't2')).toBeVisible();
    await page.locator('#lx-tasks-search').fill('grúa naranja');
    await expect(page.locator('#lx-tasks-noresults')).toContainText(
      'Ninguna tarea coincide con «grúa naranja»',
    );
    await page.locator('#lx-tasks-noresults-clear').click();
    await expect(page.locator('#lx-tasks-search')).toHaveValue('');
    await expect(count(page)).toHaveText('8 tareas');
  });

  test('event, company and day filters; kept on this device', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await openTareas(page);
    await expect(page.locator('#lx-tasks-filters')).toBeVisible();
    await pickMany(page, 'lx-tasks-f-company', ['c3']);
    await expect(count(page)).toContainText('3 tareas de 8');
    await pickMany(page, 'lx-tasks-f-event', ['none']);
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(2);
    await expect(row(page, 't5')).toBeVisible();
    await expect(row(page, 't8')).toBeVisible();
    await expect(page.locator('#lx-tasks-filters-toggle')).toContainText('2');

    // «Solo hoy» narrows the days.
    await page.locator('#lx-tasks-f-today').click();
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(1);
    await expect(row(page, 't5')).toBeVisible();

    await page.locator('#lx-tasks-search').fill('recogida');
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(1);

    // The filters survive a reload (this person, this organization); the
    // search does not.
    await page.reload();
    await expect(page.locator('#lx-space-tareas')).toBeVisible();
    await expect(page.locator('#lx-tasks-f-company')).toHaveAttribute(
      'data-value',
      'c3',
    );
    await expect(page.locator('#lx-tasks-search')).toHaveValue('');
    await expect(page.locator('#lx-tasks-list [data-task-id]')).toHaveCount(1);
    // …and never go into the address.
    await expect(page).toHaveURL(/#logistica\/tareas$/);
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter(k =>
        k.startsWith('oxeye.logistics.tasks-space.'),
      ),
    );
    expect(stored).toEqual([
      expect.stringMatching(/^oxeye\.logistics\.tasks-space\.v2:u-elvis:/),
    ]);

    // Logout leaves nothing behind for the next person on the device.
    await page.locator('#lx-logout').click();
    await expect(page.locator('#lx-login-form')).toBeVisible();
    const left = await page.evaluate(() =>
      Object.keys(localStorage).filter(k =>
        k.startsWith('oxeye.logistics.tasks-space.'),
      ),
    );
    expect(left).toEqual([]);
  });

  test('grouped by venue or company, with conflicts counted; arrow keys', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await openTareas(page);
    await page.locator('#lx-tasks-view-venue').click();
    await expect(page.locator('#lx-tasks-list')).toHaveAttribute(
      'data-view',
      'grouped',
    );
    const groups = page.locator('#lx-tasks-list .lx-tlgroup');
    await expect(
      groups.locator('.lx-tlgroup__title > span:first-child'),
    ).toHaveText([
      'Almacén municipal',
      'Plaza del Cristo',
      'Recinto ferial',
      'Sin lugar',
    ]);
    const cristo = page.locator('[data-group="v1"]');
    await expect(cristo.locator('[data-task-id]')).toHaveCount(3);
    await expect(cristo.locator('.lx-tlgroup__conflicts')).toContainText(
      '2 con conflicto',
    );

    // One radio group: arrows move between the views.
    await page.locator('#lx-tasks-view-venue').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#lx-tasks-view-company')).toBeFocused();
    await expect(page.locator('#lx-tasks-view-company')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('[data-group="c3"] [data-task-id]')).toHaveCount(
      3,
    );
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#lx-tasks-view-list')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('#lx-tasks-list')).toHaveAttribute(
      'data-view',
      'list',
    );
  });

  test('the chain of a task is highlighted both ways', async ({page}) => {
    await mockApi(page, planData());
    await openTareas(page);
    const button = row(page, 't2').locator('.lx-tlrow__chain');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const banner = page.locator('#lx-tasks-chain');
    await expect(banner).toContainText('Instalación de sonido');
    await expect(banner).toContainText('1 tarea antes · 1 tarea después');
    await expect(row(page, 't2')).toHaveClass(/is-chain-root/);
    await expect(row(page, 't1')).toHaveClass(/is-chain-before/);
    await expect(row(page, 't3')).toHaveClass(/is-chain-after/);
    await expect(row(page, 't4')).toHaveClass(/is-chain-out/);

    // Filtered-out links are counted, not lost.
    await page.locator('#lx-tasks-search').fill('sonido');
    await expect(banner).toContainText('2 ocultas por los filtros');
    await page.locator('#lx-tasks-search').fill('');

    await page.locator('#lx-tasks-chain-clear').click();
    await expect(banner).toHaveCount(0);
    await expect(row(page, 't4')).not.toHaveClass(/is-chain-out/);
  });

  test('a task opens its sheet at its own address; Back closes it', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await openTareas(page);
    await row(page, 't2').locator('.lx-tlrow__open').click();
    await expect(page.locator('#lx-task-sheet')).toBeVisible();
    await expect(page).toHaveURL(/#logistica\/tareas\/ficha\/tarea\/t2$/);
    await page.goBack();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#logistica\/tareas$/);

    // The address opens it again directly.
    await page.goto('/#logistica/tareas/ficha/tarea/t3');
    await expect(page.locator('#lx-task-sheet')).toBeVisible();
    await expect(page.locator('#lx-space-tareas')).toBeVisible();
  });

  test('empty: a member can add the first task from there', async ({page}) => {
    await mockApi(page, {...planData(), tasks: []});
    await openTareas(page);
    await expect(page.locator('#lx-tasks-empty')).toContainText(
      'Aún no hay tareas',
    );
    await page.locator('#lx-tasks-empty-add').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
  });

  test('a guest reads every task, adds none', async ({page}) => {
    await mockApi(page, planData());
    await openTareas(page, 'Invitado');
    await expect(count(page)).toHaveText('8 tareas');
    await expect(page.locator('#lx-tasks-add')).toHaveCount(0);
    await row(page, 't1').locator('.lx-tlrow__open').click();
    await expect(page.locator('#lx-task-sheet')).toBeVisible();
    await expect(page.locator('#lx-task-form')).toHaveCount(0);
  });

  test('without coverage it shows the device copy and says so', async ({
    page,
    context,
  }) => {
    await mockApi(page, planData());
    await openTareas(page);
    await expect(page.locator('#lx-tasks-offline')).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.locator('#lx-tasks-offline')).toBeVisible();
    await expect(count(page)).toHaveText('8 tareas');
    await context.setOffline(false);
    await expect(page.locator('#lx-tasks-offline')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · Tareas en el móvil', () => {
  test.use({viewport: PHONE});

  test('a tab of its own, swipe between neighbours, filters folded', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    await page.locator('#lx-tab-tareas').click();
    await expect(page.locator('#lx-space-tareas')).toBeVisible();
    await expect(page.locator('#lx-tab-tareas')).toHaveAttribute(
      'aria-current',
      'page',
    );
    // On a phone the panel starts folded; the quick chips stay at hand.
    await expect(page.locator('#lx-tasks-filters')).toHaveCount(0);
    await expect(page.locator('#lx-tasks-filter-warnings')).toBeVisible();
    await page.locator('#lx-tasks-filters-toggle').click();
    await expect(page.locator('#lx-tasks-filters')).toBeVisible();
    await page.locator('#lx-tasks-filters-toggle').click();

    // Rows are easy to tap; the page never scrolls sideways.
    const box = await row(page, 't1').locator('.lx-tlrow__open').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await swipe(page, 320, 80);
    await expect(page).toHaveURL(/#logistica\/inventarios$/);
    await swipe(page, 80, 320);
    await expect(page).toHaveURL(/#logistica\/tareas$/);
  });
});
