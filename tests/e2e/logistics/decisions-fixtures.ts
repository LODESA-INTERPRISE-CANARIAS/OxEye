import {windowsFor} from '../../../shared/logistics/acceptance.ts';
import {planWarnings} from '../../../shared/logistics/conflicts.ts';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {ORG, dailos, elvis, makeTask, type MockOptions} from './mock-api';
import {DAY, PLAZA_ADELANTADO} from './plan-fixtures';
import {dayCloseData, dayNotes, dayTasks} from './day-close-fixtures';

/**
 * Revisión 1 · E2/E3 day-close decisions: the day of day-close-fixtures.ts
 * plus two tasks overlapping at Plaza del Adelantado (ac1 × ac2) whose
 * conflict Elvis kept at 09:15 («Mantener ambas», reason `ACCEPTED_REASON`),
 * and the open question nd3 answered by Dailos at 10:20 (`ANSWER_TEXT`).
 */

export const ACCEPTED_REASON = 'MARCA-MOTIVO: se coordinan en la misma plaza.';
export const ANSWER_TEXT = 'MARCA-RESPUESTA: abre Dailos a las 7.';

export function decisionsData(): MockOptions {
  const extra = [
    makeTask(
      'ac1',
      'Carga de tarimas Demo',
      {date: DAY, start: '11:00', end: '12:30'},
      {venue: {...PLAZA_ADELANTADO}, kind: 'assembly', heavyLoad: false},
    ),
    makeTask(
      'ac2',
      'Montaje de luces Demo',
      {date: DAY, start: '12:00', end: '13:00'},
      {venue: {...PLAZA_ADELANTADO}, kind: 'assembly', heavyLoad: false},
    ),
  ];
  const tasks = [...dayTasks(), ...extra];
  const base = dayCloseData({tasks});
  const warning = planWarnings(
    tasks as unknown as Task[],
    (base.events ?? []) as unknown as LogisticsEvent[],
  ).find(
    w =>
      w.severity === 'conflict' &&
      w.taskIds.includes('ac1') &&
      w.taskIds.includes('ac2'),
  );
  if (!warning) throw new Error('fixture: no conflict between ac1 and ac2');
  const notes = dayNotes().map(n =>
    n.id === 'nd3'
      ? {
          ...n,
          answer: {
            id: 'an1',
            noteId: 'nd3',
            text: ANSWER_TEXT,
            answeredBy: dailos,
            answeredAt: `${DAY}T10:20:00.000Z`,
            replacesId: null,
            restricted: false,
          },
        }
      : n,
  );
  return {
    ...base,
    notes,
    acceptances: [
      {
        id: 'ca1',
        organizationId: ORG,
        warningKey: warning.key,
        windows: windowsFor(warning, tasks as unknown as Task[]),
        reason: ACCEPTED_REASON,
        acceptedBy: elvis,
        acceptedAt: `${DAY}T09:15:00.000Z`,
      },
    ],
  };
}
