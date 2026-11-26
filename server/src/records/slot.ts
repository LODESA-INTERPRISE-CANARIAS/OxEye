/**
 * Local slot rules shared by events and tasks, as pure functions: how a local
 * slot (date, optional last date, start, end) becomes stored instants, and how
 * a partial edit merges with what is stored. No database, no HTTP.
 */
import {
  daysBetween,
  instantsToSlot,
  slotToInstants,
} from '../../../shared/logistics/time.ts';
import {MAX_SPAN_DAYS} from '../../../shared/logistics/rules.ts';
import type {
  IsoInstant,
  LocalDate,
  LocalTime,
} from '../../../shared/logistics/contracts.ts';

export interface SlotInput {
  date?: LocalDate | null;
  endDate?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
}

export interface LocalSlot {
  date: LocalDate | null;
  endDate: LocalDate | null;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
}

export interface StoredSlot {
  localDate: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
}

export type SlotResult =
  {ok: true; slot: StoredSlot} | {ok: false; fields: Record<string, string>};

// Longest span accepted, shared with the UI; re-exported for server modules.
export {MAX_SPAN_DAYS};

export const TIME_WITHOUT_DATE = 'Indica la fecha para poder guardar la hora.';
export const END_DATE_WITHOUT_DATE =
  'Indica la fecha de inicio para poder guardar la fecha de fin.';
export const END_DATE_NOT_AFTER =
  'La fecha de fin debe ser posterior a la de inicio.';
export const END_DATE_TOO_FAR = `Como máximo ${MAX_SPAN_DAYS} días entre inicio y fin.`;

/** The slot as the user sees it, from what is stored. */
export function storedToLocal(stored: StoredSlot, timeZone: string): LocalSlot {
  const local = instantsToSlot(stored.startsAt, stored.endsAt, timeZone);
  return {
    date: stored.localDate ?? local.date,
    endDate: stored.endDate,
    startTime: local.startTime,
    endTime: local.endTime,
  };
}

/** True when the input mentions any part of the slot. */
export function touchesSlot(input: SlotInput): boolean {
  return (
    input.date !== undefined ||
    input.endDate !== undefined ||
    input.startTime !== undefined ||
    input.endTime !== undefined
  );
}

/**
 * Merges an input with the current local slot (null when creating) and
 * converts it to instants in `timeZone`. Clearing the date clears the times
 * and the end date unless new ones are given, which is then an error: a time
 * or an end date needs its day. Moving the date of a multi-day record without
 * sending a new end date keeps the end date, so it must still be later.
 */
export function resolveSlot(
  input: SlotInput,
  current: LocalSlot | null,
  timeZone: string,
): SlotResult {
  const base: LocalSlot = current ?? {
    date: null,
    endDate: null,
    startTime: null,
    endTime: null,
  };
  const dateCleared = input.date === null;
  const pick = <K extends keyof LocalSlot>(key: K): LocalSlot[K] =>
    input[key] !== undefined
      ? (input[key] as LocalSlot[K])
      : dateCleared
        ? null
        : base[key];
  const date = input.date !== undefined ? input.date : base.date;
  const endDate = pick('endDate');
  const startTime = pick('startTime');
  const endTime = pick('endTime');

  const fields: Record<string, string> = {};
  if (!date && (startTime || endTime)) fields.date = TIME_WITHOUT_DATE;
  if (endDate) {
    if (!date) fields.endDate = END_DATE_WITHOUT_DATE;
    else if (endDate <= date) fields.endDate = END_DATE_NOT_AFTER;
    else if (daysBetween(date, endDate) > MAX_SPAN_DAYS) {
      fields.endDate = END_DATE_TOO_FAR;
    }
  }
  if (Object.keys(fields).length > 0) return {ok: false, fields};

  const {startsAt, endsAt} = slotToInstants(
    date,
    startTime,
    endTime,
    timeZone,
    endDate,
  );
  return {
    ok: true,
    slot: {
      localDate: date ?? null,
      endDate: endDate ?? null,
      startsAt,
      endsAt,
    },
  };
}

/** Equality for change detection: instants compare by time, whatever their text. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (/^\d{4}-\d{2}-\d{2}T/.test(a) && !Number.isNaN(ta) && ta === tb) {
      return true;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** Contract field names whose values differ, in the order of `names`. */
export function changedFields<S>(
  before: S,
  after: S,
  names: readonly (readonly [keyof S, string])[],
): string[] {
  return names
    .filter(([key]) => !sameValue(before[key], after[key]))
    .map(([, name]) => name);
}
