/**
 * @module engine/cartography/transform
 * Interactive resize and rotation handles for booths and infrastructure items on the map canvas.
 */
import type {Point, VenueMap} from '../../types';

export interface TransformTarget {
  id: string;
  x: number;
  y: number;
  width?: number;
  depth?: number;
  area?: number;
  rotation?: number;
}

export function transformObject(
  original: TransformTarget,
  map: VenueMap,
  start: Point,
  pointer: Point,
  handle: string,
  proportional = false
): Partial<TransformTarget> | null {
  const cx = (original.x * map.widthMeters) / 100;
  const cy = (original.y * map.heightMeters) / 100;
  const radians = ((original.rotation || 0) * Math.PI) / 180;
  const cs = Math.cos(radians);
  const sn = Math.sin(radians);

  if (handle === 'rotate') {
    const a = Math.atan2(start[1] - cy, start[0] - cx);
    const b = Math.atan2(pointer[1] - cy, pointer[0] - cx);
    let rotation = (original.rotation || 0) + ((b - a) * 180) / Math.PI;
    if (proportional) rotation = Math.round(rotation / 15) * 15;
    return {rotation: ((rotation % 360) + 360) % 360};
  }

  const directions: Record<string, [number, number]> = {
    nw: [-1, -1],
    n: [0, -1],
    ne: [1, -1],
    e: [1, 0],
    se: [1, 1],
    s: [0, 1],
    sw: [-1, 1],
    w: [-1, 0],
  };
  const signs = directions[handle];
  if (!signs) return null;

  const [sx, sy] = signs;
  const w = original.width || 3;
  const h = original.depth || 3;
  const px = (pointer[0] - cx) * cs + (pointer[1] - cy) * sn;
  const py = -(pointer[0] - cx) * sn + (pointer[1] - cy) * cs;

  let width = sx ? Math.max(0.5, Math.min(100, sx * (px + (sx * w) / 2))) : w;
  let depth = sy ? Math.max(0.5, Math.min(100, sy * (py + (sy * h) / 2))) : h;

  if (proportional) {
    const scale = Math.max(
      0.5 / Math.min(w, h),
      Math.min(
        100 / Math.max(w, h),
        sx && sy
          ? Math.max(width / w, depth / h)
          : sx
            ? width / w
            : depth / h
      )
    );
    width = w * scale;
    depth = h * scale;
  }

  const ox = (sx * (width - w)) / 2;
  const oy = (sy * (depth - h)) / 2;
  const x = ((cx + ox * cs - oy * sn) / map.widthMeters) * 100;
  const y = ((cy + ox * sn + oy * cs) / map.heightMeters) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;

  return {x, y, width, depth, area: width * depth};
}

export function transformHandles(
  o: TransformTarget,
  m: VenueMap,
  pixelsPerMeter: number
): string {
  const safeId = String(o.id)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const x = (o.x * m.widthMeters) / 100;
  const y = (o.y * m.heightMeters) / 100;
  const w = o.width || 3;
  const h = o.depth || 3;
  const ppm = Math.max(0.5, pixelsPerMeter);
  const size = Math.max(0.2, Math.min(0.65, 4.5 / ppm));
  const offset = Math.max(0.9, Math.min(2.4, 14 / ppm));
  const dots: Array<[string, number, number]> = [
    ['nw', -w / 2, -h / 2],
    ['n', 0, -h / 2],
    ['ne', w / 2, -h / 2],
    ['e', w / 2, 0],
    ['se', w / 2, h / 2],
    ['s', 0, h / 2],
    ['sw', -w / 2, h / 2],
    ['w', -w / 2, 0],
  ];
  return (
    '<g data-id="' +
    safeId +
    '" transform="translate(' +
    x +
    ' ' +
    y +
    ') rotate(' +
    (o.rotation || 0) +
    ')" class="transform-controls"><rect x="' +
    -w / 2 +
    '" y="' +
    -h / 2 +
    '" width="' +
    w +
    '" height="' +
    h +
    '" fill="none" stroke="#7651a1" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/><line x1="0" y1="' +
    -h / 2 +
    '" x2="0" y2="' +
    (-h / 2 - offset) +
    '" stroke="#7651a1" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>' +
    dots
      .map(
        ([key, u, v]) =>
          '<rect data-handle="' +
          key +
          '" x="' +
          (u - size / 2) +
          '" y="' +
          (v - size / 2) +
          '" width="' +
          size +
          '" height="' +
          size +
          '" fill="white" stroke="#7651a1" stroke-width="1" vector-effect="non-scaling-stroke"><title>Arrastra para cambiar el tamaño. Mayús conserva la proporción.</title></rect>'
      )
      .join('') +
    '<circle data-handle="rotate" cx="0" cy="' +
    (-h / 2 - offset) +
    '" r="' +
    size * 0.55 +
    '" fill="#7651a1" stroke="white" stroke-width="1" vector-effect="non-scaling-stroke"><title>Arrastra para girar. Mayús gira en pasos de 15 grados.</title></circle></g>'
  );
}
