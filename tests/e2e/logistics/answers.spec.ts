import {expect, test, type Page} from '@playwright/test';
import {
  dailos,
  elvis,
  makeAnswer,
  mockApi,
  signIn,
  type MockApi,
} from './mock-api';
import {fixClock} from './plan-fixtures';
import {inventoryData} from './inventory-fixtures';

/**
 * Revisión 1 · E3: answers to open questions, inside the note's sheet. Any
 * member answers; a current answer is replaced only after looking at it (and
 * at who gave it); the asker closes the question, after which it is
 * read-only and everyone sees who closed it; guests see that there is an
 * answer, never its text. Server refusals (409, QUESTION_CLOSED,
 * ONLY_THE_ASKER) read as plain Spanish.
 *
 * n2 is Elvis's open question about «Almacén Prueba Norte».
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const A1 = '0d3c7f5e-1a2b-4c3d-8e9f-a1b2c3d4e5f6';
const A2 = '7a1e2b3c-4d5e-4f60-9a7b-c8d9e0f1a2b3';
const ANSWER_1 = 'TEXTO-RESPUESTA-1: la llave está en conserjería.';
const ANSWER_2 = 'TEXTO-RESPUESTA-2: abre Dailos a las 7:30.';

const sheet = (page: Page) => page.locator('#lx-note-sheet');
const panel = (page: Page) => page.locator('#lx-note-answer');
const answerPosts = (api: MockApi) =>
  api.calls('POST', /^\/notes\/n2\/answers$/).map(c => c.body as Json);

/** n2 with a current answer by Dailos. */
function answered(extra: Json = {}) {
  const data = inventoryData();
  const n2 = data.notes!.find(n => n.id === 'n2')!;
  n2.answer = makeAnswer(A1, 'n2', ANSWER_1, {
    answeredBy: dailos,
    answeredAt: '2026-12-02T09:45:00.000Z',
  });
  Object.assign(n2, extra);
  return data;
}

async function openQuestion(page: Page) {
  await page
    .locator('#lx-hoy-notes [data-note-id="n2"] .lx-noteitem__open')
    .click();
  await expect(panel(page)).toBeVisible();
}

test.describe('Gestor logístico · respuestas a preguntas abiertas', () => {
  test('any member answers; the question and its answer read together', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page, 'Dailos');
    await openQuestion(page);
    await expect(sheet(page)).toContainText('Sin responder');
    await expect(page.locator('#lx-note-asked')).toContainText(
      'Preguntó Elvis',
    );
    await expect(page.locator('#lx-note-answer-none')).toHaveText(
      'Aún sin respuesta.',
    );
    // Nobody answered yet: any member may still close it.
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveText(
      'Marcar como respondida',
    );

    // An empty answer is never sent.
    await page.locator('#lx-note-answer-send').click();
    await expect(panel(page)).toContainText('Escribe la respuesta');
    expect(answerPosts(api)).toEqual([]);

    await page.locator('#lx-note-answer-input').fill(ANSWER_1);
    await page.locator('#lx-note-answer-send').click();
    await expect(page.locator('#lx-note-answer-current')).toContainText(
      ANSWER_1,
    );
    await expect(page.locator('#lx-note-answer-by')).toContainText(
      'Respondió Dailos',
    );
    expect(answerPosts(api)).toEqual([{text: ANSWER_1, replaces: null}]);
    // The answer is waiting for Elvis, who asked.
    await expect(sheet(page)).toContainText('Con respuesta');
    await expect(page.locator('#lx-note-answer-ask')).toHaveText(
      'Elvis la dará por respondida cuando le sirva.',
    );
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveCount(0);
    // Toasts name the note, never the answer.
    const toast = page.locator('.lx-toast').filter({hasText: 'Respuesta'});
    await expect(toast).toContainText('Respuesta guardada');
    await expect(toast).not.toContainText('TEXTO-RESPUESTA');

    await page.keyboard.press('Escape');
    await expect(
      page.locator('#lx-hoy-notes [data-note-id="n2"] .lx-notestatus'),
    ).toHaveText('Con respuesta');
    expect(api.notes.find(n => n.id === 'n2')).toMatchObject({version: 2});
  });

  test('replacing asks first, shows who answered, and survives a 409', async ({
    page,
  }) => {
    const api = await mockApi(page, answered());
    await signIn(page, 'Yeray');
    await openQuestion(page);
    await expect(page.locator('#lx-note-answer-current')).toContainText(
      ANSWER_1,
    );
    await page.locator('#lx-note-answer-again').click();
    const input = page.locator('#lx-note-answer-input');
    await expect(input).toBeFocused();
    await input.fill('TEXTO-RESPUESTA-YERAY: la tiene el vigilante.');
    await page.locator('#lx-note-answer-send').click();

    // The current answer and its author, before anything is replaced.
    const confirm = page.locator('#lx-note-answer-confirm');
    await expect(confirm).toContainText('¿Sustituir la respuesta actual?');
    await expect(confirm).toContainText('La dio Dailos');
    await expect(confirm).toContainText(ANSWER_1);
    expect(answerPosts(api)).toEqual([]);

    // Meanwhile Elvis replaced it on the server.
    const n2 = api.notes.find(n => n.id === 'n2')!;
    const newer = makeAnswer(A2, 'n2', ANSWER_2, {
      answeredBy: elvis,
      answeredAt: '2026-12-02T10:20:00.000Z',
      replacesId: A1,
    });
    api.answers.push(newer);
    n2.answer = newer;
    n2.version = 3;

    await page.locator('#lx-note-answer-replace').click();
    await expect(page.locator('#lx-note-answer-notice')).toContainText(
      'La respuesta ha cambiado mientras escribías',
    );
    // The confirmation now shows Elvis's answer; the text typed is kept.
    await expect(confirm).toContainText('La dio Elvis');
    await expect(confirm).toContainText(ANSWER_2);
    await expect(input).toHaveValue(
      'TEXTO-RESPUESTA-YERAY: la tiene el vigilante.',
    );
    await page.locator('#lx-note-answer-replace').click();
    await expect(page.locator('#lx-note-answer-current')).toContainText(
      'TEXTO-RESPUESTA-YERAY',
    );
    expect(answerPosts(api)).toEqual([
      {text: 'TEXTO-RESPUESTA-YERAY: la tiene el vigilante.', replaces: A1},
      {text: 'TEXTO-RESPUESTA-YERAY: la tiene el vigilante.', replaces: A2},
    ]);

    // Earlier answers, loaded when opened, newest first.
    await page.locator('#lx-note-answers-toggle').click();
    const earlier = page.locator('#lx-note-answers-earlier [data-answer-id]');
    await expect(earlier).toHaveCount(2);
    await expect(earlier.nth(0)).toContainText(ANSWER_2);
    await expect(earlier.nth(0)).toContainText('Elvis');
    await expect(earlier.nth(1)).toContainText(ANSWER_1);
  });

  test('the asker closes it; then it is read-only and says who closed it', async ({
    page,
  }) => {
    const api = await mockApi(page, answered());
    await signIn(page, 'Elvis');
    // Hoy reminds the asker.
    await expect(page.locator('#lx-hoy-notes-answered')).toHaveText(
      'Una pregunta tuya tiene respuesta: ábrela para darla por respondida.',
    );
    await openQuestion(page);
    await expect(page.locator('#lx-note-answer-ask')).toContainText(
      '¿Te sirve esta respuesta?',
    );
    const toggle = page.locator('#lx-note-toggle-resolved');
    await expect(toggle).toHaveText('Dar por respondida');
    await toggle.click();
    await expect(page.locator('#lx-note-answer-closed')).toContainText(
      'Dada por respondida por Elvis',
    );
    expect(api.calls('PATCH', '/notes/n2').map(c => c.body)).toEqual([
      {version: 1, resolved: true},
    ]);
    await expect(sheet(page)).toContainText('Respondida');
    await expect(page.locator('#lx-note-answer-compose')).toHaveCount(0);
    await expect(page.locator('#lx-note-answer-again')).toHaveCount(0);
    await expect(toggle).toHaveText('Reabrir pregunta');
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-hoy-notes-answered')).toHaveCount(0);
  });

  test('others see it closed, by whom, and cannot reopen it', async ({
    page,
  }) => {
    await mockApi(
      page,
      answered({
        resolved: true,
        resolvedBy: elvis,
        resolvedAt: '2026-12-02T10:00:00.000Z',
        updatedAt: '2026-12-02T10:00:00.000Z',
      }),
    );
    await signIn(page, 'Dailos');
    await page.locator('#lx-nav-inventarios').click();
    await page.locator('[data-warehouse-id="w1"] .lx-whgroup__open').click();
    await page
      .locator('#lx-warehouse-notelist [data-note-id="n2"] .lx-noteitem__open')
      .click();
    await expect(page.locator('#lx-note-answer-closed')).toContainText(
      'Dada por respondida por Elvis',
    );
    await expect(page.locator('#lx-note-answer-closed')).toContainText(
      'Solo Elvis puede reabrirla.',
    );
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveCount(0);
    await expect(page.locator('#lx-note-answer-compose')).toHaveCount(0);
  });

  test('a stale sheet: ONLY_THE_ASKER and QUESTION_CLOSED read plainly', async ({
    page,
  }) => {
    const api = await mockApi(page, inventoryData());
    await signIn(page, 'Dailos');
    await openQuestion(page);
    await page.locator('#lx-note-answer-input').fill('TEXTO-RESPUESTA-TARDE');

    // Someone answered meanwhile: Dailos may no longer close it.
    const n2 = api.notes.find(n => n.id === 'n2')!;
    const theirs = makeAnswer(A1, 'n2', ANSWER_1, {answeredBy: elvis});
    api.answers.push(theirs);
    n2.answer = theirs;
    await page.locator('#lx-note-toggle-resolved').click();
    await expect(page.locator('#lx-note-answer-notice')).toContainText(
      'Solo quien hizo la pregunta puede darla por respondida',
    );
    // The sheet catches up with that answer; the text typed stays.
    await expect(page.locator('#lx-note-answer-current')).toContainText(
      ANSWER_1,
    );
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveCount(0);
    await expect(page.locator('#lx-note-answer-input')).toHaveValue(
      'TEXTO-RESPUESTA-TARDE',
    );

    // And then Elvis closed it: the answer is refused, the text is kept.
    n2.resolved = true;
    n2.resolvedBy = elvis;
    n2.resolvedAt = '2026-12-02T10:25:00.000Z';
    await page.locator('#lx-note-answer-send').click();
    await expect(page.locator('#lx-note-answer-confirm')).toContainText(
      'La dio Elvis',
    );
    await page.locator('#lx-note-answer-replace').click();
    await expect(page.locator('#lx-note-answer-notice')).toContainText(
      'Esta pregunta ya está dada por respondida',
    );
    await expect(page.locator('#lx-note-answer-closed')).toContainText(
      'Dada por respondida por Elvis',
    );
    await expect(page.locator('#lx-note-answer-lost')).toContainText(
      'TEXTO-RESPUESTA-TARDE',
    );
    expect(api.answers.map(a => a.text)).toEqual([ANSWER_1]);
  });

  test('guests see that there is an answer and who gave it, never its text', async ({
    page,
  }) => {
    const data = answered();
    data.answers = [
      makeAnswer(
        '9b8c7d6e-5f4a-4b3c-9d2e-1f0a9b8c7d6e',
        'n2',
        'TEXTO-RESPUESTA-0',
        {
          answeredBy: elvis,
        },
      ),
    ];
    data.notes!.find(n => n.id === 'n2')!.answer = makeAnswer(
      A1,
      'n2',
      ANSWER_1,
      {answeredBy: dailos, replacesId: '9b8c7d6e-5f4a-4b3c-9d2e-1f0a9b8c7d6e'},
    );
    await mockApi(page, data);
    await signIn(page, 'Invitado');
    await openQuestion(page);
    const current = page.locator('#lx-note-answer-current');
    await expect(current).toContainText('Visible para el equipo');
    await expect(page.locator('#lx-note-answer-by')).toContainText(
      'Respondió Dailos',
    );
    await expect(sheet(page)).toContainText('Con respuesta');
    await expect(page.locator('#lx-note-answer-compose')).toHaveCount(0);
    await expect(page.locator('#lx-note-toggle-resolved')).toHaveCount(0);
    await page.locator('#lx-note-answers-toggle').click();
    await expect(
      page.locator('#lx-note-answers-earlier [data-answer-id]'),
    ).toHaveCount(1);
    const html = await page.content();
    expect(html).not.toContain('TEXTO-RESPUESTA');
  });
});
