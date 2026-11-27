import {makeEvent, makeTask} from './mock-api';
import {DAY, PLAZA_ADELANTADO, RECINTO, planData} from './plan-fixtures';

/**
 * Revisión 1 · day view with many venues. The milestone 2 plan plus three
 * more venues on the same day: five columns (Almacén municipal, Plaza del
 * Adelantado, Plaza del Cristo, Recinto ferial, Sin lugar). At Plaza del
 * Adelantado an event and a delivery both start at 09:00 (the CAP1
 * screenshot); at the fairground a 15-minute check (a short block).
 */

const stamp = {
  createdAt: '2026-12-01T09:00:00.000Z',
  updatedAt: '2026-12-01T09:00:00.000Z',
};

export function fiveVenueData() {
  const base = planData();
  return {
    ...base,
    events: [
      ...base.events,
      makeEvent(
        'e20',
        'Mercadillo navideño',
        {date: DAY, start: '09:00', end: '14:00'},
        {venue: {...PLAZA_ADELANTADO}, status: 'planned', ...stamp},
      ),
    ],
    tasks: [
      ...base.tasks,
      makeTask(
        't20',
        'Descarga de tarimas',
        {date: DAY, start: '09:00', end: '11:00'},
        {
          eventId: 'e20',
          kind: 'delivery',
          venue: {...PLAZA_ADELANTADO},
          heavyLoad: true,
          ...stamp,
        },
      ),
      makeTask(
        't21',
        'Prueba de luces de la feria',
        {date: DAY, start: '10:00', end: '10:15'},
        {kind: 'activity', venue: {...RECINTO}, heavyLoad: false, ...stamp},
      ),
      makeTask(
        't22',
        'Revisión del generador',
        {date: DAY, start: '11:00', end: '12:00'},
        {kind: 'other', heavyLoad: false, ...stamp},
      ),
    ],
  };
}
