import {describe, expect, it} from 'vitest';
import type {
  Expense,
  OfferSnapshot,
  TaxInfo,
} from '../../../shared/logistics/contracts';
import {budgetSummary} from '../../../shared/logistics/money';
import {
  caveatsOf,
  expenseEstimate,
  groupGapText,
  headlineOf,
  ribbonOf,
  snapshotText,
} from '../../../src/logistics/budget/summary';
import {
  EMPTY_TAX_DRAFT,
  estimateLine,
  parseRate,
  pickRegime,
  rescuedTaxDraft,
  taxDraftOf,
  taxLabel,
  taxProblem,
  taxText,
  taxToSend,
} from '../../../src/logistics/budget/tax';

/**
 * Revisión 1 · E5 «Dinero», UI side: how a tax reads and is typed, the line
 * under a price, and an event's budget in words and proportions. Estimates
 * always say so; nothing unknown is counted as 0.
 */

const IGIC: TaxInfo = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'to_verify',
};

describe('Impuestos · labels', () => {
  it('says a tax nobody stated, never a guessed rate', () => {
    expect(taxLabel(null)).toBe('Impuesto sin indicar');
    expect(taxLabel(IGIC)).toBe('IGIC 7 %');
    expect(taxLabel({...IGIC, regime: 'iva', ratePercent: 21})).toBe(
      'IVA 21 %',
    );
    expect(
      taxLabel({...IGIC, regime: 'other', name: 'IPSI', ratePercent: 4}),
    ).toBe('IPSI 4 %');
    expect(taxLabel({...IGIC, ratePercent: null})).toBe(
      'IGIC · porcentaje sin saber',
    );
    expect(taxLabel({...IGIC, regime: 'none', ratePercent: 0})).toBe(
      'Sin impuesto',
    );
    expect(taxLabel({...IGIC, regime: 'unknown', ratePercent: null})).toBe(
      'Impuesto sin saber',
    );
  });

  it('adds where it comes from and «por verificar»', () => {
    expect(taxText(IGIC, {inherited: true})).toBe(
      'IGIC 7 % de la empresa · por verificar',
    );
    expect(taxText({...IGIC, verification: 'validated'})).toBe('IGIC 7 %');
  });
});

describe('Impuestos · the picker draft', () => {
  it('prefills 7 % / 21 % «por verificar» and resets on a new regime', () => {
    const igic = pickRegime(EMPTY_TAX_DRAFT, 'igic');
    expect(igic).toEqual({
      regime: 'igic',
      name: '',
      rate: '7',
      verified: false,
    });
    const iva = pickRegime({...igic, verified: true}, 'iva');
    expect(iva.rate).toBe('21');
    expect(iva.verified).toBe(false);
    expect(pickRegime(iva, 'none').rate).toBe('');
    expect(pickRegime(iva, '')).toEqual(EMPTY_TAX_DRAFT);
  });

  it('reads Spanish percentages and rejects words', () => {
    expect(parseRate('6,5')).toBe(6.5);
    expect(parseRate('7 %')).toBe(7);
    expect(parseRate('')).toBeNull();
    expect(parseRate('siete')).toBeNaN();
  });

  it('sends a TaxInput, null for nothing, and pins problems to a part', () => {
    expect(taxToSend(EMPTY_TAX_DRAFT)).toBeNull();
    expect(
      taxToSend({regime: 'igic', name: '', rate: '7', verified: true}),
    ).toEqual({
      regime: 'igic',
      ratePercent: 7,
      verification: 'validated',
    });
    // An empty rate is «not known yet», never the default.
    expect(
      taxToSend({regime: 'iva', name: '', rate: '', verified: false}),
    ).toEqual({regime: 'iva', ratePercent: null, verification: 'to_verify'});
    expect(
      taxProblem({regime: 'igic', name: '', rate: 'abc', verified: false})
        ?.field,
    ).toBe('rate');
    expect(
      taxProblem({regime: 'other', name: '', rate: '4', verified: false})
        ?.field,
    ).toBe('name');
    expect(
      taxProblem({regime: 'igic', name: '', rate: '7', verified: false}),
    ).toBeNull();
  });

  it('round-trips a stored tax and rescues only valid drafts', () => {
    const draft = taxDraftOf({...IGIC, ratePercent: 6.5});
    expect(draft.rate).toBe('6,5');
    expect(rescuedTaxDraft({regime: 'igic', rate: '7'})).toEqual({
      regime: 'igic',
      name: '',
      rate: '7',
      verified: false,
    });
    expect(rescuedTaxDraft({regime: 'vat'})).toBeNull();
    expect(rescuedTaxDraft('igic')).toBeNull();
  });
});

describe('Impuestos · the line under a price', () => {
  const offer = {
    price: 120,
    vatIncluded: false as boolean | null,
    tax: null as TaxInfo | null,
    companyTax: IGIC as TaxInfo | null,
    unit: 'day' as const,
    customUnit: null,
  };

  it('estimates with the company tax and says it is an estimate', () => {
    const line = estimateLine(offer);
    expect(line?.kind).toBe('estimate');
    expect(line?.amount).toMatch(/128,4/);
    expect(line?.text).toContain('estimación');
    expect(line?.tax).toContain('de la empresa');
  });

  it('tells why there is no estimate', () => {
    expect(estimateLine({...offer, companyTax: null})?.kind).toBe('none');
    expect(estimateLine({...offer, vatIncluded: null})?.text).toMatch(
      /No consta/,
    );
    expect(estimateLine({...offer, price: null})).toBeNull();
  });

  it('keeps an old «with tax» price truthful', () => {
    const line = estimateLine({...offer, vatIncluded: true, companyTax: null});
    expect(line?.kind).toBe('included');
    expect(line?.amount).toBeNull();
  });
});

describe('Presupuesto · the budget at a glance', () => {
  const expense = (
    id: string,
    amount: number | null,
    status: 'planned' | 'confirmed',
    tax: TaxInfo | null = IGIC,
  ) => ({id, amount, status, tax}) as unknown as Expense;

  it('says what is left, as an estimate, and what it leaves out', () => {
    const s = budgetSummary({eventId: 'e1', amount: 1000}, [
      expense('a', 400, 'confirmed'),
      expense('b', 200, 'planned'),
      expense('c', null, 'planned'),
      expense('d', 50, 'planned', null),
    ]);
    // 428 + 214 with IGIC 7 %
    expect(s.total.withTax).toBe(642);
    expect(headlineOf(s)).toMatchObject({kind: 'left', label: 'Quedan'});
    expect(headlineOf(s).amount).toMatch(/358/);
    const caveats = caveatsOf(s);
    expect(caveats[0]).toMatch(/1 gasto sin importe/);
    expect(caveats[1]).toMatch(/1 gasto sin impuesto conocido/);
    expect(caveats).toContain('Lo que queda puede ser menos de lo que se ve.');
  });

  it('draws confirmed, planned and the rest of the budget', () => {
    const s = budgetSummary({eventId: 'e1', amount: 1000}, [
      expense('a', 400, 'confirmed', {...IGIC, ratePercent: 0}),
      expense('b', 100, 'planned', {...IGIC, ratePercent: 0}),
    ]);
    expect(ribbonOf(s)).toEqual({
      confirmed: 40,
      planned: 10,
      free: 50,
      over: 0,
      mark: null,
    });
  });

  it('marks where the budget ends when the estimate passes it', () => {
    const zero = {...IGIC, ratePercent: 0};
    const s = budgetSummary({eventId: 'e1', amount: 800}, [
      expense('a', 600, 'confirmed', zero),
      expense('b', 400, 'planned', zero),
    ]);
    const r = ribbonOf(s);
    expect(r.mark).toBe(80);
    expect(r.confirmed).toBe(60);
    expect(r.planned).toBe(20);
    expect(r.over).toBe(20);
    expect(headlineOf(s).kind).toBe('over');
  });

  it('without a budget, only what is spent', () => {
    const s = budgetSummary({eventId: 'e1', amount: null}, [
      expense('a', 100, 'planned'),
    ]);
    expect(headlineOf(s).kind).toBe('none');
    expect(ribbonOf(s).free).toBe(0);
    expect(caveatsOf(s)).toEqual(['1 gasto con el impuesto por verificar.']);
  });

  it('reads one expense and its copied price', () => {
    const est = expenseEstimate({amount: 100, tax: IGIC});
    expect(est.amount).toMatch(/^107\s€$/);
    expect(est.text).toBe('con impuestos · estimación');
    expect(expenseEstimate({amount: null, tax: IGIC}).amount).toBeNull();
    expect(expenseEstimate({amount: 100, tax: null}).text).toMatch(
      /Sin impuesto/,
    );
    const snap: OfferSnapshot = {
      offerId: 'o1',
      offerName: 'Carpa 3x3',
      companyName: 'Carpas Demo',
      price: 120,
      unit: 'day',
      customUnit: null,
      vatIncluded: false,
      tax: IGIC,
      taxInherited: true,
      transportCost: null,
      assemblyCost: null,
      maintenanceCost: null,
      at: '2026-11-27T10:30:00.000Z',
    };
    const t = snapshotText(snap, 'Atlantic/Canary');
    expect(t.when).toMatch(/^Precio copiado el 27 nov/);
    expect(t.what).toContain('«Carpa 3x3» · Carpas Demo');
    expect(t.what).toContain('sin impuestos');
    expect(t.what).toContain('IGIC 7 % de la empresa');
  });

  it('a group subtotal says what it leaves out', () => {
    expect(groupGapText({unknownAmount: 0, unknownTax: 0})).toBeNull();
    expect(groupGapText({unknownAmount: 1, unknownTax: 0})).toBe(
      '1 gasto sin importe no entra en las sumas.',
    );
    expect(groupGapText({unknownAmount: 0, unknownTax: 2})).toBe(
      '2 gastos con impuesto desconocido no entran en la estimación con impuestos.',
    );
    expect(groupGapText({unknownAmount: 2, unknownTax: 1})).toContain('; ');
  });
});
