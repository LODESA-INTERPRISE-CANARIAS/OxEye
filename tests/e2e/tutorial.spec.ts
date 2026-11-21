import {expect, test} from '@playwright/test';

test.describe('Guided Tutorial from Wizard Step 2', () => {
  test('enables tutorial in Step 2, runs guided tour prior to everything else, supports pause/resume, and hands off to perimeter onboarding', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto('/');
    await page.click('#game-new');

    // Step 1: SMART goal
    await page.fill('#smart-specific', 'Evento cultural');
    await page.fill('#smart-metric', 'Asistentes');
    await page.fill('#smart-target', '800');
    await page.fill('#smart-feasible', 'Presupuesto aprobado');
    await page.fill('#smart-relevant', 'Vecindario');
    await page.fill('#smart-deadline', '2026-12-20');
    await page.click('#wizard-form button[type="submit"]');

    // Step 2: Check "Iniciar tutorial guiado al crear el proyecto"
    await expect(page.locator('#wizard-tutorial')).toBeVisible();
    await page.check('#wizard-tutorial');
    await page.click('#wizard-form button[type="submit"]');

    // Steps 3, 4, 5
    await page.click('#wizard-form button[type="submit"]');
    await page.click('#wizard-form button[type="submit"]');
    await expect(page.locator('#wizard-form')).toContainText('Activado');
    await page.click('#wizard-form button[type="submit"]');

    // Tutorial must start immediately BEFORE the perimeter banner
    await expect(page.locator('#tutorial-overlay')).toBeVisible();
    await expect(page.locator('#tour-coach')).toBeVisible();
    await expect(page.locator('#tour-spot')).toBeVisible();
    await expect(page.locator('#onboarding-perimeter-banner')).toBeHidden();

    // Pause & Resume
    await page.click('#tour-pause');
    await expect(page.locator('#tour-coach')).toContainText('Guía en pausa');
    await expect(page.locator('#tour-spot')).toBeHidden();
    await page.click('#tour-resume');
    await expect(page.locator('#tour-spot')).toBeVisible();

    // Walk through all 9 steps until "Terminar tutorial"
    for (let i = 0; i < 8; i++) {
      await page.click('#tour-next');
    }
    await expect(page.locator('#tour-next')).toContainText('Terminar tutorial');
    await page.click('#tour-next');

    // Tutorial closed -> now Step 1 perimeter onboarding banner appears
    await expect(page.locator('#tutorial-overlay')).toBeHidden();
    await expect(page.locator('#onboarding-perimeter-banner')).toBeVisible();
  });
});
