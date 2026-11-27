/**
 * One event's budget, in memory only (Revisión 1 · E5): loading, error,
 * «Necesita conexión» and «Sin acceso» states, local updates after a write
 * and a quiet reload when the shared data may have changed.
 *
 * The store's pull reloads the activity feed whenever `…/changes` reports
 * anything (budget and expense changes included), and events and companies
 * when their names change: an open budget reloads quietly after any of
 * those, so another person's change shows without leaving the sheet.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  EventBudget,
  EventBudgetResponse,
  Expense,
} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {useAccess} from '../account/useAccess';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {BUDGET_OFFLINE, budgetApi, budgetOffline, isOfflineError} from './api';

export type BudgetLoad =
  | {status: 'loading'; data: EventBudgetResponse | null}
  | {status: 'ready'; data: EventBudgetResponse}
  | {status: 'offline'; data: EventBudgetResponse | null; message: string}
  | {status: 'forbidden'; data: null; message: string}
  | {status: 'error'; data: EventBudgetResponse | null; message: string};

export interface EventBudgetState {
  load: BudgetLoad;
  /** Ask again (Reintentar). */
  reload: () => void;
  /** After a write: the budget as the server answered. */
  putBudget: (budget: EventBudget) => void;
  /** After a create or an update: the expense as the server answered. */
  putExpense: (expense: Expense) => void;
  dropExpense: (id: string) => void;
}

/**
 * Copies of the same budget open at once: the event sheet's card and the
 * budget sheet, which has its own address. When a copy closes, the others
 * reload quietly if it wrote anything (`force`) or if they could not load,
 * so the card never shows a stale figure or an old error after the sheet.
 */
type Listener = (force: boolean) => void;
const copies = new Map<string, Set<Listener>>();

/** `enabled` false (no `budget.read`): nothing is asked, nothing is kept. */
export function useEventBudget(
  eventId: string,
  enabled = true,
): EventBudgetState {
  const {can, denial} = useAccess();
  const readable = enabled && can('budget.read');
  const [load, setLoad] = useState<BudgetLoad>({
    status: 'loading',
    data: null,
  });
  const [round, setRound] = useState(0);
  const quiet = useRef(false);
  const status = useRef<BudgetLoad['status']>('loading');
  const wrote = useRef(false);
  /** Writes applied locally so far; a load started before one is stale. */
  const writes = useRef(0);
  const [self] = useState<Listener>(() => force => {
    if (!force && status.current === 'ready') return;
    quiet.current = true;
    setRound(r => r + 1);
  });

  useEffect(() => {
    status.current = load.status;
  }, [load.status]);

  useEffect(() => {
    if (!readable || !eventId) return;
    const set = copies.get(eventId) ?? new Set<Listener>();
    copies.set(eventId, set);
    set.add(self);
    return () => {
      set.delete(self);
      if (set.size === 0) copies.delete(eventId);
      for (const other of set) other(wrote.current);
    };
  }, [eventId, readable, self]);
  const connection = useLogisticsStore(s => s.connection);
  const fromCache = useLogisticsStore(s => s.fromCache);
  const activity = useLogisticsStore(s => s.activity);
  const events = useLogisticsStore(s => s.events);
  const companies = useLogisticsStore(s => s.companies);

  useEffect(() => {
    if (!readable) {
      const d = denial('budget.read');
      setLoad({
        status: 'forbidden',
        data: null,
        message: d?.message ?? '',
      });
      return;
    }
    let alive = true;
    const silent = quiet.current;
    quiet.current = false;
    if (budgetOffline()) {
      setLoad(s => ({
        status: 'offline',
        data: s.data,
        message: BUDGET_OFFLINE,
      }));
      return;
    }
    if (!silent) setLoad(s => ({status: 'loading', data: s.data}));
    // A write applied while this request was in flight is newer than its
    // answer: the answer is dropped and a quiet reload asks again.
    const startedAt = writes.current;
    const stale = () => {
      if (writes.current === startedAt) return false;
      quiet.current = true;
      setRound(r => r + 1);
      return true;
    };
    budgetApi.get(eventId).then(
      data => {
        if (!alive || stale()) return;
        setLoad({status: 'ready', data});
      },
      (err: unknown) => {
        if (!alive || stale()) return;
        if (isOfflineError(err)) {
          setLoad(s => ({
            status: 'offline',
            data: s.data,
            message: BUDGET_OFFLINE,
          }));
        } else if (isApiError(err) && err.code === 'FORBIDDEN') {
          setLoad({status: 'forbidden', data: null, message: err.message});
        } else if (silent) {
          // A quiet reload that failed keeps what is on screen.
          setLoad(s =>
            s.data ? {status: 'ready', data: s.data} : (s as BudgetLoad),
          );
        } else {
          setLoad(s => ({
            status: 'error',
            data: s.data,
            message: errorMessage(err),
          }));
        }
      },
    );
    return () => {
      alive = false;
    };
    // `denial` changes identity with the access view, as `readable` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, readable, round]);

  // Back online, or another person's change came in: reload quietly.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!readable || connection !== 'online' || fromCache) return;
    quiet.current = true;
    setRound(r => r + 1);
  }, [activity, events, companies, connection, fromCache, readable]);

  const reload = useCallback(() => setRound(r => r + 1), []);
  const putBudget = useCallback((budget: EventBudget) => {
    wrote.current = true;
    writes.current += 1;
    setLoad(s => (s.data ? {status: 'ready', data: {...s.data, budget}} : s));
  }, []);
  const putExpense = useCallback((expense: Expense) => {
    wrote.current = true;
    writes.current += 1;
    setLoad(s => {
      if (!s.data) return s;
      const list = s.data.expenses;
      const at = list.findIndex(x => x.id === expense.id);
      const expenses =
        at < 0
          ? [...list, expense]
          : list.map((x, i) => (i === at ? expense : x));
      return {status: 'ready', data: {...s.data, expenses}};
    });
  }, []);
  const dropExpense = useCallback((id: string) => {
    wrote.current = true;
    writes.current += 1;
    setLoad(s =>
      s.data
        ? {
            status: 'ready',
            data: {
              ...s.data,
              expenses: s.data.expenses.filter(x => x.id !== id),
            },
          }
        : s,
    );
  }, []);
  return {load, reload, putBudget, putExpense, dropExpense};
}
