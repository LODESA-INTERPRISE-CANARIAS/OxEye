/**
 * «Ver anteriores» in «Actividad reciente»: the store keeps the newest
 * entries; older ones are fetched a week at a time through the activity
 * range route (`from` ≤ at < `to`, at most ACTIVITY_RANGE_MAX_DAYS apart)
 * and shown a page at a time. Pure helpers, for the card and the tests.
 */
import type {ActivityEntry} from '../../../shared/logistics/contracts.ts';

/** Entries added to the list per «Ver anteriores». */
export const ACTIVITY_PAGE = 20;
/** One request covers a week (the route accepts up to eight days). */
export const ACTIVITY_WINDOW_DAYS = 7;
/** Empty weeks searched in one go before asking to go further back. */
export const ACTIVITY_EMPTY_WINDOWS = 4;

const DAY_MS = 24 * 3600_000;

/** One list, newest first, each entry once (the store and the pages overlap). */
export function mergeActivity(
  ...lists: readonly (readonly ActivityEntry[])[]
): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  for (const list of lists) {
    for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * The week that ends at `beforeMs` (inclusive: an entry at exactly that
 * instant comes back and is merged away, so equal timestamps are never lost).
 */
export function olderWindow(beforeMs: number): {
  from: string;
  to: string;
  /** Where the next window starts when this one is empty. */
  next: number;
} {
  const fromMs = beforeMs - ACTIVITY_WINDOW_DAYS * DAY_MS;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(beforeMs + 1).toISOString(),
    next: fromMs,
  };
}

/** Oldest instant of a list, in ms (NaN when empty). */
export function oldestAt(list: readonly ActivityEntry[]): number {
  let min = NaN;
  for (const e of list) {
    const t = Date.parse(e.at);
    if (!Number.isNaN(t) && !(t >= min)) min = t;
  }
  return min;
}
