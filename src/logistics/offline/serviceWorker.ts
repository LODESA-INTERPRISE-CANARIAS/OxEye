/**
 * Registers `public/oxeye-sw.js` (M6) so OxEye reopens without coverage: the
 * page and its build files come from the device when the network fails. Only
 * in production builds (the dev server's modules are not cacheable files),
 * and only once the Gestor logístico opens. The API is never cached.
 */
let registered = false;

export function registerServiceWorker(): void {
  if (registered || !import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  registered = true;
  const base = import.meta.env.BASE_URL || '/';
  navigator.serviceWorker
    .register(`${base}oxeye-sw.js`, {scope: base})
    .catch(() => {
      // Not essential: without it the window still works online and keeps
      // its data on the device; only reopening a closed tab offline needs it.
      registered = false;
    });
}
