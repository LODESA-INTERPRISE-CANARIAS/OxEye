# Gestor logístico at `/gestor-logistico` · clean addresses, step 2

- Slug: `gestor-logistico-ruta`
- Branch: `feat/gestor-logistico-ruta`
- Created from: `feat/portada-oxeye` at `bdc8e53` (needs the hub routing of step 1)
- Size: cross-cutting within one domain (Gestor front, shared link helpers, two server link builders, service worker, e2e). No data, schema, migration or API contract change. Root files touched: `index.html`, `playwright.config.ts` (listed below, approval of this plan covers them).

## Goal and intended experience

Every Gestor address loses the `#`, consistent with the hub: `oxeye…/gestor-logistico`, `/gestor-logistico/calendario/2026-12-02`, `/gestor-logistico/tareas/ficha/tarea/<id>`. Links can be shared, bookmarked and reopened as today; Back / Forward and the phone gesture behave exactly as now (spaces, days, open sheets, «¿Descartarlos?»). **Nothing already sent breaks**: every old `#logistica…` link (mails, supplier forms, installed app, bookmarks) still opens the same place and is rewritten to the new address.

## Addresses

| Today | New |
|---|---|
| `/#logistica` | `/gestor-logistico` |
| `/#logistica/<space>` | `/gestor-logistico/<space>` |
| `/#logistica/calendario/YYYY-MM-DD` | `/gestor-logistico/calendario/YYYY-MM-DD` |
| `/#logistica/cierre/YYYY-MM-DD` | `/gestor-logistico/cierre/YYYY-MM-DD` |
| `…/ficha/<tipo>/<id>` | same suffix on the path |
| `/#logistica/maquetas` (dev) | `/gestor-logistico/maquetas` |
| `/#logistica/cuenta/restablecer/<token>` | `/gestor-logistico/cuenta/restablecer#<token>` |
| `/#logistica/cuenta/verificar/<token>` | `/gestor-logistico/cuenta/verificar#<token>` |
| `/#logistica/proveedor/<token>` | `/gestor-logistico/proveedor#<token>` |
| `/#logistica/proveedor/abierto/<token>` | `/gestor-logistico/proveedor/abierto#<token>` |

**Secret tokens stay in the fragment (decision).** A fragment is never sent to a server, so it never lands in access logs of the pilot server, the Cloudflare tunnel or any proxy, nor in a `Referer`. Putting reset / verification / supplier tokens in the path would expose them there. Record ids (UUIDs, not secrets, and only readable with a session) go in the path. The app keeps stripping the token from the address as soon as it has read it, as today.

## Approach

1. **One address module, pure.** `src/logistics/shell/route.ts` becomes path-based: `parseRoute(pathname, hash)` / `routePath(route)`, relative to `import.meta.env.BASE_URL`, plus `legacyToPath(hash)` translating any `#logistica…` form to the new address (tokens → fragment). `spaces.ts`, `closing/day.ts` and the shared helpers (`shared/logistics/account.ts`, `proposals.ts`) build and read the new forms; old forms are still parsed for compatibility.
2. **History.** `historyNav.ts` keeps its model (entries `{lx, depth, index}`, sheets as entries, rewind on leaving, «¿Descartarlos?» puts the position back) and switches its writes to paths and its traversal detection to `popstate` only (no `hashchange` follows a path change). This is the delicate part: covered by the existing navigation e2e suites, run in full.
3. **Hub.** `hubRoute.ts` knows `/gestor-logistico/**` as the Gestor's (never canonicalised by the hub). `GameMenu` opens the Gestor on that prefix, «Gestor logístico» pushes `/gestor-logistico`, closing returns to `/`. Legacy `#logistica…` on load is rewritten with `replaceState` before anything renders. `main.tsx` detects supplier links on the new path (and the old hash).
4. **Server links.** `server/src/mail/links.ts` and `server/src/quotes/requests.ts` build `${base}/gestor-logistico/…#<token>` from the shared helpers. `offers/format.ts` `shareableUrl` follows. Server tests updated.
5. **Offline.** `public/oxeye-sw.js`: any same-scope navigation that is not an asset or the API is served as the app's page (network first, stored page when there is no coverage), so `/gestor-logistico/calendario` reopens offline; cache version bumped so devices take the new worker. `manifest.webmanifest` `start_url` → `../gestor-logistico`.
6. **Root files.** `index.html`: manifest and favicon links use `%BASE_URL%` (today `./…`, which does not resolve on nested paths). `playwright.config.ts`: a longer `expect` timeout so the Gestor's lazy chunk on a cold dev server stops making `entry-and-session` flaky (known since step 1).
7. **Servers must return the app for every path.** Vite dev and `vite preview` (`npm run equipo`) already do. `server/README.md` gets the rule for the pilot server (e.g. nginx `try_files $uri /index.html;`), and `scripts/equipo.mjs` prints the new address.
8. **E2E.** 343 references in 48 specs, mostly `goto('/#logistica…')` and URL assertions: replaced through one helper (`lxUrl('calendario')`) rather than by hand, plus a new `legacy-links.spec.ts`.

## Included improvements

- Legacy links keep working forever (mails already sent, installed phones, bookmarks), with the address rewritten to the clean form.
- Offline reopening works on any Gestor address, not only the root.
- Fixes the manifest/favicon relative links on nested paths (known limit of step 1).
- Ends the `entry-and-session` flakiness.

## Invariants

None of the domain invariants is touched (no emergency, subsoil, demand, Punto Violeta or persistence change). Privacy: tokens stay out of server-visible URLs (above); public supplier views keep showing only what they show today.

## Work packages

- AI Lead: address module contract (`route.ts` API, legacy table) + unit tests first; integration; log.
- `ui-engineer` (front owner): `historyNav.ts`, `spaces.ts`, `closing/day.ts`, `LogisticsApp.tsx`, account/supplier link capture, `main.tsx`, hub (`GameMenu`, `hubRoute`, `useHubRoute`), `offers/format.ts`.
- `backend-engineer`: shared helpers, server link builders, server tests, `server/README.md`, `scripts/equipo.mjs`.
- `qa-engineer`: e2e migration via helper, `legacy-links.spec.ts`, full Gestor suite serial and parallel, visual check of Gestor screens unchanged.
- `code-reviewer` on the diff (history and token handling first).

## Acceptance criteria

1. Every address in the table opens its screen directly, after reload and from a phone; Back / Forward through spaces, days and sheets behaves as on `feat/portada-oxeye` (same e2e assertions, only URLs changed).
2. Every legacy `#logistica…` form opens the same place and ends on the new address; account and supplier tokens are read and removed from the address; no token ever appears in a path.
3. Mails and supplier links generated by the server use the new form (server tests).
4. Production build (`npm run equipo` path): reload on `/gestor-logistico/calendario` works online and, after one visit, offline.
5. Full Gestor e2e suite green with parallel workers; hub and simulator suites unchanged.

## Verification

Baseline on `feat/portada-oxeye` first. `tsc` (front and `server/tsconfig.json`), lint, `npx vitest run` and `npx vitest run --root server`, `npm run build`, full `npm run test:e2e` (parallel and `--workers=1`), visual palettes. Offline check of the production build needs `npm run equipo` (user's run): I will give the exact steps.

## Allowed paths

- `src/logistics/**`
- `src/components/menu/**`
- `src/main.tsx`
- `shared/logistics/account.ts`
- `shared/logistics/proposals.ts`
- `server/src/mail/links.ts`
- `server/src/quotes/requests.ts`
- `server/src/config.ts`
- `server/tests/**`
- `server/README.md`
- `scripts/equipo.mjs`
- `public/oxeye-sw.js`
- `public/logistics/manifest.webmanifest`
- `index.html`
- `playwright.config.ts`
- `tests/e2e/**`
- `tests/unit/logistics/**`
- `tests/unit/hub/**`
- `doc/specs/2026-11-28-gestor-logistico-ruta.log.md`
