import {describe, expect, it} from 'vitest';
import {
  planWarnings,
  ROUTES_REMINDER,
} from '../../../shared/logistics/conflicts';
import type {
  Contact,
  Resource,
  Task,
  Warehouse,
} from '../../../shared/logistics/contracts';
import {
  buildWorkOrder,
  defaultWorkOrderFields,
  effectiveFields,
  isDefaultSelected,
  tasksForRecipient,
  WORK_ORDER_FIELDS,
  workOrderText,
  type BuildWorkOrderInput,
  type WorkOrderField,
} from '../../../shared/logistics/work-order';

const at = (hhmm: string) => `2026-12-02T${hhmm}:00.000Z`;
const user = {id: 'u1', displayName: 'Prueba'};
const meta = {
  version: 1,
  createdBy: user,
  createdAt: at('08:00'),
  updatedBy: user,
  updatedAt: at('08:00'),
  source: null,
  verification: 'draft' as const,
  isDemo: false,
  organizationId: 'org',
};
// Free-text markers: none of them may ever reach a work order unless the
// member explicitly ticks the field that holds it.
const M = {
  taskNotes: 'MARCA-OBSERVACION-TAREA',
  contactNotes: 'MARCA-NOTAS-PERSONA',
  contactDescription: 'MARCA-DESCRIPCION-PERSONA',
  address: 'MARCA-DIRECCION-ALMACEN',
  warehouseNotes: 'MARCA-NOTAS-ALMACEN',
  location: 'MARCA-UBICACION-RECURSO',
  resourceNotes: 'MARCA-NOTAS-RECURSO',
  phone: '+34 000 000 001',
};
const company = {id: 'co-esc', name: 'Escenarios Demo'};
const person = {id: 'ct-ana', name: 'Ana Demo'};

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...meta,
  id,
  eventId: 'ev',
  venue: {id: 'v-cristo', name: 'Plaza del Cristo'},
  title: id,
  kind: 'assembly',
  status: 'planned',
  date: '2026-12-02',
  endDate: null,
  startsAt: at('09:00'),
  endsAt: at('11:00'),
  timezone: 'Atlantic/Canary',
  company,
  contact: person,
  dependsOn: [],
  heavyLoad: false,
  resourceIds: ['r-carpa'],
  subsoilReview: null,
  notes: M.taskNotes,
  restricted: false,
  ...extra,
});

const contact: Contact = {
  ...meta,
  id: person.id,
  name: person.name,
  role: 'Coordinación',
  company,
  phone: M.phone,
  email: 'ana@example.com',
  description: M.contactDescription,
  notes: M.contactNotes,
  eventIds: [],
  restricted: false,
};
const warehouse: Warehouse = {
  ...meta,
  id: 'w1',
  name: 'Almacén Demo',
  address: M.address,
  notes: M.warehouseNotes,
  resourceCount: 1,
  acronym: null,
  openingHours: null,
  restricted: false,
};
const resource: Resource = {
  ...meta,
  id: 'r-carpa',
  name: 'Carpa 3×6 Demo',
  ownership: 'owned',
  categoryId: null,
  warehouse: {id: 'w1', name: 'Almacén Demo'},
  company: null,
  offerId: null,
  quantity: 2,
  unit: 'unidades',
  dimensions: '3 × 6 m',
  condition: 'good',
  availability: 'available',
  location: M.location,
  toAssess: false,
  notes: M.resourceNotes,
  taskIds: ['montaje'],
  media: [],
  restricted: false,
};

const camion = task('Camión Demo', {
  kind: 'delivery',
  startsAt: at('08:00'),
  endsAt: at('09:00'),
  company: null,
  contact: null,
  resourceIds: [],
});
const montaje = task('montaje', {
  title: 'Montaje Demo',
  dependsOn: [camion.id],
  heavyLoad: true,
});

const input = (
  fields: Iterable<WorkOrderField>,
  extra: Partial<BuildWorkOrderInput> = {},
): BuildWorkOrderInput => ({
  recipient: {kind: 'company', ...company},
  tasks: [montaje],
  allTasks: [camion, montaje],
  events: [{id: 'ev', name: 'Navidad Demo'}],
  resources: [resource],
  warehouses: [warehouse],
  contacts: [contact],
  warnings: [],
  fields,
  role: 'member',
  generatedBy: 'Prueba',
  generatedAt: '26 nov 2026, 10:32',
  ...extra,
});

const ALL = WORK_ORDER_FIELDS.map(f => f.id);
const everything = (s: string) => Object.values(M).filter(m => s.includes(m));

describe('work order · fields', () => {
  it('defaults: schedule, venue, materials, contact name and dependencies; nothing members-only', () => {
    expect([...defaultWorkOrderFields()].sort()).toEqual(
      ['contact', 'dependencies', 'materials', 'schedule', 'venue'].sort(),
    );
    for (const f of WORK_ORDER_FIELDS) {
      if (f.membersOnly) expect(f.defaultOn).toBe(false);
    }
  });

  it('guests never get members-only fields, even if asked for', () => {
    expect([...effectiveFields(ALL, 'guest')].sort()).toEqual(
      ['contact', 'dependencies', 'materials', 'schedule', 'venue'].sort(),
    );
    const order = buildWorkOrder(input(ALL, {role: 'guest'}));
    expect(everything(JSON.stringify(order))).toEqual([]);
    expect(everything(workOrderText(order))).toEqual([]);
  });

  it('with the defaults no free text, address, location or phone appears', () => {
    const order = buildWorkOrder(input(defaultWorkOrderFields()));
    const text = workOrderText(order);
    expect(everything(JSON.stringify(order))).toEqual([]);
    expect(everything(text)).toEqual([]);
    expect(text).toContain('Montaje Demo (montaje)');
    expect(text).toContain(
      'Miércoles, 2 de diciembre de 2026, 09:00–11:00 · por confirmar',
    );
    expect(text).toContain('Lugar: Plaza del Cristo');
    expect(text).toContain(
      'Material: Carpa 3×6 Demo (2 unidades) · Almacén Demo',
    );
    expect(text).toContain('Contacto: Ana Demo');
    expect(text).toContain('Empieza cuando termine: Camión Demo (08:00–09:00)');
    expect(text).toContain('Carga pesada');
  });

  it('members-only fields appear only when ticked; people notes, descriptions and notes never do', () => {
    const text = workOrderText(buildWorkOrder(input(ALL)));
    expect(everything(text).sort()).toEqual(
      [M.taskNotes, M.address, M.location, M.phone].sort(),
    );
    for (const never of [
      M.contactNotes,
      M.contactDescription,
      M.warehouseNotes,
      M.resourceNotes,
    ]) {
      expect(text).not.toContain(never);
    }
  });

  it('never prices or costs, and no subsoil wording for the company', () => {
    const text = workOrderText(buildWorkOrder(input(ALL)));
    expect(text).not.toMatch(/€|precio|coste|kg\/m²|subsuelo/i);
  });

  it('a confirmed time is not «por confirmar»; without schedule there is no time at all', () => {
    const confirmed = buildWorkOrder(
      input(defaultWorkOrderFields(), {
        tasks: [{...montaje, status: 'confirmed'}],
      }),
    );
    expect(confirmed.items[0].toConfirm).toBe(false);
    const none = buildWorkOrder(input(['venue']));
    expect(none.items[0]).toMatchObject({
      day: null,
      time: null,
      toConfirm: false,
      materials: [],
      contact: null,
      dependencies: [],
    });
  });
});

describe('work order · times', () => {
  it('overnight reads as a range; a later end day is named in the compact form', () => {
    const t = (startsAt: string, endsAt: string) =>
      buildWorkOrder(
        input(['schedule'], {tasks: [{...montaje, startsAt, endsAt}]}),
      ).items[0].time;
    const nb = String.fromCharCode(0xa0);
    expect(t(at('22:00'), '2026-12-03T02:00:00.000Z')).toBe('22:00–02:00');
    expect(t('2026-11-30T08:00:00.000Z', at('06:00'))).toBe(
      `08:00${nb}→ mié${nb}2${nb}dic, 06:00`,
    );
    // CAP2: «07:00 → jue 3 dic, 22:30», not the long date that overflowed.
    expect(t(at('07:00'), '2026-12-03T22:30:00.000Z')).toBe(
      `07:00${nb}→ jue${nb}3${nb}dic, 22:30`,
    );
    // Words of the date never split; only after the arrow or the comma.
    expect(t(at('08:00'), '2026-12-03T10:00:00.000Z')!.split(' ')).toEqual([
      `08:00${nb}→`,
      `jue${nb}3${nb}dic,`,
      '10:00',
    ]);
    // Another year is named.
    expect(t(at('08:00'), '2027-01-02T10:00:00.000Z')).toBe(
      `08:00${nb}→ sáb${nb}2${nb}ene${nb}2027, 10:00`,
    );
  });
});

describe('work order · routes reminder', () => {
  it('a delivery during the event carries the routes A/B/C and Carpa Amarilla reminder', () => {
    const delivery = {...camion, company, eventId: 'ev'};
    const warnings = planWarnings(
      [delivery],
      [
        {
          id: 'ev',
          name: 'Navidad Demo',
          startsAt: at('07:00'),
          endsAt: at('20:00'),
          status: 'confirmed',
        },
      ],
    );
    const order = buildWorkOrder(
      input(defaultWorkOrderFields(), {tasks: [delivery], warnings}),
    );
    expect(order.items[0].routes).toBe(true);
    expect(order.routesNote).toBe(ROUTES_REMINDER);
    expect(workOrderText(order)).toContain('Carpa Amarilla');
    expect(
      buildWorkOrder(input(defaultWorkOrderFields())).routesNote,
    ).toBeNull();
  });
});

describe('work order · recipients', () => {
  it('a company gets its tasks; a person the tasks they are in charge of', () => {
    const other = task('otra', {
      company: {id: 'co-x', name: 'Otra Demo'},
      contact: null,
    });
    const all = [camion, montaje, other];
    expect(
      tasksForRecipient(all, {kind: 'company', ...company}).map(t => t.id),
    ).toEqual(['montaje']);
    expect(
      tasksForRecipient(all, {kind: 'contact', ...person}).map(t => t.id),
    ).toEqual(['montaje']);
  });

  it('finished and cancelled tasks start unticked', () => {
    expect(isDefaultSelected({status: 'planned'})).toBe(true);
    expect(isDefaultSelected({status: 'done'})).toBe(false);
    expect(isDefaultSelected({status: 'cancelled'})).toBe(false);
  });
});
