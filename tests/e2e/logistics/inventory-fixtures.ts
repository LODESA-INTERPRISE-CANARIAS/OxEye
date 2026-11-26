import {
  addDays,
  dailos,
  elvis,
  makeActivity,
  makeCompany,
  makeEvent,
  makeNote,
  makeOffer,
  makeResource,
  makeTask,
  makeWarehouse,
  resourceCategoryId,
  type MockOptions,
} from './mock-api';
import {
  DAY,
  NOW,
  PLAZA_ADELANTADO,
  PLAZA_CRISTO,
  planVenues,
} from './plan-fixtures';

/**
 * Fixtures for the milestone 4 specs (Inventarios, quick capture, notes,
 * history). Fictitious data only: names with «Prueba», addresses in «Calle
 * Ficticia». Use with `fixClock` from plan-fixtures.ts (2 December 2026,
 * 10:30 in La Laguna).
 *
 * Every free-text field a guest must never receive carries a marker word
 * (`OBS-…`, `DIRECCION-…`, `UBICACION-…`, `TEXTO-NOTA-…`), so a spec can
 * assert it is nowhere in the markup. Note texts also never belong in labels,
 * search results or the activity feed, even for members.
 */

const stamp = {
  createdAt: '2026-12-01T09:00:00.000Z',
  updatedAt: '2026-12-01T09:00:00.000Z',
};

export const RCAT = {
  carpas: resourceCategoryId('Carpas'),
  vallas: resourceCategoryId('Vallas'),
  mesas: resourceCategoryId('Mesas'),
  vehiculos: resourceCategoryId('Vehículos'),
  generadores: resourceCategoryId('Generadores y electricidad'),
};

export const NORTE = {id: 'w1', name: 'Almacén Prueba Norte'};
export const SUR = {id: 'w2', name: 'Almacén Prueba Sur'};
export const ALQUILERES = {id: 'c10', name: 'Alquileres Prueba'};
export const ESCENARIOS = {id: 'c11', name: 'Escenarios Prueba'};

/** Marker strings a guest must never receive (M4 free text). */
export const M4_WITHHELD = [
  'OBS-EVENTO-PRIVADA',
  'OBS-TAREA-PRIVADA',
  'DIRECCION-ALMACEN-PRIVADA',
  'OBS-ALMACEN-PRIVADA',
  'UBICACION-PRIVADA',
  'OBS-RECURSO-PRIVADA',
  'TEXTO-NOTA-',
];

export const invWarehouses = () => [
  makeWarehouse(NORTE.id, NORTE.name, {
    ...stamp,
    address: 'Calle Ficticia Prueba, 1 · DIRECCION-ALMACEN-PRIVADA',
    notes: 'OBS-ALMACEN-PRIVADA: la llave la tiene el conserje.',
    verification: 'validated',
  }),
  makeWarehouse(SUR.id, SUR.name, {...stamp}),
];

/**
 * Owned: r1 Carpa (Norte, 4, validated), r2 Vallas (Norte, 200), r3 Mesas
 * (Sur, «aún por evaluar», ≈ 40), r4 Furgoneta (no warehouse, exactly one).
 * Contracted: r5 Aseos (Alquileres Prueba, with its offer), r6 Generador
 * (no company yet).
 */
export const invResources = () => [
  makeResource('r1', 'Carpa 3 × 6 Prueba', {
    ...stamp,
    categoryId: RCAT.carpas,
    warehouse: {...NORTE},
    quantity: 4,
    dimensions: '3 × 6 m',
    condition: 'good',
    availability: 'available',
    location: 'UBICACION-PRIVADA nave 2, estantería 3',
    notes: 'OBS-RECURSO-PRIVADA: falta una piqueta.',
    verification: 'validated',
    source: 'observed',
  }),
  makeResource('r2', 'Vallas Prueba', {
    ...stamp,
    categoryId: RCAT.vallas,
    warehouse: {...NORTE},
    quantity: 200,
    condition: 'fair',
    availability: 'available',
  }),
  makeResource('r3', 'Mesas plegables Prueba', {
    ...stamp,
    categoryId: RCAT.mesas,
    warehouse: {...SUR},
    quantity: 40,
    toAssess: true,
  }),
  makeResource('r4', 'Furgoneta Prueba', {
    ...stamp,
    categoryId: RCAT.vehiculos,
    quantity: 1,
    condition: 'good',
    availability: 'available',
  }),
  makeResource('r5', 'Aseos portátiles Prueba', {
    ...stamp,
    ownership: 'contracted',
    company: {...ALQUILERES},
    offerId: 'o10',
    quantity: 6,
  }),
  makeResource('r6', 'Generador Prueba', {
    ...stamp,
    ownership: 'contracted',
    categoryId: RCAT.generadores,
  }),
];

export const invCompanies = () => [
  makeCompany(ALQUILERES.id, ALQUILERES.name, {...stamp}),
  makeCompany(ESCENARIOS.id, ESCENARIOS.name, {...stamp}),
];

export const invOffers = () => [
  makeOffer('o10', 'Aseo portátil Prueba por día', ALQUILERES, {...stamp}),
  makeOffer('o11', 'Cabina accesible Prueba', ALQUILERES, {...stamp}),
  makeOffer('o12', 'Escenario Prueba 8 × 6 m', ESCENARIOS, {...stamp}),
];

export const invEvents = () => [
  makeEvent(
    'e1',
    'Navidad en la Plaza del Cristo',
    {date: DAY, start: '17:00', end: '21:00'},
    {
      ...stamp,
      venue: {...PLAZA_CRISTO},
      status: 'confirmed',
      notes: 'OBS-EVENTO-PRIVADA: acceso por la calle de atrás.',
    },
  ),
];

/**
 * tA uses the van (exactly one) 09:00–11:00. tC and tD both use the 200
 * fences 12:00–14:00 and 13:00–15:00 (a reminder, not a conflict). Kind
 * «other» and different venues, so they raise no other warning.
 */
export const invTasks = () => [
  makeTask(
    'tA',
    'Recogida de vallas Prueba',
    {date: DAY, start: '09:00', end: '11:00'},
    {
      ...stamp,
      venue: {...PLAZA_CRISTO},
      resourceIds: ['r4'],
      notes: 'OBS-TAREA-PRIVADA: llamar antes de salir.',
    },
  ),
  makeTask(
    'tC',
    'Vallado Prueba A',
    {date: DAY, start: '12:00', end: '14:00'},
    {...stamp, venue: {...PLAZA_ADELANTADO}, resourceIds: ['r2']},
  ),
  makeTask(
    'tD',
    'Vallado Prueba B',
    {date: DAY, start: '13:00', end: '15:00'},
    {...stamp, venue: {id: 'v4', name: 'Recinto ferial'}, resourceIds: ['r2']},
  ),
];

const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

/**
 * Hoy shows open incidents and questions first, oldest first (n2, n1), then
 * the other notes written today, newest first (n4, n3). n5 (resolved) and n6
 * (two days ago) are not on Hoy.
 */
export const invNotes = () => [
  makeNote(
    'n1',
    'incident',
    'TEXTO-NOTA-INCIDENCIA: la furgoneta no arranca.',
    {
      createdAt: at(addDays(DAY, -1), '16:00'),
      updatedAt: at(addDays(DAY, -1), '16:00'),
      event: {id: 'e1', name: 'Navidad en la Plaza del Cristo'},
      ref: {type: 'resource', id: 'r4', label: 'Furgoneta Prueba'},
      createdBy: dailos,
      updatedBy: dailos,
    },
  ),
  makeNote(
    'n2',
    'open_question',
    'TEXTO-NOTA-PREGUNTA: ¿quién abre el almacén?',
    {
      createdAt: at(addDays(DAY, -2), '12:00'),
      updatedAt: at(addDays(DAY, -2), '12:00'),
      ref: {type: 'warehouse', id: 'w1', label: NORTE.name},
    },
  ),
  makeNote('n3', 'note', 'TEXTO-NOTA-HOY-1: revisar lonas.', {
    createdAt: at(DAY, '09:00'),
    updatedAt: at(DAY, '09:00'),
    ref: {type: 'warehouse', id: 'w1', label: NORTE.name},
  }),
  makeNote('n4', 'decision', 'TEXTO-NOTA-HOY-2: las vallas salen a las 12.', {
    createdAt: at(DAY, '10:00'),
    updatedAt: at(DAY, '10:00'),
    ref: {type: 'task', id: 'tC', label: 'Vallado Prueba A'},
  }),
  makeNote('n5', 'incident', 'TEXTO-NOTA-RESUELTA: faltaba una valla.', {
    createdAt: at(addDays(DAY, -1), '11:00'),
    updatedAt: at(addDays(DAY, -1), '12:00'),
    resolved: true,
  }),
  makeNote('n6', 'note', 'TEXTO-NOTA-ANTIGUA: inventario de octubre.', {
    createdAt: at(addDays(DAY, -2), '09:00'),
    updatedAt: at(addDays(DAY, -2), '09:00'),
    ref: {type: 'resource', id: 'r1', label: 'Carpa 3 × 6 Prueba'},
  }),
];

/** Recent activity as the server logs it: a note is named by `noteLabel`. */
export const invActivity = () => [
  makeActivity(
    'a1',
    {type: 'resource', id: 'r1', label: 'Carpa 3 × 6 Prueba'},
    'create',
    at(addDays(DAY, -1), '09:00'),
  ),
  makeActivity(
    'a2',
    {type: 'resource', id: 'r1', label: 'Carpa 3 × 6 Prueba'},
    'update',
    at(DAY, '08:00'),
    {user: dailos, changedFields: ['quantity', 'condition']},
  ),
  makeActivity(
    'a3',
    {type: 'note', id: 'n1', label: 'Incidencia · Furgoneta Prueba'},
    'create',
    at(addDays(DAY, -1), '16:00'),
    {user: dailos},
  ),
  makeActivity(
    'a4',
    {type: 'note', id: 'n4', label: 'Decisión · Vallado Prueba A'},
    'create',
    at(DAY, '10:00'),
    {user: elvis},
  ),
];

/** Mock options for the milestone 4 inventory and notes. */
export const inventoryData = (): MockOptions => ({
  events: invEvents(),
  venues: planVenues(),
  tasks: invTasks(),
  companies: invCompanies(),
  offers: invOffers(),
  warehouses: invWarehouses(),
  resources: invResources(),
  notes: invNotes(),
  activity: invActivity(),
  // New notes and activity carry the page's fixed «now».
  now: NOW,
});
