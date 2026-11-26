import type {Page} from '@playwright/test';
import {
  categoryId,
  makeCompany,
  makeContact,
  makeOffer,
  makeTask,
  type MockOptions,
} from './mock-api';
import {DAY, planEvents, planVenues} from './plan-fixtures';

/**
 * Fixtures for the milestone 3 specs (Contactos, Catálogo, universal search).
 * Fictitious data only: names with «Prueba», phones `+34 000 000 0XX`,
 * addresses `@example.com`. Use with `fixClock` from plan-fixtures.ts.
 *
 * Free-text fields carry marker words (`NOTA-…`, `DESCRIPCION-…`,
 * `CONDICION-…`) so a spec can assert they never reach a guest, a shared
 * card or a search subtitle.
 */

const stamp = {
  createdAt: '2026-12-01T09:00:00.000Z',
  updatedAt: '2026-12-01T09:00:00.000Z',
};

export const ESCENARIOS = {id: 'c1', name: 'Escenarios Prueba'};
export const SONIDO = {id: 'c2', name: 'Sonido Prueba'};
export const CONCEJALIA = {id: 'c3', name: 'Concejalía Prueba'};

export const CAT = {
  montaje: categoryId('Montaje'),
  estructuras: categoryId('Estructuras'),
  carpas: categoryId('Carpas'),
  sonido: categoryId('Sonido'),
};

/** Values a guest must never see anywhere in the DOM. */
export const WITHHELD = {
  phones: [
    '000 000 001',
    '000000001',
    '000 000 011',
    '000000011',
    '7946 0012',
    '79460012',
  ],
  emails: ['escenarios@example.com', 'ana.prueba@example.com'],
  notes: [
    'NOTA-EMPRESA-PRIVADA',
    'NOTA-PRIVADA-ANA',
    'DESCRIPCION-PRIVADA-ANA',
    'CONDICION-PRIVADA',
  ],
  prices: ['180', '210,50', '450', '60 €'],
};

export const dirCompanies = () => [
  makeCompany(ESCENARIOS.id, ESCENARIOS.name, {
    ...stamp,
    categoryIds: [CAT.montaje, CAT.estructuras],
    phone: '+34 000 000 001',
    email: 'escenarios@example.com',
    website: 'www.example.com',
    notes: 'NOTA-EMPRESA-PRIVADA: llegan por la calle de atrás.',
    mainContactId: 'p1',
    verification: 'validated',
    source: 'document',
  }),
  makeCompany(SONIDO.id, SONIDO.name, {
    ...stamp,
    categoryIds: [CAT.sonido],
  }),
  makeCompany(CONCEJALIA.id, CONCEJALIA.name, {
    ...stamp,
    kind: 'public_body',
  }),
];

/**
 * p1 Ana: complete, main contact of Escenarios, phone with +34.
 * p2 Bruno: a number without country code (no WhatsApp).
 * p3 Íñigo: only the name (accent search).
 * p4 Carla: a second person of Escenarios, no phone.
 */
export const dirContacts = () => [
  makeContact('p1', 'Ana Prueba', {
    ...stamp,
    role: 'Jefa de montaje',
    company: {...ESCENARIOS},
    phone: '+34 000 000 011',
    email: 'ana.prueba@example.com',
    description: 'DESCRIPCION-PRIVADA-ANA coordina el montaje.',
    notes: 'NOTA-PRIVADA-ANA: prefiere WhatsApp.',
    eventIds: ['e1'],
    verification: 'validated',
    source: 'reported',
  }),
  makeContact('p2', 'Bruno Prueba', {
    ...stamp,
    role: 'Técnico de sonido',
    company: {...SONIDO},
    // Without a country code. «000 000 0XX» cannot be used here: a number
    // starting with 00 reads as the international prefix. 020 7946 0XXX is
    // Ofcom's range reserved for fiction, so it is never a real line.
    phone: '020 7946 0012',
  }),
  makeContact('p3', 'Íñigo Prueba', {...stamp}),
  makeContact('p4', 'Carla Prueba', {
    ...stamp,
    role: 'Montadora',
    company: {...ESCENARIOS},
  }),
];

/**
 * Carpas por día: o1 180 €, o2 210,50 €, o3 without price. o4 is a carpa
 * per metre (another unit: never compared with the others). o5 is sound,
 * o6 has no category and no price.
 */
export const dirOffers = () => [
  makeOffer('o1', 'Carpa Prueba 6 × 3 m', ESCENARIOS, {
    ...stamp,
    categoryId: CAT.carpas,
    price: 180,
    unit: 'day',
    transportCost: 60,
    vatIncluded: false,
    conditions: 'CONDICION-PRIVADA: mínimo dos días.',
    verification: 'validated',
  }),
  makeOffer('o2', 'Carpa Prueba reforzada', SONIDO, {
    ...stamp,
    categoryId: CAT.carpas,
    price: 210.5,
    unit: 'day',
    assemblyCost: 90,
    // Same VAT treatment as o1, so they stay comparable.
    vatIncluded: false,
  }),
  makeOffer('o3', 'Carpa Prueba 3 × 3 m', ESCENARIOS, {
    ...stamp,
    categoryId: CAT.carpas,
    unit: 'day',
    vatIncluded: false,
  }),
  makeOffer('o4', 'Carpa Prueba por metro', ESCENARIOS, {
    ...stamp,
    categoryId: CAT.carpas,
    price: 12,
    unit: 'metre',
  }),
  makeOffer('o5', 'Equipo de sonido Prueba', SONIDO, {
    ...stamp,
    categoryId: CAT.sonido,
    price: 450,
    unit: 'day',
    vatIncluded: true,
  }),
  makeOffer('o6', 'Vallas Prueba', CONCEJALIA, {...stamp}),
];

/** A task of Escenarios today with Ana as its person of contact. */
export const dirTasks = () => [
  makeTask(
    't1',
    'Montaje del escenario',
    {date: DAY, start: '08:00', end: '13:00'},
    {
      eventId: 'e1',
      kind: 'assembly',
      venue: {id: 'v1', name: 'Plaza del Cristo'},
      company: {...ESCENARIOS},
      contact: {id: 'p1', name: 'Ana Prueba'},
      heavyLoad: false,
      ...stamp,
    },
  ),
];

/** Mock options for the milestone 3 directory. */
export const directoryData = (): MockOptions => ({
  events: planEvents(),
  venues: planVenues(),
  tasks: dirTasks(),
  companies: dirCompanies(),
  contacts: dirContacts(),
  offers: dirOffers(),
});

/**
 * Records every outgoing `tel:`, `mailto:` and `wa.me` link and every
 * `window.open`, and stops them from leaving the page; fakes the clipboard.
 * Read them with `opened(page)` and `copied(page)`.
 */
export async function trapOutgoing(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __opened: {href: string; via: string; target: string | null}[];
      __copied: string[];
    };
    w.__opened = [];
    w.__copied = [];
    document.addEventListener(
      'click',
      e => {
        const a =
          e.target instanceof Element ? e.target.closest('a[href]') : null;
        const href = a?.getAttribute('href') ?? '';
        if (!/^(tel:|mailto:|https:\/\/wa\.me\/)/.test(href)) return;
        e.preventDefault();
        w.__opened.push({href, via: 'link', target: a!.getAttribute('target')});
      },
      true,
    );
    window.open = ((url?: string | URL) => {
      w.__opened.push({
        href: String(url ?? ''),
        via: 'window.open',
        target: null,
      });
      return null;
    }) as typeof window.open;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__copied.push(text);
        },
      },
    });
  });
}

export const opened = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as {__opened: {href: string; via: string}[]}).__opened,
  );

export const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as {__copied: string[]}).__copied);

/** Opens a space through the sidebar (desktop) and waits for it. */
export async function goToSpace(
  page: Page,
  space: 'contactos' | 'catalogo' | 'hoy',
) {
  await page.locator(`#lx-nav-${space}`).click();
  await page.locator(`#lx-space-${space}`).waitFor();
}
