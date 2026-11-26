/**
 * The day's activity for «Cierre de jornada»: one `GET …/activity?from=&to=`
 * for the local day. Offline, or when the server cannot answer the range
 * (an older server replies 400), the report is built with `activity: null`
 * and says so; nothing is retried behind the user's back except when the
 * connection comes back or today's records change.
 */
import {useCallback, useEffect, useState} from 'react';
import type {
  ActivityEntry,
  LocalDate,
} from '../../../shared/logistics/contracts.ts';
import {dayBounds} from '../../../shared/logistics/day-report.ts';
import {ACTIVITY_RANGE_MAX} from '../../../shared/logistics/rules.ts';
import {isApiError} from '../api/client';
import {useLogisticsStore} from '../store/useLogisticsStore';

export type DayActivity =
  | {status: 'loading'; items: null; truncated: false}
  | {status: 'ready'; items: ActivityEntry[]; truncated: boolean}
  /** No coverage: built from the records' own dates. */
  | {status: 'offline'; items: null; truncated: false}
  /** The server did not answer the range: same fallback, with a retry. */
  | {status: 'failed'; items: null; truncated: false};

interface Loaded {
  key: string;
  value: DayActivity;
}

const LOADING: DayActivity = {status: 'loading', items: null, truncated: false};
const OFFLINE: DayActivity = {status: 'offline', items: null, truncated: false};
const FAILED: DayActivity = {status: 'failed', items: null, truncated: false};

/**
 * `refreshKey` changes when the records shown change (today only), so the
 * counts follow what the lines show; the previous answer stays on screen
 * while the new one loads.
 */
export function useDayActivity(
  date: LocalDate,
  timeZone: string,
  refreshKey: string,
): DayActivity & {retry: () => void} {
  const orgId = useLogisticsStore(s => s.orgId);
  const connection = useLogisticsStore(s => s.connection);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${orgId ?? ''}|${date}|${timeZone}`;
  const offline = connection === 'offline';

  useEffect(() => {
    const store = useLogisticsStore.getState();
    if (!orgId || offline || !store.session?.token) return;
    const controller = new AbortController();
    const {from, to} = dayBounds(date, timeZone);
    // Through the store, so a 401 expires the session the usual way and
    // reachability is tracked like any other call.
    store.loadDayActivity(from, to, controller.signal).then(
      items => {
        if (controller.signal.aborted) return;
        setLoaded({
          key,
          value: {
            status: 'ready',
            items,
            truncated: items.length >= ACTIVITY_RANGE_MAX,
          },
        });
      },
      err => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // An expired session already ended through the store; never read
        // it as «no history».
        if (isApiError(err) && err.code === 'UNAUTHENTICATED') return;
        // A background reload that fails keeps the day it already had.
        setLoaded(prev =>
          prev?.key === key && prev.value.status === 'ready'
            ? prev
            : {key, value: navigator.onLine === false ? OFFLINE : FAILED},
        );
      },
    );
    return () => controller.abort();
  }, [key, orgId, date, timeZone, offline, attempt, refreshKey]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt(n => n + 1);
  }, []);

  let value: DayActivity;
  if (offline) value = OFFLINE;
  else if (loaded?.key === key) value = loaded.value;
  else value = LOADING;
  return {...value, retry};
}
