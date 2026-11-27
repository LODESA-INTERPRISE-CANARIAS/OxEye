/**
 * Shows stored photos (Revisión 1 · E3). `GET /media/:id` needs the session
 * token, so an `<img src>` cannot ask for it directly: the bytes are fetched
 * with the token once and shown through an object URL, kept for the session
 * (a photo never changes under its id). Signing out or changing user drops
 * every URL. A failed download is retried on the next view after a pause.
 */
import {useEffect, useState} from 'react';
import type {Uuid} from '../../../shared/logistics/contracts.ts';
import {api} from '../api/endpoints';
import {useLogisticsStore} from '../store/useLogisticsStore';

/** Wait before trying a failed photo again. */
const RETRY_AFTER_MS = 20_000;

interface Slot {
  url: string | null;
  pending: Promise<string> | null;
  failedAt: number | null;
}

const slots = new Map<Uuid, Slot>();
let owner: string | null = null;

function clearAll(): void {
  for (const slot of slots.values()) {
    if (slot.url) URL.revokeObjectURL(slot.url);
  }
  slots.clear();
}

/** Drops every cached photo (sign-out, another person on this device). */
export function forgetMediaCache(): void {
  clearAll();
  owner = null;
}

// Sign-out, expiry, another person or a support session: whenever the
// session token changes, every photo of the previous one goes. (Done here,
// not from the store, so the store does not import this module back.)
let sessionToken = useLogisticsStore.getState().session?.token ?? null;
useLogisticsStore.subscribe(s => {
  const next = s.session?.token ?? null;
  if (next === sessionToken) return;
  sessionToken = next;
  forgetMediaCache();
});

/** Drops one photo (it was removed). */
export function forgetMedia(id: Uuid): void {
  const slot = slots.get(id);
  if (slot?.url) URL.revokeObjectURL(slot.url);
  slots.delete(id);
}

function load(token: string, id: Uuid): Promise<string> {
  if (owner !== token) {
    clearAll();
    owner = token;
  }
  const slot = slots.get(id);
  if (slot?.url) return Promise.resolve(slot.url);
  if (slot?.pending) return slot.pending;
  const pending = api
    .mediaBlob(token, id)
    .then(blob => {
      const url = URL.createObjectURL(blob);
      // The session changed while downloading: do not keep it.
      if (owner !== token) {
        URL.revokeObjectURL(url);
        throw new Error('session changed');
      }
      slots.set(id, {url, pending: null, failedAt: null});
      return url;
    })
    .catch((err: unknown) => {
      if (owner === token) {
        slots.set(id, {url: null, pending: null, failedAt: Date.now()});
      }
      throw err;
    });
  slots.set(id, {url: null, pending, failedAt: null});
  return pending;
}

export type MediaSrcState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The object URL of photo `id` (null while loading, on error or when
 * `enabled` is false, e.g. a thumbnail still off screen).
 */
export function useMediaSrc(
  id: Uuid | null,
  enabled = true,
): {src: string | null; state: MediaSrcState} {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const cached =
    id && token && owner === token ? (slots.get(id)?.url ?? null) : null;
  const [loaded, setLoaded] = useState<{
    id: Uuid;
    src: string | null;
    state: MediaSrcState;
  } | null>(null);

  useEffect(() => {
    if (!id || !token || !enabled || cached) return;
    const slot = owner === token ? slots.get(id) : undefined;
    if (slot?.failedAt && Date.now() - slot.failedAt < RETRY_AFTER_MS) {
      setLoaded({id, src: null, state: 'error'});
      return;
    }
    let alive = true;
    setLoaded({id, src: null, state: 'loading'});
    load(token, id).then(
      src => alive && setLoaded({id, src, state: 'ready'}),
      () => alive && setLoaded({id, src: null, state: 'error'}),
    );
    return () => {
      alive = false;
    };
  }, [id, token, enabled, cached]);

  if (!id || !token) return {src: null, state: 'idle'};
  if (cached) return {src: cached, state: 'ready'};
  if (loaded && loaded.id === id) return {src: loaded.src, state: loaded.state};
  return {src: null, state: enabled ? 'loading' : 'idle'};
}
