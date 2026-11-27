/**
 * The small sums of a calendar drag (Revisión 1 · E2): how far a block may
 * go on its day, what a drag of some pixels means in minutes, whether the
 * new window fits the venue's opening hours and where the venue is closed.
 * Pure: no React, no DOM.
 */
import type {OpeningHours, Task} from '../../../shared/logistics/contracts.ts';
import {
  outsideHoursMessage,
  withinOpeningHours,
} from '../../../shared/logistics/move.ts';
import {
  MAX_DELAY_MINUTES,
  MOVE_STEP_MINUTES,
} from '../../../shared/logistics/rules.ts';
import {shiftInstant} from './exits';

const STEP = MOVE_STEP_MINUTES;

/** Minutes from a vertical drag of `dy` px at `hourPx` per hour, in steps. */
export function dragMinutes(dy: number, hourPx: number): number {
  if (!(hourPx > 0)) return 0;
  const raw = (dy / hourPx) * 60;
  return Math.round(raw / STEP) * STEP || 0;
}

/**
 * `minutes` kept so the block stays within its day (00:00–24:00 of the part
 * drawn) and within one day of its place, in whole steps.
 */
export function clampDrag(
  span: {start: number; end: number},
  minutes: number,
): number {
  const lower = Math.max(-MAX_DELAY_MINUTES, -span.start);
  const upper = Math.min(MAX_DELAY_MINUTES, 1440 - span.end);
  const lo = Math.ceil(lower / STEP) * STEP;
  const hi = Math.floor(upper / STEP) * STEP;
  if (lo > hi) return 0;
  return Math.min(hi, Math.max(lo, minutes)) || 0;
}

/** Why a task that runs past midnight does not follow the drag. */
export const CROSSES_DAY_MESSAGE =
  'Esta tarea pasa de un día a otro: en el calendario solo se mueve sin salir de su día. Cambia sus horas desde la ficha.';

/**
 * Why the drag was cut short, when the cut comes from the task crossing
 * midnight (the part drawn touches the day's edge); null otherwise, as the
 * block then visibly stops at the edge of its day.
 */
export function dragLimit(
  span: {
    start: number;
    end: number;
    continuesBefore?: boolean;
    continuesAfter?: boolean;
  },
  minutes: number,
): string | null {
  if (!minutes || clampDrag(span, minutes) === minutes) return null;
  const crosses =
    (minutes < 0 && span.continuesBefore) ||
    (minutes > 0 && span.continuesAfter);
  return crosses ? CROSSES_DAY_MESSAGE : null;
}

/** The task's window moved by `minutes`, or null without both times. */
export function shiftedWindow(
  task: Pick<Task, 'startsAt' | 'endsAt'>,
  minutes: number,
): {startsAt: string; endsAt: string} | null {
  if (!task.startsAt || !task.endsAt) return null;
  return {
    startsAt: shiftInstant(task.startsAt, minutes),
    endsAt: shiftInstant(task.endsAt, minutes),
  };
}

/**
 * Why the moved window is refused on the calendar, or null: outside the
 * venue's known opening hours (the server refuses those too). Unknown hours
 * limit nothing.
 */
export function dragRefusal(
  task: Pick<Task, 'startsAt' | 'endsAt'>,
  minutes: number,
  place: {name: string; openingHours: OpeningHours | null} | undefined,
  timeZone: string,
): string | null {
  if (!minutes || !place?.openingHours) return null;
  const moved = shiftedWindow(task, minutes);
  if (!moved) return null;
  return withinOpeningHours(moved, place.openingHours, timeZone)
    ? null
    : outsideHoursMessage(place.name, place.openingHours);
}

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Closed parts of a day for opening hours, in minutes of the day: before
 * opening and after closing. Empty when the hours are unknown.
 */
export function closedBands(
  hours: OpeningHours | null | undefined,
): {start: number; end: number}[] {
  if (!hours) return [];
  const open = toMinutes(hours.opensAt);
  const close = toMinutes(hours.closesAt);
  if (!(open < close)) return [];
  return [
    ...(open > 0 ? [{start: 0, end: open}] : []),
    ...(close < 1440 ? [{start: close, end: 1440}] : []),
  ];
}

/** Speed of the auto-scroll near an edge: px per frame, signed, 0 outside. */
export function edgeSpeed(
  y: number,
  top: number,
  bottom: number,
  zone = 40,
  max = 14,
): number {
  if (y < top + zone) {
    return -Math.ceil((max * Math.min(zone, top + zone - y)) / zone);
  }
  if (y > bottom - zone) {
    return Math.ceil((max * Math.min(zone, y - (bottom - zone))) / zone);
  }
  return 0;
}
