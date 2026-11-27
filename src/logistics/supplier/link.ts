/**
 * Supplier links (Revisión 1 · E7): `#logistica/proveedor/<token>` (one
 * company's personal form for one request) and
 * `#logistica/proveedor/abierto/<token>` (the open «presentar oferta» form,
 * only while an administrator keeps it on). Same pattern as account links
 * (`account/links.ts`):
 *
 * - the address is read once, when this module loads, before the Gestor's
 *   router tidies it up;
 * - the token is then taken off the address bar so it does not stay in the
 *   history or show over a shoulder;
 * - a copy stays in this tab's session storage, so a reload (or a dropped
 *   connection) brings the supplier back to the same form. It is cleared
 *   when the form is done or left.
 *
 * The form works signed out, before and instead of the login: a supplier
 * never sees the Gestor.
 */
import {parseSupplierLink} from '../../../shared/logistics/proposals.ts';

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
      const hash =
        v.kind === 'open'
          ? `#logistica/proveedor/abierto/${v.token}`
          : `#logistica/proveedor/${v.token}`;
      return parseSupplierLink(hash);
    }
  } catch {
    // A broken copy is simply ignored.
  }
  return null;
}

function capture(hash: string): boolean {
  const link = parseSupplierLink(hash);
  if (!link) return false;
  pending = link;
  remember(link);
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}#logistica`,
    );
  } catch {
    // Some embedded browsers refuse; the form still works.
  }
  notify();
  return true;
}

if (typeof window !== 'undefined') {
  // A reload of this tab: only while the address is still the Gestor's root
  // (the token was taken off it), never over another Gestor address.
  if (!capture(window.location.hash) && window.location.hash === '#logistica') {
    pending = remembered();
  }
  window.addEventListener('hashchange', () => capture(window.location.hash), {
    capture: true,
  });
}

/** The supplier link being shown, if any. */
export function pendingSupplierLink(): SupplierLink | null {
  return pending;
}

/** Done with it (sent, declined or left). */
export function clearSupplierLink(): void {
  pending = null;
  remember(null);
  notify();
}

export function subscribeSupplierLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
