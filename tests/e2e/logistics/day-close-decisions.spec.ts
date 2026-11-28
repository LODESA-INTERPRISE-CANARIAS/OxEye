import {expect, test, type Page} from '@playwright/test';
import {lxUrl} from './address';
import {mockApi, signIn} from './mock-api';
import {fixClock} from './plan-fixtures';
import {trapOutgoing} from './directory-fixtures';
import {DAY_NOTE_TEXT} from './day-close-fixtures';
import {
  ACCEPTED_REASON,
  ANSWER_TEXT,
  decisionsData,
} from './decisions-fixtures';

/**
 * Revisión 1 · E2/E3 in «Cierre de jornada»: a conflict kept with «Mantener
 * ambas» is a decision of the day (who, when; its reason only when a member
 * includes the decisions' text, never for guests), and an open question
 * shows whether it was answered and by whom. Fixed clock (10:30, 2 Dec).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
  await trapOutgoing(page);
});

const REASON = ACCEPTED_REASON;
const ANSWER = ANSWER_TEXT;

async function openClose(page: Page, name = 'Elvis') {
  await signIn(page, name, lxUrl('cierre'));
  await expect(page.locator('#lx-day-title')).toBeVisible();
}

const accepted = (page: Page) => page.locator('[data-acceptance-id="ca1"]');
const printCopy = (page: Page) => page.locator('body > .lx-day-root');

test.describe('Gestor logístico · cierre · decisiones y preguntas', () => {
  test('a kept conflict is a decision; its reason only when included', async ({
    page,
  }) => {
    await mockApi(page, decisionsData());
    await openClose(page);
    const group = page.locator('#lx-day-notes-decision');
    await expect(group.locator('#lx-day-accepted-title')).toBeVisible();
    await expect(accepted(page)).toContainText('Aceptado por Elvis');
    await expect(accepted(page)).toContainText(
      'Carga de tarimas Demo y Montaje de luces Demo',
    );
    await expect(accepted(page)).not.toContainText(REASON);
    await expect(printCopy(page)).not.toContainText(REASON);

    await page.locator('#lx-day-include-decision').check();
    await expect(accepted(page)).toContainText(REASON);
    await expect(printCopy(page)).toContainText(REASON);
    await expect(printCopy(page).locator('.lx-dayp__textnote')).toContainText(
      'Decisiones',
    );

    // Tapping it opens one of its tasks.
    await accepted(page).locator('.lx-dayline').click();
    await expect(page.locator('#lx-task-sheet')).toBeVisible();
  });

  test('an answered question says who answered; its text follows the rule', async ({
    page,
  }) => {
    await mockApi(page, decisionsData());
    await openClose(page);
    const questions = page.locator('#lx-day-notes-open_question');
    await expect(questions).toContainText('Con respuesta');
    await expect(questions.locator('.lx-daynote__trail')).toContainText(
      'Respondió Dailos',
    );
    await expect(questions).not.toContainText(ANSWER);
    await expect(questions).not.toContainText(DAY_NOTE_TEXT.question);

    await page.locator('#lx-day-include-open_question').check();
    await expect(questions).toContainText(DAY_NOTE_TEXT.question);
    await expect(questions.locator('.lx-daynote__answer')).toContainText(
      ANSWER,
    );
  });

  test('a guest sees the kept conflict, never its reason', async ({page}) => {
    await mockApi(page, decisionsData());
    await openClose(page, 'Invitado');
    const card = page.locator('#lx-day-accepted');
    await expect(card).toBeVisible();
    await expect(accepted(page)).toContainText('Aceptado por Elvis');
    await expect(accepted(page)).toContainText('Motivo visible para el equipo');
    const markup = await page.content();
    expect(markup).not.toContain(REASON);
    expect(markup).not.toContain(ANSWER);
  });
});
