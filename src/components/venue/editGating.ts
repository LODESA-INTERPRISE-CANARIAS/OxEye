/**
 * Venue-only map tools in «Editar distribución» (OX-04 D7). In layout mode the
 * venue part is restored from its stored record on save, so these tools would
 * silently lose their result; the map refuses them with a hint instead.
 * Presentation guard only: which part a new element is stored in is decided
 * by `splitScene` (engine/workspace/venue-layout).
 */

export const ACCESS_HINT = 'Los accesos se añaden en «Editar recinto».';
export const PERIMETER_HINT = 'El perímetro del recinto se edita en «Editar recinto».';
export const SUBSOIL_HINT = 'El subsuelo (Rayos X) se edita en «Editar recinto».';

/**
 * Hint for a tool that may not be used in layout mode, or `null` when allowed.
 * `venueHasPerimeter`: the first perimeter of a venue may still be drawn while
 * editing a layout (onboarding). `stockIsGate`: the tool places a pending stock
 * piece that is an access.
 */
export function venueOnlyToolHint(
  tool: string,
  opts: {venueHasPerimeter: boolean; stockIsGate?: boolean}
): string | null {
  if (tool === 'boundary') return opts.venueHasPerimeter ? PERIMETER_HINT : null;
  if (tool.startsWith('xray:') && tool !== 'xray:select') return SUBSOIL_HINT;
  if (tool === 'gateLine' || tool === 'vehicleBase' || tool === 'place:gate') return ACCESS_HINT;
  if (tool.startsWith('stock:') && opts.stockIsGate) return ACCESS_HINT;
  return null;
}
