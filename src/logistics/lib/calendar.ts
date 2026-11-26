/**
 * Calendar layout helpers: month grids, what happens on each day, multi-day
 * bars and the day timeline (one column per venue, overlapping blocks side
 * by side). Pure functions over contract records; no React, no store.
 */
import type {
  LocalDate,
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import {addDays, utcToLocal} from '../../../shared/logistics/time.ts';
import {recordDays, taskZone} from './tasks';

export const MINUTES_PER_DAY = 1440;

/** 42 local dates (6 weeks, Monday first) covering a month. */
export function monthCells(year: number, month: number): LocalDate[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDays(first.toISOString().slice(0, 10), -offset);
  return Array.from({length: 42}, (_, i) => addDays(start, i));
}

/** Year and month index of a local date. */
export function monthOf(date: LocalDate): {year: number; month: number} {
  return {year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1};
}

export function shiftMonth(
  cursor: {year: number; month: number},
  delta: number,
): {year: number; month: number} {
  const m = cursor.month + delta;
  return {
    year: cursor.year + Math.floor(m / 12),
    month: ((m % 12) + 12) % 12,
  };
}

export interface DayBucket {
  events: LogisticsEvent[];
  tasks: Task[];
  /** Conflict warnings that happen on this day. */
  conflicts: PlanWarning[];
  /** Reminders (heavy load, routes) for tasks on this day. */
  reminders: PlanWarning[];
}

const emptyBucket = (): DayBucket => ({
  events: [],
  tasks: [],
  conflicts: [],
  reminders: [],
});

/**
 * Everything per local day. Multi-day records appear on every day they
 * occupy. A conflict is placed on the days both tasks share (for a dependency
 * that starts too early, on the later task's days if they share none).
 */
export function buildDayIndex(
  events: LogisticsEvent[],
  tasks: Task[],
  warnings: PlanWarning[],
): Map<LocalDate, DayBucket> {
  const map = new Map<LocalDate, DayBucket>();
  const bucket = (date: LocalDate) => {
    let b = map.get(date);
    if (!b) {
      b = emptyBucket();
      map.set(date, b);
    }
    return b;
  };
  for (const e of events) {
    for (const d of recordDays(e)) bucket(d).events.push(e);
  }
  const daysById = new Map<string, LocalDate[]>();
  const byId = new Map<string, Task>();
  for (const t of tasks) {
    const days = recordDays(t);
    daysById.set(t.id, days);
    byId.set(t.id, t);
    for (const d of days) bucket(d).tasks.push(t);
  }
  for (const w of warnings) {
    const lists = w.taskIds
      .map(id => daysById.get(id))
      .filter((d): d is LocalDate[] => !!d);
    if (!lists.length) continue;
    let days: LocalDate[];
    if (w.severity === 'conflict') {
      days = lists.reduce((acc, d) => acc.filter(x => d.includes(x)));
      if (!days.length) {
        // No shared day: the task that starts too early (the one that waits
        // for the other), whatever order `taskIds` lists them in.
        const late = w.taskIds.find(id =>
          byId.get(id)?.dependsOn.some(dep => w.taskIds.includes(dep)),
        );
        days = (late && daysById.get(late)) || lists[lists.length - 1];
      }
    } else {
      days = [...new Set(lists.flat())];
    }
    for (const d of days) {
      const b = bucket(d);
      (w.severity === 'conflict' ? b.conflicts : b.reminders).push(w);
    }
  }
  return map;
}

// ---------------------------------------------------------------- month bars

export interface WeekBar {
  event: LogisticsEvent;
  /** Columns 0–6 within the week. */
  start: number;
  span: number;
  lane: number;
  /** The event started before this week / continues after it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Bars for events spanning several days within one week (7 dates), stacked
 * in lanes so they never overlap.
 */
export function weekBars(
  events: LogisticsEvent[],
  week: LocalDate[],
): WeekBar[] {
  const first = week[0];
  const last = week[week.length - 1];
  const segments: Omit<WeekBar, 'lane'>[] = [];
  for (const event of events) {
    const days = recordDays(event);
    if (days.length < 2) continue;
    if (days[days.length - 1] < first || days[0] > last) continue;
    const inWeek = days.filter(d => d >= first && d <= last);
    if (!inWeek.length) continue;
    segments.push({
      event,
      start: week.indexOf(inWeek[0]),
      span: inWeek.length,
      continuesBefore: days[0] < first,
      continuesAfter: days[days.length - 1] > last,
    });
  }
  segments.sort((a, b) => a.start - b.start || b.span - a.span);
  const laneEnds: number[] = [];
  return segments.map(s => {
    let lane = laneEnds.findIndex(end => end <= s.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.start + s.span;
    return {...s, lane};
  });
}

// ---------------------------------------------------------------- day timeline

/**
 * Minutes from local midnight of `date` to `instant`, clamped to the day:
 * anything before the day is 0, anything after it is 1440.
 */
export function minutesInDay(
  instant: string,
  date: LocalDate,
  timeZone: string,
): number {
  const local = utcToLocal(instant, timeZone);
  if (local.date < date) return 0;
  if (local.date > date) return MINUTES_PER_DAY;
  const [h, m] = local.time.split(':').map(Number);
  return h * 60 + m;
}

export interface Span {
  start: number;
  end: number;
  /** No end time: drawn with a default length and an open end. */
  openEnd: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Default drawn length of a task whose end is not known yet. */
export const OPEN_END_MINUTES = 30;

/**
 * The part of a timed record that falls on `date`, or null if untimed.
 *
 * Without an end time, a single-day record is drawn `OPEN_END_MINUTES` long.
 * A multi-day one (`endDate` after its first day) still covers every day up
 * to `endDate`: its first day runs to midnight, the following days are full,
 * and only the last day carries the open-end marker.
 */
export function spanOnDate(
  record: {
    startsAt: string | null;
    endsAt: string | null;
    timezone: string;
    endDate?: LocalDate | null;
  },
  date: LocalDate,
): Span | null {
  if (!record.startsAt) return null;
  const tz = taskZone(record);
  const start = minutesInDay(record.startsAt, date, tz);
  const startLocal = utcToLocal(record.startsAt, tz).date;
  if (!record.endsAt && record.endDate && record.endDate > startLocal) {
    const lastDay = date >= record.endDate;
    return {
      start,
      end: MINUTES_PER_DAY,
      openEnd: lastDay,
      continuesBefore: startLocal < date,
      continuesAfter: !lastDay,
    };
  }
  let end: number;
  let continuesAfter = false;
  if (record.endsAt) {
    end = minutesInDay(record.endsAt, date, tz);
    const endLocal = utcToLocal(record.endsAt, tz);
    // Ending at midnight closes the day; it does not continue.
    continuesAfter =
      endLocal.date > addDays(date, 1) ||
      (endLocal.date > date && endLocal.time !== '00:00');
  } else {
    end = Math.min(MINUTES_PER_DAY, start + OPEN_END_MINUTES);
  }
  if (end <= start) end = Math.min(MINUTES_PER_DAY, start + 15);
  return {
    start,
    end,
    openEnd: !record.endsAt,
    continuesBefore: startLocal < date,
    continuesAfter,
  };
}

export interface TimelineBlock {
  task: Task;
  span: Span;
  /** Position among overlapping blocks, and how many share the space. */
  lane: number;
  lanes: number;
}

/**
 * Lays out the timed tasks of one column: blocks that overlap in time sit
 * side by side. `minMinutes` is the shortest drawn length, so short blocks
 * with a minimum height do not cover each other.
 */
export function layoutColumn(
  tasks: Task[],
  date: LocalDate,
  minMinutes = 20,
): TimelineBlock[] {
  const items = tasks
    .map(task => ({task, span: spanOnDate(task, date)}))
    .filter((x): x is {task: Task; span: Span} => !!x.span)
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const out: TimelineBlock[] = [];
  let cluster: TimelineBlock[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const b of cluster) b.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const {task, span} of items) {
    const drawnEnd = Math.max(span.end, span.start + minMinutes);
    if (span.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex(end => end <= span.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = drawnEnd;
    clusterEnd = Math.max(cluster.length ? clusterEnd : drawnEnd, drawnEnd);
    cluster.push({task, span, lane, lanes: 1});
  }
  flush();
  return out;
}

export interface VenueColumn {
  /** Venue id, or `null` for «Sin lugar». */
  id: string | null;
  name: string;
  tasks: Task[];
  events: LogisticsEvent[];
}

/**
 * One column per venue used on the day (by tasks or events), sorted by name,
 * then «Sin lugar» when something has no venue.
 */
export function venueColumns(
  tasks: Task[],
  events: LogisticsEvent[],
): VenueColumn[] {
  const byId = new Map<string, VenueColumn>();
  const none: VenueColumn = {
    id: null,
    name: 'Sin lugar',
    tasks: [],
    events: [],
  };
  const column = (venue: {id: string; name: string} | null) => {
    if (!venue) return none;
    let c = byId.get(venue.id);
    if (!c) {
      c = {id: venue.id, name: venue.name, tasks: [], events: []};
      byId.set(venue.id, c);
    }
    return c;
  };
  for (const t of tasks) column(t.venue).tasks.push(t);
  for (const e of events) column(e.venue).events.push(e);
  const columns = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  );
  if (none.tasks.length || none.events.length) columns.push(none);
  return columns;
}

/** Minutes since local midnight now, if `date` is today in `timeZone`. */
export function nowMinutes(date: LocalDate, timeZone: string): number | null {
  const local = utcToLocal(new Date().toISOString(), timeZone);
  if (local.date !== date) return null;
  const [h, m] = local.time.split(':').map(Number);
  return h * 60 + m;
}

/** «07:00» for a minute of the day. */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
