---
name: oxeye-invariants
description: "OxEye domain-invariant checks. Use when planning or reviewing any change that touches emergency routes, Carpa Amarilla, Punto Violeta privacy, X-ray or heavy-load analysis, event demand and attendance, persistence format, simulation randomness, or user-facing safety wording. Maps changed paths to invariants, code anchors, static checks and covering tests."
---

# OxEye invariants: anchors and checks

The "Domain invariants" section of CLAUDE.md defines the invariants and is authoritative. This skill only maps them to code and verification steps. Anchors were verified at commit `63073a1`. If an anchor is missing, report it; do not assume it moved.

## 1. Trigger table

Check every invariant whose trigger matches a changed path or the plan topic. Also check any **new** producer or consumer of the data an invariant protects.

| Changed path or topic | Invariant |
|---|---|
| `src/engine/emergency/{stretcher-nav,vehicle-dispatch,response-model}.ts`, `src/engine/cartography/route-network.ts`, `src/engine/mobility/vehicle-system.ts`, anything mentioning `routeA`, `routeB` or `routeC` | I1 Emergency routes |
| `yellow_tent`, "Carpa Amarilla", accessibility or accompaniment requests | I2 Carpa Amarilla |
| `violet_point`, `sensitive`, `privacyMode`, incident panels, exports, reports, logging | I3 Punto Violeta privacy |
| `src/engine/planning/ballast.ts`, `src/engine/subsoil/**`, X-ray UI, load wording | I4 Heavy-load threshold |
| `src/engine/planning/{event-demand,demand}.ts`, `src/engine/crowd/attendance-model.ts`, `EventDemandConfig` | I5 Demand and attendance |
| `src/db/**`, import/export, project files | I6 Persistence format |
| Any `src/engine/**` | I7 Determinism |
| UI copy, reports, PDFs, docs shown to users | I8 No certification claims |

## 2. Invariants

### I1 Emergency routes
- Must hold: `routeA` is vehicular access, `routeB` is medical access on foot and `routeC` is stretcher evacuation. Meanings are never swapped, merged or reused.
- Anchors: `src/engine/emergency/stretcher-nav.ts` (most references), `vehicle-dispatch.ts`, `response-model.ts`, `cartography/route-network.ts`, `mobility/vehicle-system.ts`.
- Static check: `Grep "routeA|routeB|routeC"` across `src/`, then confirm that every new use matches its meaning (vehicle logic reads A, on-foot medical logic reads B, stretcher logic reads C).
- Tests: `stretcher-evacuation`, `emergency-dispatch`, `emergency-access-fix`, `vehicle-mobility`, `route-network`.

### I2 Carpa Amarilla
- Must hold: the `yellow_tent` kind and the "Carpa Amarilla" name and semantics (accompaniment, accessibility, calm point, staffed by auxiliaries) are preserved. It is not renamed, removed or reinterpreted.
- Anchors: `src/data/catalog.ts` (catalog entry), `src/data/inventory-meta.ts`, `src/engine/emergency/{contextual-incidents,incident-center,fire-model,emergency-lab}.ts`, `src/engine/crowd/everyday-interactions.ts`, and the labels in `Sidebar.tsx`, `MapShell.tsx` and `SimulationInspector.tsx`.
- Static check: `Grep -i "yellow_tent|carpa amarilla"`, and compare the set of files and labels with the baseline.
- Tests: `incident-center`, `contextual-fire-propagation`.

### I3 Punto Violeta privacy
- Must hold: violet-point incident details are gated by `privacyMode` (`'public' | 'authorized_synthetic'`) and the `sensitive` flags. Nothing new displays, exports or logs those details without that gating, and the condition is not re-implemented elsewhere.
- Anchors: `src/engine/emergency/incident-center.ts` (`sensitive` field and entry), `incident-dashboard.ts`, `contextual-incidents.ts` (`sensitive: true` templates), `emergency-lab.ts` (`sensitive: cat === 'violet_point'`), `src/types/index.ts` (`sensitive?` fields), `src/App.tsx` (`privacyMode` state) and `src/components/simulation/IncidentAnalysisPanel.tsx`.
- Static check: `Grep "violet_point|sensitive|privacyMode"`. For each new consumer, trace the data back to a gate. Check `JSON.stringify`, export, download, `console.*` and report paths.
- Tests: `incident-center`, `contextual-fire-propagation`.

### I4 Heavy-load threshold
- Must hold: `HEAVY_LOAD_THRESHOLD_KG_M2 = 500` (`src/engine/planning/ballast.ts:21`) is an **indicative review threshold**. Wording never calls it certified, a maximum or a structural limit. The X-ray semantics are unchanged.
- Static check: `Grep "HEAVY_LOAD_THRESHOLD_KG_M2|kg/m"`, plus `Grep -i "certific|máxim|garantiz|seguro"` near load or X-ray text.
- Tests: `ballast-groups`, `subsoil`.

### I5 Demand and attendance
- Must hold: `EventDemandConfig` (`src/types/index.ts:690`) is the single source of truth for demand. Attendance is conserved: totals are neither created nor lost by distribution. No competing configuration source is introduced.
- Anchors: `src/engine/planning/event-demand.ts`, `demand.ts`, `src/engine/crowd/attendance-model.ts`.
- Static check: `Grep "EventDemandConfig"` for new producers. Look for new state fields that duplicate demand values.
- Tests: `demand-sync`, `engine`.

### I6 Persistence format
- Must hold: the saved format identifier `'ojo-de-buey'` (`src/db/repository.ts`, `src/db/schema.ts`) and version handling stay compatible. Older saves still load.
- Static check: `Grep "ojo-de-buey|version"` in `src/db/`.

### I7 Determinism
- Must hold: simulation outcomes depend only on the initial conditions and the scenario seed. Randomness affecting simulation uses `rng(seed)` from `src/engine/crowd/grid-flow.ts:13`, or a generator derived from it.
- Baseline at `63073a1`: `Grep "Math\.random|Date\.now\(|performance\.now\(|crypto\.getRandomValues|crypto\.randomUUID" src/engine` gives **12** matches. They are identifiers (`randomUUID` in `groups`, `event-engine`, `response-example`, `ballast`, `contacts`, `inventory`; `event-model.ts:138` combining `Date.now` and `Math.random` in an id; `incident-center.ts:756` with `Date.now` in an id) and rendering blink timers (`performance.now` in `response-model.ts:2069-2071` and `vehicle-dispatch.ts:1163`). Any new match needs a justification that it does not affect simulation results.
- Tests: `seed-reproducibility`, `human-behavior-crowd`.

### I8 No certification claims
- Must hold: outputs are presented as decision support. Simulations are not guaranteed predictions, thresholds are indicative and editable, and nothing claims regulatory compliance without verified evidence.
- Static check: review new user-facing strings for "certificado", "cumple", "garantiza", "seguro" and "homologado".

## 3. Commands

Run the covering tests for each triggered invariant:

```
npx vitest run tests/unit/<file>.test.ts
```

When I7 is triggered, always include `tests/unit/seed-reproducibility.test.ts`. Agents without a shell (safety-auditor) list the commands for the AI Lead to run instead.

## 4. Report format

| Invariant | Triggered by | Evidence (file:line, grep or test result) | Status |
|---|---|---|---|

The status is one of `holds`, `at risk`, `violated` or `not affected`. Each `at risk` or `violated` row gets a one-line recommendation. State explicitly which checks were not performed.
