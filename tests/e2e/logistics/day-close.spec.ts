import {expect, test, type Page} from '@playwright/test';
import {
  HYPOTHESIS_APPLIED_TITLE,
  HYPOTHESIS_OPEN_TITLE,
} from '../../../shared/logistics/day-report.ts';
import {
  INCIDENT_SCOPE_NOTE,
  NOTE_PRIVACY_HINT,
} from '../../../shared/logistics/rules.ts';
import {mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {copied, trapOutgoing} from './directory-fixtures';
import {ORDER_PRIVATE} from './followup-fixtures';
import {DAY_NOTE_TEXT, dayCloseData} from './day-close-fixtures';

/**
 * Gestor logístico, milestone 6: «Cierre de jornada». Fixed clock (10:30 on
 * Wednesday 2 December 2026, La Laguna) and the day of day-close-fixtures.ts.
 * Notes appear by label and status; their text only when a member ticks a
 * section (incidents ask first) and never in «Copiar resumen». Hypotheses
 * apart and always called «Hipótesis». Subsoil reviews are «declarada»,
 * never «verificada»; the threshold is quoted once. Guests get no notes and
 * no hypotheses at all.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
  await trapOutgoing(page);
});

const TODAY_TITLE = /2 de diciembre de 2026/;
const YESTERDAY_TITLE = /1 de diciembre de 2026/;
const NOTE_TEXTS = Object.values(DAY_NOTE_TEXT);
/** Free text a report never carries for anyone (M5 markers). */
const PRIVATE = Object.values(ORDER_PRIVATE);

async function openClose(
  page: Page,
  name = 'Elvis',
  hash = '#logistica/cierre',
): Promise<void> {
  await signIn(page, name, hash);
  await expect(page.locator('#lx-day-title')).toBeVisible();
  await expect(
    page.locator('#lx-day-summary .lx-daysum__tile'),
  ).not.toHaveCount(0);
}

const tile = (page: Page, label: string) =>
  page.locator('#lx-day-summary .lx-daysum__tile').filter({
    has: page.locator('.lx-daysum__tilehead', {
      hasText: new RegExp(`^${label}$`),
    }),
  });

async function expectTile(
  page: Page,
  label: string,
  total: number,
  detail: string,
) {
  const t = tile(page, label);
  await expect(t.locator('.lx-daysum__fig')).toHaveText(String(total));
  await expect(t.locator('.lx-daysum__detail')).toHaveText(detail);
}

const lineNames = (page: Page, scope: string) =>
  page.locator(`${scope} .lx-dayline__name`).allTextContents();

/** Markup of the screen and of the print copy portalled to <body>. */
const reportMarkup = (page: Page) =>
  page.evaluate(
    () =>
      (document.querySelector('#lx-space-cierre')?.outerHTML ?? '') +
      (document.querySelector('body > .lx-day-root')?.outerHTML ?? ''),
  );

const countIn = (text: string, needle: string) => text.split(needle).length - 1;

/** `from`/`to` of the day-close activity requests, in order. */
const ranges = (api: MockApi) =>
  api.requests
    .filter(r => r.method === 'GET' && r.path.endsWith('/activity'))
    .map(r => new URLSearchParams(r.query))
    .filter(q => q.has('from'))
    .map(q => ({from: q.get('from'), to: q.get('to')}));

test.describe('Gestor logístico · Cierre de jornada (miembro)', () => {
  let api: MockApi;
  test.beforeEach(async ({page}) => {
    api = await mockApi(page, dayCloseData());
  });

  test('the sidebar opens today’s close; counts, people and pending share', async ({
    page,
  }) => {
    await signIn(page);
    await page.locator('#lx-nav-cierre').click();
    await expect(page).toHaveURL(/#logistica\/cierre$/);
    await expect(page.locator('#lx-day-title')).toHaveText(TODAY_TITLE);
    await expect(page.locator('.lx-dayhead__sub')).toContainText(
      'Hoy · hasta las 10:30',
    );
    await expect(page.locator('#lx-day-next-day')).toBeDisabled();
    await expect(page.locator('#lx-day-today')).toHaveCount(0);
    await expect(page.locator('#lx-day-offline')).toHaveCount(0);

    // One range request for the local day.
    expect(ranges(api)[0]).toEqual({
      from: '2026-12-02T00:00:00.000Z',
      to: '2026-12-03T00:00:00.000Z',
    });

    await expectTile(page, 'Eventos', 1, '1 con cambios');
    await expectTile(page, 'Tareas', 2, '2 con cambios · 1 borrado');
    await expectTile(page, 'Personas', 1, '1 nuevo');
    await expectTile(page, 'Empresas y entidades', 0, 'Sin cambios');
    await expectTile(page, 'Recursos', 1, '1 nuevo');
    await expectTile(page, 'Ofertas', 1, '1 nuevo');
    await expectTile(page, 'Almacenes', 0, 'Sin cambios');
    await expectTile(page, 'Notas', 4, '4 nuevos');

    // The day before (23:00 on 1 Dec) is not counted.
    expect(await page.locator('.lx-daysum__name').allTextContents()).toEqual([
      'Elvis',
      'Dailos',
      'Yeray',
    ]);
    expect(await page.locator('.lx-daysum__changes').allTextContents()).toEqual(
      ['6 cambios', '3 cambios', '2 cambios'],
    );

    // 23 records, 2 validated: 91 % still to verify.
    const gauge = page.locator('#lx-day-summary .lx-gauge');
    await expect(gauge).toHaveAttribute(
      'aria-label',
      '91 % de la información registrada pendiente de verificar',
    );
    await expect(gauge.locator('.lx-gauge__figure')).toHaveText('91 %');
    await expect(page.locator('.lx-daysum__pendingnote')).toContainText(
      '21 por verificar de 23 registros',
    );
  });

  test('records of the day by section, and what is still needed', async ({
    page,
  }) => {
    await openClose(page);
    expect(await lineNames(page, '#lx-day-records-events')).toEqual([
      'Navidad en la Plaza del Cristo',
    ]);
    expect(await lineNames(page, '#lx-day-records-tasks')).toEqual([
      'Montaje del escenario Demo',
      'Recogida de material Demo',
    ]);
    await expect(page.locator('#lx-day-records-tasks')).toContainText(
      'Cambios · Dailos · 10:05',
    );
    expect(await lineNames(page, '#lx-day-records-contacts')).toEqual([
      'Carla Demo',
    ]);
    await expect(page.locator('#lx-day-records-contacts')).toContainText(
      'Nuevo · Elvis · 09:10',
    );
    expect(await lineNames(page, '#lx-day-records-resources')).toEqual([
      'Conos Demo',
    ]);
    await expect(page.locator('#lx-day-records-resources')).toContainText(
      'Nuevo · Yeray · 09:30',
    );
    expect(await lineNames(page, '#lx-day-records-offers')).toEqual([
      'Vallas Demo por día',
    ]);
    await expect(page.locator('#lx-day-records-none')).toHaveText(
      'Sin novedades en empresas y entidades y almacenes.',
    );
    // A deleted record is counted, never listed.
    await expect(page.locator('#lx-day-records')).not.toContainText(
      'Tarea borrada Demo',
    );
    // «Qué seguimos necesitando»: events and tasks first.
    const needs = page.locator('#lx-day-needs .lx-missing__name');
    await expect(needs.first()).toBeVisible();
    expect(await needs.first().textContent()).not.toBe('Conos Demo');

    // A line opens its record.
    await page
      .locator('#lx-day-records-contacts .lx-dayline', {hasText: 'Carla Demo'})
      .click();
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    await expect(page.locator('#lx-contact-sheet')).toContainText('Carla Demo');
  });

  test('notes by label and status, never their text by default', async ({
    page,
  }) => {
    await openClose(page);
    expect(await lineNames(page, '#lx-day-notes-incident')).toEqual([
      'Incidencia · Tarima Demo',
      'Incidencia · Entrega de vallas Demo',
    ]);
    const incidents = page.locator('#lx-day-notes-incident .lx-daynote');
    await expect(incidents.nth(0)).toContainText('Dailos · 09:40');
    await expect(incidents.nth(0)).toContainText('Abierta');
    await expect(incidents.nth(1)).toContainText('De días anteriores');
    await expect(incidents.nth(1)).toContainText('sigue pendiente');
    expect(await lineNames(page, '#lx-day-notes-decision')).toEqual([
      'Decisión · Entrega de vallas Demo',
    ]);
    expect(await lineNames(page, '#lx-day-notes-open_question')).toEqual([
      'Pregunta abierta · Navidad en la Plaza del Cristo',
    ]);
    await expect(page.locator('#lx-day-notes-open_question')).toContainText(
      'Sin respuesta',
    );
    await expect(page.locator('#lx-day-notes-none')).toContainText(
      'Sin ideas para la herramienta este día.',
    );
    // The plain note is counted, not listed.
    await expect(page.locator('#lx-day-notes-other')).toHaveText(
      'Además, 1 nota del día, que no se lista aquí.',
    );
    // Every toggle starts off and carries the privacy hint.
    for (const kind of ['incident', 'decision', 'open_question']) {
      await expect(page.locator(`#lx-day-include-${kind}`)).not.toBeChecked();
    }
    await expect(page.locator('#lx-day-include-decision-hint')).toContainText(
      NOTE_PRIVACY_HINT,
    );
    await expect(page.locator('.lx-daynote__text')).toHaveCount(0);
    const markup = await reportMarkup(page);
    for (const text of [...NOTE_TEXTS, ...PRIVATE]) {
      expect(markup, text).not.toContain(text);
    }
  });

  test('«Incluir el texto» on decisions shows only the decision text', async ({
    page,
  }) => {
    await openClose(page);
    await page.locator('#lx-day-include-decision').check();
    await expect(page.locator('#lx-day-include-decision')).toBeChecked();
    await expect(
      page.locator('#lx-day-notes-decision .lx-daynote__text'),
    ).toHaveText(DAY_NOTE_TEXT.decision);
    await expect(page.locator('.lx-daynote__text')).toHaveCount(1);
    // The print copy carries it too, and says so on the page.
    const copy = page.locator('body > .lx-day-root');
    await expect(copy).toContainText(DAY_NOTE_TEXT.decision);
    await expect(copy.locator('.lx-dayp__textnote')).toContainText(
      'Incluye el texto de: Decisiones.',
    );
    const markup = await reportMarkup(page);
    for (const text of [
      DAY_NOTE_TEXT.incident,
      DAY_NOTE_TEXT.incidentEarlier,
      DAY_NOTE_TEXT.question,
      DAY_NOTE_TEXT.plain,
      ...PRIVATE,
    ]) {
      expect(markup, text).not.toContain(text);
    }
    // Unticking takes it out again.
    await page.locator('#lx-day-include-decision').uncheck();
    await expect(page.locator('.lx-daynote__text')).toHaveCount(0);
    await expect(copy).not.toContainText(DAY_NOTE_TEXT.decision);
  });

  test('incident text asks first, with the scope and privacy notes', async ({
    page,
  }) => {
    await openClose(page);
    const toggle = page.locator('#lx-day-include-incident');
    await toggle.click();
    const confirm = page.locator('#lx-day-incident-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(INCIDENT_SCOPE_NOTE);
    await expect(confirm).toContainText(NOTE_PRIVACY_HINT);
    await expect(confirm).toContainText(
      'El PDF y la copia impresa los puede leer cualquiera que los reciba',
    );
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('.lx-daynote__text')).toHaveCount(0);
    await expect(page.locator('#lx-day-incident-confirm-yes')).toBeFocused();

    // «No incluir» leaves everything as it was.
    await page.locator('#lx-day-incident-confirm-no').click();
    await expect(confirm).toHaveCount(0);
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeFocused();
    await expect(page.locator('.lx-daynote__text')).toHaveCount(0);

    await toggle.click();
    await page.locator('#lx-day-incident-confirm-yes').click();
    await expect(toggle).toBeChecked();
    await expect(
      page.locator('#lx-day-notes-incident .lx-daynote__text'),
    ).toHaveText([DAY_NOTE_TEXT.incident, DAY_NOTE_TEXT.incidentEarlier]);
    await expect(page.locator('.lx-daynote__text')).toHaveCount(2);
  });

  test('hypotheses: applied and explored apart, always «Hipótesis»', async ({
    page,
  }) => {
    await openClose(page);
    const applied = page.locator('#lx-day-hypotheses-applied');
    const open = page.locator('#lx-day-hypotheses-open');
    await expect(applied.locator('.lx-daygroup__title')).toContainText(
      HYPOTHESIS_APPLIED_TITLE,
    );
    await expect(open.locator('.lx-daygroup__title')).toContainText(
      HYPOTHESIS_OPEN_TITLE,
    );
    expect(await lineNames(page, '#lx-day-hypotheses-applied')).toEqual([
      'Hipótesis · Retraso 15 min · Reparto de mesas Demo',
    ]);
    await expect(applied).toContainText('Aplicada por Elvis a las 10:20');
    expect(await lineNames(page, '#lx-day-hypotheses-open')).toEqual([
      'Hipótesis · Retraso ≈ 30 min · Montaje del escenario Demo',
    ]);
    await expect(open).toContainText('Explorada por Dailos a las 10:10');
    await expect(page.locator('.lx-dayhypo__word')).toHaveText([
      'Hipótesis',
      'Hipótesis',
    ]);
    const markup = await reportMarkup(page);
    expect(markup).not.toContain(ORDER_PRIVATE.hypothesisNote);
    // A hypothesis opens its task.
    await open.locator('.lx-dayline').click();
    await expect(page.locator('#lx-task-sheet')).toContainText(
      'Montaje del escenario Demo',
    );
  });

  test('safety: subsoil declared (never verified), routes with Carpa Amarilla, 500 kg/m² once', async ({
    page,
  }) => {
    await openClose(page);
    const subsoil = page.locator('#lx-day-subsoil .lx-dayline');
    await expect(subsoil).toHaveCount(3);
    await expect(subsoil.nth(0)).toContainText('Descarga de tarimas Demo');
    await expect(subsoil.nth(0)).toContainText(
      'Terminó sin revisión del subsuelo declarada',
    );
    await expect(subsoil.nth(1)).toContainText('Entrega de casetas Demo');
    await expect(subsoil.nth(1)).toContainText(
      'Falta saber si lleva carga pesada',
    );
    await expect(subsoil.nth(2)).toContainText('Montaje del escenario Demo');
    await expect(subsoil.nth(2)).toContainText(
      'Revisión del subsuelo declarada por Dailos',
    );
    const safety = page.locator('#lx-day-safety');
    expect((await safety.textContent())!.toLowerCase()).not.toContain(
      'verificad',
    );
    await expect(page.locator('#lx-day-threshold')).toHaveText(
      '500 kg/m² es un umbral orientativo de revisión, no un límite certificado.',
    );
    const screen = (await page.locator('#lx-space-cierre').textContent())!;
    expect(countIn(screen, '500 kg/m²')).toBe(1);
    const printed = (await page.locator('body > .lx-day-root').textContent())!;
    expect(countIn(printed, '500 kg/m²')).toBe(1);
    expect(printed.toLowerCase()).not.toContain('subsuelo verificad');

    const routes = page.locator('#lx-day-routes');
    await expect(routes).toContainText('Entrega de generador Demo');
    await expect(routes.locator('.lx-dayroutes')).toContainText(
      'Carpa Amarilla',
    );
    await expect(routes.locator('.lx-dayroutes')).toContainText(
      'A (acceso de vehículos), B (sanitarios a pie) y C (evacuación en camilla)',
    );
  });

  test('unfinished today and the next days', async ({page}) => {
    await openClose(page);
    const unfinished = await lineNames(page, '#lx-day-unfinished');
    expect(unfinished).toHaveLength(8);
    expect(unfinished).not.toContain('Carga del camión Demo');
    expect(unfinished).not.toContain('Descarga de tarimas Demo');
    expect(unfinished).toContain('Montaje del escenario Demo');
    expect(unfinished).toContain('Limpieza Demo');
    expect(await lineNames(page, '#lx-day-next')).toEqual([
      'Entrega de casetas Demo',
    ]);
    await expect(page.locator('#lx-day-next')).toContainText('Jue 3 dic');
  });

  test('previous and next day move the link; «Hoy» comes back', async ({
    page,
  }) => {
    await openClose(page);
    await page.locator('#lx-day-prev').click();
    await expect(page.locator('#lx-day-title')).toHaveText(YESTERDAY_TITLE);
    await expect(page).toHaveURL(/#logistica\/cierre\/2026-12-01$/);
    await expect(page.locator('.lx-dayhead__sub')).toContainText('Ayer');
    await expect(page.locator('#lx-day-next-day')).toBeEnabled();
    await expect(page.locator('#lx-day-today')).toBeVisible();
    // 1 December: only the 23:00 change; today's notes are not there yet.
    await expectTile(page, 'Tareas', 1, '1 con cambios');
    await expectTile(page, 'Notas', 0, 'Sin cambios');
    expect(await lineNames(page, '#lx-day-notes-incident')).toEqual([
      'Incidencia · Entrega de vallas Demo',
    ]);
    await expect(page.locator('#lx-day-hypotheses-none')).toBeVisible();
    expect(ranges(api).at(-1)).toEqual({
      from: '2026-12-01T00:00:00.000Z',
      to: '2026-12-02T00:00:00.000Z',
    });

    await page.locator('#lx-day-next-day').click();
    await expect(page.locator('#lx-day-title')).toHaveText(TODAY_TITLE);
    await expect(page).toHaveURL(/#logistica\/cierre$/);
    await page.locator('#lx-day-prev').click();
    await page.locator('#lx-day-prev').click();
    await expect(page).toHaveURL(/#logistica\/cierre\/2026-11-30$/);
    await page.locator('#lx-day-today').click();
    await expect(page.locator('#lx-day-title')).toHaveText(TODAY_TITLE);
    await expect(page).toHaveURL(/#logistica\/cierre$/);
  });

  test('a deep link opens that day; a future day falls back to today', async ({
    page,
  }) => {
    await openClose(page, 'Elvis', '#logistica/cierre/2026-12-01');
    await expect(page.locator('#lx-day-title')).toHaveText(YESTERDAY_TITLE);
    await expect(page).toHaveURL(/#logistica\/cierre\/2026-12-01$/);
    await page.evaluate(() => {
      window.location.hash = '#logistica/cierre/2026-12-09';
    });
    await expect(page.locator('#lx-day-title')).toHaveText(TODAY_TITLE);
    await expect(page).toHaveURL(/#logistica\/cierre$/);
  });

  test('when the day’s history fails, it says so and «Reintentar» recovers', async ({
    page,
  }) => {
    // More than one: the dev build may ask twice (StrictMode).
    api.failActivityRange = 5;
    await openClose(page);
    const notice = page.locator('#lx-day-offline');
    await expect(notice).toContainText(
      'No se ha podido cargar el historial del día',
    );
    // From the records' own dates: no deletions, no changes to old records.
    await expectTile(page, 'Tareas', 0, 'Sin cambios');
    await expectTile(page, 'Personas', 1, '1 nuevo');
    await expectTile(page, 'Notas', 4, '4 nuevos');
    await expect(page.locator('body > .lx-day-root')).toContainText(
      'Sin el historial del servidor',
    );
    api.failActivityRange = 0;
    await page.locator('#lx-day-retry').click();
    await expect(notice).toHaveCount(0);
    await expectTile(page, 'Tareas', 2, '2 con cambios · 1 borrado');
  });

  test('offline it is built from the device and says so; unsent changes are marked', async ({
    page,
    context,
  }) => {
    await openClose(page);
    await context.setOffline(true);
    await expect(page.locator('#lx-sync-chip')).toHaveAttribute(
      'data-state',
      'offline',
    );
    await expect(page.locator('#lx-day-offline')).toContainText(
      'Sin conexión: las cifras salen de las fechas de los registros guardados',
    );
    await expect(page.locator('#lx-day-retry')).toHaveCount(0);
    await expectTile(page, 'Tareas', 0, 'Sin cambios');

    // A resource captured offline shows as «Pendiente de enviar».
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-resource').click();
    await page.locator('#lx-resource-name').fill('Vallas Prueba');
    await page.locator('#lx-resource-save').click();
    for (let i = 0; i < 3; i++) {
      if (!(await page.locator('.lx-sheet[open], dialog[open]').count())) {
        break;
      }
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('#lx-day-unsent')).toContainText(
      '1 cambio de este dispositivo está pendiente de enviar',
    );
    const line = page.locator('#lx-day-records-resources .lx-dayline', {
      hasText: 'Vallas Prueba',
    });
    await expect(line).toContainText('Pendiente de enviar');
    await expectTile(page, 'Recursos', 2, '2 nuevos');
    await expect(page.locator('body > .lx-day-root')).toContainText(
      'Pendiente de enviar',
    );

    await context.setOffline(false);
    await expect(page.locator('#lx-sync-chip')).toHaveAttribute(
      'data-state',
      'synced',
      {timeout: 15_000},
    );
    await expect(page.locator('#lx-day-unsent')).toHaveCount(0);
    await expect(page.locator('#lx-day-offline')).toHaveCount(0);
  });

  test('«Copiar resumen» copies counts and labels, never note text', async ({
    page,
  }) => {
    await openClose(page);
    // Even with every section's text included.
    await page.locator('#lx-day-include-decision').check();
    await page.locator('#lx-day-include-open_question').check();
    await page.locator('#lx-day-include-incident').click();
    await page.locator('#lx-day-incident-confirm-yes').click();
    await expect(page.locator('.lx-daynote__text')).toHaveCount(4);

    await page.locator('#lx-day-copy').click();
    await expect
      .poll(async () => (await copied(page)).length)
      .toBeGreaterThan(0);
    const text = (await copied(page)).at(-1)!;
    expect(text.split('\n')[0]).toMatch(
      /^Cierre de jornada · .*2 de diciembre de 2026$/,
    );
    expect(text).toContain(
      'Registros: 1 evento (1 con cambios); 2 tareas (2 con cambios); 1 persona (1 de alta); 1 oferta (1 de alta); 1 recurso (1 de alta).',
    );
    expect(text).toContain('Información pendiente de verificar: 91 %.');
    expect(text).toContain('- Incidencia · Tarima Demo (Abierta)');
    expect(text).toContain('- Decisión · Entrega de vallas Demo');
    expect(text).toContain(
      '- Hipótesis: Retraso 15 min · Reparto de mesas Demo',
    );
    expect(text).toContain(
      '- Descarga de tarimas Demo: Terminó sin revisión del subsuelo declarada',
    );
    expect(text).toContain(
      'Rutas de emergencia y Carpa Amarilla: 1 recordatorio.',
    );
    expect(text).toContain('Próximos días: 1 tarea prevista.');
    expect(text).toContain('no certifica');
    for (const t of [...NOTE_TEXTS, ...PRIVATE, '000 000 033']) {
      expect(text, t).not.toContain(t);
    }
    // An explored hypothesis is not news for a message.
    expect(text).not.toContain('Montaje del escenario Demo · ');
    await expect(page.locator('.lx-toast')).toContainText('Resumen copiado');
  });

  test('print preview: the banner says which texts the page carries', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {__printed: number};
      w.__printed = 0;
      window.print = () => {
        w.__printed++;
      };
    });
    await openClose(page);
    await page.locator('#lx-day-print').click();
    const sheet = page.locator('#lx-day-print-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#lx-day-print-banner')).toContainText(
      'Sin el texto de ninguna nota',
    );
    const preview = page.locator('#lx-day-preview');
    await expect(preview).toContainText('El día en cifras');
    await expect(preview).toContainText(
      'Revisión del subsuelo declarada por Dailos',
    );
    await expect(preview).toContainText('Generado por Elvis desde Ox Eye');
    await expect(preview).not.toContainText(DAY_NOTE_TEXT.decision);
    await page.locator('#lx-day-print-go').click();
    expect(
      await page.evaluate(
        () => (window as unknown as {__printed: number}).__printed,
      ),
    ).toBe(1);
    await page.locator('#lx-day-print-close').click();
    await expect(sheet).toHaveCount(0);

    await page.locator('#lx-day-include-decision').check();
    await page.locator('#lx-day-print').click();
    await expect(page.locator('#lx-day-print-banner')).toContainText(
      'Incluye el texto de: Decisiones.',
    );
    await expect(page.locator('#lx-day-print-banner')).toHaveClass(
      /lx-notice--error/,
    );
    await expect(preview).toContainText(DAY_NOTE_TEXT.decision);
    await expect(page.locator('#lx-day-preview-textnote')).toBeVisible();
  });

  test('on paper only the day report prints; a work order still prints itself', async ({
    page,
  }) => {
    await openClose(page);
    const day = page.locator('body > .lx-day-root');
    await expect(day).toHaveAttribute('aria-hidden', 'true');
    await expect(day).toBeHidden();
    await page.emulateMedia({media: 'print'});
    await expect(day).toBeVisible();
    await expect(page.locator('#lx-space-cierre')).toBeHidden();
    await expect(day.locator('.lx-dayp')).toHaveCount(1);
    await page.emulateMedia({media: 'screen'});
    await expect(day).toBeHidden();

    // A work order opened from the close prints instead of the day.
    await page
      .locator('#lx-day-records-contacts .lx-dayline', {hasText: 'Carla Demo'})
      .click();
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    await page.locator('#lx-contact-work-order').click();
    await expect(page.locator('#lx-order-sheet')).toBeVisible();
    await page.emulateMedia({media: 'print'});
    await expect(page.locator('body > .lx-print-root')).toBeVisible();
    await expect(day).toBeHidden();
    await page.emulateMedia({media: 'screen'});
  });
});

test.describe('Gestor logístico · Cierre de jornada (invitado)', () => {
  test('no notes and no hypotheses: «Visible para el equipo»', async ({
    page,
  }) => {
    await mockApi(page, dayCloseData());
    await openClose(page, 'Invitado');
    await expect(page.locator('#lx-day-guest')).toContainText(
      'Visible para el equipo',
    );
    await expect(page.locator('#lx-day-notes')).toHaveCount(0);
    await expect(page.locator('#lx-day-hypotheses')).toHaveCount(0);
    await expect(tile(page, 'Notas')).toHaveCount(0);
    await expectTile(page, 'Personas', 1, '1 nuevo');
    const markup = await reportMarkup(page);
    for (const text of [
      ...NOTE_TEXTS,
      ...PRIVATE,
      '000 000 033',
      'carla.demo@example.com',
      'Incidencia ·',
      'Decisión ·',
      'Pregunta abierta ·',
      'Retraso',
      HYPOTHESIS_OPEN_TITLE,
      HYPOTHESIS_APPLIED_TITLE,
    ]) {
      expect(markup, text).not.toContain(text);
    }
    // The page says the same.
    await expect(page.locator('body > .lx-day-root')).toContainText(
      'Visibles para el equipo con su propio usuario.',
    );
    await page.locator('#lx-day-print').click();
    await expect(page.locator('#lx-day-print-banner')).toContainText(
      'Sin notas ni hipótesis',
    );
    // «Copiar resumen» has no note or hypothesis line either.
    await page.locator('#lx-day-print-copy').click();
    await expect
      .poll(async () => (await copied(page)).length)
      .toBeGreaterThan(0);
    const text = (await copied(page)).at(-1)!;
    expect(text).not.toContain('Incidencias:');
    expect(text).not.toContain('Hipótesis');
  });

  test('even if the server leaked free text, the guest close shows none', async ({
    page,
  }) => {
    const api = await mockApi(page, dayCloseData());
    api.leakToGuests = true;
    await openClose(page, 'Invitado');
    await expect(page.locator('#lx-day-guest')).toBeVisible();
    const markup = await reportMarkup(page);
    for (const text of [...NOTE_TEXTS, ORDER_PRIVATE.hypothesisNote]) {
      expect(markup, text).not.toContain(text);
    }
    expect(markup).not.toContain('Incidencia ·');
    expect(markup).not.toContain('Retraso');
  });
});
