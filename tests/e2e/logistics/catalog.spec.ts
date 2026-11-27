import {expect, test, type Page} from '@playwright/test';
import {mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {CAT, directoryData} from './directory-fixtures';
import {IGIC} from './money-fixtures';

/**
 * Gestor logístico, milestone 3: «Catálogo». Category filter, honest prices
 * (unknown is «Precio pendiente de verificar», never 0 €), Spanish amounts
 * («12,5» → 12.5, empty → null), custom units, separate costs never totalled,
 * and «Comparar» limited to the same category and unit with unpriced offers
 * apart. The ranking sentence is not asserted here: its VAT rule is changing.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => fixClock(page));

type Json = Record<string, unknown>;

const offerRow = (page: Page, id: string) =>
  page.locator(`.lx-offerrow[data-offer-id="${id}"]`);
const chip = (page: Page, id: string) =>
  page.locator(`#lx-catalog-filters [data-category-id="${id}"]`);
const lastPost = (api: MockApi) =>
  api.calls('POST', '/offers').at(-1)?.body as Json;

async function openOffer(page: Page, id: string) {
  await offerRow(page, id).click();
  await expect(page.locator('#lx-offer-sheet')).toBeVisible();
}

async function newOffer(page: Page) {
  await page.locator('#lx-catalog-add').click();
  await expect(page.locator('#lx-offer-form')).toBeVisible();
}

test.describe('Gestor logístico · Catálogo · lista', () => {
  test('grouped by category; the chips filter and count', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    const groups = page.locator('#lx-space-catalogo section.lx-catgroup');
    expect(
      await groups.evaluateAll(els =>
        els.map(el => el.getAttribute('data-category-id')),
      ),
    ).toEqual([CAT.carpas, CAT.sonido, '__none__']);
    await expect(page.locator('#lx-space-catalogo')).toContainText('6 ofertas');

    // Only categories with offers get a chip.
    const chips = await page
      .locator('#lx-catalog-filters .lx-filterchip')
      .allInnerTexts();
    expect(chips.map(c => c.replace(/\s+/g, ' ').trim())).toEqual([
      'Todas 6',
      'Carpas 4',
      'Sonido 1',
      'Sin categoría 1',
    ]);

    await chip(page, CAT.carpas).click();
    await expect(chip(page, CAT.carpas)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#lx-space-catalogo')).toContainText(
      '4 ofertas de 6',
    );
    await expect(groups).toHaveCount(1);
    await expect(offerRow(page, 'o5')).toHaveCount(0);
    await expect(offerRow(page, 'o6')).toHaveCount(0);

    await chip(page, '__none__').click();
    await expect(offerRow(page, 'o6')).toBeVisible();
    await expect(offerRow(page, 'o1')).toHaveCount(0);

    // Tapping the active chip again shows everything.
    await chip(page, '__none__').click();
    await expect(page.locator('#lx-space-catalogo')).toContainText('6 ofertas');
    await expect(offerRow(page, 'o1')).toBeVisible();
  });

  test('the search field and a filter combine; «Quitar filtros» resets', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await chip(page, CAT.sonido).click();
    await page.locator('#lx-catalog-search').fill('carpa');
    await expect(page.locator('#lx-catalog-noresults')).toContainText(
      'Ninguna oferta coincide con «carpa»',
    );
    await page.locator('#lx-catalog-noresults').getByRole('button').click();
    await expect(page.locator('#lx-catalog-search')).toHaveValue('');
    await expect(offerRow(page, 'o1')).toBeVisible();
    // Accent-insensitive, by company too.
    await page.locator('#lx-catalog-search').fill('concejalia');
    await expect(offerRow(page, 'o6')).toBeVisible();
    await expect(page.locator('.lx-offerrow')).toHaveCount(1);
  });

  test('an unknown price says so and never reads as 0 €', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    for (const id of ['o3', 'o6']) {
      await expect(offerRow(page, id)).toContainText(
        'Precio pendiente de verificar',
      );
      await expect(offerRow(page, id)).not.toContainText(/(^|\D)0\s?€/);
    }
    await expect(offerRow(page, 'o1')).toContainText('180 € / día');
    await expect(offerRow(page, 'o1')).toContainText(
      '+ montaje y mantenimiento pendientes',
    );
    await expect(offerRow(page, 'o2')).toContainText('210,50 € / día');
    await expect(offerRow(page, 'o4')).toContainText('12 € / m');
    const text = await page.locator('#lx-space-catalogo').innerText();
    expect(text).not.toMatch(/(^|[^\d,.])0\s?€/);

    await openOffer(page, 'o3');
    await expect(page.locator('#lx-offer-price')).toContainText(
      'Precio pendiente de verificar',
    );
    // (VAT wording is changing with the comparison rule: not asserted.)
    const costs = page.locator('#lx-offer-costs dd');
    await expect(costs).toHaveText([
      'Pendiente de verificar',
      'Pendiente de verificar',
      'Pendiente de verificar',
    ]);
    await expect(page.locator('#lx-offer-missing')).toContainText('precio');
  });

  test('costs stay apart and are never added up', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await openOffer(page, 'o1');
    const sheet = page.locator('#lx-offer-sheet');
    await expect(page.locator('#lx-offer-price')).toContainText('180 € / día');
    await expect(page.locator('#lx-offer-costs dt')).toHaveText([
      'Transporte',
      'Montaje',
      'Mantenimiento',
    ]);
    await expect(page.locator('#lx-offer-costs dd')).toHaveText([
      '60 €',
      'Pendiente de verificar',
      'Pendiente de verificar',
    ]);
    // The offer's own cost lines are never added up: 180 + 60 = 240 must
    // not appear as a total next to them. (The «?» help says «cualquier
    // total sería falso»: only a labelled total would be a problem.)
    // Revisión 1 · E6: «Coste de una necesidad» is the approved exception,
    // a total for a concrete need with its breakdown and every unknown part
    // listed, always marked as an estimate.
    const lines = sheet.locator('#lx-offer-costs');
    await expect(lines).not.toContainText(/\bTotal\b|total:/);
    await expect(lines).not.toContainText('240');
    await expect(page.locator('#lx-offer-price')).not.toContainText('240');
    const needCost = sheet.locator('#lx-offer-terms');
    if (await needCost.locator('.lx-cost__table').count()) {
      await expect(
        needCost.locator('.lx-cost__table tbody tr').first(),
      ).toBeVisible();
      await expect(needCost).toContainText(/estimación|Sin total/);
    }
    await expect(page.locator('#lx-offer-detail')).toContainText(
      'CONDICION-PRIVADA',
    );
  });
});

test.describe('Gestor logístico · Catálogo · comparar', () => {
  test('only the same category and unit; unpriced offers listed apart', async ({
    page,
  }) => {
    // E5: offers are ranked by their estimate with tax, so both companies
    // need a known tax; without one they would be listed apart.
    const data = directoryData();
    for (const c of data.companies ?? []) c.tax = IGIC;
    await mockApi(page, data);
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await openOffer(page, 'o1');
    const compare = page.locator('#lx-offer-compare');
    await expect(compare).toContainText(
      'Misma categoría (Carpas) y misma unidad (€ / día).',
    );
    const list = page.locator('#lx-offer-compare-list');
    await expect(list.locator('li')).toHaveCount(2);
    await expect(list.locator('li.is-self')).toContainText('Esta oferta');
    await expect(list).toContainText('Carpa Prueba reforzada');
    // The carpa per metre and the sound equipment are never ranked here.
    await expect(compare).not.toContainText('Carpa Prueba por metro');
    await expect(compare).not.toContainText('Equipo de sonido Prueba');
    await expect(page.locator('#lx-offer-compare-unpriced')).toContainText(
      'Carpa Prueba 3 × 3 m · Escenarios Prueba',
    );
    await expect(list).not.toContainText('Carpa Prueba 3 × 3 m');

    // A peer opens in the same sheet.
    await list.getByRole('button', {name: /Carpa Prueba reforzada/}).click();
    await expect(page.locator('#lx-offer-price')).toContainText(
      '210,50 € / día',
    );
    await expect(
      page.locator('#lx-offer-compare-list li.is-self'),
    ).toContainText('Esta oferta');
  });

  test('without a category or with another unit there is nothing honest to compare', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await openOffer(page, 'o6');
    await expect(page.locator('#lx-offer-compare-none')).toHaveText(
      'Sin categoría no hay con qué compararla de forma honesta. Asígnale una.',
    );
    await page.locator('#lx-offer-close').click();
    await openOffer(page, 'o4');
    await expect(page.locator('#lx-offer-compare-none')).toContainText(
      'Aún no hay otras ofertas de Carpas por m',
    );
    await expect(page.locator('#lx-offer-compare-list')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · Catálogo · añadir ofertas', () => {
  test('empty amounts go as null and «12,5» as 12.5', async ({page}) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await newOffer(page);
    await page.locator('#lx-offer-companyName').fill('Escenarios Prueba');
    await expect(page.locator('#lx-offer-companyName-status')).toContainText(
      'Se enlazará con «Escenarios Prueba»',
    );
    await page.locator('#lx-offer-name').fill('Carpa Prueba 4 × 4 m');
    await page.locator(`#lx-offer-cat-${CAT.carpas}`).click();
    await page.locator('#lx-offer-unit-day').click();
    await page.locator('#lx-offer-transportCost').fill('12,5');
    await expect(page.locator('.lx-pricegroup__preview')).toContainText(
      'Se verá como: Precio pendiente de verificar',
    );
    await page.locator('#lx-offer-save').click();

    await expect.poll(() => api.calls('POST', '/offers').length).toBe(1);
    expect(lastPost(api)).toMatchObject({
      companyName: 'Escenarios Prueba',
      name: 'Carpa Prueba 4 × 4 m',
      categoryId: CAT.carpas,
      price: null,
      unit: 'day',
      customUnit: null,
      transportCost: 12.5,
      assemblyCost: null,
      maintenanceCost: null,
      // E5: a new offer's price is always before tax.
      vatIncluded: false,
      conditions: null,
    });
    await expect(page.locator('#lx-offer-price')).toContainText(
      'Precio pendiente de verificar',
    );
    await expect(page.locator('#lx-offer-costs dd').first()).toHaveText(
      '12,50 €',
    );
  });

  test('Spanish thousands and decimals; invalid amounts are refused before sending', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await newOffer(page);
    await page.locator('#lx-offer-companyName').fill('Sonido Prueba');
    await page.locator('#lx-offer-name').fill('Línea de array Prueba');

    const price = page.locator('#lx-offer-price');
    await price.fill('abc');
    await page.locator('#lx-offer-save').click();
    await expect(page.locator('#lx-offer-price-error')).toHaveText(
      'Escribe un importe en euros, por ejemplo 120 o 85,50.',
    );
    await price.fill('12,555');
    await page.locator('#lx-offer-save').click();
    await expect(page.locator('#lx-offer-price-error')).toContainText(
      'como mucho dos decimales',
    );
    expect(api.calls('POST', '/offers')).toHaveLength(0);

    await price.fill('1.250,5');
    await page.locator('#lx-offer-maintenanceCost').fill('0');
    await expect(page.locator('#lx-offer-price-error')).toHaveCount(0);
    // E5: only offers recorded before E5 are asked whether tax is included.
    await expect(page.locator('#lx-offer-vat')).toHaveCount(0);
    await page.locator('#lx-offer-save').click();
    await expect.poll(() => api.calls('POST', '/offers').length).toBe(1);
    expect(lastPost(api)).toMatchObject({
      price: 1250.5,
      unit: 'unit',
      maintenanceCost: 0,
      transportCost: null,
      vatIncluded: false,
    });
    // A known 0 is shown as 0 €; it is not «pendiente».
    await expect(page.locator('#lx-offer-costs dd').nth(2)).toHaveText('0 €');
  });

  test('a custom unit is sent and shown with its own wording', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await newOffer(page);
    await page.locator('#lx-offer-companyName').fill('Escenarios Prueba');
    await page.locator('#lx-offer-name').fill('Escenario Prueba 8 × 6 m');
    await page.locator('#lx-offer-unit-custom').click();
    await page.locator('#lx-offer-customUnit').fill('por escenario');
    await page.locator('#lx-offer-price').fill('300');
    await expect(page.locator('.lx-pricegroup__preview')).toContainText(
      'Se verá como: 300 € / escenario',
    );
    await page.locator('#lx-offer-save').click();
    await expect.poll(() => api.calls('POST', '/offers').length).toBe(1);
    expect(lastPost(api)).toMatchObject({
      unit: 'custom',
      customUnit: 'por escenario',
      price: 300,
      categoryId: null,
    });
    await expect(page.locator('#lx-offer-detail')).toContainText(
      'Por escenario',
    );
    await page.locator('#lx-offer-close').click();
    const row = page.locator('.lx-offerrow', {
      hasText: 'Escenario Prueba 8 × 6 m',
    });
    await expect(row).toContainText('300 € / escenario');
  });

  test('a new company typed in the offer is created by name', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await newOffer(page);
    await page.locator('#lx-offer-companyName').fill('Aseos Prueba');
    await expect(page.locator('#lx-offer-companyName-status')).toContainText(
      'Se creará «Aseos Prueba»',
    );
    await page.locator('#lx-offer-name').fill('Cabina Prueba');
    await page.locator('#lx-offer-save').click();
    await expect.poll(() => api.calls('POST', '/offers').length).toBe(1);
    expect(api.companies.map(c => c.name)).toContain('Aseos Prueba');
    await expect(page.locator('#lx-offer-company')).toContainText(
      'Aseos Prueba',
    );
  });

  test('company and name are required; nothing is sent without them', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', '#logistica/catalogo');
    await newOffer(page);
    await page.locator('#lx-offer-save').click();
    await expect(page.locator('#lx-offer-companyName-error')).toHaveText(
      'Indica de qué empresa es la oferta.',
    );
    await expect(page.locator('#lx-offer-name-error')).toHaveText(
      'Escribe qué se ofrece, aunque sea provisional.',
    );
    expect(api.calls('POST', '/offers')).toHaveLength(0);
  });
});
