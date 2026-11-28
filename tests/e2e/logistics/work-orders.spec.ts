import {expect, test, type Page} from '@playwright/test';
import {
  mailtoHref,
  phoneInfo,
  whatsappHref,
} from '../../../shared/logistics/contact-links.ts';
import {WORK_ORDER_NEVER_NOTE} from '../../../shared/logistics/work-order.ts';
import {lxUrl} from './address';
import {addDays, makeTask, mockApi, signIn} from './mock-api';
import {DAY, PLAZA_CRISTO, fixClock} from './plan-fixtures';
import {copied, opened, trapOutgoing} from './directory-fixtures';
import {
  ESCENARIOS,
  ORDER_PRICES,
  ORDER_PRIVATE,
  followData,
  followTasks,
  openHypothesis,
} from './followup-fixtures';

/**
 * Gestor logístico, milestone 5: work orders per company or person. Members
 * only; by default no free text the team keeps to itself (observations,
 * phone, warehouse address, resource location) and never people's notes and
 * descriptions, offer conditions, note text or prices; members-only fields
 * only when ticked; the routes A/B/C and Carpa Amarilla reminder for a
 * delivery during the event; nothing leaves the page before the send sheet's
 * own button; print through `window.print`; never a hypothesis. Fixed clock
 * and fictitious data (followup-fixtures.ts).
 */

test.use({locale: 'es-ES', timezoneId: 'Atlantic/Canary'});
test.beforeEach(async ({page}) => {
  await fixClock(page);
  await trapOutgoing(page);
});

const OUTGOING = 'a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]';
const ORDER_TITLE = 'Orden de trabajo · Escenarios Demo';

/** Every marker that must not be in a default order. */
const DEFAULT_NEVER = [...Object.values(ORDER_PRIVATE), ...ORDER_PRICES];
/** Markers that must never be in an order, whatever is ticked. */
const ALWAYS_NEVER = [
  ORDER_PRIVATE.companyNotes,
  ORDER_PRIVATE.resourceNotes,
  ORDER_PRIVATE.personNotes,
  ORDER_PRIVATE.personDescription,
  ORDER_PRIVATE.offerConditions,
  ORDER_PRIVATE.noteText,
  ORDER_PRIVATE.hypothesisNote,
  ...ORDER_PRICES,
];

async function openCompanyOrder(page: Page, id = ESCENARIOS.id) {
  await page.locator('#lx-contacts-tab-companies').click();
  await page.locator(`[data-company-id="${id}"] .lx-dirrow__main`).click();
  await expect(page.locator('#lx-company-sheet')).toBeVisible();
  await page.locator('#lx-company-work-order').click();
  await expect(page.locator('#lx-order-sheet')).toBeVisible();
}

async function openPersonOrder(page: Page, id: string) {
  await page.locator(`[data-contact-id="${id}"] .lx-dirrow__main`).click();
  await expect(page.locator('#lx-contact-sheet')).toBeVisible();
  await page.locator('#lx-contact-work-order').click();
  await expect(page.locator('#lx-order-sheet')).toBeVisible();
}

/** The order's text exactly as it would be sent (copied from the sheet). */
async function orderText(page: Page): Promise<string> {
  await page.locator('#lx-order-send').click();
  await expect(page.locator('#lx-order-send-sheet')).toBeVisible();
  await page.locator('#lx-order-send-copy').click();
  await expect.poll(async () => (await copied(page)).length).toBeGreaterThan(0);
  return (await copied(page)).at(-1)!;
}

const field = (page: Page, id: string) => page.locator(`#lx-order-field-${id}`);

test.describe('Gestor logístico · órdenes de trabajo', () => {
  test('the guest has no work-order entry', async ({page}) => {
    await mockApi(page, followData());
    // E4: no Contactos for the guest, so no company or person to start from.
    await signIn(page, 'Invitado', lxUrl('contactos'));
    await expect(page.locator('#lx-contactos-noaccess')).toBeVisible();
    await expect(
      page.locator(`[data-company-id="${ESCENARIOS.id}"]`),
    ).toHaveCount(0);
    await expect(page.locator('#lx-company-work-order')).toHaveCount(0);
    await expect(page.locator('#lx-contact-work-order')).toHaveCount(0);
  });

  test('defaults: the plan basics only, no private text, no prices', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);

    for (const on of [
      'schedule',
      'venue',
      'materials',
      'contact',
      'dependencies',
    ]) {
      await expect(field(page, on), on).toBeChecked();
    }
    for (const off of [
      'contactPhone',
      'warehouseAddress',
      'resourceLocation',
      'observations',
    ]) {
      await expect(field(page, off), off).not.toBeChecked();
    }
    await expect(page.locator('#lx-order-never')).toHaveText(
      WORK_ORDER_NEVER_NOTE,
    );
    await expect(page.locator('#lx-order-task-h1')).toBeChecked();
    await expect(page.locator('#lx-order-task-h9')).toBeChecked();

    const preview = page.locator('#lx-order-preview');
    await expect(preview).toContainText('Escenarios Demo');
    await expect(preview).toContainText('Montaje del escenario Demo');
    await expect(preview).toContainText('09:00–13:00');
    await expect(preview).toContainText('Plaza del Cristo');
    await expect(preview).toContainText('Tarima Demo');
    await expect(preview).toContainText('Almacén Demo Norte');
    await expect(preview).toContainText('Ana Demo');
    await expect(preview).toContainText('Carga pesada');
    // h9 is only planned: its time is marked «por confirmar».
    await expect(
      preview
        .locator('.lx-order__item')
        .filter({hasText: 'Entrega de generador'}),
    ).toContainText('por confirmar');
    await expect(
      preview
        .locator('.lx-order__item')
        .filter({hasText: 'Montaje del escenario'}),
    ).not.toContainText('por confirmar');

    const html = (await preview.textContent()) ?? '';
    for (const marker of DEFAULT_NEVER) {
      expect(html, marker).not.toContain(marker);
    }
    // The company gets no subsoil wording (that is the team's check).
    expect(html).not.toMatch(/subsuelo/i);

    const text = await orderText(page);
    expect(text.startsWith(`${ORDER_TITLE}\n`)).toBe(true);
    expect(text).toContain('Montaje del escenario Demo (montaje)');
    for (const marker of DEFAULT_NEVER) {
      expect(text, marker).not.toContain(marker);
    }
    expect(text).not.toMatch(/subsuelo/i);
  });

  test('members-only fields appear only when ticked; the rest never', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    const preview = page.locator('#lx-order-preview');
    const extra: [string, string][] = [
      ['contactPhone', ORDER_PRIVATE.contactPhone],
      ['warehouseAddress', ORDER_PRIVATE.warehouseAddress],
      ['resourceLocation', ORDER_PRIVATE.resourceLocation],
      ['observations', ORDER_PRIVATE.observations],
    ];
    for (const [id, marker] of extra) {
      await expect(preview, id).not.toContainText(marker);
      await field(page, id).check();
      await expect(preview, id).toContainText(marker);
    }
    const all = (await preview.textContent()) ?? '';
    for (const marker of ALWAYS_NEVER) {
      expect(all, marker).not.toContain(marker);
    }
    const text = await orderText(page);
    for (const [, marker] of extra) expect(text).toContain(marker);
    for (const marker of ALWAYS_NEVER) expect(text).not.toContain(marker);

    // Unticking takes them out again.
    await page.locator('#lx-order-send-cancel').click();
    for (const [id, marker] of extra) {
      await field(page, id).uncheck();
      await expect(preview, id).not.toContainText(marker);
    }
  });

  test('a delivery during the event carries the routes reminder', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    const routes = page.locator('#lx-order-preview .lx-order__routes');
    await expect(routes).toContainText('A (acceso de vehículos)');
    await expect(routes).toContainText('B (sanitarios a pie)');
    await expect(routes).toContainText('C (evacuación en camilla)');
    await expect(routes).toContainText('Carpa Amarilla');
    const text = await orderText(page);
    expect(text).toContain('Carpa Amarilla');
    await page.locator('#lx-order-send-cancel').click();
    // Without the delivery (h1 is assembly in the morning) there is none.
    await page.locator('#lx-order-task-h9').uncheck();
    await expect(routes).toHaveCount(0);
  });

  test('days: today by default, another day, all', async ({page}) => {
    const tasks = [
      ...followTasks(),
      makeTask(
        'h11',
        'Desmontaje del escenario Demo',
        {date: addDays(DAY, 1), start: '09:00', end: '12:00'},
        {
          kind: 'dismantling',
          venue: {...PLAZA_CRISTO},
          company: {...ESCENARIOS},
        },
      ),
    ];
    await mockApi(page, followData({tasks}));
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    await expect(page.locator(`#lx-order-day-${DAY}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#lx-order-task-h11')).toHaveCount(0);
    await page.locator(`#lx-order-day-${addDays(DAY, 1)}`).click();
    await expect(page.locator('#lx-order-task-h11')).toBeVisible();
    await expect(page.locator('#lx-order-task-h1')).toHaveCount(0);
    await expect(page.locator('#lx-order-preview')).toContainText(
      'Desmontaje del escenario Demo',
    );
    await page.locator('#lx-order-day-all').click();
    await expect(page.locator('#lx-order-tasks li')).toHaveCount(3);
  });

  test('nothing goes out before the send sheet, and Enter there opens nothing', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    await expect(page.locator(`#lx-order-sheet ${OUTGOING}`)).toHaveCount(0);
    await page.locator('#lx-order-send').click();
    const send = page.locator('#lx-order-send-sheet');
    await expect(send).toBeVisible();
    await expect(page.locator('#lx-order-send-what')).toBeFocused();
    await expect(page.locator('#lx-order-send-what')).toContainText(
      'no se abrirá nada hasta que pulses un botón',
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press(' ');
    await expect(send).toBeVisible();
    expect(await opened(page)).toEqual([]);
    expect(await copied(page)).toEqual([]);
  });

  test('after confirming: the exact WhatsApp and e-mail targets', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    // One task keeps the links short (no copy step).
    await page.locator('#lx-order-task-h9').uncheck();
    const text = await orderText(page);

    const wa = whatsappHref(phoneInfo('+34 000 000 001')!, text)!;
    const mail = mailtoHref('escenarios@example.com', ORDER_TITLE, text);
    expect(wa.startsWith('https://wa.me/34000000001?text=')).toBe(true);
    expect(wa.length).toBeLessThanOrEqual(1800);
    expect(mail.length).toBeLessThanOrEqual(1800);
    await expect(page.locator('#lx-order-send-whatsapp-what')).toContainText(
      'Se abrirá WhatsApp con',
    );
    await expect(page.locator('#lx-order-send-whatsapp')).toHaveAttribute(
      'href',
      wa,
    );
    await expect(page.locator('#lx-order-send-mail')).toHaveAttribute(
      'href',
      mail,
    );
    await page.locator('#lx-order-send-whatsapp').click();
    expect(await opened(page)).toEqual([
      {href: wa, via: 'link', target: '_blank'},
    ]);
  });

  test('e-mail opens the mail program with subject and body', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    await page.locator('#lx-order-task-h9').uncheck();
    const text = await orderText(page);
    await page.locator('#lx-order-send-mail').click();
    expect((await opened(page)).at(-1)).toEqual({
      href: mailtoHref('escenarios@example.com', ORDER_TITLE, text),
      via: 'link',
      target: null,
    });
  });

  test('WhatsApp is disabled with its reason when there is no usable phone', async ({
    page,
  }) => {
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    // Bruno Demo: no phone, no e-mail; contact of h4 today.
    await openPersonOrder(page, 'p2');
    await expect(page.locator('#lx-order-preview')).toContainText(
      'Entrega de vallas Demo',
    );
    await page.locator('#lx-order-send').click();
    await expect(page.locator('#lx-order-send-whatsapp')).toBeDisabled();
    await expect(page.locator('#lx-order-send-whatsapp-what')).toHaveText(
      'No hay teléfono en la ficha.',
    );
    await expect(page.locator('#lx-order-send-mail-what')).toContainText(
      'la ficha no tiene correo',
    );
    await page.locator('#lx-order-send-whatsapp').click({force: true});
    expect(await opened(page)).toEqual([]);
  });

  test('print calls window.print and the print copy holds the order', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {__printed: number};
      w.__printed = 0;
      window.print = () => {
        w.__printed++;
      };
    });
    await mockApi(page, followData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    await page.locator('#lx-order-print').click();
    expect(
      await page.evaluate(
        () => (window as unknown as {__printed: number}).__printed,
      ),
    ).toBe(1);
    const copy = page.locator('body > .lx-print-root .lx-order');
    await expect(copy).toHaveCount(1);
    await expect(copy).toContainText('Montaje del escenario Demo');
    await expect(copy).toContainText('Generada por Elvis desde OxEye');
    await expect(page.locator('body > .lx-print-root')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // On paper only the copy shows.
    await page.emulateMedia({media: 'print'});
    await expect(page.locator('body > .lx-print-root')).toBeVisible();
    await expect(page.locator('#lx-order-sheet')).toBeHidden();
    await page.emulateMedia({media: 'screen'});
    // Closing the sheet takes the print copy away.
    await page.locator('#lx-order-close').click();
    await expect(page.locator('body > .lx-print-root')).toHaveCount(0);
  });

  test('a hypothesis never reaches the order', async ({page}) => {
    await mockApi(page, followData({hypotheses: [openHypothesis()]}));
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    const preview = page.locator('#lx-order-preview');
    // The plan's time, not the hypothetical 09:30–13:30.
    await expect(preview).toContainText('09:00–13:00');
    const all = (await preview.textContent()) ?? '';
    expect(all).not.toContain('09:30');
    expect(all).not.toMatch(/hip[óo]tesis|retraso/i);
    expect(all).not.toContain(ORDER_PRIVATE.hypothesisNote);
    const text = await orderText(page);
    expect(text).not.toContain('09:30');
    expect(text).not.toMatch(/hip[óo]tesis|retraso/i);
  });
});

test.describe('Gestor logístico · órdenes de trabajo largas', () => {
  /** Enough tasks for Escenarios today that no link can carry the text. */
  const longData = () =>
    followData({
      tasks: [
        ...followTasks(),
        ...Array.from({length: 14}, (_, i) =>
          makeTask(
            `hl${i}`,
            `Montaje de módulo de gradas número ${i + 1} con señalización`,
            {date: DAY, start: '07:00', end: '08:00'},
            {
              kind: 'assembly',
              venue: {id: 'v2', name: 'Plaza del Adelantado'},
              company: {...ESCENARIOS},
            },
          ),
        ),
      ],
    });

  test('WhatsApp: the text is copied first, then a short link opens', async ({
    page,
  }) => {
    await mockApi(page, longData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    await page.locator('#lx-order-send').click();
    await expect(page.locator('#lx-order-send-whatsapp-what')).toContainText(
      'al pulsar se copiará el texto',
    );
    await page.locator('#lx-order-send-whatsapp').click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    expect((await copied(page))[0].startsWith(ORDER_TITLE)).toBe(true);
    const viaCode = (await opened(page)).filter(o => o.via === 'window.open');
    expect(viaCode).toEqual([
      {
        href: whatsappHref(
          phoneInfo('+34 000 000 001')!,
          'Te envío la orden de trabajo: el texto está copiado, pégalo aquí.',
        ),
        via: 'window.open',
        target: null,
      },
    ]);
  });

  test('e-mail: copied first, then the short mailto opens from code', async ({
    page,
  }) => {
    // `trapOutgoing()` cannot see `location.href = 'mailto:…'` (the page's
    // location cannot be redefined), so listen to the browser's navigation
    // requests instead.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    const navigations: string[] = [];
    cdp.on('Page.frameRequestedNavigation', e => navigations.push(e.url));

    await mockApi(page, longData());
    await signIn(page, 'Elvis', lxUrl('contactos'));
    await openCompanyOrder(page);
    await page.locator('#lx-order-send').click();
    await expect(page.locator('#lx-order-send-mail-what')).toContainText(
      'al pulsar se copiará el texto',
    );
    await page.locator('#lx-order-send-mail').click();
    await expect.poll(async () => (await copied(page)).length).toBe(1);
    const short = mailtoHref(
      'escenarios@example.com',
      ORDER_TITLE,
      'El texto de la orden de trabajo está copiado: pégalo aquí.',
    );
    await expect
      .poll(() => navigations.filter(u => u.startsWith('mailto:')))
      .toEqual([short]);
    await expect(
      page.locator('.lx-toast').filter({hasText: 'Texto de la orden copiado'}),
    ).toBeVisible();
  });
});
