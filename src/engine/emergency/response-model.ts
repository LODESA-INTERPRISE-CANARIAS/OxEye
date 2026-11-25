import type {
  Agent,
  EmergencyIncident,
  IncidentOriginMode,
  IncidentSeverityLevel,
  Infrastructure,
  Point,
  ResponseConditions,
  ResponseProfile,
  ScheduledIncident,
  VehiclePose,
} from '../../types';
import {
  getContextualTemplateById,
  hasGasCompatibleInstallation,
  resolveIncidentGenerationMode,
} from './contextual-incidents';
import {
  appendIncidentMilestone,
  categoryForIncidentType,
  formatIncidentCode,
  INCIDENT_CATEGORIES,
  normalizeSeverity,
  syncIncidentHistory,
} from './incident-center';

/**
 * Tiempos de respuesta externa orientativos para el Área Metropolitana de Tenerife
 * (San Cristóbal de La Laguna / Santa Cruz), editables por el usuario.
 */
export const DEFAULT_TENERIFE_RESPONSE_CONDITIONS: ResponseConditions = {
  detectionSec: 45,
  fireExternalSec: 420,
  policeExternalSec: 360,
  medicalExternalSec: 480,
};

export function resolveResponseConditions(
  rc?: Partial<ResponseConditions> | null
): ResponseConditions {
  const clampSec = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? Math.max(min, Math.min(max, Math.round(n)))
      : def;
  };
  return {
    detectionSec: clampSec(
      rc?.detectionSec,
      DEFAULT_TENERIFE_RESPONSE_CONDITIONS.detectionSec,
      5,
      600
    ),
    fireExternalSec: clampSec(
      rc?.fireExternalSec,
      DEFAULT_TENERIFE_RESPONSE_CONDITIONS.fireExternalSec,
      30,
      3600
    ),
    policeExternalSec: clampSec(
      rc?.policeExternalSec,
      DEFAULT_TENERIFE_RESPONSE_CONDITIONS.policeExternalSec,
      30,
      3600
    ),
    medicalExternalSec: clampSec(
      rc?.medicalExternalSec,
      DEFAULT_TENERIFE_RESPONSE_CONDITIONS.medicalExternalSec,
      30,
      3600
    ),
  };
}
import {routeBranchBias} from '../cartography/route-network';
import {buildGrid, flow, segmentDistance} from '../crowd/grid-flow';
import {
  buildVehicleGrid,
  planVehicleRoute,
} from '../mobility/vehicle-system';
import {
  gateAllowsAuthority,
  gateVehicleDelaySec,
  resolveAccessCategory,
} from './priority';
import {EmergencyLab, INCIDENTS} from './emergency-lab';
import {Evacuation} from './evacuation';
import {FireModel} from './fire-model';
import {IncidentCrowd} from './incident-crowd';
import {vehiclePath} from './motion';
import {inVehicle, poseAt} from './priority';
import {
  EmergencyVehicleFleet,
  isEmergencyVehicleKind,
} from './vehicle-dispatch';
import {Watch} from './watch';

export const AUTO_INCIDENTS: Array<[string, number]> = [
  ['minor', 60],
  ['orientation', 25],
  ['obstacle', 8],
  ['cut', 3],
  ['fall', 2],
  ['conflict', 1],
  ['fire', 1],
];

export function chooseIncident(random: () => number): string {
  let n = random() * 100;
  for (const [type, weight] of AUTO_INCIDENTS) {
    n -= weight;
    if (n < 0) return type;
  }
  return 'minor';
}

export interface ServiceLoadRow {
  kind: string;
  capacity: number;
  busy: number;
  waiting: number;
  overloaded: boolean;
}

export function serviceLoad(emergency: any): ServiceLoadRow[] {
  const active = (emergency.events as EmergencyIncident[]).filter(
    (q) => !['resolved', 'unreported'].includes(q.status)
  );
  const coreKinds = new Set(['medical', 'security', 'fire', 'ambulance', 'patrol']);
  return ['medical', 'security', 'fire', 'ambulance', 'patrol', 'yellow_tent', 'violet_point']
    .map((kind) => {
      const resources = (emergency.resources() as Infrastructure[]).filter(
        (r) =>
          (r.kind === kind || (kind === 'patrol' && r.kind === 'police_van')) &&
          r.active !== false
      );
      const staffPer =
        kind === 'medical'
          ? emergency.e.s.responseMode === 'stretcher'
            ? 2
            : 1
          : ['fire', 'ambulance'].includes(kind)
            ? 2
            : 1;
      const capacity = resources.reduce(
        (n, r) =>
          n +
          Math.min(
            Math.max(0, Math.floor(r.capacity || 0)),
            Math.floor((r.staff || 0) / staffPer)
          ),
        0
      );
      const busy = active.filter(
        (q) =>
          q.resourceId &&
          resources.some((r) => r.id === q.resourceId) &&
          ['assigned', 'assisting', 'waiting_transport'].includes(q.status)
      ).length;
      const waiting = active.filter(
        (q) =>
          ['pending', 'waiting', 'blocked', 'waiting_transport'].includes(
            q.status
          ) &&
          (q.type === 'fire'
            ? 'fire'
            : q.type === 'accessibility'
              ? 'yellow_tent'
              : q.type === 'violet_point'
                ? 'violet_point'
                : ['orientation', 'obstacle', 'conflict', 'fence_breach', 'congestion'].includes(
                      q.type
                    )
                  ? emergency.e.s.policeMode || 'security'
                  : q.responseMode === 'ambulance'
                    ? 'ambulance'
                    : 'medical') === kind
      ).length;
      return {
        kind,
        capacity,
        busy,
        waiting,
        overloaded: waiting > 0 || (capacity > 0 && busy >= capacity),
      };
    })
    .filter((row) => coreKinds.has(row.kind) || row.capacity > 0 || row.waiting > 0);
}

/**
 * Profiles for emergency response vehicles and teams.
 */
export const RESPONSE_PROFILES: Record<string, ResponseProfile> = {
  patrol: {name: 'Coche policial', width: 1.9, length: 4.6, speed: 1.8, staff: 2},
  police_van: {
    name: 'Furgón policial',
    width: 2.2,
    length: 5.8,
    speed: 1.5,
    staff: 4,
  },
  firstaid: {
    name: 'Atención en el lugar',
    width: 0.9,
    length: 0.9,
    speed: 1.1,
    staff: 1,
  },
  yellow_tent: {
    name: 'Auxiliar de Carpa Amarilla',
    width: 0.5,
    length: 0.5,
    speed: 1.05,
    staff: 1,
  },
  violet_point: {
    name: 'Equipo Punto Violeta',
    width: 0.5,
    length: 0.5,
    speed: 1.05,
    staff: 2,
  },
  stretcher: {
    name: 'Camilla desplegada + 2 operarios',
    width: 0.65,
    length: 2.0,
    speed: 0.85,
    staff: 2,
  },
  ambulance: {
    name: 'Ambulancia',
    width: 2.5,
    length: 6,
    speed: 1.2,
    staff: 2,
  },
  fire: {
    name: 'Vehículo de bomberos',
    width: 3,
    length: 8,
    speed: 1,
    staff: 2,
  },
  security: {
    name: 'Equipo de seguridad a pie',
    width: 0.9,
    length: 0.9,
    speed: 1.1,
    staff: 1,
  },
};

/**
 * Checks whether a rectangular vehicle/team footprint at `pose` fits within free grid cells.
 *
 * @param e - EventEngine instance.
 * @param pose - Vehicle pose `{x, y, angle}`.
 * @param w - Footprint width in meters.
 * @param l - Footprint length in meters.
 * @returns `true` if every sampled point lies in a free cell.
 */
export function footprintClear(e: any, pose: VehiclePose, w: number, l: number): boolean {
  const nx = Math.max(1, Math.ceil(l / 0.3));
  const ny = Math.max(1, Math.ceil(w / 0.3));
  const baseFree: Uint8Array = e.g.staffFree || e.g.free;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const u = -l / 2 + (i * l) / nx;
      const v = -w / 2 + (j * w) / ny;
      const x = pose.x + Math.cos(pose.angle) * u - Math.sin(pose.angle) * v;
      const y = pose.y + Math.sin(pose.angle) * u + Math.cos(pose.angle) * v;
      const k = e.g.index(x, y);
      if (k < 0 || !baseFree[k]) return false;
    }
  }
  return true;
}

const dist = (a: Point, b: Point): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const pathLength = (p: Point[]): number =>
  p.slice(1).reduce((n, q, i) => n + dist(p[i], q), 0);

/**
 * Computes a collision-checked geometric route for a response team or vehicle.
 *
 * @param e - EventEngine instance.
 * @param origin - Origin coordinates `[x, y]` in meters.
 * @param destination - Destination coordinates `[x, y]` in meters.
 * @param profile - Response profile.
 * @param near - Stopping distance margin in meters.
 * @returns Route result `{path, length}` or `{error}`.
 */
export function responseRoute(
  e: any,
  origin: Point,
  destination: Point,
  profile: ResponseProfile,
  near = 2
): {path?: Point[]; length?: number; error?: string} {
  const g = e.g;
  const baseFree: Uint8Array = g.staffFree || g.free;
  const free = new Uint8Array(baseFree.length);
  const r = profile.width / 2 + 0.15;
  for (let k = 0; k < baseFree.length; k++) {
    if (!baseFree[k]) continue;
    const p = g.point(k);
    let clear = true;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const j = g.index(p[0] + r * Math.cos(a), p[1] + r * Math.sin(a));
      if (j < 0 || !baseFree[j]) {
        clear = false;
        break;
      }
    }
    if (clear) free[k] = 1;
  }

  const grid = {
    ...g,
    free,
    neighbors: (k: number): number[] =>
      [
        k % g.w ? k - 1 : -1,
        k % g.w < g.w - 1 ? k + 1 : -1,
        k >= g.w ? k - g.w : -1,
        k < g.w * (g.h - 1) ? k + g.w : -1,
      ].filter((q) => q >= 0 && free[q]),
  };
  let start = -1;
  let d = Math.max(3.5, near + 1.5);
  const candidates: Array<{k: number; d: number}> = [];
  for (let k = 0; k < free.length; k++) {
    if (!free[k]) continue;
    const p = g.point(k);
    const ds = dist(p, origin);
    const dt = dist(p, destination);
    if (ds < d) {
      d = ds;
      start = k;
    }
    if (dt >= near && dt <= near + 4) candidates.push({k, d: dt});
  }
  if (start < 0) {
    return {
      error:
        'El recurso no tiene espacio libre en su posición inicial. Reubícalo sobre un paso comprobado.',
    };
  }
  candidates.sort(
    (a, b) =>
      a.d +
      dist(g.point(a.k), origin) -
      (b.d + dist(g.point(b.k), origin))
  );
  let field: Int32Array | undefined;
  let target = -1;
  for (const c of candidates.slice(0, 24)) {
    const f = flow(grid, c.k);
    if (f[start] >= 0) {
      field = f;
      target = c.k;
      break;
    }
  }
  if (!field) {
    return {error: 'No existe un corredor conectado con la anchura de ensayo.'};
  }
  // Corredores de emergencias sugeridos (`s.flows` / `s.corridors`): se priorizan
  // cuando acercan al destino, y el vehículo/equipo sigue navegando con autonomía al terminarlos.
  const corridorLines = [
    ...(e.s?.flows || []),
    ...(e.s?.corridors || []),
  ]
    .filter((l: {points?: Point[]}) => Array.isArray(l.points) && l.points.length >= 2)
    .map((l: {points: Point[]; width?: number}) => ({
      pts: l.points.map(
        ([px, py]): Point => [(px * g.m.widthMeters) / 100, (py * g.m.heightMeters) / 100]
      ),
      halfW: Math.max(1.5, (l.width || 3) / 2),
    }));
  const inEmergencyCorridor = (pt: Point): boolean => {
    for (const c of corridorLines) {
      for (let idx = 1; idx < c.pts.length; idx++) {
        if (segmentDistance(pt, c.pts[idx - 1], c.pts[idx]) <= c.halfW) {
          return true;
        }
      }
    }
    return false;
  };

  let k = start;
  let p: Point[] | null = [origin, g.point(k)];
  for (let i = 0; i < free.length && k !== target; i++) {
    const n = g
      .neighbors(k)
      .filter((nIdx: number) => free[nIdx] && field[nIdx] >= 0 && field[nIdx] < field[k])
      .sort((a: number, b: number) => {
        const ptA = g.point(a);
        const ptB = g.point(b);
        const densA = e.hashDensity ? e.hashDensity(a) : 0;
        const densB = e.hashDensity ? e.hashDensity(b) : 0;
        const biasA = e.routeNetwork
          ? routeBranchBias(ptA, e.routeNetwork, densA, profile.speed, profile.width)
          : inEmergencyCorridor(ptA)
            ? -0.45
            : 0;
        const biasB = e.routeNetwork
          ? routeBranchBias(ptB, e.routeNetwork, densB, profile.speed, profile.width)
          : inEmergencyCorridor(ptB)
            ? -0.45
            : 0;
        return field[a] + biasA - (field[b] + biasB);
      })[0];
    if (n === undefined) break;
    k = n;
    p.push(g.point(k));
  }
  if (k !== target) return {error: 'No se puede completar el recorrido.'};
  if (profile.length >= 4) {
    const clear = (a: Point, b: Point): boolean => {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const n = Math.max(1, Math.ceil(dist(a, b) / 0.4));
      for (let i = 0; i <= n; i++) {
        if (
          !footprintClear(
            e,
            {
              x: a[0] + ((b[0] - a[0]) * i) / n,
              y: a[1] + ((b[1] - a[1]) * i) / n,
              angle,
            },
            profile.width,
            profile.length
          )
        ) {
          return false;
        }
      }
      return true;
    };
    p = vehiclePath(p, Math.max(3, profile.length * 0.8), clear);
    if (!p) {
      return {
        error: 'El giro propuesto no admite el radio de ensayo del vehículo.',
      };
    }
  }
  const total = pathLength(p);
  for (let distStep = 0; distStep <= total; distStep += 0.3) {
    if (
      !footprintClear(
        e,
        poseAt(p, distStep),
        profile.width,
        profile.length
      )
    ) {
      return {
        error:
          'La huella no cabe en un estrechamiento o giro del recorrido propuesto. Revisa el paso; no se ha buscado una trayectoria vehicular óptima.',
      };
    }
  }
  return {path: p, length: total};
}

/**
 * Extended emergency response simulation with witness detection (`Watch`),
 * owner fire-extinguisher intervention, and patient transfer/handover.
 */
export class ResponseSimulation extends EmergencyLab {
  declare watch: Watch;
  social: IncidentCrowd;
  evacuation: Evacuation;
  fleet: EmergencyVehicleFleet;
  nextAuto: number;
  autoSkipped: number;
  incoming: Map<string, number>;
  fire: FireModel;
  scheduledIncidents: ScheduledIncident[];
  private scheduledSeq = 1;

  override isClosed(id: string): boolean {
    return super.isClosed(id) || !!this.fire?.isClosed(id);
  }

  constructor(e: any) {
    super(e);
    this.watch = new Watch(e);
    this.social = new IncidentCrowd(e);
    this.evacuation = new Evacuation(e);
    this.fleet = new EmergencyVehicleFleet(e);
    this.nextAuto = 120;
    this.autoSkipped = 0;
    this.incoming = new Map();
    this.fire = new FireModel(e);
    this.scheduledIncidents = [];
  }

  /** Localiza cualquier objeto del plano (puesto, infraestructura, acceso o valla) por ID. */
  private findSceneTarget(targetId: string): {obj: any; point: Point} | null {
    const e = this.e;
    const m = e.g.m;
    const obj =
      [
        ...(e.s.base?.booths || []),
        ...(e.s.infrastructure || []),
        ...(e.s.entrances || []),
      ].find((o: {id: string}) => o.id === targetId) ||
      (e.s.fences || []).find((f: {id?: string}) => f.id === targetId);
    if (!obj) return null;
    if (Array.isArray(obj.points) && obj.points.length) {
      const mid = obj.points[Math.floor(obj.points.length / 2)];
      return {
        obj,
        point: [(mid[0] * m.widthMeters) / 100, (mid[1] * m.heightMeters) / 100],
      };
    }
    return {
      obj,
      point: [(obj.x * m.widthMeters) / 100, (obj.y * m.heightMeters) / 100],
    };
  }

  /**
   * Provoca una incidencia contextual sobre un elemento concreto usando el mismo
   * motor de simulación, marcando `originMode` para no contaminar tasas espontáneas.
   */
  triggerContextualIncident(
    targetId: string,
    templateId: string,
    opts?: {
      severity?: IncidentSeverityLevel;
      originMode?: IncidentOriginMode;
      immediateDetect?: boolean;
      customParams?: {hasGas?: boolean; fireGrowthRate?: number};
    }
  ): EmergencyIncident | null {
    const e = this.e;
    if (this.events.length >= 100 || e.finished) return null;
    const target = this.findSceneTarget(targetId);
    const tpl = getContextualTemplateById(templateId);
    if (!target || !tpl) return null;

    const anchor = e.g.nearest(target.point[0], target.point[1], 14);
    const cell = anchor >= 0 ? anchor : e.entries[0]?.cell;
    if (cell === undefined || cell < 0) return null;

    const cat = tpl.category || categoryForIncidentType(tpl.engineType);
    this.categoryCounts[cat] = (this.categoryCounts[cat] || 0) + 1;
    const severity = opts?.severity || tpl.defaultSeverity;
    const sensitive = !!tpl.sensitive || cat === 'violet_point';
    const hasGas =
      opts?.customParams?.hasGas ?? hasGasCompatibleInstallation(target.obj);

    const responseMode =
      tpl.engineType === 'accessibility'
        ? 'yellow_tent'
        : tpl.engineType === 'violet_point'
          ? 'violet_point'
          : tpl.engineType === 'fire'
            ? 'fire'
            : [
                  'conflict',
                  'orientation',
                  'obstacle',
                  'fence_breach',
                  'congestion',
                ].includes(tpl.engineType)
              ? this.e.s.policeMode || 'security'
              : this.e.s.responseMode || 'firstaid';

    const row: EmergencyIncident = {
      id: this.next++,
      code: formatIncidentCode(cat, this.categoryCounts[cat]),
      category: cat,
      severity,
      sensitive,
      originMode: opts?.originMode ?? 'manual',
      targetObjectId: target.obj.id,
      targetObjectName: target.obj.name || target.obj.id,
      contextualTemplateId: tpl.id,
      hasGasInstallation: hasGas,
      hasPreDetectionData: true,
      type: tpl.engineType,
      name: `${tpl.label} · ${target.obj.name || target.obj.id}`,
      created: e.time,
      cell,
      point: [target.point[0], target.point[1]],
      stationId: target.obj.id,
      status: opts?.immediateDetect ? 'pending' : 'unreported',
      afterReportStatus: 'pending',
      reportedAt: opts?.immediateDetect ? e.time : undefined,
      reporters: [],
      responseMode,
      phase: 'alert',
      note: sensitive
        ? 'Solicitud reservada registrada en el servicio.'
        : `${tpl.label} en ${target.obj.name || target.obj.id}.`,
      model: 'Incidencia contextual · mismo motor de simulación',
    };

    this.events.push(row);
    if (tpl.engineType === 'fire') {
      this.fire.ignite(target.obj, row, {
        initialIntensity: tpl.fireConfig?.initialIntensity,
        growthRate:
          opts?.customParams?.fireGrowthRate ?? tpl.fireConfig?.growthRate,
      });
    }
    syncIncidentHistory(this.e);
    return row;
  }

  /** Programa una incidencia contextual para una hora, retardo o condición futura. */
  scheduleIncident(
    spec: Omit<ScheduledIncident, 'id' | 'executed' | 'scheduledAtSec'>
  ): ScheduledIncident {
    const entry: ScheduledIncident = {
      ...spec,
      id: `sched-${this.scheduledSeq++}`,
      scheduledAtSec: this.e.time,
      executed: false,
    };
    this.scheduledIncidents.push(entry);
    if (entry.trigger === 'immediate') {
      const spawned = this.triggerContextualIncident(entry.targetId, entry.templateId, {
        severity: entry.severity,
        originMode: 'manual',
        customParams: entry.customParams,
      });
      entry.executed = true;
      entry.executedAt = this.e.time;
      if (spawned) entry.spawnedIncidentId = spawned.id;
    }
    return entry;
  }

  cancelScheduledIncident(id: string): boolean {
    const before = this.scheduledIncidents.length;
    this.scheduledIncidents = this.scheduledIncidents.filter((s) => s.id !== id);
    return this.scheduledIncidents.length !== before;
  }

  private evaluateScheduledIncidents(): void {
    const e = this.e;
    for (const s of this.scheduledIncidents) {
      if (s.executed) continue;
      let shouldFire = false;
      if (s.trigger === 'immediate') {
        shouldFire = true;
      } else if (s.trigger === 'at_time') {
        shouldFire = e.time >= (s.triggerAtSec ?? 0);
      } else if (s.trigger === 'after_delay') {
        const baseT = s.scheduledAtSec ?? 0;
        shouldFire = e.time >= baseT + (s.delaySec ?? 0);
      } else if (s.trigger === 'condition') {
        if (s.condition === 'crowd_threshold') {
          const present = (e.agents || []).filter(
            (a: Agent) => a.state !== 'gone'
          ).length;
          shouldFire = present >= (s.conditionValue ?? 50);
        } else if (s.condition === 'active_fire') {
          shouldFire = this.events.some(
            (ev) => ev.type === 'fire' && ev.status !== 'resolved'
          );
        } else if (s.condition === 'after_incident') {
          const ref = this.events.find(
            (ev) => String(ev.id) === String(s.conditionIncidentId)
          );
          shouldFire = !!ref && (ref.status === 'resolved' || ref.reportedAt != null);
        }
      }
      if (shouldFire) {
        const spawned = this.triggerContextualIncident(s.targetId, s.templateId, {
          severity: s.severity,
          originMode: 'manual',
          customParams: s.customParams,
        });
        s.executed = true;
        s.executedAt = e.time;
        if (spawned) s.spawnedIncidentId = spawned.id;
      }
    }
  }

  /**
   * Crea una incidencia y foco independiente cuando la exposición térmica alcanza
   * ignición en una instalación vecina compatible, manteniendo trazabilidad causal.
   */
  spawnSecondaryFire(
    parentRow: EmergencyIncident,
    _parentNode: any,
    targetObj: any
  ): EmergencyIncident | null {
    const e = this.e;
    const m = e.g.m;
    const pt: Point = [
      (targetObj.x * m.widthMeters) / 100,
      (targetObj.y * m.heightMeters) / 100,
    ];
    const anchor = e.g.nearest(pt[0], pt[1], 14);
    const cell = anchor >= 0 ? anchor : e.entries[0]?.cell ?? 0;

    this.categoryCounts.fire = (this.categoryCounts.fire || 0) + 1;
    const childCode = formatIncidentCode('fire', this.categoryCounts.fire);
    const parentCode = parentRow.code || `FUE-${parentRow.id}`;
    const spreadCause = `${parentCode} → SPREAD → ${childCode}`;

    const childRow: EmergencyIncident = {
      id: this.next++,
      code: childCode,
      category: 'fire',
      severity: 'critica',
      sensitive: false,
      originMode: 'spread',
      parentIncidentId: parentRow.id,
      parentCode,
      spreadCause,
      targetObjectId: targetObj.id,
      targetObjectName: targetObj.name || targetObj.id,
      hasPreDetectionData: true,
      type: 'fire',
      name: `Propagación de incendio · ${targetObj.name || targetObj.id}`,
      created: e.time,
      reportedAt: e.time,
      cell,
      point: pt,
      stationId: targetObj.id,
      status: 'pending',
      responseMode: 'fire',
      phase: 'approach',
      fireStage: 'conato',
      note: `Foco secundario por exposición térmica desde ${parentCode} (${spreadCause}).`,
      model: 'Propagación física multifoco',
    };
    this.events.push(childRow);
    this.fire.ignite(targetObj, childRow, {
      parentRowId: parentRow.id,
      initialIntensity: 0.22,
    });

    appendIncidentMilestone(parentRow, {
      time: e.time,
      kind: 'spread',
      label: `Propagación hacia ${targetObj.name || targetObj.id} (${childCode})`,
      detail: `Transferencia térmica continuada: ${spreadCause}.`,
      status: parentRow.status,
      severity: 'critica',
      point: pt,
    });
    appendIncidentMilestone(childRow, {
      time: e.time,
      kind: 'origin',
      label: `Nuevo foco independiente por propagación (${spreadCause})`,
      detail: `Ignición por exposición térmica acumulada desde ${parentCode}.`,
      status: 'pending',
      severity: 'critica',
      point: pt,
    });

    this.evacuation.order(childRow);
    this.evaluateFireForceCapacity(childRow, parentRow);
    syncIncidentHistory(e);
    return childRow;
  }

  /**
   * Evalúa los recursos reales de bomberos al aparecer un foco nuevo o secundario:
   * primero comprueba capacidad libre en unidades reales; si están ocupadas, intenta
   * redistribución parcial sin fabricar camiones ni efectivos inexistentes.
   */
  evaluateFireForceCapacity(
    row: EmergencyIncident,
    parentRow?: EmergencyIncident
  ): void {
    const e = this.e;
    if (row.type !== 'fire' || row.status === 'resolved') return;

    if (this.fleet) {
      const existing = this.fleet.missions.get(row.id);
      if (existing && existing.stage !== 'completed') return;

      const summary = this.fleet.getFireCapacitySummary();
      if (summary.availableUnits > 0) {
        const mission = this.fleet.dispatchForIncident(row, 'fire');
        if (mission) {
          if (parentRow) {
            appendIncidentMilestone(row, {
              time: e.time,
              kind: 'reinforcement',
              label: `Refuerzo de bomberos despachado (${row.resourceName || mission.unitId})`,
              detail:
                'Nueva unidad real movilizada desde su base para atender el foco secundario sin duplicar efectivos.',
              status: row.status,
              severity: 'critica',
              resourceId: mission.unitId,
              resourceName: row.resourceName,
            });
          }
          return;
        }
      }

      // Si no hay camiones adicionales configurados, valorar redistribución de dotación cercana
      const rp = row.point || [0, 0];
      const donor = summary.busySplitCandidates.find(
        (u) =>
          u.assignedIncidentId !== row.id &&
          !this.events.some((ev) => ev.redistributedFromUnitId === u.resourceId && ev.status !== 'resolved') &&
          Math.hypot(u.currentPosition[0] - rp[0], u.currentPosition[1] - rp[1]) <= 38
      );
      if (donor) {
        const footPath = [donor.currentPosition, rp] as Point[];
        row.redistributedFromUnitId = donor.resourceId;
        row.resourceId = donor.resourceId;
        row.resourceName = `${donor.name} (dotación redistribuida)`;
        row.assigned = e.time;
        row.alertDelay = 0;
        row.handling = 420;
        row.footDeployment = true;
        row.profile = {
          name: 'Dotación redistribuida a pie',
          width: 0.7,
          length: 0.9,
          speed: 1.4,
          staff: 2,
        };
        row.path = footPath;
        row.pathLength = dist(donor.currentPosition, rp);
        row.vehicleDistance = 0;
        row.vehiclePose = poseAt(footPath, 0);
        row.status = 'assigned';
        row.phase = 'approach';
        row.note = `Dotación redistribuida parcialmente desde ${donor.name} al no haber otro camión de bomberos libre.`;
        appendIncidentMilestone(row, {
          time: e.time,
          kind: 'reinforcement',
          label: 'Redistribución de dotación entre focos',
          detail: row.note,
          status: row.status,
          severity: 'critica',
          resourceId: donor.resourceId,
          resourceName: row.resourceName,
        });
        return;
      }

      // Limitación explícita sin inventar vehículos
      row.status = 'waiting';
      row.resourceLimitation =
        summary.totalUnits === 0
          ? 'No hay camiones de bomberos configurados en el diseño.'
          : `Todos los camiones de bomberos configurados (${summary.busyUnits}/${summary.totalUnits}) están ocupados; sin refuerzos disponibles en diseño.`;
      row.note = row.resourceLimitation;
      if (!row.timeline?.some((ev) => ev.kind === 'limitation')) {
        appendIncidentMilestone(row, {
          time: e.time,
          kind: 'limitation',
          label: 'Limitación de recursos de bomberos',
          detail: row.resourceLimitation,
          status: 'waiting',
          severity: 'critica',
        });
      }
    }
  }

  override inject(
    type: string,
    sourceId: string | null = null
  ): EmergencyIncident | null {
    const row = super.inject(type, sourceId);
    if (row) {
      row.severity = normalizeSeverity(row.severity, type);
      row.responseMode =
        type === 'accessibility'
          ? 'yellow_tent'
          : type === 'violet_point'
            ? 'violet_point'
            : [
                  'fire',
                  'conflict',
                  'orientation',
                  'obstacle',
                  'fence_breach',
                  'congestion',
                ].includes(type)
              ? type === 'fire'
                ? 'fire'
                : this.e.s.policeMode || 'security'
              : this.e.s.responseMode || 'firstaid';
      row.phase = 'alert';
      if (type === 'fire') this.fire.start(row);
      row.model = 'Hipótesis editable · no protocolo validado';
      row.afterReportStatus = row.status;
      row.status = 'unreported';
      row.reporters = [];
      syncIncidentHistory(this.e);
    }
    return row;
  }

  override injectAtAgent(
    type: string,
    agent: {id: number; x: number; y: number; state?: string; target?: string | null},
    detail?: string
  ): EmergencyIncident | null {
    const row = super.injectAtAgent(type, agent, detail);
    if (row) {
      row.severity = normalizeSeverity(row.severity, type);
      row.responseMode =
        type === 'accessibility'
          ? 'yellow_tent'
          : type === 'violet_point'
            ? 'violet_point'
            : [
                  'conflict',
                  'orientation',
                  'obstacle',
                  'fence_breach',
                  'congestion',
                ].includes(type)
              ? this.e.s.policeMode || 'security'
              : this.e.s.responseMode || 'firstaid';
      row.phase = 'alert';
      row.model = 'Hipótesis editable · no protocolo validado';
      row.afterReportStatus = row.status;
      row.status = 'unreported';
      row.reporters = [];
      syncIncidentHistory(this.e);
    }
    return row;
  }

  assignResource(row: EmergencyIncident): void {
    const e = this.e;
    const requestedMode = row.responseMode || 'firstaid';

    // 1. Si es una incidencia leve/moderada atendible a pie, priorizar personal en recinto
    // y evitar movilizar vehículos innecesariamente cuando existe dotación a pie libre.
    const isFootMedicalIncident =
      ['minor', 'fall', 'cut'].includes(row.type) &&
      row.severity === 'leve' &&
      requestedMode !== 'ambulance';
    const isFootSecurityIncident =
      ['orientation', 'obstacle', 'fence_breach'].includes(row.type) &&
      row.severity !== 'grave';

    const hasFreeFoot = (footKind: 'medical' | 'security'): boolean => {
      const prof = RESPONSE_PROFILES[footKind === 'medical' ? 'firstaid' : 'security'];
      return this.resources().some(
        (r) =>
          r.active !== false &&
          r.kind === footKind &&
          (r.staff || 0) >= prof.staff &&
          this.events.filter(
            (q) =>
              q !== row &&
              q.resourceId === r.id &&
              ['assigned', 'assisting', 'waiting_transport'].includes(q.status)
          ).length <
            Math.min(
              Math.max(0, r.capacity || 0),
              Math.floor((r.staff || 0) / prof.staff)
            )
      );
    };

    if (isFootMedicalIncident && hasFreeFoot('medical')) {
      row.responseMode = 'firstaid';
    } else if (isFootSecurityIncident && hasFreeFoot('security')) {
      row.responseMode = 'security';
    }

    const activeMode = row.responseMode || 'firstaid';

    // 2. Despacho inteligente por flota de vehículos (reserva / patrulla exterior / servicio fijo)
    // cuando el incidente requiere vehículo (ambulancia, bomberos, patrulla/furgón) o refuerzo vehicular
    // porque el personal a pie en recinto está saturado o no existe.
    const needsVehicleDispatch =
      isEmergencyVehicleKind(activeMode) ||
      (activeMode === 'firstaid' && !hasFreeFoot('medical') && row.severity !== 'leve') ||
      (activeMode === 'security' && !hasFreeFoot('security') && (row.type === 'conflict' || row.severity === 'grave'));

    if (needsVehicleDispatch && this.fleet) {
      const fleetMode = isEmergencyVehicleKind(activeMode)
        ? activeMode
        : activeMode === 'firstaid'
          ? 'ambulance'
          : 'patrol';
      const mission = this.fleet.dispatchForIncident(row, fleetMode, {
        needsEvacuation: fleetMode === 'ambulance' && row.severity !== 'leve',
        preferHighCrew: row.type === 'conflict' && row.severity === 'grave',
      });
      if (mission) {
        return;
      }
    }

    const p = RESPONSE_PROFILES[row.responseMode || 'firstaid'] || RESPONSE_PROFILES.firstaid;
    const kind =
      row.responseMode === 'yellow_tent'
        ? 'yellow_tent'
        : row.responseMode === 'violet_point'
          ? 'violet_point'
          : row.responseMode === 'ambulance'
            ? 'ambulance'
            : row.responseMode === 'fire'
              ? 'fire'
              : row.responseMode === 'security'
                ? 'security'
                : row.responseMode === 'patrol'
                  ? 'patrol'
                  : row.responseMode === 'police_van'
                    ? 'police_van'
                    : 'medical';
    const candidates = this.resources().filter(
      (r) =>
        r.active !== false &&
        r.kind === kind &&
        (r.staff || 0) >= p.staff &&
        this.events.filter(
          (q) =>
            q !== row &&
            q.resourceId === r.id &&
            ['assigned', 'assisting', 'waiting_transport'].includes(q.status)
        ).length <
          Math.min(
            Math.max(0, r.capacity || 0),
            Math.floor((r.staff || 0) / p.staff),
            ['ambulance', 'fire', 'patrol'].includes(kind) ? 1 : Infinity
          )
    );
    if (!candidates.length && (kind === 'yellow_tent' || kind === 'violet_point')) {
      const hasPhysical = this.resources().some(
        (r) => r.kind === kind && r.active !== false && (r.staff || 0) >= p.staff
      );
      row.status = 'waiting';
      row.note = hasPhysical
        ? kind === 'yellow_tent'
          ? 'Carpa Amarilla sin auxiliares disponibles en este momento; solicitud en espera.'
          : 'Punto Violeta ocupado atendiendo otra solicitud; en espera.'
        : kind === 'yellow_tent'
          ? 'No hay ninguna Carpa Amarilla colocada en el plano para atender la solicitud.'
          : 'No hay ningún Punto Violeta colocado en el plano para prestar atención reservada.';
      return;
    }
    if (!candidates.length) {
      const rc = resolveResponseConditions(e.s.responseConditions);
      const externalTravelSec =
        kind === 'fire'
          ? rc.fireExternalSec
          : kind === 'security' || kind === 'patrol'
            ? rc.policeExternalSec
            : rc.medicalExternalSec;
      const totalExternalSec = rc.detectionSec + externalTravelSec;

      let reserve = this.resources().find(
        (r) =>
          r.reserve === true &&
          r.active === false &&
          r.kind === kind &&
          (r.staff || 0) >= p.staff
      );

      // Siempre debe existir un refuerzo externo disponible desde el spawn más cercano
      const spawns = (e.s.entrances || []).filter(
        (g: {role?: string; phases?: {event?: string}}) =>
          (g.phases?.event || g.role || 'both') !== 'closed'
      );
      const bestSpawn =
        spawns
          .slice()
          .sort(
            (
              a: {
                x: number;
                y: number;
                spawnType?: string;
                externalBase?: boolean;
                vehicleCategory?: string;
              },
              b: {
                x: number;
                y: number;
                spawnType?: string;
                externalBase?: boolean;
                vehicleCategory?: string;
              }
            ) => {
              const baseBonusA =
                a.externalBase &&
                (!a.vehicleCategory ||
                  a.vehicleCategory === 'all' ||
                  a.vehicleCategory === 'emergency')
                  ? -60
                  : 0;
              const baseBonusB =
                b.externalBase &&
                (!b.vehicleCategory ||
                  b.vehicleCategory === 'all' ||
                  b.vehicleCategory === 'emergency')
                  ? -60
                  : 0;
              const vehA =
                a.spawnType === 'vehicle' || a.spawnType === 'mixed' ? -25 : 0;
              const vehB =
                b.spawnType === 'vehicle' || b.spawnType === 'mixed' ? -25 : 0;
              return (
                dist(
                  [(a.x * e.g.m.widthMeters) / 100, (a.y * e.g.m.heightMeters) / 100],
                  row.point!
                ) +
                baseBonusA +
                vehA -
                (dist(
                  [(b.x * e.g.m.widthMeters) / 100, (b.y * e.g.m.heightMeters) / 100],
                  row.point!
                ) +
                  baseBonusB +
                  vehB)
              );
            }
          )[0] || null;

      // No inventar camiones de bomberos externos inexistentes si el diseño no los ha configurado
      if (kind === 'fire' && !reserve) {
        this.evaluateFireForceCapacity(row);
        return;
      }

      if (!reserve && bestSpawn) {
        const externalId = `ext-${kind}-${Math.round(e.time)}-${this.resources().length + 1}`;
        const labelMap: Record<string, string> = {
          fire: 'Refuerzo Bomberos Tenerife',
          patrol: 'Refuerzo Patrulla Policial',
          security: 'Refuerzo Policía a pie',
          ambulance: 'Refuerzo Ambulancia SUC',
          medical: 'Refuerzo Sanitario SUC',
        };
        reserve = {
          id: externalId,
          name: labelMap[kind] || `Refuerzo externo (${kind})`,
          kind,
          role: 'emergency',
          x: bestSpawn.x,
          y: bestSpawn.y,
          width: p.width,
          depth: p.length,
          area: p.width * p.length,
          capacity: 1,
          staff: Math.max(2, p.staff),
          delay: 0,
          handling: kind === 'fire' ? 360 : kind === 'medical' ? 180 : 120,
          reserve: true,
          active: false,
          phaseTags: ['event'],
        };
        e.s.infrastructure.push(reserve);
      }

      if (reserve && !this.incoming.has(reserve.id)) {
        this.incoming.set(reserve.id, e.time + totalExternalSec);
      }

      const etaMin = Math.floor(totalExternalSec / 60);
      const etaRem = totalExternalSec % 60;
      const etaLabel =
        etaMin > 0
          ? `${etaMin} min${etaRem ? ` ${etaRem} s` : ''}`
          : `${etaRem} s`;
      const hasOnSite = this.resources().some(
        (r) =>
          r.kind === kind &&
          r.active !== false &&
          !r.reserve &&
          (r.staff || 0) >= p.staff
      );

      row.status = 'waiting';
      row.reinforcements ??= {
        requestedAt: e.time,
        status: reserve
          ? `Refuerzo externo movilizado desde ${bestSpawn?.name || 'acceso'} (llegada ≈ ${etaLabel})`
          : 'Solicitud simulada · falta acceso abierto para refuerzo',
      };
      row.note =
        (hasOnSite
          ? `Servicio en recinto sobrepasado (todos los equipos de ${kind} ocupados). `
          : `Sin dotación fija de ${kind} en recinto. `) +
        (reserve
          ? `Refuerzo externo desde central en camino por ${bestSpawn?.name || 'spawn'} (detección ${rc.detectionSec} s + traslado ≈ ${etaLabel}).`
          : 'Abre al menos un acceso para permitir la entrada de refuerzos externos.');
      return;
    }
    const resource = candidates.sort(
      (a, b) =>
        dist(
          [
            (a.x * e.g.m.widthMeters) / 100,
            (a.y * e.g.m.heightMeters) / 100,
          ],
          row.point!
        ) -
        dist(
          [
            (b.x * e.g.m.widthMeters) / 100,
            (b.y * e.g.m.heightMeters) / 100,
          ],
          row.point!
        )
    )[0];
    const profile: ResponseProfile = {...p};
    const responseMode = row.responseMode || 'foot';
    if (['ambulance', 'fire', 'patrol'].includes(responseMode)) {
      profile.width = resource.width || p.width;
      profile.length = resource.depth || p.length;
    }
    const hasAuthorityConfig = e.s.entrances.some(
      (g: {recommendedAuthorities?: string[]}) =>
        Array.isArray(g.recommendedAuthorities)
    );
    const needsAuthorityCheck =
      ['ambulance', 'fire', 'patrol'].includes(responseMode) ||
      (hasAuthorityConfig && ['stretcher', 'foot'].includes(responseMode));
    let conditionalGateDelay = 0;
    let exteriorStagingOnly = false;
    if (needsAuthorityCheck) {
      const requiredWidth = ['ambulance', 'fire', 'patrol'].includes(
        responseMode
      )
        ? profile.width + 0.3
        : profile.width;
      const matchingGate = e.s.entrances.find((g: Record<string, unknown>) =>
        gateAllowsAuthority(g as never, responseMode, requiredWidth)
      );
      if (!matchingGate) {
        // Para ambulancias: si no hay puerta vehicular pero existen accesos peatonales/mixtos,
        // estacionar en punto exterior accesible y desplegar personal sanitario + camilla a pie.
        if (responseMode === 'ambulance') {
          exteriorStagingOnly = true;
        } else {
          row.status = 'blocked';
          row.note =
            'No hay un acceso autorizado para esta unidad con la anchura de ensayo declarada.';
          row.reinforcements ??= {
            requestedAt: e.time,
            status: 'Solicitud simulada · acceso autorizado pendiente',
          };
          return;
        }
      } else {
        conditionalGateDelay = gateVehicleDelaySec(matchingGate as never);
      }
    }
    if (row.reinforcements) {
      row.reinforcements.status = 'Equipo disponible y asignado en el ensayo';
    }
    row.resourceId = resource.id;
    row.resourceName = resource.name;
    row.profile = profile;
    const patrol = this.watch.patrols.find(
      (pt) => pt.resourceId === resource.id
    );
    const resOrigin: Point = patrol
      ? [patrol.x, patrol.y]
      : [
          (resource.x * e.g.m.widthMeters) / 100,
          (resource.y * e.g.m.heightMeters) / 100,
        ];
    row.origin = resOrigin;
    const dToPoint = dist(resOrigin, row.point!);
    // En Punto Violeta siempre sale personal desde el Punto Violeta hacia el lugar;
    // en Carpa Amarilla, si está muy cerca (<= 14 m) puede acercarse el visitante, si no sale el auxiliar.
    row.selfApproach = kind === 'yellow_tent' && dToPoint <= 14;
    if (kind === 'violet_point') {
      const secSupport = this.resources().find(
        (r) =>
          r.active !== false &&
          ['security', 'patrol', 'police_van'].includes(r.kind || '') &&
          (r.staff || 0) > 0
      );
      if (secSupport) {
        row.policeSupportId = secSupport.id;
        row.policeSupportName = secSupport.name;
        const secPos: Point = [
          (secSupport.x * e.g.m.widthMeters) / 100,
          (secSupport.y * e.g.m.heightMeters) / 100,
        ];
        const secRoute = responseRoute(
          e,
          secPos,
          row.selfApproach ? resOrigin : row.point!,
          RESPONSE_PROFILES.security,
          2.5
        );
        if (!secRoute.error && secRoute.path) {
          row.supportPath = secRoute.path;
          row.supportLength = secRoute.length;
          row.supportDistance = 0;
          row.supportPose = poseAt(secRoute.path, 0);
        }
      }
    }
    const routeFrom = row.selfApproach ? row.point! : row.origin;
    const routeTo = row.selfApproach ? row.origin : row.point!;
    let route = exteriorStagingOnly
      ? {error: 'Acceso vehicular directo no disponible; estacionamiento exterior y desembarco a pie.'}
      : responseRoute(
          e,
          routeFrom,
          routeTo,
          profile,
          profile.length / 2 + 1
        );
    // Si la huella del vehículo no cabe hasta el punto exacto interior (estrechamiento/giro/acceso peatonal),
    // aproximar el vehículo hasta el punto despejado más cercano y desplegar a los operarios/sanitarios a pie.
    if (route.error) {
      const vehGrid = e.vehicleManager?.vehGrid || buildVehicleGrid(e.s, e.g);
      const smartPlan = planVehicleRoute(
        e.s,
        vehGrid,
        row.origin,
        row.point!,
        {
          width: profile.width,
          length: profile.length,
          minTurnRadius: Math.max(3, profile.length * 0.8),
        },
        {
          allowFootDismount: true,
          pedestrianGrid: e.g,
        }
      );
      if (smartPlan.ok && smartPlan.path) {
        const combined = smartPlan.footPath
          ? [...smartPlan.path, ...smartPlan.footPath.slice(1)]
          : smartPlan.path;
        row.vehicleBlock = smartPlan.dismountPoint ? route.error : undefined;
        row.footDeployment = !!smartPlan.dismountPoint;
        row.dismountPoint = smartPlan.dismountPoint || row.origin;
        row.stagingUsed = !!smartPlan.dismountPoint || exteriorStagingOnly;
        if (smartPlan.dismountPoint) {
          Object.assign(profile, {
            width: Math.min(profile.width, 0.9),
            length: Math.min(profile.length, 1.8),
            speed: Math.max(1.2, Math.min(profile.speed, 2.2)),
          });
        }
        route = {
          path: combined,
          length: pathLength(combined),
        };
      } else {
        // 1. Evaluar ruta peatonal/camilla desde la posición de estacionamiento del vehículo
        const footOrigin = row.origin;
        const fenceFreeGrid =
          e.rebelGrid || buildGrid(e.s, e.g.cell, {ignoreFences: true});
        const fenceFreeEngine = {...e, g: fenceFreeGrid};
        const footFallback = responseRoute(
          fenceFreeEngine,
          footOrigin,
          row.point!,
          {...profile, width: 0.55, length: 0.7, speed: 1.45},
          1.2
        );
        if (!footFallback.error && footFallback.path) {
          row.vehicleBlock = route.error;
          row.footDeployment = true;
          row.dismountPoint = footOrigin;
          row.stagingUsed = true;
          Object.assign(profile, {width: 0.55, length: 0.7, speed: 1.45});
          route = footFallback;
          row.note =
            responseMode === 'ambulance'
              ? 'Ambulancia estacionada en punto accesible · equipo sanitario desplegado a pie con camilla hasta la víctima.'
              : row.type === 'fence_breach'
                ? 'Valla apartada temporalmente · escuadra desplegada a pie en fila india hasta el punto.'
                : 'Obstáculo en calzada · vehículo detenido y escuadra desplegada a pie en fila india.';
        } else {
          // 2. Último recurso operativo: fila india directa a pie para que un obstáculo fijo nunca bloquee el juego
          const directFoot: Point[] = [row.origin, row.point!];
          row.vehicleBlock = route.error;
          row.footDeployment = true;
          row.dismountPoint = row.origin;
          row.stagingUsed = true;
          Object.assign(profile, {width: 0.55, length: 0.7, speed: 1.35});
          route = {path: directFoot, length: pathLength(directFoot)};
          row.note =
            responseMode === 'ambulance'
              ? 'Ambulancia estacionada en exterior · equipo sanitario accediendo a pie.'
              : 'Acceso vehicular impedido por obstáculo fijo · atención a pie en fila india.';
        }
      }
    }
    if (route.error || !route.path) {
      row.status = 'blocked';
      row.note = route.error;
      row.reinforcements ??= {
        requestedAt: e.time,
        status: 'Solicitud simulada · aproximación bloqueada',
      };
      return;
    }
    const initialPose = poseAt(route.path, 0);
    const startBlockers = e.agents.filter(
      (a: Agent) =>
        a.state !== 'gone' &&
        inVehicle([a.x, a.y], initialPose, profile.width, profile.length, a.r)
    );
    const isOfficerIntervention =
      row.type === 'conflict' ||
      row.type === 'fence_breach' ||
      ['security', 'patrol'].includes(row.responseMode || '');
    if (startBlockers.length > 0) {
      if (isOfficerIntervention) {
        // El oficial desaloja inmediatamente gritando y silbando antes de intervenir
        for (const a of startBlockers as Agent[]) {
          const angle = Math.atan2(
            a.y - initialPose.y,
            a.x - initialPose.x
          );
          const pushDist = Math.max(profile.width, profile.length) / 2 + 1.8;
          const tx = initialPose.x + Math.cos(angle) * pushDist;
          const ty = initialPose.y + Math.sin(angle) * pushDist;
          const k = e.g.nearest(tx, ty, 5);
          if (k >= 0) {
            const [nx, ny] = e.g.point(k);
            a.x = nx;
            a.y = ny;
          }
          a.incidentReaction = {
            event: row.id,
            mode: 'disperse',
            ordered: true,
            reactAt: e.time,
            until: e.time + 30,
            destination: this.social.destination(a, row, 'avoid'),
          };
          this.social.stats.dispersed++;
        }
        row.whistleDispersal = true;
      } else {
        row.status = 'waiting';
        row.note =
          'La posición inicial del recurso está ocupada por asistentes.';
        return;
      }
    }
    row.path = route.path;
    row.pathLength = route.length;
    row.vehicleWidth = profile.width;
    row.vehicleLength = profile.length;
    row.vehiclePose = initialPose;
    row.vehicleDistance = 0;
    row.vehicle = true;
    row.assigned = e.time;
    row.alertDelay =
      Math.max(
        0,
        resource.delay ??
          (({fire: 90, security: 15, patrol: 30, medical: 30, ambulance: 60} as Record<
            string,
            number
          >)[resource.kind] ||
            60)
      ) + conditionalGateDelay;
    row.handling = Math.max(
      1,
      row.severity === 'leve'
        ? Math.min(resource.handling ?? 90, INCIDENTS[row.type]?.duration ?? 90)
        : resource.handling ?? INCIDENTS[row.type]?.duration ?? 240
    );
    row.yieldedIds = [];
    row.yieldBlockedIds = [];
    row.peopleDelay = 0;
    row.status = 'assigned';
    row.phase = 'approach';
    row.note = row.footDeployment
      ? (responseMode === 'ambulance'
          ? 'Ambulancia estacionada en punto accesible · personal sanitario desplegado a pie hasta la víctima.'
          : 'Dotación desplegada a pie desde el vehículo; aproximación vehicular limitada: ' +
            row.vehicleBlock)
      : row.whistleDispersal || row.type === 'conflict'
        ? 'Oficial desalojando paso con silbato y avisos de voz para intervenir.'
        : conditionalGateDelay > 0
          ? `Recurso asignado · acceso condicionado abierto bajo demanda (+${conditionalGateDelay} s).`
          : 'Recurso asignado. Recorrido geométrico de ensayo.';
  }

  move(row: EmergencyIncident, dt: number): boolean {
    const e = this.e;
    if (!row.profile || !row.path || !row.vehiclePose) return false;
    const vWidth = row.vehicleWidth || row.profile.width;
    const vLength = row.vehicleLength || row.profile.length;
    const pLength = row.pathLength || 0;
    let speed = row.profile.speed;

    if (row.profile.length >= 4) {
      const ahead = poseAt(
        row.path,
        Math.min(pLength, (row.vehicleDistance || 0) + 1.5)
      );
      const delta = ahead.angle - row.vehiclePose.angle;
      const turn = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
      const stoppingSpeed = Math.sqrt(
        1.2 * Math.max(0.01, pLength - (row.vehicleDistance || 0))
      );
      const cap = Math.min(speed, stoppingSpeed, speed / (1 + turn * 2));
      const old = row.speedNow || 0;
      row.speedNow = Math.max(old - 0.8 * dt, Math.min(cap, old + 0.45 * dt));
      speed = row.speedNow;
    }

    let left = dt * speed;
    while (left > 0) {
      const step = Math.min(0.15, left);
      const next = Math.min(pLength, (row.vehicleDistance || 0) + step);
      const pose = poseAt(row.path, next);
      if (!footprintClear(e, pose, vWidth, vLength)) {
        // Si es asistencia sanitaria/camilla y el sanitario a pie sí cabe, no cancelar como "sin respuesta disponible":
        // continuar la asistencia a pie y registrar si la camilla no pudo pasar en la fase de evacuación.
        const isMedical = ['firstaid', 'stretcher', 'ambulance'].includes(
          row.responseMode || ''
        );
        const isPointPed =
          row.responseMode === 'yellow_tent' || row.responseMode === 'violet_point';
        if (isMedical && footprintClear(e, pose, 0.55, 0.7)) {
          row.vehicleWidth = 0.55;
          row.vehicleLength = 0.7;
          row.footDeployment = true;
          if (row.phase === 'transfer' || row.responseMode === 'stretcher') {
            row.stretcherEvacuationBlocked = true;
            row.failedPhase = 'stretcher_evacuation';
            row.note =
              'Asistencia sanitaria prestada a pie; la camilla desplegada no cabe en este giro o estrechamiento.';
          }
        } else if (isPointPed && e.g.nearest(pose.x, pose.y, 1.5) >= 0) {
          // Peatón de Carpa Amarilla / Punto Violeta: bordea esquinas de lastres o mobiliario sin quedar bloqueado
        } else {
          row.status = 'blocked';
          row.note =
            'La huella queda bloqueada por un elemento fijo o por el giro.';
          return false;
        }
      }
      const blockers = e.agents.filter(
        (a: Agent) =>
          a.state !== 'gone' &&
          !((row.phase === 'transfer' || row.selfApproach) && a.id === row.agentId) &&
          inVehicle([a.x, a.y], pose, vWidth, vLength, a.r)
      );
      const other = this.events.find(
        (r) =>
          r !== row &&
          r.vehiclePose &&
          r.status !== 'resolved' &&
          Math.hypot(r.vehiclePose.x - pose.x, r.vehiclePose.y - pose.y) <
            Math.hypot(vLength, vWidth) / 2 +
              Math.hypot(r.vehicleLength || 2, r.vehicleWidth || 2) / 2
      );
      const isPointPedestrian =
        row.responseMode === 'yellow_tent' || row.responseMode === 'violet_point';
      if ((blockers.length && !isPointPedestrian) || other) {
        row.speedNow = 0;
        row.peopleDelay = (row.peopleDelay || 0) + dt;
        row.note = other
          ? 'Otro recurso ocupa el paso.'
          : 'Esperando espacio: el recurso no atraviesa a los asistentes.';
        return false;
      }
      row.distanceTravelled =
        (row.distanceTravelled || 0) + (next - (row.vehicleDistance || 0));
      row.vehiclePose = pose;
      row.vehicleDistance = next;
      left -= step;
      if (row.phase === 'transfer' || row.selfApproach) {
        const a = e.byId.get(row.agentId);
        if (a) {
          e.remove(a);
          a.x = pose.x;
          a.y = pose.y;
          a.state = row.selfApproach ? 'approaching_service' : 'transport';
          e.insert(a);
        }
      }
      if (next >= pLength - 0.01) return true;
    }
    if (row.supportPath && row.supportPose && (row.supportLength || 0) > 0) {
      const sLen = row.supportLength || 0;
      const sNext = Math.min(sLen, (row.supportDistance || 0) + dt * 1.15);
      row.supportDistance = sNext;
      row.supportPose = poseAt(row.supportPath, sNext);
    }
    return false;
  }

  startTransfer(row: EmergencyIncident): void {
    const e = this.e;
    if (
      row.responseMode === 'firstaid' ||
      row.responseMode === 'security' ||
      row.responseMode === 'patrol' ||
      row.responseMode === 'fire' ||
      ((row.responseMode === 'yellow_tent' || row.responseMode === 'violet_point') &&
        row.selfApproach)
    ) {
      this.resolve(row);
      return;
    }
    let target = row.dismountPoint || row.origin || row.point;
    if (row.responseMode === 'stretcher') {
      const ambulance = this.resources()
        .filter(
          (r) =>
            r.kind === 'ambulance' &&
            r.active !== false &&
            (r.staff || 0) >= 2 &&
            !this.events.some(
              (q) =>
                q !== row &&
                (q.transportId === r.id || q.resourceId === r.id) &&
                q.status !== 'resolved'
            )
        )
        .sort(
          (a, b) =>
            dist(
              [
                (a.x * e.g.m.widthMeters) / 100,
                (a.y * e.g.m.heightMeters) / 100,
              ],
              row.point
            ) -
            dist(
              [
                (b.x * e.g.m.widthMeters) / 100,
                (b.y * e.g.m.heightMeters) / 100,
              ],
              row.point
            )
        )[0];
      if (!ambulance) {
        row.status = 'waiting_transport';
        row.note =
          'Atención completada; falta una ambulancia disponible para la entrega.';
        return;
      }
      row.transportId = ambulance.id;
      row.transportName = ambulance.name;
      target = [
        (ambulance.x * e.g.m.widthMeters) / 100,
        (ambulance.y * e.g.m.heightMeters) / 100,
      ];
    }
    const origin: Point = row.vehiclePose
      ? [row.vehiclePose.x, row.vehiclePose.y]
      : row.point;
    const profile =
      row.footDeployment && row.responseMode === 'ambulance'
        ? RESPONSE_PROFILES.stretcher
        : row.profile || RESPONSE_PROFILES[row.responseMode || 'firstaid'];
    let route = responseRoute(
      e,
      origin,
      target,
      profile,
      profile.length / 2 + 1
    );
    if (route.error || !route.path) {
      // Si la camilla completa no cabe en un estrechamiento, intentar traslado asistido a pie hasta la ambulancia estacionada
      const assistedProfile: ResponseProfile = {
        name: 'Evacuación asistida a pie',
        width: 0.75,
        length: 1.4,
        speed: 0.85,
        staff: 2,
      };
      const fallbackRoute = responseRoute(e, origin, target, assistedProfile, 1.5);
      if (!fallbackRoute.error && fallbackRoute.path) {
        route = fallbackRoute;
      } else {
        route = {path: [origin, target], length: dist(origin, target)};
      }
    }
    row.evacuationPath = route.path;
    row.path = route.path;
    row.pathLength = route.length;
    row.vehicleDistance = 0;
    row.vehiclePose = poseAt(row.path, 0);
    row.assigned = e.time;
    row.alertDelay = 0;
    row.phase = 'transfer';
    row.status = 'assigned';
    row.note =
      row.responseMode === 'stretcher' || row.footDeployment
        ? 'Evacuación del paciente en camilla hasta la ambulancia estacionada en punto accesible.'
        : 'Regreso de la ambulancia (marcha atrás / salida) al punto de transferencia del recinto.';
    const a = e.byId.get(row.agentId);
    if (a) {
      e.remove(a);
      a.x = origin[0];
      a.y = origin[1];
      a.state = 'transport';
      e.insert(a);
    }
  }

  resolve(row: EmergencyIncident): void {
    if (row.type === 'fire') this.fire.extinguish(row);
    const patrol = this.watch.patrols.find(
      (p) => p.resourceId === row.resourceId
    );
    if (patrol && row.vehiclePose) {
      this.e.remove(patrol);
      patrol.x = row.vehiclePose.x;
      patrol.y = row.vehiclePose.y;
      patrol.target = null;
    }
    row.status = 'resolved';
    row.phase =
      row.responseMode === 'stretcher' || row.responseMode === 'ambulance'
        ? 'handover'
        : 'completed';
    row.closed = this.e.time;
    const a = this.e.byId.get(row.agentId);
    if (a) {
      if (row.phase === 'handover') {
        this.e.depart(a);
        // Si un equipo de camilla entregó el paciente a una ambulancia estacionada, movilizar la ambulancia para evacuarlo
        if (row.transportId) {
          this.fleet?.triggerPatientEvacuation(row.transportId);
        }
      } else {
        this.e.assign(a);
      }
    }
    syncIncidentHistory(this.e);
  }

  override update(dt: number): void {
    const e = this.e;
    this.evaluateScheduledIncidents();

    const genMode = resolveIncidentGenerationMode(e.s);
    const allowAuto =
      (genMode === 'auto' || genMode === 'mixed') && e.s.autoIncidents !== false;
    if (allowAuto && e.time < e.duration) {
      const rate = Math.max(0, Math.min(1000, e.s.riskInputs?.autoRate ?? 120));
      const chance = -Math.expm1(
        (-rate *
          e.agents.filter((a: Agent) => a.state !== 'gone').length *
          dt) /
          1000 /
          3600
      );
      if (this.random() < chance) {
        const type = chooseIncident(this.random);
        if (
          type !== 'fire' ||
          !this.events.some((r) => r.type === 'fire' && r.status !== 'resolved')
        ) {
          const inj = this.inject(type);
          if (!inj) {
            this.autoSkipped++;
          } else {
            inj.originMode = 'auto';
          }
        }
      }
    }

    for (const [id, time] of this.incoming) {
      if (e.time >= time) {
        const resource = this.resources().find((r) => r.id === id);
        if (resource) resource.active = true;
        this.incoming.delete(id);
      }
    }
    this.fire.update(dt, this.events);
    this.social.update();
    this.watch.update(dt, this.events);
    this.fleet?.update(dt, this.events);

    for (const row of this.events) {
      if (row.fleetMission) continue;
      if (
        row.type === 'fire' &&
        row.reportedAt != null &&
        row.status !== 'resolved' &&
        row.status !== 'owner'
      ) {
        this.evacuation.order(row);
        if (!row.reinforcements) {
          row.reinforcements = {
            requestedAt: e.time,
            status: 'Solicitud simulada pendiente de confirmación externa',
          };
        }
      }
      if (
        row.type === 'fire' &&
        row.reportedAt != null &&
        !row.localAttempt &&
        row.status !== 'resolved'
      ) {
        row.localAttempt = true;
        if (this.fire.tryWorker(row)) {
          row.afterLocalStatus = 'pending';
        } else {
          row.note =
            (row.note || '') +
            ' Sin primera intervención: comprueba formación, extintor disponible y ruta.';
        }
      }
      if (row.status === 'local') {
        this.fire.localStep(row, dt);
        // Mientras se intenta la primera intervención con extintor, movilizar en paralelo el camión de bomberos
        if (row.type === 'fire' && this.fleet && !this.fleet.missions.has(row.id)) {
          this.fleet.dispatchForIncident(row, 'fire');
        }
        continue;
      }
      if (row.status === 'blocked' && e.time >= (row.retryAt || 0)) {
        row.status = 'pending';
        row.retryAt = e.time + 30;
      }
      if (['pending', 'waiting'].includes(row.status)) {
        if ((row.retryAt || 0) > e.time) continue;
        row.retryAt = e.time + 5;
        this.assignResource(row);
      }
      if (
        row.status === 'assigned' &&
        e.time >= (row.assigned || 0) + (row.alertDelay || 0) &&
        this.move(row, dt)
      ) {
        if (row.phase === 'transfer') {
          this.resolve(row);
        } else {
          row.status = 'assisting';
          row.arrived = e.time;
          row.phase = 'care';
          row.note =
            row.type === 'fire'
              ? 'Dotación desplegada: contención y extinción durante el tiempo configurado.'
              : row.type === 'fence_breach'
                ? 'Seguridad controla el intento de salto de valla y reconduce al asistente.'
                : row.type === 'conflict'
                  ? 'Separación de asistentes y control de la incidencia durante el tiempo configurado.'
                  : 'Atención sanitaria durante el tiempo configurado.';
        }
      }
      if (
        row.status === 'assisting' &&
        e.time >= (row.arrived || 0) + (row.handling || 0)
      ) {
        this.startTransfer(row);
      }
      if (
        row.status === 'waiting_transport' &&
        e.time >= (row.retryTransfer || 0)
      ) {
        row.retryTransfer = e.time + 10;
        this.startTransfer(row);
      }
    }
    syncIncidentHistory(e);
  }
}

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

export interface ResponseSvgOptions {
  highlightIncidentId?: string | number | null;
  viewMode?: 'focus' | 'context';
  privacyMode?: 'public' | 'authorized_synthetic';
}

/**
 * Generates an SVG markup string for active response teams, vehicles, sirens, fire, evacuation zones, and patrols.
 *
 * @param engine - EventEngine instance.
 * @param opts - Optional highlight, focus/context mode, and privacy settings for incident playback.
 * @returns SVG markup string.
 */
export function responseSVG(engine: any, opts?: ResponseSvgOptions): string {
  const fireSvg = engine.emergency.fire?.svg() || '';
  const evacSvg = engine.emergency.evacuation?.svg() || '';
  const watchSvg = engine.emergency.watch?.svg(engine.emergency.events) || '';
  const fleetSvg = engine.emergency.fleet?.svg() || '';
  const highlightId = opts?.highlightIncidentId ?? null;
  const isFocus = opts?.viewMode === 'focus' && highlightId != null;
  const privacyMode = opts?.privacyMode || 'public';

  const eventsSvg = (engine.emergency.events as EmergencyIncident[])
    .filter((row) => {
      if (highlightId != null && String(row.id) === String(highlightId)) {
        return true;
      }
      return row.status !== 'resolved' && row.status !== 'unreported';
    })
    .map((row) => {
      const cat = row.category || categoryForIncidentType(row.type);
      const meta = INCIDENT_CATEGORIES[cat];
      const code = row.code || formatIncidentCode(cat, Number(row.id) || 1);
      const isSelected = highlightId != null && String(row.id) === String(highlightId);
      const opacity = isFocus && !isSelected ? '.26' : '1';
      const isRedactedViolet = cat === 'violet_point' && privacyMode === 'public';

      if (isRedactedViolet) {
        const [vx, vy] = row.point || [40, 40];
        let vHtml = `<g data-investigate-incident="${esc(row.id)}" class="incident-map-marker" opacity="${opacity}" style="cursor:pointer"><title>${esc(
          `${code} · Punto Violeta (atención reservada · doble clic para analizar)`
        )}</title>`;
        if (isSelected) {
          vHtml += `<circle cx="${vx}" cy="${vy}" r="4.6" fill="none" stroke="${meta.color}" stroke-width=".4" stroke-dasharray="1.2 .7"/>`;
        }
        vHtml += `<circle cx="${vx}" cy="${vy}" r="2.3" fill="${
          row.status === 'resolved' ? '#64748b' : meta.color
        }" fill-opacity="${row.status === 'resolved' ? '.25' : '.34'}" stroke="${meta.color}" stroke-width=".32"/><text x="${vx}" y="${
          vy - 2.9
        }" text-anchor="middle" font-size="1.25" font-weight="700" fill="${meta.color}">${esc(
          code
        )}</text><text x="${vx}" y="${vy + 0.65}" text-anchor="middle" font-size="1.9" font-weight="700" fill="#1e293b">${
          row.status === 'resolved' ? '✓' : '!'
        }</text></g>`;
        if (row.path && row.status !== 'resolved') {
          vHtml += `<polyline points="${row.path
            .map((pt) => pt.join(','))
            .join(' ')}" fill="none" stroke="${meta.color}" stroke-opacity="${opacity}" stroke-width=".45" stroke-dasharray="1.5 1"/>`;
        }
        if (row.vehiclePose && row.status !== 'resolved') {
          const vp2 = row.vehiclePose;
          vHtml += `<g opacity="${opacity}" transform="translate(${vp2.x} ${vp2.y})"><ellipse cy=".15" rx=".48" ry=".28" fill="#294652"/><circle cy="-.25" r=".46" fill="${meta.color}" stroke="#ffffff" stroke-width=".16"/>${
            row.phase === 'transfer'
              ? '<circle cx=".65" cy="-.25" r=".42" fill="#f8fafc" stroke="#475569" stroke-width=".15"/>'
              : ''
          }</g><g opacity="${opacity}" transform="translate(${vp2.x} ${vp2.y - 2.3})"><rect x="-2.4" y="-1.4" width="4.8" height="1.9" rx=".5" fill="#192e38"/><text text-anchor="middle" font-size="1.35" fill="white">VIO</text></g>`;
        }
        if (row.supportPath && row.status !== 'resolved') {
          vHtml += `<polyline points="${row.supportPath
            .map((pt: number[]) => pt.join(','))
            .join(' ')}" fill="none" stroke="#263e64" stroke-opacity=".65" stroke-width=".3" stroke-dasharray="1 1"/>`;
        }
        if (row.supportPose && row.status !== 'resolved') {
          const sp = row.supportPose;
          vHtml += `<g opacity="${opacity}" transform="translate(${sp.x} ${sp.y})"><circle r=".48" fill="#263e64" stroke="#fff" stroke-width=".15"/><text y="-1.1" text-anchor="middle" font-size="1.25" font-weight="700" fill="#263e64">POL</text></g>`;
        }
        return vHtml;
      }

      const [x, y] = row.point || [0, 0];
      let html = `<g data-investigate-incident="${esc(row.id)}" class="incident-map-marker" opacity="${opacity}" style="cursor:pointer"><title>${esc(
        `${code} · ${row.name || meta.label} (doble clic para investigar)`
      )}</title>`;
      if (isSelected) {
        html += `<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke="${meta.color}" stroke-width=".4" stroke-dasharray="1.2 .7"/><circle cx="${x}" cy="${y}" r="6.8" fill="none" stroke="${meta.color}" stroke-opacity=".45" stroke-width=".25"/>`;
      }
      html += `<circle cx="${x}" cy="${y}" r="2.3" fill="${
        row.status === 'resolved' ? '#64748b' : meta.color
      }" fill-opacity="${row.status === 'resolved' ? '.25' : '.36'}" stroke="${meta.color}" stroke-width=".32"/><text x="${x}" y="${
        y - 2.9
      }" text-anchor="middle" font-size="1.25" font-weight="700" fill="${meta.color}">${esc(
        code
      )}</text><text x="${x}" y="${y + 0.65}" text-anchor="middle" font-size="1.9" font-weight="700" fill="#1e293b">${
        row.status === 'resolved' ? '✓' : '!'
      }</text></g>`;
      if (row.fleetMission) {
        return html;
      }
      const p = row.vehiclePose;
      const walking =
        row.footDeployment ||
        ['firstaid', 'security', 'yellow_tent', 'violet_point'].includes(
          row.responseMode || ''
        );
      const stretcher = row.responseMode === 'stretcher';
      const vLen = row.vehicleLength || 2;
      const vWid = row.vehicleWidth || 2;
      if (row.path && row.status !== 'resolved') {
        html += `<polyline points="${row.path
          .map((pt) => pt.join(','))
          .join(' ')}" fill="none" stroke="${
          row.phase === 'transfer' ? '#a47eaf' : meta.color
        }" stroke-opacity="${opacity}" stroke-width=".45" stroke-dasharray="1.5 1"/>`;
      }
      if (p && row.status !== 'resolved') {
        html += `<g opacity="${opacity}" transform="translate(${p.x} ${p.y}) rotate(${
          (p.angle * 180) / Math.PI
        })"><title>${esc(
          (row.resourceName || '') + ' · ' + (row.note || '')
        )}</title>`;
        if (walking) {
          html += `<ellipse cy=".15" rx=".48" ry=".28" fill="#294652"/><circle cy="-.25" r=".44" fill="${
            row.responseMode === 'security' ? '#263e64' : '#e9eff0'
          }" stroke="#3c6570" stroke-width=".15"/><path d="M-.22 0H.22M0-.22V.22" stroke="${meta.color}" stroke-width=".12"/>`;
        } else if (stretcher) {
          html += `<rect x="-1.1" y="-.35" width="2.2" height=".7" rx=".15" fill="#f2e8b9" stroke="#876e35" stroke-width=".15"/><circle cx="-1.5" r=".3" fill="#558c92"/><circle cx="1.5" r=".3" fill="#558c92"/>${
            row.phase === 'transfer'
              ? '<ellipse rx=".7" ry=".2" fill="#bf8b66"/>'
              : ''
          }`;
        } else {
          html += `<rect x="${-vLen / 2}" y="${
            -vWid / 2
          }" width="${vLen}" height="${vWid}" rx=".4" fill="${
            row.responseMode === 'fire' ? '#bc6553' : '#eff2e8'
          }" stroke="#486d79" stroke-width=".2"/><rect x="${
            vLen / 2 - 1
          }" y="${-vWid / 2 + 0.2}" width=".6" height="${
            vWid - 0.4
          }" fill="#77a5ae"/><path d="M-.6 0H.6M0-.6V.6" stroke="#bd6951" stroke-width=".4"/>`;
        }
        const police = ['security', 'patrol'].includes(row.responseMode || '');
        const fire = row.responseMode === 'fire';
        const isAcc = row.responseMode === 'yellow_tent';
        const isVio = row.responseMode === 'violet_point';
        const lights = police
          ? ['#ea2948', '#2476ff']
          : fire
            ? ['#ed3434', '#ff9823']
            : isAcc
              ? ['#E69A26', '#fef3c7']
              : isVio
                ? ['#9755C2', '#e9d5ff']
                : ['#20bc70', '#df2940'];
        const tag = police
          ? 'POL'
          : fire
            ? 'BOM'
            : isAcc
              ? 'ACC'
              : isVio
                ? 'VIO'
                : 'SAN';
        html += `<circle cx="-.4" cy="0" r=".38" fill="${lights[0]}"/><circle cx=".4" cy="0" r=".38" fill="${lights[1]}"/>`;
        html += `<rect x="${-vLen / 2}" y="${
          -vWid / 2
        }" width="${vLen}" height="${vWid}" fill="none" stroke="#43889b" stroke-dasharray=".4 .3" stroke-width=".12"/></g><g opacity="${opacity}" transform="translate(${
          p.x
        } ${p.y - 2.6})"><rect x="-2.5" y="-1.5" width="5" height="2" rx=".5" fill="#192e38"/><text text-anchor="middle" font-size="1.45" fill="white">${tag}</text><circle cx="-2.8" cy="-.4" r=".5" fill="${
          lights[0]
        }" opacity="${
          Math.floor(performance.now() / 650) % 2 ? 0.3 : 1
        }"/><circle cx="2.8" cy="-.4" r=".5" fill="${lights[1]}" opacity="${
          Math.floor(performance.now() / 650) % 2 ? 1 : 0.3
        }"/></g>`;
      }
      return html;
    })
    .join('');
  return fireSvg + evacSvg + watchSvg + fleetSvg + eventsSvg;
}
