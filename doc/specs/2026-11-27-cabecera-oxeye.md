# Cabecera OxEye · brand first, module second, and a better loading screen

- Slug: `cabecera-oxeye`
- Branch: `feat/cabecera-oxeye` (created from `chore/marca-oxeye` at `1ae5e1f`)
- Size: small, UI only.

## Goal and intended experience

The brand block reads like a product: **OxEye** as the title (Georgia), **Gestor logístico** as the subtitle. The same order on the loading screen, which also gets the editorial-cartographic look of the rest of the module: quiet, detailed, still readable in a second.

## Approach

1. Brand block (sidebar, gate screens, supplier portal, mock-ups kit): swap the lines, `<strong>OxEye</strong>` / `<span>Gestor logístico</span>`. The phone top bar keeps «Gestor logístico» only if there is no room for both; otherwise it shows «OxEye».
2. Loading screen (`LogisticsLoading.tsx`, `loading.css`), keeping it tiny because it is eager in the hub bundle:
   - Title «OxEye» (serif), small-caps eyebrow «Gestor logístico», status «Abriendo…».
   - Behind it, faint cartographic contour lines (isolines, like the sidebar texture) and a thin coordinate line «La Laguna · 28°29′ N 16°19′ O».
   - The symbol settles in: the swirl draws itself once (stroke dash), the iris fades in; afterwards a slow, subtle breathing. All motion disabled under `prefers-reduced-motion`.
   - Same layout for the load-error state, with its buttons.
   - Works in all six palettes (only CSS variables).
3. Tests that assert the old order or text are updated.

## Allowed paths

- `src/logistics/LogisticsLoading.tsx`
- `src/logistics/shell/**`
- `src/logistics/screens/**`
- `src/logistics/supplier/**`
- `src/logistics/SupplierRoot.tsx`
- `src/logistics/mockups/**`
- `src/components/common/BrandSymbol.tsx`
- `src/styles/logistics/**`
- `tests/e2e/**`
- `tests/unit/**`
- `doc/specs/2026-11-27-cabecera-oxeye.log.md`

## Acceptance criteria

- Sidebar and gate show «OxEye» above «Gestor logístico»; loading screen too.
- Loading screen captured in the six palettes and inspected; no motion with reduced motion.

## Verification

tsc, lint, unit, build, affected e2e, visual palettes spec extended with the loading screen. Local commit.
