import {expect, test, type Page} from '@playwright/test';
import {
  demoEvent,
  makeCompany,
  makeContact,
  makeOffer,
  mockApi,
  signIn,
  signInAgain,
} from './mock-api';
import {lxUrl, lxUrlRe} from './address';
import {DAY, fixClock} from './plan-fixtures';
import {choose, expectValue, optionGroups} from './controls';
import {
  WITHHELD,
  directoryData,
  opened,
  trapOutgoing,
} from './directory-fixtures';

/**
 * Gestor logístico, milestone 3 across the app: the guest (Invitado) never
 * sees what is withheld, a task's «Persona de contacto», «+ Añadir» with the
 * new records, Contactos and Catálogo on a phone, and removing demo people,
 * companies and offers.
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
  await trapOutgoing(page);
});

const PHONE = {width: 390, height: 844};
const OUTGOING = 'a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]';

/** Fails if any withheld value is in the page's markup or visible text. */
async function expectNothingWithheld(page: Page) {
  // The module's markup (sheets and toasts included), not the page's styles.
  const html = await page
    .locator('#logistics-app')
    .evaluate(el => el.outerHTML);
  for (const v of [...WITHHELD.phones, ...WITHHELD.emails, ...WITHHELD.notes]) {
    expect(html, `withheld «${v}» in the DOM`).not.toContain(v);
  }
  // Prices only in the visible text (SVG paths are full of digits).
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\d\s?€/);
  await expect(page.locator(OUTGOING)).toHaveCount(0);
}

// E4: the guest account has no `directory.read`: Contactos and Catálogo say
// why they are locked, and no person, company or offer reaches the page.
test.describe('Gestor logístico · directorio para el invitado', () => {
  test('Contactos and Catálogo are locked with the reason; nothing is asked for', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page, 'Invitado', lxUrl('contactos'));
    await expect(page.locator('#lx-readonly')).toBeVisible();
    await expect(page.locator('#lx-contactos-noaccess')).toContainText(
      'contienen datos de personas y precios',
    );
    await expect(page.locator('[data-contact-id="p1"]')).toHaveCount(0);
    await expect(page.locator('#lx-contacts-add')).toHaveCount(0);
    await expectNothingWithheld(page);

    await page.locator('#lx-nav-catalogo').click();
    await expect(page.locator('#lx-catalogo-noaccess')).toBeVisible();
    await expect(page.locator('.lx-offerrow')).toHaveCount(0);
    await expectNothingWithheld(page);
    expect(
      api.requests.filter(r => /\/(contacts|companies|offers)$/.test(r.path)),
    ).toEqual([]);
    expect(
      api.requests.filter(r => r.method !== 'GET' && r.path !== '/auth/login'),
    ).toEqual([]);
  });

  test('after a member logs out, the guest does not inherit their data', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await page.locator('[data-contact-id="p1"] .lx-dirrow__main').click();
    await expect(page.locator('#lx-contact-detail')).toContainText(
      'ana.prueba@example.com',
    );
    await page.keyboard.press('Escape');
    await page.locator('#lx-logout').click();
    await signInAgain(page, 'Invitado');
    await page.locator('#lx-nav-contactos').click();
    await expect(page.locator('#lx-contactos-noaccess')).toBeVisible();
    await expect(page.locator('[data-contact-id="p1"]')).toHaveCount(0);
    await expectNothingWithheld(page);
    await page.locator('#lx-nav-catalogo').click();
    await expect(page.locator('#lx-catalogo-noaccess')).toBeVisible();
    await expect(page.locator('.lx-offerrow')).toHaveCount(0);
    await expectNothingWithheld(page);
  });
});

test.describe('Gestor logístico · persona de contacto de una tarea', () => {
  test('the company’s people come first; contactId is sent and shown on the task', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await page.locator('#lx-task-title').fill('Revisar carpas');
    await page.locator('#lx-task-company').fill('Escenarios Prueba');
    const groups = await optionGroups(page, 'lx-task-contact');
    expect(groups).toEqual([
      {
        label: 'De Escenarios Prueba',
        options: ['Ana Prueba · Jefa de montaje', 'Carla Prueba · Montadora'],
      },
      {
        label: 'Otras personas',
        options: [
          'Bruno Prueba · Técnico de sonido · Sonido Prueba',
          'Íñigo Prueba',
        ],
      },
    ]);
    await choose(page, 'lx-task-contact', 'p4');
    await page.locator('#lx-task-save').click();
    await expect(page.locator('#lx-task-sheet')).toHaveCount(0);
    const body = api.calls('POST', '/tasks')[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Revisar carpas',
      companyName: 'Escenarios Prueba',
      contactId: 'p4',
      date: DAY,
    });
    const row = page.locator('#lx-today-tasks .lx-taskrow', {
      hasText: 'Revisar carpas',
    });
    await expect(row.locator('.lx-taskrow__contact')).toHaveText(
      'Carla Prueba',
    );
  });

  test('choosing a person fills an empty company; the person can be reached and opened', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page);
    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await page.locator('#lx-task-title').fill('Prueba de sonido');
    await choose(page, 'lx-task-contact', 'p2');
    await expect(page.locator('#lx-task-company')).toHaveValue('Sonido Prueba');
    // Reaching from the form confirms first, too.
    await page.locator('#lx-task-contact-reach-call').click();
    await expect(page.locator('#lx-reach-sheet')).toBeVisible();
    await page.keyboard.press('Enter');
    expect(await opened(page)).toEqual([]);
    await page.locator('#lx-reach-cancel').click();
    await page.locator('#lx-task-save').click();
    await expect.poll(() => api.calls('POST', '/tasks').length).toBe(1);
    expect(api.calls('POST', '/tasks')[0].body).toMatchObject({
      contactId: 'p2',
      companyName: 'Sonido Prueba',
    });
  });

  test('a task without a person sends no contactId; an existing one shows it', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page);
    await expect(
      page.locator('#lx-today-tasks [data-task-id="t1"] .lx-taskrow__contact'),
    ).toHaveText('Ana Prueba');
    await page.locator('#lx-today-tasks [data-task-id="t1"]').click();
    await expectValue(page, 'lx-task-contact', 'p1');
    await page.locator('#lx-task-contact-open').click();
    await expect(page.locator('#lx-contact-sheet')).toBeVisible();
    await expect(page.locator('#lx-contact-tasks')).toContainText(
      'Montaje del escenario',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.locator('#lx-add').click();
    await page.locator('#lx-add-task').click();
    await page.locator('#lx-task-title').fill('Sin persona');
    await page.locator('#lx-task-save').click();
    await expect.poll(() => api.calls('POST', '/tasks').length).toBe(1);
    expect(api.calls('POST', '/tasks')[0].body).not.toHaveProperty('contactId');
  });

  test('removing the person from a task sends contactId null', async ({
    page,
  }) => {
    const api = await mockApi(page, directoryData());
    await signIn(page);
    await page.locator('#lx-today-tasks [data-task-id="t1"]').click();
    await choose(page, 'lx-task-contact', '');
    await page.locator('#lx-task-save').click();
    await expect.poll(() => api.calls('PATCH', '/tasks/t1').length).toBe(1);
    expect(api.calls('PATCH', '/tasks/t1')[0].body).toEqual({
      version: 1,
      contactId: null,
    });
    await expect(
      page.locator('#lx-today-tasks [data-task-id="t1"] .lx-taskrow__contact'),
    ).toHaveCount(0);
  });
});

test.describe('Gestor logístico · «+ Añadir» persona, empresa, oferta', () => {
  test('desktop: each option opens its form with the name focused', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page);
    const cases = [
      ['contact', '#lx-contact-form', '#lx-contact-name', 'Añadir persona'],
      [
        'company',
        '#lx-company-form',
        '#lx-company-name',
        'Añadir empresa o entidad',
      ],
      ['offer', '#lx-offer-form', '#lx-offer-name', 'Añadir oferta'],
    ] as const;
    for (const [id, form, field, title] of cases) {
      await page.locator('#lx-add').click();
      await page.locator(`#lx-add-${id}`).click();
      await expect(page.locator(form)).toBeVisible();
      await expect(page.locator(field)).toBeFocused();
      await expect(page.getByRole('dialog').last()).toContainText(title);
      await page.keyboard.press('Escape');
      await expect(page.locator(form)).toHaveCount(0);
      await expect(page.locator('#lx-add')).toBeFocused();
    }
  });

  test('phone: the floating «Añadir» offers the five records within reach', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await mockApi(page, directoryData());
    await signIn(page);
    const fab = page.locator('#lx-fab');
    for (const id of ['contact', 'company', 'offer'] as const) {
      await fab.click();
      for (const item of ['event', 'task', 'contact', 'company', 'offer']) {
        await expect(page.locator(`#lx-fab-${item}`)).toBeInViewport();
      }
      await page.locator(`#lx-fab-${id}`).click();
      await expect(page.locator(`#lx-${id}-form`)).toBeVisible();
      await expect(page.locator(`#lx-${id}-save`)).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(page.locator(`#lx-${id}-form`)).toHaveCount(0);
    }
  });
});

/** A horizontal touch swipe on the content area (same as calendar.spec). */
async function swipe(page: Page, from: number, to: number) {
  await page.locator('#lx-main').evaluate(
    (el, [a, b]) => {
      const at = (x: number): PointerEventInit => ({
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: 300,
      });
      el.dispatchEvent(new PointerEvent('pointerdown', at(a)));
      el.dispatchEvent(
        new PointerEvent('pointermove', at(a + (b > a ? 20 : -20))),
      );
      el.dispatchEvent(new PointerEvent('pointermove', at(b)));
      el.dispatchEvent(new PointerEvent('pointerup', at(b)));
    },
    [from, to],
  );
}

async function minSize(page: Page, selector: string) {
  return page.locator(selector).evaluateAll(els =>
    els.map(el => {
      const r = el.getBoundingClientRect();
      return {id: el.id || el.className, w: r.width, h: r.height};
    }),
  );
}

test.describe('Gestor logístico · Contactos y Catálogo en el móvil', () => {
  test.use({viewport: PHONE, hasTouch: true});

  test('tabs, rows and reaching someone with one hand', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page);
    await page.locator('#lx-tab-contactos').click();
    await expect(page.locator('#lx-space-contactos')).toBeVisible();
    await page.locator('#lx-contacts-tab-companies').click();
    await expect(page.locator('[data-company-id="c1"]')).toBeVisible();
    // Arrow keys move between the two segments too.
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#lx-contacts-tab-people')).toBeFocused();
    await expect(page.locator('#lx-contacts-tab-people')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    for (const t of await minSize(
      page,
      '.lx-segtabs__tab, .lx-quickcall, .lx-dirrow__main',
    )) {
      expect(t.h, `${t.id} height`).toBeGreaterThanOrEqual(44);
      expect(t.w, `${t.id} width`).toBeGreaterThanOrEqual(44);
    }

    await page.locator('[data-contact-id="p1"] .lx-dirrow__main').click();
    const tiles = page.locator('#lx-contact-reach .lx-reach__btn');
    await expect(tiles.first()).toBeInViewport();
    for (const t of await minSize(page, '#lx-contact-reach .lx-reach__btn')) {
      expect(t.h, `${t.id} height`).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#lx-contact-reach-call').click();
    await expect(page.locator('#lx-reach-go')).toBeInViewport();
    for (const t of await minSize(page, '#lx-reach-go, #lx-reach-cancel')) {
      expect(t.h, `${t.id} height`).toBeGreaterThanOrEqual(44);
    }
    expect(await opened(page)).toEqual([]);
  });

  test('swipe between Contactos and Catálogo still works', async ({page}) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await expect(page.locator('#lx-space-contactos')).toBeVisible();
    await swipe(page, 320, 80);
    await expect(page).toHaveURL(lxUrlRe('catalogo'));
    await expect(page.locator('#lx-space-catalogo')).toBeVisible();
    await swipe(page, 80, 320);
    await expect(page).toHaveURL(lxUrlRe('contactos'));
  });

  test('Catálogo: the category strip filters and rows are easy to tap', async ({
    page,
  }) => {
    await mockApi(page, directoryData());
    await signIn(page, 'Elvis', lxUrl('catalogo'));
    await expect(page.locator('#lx-space-catalogo')).toBeVisible();
    const strip = page.locator('#lx-catalog-filters');
    await expect(strip).toBeVisible();
    await strip.locator('.lx-filterchip', {hasText: 'Sonido'}).click();
    await expect(page.locator('.lx-offerrow')).toHaveCount(1);
    for (const t of await minSize(page, '.lx-offerrow, .lx-filterchip')) {
      expect(t.h, `${t.id} height`).toBeGreaterThanOrEqual(44);
    }
    // The page itself never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator('.lx-offerrow').first().click();
    await expect(page.locator('#lx-offer-price')).toBeInViewport();
  });
});

test.describe('Gestor logístico · quitar la demo del directorio', () => {
  test('demo people, companies and offers go; real records are unlinked', async ({
    page,
  }) => {
    const data = directoryData();
    const demoCompany = makeCompany('c-demo', 'Escenarios Demo', {
      isDemo: true,
      mainContactId: 'p-demo',
    });
    const usedDemoCompany = makeCompany('c-demo-used', 'Concejalía Demo', {
      isDemo: true,
    });
    const realCompany = makeCompany('c-real', 'Carpas Prueba', {
      mainContactId: 'p-demo',
    });
    const api = await mockApi(page, {
      ...data,
      events: [...(data.events ?? []), demoEvent()],
      companies: [
        ...(data.companies ?? []),
        demoCompany,
        usedDemoCompany,
        realCompany,
      ],
      contacts: [
        ...(data.contacts ?? []),
        makeContact('p-demo', 'Ana Demo', {
          isDemo: true,
          company: {id: 'c-demo', name: 'Escenarios Demo'},
          phone: '+34 000 000 001',
        }),
        // Real person linked to the demo event and a demo company.
        makeContact('p-real', 'Rita Prueba', {
          eventIds: ['e1', 'e-demo'],
          company: {id: 'c-demo-used', name: 'Concejalía Demo'},
        }),
      ],
      offers: [
        ...(data.offers ?? []),
        makeOffer(
          'o-demo',
          'Carpa Demo',
          {id: 'c-demo', name: 'Escenarios Demo'},
          {isDemo: true},
        ),
      ],
    });
    await signIn(page);
    await page.locator('#lx-demo-remove').click();
    await page.locator('#lx-demo-confirm-button').click();
    await expect(page.locator('#lx-demo-notice')).toHaveCount(0);
    // Event, person, offer and the unused demo company: 4 records.
    await expect(
      page.getByRole('status').filter({hasText: 'demostración'}),
    ).toContainText('Se han quitado 4 registros de demostración.');

    expect(api.contacts.map(c => c.id)).not.toContain('p-demo');
    expect(api.offers.map(o => o.id)).not.toContain('o-demo');
    expect(api.companies.map(c => c.id)).not.toContain('c-demo');
    // Still used by a real person: kept.
    expect(api.companies.map(c => c.id)).toContain('c-demo-used');
    const rita = api.contacts.find(c => c.id === 'p-real')!;
    expect(rita.eventIds).toEqual(['e1']);
    expect(rita.version).toBe(2);
    const carpas = api.companies.find(c => c.id === 'c-real')!;
    expect(carpas.mainContactId).toBeNull();
    expect(carpas.version).toBe(2);

    await page.locator('#lx-nav-contactos').click();
    await expect(page.locator('[data-contact-id="p-demo"]')).toHaveCount(0);
    await expect(page.locator('[data-contact-id="p-real"]')).toBeVisible();
    await page.locator('#lx-nav-catalogo').click();
    await expect(
      page.locator('.lx-offerrow[data-offer-id="o-demo"]'),
    ).toHaveCount(0);
  });
});
