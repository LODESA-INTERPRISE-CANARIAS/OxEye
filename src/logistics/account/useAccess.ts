/**
 * The viewer's access in the open organization (Revisión 1 · E4), for any
 * screen that hides or locks what the viewer lacks.
 */
import {useMemo} from 'react';
import type {Permission} from '../../../shared/logistics/contracts.ts';
import {can} from '../../../shared/logistics/permissions.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {accessView, denial, type AccessView, type Denial} from './access';

export interface Access extends AccessView {
  can: (permission: Permission) => boolean;
  /** Why it is missing, or null when the viewer has it. */
  denial: (permission: Permission) => Denial | null;
}

export function useAccess(): Access {
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const organizations = useLogisticsStore(s => s.organizations);
  const orgId = useLogisticsStore(s => s.orgId);
  return useMemo(() => {
    const org = organizations.find(o => o.id === orgId) ?? null;
    const view = accessView(user, org, organizations);
    return {
      ...view,
      can: p => can(view.permissions, p),
      denial: p => denial(view, p),
    };
  }, [user, organizations, orgId]);
}

/** Shortcut for one permission. */
export function useCan(permission: Permission): boolean {
  return useAccess().can(permission);
}
