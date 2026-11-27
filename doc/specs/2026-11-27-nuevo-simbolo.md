# Nuevo símbolo · replace the old eye mark with the new Ox Eye symbol

- Slug: `nuevo-simbolo`
- Branch: `feat/nuevo-simbolo` (created from `feat/gestor-logistico` at `3fcded2`)
- Size: small, UI only. No data, API, persistence or invariant is touched.
- Source: two SVGs supplied by the user on 2026-11-27, `public/assets/logo/oxeye-simbolo-tinta.svg` (ink #161718 on light) and `oxeye-simbolo-cal.svg` (lime #F7F6F3 on dark).

## Goal and intended experience

Wherever a person sees the old eye (rounded tile with a lens-shaped eye), they now see the new symbol, mainly in the Gestor logístico and in the same places and sizes as before, so the brand reads as one thing without moving any layout. It must work in all six palettes, in print (work orders, day report) and as the browser tab icon.

## Approach

1. **One symbol, one source.** Add `src/data/brandSymbol.ts` with the symbol geometry (outer swirl halves, frame, iris, highlight, masks), copied from the supplied SVG with the unused `sB` clip removed. Both React and the favicon string build from it, so there is a single copy of the paths.
2. **`EyeMark` keeps its API** (`size`, `className`) so its ~15 call sites stay untouched. Inside, it renders:
   - default `tile` variant: the symbol in `--lx-on-accent` on a rounded `--lx-accent` tile (the same role the old tile had), highlight dot in `--lx-accent`;
   - `variant="glyph"`: the symbol alone in the current text colour (`currentColor`) with a transparent highlight hole, for small inline marks ("Generada por Ox Eye", renewal mark) and print, where a tile would be a black blob.
   - Mask/clip ids come from `React.useId()` so several marks on one page never collide.
3. **Print**: `closing.css` / work-order print rules switch to the ink look (glyph in `CanvasText`, no filled tile).
4. **Loading screen** (`LogisticsLoading.tsx`) and **simulation header** (`Header.tsx`) reuse the same symbol (header colours from `getPaletteLogoColors`, so palettes keep their logo tones).
5. **Favicon**: `applyPalette` builds the new symbol on the palette tile; `public/favicon.svg` is regenerated with the default palette (also used by the Gestor's web manifest).
6. The symbol's aspect is 1040×760; inside the square tile it is fitted with padding so it is not cramped at 30–38 px.

## Included improvements

- Accessible name: the brand blocks keep their visible text; the mark stays `aria-hidden`.
- Small-size legibility: at ≤20 px the glyph variant is used instead of the tile (the fine strokes of the swirl vanish inside a tile that small).

## Ideas for later

- PNG icons (192/512, maskable) for installing the Gestor as an app on phones.
- A full horizontal lockup (symbol + «Ox Eye» wordmark) for the hub cover once a wordmark exists.

## Allowed paths

- `src/data/brandSymbol.ts`
- `src/data/palettes.ts`
- `src/logistics/ui/icons.tsx`
- `src/logistics/LogisticsLoading.tsx`
- `src/logistics/offers/**`
- `src/logistics/mockups/**`
- `src/logistics/orders/**`
- `src/logistics/closing/**`
- `src/components/header/Header.tsx`
- `src/styles/logistics/**`
- `src/styles/layout.css`
- `public/favicon.svg`
- `public/assets/logo/**`
- `tests/e2e/visual-palettes.spec.ts`
- `doc/specs/2026-11-27-nuevo-simbolo.log.md`

## Acceptance criteria

- No trace of the old eye path (`M9 32Q32 6 55 32Q32 58 9 32Z`) remains in `src/` or `public/`.
- Sidebar, phone top bar, access/gate screens, supplier portal, loading/error screen, work order, day report, renewal mark and simulation header show the new symbol at their previous sizes, without layout shift.
- Correct contrast in the six palettes; print preview shows an ink symbol.
- Tab icon shows the new symbol and follows the palette.

## Verification

Baseline first; then `tsc`, lint, unit tests, `npm run build`, and `tests/e2e/visual-palettes.spec.ts` screenshots of the Gestor in all six palettes, opened and inspected. Local commit `FEAT: nuevo símbolo de Ox Eye`.
