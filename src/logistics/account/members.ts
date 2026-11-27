/**
 * People of the open organization with their photo and accent
 * (`GET /organizations/:orgId/members`, Revisión 1 · E4), so a name looks
 * the same wherever it appears. Loaded once per session and organization,
 * shared by every avatar; a failure just leaves the initials.
 */
import {useEffect, useSyncExternalStore} from 'react';
import type {MemberProfile, Uuid} from '../../../shared/logistics/contracts.ts';
import {api} from '../api/endpoints';
import {useLogisticsStore} from '../store/useLogisticsStore';

interface Directory {
  key: string;
  byId: ReadonlyMap<Uuid, MemberProfile>;
  state: 'loading' | 'ready' | 'error';
}

const EMPTY: Directory = {key: '', byId: new Map(), state: 'loading'};
let current: Directory = EMPTY;
let pending: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Directory): void {
  current = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensure(token: string, orgId: string): void {
  const key = `${token}:${orgId}`;
  if (current.key === key || pending === key) return;
  pending = key;
  publish({key, byId: new Map(), state: 'loading'});
  api.members(token, orgId).then(
    res => {
      if (pending !== key) return;
      pending = null;
      publish({
        key,
        byId: new Map(res.items.map(m => [m.id, m])),
        state: 'ready',
      });
    },
    () => {
      if (pending !== key) return;
      pending = null;
      publish({key, byId: new Map(), state: 'error'});
    },
  );
}

/** Forget them (a profile changed: name, photo or accent). */
export function refreshMembers(): void {
  const {session, orgId} = useLogisticsStore.getState();
  current = EMPTY;
  pending = null;
  if (session && orgId) ensure(session.token, orgId);
}

/** The organization's people by id (empty while loading or for guests). */
export function useMembers(): Directory {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const guest = useLogisticsStore(s => s.session?.user.role === 'guest');
  const orgId = useLogisticsStore(s => s.orgId);
  const online = useLogisticsStore(s => s.phase === 'ready');
  useEffect(() => {
    if (token && orgId && online && !guest) ensure(token, orgId);
  }, [token, orgId, online, guest]);
  const dir = useSyncExternalStore(subscribe, () => current);
  return token && orgId && dir.key === `${token}:${orgId}` ? dir : EMPTY;
}

export function useMember(id: Uuid | null | undefined): MemberProfile | null {
  const dir = useMembers();
  return id ? (dir.byId.get(id) ?? null) : null;
}
