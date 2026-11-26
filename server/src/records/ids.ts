/**
 * Lists of record identifiers sent by clients (predecessors, categories,
 * events): parsed from JSON columns and normalised so lists compare reliably.
 */
import type {Uuid} from '../../../shared/logistics/contracts.ts';

/** Lower-case, de-duplicated and sorted, so lists compare reliably. */
export function normalizeIds(ids: readonly string[]): Uuid[] {
  return [...new Set(ids.map(id => id.toLowerCase()))].sort();
}

/** A jsonb array of ids from either driver (parsed or as text), normalised. */
export function parseIds(value: unknown): Uuid[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list) ? normalizeIds(list.map(String)) : [];
}

/** Sort comparator by id, for a stable order of side-effect rows and logs. */
export function byId(a: {id: string}, b: {id: string}): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A jsonb array of ids keeping the order the query gave (e.g. category order). */
export function parseOrderedIds(value: unknown): Uuid[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list) ? list.map(v => String(v).toLowerCase()) : [];
}
