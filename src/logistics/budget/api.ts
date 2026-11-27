/**
 * Budget calls (Revisión 1 · E5). Straight to the server and never through
 * the store, the device copy or the outbox: budget data is not kept on the
 * device and a budget write never waits for coverage («Necesita conexión»).
 *
 * The token comes from the store's session; a 401 asks the store to pull,
 * which expires the session the usual way (rescue, login screen).
 */
import type {
  BudgetSummary,
  EventBudget,
  EventBudgetInput,
  EventBudgetResponse,
  Expense,
  ExpenseInput,
  ListResponse,
} from '../../../shared/logistics/contracts.ts';
import {ApiError, apiRequest, isApiError} from '../api/client';
import {NEEDS_CONNECTION, useLogisticsStore} from '../store/useLogisticsStore';

/** Shown instead of the budget while there is no connection. */
export const BUDGET_OFFLINE =
  'El presupuesto no se guarda en este dispositivo: se consulta y se cambia con conexión.';

/** True when a call cannot reach the server right now. */
export function budgetOffline(): boolean {
  const s = useLogisticsStore.getState();
  const online = typeof navigator === 'undefined' || navigator.onLine;
  return !online || s.connection === 'offline' || s.fromCache;
}

/** True for an error that means «no connection», not «the server said no». */
export function isOfflineError(err: unknown): boolean {
  return isApiError(err) && err.isUnavailable;
}

async function call<T>(
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (budgetOffline()) {
    throw new ApiError({
      code: 'UNAVAILABLE',
      status: 0,
      message: NEEDS_CONNECTION,
    });
  }
  const token = useLogisticsStore.getState().session?.token ?? null;
  try {
    return await apiRequest<T>(method, path, {body, token});
  } catch (err) {
    // The store owns the session: let it find out and expire it.
    if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
      void useLogisticsStore.getState().pull();
    }
    throw err;
  }
}

export const budgetApi = {
  get: (eventId: string) =>
    call<EventBudgetResponse>(
      'GET',
      `/events/${encodeURIComponent(eventId)}/budget`,
    ),
  set: (eventId: string, input: EventBudgetInput) =>
    call<EventBudget>(
      'PUT',
      `/events/${encodeURIComponent(eventId)}/budget`,
      input,
    ),
  list: (orgId: string) =>
    call<ListResponse<BudgetSummary>>(
      'GET',
      `/organizations/${encodeURIComponent(orgId)}/budgets`,
    ),
  createExpense: (input: ExpenseInput) =>
    call<Expense>('POST', '/expenses', input),
  updateExpense: (id: string, input: ExpenseInput) =>
    call<Expense>('PATCH', `/expenses/${encodeURIComponent(id)}`, input),
  deleteExpense: (id: string, version: number) =>
    call<void>(
      'DELETE',
      `/expenses/${encodeURIComponent(id)}?version=${version}`,
    ),
};
