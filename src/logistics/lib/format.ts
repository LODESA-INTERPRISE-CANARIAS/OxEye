/**
 * Spanish date and time formatting in the organization's time zone.
 */
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(key: string, options: Intl.DateTimeFormatOptions) {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('es-ES', options);
    cache.set(key, f);
  }
  return f;
}

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase('es-ES') + text.slice(1) : text;
}

/** Local `YYYY-MM-DD` for now in `timeZone`. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE): string {
  return utcToLocal(new Date().toISOString(), timeZone).date;
}

/** Noon UTC of a local date: safe to format the calendar date anywhere. */
function dateAnchor(localDate: string): Date {
  return new Date(`${localDate}T12:00:00Z`);
}

/** «Miércoles, 2 de diciembre de 2026». */
export function longDate(localDate: string): string {
  return capitalize(
    fmt('long', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(dateAnchor(localDate)),
  );
}

/** «Mié 2 dic». */
export function shortDate(localDate: string): string {
  const parts = fmt('short', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(dateAnchor(localDate));
  const get = (type: string) =>
    parts.find(p => p.type === type)?.value.replace('.', '') ?? '';
  return `${capitalize(get('weekday'))} ${get('day')} ${get('month')}`;
}

/** «2 dic». */
export function dayMonthShort(localDate: string): string {
  return shortDate(localDate).split(' ').slice(1).join(' ');
}

/** «1 tarea», «3 tareas». */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** «2 de diciembre». */
export function dayMonth(localDate: string): string {
  return fmt('daymonth', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dateAnchor(localDate));
}

/** «Diciembre 2026». */
export function monthTitle(year: number, monthIndex: number): string {
  return capitalize(
    fmt('month', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(
      new Date(Date.UTC(year, monthIndex, 1, 12)),
    ),
  );
}

/** «2 dic, 10:30» in `timeZone`. */
export function instantShort(
  instant: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const local = utcToLocal(instant, timeZone);
  return `${shortDate(local.date).split(' ').slice(1).join(' ')}, ${local.time}`;
}

const relative = new Intl.RelativeTimeFormat('es-ES', {numeric: 'auto'});

/** «hace 5 minutos», «hace 2 horas», or a short date after a day. */
export function relativeTime(
  instant: string,
  timeZone: string = DEFAULT_TIMEZONE,
  now: number = Date.now(),
): string {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return '';
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'ahora mismo';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return instantShort(instant, timeZone);
}

/** IANA zone as people read it: «America/New_York» → «America/New York». */
function readableZone(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

/** Subtitle note: «hora de Canarias», or the zone name elsewhere. */
export function zoneNote(timeZone: string = DEFAULT_TIMEZONE): string {
  return timeZone === DEFAULT_TIMEZONE
    ? 'hora de Canarias'
    : `hora de ${readableZone(timeZone)}`;
}

/** Form note on which clock the times use: «Horas de Canarias». */
export function zoneHoursNote(timeZone: string = DEFAULT_TIMEZONE): string {
  return timeZone === DEFAULT_TIMEZONE
    ? 'Horas de Canarias'
    : `Horas en la zona ${readableZone(timeZone)}`;
}

/** Initials for an avatar: «Elvis» → «E», «Equipo Norte» → «EN». */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map(w => w[0]?.toLocaleUpperCase('es-ES') ?? '')
    .join('');
}
