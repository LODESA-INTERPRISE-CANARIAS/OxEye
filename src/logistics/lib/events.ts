/**
 * Presentation helpers for logistics events: ordering, local dates, labels and
 * what information is still missing. No React, no store.
 */
import type {
  DataSource,
  EventStatus,
  LogisticsEvent,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {
  DEFAULT_TIMEZONE,
  instantsToSlot,
} from '../../../shared/logistics/time.ts';

/** Server order: date, then startsAt, undated last, then name. */
export function sortEvents(events: LogisticsEvent[]): LogisticsEvent[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? -1 : 1;
    }
    if (a.startsAt && b.startsAt) {
      const diff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      if (diff !== 0) return diff;
    } else if (a.startsAt) {
      return -1;
    } else if (b.startsAt) {
      return 1;
    }
    return a.name.localeCompare(b.name, 'es');
  });
}

export interface EventSlot {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
}

export function eventSlot(event: LogisticsEvent): EventSlot {
  const slot = instantsToSlot(
    event.startsAt,
    event.endsAt,
    event.timezone || DEFAULT_TIMEZONE,
  );
  // The stored local day wins: it exists even when the times are unknown.
  return {...slot, date: event.date ?? slot.date};
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  planned: 'Previsto',
  confirmed: 'Confirmado',
  delayed: 'Con retraso',
  cancelled: 'Cancelado',
};

export const STATUS_HELP: Record<EventStatus, string> = {
  planned: 'Está en el plan, pero aún no se ha confirmado.',
  confirmed: 'Confirmado con quien lo organiza.',
  delayed: 'Va con retraso respecto a lo previsto.',
  cancelled: 'No se celebrará.',
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  draft: 'Borrador',
  to_verify: 'Por verificar',
  validated: 'Validado',
};

export const VERIFICATION_HELP: Record<Verification, string> = {
  draft: 'Apunte rápido; puede estar incompleto.',
  to_verify: 'Hay que comprobarlo con la fuente.',
  validated: 'Comprobado con la fuente.',
};

export const SOURCE_LABEL: Record<DataSource, string> = {
  observed: 'Observado',
  reported: 'Comunicado',
  document: 'Documento',
};

export const SOURCE_HELP: Record<DataSource, string> = {
  observed: 'Lo hemos visto en persona.',
  reported: 'Nos lo ha dicho alguien.',
  document: 'Consta en un documento, contrato o correo.',
};

export type MissingKey = 'venue' | 'date' | 'start' | 'end' | 'validation';

export const MISSING_LABEL: Record<MissingKey, string> = {
  venue: 'lugar',
  date: 'fecha',
  start: 'hora de inicio',
  end: 'hora de fin',
  validation: 'validación',
};

/** What an event still lacks, in display order. Cancelled events count too. */
export function missingInfo(event: LogisticsEvent): MissingKey[] {
  const slot = eventSlot(event);
  const missing: MissingKey[] = [];
  if (!event.venue) missing.push('venue');
  if (!slot.date) missing.push('date');
  else {
    if (!slot.startTime) missing.push('start');
    if (!slot.endTime) missing.push('end');
  }
  if (event.verification !== 'validated') missing.push('validation');
  return missing;
}

export interface VerificationSummary {
  total: number;
  validated: number;
  /** 0–100, rounded; null when there are no events. */
  percent: number | null;
  incomplete: {event: LogisticsEvent; missing: MissingKey[]}[];
}

export function verificationSummary(
  events: LogisticsEvent[],
): VerificationSummary {
  const total = events.length;
  const validated = events.filter(e => e.verification === 'validated').length;
  const incomplete = events
    .map(event => ({event, missing: missingInfo(event)}))
    .filter(row => row.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);
  return {
    total,
    validated,
    percent: total ? Math.round((validated / total) * 100) : null,
    incomplete,
  };
}

/** Groups events into today, upcoming and undated, relative to `today`. */
export function groupForToday(events: LogisticsEvent[], today: string) {
  const todayEvents: LogisticsEvent[] = [];
  const upcoming: LogisticsEvent[] = [];
  const undated: LogisticsEvent[] = [];
  for (const event of events) {
    const {date} = eventSlot(event);
    if (!date) undated.push(event);
    else if (date === today) todayEvents.push(event);
    else if (date > today) upcoming.push(event);
  }
  return {todayEvents, upcoming, undated};
}

/** Events per local date, for calendar dots. */
export function eventsByDate(
  events: LogisticsEvent[],
): Map<string, LogisticsEvent[]> {
  const map = new Map<string, LogisticsEvent[]>();
  for (const event of events) {
    const {date} = eventSlot(event);
    if (!date) continue;
    const list = map.get(date);
    if (list) list.push(event);
    else map.set(date, [event]);
  }
  return map;
}
