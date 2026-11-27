/**
 * Account links (Revisión 1 · E4): `#logistica/cuenta/restablecer/<token>`
 * and `#logistica/cuenta/verificar/<token>`, opened from an e-mail.
 *
 * The address is read once, when this module loads (before the Gestor's
 * router tidies the address up), and the token is then taken off the
 * address bar so it does not stay in the history. The link must work signed
 * out, before the login, and also inside an open session.
 */
import {
  parseAccountLink,
  type AccountLinkPurpose,
} from '../../../shared/logistics/account.ts';

export interface AccountLink {
  purpose: AccountLinkPurpose;
  token: string;
}

let pending: AccountLink | null = null;
const listeners = new Set<() => void>();

function capture(hash: string): boolean {
  const link = parseAccountLink(hash);
  if (!link) return false;
  pending = link;
  try {
    // Keep the user inside the Gestor, without the secret in the address.
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}#logistica`,
    );
  } catch {
    // Some embedded browsers refuse; the link still works.
  }
  return true;
}

function notify(): void {
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  capture(window.location.hash);
  // A link pasted into the address bar of an open Gestor. Capture phase, so
  // it runs before the router reads the new address. The sheet is shown
  // only after this `hashchange` has been handled: the history (historyNav)
  // closes what is open for a pasted link, and would close the link's own
  // sheet if it were already there.
  window.addEventListener(
    'hashchange',
    () => {
      if (capture(window.location.hash)) window.setTimeout(notify, 0);
    },
    {capture: true},
  );
}

/** The account link waiting to be handled, if any. */
export function pendingAccountLink(): AccountLink | null {
  return pending;
}

/** Done with it (handled or dismissed). */
export function clearAccountLink(): void {
  pending = null;
  for (const l of listeners) l();
}

export function subscribeAccountLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
