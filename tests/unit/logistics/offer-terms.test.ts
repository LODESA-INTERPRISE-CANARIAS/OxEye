/**
 * Revisión 1 · E6: the cost of a concrete need under an offer's terms, the
 * comparison of offers (expired ones never compared as current, pending
 * proposals without a position), month labels, renewal dates and the terms
 * of offers recorded before versions.
 */
import {describe, expect, it} from 'vitest';
import {
  compareNeed,
  coversDates,
  isExpired,
  legacyTerms,
  monthsLabel,
  offerCost,
  overlappingMonth,
  renewalDue,
  renewalStart,
  termsTax,
  versionStatus,
} from '../../../shared/logistics/offer-terms';
import type {NeedSpec} from '../../../shared/logistics/offer-terms';
import type {OfferTerms, TaxInfo} from '../../../shared/logistics/contracts';

const IGIC: TaxInfo = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'validated',
};
const NONE: TaxInfo = {
  regime: 'none',
  name: null,
  ratePercent: 0,
  verification: 'to_verify',
};

function terms(over: Partial<OfferTerms> = {}): OfferTerms {
  return {
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
    ...over,
  };
}

function need(over: Partial<NeedSpec> = {}): NeedSpec {
  return {
    quantity: 1,
    days: 1,
    hoursPerDay: null,
    dateFrom: null,
    dateTo: null,
    ...over,
  };
}

describe('offerCost', () => {
  it('prices units × days, adds supplements that always apply and keeps on-request ones apart', () => {
    const cost = offerCost(
      terms({
        price: 195,
        supplements: [
          {
            label: 'Transporte',
            kind: 'transport',
            included: false,
            amount: 120,
            per: 'order',
            applies: 'always',
          },
          {
            label: 'Montaje',
            kind: 'assembly',
            included: true,
            amount: null,
            per: 'order',
            applies: 'always',
          },
          {
            label: 'Mantenimiento',
            kind: 'maintenance',
            included: false,
            amount: 50,
            per: 'day',
            applies: 'on_request',
          },
        ],
      }),
      need({quantity: 3, days: 4}),
      IGIC,
    );
    expect(cost.parts.map(p => [p.key, p.amount, p.state])).toEqual([
      ['base', 2340, 'priced'],
      ['supplement:0', 120, 'priced'],
      ['supplement:1', 0, 'included'],
    ]);
    expect(cost.parts[0]?.detail).toContain('3 × 4 jornadas × 195');
    expect(cost.onRequest).toEqual([
      expect.objectContaining({
        label: 'Mantenimiento',
        amount: 200,
        state: 'priced',
      }),
    ]);
    expect(cost.unknown).toEqual([]);
    expect(cost.knownSum).toBe(2460);
    expect(cost.beforeTax).toBe(2460);
    expect(cost.total).toBe(2632.2);
    expect(cost.tax).toEqual({
      label: 'IGIC 7 %',
      ratePercent: 7,
      amount: 172.2,
      verified: true,
      included: false,
    });
  });

  it('supplements per unit, per unit and day and in percent', () => {
    const cost = offerCost(
      terms({
        price: 100,
        supplements: [
          {
            label: 'Lona',
            kind: 'other',
            included: false,
            amount: 5,
            per: 'unit',
            applies: 'always',
          },
          {
            label: 'Limpieza',
            kind: 'other',
            included: false,
            amount: 2,
            per: 'unit_day',
            applies: 'always',
          },
          {
            label: 'Seguro',
            kind: 'other',
            included: false,
            amount: 10,
            per: 'percent',
            applies: 'always',
          },
        ],
      }),
      need({quantity: 2, days: 3}),
      NONE,
    );
    expect(cost.parts.map(p => p.amount)).toEqual([600, 10, 12, 60]);
    expect(cost.total).toBe(682);
  });

  it('a missing price, supplement price or tax is listed as unknown, never invented', () => {
    const noPrice = offerCost(terms({price: null}), need(), IGIC);
    expect(noPrice.unknown).toEqual(['Precio']);
    expect(noPrice.total).toBeNull();
    expect(noPrice.beforeTax).toBeNull();

    const noExtra = offerCost(
      terms({
        supplements: [
          {
            label: 'Transporte',
            kind: 'transport',
            included: false,
            amount: null,
            per: 'order',
            applies: 'always',
          },
        ],
      }),
      need(),
      IGIC,
    );
    expect(noExtra.unknown).toEqual(['Transporte']);
    expect(noExtra.knownSum).toBe(100);
    expect(noExtra.total).toBeNull();

    const noTax = offerCost(terms(), need(), null);
    expect(noTax.beforeTax).toBe(100);
    expect(noTax.total).toBeNull();
    expect(noTax.unknown).toEqual(['Impuesto']);

    const unsaid = offerCost(terms({pricesIncludeTax: null}), need(), IGIC);
    expect(unsaid.total).toBeNull();
    expect(unsaid.unknown).toEqual(['Si el precio incluye impuesto']);
    // Without tax it does not matter whether prices include it.
    expect(offerCost(terms({pricesIncludeTax: null}), need(), NONE).total).toBe(
      100,
    );
  });

  it('prices that include tax: the total is as written and the tax is taken out', () => {
    const cost = offerCost(
      terms({price: 1070, pricesIncludeTax: true}),
      need(),
      IGIC,
    );
    expect(cost.total).toBe(1070);
    expect(cost.beforeTax).toBe(1000);
    expect(cost.tax?.amount).toBe(70);
    expect(cost.tax?.included).toBe(true);
  });

  it('minimum days count only for prices per day; minimum quantity for prices per unit', () => {
    const days = offerCost(
      terms({minimumDays: 3}),
      need({quantity: 2, days: 1}),
      NONE,
    );
    expect(days.billedDays).toBe(3);
    expect(days.total).toBe(600);
    expect(days.notes[0]).toContain('Mínimo 3 jornadas');

    const units = offerCost(
      terms({
        basis: 'unit_event',
        price: 50,
        minimumDays: 5,
        minimumQuantity: 10,
      }),
      need({quantity: 4, days: 3}),
      NONE,
    );
    expect(units.billedDays).toBe(3);
    expect(units.billedQuantity).toBe(10);
    expect(units.total).toBe(500);

    const order = offerCost(
      terms({basis: 'order', price: 200, minimumQuantity: 10}),
      need({quantity: 4, days: 3}),
      NONE,
    );
    expect(order.billedQuantity).toBe(4);
    expect(order.total).toBe(200);
  });

  it('a minimum order tops the total up', () => {
    const cost = offerCost(
      terms({basis: 'order', price: 200, minimumOrder: 300}),
      need(),
      NONE,
    );
    expect(cost.parts.at(-1)).toEqual(
      expect.objectContaining({
        key: 'minimum_order',
        amount: 100,
        state: 'priced',
      }),
    );
    expect(cost.total).toBe(300);
    // With an unknown part the minimum is only a note.
    const unknown = offerCost(
      terms({basis: 'order', price: null, minimumOrder: 300}),
      need(),
      NONE,
    );
    expect(unknown.parts.some(p => p.key === 'minimum_order')).toBe(false);
    expect(unknown.notes.join(' ')).toContain('Pedido mínimo');
  });

  it('seasonal rates by day; unknown when the dates are missing or the days cannot be placed', () => {
    const summer = [{label: 'Verano', months: [6, 7, 8, 9], price: 195}];
    const july = offerCost(
      terms({price: 170, seasonal: summer}),
      need({
        quantity: 3,
        days: 4,
        dateFrom: '2027-07-10',
        dateTo: '2027-07-13',
      }),
      NONE,
    );
    expect(july.total).toBe(2340);
    expect(july.notes.join(' ')).toContain('Verano (jun – sep)');

    const across = offerCost(
      terms({price: 170, seasonal: summer}),
      need({days: 4, dateFrom: '2027-05-30', dateTo: '2027-06-02'}),
      NONE,
    );
    expect(across.total).toBe(170 + 170 + 195 + 195);
    expect(across.parts[0]?.detail).toContain('tarifas de temporada');

    const unplaced = offerCost(
      terms({price: 170, seasonal: summer}),
      need({days: 2, dateFrom: '2027-05-30', dateTo: '2027-06-02'}),
      NONE,
    );
    expect(unplaced.total).toBeNull();
    expect(unplaced.unknown).toEqual(['Precio']);

    const undated = offerCost(
      terms({price: 170, seasonal: summer}),
      need(),
      NONE,
    );
    expect(undated.total).toBeNull();
    expect(undated.parts[0]?.detail).toContain('no tiene fechas');
  });

  it('hours need the hours per day; packs and other units are not computed', () => {
    const hourly = terms({basis: 'hour_person', price: 20});
    expect(
      offerCost(hourly, need({quantity: 2, days: 3}), NONE).total,
    ).toBeNull();
    expect(
      offerCost(hourly, need({quantity: 2, days: 3, hoursPerDay: 8}), NONE)
        .total,
    ).toBe(960);
    expect(
      offerCost(terms({basis: 'pack', price: 500}), need(), NONE).unknown,
    ).toEqual(['Precio']);
    expect(
      offerCost(
        terms({basis: 'custom', customUnit: 'por metro', price: 3}),
        need(),
        NONE,
      ).parts[0]?.detail,
    ).toContain('por metro');
  });

  it('the commitment price is computed for the same need; dates covered by the service months', () => {
    const cost = offerCost(
      terms({
        price: 195,
        commitment: {years: 3, price: 180, conditions: null},
        serviceMonths: [6, 7, 8, 9],
      }),
      need({
        quantity: 3,
        days: 4,
        dateFrom: '2027-07-10',
        dateTo: '2027-07-13',
      }),
      IGIC,
    );
    expect(cost.commitment).toEqual({years: 3, beforeTax: 2160, total: 2311.2});
    expect(cost.covers).toBe(true);
    expect(
      offerCost(
        terms({commitment: {years: 2, price: null, conditions: null}}),
        need(),
        IGIC,
      ).commitment,
    ).toEqual({years: 2, total: null, beforeTax: null});
  });
});

describe('dates', () => {
  it('coversDates: every day of the need must be in a service month', () => {
    expect(coversDates([6, 7, 8, 9], '2027-07-01', '2027-07-03')).toBe(true);
    expect(coversDates([6, 7, 8, 9], '2027-09-30', '2027-10-01')).toBe(false);
    expect(coversDates([11, 12, 1], '2027-12-31', '2028-01-01')).toBe(true);
    expect(coversDates(null, '2027-07-01', null)).toBeNull();
    expect(coversDates([7], null, null)).toBeNull();
  });

  it('expiry, status and renewal window (the deadline day still counts)', () => {
    expect(isExpired('2026-11-27', '2026-11-27')).toBe(false);
    expect(isExpired('2026-11-26', '2026-11-27')).toBe(true);
    expect(isExpired(null, '2026-11-27')).toBe(false);
    expect(versionStatus(true, '2030-01-01', '2026-11-27')).toBe('superseded');
    expect(versionStatus(false, '2026-11-26', '2026-11-27')).toBe('expired');
    expect(versionStatus(false, null, '2026-11-27')).toBe('current');
    expect(renewalStart('2027-01-31', 30)).toBe('2027-01-01');
    expect(renewalDue('2027-01-31', 30, '2026-12-31')).toBe(false);
    expect(renewalDue('2027-01-31', 30, '2027-01-01')).toBe(true);
    expect(renewalDue('2027-01-31', 30, '2027-01-31')).toBe(true);
    expect(renewalDue('2027-01-31', 30, '2027-02-01')).toBe(false);
    expect(renewalDue(null, 30, '2027-01-01')).toBe(false);
  });

  it('monthsLabel and overlapping seasons', () => {
    expect(monthsLabel([6, 7, 8, 9])).toBe('jun – sep');
    expect(monthsLabel([11, 12, 1, 2, 3])).toBe('nov – mar');
    expect(monthsLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe(
      'todo el año',
    );
    expect(monthsLabel([5, 1, 3])).toBe('ene, mar, may');
    expect(monthsLabel([4])).toBe('abr');
    expect(monthsLabel(null)).toBe('Pendiente de verificar');
    expect(
      overlappingMonth([
        {label: 'Verano', months: [6, 7, 8, 9], price: 1},
        {label: 'Lluvias', months: [11, 12, 1, 2, 3], price: 1},
      ]),
    ).toBeNull();
    expect(
      overlappingMonth([
        {label: 'Verano', months: [6, 7, 8, 9], price: 1},
        {label: 'Fiestas', months: [9, 10], price: 1},
      ]),
    ).toBe(9);
  });
});

describe('offers recorded before versions', () => {
  const offer = {
    price: 120,
    unit: 'day' as const,
    customUnit: null,
    transportCost: 0,
    assemblyCost: null,
    maintenanceCost: 40,
    conditions: 'Pago a 30 días',
    vatIncluded: null,
  };

  it('legacyTerms keeps price, unit and known costs; nothing about dates is invented', () => {
    const t = legacyTerms(offer);
    expect(t.basis).toBe('unit_day');
    expect(t.price).toBe(120);
    expect(t.pricesIncludeTax).toBeNull();
    expect(t.supplements).toEqual([
      {
        label: 'Transporte',
        kind: 'transport',
        included: true,
        amount: 0,
        per: 'order',
        applies: 'always',
      },
      {
        label: 'Mantenimiento',
        kind: 'maintenance',
        included: false,
        amount: 40,
        per: 'order',
        applies: 'always',
      },
    ]);
    expect([t.acceptUntil, t.serviceMonths, t.commitment, t.tax]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(legacyTerms({...offer, unit: 'metre'})).toMatchObject({
      basis: 'custom',
      customUnit: 'por metro',
    });
  });

  it('termsTax: the version tax, else the offer effective tax', () => {
    expect(termsTax({tax: IGIC}, null)).toBe(IGIC);
    expect(termsTax({tax: null}, {tax: null, companyTax: IGIC})).toEqual(IGIC);
    expect(termsTax({tax: null}, {tax: NONE, companyTax: IGIC})).toEqual(NONE);
    expect(termsTax({tax: null}, null)).toBeNull();
  });
});

describe('compareNeed', () => {
  const today = '2026-11-27';
  const n = need({quantity: 1, days: 1, dateFrom: '2027-07-10'});
  const c = (item: string, over: Partial<OfferTerms>, pending = false) => ({
    item,
    terms: terms(over),
    tax: NONE,
    pending,
  });

  it('cheapest first; equal totals share a position; pending without one; expired apart', () => {
    const out = compareNeed(
      [
        c('A', {price: 1000}),
        c('B', {price: 900}, true),
        c('C', {price: 1000}),
        c('G', {price: 1200}),
        c('D', {price: 10, acceptUntil: '2026-11-26'}),
        c('E', {price: 20, serviceMonths: [12]}),
        c('F', {price: null}),
      ],
      n,
      today,
    );
    expect(out.ranked.map(r => [r.item, r.rank, r.pending])).toEqual([
      ['B', null, true],
      ['A', 1, false],
      ['C', 1, false],
      ['G', 3, false],
    ]);
    expect(out.expired.map(r => r.item)).toEqual(['D']);
    expect(out.unavailable.map(r => r.item)).toEqual(['E']);
    expect(out.unknown.map(r => r.item)).toEqual(['F']);
  });

  it('an offer whose deadline is today is still current', () => {
    const out = compareNeed([c('A', {acceptUntil: today})], n, today);
    expect(out.ranked.map(r => r.item)).toEqual(['A']);
  });
});
