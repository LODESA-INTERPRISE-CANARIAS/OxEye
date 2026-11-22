/**
 * @module components/map/xrayTools
 * Lógica de herramientas interactivas de la capa «Rayos X» (perímetro booleano,
 * columnas y muros de carga), separada de `MapShell.tsx` para mantenerlo modular.
 */
import {
  inside,
  percent,
  segmentDistance,
  world,
} from '../../engine/cartography/geometry';
import {
  emptySubsoil,
  SUBSOIL_DEFAULTS,
  wallMetrics,
} from '../../engine/subsoil/heat';
import type {
  MapMetadata,
  Point2D,
  Scene,
  SubsoilColumn,
  SubsoilPolygon,
  SubsoilWall,
} from '../../types';

/** Resultado de hit-test geométrico sobre elementos del subsuelo. */
export interface SubsoilHit {
  id: string;
  kind: 'column' | 'wall' | 'polygon';
  handle?: 'a' | 'b';
  item: SubsoilColumn | SubsoilWall | SubsoilPolygon;
}

/**
 * Añade una columna estructural en la posición dada en metros locales.
 */
export function placeSubsoilColumn(
  scene: Scene,
  pointMeters: Point2D,
  map: MapMetadata
): string {
  scene.subsoil ??= emptySubsoil();
  const [x, y] = percent(pointMeters, map);
  const id = crypto.randomUUID();
  const count = scene.subsoil.columns.length + 1;
  scene.subsoil.columns.push({
    id,
    name: `Columna ${count}`,
    x,
    y,
    diameter: SUBSOIL_DEFAULTS.columnDiameter,
    influenceRadius: SUBSOIL_DEFAULTS.columnInfluenceRadius,
  });
  return id;
}

/**
 * Aplica un polígono dibujado al perímetro del subsuelo (`replace`, `add` o `subtract`)
 * sin modificar en absoluto `scene.boundary`, `scene.passages` ni `scene.reserves`.
 */
export function commitSubsoilBoundary(
  scene: Scene,
  draftPointsMeters: Point2D[],
  mode: 'replace' | 'add' | 'subtract',
  map: MapMetadata
): string {
  scene.subsoil ??= emptySubsoil();
  const pts = draftPointsMeters.map((pt) => percent(pt, map));
  const id = crypto.randomUUID();
  if (mode === 'replace') {
    scene.subsoil.polygons = [
      {
        id,
        op: 'add',
        name: 'Perímetro del subsuelo',
        points: pts,
      },
    ];
  } else {
    scene.subsoil.polygons.push({
      id,
      op: mode,
      name:
        mode === 'add'
          ? 'Ampliación del subsuelo'
          : 'Área restada del subsuelo',
      points: pts,
    });
  }
  return id;
}

/**
 * Crea un muro de carga a partir de sus dos extremos en metros locales.
 * Devuelve `null` si la longitud es menor a 0,5 m.
 */
export function commitSubsoilWall(
  scene: Scene,
  aMeters: Point2D,
  bMeters: Point2D,
  map: MapMetadata
): string | null {
  const len = Math.hypot(bMeters[0] - aMeters[0], bMeters[1] - aMeters[1]);
  if (len < 0.5) return null;
  scene.subsoil ??= emptySubsoil();
  const id = crypto.randomUUID();
  const count = scene.subsoil.walls.length + 1;
  scene.subsoil.walls.push({
    id,
    name: `Muro de carga ${count}`,
    a: percent(aMeters, map),
    b: percent(bMeters, map),
    thickness: SUBSOIL_DEFAULTS.wallThickness,
    influenceDepth: SUBSOIL_DEFAULTS.wallInfluenceDepth,
  });
  return id;
}

/**
 * Hit-test geométrico en metros locales sobre columnas, extremos de muros y
 * segmentos de muros de carga. Permite seleccionarlos y arrastrarlos incluso
 * cuando `#xray-layer` mantiene `pointer-events="none"` en modo selección libre.
 */
export function hitTestSubsoil(
  scene: Scene,
  pointMeters: Point2D,
  map: MapMetadata,
  selectedIds: string[]
): SubsoilHit | null {
  const sub = scene.subsoil;
  if (!sub) return null;

  // 1. Extremos arrastrables del muro actualmente seleccionado en solitario
  if (selectedIds.length === 1) {
    const selWall = sub.walls.find((w) => w.id === selectedIds[0]);
    if (selWall) {
      const m = wallMetrics(selWall, map);
      if (Math.hypot(pointMeters[0] - m.aMeters[0], pointMeters[1] - m.aMeters[1]) <= 1.8) {
        return {id: selWall.id, kind: 'wall', handle: 'a', item: selWall};
      }
      if (Math.hypot(pointMeters[0] - m.bMeters[0], pointMeters[1] - m.bMeters[1]) <= 1.8) {
        return {id: selWall.id, kind: 'wall', handle: 'b', item: selWall};
      }
    }
  }

  // 2. Columnas (de arriba abajo en orden de pintado)
  for (let i = sub.columns.length - 1; i >= 0; i--) {
    const col = sub.columns[i];
    const [cx, cy] = world([col.x, col.y], map);
    const hitR = Math.max(1.4, col.diameter / 2 + 0.5);
    if (Math.hypot(pointMeters[0] - cx, pointMeters[1] - cy) <= hitR) {
      return {id: col.id, kind: 'column', item: col};
    }
  }

  // 3. Muros de carga
  for (let i = sub.walls.length - 1; i >= 0; i--) {
    const wall = sub.walls[i];
    const m = wallMetrics(wall, map);
    const hitTol = Math.max(1.4, wall.thickness / 2 + 0.6);
    if (segmentDistance(pointMeters, m.aMeters, m.bMeters) <= hitTol) {
      return {id: wall.id, kind: 'wall', item: wall};
    }
  }

  // 4. Bordes del perímetro del subsuelo (muros perimetrales de carga)
  for (let i = sub.polygons.length - 1; i >= 0; i--) {
    const poly = sub.polygons[i];
    if (poly.points.length < 3) continue;
    const ptsMeters = poly.points.map((pt) => world(pt, map));
    for (let j = 0; j < ptsMeters.length; j++) {
      const a = ptsMeters[j];
      const b = ptsMeters[(j + 1) % ptsMeters.length];
      if (segmentDistance(pointMeters, a, b) <= 2.2) {
        return {id: poly.id, kind: 'polygon', item: poly};
      }
    }
  }

  // 5. Interior de polígonos del subsuelo (si no hay pieza de superficie, columna ni muro encima)
  const ptPct = percent(pointMeters, map);
  for (let i = sub.polygons.length - 1; i >= 0; i--) {
    const poly = sub.polygons[i];
    if (poly.points.length >= 3 && inside(ptPct, poly.points)) {
      return {id: poly.id, kind: 'polygon', item: poly};
    }
  }

  return null;
}

/**
 * Aplica desplazamiento en vivo a un muro de carga (completo o solo extremo `a`/`b`).
 */
export function applyWallDrag(
  wall: SubsoilWall,
  snapshot: SubsoilWall,
  startMeters: Point2D,
  currentMeters: Point2D,
  map: MapMetadata,
  endpointHandle?: 'a' | 'b'
): void {
  const clampPct = (v: number): number => Math.max(0, Math.min(100, v));
  if (endpointHandle === 'a' || endpointHandle === 'b') {
    const nextPct = percent(currentMeters, map);
    wall[endpointHandle] = [clampPct(nextPct[0]), clampPct(nextPct[1])];
    return;
  }
  const dPctX = ((currentMeters[0] - startMeters[0]) / map.widthMeters) * 100;
  const dPctY = ((currentMeters[1] - startMeters[1]) / map.heightMeters) * 100;
  const na: Point2D = [snapshot.a[0] + dPctX, snapshot.a[1] + dPctY];
  const nb: Point2D = [snapshot.b[0] + dPctX, snapshot.b[1] + dPctY];
  if (
    na[0] >= 0 &&
    na[0] <= 100 &&
    na[1] >= 0 &&
    na[1] <= 100 &&
    nb[0] >= 0 &&
    nb[0] <= 100 &&
    nb[1] >= 0 &&
    nb[1] <= 100
  ) {
    wall.a = na;
    wall.b = nb;
  }
}

/**
 * Resuelve la selección/arrastre de un elemento de subsuelo en `pointerdown`
 * (asas de extremos de muro, elementos por `data-id` o hit-test geométrico).
 */
export function resolveSubsoilPointerDown(
  targetEl: HTMLElement,
  scene: Scene,
  pointMeters: Point2D,
  map: MapMetadata,
  selectedIds: string[],
  domId: string | null
): SubsoilHit | null {
  const handleEl = targetEl.closest<HTMLElement>('[data-xray-handle]');
  if (handleEl?.dataset.xrayHandle && handleEl.dataset.wallId) {
    const wall = scene.subsoil?.walls.find(
      (w) => w.id === handleEl.dataset.wallId
    );
    if (wall) {
      return {
        id: wall.id,
        kind: 'wall',
        handle: handleEl.dataset.xrayHandle as 'a' | 'b',
        item: wall,
      };
    }
  }
  if (domId && scene.subsoil) {
    const col = scene.subsoil.columns.find((c) => c.id === domId);
    if (col) return {id: col.id, kind: 'column', item: col};
    const wall = scene.subsoil.walls.find((w) => w.id === domId);
    if (wall) return {id: wall.id, kind: 'wall', item: wall};
    const poly = scene.subsoil.polygons.find((pl) => pl.id === domId);
    if (poly) return {id: poly.id, kind: 'polygon', item: poly};
  }
  return hitTestSubsoil(scene, pointMeters, map, selectedIds);
}

/**
 * Genera el SVG del trazo en construcción (`#draft-layer`) con tamaño constante
 * en píxeles de pantalla (independiente del zoom) para máxima precisión al
 * dibujar perímetros, reservas o zonas de maniobra.
 */
export function buildDraftSvg(
  draftPoints: Point2D[],
  tool: string,
  boundaryMode: 'replace' | 'add' | 'subtract',
  metersPerPixel = 0.25
): string {
  if (!draftPoints.length) return '';
  const mpp =
    Number.isFinite(metersPerPixel) && metersPerPixel > 0
      ? metersPerPixel
      : 0.25;
  const points = draftPoints.map((p) => p.join(',')).join(' ');
  const isBnd = tool === 'boundary' || tool === 'xray:boundary';
  const strokeColor =
    isBnd && boundaryMode === 'add'
      ? '#167869'
      : isBnd && boundaryMode === 'subtract'
        ? '#b43c4c'
        : tool === 'turning'
          ? '#3b607a'
          : tool === 'loadingZone'
            ? '#9e6d17'
            : tool === 'interestZone'
              ? '#0f766e'
              : tool === 'subperimeter'
                ? '#b45309'
                : tool === 'flow'
                  ? '#dc2626'
                  : '#633584';
  const lineW = 1.8 * mpp;
  const dashA = 6 * mpp;
  const dashB = 4 * mpp;
  const dotR = 3.5 * mpp;
  const dotStroke = 1.4 * mpp;
  const badgeR = 8 * mpp;
  const badgeOff = 11 * mpp;
  const badgeFont = 11 * mpp;
  const badge =
    isBnd && boundaryMode !== 'replace'
      ? `<g transform="translate(${draftPoints[0][0] + badgeOff} ${draftPoints[0][1] - badgeOff})"><circle r="${badgeR}" fill="${strokeColor}"/><text text-anchor="middle" dominant-baseline="central" font-size="${badgeFont}" font-weight="700" fill="#fff">${boundaryMode === 'add' ? '+' : '−'}</text></g>`
      : '';
  return `<polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="${lineW}" stroke-dasharray="${dashA} ${dashB}"/>${draftPoints
    .map(
      (p) =>
        `<circle cx="${p[0]}" cy="${p[1]}" r="${dotR}" fill="${strokeColor}" stroke="#ffffff" stroke-width="${dotStroke}"/>`
    )
    .join('')}${badge}`;
}
