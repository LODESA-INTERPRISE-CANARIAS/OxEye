/**
 * Pure helpers behind the Gestor's own form controls (TimeField, DateField,
 * SelectField): what people type on site («930», «21h», «2/12», «mañana»)
 * becomes a `HH:MM` or `YYYY-MM-DD` value, plus the Spanish labels and the
 * month grid the pickers draw. No DOM, no React.
 *
 * Parsers return the value, `''` for an empty text (unknown, «Pendiente de
 * verificar») or `null` when the text is not understood yet.
 */

/** Minutes per ↑/↓ press and per step in the time picker. */
export const TIME_STEP = 5;

const pad = (n: number) => String(n).padStart(2, '0');

/** Lower case without accents, trimmed, inner spaces collapsed. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ time

function timeOf(h: number, m: number): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (m < 0 || m > 59 || h < 0 || h > 24) return null;
  // «24:00» is how people write midnight at the end of the day.
  if (h === 24) return m === 0 ? '00:00' : null;
  return `${pad(h)}:${pad(m)}`;
}

/**
 * «9» → 09:00, «930» → 09:30, «0930», «9:30», «9.30», «9,30», «9h30»,
 * «9 30», «21h», «21 h», «24:00» → 00:00, «mediodía», «medianoche»;
 * «ahora» needs `now`.
 */
export function parseTime(text: string, now?: string): string | null {
  const t = foldText(text);
  if (!t) return '';
  if (t === 'ahora') return now ?? null;
  if (t === 'mediodia') return '12:00';
  if (t === 'medianoche') return '00:00';
  const unit = String.raw`(?:\s*(?:h|hs|horas?|min))?`;
  const sep = new RegExp(
    String.raw`^(\d{1,2})\s*(?:[:.,']|h|\s)\s*(\d{2})?${unit}$`,
  ).exec(t);
  if (sep) return timeOf(Number(sep[1]), sep[2] ? Number(sep[2]) : 0);
  const digits = new RegExp(String.raw`^(\d{1,4})${unit}$`).exec(t);
  if (!digits) return null;
  const d = digits[1];
  if (d.length <= 2) return timeOf(Number(d), 0);
  return timeOf(Number(d.slice(0, -2)), Number(d.slice(-2)));
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/**
 * One ↑/↓ press: to the next (or previous) multiple of `step`, wrapping
 * around midnight. «09:07» + 5 → 09:10; «09:10» − 5 → 09:05.
 */
export function stepTime(
  value: string,
  direction: 1 | -1,
  step = TIME_STEP,
): string {
  const m = toMinutes(value);
  const next =
    direction > 0
      ? (Math.floor(m / step) + 1) * step
      : (Math.ceil(m / step) - 1) * step;
  return fromMinutes(next);
}

/** Nearest multiple of `step` («09:32» → 09:30, «23:58» → 00:00). */
export function roundTime(value: string, step = TIME_STEP): string {
  return fromMinutes(Math.round(toMinutes(value) / step) * step);
}

/** `value` plus `minutes` («22:30» + 120 → 00:30, the next day). */
export function addMinutes(value: string, minutes: number): string {
  return fromMinutes(toMinutes(value) + minutes);
}

// ------------------------------------------------------------------ dates

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateOf(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parts(value: string): [number, number, number] {
  const m = DATE_RE.exec(value);
  if (!m) throw new Error(`Not a local date: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function dayNumber(value: string): number {
  const [y, m, d] = parts(value);
  return Date.UTC(y, m - 1, d) / 864e5;
}

/** Whole days added to a local date. */
export function shiftDate(value: string, days: number): string {
  const [y, m, d] = parts(value);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Same day `months` later, clamped to the month's length (31/1 → 28/2). */
export function shiftMonth(value: string, months: number): string {
  const [y, m, d] = parts(value);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return dateOf(
    first.getUTCFullYear(),
    first.getUTCMonth() + 1,
    Math.min(d, last),
  )!;
}

/** Monday 0 … Sunday 6. */
export function weekdayIndex(value: string): number {
  const [y, m, d] = parts(value);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The candidate closest to `today` (ties go to the later one). */
function nearest(candidates: (string | null)[], today: string): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  const t = dayNumber(today);
  for (const c of candidates) {
    if (!c) continue;
    const gap = Math.abs(dayNumber(c) - t);
    if (gap < bestGap || (gap === bestGap && best !== null && c > best)) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const WEEKDAYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
];

/** 1–12 for a month name or a prefix of at least three letters. */
function monthNumber(word: string): number | null {
  const w = word.replace(/\.$/, '');
  if (w.length < 3) return null;
  if (w === 'set' || w === 'sept') return 9;
  const i = MONTHS.findIndex(name => name.startsWith(w));
  return i >= 0 ? i + 1 : null;
}

/** 0–6 for a weekday name or its three-letter form. */
function weekdayNumber(word: string): number | null {
  const w = word.replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = WEEKDAYS.findIndex(name => name.startsWith(w));
  return i >= 0 ? i : null;
}

const RELATIVE: Record<string, number> = {
  hoy: 0,
  manana: 1,
  'pasado manana': 2,
  pasado: 2,
  ayer: -1,
  anteayer: -2,
};

/**
 * «hoy», «mañana», «pasado mañana», «ayer»; «2/12», «2-12», «2.12»,
 * «2/12/26», «2-12-2026», «2026-12-02»; «2 dic», «2 de diciembre de
 * 2026»; «viernes», «el vie» (the next one, today included); «15» (the
 * 15th closest to today). Without a year, the date closest to `today`.
 */
export function parseDate(text: string, today: string): string | null {
  const t = foldText(text).replace(/^(el|este|proximo) /, '');
  if (!t) return '';
  if (t in RELATIVE) return shiftDate(today, RELATIVE[t]);

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return dateOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const [ty, tm] = parts(today);
  const yearOf = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const inNearestYear = (m: number, d: number) =>
    nearest(
      [dateOf(ty - 1, m, d), dateOf(ty, m, d), dateOf(ty + 1, m, d)],
      today,
    );

  const numeric =
    /^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})(?:\s*[/.\-\s]\s*(\d{2}|\d{4}))?$/.exec(
      t,
    );
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    return numeric[3] ? dateOf(yearOf(numeric[3]), m, d) : inNearestYear(m, d);
  }

  const named =
    /^(\d{1,2})\s*(?:de\s+)?([a-z]+\.?)(?:\s*(?:de\s+)?(\d{4}))?$/.exec(t);
  if (named) {
    const m = monthNumber(named[2]);
    if (!m) return null;
    const d = Number(named[1]);
    return named[3] ? dateOf(Number(named[3]), m, d) : inNearestYear(m, d);
  }

  const compact = /^(\d{4}|\d{6}|\d{8})$/.exec(t);
  if (compact) {
    const s = compact[1];
    const d = Number(s.slice(0, 2));
    const m = Number(s.slice(2, 4));
    if (s.length === 4) return inNearestYear(m, d);
    return dateOf(yearOf(s.slice(4)), m, d);
  }

  const dayOnly = /^(\d{1,2})$/.exec(t);
  if (dayOnly) {
    const d = Number(dayOnly[1]);
    return nearest(
      [-1, 0, 1].map(k => {
        const first = new Date(Date.UTC(ty, tm - 1 + k, 1));
        return dateOf(first.getUTCFullYear(), first.getUTCMonth() + 1, d);
      }),
      today,
    );
  }

  const wd = weekdayNumber(t);
  if (wd !== null) {
    return shiftDate(today, (wd - weekdayIndex(today) + 7) % 7);
  }
  return null;
}

/** «02/12/2026», the way the field shows a date. */
export function formatDate(value: string): string {
  if (!DATE_RE.test(value)) return value;
  const [y, m, d] = parts(value);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** Whether `value` is inside the optional `min`…`max` range. */
export function dateInRange(
  value: string,
  min?: string,
  max?: string,
): boolean {
  return (!min || value >= min) && (!max || value <= max);
}

/** `value` moved into the optional `min`…`max` range. */
export function clampDate(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

/** First day of the month of `value`. */
export function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

/**
 * The weeks of the month of `value`, Monday first; days of other months
 * are `null` so the grid keeps its shape.
 */
export function monthWeeks(value: string): (string | null)[][] {
  const first = monthStart(value);
  const lead = weekdayIndex(first);
  const [y, m] = parts(first);
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({length: lead}, () => null);
  for (let d = 1; d <= length; d++) cells.push(`${y}-${pad(m)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const capitalize = (s: string) =>
  s ? s[0].toLocaleUpperCase('es-ES') + s.slice(1) : s;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('es-ES', {...options, timeZone: 'UTC'});
    fmtCache.set(key, f);
  }
  return f;
}

const anchor = (value: string) => new Date(`${value}T12:00:00Z`);

/** «Diciembre de 2026» → «Diciembre 2026». */
export function monthLabel(value: string): string {
  return capitalize(
    fmt({month: 'long', year: 'numeric'})
      .format(anchor(monthStart(value)))
      .replace(' de ', ' '),
  );
}

/** «Miércoles, 2 de diciembre de 2026». */
export function dateLong(value: string): string {
  return capitalize(
    fmt({
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(anchor(value)),
  );
}

/** «mié». */
export function weekdayShort(value: string): string {
  return fmt({weekday: 'short'}).format(anchor(value)).replace('.', '');
}

/** Column heads of the month grid, Monday first. */
export const WEEK_HEADS: {short: string; long: string}[] = [
  {short: 'L', long: 'lunes'},
  {short: 'M', long: 'martes'},
  {short: 'X', long: 'miércoles'},
  {short: 'J', long: 'jueves'},
  {short: 'V', long: 'viernes'},
  {short: 'S', long: 'sábado'},
  {short: 'D', long: 'domingo'},
];
