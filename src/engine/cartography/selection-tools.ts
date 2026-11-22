/**
 * @module engine/cartography/selection-tools
 * Utilidades geométricas para selección de elementos superpuestos (selección cíclica y doble clic),
 * selección rápida por caja (Shift + arrastrar) y alineación/distribución equidistante en multiselección.
 */
import type {
  BoothItem,
  EntranceItem,
  InfrastructureItem,
  MapMetadata,
  Point2D,
  Scene,
} from '../../types';
import {inside, percent, rect, world} from './geometry';

export type AlignMode =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom';

export type DistributeAxis = 'x' | 'y';

export interface OverlappingHit {
  id: string;
  name: string;
  locked: boolean;
  area: number;
  isCover: boolean;
}

type PlacedItem = BoothItem | InfrastructureItem | EntranceItem;

function itemBoundsMeters(
  item: PlacedItem,
  map: MapMetadata
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
} {
  const [cx, cy] = world([item.x, item.y], map);
  const inf = item as InfrastructureItem;
  const ent = item as EntranceItem;
  if (inf.kind === 'security' || inf.kind === 'steward') {
    const r = 0.9;
    return {
      minX: cx - r,
      maxX: cx + r,
      minY: cy - r,
      maxY: cy + r,
      cx,
      cy,
      width: r * 2,
      height: r * 2,
    };
  }
  if ('clearWidth' in ent && ent.clearWidth !== undefined) {
    const r = Math.max(1.5, ent.clearWidth / 2);
    return {
      minX: cx - r,
      maxX: cx + r,
      minY: cy - r,
      maxY: cy + r,
      cx,
      cy,
      width: r * 2,
      height: r * 2,
    };
  }
  const poly = rect(item as unknown as Record<string, unknown>, map);
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx,
    cy,
    width: Math.max(0.2, maxX - minX),
    height: Math.max(0.2, maxY - minY),
  };
}

/**
 * Devuelve todos los elementos colocados que contienen `ptMeters` (en metros locales),
 * ordenados de menor a mayor área (y elementos no-cubierta antes que carpas) para que
 * una mesa debajo de una carpa pueda seleccionarse primero y ciclarse limpiamente.
 * Incluye elementos bloqueados para que sigan siendo identificables.
 */
export function findOverlappingItemsAtPoint(
  ptMeters: Point2D,
  scene: Scene,
  map: MapMetadata
): OverlappingHit[] {
  const all: PlacedItem[] = [
    ...scene.base.booths,
    ...scene.infrastructure,
    ...scene.entrances,
  ];
  const hits: OverlappingHit[] = [];

  for (const item of all) {
    const inf = item as InfrastructureItem;
    const ent = item as EntranceItem;
    let contains = false;
    if (inf.kind === 'security' || inf.kind === 'steward') {
      const [cx, cy] = world([item.x, item.y], map);
      contains = Math.hypot(ptMeters[0] - cx, ptMeters[1] - cy) <= 1.2;
    } else if ('clearWidth' in ent && ent.clearWidth !== undefined) {
      const [cx, cy] = world([item.x, item.y], map);
      contains =
        Math.hypot(ptMeters[0] - cx, ptMeters[1] - cy) <=
        Math.max(1.8, ent.clearWidth / 2 + 0.5);
    } else {
      const poly = rect(item as unknown as Record<string, unknown>, map);
      contains = inside(ptMeters, poly);
    }
    if (!contains) continue;

    const bounds = itemBoundsMeters(item, map);
    const isCover = inf.role === 'cover';
    hits.push({
      id: item.id,
      name: item.name || inf.kind || 'Elemento',
      locked: !!item.locked,
      area: bounds.width * bounds.height,
      isCover,
    });
  }

  // Prioridad: elementos interiores (no carpa) primero, luego de menor a mayor área
  hits.sort((a, b) => {
    if (a.isCover !== b.isCover) return a.isCover ? 1 : -1;
    return a.area - b.area;
  });
  return hits;
}

/**
 * Devuelve los IDs de todos los elementos cuya huella o centro intersecta el rectángulo
 * de selección (`p1Meters` -> `p2Meters`). Por defecto excluye elementos bloqueados (`locked`).
 */
export function findItemsInMarqueeBox(
  p1Meters: Point2D,
  p2Meters: Point2D,
  scene: Scene,
  map: MapMetadata,
  opts?: {excludeLocked?: boolean}
): {ids: string[]; skippedLocked: number} {
  const excludeLocked = opts?.excludeLocked !== false;
  const minX = Math.min(p1Meters[0], p2Meters[0]);
  const maxX = Math.max(p1Meters[0], p2Meters[0]);
  const minY = Math.min(p1Meters[1], p2Meters[1]);
  const maxY = Math.max(p1Meters[1], p2Meters[1]);

  const all: PlacedItem[] = [
    ...scene.base.booths,
    ...scene.infrastructure,
    ...scene.entrances,
  ];
  const ids: string[] = [];
  let skippedLocked = 0;

  for (const item of all) {
    const b = itemBoundsMeters(item, map);
    const overlapsBox =
      b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
    if (!overlapsBox) continue;
    if (excludeLocked && item.locked) {
      skippedLocked++;
      continue;
    }
    ids.push(item.id);
  }
  return {ids, skippedLocked};
}

/**
 * Alinea los elementos seleccionados según el modo elegido (`left`, `center-x`, `right`,
 * `top`, `center-y`, `bottom`). Respeta los elementos bloqueados (sirven de referencia pero no se mueven)
 * y evita que dos elementos sólidos queden apilados uno encima del otro al alinearlos.
 */
export function alignSelectedItems(
  scene: Scene,
  selectedIds: string[],
  map: MapMetadata,
  mode: AlignMode
): {movedCount: number; lockedSkipped: number} {
  const idSet = new Set(selectedIds);
  const items: PlacedItem[] = [
    ...scene.base.booths,
    ...scene.infrastructure,
    ...scene.entrances,
  ].filter((o) => idSet.has(o.id));

  if (items.length < 2) return {movedCount: 0, lockedSkipped: 0};

  const entries = items.map((item) => ({
    item,
    b: itemBoundsMeters(item, map),
    isCover: (item as InfrastructureItem).role === 'cover',
    targetCx: 0,
    targetCy: 0,
  }));

  const minLeft = Math.min(...entries.map((e) => e.b.minX));
  const maxRight = Math.max(...entries.map((e) => e.b.maxX));
  const avgCx = (minLeft + maxRight) / 2;
  const minTop = Math.min(...entries.map((e) => e.b.minY));
  const maxBottom = Math.max(...entries.map((e) => e.b.maxY));
  const avgCy = (minTop + maxBottom) / 2;

  const isHorizontalAlign =
    mode === 'left' || mode === 'center-x' || mode === 'right';

  for (const e of entries) {
    e.targetCx = e.b.cx;
    e.targetCy = e.b.cy;
    if (e.item.locked) continue;
    if (mode === 'left') e.targetCx = minLeft + e.b.width / 2;
    else if (mode === 'center-x') e.targetCx = avgCx;
    else if (mode === 'right') e.targetCx = maxRight - e.b.width / 2;
    else if (mode === 'top') e.targetCy = minTop + e.b.height / 2;
    else if (mode === 'center-y') e.targetCy = avgCy;
    else if (mode === 'bottom') e.targetCy = maxBottom - e.b.height / 2;
  }

  // Evitar apilamiento físico: si dos elementos sólidos (no carpas) quedan solapados tras alinear
  // en un eje, separarlos ordenadamente a lo largo del eje perpendicular con un margen limpio (0,5 m).
  const minGap = 0.5;
  const solids = entries.filter((e) => !e.isCover);
  if (isHorizontalAlign) {
    solids.sort((a, b) => a.b.cy - b.b.cy || a.b.cx - b.b.cx);
    for (let i = 1; i < solids.length; i++) {
      const prev = solids[i - 1];
      const curr = solids[i];
      const overlapX =
        Math.abs(curr.targetCx - prev.targetCx) <
        (curr.b.width + prev.b.width) / 2 - 0.05;
      const minCenterDistY = (prev.b.height + curr.b.height) / 2 + minGap;
      if (overlapX && curr.targetCy - prev.targetCy < minCenterDistY) {
        if (!curr.item.locked) {
          curr.targetCy = prev.targetCy + minCenterDistY;
        }
      }
    }
  } else {
    solids.sort((a, b) => a.b.cx - b.b.cx || a.b.cy - b.b.cy);
    for (let i = 1; i < solids.length; i++) {
      const prev = solids[i - 1];
      const curr = solids[i];
      const overlapY =
        Math.abs(curr.targetCy - prev.targetCy) <
        (curr.b.height + prev.b.height) / 2 - 0.05;
      const minCenterDistX = (prev.b.width + curr.b.width) / 2 + minGap;
      if (overlapY && curr.targetCx - prev.targetCx < minCenterDistX) {
        if (!curr.item.locked) {
          curr.targetCx = prev.targetCx + minCenterDistX;
        }
      }
    }
  }

  let movedCount = 0;
  let lockedSkipped = 0;
  for (const e of entries) {
    if (e.item.locked) {
      lockedSkipped++;
      continue;
    }
    if (
      Math.abs(e.targetCx - e.b.cx) < 0.005 &&
      Math.abs(e.targetCy - e.b.cy) < 0.005
    ) {
      continue;
    }
    const nextMeters: Point2D = [
      Math.max(0.5, Math.min(map.widthMeters - 0.5, e.targetCx)),
      Math.max(0.5, Math.min(map.heightMeters - 0.5, e.targetCy)),
    ];
    const [nx, ny] = percent(nextMeters, map);
    e.item.x = nx;
    e.item.y = ny;
    movedCount++;
  }

  return {movedCount, lockedSkipped};
}

/**
 * Distribuye (equidistancia) 3 o más elementos seleccionados a lo largo del eje X o Y.
 * - Si los elementos forman varias filas o columnas, distribuye cada fila/columna de forma coherente.
 * - Garantiza siempre una separación mínima sin solapes entre elementos sólidos y respeta los bloqueados.
 */
export function distributeSelectedItems(
  scene: Scene,
  selectedIds: string[],
  map: MapMetadata,
  axis: DistributeAxis
): {movedCount: number; lockedSkipped: number} {
  const idSet = new Set(selectedIds);
  const items: PlacedItem[] = [
    ...scene.base.booths,
    ...scene.infrastructure,
    ...scene.entrances,
  ].filter((o) => idSet.has(o.id));

  if (items.length < 3) return {movedCount: 0, lockedSkipped: 0};

  const allEntries = items.map((item) => ({
    item,
    b: itemBoundsMeters(item, map),
  }));

  // Agrupar en bandas paralelas (filas cuando axis === 'x', columnas cuando axis === 'y')
  // para que una cuadrícula 2×2 o 2×3 se distribuya por filas/columnas sin mezclarse.
  const sortedCross = allEntries
    .slice()
    .sort((a, b) => (axis === 'x' ? a.b.cy - b.b.cy : a.b.cx - b.b.cx));
  const bands: Array<typeof allEntries> = [];
  for (const entry of sortedCross) {
    const pos = axis === 'x' ? entry.b.cy : entry.b.cx;
    const size = axis === 'x' ? entry.b.height : entry.b.width;
    const band = bands.find((g) => {
      const avg =
        g.reduce((s, e) => s + (axis === 'x' ? e.b.cy : e.b.cx), 0) / g.length;
      const avgSize =
        g.reduce((s, e) => s + (axis === 'x' ? e.b.height : e.b.width), 0) /
        g.length;
      return Math.abs(pos - avg) <= Math.max(size, avgSize) * 0.75;
    });
    if (band) band.push(entry);
    else bands.push([entry]);
  }

  // Solo usar distribución por bandas si todas las bandas relevantes tienen ≥ 2 elementos;
  // si no, distribuir la selección completa como una sola secuencia.
  const groupsToDistribute =
    bands.length > 1 && bands.every((g) => g.length >= 2)
      ? bands
      : [allEntries];

  let movedCount = 0;
  let lockedSkipped = 0;
  const minGap = 0.5;

  for (const group of groupsToDistribute) {
    if (group.length < 2) continue;
    const entries = group
      .slice()
      .sort((a, b) => (axis === 'x' ? a.b.cx - b.b.cx : a.b.cy - b.b.cy));

    const first = entries[0];
    const last = entries[entries.length - 1];
    const span =
      axis === 'x' ? last.b.maxX - first.b.minX : last.b.maxY - first.b.minY;
    const sumSizes = entries.reduce(
      (acc, e) => acc + (axis === 'x' ? e.b.width : e.b.height),
      0
    );
    const rawGap = (span - sumSizes) / (entries.length - 1);
    const gap = Math.max(minGap, rawGap);

    let cursor = axis === 'x' ? first.b.maxX : first.b.maxY;
    const endIdx = rawGap >= minGap ? entries.length - 1 : entries.length;
    for (let i = 1; i < endIdx; i++) {
      const {item, b} = entries[i];
      const size = axis === 'x' ? b.width : b.height;
      const targetCenter = cursor + gap + size / 2;
      cursor = cursor + gap + size;
      if (item.locked) {
        lockedSkipped++;
        continue;
      }
      const prevCenter = axis === 'x' ? b.cx : b.cy;
      if (Math.abs(targetCenter - prevCenter) < 0.005) continue;
      const nextMeters: Point2D =
        axis === 'x'
          ? [Math.max(0.5, Math.min(map.widthMeters - 0.5, targetCenter)), b.cy]
          : [b.cx, Math.max(0.5, Math.min(map.heightMeters - 0.5, targetCenter))];
      const [nx, ny] = percent(nextMeters, map);
      item.x = nx;
      item.y = ny;
      movedCount++;
    }
  }

  return {movedCount, lockedSkipped};
}
