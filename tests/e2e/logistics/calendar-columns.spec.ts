import {expect, test, type Locator, type Page} from '@playwright/test';
import {fiveVenueData} from './calendar-columns-fixtures';
import {goToAddress, lxUrl, lxUrlRe} from './address';
import {mockApi, signIn} from './mock-api';
import {
  ALMACEN,
  DAY,
  fixClock,
  PLAZA_ADELANTADO,
  planData,
} from './plan-fixtures';

/**
 * Revisión 1 · Calendario, day view by venue: resizable columns, folding a
 * venue to its acronym, ‹ › with more than three venues, each venue's own
 * warnings in its header, and the event frame always readable (CAP1). The
 * clock is fixed at 10:30 on Wed 2 Dec 2026.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const PREFS_KEY = 'oxeye.logistics.calendar-columns.v1';

const head = (page: Page, key: string) =>
  page.locator(`#lx-timeline .lx-tl__head[data-col="${key}"]`);
const block = (page: Page, id: string) =>
  page.locator(`#lx-timeline [data-task-id="${id}"]`);
const widthOf = async (l: Locator) => (await l.boundingBox())!.width;
const prefs = (page: Page) =>
  page.evaluate(k => localStorage.getItem(k), PREFS_KEY);

async function openDay(page: Page, data = planData()) {
  await mockApi(page, data);
  await signIn(page, 'Elvis', lxUrl(`calendario/${DAY}`));
  await expect(page.locator('#lx-timeline')).toBeVisible();
}

test.describe('Gestor logístico · Calendario, columnas por lugar', () => {
  test('a column edge drags wider and narrower, within the screen, and is remembered', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openDay(page);
    const almacen = head(page, ALMACEN.id);
    const before = await widthOf(almacen);
    const handle = page.locator(`[data-col-resize="${ALMACEN.id}"]`);
    await expect(handle).toHaveAttribute('role', 'separator');
    await expect(handle).toHaveAttribute('aria-valuetext', 'Ancho automático');

    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 150, y, {steps: 6});
    await page.mouse.up();
    await expect
      .poll(async () => Math.abs((await widthOf(almacen)) - (before - 150)))
      .toBeLessThan(3);
    expect(JSON.parse((await prefs(page))!)).toEqual({
      [ALMACEN.id]: {width: Math.round(before - 150)},
    });

    // Never wider than the visible plan, however far it is dragged.
    const box2 = (await handle.boundingBox())!;
    await page.mouse.move(box2.x + 8, y);
    await page.mouse.down();
    await page.mouse.move(box2.x + 3000, y, {steps: 4});
    await page.mouse.up();
    const scroller = (await page.locator('.lx-tl__scroller').boundingBox())!;
    expect(await widthOf(almacen)).toBeLessThanOrEqual(scroller.width - 50);

    // Keyboard: ← narrows by 16 px, Inicio goes to the narrowest.
    await handle.focus();
    const wide = await widthOf(almacen);
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(async () => Math.abs((await widthOf(almacen)) - (wide - 16)))
      .toBeLessThan(2);
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '128');
    await expect.poll(() => widthOf(almacen)).toBeLessThan(130);

    // Remembered on this device.
    await page.reload();
    await expect(page.locator('#lx-timeline')).toBeVisible();
    await expect.poll(() => widthOf(head(page, ALMACEN.id))).toBeLessThan(130);

    // Supr returns it to automatic.
    await page.locator(`[data-col-resize="${ALMACEN.id}"]`).focus();
    await page.keyboard.press('Delete');
    await expect
      .poll(async () =>
        Math.abs((await widthOf(head(page, ALMACEN.id))) - before),
      )
      .toBeLessThan(3);
    expect(await prefs(page)).toBeNull();
  });

  test('the last column, narrowed by hand, snaps back to fill the plan when dragged to its edge', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openDay(page);
    const last = page.locator('#lx-timeline .lx-tl__head[data-col]').last();
    const key = (await last.getAttribute('data-col'))!;
    const first = page.locator('#lx-timeline .lx-tl__head[data-col]').first();
    const firstKey = (await first.getAttribute('data-col'))!;
    const drag = async (dx: number, k = key) => {
      const b = (await page.locator(`[data-col-resize="${k}"]`).boundingBox())!;
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y, {steps: 6});
      await page.mouse.up();
    };
    // Every column sized by hand: an empty band is left on the right.
    await drag(-100, firstKey);
    await drag(-200);
    await expect
      .poll(async () => JSON.parse((await prefs(page)) ?? '{}')[key]?.width)
      .toBeTruthy();
    const firstWidth = await widthOf(first);

    // To the plan's right edge: automatic again, the others untouched.
    await drag(400);
    await expect
      .poll(async () => JSON.parse((await prefs(page)) ?? '{}')[key])
      .toBeUndefined();
    expect(JSON.parse((await prefs(page))!)[firstKey]?.width).toBeTruthy();
    const scroller = page.locator('.lx-tl__scroller');
    const edge = await scroller.evaluate(
      el => el.getBoundingClientRect().left + el.clientLeft + el.clientWidth,
    );
    await expect
      .poll(async () => {
        const b = (await last.boundingBox())!;
        return Math.abs(b.x + b.width - edge);
      })
      .toBeLessThan(3);
    expect(Math.abs((await widthOf(first)) - firstWidth)).toBeLessThan(2);
  });

  test('a venue folds to its acronym, its blocks stay as markers, and it unfolds', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openDay(page);
    const almacen = head(page, ALMACEN.id);
    await almacen
      .getByRole('button', {
        name: 'Contraer Almacén municipal a sus siglas (A.M.)',
      })
      .click();

    const expand = almacen.locator('.lx-tl__expand');
    await expect(expand).toHaveText(/A\.M\./);
    await expect(expand).toHaveAttribute(
      'aria-label',
      'Expandir Almacén municipal (A.M.): 1 tarea',
    );
    await expect(expand).toHaveAttribute('title', /^Almacén municipal/);
    await expect(expand).toBeFocused();
    expect(await widthOf(almacen)).toBeLessThan(60);
    await expect(
      page.getByRole('group', {name: 'Almacén municipal: 1 tarea (contraído)'}),
    ).toBeVisible();

    // The block is a slim marker that still opens its task.
    const marker = block(page, 't5');
    await expect(marker).toHaveClass(/is-marker/);
    await expect(marker).toHaveAttribute(
      'title',
      /^Recogida de material en el almacén/,
    );
    await marker.click();
    await expect(page.locator('#lx-task-title')).toHaveValue(
      'Recogida de material en el almacén',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-task-form')).toHaveCount(0);
    await expect(page).toHaveURL(lxUrlRe(`calendario/${DAY}`));

    await page.reload();
    await expect(
      head(page, ALMACEN.id).locator('.lx-tl__expand'),
    ).toBeVisible();
    await head(page, ALMACEN.id).locator('.lx-tl__expand').click();
    await expect(head(page, ALMACEN.id).locator('.lx-tl__venue')).toHaveText(
      'Almacén municipal',
    );
    await expect(block(page, 't5')).not.toHaveClass(/is-marker/);
    await expect(head(page, ALMACEN.id).locator('.lx-tl__fold')).toBeFocused();
    expect(await prefs(page)).toBeNull();
  });

  test('each venue header shows its own warnings and opens them', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await openDay(page, fiveVenueData());
    // The day's general list stays, as the pill in the bar.
    await expect(page.locator('#lx-day-warnings-toggle')).toBeVisible();

    const cristo = head(page, 'v1').locator('.lx-tl__warnbadge');
    await expect(cristo).toHaveText('5');
    await expect(cristo).toHaveClass(/has-conflict/);
    await expect(cristo).toHaveAttribute(
      'aria-label',
      'Avisos de Plaza del Cristo: 2 conflictos y 3 recordatorios. Ver avisos.',
    );
    // Reminders only: the neutral tone.
    const adelantado = head(page, PLAZA_ADELANTADO.id).locator(
      '.lx-tl__warnbadge',
    );
    await expect(adelantado).toBeVisible();
    await expect(adelantado).not.toHaveClass(/has-conflict/);
    // No warnings, no badge.
    await expect(
      head(page, ALMACEN.id).locator('.lx-tl__warnbadge'),
    ).toHaveCount(0);

    await cristo.click();
    const panel = page.getByRole('dialog', {
      name: 'Avisos de Plaza del Cristo',
    });
    await expect(panel).toBeVisible();
    await expect(panel.locator('.lx-warning')).toHaveCount(5);
    await expect(panel.locator('.lx-warning').first()).toHaveClass(
      /lx-warning--conflict/,
    );
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(cristo).toBeFocused();

    // A warning opens its task.
    await cristo.click();
    await panel.locator('.lx-warning__row').first().click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#lx-task-form')).toBeVisible();
  });

  test('the event frame stays readable over blocks at the same hour, and short blocks keep their start (CAP1)', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 900});
    await openDay(page, fiveVenueData());
    const frame = head(page, PLAZA_ADELANTADO.id).locator('.lx-tl__frame');
    await expect(frame).toHaveText(/09:00 – 14:00\s*Mercadillo navideño/);
    await expect(frame).toHaveAttribute('title', /Mercadillo navideño/);

    const zoomOut = page.locator('#lx-cal-zoom-out');
    for (let i = 0; i < 8; i++) {
      // Nothing covers the frame hours or a short block's start, at any scale.
      const hours = frame.locator('.lx-tl__frame-time');
      const covered = await hours.evaluate(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
        return !el.contains(hit);
      });
      expect(covered, `frame hours at step ${i}`).toBe(false);
      const start = block(page, 't21').locator('.lx-tl__block-start');
      await expect(start).toHaveText('10:00');
      await start.scrollIntoViewIfNeeded();
      const fits = await start.evaluate(el => {
        const r = el.getBoundingClientRect();
        const b = el.closest('.lx-tl__block')!.getBoundingClientRect();
        return (
          r.width > 20 &&
          r.left >= b.left &&
          r.right <= b.right + 0.5 &&
          r.top >= b.top - 0.5 &&
          r.bottom <= b.bottom + 0.5
        );
      });
      expect(fits, `short block start at step ${i}`).toBe(true);
      if (await zoomOut.isDisabled()) break;
      await zoomOut.click();
    }
  });

  test('with more than three venues, ‹ › step one venue at a time (phone in landscape)', async ({
    page,
  }) => {
    await page.setViewportSize({width: 844, height: 390});
    // Plaza del Cristo widened on this phone earlier: more to scroll.
    await page.addInitScript(k => {
      localStorage.setItem(k, JSON.stringify({v1: {width: 400}}));
    }, PREFS_KEY);
    await mockApi(page, fiveVenueData());
    await signIn(page);
    await goToAddress(page, lxUrl(`calendario/${DAY}`));
    await expect(page.locator('#lx-timeline')).toBeVisible();
    const prev = page.locator('#lx-tl-prev');
    const next = page.locator('#lx-tl-next');
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    await expect(next).toHaveAccessibleName('Ver el lugar siguiente');

    const scroller = page.locator('.lx-tl__scroller');
    const left = () => scroller.evaluate(el => el.scrollLeft);
    const second = await head(page, PLAZA_ADELANTADO.id).evaluate(el => {
      const s = el.closest('.lx-tl__scroller')!;
      const gutter =
        s.querySelector<HTMLElement>('.lx-tl__corner')!.offsetWidth;
      return (
        el.getBoundingClientRect().left -
        s.getBoundingClientRect().left +
        s.scrollLeft -
        gutter
      );
    });
    // One venue: the second column now starts beside the hours.
    await next.click();
    await expect
      .poll(async () => Math.abs((await left()) - second))
      .toBeLessThan(2);
    await expect(prev).toBeEnabled();

    for (let i = 0; i < 6 && (await next.isEnabled()); i++) {
      await next.click();
      await page.waitForTimeout(400);
    }
    await expect(next).toBeDisabled();
    expect(await left()).toBe(
      await scroller.evaluate(el => el.scrollWidth - el.clientWidth),
    );
    // At the end, the last venue is whole, left of «›».
    const lastRight = (await head(page, 'none').boundingBox())!;
    const arrow = (await page.locator('.lx-tl__arrow--next').boundingBox())!;
    expect(lastRight.x + lastRight.width).toBeLessThanOrEqual(arrow.x + 1);
    await prev.click();
    await expect(next).toBeEnabled();

    // Free horizontal scrolling still works.
    await scroller.evaluate(el => el.scrollTo({left: 0}));
    await expect(prev).toBeDisabled();
    await scroller.evaluate(el => el.scrollBy({left: 60}));
    await expect.poll(left).toBeGreaterThan(0);
  });

  test('two venues that fit show no arrows', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openDay(page);
    await expect(page.locator('#lx-tl-prev')).toHaveCount(0);
    await expect(page.locator('#lx-tl-next')).toHaveCount(0);
  });

  test('Tab into a venue header keeps the hour shown', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openDay(page);
    const scroller = page.locator('.lx-tl__scroller');
    await page.waitForTimeout(200);
    await scroller.evaluate(el => {
      el.scrollTop = 500;
    });
    await scroller.focus();
    await page.keyboard.press('Tab');
    await expect(head(page, ALMACEN.id).locator('.lx-tl__fold')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.locator(`[data-col-resize="${ALMACEN.id}"]`),
    ).toBeFocused();
    await page.waitForTimeout(100);
    expect(await scroller.evaluate(el => el.scrollTop)).toBe(500);
  });
});
