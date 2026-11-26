import {expect, test, type Page} from '@playwright/test';
import {
  SUBSOIL_REVIEW_LABEL,
  SUBSOIL_REVIEW_NOTE,
} from '../../../shared/logistics/rules.ts';
import {dailos, mockApi, signIn, TOKEN, type MockApi} from './mock-api';
import {NOW, fixClock, planData, planTasks} from './plan-fixtures';
import {followData} from './followup-fixtures';

/**
 * Gestor logístico, milestone 5: «Subsuelo revisado en el simulador». A mark
 * a member declares on a heavy task (who and when), never a verdict: it takes
 * the subsoil reminder out of Hoy, it is withdrawn when the venue, the heavy
 * load or the material change, the guest only reads it, and no UI text around
 * it says «apto», «cumple», «certificado» or quotes a weight. The 500 kg/m²
 * review threshold stays in the reminder itself (hoy-plan.spec.ts).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const DECLARED = {by: dailos, at: '2026-12-02T08:45:00.000Z'};
const declaredPlan = () => ({
  ...planData(),
  tasks: planTasks().map(t =>
    t.id === 't1' ? {...t, subsoilReview: {...DECLARED}} : t,
  ),
});
const patches = (api: MockApi, id: string) =>
  api.calls('PATCH', `/tasks/${id}`).map(c => c.body as Json);
const heavyWarning = (page: Page) =>
  page.locator('#lx-warnings [data-warning="heavy_load"]');

async function openT1(page: Page) {
  await page.locator('#lx-today-tasks [data-task-id="t1"]').click();
  await expect(page.locator('#lx-task-sheet')).toBeVisible();
}

/** Words a declared mark must never carry (it is not a verdict). */
const VERDICT = /\bapto\b|\bapta\b|\bcumple|certificad|\d\s*kg/i;

test.describe('Gestor logístico · subsuelo revisado', () => {
  test('declaring it on a heavy task: who, when, and the reminder goes', async ({
    page,
  }) => {
    // The mark is stamped with the page's fixed «now».
    const api = await mockApi(page, {...planData(), now: NOW});
    await signIn(page);
    await expect(heavyWarning(page)).toBeVisible();
    await expect(page.locator('#lx-warnings .lx-count')).toHaveText('5');

    await openT1(page);
    const box = page.locator('#lx-task-subsoil-reviewed');
    const state = page.locator('#lx-task-subsoil-state');
    await expect(box).not.toBeChecked();
    await expect(state).toHaveText(
      'Márcalo cuando hayas revisado el subsuelo en el simulador.',
    );
    await box.check();
    await expect(state).toHaveText('Se declarará a tu nombre al guardar.');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, 't1')).toEqual([{version: 1, subsoilReviewed: true}]);
    expect(api.tasks.find(t => t.id === 't1')?.subsoilReview).toMatchObject({
      by: {displayName: 'Elvis'},
    });

    // Declared: no subsoil reminder for t1 in Hoy any more.
    await expect(heavyWarning(page)).toHaveCount(0);
    await expect(page.locator('#lx-warnings .lx-count')).toHaveText('4');

    await openT1(page);
    await expect(box).toBeChecked();
    await expect(state).toContainText('Declarado por Elvis');
    await expect(state).toContainText('10:30');
    // Saving again without touching it sends nothing about the mark.
    await page.locator('#lx-task-notes').fill('Prueba: revisado con Dailos');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, 't1')[1]).toEqual({
      version: 2,
      notes: 'Prueba: revisado con Dailos',
    });
  });

  test('a new venue: the box starts unticked, a hint says saving withdraws it', async ({
    page,
  }) => {
    const api = await mockApi(page, declaredPlan());
    await signIn(page);
    await expect(heavyWarning(page)).toHaveCount(0);
    await openT1(page);
    const box = page.locator('#lx-task-subsoil-reviewed');
    const state = page.locator('#lx-task-subsoil-state');
    await expect(box).toBeChecked();
    await expect(state).toContainText('Declarado por Dailos');

    await page.locator('#lx-task-venue').fill('Plaza del Adelantado');
    await expect(page.locator('#lx-task-subsoil')).toHaveClass(/is-stale/);
    await expect(box).not.toBeChecked();
    await expect(state).toContainText(
      'Has cambiado el lugar, la carga pesada o los recursos: al guardar se retirará la marca.',
    );
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    const body = patches(api, 't1')[0];
    expect(body).toMatchObject({version: 1, venueName: 'Plaza del Adelantado'});
    expect(body).not.toHaveProperty('subsoilReviewed');
    // The server withdrew it: the reminder is back.
    expect(api.tasks.find(t => t.id === 't1')?.subsoilReview).toBeNull();
    await expect(heavyWarning(page)).toBeVisible();
  });

  test('re-declaring for the new venue renews it to the current user', async ({
    page,
  }) => {
    const api = await mockApi(page, declaredPlan());
    await signIn(page);
    await openT1(page);
    await page.locator('#lx-task-venue').fill('Plaza del Adelantado');
    await page.locator('#lx-task-subsoil-reviewed').check();
    await expect(page.locator('#lx-task-subsoil-state')).toContainText(
      'Se volverá a declarar a tu nombre al guardar',
    );
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, 't1')[0]).toMatchObject({subsoilReviewed: true});
    expect(api.tasks.find(t => t.id === 't1')?.subsoilReview).toMatchObject({
      by: {displayName: 'Elvis'},
    });
  });

  test('«Carga pesada: No» hides the mark and never sends it', async ({
    page,
  }) => {
    const api = await mockApi(page, declaredPlan());
    await signIn(page);
    await openT1(page);
    await page.locator('#lx-task-heavy-no').click();
    await expect(page.locator('#lx-task-subsoil')).toHaveCount(0);
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    expect(patches(api, 't1')).toEqual([{version: 1, heavyLoad: false}]);
    expect(api.tasks.find(t => t.id === 't1')?.subsoilReview).toBeNull();
  });

  test('a supplier changing the quantity of the material withdraws it', async ({
    page,
  }) => {
    // h1 uses r1 (20 tarimas) and its review was declared by Dailos.
    const api = await mockApi(page, followData());
    await signIn(page);
    await expect(heavyWarning(page)).toHaveCount(0);
    await page.locator('#lx-nav-inventarios').click();
    await page.locator('#lx-inventory-tab-owned').click();
    await page.locator('[data-resource-id="r1"] .lx-resrow__main').click();
    await page.locator('#lx-resource-edit').click();
    await page.locator('#lx-resource-quantity').fill('24');
    await page.locator('#lx-resource-save').click();
    await expect.poll(() => api.calls('PATCH', '/resources/r1').length).toBe(1);
    expect(api.tasks.find(t => t.id === 'h1')?.subsoilReview).toBeNull();
    // Back in the resource's view (the save finished), then close it.
    await expect(page.locator('#lx-resource-edit')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-resource-sheet')).toHaveCount(0);
    await page.locator('#lx-nav-hoy').click();
    await expect(heavyWarning(page)).toContainText(
      'Montaje del escenario Demo',
    );
  });

  test('the guest reads the mark and cannot change it', async ({page}) => {
    await mockApi(page, declaredPlan());
    await signIn(page, 'Invitado');
    await openT1(page);
    const value = page.locator('#lx-task-subsoil-value');
    await expect(value).toContainText(SUBSOIL_REVIEW_LABEL);
    await expect(value).toContainText('Declarado por Dailos');
    await expect(page.locator('#lx-task-subsoil-reviewed')).toHaveCount(0);
    await expect(page.locator('#lx-task-form')).toHaveCount(0);
  });

  test('without a declaration the guest sees that nobody declared it', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page, 'Invitado');
    await openT1(page);
    await expect(page.locator('#lx-task-subsoil-value')).toHaveText(
      'Nadie ha declarado la revisión del subsuelo en el simulador',
    );
  });

  test('no verdict and no weight in anything the mark says', async ({page}) => {
    await mockApi(page, declaredPlan());
    await signIn(page);
    // The shared wording itself.
    expect(SUBSOIL_REVIEW_LABEL).not.toMatch(VERDICT);
    expect(SUBSOIL_REVIEW_NOTE).not.toMatch(VERDICT);
    expect(SUBSOIL_REVIEW_NOTE).toContain('no certifica');

    await openT1(page);
    const field = page.locator('#lx-task-subsoil');
    // textContent includes the closed help tip.
    const all = (await field.evaluate(el => el.textContent)) ?? '';
    expect(all).not.toMatch(VERDICT);
    await page.locator('#lx-task-venue').fill('Plaza del Adelantado');
    expect((await field.evaluate(el => el.textContent)) ?? '').not.toMatch(
      VERDICT,
    );
    await page.keyboard.press('Escape');
    await page.locator('#lx-task-discard-confirm').click();

    await page.unrouteAll({behavior: 'ignoreErrors'});
    await mockApi(page, declaredPlan());
    await page.locator('#lx-logout').click();
    await signIn(page, 'Invitado');
    await openT1(page);
    const value =
      (await page
        .locator('#lx-task-subsoil-value')
        .evaluate(el => el.textContent)) ?? '';
    expect(value).not.toMatch(VERDICT);
  });

  test('the mock is strict like the server: no mark without heavy load', async ({
    page,
  }) => {
    await mockApi(page, planData());
    await signIn(page);
    // t2 has «Carga pesada: No».
    const res = await page.evaluate(async token => {
      const r = await fetch('/api/tasks/t2', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({version: 1, subsoilReviewed: false}),
      });
      return {status: r.status, body: await r.json()};
    }, TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.fields.subsoilReviewed).toBe(
      'Solo se puede declarar en una tarea con carga pesada.',
    );
  });
});
