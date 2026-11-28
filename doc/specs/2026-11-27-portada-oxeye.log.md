# Portada OxEye · execution log

## Baseline (branch `feat/portada-oxeye` at `dc05874`, Windows, before any change)

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npm run lint`: 0 errors, 2 warnings (`ComparisonDialog.tsx` exhaustive-deps, `response-model.ts` unused `resolveAccessCategory`).
- `npx vitest run`: 57 files, 694 tests, all passing.
- E2E on the affected specs (`app`, `first-run-flow`, `onboarding-spawns`, `palettes`, `programme-contacts`, `tutorial`, `logistics/entry-and-session`, `logistics/navigation`, `logistics/supplier`): 38 passed, 1 skipped, 4 failed, all 4 in `logistics/entry-and-session.spec.ts` (`#lx-login-form` never visible after opening the Gestor from the hub). Pre-existing: the Gestor's login form no longer carries that id (only the class `lx-login-form`, `AccountLinkPanel.tsx`), so those assertions are stale, unrelated to this work.

## Decisions

- `/` with an empty path; `/simulador/modelo` mirrors the open workspace (`menuOpen === false`), so Back from the workspace returns to `/simulador`; a model created from the wizard replaces the wizard's entry, so Back does not reopen the wizard.
- Back from the workspace reopens the menu by clicking the workspace's own `#main-menu` button: the simulation's pause lives in `App.tsx` state (`onPauseSimulation`), out of scope, and the header button is the existing path that pauses and opens the menu together.
- The wizard mounts fresh on each visit (starts at step 1, as the old «Crear nuevo modelo» reset did); its first-step back button reads «Volver al simulador» instead of «Menú principal». Added a 5-dot step indicator; no field or logic change.
- Ajustes apply and persist immediately (no «Guardar y volver» step): the palette preview was already live, and a settings screen that loses changes on Back is a trap now that Back is a real navigation. `#prefs-save` stays as «Listo».
- The hub imports `src/styles/logistics/tokens.css` (read-only use) so the `.lx` tokens exist before the Gestor's lazy chunk loads.
- Tab title follows the screen («Ajustes · OxEye», …).
- The Node-script and `sed` routes for carving the wizard out were blocked by the hooks; the move was done with the editor tools, verbatim.

- Baseline correction (QA, code-reviewer): `#lx-login-form` does exist (`LoginScreen.tsx:212`); the 4 baseline failures in `entry-and-session` are load flakiness of the Gestor's lazy chunk on a cold dev server with parallel workers (the failing set changes per run; 17/17 pass with `--workers=1`). Not introduced, not fixed here (would need a Playwright config change).
- «Guardar y salir» marks the project as saved (`hasSavedProject: true`) when the save succeeded, so «Volver» offers «Continuar» without a reload (before, it stayed disabled until reload). Done in `SimulatorSection` and not in the store's `save()`, because autosave also calls `save()` and would enable «Continuar» on a first run. Coupling noted: success is read from `saveStatusText === 'Guardado en este navegador'`; `save()` returning a result would be cleaner (out of scope, `src/store`).
- The wizard ignores a finished map download if it was left meanwhile (Back during «Preparando cartografía…»), so it never replaces the active model behind the user's back.
- «Volver al simulador» steps back in the history when the wizard was opened from the Simulador, so Back never reopens an empty wizard.
- Vector's Gestor card uses a deeper shade of its accent (≈5.3:1 with its light text; the plain accent gave ≈4.1:1).
- «Movimiento reducido» copy says what it really covers (portada and simulator map); the Gestor follows the system preference only.
- Known limit, out of scope (root file): `index.html` links the web manifest with a relative `./logistics/manifest.webmanifest`, which does not resolve on two-level routes (`/simulador/modelo`, `/simulador/nuevo`). Harmless today (the Gestor, the only installable part, lives at `/#logistica`; the favicon is replaced at runtime by `applyPalette` with a data URL). Fix with `%BASE_URL%` in step 2, which touches the manifest anyway.
- `DEFAULT_PREFERENCES` in `SettingsScreen` repeats the defaults in `src/db/repository.ts`; exporting them from there is left for a task that may touch `src/db`.

## Scope extensions
