/**
 * In-memory login throttling. Counts attempts per key (display name, client
 * IP) in a sliding window; once a key reaches its limit, further attempts are
 * refused until the oldest one leaves the window. State is per process, which
 * is enough for one API instance; it resets on restart.
 *
 * Callers record an attempt with `hit` before doing the slow check (scrypt),
 * so parallel requests cannot all pass `retryAfter` at once, and give it back
 * with `refund` when it turns out not to be a failure.
 */
export interface RateLimiter {
  /** Seconds to wait if the key is blocked, otherwise 0. */
  retryAfter(key: string): number;
  /** Records an attempt now; returns its timestamp for `refund`. */
  hit(key: string): number;
  /** Removes one attempt recorded by `hit` at `at`. */
  refund(key: string, at: number): void;
  /** Forgets every attempt for the key. */
  reset(key: string): void;
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now: () => number;
  /** Prune expired keys when the map grows past this size. */
  maxKeys?: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const failures = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;

  function recent(key: string, now: number): number[] {
    const list = failures.get(key);
    if (!list) return [];
    const kept = list.filter(t => now - t < options.windowMs);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== list.length) failures.set(key, kept);
    return kept;
  }

  function prune(now: number): void {
    for (const key of [...failures.keys()]) recent(key, now);
  }

  return {
    retryAfter(key) {
      const now = options.now();
      const list = recent(key, now);
      if (list.length < options.max) return 0;
      const oldest = list[list.length - options.max] as number;
      return Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
    },
    hit(key) {
      const now = options.now();
      if (failures.size >= maxKeys) prune(now);
      const list = recent(key, now);
      list.push(now);
      failures.set(key, list);
      return now;
    },
    refund(key, at) {
      const list = failures.get(key);
      if (!list) return;
      const i = list.lastIndexOf(at);
      if (i === -1) return;
      list.splice(i, 1);
      if (list.length === 0) failures.delete(key);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
