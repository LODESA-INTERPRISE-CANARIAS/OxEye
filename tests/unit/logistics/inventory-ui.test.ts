import {describe, expect, it} from 'vitest';
import type {
  Company,
  Note,
  Resource,
  Warehouse,
} from '../../../shared/logistics/contracts';
import {verificationSummary} from '../../../src/logistics/lib/events';
import {
  countByCategory,
  excerpt,
  groupByCompany,
  groupByWarehouse,
  isOpenNote,
  LOOSE,
  notesAbout,
  notesForToday,
  quantityCertainty,
  resolvedLabel,
  sortNotes,
} from '../../../src/logistics/lib/inventory';

const meta = {
  version: 1,
  createdBy: {id: 'u1', displayName: 'Equipo'},
  createdAt: '2026-12-02T09:00:00.000Z',
  updatedBy: {id: 'u1', displayName: 'Equipo'},
  updatedAt: '2026-12-02T09:00:00.000Z',
  source: null,
  verification: 'draft' as const,
  isDemo: false,
  organizationId: 'org',
};

const warehouse = (id: string, name: string, over: Partial<Warehouse> = {}) =>
  ({
    ...meta,
    id,
    name,
    address: null,
    notes: null,
    resourceCount: 0,
    restricted: false,
    ...over,
  }) satisfies Warehouse;

const resource = (id: string, over: Partial<Resource> = {}): Resource => ({
  ...meta,
  id,
  name: `Recurso ${id}`,
  ownership: 'owned',
  categoryId: null,
  warehouse: null,
  company: null,
  offerId: null,
  quantity: null,
  unit: 'unidades',
  dimensions: null,
  condition: 'unknown',
  availability: 'unknown',
  location: null,
  toAssess: false,
  notes: null,
  taskIds: [],
  restricted: false,
  ...over,
});

const company = (id: string, name: string): Company => ({
  ...meta,
  id,
  name,
  kind: 'supplier',
  categoryIds: [],
  phone: null,
  email: null,
  website: null,
  notes: null,
  mainContactId: null,
  contactCount: 0,
  offerCount: 0,
  restricted: false,
});

const note = (id: string, over: Partial<Note> = {}): Note => ({
  ...meta,
  id,
  kind: 'note',
  text: 'Texto de prueba',
  event: null,
  ref: null,
  resolved: false,
  restricted: false,
  ...over,
});

const norte = warehouse('w1', 'Almacén Demo Norte');
const sur = warehouse('w2', 'almacén demo sur');
const vacio = warehouse('w3', 'Almacén Demo Vacío');

describe('groupByWarehouse', () => {
  const list = [
    resource('r1', {name: 'Vallas', warehouse: {id: 'w2', name: sur.name}}),
    resource('r2', {name: 'Carpas', warehouse: {id: 'w1', name: norte.name}}),
    resource('r3', {name: 'Mesas'}),
    // A warehouse not loaded (deleted meanwhile): goes with the loose ones.
    resource('r4', {name: 'Bancos', warehouse: {id: 'gone', name: 'Viejo'}}),
  ];

  it('orders warehouses by name ignoring case and puts «Sin almacén» last', () => {
    const groups = groupByWarehouse(list, [sur, vacio, norte], false);
    expect(groups.map(g => g.key)).toEqual(['w1', 'w2', LOOSE]);
    expect(groups[2].items.map(r => r.name)).toEqual(['Bancos', 'Mesas']);
  });

  it('keeps empty warehouses only when asked (a new one must be visible)', () => {
    const groups = groupByWarehouse(list, [sur, vacio, norte], true);
    expect(groups.map(g => g.key)).toEqual(['w1', 'w2', 'w3', LOOSE]);
    expect(groups[2].items).toEqual([]);
  });
});

describe('groupByCompany', () => {
  it('groups contracted services by company and links the loaded record', () => {
    const acme = company('c1', 'Alquileres Demo');
    const groups = groupByCompany(
      [
        resource('a', {
          ownership: 'contracted',
          company: {id: 'c2', name: 'Zeta Prueba'},
        }),
        resource('b', {
          ownership: 'contracted',
          company: {id: 'c1', name: acme.name},
        }),
        resource('c', {ownership: 'contracted'}),
      ],
      [acme],
    );
    expect(groups.map(g => g.company?.name ?? null)).toEqual([
      'Alquileres Demo',
      'Zeta Prueba',
      null,
    ]);
    expect(groups[0].record).toBe(acme);
    expect(groups[1].record).toBeNull();
    expect(groups[2].key).toBe(LOOSE);
  });
});

describe('countByCategory', () => {
  it('counts per category, with «sin categoría» apart', () => {
    const counts = countByCategory([
      resource('a', {categoryId: 'k1'}),
      resource('b', {categoryId: 'k1'}),
      resource('c'),
    ]);
    expect(counts.get('k1')).toBe(2);
    expect(counts.get(LOOSE)).toBe(1);
  });
});

describe('quantityCertainty', () => {
  it('follows the certainty grammar and never reads «sin contar» as 0', () => {
    expect(quantityCertainty(resource('a'))).toBe('pending');
    expect(quantityCertainty(resource('a', {quantity: 0}))).toBe('planned');
    expect(
      quantityCertainty(resource('a', {quantity: 40, toAssess: true})),
    ).toBe('hypothesis');
    expect(
      quantityCertainty(
        resource('a', {quantity: 200, verification: 'validated'}),
      ),
    ).toBe('confirmed');
    // «Aún por evaluar» wins over a validated record: the figure is provisional.
    expect(
      quantityCertainty(
        resource('a', {
          quantity: 200,
          toAssess: true,
          verification: 'validated',
        }),
      ),
    ).toBe('hypothesis');
  });
});

describe('notes', () => {
  it('open means an unresolved incident or open question only', () => {
    expect(isOpenNote(note('a', {kind: 'incident'}))).toBe(true);
    expect(isOpenNote(note('a', {kind: 'incident', resolved: true}))).toBe(
      false,
    );
    expect(isOpenNote(note('a', {kind: 'open_question'}))).toBe(true);
    expect(isOpenNote(note('a', {kind: 'decision'}))).toBe(false);
    expect(resolvedLabel(note('a', {kind: 'open_question'}))).toBe(
      'Sin responder',
    );
    expect(resolvedLabel(note('a', {kind: 'incident', resolved: true}))).toBe(
      'Resuelta',
    );
    expect(resolvedLabel(note('a'))).toBeNull();
  });

  it('an event lists notes filed under it; any other record those linked to it', () => {
    const list = [
      note('a', {event: {id: 'e1', name: 'Feria Demo'}}),
      note('b', {
        event: {id: 'e1', name: 'Feria Demo'},
        ref: {type: 'resource', id: 'r1', label: 'Vallas'},
      }),
      note('c', {ref: {type: 'resource', id: 'r1', label: 'Vallas'}}),
      note('d', {ref: {type: 'warehouse', id: 'r1', label: 'Mismo id'}}),
    ];
    expect(notesAbout(list, {type: 'event', id: 'e1'}).map(n => n.id)).toEqual([
      'a',
      'b',
    ]);
    expect(
      notesAbout(list, {type: 'resource', id: 'r1'}).map(n => n.id),
    ).toEqual(['b', 'c']);
  });

  it('Hoy: open ones first (oldest first, any day), then today newest first', () => {
    const list = [
      note('old-incident', {
        kind: 'incident',
        createdAt: '2026-11-30T10:00:00.000Z',
      }),
      note('new-question', {
        kind: 'open_question',
        createdAt: '2026-12-02T08:00:00.000Z',
      }),
      note('today-early', {createdAt: '2026-12-02T07:00:00.000Z'}),
      note('today-late', {createdAt: '2026-12-02T12:00:00.000Z'}),
      note('yesterday', {createdAt: '2026-12-01T12:00:00.000Z'}),
      note('closed', {
        kind: 'incident',
        resolved: true,
        createdAt: '2026-11-30T09:00:00.000Z',
      }),
      // Atlantic/Canary is UTC+0 in December: 23:30 UTC on the 1st is
      // still the 1st locally.
      note('late-night', {createdAt: '2026-12-01T23:30:00.000Z'}),
    ];
    const hoy = notesForToday(list, '2026-12-02', 'Atlantic/Canary');
    expect(hoy.open.map(n => n.id)).toEqual(['old-incident', 'new-question']);
    expect(hoy.today.map(n => n.id)).toEqual(['today-late', 'today-early']);
  });

  it('sorts newest first and cuts excerpts on one line', () => {
    expect(
      sortNotes([
        note('a', {createdAt: '2026-12-01T10:00:00.000Z'}),
        note('b', {createdAt: '2026-12-02T10:00:00.000Z'}),
      ]).map(n => n.id),
    ).toEqual(['b', 'a']);
    expect(excerpt('  Línea uno\n\nlínea   dos ')).toBe('Línea uno línea dos');
    const long = excerpt('x'.repeat(200), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('verificationSummary with inventories', () => {
  it('counts warehouses and resources and lists what they lack', () => {
    const summary = verificationSummary([], [], {
      warehouses: [
        norte,
        warehouse('w9', 'Validado', {
          verification: 'validated',
          address: 'Calle Demo 1',
        }),
      ],
      resources: [
        resource('r1', {
          name: 'Vallas',
          warehouse: {id: 'w1', name: norte.name},
          quantity: 10,
          condition: 'good',
          verification: 'validated',
        }),
      ],
    });
    expect(summary.total).toBe(3);
    expect(summary.validated).toBe(2);
    const row = summary.incomplete.find(r => r.kind === 'warehouse');
    expect(row?.name).toBe('Almacén Demo Norte');
    expect(row?.missing).toEqual(['dirección', 'validación']);
  });

  it('a guest’s withheld address is not «missing»', () => {
    const summary = verificationSummary([], [], {
      warehouses: [
        warehouse('w1', 'Almacén', {
          restricted: true,
          verification: 'validated',
        }),
      ],
    });
    expect(summary.incomplete).toEqual([]);
  });
});
