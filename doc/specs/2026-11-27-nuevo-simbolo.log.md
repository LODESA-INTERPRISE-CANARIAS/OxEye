# Nuevo símbolo · execution log

## Decisions

- Geometry copied by hand into `src/data/brandSymbol.ts` (Node scripts are blocked by the guard); the duplicate frame clipped by `sA` and the unused `sB` clip were dropped: same pixels, half the markup.
- The iris highlight is a mask hole instead of a second circle: on the tile it shows the accent colour (like the supplied file), without a tile it is transparent, so one drawing serves every background and print.
- One shared React primitive `BrandSymbol` (depends only on `src/data/brandSymbol.ts`) used by `EyeMark`, the simulation header and the loading screen, instead of three copies of the JSX; ids from `React.useId()`.

## Scope extensions

- `src/components/common/BrandSymbol.tsx`: shared React rendering of the symbol for both modules (brand primitive, no module internals).
