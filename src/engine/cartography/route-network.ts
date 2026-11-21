/**
 * @module engine/cartography/route-network
 * Motor puro de unión fluida y red de ramales para cualquier ruta dibujada
 * (`s.flows`, `s.corridors`, `s.roadPlans`).
 *
 * - Enganche magnético (`snapRoutePoint`) al dibujar para unir extremos o
 *   empalmes en T sin huecos.
 * - Grafo de nodos y ramales (`buildRouteNetwork`) que detecta intersecciones,
 *   empalmes en T y vértices compartidos para construir bifurcaciones reales.
 * - Evaluación de coste objetivo por ramal (`evaluateBranchCost` y
 *   `routeBranchPenalty`) basada en caudal (densidad local), dimensiones
 *   (anchura del corredor frente al diámetro de la partícula/vehículo) y
 *   velocidad objetiva.
 */
import type {GeometryTrace, MapMetadata, Point2D} from '../../types';
import {segmentDistance, world} from './geometry';

export interface RouteNode {
  id: number;
  point: Point2D;
  degree: number;
  isJunction: boolean;
}

export interface RouteEdge {
  id: string;
  routeId: string;
  a: number;
  b: number;
  ptA: Point2D;
  ptB: Point2D;
  length: number;
  width: number;
}

export interface RouteNetwork {
  nodes: RouteNode[];
  edges: RouteEdge[];
  junctions: RouteNode[];
}

/** Proyecta un punto `p` sobre el segmento `[a, b]` en metros locales. */
function projectPointOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): {point: Point2D; t: number; dist: number} {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return {
      point: [a[0], a[1]],
      t: 0,
      dist: Math.hypot(p[0] - a[0], p[1] - a[1]),
    };
  }
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq)
  );
  const px = a[0] + dx * t;
  const py = a[1] + dy * t;
  return {
    point: [px, py],
    t,
    dist: Math.hypot(p[0] - px, p[1] - py),
  };
}

/** Calcula la intersección interior de dos segmentos `[a, b]` y `[c, d]`, o `null`. */
function segmentIntersectionPoint(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D
): Point2D | null {
  const rX = b[0] - a[0];
  const rY = b[1] - a[1];
  const sX = d[0] - c[0];
  const sY = d[1] - c[1];
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null;
  const qpX = c[0] - a[0];
  const qpY = c[1] - a[1];
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return [a[0] + t * rX, a[1] + t * rY];
  }
  return null;
}

/**
 * Engancha un punto clicado en metros locales al vértice o segmento más cercano
 * de cualquier ruta existente (dentro de `tolMeters`, por defecto `1.8 m`) para
 * crear empalmes en T y ramales limpios sin huecos.
 */
export function snapRoutePoint(
  cursorMeters: Point2D,
  routes: GeometryTrace[],
  map: MapMetadata,
  tolMeters = 1.8
): {point: Point2D; snapped: boolean} {
  let bestPt: Point2D = cursorMeters;
  let bestDist = tolMeters;
  let snapped = false;

  for (const r of routes) {
    const pts = (r.points || []).map((pt) => world(pt, map));
    // 1. Prioridad a vértices existentes
    for (const v of pts) {
      const d = Math.hypot(cursorMeters[0] - v[0], cursorMeters[1] - v[1]);
      if (d <= bestDist) {
        bestDist = d;
        bestPt = [v[0], v[1]];
        snapped = true;
      }
    }
    // 2. Proyección sobre segmentos (empalme en T)
    for (let i = 1; i < pts.length; i++) {
      const proj = projectPointOnSegment(cursorMeters, pts[i - 1], pts[i]);
      if (proj.dist < bestDist) {
        bestDist = proj.dist;
        bestPt = proj.point;
        snapped = true;
      }
    }
  }

  return {point: bestPt, snapped};
}

/**
 * Construye una red fluida de nodos y ramales a partir de todas las rutas
 * dibujadas, dividiendo segmentos en intersecciones y empalmes en T.
 */
export function buildRouteNetwork(
  routes: GeometryTrace[],
  map: MapMetadata,
  junctionTolMeters = 1.5
): RouteNetwork {
  interface RawSeg {
    routeId: string;
    a: Point2D;
    b: Point2D;
    width: number;
  }
  const rawSegs: RawSeg[] = [];
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri];
    const pts = (r.points || []).map((pt) => world(pt, map));
    const width = Math.max(1, Number(r.width) || 3.5);
    const routeId = r.id || `route-${ri}`;
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 0.2) {
        continue;
      }
      rawSegs.push({routeId, a: pts[i - 1], b: pts[i], width});
    }
  }
  if (!rawSegs.length) {
    return {nodes: [], edges: [], junctions: []};
  }

  // Recoger puntos de corte en cada segmento (intersecciones y empalmes en T)
  const splitParams: number[][] = rawSegs.map(() => [0, 1]);
  for (let i = 0; i < rawSegs.length; i++) {
    for (let j = i + 1; j < rawSegs.length; j++) {
      const s1 = rawSegs[i];
      const s2 = rawSegs[j];
      const hit = segmentIntersectionPoint(s1.a, s1.b, s2.a, s2.b);
      if (hit) {
        splitParams[i].push(projectPointOnSegment(hit, s1.a, s1.b).t);
        splitParams[j].push(projectPointOnSegment(hit, s2.a, s2.b).t);
      } else {
        // Empalmes cercanos en T
        for (const endPt of [s2.a, s2.b]) {
          const p1 = projectPointOnSegment(endPt, s1.a, s1.b);
          if (p1.dist <= junctionTolMeters) splitParams[i].push(p1.t);
        }
        for (const endPt of [s1.a, s1.b]) {
          const p2 = projectPointOnSegment(endPt, s2.a, s2.b);
          if (p2.dist <= junctionTolMeters) splitParams[j].push(p2.t);
        }
      }
    }
  }

  // Fusionar nodos próximos en vértices únicos
  const nodes: RouteNode[] = [];
  const getOrCreateNode = (pt: Point2D): number => {
    for (const n of nodes) {
      if (Math.hypot(n.point[0] - pt[0], n.point[1] - pt[1]) <= junctionTolMeters) {
        return n.id;
      }
    }
    const id = nodes.length;
    nodes.push({id, point: [pt[0], pt[1]], degree: 0, isJunction: false});
    return id;
  };

  const edges: RouteEdge[] = [];
  for (let i = 0; i < rawSegs.length; i++) {
    const seg = rawSegs[i];
    const ts = [...splitParams[i]].sort((a, b) => a - b);
    const dedupTs: number[] = [];
    for (const t of ts) {
      if (!dedupTs.length || t - dedupTs[dedupTs.length - 1] > 0.02) {
        dedupTs.push(t);
      }
    }
    for (let k = 1; k < dedupTs.length; k++) {
      const t0 = dedupTs[k - 1];
      const t1 = dedupTs[k];
      const p0: Point2D = [
        seg.a[0] + (seg.b[0] - seg.a[0]) * t0,
        seg.a[1] + (seg.b[1] - seg.a[1]) * t0,
      ];
      const p1: Point2D = [
        seg.a[0] + (seg.b[0] - seg.a[0]) * t1,
        seg.a[1] + (seg.b[1] - seg.a[1]) * t1,
      ];
      const nA = getOrCreateNode(p0);
      const nB = getOrCreateNode(p1);
      if (nA === nB) continue;
      const ptA = nodes[nA].point;
      const ptB = nodes[nB].point;
      const length = Math.hypot(ptB[0] - ptA[0], ptB[1] - ptA[1]);
      if (length < 0.2) continue;
      edges.push({
        id: `${seg.routeId}-${i}-${k}`,
        routeId: seg.routeId,
        a: nA,
        b: nB,
        ptA,
        ptB,
        length,
        width: seg.width,
      });
      nodes[nA].degree++;
      nodes[nB].degree++;
    }
  }

  for (const n of nodes) {
    n.isJunction = n.degree >= 3;
  }

  return {
    nodes,
    edges,
    junctions: nodes.filter((n) => n.isJunction),
  };
}

/**
 * Evalúa la velocidad efectiva y coste objetivo de un ramal en función de:
 * - **Dimensiones**: anchura del ramal (`edge.width`) respecto al diámetro del agente.
 * - **Caudal**: densidad local (`localDensity` agentes en la celda) respecto a la capacidad del ramal.
 * - **Velocidad objetiva**: velocidad deseada del agente (`targetSpeed` m/s).
 */
export function evaluateBranchFlow(
  edge: Pick<RouteEdge, 'width' | 'length'>,
  agentWidth: number,
  localDensity: number,
  targetSpeed: number
): {effectiveSpeed: number; congestionRatio: number; costSeconds: number} {
  const safeWidth = Math.max(0.5, agentWidth);
  const lanes = Math.max(1, edge.width / (safeWidth * 1.25));
  const capacity = lanes * 2.2;
  const congestionRatio = Math.max(0, Math.min(1.5, localDensity / capacity));
  const widthBonus = Math.min(1.15, 0.85 + edge.width / 16);
  const speedFactor = Math.max(0.22, (1 - 0.65 * Math.min(1, congestionRatio)) * widthBonus);
  const effectiveSpeed = Math.max(0.2, targetSpeed * speedFactor);
  return {
    effectiveSpeed,
    congestionRatio,
    costSeconds: edge.length / effectiveSpeed,
  };
}

/**
 * Calcula un término de preferencia/penalización de ramal para una celda en `pt`
 * (negativo = ramal amplio y fluido; positivo = ramal estrecho o congestionado).
 */
export function routeBranchBias(
  pt: Point2D,
  network: RouteNetwork | undefined,
  localDensity: number,
  targetSpeed: number,
  agentWidth: number
): number {
  if (!network || !network.edges.length) return 0;
  let bestEdge: RouteEdge | null = null;
  let bestDist = Infinity;
  for (const edge of network.edges) {
    const d = segmentDistance(pt, edge.ptA, edge.ptB);
    if (d <= edge.width / 2 && d < bestDist) {
      bestDist = d;
      bestEdge = edge;
    }
  }
  if (!bestEdge) return 0;
  const {effectiveSpeed, congestionRatio} = evaluateBranchFlow(
    bestEdge,
    agentWidth,
    localDensity,
    targetSpeed
  );
  // Ramales amplios y fluidos reducen el coste (preferencia negativa); ramales saturados penalizan
  const speedRatio = effectiveSpeed / Math.max(0.2, targetSpeed);
  return congestionRatio * 1.2 - speedRatio * 0.45;
}

/**
 * Construye el atributo SVG `d` de una ruta en coordenadas locales (metros).
 * Con `curved = false` devuelve tramos rectos (`M ... L ...`).
 * Con `curved = true` aplica un suavizado Bézier cuadrático ligero (`Q`) en cada
 * vértice interior sin mover los extremos (para mantener los empalmes/ramales exactos)
 * y sin sobrepasar nunca los segmentos adyacentes.
 */
export function routePathD(
  points: Point2D[],
  curved: boolean,
  radiusMeters = 2.0
): string {
  if (!points.length) return '';
  const fmt = (n: number) => Number(n.toFixed(2));
  if (points.length === 1) return `M${fmt(points[0][0])},${fmt(points[0][1])}`;
  if (!curved || points.length === 2) {
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p[0])},${fmt(p[1])}`)
      .join(' ');
  }
  const cmds: string[] = [`M${fmt(points[0][0])},${fmt(points[0][1])}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const dx1 = prev[0] - curr[0];
    const dy1 = prev[1] - curr[1];
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next[0] - curr[0];
    const dy2 = next[1] - curr[1];
    const len2 = Math.hypot(dx2, dy2);
    if (len1 < 0.05 || len2 < 0.05) {
      cmds.push(`L${fmt(curr[0])},${fmt(curr[1])}`);
      continue;
    }
    const r = Math.min(radiusMeters, len1 * 0.35, len2 * 0.35);
    const inX = curr[0] + (dx1 / len1) * r;
    const inY = curr[1] + (dy1 / len1) * r;
    const outX = curr[0] + (dx2 / len2) * r;
    const outY = curr[1] + (dy2 / len2) * r;
    cmds.push(
      `L${fmt(inX)},${fmt(inY)} Q${fmt(curr[0])},${fmt(curr[1])} ${fmt(outX)},${fmt(outY)}`
    );
  }
  const last = points[points.length - 1];
  cmds.push(`L${fmt(last[0])},${fmt(last[1])}`);
  return cmds.join(' ');
}
