/**
 * The OxEye symbol as an inline SVG. Shared brand primitive for the
 * simulation and the Logistics Manager; geometry lives in
 * `src/data/brandSymbol.ts`.
 *
 * - `tile`: the symbol on a rounded square (app-icon look). Colours come from
 *   CSS: the tile uses `fill` of `.ox-symbol__tile`, the symbol uses
 *   `currentColor`, so each module styles it with its own variables.
 * - `glyph`: the symbol alone in `currentColor`, for small inline marks and
 *   print.
 * The iris highlight is a hole, so it shows the tile or the page behind it.
 */
import React from 'react';
import {
  BRAND_CLIP_H1,
  BRAND_CLIP_H2,
  BRAND_CUTS,
  BRAND_CUT_WIDTH,
  BRAND_FRAME,
  BRAND_FRAME_GAP,
  BRAND_FRAME_OUTER,
  BRAND_HIGHLIGHT,
  BRAND_IRIS,
  BRAND_MASK_BOX,
  BRAND_SWIRL_A,
  BRAND_SWIRL_B,
  BRAND_SYMBOL_ASPECT,
  BRAND_SYMBOL_VIEWBOX,
  BRAND_TILE,
  BRAND_TILE_VIEWBOX,
} from '../../data/brandSymbol';

export interface BrandSymbolProps {
  /** Width in px; a tile is square, a glyph keeps the symbol's aspect. */
  size: number;
  variant?: 'tile' | 'glyph';
  className?: string;
  /** Optional inline colours (e.g. the simulation header's palette tones). */
  color?: string;
  tileColor?: string;
}

export const BrandSymbol: React.FC<BrandSymbolProps> = ({
  size,
  variant = 'tile',
  className,
  color,
  tileColor,
}) => {
  // useId returns ":r1:"-style ids; strip the colons so url(#…) stays valid.
  const p = `oxs${React.useId().replace(/:/g, '')}`;
  const tile = variant === 'tile';
  const b = BRAND_MASK_BOX;
  const white = (
    <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="#fff" />
  );
  return (
    <svg
      className={['ox-symbol', `ox-symbol--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      width={size}
      height={tile ? size : Math.round(size * BRAND_SYMBOL_ASPECT)}
      viewBox={tile ? BRAND_TILE_VIEWBOX : BRAND_SYMBOL_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      style={color ? {color} : undefined}
    >
      {tile && (
        <rect
          className="ox-symbol__tile"
          x={BRAND_TILE.x}
          y={BRAND_TILE.y}
          width={BRAND_TILE.size}
          height={BRAND_TILE.size}
          rx={BRAND_TILE.radius}
          fill={tileColor}
        />
      )}
      <defs>
        <clipPath id={`${p}h1`}>
          <path d={BRAND_CLIP_H1} />
        </clipPath>
        <clipPath id={`${p}h2`}>
          <path d={BRAND_CLIP_H2} />
        </clipPath>
        <mask id={`${p}k`} maskUnits="userSpaceOnUse" {...b}>
          {white}
          <path
            d={BRAND_FRAME_OUTER}
            fill="#000"
            stroke="#000"
            strokeWidth={BRAND_FRAME_GAP}
          />
        </mask>
        <mask id={`${p}m`} maskUnits="userSpaceOnUse" {...b}>
          {white}
          {BRAND_CUTS.map(c => (
            <line
              key={c.x1}
              {...c}
              stroke="#000"
              strokeWidth={BRAND_CUT_WIDTH}
            />
          ))}
        </mask>
        <mask id={`${p}i`} maskUnits="userSpaceOnUse" {...b}>
          {white}
          <circle {...BRAND_HIGHLIGHT} fill="#000" />
        </mask>
      </defs>
      <g className="ox-symbol__mark" fill="currentColor">
        <g mask={`url(#${p}m)`}>
          <g mask={`url(#${p}k)`}>
            <path d={BRAND_SWIRL_A} clipPath={`url(#${p}h1)`} />
            <path d={BRAND_SWIRL_B} clipPath={`url(#${p}h2)`} />
          </g>
          <path d={BRAND_FRAME} fillRule="evenodd" />
        </g>
        <circle {...BRAND_IRIS} mask={`url(#${p}i)`} />
      </g>
    </svg>
  );
};
