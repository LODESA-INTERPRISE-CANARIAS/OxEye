/**
 * Event rules as pure functions: how a local slot (date, start, end) becomes
 * stored instants, how a partial edit merges with what is stored, and which
 * fields an edit really changed. No database, no HTTP.
 *
 * Status: any status may change to any other (a cancelled event can be
 * reopened if it was cancelled by mistake); the activity log keeps the trail.
 */
import {
  instantsToSlot,
  slotToInstants,
} from '../../../shared/logistics/time.ts';
import type {
  EventStatus,
  DataSource,
  IsoInstant,
  LocalDate,
  LocalTime,
  Verification,
} from '../../../shared/logistics/contracts.ts';

export interface SlotInput {
  date?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
}

export interface LocalSlot {
  date: LocalDate | null;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
}

export interface StoredSlot {
  localDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
}

export type SlotResult =
  {ok: true; slot: StoredSlot} | {ok: false; fields: Record<string, string>};

export const TIME_WITHOUT_DATE = 'Indica la fecha para poder guardar la hora.';

/** The slot as the user sees it, from what is stored. */
export function storedToLocal(stored: StoredSlot, timeZone: string): LocalSlot {
  const local = instantsToSlot(stored.startsAt, stored.endsAt, timeZone);
  return {
    date: stored.localDate ?? local.date,
    startTime: local.startTime,
    endTime: local.endTime,
  };
}

/** True when the input mentions any part of the slot. */
export function touchesSlot(input: SlotInput): boolean {
  return (
    input.date !== undefined ||
    input.startTime !== undefined ||
    input.endTime !== undefined
  );
}

/**
 * Merges an input with the current local slot (null when creating) and
 * converts it to instants in `timeZone`. Clearing the date clears the times
 * unless new times are given, which is then an error: a time needs its day.
 */
export function resolveSlot(
  input: SlotInput,
  current: LocalSlot | null,
  timeZone: string,
): SlotResult {
  const base: LocalSlot = current ?? {
    date: null,
    startTime: null,
    endTime: null,
  };
  const dateCleared = input.date === null;
  const date = input.date !== undefined ? input.date : base.date;
  const startTime =
    input.startTime !== undefined
      ? input.startTime
      : dateCleared
        ? null
        : base.startTime;
  const endTime =
    input.endTime !== undefined
      ? input.endTime
      : dateCleared
        ? null
        : base.endTime;

  if (!date && (startTime || endTime)) {
    return {ok: false, fields: {date: TIME_WITHOUT_DATE}};
  }
  const {startsAt, endsAt} = slotToInstants(date, startTime, endTime, timeZone);
  return {ok: true, slot: {localDate: date ?? null, startsAt, endsAt}};
}

/** The editable state of an event, in comparable form. */
export interface EventState {
  name: string;
  venueId: string | null;
  localDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  status: EventStatus;
  notes: string | null;
  source: DataSource | null;
  verification: Verification;
}

/** Contract field names, in a stable order, for the activity log. */
const FIELD_NAMES: [keyof EventState, string][] = [
  ['name', 'name'],
  ['venueId', 'venue'],
  ['localDate', 'date'],
  ['startsAt', 'startsAt'],
  ['endsAt', 'endsAt'],
  ['status', 'status'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

export function changedEventFields(
  before: EventState,
  after: EventState,
): string[] {
  return FIELD_NAMES.filter(([key]) => !sameValue(before[key], after[key])).map(
    ([, name]) => name,
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    // Instants compare by time, whatever their textual form.
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (/^\d{4}-\d{2}-\d{2}T/.test(a) && !Number.isNaN(ta) && ta === tb) {
      return true;
    }
  }
  return a === b;
}
