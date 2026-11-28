/**
 * Personal access rules shared by the server and the UI (Revisión 1 · E4):
 * password rules, profile limits, account-link lifetimes, support-session
 * bounds, e-mail masking and the short device label of a session. Pure.
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const DISPLAY_NAME_MAX = 80;
export const USERNAME_MAX = 80;
export const BIO_MAX = 280;
export const EMAIL_MAX = 254;
export const ACCENT_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** A password-reset link works once, for this long. */
export const RESET_LINK_MINUTES = 30;
/** An e-mail verification link works once, for this long. */
export const EMAIL_LINK_HOURS = 24;

export const SUPPORT_REASON_MIN = 10;
export const SUPPORT_REASON_MAX = 280;
export const SUPPORT_MINUTES_MIN = 5;
export const SUPPORT_MINUTES_MAX = 30;
export const VIEW_AS_GUEST_MINUTES = 30;

export type AccountLinkPurpose = 'reset' | 'verify';

const LINK_SEGMENT: Record<AccountLinkPurpose, string> = {
  reset: 'restablecer',
  verify: 'verificar',
};

/**
 * Address of an account link relative to the web's address, e.g.
 * `gestor-logistico/cuenta/restablecer#<token>` (the server prefixes
 * `${PUBLIC_APP_URL}/`). The token travels in the fragment, so it never
 * reaches a server, a proxy or a log.
 */
export function accountLinkHash(
  purpose: AccountLinkPurpose,
  token: string,
): string {
  return `gestor-logistico/cuenta/${LINK_SEGMENT[purpose]}#${token}`;
}

const ACCOUNT_LINK =
  /^\/?gestor-logistico\/cuenta\/(restablecer|verificar)\/?#([A-Za-z0-9_-]{43})$/;
/** The form mailed before 2026-11-28, still honoured. */
const LEGACY_ACCOUNT_LINK =
  /^#logistica\/cuenta\/(restablecer|verificar)\/([A-Za-z0-9_-]{43})$/;

/**
 * The purpose and token of an account link, or null. Reads the address and
 * fragment together (`/gestor-logistico/cuenta/verificar#<token>`) or a
 * legacy fragment alone (`#logistica/cuenta/verificar/<token>`).
 */
export function parseAccountLink(
  location: string,
): {purpose: AccountLinkPurpose; token: string} | null {
  const m = ACCOUNT_LINK.exec(location) ?? LEGACY_ACCOUNT_LINK.exec(location);
  if (!m) return null;
  return {
    purpose: m[1] === 'restablecer' ? 'reset' : 'verify',
    token: m[2] as string,
  };
}

/** Plain-Spanish problem with a new password, or null when it is acceptable. */
export function passwordProblem(
  password: string,
  username: string,
): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  }
  if (length > PASSWORD_MAX) {
    return `La contraseña puede tener como máximo ${PASSWORD_MAX} caracteres.`;
  }
  if (password.trim().toLowerCase() === username.trim().toLowerCase()) {
    return 'La contraseña no puede ser tu nombre de usuario.';
  }
  return null;
}

/** Loose shape check (one @, no spaces, a dot in the domain). */
export function isEmailAddress(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= EMAIL_MAX &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  );
}

/** «yeray@example.com» → «y•••@example.com»; never more than the first letter. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const first = [...email.slice(0, at)][0] ?? '';
  return `${first}•••${email.slice(at)}`;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\bWindows\b/, 'Windows'],
  [/\b(iPhone|iPod)\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * «Chrome · Windows» from a user agent, or null when nothing is recognised.
 * Only the browser family and the system are kept (no versions, no model).
 */
export function deviceLabel(
  userAgent: string | null | undefined,
): string | null {
  if (!userAgent) return null;
  const ua = userAgent.slice(0, 512);
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system;
}
