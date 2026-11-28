import {useCallback, useEffect, useState} from 'react';
import {rewriteLegacyLocation} from '../../logistics/shell/address';
import {hubPath, isCanonical, parseHubPath, type HubRoute} from './hubRoute';

const BASE = import.meta.env?.BASE_URL ?? '/';

/** History entries written by the hub carry this marker. */
const HUB_STATE = {hub: 1} as const;

function current(): HubRoute {
  return parseHubPath(window.location.pathname, BASE).route;
}

export interface HubNavigation {
  route: HubRoute;
  /** Goes to a hub screen; `replace` rewrites the entry instead of pushing. */
  navigate: (route: HubRoute, options?: {replace?: boolean}) => void;
}

/**
 * The hub's address. Pushes a history entry per screen so Back / Forward and
 * the phone's back gesture move between them, and puts unknown or
 * non-canonical paths right with `replaceState` (no error page).
 *
 * It reads only the pathname: every Gestor address (`/gestor-logistico/**`,
 * written by its own `historyNav`) is the `logistics` route and is never
 * rewritten here, and hub navigation drops the hash only when it moves to
 * another screen. A legacy `#logistica…` fragment typed or pasted over the
 * hub is rewritten to its clean address first (`main.tsx` does the same on
 * load).
 */
export function useHubRoute(): HubNavigation {
  const [route, setRoute] = useState<HubRoute>(current);

  useEffect(() => {
    const {pathname, search, hash} = window.location;
    if (!isCanonical(pathname, BASE)) {
      window.history.replaceState(
        window.history.state,
        '',
        `${hubPath(current(), BASE)}${search}${hash}`,
      );
    }
    const onPop = () => {
      rewriteLegacyLocation();
      setRoute(current());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (next: HubRoute, {replace = false}: {replace?: boolean} = {}) => {
      const url = `${hubPath(next, BASE)}${window.location.search}`;
      const sameEntry =
        `${window.location.pathname}${window.location.search}` === url &&
        !window.location.hash;
      if (!sameEntry) {
        if (replace) window.history.replaceState(HUB_STATE, '', url);
        else window.history.pushState(HUB_STATE, '', url);
      }
      setRoute(next);
    },
    [],
  );

  return {route, navigate};
}
