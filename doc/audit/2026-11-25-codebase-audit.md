# Codebase audit of the OxEye baseline

- Scope: first technical audit and stabilisation of the codebase (architecture, persistence, dependencies, invariant tests, E2E repair, known issues)
- Date: 2026-11-25
- Audited commit: `9809b13` (`main`), branch `feat/ox-01`
- Line references (`file:line`) point to commit `b5be350` (branch `feat/ox-01`). In the 25 files touched by the comment cleanup (`adf2973`) they are a few lines lower than at `9809b13`. References were checked against `b5be350` where reviewed; unreviewed ones may be off by a few lines.
- Version in `package.json`: `0.16.0`

> Status scale: **Existente y verificado** (works and has automated tests), **Existente parcialmente** (implemented, with limitations or without direct tests), **Prototipado**, **No implementado**, **Desconocido**. An export or a UI button alone never yields "verificado".
>
> Evidence levels used in this document: *verified* = checked by running a command in this audit; *static* = derived from reading the code; *reported* = taken from earlier documents and not re-checked.

## 1. Summary

| Area | Result |
|---|---|
| Unit tests | 23 suites, 117 tests, all passing (verified) |
| Type-check | passes with `strict: false`; enabling `strict` + `noImplicitAny` gives 48 errors (verified) |
| Lint | 0 errors; 126 warnings before cleanup, 2 after (verified) |
| Build | passes; single JS bundle of 1,669 kB (509 kB gzip) (verified) |
| E2E | 12 of 12 failing at baseline; after repair 11 passed, 2 `fixme`, 0 failed (verified, section 8) |
| Engine modules | 63: 45 verificado, 16 parcialmente, 2 prototipado |
| UI / state / persistence | No component, store or `App.tsx` has a unit test; UI is covered only by E2E |
| Import cycles | 2 runtime cycles, 1 type-only cycle |
| Domain invariants | Punto Violeta privacy has 3 high-severity bypasses; the `demandInputs` mirror derived from `EventDemandConfig` blocks simulation after reload (KI-28, blocker); routes A/B/C, Carpa Amarilla and X-ray/500 kg/m² have tests with gaps |

The most important findings are:

- **KI-28 (blocker):** a project reloaded from storage cannot be simulated, because demand inputs rebuilt from `EventDemandConfig` contain non-numeric values that the risk review treats as critical.
- **KI-01 to KI-03 (high):** Punto Violeta privacy bypasses in an export, the director log, and the public-mode map and print report (section 7.3).

They are registered here and were not fixed by the audit.

## 2. Installation and execution

The authoritative instructions are in `README.md`, section "🚀 Inicio Rápido". Summary of the facts verified during this audit:

- Node.js 22 is used by CI (`.github/workflows/deploy-pages.yml`); the audit machine ran Node 26.13.1 and npm 11.20.0 without problems.
- Install with `npm ci` (uses `package-lock.json`).
- E2E needs Chromium for Playwright: `npx playwright install chromium`.
- `npm run test:e2e` starts its own Vite dev server on port 5173 **only if none is running** (`reuseExistingServer: !process.env.CI` in `playwright.config.ts`). A stale dev server whose dependency cache has been removed makes the app fail to mount (Vite answers 504 "Outdated Optimize Dep") and every E2E test fails. Stop any running `npm run dev` before running E2E.
- `npm run test:e2e` writes `playwright-report/` and `test-results/`; both are ignored by Git since commit `8aed8f5`.
- `npm run build` writes `dist/` and `*.tsbuildinfo` (ignored).

## 3. Verification log

| Date | Commit | Command | Result |
|---|---|---|---|
| 2026-11-25 | `9809b13` | `npm run lint` | 0 errors, 126 warnings (124 unused `eslint-disable`, 1 `react-hooks/exhaustive-deps`, 1 unused `resolveAccessCategory`) |
| 2026-11-25 | `9809b13` | `npx vitest run` | 23 files, 117 tests passed |
| 2026-11-25 | `9809b13` | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 2026-11-25 | `9809b13` | `npx tsc --noEmit -p tsconfig.json --strict --noImplicitAny` | 48 errors |
| 2026-11-25 | `9809b13` | `npm run build` | pass; `index-*.js` 1,669.08 kB (gzip 508.77 kB), CSS 115.02 kB; Vite chunk-size warning |
| 2026-11-25 | `9809b13` | `npx prettier --check "src/**/*.{ts,tsx,css}"` | 127 files with style differences |
| 2026-11-25 | `9809b13` | grep for `any` type usages in `src` | 189 |
| 2026-11-25 | `9809b13` | `npm run test:e2e` (pre-WP2) | 12 failed; invalid run: stale dev server, app did not mount |
| 2026-11-25 | `adf2973` | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 2026-11-25 | `adf2973` | `npm run lint` | 0 errors, 2 warnings |
| 2026-11-25 | `adf2973` | `npx vitest run` | 23 files, 117 tests passed |
| 2026-11-25 | `adf2973` | `npm run test:e2e` (fresh server) | 12 failed (real baseline) |
| 2026-11-25 | `c104d80` | `npx playwright test` | 11 passed, 2 skipped (`fixme`), 0 failed |
| 2026-11-25 | `c104d80` | `npm run lint` | 0 errors, 2 warnings |

Final verification results are appended in section 11.

## 4. Real architecture

### 4.1 Layers

```text
main.tsx → App.tsx (orchestration, simulation lifecycle, RAF loop)
             ├── components/** (React UI; MapShell renders the SVG map)
             ├── store/useProjectStore.ts (single Zustand store)
             ├── db/repository.ts (localStorage + Dexie + import/export)
             ├── engine/** (domain and simulation logic, 10 domains)
             └── data/** (static catalogues, geodata JSON, palettes)
src/index.ts: public barrel used only by TypeDoc and 2 unit tests; the app never imports it.
```

Simulation runs on the main thread inside the React tree (`App.tsx`, RAF loop). Domain computation also lives in several components (`ComparisonDialog.tsx:52-129` builds engines and runs a search loop; `RiskDialog.tsx:127-130` duplicates the engine wiring of `App.tsx:81-87`, also duplicated in `engine/planning/batch.ts:160-186` and `evaluator.ts:178-193`).

### 4.2 Import cycles (static)

Method: every `import` / `export … from` in `src/engine/**`, `src/store`, `src/components` was listed (multi-line blocks included) and reachability traced by hand. `import type` edges are reported separately.

| Kind | Cycle | Evidence |
|---|---|---|
| Runtime | `event-engine → emergency-lab → incident-center → event-engine` | `event-engine.ts:27`, `emergency-lab.ts:2-7`, `incident-center.ts:14` (`new EventEngine` at `:789`) |
| Runtime | `contextual-incidents ↔ response-model` | `response-model.ts:13-17`, `contextual-incidents.ts:14` (`new EventEngine` / `new ResponseSimulation` at `:881-882`) |
| Type-only | `attendance-model ↔ event-engine` | `attendance-model.ts:20` (type), `event-engine.ts:33` (value) |

The earlier audit described the first cycle as `event-engine → incident-center → emergency-lab`; the real order is the one above. Both runtime cycles remain as registered debt (KI-10).

### 4.3 Boundary leaks

| Direction | Location | Note |
|---|---|---|
| engine → store | `engine/emergency/risk-guidance.ts:7` | `import type {ActiveModal}`; the only case |
| store → components | `store/useProjectStore.ts:16-17` | imports `components/map/selectionActions.ts` (pure scene logic placed under components) |
| data → engine | `data/catalog.ts:5` | imports `engine/logistics/phases`; no cycle today |
| engine → data | `grid-flow.ts:1`, `presets.ts:1-3`, `risk.ts:5-6`, `vehicle-system.ts:7`, `evaluator.ts:1`, `heat.ts:7` | known risk |
| hidden global mutation | `presets.ts:849-859` (`configure()`) | mutates `MAPS` exported by `data/venue-maps.ts`; called on load, import and undo |
| engine → network | `cartography/custom-map.ts:354-568` | Nominatim / OSM / Overpass `fetch` inside the engine |
| engine → presentation | minimap, object-skin, feedback, furniture, director-logic, emergency-lab, fire-model:1109, incident-center, incident-dashboard, response-model:~2021, risk:1057+, vehicle-dispatch:1161+, shift:986 | HTML/SVG strings, injected with `innerHTML` / `dangerouslySetInnerHTML` |
| data/db → DOM | `data/palettes.ts:152-162`, `db/repository.ts:216-217,233-244` | palette application, body class, downloads |
| barrel side effect | `src/index.ts:70-75` | re-exports the store; importing it runs `loadProjectFromStorage` at import time |

No engine module imports React or components, or uses `window`, `document` or `localStorage`.

### 4.4 Persistence

**localStorage** (only two keys; no sessionStorage or cookies):

| Key | Content | Writer | Reader |
|---|---|---|---|
| `ojo-de-buey-project-v1` | Whole `ProjectFile` (`version: 1`, `format: 'ojo-de-buey'`, `active`, `maps`, `scenes{cristo,constitucion,vega}`), including custom-map vectors, contacts, programme, annotations, `lastSessionReview`, `lastAudit`, `safetyHistory`, `learning` | `saveProjectToStorage` (`repository.ts:169-186`) on every scene edit, replace, save, undo and wizard creation | `loadProjectFromStorage` (`repository.ts:125-161`), once at store initialisation |
| `ojo-prefs` | `UserPreferences {speed, reduceMotion, help, palette}` | `savePreferences` (`repository.ts:216-224`) | `loadPreferences` (`repository.ts:193-209`) |

If the stored project fails validation (wrong format or version, `validateScene` error, bbox mismatch on a non-custom map), the app silently starts from a default project and the next save overwrites the stored data (KI-07).

**IndexedDB (Dexie)** `OxEyeDatabase` v1 (`repository.ts:47-60`): table `projects` is written on every save (errors swallowed) and **never read**; table `simulationRuns` is never written or read.

**Drizzle**: `db/schema.ts` defines 6 SQLite tables and is not used at runtime (only re-exported by `src/index.ts:16`). `drizzle-orm` and `drizzle-kit` are therefore unused by the running app.

**Undo history**: `useProjectStore.ts:111-112, 596-630`. Each checkpoint is `JSON.stringify` of the whole project; cap 35 entries (the redo path does not re-apply the cap); memory only; disabled in the simulate panel.

**Exports** (all through `downloadFile`, `repository.ts:233-244`):

| File | Origin | Notes |
|---|---|---|
| `Ojo_de_Buey_Proyecto.json` | `Header.tsx:38`, `GameMenu.tsx:414-417` | Full project, identical to localStorage; includes contacts' personal data |
| `Ojo_de_Buey_Observaciones.csv` | `repository.ts:252-282` | Formula-injection guard present |
| `Informe_de_visitantes.json` | `Sidebar.tsx:2324-2358` | Exports emergency events without privacy filtering (KI-01) |
| `Conclusiones_de_jornada.json` | `ClosingDialog.tsx:372-382` | `lastSessionReview` (includes `reason: r.note`, see KI-04) |
| `Autoinforme_Ojo_de_Buey.json` | `ComparisonDialog.tsx:663-666` | `lastAudit` |
| `Revision_de_riesgos.json` | `RiskDialog.tsx:764-783` | Includes a status disclaimer |
| `Ranking_Ojo_de_Buey.json` | `LaboratoryDialog.tsx:279-282` | Batch rows |
| `Programa_Ojo_de_Buey.csv` | `ProgrammeDialog.tsx:453-480` | **No formula-injection guard** (KI-12) |
| `Ojo_de_Buey_Fuentes.json` | `InfoDialog.tsx:155-158` | Static sources |
| `{code}_Analisis_Incidencia.json`, `{code}_Cronologia.csv` | `IncidentAnalysisPanel.tsx:206-224` | Privacy-aware (`incident-center.ts:857-944`) |
| Incident report (print window) | `IncidentAnalysisPanel.tsx:226-287` | Not a real PDF; embeds the live map SVG (KI-03) |

**Import**: single entry point `Header.tsx:286` → `parseImportedProject` (`repository.ts:309-350`). Full project files must be version 1; legacy single-scenario files are remapped and lose annotations, measurements and road plans. There is no versioned migration path; in-place migrations run on every load.

## 5. Dependencies

| Package | Kind | Status | Evidence |
|---|---|---|---|
| react, react-dom 19 | runtime | used | whole UI |
| zustand 5 | runtime | used | `store/useProjectStore.ts` |
| dexie 4 | runtime | used, write-only | `db/repository.ts:47-60`; data never read back |
| drizzle-orm 0.38 | runtime | **not used at runtime** | only `db/schema.ts`, reachable only from `src/index.ts` |
| drizzle-kit 0.30 | dev | unused | no migrations or config |
| gts 6 | dev | **unused** | not referenced by `eslint.config.js` |
| eslint 9, typescript-eslint 8, eslint-plugin-react-hooks, eslint-config-prettier, @eslint/js, globals | dev | used | `eslint.config.js` |
| prettier 3 | dev | configured, not applied | 127 files differ |
| typescript 5.7, vite 6, @vitejs/plugin-react | dev | used | build |
| vitest 2, jsdom 25 | dev | used | unit tests |
| @playwright/test 1.49 | dev | used | E2E |
| typedoc 0.27 | dev | used by `npm run docs` | not run in this audit |
| @types/* | dev | used | — |

External runtime services: OpenStreetMap / Nominatim / Overpass (custom locations), PNOA / Esri orthophotos (see `InfoDialog` sources).

## 6. Module classification

### 6.1 Engine (`src/engine/`, 63 modules)

"Runtime-used" = imported by the running app directly (Yes) or only through other engine modules (Transitive). Evidence names the unit test that exercises the module.

| Module | Responsibility | Status | Evidence / limitation | Runtime-used |
|---|---|---|---|---|
| cartography/custom-map | Local projection, OSM tiles, Nominatim/Overpass fetch | Verificado | spawns-and-map.test | Yes |
| cartography/fences | Fence geometry, snapping, segments | Verificado | fences.test | Yes |
| cartography/geometry | UTM/percent/metres transforms, point-in-polygon, distances | Verificado | ~12 suites | Yes |
| cartography/groups | Hierarchical grouping, rigid transforms | Verificado | ballast-groups.test | Yes |
| cartography/minimap | SVG thumbnails | Parcialmente | no test; HTML/SVG string output | Yes |
| cartography/object-skin | Decorative plan symbols | Verificado | engine.test | Yes |
| cartography/route-network | Route branch network | Verificado | route-network.test | Yes |
| cartography/selection-tools | Cyclic/box selection, align/distribute | Verificado | selection-tools.test | Yes |
| cartography/spawns | Pedestrian/vehicle spawn generation | Verificado | spawns-and-map.test | Yes |
| cartography/transform | Resize/rotate handle maths | Verificado | engine.test | Yes |
| crowd/attendance-model | Hourly attendance with conservation | Verificado | demand-sync.test, human-behavior-crowd.test | Yes |
| crowd/crowd-guidance | Congestion detection, steward dispatch | Verificado | human-behavior-crowd.test (via engine) | Yes |
| crowd/demography | Census quotas, synthetic identity | Parcialmente | indirect coverage only | Transitive |
| crowd/event-engine | Core crowd simulation (1,977 lines) | Verificado | seed-reproducibility, engine, fences and others | Yes |
| crowd/event-model | Site/booth/weather defaults | Parcialmente | indirect only; unseeded id at `:138` | Transitive |
| crowd/everyday-interactions | Everyday queries, false alarms | Verificado | human-behavior-crowd.test | Transitive |
| crowd/feedback | Visitor feedback log, HTML cards | Parcialmente | no test | Transitive |
| crowd/grid-flow | Navigation grid, flow field, seeded `rng` | Verificado | fences.test, seed-reproducibility.test | Yes |
| crowd/human-behavior | Schedules, needs, decisions, social groups | Verificado | human-behavior-crowd.test | Transitive |
| crowd/personas | 1,000 synthetic personas | Parcialmente | indirect only | Transitive |
| crowd/presets | Venue presets, initial scenes | Verificado | almost all suites; contains hardcoded scenes | Yes |
| crowd/route-traces | Movement vectors | Parcialmente | no test; `routeArrows` has no consumer | Transitive |
| crowd/shelter | Weather shelter seeking | Parcialmente | indirect only | Transitive |
| crowd/small-example | Promoter demo scene | **Prototipado** | demo data; seeds the default `cristo` scene (`db/repository.ts:75`) | Yes |
| crowd/steward-system | Autonomous stewards | Verificado | stewards.test | Transitive |
| dining/dining | Seating, wet tables, drying crew | Parcialmente | indirect only (diagnostics.test uses a mock) | Transitive |
| dining/furniture | Picnic zone geometry | Parcialmente | indirect only | Transitive |
| director/director-logic | Goals, schedule, live weather/arrivals | Verificado | engine.test, smart-objectives.test; `applyLive*` untested | Yes |
| emergency/contextual-incidents | Per-installation incident catalogue | Verificado | contextual-fire-propagation.test | Yes |
| emergency/emergency-lab | `EmergencyLab` base class, incident panels | Parcialmente | indirect via `ResponseSimulation`; `emergencyPanel` unused | Yes |
| emergency/evacuation | Caution perimeter, evacuation routing | Verificado | engine.test | Transitive |
| emergency/fire-model | Multi-focus fire propagation | Verificado | contextual-fire-propagation.test, engine.test | Transitive |
| emergency/incident-center | Taxonomy, timeline, Punto Violeta privacy, exports | Verificado | incident-center.test | Yes |
| emergency/incident-crowd | Crowd reaction to incidents | Parcialmente | no test | Transitive |
| emergency/incident-dashboard | Incident corner cards | Verificado | incident-center.test | Yes |
| emergency/motion | Vehicle path smoothing | Parcialmente | indirect only | Transitive |
| emergency/priority | Gate authority, pedestrian yield | Verificado | emergency-access-fix.test | Yes |
| emergency/response-example | Demo response teams | **Prototipado** | demo data; also seeds the default scene | Yes |
| emergency/response-model | `ResponseSimulation` (2,078 lines) | Verificado | engine, emergency-dispatch, stretcher-evacuation, seed-reproducibility | Yes |
| emergency/risk-guidance | Guidance per risk issue | Verificado | diagnostics.test | Yes |
| emergency/risk | Pre-flight and live risk | Verificado | ballast-groups, subsoil, stewards, smart-objectives | Yes |
| emergency/stretcher-nav | Route A/B/C navigation | Verificado | stretcher-evacuation.test | Transitive |
| emergency/vehicle-dispatch | Emergency fleet dispatch | Verificado | emergency-dispatch.test, stretcher-evacuation.test | Yes |
| emergency/watch | Foot patrols, fixed posts | Parcialmente | no test | Transitive |
| experience/experience-monitor | Satisfaction, sound, complaints | Parcialmente | indirect only | Yes |
| experience/post-sim-diagnostics | Post-simulation diagnostics | Verificado | diagnostics.test, fences.test | Yes |
| experience/review-memory | Deferred/recurring issue memory | Verificado | engine.test | Yes |
| logistics/companies | Company lot allocation | Parcialmente | indirect only | Yes |
| logistics/phases | Phases, logistics reservations | Verificado | demand-sync, stewards, seed-reproducibility | Yes |
| logistics/shift | Setup/strike shift simulation | Verificado | logistics-sequencing, diagnostics, emergency-access-fix | Yes |
| mobility/vehicle-system | Vehicle grid, routing, lifecycle | Verificado | vehicle-mobility.test | Transitive |
| planning/ballast | Ballast, kg/m² vs indicative 500 threshold | Verificado | ballast-groups.test | Yes |
| planning/batch | Batch scenario evaluation | Verificado | smart-objectives.test | Yes |
| planning/contacts | Provider contacts, migration | Verificado | programme-contacts.test | Yes |
| planning/demand | Initial service demand | Verificado | engine, demand-sync, smart-objectives | Yes |
| planning/evaluator | Spatial metrics, `trial`, `compare` | Parcialmente | `trial`/`compare` untested | Yes |
| planning/event-demand | `EventDemandConfig` single source of truth | Verificado | demand-sync.test | Yes |
| planning/inventory | Stock classify/reconcile | Verificado | engine.test | Yes |
| planning/layout | Generate/rebalance/redesign layout | Verificado | smart-objectives.test | Yes |
| planning/objectives | SMART objectives catalogue | Verificado | smart-objectives.test | Yes |
| planning/programme | Activity programme and scheduler | Verificado | engine.test, programme-contacts.test | Yes |
| planning/spatial-assistant | Spatial correction assistant | Verificado | spatial-assistant.test | Yes |
| subsoil/heat | X-ray heat, heavy-load conflicts | Verificado | subsoil.test, ballast-groups.test | Yes |

Totals: 45 Existente y verificado, 16 Existente parcialmente, 2 Prototipado. "Verificado" means a passing unit suite exercises the module; it does not measure how much of a large module is covered. Untested exports: `routeArrows`, `emergencyPanel`, `trial`, `compare`, `applyLiveWeather`, `applyLiveArrivals`.

Duplicated utilities (debt, KI-14): HTML escape `esc` ×7, Euclidean distance ×7, `gateMode` ×2 (`geometry.ts:164`, `presets.ts:36`), seeded PRNG `rng` plus three inline LCGs (`inventory.ts:260`, `layout.ts:493,703`), several clamp helpers.

### 6.2 UI, state, persistence and data

No React component, `useProjectStore` or `App.tsx` has a unit test. "E2E" in the evidence column names the specs that exercise the file (status in section 8). *Verificado (E2E)* means a passing E2E spec exercises the file through the UI; it covers the flows in those specs, not every feature of the file. Files reached only by the two `fixme` tests stay *Existente parcialmente*.

| File | Lines | Responsibility | Status | Evidence |
|---|---|---|---|---|
| App.tsx | 1912 | Orchestration, engine lifecycle, RAF loop, modals | Verificado (E2E) | E2E only |
| main.tsx | 28 | React root, global error toasts | Verificado (E2E) | E2E only |
| index.ts | 75 | Public barrel (TypeDoc, tests); not imported by the app | Verificado (barrel) | 2 unit suites |
| store/useProjectStore.ts | 866 | Single Zustand store: project, UI, history, prefs, wizard | Verificado (E2E) | E2E only |
| db/repository.ts | 351 | localStorage/Dexie persistence, prefs, import/export | Verificado (import, default project); storage paths untested | demand-sync, fences, programme-contacts, spawns-and-map, subsoil |
| db/schema.ts | 99 | Drizzle table definitions | Prototipado | not used at runtime |
| data/catalog.ts | 381 | Venues, catalogue, icons | Verificado | engine.test, incident-center.test |
| data/geodata.ts (+ json/maps.json, json/carto.json) | 22 | Map and OSM vector data | Verificado | ~20 suites |
| data/venue-maps.ts | 171 | Legacy maps and zones; `MAPS` mutated by `configure()` | Verificado (indirect) | engine suites; `ZONES` unused |
| data/site-reference.ts | 98 | Access and inventory reference data | Verificado | engine.test |
| data/inventory-meta.ts | 350 | Inventory metadata | Verificado | incident-center.test |
| data/palettes.ts | 162 | Palettes, `applyPalette` | Verificado | palettes.test |
| data/plain-language-fields.ts | 282 | Plain-language help dictionaries | Parcialmente | no test |
| common/CustomizableSelect.tsx | 132 | Select with custom value | Verificado (E2E) | E2E programme-contacts |
| common/PlainLanguageEnhancer.tsx | 185 | Adds help tooltips by DOM manipulation | Parcialmente | no test |
| common/Toast.tsx | 55 | Toast with map locate | Parcialmente | no test |
| common/TutorialOverlay.tsx | 345 | Guided tour | Verificado (E2E) | E2E first-run-flow, tutorial |
| demand/DemandControls.tsx | 432 | Demand inputs, hourly editor | Verificado (E2E) | E2E app |
| header/Header.tsx | 294 | Header, project JSON export/import | Verificado (E2E) | E2E app, programme-contacts, fences |
| icons/InventoryIcons.tsx | 317 | SVG icons | Verificado (E2E) | E2E onboarding-spawns |
| layout/NavigationRail.tsx | 38 | Workspace switch | Verificado (E2E) | E2E app (single venue) |
| layout/PhaseStrip.tsx | 162 | Phase and venue selector | Verificado (E2E) | E2E xray, onboarding-spawns |
| layout/Sidebar.tsx | 2535 | Plan/simulate/review panels, exports | Verificado (E2E) | E2E app, fences |
| layout/SourceBar.tsx | 25 | Attribution bar | Parcialmente | no test |
| layout/VenueTabs.tsx | 60 | Venue tabs | **Desconocido** | imported nowhere; dead code, since preset venue switching is not a product feature (KI-29) |
| layout/WorkspaceBar.tsx | 80 | Title, base layer, layers button | Verificado (E2E) | E2E app, xray |
| map/IncidentQuickInspector.tsx | 255 | Incident/congestion popover | Parcialmente | no test |
| map/Inspector.tsx | 2432 | Object inspector | Verificado (E2E) | E2E fences, ballast-groups, xray, onboarding-spawns |
| map/LayerPanel.tsx | 99 | Layer toggles | Verificado (E2E) | E2E xray |
| map/MapShell.tsx | 3268 | SVG map, drawing, drag, HUD, undo/redo | Verificado (E2E) | all map E2E specs |
| map/SimulationInspector.tsx | 482 | Simulate inspector, incident trigger | Parcialmente | no test |
| map/SubsoilInspector.tsx | 801 | Subsoil and multi-selection inspector | Verificado (E2E) | E2E xray |
| map/XRayLayer.tsx | 396 | X-ray layer | Verificado (E2E) | E2E xray, ballast-groups |
| map/selectionActions.ts | 403 | Copy/paste/delete scene items | Verificado | subsoil.test |
| map/useMapShortcuts.ts | 186 | Keyboard shortcuts incl. undo/redo | Verificado (E2E) | E2E xray, ballast-groups |
| map/xrayTools.ts | 318 | X-ray drawing helpers | Verificado (E2E) | E2E xray |
| menu/GameMenu.tsx | 1045 | Launch menu, project wizard, settings | Verificado (E2E) | E2E first-run-flow, palettes, tutorial, onboarding-spawns, app |
| menu/LocationPicker.tsx | 385 | OSM/Nominatim location picker | Verificado (E2E) | E2E onboarding-spawns; network dependent |
| modals/ClosingDialog.tsx | 392 | Day closing summary, export | Parcialmente | no test |
| modals/ComparisonDialog.tsx | 693 | Recovery search, self-evaluation | Parcialmente | no test |
| modals/ContactsDialog.tsx | 183 | Provider contacts | Verificado (E2E) | E2E programme-contacts |
| modals/DemandChangeDialog.tsx | 187 | Confirms live demand changes | Parcialmente | no test |
| modals/DemandDialog.tsx | 726 | Demand calculator on `demandConfig` | Verificado (E2E) | E2E app |
| modals/InfoDialog.tsx | 176 | About, sources, limitations | Parcialmente | no test |
| modals/InventoryDialog.tsx | 635 | Stock catalogue | Verificado (E2E) | E2E onboarding-spawns |
| modals/LaboratoryDialog.tsx | 380 | Batch evaluation and ranking | Parcialmente | no test |
| modals/ObjectivesDialog.tsx | 220 | Edit objectives | Parcialmente | no test |
| modals/OrganizationsDialog.tsx | 211 | Subcontractor companies | Parcialmente | no test |
| modals/ParametersDialog.tsx | 218 | Production parameters | Verificado (E2E) | E2E fences |
| modals/PostSimDiagnosticsView.tsx | 311 | Post-simulation diagnostics view | Parcialmente | E2E diagnostics is `fixme` (KI-28) |
| modals/ProgrammeDialog.tsx | 1166 | Programme scheduling, CSV export | Verificado (E2E) | E2E app, programme-contacts |
| modals/RiskDialog.tsx | 801 | Risk review, live hypotheses, export | Verificado (E2E) | E2E app, xray |
| modals/SmallExampleDialog.tsx | 96 | Load compact example | Parcialmente | no test |
| planning/ObjectiveCategoryIcon.tsx | 119 | Objective category icons | Verificado (E2E) | E2E wizard specs |
| planning/ObjectivesConfigurator.tsx | 416 | SMART objective selection | Verificado (E2E) | E2E wizard specs |
| review/SpatialAssistantPanel.tsx | 204 | Spatial corrections panel | Parcialmente | no test |
| simulation/IncidentAnalysisPanel.tsx | 833 | Incident analysis, replay, exports, print | Parcialmente | no test |
| simulation/SimulationStrip.tsx | 229 | Play, speed, clock, timeline | Verificado (E2E) | E2E xray |

`src/components/` holds 42 `.tsx` files plus 3 `.ts` files (`selectionActions.ts`, `useMapShortcuts.ts`, `xrayTools.ts`).

## 7. Domain invariants: tests and gaps

Static review by the `safety-auditor` agent with the `oxeye-invariants` skill; the unit suites named below pass (verified, section 3). High-severity privacy findings were re-checked in the code by the AI Lead.

### 7.1 Emergency routes (A vehicular, B medical on foot, C stretcher evacuation)

- Anchors: `stretcher-nav.ts:4-6, 307-345, 367-439`; `vehicle-dispatch.ts:626-630`; `risk.ts:697-723`.
- Tests: `stretcher-evacuation.test.ts` › "CA 4, 5 & 8 · distinguishes medic foot assistance (Route B ok) from unresolved stretcher evacuation (Route C blocked…)", "CA 3 · defines stretcher equipment…", "CA 1, 2, 4, 6 & 7 · ambulance parks outside, medics deploy on foot…".
- Gaps: mapping of mission paths to A/B/C and the fallback to reversed B (`vehicle-dispatch.ts:626-630`) untested (medium); route A not asserted with vehicle dimensions (low); risk messages not checked to name the right route (low); no E2E.
- Note: the `oxeye-invariants` skill lists `route-network.ts` as an anchor; it is unrelated to A/B/C, and `risk.ts` is missing (KI-16).

### 7.2 Carpa Amarilla

- Anchors: `data/catalog.ts:195-201`; `data/inventory-meta.ts:105-114`; `response-model.ts:209-215, 564-566, 1046-1058, 1286-1287`.
- Tests: `incident-center.test.ts` › "PHYSICAL RESOURCES · yellow_tent and violet_point exist in catalog and handle bidirectional dispatch only when placed"; `contextual-fire-propagation.test.ts` › "…evaluates threats on Carpa Amarilla & Punto Violeta without auto-igniting them".
- Gaps (low): labels and status headlines untested; 14 m walk-over rule untested; template `acc_staff_saturation` is routed to security rather than the tent (possibly intended).

### 7.3 Punto Violeta privacy

- Protection: with category `violet_point` and `privacyMode === 'public'` (default, `App.tsx:204`), name, note and timeline detail are replaced by generic text and the location is described as reserved.
- Tests: `incident-center.test.ts` › "CA 12 & 13 · enforces Punto Violeta privacy in public mode across notifications, SVG, JSON and CSV exports"; `contextual-fire-propagation.test.ts` › "…protects Punto Violeta privacy".
- **Bypasses (high):**
  1. `Informe_de_visitantes.json` exports `name`, `note` and `reporters` of every emergency event with no privacy filter (`Sidebar.tsx:2324-2358`). A violet request's name is built as `${template label} · ${object name}` (`response-model.ts:589`). (KI-01)
  2. The director log always renders `row.name` (`Sidebar.tsx:1779-1782`); only the detail line is redacted. (KI-02)
  3. In public mode `responseSVG` still draws the marker, path and vehicle at the real position (`response-model.ts:1935-1963`); the incident print report embeds the live map SVG (`IncidentAnalysisPanel.tsx:237-238`) while stating that the location is reserved. Whether a marker may appear on screen is a product decision; the contradiction in the report is a defect. (KI-03)
- Other gaps: the gating rule is re-implemented in 10+ places with three different predicates (medium, KI-05); `lastSessionReview` persists `reason: r.note` (`App.tsx:417-425`), reaching localStorage and exports (medium, KI-04); no tests for dashboard redaction, inspector redaction, the print report or the `authorized_synthetic` mode; the existing test checks labels but not the absence of coordinates; no E2E.

### 7.4 X-ray and heavy load (500 kg/m² indicative review threshold)

- Anchors: `planning/ballast.ts:8-9, 20-21, 100-109`; `subsoil/heat.ts:297-328`; wording at `Inspector.tsx:2247-2250, 2323-2329`, `risk.ts:522`.
- Tests: `ballast-groups.test.ts` › "computes surface load in kg/m² and triggers heavy-load threshold at >= 500 kg/m²", "keeps tent own weight, ballasts, and ground surface load separate…"; `subsoil.test.ts` › "classifies heavy loads by catalog defaults…", "flags heavy loads on unsupported garage slab…"; E2E `xray.spec.ts`, `ballast-groups.spec.ts`.
- Current wording presents the value as indicative ("no es un límite estructural certificado", "orientativo y no certifica").
- Gaps: no test protects the disclaimer wording (medium); in the inspector, the non-certification note under the heavy-load toggle appears only for `kind === 'ballast'` (`Inspector.tsx:2324-2329`); covers have a different note (`:2246-2250`) and the subsoil risk message carries its own (`risk.ts:522`) (low); the threshold is a hard-coded constant, not editable as CLAUDE.md §2.1 recommends (low).

### 7.5 `EventDemandConfig` and attendance conservation

- Anchors: `types/index.ts:689-723`; `planning/event-demand.ts:188, 378, 751-777, 783`; `crowd/attendance-model.ts`; `event-engine.ts:1747`.
- Tests: `demand-sync.test.ts` › "Prueba 1" to "Prueba 8" (bidirectional single source, hourly curve, conservation `ocupación(t+1) = ocupación(t) + entradas(t) - salidas(t)`, stay changes, live changes, legacy migration); `human-behavior-crowd.test.ts` › "Prueba A — … conservación exacta y reentradas sin duplicar asistentes únicos".
- Gaps (medium): direct writes that bypass the config — `director/director-logic.ts:156` (`base.arrivals`), `modals/RiskDialog.tsx:242`, `store/useProjectStore.ts:779, 830` (`base.hours`) — can let copies drift (KI-06); no full-day test that total entries equal `uniqueAttendees`.

### 7.6 Seeded reproducibility

- `seed-reproducibility.test.ts` › "produces 100% identical simulation outcomes for the same JSON + same seed" and the different-seed counterpart.
- Randomness/clock grep in `src/engine`: 12 matches, equal to the recorded baseline (identifiers and render blink timers).
- Gaps: the test runs 120 s of crowd only; emergency, fire and dispatch outcomes are not compared (medium); `event-model.ts:138` builds an id from `Date.now()` and `Math.random()` (low, not proven harmless).

### 7.7 Non-certification wording

- Disclaimers exist in `InfoDialog.tsx`, `ClosingDialog.tsx`, `RiskDialog.tsx`, `incident-center.ts:898-902` and the JSON incident export.
- Gaps: the incident print report omits the limitations block that the JSON export includes (medium, KI-08); `inventory-meta.ts:121` says "privacidad garantizada en modo público" (medium, KI-09), `:272` "garantiza rutas alternativas de evacuación" and `:321` "Radio de giro garantizado" (low); no test protects any disclaimer string.

## 8. E2E status

### 8.1 Causes of the baseline failures

1. **Environment (first cause):** a stale Vite dev server on port 5173 was reused by Playwright (`reuseExistingServer`); its dependency cache no longer existed, React modules returned 504 "Outdated Optimize Dep" and `#root` stayed empty. No selector could be found. Fixed by stopping the server (KI-25).
2. **Outdated tests (second cause), with a fresh server:**
   - With empty storage `#game-continue` is disabled; 8 specs clicked it directly.
   - Wizard step 1/5 is now an objective-card picker with a second «Jerarquía e hipótesis» sub-step; `#smart-specific` no longer exists.
   - The demand calculator is tabbed; «Primera propuesta para este público» became «Necesidades calculadas y balance frente al inventario».
   - `planProgramme` ranks activities by affinity with objectives (`programme.ts:218-230`), so a custom activity is not guaranteed a slot.
   - In `xray.spec.ts` the floating inspector covered the click point used to select the garage perimeter.

### 8.2 Current first-run flow (verified by E2E)

With empty storage the store holds the bundled default project, but «Continuar» is disabled and «Crear nuevo modelo» is the primary action. A 5-step wizard creates a project and enters perimeter onboarding; on first run the guided tour starts first. «Salir» saves the current session, after which «Continuar» is enabled (KI-31).

### 8.3 Repair (commit `c104d80`, `tests/e2e/**` only)

- New `tests/e2e/helpers.ts`: `openWorkspaceWithDefaultProject` (enters the workspace through «Salir» → reload → «Continuar»), `completeObjectivesStep`, `WIZARD_SUBMIT`.
- No assertion was removed. Changed expectations: the demand heading literal (with an added check that results are absent before calculation); programme planning restricted to the custom activity through the UI checkboxes; the garage perimeter is clicked on its left edge with a check that the point hits the map. The 500 kg/m² and critical-risk assertions are unchanged.
- Caveat: because the helper reloads the project, KI-28 also raises a critical risk. In `xray.spec.ts` the risk dialog opening on Play is therefore not attributable to the unsupported-slab block alone; the slab-specific item and its removal after unchecking the heavy load are still asserted.
- The `src` diff of commit `adf2973` was checked mechanically: 124 removed lines, all `// eslint-disable-next-line`, and zero added lines.
- `app.spec.ts` was split: the original test (with venue switching) is `fixme`; a copy without the venue step runs.
- Setup change: `onboarding-spawns.spec.ts` unticks `#wizard-tutorial` in step 2, because the first-run tour hides the perimeter banner the test checks.
- `diagnostics.spec.ts` now runs on a reloaded project (through the helper), which is what triggers KI-28. Whether a wizard-created project can be simulated without a reload was not checked.

### 8.4 Result

| Spec › test | Baseline | Now |
|---|---|---|
| app › renders main launch menu, enters workspace, switches venues, and opens dialogs | fail | **fixme**: obsolete by product decision (KI-29) |
| app › renders main launch menu, enters workspace, and opens dialogs (single venue) | — (new) | pass |
| ballast-groups › adds ballast subcomponents… | fail | pass |
| diagnostics › renders satisfaction donut chart… | fail | **fixme** (KI-28) |
| fences › permite trazar vallas encadenadas… | fail | pass |
| first-run-flow › disables Continue when no project exists… | fail | pass |
| onboarding-spawns › creates custom-location scenario… (network mocked with `page.route`) | fail | pass |
| palettes › muestra las 6 paletas predefinidas… | fail | pass |
| programme-contacts › adds custom contact kind… | fail | pass |
| tutorial › enables tutorial in Step 2… | fail | pass |
| xray › toggles X-Ray layer… | fail | pass |
| xray › triggers critical risk when a heavy load sits on unsupported garage slab… | fail | pass |
| xray › supports Solo subsuelo view and locking… | fail | pass |

Totals: **11 passed, 2 skipped (`fixme`), 0 failed**, identical in three consecutive runs (two by the QA agent, one by the AI Lead).

Not covered by E2E: post-simulation diagnostics, a simulation started from a wizard-created project, Punto Violeta privacy, emergency routes A/B/C, Carpa Amarilla.

## 9. Known-issues register

Severity: **blocker** (prevents a basic flow or breaks a non-negotiable invariant in normal use), **high**, **medium**, **low**. None of these was fixed by the audit except where stated.

| Id | Severity | Issue | Cause / location | Status |
|---|---|---|---|---|
| KI-01 | high | Visitor report export leaks Punto Violeta incident names, notes and reporters | `Sidebar.tsx:2324-2358`, no privacy filter | open |
| KI-02 | high | Director log shows Punto Violeta incident names in any privacy mode | `Sidebar.tsx:1779-1782` | open |
| KI-03 | high | Public-mode map draws the real Punto Violeta position; print report embeds it while stating it is reserved | `response-model.ts:1935-1963`, `IncidentAnalysisPanel.tsx:237-238` | open; on-screen behaviour needs a product decision |
| KI-04 | medium | Session review persists the incident note | `App.tsx:417-425` → `lastSessionReview` | open |
| KI-05 | medium | Privacy gating duplicated in 10+ places with three predicates | `incident-center.ts`, `incident-dashboard.ts`, `response-model.ts`, `App.tsx`, `Sidebar.tsx`, inspectors | open |
| KI-06 | medium | Writers bypass `EventDemandConfig` | `director-logic.ts:156`, `RiskDialog.tsx:242`, `useProjectStore.ts:779,830` | open |
| KI-07 | medium | Invalid stored project is silently replaced by a default and overwritten on next save | `repository.ts:135-160` | open |
| KI-08 | medium | Incident print report lacks the limitations disclaimer | `IncidentAnalysisPanel.tsx:253-285` | open |
| KI-09 | medium | Guarantee wording ("privacidad garantizada", "garantiza rutas", "garantizado") | `inventory-meta.ts:121, 272, 321` | open |
| KI-10 | medium | Two runtime import cycles | section 4.2 | registered debt |
| KI-11 | medium | E2E not run in CI | `.github/workflows/deploy-pages.yml` | open |
| KI-12 | medium | Programme CSV export has no formula-injection guard | `ProgrammeDialog.tsx:453-480` | open |
| KI-13 | medium | TypeScript not strict: 48 errors with `strict` + `noImplicitAny`; 189 `any` usages | `tsconfig.json` | deferred |
| KI-14 | low | Duplicated utilities (escape, distance, `gateMode`, PRNG, clamp) | section 6.1 | registered debt |
| KI-15 | low | Single 1,669 kB JS bundle, no code splitting | `vite.config.ts` | registered debt |
| KI-16 | low | `oxeye-invariants` skill anchors for routes are inaccurate | `.claude/skills/oxeye-invariants/SKILL.md` | open (config change needs its own plan) |
| KI-17 | low | Prettier configured but not applied (127 files differ) | — | out of the audit scope |
| KI-18 | low | Unused dependencies `drizzle-orm`, `drizzle-kit`, `gts`; Dexie written but never read | section 5 | open |
| KI-19 | low | Dead code: `VenueTabs.tsx`, `venue-maps.ts` `ZONES`, `routeArrows`, `emergencyPanel` | section 6 | open |
| KI-20 | low | Engine performs network I/O and builds HTML/SVG strings; components inject them with `innerHTML` | section 4.3 | registered debt |
| KI-21 | low | Hidden global mutation of `MAPS` by `configure()` | `presets.ts:849-859` | registered debt |
| KI-22 | low | Undo stores full project copies; redo path ignores the 35-entry cap | `useProjectStore.ts:596-630` | registered debt |
| KI-23 | low | Unseeded id from `Date.now()` + `Math.random()` | `event-model.ts:138` | open (impact unproven) |
| KI-24 | low | 2 remaining lint warnings: missing `useEffect` dependency `currentMap`; unused `resolveAccessCategory` | lint output | open |
| KI-25 | low | Stale dev server on :5173 makes all E2E fail (app does not mount) | `playwright.config.ts` `reuseExistingServer` | documented in README |
| KI-26 | resolved | Playwright artefacts were tracked in Git | — | fixed in `8aed8f5` |
| KI-27 | resolved | 124 unused `eslint-disable` directives | — | fixed in `adf2973` |

Issues found while repairing E2E:

| Id | Severity | Issue | Cause / location | Status |
|---|---|---|---|---|
| KI-28 | **blocker** | A project reloaded from storage cannot be simulated: risk review reports a critical «Hay hipótesis de demanda inválidas» and Play opens «Ensayo cancelado por un fallo crítico» (verified by E2E on reload). Statically, the same applies to any scene passed through `syncDemandConfigToScene`: JSON import (`repository.ts:320, 345`) and probably every demand edit through `updateEventDemand` (`event-demand.ts:869`, called from `DemandDialog`, `Sidebar` and `App`) — not executed | `legacyDemandInputs` copies the string `curveProfile` and `undefined` caps into `demandInputs` (`event-demand.ts:689-699`, merged at `:772-775`); `assessRisk` rejects any non-finite value (`risk.ts:235-243`). Defect in the legacy `demandInputs` mirror derived from `EventDemandConfig`: the single source and conservation are not violated, but synchronised scenes are blocked from simulation. No unit test runs `assessRisk` after `syncDemandConfigToScene` | open; E2E `diagnostics` is `fixme`; also weakens `xray` (section 8.3) |
| KI-29 | low | Venue switching between preset venues is not reachable in the UI | **Intended** (user, 2026-11-25): Plaza del Cristo is always the default; other places are chosen as a custom map when creating a model. Residue: `VenueTabs` never rendered, `layout.css:868` hides non-Cristo tabs, `#venue-select` (`PhaseStrip.tsx:119-132`) offers only `cristo`, `constitucion`/`vega` scenes still stored in every project; the E2E test with venue switching is obsolete (`fixme`) | closed as intended; dead code and the obsolete test are cleanup candidates |
| KI-30 | low | Duplicate DOM ids: `ObjectivesConfigurator` is mounted in the wizard and in `#objectives-dialog` (`#smart-cards-grid`, `#smart-hypotheses`, `#smart-search`…) | `GameMenu.tsx`, `ObjectivesDialog.tsx` | open |
| KI-31 | low | «Salir» saves the bundled default project even if the user never created one, enabling «Continuar» despite the tooltip «Crea o carga primero un proyecto» | `GameMenu.tsx` | open; E2E helper relies on it |

## 10. Gap matrix: non-negotiable invariants

The matrix records the audited state and gap only; it does not plan the fixes.

| Requisito | Estado objetivo | Estado actual | Brecha | Prioridad | Dependencia | Responsable | Prueba | Estado |
|---|---|---|---|---|---|---|---|---|
| Emergency routes A/B/C | A vehicular, B medical on foot, C stretcher evacuation, never interchanged | Implemented in `stretcher-nav.ts`, `vehicle-dispatch.ts`, `risk.ts` | Mission-path mapping and fallback untested; no E2E | Fixed commitment | — | Por asignar | `stretcher-evacuation.test.ts` (CA 1-8) | Tested with gaps |
| Carpa Amarilla | Accessibility service semantics preserved | Catalogue, dispatch and fire-threat handling implemented | Labels, 14 m rule untested; no E2E | Fixed commitment | — | Por asignar | `incident-center.test.ts` › PHYSICAL RESOURCES; `contextual-fire-propagation.test.ts` | Tested with gaps |
| Punto Violeta privacy | No individual data in public views or exports | Redaction in notifications, SVG label, incident JSON/CSV | **3 high bypasses** (KI-01..03); rule duplicated (KI-05) | Fixed commitment | — | Por asignar | `incident-center.test.ts` › CA 12 & 13 (label only) | **Failing in code** |
| X-ray and 500 kg/m² (indicative) | Indicative review threshold, never certification | Threshold and slab conflicts implemented; wording indicative | Disclaimer untested, only for ballast; hard-coded | Fixed commitment | — | Por asignar | `ballast-groups.test.ts`, `subsoil.test.ts`; E2E `xray`, `ballast-groups` (pass) | Tested with gaps |
| `EventDemandConfig` and attendance conservation | Single source of truth; exact conservation | Sync and conservation implemented and tested | 3 bypassing writers (KI-06); the derived `demandInputs` mirror becomes invalid after sync and blocks simulation (KI-28, blocker) | Fixed commitment | — | Por asignar | `demand-sync.test.ts` (Prueba 1-8), `human-behavior-crowd.test.ts` › Prueba A | **Defect open** |

## 11. Final verification

Run on 2026-11-25 at commit `b5be350` (branch `feat/ox-01`), working tree containing only documentation changes. Results are identical to the run at `c104d80`.

| Command | Result | Baseline (`9809b13`) |
|---|---|---|
| `npm run lint` | 0 errors, 2 warnings | 0 errors, 126 warnings |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 | exit 0 |
| `npm run test` (`vitest run`) | 23 files, 117 tests passed | same |
| `npm run build` | pass; `index-Dwc8XZ4O.js` 1,669.08 kB | pass; **same file hash**, so the directive cleanup did not change the bundled output |
| `npm run test:e2e` | 11 passed, 2 skipped (`fixme`), 0 failed | 12 failed |

Pending human actions (cannot be performed or verified by Claude Code):

- Clean install with `npm ci` and a full run of the checks above (package installs are blocked for Claude Code by the project hooks).
- A team member who did not take part in the audit installs and runs the project from the README alone.
- Cross-review of this document.

## 12. Proposed documentation corrections (not applied)

These are proposals for the user; the audit did not edit these files.

`doc/claude/02_ARQUITECTURA_Y_STACK.md`:
- "React + TypeScript estricto" → TypeScript with `strict: false` (strict mode pending, KI-13).
- "Drizzle ORM + Dexie (IndexedDB) + localStorage" as persistence → localStorage is the source of truth; Dexie is written but never read; Drizzle schema is not used at runtime.
- "ESLint (`gts` / Google TypeScript Style)" → ESLint 9 with `typescript-eslint`, `react-hooks` and `eslint-config-prettier`; `gts` is not used.
- "Motor puro … sin dependencias de React ni del DOM" → true for React and DOM, but the engine performs network I/O (`custom-map.ts`), imports a store type (`risk-guidance.ts:7`) and produces HTML/SVG strings.
- `.agents/agents/` with `prompt-engineer` and `oxeye-developer` → does not exist; the agents are under `.claude/agents/`.
- "GameMenu (portada + Wizard 4 pasos)" → the wizard has 5 steps (`GameMenu.tsx:277-283`), the first with an objective picker and a priority sub-step.
- "e2e/ 10 suites Playwright cubriendo flujos completos de UI" → 10 specs; status in section 8.
- `db/` "schema.ts (Drizzle) y repository.ts (persistencia local + JSON)" → add that the schema is unused at runtime.

`doc/claude/04_ESTADO_ACTUAL.md`:
- Last commit on `main` `6fd5f76` → `9809b13` at audit time.
- Add the known-issues summary from section 9 and the E2E status.

`README.md` (outside "🚀 Inicio Rápido", which was updated with the audit):
- Line 114 "TypeScript estricto" → same correction as above.
- The audit did not re-check feature claims elsewhere in the README; `04_ESTADO_ACTUAL.md` already lists outdated counts (150 vs 500 pieces, 27-piece catalogue).

`package.json`:
- `version` stays `0.16.0`. A version scheme and release tagging are a product decision.
