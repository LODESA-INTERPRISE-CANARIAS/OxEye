/**
 * @module engine/emergency/stretcher-nav
 * Navegación y evaluación de colisiones diferenciada en 3 rutas independientes:
 *  - Ruta A: Vehicular (ambulancia desde su base/posición hasta punto practicable de estacionamiento).
 *  - Ruta B: Sanitaria peatonal (sanitario a pie desde la ambulancia estacionada hasta la víctima).
 *  - Ruta C: Evacuación con camilla (desde la víctima hasta la ambulancia considerando huella física
 *            + espacio de maniobra, giros y obstáculos).
 */
import type {
  NavigationGrid,
  Point2D,
  Scene,
  StretcherConfig,
} from '../../types';
import {inside, world} from '../cartography/geometry';
import {flow} from '../crowd/grid-flow';
import {
  buildVehicleGrid,
  identifyBlockingObstacle,
  planVehicleRoute,
} from '../mobility/vehicle-system';
import {poseAt} from './priority';

/** Propiedades iniciales recomendadas de una camilla convencional desplegada (2,00 m × 0,65 m). */
export const DEFAULT_STRETCHER_CONFIG: StretcherConfig = {
  length: 2.0,
  width: 0.65,
  handlingMarginLength: 0.55,
  handlingMarginWidth: 0.2,
  requiredOperators: 2,
  state: 'deployed',
  canTransportPatient: true,
  speedEmpty: 1.15,
  speedLoaded: 0.85,
};

/** Resuelve la configuración efectiva de camilla combinando valores por defecto y overrides de escena. */
export function resolveStretcherConfig(
  override?: Partial<StretcherConfig> | null
): StretcherConfig {
  const clamp = (v: unknown, def: number, min: number, max: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
  };
  return {
    length: clamp(override?.length, DEFAULT_STRETCHER_CONFIG.length, 0.8, 3.0),
    width: clamp(override?.width, DEFAULT_STRETCHER_CONFIG.width, 0.4, 1.2),
    handlingMarginLength: clamp(
      override?.handlingMarginLength,
      DEFAULT_STRETCHER_CONFIG.handlingMarginLength,
      0.1,
      1.5
    ),
    handlingMarginWidth: clamp(
      override?.handlingMarginWidth,
      DEFAULT_STRETCHER_CONFIG.handlingMarginWidth,
      0.05,
      0.8
    ),
    requiredOperators: Math.round(
      clamp(
        override?.requiredOperators,
        DEFAULT_STRETCHER_CONFIG.requiredOperators,
        1,
        4
      )
    ),
    state: override?.state === 'folded' ? 'folded' : 'deployed',
    canTransportPatient: override?.canTransportPatient !== false,
    speedEmpty: clamp(
      override?.speedEmpty,
      DEFAULT_STRETCHER_CONFIG.speedEmpty,
      0.4,
      2.2
    ),
    speedLoaded: clamp(
      override?.speedLoaded,
      DEFAULT_STRETCHER_CONFIG.speedLoaded,
      0.3,
      1.8
    ),
  };
}

export interface RouteEvalResult {
  ok: boolean;
  path?: Point2D[];
  length?: number;
  reason?: string;
  blockingObstacle?: string;
  turnBlocked?: boolean;
}

export interface MedicalResponsePlan {
  stretcher: StretcherConfig;
  routeA: RouteEvalResult & {
    stagingPoint: Point2D;
    directToVictim: boolean;
  };
  routeB: RouteEvalResult;
  routeC: RouteEvalResult;
  assistancePossible: boolean;
  stretcherEvacuationPossible: boolean;
  failedPhase:
    | 'none'
    | 'vehicle_approach'
    | 'medic_foot'
    | 'stretcher_evacuation';
  severity: 'info' | 'warning' | 'critical';
  summaryTitle: string;
  summaryDetail: string;
}

const dist = (a: Point2D, b: Point2D): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const pathLength = (pts: Point2D[]): number =>
  pts.slice(1).reduce((acc, q, i) => acc + dist(pts[i], q), 0);

/** Comprueba si una huella rectangular `(w × l)` cabe libre de obstáculos sobre `baseFree`. */
function rectFitsOnMask(
  grid: NavigationGrid,
  baseFree: Uint8Array,
  pose: {x: number; y: number; angle: number},
  w: number,
  l: number
): Point2D | null {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const nx = Math.max(2, Math.ceil(l / 0.35));
  const ny = Math.max(2, Math.ceil(w / 0.25));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const u = -l / 2 + (i * l) / nx;
      const v = -w / 2 + (j * w) / ny;
      const px = pose.x + u * cos - v * sin;
      const py = pose.y + u * sin + v * cos;
      const k = grid.index(px, py);
      if (k < 0 || !baseFree[k]) return [px, py];
    }
  }
  return null;
}

/** Construye una ruta sobre `staffFree` con erosión radial `radius` y verificación opcional de huella barrida. */
function computeMaskedRoute(
  scene: Scene,
  grid: NavigationGrid,
  origin: Point2D,
  destination: Point2D,
  opts: {
    erodeRadius: number;
    hullWidth?: number;
    hullLength?: number;
    startSearchRadius?: number;
    endSearchRadius?: number;
  }
): RouteEvalResult {
  const baseFree: Uint8Array = grid.staffFree || grid.free;
  const free = new Uint8Array(baseFree.length);
  const r = opts.erodeRadius;

  for (let k = 0; k < baseFree.length; k++) {
    if (!baseFree[k]) continue;
    if (r <= 0.1) {
      free[k] = 1;
      continue;
    }
    const p = grid.point(k);
    let clear = true;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const j = grid.index(p[0] + r * Math.cos(a), p[1] + r * Math.sin(a));
      if (j < 0 || !baseFree[j]) {
        clear = false;
        break;
      }
    }
    if (clear) free[k] = 1;
  }

  const masked: NavigationGrid = {
    ...grid,
    free,
    neighbors: (k: number) => {
      const col = k % grid.w;
      const row = Math.floor(k / grid.w);
      const out: number[] = [];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = col + di;
          const nj = row + dj;
          if (ni < 0 || ni >= grid.w || nj < 0 || nj >= grid.h) continue;
          const nk = nj * grid.w + ni;
          if (!free[nk]) continue;
          // Evitar cortar esquinas en diagonal si un ortogonal adyacente está bloqueado
          if (di !== 0 && dj !== 0) {
            if (!free[row * grid.w + ni] || !free[nj * grid.w + col]) continue;
          }
          out.push(nk);
        }
      }
      return out;
    },
  };

  const findNearest = (pt: Point2D, maxR: number): number => {
    let best = -1;
    let bestD = maxR;
    const minI = Math.max(0, Math.floor((pt[0] - maxR) / grid.cell));
    const maxI = Math.min(grid.w - 1, Math.ceil((pt[0] + maxR) / grid.cell));
    const minJ = Math.max(0, Math.floor((pt[1] - maxR) / grid.cell));
    const maxJ = Math.min(grid.h - 1, Math.ceil((pt[1] + maxR) / grid.cell));
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const k = j * grid.w + i;
        if (!free[k]) continue;
        const p = grid.point(k);
        const d = dist(p, pt);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    return best;
  };

  const sIdx = findNearest(origin, opts.startSearchRadius ?? 12);
  const tIdx = findNearest(destination, opts.endSearchRadius ?? 6);
  if (sIdx < 0 || tIdx < 0) {
    const failPt = sIdx < 0 ? origin : destination;
    const obs = identifyBlockingObstacle(failPt, scene, grid.m);
    return {
      ok: false,
      reason: `Espacio insuficiente junto a «${obs}» para la anchura requerida (${(r * 2).toFixed(2)} m).`,
      blockingObstacle: obs,
    };
  }

  const field = flow(masked, tIdx);
  if (field[sIdx] < 0) {
    const midPt: Point2D = [
      (origin[0] + destination[0]) / 2,
      (origin[1] + destination[1]) / 2,
    ];
    const obs = identifyBlockingObstacle(midPt, scene, grid.m);
    return {
      ok: false,
      reason: `No existe un paso continuo con anchura útil suficiente (bloqueado cerca de «${obs}»).`,
      blockingObstacle: obs,
    };
  }

  const pts: Point2D[] = [grid.point(sIdx)];
  let k = sIdx;
  for (let step = 0; step < free.length && k !== tIdx; step++) {
    const nxt = masked
      .neighbors(k)
      .filter((n) => field[n] >= 0 && field[n] < field[k])
      .sort((a, b) => field[a] - field[b])[0];
    if (nxt === undefined) break;
    k = nxt;
    pts.push(grid.point(k));
  }

  if (k !== tIdx) {
    const obs = identifyBlockingObstacle(grid.point(k), scene, grid.m);
    return {
      ok: false,
      reason: `Recorrido interrumpido junto a «${obs}».`,
      blockingObstacle: obs,
    };
  }

  // Verificación de huella rectangular barrida en giros y estrechamientos (para camilla desplegada)
  if (opts.hullWidth && opts.hullLength) {
    const total = pathLength(pts);
    for (let ds = 0; ds <= total; ds += 0.35) {
      const hit = rectFitsOnMask(
        grid,
        baseFree,
        poseAt(pts, ds),
        opts.hullWidth,
        opts.hullLength
      );
      if (hit) {
        const obs = identifyBlockingObstacle(hit, scene, grid.m);
        return {
          ok: false,
          turnBlocked: true,
          reason: `La camilla desplegada (${opts.hullWidth.toFixed(2)} × ${opts.hullLength.toFixed(2)} m) no cabe en el giro o estrechamiento junto a «${obs}».`,
          blockingObstacle: obs,
        };
      }
    }
  }

  return {
    ok: true,
    path: pts,
    length: pathLength(pts),
  };
}

/**
 * Ruta B — Evalúa la aproximación peatonal de un sanitario a pie (sin heredar dimensiones de ambulancia).
 */
export function evaluateMedicFootRoute(
  scene: Scene,
  grid: NavigationGrid,
  origin: Point2D,
  victimPoint: Point2D
): RouteEvalResult {
  return computeMaskedRoute(scene, grid, origin, victimPoint, {
    erodeRadius: 0.25,
    startSearchRadius: 16,
    endSearchRadius: 1.6,
  });
}

/**
 * Ruta C — Evalúa la evacuación con camilla desplegada (`2,00 × 0,65 m` + margen de manipulación)
 * desde la víctima hasta la ambulancia estacionada, comprobando anchura útil y giros.
 */
export function evaluateStretcherEvacuationRoute(
  scene: Scene,
  grid: NavigationGrid,
  victimPoint: Point2D,
  ambulanceStagingPoint: Point2D,
  stretcherOverride?: Partial<StretcherConfig> | null
): RouteEvalResult {
  const st = resolveStretcherConfig(stretcherOverride);
  // Distinguir huella física (width × length) y espacio operativo mínimo de manipulación
  const effectiveWidth = st.width + st.handlingMarginWidth;
  const effectiveLength = st.length + st.handlingMarginLength * 0.5;
  return computeMaskedRoute(scene, grid, victimPoint, ambulanceStagingPoint, {
    erodeRadius: effectiveWidth / 2,
    hullWidth: st.width,
    hullLength: effectiveLength,
    startSearchRadius: 1.6,
    endSearchRadius: 16,
  });
}

/**
 * Evaluación completa de las 3 rutas independientes (A: Vehicular, B: Sanitario a pie,
 * C: Evacuación con camilla) para una ambulancia y una ubicación de incidente.
 */
export function evaluateMedicalResponsePlan(opts: {
  scene: Scene;
  pedGrid: NavigationGrid;
  vehGrid?: NavigationGrid;
  ambulanceOrigin: Point2D;
  victimPoint: Point2D;
  ambulanceWidth?: number;
  ambulanceLength?: number;
  allowVehicleDirect?: boolean;
}): MedicalResponsePlan {
  const {scene, pedGrid, ambulanceOrigin, victimPoint} = opts;
  const stretcher = resolveStretcherConfig(scene.stretcher);
  const vehW = opts.ambulanceWidth ?? 2.5;
  const vehL = opts.ambulanceLength ?? 6.0;
  const vehGrid = opts.vehGrid || buildVehicleGrid(scene, pedGrid);

  // 1. Ruta A — Aproximación vehicular (ambulancia hasta punto practicable más cercano)
  let stagingPoint: Point2D = [...ambulanceOrigin];
  let directToVictim = false;
  let routeAPath: Point2D[] | undefined = [ambulanceOrigin];
  let routeAOk = false;
  let routeAReason: string | undefined;
  let routeAObs: string | undefined;

  if (opts.allowVehicleDirect !== false) {
    const planA = planVehicleRoute(
      scene,
      vehGrid,
      ambulanceOrigin,
      victimPoint,
      {
        width: vehW,
        length: vehL,
        minTurnRadius: Math.max(3, vehL * 0.75),
      },
      {
        allowFootDismount: true,
        pedestrianGrid: pedGrid,
      }
    );
    if (planA.ok && planA.path && planA.path.length >= 2) {
      routeAOk = true;
      routeAPath = planA.path;
      stagingPoint = planA.dismountPoint || planA.path[planA.path.length - 1];
      directToVictim =
        !planA.dismountPoint && dist(stagingPoint, victimPoint) <= vehL / 2 + 2.5;
    } else {
      routeAReason =
        planA.reason ||
        'La ambulancia no puede circular por el interior; estacionamiento en punto exterior accesible.';
      routeAObs = planA.blockingObstacle;
    }
  } else {
    routeAReason =
      'Acceso vehicular restringido; ambulancia estacionada en punto exterior.';
  }

  // Construir malla peatonal/sanitaria que conserva los obstáculos interiores de `pedGrid.staffFree`
  // y añade los accesos/aceras exteriores transitables de `vehGrid` (fuera del perímetro)
  // para que sanitarios y camillas puedan ir y volver entre una ambulancia estacionada fuera y la víctima.
  const combinedFree = new Uint8Array(pedGrid.staffFree || pedGrid.free);
  const boundaryMeters = (scene.boundary || []).map((p) => world(p, pedGrid.m));
  if (vehGrid.free.length === combinedFree.length && boundaryMeters.length >= 3) {
    for (let k = 0; k < combinedFree.length; k++) {
      if (!combinedFree[k] && vehGrid.free[k]) {
        const pt = pedGrid.point(k);
        if (!inside(pt, boundaryMeters)) {
          combinedFree[k] = 1;
        }
      }
    }
  }
  const navPedGrid: NavigationGrid = {
    ...pedGrid,
    free: combinedFree,
    staffFree: combinedFree,
  };

  // 2. Ruta B — Sanitario a pie desde la ambulancia estacionada hasta la víctima
  const routeB = evaluateMedicFootRoute(scene, navPedGrid, stagingPoint, victimPoint);

  // 3. Ruta C — Evacuación con camilla desde la víctima hasta la ambulancia estacionada
  const routeC = evaluateStretcherEvacuationRoute(
    scene,
    navPedGrid,
    victimPoint,
    stagingPoint,
    stretcher
  );

  const assistancePossible = routeB.ok;
  const stretcherEvacuationPossible = routeC.ok;

  // Clasificación coherente diferenciando asistencia a pie vs evacuación con camilla
  if (directToVictim && assistancePossible && stretcherEvacuationPossible) {
    return {
      stretcher,
      routeA: {
        ok: true,
        path: routeAPath,
        length: pathLength(routeAPath || []),
        stagingPoint,
        directToVictim: true,
      },
      routeB,
      routeC,
      assistancePossible,
      stretcherEvacuationPossible,
      failedPhase: 'none',
      severity: 'info',
      summaryTitle: 'Acceso directo de ambulancia y evacuación operativa',
      summaryDetail:
        'La ambulancia puede aproximarse directamente y existe recorrido apto para sanitarios y camilla.',
    };
  }

  if (assistancePossible && stretcherEvacuationPossible) {
    return {
      stretcher,
      routeA: {
        ok: routeAOk,
        path: routeAPath,
        length: pathLength(routeAPath || []),
        stagingPoint,
        directToVictim: false,
        reason: routeAReason,
        blockingObstacle: routeAObs,
      },
      routeB,
      routeC,
      assistancePossible: true,
      stretcherEvacuationPossible: true,
      failedPhase: 'vehicle_approach',
      severity: 'warning',
      summaryTitle: 'AVISO — Ambulancia sin acceso directo',
      summaryDetail:
        'La ambulancia no puede acceder hasta la ubicación del incidente. Se ha identificado un punto de estacionamiento alternativo, una ruta peatonal para los sanitarios y un recorrido apto para evacuación en camilla.',
    };
  }

  if (assistancePossible && !stretcherEvacuationPossible) {
    return {
      stretcher,
      routeA: {
        ok: routeAOk,
        path: routeAPath,
        length: pathLength(routeAPath || []),
        stagingPoint,
        directToVictim: false,
        reason: routeAReason,
        blockingObstacle: routeAObs,
      },
      routeB,
      routeC,
      assistancePossible: true,
      stretcherEvacuationPossible: false,
      failedPhase: 'stretcher_evacuation',
      severity: 'critical',
      summaryTitle: 'CRÍTICO — Evacuación con camilla no resuelta',
      summaryDetail:
        `El personal sanitario puede llegar a pie hasta la víctima, pero no existe una ruta apta para el traslado en camilla (${stretcher.width.toFixed(2)} × ${stretcher.length.toFixed(2)} m). ${routeC.reason || 'Revisar obstáculos, anchuras y giros.'}`,
    };
  }

  return {
    stretcher,
    routeA: {
      ok: routeAOk,
      path: routeAPath,
      length: pathLength(routeAPath || []),
      stagingPoint,
      directToVictim: false,
      reason: routeAReason,
      blockingObstacle: routeAObs,
    },
    routeB,
    routeC,
    assistancePossible: false,
    stretcherEvacuationPossible: false,
    failedPhase: 'medic_foot',
    severity: 'critical',
    summaryTitle: 'CRÍTICO — Sin acceso sanitario a pie ni en camilla',
    summaryDetail:
      routeB.reason ||
      'Ni la ambulancia ni el personal sanitario a pie disponen de un paso conectado hasta la ubicación.',
  };
}
