/**
 * @module engine/cartography/fences
 * Utilidades geométricas puras para vallas (encadenadas y sueltas):
 * largo fijo, ajuste angular opcional a 15°, imán a extremos/segmentos
 * y detección de cruces para la simulación.
 */
import type {GeometryTrace, MapMetadata, Point2D} from '../../types';
import {percent, world} from './geometry';

export const DEFAULT_FENCE_LENGTH = 3.5;
export const MIN_FENCE_LENGTH = 0.5;
export const MAX_FENCE_LENGTH = 10;
export const FENCE_SNAP_RADIUS = 0.5;

/** Limita el largo de una valla al rango operativo `[0.5, 10]` metros. */
export function clampFenceLength(length: number): number {
  if (!Number.isFinite(length)) return DEFAULT_FENCE_LENGTH;
  return Math.max(MIN_FENCE_LENGTH, Math.min(MAX_FENCE_LENGTH, Math.round(length * 100) / 100));
}

/** Redondea un ángulo en grados a pasos de 15° cuando `shiftKey` está pulsado. */
export function snapAngleDeg(angleDeg: number, shiftKey: boolean): number {
  if (!shiftKey) return angleDeg;
  return Math.round(angleDeg / 15) * 15;
}

/** Proyecta un punto `p` sobre el segmento `[a, b]` en metros. */
export function projectPointToSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): {point: Point2D; dist: number; t: number} {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return {point: [a[0], a[1]], dist: Math.hypot(p[0] - a[0], p[1] - a[1]), t: 0};
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const proj: Point2D = [a[0] + dx * t, a[1] + dy * t];
  return {point: proj, dist: Math.hypot(p[0] - proj[0], p[1] - proj[1]), t};
}

/** Extrae todos los segmentos de vallas en coordenadas métricas locales. */
export function fenceSegmentsMeters(
  fences: GeometryTrace[],
  map: MapMetadata
): Array<{id: string; name: string; a: Point2D; b: Point2D}> {
  const out: Array<{id: string; name: string; a: Point2D; b: Point2D}> = [];
  for (const f of fences || []) {
    if (!f.points || f.points.length < 2) continue;
    const pts = f.points.map((pt) => world(pt, map));
    for (let i = 1; i < pts.length; i++) {
      out.push({
        id: f.id || `fence-${out.length + 1}`,
        name: f.name || 'Valla',
        a: pts[i - 1],
        b: pts[i],
      });
    }
  }
  return out;
}

/**
 * Aplica imán (snap) a un punto en metros si se encuentra dentro de `snapRadius` (0,5 m por defecto)
 * de un extremo o tramo de otra valla existente. Prioriza extremos sobre puntos intermedios.
 */
export function snapFencePoint(
  pointMeters: Point2D,
  fences: GeometryTrace[],
  map: MapMetadata,
  snapRadius = FENCE_SNAP_RADIUS,
  excludeId?: string
): {point: Point2D; snapped: boolean; snapKind?: 'endpoint' | 'segment'} {
  let bestEndpoint: {point: Point2D; dist: number} | null = null;
  let bestSegment: {point: Point2D; dist: number} | null = null;

  for (const f of fences || []) {
    if (excludeId && f.id === excludeId) continue;
    if (!f.points || f.points.length < 2) continue;
    const pts = f.points.map((pt) => world(pt, map));
    for (const ep of pts) {
      const d = Math.hypot(pointMeters[0] - ep[0], pointMeters[1] - ep[1]);
      if (d <= snapRadius && (!bestEndpoint || d < bestEndpoint.dist)) {
        bestEndpoint = {point: ep, dist: d};
      }
    }
    for (let i = 1; i < pts.length; i++) {
      const proj = projectPointToSegment(pointMeters, pts[i - 1], pts[i]);
      if (proj.dist <= snapRadius && (!bestSegment || proj.dist < bestSegment.dist)) {
        bestSegment = {point: proj.point, dist: proj.dist};
      }
    }
  }

  if (bestEndpoint) {
    return {point: bestEndpoint.point, snapped: true, snapKind: 'endpoint'};
  }
  if (bestSegment) {
    return {point: bestSegment.point, snapped: true, snapKind: 'segment'};
  }
  return {point: pointMeters, snapped: false};
}

/**
 * Calcula el extremo final de una valla de largo fijo partiendo de `startMeters`
 * hacia `cursorMeters`, con ajuste angular opcional a 15° (`shiftKey`) e imán final.
 */
export function computeFixedFenceEnd(
  startMeters: Point2D,
  cursorMeters: Point2D,
  lengthMeters: number,
  shiftKey: boolean,
  fences: GeometryTrace[],
  map: MapMetadata,
  snapRadius = FENCE_SNAP_RADIUS
): {end: Point2D; angleDeg: number; snapped: boolean} {
  const len = clampFenceLength(lengthMeters);
  const dx = cursorMeters[0] - startMeters[0];
  const dy = cursorMeters[1] - startMeters[1];
  const rawAngleDeg = Math.hypot(dx, dy) < 1e-4 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  const angleDeg = snapAngleDeg(rawAngleDeg, shiftKey);
  const rad = (angleDeg * Math.PI) / 180;
  const rawEnd: Point2D = [
    startMeters[0] + Math.cos(rad) * len,
    startMeters[1] + Math.sin(rad) * len,
  ];
  const snap = snapFencePoint(rawEnd, fences, map, snapRadius);
  if (
    snap.snapped &&
    Math.hypot(snap.point[0] - startMeters[0], snap.point[1] - startMeters[1]) >= MIN_FENCE_LENGTH
  ) {
    const snappedAngle =
      (Math.atan2(snap.point[1] - startMeters[1], snap.point[0] - startMeters[0]) * 180) /
      Math.PI;
    return {end: snap.point, angleDeg: snappedAngle, snapped: true};
  }
  return {end: rawEnd, angleDeg, snapped: false};
}

/** Calcula métricas en metros (extremos, centro, largo y ángulo en grados) de una valla. */
export function fenceMetrics(
  fence: GeometryTrace,
  map: MapMetadata
): {a: Point2D; b: Point2D; mid: Point2D; length: number; angleDeg: number} {
  const a = world(fence.points[0] || [0, 0], map);
  const b = world(fence.points[fence.points.length - 1] || [0, 0], map);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    a,
    b,
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    length,
    angleDeg,
  };
}

/**
 * Devuelve todos los índices/IDs de vallas conectadas a `fence` dentro de la misma cadena.
 */
export function connectedFenceChainIds(
  fence: GeometryTrace,
  fences: GeometryTrace[],
  map: MapMetadata,
  toleranceMeters = 0.25
): Set<string> {
  const result = new Set<string>();
  if (!fence.id) return result;
  result.add(fence.id);
  const isChained = fence.fenceKind === 'chain' || !!fence.chainId;
  if (!isChained) return result;

  const sameChain = (fences || []).filter(
    (f) =>
      f.id &&
      f.points?.length >= 2 &&
      (fence.chainId
        ? f.chainId === fence.chainId
        : f.fenceKind === 'chain')
  );
  const queue: GeometryTrace[] = [fence];
  while (queue.length) {
    const cur = queue.shift()!;
    const cPts = cur.points.map((pt) => world(pt, map));
    const cEnds = [cPts[0], cPts[cPts.length - 1]];
    for (const other of sameChain) {
      if (!other.id || result.has(other.id)) continue;
      const oPts = other.points.map((pt) => world(pt, map));
      const oEnds = [oPts[0], oPts[oPts.length - 1]];
      const touches = cEnds.some((ce) =>
        oEnds.some((oe) => Math.hypot(ce[0] - oe[0], ce[1] - oe[1]) <= toleranceMeters)
      );
      if (touches) {
        result.add(other.id);
        queue.push(other);
      }
    }
  }
  return result;
}

/**
 * Devuelve el subconjunto de vallas conectadas en cascada al extremo `side` (`'a'` o `'b'`)
 * de `fence` (incluyendo la propia `fence`), sin retroceder por el extremo opuesto (pivote).
 */
export function downstreamChainIds(
  fence: GeometryTrace,
  side: 'a' | 'b',
  fences: GeometryTrace[],
  map: MapMetadata,
  toleranceMeters = 0.25
): Set<string> {
  const result = new Set<string>();
  if (!fence.id || !fence.points || fence.points.length < 2) return result;
  result.add(fence.id);
  const isChained = fence.fenceKind === 'chain' || !!fence.chainId;
  if (!isChained) return result;

  const sameChain = (fences || []).filter(
    (f) =>
      f.id &&
      f.id !== fence.id &&
      f.points?.length >= 2 &&
      (fence.chainId
        ? f.chainId === fence.chainId
        : f.fenceKind === 'chain')
  );

  const fPts = fence.points.map((pt) => world(pt, map));
  const seedPoint = side === 'a' ? fPts[0] : fPts[fPts.length - 1];
  const frontier: Point2D[] = [seedPoint];

  while (frontier.length) {
    const pt = frontier.shift()!;
    for (const other of sameChain) {
      if (!other.id || result.has(other.id)) continue;
      const oPts = other.points.map((p) => world(p, map));
      const oA = oPts[0];
      const oB = oPts[oPts.length - 1];
      if (Math.hypot(pt[0] - oA[0], pt[1] - oA[1]) <= toleranceMeters) {
        result.add(other.id);
        frontier.push(oB);
      } else if (Math.hypot(pt[0] - oB[0], pt[1] - oB[1]) <= toleranceMeters) {
        result.add(other.id);
        frontier.push(oA);
      }
    }
  }
  return result;
}

/**
 * Rota rígidamente `fence` y todas las vallas encadenadas conectadas a su extremo arrastrado
 * (`draggedSide`) alrededor del extremo opuesto (pivote), manteniendo intactas todas las uniones.
 */
export function rotateFenceChainBranch(
  snapshotFences: GeometryTrace[],
  fenceId: string,
  draggedSide: 'a' | 'b',
  map: MapMetadata,
  cursorMeters: Point2D,
  shiftKey = false
): Map<string, Point2D[]> {
  const out = new Map<string, Point2D[]>();
  const fence = snapshotFences.find((f) => f.id === fenceId);
  if (!fence || !fence.points || fence.points.length < 2) return out;

  const fm = fenceMetrics(fence, map);
  const pivot = draggedSide === 'a' ? fm.b : fm.a;
  const handleStart = draggedSide === 'a' ? fm.a : fm.b;
  const baseAngleDeg =
    (Math.atan2(handleStart[1] - pivot[1], handleStart[0] - pivot[0]) * 180) /
    Math.PI;
  const dx = cursorMeters[0] - pivot[0];
  const dy = cursorMeters[1] - pivot[1];
  if (Math.hypot(dx, dy) < 1e-3) return out;
  const targetAngleDeg = snapAngleDeg(
    (Math.atan2(dy, dx) * 180) / Math.PI,
    shiftKey
  );
  const deltaRad = ((targetAngleDeg - baseAngleDeg) * Math.PI) / 180;
  const cs = Math.cos(deltaRad);
  const sn = Math.sin(deltaRad);

  const branchIds = downstreamChainIds(fence, draggedSide, snapshotFences, map);
  for (const f of snapshotFences) {
    if (!f.id || !branchIds.has(f.id)) continue;
    const rotatedMeters: Point2D[] = f.points.map((pt) => {
      const p = world(pt, map);
      const rx = p[0] - pivot[0];
      const ry = p[1] - pivot[1];
      return [pivot[0] + rx * cs - ry * sn, pivot[1] + rx * sn + ry * cs];
    });
    if (
      rotatedMeters.some(
        (p) =>
          p[0] < 0 ||
          p[0] > map.widthMeters ||
          p[1] < 0 ||
          p[1] > map.heightMeters
      )
    ) {
      return new Map();
    }
    out.set(
      f.id,
      rotatedMeters.map((p) => percent(p, map))
    );
  }
  return out;
}

/**
 * Rota rígidamente una valla (y la rama conectada en su extremo B) un ángulo absoluto `angleDeg`
 * desde el Inspector, manteniendo unidas todas las vallas de la cadena.
 */
export function rotateFenceChainByAngle(
  snapshotFences: GeometryTrace[],
  fenceId: string,
  map: MapMetadata,
  angleDeg: number
): Map<string, Point2D[]> {
  const fence = snapshotFences.find((f) => f.id === fenceId);
  if (!fence || !fence.points || fence.points.length < 2) return new Map();
  const anchors = fenceChainAnchors(fence, snapshotFences, map);
  const draggedSide: 'a' | 'b' =
    anchors.anchorB && !anchors.anchorA ? 'a' : 'b';
  const fm = fenceMetrics(fence, map);
  const pivot = draggedSide === 'a' ? fm.b : fm.a;
  const rad = ((draggedSide === 'a' ? angleDeg + 180 : angleDeg) * Math.PI) / 180;
  const targetCursor: Point2D = [
    pivot[0] + Math.cos(rad) * Math.max(1, fm.length),
    pivot[1] + Math.sin(rad) * Math.max(1, fm.length),
  ];
  return rotateFenceChainBranch(
    snapshotFences,
    fenceId,
    draggedSide,
    map,
    targetCursor,
    false
  );
}

/**
 * Desplaza globalmente toda la cadena de vallas conectadas a `fenceId` manteniendo
 * su forma y orientaciones relativas.
 */
export function translateFenceChain(
  snapshotFences: GeometryTrace[],
  fenceId: string,
  map: MapMetadata,
  dxMeters: number,
  dyMeters: number
): Map<string, Point2D[]> {
  const out = new Map<string, Point2D[]>();
  const fence = snapshotFences.find((f) => f.id === fenceId);
  if (!fence) return out;
  const chainIds = connectedFenceChainIds(fence, snapshotFences, map);
  for (const f of snapshotFences) {
    if (!f.id || !chainIds.has(f.id)) continue;
    const movedMeters: Point2D[] = f.points.map((pt) => {
      const p = world(pt, map);
      return [p[0] + dxMeters, p[1] + dyMeters];
    });
    if (
      movedMeters.some(
        (p) =>
          p[0] < 0 ||
          p[0] > map.widthMeters ||
          p[1] < 0 ||
          p[1] > map.heightMeters
      )
    ) {
      return new Map();
    }
    out.set(
      f.id,
      movedMeters.map((p) => percent(p, map))
    );
  }
  return out;
}

/**
 * Determina qué extremos (`A` = `points[0]`, `B` = `points[last]`) de una valla encadenada
 * están anclados a otra valla de la misma cadena (`chainId`).
 */
export function fenceChainAnchors(
  fence: GeometryTrace,
  fences: GeometryTrace[],
  map: MapMetadata,
  toleranceMeters = 0.25
): {anchorA: boolean; anchorB: boolean} {
  if (!fence.points || fence.points.length < 2) {
    return {anchorA: false, anchorB: false};
  }
  const isChained = fence.fenceKind === 'chain' || !!fence.chainId;
  if (!isChained) {
    return {anchorA: false, anchorB: false};
  }
  const a = world(fence.points[0], map);
  const b = world(fence.points[fence.points.length - 1], map);
  let anchorA = false;
  let anchorB = false;

  for (const other of fences || []) {
    if (other.id && fence.id && other.id === fence.id) continue;
    if (other === fence) continue;
    if (fence.chainId && other.chainId && other.chainId !== fence.chainId) {
      continue;
    }
    if (!other.points || other.points.length < 2) continue;
    const pts = other.points.map((pt) => world(pt, map));
    for (const ep of [pts[0], pts[pts.length - 1]]) {
      if (Math.hypot(a[0] - ep[0], a[1] - ep[1]) <= toleranceMeters) {
        anchorA = true;
      }
      if (Math.hypot(b[0] - ep[0], b[1] - ep[1]) <= toleranceMeters) {
        anchorB = true;
      }
    }
    if (anchorA && anchorB) break;
  }

  return {anchorA, anchorB};
}

/**
 * Rota una valla de borde de cadena alrededor de su extremo anclado (`'a'` o `'b'`)
 * manteniendo fijo el punto de anclaje y su largo exacto.
 */
export function pivotFenceAroundAnchor(
  fence: GeometryTrace,
  map: MapMetadata,
  cursorMeters: Point2D,
  anchorSide: 'a' | 'b',
  shiftKey = false
): Point2D[] {
  const m = fenceMetrics(fence, map);
  const anchor = anchorSide === 'a' ? m.a : m.b;
  const len = Math.max(MIN_FENCE_LENGTH, m.length);
  const dx = cursorMeters[0] - anchor[0];
  const dy = cursorMeters[1] - anchor[1];
  const rawAngleDeg =
    Math.hypot(dx, dy) < 1e-4
      ? anchorSide === 'a'
        ? m.angleDeg
        : m.angleDeg + 180
      : (Math.atan2(dy, dx) * 180) / Math.PI;
  const angleDeg = snapAngleDeg(rawAngleDeg, shiftKey);
  const rad = (angleDeg * Math.PI) / 180;
  const clampM = (p: Point2D): Point2D => [
    Math.max(0, Math.min(map.widthMeters, p[0])),
    Math.max(0, Math.min(map.heightMeters, p[1])),
  ];
  const freeEnd = clampM([
    anchor[0] + Math.cos(rad) * len,
    anchor[1] + Math.sin(rad) * len,
  ]);
  return anchorSide === 'a'
    ? [percent(anchor, map), percent(freeEnd, map)]
    : [percent(freeEnd, map), percent(anchor, map)];
}

/**
 * Recalcula los dos extremos porcentuales de una valla rotándola o ajustando su largo.
 * Si está anclada en un extremo de cadena, pivota alrededor de ese anclaje sin soltarse;
 * si está anclada en ambos extremos, permanece fija.
 */
export function updateFenceGeometry(
  fence: GeometryTrace,
  map: MapMetadata,
  patch: {length?: number; angleDeg?: number},
  anchors?: {anchorA: boolean; anchorB: boolean}
): Point2D[] {
  const m = fenceMetrics(fence, map);
  if (anchors?.anchorA && anchors?.anchorB) {
    return fence.points.map((pt) => [pt[0], pt[1]] as Point2D);
  }
  const nextLen =
    patch.length !== undefined ? clampFenceLength(patch.length) : Math.max(MIN_FENCE_LENGTH, m.length);
  const nextAngleDeg = patch.angleDeg !== undefined ? patch.angleDeg : m.angleDeg;
  const rad = (nextAngleDeg * Math.PI) / 180;
  const clampM = (p: Point2D): Point2D => [
    Math.max(0, Math.min(map.widthMeters, p[0])),
    Math.max(0, Math.min(map.heightMeters, p[1])),
  ];

  if (anchors?.anchorA && !anchors?.anchorB) {
    const bM = clampM([
      m.a[0] + Math.cos(rad) * nextLen,
      m.a[1] + Math.sin(rad) * nextLen,
    ]);
    return [percent(m.a, map), percent(bM, map)];
  }
  if (anchors?.anchorB && !anchors?.anchorA) {
    const aM = clampM([
      m.b[0] - Math.cos(rad) * nextLen,
      m.b[1] - Math.sin(rad) * nextLen,
    ]);
    return [percent(aM, map), percent(m.b, map)];
  }

  const half = nextLen / 2;
  const aM = clampM([m.mid[0] - Math.cos(rad) * half, m.mid[1] - Math.sin(rad) * half]);
  const bM = clampM([m.mid[0] + Math.cos(rad) * half, m.mid[1] + Math.sin(rad) * half]);
  return [percent(aM, map), percent(bM, map)];
}

/** Comprueba si dos segmentos 2D `[a1, a2]` y `[b1, b2]` se intersectan (incluyendo extremos). */
export function segmentsIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): boolean {
  if (
    Math.max(a1[0], a2[0]) < Math.min(b1[0], b2[0]) - 1e-6 ||
    Math.max(b1[0], b2[0]) < Math.min(a1[0], a2[0]) - 1e-6 ||
    Math.max(a1[1], a2[1]) < Math.min(b1[1], b2[1]) - 1e-6 ||
    Math.max(b1[1], b2[1]) < Math.min(a1[1], a2[1]) - 1e-6
  ) {
    return false;
  }
  const ccw = (p: Point2D, q: Point2D, r: Point2D): number =>
    (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = ccw(a1, a2, b1);
  const d2 = ccw(a1, a2, b2);
  const d3 = ccw(b1, b2, a1);
  const d4 = ccw(b1, b2, a2);
  return d1 * d2 <= 1e-9 && d3 * d4 <= 1e-9;
}
