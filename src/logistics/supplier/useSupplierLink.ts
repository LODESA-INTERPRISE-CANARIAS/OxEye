/**
 * The supplier link of this page, if the Gestor was opened from one. The
 * Gestor renders the supplier form instead of everything else while it is
 * set (see `supplier/link.ts`).
 */
import {useSyncExternalStore} from 'react';
import {
  pendingSupplierLink,
  subscribeSupplierLink,
  type SupplierLink,
} from './link';

export function useSupplierLink(): SupplierLink | null {
  return useSyncExternalStore(subscribeSupplierLink, pendingSupplierLink);
}
