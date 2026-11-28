# Portada OxEye · new hub with clean routes

- Slug: `portada-oxeye`
- Branch: `feat/portada-oxeye`
- Created from: `feat/gestor-logistico` at `dc05874`
- Size: feature in one domain (the hub, `src/components/menu/`), UI only. No data, API, persistence format or domain invariant is touched. Step 1 of 2: step 2 (the Gestor moves from `#logistica` to `/gestor-logistico`) is a separate plan on its own branch.

## Goal and intended experience

The first screen presents OxEye as a product, with the Gestor logístico's visual language instead of the old simulation style, and with the Gestor as the main way in. Every hub screen has its own clean address (no `#`), so it can be linked, bookmarked and reached with Back / Forward and the phone's back gesture.

- **`/` Portada.** Left (top on phone): eyebrow «San Cristóbal de La Laguna», «OxEye» in Georgia, the line «Un plano para conversar, un modelo para ensayar.» Three entries with clear hierarchy:
  - **Gestor logístico**: large primary card, one line on what it does (eventos, tareas, inventarios, contactos y proveedores), «Entrar». Opens `#logistica` exactly as today.
  - **Simulador**: secondary card, shows the last saved model («Navidad en el Cristo · guardado en este dispositivo») or «Sin modelos todavía».
  - **Ajustes**: quiet entry. Footer link «Acerca de OxEye» and the version.
  Right (top on phone): the OxEye symbol (`BrandSymbol`) animated on arrival: the swirl strokes draw in, the frame settles, the iris appears, then a very slow breathing pulse on the iris. ≤ 1.5 s, CSS/SVG only, off with «Movimiento reducido» or `prefers-reduced-motion`.
- **`/simulador` Simulador.** Everything that was in the old menu for the simulation: «Continuar» (with the model name), «Cargar modelo (JSON)», «Crear nuevo modelo», «Guardar y salir». A short plain-language line on what the simulator is for, and «Volver a la portada».
- **`/simulador/nuevo`** the existing new-model wizard. Only its frame (card, typography, buttons, step indicator) takes the new look; its steps, fields and logic stay as they are.
- **`/simulador/modelo`** the simulation workspace is open (menu hidden). The workspace itself is **not touched**: the hub only keeps the address in sync with `menuOpen`. Reloading on it reopens the saved model if there is one, otherwise goes to `/simulador`. Opening the menu from inside the workspace lands on `/simulador`.
- **`/ajustes` Ajustes.** Grouped: «Apariencia» (palette grid with live preview, «Movimiento reducido»), «Simulador» (velocidad, ayudas `?`). New: «Restablecer ajustes» (with confirmation, palette and preferences back to defaults; no data deleted), the version of the app. Same `preferences` store as today, so the Gestor keeps following the palette.
- **`/acerca` Acerca de OxEye.** Replaces «Créditos»: what OxEye is, its two modules, methodological sources (PEMU La Laguna 2011, plan de autoprotección de la Plaza del Cristo 2021, Directiva 89/391/CEE, INSST 2020) with the honest note «OxEye ayuda a decidir; no certifica», and the existing credits.
- **Unknown address** → replaced by `/` (no error page). `#logistica…` keeps working on any path.

## Approach

1. **Hub routing, pure.** `src/components/menu/hubRoute.ts`: `parseHubPath(pathname, base)` / `hubPath(route, base)` for `/`, `/simulador`, `/simulador/nuevo`, `/simulador/modelo`, `/ajustes`, `/acerca`; respects `import.meta.env.BASE_URL` (GitHub Pages build still works at its root; deep links there are not a goal, the Gestor is not published there) and trailing slashes. A small `useHubRoute` hook: `pushState` on navigation, `popstate` to follow Back / Forward, `replaceState` for unknown paths. It ignores the hash entirely, so it never interferes with the Gestor's `historyNav`.
2. **Split `GameMenu.tsx`** (1 122 lines) into `HubHome`, `SimulatorSection`, `SettingsScreen`, `AboutScreen` and the existing wizard moved as-is into `NewModelWizard.tsx`. `GameMenu` stays the mount point used by `App.tsx` (no `App.tsx` change) and keeps the `#logistica` open/close logic unchanged.
3. **Look.** The hub root gets the `.lx` class so it inherits the Gestor's tokens in all six palettes (`src/styles/logistics/tokens.css`). New styles in `src/styles/hub/`; `game-menu.css` keeps only what the wizard still needs. Layout: two columns ≥ 900 px, one column below, touch targets ≥ 44 px.
4. **Stable test hooks.** Ids `#game-continue`, `#game-load`, `#game-new`, `#game-logistics`, `#game-settings`, `#game-exit` are kept on their new buttons; e2e helpers learn the extra step through `/simulador`.

## Included improvements

- Back / Forward and the phone gesture move through the hub like in the Gestor.
- Focus moves to the screen title on every route change; full keyboard use, visible focus.
- «Continuar» disabled state explains why («Crea o carga primero un modelo»), as today.
- Hub works in every palette and on phone, checked with screenshots.

## Known limits (stated, not hidden)

- Clean addresses need the server to return the app for any path: Vite dev and `vite preview` (used by `npm run equipo`) already do; the pilot server's rule is documented in step 2.
- The Gestor's service worker only serves the root offline; hub sub-routes need connection until step 2 (the Gestor itself, at `/#logistica`, keeps working offline).
- The simulation header's brand link (`href="./"`, untouched) from `/simulador/modelo` lands on `/simulador/`, which the hub reads as the Simulador section.

## Invariants

None touched: no simulation engine, emergency, subsoil, demand, persistence or export code changes. «Acerca de» wording keeps methodological honesty (no certification claims).

## Work packages

- AI Lead: `hubRoute.ts` + unit tests, integration, log.
- `ui-engineer`: hub screens, symbol animation, styles, phone layout.
- `qa-engineer`: e2e updates, new `hub.spec.ts` (routes, Back/Forward, unknown path, reload on each route), visual palettes extended to Portada / Simulador / Ajustes / Acerca on desktop and phone.
- `code-reviewer` on the diff.

## Acceptance criteria

1. Opening `/`, `/simulador`, `/simulador/nuevo`, `/ajustes`, `/acerca` directly (dev and `vite preview`) shows that screen; Back / Forward move between them.
2. «Gestor logístico» opens the Gestor as today; leaving it returns to `/`; Gestor e2e suite passes.
3. Continuar / Cargar modelo / Crear nuevo modelo / Guardar y salir behave as before; the simulation workspace is visually and functionally unchanged (`app.spec`, `first-run-flow`, `tutorial` pass).
4. All six palettes and phone width look right (screenshots reviewed); reduced motion stops the animation.

## Verification

Baseline first (`oxeye-verification`). `npx tsc --noEmit`, lint, `npx vitest run` (hub route tests), `npm run build`, e2e: hub, simulation flows, Gestor entry/navigation, `visual-palettes.spec.ts` with images opened.

## Allowed paths

- `src/components/menu/**`
- `src/styles/hub/**`
- `src/styles/game-menu.css`
- `src/styles/index.css`
- `tests/unit/hub/**`
- `tests/e2e/hub.spec.ts`
- `tests/e2e/helpers.ts`
- `tests/e2e/visual-palettes.spec.ts`
- `tests/e2e/app.spec.ts`
- `tests/e2e/first-run-flow.spec.ts`
- `tests/e2e/onboarding-spawns.spec.ts`
- `tests/e2e/palettes.spec.ts`
- `tests/e2e/programme-contacts.spec.ts`
- `tests/e2e/tutorial.spec.ts`
- `tests/e2e/logistics/entry-and-session.spec.ts`
- `tests/e2e/logistics/navigation.spec.ts`
- `tests/e2e/logistics/supplier.spec.ts`
- `doc/specs/2026-11-27-portada-oxeye.log.md`
