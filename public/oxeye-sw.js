/*
 * OxEye service worker (Gestor logístico, M6 «Sin cobertura»).
 *
 * Its only job: OxEye opens again on a device without coverage. The data the
 * Gestor needs lives in its own IndexedDB copy; this worker only keeps the
 * page and its build files.
 *
 * - The app's page (the scope root or its index.html): network first, so a
 *   new version is picked up as soon as there is coverage. When the network
 *   fails, or takes longer than NAVIGATION_WAIT_MS (weak coverage on site),
 *   the last page that loaded opens; the request still finishes in the
 *   background and refreshes the stored page. Other navigations are left to
 *   the browser.
 * - Build files (hashed names under `assets/`): cache first; they never
 *   change under the same name. One versioned cache, bounded in size (the
 *   files the stored page links are never evicted); older caches are deleted
 *   when a new worker takes over.
 * - Never cached: API calls, anything cross-origin (fonts, map tiles, the
 *   API on another host), non-GET requests, partial responses.
 *
 * Registered from src/logistics/offline/serviceWorker.ts, production only.
 */
/* global self, caches, fetch, Request, Response, URL, setTimeout */
'use strict';

const VERSION = 'oxeye-sw-v1';
const PAGES = `${VERSION}:pages`;
const ASSETS = `${VERSION}:assets`;
/** Enough for the simulator and the Gestor chunks, without growing forever. */
const MAX_ASSETS = 160;
/** How long a navigation waits for the network before the stored page. */
const NAVIGATION_WAIT_MS = 3500;

const SCOPE = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE.pathname.endsWith('/')
  ? SCOPE.pathname
  : `${SCOPE.pathname}/`;
const INDEX_URL = new URL('./', SCOPE).href;
const ASSETS_PATH = `${SCOPE_PATH}assets/`;
/** Vite's content hash before the extension, e.g. `index-B2x9_aQ1.js`. */
const HASHED =
  /-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|png|jpe?g|svg|webp|avif|wasm|json)$/;

const OFFLINE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>OxEye</title><p style="font-family:system-ui;padding:24px">Sin conexión. OxEye aún no se había abierto en este dispositivo: ábrelo una vez con cobertura y después funcionará sin ella.</p>';

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then(cache => cache.add(new Request(INDEX_URL, {cache: 'reload'})))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(
              key => key.startsWith('oxeye-sw-') && !key.startsWith(VERSION),
            )
            .map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApi(url) {
  const path = url.pathname;
  return (
    path.startsWith(`${SCOPE_PATH}api/`) ||
    path.startsWith('/api/') ||
    path.includes('/organizations/') ||
    path.includes('/auth/')
  );
}

/** The app's own page: the scope root or its index.html (any query). */
function isAppIndex(url) {
  return (
    url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`
  );
}

function cacheable(response) {
  return (
    !!response &&
    response.ok &&
    response.status === 200 &&
    response.type === 'basic'
  );
}

function isHtml(response) {
  return (response.headers.get('content-type') || '').includes('text/html');
}

/** `origin + pathname` of the build files the stored page links. */
async function indexAssets() {
  const keep = new Set();
  try {
    const page = await (await caches.open(PAGES)).match(INDEX_URL);
    if (!page) return keep;
    const html = await page.text();
    for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
      try {
        const url = new URL(match[1], INDEX_URL);
        if (url.pathname.startsWith(ASSETS_PATH)) {
          keep.add(url.origin + url.pathname);
        }
      } catch {
        // Not a URL: nothing to keep.
      }
    }
  } catch {
    // No stored page to read: evict by age only.
  }
  return keep;
}

/** Evicts the oldest files beyond MAX_ASSETS, never those the page links. */
async function trim(cache) {
  const keys = await cache.keys();
  let extra = keys.length - MAX_ASSETS;
  if (extra <= 0) return;
  const keep = await indexAssets();
  for (const key of keys) {
    if (extra <= 0) break;
    const url = new URL(key.url);
    if (keep.has(url.origin + url.pathname)) continue;
    await cache.delete(key);
    extra--;
  }
}

/** One trim at a time: two at once would evict twice as much. */
let trimming = Promise.resolve();

function scheduleTrim(cache) {
  trimming = trimming.then(() => trim(cache)).catch(() => undefined);
  return trimming;
}

const wait = ms => new Promise(resolve => setTimeout(() => resolve(), ms));

async function storedIndex() {
  try {
    return (await (await caches.open(PAGES)).match(INDEX_URL)) || null;
  } catch {
    return null;
  }
}

function offlinePage() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: {'Content-Type': 'text/html; charset=utf-8'},
  });
}

function navigate(event) {
  const {request} = event;
  let storing = Promise.resolve();
  const network = fetch(request).then(response => {
    if (cacheable(response) && isHtml(response)) {
      // Cloned before the page reads the body.
      const copy = response.clone();
      storing = caches
        .open(PAGES)
        .then(cache => cache.put(INDEX_URL, copy))
        .catch(() => undefined);
    }
    return response;
  });
  // Keeps the worker alive until the page is stored, even after the stored
  // copy has already answered a slow navigation.
  event.waitUntil(network.then(() => storing).catch(() => undefined));

  return (async () => {
    const first = await Promise.race([
      network.then(
        response => response,
        () => 'failed',
      ),
      wait(NAVIGATION_WAIT_MS).then(() => 'slow'),
    ]);
    if (first !== 'failed' && first !== 'slow') return first;
    const cached = await storedIndex();
    if (cached) return cached;
    if (first === 'slow') {
      // Nothing stored yet: the network is the only way.
      try {
        return await network;
      } catch {
        // Falls through to the offline page.
      }
    }
    return offlinePage();
  })();
}

async function asset(event) {
  const {request} = event;
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    await cache.put(request, response.clone());
    event.waitUntil(scheduleTrim(cache));
  }
  return response;
}

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH) || isApi(url)) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    if (isAppIndex(url)) event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith(ASSETS_PATH) && HASHED.test(url.pathname)) {
    event.respondWith(asset(event));
  }
});
