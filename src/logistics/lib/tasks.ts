/**
 * Presentation helpers for tasks: labels, icons, ordering and local slots.
 * No React, no store. Scheduling and warnings live in `shared/logistics/`.
 */
import type {
  LocalDate,
  LogisticsEvent,
  Task,
  TaskKind,
  TaskStatus,
} from '../../../shared/logistics/contracts.ts';
import {
  LOAD_BEARING_KINDS,
  SUBSOIL_THRESHOLD_NOTE,
} from '../../../shared/logistics/conflicts.ts';
import {
  DEFAULT_TIMEZONE,
  occupiedDates,
  utcToLocal,
} from '../../../shared/logistics/time.ts';
import type {IconName} from '../ui/icons';

// Labels live in shared/ so work orders (built there) use the same words.
export {
  TASK_KIND_LABEL,
  TASK_STATUS_LABEL,
} from '../../../shared/logistics/rules.ts';

export const TASK_KIND_ICON: Record<TaskKind, IconName> = {
  assembly: 'assembly',
  activity: 'activityKind',
  dismantling: 'dismantling',
  transport: 'transport',
  delivery: 'delivery',
  other: 'other',
};

export const TASK_KIND_HELP: Record<TaskKind, string> = {
  assembly: 'Montar escenario, carpas, vallas, sonido…',
  activity: 'Lo que ocurre ante el público o el equipo.',
  dismantling: 'Desmontar y retirar lo montado.',
  transport: 'Mover material o personas de un sitio a otro.',
  delivery: 'Llega material de un proveedor.',
  other: 'Cualquier otra cosa que haya que hacer.',
};

export const TASK_STATUS_HELP: Record<TaskStatus, string> = {
  planned: 'Está en el plan, pero aún no se ha confirmado.',
  confirmed: 'Confirmada con quien la hace.',
  in_progress: 'Se está haciendo ahora.',
  done: 'Terminada.',
  delayed: 'Va con retraso respecto a lo previsto.',
  cancelled: 'No se hará.',
};

export function isLoadBearing(kind: TaskKind): boolean {
  return LOAD_BEARING_KINDS.has(kind);
}

export const HEAVY_LOAD_HELP = `Escenarios, generadores, depósitos de agua o lastres pesan mucho sobre el suelo. Si la respuesta es «Sí», revisa el subsuelo en el simulador de OxEye (análisis de rayos X): ${SUBSOIL_THRESHOLD_NOTE} «No lo sé» queda como pendiente de verificar; nunca se da por ligera.`;

/**
 * `?` help of the «Subsuelo» block of a change-of-times preview (a move, a
 * «¿Y si…?»): `change` is what the person is doing, e.g. «Mover la tarea».
 */
export function subsoilMovedHelp(change: string): string {
  return `Las cargas pesadas siguen necesitando la revisión del subsuelo en el simulador. ${SUBSOIL_THRESHOLD_NOTE} ${change} no cambia la carga ni la revisión declarada.`;
}

/** Local slot of a task or event, as forms and labels show it. */
export interface RecordSlot {
  date: LocalDate | null;
  /** Last day as stored (multi-day records); null for single-day. */
  endDate: LocalDate | null;
  startTime: string | null;
  endTime: string | null;
}

/** What a task and an event have in common for dates and times. */
export interface TimedRecord {
  date: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
}

export function taskZone(record: {timezone?: string | null}): string {
  return record.timezone || DEFAULT_TIMEZONE;
}

/**
 * Local first day: the stored day wins (it exists even when the times are
 * unknown), then the day of the start, then the day of the end.
 */
export function recordDate(record: TimedRecord): LocalDate | null {
  if (record.date) return record.date;
  const instant = record.startsAt ?? record.endsAt;
  return instant ? utcToLocal(instant, taskZone(record)).date : null;
}

/** Local date and times of a task or event for forms and labels. */
export function recordSlot(record: TimedRecord): RecordSlot {
  const tz = taskZone(record);
  const start = record.startsAt ? utcToLocal(record.startsAt, tz) : null;
  const end = record.endsAt ? utcToLocal(record.endsAt, tz) : null;
  return {
    date: record.date ?? start?.date ?? end?.date ?? null,
    endDate: record.endDate ?? null,
    startTime: start?.time ?? null,
    endTime: end?.time ?? null,
  };
}

/** Local days a task or event occupies (empty when undated). */
export function recordDays(record: TimedRecord): LocalDate[] {
  const date = recordDate(record);
  if (!date) return [];
  return occupiedDates(
    {date, endDate: record.endDate, endsAt: record.endsAt},
    taskZone(record),
  );
}

const collator = new Intl.Collator('es');

/**
 * Date, then start, untimed after timed, undated last, then name. Sort keys
 * are computed once per record (time-zone conversion is the costly part on
 * phones with a few hundred tasks), not inside the comparator.
 */
export function sortRecords<T extends TimedRecord>(
  records: T[],
  name: (record: T) => string,
): T[] {
  const keyed = records.map(record => ({
    record,
    date: recordDate(record),
    start: record.startsAt ? Date.parse(record.startsAt) : null,
    name: name(record),
  }));
  keyed.sort((a, b) => {
    if (a.date !== b.date) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? -1 : 1;
    }
    if (a.start !== null && b.start !== null) {
      if (a.start !== b.start) return a.start - b.start;
    } else if (a.start !== null) {
      return -1;
    } else if (b.start !== null) {
      return 1;
    }
    return collator.compare(a.name, b.name);
  });
  return keyed.map(k => k.record);
}

export function sortTasks(tasks: Task[]): Task[] {
  return sortRecords(tasks, t => t.title);
}

/** Tasks of one event, in time order. */
export function tasksOfEvent(tasks: Task[], eventId: string): Task[] {
  return sortTasks(tasks.filter(t => t.eventId === eventId));
}

/** Tasks that list `id` among their dependencies. */
export function dependentsOf(tasks: Task[], id: string): Task[] {
  return sortTasks(tasks.filter(t => t.dependsOn.includes(id)));
}

/** Event filter of the calendar: every event, one event, or tasks without one. */
export type EventFilter = 'all' | 'none' | string;

export function filterTasks(tasks: Task[], filter: EventFilter): Task[] {
  if (filter === 'all') return tasks;
  if (filter === 'none') return tasks.filter(t => !t.eventId);
  return tasks.filter(t => t.eventId === filter);
}

export function filterEvents(
  events: LogisticsEvent[],
  filter: EventFilter,
): LogisticsEvent[] {
  if (filter === 'all') return events;
  if (filter === 'none') return [];
  return events.filter(e => e.id === filter);
}

/**
 * Case-insensitive key for names typed by people, as the server matches
 * venues and companies (find-or-create by name).
 */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('es-ES');
}
