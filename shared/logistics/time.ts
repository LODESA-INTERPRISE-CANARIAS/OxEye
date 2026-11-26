/**
 * Local date/time ↔ UTC instant conversion for an IANA time zone, using only
 * Intl (no dependencies). Shared by the server (stores UTC) and the UI
 * (shows and edits local times, `Atlantic/Canary` by default).
 */
import type {IsoInstant, LocalDate, LocalTime} from './contracts.ts';

export const DEFAULT_TIMEZONE = 'Atlantic/Canary';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d
  );
}

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: value});
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(ms: number, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) {
    parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `timeZone` from UTC at the given instant, in minutes (WEST = +60). */
export function offsetMinutes(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const w = wallClock(whole, timeZone);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  return Math.round((asUtc - whole) / 60000);
}

/**
 * Converts a local wall-clock date and time in `timeZone` to a UTC instant.
 * Non-existent times in a spring-forward gap resolve forward; ambiguous times
 * in a fall-back overlap resolve to the first (summer-time) occurrence.
 */
export function localToUtc(
  date: LocalDate,
  time: LocalTime,
  timeZone: string = DEFAULT_TIMEZONE,
): IsoInstant {
  if (!isLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);
  if (!isLocalTime(time)) throw new RangeError(`Invalid local time: ${time}`);
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = offsetMinutes(guess - 12 * 3600_000, timeZone);
  const second = offsetMinutes(guess + 12 * 3600_000, timeZone);
  // Try the earlier offset first so ambiguous times map to summer time.
  for (const off of [Math.max(first, second), Math.min(first, second)]) {
    const candidate = guess - off * 60000;
    if (offsetMinutes(candidate, timeZone) === off) {
      return new Date(candidate).toISOString();
    }
  }
  // Gap: the wall-clock time does not exist; shift by the offset before it.
  return new Date(guess - Math.min(first, second) * 60000).toISOString();
}

/** Converts a UTC instant to the local date and time in `timeZone`. */
export function utcToLocal(
  instant: IsoInstant,
  timeZone: string = DEFAULT_TIMEZONE,
): {date: LocalDate; time: LocalTime} {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant: ${instant}`);
  const w = wallClock(ms, timeZone);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return {
    date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

/** Adds whole days to a local date. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, mo, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 864e5,
  );
}

/** Every local date from `from` to `to`, both included (empty if reversed). */
export function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let i = 0, n = daysBetween(from, to); i <= n; i++) {
    out.push(addDays(from, i));
  }
  return out;
}

/**
 * Turns a local slot (date, start, end) into UTC instants. Missing parts stay
 * null. With `endDate` (multi-day) the end time falls on that day; without it,
 * an end time at or before the start time means the next day (22:00–02:00).
 */
export function slotToInstants(
  date: LocalDate | null | undefined,
  startTime: LocalTime | null | undefined,
  endTime: LocalTime | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  endDate?: LocalDate | null,
): {startsAt: IsoInstant | null; endsAt: IsoInstant | null} {
  if (!date) return {startsAt: null, endsAt: null};
  const startsAt = startTime ? localToUtc(date, startTime, timeZone) : null;
  let endsAt: IsoInstant | null = null;
  if (endTime) {
    const lastDay =
      endDate && endDate > date
        ? endDate
        : startTime && endTime <= startTime
          ? addDays(date, 1)
          : date;
    endsAt = localToUtc(lastDay, endTime, timeZone);
  }
  return {startsAt, endsAt};
}

/**
 * Local days a record occupies: from `date` to `endDate` (or to the local day
 * of `endsAt` for overnight slots). Empty when undated.
 */
export function occupiedDates(
  record: {
    date: LocalDate | null;
    endDate: LocalDate | null;
    endsAt: IsoInstant | null;
  },
  timeZone: string = DEFAULT_TIMEZONE,
): LocalDate[] {
  if (!record.date) return [];
  let last =
    record.endDate && record.endDate > record.date
      ? record.endDate
      : record.date;
  if (record.endsAt) {
    const endLocal = utcToLocal(record.endsAt, timeZone);
    // An overnight end at 00:00 does not occupy the next day.
    const endDay =
      endLocal.time === '00:00' ? addDays(endLocal.date, -1) : endLocal.date;
    if (endDay > last) last = endDay;
  }
  return eachDate(record.date, last);
}

/** Inverse of slotToInstants for editing forms. */
export function instantsToSlot(
  startsAt: IsoInstant | null,
  endsAt: IsoInstant | null,
  timeZone: string = DEFAULT_TIMEZONE,
): {
  date: LocalDate | null;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
} {
  const start = startsAt ? utcToLocal(startsAt, timeZone) : null;
  const end = endsAt ? utcToLocal(endsAt, timeZone) : null;
  return {
    date: start?.date ?? end?.date ?? null,
    startTime: start?.time ?? null,
    endTime: end?.time ?? null,
  };
}
