/**
 * Revisión 1 · E2: the acronym and daily opening hours that venues and
 * warehouses share. Opening hours are local wall-clock `time` columns, read
 * back as «HH:MM» so both drivers agree.
 */
import type {OpeningHours} from '../../../shared/logistics/contracts.ts';

export interface PlaceColumns {
  acronym: string | null;
  opens_at: string | null;
  closes_at: string | null;
}

/** Acronym and opening hours of table alias `t`. */
export function placeColumns(t: string): string {
  return `${t}.acronym, to_char(${t}.opens_at, 'HH24:MI') AS opens_at,
    to_char(${t}.closes_at, 'HH24:MI') AS closes_at`;
}

export function hoursOf(row: PlaceColumns): OpeningHours | null {
  return row.opens_at && row.closes_at
    ? {opensAt: row.opens_at, closesAt: row.closes_at}
    : null;
}

/** «08:00-20:00» or null, so two values compare by value in `changedFields`. */
export function hoursKey(hours: OpeningHours | null): string | null {
  return hours ? `${hours.opensAt}-${hours.closesAt}` : null;
}

export function hoursFromKey(key: string | null): OpeningHours | null {
  if (!key) return null;
  const [opensAt, closesAt] = key.split('-') as [string, string];
  return {opensAt, closesAt};
}
