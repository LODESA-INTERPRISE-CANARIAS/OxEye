/**
 * Clean addresses of the OxEye hub (no `#`). Pure: no React, no DOM.
 *
 *   /                    Portada
 *   /simulador           Simulador (continue, load, new model, save and exit)
 *   /simulador/nuevo     new-model wizard
 *   /simulador/modelo    the simulation workspace is open (menu hidden)
 *   /ajustes             Ajustes
 *   /acerca              Acerca de OxEye
 *
 * Paths are relative to the build's base (`import.meta.env.BASE_URL`), so a
 * build served under a sub-folder keeps working at its root. The hash is not
 * part of a hub address.
 *
 *   /gestor-logistico/** the Gestor logístico is open over the hub
 *
 * Everything under `/gestor-logistico` belongs to the Gestor (its own
 * addresses: `src/logistics/shell/route.ts`): the hub knows it as one route
 * and never rewrites it.
 */

export type HubRoute =
  | 'home'
  | 'simulator'
  | 'new-model'
  | 'workspace'
  | 'settings'
  | 'about'
  | 'logistics';

/** First path segment of every Gestor address (exact case). */
const LOGISTICS_SEGMENT = 'gestor-logistico';

const PATH_OF: Record<HubRoute, string> = {
  home: '',
  simulator: 'simulador',
  'new-model': 'simulador/nuevo',
  workspace: 'simulador/modelo',
  settings: 'ajustes',
  about: 'acerca',
  logistics: LOGISTICS_SEGMENT,
};

// The hub's own screens, read leniently; the Gestor's prefix is matched
// exactly in `parseHubPath`.
const ROUTE_OF = new Map<string, HubRoute>(
  (Object.entries(PATH_OF) as [HubRoute, string][])
    .filter(([r]) => r !== 'logistics')
    .map(([r, p]) => [p, r]),
);

/** `/OxEye` or `/OxEye/` → `/OxEye/`; empty → `/`. */
export function normalizeBase(base: string | undefined): string {
  const b = (base || '/').trim();
  const withLead = b.startsWith('/') ? b : `/${b}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

export interface ParsedHubPath {
  route: HubRoute;
  /** False when the path is not a hub address (it falls back to `home`). */
  known: boolean;
}

/**
 * Reads a pathname. Trailing slashes, repeated slashes, `index.html`, case and
 * percent-encoding are tolerated; anything else outside the table is unknown.
 */
export function parseHubPath(pathname: string, base?: string): ParsedHubPath {
  const root = normalizeBase(base);
  let path = pathname || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  // The base itself without its trailing slash (`/OxEye`) is the root too.
  if (`${path}/` === root) path = root;
  if (!path.startsWith(root)) return {route: 'home', known: false};
  let rest = path.slice(root.length);
  // The Gestor's addresses, as they are: its ids are case-sensitive and its
  // own router reads them.
  if (rest.split('/').find(Boolean) === LOGISTICS_SEGMENT) {
    return {route: 'logistics', known: true};
  }
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return {route: 'home', known: false};
  }
  rest = rest
    .split('/')
    .filter(Boolean)
    .join('/')
    .toLowerCase()
    .replace(/(^|\/)index\.html$/, '');
  const route = ROUTE_OF.get(rest);
  return route ? {route, known: true} : {route: 'home', known: false};
}

/** The canonical pathname of a route under the base. */
export function hubPath(route: HubRoute, base?: string): string {
  return `${normalizeBase(base)}${PATH_OF[route]}`;
}

/** True when the path is a hub address in its exact form (`/ajustes`, not `/ajustes/`). */
export function isCanonical(pathname: string, base?: string): boolean {
  const {route, known} = parseHubPath(pathname, base);
  // The Gestor puts its own addresses right (`historyNav`).
  if (route === 'logistics') return true;
  return known && pathname === hubPath(route, base);
}
