import {expect, test, type Page} from '@playwright/test';
import {ORG, mockApi, signIn} from './mock-api';
import {NOW, fixClock} from './plan-fixtures';
import {CAT, directoryData} from './directory-fixtures';
import {choose} from './controls';

/**
 * Gestor logístico, milestone 3: the universal search. «/» and Ctrl+K open
 * it, results are accent-insensitive across people, companies, offers,
 * events, tasks and places, with type and category filters and keyboard
 * navigation; opening a hit opens its sheet. Members' five recent searches
 * live on the server; a guest's stay on the device and are never sent.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

const RECENT_KEY = `oxeye.logistics.recent.v1:${ORG}`;
const sheet = (page: Page) => page.locator('#lx-search-sheet');
const input = (page: Page) => page.locator('#lx-search-input');
const hits = (page: Page) => page.locator('#lx-search-results [role="option"]');
const hitTypes = (page: Page) =>
  hits(page).evaluateAll(els =>
    els.map(el => el.getAttribute('data-hit-type')),
  );
const hitTitles = (page: Page) =>
  page.locator('#lx-search-results .lx-hit__title').allTextContents();

const ago = (minutes: number) =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

async function openSearch(page: Page) {
  await page.locator('#lx-search').click();
  await expect(sheet(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

test.describe('Gestor logístico · búsqueda universal', () => {
  test('«/» and Ctrl+K open it; «/» typed in a field does not', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await page.locator('#lx-title').click();
    await page.keyboard.press('/');
    await expect(sheet(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    await page.keyboard.press('Control+k');
    await expect(sheet(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    // Escape first clears the text, then closes.
    await input(page).fill('ana');
    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue('');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    await page.locator('#lx-nav-contactos').click();
    const field = page.locator('#lx-contacts-search');
    await field.click();
    await page.keyboard.type('a/b');
    await expect(field).toHaveValue('a/b');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('accent-insensitive results across types', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await openSearch(page);
    await input(page).fill('inigo');
    expect(await hitTitles(page)).toEqual(['Íñigo Prueba']);
    await expect(hits(page).first()).toContainText('Persona');

    await input(page).fill('concejalia');
    expect(await hitTitles(page)).toContain('Concejalía Prueba');

    await input(page).fill('plaza cristo');
    const types = await hitTypes(page);
    expect(types).toEqual(expect.arrayContaining(['event', 'task', 'venue']));

    // People, companies, offers, and the task of «Escenarios Prueba».
    await input(page).fill('prueba');
    expect(new Set(await hitTypes(page))).toEqual(
      new Set(['contact', 'company', 'offer', 'task']),
    );
    // Subtitles never quote descriptions or notes.
    await expect(page.locator('#lx-search-results')).not.toContainText(
      /DESCRIPCION-|NOTA-|CONDICION-/,
    );
  });

  test('type and category filters', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await openSearch(page);
    await input(page).fill('prueba');
    await page.locator('#lx-search-type-offer').click();
    await expect(page.locator('#lx-search-type-offer')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(new Set(await hitTypes(page))).toEqual(new Set(['offer']));
    await expect(hits(page)).toHaveCount(6);

    await choose(page, 'lx-search-category', CAT.sonido);
    expect(await hitTitles(page)).toEqual(['Equipo de sonido Prueba']);

    // «Todo» with the category: companies and offers of that category.
    await page
      .locator('#lx-search-types')
      .getByRole('button', {name: 'Todo'})
      .click();
    expect((await hitTitles(page)).sort()).toEqual(
      ['Equipo de sonido Prueba', 'Sonido Prueba'].sort(),
    );

    // The category does not apply to people: the selector goes away.
    await page.locator('#lx-search-type-contact').click();
    await expect(page.locator('#lx-search-category')).toHaveCount(0);
    expect(new Set(await hitTypes(page))).toEqual(new Set(['contact']));

    // A filter with no text lists everything that passes it.
    await input(page).fill('');
    await expect(hits(page)).toHaveCount(4);
  });

  test('arrows move, Enter opens the highlighted hit', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await openSearch(page);
    await input(page).fill('carpa');
    await expect(hits(page)).not.toHaveCount(0);
    const titles = await hitTitles(page);
    await page.keyboard.press('ArrowDown');
    await expect(input(page)).toHaveAttribute(
      'aria-activedescendant',
      'lx-search-opt-0',
    );
    await expect(page.locator('#lx-search-opt-0')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#lx-search-opt-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(input(page)).toHaveAttribute(
      'aria-activedescendant',
      'lx-search-opt-1',
    );
    // Up from the first wraps to the last.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(input(page)).toHaveAttribute(
      'aria-activedescendant',
      `lx-search-opt-${titles.length - 1}`,
    );
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#lx-offer-sheet')).toContainText(titles[1]);
  });

  test('each kind of hit opens its own sheet', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page);
    const cases: [string, string, string, string][] = [
      ['contact', 'carla', '#lx-contact-sheet', 'Carla Prueba'],
      ['company', 'sonido prueba', '#lx-company-sheet', 'Sonido Prueba'],
      ['offer', 'vallas', '#lx-offer-sheet', 'Vallas Prueba'],
      ['event', 'navidad', '#lx-event-sheet', 'Navidad en la Plaza del Cristo'],
      ['task', 'montaje escenario', '#lx-task-sheet', 'Montaje del escenario'],
      ['venue', 'recinto', '#lx-venue-sheet', 'Recinto ferial'],
    ];
    for (const [type, query, target, title] of cases) {
      await openSearch(page);
      await input(page).fill(query);
      await page
        .locator(`#lx-search-results [data-hit-type="${type}"]`)
        .filter({hasText: title})
        .first()
        .click();
      await expect(sheet(page)).toHaveCount(0);
      const opened = page.locator(target);
      await expect(opened).toBeVisible();
      if (type === 'task') {
        await expect(page.locator('#lx-task-title')).toHaveValue(title);
      } else if (type === 'event') {
        await expect(page.locator('#lx-event-name')).toHaveValue(title);
      } else {
        await expect(opened).toContainText(title);
      }
      await page.keyboard.press('Escape');
      await expect(opened).toHaveCount(0);
    }
  });

  test('nothing found offers to add the person or the company', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await openSearch(page);
    await input(page).fill('Zoe Prueba');
    await expect(page.locator('#lx-search-noresults')).toContainText(
      'Nada coincide con «Zoe Prueba»',
    );
    await page
      .getByRole('button', {name: 'Añadir persona «Zoe Prueba»'})
      .click();
    await expect(page.locator('#lx-contact-form')).toBeVisible();
    await expect(page.locator('#lx-contact-name')).toHaveValue('Zoe Prueba');
  });
});

test.describe('Gestor logístico · búsquedas recientes', () => {
  test('member: opened searches are sent to the server, five kept, «Borrar recientes»', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      ...directoryData(),
      recentSearches: [
        {query: 'vallas', at: ago(5)},
        {query: 'Ana', at: ago(60)},
        {query: 'Plaza del Cristo', at: ago(120)},
        {query: 'sonido', at: ago(180)},
        {query: 'grúa', at: ago(240)},
      ],
    });
    await signIn(page);
    await openSearch(page);
    const recent = page.locator('#lx-search-recent .lx-recent__query');
    await expect(recent).toHaveText([
      'vallas',
      'Ana',
      'Plaza del Cristo',
      'sonido',
      'grúa',
    ]);
    await expect(page.locator('#lx-search-recent-title')).not.toContainText(
      'en este dispositivo',
    );

    // Typing alone records nothing; opening a hit does.
    // One typo is tolerated («carla» ~ «carpa»), but the person ranks first.
    await input(page).fill('carla');
    await expect(hits(page).first()).toContainText('Carla Prueba');
    expect(api.calls('POST', `/organizations/${ORG}/recent-searches`)).toEqual(
      [],
    );
    await hits(page).first().click();
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    await expect
      .poll(() => api.calls('POST', `/organizations/${ORG}/recent-searches`))
      .toHaveLength(1);
    expect(
      api.calls('POST', `/organizations/${ORG}/recent-searches`)[0].body,
    ).toEqual({query: 'carla'});
    await page.keyboard.press('Escape');

    await openSearch(page);
    await expect(recent).toHaveText([
      'carla',
      'vallas',
      'Ana',
      'Plaza del Cristo',
      'sonido',
    ]);
    // A recent search fills the field again.
    await page.locator('.lx-recent__row', {hasText: 'vallas'}).click();
    await expect(input(page)).toHaveValue('vallas');
    await expect(hits(page).first()).toContainText('Vallas Prueba');

    await input(page).fill('');
    await page.locator('#lx-search-clear-recent').click();
    await expect
      .poll(
        () =>
          api.calls('DELETE', `/organizations/${ORG}/recent-searches`).length,
      )
      .toBe(1);
    await expect(recent).toHaveCount(0);
    await expect(page.locator('#lx-search-recent')).toContainText(
      'Tus cinco últimas búsquedas aparecerán aquí.',
    );
    await expect(
      page
        .getByRole('status')
        .filter({hasText: 'Búsquedas recientes borradas'}),
    ).toBeVisible();
  });

  test('member: Enter with no result still saves the search', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page);
    await openSearch(page);
    await input(page).fill('generador');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => api.calls('POST', `/organizations/${ORG}/recent-searches`))
      .toHaveLength(1);
    await expect(
      page.getByRole('status').filter({hasText: 'recientes'}),
    ).toContainText('Búsqueda guardada en recientes: «generador»');
  });

  test('guest: recent searches stay on this device and are never sent', async ({
    page,
  }) => {
    const api = await mockApi(page, {
      ...directoryData(),
      // A member's server-side list must never show to the shared guest login.
      recentSearches: [{query: 'búsqueda de Elvis', at: ago(5)}],
    });
    await signIn(page, 'Invitado');
    await openSearch(page);
    await expect(page.locator('#lx-search-recent-title')).toContainText(
      'en este dispositivo',
    );
    await expect(page.locator('#lx-search-recent')).not.toContainText(
      'búsqueda de Elvis',
    );
    // E4: no people for the guest; the search is still kept on the device.
    await input(page).fill('ana');
    await expect(page.locator('#lx-search-sheet')).not.toContainText(
      'Ana Prueba',
    );
    await page.keyboard.press('Enter');
    await expect(page.locator('#lx-contact-sheet')).toHaveCount(0);
    await expect(page.locator('.lx-toast')).toContainText(
      'Búsqueda guardada en recientes',
    );
    await input(page).fill('');
    await expect(
      page.locator('#lx-search-recent .lx-recent__query'),
    ).toHaveText(['ana']);
    const stored = await page.evaluate(
      k => localStorage.getItem(k),
      RECENT_KEY,
    );
    expect(JSON.parse(stored ?? '[]')).toEqual([{query: 'ana', at: NOW}]);

    await page.locator('#lx-search-clear-recent').click();
    await expect(
      page.locator('#lx-search-recent .lx-recent__query'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(k => localStorage.getItem(k), RECENT_KEY),
    ).toBeNull();
    // Nothing about recent searches ever went to the server.
    expect(
      api.requests.filter(r => r.path.endsWith('/recent-searches')),
    ).toEqual([]);
  });
});
