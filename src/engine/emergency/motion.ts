/**
 * @module engine/emergency/motion
 * Suavizado geométrico de trayectorias con radio de giro para vehículos de emergencia.
 */
import type {Point2D} from '../../types';

/**
 * Simplifica una ruta poligonal e inserta arcos circulares con el radio de giro indicado.
 */
export function vehiclePath(
  points: Point2D[],
  radius: number,
  clearSegment: (a: Point2D, b: Point2D) => boolean,
): Point2D[] | null {
  const corners: Point2D[] = [points[0]];
  for (let i = 0; i < points.length - 1; ) {
    let next = points.length - 1;
    while (next > i + 1 && !clearSegment(points[i], points[next])) next--;
    if (
      Math.hypot(
        points[next][0] - points[i][0],
        points[next][1] - points[i][1],
      ) > 0.01
    ) {
      corners.push(points[next]);
    }
    i = next;
  }
  const path: Point2D[] = [corners[0]];
  let previousCut = 0;
  for (let i = 1; i < corners.length - 1; i++) {
    const [a, b, c] = corners.slice(i - 1, i + 2);
    const incoming = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const outgoing = Math.atan2(c[1] - b[1], c[0] - b[0]);
    const turn = Math.atan2(
      Math.sin(outgoing - incoming),
      Math.cos(outgoing - incoming),
    );
    const cut = radius * Math.tan(Math.abs(turn) / 2);
    if (
      cut + previousCut > Math.hypot(b[0] - a[0], b[1] - a[1]) ||
      cut > Math.hypot(c[0] - b[0], c[1] - b[1])
    ) {
      return null;
    }
    const start: Point2D = [
      b[0] - cut * Math.cos(incoming),
      b[1] - cut * Math.sin(incoming),
    ];
    const sign = Math.sign(turn);
    const cx = start[0] - sign * radius * Math.sin(incoming);
    const cy = start[1] + sign * radius * Math.cos(incoming);
    path.push(start);
    const steps = Math.ceil((Math.abs(turn) * radius) / 0.15);
    for (let j = 1; j <= steps; j++) {
      const angle = incoming + (turn * j) / steps;
      path.push([
        cx + sign * radius * Math.sin(angle),
        cy - sign * radius * Math.cos(angle),
      ]);
    }
    previousCut = cut;
  }
  path.push(corners.at(-1)!);
  return path;
}
