import {expect, test, type Page} from '@playwright/test';
import {lxUrl} from './address';
import {makeContact, mockApi, signIn, type MockApi} from './mock-api';
import {fixClock} from './plan-fixtures';
import {choose, expectValue, optionLabels} from './controls';
import {
  CAT,
  copied,
  directoryData,
  opened,
  trapOutgoing,
} from './directory-fixtures';

/**
 * Gestor logístico, milestone 3: «Contactos». Capturing a person with only
 * the name, companies found or created by name, look-alikes and duplicates,
 * reaching someone only after a confirmation sheet (acceptance test 4 of the
 * field demo), sharing chosen fields only, and the company sheet (kind,
 * categories, responsible person, its people, offers and tasks, delete and
 * version conflicts). Fixed clock and fictitious data (directory-fixtures.ts).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
  await trapOutgoing(page);
});

type Json = Record<string, unknown>;

const personRow = (page: Page, id: string) =>
  page.locator(`[data-contact-id="${id}"]`);
const companyRow = (page: Page, id: string) =>
  page.locator(`[data-company-id="${id}"]`);

async function openPerson(page: Page, id: string) {
  await personRow(page, id).locator('.lx-dirrow__main').click();
  await expect(page.locator('#lx-contact-sheet')).toBeVisible();
}

async function openCompany(page: Page, id: string) {
  await page.locator('#lx-contacts-tab-companies').click();
  await companyRow(page, id).locator('.lx-dirrow__main').click();
  await expect(page.locator('#lx-company-sheet')).toBeVisible();
}

const OUTGOING = 'a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]';

const lastBody = (api: MockApi, method: string, path: string | RegExp) =>
  api.calls(method, path).at(-1)?.body as Json;

test.describe('Gestor logístico · Contactos · capturar personas', () => {
  test('a person with only a name is saved and shows what is missing', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await expect(page.locator('#lx-contacts-tab-people')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#lx-contacts-panel')).toContainText(
      '4 personas',
    );

    await page.locator('#lx-contacts-add').click();
    await expect(page.locator('#lx-contact-name')).toBeFocused();
    await page.locator('#lx-contact-name').fill('Diego Prueba');
    await page.locator('#lx-contact-save').click();

    await expect.poll(() => api.calls('POST', '/contacts').length).toBe(1);
    expect(lastBody(api, 'POST', '/contacts')).toMatchObject({
      name: 'Diego Prueba',
      companyName: null,
      role: null,
      phone: null,
      email: null,
      description: null,
      notes: null,
      eventIds: [],
      verification: 'draft',
    });

    // The same sheet turns into the person's card.
    const sheet = page.locator('#lx-contact-sheet');
    await expect(page.locator('#lx-contact-edit')).toBeVisible();
    await expect(sheet).toContainText('Diego Prueba');
    await expect(page.locator('#lx-contact-reach-none')).toContainText(
      'Falta el teléfono y el correo: pendiente de verificar',
    );
    await expect(page.locator('#lx-contact-missing')).toHaveText(
      'Falta: teléfono o correo, cargo, empresa o entidad',
    );
    await expect(page.locator('#lx-contact-detail')).toContainText(
      'Pendiente de verificar',
    );
    await page.locator('#lx-contact-close').click();
    await expect(sheet).toHaveCount(0);

    // M6: the device names the new record (replay-safe outbox).
    const id = (lastBody(api, 'POST', '/contacts') as {id: string}).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = personRow(page, id);
    await expect(row).toContainText(
      'Falta teléfono o correo, cargo, empresa o entidad',
    );
    // Filed under its letter, and it has no phone so no quick call.
    await expect(
      page.locator('[aria-labelledby="lx-letter-p-D"]'),
    ).toContainText('Diego Prueba');
    await expect(row.locator('.lx-quickcall')).toHaveCount(0);
    await expect(page.locator('#lx-contacts-panel')).toContainText(
      '5 personas',
    );
  });

  test('without a name nothing is sent', async ({page}) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-contact-role').fill('Conductor');
    await page.locator('#lx-contact-save').click();
    await expect(page.locator('#lx-contact-name-error')).toHaveText(
      'Escribe el nombre, aunque sea solo el de pila.',
    );
    await expect(page.locator('#lx-contact-name')).toBeFocused();
    expect(api.calls('POST', '/contacts')).toHaveLength(0);
  });

  test('a new company name is created; a known one is linked', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-contact-name').fill('Elena Prueba');
    const company = page.locator('#lx-contact-companyName');
    const status = page.locator('#lx-contact-companyName-status');

    // Different case: the existing company is found.
    await company.fill('escenarios prueba');
    await expect(status).toContainText(
      'Se enlazará con «Escenarios Prueba» · proveedor',
    );
    await company.fill('Carpas Nuevas Prueba');
    await expect(status).toContainText(
      'Se creará «Carpas Nuevas Prueba» como empresa o entidad nueva',
    );
    await page.locator('#lx-contact-phone').fill('000 000 031');
    await page.locator('#lx-contact-save').click();

    await expect.poll(() => api.calls('POST', '/contacts').length).toBe(1);
    expect(lastBody(api, 'POST', '/contacts')).toMatchObject({
      name: 'Elena Prueba',
      companyName: 'Carpas Nuevas Prueba',
      phone: '000 000 031',
    });
    expect(api.companies.map(c => c.name)).toContain('Carpas Nuevas Prueba');
    // The card links to the new company once the list is refreshed.
    await expect(page.locator('#lx-contact-company')).toHaveText(
      'Carpas Nuevas Prueba',
    );
    await page.locator('#lx-contact-close').click();
    await expect(page.locator('#lx-contacts-tab-companies')).toContainText('4');
    await page.locator('#lx-contacts-tab-companies').click();
    await expect(
      page.locator('.lx-dirrow', {hasText: 'Carpas Nuevas Prueba'}),
    ).toContainText('1 persona');
  });

  test('«Guardar y seguir» keeps the company for the next person', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-contact-name').fill('Felipe Prueba');
    await page.locator('#lx-contact-companyName').fill('Sonido Prueba');
    await page.locator('#lx-contact-save-next').click();
    await expect(page.locator('#lx-contact-saved')).toContainText(
      'Guardada «Felipe Prueba»',
    );
    await expect(page.locator('#lx-contact-name')).toHaveValue('');
    await expect(page.locator('#lx-contact-name')).toBeFocused();
    await expect(page.locator('#lx-contact-companyName')).toHaveValue(
      'Sonido Prueba',
    );
    await page.locator('#lx-contact-name').fill('Gloria Prueba');
    await page.locator('#lx-contact-save').click();
    await expect.poll(() => api.calls('POST', '/contacts').length).toBe(2);
    expect(
      api.calls('POST', '/contacts').map(c => (c.body as Json).companyName),
    ).toEqual(['Sonido Prueba', 'Sonido Prueba']);
  });

  test('a look-alike name asks «¿Es la misma persona…?»: Abrir', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-contact-name').fill('ana  prueba');
    const warn = page.locator('#lx-contact-lookalike');
    await expect(warn).toContainText(
      '¿Es la misma persona que «Ana Prueba» · Jefa de montaje · Escenarios Prueba?',
    );
    await page.locator('#lx-contact-lookalike-open-p1').click();
    // The existing card, not a new record.
    await expect(page.locator('#lx-contact-form')).toHaveCount(0);
    await expect(page.locator('#lx-contact-subtitle')).toHaveText(
      'Jefa de montaje · Escenarios Prueba',
    );
    expect(api.calls('POST', '/contacts')).toHaveLength(0);
  });

  test('a look-alike can be dismissed: «No, es otra» and save', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-contact-name').fill('Ana Prueba');
    const warn = page.locator('#lx-contact-lookalike');
    await expect(warn).toBeVisible();
    await page.locator('#lx-contact-lookalike-dismiss-p1').click();
    await expect(warn).toHaveCount(0);
    // Two people may share a name: the server accepts it.
    await page.locator('#lx-contact-save').click();
    await expect.poll(() => api.calls('POST', '/contacts').length).toBe(1);
    expect(api.contacts.filter(c => c.name === 'Ana Prueba')).toHaveLength(2);
  });

  test('letters group the list, with Ñ apart and accents filed under their letter', async ({
    page,
  }) => {
    await mockApi(page, {
      ...directoryData(),
      contacts: [
        makeContact('n1', 'Nora Prueba'),
        makeContact('n2', 'Ñandú Prueba'),
        makeContact('n3', 'Óscar Prueba'),
        makeContact('n4', 'Álvaro Prueba'),
        makeContact('n5', '3 Hermanos Prueba'),
      ],
    });
    await signIn(page, 'Elvis', lxUrl('contactos'));
    const letters = await page
      .locator('#lx-contacts-panel .lx-letter__title')
      .allTextContents();
    // Spanish address book: Ñ after N, accents with their letter, # last.
    expect(letters).toEqual(['A', 'N', 'Ñ', 'O', '#']);
  });
});

test.describe('Gestor logístico · Contactos · llamar, WhatsApp, correo', () => {
  test('acceptance 4: each channel confirms first and opens only on the button', async ({
    page,
    context,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    const start = page.url();
    await openPerson(page, 'p1');
    const reach = page.locator('#lx-reach-sheet');
    const go = page.locator('#lx-reach-go');

    // Nothing that could dial or open exists before a confirmation sheet.
    await expect(page.locator(OUTGOING)).toHaveCount(0);

    // Llamar
    await page.locator('#lx-contact-reach-call').click();
    await expect(reach).toBeVisible();
    await expect(page.locator('#lx-reach-what')).toBeFocused();
    // A stray Enter right after it opens does nothing.
    await page.keyboard.press('Enter');
    await expect(reach).toBeVisible();
    expect(await opened(page)).toEqual([]);
    await expect(page.locator('#lx-reach-what')).toHaveText(
      'Se abrirá la llamada a +34 000 00 00 11.',
    );
    await expect(reach).toContainText(
      'No se abrirá nada hasta que pulses el botón.',
    );
    await expect(go).toHaveAttribute('href', 'tel:+34000000011');
    await go.click();
    await expect(reach).toHaveCount(0);
    expect(await opened(page)).toEqual([
      {href: 'tel:+34000000011', via: 'link', target: null},
    ]);
    // Closing the confirmation leaves the person's card open.
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();

    // WhatsApp
    await page.locator('#lx-contact-reach-whatsapp').click();
    await expect(reach).toBeVisible();
    await page.keyboard.press('Enter');
    expect(await opened(page)).toHaveLength(1);
    await expect(page.locator('#lx-reach-what')).toHaveText(
      'Se abrirá WhatsApp con una conversación con +34 000 00 00 11.',
    );
    await expect(go).toHaveAttribute('href', 'https://wa.me/34000000011');
    await go.click();
    await expect(reach).toHaveCount(0);
    expect((await opened(page))[1]).toEqual({
      href: 'https://wa.me/34000000011',
      via: 'link',
      target: '_blank',
    });

    // Correo
    await page.locator('#lx-contact-reach-mail').click();
    await expect(reach).toBeVisible();
    await page.keyboard.press('Enter');
    expect(await opened(page)).toHaveLength(2);
    await expect(page.locator('#lx-reach-what')).toHaveText(
      'Se abrirá tu programa de correo para escribir a ana.prueba@example.com.',
    );
    await expect(go).toHaveAttribute('href', 'mailto:ana.prueba@example.com');
    await go.click();
    expect((await opened(page))[2].href).toBe('mailto:ana.prueba@example.com');

    // Nothing navigated away and no window was opened: the address is still
    // the person's card (its own address since Revisión 1) over Contactos.
    expect(page.url()).toBe(`${start}/ficha/persona/p1`);
    expect(context.pages()).toHaveLength(1);
    expect((await opened(page)).filter(o => o.via === 'window.open')).toEqual(
      [],
    );
  });

  test('cancelling or Escape opens nothing and keeps the card', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openPerson(page, 'p1');
    await page.locator('#lx-contact-reach-call').click();
    await page.locator('#lx-reach-cancel').click();
    await expect(page.locator('#lx-reach-sheet')).toHaveCount(0);
    await page.locator('#lx-contact-reach-mail').click();
    await expect(page.locator('#lx-reach-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lx-reach-sheet')).toHaveCount(0);
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    expect(await opened(page)).toEqual([]);
  });

  test('the quick «Llamar» of a row confirms first too', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await expect(page.locator(OUTGOING)).toHaveCount(0);
    const quick = page.locator('#lx-call-p1');
    await expect(quick).toHaveAccessibleName('Llamar a Ana Prueba');
    await quick.click();
    await expect(page.locator('#lx-reach-sheet')).toContainText(
      'Llamar a Ana Prueba',
    );
    await page.keyboard.press('Enter');
    expect(await opened(page)).toEqual([]);
    await page.locator('#lx-reach-go').click();
    expect((await opened(page)).map(o => o.href)).toEqual(['tel:+34000000011']);
    // People without a phone have no quick call.
    await expect(page.locator('#lx-call-p3')).toHaveCount(0);
  });

  test('without a country code WhatsApp is dimmed and says why', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openPerson(page, 'p2');
    const wa = page.locator('#lx-contact-reach-whatsapp');
    await expect(wa).toHaveClass(/lx-reach__btn--muted/);
    await expect(wa).toContainText('Falta el prefijo');
    await expect(page.locator('#lx-contact-detail')).toContainText(
      'No sabemos el prefijo del país',
    );
    await wa.click();
    const reach = page.locator('#lx-reach-sheet');
    await expect(page.locator('#lx-reach-what')).toHaveText(
      'WhatsApp no está disponible para 020 7946 0012: necesita el número con el prefijo del país (por ejemplo +34). Corrígelo en la ficha o llama por teléfono.',
    );
    await expect(page.locator('#lx-reach-go')).toHaveCount(0);
    await expect(page.locator(OUTGOING)).toHaveCount(0);
    await expect(page.locator('#lx-reach-cancel')).toHaveText('Cerrar');
    await expect(page.locator('#lx-reach-copy')).toBeVisible();
    await page.locator('#lx-reach-cancel').click();
    await expect(reach).toHaveCount(0);

    // A call still works, with the number as typed and the warning repeated.
    await page.locator('#lx-contact-reach-call').click();
    await expect(page.locator('#lx-reach-warning')).toContainText(
      'No sabemos el prefijo del país',
    );
    await expect(page.locator('#lx-reach-go')).toHaveAttribute(
      'href',
      'tel:02079460012',
    );
    expect(await opened(page)).toEqual([]);
  });

  test('desktop: «Copiar número» comes first and says it copied', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openPerson(page, 'p1');
    const tiles = page.locator('#lx-contact-reach .lx-reach__btn');
    await expect(tiles).toHaveCount(4);
    await expect(tiles.first()).toHaveAttribute('id', 'lx-contact-reach-copy');
    await expect(tiles.first()).toHaveClass(/lx-reach__btn--lead/);
    await page.locator('#lx-contact-reach-copy').click();
    await expect(
      page.getByRole('status').filter({hasText: 'Número copiado'}),
    ).toContainText('Número copiado: +34 000 00 00 11');
    expect(await copied(page)).toEqual(['+34 000 00 00 11']);
    expect(await opened(page)).toEqual([]);
  });
});

test.describe('Gestor logístico · Contactos · compartir', () => {
  test('only the chosen fields; notes and descriptions are never offered', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openPerson(page, 'p1');
    await page.locator('#lx-contact-share').click();
    const sheet = page.locator('#lx-share-sheet');
    await expect(sheet).toBeVisible();

    const fields = await page
      .locator('#lx-share-fields input[type="checkbox"]')
      .evaluateAll(els => els.map(el => el.id));
    expect(fields).toEqual([
      'lx-share-field-name',
      'lx-share-field-role',
      'lx-share-field-company',
      'lx-share-field-phone',
      'lx-share-field-email',
    ]);
    await expect(page.locator('#lx-share-fields')).not.toContainText(
      /Descripción|Observaciones/,
    );
    await expect(sheet).not.toContainText('DESCRIPCION-PRIVADA-ANA');
    await expect(sheet).not.toContainText('NOTA-PRIVADA-ANA');

    // Name and phone by default.
    const preview = page.locator('#lx-share-preview');
    await expect(preview).toHaveText('Ana Prueba\nTeléfono: +34 000 000 011');

    await page.locator('#lx-share-field-phone').click();
    await page.locator('#lx-share-field-role').click();
    await page.locator('#lx-share-field-email').click();
    const text = 'Ana Prueba · Jefa de montaje\nCorreo: ana.prueba@example.com';
    await expect(preview).toHaveText(text);
    await page.locator('#lx-share-copy').click();
    await expect(
      page.getByRole('status').filter({hasText: 'Ficha copiada'}),
    ).toBeVisible();
    expect(await copied(page)).toEqual([text]);
    await expect(page.locator('#lx-share-whatsapp')).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent(text)}`,
    );

    // Nothing chosen: nothing to send.
    for (const f of ['name', 'role', 'email']) {
      await page.locator(`#lx-share-field-${f}`).click();
    }
    await expect(preview).toHaveText('Elige al menos un dato.');
    await expect(page.locator('#lx-share-copy')).toBeDisabled();
    await expect(page.locator('a#lx-share-whatsapp')).toHaveCount(0);
    expect(await opened(page)).toEqual([]);
  });

  test('a person with only a name has nothing to share', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openPerson(page, 'p3');
    await expect(page.locator('#lx-contact-share')).toHaveCount(0);
  });
});

test.describe('Gestor logístico · Empresas y entidades', () => {
  test('the sheet shows kind, categories, responsible person, people, offers and tasks', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-tab-companies').click();
    const row = companyRow(page, 'c1');
    await expect(row).toContainText('Proveedor');
    await expect(row).toContainText('Montaje, Estructuras');
    await expect(row).toContainText('2 personas · 3 ofertas');
    await expect(companyRow(page, 'c3')).toContainText('Organismo público');

    await row.locator('.lx-dirrow__main').click();
    const sheet = page.locator('#lx-company-sheet');
    await expect(sheet).toContainText('Escenarios Prueba');
    await expect(sheet).toContainText('Montaje, Estructuras');
    await expect(page.locator('#lx-company-main')).toContainText(
      'Persona responsable',
    );
    await expect(page.locator('#lx-company-main')).toContainText('Ana Prueba');
    await expect(page.locator('#lx-company-main')).toContainText(
      'Jefa de montaje',
    );

    const people = page.locator('#lx-company-people .lx-linkrow');
    await expect(people).toHaveCount(2);
    await expect(people.nth(0)).toContainText('Ana Prueba');
    await expect(people.nth(0)).toContainText('Responsable');
    await expect(people.nth(1)).toContainText('Carla Prueba');
    await expect(people.nth(1)).toContainText('Montadora');

    const offers = page.locator('#lx-company-offers .lx-linkrow');
    await expect(offers).toHaveCount(3);
    await expect(
      offers.filter({hasText: 'Carpa Prueba 6 × 3 m'}),
    ).toContainText('180 € / día');
    await expect(
      offers.filter({hasText: 'Carpa Prueba 3 × 3 m'}),
    ).toContainText('Precio pendiente');
    await expect(page.locator('#lx-company-tasks')).toContainText(
      'Montaje del escenario',
    );
    // Team notes are shown to members, but never as a link to share.
    await expect(page.locator('#lx-company-detail')).toContainText(
      'NOTA-EMPRESA-PRIVADA',
    );

    // From the company to one of its people.
    await people.nth(1).click();
    await expect(page.locator('#lx-contact-sheet')).toContainText(
      'Carla Prueba',
    );
  });

  test('editing: kind, categories with «Nueva categoría», responsible among its people', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompany(page, 'c1');
    await page.locator('#lx-company-edit').click();
    await expect(page.locator('#lx-company-form')).toBeVisible();

    await page.locator('#lx-company-kind-public_body').click();
    await page.locator('#lx-company-cat-new').click();
    await expect(page.locator('#lx-company-cat-name')).toBeFocused();
    await page.locator('#lx-company-cat-name').fill('Aseos portátiles Prueba');
    // Enter adds the category; it does not submit the form.
    await page.keyboard.press('Enter');
    await expect.poll(() => api.calls('POST', '/categories').length).toBe(1);
    expect(lastBody(api, 'POST', '/categories')).toMatchObject({
      name: 'Aseos portátiles Prueba',
      scope: 'service',
    });
    expect(api.calls('PATCH', '/companies/c1')).toHaveLength(0);
    const created = api.categories.find(
      c => c.name === 'Aseos portátiles Prueba',
    )!;
    await expect(page.locator(`#lx-company-cat-${created.id}`)).toBeChecked();
    await page.locator(`#lx-company-cat-${CAT.carpas}`).click();

    // Only the company's own people can be responsible.
    await expectValue(page, 'lx-company-mainContactId', 'p1');
    expect(await optionLabels(page, 'lx-company-mainContactId')).toEqual([
      'Sin persona responsable',
      'Ana Prueba · Jefa de montaje',
      'Carla Prueba · Montadora',
    ]);
    await choose(page, 'lx-company-mainContactId', 'p4');
    await page.locator('#lx-company-save').click();

    await expect.poll(() => api.calls('PATCH', '/companies/c1').length).toBe(1);
    const body = lastBody(api, 'PATCH', '/companies/c1');
    expect(body).toEqual({
      version: 1,
      kind: 'public_body',
      categoryIds: [CAT.montaje, CAT.estructuras, CAT.carpas, created.id],
      mainContactId: 'p4',
    });
    // Back to the card, with the new values.
    await expect(page.locator('#lx-company-edit')).toBeVisible();
    await expect(page.locator('#lx-company-sheet')).toContainText(
      'Organismo público',
    );
    await expect(page.locator('#lx-company-main')).toContainText(
      'Carla Prueba',
    );
    await expect(page.locator('#lx-company-detail')).toContainText(
      'Aseos portátiles Prueba',
    );
  });

  test('deleting explains the consequences first', async ({page}) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompany(page, 'c1');
    await page.locator('#lx-company-edit').click();
    await page.locator('#lx-company-delete').click();
    await expect(page.locator('#lx-company-delete-text')).toHaveText(
      '¿Borrar «Escenarios Prueba»?',
    );
    await expect(page.locator('#lx-company-delete-detail')).toHaveText(
      'Se borrarán sus 3 ofertas del catálogo. 2 personas se quedarán sin empresa. 1 tarea perderá la empresa responsable. No se puede deshacer.',
    );
    await page.locator('#lx-company-delete-keep').click();
    expect(api.calls('DELETE', '/companies/c1')).toHaveLength(0);

    await page.locator('#lx-company-delete').click();
    await page.locator('#lx-company-delete-confirm').click();
    await expect(page.locator('#lx-company-sheet')).toHaveCount(0);
    const del = api.calls('DELETE', '/companies/c1');
    expect(del).toHaveLength(1);
    expect(del[0].query).toBe('?version=1');
    // Its people stay, without the company.
    await page.locator('#lx-contacts-tab-people').click();
    await expect(personRow(page, 'p1')).not.toContainText('Escenarios Prueba');
    await expect(personRow(page, 'p1')).toContainText('Jefa de montaje');
  });

  test('a name already used: 409 DUPLICATE offers «Abrir la existente»', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('#lx-contacts-tab-companies').click();
    await page.locator('#lx-contacts-add').click();
    await page.locator('#lx-company-name').fill('ESCENARIOS PRUEBA');
    await expect(page.locator('#lx-company-lookalike')).toContainText(
      '¿Es la misma que «Escenarios Prueba» · Proveedor?',
    );
    await page.locator('#lx-company-save').click();
    const dup = page.locator('#lx-company-duplicate');
    await expect(dup).toContainText('Ya existe «Escenarios Prueba»');
    await expect(dup).toContainText('No se ha guardado');
    expect(api.companies).toHaveLength(3);
    await page.locator('#lx-company-open-existing').click();
    await expect(page.locator('#lx-company-form')).toHaveCount(0);
    await expect(page.locator('#lx-company-main')).toContainText('Ana Prueba');
  });

  test('a stale version: 409 merges, keeps mine on the clash, discard loads theirs', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompany(page, 'c2');
    await page.locator('#lx-company-edit').click();
    await page.locator('#lx-company-phone').fill('+34 000 000 021');
    // Meanwhile Dailos saves the same company.
    api.editDirectoryOnServer('companies', 'c2', {
      phone: '+34 000 000 022',
      website: 'sonido.example.com',
    });
    await page.locator('#lx-company-save').click();

    const conflict = page.locator('#lx-company-conflict');
    await expect(conflict).toBeVisible();
    // M5: «Ver versión actual» became «Descartar mis cambios» (same id).
    await expect(page.locator('#lx-company-load-current')).toHaveText(
      'Descartar mis cambios',
    );
    // Nothing overwritten: the server keeps Dailos's copy, the form keeps ours.
    const server = api.companies.find(c => c.id === 'c2')!;
    expect(server.phone).toBe('+34 000 000 022');
    expect(server.version).toBe(2);
    expect(api.calls('PATCH', '/companies/c2')).toHaveLength(1);
    await expect(page.locator('#lx-company-phone')).toHaveValue(
      '+34 000 000 021',
    );
    // M5: the website only Dailos changed is taken; the phone both changed
    // is a clash with mine kept, and «Guardar» stays available.
    await expect(page.locator('#lx-company-merge-theirs')).toContainText('Web');
    await expect(page.locator('#lx-company-website')).toHaveValue(
      'sonido.example.com',
    );
    await expect(page.locator('#lx-company-clash-phone-mine')).toBeChecked();
    await expect(page.locator('#lx-company-save')).toBeEnabled();

    await page.locator('#lx-company-load-current').click();
    await expect(page.locator('#lx-company-current-loaded')).toBeVisible();
    await expect(page.locator('#lx-company-phone')).toHaveValue(
      '+34 000 000 022',
    );
    await expect(page.locator('#lx-company-website')).toHaveValue(
      'sonido.example.com',
    );
    // Saving again goes with the current version.
    await page.locator('#lx-company-phone').fill('+34 000 000 023');
    await page.locator('#lx-company-save').click();
    await expect.poll(() => api.calls('PATCH', '/companies/c2').length).toBe(2);
    expect(lastBody(api, 'PATCH', '/companies/c2')).toEqual({
      version: 2,
      phone: '+34 000 000 023',
    });
  });
});
