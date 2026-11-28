/**
 * Reads and writes the Gestor's address on `window.location` (see
 * `route.ts` for the address forms). The address is the path relative to the
 * build's base, with a leading slash: `/gestor-logistico/calendario`. The
 * fragment is not part of it; it only carries secret link tokens.
 */
import {
  isGestorAddress,
  isLegacyHash,
  legacyLocation,
  normalizeAddress,
} from './route';

/** The build's base with exactly one trailing slash (`/` or `/OxEye/`). */
function base(): string {
  const raw = (import.meta.env?.BASE_URL ?? '/').trim() || '/';
  const lead = raw.startsWith('/') ? raw : `/${raw}`;
  return lead.endsWith('/') ? lead : `${lead}/`;
}

/** The address of a pathname, or `/` when it is outside the base. */
export function addressOf(pathname: string): string {
  const root = base();
  if (`${pathname}/` === root) return '/';
  if (!pathname.startsWith(root)) return '/';
  return normalizeAddress(`/${pathname.slice(root.length)}`);
}

/** The address on screen now. */
export function currentAddress(): string {
  return addressOf(window.location.pathname);
}

/** True while the address is the Gestor's. */
export function inGestor(): boolean {
  return isGestorAddress(currentAddress());
}

/**
 * What the link parsers read (`parseAccountLink`, `parseSupplierLink`): the
 * address with its fragment (`/gestor-logistico/proveedor#<token>`), or a
 * legacy `#logistica…` fragment alone, whatever path it was opened on.
 */
export function linkLocation(): string {
  const {hash} = window.location;
  return isLegacyHash(hash) ? hash : `${currentAddress()}${hash}`;
}

/**
 * The URL of an address, keeping the query string. `hash` (a token) is
 * appended only when given: the Gestor's own addresses have no fragment.
 */
export function addressUrl(address: string, hash = ''): string {
  const root = base().replace(/\/$/, '');
  const path = address === '/' ? '/' : address;
  return `${root}${path}${window.location.search}${hash}`;
}

/**
 * Rewrites a legacy `#logistica…` address in place (mails, installed apps
 * and bookmarks made before 2026-11-28), keeping the history entry. Returns
 * true when it rewrote. Call it before anything reads the address.
 */
export function rewriteLegacyLocation(): boolean {
  const moved = legacyLocation(window.location.hash);
  if (!moved) return false;
  window.history.replaceState(
    window.history.state,
    '',
    addressUrl(moved.address, moved.hash),
  );
  return true;
}
