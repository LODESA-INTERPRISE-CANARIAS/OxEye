/**
 * @module engine/subsoil/heat
 * Motor matemático puro para la capa «Rayos X» (subsuelo): evaluación de
 * pertenencia al perímetro booleano del subsuelo, métricas y rotación de muros
 * de carga, y cálculo del mapa de calor estructural normalizado `[0, 1]`.
 */
import type {
  MapMetadata,
  Point2D,
  SubsoilColumn,
  SubsoilStructure,
  SubsoilWall,
} from '../../types';
import {inside, percent, segmentDistance, world} from '../cartography/geometry';

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
