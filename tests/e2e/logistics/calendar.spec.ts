import {expect, test, type Page} from '@playwright/test';
import {choose} from './controls';
import {goToAddress, lxUrl, lxUrlRe} from './address';
import {addDays, mockApi, signIn} from './mock-api';
import {DAY, fixClock, planData} from './plan-fixtures';

/**
 * Gestor logístico, milestone 2: «Calendario». Month view with per-day counts
 * and conflict marks, the day view (timeline by venue, list by hour on an
 * upright phone), the link per day, navigation, the event filter, the hour
 * scale and multi-day events. The clock is fixed at 10:30 on Wed 2 Dec 2026.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const HOUR_KEY = 'oxeye.logistics.hour.v1';

const dayCell = (page: Page, date: string) =>
  page.locator(`#lx-month [data-date="${date}"]`);
const block = (page: Page, id: string) =>
  page.locator(`#lx-timeline [data-task-id="${id}"]`);

const hashOf = (date: string | null) =>
  lxUrlRe(`calendario${date ? `/${date}` : ''}`);

test.describe('Gestor logístico · Calendario, mes', () => {
  test('month view with counts and the conflict mark on the right day', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl('calendario'));
    await expect(page.locator('#lx-month')).toBeVisible();
    await expect(page.locator('#lx-title')).toHaveText('Calendario');
    await expect(page.locator('#lx-cal-title')).toHaveText(
      /diciembre de 2026/i,
    );
    await expect(page.locator('#lx-cal-view-month')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const today = dayCell(page, DAY);
    await expect(today).toHaveAttribute(
      'aria-label',
      'miércoles 2 de diciembre, hoy: 1 evento, 5 tareas, 2 conflictos. Navidad en la Plaza del Cristo',
    );
    await expect(today).toHaveClass(/is-today/);
    await expect(today).toHaveClass(/has-conflict/);
    await expect(today.locator('.lx-month__conflict')).toHaveText('2');
    await expect(today.locator('.lx-month__tasks')).toContainText('5');

    const tomorrow = dayCell(page, addDays(DAY, 1));
    await expect(tomorrow).toHaveAttribute(
      'aria-label',
      'jueves 3 de diciembre: 1 tarea',
    );
    await expect(tomorrow).not.toHaveClass(/has-conflict/);
    await expect(tomorrow.locator('.lx-month__conflict')).toHaveCount(0);
    await expect(dayCell(page, addDays(DAY, 4))).toHaveAttribute(
      'aria-label',
      'domingo 6 de diciembre: sin nada registrado',
    );

    // Tasks without a date are listed apart.
    await expect(page.locator('#lx-cal-undated')).toContainText(
      'Confirmar grúa con la empresa',
    );
  });

  test('a multi-day event shows on each of its days', async ({page}) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl('calendario'));
    for (const [offset, label] of [
      [5, 'lunes 7 de diciembre: 1 evento, 1 tarea. Feria de Navidad'],
      [6, 'martes 8 de diciembre: 1 evento. Feria de Navidad'],
      [7, 'miércoles 9 de diciembre: 1 evento. Feria de Navidad'],
      [8, 'jueves 10 de diciembre: sin nada registrado'],
    ] as const) {
      await expect(dayCell(page, addDays(DAY, offset))).toHaveAttribute(
        'aria-label',
        label,
      );
    }
    // One continuous bar across Monday to Wednesday.
    await expect(
      page.locator('.lx-month__bar', {hasText: 'Feria de Navidad'}),
    ).toHaveCount(1);

    for (const offset of [5, 6, 7]) {
      const date = addDays(DAY, offset);
      await goToAddress(page, lxUrl(`calendario/${date}`));
      const chip = page.locator('.lx-daychip[data-event-id="e7"]');
      await expect(chip, date).toBeVisible();
      if (offset > 5) await expect(chip).toContainText('continúa');
      else await expect(chip).not.toContainText('continúa');
    }
    await goToAddress(page, lxUrl(`calendario/${addDays(DAY, 8)}`));
    await expect(page.locator('#lx-day-empty')).toBeVisible();
  });

  test('clicking or pressing Enter on a day opens it and updates the link', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl('calendario'));
    await dayCell(page, addDays(DAY, 1)).click();
    await expect(page).toHaveURL(hashOf(addDays(DAY, 1)));
    await expect(page.locator('#lx-cal-title')).toContainText('3 de diciembre');
    await expect(page.locator('#lx-cal-view-day')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(block(page, 't8')).toBeVisible();

    await page.locator('#lx-cal-view-month').click();
    await expect(page).toHaveURL(hashOf(null));
    await expect(page.locator('#lx-month')).toBeVisible();

    // Keyboard: the focused day moves with the arrows.
    await dayCell(page, DAY).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dayCell(page, addDays(DAY, 1))).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(dayCell(page, addDays(DAY, 8))).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(hashOf(addDays(DAY, 8)));
  });

  test('previous, next and «Hoy» move by month', async ({page}) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl('calendario'));
    const title = page.locator('#lx-cal-title');
    const todayButton = page.locator('#lx-cal-today');
    await expect(todayButton).toBeDisabled();
    await page.locator('#lx-cal-prev').click();
    await expect(title).toHaveText(/noviembre de 2026/i);
    await expect(todayButton).toBeEnabled();
    await page.locator('#lx-cal-next').click();
    await page.locator('#lx-cal-next').click();
    await expect(title).toHaveText(/enero de 2027/i);
    await todayButton.click();
    await expect(title).toHaveText(/diciembre de 2026/i);
    await expect(todayButton).toBeDisabled();
    // The month view keeps a link of its own.
    await expect(page).toHaveURL(hashOf(null));
  });
});

test.describe('Gestor logístico · Calendario, día', () => {
  test('a link to a day opens it, before and after signing in', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl(`calendario/${addDays(DAY, 6)}`));
    await expect(page.locator('#lx-cal-title')).toContainText('8 de diciembre');
    await expect(page.locator('.lx-daychip[data-event-id="e7"]')).toBeVisible();

    await goToAddress(page, lxUrl(`calendario/${DAY}`));
    await expect(page.locator('#lx-cal-title')).toContainText('2 de diciembre');
    await expect(page.locator('#lx-cal-summary')).toContainText(
      '1 evento · 5 tareas',
    );
    await expect(page.locator('#lx-cal-summary')).toContainText('Hoy');
  });

  test('previous, next and «Hoy» move by day and keep the link', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl(`calendario/${DAY}`));
    const todayButton = page.locator('#lx-cal-today');
    await expect(todayButton).toBeDisabled();
    await page.locator('#lx-cal-prev').click();
    await expect(page).toHaveURL(hashOf(addDays(DAY, -1)));
    await expect(todayButton).toBeEnabled();
    await page.locator('#lx-cal-next').click();
    await page.locator('#lx-cal-next').click();
    await expect(page).toHaveURL(hashOf(addDays(DAY, 1)));
    await expect(page.locator('#lx-cal-title')).toContainText('3 de diciembre');
    await todayButton.click();
    await expect(page).toHaveURL(hashOf(DAY));
    await expect(todayButton).toBeDisabled();
  });

  test('timeline blocks are buttons named with title, time and venue', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl(`calendario/${DAY}`));
    const timeline = page.locator('#lx-timeline');
    await expect(timeline).toBeVisible();
    await expect(
      timeline.getByRole('group', {name: 'Plaza del Cristo: 3 tareas'}),
    ).toBeVisible();
    await expect(
      timeline.getByRole('group', {name: 'Almacén municipal: 1 tarea'}),
    ).toBeVisible();

    const t1 = timeline.getByRole('button', {
      name: /^Montaje del escenario, montaje, 08:00 – 13:00, Plaza del Cristo, Escenarios Demo, confirmada/,
    });
    await expect(t1).toBeVisible();
    await expect(t1).toHaveAttribute('data-task-id', 't1');
    await expect(t1).toHaveClass(/has-conflict/);
    await expect(
      timeline.getByRole('button', {
        name: /^Entrega de vallas, entrega, 17:30 – 18:30, Plaza del Cristo/,
      }),
    ).toBeVisible();
    await expect(block(page, 't3')).not.toHaveClass(/has-conflict/);
    // The event behind its venue's tasks; its name and hours are in the
    // venue's header (Revisión 1, CAP1), so no block can cover them.
    await expect(timeline.locator('.lx-tl__band')).toHaveCount(1);
    await expect(
      timeline.locator('.lx-tl__head[data-col="v1"] .lx-tl__frame'),
    ).toHaveText(/17:00 – 21:00\s*Navidad en la Plaza del Cristo/);
    // Tasks without a time sit under «Sin hora», not in the timeline.
    await expect(block(page, 't4')).toHaveCount(0);
    const untimed = page.locator('#lx-day-untimed');
    await expect(untimed.locator('h3')).toHaveText('Sin hora · 1');
    await expect(untimed.locator('[data-task-id="t4"]')).toBeVisible();

    // Clicking a block opens its task.
    await block(page, 't2').click();
    await expect(page.locator('#lx-task-form')).toBeVisible();
    await expect(page.locator('#lx-task-title')).toHaveValue(
      'Instalación de sonido',
    );
    await page.keyboard.press('Escape');
    await untimed.locator('[data-task-id="t4"]').click();
    await expect(page.locator('#lx-task-title')).toHaveValue(
      'Revisar extintores',
    );
  });

  test('the event filter narrows the month and the day', async ({page}) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl('calendario'));
    await choose(page, 'lx-cal-filter', 'e1');
    await expect(dayCell(page, DAY)).toHaveAttribute(
      'aria-label',
      'miércoles 2 de diciembre, hoy: 1 evento, 3 tareas, 2 conflictos. Navidad en la Plaza del Cristo',
    );
    await expect(dayCell(page, addDays(DAY, 1))).toHaveAttribute(
      'aria-label',
      /sin nada registrado$/,
    );
    await expect(dayCell(page, addDays(DAY, 5))).toHaveAttribute(
      'aria-label',
      /sin nada registrado$/,
    );

    await choose(page, 'lx-cal-filter', 'none');
    await expect(dayCell(page, DAY)).toHaveAttribute(
      'aria-label',
      'miércoles 2 de diciembre, hoy: 2 tareas',
    );
    await expect(dayCell(page, DAY)).not.toHaveClass(/has-conflict/);
    await expect(dayCell(page, addDays(DAY, 1))).toHaveAttribute(
      'aria-label',
      'jueves 3 de diciembre: 1 tarea',
    );

    // The filter stays while looking at the day.
    await dayCell(page, DAY).click();
    await expect(block(page, 't5')).toBeVisible();
    await expect(block(page, 't1')).toHaveCount(0);
    await expect(
      page.locator('#lx-day-untimed [data-task-id="t4"]'),
    ).toBeVisible();

    await choose(page, 'lx-cal-filter', 'e1');
    for (const id of ['t1', 't2', 't3']) {
      await expect(block(page, id)).toBeVisible();
    }
    await expect(block(page, 't5')).toHaveCount(0);
    await expect(page.locator('#lx-day-untimed')).toHaveCount(0);

    await choose(page, 'lx-cal-filter', 'all');
    await expect(block(page, 't5')).toBeVisible();
    await expect(block(page, 't1')).toBeVisible();
  });

  test('− and + change the hour height and it is remembered after reload', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl(`calendario/${DAY}`));
    const timeline = page.locator('#lx-timeline');
    await expect(timeline).toHaveAttribute('style', /--lx-hour: 64px/);
    const before = (await block(page, 't1').boundingBox())!.height;

    await page.locator('#lx-cal-zoom-in').click();
    await expect(timeline).toHaveAttribute('style', /--lx-hour: 80px/);
    await expect
      .poll(async () =>
        Math.abs(
          (await block(page, 't1').boundingBox())!.height - before * 1.25,
        ),
      )
      .toBeLessThan(2);
    expect(await page.evaluate(k => localStorage.getItem(k), HOUR_KEY)).toBe(
      '80',
    );

    await page.reload();
    await expect(page.locator('#lx-timeline')).toHaveAttribute(
      'style',
      /--lx-hour: 80px/,
    );
    await page.locator('#lx-cal-zoom-out').click();
    await page.locator('#lx-cal-zoom-out').click();
    await expect(page.locator('#lx-timeline')).toHaveAttribute(
      'style',
      /--lx-hour: 51px/,
    );
  });
});

/** A horizontal touch swipe from right to left on the content area. */
async function swipeLeft(page: Page) {
  await page.locator('#lx-main').evaluate(el => {
    const at = (x: number): PointerEventInit => ({
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: 220,
    });
    el.dispatchEvent(new PointerEvent('pointerdown', at(640)));
    el.dispatchEvent(new PointerEvent('pointermove', at(620)));
    el.dispatchEvent(new PointerEvent('pointermove', at(440)));
    el.dispatchEvent(new PointerEvent('pointerup', at(440)));
  });
}

test.describe('Gestor logístico · Calendario en el móvil', () => {
  test('upright, the day is a list by hour', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await mockApi(page, planData());
    await signIn(page, 'Elvis', lxUrl(`calendario/${DAY}`));
    const list = page.locator('#lx-hour-list');
    await expect(list).toBeVisible();
    await expect(page.locator('#lx-timeline')).toHaveCount(0);
    await expect(page.locator('#lx-cal-zoom-in')).toHaveCount(0);
    await expect(page.locator('#logistics-app')).not.toHaveAttribute(
      'data-timeline',
    );
    const eight = list.locator('.lx-hours__group', {
      has: page.locator('h3', {hasText: '08:00'}),
    });
    await expect(eight.locator('[data-task-id="t1"]')).toBeVisible();
    const hours = await list
      .locator('.lx-hours__label')
      .evaluateAll(els => els.map(el => el.textContent));
    expect(hours).toEqual(['07:00', '08:00', '12:00', '17:00']);
    await list.locator('[data-task-id="t3"]').click();
    await expect(page.locator('#lx-task-title')).toHaveValue(
      'Entrega de vallas',
    );
  });

  test('in landscape, the day is the timeline', async ({page}) => {
    await page.setViewportSize({width: 844, height: 390});
    await mockApi(page, planData());
    // The header is folded away beside the timeline, so sign in on «Hoy».
    await signIn(page);
    await goToAddress(page, lxUrl(`calendario/${DAY}`));
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await expect(page.locator('#lx-title')).toBeHidden();
    await expect(page.locator('#lx-hour-list')).toHaveCount(0);
    await expect(page.locator('#logistics-app')).toHaveAttribute(
      'data-timeline',
      'true',
    );
    await expect(page.locator('.lx-tl__scroller')).toHaveAttribute(
      'data-no-swipe',
    );
  });

  test('the swipe between spaces is off while the timeline is shown', async ({
    page,
  }) => {
    await page.setViewportSize({width: 844, height: 390});
    await mockApi(page, planData());
    await signIn(page);
    await goToAddress(page, lxUrl(`calendario/${DAY}`));
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await swipeLeft(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(hashOf(DAY));
    await expect(page.locator('#lx-timeline')).toBeVisible();

    // Control: the same gesture on the month view moves to the next space
    // («Tareas», after «Calendario» since Revisión 1).
    await page.locator('#lx-cal-view-month').click();
    await expect(page.locator('#lx-month')).toBeVisible();
    await swipeLeft(page);
    await expect(page).toHaveURL(lxUrlRe('tareas'));
  });
});
