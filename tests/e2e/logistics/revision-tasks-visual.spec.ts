import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn} from './mock-api';
import {fixClock, planData} from './plan-fixtures';
import {decisionsData} from './decisions-fixtures';

/**
 * Screenshots of the Revisión 1 · E2/E3 screens for the UI review (no
 * behavioural assertions: those live in tasks-space.spec.ts,
 * organization.spec.ts and day-close-decisions.spec.ts): «Tareas», the
 * «Organización» sheet and the day-close decisions.
 * Output: test-results/visual/logistics-r1t-<screen>-<palette>.png
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

async function capture(page: Page, screen: string, fullPage = false) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const id of PALETTES) {
    await page.evaluate(p => {
      document.documentElement.dataset.palette = p;
    }, id);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/logistics-r1t-${screen}-${id}.png`,
      fullPage,
    });
  }
}

test.describe('Revisión 1 · Tareas, Organización, decisiones del cierre', () => {
  test('Tareas · desktop list and chain', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, planData());
    await signIn(page, 'Elvis', '#logistica/tareas');
    await expect(
      page.locator('#lx-tasks-list [data-task-id]').first(),
    ).toBeVisible();
    await capture(page, 'tasks-list-desktop');
    await page
      .locator('#lx-tasks-list [data-task-id="t2"] .lx-tlrow__chain')
      .click();
    await expect(page.locator('#lx-tasks-chain')).toBeVisible();
    await capture(page, 'tasks-chain-desktop');
  });

  test('Tareas · desktop grouped by venue', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, planData());
    await signIn(page, 'Elvis', '#logistica/tareas');
    await page.locator('#lx-tasks-view-venue').click();
    await expect(page.locator('[data-group="v1"]')).toBeVisible();
    await capture(page, 'tasks-grouped-desktop');
  });

  test('Tareas · phone', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, planData());
    await signIn(page, 'Elvis', '#logistica/tareas');
    await expect(
      page.locator('#lx-tasks-list [data-task-id]').first(),
    ).toBeVisible();
    await capture(page, 'tasks-phone');
    await page.locator('#lx-tasks-filters-toggle').click();
    await expect(page.locator('#lx-tasks-filters')).toBeVisible();
    await capture(page, 'tasks-filters-phone');
  });

  test('Tareas · empty', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, {...planData(), tasks: []});
    await signIn(page, 'Elvis', '#logistica/tareas');
    await expect(page.locator('#lx-tasks-empty')).toBeVisible();
    await capture(page, 'tasks-empty-desktop');
  });

  test('Organización · view and edit', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page);
    await signIn(page);
    await page.locator('#lx-org-select').click();
    await expect(page.locator('#lx-org-sheet')).toBeVisible();
    await capture(page, 'org-sheet');
    await page.locator('#lx-org-edit').click();
    await page.locator('#lx-org-acronym').fill('SCLL');
    await capture(page, 'org-sheet-edit');
  });

  test('Cierre · decisions and answered question', async ({page}) => {
    await page.setViewportSize(DESKTOP);
    await mockApi(page, decisionsData());
    await signIn(page, 'Elvis', '#logistica/cierre');
    await page.locator('#lx-day-include-decision').check();
    await page.locator('#lx-day-include-open_question').check();
    await page.locator('#lx-day-notes-decision').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-acceptance-id="ca1"]')).toBeVisible();
    await capture(page, 'day-decisions-desktop');
    await page.locator('#lx-day-notes-open_question').scrollIntoViewIfNeeded();
    await capture(page, 'day-question-desktop');
  });

  test('Cierre · guest decisions', async ({page}) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, decisionsData());
    await signIn(page, 'Invitado', '#logistica/cierre');
    await page.locator('#lx-day-accepted').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-acceptance-id="ca1"]')).toBeVisible();
    await capture(page, 'day-decisions-guest-phone');
  });
});
