import {describe, expect, it} from 'vitest';
import type {
  Offer,
  OfferTerms,
  OfferVersion,
  Proposal,
  QuoteNeed,
} from '../../../shared/logistics/contracts';
import {compareNeed} from '../../../shared/logistics/offer-terms';
import {
  LINK_STATUS_LABEL,
  LOCAL_LINK_WARNING,
  PROPOSAL_STATE_LABEL,
  isLocalOnly,
  linkMessage,
  mailtoHref,
  needText,
  priceText,
  shareableUrl,
  supplementText,
  termsOfOffer,
  validityOf,
} from '../../../src/logistics/offers/format';
import {candidatesFor} from '../../../src/logistics/offers/NeedCompare';
import {
  eventNeedDates,
  needOfDraft,
} from '../../../src/logistics/catalog/terms/NeedCost';
import {
  allProblems,
  draftKeyOf,
  emptyDraft,
  productProblems,
  proposalInputOf,
  validityProblems,
} from '../../../src/logistics/supplier/draft';
import {stepsFor} from '../../../src/logistics/supplier/ProposalForm';

/**
 * Revisión 1 · E6–E7, UI side: how validity, prices and needs read, the
 * personal link message (shared by hand, never sent by the server), the
 * supplier form's steps and checks, and which answers a comparison shows
 * (pending proposals marked, never ranked).
 */

const TODAY = '2026-11-27';

const terms = (extra: Partial<OfferTerms> = {}): OfferTerms => ({
  basis: 'unit_day',
  customUnit: null,
  price: 100,
  pricesIncludeTax: false,
  seasonal: [],
  supplements: [],
  notIncluded: [],
  minimumDays: null,
  minimumQuantity: null,
  minimumOrder: null,
  acceptUntil: null,
  serviceMonths: null,
  serviceNote: null,
  commitment: null,
  conditions: null,
  available: null,
  tax: null,
  ...extra,
});

const NEED: QuoteNeed = {
  title: '3 carpas de 6 × 6 m',
  categoryId: 'cat-carpas',
  quantity: 3,
  unitLabel: 'carpas',
  days: 4,
  hoursPerDay: null,
  dateFrom: '2026-12-12',
  dateTo: '2026-12-15',
  note: null,
};

const offer = (id: string, extra: Partial<Offer> = {}): Offer =>
  ({
    id,
    name: `Oferta ${id}`,
    company: {id: `c-${id}`, name: `Empresa ${id}`},
    categoryId: 'cat-carpas',
    price: 100,
    unit: 'day',
    customUnit: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    conditions: null,
    vatIncluded: false,
    tax: {
      regime: 'igic',
      name: null,
      ratePercent: 7,
      verification: 'validated',
    },
    companyTax: null,
    restricted: false,
    ...extra,
  }) as Offer;

describe('validityOf', () => {
  it('keeps the deadline in words, from unknown to expired', () => {
    expect(validityOf(null, TODAY).kind).toBe('unknown');
    expect(validityOf('2026-11-20', TODAY)).toMatchObject({
      kind: 'expired',
      daysLeft: -7,
    });
    expect(validityOf(TODAY, TODAY)).toMatchObject({
      kind: 'soon',
      text: 'Vence hoy',
    });
    expect(validityOf('2026-12-07', TODAY)).toMatchObject({
      kind: 'soon',
      text: 'Vence en 10 días',
    });
    expect(validityOf('2027-06-30', TODAY).kind).toBe('current');
    expect(validityOf('2027-06-30', TODAY).text).toMatch(/^Vigente hasta el /);
  });
});

describe('labels and texts', () => {
  it('says who has to act on a pending proposal', () => {
    expect(PROPOSAL_STATE_LABEL.pending).toBe('Pendiente de un administrador');
    expect(LINK_STATUS_LABEL.revoked).toBe('Enlace anulado');
  });

  it('reads prices, supplements and needs', () => {
    expect(priceText(terms({price: 195}))).toMatch(
      /^195(,00)?\s€ por unidad y jornada$/,
    );
    expect(priceText(terms({price: null}))).toBeNull();
    expect(
      priceText(
        terms({price: 900, basis: 'custom', customUnit: 'por escenario'}),
      ),
    ).toMatch(/por escenario$/);
    expect(
      supplementText({
        label: 'Montaje',
        kind: 'assembly',
        included: true,
        amount: null,
        per: 'order',
        applies: 'always',
      }),
    ).toBe('Montaje · incluido');
    expect(
      supplementText({
        label: 'Limpieza nocturna',
        kind: 'other',
        included: false,
        amount: null,
        per: 'day',
        applies: 'on_request',
      }),
    ).toBe('Limpieza nocturna · sin precio');
    expect(needText(NEED)).toMatch(/^3 carpas · 4 jornadas · 12/);
    expect(needText({...NEED, quantity: 1, dateFrom: null})).toBe(
      '1 carpa · 4 jornadas',
    );
  });

  it('uses the version in force, or the old data marked as such', () => {
    const o = offer('o1');
    expect(termsOfOffer(o, null).legacy).toBe(true);
    const version = {terms: terms({price: 180}), offerId: 'o1'} as OfferVersion;
    expect(termsOfOffer(o, version)).toMatchObject({legacy: false});
    expect(termsOfOffer(o, version).terms.price).toBe(180);
  });
});

describe('sharing a personal link by hand', () => {
  it("builds the address from this Gestor's own location", () => {
    const token = 'A'.repeat(20) + '_-' + 'z'.repeat(21);
    const lan = 'http://192.168.1.20:5173';
    expect(
      shareableUrl(
        `http://server:8787/gestor-logistico/proveedor#${token}`,
        lan,
      ),
    ).toBe(`${lan}/gestor-logistico/proveedor#${token}`);
    expect(
      shareableUrl(
        `http://server:8787/gestor-logistico/proveedor/abierto#${token}`,
        lan,
      ),
    ).toBe(`${lan}/gestor-logistico/proveedor/abierto#${token}`);
    // A Gestor served under a sub-path keeps it; the server's own path goes.
    expect(
      shareableUrl(
        `https://pilot.example.org/web/gestor-logistico/proveedor#${token}`,
        lan,
        '/OxEye/',
      ),
    ).toBe(`${lan}/OxEye/gestor-logistico/proveedor#${token}`);
    expect(
      shareableUrl(
        `http://s/gestor-logistico/proveedor#${token}`,
        lan,
        '/OxEye',
      ),
    ).toBe(`${lan}/OxEye/gestor-logistico/proveedor#${token}`);
    // A link issued before 2026-11-28: shared in the new form, token still
    // only in the fragment.
    const legacy = shareableUrl(
      `http://server:8787/#logistica/proveedor/abierto/${token}`,
      lan,
    );
    expect(legacy).toBe(`${lan}/gestor-logistico/proveedor/abierto#${token}`);
    expect(new URL(legacy).pathname).not.toContain(token);
    // Not a Gestor link: the server's address as it is.
    expect(shareableUrl('http://x/sin-hash', lan)).toBe('http://x/sin-hash');
    expect(shareableUrl('http://x/#otra', lan)).toBe('http://x/#otra');
    expect(shareableUrl('http://gestor-logistico.example/x', lan)).toBe(
      'http://gestor-logistico.example/x',
    );
  });

  it('warns when the address only works on this computer', () => {
    expect(isLocalOnly('localhost')).toBe(true);
    expect(isLocalOnly('127.0.0.1')).toBe(true);
    expect(isLocalOnly('192.168.1.20')).toBe(false);
    expect(LOCAL_LINK_WARNING).toContain('npm run equipo');
  });

  it('prepares a message with the need, the link and its expiry', () => {
    const m = {
      organization: 'Ayuntamiento de La Laguna',
      sender: 'Elvis',
      company: 'Carpas Demo',
      need: NEED,
      url: 'http://equipo:5173/gestor-logistico/proveedor#abc',
      expiresOn: '2026-12-04',
    };
    const {subject, body} = linkMessage(m);
    expect(subject).toBe('Petición de presupuesto · 3 carpas de 6 × 6 m');
    expect(body).toContain('Hola, Carpas Demo:');
    expect(body).toContain(m.url);
    expect(body).toContain('Elvis');
    const href = mailtoHref('ventas@carpas.example.org', m);
    expect(href.startsWith('mailto:ventas%40carpas.example.org?subject=')).toBe(
      true,
    );
    expect(mailtoHref(null, m).startsWith('mailto:?subject=')).toBe(true);
  });
});

describe('supplier form', () => {
  it('asks only what is needed: declining is one step', () => {
    const d = emptyDraft('Carpas Demo', 'Carpa 6x6');
    expect(stepsFor({...d, intent: 'no'}, 'request').map(s => s.id)).toEqual([
      'start',
      'decline',
    ]);
    const ids = stepsFor(d, 'request').map(s => s.id);
    expect(ids).toEqual([
      'start',
      'company',
      'price:0',
      'extras:0',
      'products',
      'tax',
      'dates',
      'review',
    ]);
    // The open form and a manual record have no «¿Puedes?» step.
    expect(stepsFor(d, 'open')[0].id).toBe('company');
    expect(stepsFor(d, 'manual')[0].id).toBe('company');
  });

  it('checks prices, seasons and dates in plain words', () => {
    const d = emptyDraft('', '');
    const problems = allProblems(d, TODAY);
    expect(problems['company.name']).toBeTruthy();
    expect(problems['products.0.name']).toBeTruthy();

    const product = {...d.products[0], name: 'Carpa', price: 'mucho'};
    expect(
      productProblems({...d, products: [product]}, 0)['products.0.price'],
    ).toMatch(/importe en euros/);
    const seasons = [
      {label: 'Verano', months: [6, 7], price: '150'},
      {label: 'Otra', months: [7], price: '120'},
    ];
    expect(
      productProblems(
        {...d, products: [{...product, price: '100', seasonal: true, seasons}]},
        0,
      )['products.0.seasons'],
    ).toBe('Un mes no puede estar en dos temporadas.');

    expect(
      validityProblems(
        {...d, validity: 'date', validityDate: '2026-11-01'},
        TODAY,
      ).validityDate,
    ).toBeTruthy();
    expect(
      validityProblems({...d, service: 'months', serviceMonths: []}, TODAY)
        .serviceMonths,
    ).toBeTruthy();
  });

  it('sends prices before tax, extras as supplements and the deadline as a date', () => {
    const d = emptyDraft('Carpas Demo', 'Carpa 6x6');
    const p = {
      ...d.products[0],
      price: '85,50',
      extras: {
        transport: {
          state: 'extra' as const,
          price: '120',
          per: 'order' as const,
        },
        assembly: {
          state: 'included' as const,
          price: '',
          per: 'order' as const,
        },
        maintenance: {state: 'no' as const, price: '', per: 'order' as const},
      },
    };
    const input = proposalInputOf(
      {
        ...d,
        intent: 'similar',
        products: [p],
        tax: {regime: 'igic', name: '', rate: '7', verified: false},
        validity: '3m',
        service: 'all',
        privacy: true,
      },
      TODAY,
      {publicForm: true},
    );
    expect(input.intent).toBe('similar');
    expect(input.products[0].price).toBe(85.5);
    expect(input.products[0].supplements).toEqual([
      expect.objectContaining({
        kind: 'transport',
        included: false,
        amount: 120,
      }),
      expect.objectContaining({kind: 'assembly', included: true, amount: null}),
    ]);
    expect(input.products[0].notIncluded).toEqual([
      'Mantenimiento durante el evento',
    ]);
    expect(input.tax).toMatchObject({regime: 'igic', ratePercent: 7});
    expect(input.pricesIncludeTax).toBe(false);
    expect(input.acceptUntil).toBe('2027-02-26');
    expect(input.serviceMonths).toHaveLength(12);
    expect(input.privacyAccepted).toBe(true);
    // A manual record never carries the supplier's consent.
    expect(
      'privacyAccepted' in proposalInputOf(d, TODAY, {publicForm: false}),
    ).toBe(false);
  });

  it("maps the server's field paths onto the form's keys", () => {
    expect(draftKeyOf('proposal.products.0.price')).toBe('products.0.price');
    expect(draftKeyOf('products.1.seasonal.0.price')).toBe(
      'products.1.seasons.0.price',
    );
    expect(draftKeyOf('tax.ratePercent')).toBe('tax.rate');
    expect(draftKeyOf('acceptUntil')).toBe('validityDate');
  });
});

describe('dates of a need from an event', () => {
  const ev = (
    id: string,
    date: string | null,
    extra: {endDate?: string | null; status?: string} = {},
  ) => ({
    id,
    name: `Evento ${id}`,
    date,
    endDate: extra.endDate ?? null,
    status: extra.status ?? 'planned',
  });

  it('takes the next event, or the one under way, never a cancelled one', () => {
    const events = [
      ev('past', '2026-11-01'),
      ev('cancelled', '2026-11-30', {status: 'cancelled'}),
      ev('later', '2027-01-10'),
      ev('ongoing', '2026-11-25', {endDate: '2026-11-29'}),
      ev('undated', null),
    ];
    expect(eventNeedDates(events, TODAY)).toEqual({
      eventId: 'ongoing',
      name: 'Evento ongoing',
      from: '2026-11-25',
      to: '2026-11-29',
      days: 5,
    });
  });

  it('prefers the event in context, and has nothing to offer without events', () => {
    const events = [ev('a', '2026-12-01'), ev('b', '2026-12-20')];
    expect(eventNeedDates(events, TODAY, 'b')?.eventId).toBe('b');
    expect(eventNeedDates(events, TODAY, 'missing')?.eventId).toBe('a');
    expect(eventNeedDates([], TODAY)).toBeNull();
    expect(eventNeedDates([ev('past', '2026-10-01')], TODAY)).toBeNull();
  });

  it('gives no need while the hours per day are typed but not valid', () => {
    const d = {quantity: '2', days: '3', hours: '', from: '', to: ''};
    expect(needOfDraft(d)?.hoursPerDay).toBeNull();
    expect(needOfDraft({...d, hours: '8'})?.hoursPerDay).toBe(8);
    expect(needOfDraft({...d, hours: '30'})).toBeNull();
    expect(needOfDraft({...d, hours: 'ocho'})).toBeNull();
  });
});

describe('comparing the answers to a need', () => {
  const pending = {
    id: 'p1',
    state: 'pending',
    request: {id: 'qr1', title: NEED.title},
    content: {
      company: {name: 'Carpas Nuevas'},
      products: [
        {
          key: 'a',
          categoryKey: null,
          name: 'Carpa 6x6',
          basis: 'unit_day',
          price: 50,
        },
      ],
      tax: {
        regime: 'igic',
        name: null,
        ratePercent: 7,
        verification: 'to_verify',
      },
      pricesIncludeTax: false,
      acceptUntil: '2027-01-31',
      serviceMonths: [12],
      privacyVersion: '2026-11-27-borrador',
    },
  } as unknown as Proposal;

  it('takes the same category, the renegotiated offer and the pending proposals of the request', () => {
    const offers = [
      offer('o1'),
      offer('o2', {categoryId: 'otra'}),
      offer('o3', {categoryId: 'otra'}),
      offer('o4', {restricted: true}),
    ];
    const other = {
      ...pending,
      id: 'p2',
      request: {id: 'qr9', title: 'x'},
    } as Proposal;
    const approved = {...pending, id: 'p3', state: 'approved'} as Proposal;
    const keys = candidatesFor(NEED, offers, [], [pending, other, approved], {
      id: 'qr1',
      offerId: 'o3',
    }).map(c => c.item.key);
    expect(keys).toEqual(['o:o1', 'o:o3', 'p:p1:a']);
  });

  it('never gives a pending proposal a position, even when it is cheaper', () => {
    const list = candidatesFor(NEED, [offer('o1')], [], [pending], {
      id: 'qr1',
      offerId: null,
    });
    const cmp = compareNeed(
      list,
      {
        quantity: NEED.quantity,
        days: NEED.days,
        hoursPerDay: null,
        dateFrom: NEED.dateFrom,
        dateTo: NEED.dateTo,
      },
      TODAY,
    );
    const proposalRow = cmp.ranked.find(r => r.item.pending);
    const offerRow = cmp.ranked.find(r => !r.item.pending);
    expect(proposalRow?.rank ?? null).toBeNull();
    expect(offerRow?.rank).toBe(1);
  });
});
