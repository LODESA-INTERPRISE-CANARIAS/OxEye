import {describe, expect, it} from 'vitest';
import {
  budgetShare,
  budgetSummary,
  defaultTax,
  effectiveTax,
  expenseTotals,
  normalizeTax,
  priceEstimate,
  roundCents,
  sameTax,
  snapshotOf,
  taxInputOf,
  taxRate,
  withTax,
  withoutTax,
} from '../../../shared/logistics/money';
import {
  budgetMayHaveChanged,
  listsToReload,
} from '../../../shared/logistics/sync';
import {
  hiddenBudgetTypes,
  mayHoldBudget,
  withoutBudgetEntries,
  WITHHELD_FROM_GUESTS,
} from '../../../shared/logistics/redaction';
import {canQueue} from '../../../shared/logistics/outbox';
import {describeChange} from '../../../shared/logistics/history';
import {DEFAULT_TAX_RATE} from '../../../shared/logistics/rules';
import type {
  Expense,
  Offer,
  TaxInfo,
} from '../../../shared/logistics/contracts';

const igic: TaxInfo = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'to_verify',
};
const iva: TaxInfo = {
  regime: 'iva',
  name: null,
  ratePercent: 21,
  verification: 'validated',
};
const none: TaxInfo = {
  regime: 'none',
  name: null,
  ratePercent: 0,
  verification: 'validated',
};
const unknown: TaxInfo = {
  regime: 'unknown',
  name: null,
  ratePercent: null,
  verification: 'to_verify',
};

describe('taxes', () => {
  it('prefills IGIC 7 % and IVA 21 % «por verificar», never a tax nobody stated', () => {
    expect(normalizeTax(null)).toEqual({ok: true, tax: null});
    expect(normalizeTax({regime: 'igic'})).toEqual({ok: true, tax: igic});
    expect(normalizeTax({regime: 'iva', verification: 'validated'})).toEqual({
      ok: true,
      tax: iva,
    });
    expect(DEFAULT_TAX_RATE).toEqual({igic: 7, iva: 21});
    // An explicit null rate stays unknown.
    expect(normalizeTax({regime: 'igic', ratePercent: null})).toMatchObject({
      ok: true,
      tax: {ratePercent: null},
    });
    expect(normalizeTax({regime: 'none'})).toMatchObject({
      tax: {ratePercent: 0},
    });
    expect(normalizeTax({regime: 'unknown'})).toMatchObject({
      tax: {ratePercent: null},
    });
    expect(
      normalizeTax({regime: 'other', name: '  IPSI  ', ratePercent: 4}),
    ).toMatchObject({tax: {name: 'IPSI', ratePercent: 4}});
    // A name only for «otro».
    expect(normalizeTax({regime: 'igic', name: 'X'})).toMatchObject({
      tax: {name: null},
    });
  });

  it('explains every invalid tax by field', () => {
    const fields = (v: unknown) => {
      const r = normalizeTax(v);
      return 'fields' in r ? Object.keys(r.fields) : null;
    };
    expect(fields({regime: 'vat'})).toEqual(['regime']);
    expect(fields('igic')).toEqual(['regime']);
    expect(fields({regime: 'other'})).toEqual(['name']);
    expect(fields({regime: 'other', name: 'x'.repeat(41)})).toEqual(['name']);
    expect(fields({regime: 'none', ratePercent: 7})).toEqual(['ratePercent']);
    expect(fields({regime: 'unknown', ratePercent: 7})).toEqual([
      'ratePercent',
    ]);
    expect(fields({regime: 'igic', ratePercent: 101})).toEqual(['ratePercent']);
    expect(fields({regime: 'igic', ratePercent: 6.999})).toEqual([
      'ratePercent',
    ]);
    expect(fields({regime: 'igic', ratePercent: '7'})).toEqual(['ratePercent']);
    expect(fields({regime: 'igic', verification: 'draft'})).toEqual([
      'verification',
    ]);
  });

  it('rates, inheritance and amounts with tax (rounded to cents)', () => {
    expect(taxRate(null)).toBeNull();
    expect(taxRate(unknown)).toBeNull();
    expect(taxRate(none)).toBe(0);
    expect(taxRate(igic)).toBe(7);
    expect(effectiveTax({tax: iva}, {tax: igic})).toBe(iva);
    expect(effectiveTax({tax: null}, {tax: igic})).toBe(igic);
    expect(effectiveTax({tax: null}, null)).toBeNull();
    expect(effectiveTax({tax: null, companyTax: igic})).toBe(igic);
    expect(withTax(100, igic)).toBe(107);
    expect(withTax(33.33, iva)).toBe(40.33);
    expect(withTax(100, unknown)).toBeNull();
    expect(withTax(null, igic)).toBeNull();
    expect(withoutTax(107, igic)).toBe(100);
    expect(roundCents(0.125)).toBe(0.13);
    expect(roundCents(-0.125)).toBe(-0.13);
    expect(sameTax(igic, {...igic})).toBe(true);
    expect(sameTax(igic, {...igic, verification: 'validated'})).toBe(false);
    expect(sameTax(null, null)).toBe(true);
    expect(defaultTax('iva')).toMatchObject({ratePercent: 21});
    expect(defaultTax('other')).toMatchObject({name: null, ratePercent: null});
    expect(normalizeTax(taxInputOf(igic))).toEqual({ok: true, tax: igic});
  });
});

describe('offer estimates and snapshots', () => {
  const offer = (o: Partial<Offer>) =>
    ({
      price: 100,
      vatIncluded: false,
      tax: null,
      companyTax: null,
      ...o,
    }) as Pick<Offer, 'price' | 'vatIncluded' | 'tax' | 'companyTax'>;

  it('derives both sides only from what the offer records', () => {
    expect(priceEstimate(offer({companyTax: igic}))).toEqual({
      beforeTax: 100,
      withTax: 107,
      tax: igic,
      inherited: true,
      toVerify: true,
      missing: null,
    });
    // Old offer: the written price includes tax; its total is known even
    // without a rate, the price before tax is not.
    expect(priceEstimate(offer({vatIncluded: true}))).toMatchObject({
      beforeTax: null,
      withTax: 100,
      missing: null,
    });
    expect(priceEstimate(offer({vatIncluded: true, tax: igic}))).toMatchObject({
      beforeTax: 93.46,
      withTax: 100,
      inherited: false,
    });
    expect(priceEstimate(offer({vatIncluded: null, tax: igic}))).toMatchObject({
      beforeTax: null,
      withTax: null,
      missing: 'treatment',
    });
    expect(priceEstimate(offer({vatIncluded: null, tax: none}))).toMatchObject({
      beforeTax: 100,
      withTax: 100,
    });
    expect(priceEstimate(offer({}))).toMatchObject({
      beforeTax: 100,
      withTax: null,
      missing: 'rate',
    });
    expect(priceEstimate(offer({price: null}))).toMatchObject({
      beforeTax: null,
      withTax: null,
      missing: null,
    });
  });

  it('a snapshot is a copy: changing the offer afterwards does not touch it', () => {
    const full = {
      id: 'o1',
      name: 'Escenario',
      company: {id: 'c1', name: 'Escenarios Demo'},
      price: 1000,
      unit: 'day' as const,
      customUnit: null,
      vatIncluded: false,
      tax: null,
      companyTax: {...igic},
      transportCost: 150,
      assemblyCost: null,
      maintenanceCost: null,
    };
    const snap = snapshotOf(full, '2026-11-27T10:00:00.000Z');
    expect(snap).toEqual({
      offerId: 'o1',
      offerName: 'Escenario',
      companyName: 'Escenarios Demo',
      price: 1000,
      unit: 'day',
      customUnit: null,
      vatIncluded: false,
      tax: igic,
      taxInherited: true,
      transportCost: 150,
      assemblyCost: null,
      maintenanceCost: null,
      at: '2026-11-27T10:00:00.000Z',
    });
    full.price = 1;
    full.companyTax.ratePercent = 21;
    full.company.name = 'Otro nombre';
    expect(snap.price).toBe(1000);
    expect(snap.tax?.ratePercent).toBe(7);
    expect(snap.companyName).toBe('Escenarios Demo');
  });
});

describe('budget sums', () => {
  const e = (
    amount: number | null,
    tax: TaxInfo | null,
    status: Expense['status'] = 'planned',
  ) => ({amount, tax, status});

  it('never counts an unknown amount or tax as 0', () => {
    expect(
      expenseTotals([
        e(100, igic),
        e(0.1, igic),
        e(0.2, igic),
        e(null, igic),
        e(50, null),
        e(10, none),
      ]),
    ).toEqual({
      count: 6,
      beforeTax: 160.3,
      withTax: 117.32,
      unknownAmount: 1,
      unknownTax: 1,
      taxToVerify: 3,
    });
    expect(expenseTotals([])).toMatchObject({count: 0, beforeTax: 0});
  });

  it('splits planned and confirmed and compares the budget with the estimate with tax', () => {
    const sum = budgetSummary({eventId: 'e', amount: 1000}, [
      e(100, igic),
      e(200, iva, 'confirmed'),
    ]);
    expect(sum.planned.withTax).toBe(107);
    expect(sum.confirmed.withTax).toBe(242);
    expect(sum.total).toMatchObject({count: 2, beforeTax: 300, withTax: 349});
    expect(sum.remaining).toBe(651);
    expect(sum.incomplete).toBe(false);
    const over = budgetSummary({eventId: 'e', amount: 100}, [e(200, iva)]);
    expect(over.remaining).toBe(-142);
    const noBudget = budgetSummary({eventId: 'e', amount: null}, [
      e(null, null),
    ]);
    expect(noBudget.remaining).toBeNull();
    expect(noBudget.incomplete).toBe(true);
    expect(budgetShare(250, 1000)).toBe(0.25);
    expect(budgetShare(1, 0)).toBeNull();
    expect(budgetShare(1, null)).toBeNull();
  });
});

describe('budget privacy on the device', () => {
  it('only viewers with budget.read hold budget entries', () => {
    expect(mayHoldBudget(['plan.edit', 'directory.read'])).toBe(false);
    expect(mayHoldBudget(['budget.read'])).toBe(true);
    expect(hiddenBudgetTypes([])).toEqual(['budget', 'expense']);
    const entries = [
      {entityType: 'task'},
      {entityType: 'expense'},
      {entityType: 'budget'},
    ];
    expect(withoutBudgetEntries(entries, ['plan.edit'])).toEqual([
      {entityType: 'task'},
    ]);
    expect(withoutBudgetEntries(entries, ['budget.read'])).toHaveLength(3);
  });

  it('budget writes are never queued and never reload every list', () => {
    expect(canQueue('member', 'expense', 'create')).toBe(false);
    expect(canQueue('member', 'budget', 'update')).toBe(false);
    const changes = {cursor: '9', types: ['expense', 'budget'], full: false};
    expect([...listsToReload(changes)]).toEqual(['activity']);
    expect(budgetMayHaveChanged(changes)).toBe(true);
    expect(
      budgetMayHaveChanged({cursor: '9', types: ['task'], full: false}),
    ).toBe(false);
    expect(
      budgetMayHaveChanged({cursor: '9', types: ['company'], full: false}),
    ).toBe(true);
    expect(budgetMayHaveChanged({cursor: '9', types: [], full: true})).toBe(
      true,
    );
  });

  it('offer taxes go with the prices for guests; history names fields, never amounts', () => {
    expect(WITHHELD_FROM_GUESTS.offer).toEqual(
      expect.arrayContaining(['price', 'tax', 'companyTax']),
    );
    expect(describeChange({action: 'update', changedFields: ['amount']})).toBe(
      'Cambió importe',
    );
    expect(
      describeChange({action: 'update', changedFields: ['tax', 'concept']}),
    ).toBe('Cambió impuesto y concepto');
  });
});
