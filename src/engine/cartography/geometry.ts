/**
 * @module engine/cartography/geometry
 * Funciones de proyección cartográfica UTM 28N, conversión de coordenadas,
 * cálculo de celdas de cuadrícula y geometría computacional (punto en polígono, huella rotada).
 */
import type {MapMetadata, Point2D, Scene} from '../../types';

/**
 * Comprueba si un punto 2D está dentro de un polígono mediante trazado de rayos (Ray Casting).
 */
export const inside = (p: Point2D, poly: Point2D[]): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      c = !c;
    }
  }
  return c;
};

/**
 * Calcula los 4 vértices en metros locales del rectángulo rotado de una pieza.
 */
export function rect(o: Record<string, any>, m: MapMetadata): Point2D[] {
  const a = ((o.rotation || 0) * Math.PI) / 180;
  const w = (o.width || Math.sqrt(o.area || 24)) / 2;
  const h =
    (o.depth || (o.area || 24) / (o.width || Math.sqrt(o.area || 24))) / 2;
  const x = (o.x * m.widthMeters) / 100;
  const y = (o.y * m.heightMeters) / 100;
  return (
    [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ] as Point2D[]
  ).map(([u, v]) => [
    x + u * Math.cos(a) - v * Math.sin(a),
    y + u * Math.sin(a) + v * Math.cos(a),
  ]);
}

/** Convierte coordenadas porcentuales `[0..100, 0..100]` a metros locales del recinto. */
export function world(p: Point2D, m: MapMetadata): Point2D {
  return [(p[0] * m.widthMeters) / 100, (p[1] * m.heightMeters) / 100];
}

/** Convierte metros locales del recinto a coordenadas porcentuales `[0..100, 0..100]`. */
export function percent(p: Point2D, m: MapMetadata): Point2D {
  return [(p[0] / m.widthMeters) * 100, (p[1] / m.heightMeters) * 100];
}

/** Convierte coordenadas absolutas UTM `[Este, Norte]` a metros locales desde la esquina NO. */
export function localPoint(p: Point2D, m: MapMetadata): Point2D {
  return [p[0] - m.bbox[0], m.bbox[3] - p[1]];
}

/** Convierte un índice entero `0..N` en etiqueta alfabética de columna (`A..Z`, `AA..ZZ`). */
export function column(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

/** Devuelve la referencia alfanumérica de celda (ej. `R14`) para un punto en metros locales. */
export function cellAt(p: Point2D, size = 10): string {
  return p[0] < 0 || p[1] < 0
    ? 'Fuera del plano'
    : column(Math.floor(p[0] / size)) + (Math.floor(p[1] / size) + 1);
}

/** Remapea un punto porcentual entre dos extensiones cartográficas UTM distintas. */
export function remapPoint(
  p: Point2D,
  old: MapMetadata,
  next: MapMetadata,
): Point2D {
  return [
    ((old.bbox[0] + (p[0] * old.widthMeters) / 100 - next.bbox[0]) /
      next.widthMeters) *
      100,
    ((next.bbox[3] - (old.bbox[3] - (p[1] * old.heightMeters) / 100)) /
      next.heightMeters) *
      100,
  ];
}

/** Remapea todos los elementos de una escena desde una extensión cartográfica antigua a la actual. */
export function remapScene(
  s: Scene,
  old: MapMetadata,
  next: MapMetadata,
): Scene {
  const copy = structuredClone(s);
  if (copy.boundary) {
    copy.boundary = copy.boundary.map(p => remapPoint(p, old, next));
  }
  for (const a of [
    copy.base.booths,
    copy.infrastructure,
    copy.reserves,
    copy.passages,
    copy.fences,
    copy.entrances,
    copy.flows,
    copy.corridors,
  ]) {
    for (const o of (a || []) as Array<Record<string, any>>) {
      if (Number.isFinite(o.x) && Number.isFinite(o.y)) {
        [o.x, o.y] = remapPoint([o.x, o.y], old, next);
      }
      if (o.points) {
        o.points = o.points.map((p: Point2D) => remapPoint(p, old, next));
      }
    }
  }
  return copy;
}

/** Calcula la longitud planimétrica acumulada de una polilínea de puntos. */
export function length(p: Point2D[]): number {
  return p
    .slice(1)
    .reduce((sum, q, i) => sum + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
}

/** Alias de `length` para compatibilidad con el visor y la barra lateral. */
export const polylineLength = length;

/** Calcula la distancia mínima desde un punto `p` al segmento `[a, b]`. */
export function segmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Devuelve el modo operativo de un acceso en la fase indicada. */
export const gateMode = (g: Record<string, any>, phase = 'event'): string =>
  g.phases?.[phase] || (phase === 'event' ? g.role || 'both' : 'closed');
