/**
 * @module engine/emergency/priority
 * Cálculo de poses sobre trayectorias, colisión con huella de vehículo y cesión de paso peatonal.
 */
import {flow} from '../crowd/grid-flow';
import type {
  AccessCategory,
  AuthorityAccessUnit,
  ConditionalAccessState,
  Point2D,
} from '../../types';

/** Compatibilidad entre modos de respuesta de emergencia y las casillas de autoridades recomendadas. */
export const AUTHORITY_COMPAT: Record<string, AuthorityAccessUnit[]> = {
  fire: ['heavy_trucks'],
  ambulance: ['passenger_vehicles', 'heavy_trucks'],
  patrol: ['passenger_vehicles', 'light_stretchers'],
  stretcher: ['light_stretchers'],
  foot: ['foot'],
};

export interface GateLike {
  phases?: {event?: string};
  role?: string;
  clearWidth?: number;
  spawnType?: string;
  externalBase?: boolean;
  accessCategory?: AccessCategory;
  conditionalState?: ConditionalAccessState;
  recommendedAuthorities?: AuthorityAccessUnit[];
}

/**
 * Resuelve la clasificación operativa efectiva de un acceso del recinto.
 */
export function resolveAccessCategory(g: GateLike): AccessCategory {
  if (g.accessCategory) return g.accessCategory;
  const gateRole = g.phases?.event || g.role || 'both';
  if (gateRole === 'closed') return 'physically_blocked';
  if (gateRole === 'emergency' || g.externalBase) return 'emergency_vehicle';
  if (g.spawnType === 'vehicle') return 'emergency_vehicle';
  if (g.spawnType === 'mixed') return 'mixed';
  if (g.spawnType === 'pedestrian') return 'pedestrian_only';
  return 'mixed';
}

/** Devuelve `true` si el acceso es exclusivamente peatonal (nunca apto para vehículos). */
export function isPedestrianOnlyAccess(g: GateLike): boolean {
  return resolveAccessCategory(g) === 'pedestrian_only';
}

/** Demora operativa en segundos al atravesar un acceso condicionado (retirada de valla/bolardo). */
export function gateVehicleDelaySec(g: GateLike): number {
  const cat = resolveAccessCategory(g);
  if (cat === 'conditional' && (g.conditionalState || 'open_on_demand') === 'open_on_demand') {
    return 15;
  }
  return 0;
}

/**
 * Comprueba si un acceso permite el paso del tipo de unidad/vehículo indicado
 * respetando su clasificación operativa (`accessCategory`), estado condicionado,
 * `recommendedAuthorities` y la anchura libre declarada.
 */
export function gateAllowsAuthority(
  g: GateLike,
  mode: string,
  requiredWidth: number,
): boolean {
  const gateRole = g.phases?.event || g.role || 'both';
  const cat = resolveAccessCategory(g);
  const isVehicle = ['fire', 'ambulance', 'patrol'].includes(mode);

  if (gateRole === 'closed' || cat === 'physically_blocked') return false;
  if (isVehicle && cat === 'pedestrian_only') return false;
  if (cat === 'conditional' && g.conditionalState === 'closed') return false;
  if ((Number(g.clearWidth) || 0) < requiredWidth) return false;

  const authorities = g.recommendedAuthorities;
  if (Array.isArray(authorities) && authorities.length > 0) {
    const allowed = AUTHORITY_COMPAT[mode] || ['heavy_trucks'];
    return authorities.some((u) => allowed.includes(u));
  }
  if (cat === 'emergency_vehicle' || cat === 'conditional') return true;
  if (cat === 'mixed' && isVehicle) return true;
  return gateRole === 'emergency';
}

const distance = (a: Point2D, b: Point2D) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

function nearest(grid: any, p: Point2D, max = 12): number {
  let best = -1;
  let dist = max;
  for (let k = 0; k < grid.free.length; k++) {
    if (grid.free[k]) {
      const d = distance(p, grid.point(k));
      if (d < dist) {
        dist = d;
        best = k;
      }
    }
  }
  return best;
}

export interface VehiclePose {
  x: number;
  y: number;
  angle: number;
}

export function priorityRoute(
  e: any,
  row: Record<string, any>,
  resource: Record<string, any>,
) {
  const width = Math.max(1.8, resource.width || 2.5);
  const length = Math.max(4, resource.depth || 6);
  const mode = row.responseMode || resource.kind || 'fire';
  if (
    !e.s.entrances.some((g: any) =>
      gateAllowsAuthority(g, mode, width + 0.3),
    )
  ) {
    return {
      error: 'No hay acceso autorizado para este tipo de unidad con el ancho de ensayo.',
    };
  }
  e.priorityGrids ??= new Map();
  const key = width.toFixed(2);
  if (!e.priorityGrids.has(key)) {
    const g = e.g;
    const free = new Uint8Array(g.free.length);
    const r = width / 2 + 0.2;
    for (let k = 0; k < g.free.length; k++) {
      if (!g.free[k]) continue;
      const p = g.point(k);
      let clear = true;
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const j = g.index(p[0] + r * Math.cos(a), p[1] + r * Math.sin(a));
        if (j < 0 || !g.free[j]) {
          clear = false;
          break;
        }
      }
      if (clear) free[k] = 1;
    }
    e.priorityGrids.set(key, {...g, free});
  }
  const grid = e.priorityGrids.get(key);
  const origin: Point2D = [
    (resource.x * e.g.m.widthMeters) / 100,
    (resource.y * e.g.m.heightMeters) / 100,
  ];
  const start = nearest(grid, origin);
  const candidates: Array<{k: number; d: number}> = [];
  if (start < 0) {
    return {error: 'La reserva no conecta con un corredor del ancho de ensayo.'};
  }
  for (let k = 0; k < grid.free.length; k++) {
    if (grid.free[k]) {
      const d = distance(grid.point(k), row.point);
      if (d >= length / 2 + 1 && d <= 14) candidates.push({k, d});
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  let field: Int32Array | undefined;
  let target: number | undefined;
  for (const c of candidates.slice(0, 12)) {
    const f = flow(grid, c.k);
    if (f[start] >= 0) {
      field = f;
      target = c.k;
      break;
    }
  }
  if (!field || target == null) {
    return {
      error:
        'Mesas, vallas, módulos o límites interrumpen el corredor del ancho ensayado.',
    };
  }
  let k = start;
  const path: Point2D[] = [grid.point(k)];
  for (let i = 0; i < grid.free.length && k !== target; i++) {
    const n = e.g
      .neighbors(k)
      .filter((nIdx: number) => field![nIdx] >= 0 && field![nIdx] < field![k])
      .sort((a: number, b: number) => field![a] - field![b])[0];
    if (n == null) break;
    k = n;
    path.push(grid.point(k));
  }
  return {
    path,
    width,
    length,
    offset: distance(origin, path[0]),
    lastLeg: distance(path.at(-1)!, row.point),
  };
}

/**
 * Obtiene la posición y orientación (`angle` en radianes) a una distancia en metros sobre una polilínea.
 */
export function poseAt(path: Point2D[], metres: number): VehiclePose {
  let left = metres;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = distance(a, b);
    if (left <= d || i === path.length - 1) {
      const t = d ? Math.min(1, left / d) : 0;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      };
    }
    left -= d;
  }
  return {x: path[0][0], y: path[0][1], angle: 0};
}

/**
 * Comprueba si un círculo de radio `r` en `p` intersecta la huella rectangular de un vehículo.
 */
export function inVehicle(
  p: Point2D,
  pose: VehiclePose,
  width: number,
  length: number,
  r = 0,
): boolean {
  const dx = p[0] - pose.x;
  const dy = p[1] - pose.y;
  const u = dx * Math.cos(pose.angle) + dy * Math.sin(pose.angle);
  const v = -dx * Math.sin(pose.angle) + dy * Math.cos(pose.angle);
  return Math.abs(u) < length / 2 + r && Math.abs(v) < width / 2 + r;
}

function fixedClear(
  e: any,
  pose: VehiclePose,
  w: number,
  l: number,
): boolean {
  for (let i = 0; i <= Math.ceil(l / 0.6); i++) {
    for (let j = 0; j <= Math.ceil(w / 0.6); j++) {
      const u = -l / 2 + (i * l) / Math.ceil(l / 0.6);
      const v = -w / 2 + (j * w) / Math.ceil(w / 0.6);
      const x = pose.x + Math.cos(pose.angle) * u - Math.sin(pose.angle) * v;
      const y = pose.y + Math.sin(pose.angle) * u + Math.cos(pose.angle) * v;
      const k = e.g.index(x, y);
      if (k < 0 || !e.g.free[k]) return false;
    }
  }
  return true;
}

export function advancePriority(
  e: any,
  row: Record<string, any>,
  dt: number,
): boolean {
  row.vehiclePose ??= poseAt(row.path, 0);
  row.vehicleDistance ??= 0;
  row.yieldedIds ??= [];
  row.yieldBlockedIds ??= [];
  row.peopleDelay ??= 0;
  const speed = Math.max(0.3, Math.min(4, e.s.emergency?.vehicleSpeed ?? 1.5));
  const next = Math.min(row.pathLength, row.vehicleDistance + dt * speed);
  const pose = poseAt(row.path, next);
  if (!fixedClear(e, pose, row.vehicleWidth, row.vehicleLength)) {
    row.status = 'blocked';
    row.note =
      'Obstáculo fijo, límite o giro incompatible con la huella rectangular ensayada.';
    row.fixedBlock = true;
    row.fixedObstacles = [
      ...e.s.base.booths,
      ...e.s.infrastructure.filter((o: any) =>
        ['furniture', 'facility'].includes(o.role),
      ),
    ]
      .filter(
        (o: any) =>
          Math.hypot(
            (o.x * e.g.m.widthMeters) / 100 - pose.x,
            (o.y * e.g.m.heightMeters) / 100 - pose.y,
          ) <
          row.vehicleLength / 2 + Math.hypot(o.width || 0, o.depth || 0) / 2 + 1,
      )
      .map((o: any) => o.name);
    if (
      e.s.fences.some((f: any) =>
        f.points.some(
          (p: Point2D) =>
            Math.hypot(
              (p[0] * e.g.m.widthMeters) / 100 - pose.x,
              (p[1] * e.g.m.heightMeters) / 100 - pose.y,
            ) <
            row.vehicleLength / 2 + 2,
        ),
      )
    ) {
      row.fixedObstacles.push('Vallas próximas');
    }
    if (!row.fixedObstacles.length) {
      row.fixedObstacles.push('Límite del recinto o reserva');
    }
    row.note += ' Revisar cerca de: ' + row.fixedObstacles.join(', ') + '.';
    return false;
  }
  const blockers = e.agents.filter(
    (a: any) =>
      a.state !== 'gone' &&
      inVehicle([a.x, a.y], pose, row.vehicleWidth, row.vehicleLength, a.r),
  );
  if (blockers.length) {
    row.peopleDelay += dt;
    return false;
  }
  row.vehicleDistance = next;
  row.vehiclePose = pose;
  return next >= row.pathLength - 0.01;
}

/**
 * Desplaza lateralmente a los peatones situados delante de un vehículo o equipo de emergencia en ruta.
 */
export function yieldForPriority(
  e: any,
  a: Record<string, any>,
  dt: number,
): boolean {
  const rows =
    e.emergency?.events.filter(
      (o: any) =>
        o.vehicle &&
        o.status === 'assigned' &&
        e.time >= o.assigned + o.alertDelay &&
        o.vehiclePose,
    ) || [];
  const row = rows.find((o: any) => {
    const dx = a.x - o.vehiclePose.x;
    const dy = a.y - o.vehiclePose.y;
    const u =
      dx * Math.cos(o.vehiclePose.angle) + dy * Math.sin(o.vehiclePose.angle);
    const v =
      -dx * Math.sin(o.vehiclePose.angle) + dy * Math.cos(o.vehiclePose.angle);
    return (
      u > -o.vehicleLength / 2 - 2 &&
      u < o.vehicleLength / 2 + 10 &&
      Math.abs(v) < o.vehicleWidth / 2 + 1.2
    );
  });
  if (!row || a.state === 'incident') {
    if (a.priorityYield) {
      delete a.priorityYield;
      if (a.state === 'service') a.state = 'serviceWalk';
    }
    return false;
  }
  if (!row.yieldedIds.includes(a.id)) row.yieldedIds.push(a.id);
  if (
    !a.priorityYield ||
    a.priorityYield.row !== row.id ||
    e.time > a.priorityYield.until
  ) {
    let chosen: Record<string, any> | null = null;
    const pose = row.vehiclePose;
    const dx = a.x - pose.x;
    const dy = a.y - pose.y;
    const side =
      -dx * Math.sin(pose.angle) + dy * Math.cos(pose.angle) >= 0 ? 1 : -1;
    for (const sign of [side, -side]) {
      for (const d of [2.5, 3.5, 4.5, 6]) {
        const x = a.x - Math.sin(pose.angle) * d * sign;
        const y = a.y + Math.cos(pose.angle) * d * sign;
        if (
          e.clearAt(x, y, a.id) &&
          !inVehicle([x, y], pose, row.vehicleWidth + 2, row.vehicleLength + 4, a.r)
        ) {
          const k = e.g.index(x, y);
          const field = e.getFlow(k);
          if (field[e.g.index(a.x, a.y)] >= 0) {
            chosen = {
              row: row.id,
              cell: k,
              field,
              target: [x, y],
              until: e.time + 4,
            };
            break;
          }
        }
      }
      if (chosen) break;
    }
    a.priorityYield = chosen || {
      row: row.id,
      until: e.time + 2,
      blocked: true,
    };
    if (!chosen && !row.yieldBlockedIds.includes(a.id)) {
      row.yieldBlockedIds.push(a.id);
    }
  }
  if (!a.priorityYield.blocked) {
    e.move(
      a,
      a.priorityYield.field,
      a.priorityYield.cell,
      dt,
      0.35,
      a.priorityYield.target,
    );
  }
  return true;
}
