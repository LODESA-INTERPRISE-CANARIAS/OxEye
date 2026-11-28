/**
 * The OxEye symbol for the Portada hero, drawn inline from the shared
 * geometry (`src/data/brandSymbol.ts`, same construction as `BrandSymbol`)
 * so each part can move on arrival:
 *
 *   1. the swirl contour is traced like an isoline, then fills in;
 *   2. the frame settles into place;
 *   3. the iris opens; afterwards it breathes very slowly.
 *
 * Behind it, faint isolines draw in once and then pulse slowly. The intro
 * lasts about 1.3 s. All motion lives in CSS (`src/styles/hub/hub.css`) and
 * stops with «Movimiento reducido» or `prefers-reduced-motion`; the resting
 * state is the finished symbol.
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
  BRAND_SYMBOL_VIEWBOX,
} from '../../data/brandSymbol';

/** Irregular contour rings around the symbol (hero backdrop, 600 × 600). */
const ISOLINES = [
  'M300 168c78 2 136 50 138 124 2 78-58 136-140 134-84-2-142-54-140-128 2-76 58-132 142-130Z',
  'M298 112c108 4 192 70 194 172 2 106-82 184-196 182-116-4-200-76-196-178 4-104 84-180 198-176Z',
  'M302 56c138 6 244 92 246 222 2 134-104 236-250 234-148-2-254-98-248-232 6-132 110-230 252-224Z',
  'M296 4c166 8 296 114 298 276 2 164-128 290-302 288-176-2-306-120-300-284C-2 126 128-4 296 4Z',
];

export const HubSymbol: React.FC = () => {
  // useId returns ":r1:"-style ids; strip the colons so url(#…) stays valid.
  const p = `hubs${React.useId().replace(/:/g, '')}`;
  const b = BRAND_MASK_BOX;
  const white = (
    <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="#fff" />
  );
  return (
    <div className="hub-symbol" aria-hidden="true">
      <svg
        className="hub-symbol__isolines"
        viewBox="0 0 600 600"
        focusable="false"
      >
        <g fill="none" stroke="currentColor">
          {ISOLINES.map((d, i) => (
            <path
              key={d}
              d={d}
              pathLength={1}
              style={{'--i': i} as React.CSSProperties}
            />
          ))}
        </g>
      </svg>
      <svg
        className="hub-symbol__mark"
        viewBox={BRAND_SYMBOL_VIEWBOX}
        focusable="false"
      >
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
        <g fill="currentColor">
          <g mask={`url(#${p}m)`}>
            <g mask={`url(#${p}k)`}>
              <g className="hub-symbol__swirl" stroke="currentColor">
                <path
                  d={BRAND_SWIRL_A}
                  clipPath={`url(#${p}h1)`}
                  pathLength={1}
                />
                <path
                  d={BRAND_SWIRL_B}
                  clipPath={`url(#${p}h2)`}
                  pathLength={1}
                />
              </g>
            </g>
            <path
              className="hub-symbol__frame"
              d={BRAND_FRAME}
              fillRule="evenodd"
            />
          </g>
          <circle
            className="hub-symbol__iris"
            {...BRAND_IRIS}
            mask={`url(#${p}i)`}
          />
        </g>
      </svg>
      <p className="hub-symbol__coords">La Laguna · 28°29′ N 16°19′ O</p>
    </div>
  );
};
