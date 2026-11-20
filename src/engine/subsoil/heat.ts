/**
 * @module engine/subsoil/heat
 * Motor matemático puro para la capa «Rayos X» (subsuelo): evaluación de
 * pertenencia al perímetro booleano del subsuelo, métricas y rotación de muros
 * de carga, y cálculo del mapa de calor estructural normalizado `[0, 1]`.
 */
import {CATALOG} from '../../data/catalog';
import type {
  BoothItem,
  InfrastructureItem,
  MapMetadata,
  Point2D,
  Scene,
  SubsoilColumn,
  SubsoilStructure,
  SubsoilWall,
} from '../../types';
import {
  inside,
  percent,
  rect,
  segmentDistance,
  world,
} from '../cartography/geometry';

/** Valores por defecto en metros para nuevos elementos estructurales del subsuelo. */
export const SUBSOIL_DEFAULTS = {
  columnDiameter: 0.8,
  columnInfluenceRadius: 4,
  wallThickness: 0.4,
  wallInfluenceDepth: 3,
} as const;

/** Métricas geométricas derivadas de un muro de carga en metros locales. */
export interface WallMetrics {
  aMeters: Point2D;
  bMeters: Point2D;
  midMeters: Point2D;
  length: number;
  angleDeg: number;
}

/**
 * Crea una estructura de subsuelo vacía.
 *
 * @returns Estructura `SubsoilStructure` sin polígonos, columnas ni muros.
 */
export function emptySubsoil(): SubsoilStructure {
  return {polygons: [], columns: [], walls: []};
}

/**
 * Comprueba si un punto en coordenadas porcentuales `[0..100, 0..100]` pertenece
 * al recinto de subsuelo aplicando en orden secuencial las operaciones `add` y
 * `subtract` de `subsoil.polygons`.
 *
 * @param pointPercent - Punto en porcentaje del recinto.
 * @param subsoil - Estructura de subsuelo (opcional).
 * @returns `true` si el punto queda dentro del subsuelo resultante.
 */
export function pointInSubsoil(
  pointPercent: Point2D,
  subsoil: SubsoilStructure | undefined
): boolean {
  if (!subsoil || !subsoil.polygons.length) return false;
  let insideArea = false;
  for (const poly of subsoil.polygons) {
    if (poly.points.length < 3) continue;
    if (inside(pointPercent, poly.points)) {
      insideArea = poly.op === 'add';
    }
  }
  return insideArea;
}

/**
 * Calcula las métricas en metros locales (extremos, punto medio, longitud y
 * ángulo en grados) de un muro de carga.
 *
 * @param wall - Muro de carga con extremos porcentuales `a` y `b`.
 * @param map - Metadatos cartográficos del recinto.
 * @returns Métricas del muro en metros locales.
 */
export function wallMetrics(wall: SubsoilWall, map: MapMetadata): WallMetrics {
  const aMeters = world(wall.a, map);
  const bMeters = world(wall.b, map);
  const dx = bMeters[0] - aMeters[0];
  const dy = bMeters[1] - aMeters[1];
  const length = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    aMeters,
    bMeters,
    midMeters: [(aMeters[0] + bMeters[0]) / 2, (aMeters[1] + bMeters[1]) / 2],
    length,
    angleDeg,
  };
}

/**
 * Rota un muro de carga alrededor de su punto medio hasta alcanzar `angleDeg`
 * grados en espacio métrico local y devuelve sus nuevos extremos porcentuales.
 *
 * @param wall - Muro de carga original.
 * @param angleDeg - Ángulo objetivo en grados.
 * @param map - Metadatos cartográficos del recinto.
 * @returns Nuevos extremos `a` y `b` acotados a `[0, 100]`.
 */
export function rotateWall(
  wall: SubsoilWall,
  angleDeg: number,
  map: MapMetadata
): {a: Point2D; b: Point2D} {
  const {midMeters, length} = wallMetrics(wall, map);
  const half = length / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  const clampPct = (pt: Point2D): Point2D => [
    Math.max(0, Math.min(100, pt[0])),
    Math.max(0, Math.min(100, pt[1])),
  ];
  return {
    a: clampPct(percent([midMeters[0] - dx, midMeters[1] - dy], map)),
    b: clampPct(percent([midMeters[0] + dx, midMeters[1] + dy], map)),
  };
}

/**
 * Calcula la intensidad de restricción de carga (`0` a `1`) generada por una
 * columna circular en un punto dado en metros locales.
 *
 * Devuelve `1` dentro del núcleo de la columna (`d <= diameter / 2`), decae
 * linealmente hasta `0` en `diameter / 2 + influenceRadius` y vale `0` más allá.
 *
 * @param pointMeters - Punto de consulta `[x, y]` en metros locales.
 * @param column - Columna estructural.
 * @param map - Metadatos cartográficos del recinto.
 * @returns Intensidad normalizada en `[0, 1]`.
 */
export function columnHeat(
  pointMeters: Point2D,
  column: SubsoilColumn,
  map: MapMetadata
): number {
  const [cx, cy] = world([column.x, column.y], map);
  const dist = Math.hypot(pointMeters[0] - cx, pointMeters[1] - cy);
  const coreRadius = Math.max(0, column.diameter / 2);
  if (dist <= coreRadius) return 1;
  const influence = Math.max(0, column.influenceRadius);
  if (influence <= 0 || dist >= coreRadius + influence) return 0;
  return Math.max(0, Math.min(1, 1 - (dist - coreRadius) / influence));
}

/**
 * Calcula la intensidad de restricción de carga (`0` a `1`) generada por un
 * muro de carga en un punto dado en metros locales.
 *
 * Genera una banda simétrica alrededor del segmento `a → b` que sigue su
 * orientación: vale `1` sobre el grosor del muro (`d <= thickness / 2`),
 * decae linealmente hasta `0` a distancia `thickness / 2 + influenceDepth` y
 * vale `0` fuera de la banda.
 *
 * @param pointMeters - Punto de consulta `[x, y]` en metros locales.
 * @param wall - Muro de carga estructural.
 * @param map - Metadatos cartográficos del recinto.
 * @returns Intensidad normalizada en `[0, 1]`.
 */
export function wallHeat(
  pointMeters: Point2D,
  wall: SubsoilWall,
  map: MapMetadata
): number {
  const aMeters = world(wall.a, map);
  const bMeters = world(wall.b, map);
  const dist = segmentDistance(pointMeters, aMeters, bMeters);
  const halfThickness = Math.max(0, wall.thickness / 2);
  if (dist <= halfThickness) return 1;
  const depth = Math.max(0, wall.influenceDepth);
  if (depth <= 0 || dist >= halfThickness + depth) return 0;
  return Math.max(0, Math.min(1, 1 - (dist - halfThickness) / depth));
}

/**
 * Función pura de calor estructural del subsuelo en un punto `[x, y]` en
 * metros locales del recinto.
 *
 * Combina las contribuciones de todas las columnas y muros mediante unión
 * probabilística `1 - ∏(1 - h_i)`, garantizando un resultado acotado en `[0, 1]`:
 * - `0` fuera de toda zona de influencia.
 * - Igual a la contribución individual cuando solo afecta un elemento.
 * - `1` sobre el núcleo de cualquier columna o muro, y mayor en solapamientos.
 *
 * Pensada para reutilizarse en futuras validaciones o avisos de sobrecarga.
 *
 * @param pointMeters - Punto de consulta `[x, y]` en metros locales.
 * @param subsoil - Estructura de subsuelo del recinto (puede ser `undefined`).
 * @param map - Metadatos cartográficos del recinto.
 * @returns Valor de calor estructural en `[0, 1]`.
 */
export function structuralHeat(
  pointMeters: Point2D,
  subsoil: SubsoilStructure | undefined,
  map: MapMetadata
): number {
  if (!subsoil) return 0;
  let complement = 1;
  for (const col of subsoil.columns || []) {
    const h = columnHeat(pointMeters, col, map);
    if (h >= 1) return 1;
    if (h > 0) complement *= 1 - h;
  }
  for (const wall of subsoil.walls || []) {
    const h = wallHeat(pointMeters, wall, map);
    if (h >= 1) return 1;
    if (h > 0) complement *= 1 - h;
  }
  return Math.max(0, Math.min(1, 1 - complement));
}

/** Alias en español de {@link structuralHeat}. */
export const calor = structuralHeat;

/** Umbrales de intensidad de calor estructural `[0, 1]` para avisos y bloqueos de riesgo. */
export const SUBSOIL_HEAT_THRESHOLDS = {
  /** Cualquier solapamiento positivo por encima de este valor genera al menos aviso (`warning`). */
  warning: 0.01,
  /** A partir de este valor de calor se emite bloqueo crítico (`critical`) al iniciar simulación. */
  critical: 0.25,
} as const;

/** Elemento estructural del subsuelo (columna o muro de carga) que provoca calor en una pieza. */
export interface StructuralHeatSource {
  id: string;
  name: string;
  kind: 'column' | 'wall';
  heat: number;
}

/** Conflicto detectado entre una pieza de carga pesada y la estructura del subsuelo. */
export interface StructuralLoadConflict {
  itemId: string;
  itemName: string;
  heat: number;
  level: 'critical' | 'warning';
  sources: StructuralHeatSource[];
}

/**
 * Determina si un puesto o infraestructura se considera carga pesada frente al subsuelo.
 * Respeta la marca explícita `item.heavyLoad` y, si no está definida, consulta el catálogo.
 *
 * @param item - Puesto o elemento de infraestructura.
 * @returns `true` si la pieza se clasifica como carga pesada.
 */
export function isHeavyLoadItem(item: {
  kind?: string;
  type?: string;
  role?: string;
  heavyLoad?: boolean;
}): boolean {
  if (typeof item.heavyLoad === 'boolean') return item.heavyLoad;
  const byKind = item.kind ? CATALOG[item.kind] : undefined;
  if (byKind && typeof byKind.heavyLoad === 'boolean') return byKind.heavyLoad;
  const byType = item.type ? CATALOG[item.type] : undefined;
  if (byType && typeof byType.heavyLoad === 'boolean') return byType.heavyLoad;
  const byRole = item.role ? CATALOG[item.role] : undefined;
  if (byRole && typeof byRole.heavyLoad === 'boolean') return byRole.heavyLoad;
  return false;
}

/**
 * Evalúa el pico de calor estructural sobre la huella rotada (centro, 4 esquinas y
 * 4 puntos medios de arista) de una pieza del plano y devuelve las columnas y muros
 * de carga afectados.
 *
 * @param item - Puesto o infraestructura a evaluar.
 * @param subsoil - Estructura de subsuelo del recinto.
 * @param map - Metadatos cartográficos del recinto.
 * @returns Conflicto estructural si la pieza interseca una zona de calor, o `null`.
 */
export function evaluateItemSubsoilHeat(
  item: BoothItem | InfrastructureItem,
  subsoil: SubsoilStructure | undefined,
  map: MapMetadata
): StructuralLoadConflict | null {
  if (!subsoil || (!subsoil.columns.length && !subsoil.walls.length)) {
    return null;
  }
  const corners = rect(item as unknown as Record<string, unknown>, map);
  const center = world([item.x, item.y], map);
  const samples: Point2D[] = [center, ...corners];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    samples.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }

  let peakHeat = 0;
  const sourceMap = new Map<string, StructuralHeatSource>();

  for (const pt of samples) {
    const h = structuralHeat(pt, subsoil, map);
    if (h > peakHeat) peakHeat = h;
    for (const col of subsoil.columns) {
      const ch = columnHeat(pt, col, map);
      if (ch >= SUBSOIL_HEAT_THRESHOLDS.warning) {
        const prev = sourceMap.get(col.id);
        if (!prev || ch > prev.heat) {
          sourceMap.set(col.id, {
            id: col.id,
            name: col.name,
            kind: 'column',
            heat: ch,
          });
        }
      }
    }
    for (const wall of subsoil.walls) {
      const wh = wallHeat(pt, wall, map);
      if (wh >= SUBSOIL_HEAT_THRESHOLDS.warning) {
        const prev = sourceMap.get(wall.id);
        if (!prev || wh > prev.heat) {
          sourceMap.set(wall.id, {
            id: wall.id,
            name: wall.name,
            kind: 'wall',
            heat: wh,
          });
        }
      }
    }
  }

  if (peakHeat < SUBSOIL_HEAT_THRESHOLDS.warning || !sourceMap.size) {
    return null;
  }

  const sources = [...sourceMap.values()].sort((a, b) => b.heat - a.heat);
  return {
    itemId: item.id,
    itemName: item.name,
    heat: peakHeat,
    level:
      peakHeat >= SUBSOIL_HEAT_THRESHOLDS.critical ? 'critical' : 'warning',
    sources,
  };
}

/**
 * Analiza todas las piezas clasificadas como carga pesada de una escena frente
 * a las columnas y muros de carga del subsuelo.
 *
 * @param scene - Escena a analizar.
 * @param map - Metadatos cartográficos del recinto.
 * @returns Lista de conflictos estructurales detectados.
 */
export function evaluateHeavyLoadConflicts(
  scene: Scene,
  map: MapMetadata
): StructuralLoadConflict[] {
  if (
    !scene.subsoil ||
    (!scene.subsoil.columns.length && !scene.subsoil.walls.length)
  ) {
    return [];
  }
  const conflicts: StructuralLoadConflict[] = [];
  const candidates: Array<BoothItem | InfrastructureItem> = [
    ...scene.base.booths,
    ...scene.infrastructure.filter((r) => r.active !== false),
  ];
  for (const item of candidates) {
    if (!isHeavyLoadItem(item)) continue;
    const conflict = evaluateItemSubsoilHeat(item, scene.subsoil, map);
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}
