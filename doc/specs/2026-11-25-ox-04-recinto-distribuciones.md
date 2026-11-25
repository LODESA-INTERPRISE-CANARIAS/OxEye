# OX-04 · Venue (Recinto) and several layouts (Distribuciones)

- Date: 2026-11-25
- Slug: `ox-04-recinto-distribuciones`
- Branch: `feat/ox-04-recinto-distribuciones` (from commit `5113cf5`, head of `chore/ox-02-design-decisions`, which contains all of OX-03; OX-04 depends on OX-03)
- Classification: TASK
- Source: OX-04 card pasted by the user on 2026-11-25. Background: `doc/architecture/data-authority-map.md` rows 5–7, ADR-024-001/002/005, OX-03 workspace layer.
- Execution: after approval with `APPROVE IMPLEMENTATION ox-04-recinto-distribuciones`.

## 1. Objective

Separate the reusable **Recinto** (what does not change: perimeter, fixed accesses, restricted zones, X-ray subsoil, permanent elements, base map and its provenance) from the per-event **Distribución** (what is placed for each event), so a venue is stored once and several layouts are prepared without redrawing it.

## 2. Current behaviour (verified, read-only investigation)

- Each OX-03 event stores one v1 `ProjectFile` (`scenes[cristo|constitucion|vega]` + `maps`). Venue and placed items live together in each `Scene` (`src/types/index.ts:836-1016`).
- Venue-like data: `maps[venue]` (bbox, crs, `source`/`retrieved`/`flightDate`/`attribution`, `customLocation`), `boundary` (single polygon), perimeter "add"/"subtract" stored as `passages` with `origin:'boundary-add'` and `reserves` with `origin:'boundary-subtract'` (`MapShell.tsx:1530-1556`), preset reference reserves/passages (`presets.ts:57-170`), `subsoil`, items with `permanent` (only `BoothItem`/`InfrastructureItem`, set in `Inspector.tsx:2258-2276`, read only by `shift.ts`).
- Entrances mix physical data (x/y, `clearWidth`, `accessCategory`, `externalBase`, `streetName`) with per-event operation (`phases`, `role`, weights, `conditionalState`, `maxRatePerHour`) (`types:294-335`).
- Routes A/B/C are **not stored**: computed by `evaluateMedicalResponsePlan` (`stretcher-nav.ts:351-535`) from the scene; gate checks in `risk.ts:362-439`. Heavy load / X-ray: `evaluateHeavyLoadConflicts(scene, map)` (`heat.ts:420-438`) inside `assessRisk`. All take a `Scene` → they work unchanged on a composed venue + layout scene.
- `safetyReview`/`safetyLock` fingerprints already include boundary, subsoil, entrances and items (`risk.ts:77-134`).
- No "installation outside perimeter" check exists: only a passive Inspector note using the item centre and `boundary` only (`Inspector.tsx:1605-1610`).
- Items have stable string `id`, `x`/`y` (percent of venue map), `width`/`depth` (m), `rotation`; **no per-item version**. Fences get `'fence-'+i` only when missing. Duplication creates UUIDs (`selectionActions.ts:235`). Cross-references: `coverGroup`, `attachedCoverId`, `groups.memberIds/parentGroupId`, fence `chainId`, `homeBaseId` (→ entrance), `patrolRouteId` (→ roadPlan/flow).
- `CATALOG_ITEM_LIMIT = 500` (booths + infrastructure + entrances) checked on paste; `validateScene` rejects lists > 500 on load (`presets.ts:1002-1011`).
- `layout.ts` generators are pure, honour `locked`, ignore `permanent`; seeded from `Sidebar.tsx:215`.

## 3. Scope

In scope: card requirements 1–6 and acceptance criteria, in local mode (OX-21 later moves the repositories to the server).

Excluded:
- Changing a venue's base-map extent (bbox) after creation (would require remapping every layout).
- `VAL-MAP-FOOTPRINT-001` (physical footprint vs use space) beyond using the footprint rectangle for the perimeter check.
- ADR-024-003 (geometry engine, PostGIS) and ADR-024-008 (official territorial data): not decided here; no official plans implied (`PLAN-002`).
- Per-item version field (would touch `src/types/index.ts`); the version is the layout's (D6).
- Stored geometry for routes A/B/C (they stay computed per layout, D9).
- Sharing venues across organizations; server persistence (OX-21).

## 4. Decisions taken by the AI Lead (defaults; see §12 for confirmation)

| # | Decision | Reason |
|---|---|---|
| D1 | **Venue content:** base map + provenance, `boundary`, boundary-add/-subtract traces, preset reference reserves/passages, `subperimeter` restricted zones, `subsoil`, **all entrances (physical data)**, and items with `permanent: true`. | Card req. 1 ("perímetro, accesos, zonas restringidas, subsuelo, permanentes, ortofoto"). Card req. 4 treats a new access as a venue change. |
| D2 | **Per-layout access operation:** a layout may override an entrance's operational fields (`phases`, `role`, `entryWeight`/`exitWeight`, `conditionalState`, `maxRatePerHour`) via `accessOverrides[entranceId]`; physical fields stay in the venue. | Gates open/close per event without changing the venue. |
| D3 | **Layout content:** non-permanent booths and infrastructure, fences, flows/corridors, `pendingStock`, groups, interest-zone passages, turning/loading/exclusion reserves, **layout-specific restricted zones**, `serviceRoute`/`vehicleRoute`/`vehicleReference`, `roadPlans`, measurements, annotations, plus its own `safetyReview`/`safetyLock`. | What is placed per event (user answer §12.2). |
| D4 | **Event-level (unchanged in the event payload):** title, dates, days, programme, contacts/companies, scenario and simulation parameters, and **`demandConfig` (one per event)**. The data authority map (row 6, rule 3) is updated: `EventDemandConfig` is owned by the Evento, read by every layout. | Several layouts of one event share the same attendance; a per-layout copy would create competing sources (CLAUDE §5.5). |
| D5 | **Phase:** "fase operativa" = `PhaseKey` (`pre`/`event`/`post`). A layout covers a set of phases (default all three). Invariant: for each (event, venue, phase) at most one `current` layout; promoting a layout to `current` demotes overlapping current layouts to `proposal`, atomically. Item `phaseTags` keep working inside a layout. | Card req. 5 without splitting today's content. |
| D6 | **Version:** each layout has an integer `version`, incremented on every persisted content change (optimistic-concurrency field of ADR-024-002). VAL-MAP-CORE-001 checks it is unchanged after reopen. The venue has its own `version`. | Avoids changing central types. |
| D7 | **Two editing modes:** «Editar distribución» (default) and «Editar recinto». The editor keeps a single composed `Scene`; elements of the other part are shown **locked** (runtime set of ids, no type change). Venue-only tools (perimeter, subsoil, restricted zones, entrances, `permanent` checkbox) are enabled only in venue mode. | No silent venue changes from layout editing (card req. 4). |
| D8 | **Affected layouts:** saving a venue change bumps `venue.version` and shows the list of layouts of that venue with `baseVenueVersion < venue.version` (all events of the organization). They are not modified; they show «Recinto modificado: revisar» until reopened and re-evaluated; such a layout cannot be promoted to `proposal`/`current` until re-evaluated. | Card req. 4 and INV-014 (no inherited conformity). |
| D9 | **Promotion gate («confirmar como válida»)**: promoting a layout to `proposal` or `current` re-runs `assessRisk` on the composed scene and is **blocked** when: an installation is outside the effective perimeter (new check, D10); there is any critical gate/emergency-access issue; heavy-load/X-ray conflicts are critical; the medical response plan (routes A/B/C) is not satisfied. The dialog lists each cause. Drafts can always be saved. | Card non-negotiables; VAL-MAP-BOUNDARY-001. |
| D10 | **Perimeter check:** new pure function `installationPerimeterStatus(item, scene, map)` using the four footprint corners (`rect()`) against the effective perimeter (boundary ∪ boundary-add − boundary-subtract); new risk issue; the Inspector note becomes an explanation of the cause. No silent move. | VAL-MAP-BOUNDARY-001. |
| D11 | **Safety review per layout:** `safetyReview`/`safetyLock` live in the layout and are **never copied** on duplicate or across layouts; X-ray/heavy-load is re-evaluated on the composed scene of each layout. | Non-negotiable of the card. |
| D12 | **Duplicate:** new UUIDs for every layout item; `originItemIds: Record<newId, sourceId>` and `originLayoutId` stored in the layout; internal references (`coverGroup`, `attachedCoverId`, groups, `chainId`, layout `patrolRouteId`) are remapped; references to venue ids (`homeBaseId` → entrance) are kept. New layout starts as `draft`, version 1, no safety review. **Blank** layout = venue only. | Card req. 3 and 6. |
| D13 | **Venue scope and reuse:** `Venue` belongs to the organization and is reusable by events. The wizard gets an option «Usar un recinto guardado» (skips perimeter drawing). | Card req. 1; acceptance 1. |
| D14 | **Persistence:** Dexie `version(3)` adds `venues` and `layouts`; an event references its venues and active layout. The event payload keeps event-level data; its venue/layout fields become a derived cache and are ignored on open (recomposed from venue + layout). Export stays a composed v1 `ProjectFile` of the active layout; import goes through the migration. | Single source per entity (INV-003). |
| D15 | **Migration (lazy, on open, deterministic ids):** an event without layouts is split per venue scene with content (`eventVenues`) into one `Venue` + one `current` layout (all phases, version 1). Venue id = deterministic hash of the venue content in that org, so identical venues dedupe across events and re-running creates nothing new. | Acceptance «proyecto antiguo → recinto + distribución vigente»; INV-001/019. |
| D16 | **Permissions:** new action `venue.edit` (org admin, event coordination); layout create/duplicate/promote use `event.edit`. Matrix tests updated. | Reuses OX-03 module. |
| D17 | **500-item limit** checked on the composed scene (venue permanent + layout) when adding, duplicating or composing; composition never produces a scene `validateScene` would reject. | Card NFR; avoids unopenable events. |
| D18 | **Displayed precision (MAP-009):** new UI shows metres with at most 1 decimal and percentages as integers. | Card NFR. |

## 5. Technical approach

1. **Types** (`src/types/venue.ts`, new): `Venue {id, orgId, name, version, map, boundary, traces, subsoil, entrances, permanentItems, updatedAt}`; `Layout {id, orgId, eventId, venueId, name, state, phases, version, baseVenueVersion, originLayoutId?, originItemIds?, content, accessOverrides, safetyReview?, safetyLock?, updatedAt}`; `LayoutState`.
2. **Pure engine** (`src/engine/workspace/venue-layout.ts`): `composeScene(venue, layout, eventScene)`, `splitScene(scene, venue, mode)`, `duplicateLayout(layout, idGen)`, `affectedLayouts(venue, layouts)`, `promoteLayout(layouts, id, phases)` (one-current invariant), `migrateEventPayload(project, orgId)`. Only imports `src/types/*` and existing pure geometry helpers.
3. **Cartography** (`src/engine/cartography/perimeter-status.ts`): effective perimeter + `installationPerimeterStatus`; **risk issue** added in `src/engine/emergency/risk.ts` (single owner).
4. **DB**: `src/db/repository.ts` (Dexie v3 schema only), `src/db/workspace-repository.ts` (venue/layout CRUD, transactional promote), `src/db/workspace-migration.ts` (D15).
5. **Store**: `useWorkspaceStore` — `activeVenueId`, `activeLayoutId`, `editMode`, `openLayout`, `createLayout(blank|duplicate)`, `renameLayout`, `promoteLayout`, `archiveLayout`, `saveVenue` (returns affected list); compose on open, split on flush. `useProjectStore`: additive only (locked-id set for composed view, readOnly per mode).
6. **UI** (Spanish; terminology «Recinto», «Distribución», «Fase operativa»): new `src/components/venue/` components — layouts panel (list, state badges, version, create blank/duplicate, promote/archive with gate dialog), venue mode toggle, affected-layouts dialog; ContextHeader shows *Recinto › Distribución*; GameMenu wizard «Usar un recinto guardado». Hotspots, single owner: `MapShell.tsx` (gate venue-only tools by mode), `Inspector.tsx` (perimeter explanation, `permanent` checkbox only in venue mode).
7. **App.tsx**: at most the existing reset effect extended to `activeLayoutId` (sim reset on layout switch).
8. **Docs**: data authority map row 6/rule 3 (D4) and a short note on venue/layout ownership.

## 6. Domain invariants

| Invariant | Impact | Control |
|---|---|---|
| 5.1 Routes A/B/C | Computed per composed layout; never inherited | D9 gate + D11; regression `stretcher-evacuation`, `emergency-dispatch` |
| 5.2 Carpa Amarilla | Items copied verbatim on duplicate/split | Unit round-trip test on a scene with `yellow_tent` |
| 5.3 Punto Violeta | No new export or view; export remains the composed v1 file | safety-auditor review |
| 5.4 X-ray / 500 kg/m² | Subsoil moves to venue; evaluation per layout; wording stays "indicative" | D11; regression `subsoil`, `ballast-groups` |
| 5.5 EventDemandConfig | Stays one per event (D4); composition never forks it | Unit test: compose/split keep `demandConfig` identical; `demand-sync` regression |
| Reproducibility | Composition deterministic; no new randomness | `seed-reproducibility` |

## 7. Agents and ownership (serialized where shared)

| Step | Owner | Files |
|---|---|---|
| 1 Types + pure compose/split/duplicate/promote/migrate + unit tests | AI Lead | `src/types/venue.ts`, `src/engine/workspace/venue-layout.ts` |
| 2 Perimeter status + risk issue (parallel with 1) | `cartography-engineer` | `src/engine/cartography/perimeter-status.ts`, `src/engine/emergency/risk.ts` |
| 3 DB + migration + store wiring (serial after 1) | AI Lead | `src/db/*`, `src/store/*`, `src/App.tsx` (minimal) |
| 4 UI (after 3) | `ui-engineer` (single owner of MapShell/Inspector) | `src/components/venue/**`, `src/components/header/**`, `src/components/menu/**`, `src/components/map/MapShell.tsx`, `src/components/map/Inspector.tsx`, styles |
| 5 Tests | `qa-engineer` | `tests/unit/**`, `tests/e2e/**` |
| 6 Review | `safety-auditor`, `code-reviewer` | read-only |

## 8. Verification

- Unit: compose ∘ split round-trip (identity, positions, rotation, dimensions); duplicate (new ids, `originItemIds`, remapped references, no safety review copied); one-current invariant per phase; affected layouts by version; migration deterministic (twice → no duplicates; identical venues dedupe); perimeter status (inside, corner outside, inside a subtract hole); permission matrix with `venue.edit`.
- Integration: VAL-MAP-CORE-001 — insert tent, rotate 90°, move 4 m, save, reinit store on the same repo → same id/position/rotation/dimensions and layout version.
- E2E: create venue (Plaza del Cristo) → two layouts without redrawing → promote one to current; add an access in venue mode → affected list shown; an installation outside the perimeter blocks promotion with an explanation; old project import → venue + one current layout.
- Regression: full unit suite (`subsoil`, `ballast-groups`, `stretcher-evacuation`, `emergency-dispatch`, `demand-sync`, `seed-reproducibility`), full e2e, `tsc`, lint, build; manual check of SVG responsiveness with ~500 items.

## 9. Risks and rollback

- Composition/split errors could lose items → round-trip tests before wiring; the event payload keeps the last composed copy as a fallback cache.
- Coordinates are percent of the venue map: excluded bbox changes (§3).
- Hotspot edits (MapShell, Inspector) → single owner, small diffs.
- Existing OX-03 events migrate lazily; rollback = revert branch (v2 tables untouched; v3 tables ignored by older code).

## 10. Acceptance criteria

- [ ] Venue «Plaza del Cristo» saved; two different layouts created without redrawing the perimeter.
- [ ] VAL-MAP-CORE-001 passes (identity, position, rotation, dimensions, layout version after save/reopen).
- [ ] VAL-MAP-BOUNDARY-001 passes (outside installation cannot be confirmed; UI explains why).
- [ ] Adding an access to the venue lists the affected layouts.
- [ ] An old project opens as venue + one current layout.
- [ ] X-ray/heavy-load and routes A/B/C evaluated per layout; none inherited; promotion blocked with explanation when missing.
- [ ] No regression against the baseline.

## 11. Baseline to record at execution start

`tsc`, `vitest` (181 at OX-03 end), `playwright` (14 passed / 2 skipped), lint (0 errors / 2 pre-existing warnings), build.

## 12. Product questions (answered by the user, 2026-11-25)

Definition confirmed by the user: the **Distribución** is everything placed on the venue for one event, in one version of the set-up; event-level data (dates, programme, demand) is shared by all layouts of the event.

1. All physical entrances belong to the venue, with per-layout operational overrides (D1, D2) — **yes**.
2. Restricted zones in the venue; `roadPlans`, measurements and annotations in each layout — **yes**, and **a layout may also have its own restricted zones** (e.g. a concert backstage). Rule: a restricted zone drawn in «Editar recinto» belongs to the venue; one drawn in «Editar distribución» belongs to that layout only (D1, D3, D7).
3. `EventDemandConfig` one per event (D4), updating the data authority map — **yes**.
4. Phase = pre/event/post; **a layout's final goal is to cover several phases** (D5: default all three; one `current` per event, venue and phase) — **yes**.
5. Items marked `permanent` are venue content, changed only in venue mode (D1, D7) — **yes** (card assumption confirmed).
6. «Confirmar como válida» = gate on promotion to proposal/current; "versión" = layout version (D6, D9) — **yes**.
7. Who edits the venue — **not known**. D16 is applied as a **provisional** default (organization administration and event coordination), isolated in the permission matrix so it can change in OX-20 / OX-24 without code changes elsewhere.

Rule for execution: the OX-04 card is the source of truth; any deviation found during implementation is reported instead of silently reinterpreted.

## Allowed paths

- `doc/specs/2026-11-25-ox-04-recinto-distribuciones.md`
- `doc/architecture/data-authority-map.md`
- `src/types/venue.ts`
- `src/engine/workspace/**`
- `src/engine/cartography/perimeter-status.ts`
- `src/engine/emergency/risk.ts`
- `src/db/repository.ts`
- `src/db/workspace-repository.ts`
- `src/db/workspace-migration.ts`
- `src/store/useWorkspaceStore.ts`
- `src/store/useProjectStore.ts`
- `src/App.tsx`
- `src/components/venue/**`
- `src/components/header/**`
- `src/components/menu/**`
- `src/components/map/MapShell.tsx`
- `src/components/map/Inspector.tsx`
- `src/styles/layout.css`
- `src/styles/game-menu.css`
- `src/styles/index.css`
- `tests/unit/**`
- `tests/e2e/**`
