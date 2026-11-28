import type {Page} from '@playwright/test';

/**
 * The Gestor logístico's addresses in e2e (plan `gestor-logistico-ruta`).
 * Since 2026-11-28 the Gestor lives on the path `/gestor-logistico/...`; secret
 * tokens (account and supplier links) stay in the fragment. The legacy
 * `#logistica...` forms are only used on purpose (see `legacy-links.spec.ts`).
 */

export const LX_ROOT = '/gestor-logistico';

/** `lxUrl()` -> `/gestor-logistico`, `lxUrl('calendario')` -> `/gestor-logistico/calendario`. */
export const lxUrl = (rest = ''): string => LX_ROOT + (rest ? `/${rest}` : '');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A `toHaveURL` matcher for a Gestor address: the path ends exactly there
 * (no trailing segment) and there is no fragment. The query string, if any, is
 * allowed.
 */
export const lxUrlRe = (rest = ''): RegExp =>
  new RegExp(`^[^#?]*?${escape(lxUrl(rest))}(\\?[^#]*)?$`);

/** The pathname on screen now. */
export const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** The fragment on screen now (`''` when there is none). */
export const hashOf = (page: Page): string => new URL(page.url()).hash;

/**
 * Moves to another Gestor address without reloading, as when the app itself
 * changes its address: push the entry and let the app react to `popstate`.
 * This replaces the old `location.hash = '#logistica/...'` steps.
 */
export async function goToAddress(page: Page, address: string): Promise<void> {
  await page.evaluate(to => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate', {state: null}));
  }, address);
}
