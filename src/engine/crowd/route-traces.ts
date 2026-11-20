/**
 * @module engine/crowd/route-traces
 * Registro de vectores de desplazamiento entre celdas de 3 × 3 m para análisis de flujos.
 */

export function recordMovement(
  e: any,
  a: {x: number; y: number},
  oldX: number,
  oldY: number,
) {
  const cell = 3;
  const from = [Math.floor(oldX / cell), Math.floor(oldY / cell)];
  const to = [Math.floor(a.x / cell), Math.floor(a.y / cell)];
  if (from[0] === to[0] && from[1] === to[1]) return;
  const key = from.join(',') + '>' + to.join(',');
  const row = e.routeEdges.get(key) || {from: [0, 0], to: [0, 0], count: 0};
  row.from[0] += oldX;
  row.from[1] += oldY;
  row.to[0] += a.x;
  row.to[1] += a.y;
  row.count++;
  e.routeEdges.set(key, row);
}

export function routeArrows(e: any) {
  const rows = [...(e.routeEdges?.values() || [])].filter(
    (o: any) => o.count >= 2,
  );
  const max = Math.max(1, ...rows.map((o: any) => o.count));
  return rows
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 350)
    .map((o: any) => {
      const from = o.from.map((v: number) => v / o.count);
      const to = o.to.map((v: number) => v / o.count);
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const len = Math.hypot(dx, dy);
      const cx = (from[0] + to[0]) / 2;
      const cy = (from[1] + to[1]) / 2;
      if (len < 0.02) return null;
      const length = Math.min(2.6, 1 + Math.log1p(o.count) * 0.25);
      return {
        from: [cx - (dx / len) * (length / 2), cy - (dy / len) * (length / 2)],
        to: [cx + (dx / len) * (length / 2), cy + (dy / len) * (length / 2)],
        count: o.count,
        strength: Math.sqrt(o.count / max),
        width: 0.1 + 1.25 * (o.count / max) ** 0.8,
      };
    })
    .filter(Boolean);
}
