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

/**
 * Discretizes the scene into a navigable 2D grid of cells (`0.75 m` default).
 *
 * @param s - Scene to discretize.
 * @param cell - Cell edge length in meters (defaults to `0.75`).
 * @returns Constructed navigation grid with index, point, neighbors, and nearest queries.
 */
export function buildGrid(
  s: Scene,
  cell = 0.75,
  opts?: {ignoreFences?: boolean}
): NavigationGrid {
  const m = MAPS[s.site];
  const w = Math.ceil(m.widthMeters / cell);
  const h = Math.ceil(m.heightMeters / cell);
  const toMeters = (ps: Point[]): Point[] =>
    ps.map(([x, y]) => [(x * m.widthMeters) / 100, (y * m.heightMeters) / 100]);
  const boundary = toMeters(s.boundary);
  const obstacles = s.reserves.map((r) => toMeters(r.points));
  const footprints = [
    ...s.base.booths,
    ...s.infrastructure.filter(
      (o) =>
        ['facility', 'furniture'].includes(o.role || '') || o.kind === 'ballast'
    ),
  ].map((b) => rect(b, m));
  const segments = opts?.ignoreFences
    ? []
    : (s.fences || []).flatMap((f) => {
        const pts = toMeters(f.points);
        return pts.slice(1).map((p, i) => [pts[i], p] as [Point, Point]);
      });
  const free = new Uint8Array(w * h);
  let count = 0;

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p: Point = [(i + 0.5) * cell, (j + 0.5) * cell];
      if (
        (inside(p, boundary) ||
          (s.passages || []).some((r) => inside(p, toMeters(r.points)))) &&
        !obstacles.some((o) => inside(p, o)) &&
        !footprints.some((o) => inside(p, o)) &&
        !segments.some(
          ([a, b]) => segmentDistance(p, a, b) < cell * 0.55 + s.diameter / 2
        )
      ) {
        free[j * w + i] = 1;
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
