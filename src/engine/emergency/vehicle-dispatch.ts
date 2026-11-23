/**
 * @module engine/emergency/vehicle-dispatch
 * Sistema unificado de despacho, patrullaje exterior, estacionamiento en base,
 * desembarco de tripulación a pie y regreso de vehículos de emergencia.
 *
 * Separa explícitamente:
 *  - Base operativa (`homeBaseId`, `homePosition`)
 *  - Vehículo (`EmergencyUnitRuntime`)
 *  - Tripulación desplegada a pie (`DeployedCrewMember`)
 *  - Misión (`EmergencyMission`)
 */
import type {
  EmergencyCrewStatus,
  EmergencyIncident,
  EmergencyOperationalMode,
  EmergencyVehicleStatus,
  EntranceItem,
  Infrastructure,
  NavigationGrid,
  Point2D,
  Scene,
} from '../../types';
import {inside, world} from '../cartography/geometry';
import {flow} from '../crowd/grid-flow';
import {
  buildVehicleGrid,
  collectRoadSegments,
  planVehicleRoute,
} from '../mobility/vehicle-system';
import {gateAllowsAuthority, gateVehicleDelaySec, poseAt} from './priority';

export type EmergencyVehicleKind =
  | 'ambulance'
  | 'patrol'
  | 'police_van'
  | 'fire';

export const EMERGENCY_VEHICLE_KINDS: ReadonlySet<string> = new Set([
  'ambulance',
  'patrol',
  'police_van',
  'fire',
]);

export function isEmergencyVehicleKind(kind?: string): kind is EmergencyVehicleKind {
  return !!kind && EMERGENCY_VEHICLE_KINDS.has(kind);
}

export function resolveOperationalMode(
  r: Pick<Infrastructure, 'operationalMode' | 'fixedPost' | 'patrolMode'>
): EmergencyOperationalMode {
  if (
    r.operationalMode === 'reserve' ||
    r.operationalMode === 'exterior_patrol' ||
    r.operationalMode === 'fixed_service'
  ) {
    return r.operationalMode;
  }
  if (r.fixedPost || r.patrolMode === 'fixed') return 'fixed_service';
  return 'reserve';
}

export function defaultCrewCapacity(kind: EmergencyVehicleKind): number {
  switch (kind) {
    case 'police_van':
      return 8;
    case 'fire':
      return 4;
    case 'patrol':
      return 2;
    case 'ambulance':
      return 2;
  }
}

export interface EmergencyUnitRuntime {
  resourceId: string;
  name: string;
  kind: EmergencyVehicleKind;
  operationalMode: EmergencyOperationalMode;
  homeBaseId: string | null;
  homePosition: Point2D;
  currentPosition: Point2D;
  angle: number;
  width: number;
  length: number;
  speed: number;
  available: boolean;
  availableForReinforcement: boolean;
  assignedIncidentId: number | string | null;
  crewCapacity: number;
  crewStatus: EmergencyCrewStatus;
  vehicleStatus: EmergencyVehicleStatus;
  sirensActive: boolean;
  patrolRouteId?: string;
  patrolPath: Point2D[];
  patrolDist: number;
  patrolLength: number;
  patrolDir: 1 | -1;
  activePath: Point2D[];
  activeDist: number;
  activeLength: number;
  dismountPoint: Point2D | null;
  delaySec: number;
  handlingSec: number;
}

export interface DeployedCrewMember {
  id: string;
  unitId: string;
  incidentId: number | string;
  role: 'medical' | 'police' | 'fire';
  x: number;
  y: number;
  carryingStretcher: boolean;
  carryingPatient: boolean;
  path: Point2D[];
  pathDist: number;
  pathLength: number;
  speed: number;
  status: 'deploying' | 'intervening' | 'returning';
}

export interface EmergencyMission {
  incidentId: number | string;
  unitId: string;
  stage:
    | 'dispatched'
    | 'en_route'
    | 'crew_deploying'
    | 'intervening'
    | 'crew_returning'
    | 'vehicle_returning'
    | 'completed';
  stagingPoint: Point2D;
  incidentPoint: Point2D;
  needsEvacuation: boolean;
  dispatchedAt: number;
  dispatchDelay: number;
  vehicleArrivedAt?: number;
  crewArrivedAt?: number;
  interventionEndAt?: number;
  crewReturnedAt?: number;
  resolvedAt?: number;
  handlingDuration: number;
  footPath: Point2D[];
  evacuationPath: Point2D[];
  routeWarning?: string;
}

const dist = (a: Point2D, b: Point2D): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const polylineLength = (pts: Point2D[]): number =>
  pts.slice(1).reduce((acc, q, i) => acc + dist(pts[i], q), 0);

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] || c
  );

/**
 * Comprueba si un punto en metros está estrictamente fuera del perímetro del evento.
 */
function isOutsideBoundary(pt: Point2D, boundaryMeters: Point2D[]): boolean {
  if (boundaryMeters.length < 3) return true;
  return !inside(pt, boundaryMeters);
}

/**
 * Construye una ruta de patrulla exterior válida (sin atravesar el perímetro del evento).
 */
function buildExteriorPatrolPath(
  scene: Scene,
  map: NavigationGrid['m'],
  homePos: Point2D,
  boundaryMeters: Point2D[],
  patrolRouteId?: string
): Point2D[] {
  // 1. Si el usuario configuró explícitamente una ruta de patrulla (roadPlans o flows), usarla
  if (patrolRouteId) {
    const line = [
      ...(scene.roadPlans || []),
      ...(scene.flows || []),
    ].find((r) => r.id === patrolRouteId && r.points && r.points.length >= 2);
    if (line) {
      const pts = line.points.map((p) => world(p, map));
      // Mantener solo vértices que estén fuera del perímetro del evento si la ruta cruza accidentalmente
      const exteriorOnly = pts.filter((pt) => isOutsideBoundary(pt, boundaryMeters));
      if (exteriorOnly.length >= 2) return exteriorOnly;
      return pts;
    }
  }

  // 2. Buscar segmentos de calles exteriores fuera del perímetro del evento cerca de homePos
  const segs = collectRoadSegments(scene, map).filter((seg) => {
    const mid: Point2D = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2];
    const inMap =
      mid[0] >= 2 &&
      mid[1] >= 2 &&
      mid[0] <= map.widthMeters - 2 &&
      mid[1] <= map.heightMeters - 2;
    return (
      inMap &&
      isOutsideBoundary(seg.a, boundaryMeters) &&
      isOutsideBoundary(seg.b, boundaryMeters) &&
      isOutsideBoundary(mid, boundaryMeters)
    );
  });

  if (!segs.length) return [];

  // Seleccionar el segmento exterior más cercano a la base y encadenar vecinos contiguos
  segs.sort((a, b) => {
    const da = Math.min(dist(a.a, homePos), dist(a.b, homePos));
    const db = Math.min(dist(b.a, homePos), dist(b.b, homePos));
    return da - db;
  });

  const chain: Point2D[] = [segs[0].a, segs[0].b];
  const used = new Set<number>([0]);
  for (let iter = 0; iter < 6; iter++) {
    const tail = chain[chain.length - 1];
    let bestIdx = -1;
    let bestD = 3.5;
    let nextPt: Point2D | null = null;
    for (let i = 1; i < segs.length; i++) {
      if (used.has(i)) continue;
      const dA = dist(tail, segs[i].a);
      const dB = dist(tail, segs[i].b);
      if (dA < bestD) {
        bestD = dA;
        bestIdx = i;
        nextPt = segs[i].b;
      }
      if (dB < bestD) {
        bestD = dB;
        bestIdx = i;
        nextPt = segs[i].a;
      }
    }
    if (bestIdx < 0 || !nextPt) break;
    used.add(bestIdx);
    chain.push(nextPt);
  }
  return polylineLength(chain) >= 6 ? chain : [];
}

/**
 * Calcula una ruta peatonal practicable (para sanitarios, camilla o agentes a pie)
 * entre dos puntos usando la malla `staffFree` del recinto.
 */
function buildFootPath(
  grid: NavigationGrid,
  origin: Point2D,
  destination: Point2D
): {path: Point2D[]; exact: boolean} {
  const baseFree: Uint8Array = grid.staffFree || grid.free;
  const g: NavigationGrid = {
    ...grid,
    free: baseFree,
    neighbors: (k: number) =>
      [
        k % grid.w ? k - 1 : -1,
        k % grid.w < grid.w - 1 ? k + 1 : -1,
        k >= grid.w ? k - grid.w : -1,
        k < grid.w * (grid.h - 1) ? k + grid.w : -1,
      ].filter((q) => q >= 0 && baseFree[q]),
  };
  const nearestOn = (pt: Point2D, maxR = 14): number => {
    let best = -1;
    let bestD = maxR;
    const minI = Math.max(0, Math.floor((pt[0] - maxR) / grid.cell));
    const maxI = Math.min(grid.w - 1, Math.ceil((pt[0] + maxR) / grid.cell));
    const minJ = Math.max(0, Math.floor((pt[1] - maxR) / grid.cell));
    const maxJ = Math.min(grid.h - 1, Math.ceil((pt[1] + maxR) / grid.cell));
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const k = j * grid.w + i;
        if (!baseFree[k]) continue;
        const p = grid.point(k);
        const d = dist(p, pt);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    return best;
  };
  const sIdx = nearestOn(origin, 16);
  const tIdx = nearestOn(destination, 12);
  if (sIdx >= 0 && tIdx >= 0) {
    const field = flow(g, tIdx);
    if (field[sIdx] >= 0) {
      const pts: Point2D[] = [origin, grid.point(sIdx)];
      let k = sIdx;
      for (let step = 0; step < baseFree.length && k !== tIdx; step++) {
        const nxt = g
          .neighbors(k)
          .filter((n) => field[n] >= 0 && field[n] < field[k])
          .sort((a, b) => field[a] - field[b])[0];
        if (nxt === undefined) break;
        k = nxt;
        pts.push(grid.point(k));
      }
      pts.push(destination);
      return {path: pts, exact: true};
    }
  }
  return {path: [origin, destination], exact: false};
}

/**
 * Flota persistente de vehículos de emergencia durante una simulación de evento.
 */
export class EmergencyVehicleFleet {
  e: any;
  units: EmergencyUnitRuntime[];
  crew: DeployedCrewMember[];
  missions: Map<number | string, EmergencyMission>;
  boundaryMeters: Point2D[];
  private _vehGrid: NavigationGrid | null = null;

  constructor(e: any) {
    this.e = e;
    this.units = [];
    this.crew = [];
    this.missions = new Map();
    const map = e.g.m;
    this.boundaryMeters = (e.s.boundary || []).map((p: Point2D) => world(p, map));
    this.initUnits();
  }

  get vehGrid(): NavigationGrid {
    if (!this._vehGrid) {
      this._vehGrid = this.e.vehicleManager?.vehGrid || buildVehicleGrid(this.e.s, this.e.g);
    }
    return this._vehGrid;
  }

  private resolveHomePosition(r: Infrastructure): {
    homeBaseId: string | null;
    homePosition: Point2D;
  } {
    const map = this.e.g.m;
    if (r.homeBaseId) {
      const base = (this.e.s.entrances || []).find(
        (g: EntranceItem) => g.id === r.homeBaseId
      );
      if (base) {
        return {
          homeBaseId: base.id,
          homePosition: world([base.x, base.y], map),
        };
      }
    }
    return {
      homeBaseId: null,
      homePosition: world([r.x, r.y], map),
    };
  }

  private initUnits(): void {
    const scene: Scene = this.e.s;
    const map = this.e.g.m;
    const infra = (scene.infrastructure || []).filter(
      (r) => r.role === 'emergency' && isEmergencyVehicleKind(r.kind)
    );

    for (const r of infra) {
      const kind = r.kind as EmergencyVehicleKind;
      const mode = resolveOperationalMode(r);
      const {homeBaseId, homePosition} = this.resolveHomePosition(r);
      const crewCap = Math.max(
        1,
        Math.min(
          16,
          Math.round(Number(r.crewCapacity ?? r.staff ?? defaultCrewCapacity(kind)))
        )
      );
      const patrolPath =
        mode === 'exterior_patrol'
          ? buildExteriorPatrolPath(
              scene,
              map,
              homePosition,
              this.boundaryMeters,
              r.patrolRouteId
            )
          : [];
      const startPos = patrolPath.length >= 2 ? patrolPath[0] : homePosition;
      const startAngle =
        patrolPath.length >= 2
          ? Math.atan2(patrolPath[1][1] - patrolPath[0][1], patrolPath[1][0] - patrolPath[0][0])
          : (((Number(r.rotation) || 0) - 90) * Math.PI) / 180;

      const defaultSpeed =
        kind === 'patrol'
          ? 5.2
          : kind === 'police_van'
            ? 4.4
            : kind === 'ambulance'
              ? 4.8
              : 3.8;

      this.units.push({
        resourceId: r.id,
        name: r.name,
        kind,
        operationalMode: mode,
        homeBaseId,
        homePosition,
        currentPosition: [startPos[0], startPos[1]],
        angle: startAngle,
        width: r.width || (kind === 'fire' ? 3 : kind === 'ambulance' ? 2.5 : 2),
        length: r.depth || (kind === 'fire' ? 8 : kind === 'ambulance' ? 6 : 4.6),
        speed: defaultSpeed,
        available: r.active !== false || mode === 'reserve',
        availableForReinforcement: r.availableForReinforcement !== false,
        assignedIncidentId: null,
        crewCapacity: crewCap,
        crewStatus: 'embarked',
        vehicleStatus:
          mode === 'exterior_patrol' && patrolPath.length >= 2
            ? 'patrolling'
            : 'parked',
        sirensActive: false,
        patrolRouteId: r.patrolRouteId,
        patrolPath,
        patrolDist: 0,
        patrolLength: polylineLength(patrolPath),
        patrolDir: 1,
        activePath: [],
        activeDist: 0,
        activeLength: 0,
        dismountPoint: null,
        delaySec: Math.max(
          0,
          Number(
            r.delay ??
              ({
                fire: 60,
                ambulance: 30,
                patrol: 20,
                police_van: 30,
              } as Record<EmergencyVehicleKind, number>)[kind]
          )
        ),
        handlingSec: Math.max(
          15,
          Number(
            r.handling ??
              ({
                fire: 240,
                ambulance: 150,
                patrol: 120,
                police_van: 150,
              } as Record<EmergencyVehicleKind, number>)[kind]
          )
        ),
      });
    }
  }

  /** Devuelve los tipos de vehículo compatibles con un servicio/modo solicitado. */
  compatibleKinds(requestedMode: string): EmergencyVehicleKind[] {
    if (requestedMode === 'ambulance') return ['ambulance'];
    if (requestedMode === 'fire') return ['fire'];
    if (requestedMode === 'police_van') return ['police_van', 'patrol'];
    if (requestedMode === 'patrol' || requestedMode === 'security') {
      return ['patrol', 'police_van'];
    }
    return ['ambulance'];
  }

  /**
   * Selecciona la mejor unidad compatible disponible considerando distancia, ETA,
   * capacidad de tripulación y disponibilidad para refuerzos.
   */
  selectBestUnit(
    requestedMode: string,
    incidentPoint: Point2D,
    opts?: {preferHighCrew?: boolean}
  ): EmergencyUnitRuntime | null {
    const allowed = this.compatibleKinds(requestedMode);
    const candidates = this.units.filter(
      (u) =>
        allowed.includes(u.kind) &&
        u.available &&
        u.availableForReinforcement &&
        u.assignedIncidentId === null &&
        u.crewStatus === 'embarked' &&
        (u.vehicleStatus === 'parked' || u.vehicleStatus === 'patrolling')
    );
    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      const etaA = dist(a.currentPosition, incidentPoint) / Math.max(1, a.speed) + a.delaySec;
      const etaB = dist(b.currentPosition, incidentPoint) / Math.max(1, b.speed) + b.delaySec;
      const crewBonusA = opts?.preferHighCrew ? -a.crewCapacity * 4 : 0;
      const crewBonusB = opts?.preferHighCrew ? -b.crewCapacity * 4 : 0;
      const patrolBonusA = a.vehicleStatus === 'patrolling' ? -10 : 0;
      const patrolBonusB = b.vehicleStatus === 'patrolling' ? -10 : 0;
      return etaA + crewBonusA + patrolBonusA - (etaB + crewBonusB + patrolBonusB);
    });
    return candidates[0];
  }

  /**
   * Despacha un vehículo compatible hacia una incidencia real, sin duplicar vehículos
   * si la incidencia ya tiene una misión asignada.
   */
  dispatchForIncident(
    row: EmergencyIncident,
    requestedMode: string,
    opts?: {needsEvacuation?: boolean; preferHighCrew?: boolean}
  ): EmergencyMission | null {
    // Nunca generar vehículos duplicados para una misma incidencia
    const existing = this.missions.get(row.id);
    if (existing && existing.stage !== 'completed') {
      return existing;
    }

    const incidentPoint: Point2D = row.point || [
      this.e.g.m.widthMeters / 2,
      this.e.g.m.heightMeters / 2,
    ];
    const unit = this.selectBestUnit(requestedMode, incidentPoint, opts);
    if (!unit) return null;

    const scene: Scene = this.e.s;
    const requiredWidth = unit.width + 0.3;
    const hasAuthorityConfig = (scene.entrances || []).some((g) =>
      Array.isArray(g.recommendedAuthorities)
    );
    const matchingGate = (scene.entrances || []).find((g) =>
      gateAllowsAuthority(g, unit.kind, requiredWidth)
    );
    if (!matchingGate && hasAuthorityConfig && unit.kind === 'fire') {
      return null;
    }
    const conditionalDelay = matchingGate ? gateVehicleDelaySec(matchingGate) : 0;

    // En servicio fijo, si ya está estacionado cerca o dentro del recinto, desplegar personal a pie
    // sin mover innecesariamente el vehículo salvo que necesite aproximarse desde muy lejos.
    const distToIncident = dist(unit.currentPosition, incidentPoint);
    const stayParkedFixed =
      unit.operationalMode === 'fixed_service' && distToIncident <= 85;

    let vehiclePath: Point2D[] = [unit.currentPosition];
    let stagingPoint: Point2D = [...unit.currentPosition];
    let footPath: Point2D[] = [];
    let routeWarning: string | undefined;

    if (stayParkedFixed || !matchingGate) {
      // Estacionamiento en posición actual/exterior accesible y desembarco a pie
      const fp = buildFootPath(this.e.g, stagingPoint, incidentPoint);
      footPath = fp.path;
      if (!fp.exact) {
        routeWarning =
          'No existe un corredor peatonal continuo libre de obstáculos hasta el punto; aproximación a pie asistida.';
      }
    } else {
      // Calcular ruta vehicular desde la ubicación REAL del vehículo hasta el punto practicable más cercano
      const plan = planVehicleRoute(
        scene,
        this.vehGrid,
        unit.currentPosition,
        incidentPoint,
        {
          width: unit.width,
          length: unit.length,
          minTurnRadius: Math.max(3, unit.length * 0.75),
        },
        {
          allowFootDismount: true,
          pedestrianGrid: this.e.g,
        }
      );

      if (plan.ok && plan.path && plan.path.length >= 2) {
        vehiclePath = plan.path;
        stagingPoint = plan.dismountPoint || plan.path[plan.path.length - 1];
        if (plan.footPath && plan.footPath.length >= 2) {
          footPath = plan.footPath;
        } else {
          const fp = buildFootPath(this.e.g, stagingPoint, incidentPoint);
          footPath = fp.path;
        }
      } else {
        // Si la vía interior está bloqueada, estacionar en punto exterior practicable y desplegar a pie
        const fp = buildFootPath(this.e.g, stagingPoint, incidentPoint);
        footPath = fp.path;
        routeWarning =
          plan.reason ||
          'Acceso vehicular interior restringido; vehículo estacionado en punto seguro y despliegue a pie.';
      }
    }

    const evacFoot = buildFootPath(this.e.g, incidentPoint, stagingPoint);
    const evacuationPath = evacFoot.exact
      ? evacFoot.path
      : footPath.slice().reverse();

    const needsEvacuation =
      opts?.needsEvacuation ??
      (unit.kind === 'ambulance' && row.severity !== 'leve');

    const handlingDuration = Math.max(
      15,
      row.severity === 'leve'
        ? Math.min(unit.handlingSec, 60)
        : unit.handlingSec
    );

    const mission: EmergencyMission = {
      incidentId: row.id,
      unitId: unit.resourceId,
      stage: 'dispatched',
      stagingPoint,
      incidentPoint,
      needsEvacuation,
      dispatchedAt: this.e.time,
      dispatchDelay: unit.delaySec + conditionalDelay,
      handlingDuration,
      footPath: footPath.length >= 2 ? footPath : [stagingPoint, incidentPoint],
      evacuationPath:
        evacuationPath.length >= 2
          ? evacuationPath
          : [incidentPoint, stagingPoint],
      routeWarning,
    };

    unit.available = false;
    unit.assignedIncidentId = row.id;
    unit.vehicleStatus = 'dispatched';
    unit.crewStatus = 'embarked';
    unit.sirensActive = this.e.s.emergency?.sirens !== false;
    unit.activePath = vehiclePath;
    unit.activeDist = 0;
    unit.activeLength = polylineLength(vehiclePath);
    unit.dismountPoint = stagingPoint;

    // Registrar metadatos y marcas de tiempo en la incidencia
    row.resourceId = unit.resourceId;
    row.resourceName = unit.name;
    row.dispatchedAt = this.e.time;
    row.assigned = this.e.time;
    row.alertDelay = mission.dispatchDelay;
    row.dismountPoint = stagingPoint;
    row.footDeployment = true;
    row.stagingUsed = dist(stagingPoint, incidentPoint) > 3;
    row.path = vehiclePath.length >= 2 ? [...vehiclePath, ...mission.footPath.slice(1)] : mission.footPath;
    row.pathLength = polylineLength(row.path);
    row.evacuationPath = mission.evacuationPath;
    row.status = 'assigned';
    row.phase = 'approach';
    row.fleetMission = true;
    row.note = stayParkedFixed
      ? `${unit.name} (servicio fijo) despliega personal a pie hacia la incidencia.`
      : routeWarning
        ? `${unit.name} estacionado en punto seguro · ${routeWarning}`
        : `${unit.name} despachado desde su ubicación real (${unit.homeBaseId ? 'base asignada' : 'punto de espera'}).`;

    this.missions.set(row.id, mission);
    return mission;
  }

  private spawnCrewForMission(
    unit: EmergencyUnitRuntime,
    mission: EmergencyMission
  ): void {
    // Eliminar posibles restos previos de la misma misión
    this.crew = this.crew.filter((c) => c.incidentId !== mission.incidentId);
    const deployCount =
      unit.kind === 'police_van'
        ? Math.min(unit.crewCapacity, 4)
        : Math.min(unit.crewCapacity, 2);
    const role: DeployedCrewMember['role'] =
      unit.kind === 'ambulance'
        ? 'medical'
        : unit.kind === 'fire'
          ? 'fire'
          : 'police';
    const footLen = polylineLength(mission.footPath);

    for (let i = 0; i < deployCount; i++) {
      const offset = i * 0.65;
      const startPt = mission.footPath[0] || unit.currentPosition;
      this.crew.push({
        id: `crew-${unit.resourceId}-${mission.incidentId}-${i}`,
        unitId: unit.resourceId,
        incidentId: mission.incidentId,
        role,
        x: startPt[0] + (i % 2 === 0 ? -0.35 : 0.35),
        y: startPt[1] + offset * 0.25,
        carryingStretcher: unit.kind === 'ambulance' && i === 0,
        carryingPatient: false,
        path: mission.footPath,
        pathDist: 0,
        pathLength: footLen,
        speed: unit.kind === 'ambulance' ? 1.35 : 1.55,
        status: 'deploying',
      });
    }
    unit.crewStatus = 'deploying';
    unit.vehicleStatus = 'intervening';
    unit.sirensActive = false;
    mission.stage = 'crew_deploying';
  }

  private startVehicleReturn(unit: EmergencyUnitRuntime): void {
    // Prohibido salir si la tripulación no está completamente embarcada
    if (unit.crewStatus !== 'embarked') return;
    if (dist(unit.currentPosition, unit.homePosition) <= 1.5) {
      unit.currentPosition = [unit.homePosition[0], unit.homePosition[1]];
      unit.vehicleStatus =
        unit.operationalMode === 'exterior_patrol' && unit.patrolPath.length >= 2
          ? 'patrolling'
          : 'parked';
      unit.available = true;
      unit.assignedIncidentId = null;
      unit.sirensActive = false;
      unit.activePath = [];
      unit.activeDist = 0;
      unit.activeLength = 0;
      return;
    }

    const backPlan = planVehicleRoute(
      this.e.s,
      this.vehGrid,
      unit.currentPosition,
      unit.homePosition,
      {
        width: unit.width,
        length: unit.length,
        minTurnRadius: Math.max(3, unit.length * 0.75),
      }
    );
    const backPath =
      backPlan.ok && backPlan.path && backPlan.path.length >= 2
        ? backPlan.path
        : unit.activePath.length >= 2
          ? unit.activePath.slice().reverse()
          : [unit.currentPosition, unit.homePosition];

    unit.activePath = backPath;
    unit.activeDist = 0;
    unit.activeLength = polylineLength(backPath);
    unit.vehicleStatus = 'returning';
    unit.sirensActive = false;
  }

  update(dt: number, events: EmergencyIncident[]): void {
    const now = this.e.time;

    // 1. Actualizar patrullas exteriores (solo las que tienen modo 'exterior_patrol' y están libres)
    for (const u of this.units) {
      if (
        u.vehicleStatus === 'patrolling' &&
        u.operationalMode === 'exterior_patrol' &&
        u.available &&
        u.patrolPath.length >= 2 &&
        u.patrolLength > 0.5
      ) {
        const patrolSpeed = u.speed * 0.55;
        u.patrolDist += patrolSpeed * dt * u.patrolDir;
        if (u.patrolDist >= u.patrolLength) {
          u.patrolDist = u.patrolLength;
          u.patrolDir = -1;
        } else if (u.patrolDist <= 0) {
          u.patrolDist = 0;
          u.patrolDir = 1;
        }
        const pose = poseAt(u.patrolPath, u.patrolDist);
        u.currentPosition = [pose.x, pose.y];
        u.angle = u.patrolDir === 1 ? pose.angle : pose.angle + Math.PI;
      }
    }

    // 2. Actualizar misiones activas
    for (const mission of this.missions.values()) {
      if (mission.stage === 'completed') continue;
      const unit = this.units.find((u) => u.resourceId === mission.unitId);
      const row = events.find((ev) => ev.id === mission.incidentId);
      if (!unit) {
        mission.stage = 'completed';
        continue;
      }

      // Fase A: Despachado -> esperar demora de salida -> En ruta
      if (mission.stage === 'dispatched') {
        if (now < mission.dispatchedAt + mission.dispatchDelay) continue;
        if (unit.activeLength <= 0.5) {
          // Ya está en su punto de parada (p. ej. servicio fijo o staging exterior)
          mission.vehicleArrivedAt = now;
          this.spawnCrewForMission(unit, mission);
          if (row) {
            row.vehiclePose = {
              x: unit.currentPosition[0],
              y: unit.currentPosition[1],
              angle: unit.angle,
            };
            row.note = `${unit.name} estacionado · tripulación desplegándose a pie.`;
          }
        } else {
          mission.stage = 'en_route';
          unit.vehicleStatus = 'en_route';
        }
        continue;
      }

      // Fase B: Vehículo en ruta hacia punto de parada seguro
      if (mission.stage === 'en_route') {
        unit.activeDist = Math.min(unit.activeLength, unit.activeDist + unit.speed * dt);
        const pose = poseAt(unit.activePath, unit.activeDist);
        unit.currentPosition = [pose.x, pose.y];
        unit.angle = pose.angle;
        if (row) {
          row.vehiclePose = pose;
        }
        if (unit.activeDist >= unit.activeLength - 0.15) {
          unit.currentPosition = [mission.stagingPoint[0], mission.stagingPoint[1]];
          mission.vehicleArrivedAt = now;
          this.spawnCrewForMission(unit, mission);
          if (row) {
            row.note = `${unit.name} estacionado en punto seguro · desplegando personal a pie.`;
          }
        }
        continue;
      }

      // Fase C: Tripulación caminando a pie hasta la incidencia (vehículo espera estacionado)
      if (mission.stage === 'crew_deploying') {
        const members = this.crew.filter((c) => c.incidentId === mission.incidentId);
        let allArrived = true;
        for (const m of members) {
          m.pathDist = Math.min(m.pathLength, m.pathDist + m.speed * dt);
          const p = poseAt(m.path, m.pathDist);
          m.x = p.x;
          m.y = p.y;
          if (m.pathDist < m.pathLength - 0.15) {
            allArrived = false;
          } else {
            m.status = 'intervening';
          }
        }
        if (members[0] && row) {
          row.vehiclePose = {x: members[0].x, y: members[0].y, angle: 0};
        }
        if (allArrived) {
          mission.stage = 'intervening';
          mission.crewArrivedAt = now;
          mission.interventionEndAt = now + mission.handlingDuration;
          unit.crewStatus = 'intervening';
          if (row) {
            row.status = 'assisting';
            row.arrived = now;
            row.phase = 'care';
            row.note =
              unit.kind === 'ambulance'
                ? 'Personal sanitario desplegado atendiendo al paciente en el lugar.'
                : unit.kind === 'fire'
                  ? 'Dotación de bomberos interviniendo en el foco.'
                  : 'Agentes policiales desplegados controlando la incidencia.';
          }
        }
        continue;
      }

      // Fase D: Intervención en curso (vehículo espera estacionado, prohibido salir)
      if (mission.stage === 'intervening') {
        if (now >= (mission.interventionEndAt ?? now)) {
          const members = this.crew.filter((c) => c.incidentId === mission.incidentId);
          const evacLen = polylineLength(mission.evacuationPath);
          for (const m of members) {
            m.status = 'returning';
            m.path = mission.evacuationPath;
            m.pathDist = 0;
            m.pathLength = evacLen;
            m.carryingPatient = mission.needsEvacuation && m.carryingStretcher;
            if (m.carryingPatient) m.speed = 0.95;
          }
          mission.stage = 'crew_returning';
          unit.crewStatus = 'returning';
          if (row) {
            row.phase = mission.needsEvacuation ? 'transfer' : 'care';
            row.note = mission.needsEvacuation
              ? 'Traslado del paciente en camilla hasta la ambulancia estacionada.'
              : 'Intervención completada · personal regresando al vehículo.';
          }
        }
        continue;
      }

      // Fase E: Tripulación regresando al vehículo (con paciente si procede)
      if (mission.stage === 'crew_returning') {
        const members = this.crew.filter((c) => c.incidentId === mission.incidentId);
        let allBack = true;
        for (const m of members) {
          m.pathDist = Math.min(m.pathLength, m.pathDist + m.speed * dt);
          const p = poseAt(m.path, m.pathDist);
          m.x = p.x;
          m.y = p.y;
          if (m.pathDist < m.pathLength - 0.15) {
            allBack = false;
          }
        }
        if (mission.needsEvacuation && row?.agentId != null && members[0]) {
          const ag = this.e.byId?.get(row.agentId);
          if (ag) {
            this.e.remove(ag);
            ag.x = members[0].x;
            ag.y = members[0].y;
            ag.state = 'transport';
            this.e.insert(ag);
          }
        }
        if (allBack) {
          // Tripulación embarcada de nuevo -> ahora sí puede salir el vehículo
          this.crew = this.crew.filter((c) => c.incidentId !== mission.incidentId);
          unit.crewStatus = 'embarked';
          mission.crewReturnedAt = now;
          mission.resolvedAt = now;
          if (row && row.status !== 'resolved') {
            if (row.type === 'fire') this.e.emergency?.fire?.extinguish(row);
            row.status = 'resolved';
            row.phase = mission.needsEvacuation ? 'handover' : 'completed';
            row.closed = now;
            row.note = mission.needsEvacuation
              ? 'Paciente evacuado en ambulancia · unidad regresando a base.'
              : 'Incidencia resuelta · tripulación embarcada y vehículo regresando a base.';
            const ag = row.agentId != null ? this.e.byId?.get(row.agentId) : null;
            if (ag) {
              if (mission.needsEvacuation) this.e.depart(ag);
              else this.e.assign(ag);
            }
          }
          mission.stage = 'vehicle_returning';
          this.startVehicleReturn(unit);
          if (unit.vehicleStatus === 'parked' || unit.vehicleStatus === 'patrolling') {
            mission.stage = 'completed';
          }
        }
        continue;
      }

      // Fase F: Vehículo regresando a su base o ruta de patrulla
      if (mission.stage === 'vehicle_returning') {
        if (unit.vehicleStatus !== 'returning' || unit.activeLength <= 0.2) {
          mission.stage = 'completed';
          continue;
        }
        unit.activeDist = Math.min(unit.activeLength, unit.activeDist + unit.speed * dt);
        const pose = poseAt(unit.activePath, unit.activeDist);
        unit.currentPosition = [pose.x, pose.y];
        unit.angle = pose.angle;
        if (unit.activeDist >= unit.activeLength - 0.15) {
          unit.currentPosition = [unit.homePosition[0], unit.homePosition[1]];
          unit.vehicleStatus =
            unit.operationalMode === 'exterior_patrol' && unit.patrolPath.length >= 2
              ? 'patrolling'
              : 'parked';
          unit.available = true;
          unit.assignedIncidentId = null;
          unit.sirensActive = false;
          unit.activePath = [];
          unit.activeDist = 0;
          unit.activeLength = 0;
          mission.stage = 'completed';
        }
      }
    }
  }

  /** Genera el SVG de todos los vehículos de emergencia de la flota y su tripulación a pie. */
  svg(): string {
    const blink = Math.floor(performance.now() / 600) % 2 === 0;
    const statusLabel: Record<EmergencyVehicleStatus, string> = {
      parked: 'ESTACIONADO',
      patrolling: 'PATRULLA EXT.',
      dispatched: 'DESPACHADO',
      en_route: 'EN RUTA',
      intervening: 'INTERVINIENDO',
      returning: 'REGRESO BASE',
    };
    const modeTag: Record<EmergencyOperationalMode, string> = {
      reserve: 'RES',
      exterior_patrol: 'PAT',
      fixed_service: 'FIJO',
    };

    const unitsSvg = this.units
      .map((u) => {
        const [x, y] = u.currentPosition;
        const deg = (u.angle * 180) / Math.PI;
        const fill =
          u.kind === 'fire'
            ? '#bc5a48'
            : u.kind === 'ambulance'
              ? '#f2f7f7'
              : u.kind === 'police_van'
                ? '#2d4b7a'
                : '#3c6299';
        const tag =
          u.kind === 'fire'
            ? 'BOM'
            : u.kind === 'ambulance'
              ? 'AMB'
              : u.kind === 'police_van'
                ? 'FUR'
                : 'POL';
        const lights =
          u.kind === 'fire'
            ? ['#ef4444', '#f59e0b']
            : u.kind === 'ambulance'
              ? ['#10b981', '#ef4444']
              : ['#ef4444', '#2563eb'];

        let html = '';
        if (u.activePath.length >= 2 && (u.vehicleStatus === 'en_route' || u.vehicleStatus === 'returning')) {
          html += `<polyline points="${u.activePath.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${
            u.vehicleStatus === 'returning' ? '#64748b' : '#0284c7'
          }" stroke-width=".42" stroke-dasharray="1.4 0.9" opacity=".8"/>`;
        }
        html += `<g transform="translate(${x} ${y}) rotate(${deg})"><title>${esc(
          `${u.name} · ${statusLabel[u.vehicleStatus]} · Tripulación: ${u.crewCapacity} (${u.crewStatus})`
        )}</title>`;
        html += `<rect x="${-u.length / 2}" y="${-u.width / 2}" width="${u.length}" height="${u.width}" rx=".45" fill="${fill}" stroke="#1e293b" stroke-width=".2"/>`;
        html += `<rect x="${u.length / 2 - 1.0}" y="${-u.width / 2 + 0.22}" width=".65" height="${u.width - 0.44}" rx=".18" fill="#bae6fd" fill-opacity=".8"/>`;
        if (u.kind === 'ambulance') {
          html += '<path d="M-.55 0H.55M0-.55V.55" stroke="#dc2626" stroke-width=".36"/>';
        }
        if (u.sirensActive) {
          html += `<circle cx="-.35" cy="0" r=".36" fill="${lights[0]}" opacity="${blink ? 1 : 0.25}"/>`;
          html += `<circle cx=".35" cy="0" r=".36" fill="${lights[1]}" opacity="${blink ? 0.25 : 1}"/>`;
        }
        html += '</g>';
        html += `<g transform="translate(${x} ${y - 2.3})"><rect x="-3.4" y="-1.45" width="6.8" height="1.95" rx=".45" fill="#0f172a" fill-opacity=".85"/><text text-anchor="middle" font-size="1.25" fill="#f8fafc">${tag}·${modeTag[u.operationalMode]}</text></g>`;
        return html;
      })
      .join('');

    const crewSvg = this.crew
      .map((m) => {
        const fill =
          m.role === 'medical'
            ? '#0891b2'
            : m.role === 'fire'
              ? '#dc2626'
              : '#1d4ed8';
        let html = `<g transform="translate(${m.x} ${m.y})"><title>${esc(
          `Tripulación a pie (${m.role}) · ${m.status}${m.carryingPatient ? ' · evacuando paciente' : ''}`
        )}</title>`;
        if (m.carryingStretcher) {
          html += `<rect x="-.9" y="-.3" width="1.8" height=".6" rx=".15" fill="${
            m.carryingPatient ? '#f59e0b' : '#fef3c7'
          }" stroke="#78350f" stroke-width=".12"/>`;
        }
        html += `<circle r=".42" fill="${fill}" stroke="#ffffff" stroke-width=".14"/></g>`;
        return html;
      })
      .join('');

    return unitsSvg + crewSvg;
  }
}
