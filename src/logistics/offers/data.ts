/**
 * Revisión 1 · E6–E7 data in the open session: offer versions, quote
 * requests, proposals, renewals and the renewal settings. They are read from
 * the server when a screen needs them and kept for the session (not in the
 * device cache: proposals and links are only useful online). Every screen
 * that shows the same list shares one copy, so a decision taken in a sheet
 * shows everywhere at once.
 */
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import type {
  ListResponse,
  OfferRenewal,
  OfferSettings,
  OfferVersion,
  Proposal,
  QuoteRequest,
} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {offersApi} from '../api/offers';
import {useLogisticsStore} from '../store/useLogisticsStore';

export type LoadState = 'loading' | 'ready' | 'error';

export interface Resource<T> {
  state: LoadState;
  data: T | null;
  error: string | null;
  /** The server does not have these routes yet (404 on the list). */
  unsupported: boolean;
}

interface Entry {
  value: Resource<unknown>;
  pending: Promise<void> | null;
  /** How to read it again («Actualizar», quiet reloads). */
  loader: (() => Promise<unknown>) | null;
  /** When the server last answered, to avoid asking twice in a row. */
  loadedAt: number;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const LOADING: Resource<unknown> = {
  state: 'loading',
  data: null,
  error: null,
  unsupported: false,
};

/** A quiet reload within this time of the last answer is skipped. */
const FRESH_MS = 4000;

function entryOf(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = {value: LOADING, pending: null, loader: null, loadedAt: 0};
    entries.set(key, entry);
  }
  return entry;
}

function notify(): void {
  for (const l of listeners) l();
}

function publish(key: string, value: Resource<unknown>): void {
  entryOf(key).value = value;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * - `quiet`: first read, or a reload that keeps what is on screen; skipped
 *   when the last answer is very recent, and a failure with data on screen
 *   changes nothing (the next trigger tries again).
 * - `force`: the user asked («Actualizar», «Reintentar»); errors show.
 */
function load<T>(
  key: string,
  loader: () => Promise<T>,
  mode: 'quiet' | 'force' = 'quiet',
): Promise<void> {
  const known = entries.get(key);
  if (known?.pending) return known.pending;
  if (
    mode === 'quiet' &&
    known &&
    known.value.state === 'ready' &&
    Date.now() - known.loadedAt < FRESH_MS
  ) {
    return Promise.resolve();
  }
  const entry = entryOf(key);
  entry.loader = loader;
  const previous = known?.value as Resource<T> | undefined;
  // A reload keeps what is on screen; only the first load shows skeletons.
  if (!previous || previous.data === null) publish(key, LOADING);
  const pending = loader().then(
    data => {
      // Signed out or another organization while reading: drop the answer.
      if (entries.get(key) !== entry) return;
      entry.pending = null;
      entry.loadedAt = Date.now();
      publish(key, {state: 'ready', data, error: null, unsupported: false});
    },
    err => {
      if (entries.get(key) !== entry) return;
      entry.pending = null;
      if (mode === 'quiet' && previous && previous.data !== null) {
        notify();
        return;
      }
      publish(key, {
        state: 'error',
        data: previous?.data ?? null,
        error: errorMessage(err),
        unsupported: isApiError(err) && err.status === 404,
      });
    },
  );
  entry.pending = pending;
  notify();
  return pending;
}

/** Forgets everything (sign-out, organization change). */
export function resetOffersData(): void {
  entries.clear();
  notify();
}

/**
 * «Actualizar»: reads again every list already read in the open session and
 * organization. Resolves when all have answered (or failed).
 */
export function refreshOffersData(): Promise<void> {
  const prefix = keyOf('');
  if (!prefix) return Promise.resolve();
  const jobs: Promise<void>[] = [];
  for (const [key, entry] of entries) {
    if (key.startsWith(prefix) && entry.loader) {
      jobs.push(load(key, entry.loader, 'force'));
    }
  }
  return Promise.all(jobs).then(() => undefined);
}

// Sign-out, expiry, another person or another organization: nothing of the
// previous one stays in memory. (Subscribed here, as media-cache does, so the
// store never imports this module back.)
let owner = sessionOwner(useLogisticsStore.getState());
useLogisticsStore.subscribe(s => {
  const next = sessionOwner(s);
  if (next === owner) return;
  owner = next;
  resetOffersData();
});

function sessionOwner(s: {
  session: {token: string} | null;
  orgId: string | null;
}): string {
  return `${s.session?.token ?? ''}:${s.orgId ?? ''}`;
}

/** Replaces a loaded list in place (after a write the server answered). */
function update<T>(key: string, change: (data: T) => T): void {
  const entry = entries.get(key);
  if (!entry || entry.value.data === null) return;
  publish(key, {...entry.value, data: change(entry.value.data as T)});
}

interface Session {
  token: string | null;
  orgId: string | null;
  online: boolean;
  member: boolean;
}

function useSession(): Session {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const member = useLogisticsStore(s => s.session?.user.role === 'member');
  const orgId = useLogisticsStore(s => s.orgId);
  const online = useLogisticsStore(s => s.phase === 'ready');
  return {token, orgId, online, member};
}

/**
 * One server list for the open organization. `enabled` false (no access)
 * never asks the server.
 */
function useResource<T>(
  name: string,
  loader: (token: string, orgId: string) => Promise<T>,
  enabled = true,
): Resource<T> & {reload: () => void; key: string} {
  const {token, orgId, online, member} = useSession();
  // Per session and organization: another sign-in never sees this copy.
  const key = token && orgId ? `${token}:${orgId}:${name}` : '';
  const active = !!key && enabled && member;
  // Read again, quietly, when the view opens, when the tab comes back into
  // view, and when another person's change or a sync came in: proposals and
  // link states change on the server without this device doing anything.
  const activity = useLogisticsStore(s => s.activity);
  const lastSyncAt = useLogisticsStore(s => s.lastSyncAt);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setShown(n => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active]);
  useEffect(() => {
    if (active && online && token && orgId) {
      void load(key, () => loader(token, orgId));
    }
    // `loader` is a stable module function per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, online, key, token, orgId, activity, lastSyncAt, shown]);
  const value = useSyncExternalStore(subscribe, () =>
    key ? entries.get(key)?.value : undefined,
  ) as Resource<T> | undefined;
  const reload = useCallback(() => {
    if (active && token && orgId) {
      void load(key, () => loader(token, orgId), 'force');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, token, orgId]);
  return {...((active && value) || (LOADING as Resource<T>)), reload, key};
}

const items = <T>(res: ListResponse<T>) => res.items;

export function useCurrentVersions(enabled = true) {
  return useResource(
    'versions',
    (t, o) => offersApi.currentVersions(t, o).then(items),
    enabled,
  ) as Resource<OfferVersion[]> & {reload: () => void; key: string};
}

export function useOfferVersions(offerId: string, enabled = true) {
  return useResource(
    `versions:${offerId}`,
    t => offersApi.offerVersions(t, offerId).then(items),
    enabled,
  ) as Resource<OfferVersion[]> & {reload: () => void; key: string};
}

export function useQuoteRequests(enabled = true) {
  return useResource(
    'requests',
    (t, o) => offersApi.quoteRequests(t, o).then(items),
    enabled,
  ) as Resource<QuoteRequest[]> & {reload: () => void; key: string};
}

export function useProposals(enabled = true) {
  return useResource(
    'proposals',
    (t, o) => offersApi.proposals(t, o).then(items),
    enabled,
  ) as Resource<Proposal[]> & {reload: () => void; key: string};
}

export function useRenewals(enabled = true) {
  return useResource(
    'renewals',
    (t, o) => offersApi.renewals(t, o).then(items),
    enabled,
  ) as Resource<OfferRenewal[]> & {reload: () => void; key: string};
}

export function useOfferSettings(enabled = true) {
  return useResource(
    'settings',
    (t, o) => offersApi.offerSettings(t, o),
    enabled,
  ) as Resource<OfferSettings> & {reload: () => void; key: string};
}

// ---------------------------------------------------------------- writes

/** The key of one list in the open organization (for in-place updates). */
function keyOf(name: string): string | null {
  const {session, orgId} = useLogisticsStore.getState();
  return session && orgId ? `${session.token}:${orgId}:${name}` : null;
}

const upsert =
  <T extends {id: string}>(record: T) =>
  (list: T[]): T[] =>
    list.some(r => r.id === record.id)
      ? list.map(r => (r.id === record.id ? record : r))
      : [record, ...list];

export function storeRequest(request: QuoteRequest): void {
  const key = keyOf('requests');
  if (key) update<QuoteRequest[]>(key, upsert(request));
}

export function storeProposal(proposal: Proposal): void {
  const key = keyOf('proposals');
  if (key) update<Proposal[]>(key, upsert(proposal));
}

export function storeRenewal(renewal: OfferRenewal): void {
  const key = keyOf('renewals');
  if (key) update<OfferRenewal[]>(key, upsert(renewal));
}

export function storeSettings(settings: OfferSettings): void {
  const key = keyOf('settings');
  if (key) {
    publish(key, {
      state: 'ready',
      data: settings,
      error: null,
      unsupported: false,
    });
  }
}

/** New versions approved: the current list and each offer's history. */
export function storeVersions(versions: OfferVersion[]): void {
  const key = keyOf('versions');
  if (key) {
    update<OfferVersion[]>(key, list => {
      const byOffer = new Map(list.map(v => [v.offerId, v]));
      for (const v of versions) byOffer.set(v.offerId, v);
      return [...byOffer.values()];
    });
  }
  // Histories are read again when opened (the previous one is superseded).
  for (const v of versions) {
    const k = keyOf(`versions:${v.offerId}`);
    if (k) entries.delete(k);
  }
  for (const l of listeners) l();
}

/** The session's token, for writes from event handlers. */
export function sessionToken(): string | null {
  return useLogisticsStore.getState().session?.token ?? null;
}

export function openOrgId(): string | null {
  return useLogisticsStore.getState().orgId;
}
