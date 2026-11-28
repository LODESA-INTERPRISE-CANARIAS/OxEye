# Gestor logístico at `/gestor-logistico` · execution log

## Baseline (`feat/portada-oxeye` at `bdc8e53`, Windows)

- Server: `npx tsc --noEmit -p server/tsconfig.json` exit 0; `npx vitest run --root server` 25 files, 407 tests, all passing.
- E2E full suite, parallel (`npx playwright test`): 624 tests; 440 passed first time, 182 flaky (passed on retry; the «N flaky» header was cut by `tail`, only the end of their list survived), 2 skipped, 0 failed (17.5 min). Flakiness = Gestor lazy chunk on a cold dev server vs the 5 s expect timeout.
- After (branch, before commit): 624 tests; 622 passed, 2 skipped, 0 failed, no flaky, 7.3 min (QA run, parallel), with `expect.timeout` 10 s.
- Front (from step 1): tsc 0, lint 0 errors / 2 known warnings, unit 58 files / 705 tests passing, build OK.

## Decisions

- Address model kept, root changed: an address is the path relative to the build's base with a leading slash (`/gestor-logistico/calendario`). `route.ts` stays pure string logic (`parseRoute`, `baseAddress` (was `baseHash`), `withSheet`, `stripSheet`); `parseRoute` also reads legacy `#logistica…` fragments. DOM reads and writes live in the new `shell/address.ts` (`currentAddress`, `addressUrl`, `rewriteLegacyLocation`).
- Legacy links: `legacyLocation(hash)` in `route.ts` translates any `#logistica…` to the new address; account and supplier tokens go to the new address's fragment, never the path.
- Shared link helpers keep their names (`accountLinkHash`, `supplierLinkHash`, `openOfferLinkHash`) and now return the relative new form (`gestor-logistico/proveedor#<token>`). The server composes `${base}/${…}` exactly as before, so `server/src/mail/links.ts`, `quotes/requests.ts` and `offer-terms/renewals.ts` (the latter outside this plan's paths) need no change. Parsers accept the new form and the legacy fragment.

- Server and docs (backend-engineer): composed URLs verified as `${base}/gestor-logistico/…#<token>` for account mails, quote requests and open-offer renewals; server tests assert the token appears only in the fragment. `server/README.md` documents the index.html fallback for the pilot server (nginx / Caddy) and the new addresses; `scripts/equipo.mjs` prints `/gestor-logistico`; the `PUBLIC_APP_URL` error message asks for the web's base without `/gestor-logistico` or `#`.
- Front (ui-engineer): `historyNav` writes paths and detects traversals by `popstate` only (the 80 ms wait for a following `hashchange` is gone; the 1500 ms timeout stays). `linkLocation()` added to `address.ts` for the link parsers. `shareableUrl(serverUrl, origin, base)` takes the build base instead of `location.pathname`. `closing/day.ts` helpers renamed to address names; dead hash helpers removed from `spaces.ts`.
- Calendar Back after two quick day changes lands on the month: not a regression, day changes within 800 ms fold into one entry, same as the hash version.
- Product decision (AI Lead): a legacy `#logistica…` or a `/gestor-logistico` popstate arriving while the simulation workspace is in use leaves the Gestor closed and puts the address back to `/simulador/modelo`, so address and screen agree. Consequence: that history entry becomes a second `/simulador/modelo` (one Back seems to do nothing). On a fresh load the legacy rewrite applies normally.
- Pasting a link with another path in an open tab now reloads the page (a path change), so tokens are captured at load as on a first open; fragment-only pastes still go through the listeners.
- Service worker v2: any same-scope navigation that is not the API, `assets/` or a file with an extension serves the app page (network first, stored page offline). `index.html` links favicon and manifest with absolute paths (Vite prefixes the base on build; checked with base `/`, not with `/OxEye/`). Manifest `start_url` → `../gestor-logistico`.
- `playwright.config.ts`: `expect.timeout` 10 s (lazy Gestor chunk on a cold dev server).
- Review fixes (code-reviewer): a malformed legacy token link (`#logistica/proveedor/<token>/`, `…<token>.`, `cuenta/restablecer/<token>x`) now opens the Gestor's root instead of putting its text in the path (it may still contain a valid token); `?`/`#` inside an old fragment are dropped. `historyNav` ends a traversal only on one of its own entries (a fragment pasted while leaving is no longer taken for the landing; `exit` always lands on the first entry, which `start()` stamps with `{lx}`). The service worker stores a navigation response as the offline page only when it is the app's page (`<div id="root">`), so a soft-404 or captive portal never replaces it.
- Accepted, not changed: `goToAddress` in e2e simulates an external address change with `pushState` + `popstate` (a real paste of another path reloads the page, covered by `page.goto` cases); a sub-path build (`/OxEye/`) has no index fallback on GitHub Pages (not a target).
- Left for a follow-up (outside the plan's paths, not in the extensible areas): `server/.env.example:66` comment still says «without #logistica» (cosmetic; suggested «the web's base, without /gestor-logistico or #»).

## Scope extensions
