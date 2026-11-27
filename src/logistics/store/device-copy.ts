/**
 * What of the Gestor's lists may rest on the device (IndexedDB), as a pure
 * function so it can be tested without a browser:
 * - every record goes through the same withholding as the API's
 *   (`withholdFor`), with the viewer's role *and* directory access, so a
 *   member without `directory.read` keeps exactly what the server sends it;
 * - budget and expense entries of the activity feed never rest on the
 *   device, whoever holds `budget.read`: they stay in memory only. They are
 *   dropped again when a copy is read, in case an older version stored them.
 */
import type {Role} from '../../../shared/logistics/contracts.ts';
import {
  BUDGET_ENTITY_TYPES,
  withholdFor,
  type WithheldKind,
} from '../../../shared/logistics/redaction.ts';
import type {SyncList} from '../../../shared/logistics/sync.ts';

/** Lists whose records carry fields withheld from some viewers. */
export const WITHHELD_KIND: Partial<Record<SyncList, WithheldKind>> = {
  events: 'event',
  tasks: 'task',
  contacts: 'contact',
  companies: 'company',
  offers: 'offer',
  warehouses: 'warehouse',
  resources: 'resource',
  notes: 'note',
  hypotheses: 'hypothesis',
  acceptances: 'acceptance',
};

const BUDGET_TYPES: readonly string[] = BUDGET_ENTITY_TYPES;

/** Activity entries without the budget's (device copy only). */
export function withoutBudgetActivity<T>(items: readonly T[]): T[] {
  return items.filter(item => {
    const type = (item as {entityType?: unknown} | null)?.entityType;
    return !(typeof type === 'string' && BUDGET_TYPES.includes(type));
  });
}

/** A list as it may be saved on the device. */
export function forDevice<T extends object>(
  list: SyncList,
  items: readonly T[],
  role: Role,
  directory: boolean,
): object[] {
  if (list === 'activity') return withoutBudgetActivity(items);
  const kind = WITHHELD_KIND[list];
  return kind
    ? items.map(r => withholdFor(kind, r, role, directory))
    : [...items];
}

/** A list as read back from the device (older copies may hold more). */
export function fromDevice<T>(list: SyncList, items: readonly T[]): T[] {
  return list === 'activity' ? withoutBudgetActivity(items) : [...items];
}
