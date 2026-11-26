import {
  addDays,
  dailos,
  elvis,
  makeActivity,
  makeContact,
  makeNote,
  makeOffer,
  makeResource,
  makeTask,
  type MockOptions,
} from './mock-api';
import {DAY, PLAZA_CRISTO, RECINTO} from './plan-fixtures';
import {
  ESCENARIOS,
  VALLAS,
  appliedHypothesis,
  followContacts,
  followData,
  followNotes,
  followOffers,
  followResources,
  followTasks,
  openHypothesis,
} from './followup-fixtures';

/**
 * Fixtures for «Cierre de jornada» (M6): the M5 day (followup-fixtures.ts,
 * fixed clock 10:30 on Wednesday 2 December 2026) plus what the team did
 * that morning. Fictitious data only («Demo», +34 000 000 0XX).
 *
 * The day's activity (all on 2 Dec; one entry the day before is left out):
 *   Elvis  e1 changed 08:00 · Carla Demo (p3) new 09:10 · offer o2 new 09:50 ·
 *          decision nd2 10:00 · question nd3 10:10 · a task deleted 10:15
 *   Dailos h1 changed 08:45 · h6 changed 10:05 · incident nd1 09:40
 *   Yeray  Conos Demo (r2) new 09:30 · plain note nd4 10:20
 * → events 1 changed; tasks 2 changed + 1 deleted; people 1 new; resources
 *   1 new; offers 1 new; notes 4 new. Elvis 6 changes, Dailos 3, Yeray 2.
 *
 * Records: 23 (1 event, 11 tasks, 3 people, 3 companies, 2 offers, 1
 * warehouse, 2 resources), 2 validated (e1, r2) → 91 % pending.
 *
 * Notes: incidents nd1 (today, open) and nd5 (yesterday, still open);
 * decision nd2; open question nd3; plain note nd4 (counted, never listed).
 * Hypotheses: hy1 open (Dailos 10:10), hy2 applied (Elvis 10:20).
 *
 * Safety: h11 heavy and done without a declared review (finished
 * unreviewed); h12 tomorrow, a delivery whose load is unknown; h1 declared
 * by Dailos. h9 is a delivery during e1: the routes reminder.
 *
 * Every text a default report must not carry has a `TEXTO-NOTA-DIA-…` marker.
 */

const at = (time: string, date = DAY) => `${date}T${time}:00.000Z`;
const stamp = {
  createdAt: '2026-12-01T09:00:00.000Z',
  updatedAt: '2026-12-01T09:00:00.000Z',
};
const yeray = {id: 'u-yeray', displayName: 'Yeray'};

export const CARLA = {id: 'p3', name: 'Carla Demo'};

export const DAY_NOTE_TEXT = {
  incident: 'TEXTO-NOTA-DIA-INCIDENCIA: un camión bloqueó el paso.',
  incidentEarlier: 'TEXTO-NOTA-DIA-ANTIGUA: faltaba una valla.',
  decision: 'TEXTO-NOTA-DIA-DECISION: las vallas salen a las 12.',
  question: 'TEXTO-NOTA-DIA-PREGUNTA: ¿quién abre el almacén?',
  plain: 'TEXTO-NOTA-DIA-SIMPLE: revisar lonas.',
};

export const dayTasks = () => [
  ...followTasks(),
  makeTask(
    'h11',
    'Descarga de tarimas Demo',
    {date: DAY, start: '07:00', end: '08:00'},
    {
      ...stamp,
      kind: 'assembly',
      status: 'done',
      venue: {...PLAZA_CRISTO},
      company: {...ESCENARIOS},
      heavyLoad: true,
      subsoilReview: null,
    },
  ),
  makeTask(
    'h12',
    'Entrega de casetas Demo',
    {date: addDays(DAY, 1), start: '09:00', end: '10:00'},
    {
      ...stamp,
      kind: 'delivery',
      venue: {...RECINTO},
      company: {...VALLAS},
      contact: {...CARLA},
      heavyLoad: null,
    },
  ),
];

export const dayContacts = () => [
  ...followContacts(),
  makeContact(CARLA.id, CARLA.name, {
    createdAt: at('09:10'),
    updatedAt: at('09:10'),
    role: 'Coordinadora de transporte',
    company: {...VALLAS},
    phone: '+34 000 000 033',
    email: 'carla.demo@example.com',
  }),
];

export const dayResources = () => [
  ...followResources(),
  makeResource('r2', 'Conos Demo', {
    createdAt: at('09:30'),
    updatedAt: at('09:30'),
    createdBy: yeray,
    updatedBy: yeray,
    quantity: 30,
    verification: 'validated',
  }),
];

export const dayOffers = () => [
  ...followOffers(),
  makeOffer('o2', 'Vallas Demo por día', VALLAS, {
    createdAt: at('09:50'),
    updatedAt: at('09:50'),
  }),
];

export const dayNotes = () => [
  ...followNotes(),
  makeNote('nd1', 'incident', DAY_NOTE_TEXT.incident, {
    createdAt: at('09:40'),
    updatedAt: at('09:40'),
    createdBy: dailos,
    updatedBy: dailos,
    ref: {type: 'resource', id: 'r1', label: 'Tarima Demo'},
  }),
  makeNote('nd2', 'decision', DAY_NOTE_TEXT.decision, {
    createdAt: at('10:00'),
    updatedAt: at('10:00'),
    ref: {type: 'task', id: 'h4', label: 'Entrega de vallas Demo'},
  }),
  makeNote('nd3', 'open_question', DAY_NOTE_TEXT.question, {
    createdAt: at('10:10'),
    updatedAt: at('10:10'),
    event: {id: 'e1', name: 'Navidad en la Plaza del Cristo'},
  }),
  makeNote('nd4', 'note', DAY_NOTE_TEXT.plain, {
    createdAt: at('10:20'),
    updatedAt: at('10:20'),
    createdBy: yeray,
    updatedBy: yeray,
  }),
  makeNote('nd5', 'incident', DAY_NOTE_TEXT.incidentEarlier, {
    createdAt: at('16:00', addDays(DAY, -1)),
    updatedAt: at('16:00', addDays(DAY, -1)),
    ref: {type: 'task', id: 'h4', label: 'Entrega de vallas Demo'},
  }),
];

export const dayActivity = () => [
  makeActivity(
    'd0',
    {type: 'task', id: 'h1', label: 'Montaje del escenario Demo'},
    'update',
    at('23:00', addDays(DAY, -1)),
  ),
  makeActivity(
    'd1',
    {type: 'event', id: 'e1', label: 'Navidad en la Plaza del Cristo'},
    'update',
    at('08:00'),
    {changedFields: ['status']},
  ),
  makeActivity(
    'd2',
    {type: 'task', id: 'h1', label: 'Montaje del escenario Demo'},
    'update',
    at('08:45'),
    {user: dailos, changedFields: ['subsoilReview']},
  ),
  makeActivity(
    'd3',
    {type: 'contact', id: CARLA.id, label: CARLA.name},
    'create',
    at('09:10'),
  ),
  makeActivity(
    'd4',
    {type: 'resource', id: 'r2', label: 'Conos Demo'},
    'create',
    at('09:30'),
    {user: yeray},
  ),
  makeActivity(
    'd5',
    {type: 'note', id: 'nd1', label: 'Incidencia · Tarima Demo'},
    'create',
    at('09:40'),
    {user: dailos},
  ),
  makeActivity(
    'd6',
    {type: 'offer', id: 'o2', label: 'Vallas Demo por día'},
    'create',
    at('09:50'),
  ),
  makeActivity(
    'd7',
    {type: 'note', id: 'nd2', label: 'Decisión · Entrega de vallas Demo'},
    'create',
    at('10:00'),
  ),
  makeActivity(
    'd8',
    {type: 'task', id: 'h6', label: 'Recogida de material Demo'},
    'update',
    at('10:05'),
    {user: dailos, changedFields: ['status']},
  ),
  makeActivity(
    'd9',
    {
      type: 'note',
      id: 'nd3',
      label: 'Pregunta abierta · Navidad en la Plaza del Cristo',
    },
    'create',
    at('10:10'),
  ),
  makeActivity(
    'd10',
    {type: 'task', id: 'tx', label: 'Tarea borrada Demo'},
    'delete',
    at('10:15'),
  ),
  makeActivity(
    'd11',
    {type: 'note', id: 'nd4', label: 'Nota'},
    'create',
    at('10:20'),
    {user: yeray},
  ),
];

/** Mock options for the day close of 2 December. */
export const dayCloseData = (extra: Partial<MockOptions> = {}): MockOptions =>
  followData({
    tasks: dayTasks(),
    contacts: dayContacts(),
    resources: dayResources(),
    offers: dayOffers(),
    notes: dayNotes(),
    hypotheses: [openHypothesis(), appliedHypothesis()],
    activity: dayActivity(),
    ...extra,
  });

export {elvis};
