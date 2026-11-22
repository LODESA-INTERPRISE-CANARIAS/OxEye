/**
 * @module engine/mobility/vehicle-system
 * Sistema unificado de movilidad vehicular, red viaria exterior/interior,
 * ciclo completo (spawn -> entrada -> operación -> salida) y detección de
 * bloqueos/maniobras con diagnóstico del obstáculo y alternativas viables.
 */
import {CARTO_DATA} from '../../data/geodata';
import type {
  EntranceItem,
  NavigationGrid,
  Point,
  Point2D,
  Scene,
} from '../../types';
import {inside, localPoint, rect, segmentDistance, world} from '../cartography/geometry';
import {flow} from '../crowd/grid-flow';
import {vehiclePath} from '../emergency/motion';
import {poseAt} from '../emergency/priority';

export type VehicleKind = 'ordinary' | 'logistics' | 'emergency';

export type VehicleState =
  | 'entering'
  | 'operating'
  | 'exiting'
  | 'departed'
  | 'blocked';

export interface VehicleDimensions {
  width: number;
  length: number;
  speed: number;
  minTurnRadius: number;
  label: string;
}

export const VEHICLE_SPECS: Record<VehicleKind, VehicleDimensions> = {
  ordinary: {
    width: 1.9,
    length: 4.5,
    speed: 4.2,
    minTurnRadius: 3.4,
    label: 'Vehículo ordinario',
  },
  logistics: {
    width: 2.5,
    length: 7.5,
    speed: 3.1,
    minTurnRadius: 5.8,
    label: 'Camión logístico',
  },
  emergency: {
    width: 2.4,
    length: 6.5,
    speed: 5.0,
    minTurnRadius: 4.8,
    label: 'Vehículo de emergencias',
  },
};

export interface VehicleAlternative {
  kind:
    | 'reroute'
    | 'alternate_access'
    | 'dismount_foot'
    | 'relocate_loading'
    | 'manual';
  label: string;
  point?: Point2D;
}

export interface VehicleRouteReport {
  ok: boolean;
  path?: Point2D[];
  length?: number;
  /** Punto donde el vehículo aparca si el último tramo se completa a pie. */
  dismountPoint?: Point2D;
  /** Ruta peatonal desde `dismountPoint` hasta el destino exacto. */
  footPath?: Point2D[];
  /** Si el vehículo tuvo que rodear una vía bloqueada. */
  rerouted?: boolean;
  /** Descripción del fallo cuando `ok === false`. */
  reason?: string;
  /** Nombre del obstáculo concreto detectado en el punto de bloqueo. */
  blockingObstacle?: string;
  /** Alternativas concretas propuestas por el sistema. */
  alternatives: VehicleAlternative[];
}

export interface SimVehicle {
  id: string;
  kind: VehicleKind;
  name: string;
  spawnId: string;
  spawnName: string;
  state: VehicleState;
  operation: 'park' | 'unload' | 'service' | 'transit';
  x: number;
  y: number;
  angle: number;
  width: number;
  length: number;
  speed: number;
  path: Point2D[];
  pathDist: number;
  pathLength: number;
  destination: Point2D;
  destinationName: string;
  operateUntil: number;
  stuckSeconds: number;
  rerouteCount: number;
  diagnostic?: VehicleRouteReport;
}

interface ObstacleBox {
  id: string;
  name: string;
  poly: Point2D[];
  cx: number;
  cy: number;
}

const dist = (a: Point2D, b: Point2D): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const pathLength = (pts: Point2D[]): number =>
  pts.slice(1).reduce((acc, q, i) => acc + dist(pts[i], q), 0);

/**
 * Recopila los segmentos de la red viaria (propuestas viales, corredores y calles OSM)
 * en coordenadas locales en metros.
 */
export function collectRoadSegments(
  scene: Scene,
  map: NavigationGrid['m']
): Array<{a: Point2D; b: Point2D; halfWidth: number; name: string}> {
  const segs: Array<{a: Point2D; b: Point2D; halfWidth: number; name: string}> = [];

  const pushPolyline = (pts: Point2D[], width: number, name: string) => {
    for (let i = 1; i < pts.length; i++) {
      if (dist(pts[i - 1], pts[i]) < 0.2) continue;
      segs.push({a: pts[i - 1], b: pts[i], halfWidth: Math.max(1.8, width / 2), name});
    }
  };

  for (const r of [...(scene.roadPlans || []), ...(scene.flows || []), ...(scene.corridors || [])]) {
    if (!r.points || r.points.length < 2) continue;
    pushPolyline(
      r.points.map((p) => world(p, map)),
      r.width || 4,
      r.name || 'Corredor vial'
    );
  }

  // Calles del mapa personalizado (si existen)
  if (map.customLocation?.streets?.length) {
    for (const st of map.customLocation.streets) {
      if (!st.points || st.points.length < 2) continue;
      pushPolyline(
        st.points,
        st.kind === 'vehicle' ? 5.5 : 3.5,
        st.name || 'Vía exterior'
      );
    }
  } else {
    // Calles reales OSM del entorno cartográfico
    const highwaySet = new Set([
      'primary',
      'secondary',
      'tertiary',
      'residential',
      'unclassified',
      'service',
      'living_street',
      'pedestrian',
    ]);
    for (const f of CARTO_DATA.features) {
      const hw = f.tags?.highway;
      if (!hw || !highwaySet.has(hw) || f.points.length < 2) continue;
      const pts = f.points.map((p) => localPoint(p, map));
      const inBounds = pts.some(
        ([x, y]) =>
          x >= -15 && y >= -15 && x <= map.widthMeters + 15 && y <= map.heightMeters + 15
      );
      if (!inBounds) continue;
      pushPolyline(pts, hw === 'pedestrian' ? 4.5 : 5.5, f.tags?.name || 'Calle exterior');
    }
  }

  return segs;
}

/**
 * Recopila todos los obstáculos sólidos del plano (puestos, infraestructuras bloqueantes,
 * reservas no transitables y vallas) con sus nombres para diagnóstico concreto.
 */
function collectVehicleObstacles(
  scene: Scene,
  map: NavigationGrid['m']
): {
  boxes: ObstacleBox[];
  fences: Array<{name: string; a: Point2D; b: Point2D}>;
} {
  const boxes: ObstacleBox[] = [];
  for (const b of scene.base.booths) {
    const poly = rect(b, map);
    const [cx, cy] = world([b.x, b.y], map);
    boxes.push({id: b.id, name: b.name || 'Puesto', poly, cx, cy});
  }
  for (const inf of scene.infrastructure) {
    if (
      inf.role === 'cover' ||
      inf.kind === 'loading' ||
      inf.kind === 'turning'
    ) {
      continue;
    }
    const isPerson = inf.kind === 'security' || inf.kind === 'steward';
    const boxItem = isPerson
      ? {...inf, width: Math.max(1.4, inf.width || 0.5), depth: Math.max(1.4, inf.depth || 0.5)}
      : inf;
    const poly = rect(boxItem, map);
    const [cx, cy] = world([inf.x, inf.y], map);
    boxes.push({id: inf.id, name: inf.name || inf.kind, poly, cx, cy});
  }
  for (const res of scene.reserves || []) {
    if (res.origin === 'turning' || res.origin === 'loading') continue;
    if (!res.points || res.points.length < 3) continue;
    const poly = res.points.map((p) => world(p, map));
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    boxes.push({id: res.id || res.name, name: res.name || 'Zona excluida', poly, cx, cy});
  }
  const fences: Array<{name: string; a: Point2D; b: Point2D}> = [];
  for (const f of scene.fences || []) {
    const pts = (f.points || []).map((p) => world(p, map));
    for (let i = 1; i < pts.length; i++) {
      fences.push({name: f.name || 'Valla', a: pts[i - 1], b: pts[i]});
    }
  }
  return {boxes, fences};
}

/**
 * Construye una malla de circulación vehicular que une el interior transitable de la plaza,
 * la red viaria exterior (OSM / propuestas viales / corredores) y los accesos/bases exteriores.
 */
export function buildVehicleGrid(
  scene: Scene,
  baseGrid: NavigationGrid
): NavigationGrid {
  const {w, h, cell, m} = baseGrid;
  const free = new Uint8Array(baseGrid.free);
  const roads = collectRoadSegments(scene, m);
  const {boxes, fences} = collectVehicleObstacles(scene, m);

  // Conectar también cada base exterior o acceso vehicular al punto más cercano del perímetro/vía
  const baseAprons: Array<{pt: Point2D; radius: number}> = [];
  const baseConnectors: Array<{a: Point2D; b: Point2D; halfWidth: number}> = [];
  const perimeterPts = (scene.boundary || []).map((p) => world(p, m));

  for (const ent of scene.entrances || []) {
    if ((ent.phases?.event || ent.role || 'both') === 'closed') continue;
    const pt = world([ent.x, ent.y], m);
    baseAprons.push({pt, radius: Math.max(3.5, (ent.clearWidth || 4) * 0.9)});
    if (ent.externalBase && perimeterPts.length >= 3) {
      // Conectar la base exterior con la entrada de plaza más cercana o borde del perímetro
      const otherGates = (scene.entrances || []).filter(
        (g) => g.id !== ent.id && !g.externalBase && (g.phases?.event || g.role || 'both') !== 'closed'
      );
      let target: Point2D = perimeterPts[0];
      let bestD = Infinity;
      for (const g of otherGates) {
        const gp = world([g.x, g.y], m);
        const d = dist(pt, gp);
        if (d < bestD) {
          bestD = d;
          target = gp;
        }
      }
      if (!otherGates.length) {
        for (const pp of perimeterPts) {
          const d = dist(pt, pp);
          if (d < bestD) {
            bestD = d;
            target = pp;
          }
        }
      }
      baseConnectors.push({a: pt, b: target, halfWidth: 3.8});
    }
  }

  // Zonas de carga/descarga y maniobra son siempre transitables para vehículos
  const serviceZones = (scene.reserves || [])
    .filter((r) => r.origin === 'turning' || r.origin === 'loading')
    .filter((r) => r.points && r.points.length >= 3)
    .map((r) => r.points.map((p) => world(p, m)));

  let count = baseGrid.count;
  // Bloquear en la malla vehicular todos los objetos físicos del diseño (puestos, emergencias, policía a pie, etc.)
  for (const box of boxes) {
    const xs = box.poly.map((p) => p[0]);
    const ys = box.poly.map((p) => p[1]);
    const minI = Math.max(0, Math.floor((Math.min(...xs) - 0.25) / cell));
    const maxI = Math.min(w - 1, Math.ceil((Math.max(...xs) + 0.25) / cell));
    const minJ = Math.max(0, Math.floor((Math.min(...ys) - 0.25) / cell));
    const maxJ = Math.min(h - 1, Math.ceil((Math.max(...ys) + 0.25) / cell));
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const k = j * w + i;
        if (!free[k]) continue;
        const p: Point2D = [(i + 0.5) * cell, (j + 0.5) * cell];
        if (inside(p, box.poly)) {
          free[k] = 0;
          count--;
        }
      }
    }
  }

  const markCellIfClear = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return;
    const k = j * w + i;
    if (free[k]) return;
    const p: Point2D = [(i + 0.5) * cell, (j + 0.5) * cell];
    if (boxes.some((b) => inside(p, b.poly))) return;
    if (fences.some((f) => segmentDistance(p, f.a, f.b) < cell * 0.55 + 0.3)) {
      return;
    }
    free[k] = 1;
    count++;
  };

  const rasterSegment = (a: Point2D, b: Point2D, halfW: number) => {
    const minI = Math.max(0, Math.floor((Math.min(a[0], b[0]) - halfW) / cell));
    const maxI = Math.min(w - 1, Math.ceil((Math.max(a[0], b[0]) + halfW) / cell));
    const minJ = Math.max(0, Math.floor((Math.min(a[1], b[1]) - halfW) / cell));
    const maxJ = Math.min(h - 1, Math.ceil((Math.max(a[1], b[1]) + halfW) / cell));
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const p: Point2D = [(i + 0.5) * cell, (j + 0.5) * cell];
        if (segmentDistance(p, a, b) <= halfW) markCellIfClear(i, j);
      }
    }
  };

  for (const seg of roads) rasterSegment(seg.a, seg.b, seg.halfWidth);
  for (const c of baseConnectors) rasterSegment(c.a, c.b, c.halfWidth);

  for (const ap of baseAprons) {
    const r = Math.max(ap.radius, 5.5);
    const minI = Math.max(0, Math.floor((ap.pt[0] - r) / cell));
    const maxI = Math.min(w - 1, Math.ceil((ap.pt[0] + r) / cell));
    const minJ = Math.max(0, Math.floor((ap.pt[1] - r) / cell));
    const maxJ = Math.min(h - 1, Math.ceil((ap.pt[1] + r) / cell));
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const p: Point2D = [(i + 0.5) * cell, (j + 0.5) * cell];
        if (dist(p, ap.pt) <= r) markCellIfClear(i, j);
      }
    }
  }

  for (const poly of serviceZones) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const minI = Math.max(0, Math.floor(Math.min(...xs) / cell));
    const maxI = Math.min(w - 1, Math.ceil(Math.max(...xs) / cell));
    const minJ = Math.max(0, Math.floor(Math.min(...ys) / cell));
    const maxJ = Math.min(h - 1, Math.ceil(Math.max(...ys) / cell));
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const p: Point2D = [(i + 0.5) * cell, (j + 0.5) * cell];
        if (inside(p, poly)) markCellIfClear(i, j);
      }
    }
  }

  const neighbors = (k: number): number[] =>
    [
      k % w ? k - 1 : -1,
      k % w < w - 1 ? k + 1 : -1,
      k >= w ? k - w : -1,
      k < w * (h - 1) ? k + w : -1,
    ].filter((q) => q >= 0 && free[q]);

  const nearest = (x: number, y: number, max = 16): number => {
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
        const pt = baseGrid.point(k);
        const r = Math.hypot(pt[0] - x, pt[1] - y);
        if (r < d) {
          d = r;
          best = k;
        }
      }
    }
    return best;
  };

  return {
    ...baseGrid,
    free,
    count,
    area: count * cell * cell,
    neighbors,
    nearest,
  };
}

/**
 * Identifica el obstáculo concreto más cercano a un punto de colisión/estrechamiento.
 */
export function identifyBlockingObstacle(
  pt: Point2D,
  scene: Scene,
  map: NavigationGrid['m']
): string {
  const {boxes, fences} = collectVehicleObstacles(scene, map);
  let bestName = 'estrechamiento de la vía o borde del perímetro';
  let bestDist = 6.0;

  for (const b of boxes) {
    const d = Math.hypot(pt[0] - b.cx, pt[1] - b.cy);
    if (inside(pt, b.poly)) return b.name;
    if (d < bestDist) {
      bestDist = d;
      bestName = b.name;
    }
  }
  for (const f of fences) {
    const d = segmentDistance(pt, f.a, f.b);
    if (d < bestDist) {
      bestDist = d;
      bestName = f.name;
    }
  }
  return bestName;
}

function hullClearOnGrid(
  grid: NavigationGrid,
  pose: {x: number; y: number; angle: number},
  width: number,
  length: number
): Point2D | null {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  for (const lx of [-length / 2, 0, length / 2]) {
    for (const ly of [-width / 2, 0, width / 2]) {
      const px = pose.x + lx * cos - ly * sin;
      const py = pose.y + lx * sin + ly * cos;
      const k = grid.index(px, py);
      if (k < 0 || !grid.free[k]) return [px, py];
    }
  }
  return null;
}

/**
 * Calcula una ruta vehicular validando anchura, huella, radio de giro y maniobra.
 * Si el destino interior es demasiado estrecho, intenta encontrar:
 * - otra ruta libre en la red viaria,
 * - otro acceso abierto,
 * - o un punto de parada seguro con aproximación a pie (`allowFootDismount`).
 */
export function planVehicleRoute(
  scene: Scene,
  vehGrid: NavigationGrid,
  origin: Point2D,
  destination: Point2D,
  spec: Pick<VehicleDimensions, 'width' | 'length' | 'minTurnRadius'>,
  opts?: {
    allowFootDismount?: boolean;
    near?: number;
    pedestrianGrid?: NavigationGrid;
  }
): VehicleRouteReport {
  const near = opts?.near ?? Math.max(2, spec.length / 2 + 0.8);
  const buildEroded = (margin: number): Uint8Array => {
    const rad = spec.width / 2 + margin;
    const mask = new Uint8Array(vehGrid.free.length);
    for (let k = 0; k < vehGrid.free.length; k++) {
      if (!vehGrid.free[k]) continue;
      const p = vehGrid.point(k);
      let clear = true;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const j = vehGrid.index(p[0] + rad * Math.cos(a), p[1] + rad * Math.sin(a));
        if (j < 0 || !vehGrid.free[j]) {
          clear = false;
          break;
        }
      }
      if (clear) mask[k] = 1;
    }
    return mask;
  };
  // Preferir el eje central de la calzada (margen holgado); si no hay paso, usar margen mínimo
  let free = buildEroded(0.95);
  let hasStartCenter = false;
  for (let k = 0; k < free.length; k++) {
    if (free[k] && dist(vehGrid.point(k), origin) < 4.5) {
      hasStartCenter = true;
      break;
    }
  }
  if (!hasStartCenter) free = buildEroded(0.15);

  const eroded: NavigationGrid = {
    ...vehGrid,
    free,
    neighbors: (k: number) => {
      const col = k % vehGrid.w;
      const row = Math.floor(k / vehGrid.w);
      const out: number[] = [];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = col + di;
          const nj = row + dj;
          if (ni < 0 || ni >= vehGrid.w || nj < 0 || nj >= vehGrid.h) continue;
          const nk = nj * vehGrid.w + ni;
          if (free[nk]) out.push(nk);
        }
      }
      return out;
    },
  };

  // Localizar celda de inicio válida cerca de origin
  let start = -1;
  let bestStartDist = 4.5;
  for (let k = 0; k < free.length; k++) {
    if (!free[k]) continue;
    const d = dist(vehGrid.point(k), origin);
    if (d < bestStartDist) {
      bestStartDist = d;
      start = k;
    }
  }

  const alternatives: VehicleAlternative[] = [];
  if (start < 0) {
    const obs = identifyBlockingObstacle(origin, scene, vehGrid.m);
    alternatives.push({
      kind: 'alternate_access',
      label: 'Utilizar otro acceso/base vehicular con mayor anchura libre',
    });
    alternatives.push({
      kind: 'manual',
      label: `Despejar «${obs}» junto al punto de partida del vehículo`,
    });
    return {
      ok: false,
      reason: `El vehículo no tiene espacio libre para iniciar la marcha junto a «${obs}».`,
      blockingObstacle: obs,
      alternatives,
    };
  }

  // BFS desde el inicio para conocer TODAS las celdas alcanzables por el vehículo
  const reachFromStart = flow(eroded, start);

  // Buscar celdas candidatas cerca del destino
  const targetCandidates: Array<{k: number; d: number}> = [];
  for (let k = 0; k < free.length; k++) {
    if (!free[k] || reachFromStart[k] < 0) continue;
    const dt = dist(vehGrid.point(k), destination);
    if (dt <= near + 4.5) {
      targetCandidates.push({k, d: dt});
    }
  }
  targetCandidates.sort((a, b) => a.d - b.d);

  const traceAndValidate = (targetIdx: number): {
    path?: Point2D[];
    length?: number;
    blockPoint?: Point2D;
    turnFailed?: boolean;
  } => {
    const field = flow(eroded, targetIdx);
    if (field[start] < 0) return {};
    let k = start;
    const raw: Point2D[] = [vehGrid.point(k)];
    const targetPt = vehGrid.point(targetIdx);
    for (let i = 0; i < free.length && k !== targetIdx; i++) {
      const next = eroded
        .neighbors(k)
        .filter((n) => field[n] >= 0 && field[n] < field[k])
        .sort((a, b) => {
          if (field[a] !== field[b]) return field[a] - field[b];
          return dist(vehGrid.point(a), targetPt) - dist(vehGrid.point(b), targetPt);
        })[0];
      if (next === undefined) break;
      k = next;
      raw.push(vehGrid.point(k));
    }
    if (k !== targetIdx) return {};

    // Simplificar el escalonado de la malla (RDP 1,6 m) para evitar micro-giros artificiales
    // en calles diagonales manteniendo fielmente todos los giros reales y rodeos.
    const simplify = (pts: Point2D[], eps: number): Point2D[] => {
      if (pts.length <= 2) return pts;
      let maxD = 0;
      let maxIdx = 0;
      const a = pts[0];
      const b = pts[pts.length - 1];
      for (let idx = 1; idx < pts.length - 1; idx++) {
        const d = segmentDistance(pts[idx], a, b);
        if (d > maxD) {
          maxD = d;
          maxIdx = idx;
        }
      }
      if (maxD > eps) {
        const left = simplify(pts.slice(0, maxIdx + 1), eps);
        const right = simplify(pts.slice(maxIdx), eps);
        return [...left.slice(0, -1), ...right];
      }
      return [a, b];
    };
    const smoothRaw = simplify(raw, 1.6);

    // Comprobar radio de giro y huella barrida
    const clearSeg = (a: Point2D, b: Point2D): boolean => {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const steps = Math.max(1, Math.ceil(dist(a, b) / 0.5));
      for (let s = 0; s <= steps; s++) {
        const px = a[0] + ((b[0] - a[0]) * s) / steps;
        const py = a[1] + ((b[1] - a[1]) * s) / steps;
        if (hullClearOnGrid(vehGrid, {x: px, y: py, angle}, spec.width, spec.length)) {
          return false;
        }
      }
      return true;
    };

    let curved =
      spec.length >= 4
        ? vehiclePath(smoothRaw as Point[], spec.minTurnRadius, clearSeg)
        : smoothRaw;

    if (!curved) {
      // Si la polilínea simplificada sí tiene huella completa despejada en cada tramo y esquina
      // (p. ej. tramo final corto dentro de una plaza abierta), permitirla; si roza cualquier obstáculo, bloquear.
      const totalRaw = pathLength(smoothRaw);
      let failPt: Point2D | null = null;
      for (let ds = 0; ds <= totalRaw; ds += 0.45) {
        const hit = hullClearOnGrid(vehGrid, poseAt(smoothRaw, ds), spec.width, spec.length);
        if (hit) {
          failPt = hit;
          break;
        }
      }
      if (failPt) {
        return {blockPoint: failPt, turnFailed: true};
      }
      curved = smoothRaw;
    }

    const total = pathLength(curved);
    for (let ds = 0; ds <= total; ds += 0.45) {
      const hit = hullClearOnGrid(vehGrid, poseAt(curved, ds), spec.width, spec.length);
      if (hit) {
        return {blockPoint: hit, turnFailed: false};
      }
    }

    return {path: curved, length: total};
  };

  let lastBlockPoint: Point2D | undefined;
  let lastTurnFailed = false;

  for (const cand of targetCandidates.slice(0, 12)) {
    const attempt = traceAndValidate(cand.k);
    if (attempt.path) {
      return {
        ok: true,
        path: attempt.path,
        length: attempt.length,
        alternatives: [],
      };
    }
    if (attempt.blockPoint && !lastBlockPoint) {
      lastBlockPoint = attempt.blockPoint;
      lastTurnFailed = !!attempt.turnFailed;
    }
  }

  // Si está permitido el descenso a pie (emergencias / servicio), buscar el punto alcanzable más cercano al destino
  if (opts?.allowFootDismount) {
    let bestDismount: {k: number; d: number} | null = null;
    for (let k = 0; k < free.length; k++) {
      if (!free[k] || reachFromStart[k] < 0) continue;
      const d = dist(vehGrid.point(k), destination);
      if (!bestDismount || d < bestDismount.d) {
        bestDismount = {k, d};
      }
    }
    if (bestDismount) {
      const dismountAttempt = traceAndValidate(bestDismount.k);
      if (dismountAttempt.path) {
        const dismountPt = vehGrid.point(bestDismount.k);
        // Verificar conectividad peatonal desde dismountPt hasta destination
        const pedGrid = opts.pedestrianGrid || vehGrid;
        const pStart = pedGrid.nearest(dismountPt[0], dismountPt[1], 6);
        const pEnd = pedGrid.nearest(destination[0], destination[1], 6);
        if (pStart >= 0 && pEnd >= 0) {
          const pedField = flow(pedGrid, pEnd);
          if (pedField[pStart] >= 0) {
            const footPath: Point2D[] = [dismountPt];
            let pk = pStart;
            for (let i = 0; i < pedGrid.free.length && pk !== pEnd; i++) {
              const nxt = pedGrid
                .neighbors(pk)
                .filter((n) => pedField[n] >= 0 && pedField[n] < pedField[pk])
                .sort((a, b) => pedField[a] - pedField[b])[0];
              if (nxt === undefined) break;
              pk = nxt;
              footPath.push(pedGrid.point(pk));
            }
            footPath.push(destination);
            return {
              ok: true,
              path: dismountAttempt.path,
              length: dismountAttempt.length,
              dismountPoint: dismountPt,
              footPath,
              alternatives: [
                {
                  kind: 'dismount_foot',
                  label: `Parada en aproximación despejada (${dismountAttempt.length?.toFixed(0)} m) y despliegue a pie (${pathLength(footPath).toFixed(0)} m)`,
                  point: dismountPt,
                },
              ],
            };
          }
        }
      }
    }
  }

  // No hay ruta directa válida: diagnosticar obstáculo concreto y proponer alternativas
  const blockPt = lastBlockPoint || destination;
  const obs = identifyBlockingObstacle(blockPt, scene, vehGrid.m);

  // Comprobar si otro acceso abierto sí puede llegar
  for (const ent of scene.entrances || []) {
    if ((ent.phases?.event || ent.role || 'both') === 'closed') continue;
    if (ent.spawnType === 'pedestrian') continue;
    const ep = world([ent.x, ent.y], vehGrid.m);
    if (dist(ep, origin) < 3) continue;
    const altStart = eroded.nearest(ep[0], ep[1], 5);
    if (altStart >= 0) {
      alternatives.push({
        kind: 'alternate_access',
        label: `Entrar por acceso alternativo «${ent.name}»`,
        point: ep,
      });
      break;
    }
  }

  // Comprobar si existe una zona de descarga/maniobra alcanzable
  const altLoading = (scene.reserves || []).find(
    (r) =>
      (r.origin === 'loading' || r.origin === 'turning') &&
      r.points?.length >= 3
  );
  if (altLoading) {
    const pts = altLoading.points.map((p) => world(p, vehGrid.m));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    alternatives.push({
      kind: 'relocate_loading',
      label: `Reubicar descarga/maniobra en «${altLoading.name}»`,
      point: [cx, cy],
    });
  }

  alternatives.push({
    kind: 'manual',
    label: `Despejar o separar «${obs}» para garantizar radio de giro (≥ ${spec.minTurnRadius.toFixed(1)} m)`,
    point: blockPt,
  });

  return {
    ok: false,
    reason: lastTurnFailed
      ? `Radio de giro insuficiente (mín. ${spec.minTurnRadius.toFixed(1)} m) bloqueado por «${obs}».`
      : `Paso vehicular bloqueado por «${obs}» (anchura requerida ${(spec.width + 0.3).toFixed(1)} m).`,
    blockingObstacle: obs,
    alternatives,
  };
}

/**
 * Gestor del ciclo completo de vehículos (ordinarios, logísticos y de emergencia)
 * dentro de `EventEngine`:
 * `spawn conectado -> entrada -> operación (estacionar/descargar/servicio) -> ruta de salida -> abandono`.
 */
export class VehicleManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  private _vehGrid: NavigationGrid | null = null;
  vehicles: SimVehicle[];
  departedCount: number;
  blockedReports: Array<{
    at: number;
    vehicleId: string;
    kind: VehicleKind;
    reason: string;
    blockingObstacle?: string;
    alternatives: VehicleAlternative[];
  }>;
  nextSpawnAt: number;
  seq: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.vehicles = [];
    this.departedCount = 0;
    this.blockedReports = [];
    this.nextSpawnAt = 8;
    this.seq = 1;
  }

  get vehGrid(): NavigationGrid {
    if (!this._vehGrid) {
      this._vehGrid = buildVehicleGrid(this.e.s, this.e.g);
    }
    return this._vehGrid;
  }

  /** Devuelve todos los spawns vehiculares o bases exteriores válidas y abiertas. */
  vehicleSpawns(): EntranceItem[] {
    return (this.e.s.entrances || []).filter(
      (g: EntranceItem) =>
        (g.phases?.event || g.role || 'both') !== 'closed' &&
        (g.spawnType === 'vehicle' || g.spawnType === 'mixed' || g.externalBase)
    );
  }

  /**
   * Genera un vehículo concreto desde un spawn/base válido y valida su ruta completa
   * antes de iniciar el recorrido.
   */
  spawnFrom(spawn: EntranceItem, forcedKind?: VehicleKind): SimVehicle | null {
    const e = this.e;
    const cat = spawn.vehicleCategory || 'all';
    const kind: VehicleKind =
      forcedKind ||
      (cat !== 'all'
        ? cat
        : e.random() < 0.45
          ? 'logistics'
          : 'ordinary');
    const spec = VEHICLE_SPECS[kind];
    const origin = world([spawn.x, spawn.y], e.g.m);
    const destInfo = this.pickDestination(spawn, kind);
    let activeDest = destInfo;
    let plan = planVehicleRoute(e.s, this.vehGrid, origin, activeDest.point, spec, {
      allowFootDismount: kind === 'emergency',
      pedestrianGrid: e.g,
    });

    // Si la ruta directa al primer destino está bloqueada, buscar un punto interior despejado de la plaza
    // para que el vehículo entre a cumplir su labor (estacionar/descargar/servicio) en lugar de desaparecer en el acceso.
    if (!plan.ok) {
      const bPts = (e.s.boundary || []).map((p: Point2D) => world(p, e.g.m));
      const candidates: Array<{point: Point2D; name: string; operation: SimVehicle['operation']}> = [];
      if (bPts.length >= 3) {
        const cx = bPts.reduce((s: number, p: Point2D) => s + p[0], 0) / bPts.length;
        const cy = bPts.reduce((s: number, p: Point2D) => s + p[1], 0) / bPts.length;
        candidates.push({point: [cx, cy], name: 'Interior de la plaza', operation: 'service'});
        for (const [ox, oy] of [
          [12, 0],
          [-12, 0],
          [0, 12],
          [0, -12],
        ]) {
          candidates.push({
            point: [cx + ox, cy + oy],
            name: 'Punto de servicio interior',
            operation: 'service',
          });
        }
      }
      for (const cand of candidates) {
        const altPlan = planVehicleRoute(e.s, this.vehGrid, origin, cand.point, spec, {
          allowFootDismount: kind === 'emergency',
          pedestrianGrid: e.g,
        });
        if (altPlan.ok && altPlan.path) {
          plan = {...altPlan, rerouted: true};
          activeDest = cand;
          break;
        }
      }
    }

    const id = `veh-${this.seq++}`;
    if (!plan.ok || !plan.path) {
      this.blockedReports.push({
        at: e.time,
        vehicleId: id,
        kind,
        reason: plan.reason || 'Ruta vehicular bloqueada.',
        blockingObstacle: plan.blockingObstacle,
        alternatives: plan.alternatives,
      });
      if (this.blockedReports.length > 30) this.blockedReports.shift();
      return null;
    }

    const startPose = poseAt(plan.path, 0);
    const veh: SimVehicle = {
      id,
      kind,
      name: `${spec.label} #${this.seq - 1}`,
      spawnId: spawn.id,
      spawnName: spawn.name,
      state: 'entering',
      operation: activeDest.operation,
      x: startPose.x,
      y: startPose.y,
      angle: startPose.angle,
      width: spec.width,
      length: spec.length,
      speed: spec.speed,
      path: plan.path,
      pathDist: 0,
      pathLength: plan.length || pathLength(plan.path),
      destination: activeDest.point,
      destinationName: activeDest.name,
      operateUntil: 0,
      stuckSeconds: 0,
      rerouteCount: 0,
      diagnostic: plan,
    };
    this.vehicles.push(veh);
    return veh;
  }

  private pickDestination(
    spawn: EntranceItem,
    kind: VehicleKind
  ): {point: Point2D; name: string; operation: SimVehicle['operation']} {
    const e = this.e;
    const m = e.g.m;
    const reserves = e.s.reserves || [];
    const loadingZones = reserves.filter(
      (r: {origin?: string; points?: Point2D[]}) =>
        r.origin === 'loading' && r.points && r.points.length >= 3
    );
    const turningZones = reserves.filter(
      (r: {origin?: string; points?: Point2D[]}) =>
        r.origin === 'turning' && r.points && r.points.length >= 3
    );

    const centroid = (pts: Point2D[]): Point2D => {
      const wPts = pts.map((p) => world(p, m));
      return [
        wPts.reduce((s, p) => s + p[0], 0) / wPts.length,
        wPts.reduce((s, p) => s + p[1], 0) / wPts.length,
      ];
    };

    if (kind === 'logistics' && loadingZones.length) {
      const z = loadingZones[Math.floor(e.random() * loadingZones.length)];
      return {point: centroid(z.points), name: z.name || 'Carga y descarga', operation: 'unload'};
    }
    if (turningZones.length) {
      const z = turningZones[Math.floor(e.random() * turningZones.length)];
      return {point: centroid(z.points), name: z.name || 'Zona de maniobra', operation: 'park'};
    }
    if (loadingZones.length) {
      const z = loadingZones[Math.floor(e.random() * loadingZones.length)];
      return {point: centroid(z.points), name: z.name || 'Servicio público', operation: 'service'};
    }

    // Si no hay zona de carga/maniobra dibujada, entrar al interior despejado del perímetro
    // para realizar la operación (estacionar / servicio) y luego salir por un acceso válido.
    const bPts = (e.s.boundary || []).map((p: Point2D) => world(p, m));
    if (bPts.length >= 3) {
      return {
        point: [
          bPts.reduce((s: number, p: Point2D) => s + p[0], 0) / bPts.length,
          bPts.reduce((s: number, p: Point2D) => s + p[1], 0) / bPts.length,
        ],
        name: 'Área operativa interior',
        operation: kind === 'logistics' ? 'unload' : 'service',
      };
    }
    return {
      point: [m.widthMeters / 2, m.heightMeters / 2],
      name: 'Centro del plano',
      operation: 'service',
    };
  }

  private pickExit(veh: SimVehicle): {point: Point2D; name: string} {
    const e = this.e;
    const m = e.g.m;
    const spawns = this.vehicleSpawns();
    // Si el vehículo partió de una base exterior (o existen bases exteriores), debe volver a su base
    // en lugar de desaparecer en un acceso mixto del borde de la plaza.
    const ownSpawn = spawns.find((g) => g.id === veh.spawnId);
    if (ownSpawn?.externalBase) {
      return {point: world([ownSpawn.x, ownSpawn.y], m), name: ownSpawn.name};
    }
    const extBases = spawns.filter((g) => g.externalBase);
    if (extBases.length) {
      const chosen = extBases[Math.floor(e.random() * extBases.length)];
      return {point: world([chosen.x, chosen.y], m), name: chosen.name};
    }
    const other = spawns.filter(
      (g) =>
        g.id !== veh.spawnId &&
        ['both', 'out', 'free'].includes(g.phases?.event || g.role || 'both')
    );
    const chosen =
      (other.length ? other[Math.floor(e.random() * other.length)] : null) ||
      ownSpawn ||
      spawns[0];
    if (chosen) {
      return {point: world([chosen.x, chosen.y], m), name: chosen.name};
    }
    return {point: veh.path[0] || [veh.x, veh.y], name: veh.spawnName};
  }

  update(dt: number): void {
    const e = this.e;
    const spawns = this.vehicleSpawns();

    // Generación periódica de vehículos desde spawns vehiculares / bases exteriores
    const activeCount = this.vehicles.filter((v) => v.state !== 'departed').length;
    if (spawns.length && e.time >= this.nextSpawnAt && activeCount < Math.min(8, spawns.length * 2)) {
      const chosen = spawns[Math.floor(e.random() * spawns.length)];
      this.spawnFrom(chosen);
      this.nextSpawnAt = e.time + 22 + e.random() * 25;
    }

    for (const v of this.vehicles) {
      if (v.state === 'departed' || v.state === 'blocked') continue;

      if (v.state === 'operating') {
        if (e.time >= v.operateUntil) {
          // Calcular ruta de salida y abandonar el área operativa
          const exitInfo = this.pickExit(v);
          const spec = VEHICLE_SPECS[v.kind];
          const exitPlan = planVehicleRoute(
            e.s,
            this.vehGrid,
            [v.x, v.y],
            exitInfo.point,
            spec
          );
          if (exitPlan.ok && exitPlan.path) {
            v.path = exitPlan.path;
            v.pathDist = 0;
            v.pathLength = exitPlan.length || pathLength(exitPlan.path);
            v.destination = exitInfo.point;
            v.destinationName = exitInfo.name;
            v.state = 'exiting';
          } else {
            // Regresar por la ruta de entrada invertida si no hay otra salida
            const rev = v.path.slice().reverse();
            v.path = rev;
            v.pathDist = 0;
            v.pathLength = pathLength(rev);
            v.destination = rev[rev.length - 1] || [v.x, v.y];
            v.destinationName = v.spawnName;
            v.state = 'exiting';
          }
        }
        continue;
      }

      // Desplazamiento en 'entering' o 'exiting'
      const step = v.speed * dt;
      const nextDist = Math.min(v.pathLength, v.pathDist + step);
      const nextPose = poseAt(v.path, nextDist);

      // Comprobar si hay bloqueo imprevisto (nunca permanecer intentando atravesar un obstáculo)
      const hit = hullClearOnGrid(this.vehGrid, nextPose, v.width, v.length);
      if (hit) {
        v.stuckSeconds += dt;
        if (v.stuckSeconds >= 2) {
          const spec = VEHICLE_SPECS[v.kind];
          const retry =
            v.rerouteCount < 2
              ? planVehicleRoute(e.s, this.vehGrid, [v.x, v.y], v.destination, spec)
              : null;
          if (retry?.ok && retry.path) {
            v.path = retry.path;
            v.pathDist = 0;
            v.pathLength = retry.length || pathLength(retry.path);
            v.stuckSeconds = 0;
            v.rerouteCount++;
          } else {
            const obs = identifyBlockingObstacle(hit, e.s, e.g.m);
            v.state = 'blocked';
            v.diagnostic = retry || {
              ok: false,
              reason: `Vehículo detenido ante obstáculo «${obs}».`,
              blockingObstacle: obs,
              alternatives: [
                {kind: 'manual', label: `Despejar «${obs}» o reasignar acceso`},
              ],
            };
            this.blockedReports.push({
              at: e.time,
              vehicleId: v.id,
              kind: v.kind,
              reason: v.diagnostic.reason || `Bloqueado por «${obs}»`,
              blockingObstacle: obs,
              alternatives: v.diagnostic.alternatives,
            });
          }
        }
        continue;
      }

      v.stuckSeconds = 0;
      v.pathDist = nextDist;
      v.x = nextPose.x;
      v.y = nextPose.y;
      v.angle = nextPose.angle;

      if (v.pathDist >= v.pathLength - 0.15) {
        if (v.state === 'entering') {
          if (v.operation === 'transit') {
            v.state = 'departed';
            this.departedCount++;
          } else {
            v.state = 'operating';
            v.operateUntil =
              e.time + (v.operation === 'unload' ? 28 : 16);
          }
        } else if (v.state === 'exiting') {
          v.state = 'departed';
          this.departedCount++;
        }
      }
    }

    // Limpiar vehículos ya salidos para no acumular memoria
    if (this.vehicles.length > 40) {
      this.vehicles = this.vehicles.filter((v) => v.state !== 'departed');
    }
  }
}
