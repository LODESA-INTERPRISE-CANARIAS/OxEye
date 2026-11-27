import {expect, test, type Page} from '@playwright/test';
import {addDays, mockApi, signIn, type MockApi} from './mock-api';
import {DAY, fixClock, planData} from './plan-fixtures';
import {expectValue} from './controls';

/**
 * The Gestor's own time, date and select controls in the task form: typed
 * text, the pickers with keyboard and pointer, Escape inside a sheet, and
 * screenshots open and closed on phone and desktop
 * (test-results/visual/logistics-controls-<state>-<viewport>-<palette>.png).
 */

const DESKTOP = {width: 1440, height: 1000};
const PHONE = {width: 390, height: 844};
const OUT = 'test-results/visual';

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const sheet = (page: Page) => page.locator('#lx-task-sheet');
const toggle = (page: Page, id: string) =>
  page.locator(`button[aria-controls^="${id}-picker"]`);
const panel = (page: Page, id: string) => page.locator(`[id^="${id}-picker"]`);

async function openAddTask(page: Page, phone = false) {
  await page.locator(phone ? '#lx-fab' : '#lx-add').click();
  await page.locator(phone ? '#lx-fab-task' : '#lx-add-task').click();
  await expect(page.locator('#lx-task-form')).toBeVisible();
  await expect(page.locator('#lx-task-title')).toBeFocused();
}

function postBody(api: MockApi): Record<string, unknown> {
  return api.calls('POST', '/tasks')[0].body as Record<string, unknown>;
}

test.describe('Gestor logístico · controles propios', () => {
  // Long flows; other suites often run at the same time.
  test.describe.configure({timeout: 60_000});

  test('time: typed the way people write it, ↑/↓ by 5 min, unreadable text reverts', async ({
    page,
  }) => {
    const api = await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    await page.locator('#lx-task-title').fill('Prueba de horas');

    const start = page.locator('#lx-task-start');
    await start.fill('930');
    await start.press('Tab');
    await expect(start).toHaveValue('09:30');
    await start.focus();
    await start.press('ArrowUp');
    await expect(start).toHaveValue('09:35');
    await start.press('ArrowDown');
    await start.press('ArrowDown');
    await expect(start).toHaveValue('09:25');

    const end = page.locator('#lx-task-end');
    await end.fill('21h');
    await end.press('Tab');
    await expect(end).toHaveValue('21:00');
    await end.fill('25:00');
    await end.press('Tab');
    await expect(end).toHaveValue('21:00');
    await expect(page.locator('#lx-task-end-note')).toContainText(
      'No he entendido «25:00»: se mantiene 21:00',
    );
    await expect(end).toHaveAttribute('aria-invalid', 'true');

    await page.locator('#lx-task-save').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(postBody(api)).toMatchObject({
      date: DAY,
      startTime: '09:25',
      endTime: '21:00',
    });
  });

  test('time picker: hour then minutes, «+1 h» after the start, Escape keeps the sheet', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);

    await toggle(page, 'lx-task-start').click();
    const picker = panel(page, 'lx-task-start');
    await expect(picker).toBeVisible();
    // Opens on the current hour (10:30 in Canarias).
    await expect(picker.locator('[data-cell="10"]').first()).toBeFocused();
    await picker.locator('[data-cell="18"]').click();
    await expect(page.locator('#lx-task-start')).toHaveValue('18:00');
    await expect(picker.locator('[data-cell="00"]').last()).toBeFocused();
    await picker.locator('[data-cell="30"]').click();
    await expect(picker).toBeHidden();
    await expect(page.locator('#lx-task-start')).toHaveValue('18:30');
    await expect(toggle(page, 'lx-task-start')).toBeFocused();

    // End: the quick chips follow the start.
    await toggle(page, 'lx-task-end').click();
    const endPicker = panel(page, 'lx-task-end');
    await endPicker.getByRole('button', {name: '+2 h 20:30'}).click();
    await expect(page.locator('#lx-task-end')).toHaveValue('20:30');

    // Keyboard: arrows inside the hours grid, Escape closes only the panel.
    await toggle(page, 'lx-task-end').press('Enter');
    await expect(endPicker).toBeVisible();
    await expect(endPicker.locator('[data-cell="20"]').first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(endPicker.locator('[data-cell="21"]').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(endPicker.locator('[data-cell="21"]').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(endPicker).toBeHidden();
    await expect(sheet(page)).toBeVisible();
    await expect(toggle(page, 'lx-task-end')).toBeFocused();
    await expect(page.locator('#lx-task-end')).toHaveValue('20:30');

    // A tap outside closes it too.
    await toggle(page, 'lx-task-end').click();
    await expect(endPicker).toBeVisible();
    await page.locator('#lx-task-title').click();
    await expect(endPicker).toBeHidden();
    await expect(sheet(page)).toBeVisible();
  });

  test('date: «mañana», Spanish order, a calendar with Monday first and keys', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    const date = page.locator('#lx-task-date');
    await expect(date).toHaveValue('02/12/2026');

    await date.fill('mañana');
    await date.press('Tab');
    await expect(date).toHaveValue('03/12/2026');
    await expectValue(page, 'lx-task-date', addDays(DAY, 1));
    await expect(page.locator('.lx-ctl__weekday')).toContainText('jue');

    await date.fill('5/1');
    await date.press('Tab');
    await expectValue(page, 'lx-task-date', '2027-01-05');

    await toggle(page, 'lx-task-date').click();
    const cal = panel(page, 'lx-task-date');
    await expect(cal.locator('.lx-dp__title')).toHaveText('Enero 2027');
    await expect(cal.locator('th').first()).toHaveAttribute('abbr', 'lunes');
    const focused = cal.locator('[data-date="2027-01-05"]');
    await expect(focused).toBeFocused();
    await expect(focused).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('PageUp');
    await expect(cal.locator('.lx-dp__title')).toHaveText('Diciembre 2026');
    await expect(cal.locator('[data-date="2026-12-05"]')).toBeFocused();
    // Today is marked.
    await expect(cal.locator('[data-date="2026-12-02"]')).toHaveAttribute(
      'aria-current',
      'date',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(cal).toBeHidden();
    await expectValue(page, 'lx-task-date', '2026-11-27');
    await expect(date).toHaveValue('27/11/2026');

    // «Sin fecha» leaves it unknown.
    await toggle(page, 'lx-task-date').click();
    await page.locator('#lx-task-date-clear').click();
    await expect(date).toHaveValue('');
  });

  test('select: list with groups, keyboard and type-ahead; Escape keeps the sheet', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    await openAddTask(page);
    const event = page.locator('#lx-task-event');
    await expect(event).toHaveAttribute('role', 'combobox');
    await expect(event).toHaveText('Sin evento (tarea suelta)');

    await event.focus();
    await page.keyboard.press('ArrowDown');
    const list = page.locator('#lx-task-event-listbox');
    await expect(list).toBeVisible();
    await expect(event).toHaveAttribute('aria-expanded', 'true');
    const active = await event.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    await expect(page.locator(`#${active}`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    await expect(event).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(list).toHaveCount(0);
    await expect(event).not.toHaveAttribute('data-value', '');
    await expect(event).toBeFocused();
  });
});

test.describe('Gestor logístico · controles propios · capturas', () => {
  test.describe.configure({timeout: 120_000});

  for (const [vp, size] of [
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ] as const) {
    test(`task form with the controls open and closed (${vp})`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({reducedMotion: 'reduce'});
      await mockApi(page, planData());
      await signIn(page);
      await openAddTask(page, vp === 'phone');
      await page.locator('#lx-task-title').fill('Montaje de vallas');
      await page.locator('#lx-task-start').fill('930');
      await page.locator('#lx-task-start').press('Tab');
      await page.locator('#lx-task-date').scrollIntoViewIfNeeded();

      const shoot = async (state: string) => {
        for (const palette of ['oxeye', 'noctis', 'bendy']) {
          await page.evaluate(p => {
            document.documentElement.dataset.palette = p;
          }, palette);
          await page.waitForTimeout(150);
          await page.screenshot({
            path: `${OUT}/logistics-controls-${state}-${vp}-${palette}.png`,
          });
        }
      };

      await shoot('closed');
      await toggle(page, 'lx-task-end').click();
      await expect(panel(page, 'lx-task-end')).toBeVisible();
      await shoot('time');
      await page.keyboard.press('Escape');
      await toggle(page, 'lx-task-date').click();
      await expect(panel(page, 'lx-task-date')).toBeVisible();
      await shoot('date');
      await page.keyboard.press('Escape');
      await page.locator('#lx-task-event').scrollIntoViewIfNeeded();
      await page.locator('#lx-task-event').click();
      await expect(page.locator('#lx-task-event-listbox')).toBeVisible();
      await shoot('select');
      await page.keyboard.press('Escape');
    });
  }
});
