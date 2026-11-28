/**
 * Account links (Revisión 1 · E4): `/gestor-logistico/cuenta/restablecer#<token>`
 * and `/gestor-logistico/cuenta/verificar#<token>`, opened from an e-mail
 * (mails sent before 2026-11-28 carry `#logistica/cuenta/…/<token>`, still
 * read). The token stays in the fragment: it never reaches a server log.
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
import {addressUrl, linkLocation} from '../shell/address';
import {ROOT_ADDRESS} from '../shell/route';

export interface AccountLink {
  purpose: AccountLinkPurpose;
  token: string;
}

let pending: AccountLink | null = null;
const listeners = new Set<() => void>();

function capture(): boolean {
  const link = parseAccountLink(linkLocation());
  if (!link) return false;
  pending = link;
  try {
    // Keep the user inside the Gestor, without the secret in the address.
    window.history.replaceState(
      window.history.state,
      '',
      addressUrl(ROOT_ADDRESS),
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
  capture();
  // A link pasted into the address bar of an open page that only changes
  // the fragment (a different path loads the page again, and is read
  // above). Capture phase, so it runs before the hub and the router read
  // the new address; `popstate` comes first, `hashchange` is kept for
  // browsers that fire only that one. The sheet is shown only after the
  // event has been handled: the history (historyNav) closes what is open
  // for a pasted link, and would close the link's own sheet if it were
  // already there.
  const onPasted = () => {
    if (capture()) window.setTimeout(notify, 0);
  };
  window.addEventListener('popstate', onPasted, {capture: true});
  window.addEventListener('hashchange', onPasted, {capture: true});
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
