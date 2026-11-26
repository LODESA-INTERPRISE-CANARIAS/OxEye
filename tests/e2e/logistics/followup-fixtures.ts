import {
  dailos,
  elvis,
  makeCompany,
  makeContact,
  makeEvent,
  makeHypothesis,
  makeNote,
  makeOffer,
  makeResource,
  makeTask,
  makeWarehouse,
  type MockOptions,
} from './mock-api';
import {
  ALMACEN,
  DAY,
  NOW,
  PLAZA_ADELANTADO,
  PLAZA_CRISTO,
  planVenues,
} from './plan-fixtures';

/**
 * Fixtures for the milestone 5 specs (la jornada, «¿Y si…?», work orders,
 * the declared subsoil mark). Use with `fixClock` from plan-fixtures.ts:
 * Wednesday 2 December 2026, 10:30 in La Laguna (UTC+0 in winter).
 * Fictitious data only: «Demo» names, phones `+34 000 000 0XX`, addresses
 * `@example.com`.
 *
 * At 10:30:
 *   Va tarde      h1 «Montaje del escenario Demo», confirmed 09:00–13:00, not
 *                 started (+1 h 30 min). Heavy load, subsoil declared by
 *                 Dailos, uses r1. Escenarios Demo, contact Ana Demo.
 *   Ahora         h6 «Recogida de material Demo», in progress 10:00–11:00.
 *   Lo siguiente  h7 «Reparto de mesas Demo», 11:00–12:00, after h6.
 *   Más tarde     h2 «Instalación de sonido Demo» 13:00–15:00 after h1;
 *                 h4 «Entrega de vallas Demo» (delivery, event e1) 15:30–16:45
 *                 after h2 (30 min slack); h3 «Pruebas de luces Demo»
 *                 16:00–16:30 after h2 (60 min slack, another venue);
 *                 h9 «Entrega de generador Demo» (delivery during e1)
 *                 18:00–18:30, Escenarios Demo: the routes reminder.
 *   Sin hora      h5 «Limpieza Demo», after h2 (cannot be computed).
 *   Terminadas    h8 «Carga del camión Demo», done 07:00–08:00.
 *
 * Delaying h1:
 *   30 min  → h1 and h2 move; h4 absorbs it (0 min left), h3 too (30 min
 *             left); h5 unknown; e1 margin 2 h → 1 h 30 min.
 *   120 min → h1, h2, h4 (17:00–18:15) and h3 move; h4 runs 1 h 15 min into
 *             e1 (routes reminder) and overlaps h9 at Plaza del Cristo (new
 *             warning).
 *
 * Every free-text field a work order or a guest must not carry by default has
 * a marker (`OBS-…`, `DIRECCION-…`, `UBICACION-…`, `NOTA-…`, `DESCRIPCION-…`,
 * `CONDICION-…`, `TEXTO-NOTA-…`, price 4321,5).
 */

const stamp = {
  createdAt: '2026-12-01T09:00:00.000Z',
  updatedAt: '2026-12-01T09:00:00.000Z',
};
const at = (time: string, date = DAY) => `${date}T${time}:00.000Z`;

export const ESCENARIOS = {id: 'c1', name: 'Escenarios Demo'};
export const SONIDO = {id: 'c2', name: 'Sonido Demo'};
export const VALLAS = {id: 'c3', name: 'Vallas Demo'};
export const ANA = {id: 'p1', name: 'Ana Demo'};
export const BRUNO = {id: 'p2', name: 'Bruno Demo'};
export const NORTE = {id: 'w1', name: 'Almacén Demo Norte'};

/** Markers that never belong in a default work order (or a guest's view). */
export const ORDER_PRIVATE = {
  observations: 'OBS-TAREA-PRIVADA',
  contactPhone: '000 000 011',
  companyNotes: 'NOTA-EMPRESA-PRIVADA',
  warehouseAddress: 'DIRECCION-ALMACEN-PRIVADA',
  resourceLocation: 'UBICACION-PRIVADA',
  resourceNotes: 'OBS-RECURSO-PRIVADA',
  personNotes: 'NOTA-PERSONA-PRIVADA',
  personDescription: 'DESCRIPCION-PRIVADA',
  offerConditions: 'CONDICION-PRIVADA',
  noteText: 'TEXTO-NOTA-PRIVADA',
  hypothesisNote: 'NOTA-HIPOTESIS-PRIVADA',
};
/** How the offer price could be shown. */
export const ORDER_PRICES = ['4321', '4.321'];

export const followEvents = () => [
  makeEvent(
    'e1',
    'Navidad en la Plaza del Cristo',
    {date: DAY, start: '17:00', end: '21:00'},
    {
      ...stamp,
      venue: {...PLAZA_CRISTO},
      status: 'confirmed',
      verification: 'validated',
    },
  ),
];

export const followCompanies = () => [
  makeCompany(ESCENARIOS.id, ESCENARIOS.name, {
    ...stamp,
    phone: '+34 000 000 001',
    email: 'escenarios@example.com',
    notes: `${ORDER_PRIVATE.companyNotes}: llegan por detrás.`,
    mainContactId: ANA.id,
  }),
  makeCompany(SONIDO.id, SONIDO.name, {...stamp}),
  makeCompany(VALLAS.id, VALLAS.name, {...stamp}),
];

export const followContacts = () => [
  makeContact(ANA.id, ANA.name, {
    ...stamp,
    role: 'Jefa de montaje',
    company: {...ESCENARIOS},
    phone: '+34 000 000 011',
    email: 'ana.demo@example.com',
    description: `${ORDER_PRIVATE.personDescription} coordina el montaje.`,
    notes: `${ORDER_PRIVATE.personNotes}: prefiere WhatsApp.`,
  }),
  // No phone and no e-mail: WhatsApp cannot be offered.
  makeContact(BRUNO.id, BRUNO.name, {
    ...stamp,
    role: 'Conductor',
    company: {...VALLAS},
  }),
];

export const followOffers = () => [
  makeOffer('o1', 'Escenario Demo 8 × 6 m', ESCENARIOS, {
    ...stamp,
    price: 4321.5,
    unit: 'day',
    conditions: `${ORDER_PRIVATE.offerConditions}: mínimo dos días.`,
  }),
];

export const followWarehouses = () => [
  makeWarehouse(NORTE.id, NORTE.name, {
    ...stamp,
    address: `Calle Ficticia Demo, 1 · ${ORDER_PRIVATE.warehouseAddress}`,
  }),
];

export const followResources = () => [
  makeResource('r1', 'Tarima Demo', {
    ...stamp,
    warehouse: {...NORTE},
    quantity: 20,
    location: `${ORDER_PRIVATE.resourceLocation} nave 2`,
    notes: `${ORDER_PRIVATE.resourceNotes}: dos tablas rayadas.`,
  }),
];

export const SUBSOIL_DECLARED = {by: dailos, at: at('08:45')};

export const followTasks = () => [
  makeTask(
    'h1',
    'Montaje del escenario Demo',
    {date: DAY, start: '09:00', end: '13:00'},
    {
      ...stamp,
      eventId: 'e1',
      kind: 'assembly',
      status: 'confirmed',
      venue: {...PLAZA_CRISTO},
      company: {...ESCENARIOS},
      contact: {...ANA},
      heavyLoad: true,
      resourceIds: ['r1'],
      subsoilReview: {...SUBSOIL_DECLARED},
      notes: `${ORDER_PRIVATE.observations}: llamar antes de descargar.`,
    },
  ),
  makeTask(
    'h2',
    'Instalación de sonido Demo',
    {date: DAY, start: '13:00', end: '15:00'},
    {
      ...stamp,
      eventId: 'e1',
      kind: 'assembly',
      venue: {...PLAZA_CRISTO},
      company: {...SONIDO},
      heavyLoad: false,
      dependsOn: ['h1'],
    },
  ),
  makeTask(
    'h3',
    'Pruebas de luces Demo',
    {date: DAY, start: '16:00', end: '16:30'},
    {
      ...stamp,
      kind: 'other',
      venue: {...PLAZA_ADELANTADO},
      dependsOn: ['h2'],
    },
  ),
  makeTask(
    'h4',
    'Entrega de vallas Demo',
    {date: DAY, start: '15:30', end: '16:45'},
    {
      ...stamp,
      eventId: 'e1',
      kind: 'delivery',
      venue: {...PLAZA_CRISTO},
      company: {...VALLAS},
      contact: {...BRUNO},
      heavyLoad: false,
      dependsOn: ['h2'],
    },
  ),
  makeTask(
    'h5',
    'Limpieza Demo',
    {date: DAY},
    {...stamp, kind: 'other', dependsOn: ['h2']},
  ),
  makeTask(
    'h6',
    'Recogida de material Demo',
    {date: DAY, start: '10:00', end: '11:00'},
    {
      ...stamp,
      kind: 'transport',
      status: 'in_progress',
      venue: {...ALMACEN},
      heavyLoad: false,
    },
  ),
  makeTask(
    'h7',
    'Reparto de mesas Demo',
    {date: DAY, start: '11:00', end: '12:00'},
    {
      ...stamp,
      kind: 'other',
      venue: {...ALMACEN},
      dependsOn: ['h6'],
    },
  ),
  makeTask(
    'h8',
    'Carga del camión Demo',
    {date: DAY, start: '07:00', end: '08:00'},
    {
      ...stamp,
      kind: 'other',
      status: 'done',
      venue: {...ALMACEN},
    },
  ),
  makeTask(
    'h9',
    'Entrega de generador Demo',
    {date: DAY, start: '18:00', end: '18:30'},
    {
      ...stamp,
      eventId: 'e1',
      kind: 'delivery',
      venue: {...PLAZA_CRISTO},
      company: {...ESCENARIOS},
      heavyLoad: false,
    },
  ),
];

export const followNotes = () => [
  makeNote('n1', 'note', `${ORDER_PRIVATE.noteText}: la grúa llega tarde.`, {
    ...stamp,
    ref: {type: 'task', id: 'h1', label: 'Montaje del escenario Demo'},
  }),
];

/** An open hypothesis on h1 (+30 min), saved by Dailos at 10:10. */
export const openHypothesis = () =>
  makeHypothesis('hy1', {id: 'h1', title: 'Montaje del escenario Demo'}, 30, {
    createdBy: dailos,
    createdAt: at('10:10'),
    estimated: true,
    note: `${ORDER_PRIVATE.hypothesisNote}: la grúa avisa de que sale tarde.`,
  });

/** An applied hypothesis on h7, applied by Elvis at 10:20. */
export const appliedHypothesis = () =>
  makeHypothesis('hy2', {id: 'h7', title: 'Reparto de mesas Demo'}, 15, {
    createdBy: elvis,
    createdAt: at('10:15'),
    appliedAt: at('10:20'),
    appliedBy: elvis,
  });

/** Mock options for the milestone 5 day. */
export const followData = (extra: Partial<MockOptions> = {}): MockOptions => ({
  events: followEvents(),
  venues: planVenues(),
  tasks: followTasks(),
  companies: followCompanies(),
  contacts: followContacts(),
  offers: followOffers(),
  warehouses: followWarehouses(),
  resources: followResources(),
  notes: followNotes(),
  hypotheses: [],
  now: NOW,
  ...extra,
});

/** Instant of a local time today (UTC+0 in winter). */
export const today = at;
