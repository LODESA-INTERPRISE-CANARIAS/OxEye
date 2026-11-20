import type {Scene, VenueMap} from '../../types';
import {world} from './geometry';

/**
 * Generates an inline SVG mini-map string for a scene, optionally highlighting an item by ID.
 *
 * @param scene - Scene to render.
 * @param boundaryScene - Reference scene holding the boundary polygon.
 * @param m - Georeferenced venue map.
 * @param highlight - Optional element ID to highlight in `#d64e32`.
 * @returns SVG markup string.
 */
export function miniMap(
  scene: Scene,
  boundaryScene: Scene,
  m: VenueMap,
  highlight?: string
): string {
  const outline = boundaryScene.boundary.map((q) => world(q, m));
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const a = Math.min(...xs) - 5;
  const b = Math.min(...ys) - 5;
  return (
    '<svg style="width:100%;height:160px;background:#edf1e6" viewBox="' +
    [a, b, Math.max(...xs) - a + 5, Math.max(...ys) - b + 5].join(' ') +
    '"><polygon points="' +
    outline.map((p) => p.join(',')).join(' ') +
    '" fill="#e1e6cc" stroke="#69806a"/>' +
    [...scene.base.booths, ...scene.infrastructure]
      .map((o) => {
        const [x, y] = world([o.x, o.y], m);
        const w = o.width || 3;
        const h = o.depth || 3;
        return (
          '<rect transform="translate(' +
          x +
          ' ' +
          y +
          ') rotate(' +
          (Number(o.rotation) || 0) +
          ')" x="' +
          -w / 2 +
          '" y="' +
          -h / 2 +
          '" width="' +
          w +
          '" height="' +
          h +
          '" fill="' +
          (o.id === highlight ? '#d64e32' : '#829d8d') +
          '"/>'
        );
      })
      .join('') +
    '</svg>'
  );
}

/**
 * Generates an inline SVG mini-map string with simulated pedestrian positions overlaid.
 *
 * @param scene - Scene to render.
 * @param boundaryScene - Reference scene holding the boundary polygon.
 * @param m - Georeferenced venue map.
 * @param people - Array of `{x, y}` coordinates in meters.
 * @returns SVG markup string.
 */
export function batchMap(
  scene: Scene,
  boundaryScene: Scene,
  m: VenueMap,
  people: Array<{x: number; y: number}> = []
): string {
  return miniMap(scene, boundaryScene, m).replace(
    '</svg>',
    people
      .map(
        (p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r=".5" fill="#d58c35"/>'
      )
      .join('') + '</svg>'
  );
}
