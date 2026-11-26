import type {Page} from '@playwright/test';
import {addDays, makeCompany, makeEvent, makeTask} from './mock-api';

/**
 * Fixtures for the milestone 2 specs (tasks, Calendario, the grown «Hoy»).
 *
 * The browser clock is fixed with `fixClock`, so «now», «today», «Ahora» and
 * «Siguiente» never depend on when the suite runs: Wednesday 2 December 2026,
 * 10:30 in La Laguna (Atlantic/Canary is UTC+0 in winter).
 */

export const DAY = '2026-12-02';
export const NOW = '2026-12-02T10:30:00.000Z';

/** Fixes Date.now() / new Date() in the page; timers keep running. */
export async function fixClock(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
}

const stamp = {
  createdAt: '2026-12-01T09:00:00.000Z',
  updatedAt: '2026-12-01T09:00:00.000Z',
};

export const PLAZA_CRISTO = {id: 'v1', name: 'Plaza del Cristo'};
export const PLAZA_ADELANTADO = {id: 'v2', name: 'Plaza del Adelantado'};
export const RECINTO = {id: 'v4', name: 'Recinto ferial'};
export const ALMACEN = {id: 'v5', name: 'Almacén municipal'};

export const ESCENARIOS = {id: 'c1', name: 'Escenarios Teide'};
export const SONIDO = {id: 'c2', name: 'Sonido Atlántico'};
export const VALLAS = {id: 'c3', name: 'Vallas Canarias'};

export const planVenues = () => [
  {...PLAZA_CRISTO},
  {...PLAZA_ADELANTADO},
  {...RECINTO},
  {...ALMACEN},
];

export const planCompanies = () =>
  [ESCENARIOS, SONIDO, VALLAS].map(c => makeCompany(c.id, c.name, stamp));

/**
 * e1: today 17:00–21:00 at Plaza del Cristo (validated).
 * e7: «Feria de Navidad», 7–9 December, a multi-day event at the fairground.
 */
export const planEvents = () => [
  makeEvent(
    'e1',
    'Navidad en la Plaza del Cristo',
    {date: DAY, start: '17:00', end: '21:00'},
    {
      venue: {...PLAZA_CRISTO},
      status: 'confirmed',
      verification: 'validated',
      source: 'document',
      ...stamp,
    },
  ),
  makeEvent(
    'e7',
    'Feria de Navidad',
    {
      date: addDays(DAY, 5),
      endDate: addDays(DAY, 7),
      start: '10:00',
      end: '20:00',
    },
    {venue: {...RECINTO}, status: 'confirmed', ...stamp},
  ),
];

/**
 * Today's plan, built so that `planWarnings` yields exactly five warnings for
 * the day, conflicts first:
 *   conflict  venue_overlap       t1 × t2 at Plaza del Cristo, 12:00–13:00
 *   conflict  dependency_order    t2 starts at 12:00, t1 ends at 13:00
 *   reminder  heavy_load          t1 (heavy load: yes)
 *   reminder  heavy_load_unknown  t3 (delivery, heavy load not known)
 *   reminder  route_window        t3 is a delivery during its event e1
 * At 10:30, t1 is running («Ahora»), t2 is next («Siguiente»), t3 follows,
 * t4 has no time («Sin hora») and t5 is done (folded away).
 */
export const planTasks = () => [
  makeTask(
    't1',
    'Montaje del escenario',
    {date: DAY, start: '08:00', end: '13:00'},
    {
      eventId: 'e1',
      kind: 'assembly',
      venue: {...PLAZA_CRISTO},
      status: 'confirmed',
      company: {...ESCENARIOS},
      heavyLoad: true,
      verification: 'validated',
      source: 'document',
      ...stamp,
    },
  ),
  makeTask(
    't2',
    'Instalación de sonido',
    {date: DAY, start: '12:00', end: '15:00'},
    {
      eventId: 'e1',
      kind: 'assembly',
      venue: {...PLAZA_CRISTO},
      company: {...SONIDO},
      heavyLoad: false,
      dependsOn: ['t1'],
      ...stamp,
    },
  ),
  makeTask(
    't3',
    'Entrega de vallas',
    {date: DAY, start: '17:30', end: '18:30'},
    {
      eventId: 'e1',
      kind: 'delivery',
      venue: {...PLAZA_CRISTO},
      company: {...VALLAS},
      heavyLoad: null,
      dependsOn: ['t2'],
      ...stamp,
    },
  ),
  makeTask('t4', 'Revisar extintores', {date: DAY}, {kind: 'other', ...stamp}),
  makeTask(
    't5',
    'Recogida de material en el almacén',
    {date: DAY, start: '07:00', end: '08:00'},
    {
      kind: 'transport',
      venue: {...ALMACEN},
      status: 'done',
      company: {...VALLAS},
      heavyLoad: false,
      ...stamp,
    },
  ),
  makeTask(
    't8',
    'Recogida de vallas en el almacén',
    {date: addDays(DAY, 1), start: '09:00', end: '10:00'},
    {
      kind: 'transport',
      venue: {...ALMACEN},
      company: {...VALLAS},
      heavyLoad: false,
      ...stamp,
    },
  ),
  makeTask(
    't10',
    'Montaje de casetas',
    {date: addDays(DAY, 5), start: '08:00', end: '12:00'},
    {
      eventId: 'e7',
      kind: 'assembly',
      venue: {...RECINTO},
      company: {...ESCENARIOS},
      heavyLoad: false,
      ...stamp,
    },
  ),
  makeTask(
    't11',
    'Confirmar grúa con la empresa',
    {},
    {kind: 'other', ...stamp},
  ),
];

/** Mock options for the full milestone 2 plan. */
export const planData = () => ({
  events: planEvents(),
  tasks: planTasks(),
  venues: planVenues(),
  companies: planCompanies(),
});
