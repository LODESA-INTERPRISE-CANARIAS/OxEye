import {describe, expect, it} from 'vitest';
import {
  planWarnings,
  RESOURCE_LOAD_NOTE,
  SUBSOIL_THRESHOLD_NOTE,
  type PlanResource,
  type PlanTask,
} from '../../../shared/logistics/conflicts';
import {
  changedFieldsLabel,
  describeChange,
  FIELD_LABEL,
  noteLabel,
} from '../../../shared/logistics/history';
import {
  formatQuantity,
  parseQuantity,
  quantityLabel,
} from '../../../shared/logistics/inventory';
import {
  missingForResource,
  missingForWarehouse,
} from '../../../shared/logistics/quality';
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  BUILT_IN_SERVICE_CATEGORIES,
  INCIDENT_SCOPE_NOTE,
  isValidQuantity,
  NOTE_KIND_LABEL,
  NOTE_KINDS,
} from '../../../shared/logistics/rules';
import {universalSearch} from '../../../shared/logistics/search';
import {phoneInfo} from '../../../shared/logistics/contact-links';

const at = (hhmm: string) => `2026-12-02T${hhmm}:00.000Z`;
const cristo = {id: 'v-cristo', name: 'Plaza del Cristo'};
const adelantado = {id: 'v-adel', name: 'Plaza del Adelantado'};

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  kind: 'transport',
  status: 'planned',
  eventId: null,
  venue: cristo,
  company: null,
  startsAt: at('09:00'),
  endsAt: at('10:00'),
  dependsOn: [],
  heavyLoad: false,
  ...extra,
});

const resource = (
  id: string,
  extra: Partial<PlanResource> = {},
): PlanResource => ({
  id,
  name: id,
  quantity: 1,
  unit: 'unidades',
  condition: 'good',
  availability: 'available',
  ...extra,
});

const ofKind = (tasks: PlanTask[], resources: PlanResource[], kind: string) =>
  planWarnings(tasks, [], resources).filter(w => w.kind === kind);

describe('plan warnings · resources', () => {
  const van = resource('Furgoneta Demo');

  it('a single resource in two overlapping tasks is a conflict', () => {
    const w = ofKind(
      [
        task('Recoger vallas', {resourceIds: [van.id]}),
        task('Llevar mesas', {
          venue: adelantado,
          startsAt: at('09:30'),
          endsAt: at('11:00'),
          resourceIds: [van.id],
        }),
      ],
      [van],
      'resource_overlap',
    );
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe('conflict');
    expect(w[0].minutes).toBe(30);
    expect(w[0].title).toContain('Furgoneta Demo');
  });

  it('with several or an uncounted stock it is a reminder that says what is known', () => {
    const fences = resource('Vallas Demo', {quantity: 200});
    const many = ofKind(
      [
        task('a', {resourceIds: [fences.id]}),
        task('b', {resourceIds: [fences.id], venue: adelantado}),
      ],
      [fences],
      'resource_overlap',
    );
    expect(many[0].severity).toBe('reminder');
    expect(many[0].detail).toContain('200 unidades');

    const uncounted = resource('Mesas Demo', {quantity: null});
    const unknown = ofKind(
      [
        task('a', {resourceIds: [uncounted.id]}),
        task('b', {resourceIds: [uncounted.id]}),
      ],
      [uncounted],
      'resource_overlap',
    );
    expect(unknown[0].severity).toBe('reminder');
    expect(unknown[0].detail).toContain('Aún no consta cuántos hay');
  });

  it('«one» means one unit; none in stock is a conflict', () => {
    const oneKg = resource('Lastre Demo', {quantity: 1, unit: 'kg'});
    const empty = resource('Mesas Demo', {quantity: 0});
    const both = (r: PlanResource) =>
      ofKind(
        [task('a', {resourceIds: [r.id]}), task('b', {resourceIds: [r.id]})],
        [r],
        'resource_overlap',
      )[0];
    expect(both(oneKg).severity).toBe('reminder');
    expect(both(empty).severity).toBe('conflict');
    expect(both(empty).detail).toContain('no hay ninguno');
  });

  it('ignores back-to-back, finished, cancelled and unknown resources', () => {
    expect(
      ofKind(
        [
          task('a', {resourceIds: [van.id]}),
          task('b', {
            resourceIds: [van.id],
            startsAt: at('10:00'),
            endsAt: at('11:00'),
          }),
          task('c', {resourceIds: [van.id], status: 'done'}),
          task('d', {resourceIds: [van.id], status: 'cancelled'}),
          task('e', {resourceIds: ['gone']}),
          task('f', {resourceIds: ['gone']}),
        ],
        [van],
        'resource_overlap',
      ),
    ).toEqual([]);
  });

  it('reminds when a live task counts on something damaged or under repair', () => {
    const tent = resource('Carpa Demo', {availability: 'maintenance'});
    const stage = resource('Tarima Demo', {condition: 'damaged'});
    const w = ofKind(
      [task('Montaje', {resourceIds: [tent.id, stage.id]})],
      [tent, stage],
      'resource_unavailable',
    );
    expect(w.map(x => x.title)).toEqual([
      '«Carpa Demo»: en reparación',
      '«Tarima Demo»: con daños',
    ]);
    expect(w.every(x => x.severity === 'reminder')).toBe(true);
  });

  it('never turns resource quantity, unit or weight into a heavy-load answer', () => {
    const ballast = resource('Lastre Demo', {quantity: 4000, unit: 'kg'});
    const tasks = [
      task('Montaje', {
        kind: 'assembly',
        heavyLoad: null,
        resourceIds: [ballast.id],
      }),
    ];
    const w = planWarnings(tasks, [], [ballast]);
    // Still asked, not answered by the inventory.
    expect(w.map(x => x.kind)).toEqual(['heavy_load_unknown']);
    expect(w.some(x => x.kind === 'heavy_load')).toBe(false);
    for (const x of w) expect(x.detail).not.toMatch(/kg\/m/);
  });

  it('the resource load note sends to the simulator and quotes no threshold', () => {
    expect(RESOURCE_LOAD_NOTE).toContain('simulador');
    expect(RESOURCE_LOAD_NOTE).toContain('rayos X');
    expect(RESOURCE_LOAD_NOTE).not.toMatch(/\d+\s*kg\/m/);
    expect(SUBSOIL_THRESHOLD_NOTE).toContain('orientativo');
  });
});

describe('inventory quantities', () => {
  it('reads quantities the way they are typed in Spanish', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('  ')).toBeNull();
    expect(parseQuantity('200')).toBe(200);
    expect(parseQuantity('2,5')).toBe(2.5);
    expect(parseQuantity('1.000')).toBe(1000);
    expect(parseQuantity('12.500,5')).toBe(12500.5);
    expect(parseQuantity('0.500')).toBe(0.5);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('0')).toBe(0);
  });

  it('rejects text, negatives, three decimals and absurd figures', () => {
    for (const bad of ['muchas', '-3', '1,234', '2000000', '3x6']) {
      expect(parseQuantity(bad)).toBeNaN();
    }
    expect(isValidQuantity(1_000_000)).toBe(true);
    expect(isValidQuantity(1_000_000.01)).toBe(false);
  });

  it('labels a quantity honestly', () => {
    expect(formatQuantity(2.5)).toBe('2,5');
    expect(
      quantityLabel({quantity: 200, unit: 'unidades', toAssess: false}),
    ).toBe('200 unidades');
    expect(
      quantityLabel({quantity: 40, unit: 'unidades', toAssess: true}),
    ).toBe('≈ 40 unidades · por evaluar');
    expect(
      quantityLabel({quantity: 1, unit: 'unidades', toAssess: false}),
    ).toBe('1 unidad');
    expect(quantityLabel({quantity: 1, unit: 'juegos', toAssess: false})).toBe(
      '1 juegos',
    );
    expect(quantityLabel({quantity: null, unit: 'm', toAssess: false})).toBe(
      'Sin contar',
    );
    expect(quantityLabel({quantity: null, unit: 'm', toAssess: true})).toBe(
      'Por evaluar',
    );
  });
});

describe('inventory quality', () => {
  const base = {
    quantity: 10,
    dimensions: '3 × 6 m',
    warehouse: {id: 'w', name: 'Almacén Demo'},
    condition: 'good' as const,
    toAssess: false,
    ownership: 'owned' as const,
    company: null,
    categoryId: 'cat',
  };

  it('owned material asks for a warehouse, contracted for its company', () => {
    expect(missingForResource(base)).toEqual([]);
    expect(missingForResource({...base, warehouse: null})).toEqual(['almacén']);
    expect(
      missingForResource({...base, ownership: 'contracted', warehouse: null}),
    ).toEqual(['empresa']);
  });

  it('«aún por evaluar» keeps quantity and condition pending', () => {
    expect(missingForResource({...base, toAssess: true})).toEqual([
      'cantidad',
      'estado',
    ]);
  });

  it('a withheld address is not missing', () => {
    expect(missingForWarehouse({address: null})).toEqual(['dirección']);
    expect(missingForWarehouse({address: null, restricted: true})).toEqual([]);
  });
});

describe('search · inventories', () => {
  const categories = [{id: 'c-carpas', name: 'Carpas'}];
  const sources = {
    categories,
    warehouses: [{id: 'w1', name: 'Almacén Demo Las Torres'}],
    resources: [
      {
        id: 'r1',
        name: 'Carpa 3×6 Demo',
        ownership: 'owned' as const,
        categoryId: 'c-carpas',
        warehouse: {id: 'w1', name: 'Almacén Demo Las Torres'},
        company: null,
      },
      {
        id: 'r2',
        name: 'Aseos portátiles Demo',
        ownership: 'contracted' as const,
        categoryId: null,
        warehouse: null,
        company: {id: 'c1', name: 'Escenarios Demo'},
      },
    ],
  };

  it('finds warehouses and resources by name, category and place', () => {
    expect(universalSearch('torres', sources).map(h => h.id)).toEqual([
      'w1',
      'r1',
    ]);
    expect(universalSearch('carpas', sources).map(h => h.id)).toEqual(['r1']);
    const aseos = universalSearch('aseos', sources)[0];
    expect(aseos.subtitle).toBe('Contratado · Escenarios Demo');
  });

  it('filters resources by category', () => {
    expect(
      universalSearch('', sources, {categoryId: 'c-carpas'}).map(h => h.id),
    ).toEqual(['r1']);
  });

  it('never searches notes, locations or resource notes', () => {
    const withText = {
      ...sources,
      resources: sources.resources.map(r => ({
        ...r,
        location: 'Nave secreta',
        notes: 'marcadorprivado',
      })),
      notes: [{id: 'n1', text: 'marcadorprivado'}],
    } as unknown as Parameters<typeof universalSearch>[1];
    expect(universalSearch('marcadorprivado', withText)).toEqual([]);
    expect(universalSearch('secreta', withText)).toEqual([]);
  });
});

describe('history and note labels', () => {
  it('describes changes by field name, never by value', () => {
    expect(describeChange({action: 'create', changedFields: []})).toBe(
      'Creó el registro',
    );
    expect(
      describeChange({
        action: 'update',
        changedFields: ['startsAt', 'company', 'status'],
      }),
    ).toBe('Cambió hora de inicio, empresa y estado');
    expect(changedFieldsLabel(['quantity'])).toBe('cantidad');
    expect(changedFieldsLabel(['condition', 'status'])).toBe('estado');
  });

  it('labels every field the server logs for M4 records', () => {
    for (const f of [
      'address',
      'ownership',
      'warehouse',
      'offerId',
      'quantity',
      'dimensions',
      'condition',
      'availability',
      'location',
      'toAssess',
      'text',
      'ref',
      'resolved',
      'resourceIds',
    ]) {
      expect(FIELD_LABEL[f], f).toBeTruthy();
    }
  });

  it('a note label is its kind and what it points at, never its text', () => {
    expect(noteLabel({kind: 'incident', ref: {label: 'Montaje Demo'}})).toBe(
      'Incidencia · Montaje Demo',
    );
    expect(noteLabel({kind: 'decision', event: {name: 'Navidad Demo'}})).toBe(
      'Decisión · Navidad Demo',
    );
    const withText = {
      kind: 'note' as const,
      text: 'marcadorprivado',
      ref: null,
      event: null,
    };
    expect(noteLabel(withText)).toBe('Nota');
    // Never «Incidencia · <person>»: falls back to the event, or the kind.
    expect(
      noteLabel({
        kind: 'incident',
        ref: {type: 'contact', label: 'Ana Demo'},
        event: {name: 'Navidad Demo'},
      }),
    ).toBe('Incidencia · Navidad Demo');
    expect(
      noteLabel({kind: 'incident', ref: {type: 'contact', label: 'Ana Demo'}}),
    ).toBe('Incidencia');
    expect(NOTE_KINDS.map(k => NOTE_KIND_LABEL[k])).toHaveLength(5);
  });

  it('the incident copy keeps Punto Violeta and attended people out', () => {
    expect(INCIDENT_SCOPE_NOTE).toContain('Punto Violeta');
    expect(INCIDENT_SCOPE_NOTE).toContain('personas atendidas');
  });

  it('resource categories are their own list', () => {
    expect(BUILT_IN_RESOURCE_CATEGORIES).toContain('Carpas');
    expect(new Set(BUILT_IN_RESOURCE_CATEGORIES).size).toBe(
      BUILT_IN_RESOURCE_CATEGORIES.length,
    );
    // Same name in both scopes is fine (scoped unique index).
    expect(BUILT_IN_SERVICE_CATEGORIES).toContain('Carpas');
  });
});

describe('phone warning reasons', () => {
  it('carries a code with every warning', () => {
    expect(phoneInfo('600 000 001')!.reason).toBeNull();
    expect(phoneInfo('+600 000 001')!.reason).toBe('missing_34');
    expect(phoneInfo('922 00 00 / 600 00 00 01')!.reason).toBe('two_numbers');
    expect(phoneInfo('60000')!.reason).toBe('incomplete');
    expect(phoneInfo('1234567890')!.reason).toBe('unknown_country');
    expect(phoneInfo('+34 600 00')!.warning).toContain('9 cifras');
    expect(phoneInfo('+44 12')!.warning).toBe('El número parece incompleto.');
  });
});
