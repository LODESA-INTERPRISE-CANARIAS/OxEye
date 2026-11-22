import {MAPS} from '../../data/venue-maps';
import type {NavigationGrid, Point, Scene} from '../../types';
import {inside, rect, segmentDistance} from '../cartography/geometry';

export {inside, rect, segmentDistance};

/**
 * Generates a deterministic pseudo-random number generator (Mulberry32).
 *
 * @param seed - Initial numeric seed.
 * @returns Function returning a pseudo-random number in [0, 1).
 */
export function rng(seed: number): () => number {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BoundedPoly {
  pts: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function toBoundedPoly(pts: Point[]): BoundedPoly {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {pts, minX, minY, maxX, maxY};
}

function insideBounded(p: Point, b: BoundedPoly): boolean {
  if (p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY) {
    return false;
  }
  return inside(p, b.pts);
}

/**
 * Discretizes the scene into a navigable 2D grid of cells (`0.75 m` default).
 * Precomputes bounding boxes for all polygons and produces both `free` (civilian crowd)
 * and `staffFree` (authorized emergency services, police, and event staff, including `subperimeter` zones)
 * in a single pass.
 *
 * @param s - Scene to discretize.
 * @param cell - Cell edge length in meters (defaults to `0.75`).
 * @param opts - Optional flags (`ignoreFences`, `allowRestricted`).
 * @returns Constructed navigation grid with index, point, neighbors, and nearest queries.
 */
export function buildGrid(
  s: Scene,
  cell = 0.75,
  opts?: {ignoreFences?: boolean; allowRestricted?: boolean}
): NavigationGrid {
  const m = MAPS[s.site];
  const w = Math.ceil(m.widthMeters / cell);
  const h = Math.ceil(m.heightMeters / cell);
  const toMeters = (ps: Point[]): Point[] =>
    ps.map(([x, y]) => [(x * m.widthMeters) / 100, (y * m.heightMeters) / 100]);

  const boundary = s.boundary?.length >= 3 ? toBoundedPoly(toMeters(s.boundary)) : null;
  const passages = (s.passages || [])
    .filter((r) => r.points?.length >= 3)
    .map((r) => toBoundedPoly(toMeters(r.points)));

  // Subperímetros: excluyen a civiles pero autorizan a servicios de emergencia, policía y personal del evento
  const isStaffAuthorizedReserve = (origin?: string) =>
    origin === 'subperimeter';

  const hardObstacles = (s.reserves || [])
    .filter((r) => r.points?.length >= 3 && !isStaffAuthorizedReserve(r.origin))
    .map((r) => toBoundedPoly(toMeters(r.points)));

  const restrictedForCivilians = (s.reserves || [])
    .filter((r) => r.points?.length >= 3 && isStaffAuthorizedReserve(r.origin))
    .map((r) => toBoundedPoly(toMeters(r.points)));

  const footprints = [
    ...s.base.booths,
    ...s.infrastructure.filter(
      (o) =>
        ['facility', 'furniture'].includes(o.role || '') || o.kind === 'ballast'
    ),
  ].map((b) => toBoundedPoly(rect(b, m)));

  const segMargin = cell * 0.55 + s.diameter / 2;
  const segments = opts?.ignoreFences
    ? []
    : (s.fences || []).flatMap((f) => {
        const pts = toMeters(f.points);
        return pts.slice(1).map((p, i) => {
          const a = pts[i];
          return {
            a,
            b: p,
            minX: Math.min(a[0], p[0]) - segMargin,
            minY: Math.min(a[1], p[1]) - segMargin,
            maxX: Math.max(a[0], p[0]) + segMargin,
            maxY: Math.max(a[1], p[1]) + segMargin,
          };
        });
      });

  const free = new Uint8Array(w * h);
  const staffFree = new Uint8Array(w * h);
  let count = 0;

  for (let j = 0; j < h; j++) {
    const py = (j + 0.5) * cell;
    for (let i = 0; i < w; i++) {
      const px = (i + 0.5) * cell;
      const p: Point = [px, py];
      const inDomain =
        (boundary !== null && insideBounded(p, boundary)) ||
        passages.some((r) => insideBounded(p, r));
      if (!inDomain) continue;
      if (hardObstacles.some((o) => insideBounded(p, o))) continue;
      if (footprints.some((o) => insideBounded(p, o))) continue;
      if (
        segments.some(
          (sSeg) =>
            px >= sSeg.minX &&
            px <= sSeg.maxX &&
            py >= sSeg.minY &&
            py <= sSeg.maxY &&
            segmentDistance(p, sSeg.a, sSeg.b) < segMargin
        )
      ) {
        continue;
      }
      const k = j * w + i;
      staffFree[k] = 1;
      if (
        opts?.allowRestricted ||
        !restrictedForCivilians.some((o) => insideBounded(p, o))
      ) {
        free[k] = 1;
        count++;
      }
    }
  }

  const index = (x: number, y: number): number => {
    const i = Math.floor(x / cell);
    const j = Math.floor(y / cell);
    return i >= 0 && i < w && j >= 0 && j < h ? j * w + i : -1;
  };

  const point = (k: number): Point => [
    ((k % w) + 0.5) * cell,
    (Math.floor(k / w) + 0.5) * cell,
  ];

  const neighbors = (k: number): number[] =>
    [
      k % w ? k - 1 : -1,
      k % w < w - 1 ? k + 1 : -1,
      k >= w ? k - w : -1,
      k < w * (h - 1) ? k + w : -1,
    ].filter((q) => q >= 0 && free[q]);

  const nearest = (x: number, y: number, max = 12): number => {
    let best = -1;
    let d = max;
    for (
      let j = Math.max(0, Math.floor((y - max) / cell));
      j < Math.min(h, Math.ceil((y + max) / cell));
      j++
    ) {
      for (
        let i = Math.max(0, Math.floor((x - max) / cell));
        i < Math.min(w, Math.ceil((x + max) / cell));
        i++
      ) {
        const k = j * w + i;
        if (!free[k]) continue;
        const p = point(k);
        const r = Math.hypot(p[0] - x, p[1] - y);
        if (r < d) {
          d = r;
          best = k;
        }
      }
    }
    return best;
  };

  return {
    m,
    w,
    h,
    cell,
    free,
    staffFree,
    count,
    area: count * cell * cell,
    index,
    point,
    neighbors,
    nearest,
  };
}

/**
 * Computes a Breadth-First Search (BFS) distance field towards a target cell index.
 *
 * @param grid - Navigation grid (or custom free-mask grid).
 * @param target - Target cell index.
 * @returns `Int32Array` with step distances to `target` (`-1` if unreachable).
 */
export function flow(
  grid: Pick<NavigationGrid, 'w' | 'free'>,
  target: number
): Int32Array {
  const d = new Int32Array(grid.free.length).fill(-1);
  if (target < 0 || !grid.free[target]) return d;
  const queue = new Int32Array(d.length);
  const w = grid.w;
  const free = grid.free;
  let a = 0;
  let b = 0;
  d[target] = 0;
  queue[b++] = target;
  while (a < b) {
    const k = queue[a++];
    const x = k % w;
    let n: number;
    if (x > 0) {
      n = k - 1;
      if (free[n] && d[n] < 0) {
        d[n] = d[k] + 1;
        queue[b++] = n;
      }
    }
    if (x < w - 1) {
      n = k + 1;
      if (free[n] && d[n] < 0) {
        d[n] = d[k] + 1;
        queue[b++] = n;
      }
    }
    if (k >= w) {
      n = k - w;
      if (free[n] && d[n] < 0) {
        d[n] = d[k] + 1;
        queue[b++] = n;
      }
    }
    if (k < d.length - w) {
      n = k + w;
      if (free[n] && d[n] < 0) {
        d[n] = d[k] + 1;
        queue[b++] = n;
      }
    }
  }
  return d;
}
