/**
 * Supplier links (Revisión 1 · E7): `/gestor-logistico/proveedor#<token>`
 * (one company's personal form for one request) and
 * `/gestor-logistico/proveedor/abierto#<token>` (the open «presentar oferta»
 * form, only while an administrator keeps it on); links sent before
 * 2026-11-28 carry `#logistica/proveedor/[abierto/]<token>` and are still
 * read. Same pattern as account links
 * (`account/links.ts`):
 *
 * - the address is read once, when this module loads, before the Gestor's
 *   router tidies it up;
 * - the token is then taken off the address bar so it does not stay in the
 *   history or show over a shoulder;
 * - a copy stays in this tab's session storage, so a reload (or a dropped
 *   connection) brings the supplier back to the same form. It is cleared
 *   when the form is done or left, or reaches an end (gone, declined,
 *   already answered, too many attempts).
 *
 * The form works signed out, before and instead of the login: a supplier
 * never sees the Gestor.
 */
import {
  openOfferLinkHash,
  parseSupplierLink,
  supplierLinkHash,
} from '../../../shared/logistics/proposals.ts';
import {addressUrl, currentAddress, linkLocation} from '../shell/address';
import {LEGACY_ROOT, ROOT_ADDRESS} from '../shell/route';

export interface SupplierLink {
  kind: 'request' | 'open';
  token: string;
}

const TAB_KEY = 'oxeye.logistics.supplier.v1';

let pending: SupplierLink | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function remember(link: SupplierLink | null): void {
  try {
    if (link) sessionStorage.setItem(TAB_KEY, JSON.stringify(link));
    else sessionStorage.removeItem(TAB_KEY);
  } catch {
    // Storage may be unavailable (private mode): the link lasts the page.
  }
}

function remembered(): SupplierLink | null {
  try {
    const raw = sessionStorage.getItem(TAB_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SupplierLink>;
    if (
      (v.kind === 'request' || v.kind === 'open') &&
      typeof v.token === 'string'
    ) {
      // Parsed again, so a broken or foreign token is never trusted.
      const link =
        v.kind === 'open'
          ? openOfferLinkHash(v.token)
          : supplierLinkHash(v.token);
      return parseSupplierLink(link);
    }
  } catch {
    // A broken copy is simply ignored.
  }
  return null;
}

function capture(): boolean {
  const link = parseSupplierLink(linkLocation());
  if (!link) return false;
  pending = link;
  remember(link);
  try {
    window.history.replaceState(
      window.history.state,
      '',
      addressUrl(ROOT_ADDRESS),
    );
  } catch {
    // Some embedded browsers refuse; the form still works.
  }
  notify();
  return true;
}

/** The answers a supplier typed and has not sent yet (SupplierApp). */
export const SUPPLIER_DRAFT_KEY = 'oxeye.logistics.supplier.draft.v1';

function hasDraft(token: string): boolean {
  try {
    const raw = sessionStorage.getItem(SUPPLIER_DRAFT_KEY);
    return !!raw && (JSON.parse(raw) as {token?: string}).token === token;
  } catch {
    return false;
  }
}

function isReload(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    return nav?.type === 'reload';
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  // The copy in this tab brings the form back only on a real reload, or
  // while there are answers not yet sent; and only on the Gestor's root
  // address (where the token was taken off). Opening OxEye again in this
  // tab otherwise opens OxEye, never a form that was already finished.
  // This module loads before `main.tsx` rewrites a legacy address, so the
  // root is recognised in both forms.
  const atRoot =
    currentAddress() === ROOT_ADDRESS || window.location.hash === LEGACY_ROOT;
  if (!capture() && atRoot) {
    const copy = remembered();
    if (copy && (isReload() || hasDraft(copy.token))) pending = copy;
    else if (copy) remember(null);
  }
  // A supplier link pasted into a tab where OxEye is already open and that
  // changes only the fragment (another path loads the page anyway): start
  // the page again so only the supplier's form is mounted (main.tsx), never
  // on top of the hub, the map or the Gestor. `popstate` comes first;
  // `hashchange` is kept for browsers that fire only that one.
  const onPasted = () => {
    if (capture()) window.location.reload();
  };
  window.addEventListener('popstate', onPasted, {capture: true});
  window.addEventListener('hashchange', onPasted, {capture: true});
}

/** The supplier link being shown, if any. */
export function pendingSupplierLink(): SupplierLink | null {
  return pending;
}

/** Done with it (sent, declined or left): the page leaves the form. */
export function clearSupplierLink(): void {
  pending = null;
  remember(null);
  notify();
}

/**
 * The form reached an end it cannot leave (link gone, declined, already
 * answered, paused for too many attempts): the page keeps showing that end,
 * but this tab no longer comes back to it on its own.
 */
export function releaseSupplierLink(): void {
  remember(null);
}

/** The form opened again (after a pause): a reload brings it back again. */
export function keepSupplierLink(link: SupplierLink): void {
  if (pending?.token === link.token) remember(link);
}

export function subscribeSupplierLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
