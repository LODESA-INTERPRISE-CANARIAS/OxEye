/**
 * @module engine/crowd/shelter
 * Búsqueda de refugio climático (carpas y cubiertas) ante lluvia, sol o noche.
 */
import {inside, rect} from '../cartography/geometry';

export function buildShelters(e: any) {
  return e.s.infrastructure
    .filter(
      (o: any) => o.role === 'cover' || ['kiosk', 'awning'].includes(o.kind),
    )
    .map((o: any) => {
      const polygon = rect(o, e.g.m);
      const cells: number[] = [];
      for (let k = 0; k < e.g.free.length; k++) {
        if (
          e.g.free[k] &&
          inside(e.g.point(k), polygon) &&
          e.clearAt(...e.g.point(k)) &&
          e.entries.some((g: any) => g.field[k] >= 0)
        ) {
          cells.push(k);
        }
      }
      return {
        id: o.id,
        name: o.name,
        polygon,
        cells,
        capacity: Math.max(0, +o.capacity || 0),
      };
    })
    .filter((o: any) => o.cells.length && o.capacity > 0);
}

export function exposureNeed(e: any, a: Record<string, any>): number {
  const weather = e.s.base.weather;
  const hour = (e.s.base.start + e.time / 3600) % 24;
  const night = hour >= 19 || hour < 7;
  return (
    (weather === 'rain'
      ? 1
      : weather === 'sun'
        ? 0.55
        : weather === 'dew'
          ? 0.65
          : night
            ? 0.25
            : 0) * (a.persona?.shelterPreference ?? 0.65)
  );
}

export function seekShelter(e: any, a: Record<string, any>): boolean {
  if (
    e.closing ||
    !['walk', 'roam'].includes(a.state) ||
    e.time < (a.shelterCooldown || 0)
  ) {
    return false;
  }
  a.shelterCooldown = e.time + 180 + e.random() * 240;
  if (e.random() > exposureNeed(e, a)) return false;
  if (e.shelters.some((o: any) => inside([a.x, a.y], o.polygon))) return false;
  const cell = e.g.index(a.x, a.y);
  const options = e.shelters
    .filter((o: any) => {
      const occupied =
        e.agents.filter(
          (p: any) => p.shelterId === o.id && p.state === 'shelter',
        ).length + (e.coverLoad.get(o.id) || 0);
      return occupied < o.capacity;
    })
    .map((o: any) => {
      const k = o.cells[Math.floor(e.random() * o.cells.length)];
      const p = e.g.point(k);
      return {o, k, distance: Math.hypot(p[0] - a.x, p[1] - a.y)};
    })
    .sort((a1: any, b: any) => a1.distance - b.distance);

  for (const pick of options) {
    const field = e.getFlow(pick.k);
    if (field[cell] < 0) continue;
    a.state = 'shelter';
    a.shelterId = pick.o.id;
    a.shelterCell = pick.k;
    a.shelterField = field;
    a.shelterUntil = e.time + 90 + e.random() * 150;
    e.stats.shelterVisits++;
    return true;
  }
  return false;
}
