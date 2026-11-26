import {useCallback, useSyncExternalStore} from 'react';

/** Whether a CSS media query matches, following changes (rotation, resize). */
export function useMediaQuery(query: string): boolean {
  // Stable per query, so React does not resubscribe on every render.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia?.(query);
      mql?.addEventListener('change', onChange);
      return () => mql?.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
