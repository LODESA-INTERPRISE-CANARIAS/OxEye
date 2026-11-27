# Cabecera OxEye · execution log

## Decisions

- Supplier portal brand left as is («Petición de presupuesto · con OxEye»): there the organisation is the title on purpose.
- Phone top bar shows «OxEye» (room for one word next to the sync chip and search).
- The swirl is a filled shape, not a stroke, so a stroke-dash «drawing» is not possible; instead it turns into place (rotate + fade), the iris opens after, then the mark breathes. `BrandSymbol` gained class hooks (`ox-symbol__swirl`, `__frame`, `__iris`) for it; no visual change elsewhere.
- Backdrop isolines are inline SVG (not `ContourTexture` from `logistics/ui`) so the eager hub bundle does not pull the logistics UI module.
- Load-error screen reuses the backdrop and mark; its title stays «No se ha podido abrir el Gestor logístico».
- Visual spec captures the loading layer by holding the lazy chunk, with reduced motion so frames are stable.

## Scope extensions
