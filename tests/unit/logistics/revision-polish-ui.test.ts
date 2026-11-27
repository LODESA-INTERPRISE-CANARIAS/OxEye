import {describe, expect, it} from 'vitest';
import type {ActivityEntry, TaxInfo} from '../../../shared/logistics/contracts';
import type {Comparable} from '../../../shared/logistics/catalogue';

const IGIC: TaxInfo = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'to_verify',
};
import {
  APART_REASON_LABEL,
  categoriesWithComparison,
  compareCategory,
  positionLabel,
  vatText,
} from '../../../src/logistics/catalog/compare';
import {
  mergeActivity,
  oldestAt,
  olderWindow,
} from '../../../src/logistics/hoy/activity-paging';
import {
  companiesText,
  summarizeEvents,
  warningsText,
} from '../../../src/logistics/hoy/upcoming';

/**
 * Revisión 1 · E1 «Pulido»: the pure parts of the Hoy upcoming cards, the
 * «Ver anteriores» paging of «Actividad reciente» and the catalogue's
 * per-category «Comparar» with medals.
 */

describe('Hoy · what an upcoming event card says', () => {
  const company = (id: string, name: string) => ({id, name});
  const tasks = [
    {
      id: 't1',
      eventId: 'e1',
      status: 'planned',
      company: company('c1', 'Sonido Demo'),
    },
    {
      id: 't2',
      eventId: 'e1',
      status: 'done',
      company: company('c2', 'Vallas Demo'),
    },
    {
      id: 't3',
      eventId: 'e1',
      status: 'confirmed',
      company: company('c3', 'Escenarios Demo'),
    },
    {
      id: 't4',
      eventId: 'e1',
      status: 'planned',
      company: company('c1', 'Sonido Demo'),
    },
    {id: 't5', eventId: 'e2', status: 'cancelled', company: null},
    {
      id: 't6',
      eventId: null,
      status: 'planned',
      company: company('c9', 'Suelta Demo'),
    },
  ] as const;
  const warnings = [
    {key: 'w1', severity: 'conflict', taskIds: ['t1', 't3']},
    {key: 'w2', severity: 'reminder', taskIds: ['t3']},
    {key: 'w3', severity: 'reminder', taskIds: ['t6']},
  ] as const;

  it('counts tasks, closed ones, warnings once per event and live companies', () => {
    const map = summarizeEvents(tasks as never, warnings as never);
    expect(map.get('e1')).toEqual({
      tasks: 4,
      closed: 1,
      conflicts: 1,
      reminders: 1,
      // Finished «Vallas Demo» no longer counts; names once, in order.
      companies: ['Escenarios Demo', 'Sonido Demo'],
    });
    expect(map.get('e2')).toEqual({
      tasks: 1,
      closed: 1,
      conflicts: 0,
      reminders: 0,
      companies: [],
    });
    // A task without event belongs to no card.
    expect([...map.keys()].sort()).toEqual(['e1', 'e2']);
  });

  it('reads companies and warnings in plain Spanish', () => {
    expect(companiesText([])).toBe('');
    expect(companiesText(['A'])).toBe('A');
    expect(companiesText(['A', 'B'])).toBe('A y B');
    expect(companiesText(['A', 'B', 'C'])).toBe('A, B y C');
    expect(companiesText(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C y 2 más');
    expect(warningsText({conflicts: 0, reminders: 0})).toBeNull();
    expect(warningsText({conflicts: 1, reminders: 0})).toBe('1 conflicto');
    expect(warningsText({conflicts: 2, reminders: 1})).toBe(
      '2 conflictos · 1 recordatorio',
    );
    expect(warningsText({conflicts: 0, reminders: 3})).toBe('3 recordatorios');
  });
});

describe('Hoy · «Ver anteriores» in «Actividad reciente»', () => {
  const entry = (id: string, at: string): ActivityEntry =>
    ({id, at, action: 'update', entityType: 'task'}) as ActivityEntry;

  it('merges the store and the pages newest first, each entry once', () => {
    const recent = [
      entry('a', '2026-12-02T10:00:00Z'),
      entry('b', '2026-12-01T09:00:00Z'),
    ];
    const older = [
      entry('b', '2026-12-01T09:00:00Z'),
      entry('c', '2026-11-28T08:00:00Z'),
    ];
    expect(mergeActivity(recent, older).map(e => e.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      mergeActivity([entry('x', '2026-11-01T00:00:00Z')], recent).map(
        e => e.id,
      ),
    ).toEqual(['a', 'b', 'x']);
  });

  it('asks for the week before the oldest entry, that instant included', () => {
    const before = Date.parse('2026-12-01T09:00:00.000Z');
    const w = olderWindow(before);
    expect(w.from).toBe('2026-11-24T09:00:00.000Z');
    expect(w.to).toBe('2026-12-01T09:00:00.001Z');
    expect(w.next).toBe(Date.parse(w.from));
    // Within the route's limit of eight days.
    expect(Date.parse(w.to) - Date.parse(w.from)).toBeLessThan(8 * 86_400_000);
  });

  it('finds the oldest instant, NaN for nothing', () => {
    expect(oldestAt([])).toBeNaN();
    expect(
      oldestAt([
        entry('a', '2026-12-02T10:00:00Z'),
        entry('b', '2026-11-30T10:00:00Z'),
      ]),
    ).toBe(Date.parse('2026-11-30T10:00:00Z'));
  });
});

describe('Catálogo · «Comparar» for a whole category', () => {
  const offer = (
    id: string,
    over: Partial<{
      categoryId: string | null;
      unit: string;
      customUnit: string | null;
      price: number | null;
      vatIncluded: boolean | null;
      companyTax: TaxInfo | null;
    }> = {},
  ) =>
    ({
      id,
      name: `Oferta ${id}`,
      categoryId: 'carpas',
      unit: 'day',
      customUnit: null,
      price: 100,
      vatIncluded: false,
      // E5: IGIC 7 % from the company unless the test says otherwise.
      tax: null,
      companyTax: IGIC,
      ...over,
    }) as never as Comparable;

  const offers = [
    offer('o1', {price: 180}),
    offer('o2', {price: 120}),
    offer('o3', {price: null}),
    offer('o4', {price: 12, unit: 'metre'}),
    offer('o5', {price: 300, vatIncluded: true}),
    offer('o6', {price: 310, vatIncluded: true}),
    offer('o7', {price: 90, vatIncluded: null}),
    offer('s1', {categoryId: 'sonido', price: 450}),
  ];

  it('E5: ranks each unit on its own by the estimate with tax, whatever the tax treatment', () => {
    const {groups, apart} = compareCategory('carpas', offers);
    // 120 + 7 % = 128,40; 180 + 7 % = 192,60; 300 and 310 already include it.
    expect(groups.map(g => g.peers.map(p => p.id))).toEqual([
      ['o2', 'o1', 'o5', 'o6'],
    ]);
    expect(groups[0]?.estimates.o2?.withTax).toBe(128.4);
    expect(apart.map(a => [a.offer.id, a.reason])).toEqual([
      ['o3', 'price'],
      ['o4', 'alone'],
      ['o7', 'tax'],
    ]);
  });

  it('offers «Comparar» only where two offers can be ranked together', () => {
    expect([...categoriesWithComparison(offers)]).toEqual(['carpas']);
    expect(
      categoriesWithComparison([
        offer('a', {price: 10}),
        offer('b', {price: null}),
      ]).size,
    ).toBe(0);
    // E5: tax included and before tax are ranked together once the rate is known…
    expect(
      categoriesWithComparison([
        offer('a', {price: 10, vatIncluded: true}),
        offer('b', {price: 12, vatIncluded: false}),
      ]).size,
    ).toBe(1);
    // …and never with an unknown rate.
    expect(
      categoriesWithComparison([
        offer('a', {price: 10, vatIncluded: true}),
        offer('b', {price: 12, vatIncluded: false, companyTax: null}),
      ]).size,
    ).toBe(0);
  });

  it('says the medal in words and the taxes as declared', () => {
    expect(positionLabel(1)).toBe('1.º, oro');
    expect(positionLabel(2)).toBe('2.º, plata');
    expect(positionLabel(3)).toBe('3.º, bronce');
    expect(positionLabel(4)).toBe('4.º');
    expect(vatText(true)).toBe('Impuestos incluidos');
    expect(vatText(false)).toBe('Sin impuestos');
    expect(vatText(null)).toBe('Impuestos sin verificar');
    // E5: an offer apart says why, the tax one in plain words.
    expect(APART_REASON_LABEL.tax).toBe('sin impuesto conocido');
  });
});
