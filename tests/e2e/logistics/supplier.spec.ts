import {expect, test, type Page} from '@playwright/test';
import {OPEN_TOKEN, SUPPLIER_TOKEN, mockApi} from './mock-api';
import {offersData} from './offers-fixtures';

/**
 * Revisión 1 · E7: the public supplier page. A company opens its personal
 * link (or the open «presentar oferta» link) with no account: only this
 * request, a guided form, consent to a privacy text still pending legal
 * review, and one friendly state for every link that no longer works.
 * The token leaves the address at once and only travels in request bodies.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});

const choice = (page: Page, name: string, value: string) =>
  page.locator(`#${name} .lx-choice[data-value="${value}"]`).click();

async function next(page: Page, step: string) {
  await page.locator('#lx-sf-next').click();
  await expect(page.locator('#lx-sf-form')).toHaveAttribute('data-step', step);
}

test('a company answers its personal link from start to «pendiente de revisión»', async ({
  page,
}) => {
  const mock = await mockApi(page, offersData());
  await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
  await expect(page.locator('#lx-supplier')).toBeVisible();
  // No Gestor chrome and no login in front of it.
  await expect(page.locator('#lx-login-username')).toHaveCount(0);
  await expect(page.locator('#lx-title')).toHaveCount(0);
  // Nothing of the hub or the simulation is mounted underneath (main.tsx).
  await expect(page.locator('#game-menu')).toHaveCount(0);
  await expect(page.locator('.app')).toHaveCount(0);
  // The token leaves the address and never goes in a path.
  expect(new URL(page.url()).hash).not.toContain(SUPPLIER_TOKEN);
  expect(mock.requests.some(r => r.path.includes(SUPPLIER_TOKEN))).toBe(false);
  expect(mock.calls('POST', '/public/requests/lookup')[0].body).toEqual({
    token: SUPPLIER_TOKEN,
  });
  await expect(page.locator('#lx-supplier-request')).toContainText(
    '4 carpas de 6 × 6 m',
  );
  await expect(page.locator('#lx-supplier')).toContainText(
    'Ayuntamiento de La Laguna',
  );

  await choice(page, 'lx-sf-intent', 'yes');
  await next(page, 'company');
  await expect(page.locator('#lx-sf-company-name')).toHaveValue(
    'Estructuras Norte',
  );
  await next(page, 'price:0');
  await page.locator('#lx-sf-products-0-price').fill('150');
  await next(page, 'extras:0');
  await next(page, 'products');
  await next(page, 'tax');
  await choice(page, 'lx-sf-tax', 'igic');
  await page.locator('#lx-sf-tax-rate').fill('7');
  await next(page, 'dates');
  await page.locator('#lx-sf-validity-3m').click();
  await page.locator('#lx-sf-service-all').click();
  await next(page, 'review');
  await expect(page.locator('#lx-sf-form')).toContainText(
    'Texto pendiente de revisión legal',
  );

  // Consent is required before sending.
  await page.locator('#lx-sf-next').click();
  await expect(page.locator('#lx-sf-privacy-error')).toBeVisible();
  expect(mock.calls('POST', '/public/requests/proposal')).toHaveLength(0);
  await page.locator('#lx-sf-privacy').check();
  await page.locator('#lx-sf-next').click();

  await expect(page.locator('#lx-supplier-sent')).toContainText(
    'Tu propuesta queda pendiente de revisión',
  );
  const sent = mock.calls('POST', '/public/requests/proposal')[0]
    .body as Record<string, unknown>;
  expect(sent).toMatchObject({token: SUPPLIER_TOKEN, privacyAccepted: true});
  expect(sent.tax).toMatchObject({regime: 'igic', ratePercent: 7});
  const created = mock.proposals.find(p => p.via === 'link' && p.id !== 'p1');
  expect(created?.state).toBe('pending');
});

test('a company that cannot says so in one step', async ({page}) => {
  const mock = await mockApi(page, offersData());
  await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
  await choice(page, 'lx-sf-intent', 'no');
  await next(page, 'decline');
  await page.locator('#lx-sf-declineReason').fill('Sin carpas libres.');
  await page.locator('#lx-sf-next').click();
  await expect(page.locator('#lx-supplier-declined')).toBeVisible();
  expect(mock.calls('POST', '/public/requests/decline')[0].body).toEqual({
    token: SUPPLIER_TOKEN,
    reason: 'Sin carpas libres.',
  });
});

test('every link that no longer works reads the same', async ({page}) => {
  await mockApi(page, offersData());
  await page.goto(`/#logistica/proveedor/${'z'.repeat(43)}`);
  await expect(page.locator('#lx-supplier-gone')).toContainText(
    'Este enlace ya no está disponible',
  );
  // An end the form cannot leave: the tab is OxEye again after a reload.
  await page.reload();
  await expect(page.locator('#lx-login-username')).toBeVisible();
  await expect(page.locator('#lx-supplier')).toHaveCount(0);
});

test('a reload keeps the form; OxEye opened again in the tab does not', async ({
  page,
}) => {
  await mockApi(page, offersData());
  await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
  await expect(page.locator('#lx-supplier-request')).toBeVisible();
  // A real reload (or a dropped connection) brings the supplier back.
  await page.reload();
  await expect(page.locator('#lx-supplier-request')).toBeVisible();
  // Merely opened, nothing typed: opening OxEye again in this tab is OxEye.
  await page.goto('about:blank');
  await page.goto('/#logistica');
  await expect(page.locator('#lx-login-username')).toBeVisible();
  await expect(page.locator('#lx-supplier')).toHaveCount(0);
});

test('answers not yet sent bring the tab back to the form', async ({page}) => {
  await mockApi(page, offersData());
  await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
  await choice(page, 'lx-sf-intent', 'yes');
  await page.goto('about:blank');
  await page.goto('/#logistica');
  await expect(page.locator('#lx-supplier-request')).toBeVisible();
  await expect(
    page.locator('#lx-sf-intent .lx-choice[data-value="yes"] input'),
  ).toBeChecked();
});

test('a supplier link pasted into an open OxEye tab opens only the form', async ({
  page,
}) => {
  await mockApi(page, offersData());
  await page.goto('/#logistica');
  await expect(page.locator('#lx-login-username')).toBeVisible();
  await page.evaluate(token => {
    window.location.hash = `#logistica/proveedor/${token}`;
  }, SUPPLIER_TOKEN);
  await expect(page.locator('#lx-supplier-request')).toBeVisible();
  await expect(page.locator('#lx-login-username')).toHaveCount(0);
  await expect(page.locator('.app')).toHaveCount(0);
  expect(new URL(page.url()).hash).not.toContain(SUPPLIER_TOKEN);
});

test('too many attempts pause the link for a moment', async ({page}) => {
  const mock = await mockApi(page, offersData());
  mock.publicLimited = 1;
  await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
  await expect(page.locator('#lx-supplier-limited')).toContainText('2 minutos');
  await page.locator('#lx-supplier-limited button').click();
  await expect(page.locator('#lx-supplier-request')).toBeVisible();
});

test('a link already answered says so', async ({page}) => {
  const data = offersData();
  const links = data.quoteRequests![0].links as Record<string, unknown>[];
  Object.assign(links[1], {status: 'answered'});
  await mockApi(page, data);
  await page.goto(`/#logistica/proveedor/${SUPPLIER_TOKEN}`);
  await expect(page.locator('#lx-supplier-used')).toContainText(
    'Ya has respondido a esta solicitud',
  );
});

test('the open link works only while an administrator keeps it on', async ({
  page,
}) => {
  const data = offersData();
  data.supplierLinks!.push({token: OPEN_TOKEN, requestId: null, linkId: null});
  data.offerSettings = {openLink: {enabled: true, createdAt: null}, version: 1};
  const mock = await mockApi(page, data);
  await page.goto(`/#logistica/proveedor/abierto/${OPEN_TOKEN}`);
  await expect(page.locator('#lx-sf-form')).toHaveAttribute(
    'data-step',
    'company',
  );
  await expect(page.locator('#lx-supplier-request')).toHaveCount(0);

  (mock.offerSettings.openLink as {enabled: boolean}).enabled = false;
  await page.reload();
  await expect(page.locator('#lx-supplier-gone')).toBeVisible();
});
