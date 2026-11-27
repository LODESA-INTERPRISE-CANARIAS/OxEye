/**
 * Moving a task in time (Revisión 1 · E2): a long-press drag on the calendar,
 * its keyboard equivalent, or a conflict exit («Retrasar la segunda»,
 * «Adelantar la primera»). Pure and shared: the UI previews the move with
 * `analyzeMove`, and the server recomputes the same `simulateMove` before
 * writing it, so what a member confirmed is exactly what is written (or
 * nothing is).
 *
 * A move only changes times (and the local days that follow from them). It
 * never touches heavy load, the declared subsoil review, the venue or the
 * resources, and the plan warnings are re-run on the moved plan: routes
 * A/B/C, Carpa Amarilla and subsoil reminders of moved tasks are always
 * shown. The Gestor has no route geometry, so nothing here says a slot is
 * safe.
 *
 * Opening hours are a daily window in the organization's time zone, known
 * or not («Pendiente de verificar»). Unknown hours limit nothing.
 */
import type {IsoInstant, OpeningHours, Task, Uuid} from './contracts.ts';
import {
  movedSafety,
  planWarnings,
  type PlanEvent,
  type PlanResource,
  type PlanTask,
  type PlanWarning,
} from './conflicts.ts';
import {simulateMove, type DelayImpact, type ScheduleItem} from './schedule.ts';
import {DEFAULT_TIMEZONE, isLocalTime, utcToLocal} from './time.ts';

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

// ---------------------------------------------------------------- what can move

export type MoveBlocker = 'finished' | 'cancelled' | 'in_progress' | 'untimed';

/** Why a task cannot be moved, in plain Spanish (UI and server). */
export const MOVE_BLOCKED: Record<MoveBlocker, string> = {
  finished: 'Esa tarea ya está hecha: no se puede mover.',
  cancelled: 'Esa tarea está cancelada: no se puede mover.',
  in_progress:
    'Esa tarea ya está en marcha: su inicio no se mueve. Si va a durar más, usa «¿Y si…?» con «se alarga».',
  untimed:
    'Esa tarea no tiene hora de inicio y de fin: ponle horario para poder moverla.',
};

/** Why `task` cannot be moved, or null when it can. */
export function moveBlocker(
  task: Pick<Task, 'status' | 'startsAt' | 'endsAt'>,
): MoveBlocker | null {
  if (task.status === 'done') return 'finished';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'in_progress') return 'in_progress';
  if (Number.isNaN(ms(task.startsAt)) || Number.isNaN(ms(task.endsAt))) {
    return 'untimed';
  }
  return null;
}

/**
 * Tasks as schedule items for a move. Lanes are venues. Cancelled tasks are
 * out; tasks under way or finished (the root included) are fixed: they
 * occupy their lane but never move.
 */
export function moveItems(tasks: PlanTask[]): ScheduleItem[] {
  return tasks.map(t => ({
    id: t.id,
    label: t.title,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    lane: t.venue?.id ?? null,
    dependsOn: t.dependsOn,
    cancelled: t.status === 'cancelled',
    fixed: t.status === 'done' || t.status === 'in_progress',
  }));
}

// ---------------------------------------------------------------- opening hours

/** A place with its known (or unknown) daily opening hours. */
export interface PlaceHours {
  id: Uuid;
  name: string;
  openingHours: OpeningHours | null;
}

export const OPENING_HOURS_INVALID =
  'Indica la hora de apertura y la de cierre (HH:MM), o deja el horario vacío si no se sabe.';
export const OPENING_HOURS_ORDER =
  'La apertura debe ser anterior al cierre (los horarios que pasan de medianoche no se admiten).';

/** Validation shared by the server and the forms: null when valid. */
export function openingHoursProblem(hours: OpeningHours): string | null {
  if (!isLocalTime(hours.opensAt) || !isLocalTime(hours.closesAt)) {
    return OPENING_HOURS_INVALID;
  }
  if (hours.opensAt >= hours.closesAt) return OPENING_HOURS_ORDER;
  return null;
}

/** «08:00–20:00»; «Pendiente de verificar» when unknown. */
export function openingHoursLabel(hours: OpeningHours | null): string {
  return hours
    ? `${hours.opensAt}–${hours.closesAt}`
    : 'Pendiente de verificar';
}

/**
 * True when the window fits the place's daily hours in `timeZone`: it starts
 * at or after opening (and before closing) and ends after opening and at or
 * before closing. A window over several days is checked at its first and
 * last day (the Gestor does not know what happens overnight); an end at
 * midnight counts as 24:00 of the day before. Unknown hours, or a window
 * without both times, are never outside.
 */
export function withinOpeningHours(
  window: {startsAt: IsoInstant | null; endsAt: IsoInstant | null},
  hours: OpeningHours | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  if (!hours || !window.startsAt || !window.endsAt) return true;
  if (Number.isNaN(ms(window.startsAt)) || Number.isNaN(ms(window.endsAt))) {
    return true;
  }
  const start = utcToLocal(window.startsAt, timeZone);
  const end = utcToLocal(window.endsAt, timeZone);
  // An end at midnight is 24:00 of the day before.
  const endTime =
    end.time === '00:00' && end.date > start.date ? '24:00' : end.time;
  const startOk = start.time >= hours.opensAt && start.time < hours.closesAt;
  const endOk = endTime > hours.opensAt && endTime <= hours.closesAt;
  return startOk && endOk;
}

/** «Plaza del Adelantado abre de 08:00 a 20:00: …». */
export function outsideHoursMessage(
  placeName: string,
  hours: OpeningHours,
): string {
  return `«${placeName}» abre de ${hours.opensAt} a ${hours.closesAt}: la tarea quedaría fuera de ese horario.`;
}

// ---------------------------------------------------------------- preview

export interface MoveAnalysis<T extends PlanTask = PlanTask> {
  impact: DelayImpact;
  /** The plan after the move: moved tasks have new times; nothing else differs. */
  tasks: T[];
  /** Warnings that exist only after the move. */
  newWarnings: PlanWarning[];
  /** Warnings that already exist but get worse (more minutes). */
  worsened: PlanWarning[];
  /**
   * Warnings the move makes disappear. Never route or heavy-load reminders:
   * moving a task does not solve a risk the Gestor cannot see.
   */
  clearedWarnings: PlanWarning[];
  /**
   * Routes A/B/C and Carpa Amarilla: one reminder for every moved task with
   * vehicles, load-bearing work or a known heavy load, whether or not it
   * still coincides with an event (`movedSafety` in conflicts.ts).
   */
  routeReminders: PlanWarning[];
  /** Heavy-load (subsoil) reminders on moved tasks after the move, new or not. */
  subsoilReminders: PlanWarning[];
  /**
   * Moved tasks whose new window falls outside their venue's known opening
   * hours. The server refuses a move whose root is here (400
   * `fields.minutes`); a dependant pushed out of hours is only shown.
   */
  outsideHours: Uuid[];
}

/**
 * Everything a move preview shows: which tasks move, the plan warnings
 * re-run on the moved plan, the route and subsoil reminders of what moves,
 * and what falls outside opening hours. Nothing is modified.
 */
export function analyzeMove<T extends PlanTask>(input: {
  tasks: T[];
  events?: PlanEvent[];
  resources?: PlanResource[];
  venues?: PlaceHours[];
  rootId: Uuid;
  minutes: number;
  /** The organization's time zone, for opening hours. */
  timeZone?: string;
}): MoveAnalysis<T> {
  const {tasks, events = [], resources = [], venues = [], rootId} = input;
  const impact = simulateMove(moveItems(tasks), rootId, input.minutes);
  const moved = new Map(impact.shifted.map(s => [s.id, s]));
  const after = tasks.map(t => {
    const s = moved.get(t.id);
    return s ? {...t, startsAt: s.startsAt, endsAt: s.endsAt} : t;
  });

  const beforeWarnings = planWarnings(tasks, events, resources);
  const afterWarnings = planWarnings(after, events, resources);
  const beforeByKey = new Map(beforeWarnings.map(w => [w.key, w]));
  const afterKeys = new Set(afterWarnings.map(w => w.key));
  const newWarnings: PlanWarning[] = [];
  const worsened: PlanWarning[] = [];
  for (const w of afterWarnings) {
    const old = beforeByKey.get(w.key);
    if (!old) newWarnings.push(w);
    else if ((w.minutes ?? 0) > (old.minutes ?? 0)) worsened.push(w);
  }
  const touchesMoved = (w: PlanWarning) => w.taskIds.some(id => moved.has(id));
  const hoursById = new Map(venues.map(v => [v.id, v.openingHours]));
  const outsideHours = after
    .filter(
      t =>
        moved.has(t.id) &&
        !!t.venue &&
        !withinOpeningHours(t, hoursById.get(t.venue.id), input.timeZone),
    )
    .map(t => t.id);

  const safety = movedSafety({
    after,
    movedIds: moved,
    afterWarnings,
    cleared: beforeWarnings.filter(w => !afterKeys.has(w.key)),
  });

  return {
    impact,
    tasks: after,
    newWarnings,
    worsened,
    clearedWarnings: safety.cleared,
    routeReminders: safety.routeReminders,
    subsoilReminders: afterWarnings.filter(
      w =>
        (w.kind === 'heavy_load' || w.kind === 'heavy_load_unknown') &&
        touchesMoved(w),
    ),
    outsideHours,
  };
}
