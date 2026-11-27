/**
 * Where account links point. A link mailed after an anonymous request
 * (password recovery) is built only from a trusted address: PUBLIC_APP_URL
 * or an allowed CORS origin, never from a Host or Origin the caller chose
 * (otherwise anyone could have the server mail someone a link to another
 * site). A link for a signed-in request (verification of one's own e-mail,
 * an administrator's reset link) may use that request's Origin.
 */
import type {Config} from '../config.ts';
import {
  accountLinkHash,
  type AccountLinkPurpose,
} from '../../../shared/logistics/account.ts';

const ORIGIN_RE = /^https?:\/\/[^/\s]+$/;

/** PUBLIC_APP_URL, or the request Origin when it is an allowed CORS origin. */
export function trustedBase(
  config: Config,
  origin: string | undefined,
): string | null {
  if (config.mail.publicAppUrl) return config.mail.publicAppUrl;
  const o = origin?.replace(/\/+$/, '');
  return o && config.corsOrigins.includes(o) ? o : null;
}

/** As `trustedBase`, else any well-formed Origin (signed-in requests only). */
export function requestBase(
  config: Config,
  origin: string | undefined,
): string | null {
  const trusted = trustedBase(config, origin);
  if (trusted) return trusted;
  const o = origin?.replace(/\/+$/, '');
  return o && ORIGIN_RE.test(o) ? o : null;
}

export function accountUrl(
  base: string,
  purpose: AccountLinkPurpose,
  token: string,
): string {
  return `${base}/${accountLinkHash(purpose, token)}`;
}
