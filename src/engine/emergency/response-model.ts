import type {
  Agent,
  EmergencyIncident,
  Infrastructure,
  Point,
  ResponseConditions,
  ResponseProfile,
  VehiclePose,
} from '../../types';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serviceLoad(emergency: any): ServiceLoadRow[] {
  const active = (emergency.events as EmergencyIncident[]).filter(
    (q) => !['resolved', 'unreported'].includes(q.status)
  );
  return ['medical', 'security', 'fire', 'ambulance', 'patrol'].map((kind) => {
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
          : ['orientation', 'obstacle', 'conflict', 'fence_breach'].includes(
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
  });
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  let d = 1.5;
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

  override isClosed(id: string): boolean {
    return super.isClosed(id) || !!this.fire?.isClosed(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }

  override inject(
    type: string,
    sourceId: string | null = null
  ): EmergencyIncident | null {
    const row = super.inject(type, sourceId);
    if (row) {
      row.severity = ['minor', 'orientation', 'obstacle'].includes(type)
        ? 'leve'
        : type === 'fire'
          ? 'grave'
          : 'moderada';
      row.responseMode = [
        'fire',
        'conflict',
        'orientation',
        'obstacle',
        'fence_breach',
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
      row.severity = type === 'fence_breach' ? 'moderada' : 'leve';
      row.responseMode = ['conflict', 'orientation', 'obstacle', 'fence_breach'].includes(
        type
      )
        ? this.e.s.policeMode || 'security'
        : this.e.s.responseMode || 'firstaid';
      row.phase = 'alert';
      row.model = 'Hipótesis editable · no protocolo validado';
      row.afterReportStatus = row.status;
      row.status = 'unreported';
      row.reporters = [];
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
      row.responseMode === 'ambulance'
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
    row.origin = patrol
      ? [patrol.x, patrol.y]
      : [
          (resource.x * e.g.m.widthMeters) / 100,
          (resource.y * e.g.m.heightMeters) / 100,
        ];
    let route = exteriorStagingOnly
      ? {error: 'Acceso vehicular directo no disponible; estacionamiento exterior y desembarco a pie.'}
      : responseRoute(
          e,
          row.origin,
          row.point!,
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
          !(row.phase === 'transfer' && a.id === row.agentId) &&
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
      if (blockers.length || other) {
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
      if (row.phase === 'transfer') {
        const a = e.byId.get(row.agentId);
        if (a) {
          e.remove(a);
          a.x = pose.x;
          a.y = pose.y;
          a.state = 'transport';
          e.insert(a);
        }
      }
      if (next >= pLength - 0.01) return true;
    }
    return false;
  }

  startTransfer(row: EmergencyIncident): void {
    const e = this.e;
    if (
      row.responseMode === 'firstaid' ||
      row.responseMode === 'security' ||
      row.responseMode === 'patrol' ||
      row.responseMode === 'fire'
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
  }

  override update(dt: number): void {
    const e = this.e;
    if (e.s.autoIncidents && e.time < e.duration) {
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
          if (!this.inject(type)) this.autoSkipped++;
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

/**
 * Generates an SVG markup string for active response teams, vehicles, sirens, fire, evacuation zones, and patrols.
 *
 * @param engine - EventEngine instance.
 * @returns SVG markup string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function responseSVG(engine: any): string {
  const fireSvg = engine.emergency.fire?.svg() || '';
  const evacSvg = engine.emergency.evacuation?.svg() || '';
  const watchSvg = engine.emergency.watch?.svg(engine.emergency.events) || '';
  const fleetSvg = engine.emergency.fleet?.svg() || '';
  const eventsSvg = (engine.emergency.events as EmergencyIncident[])
    .filter((row) => row.status !== 'resolved' && row.status !== 'unreported')
    .map((row) => {
      const [x, y] = row.point!;
      let html = `<circle cx="${x}" cy="${y}" r="2.4" fill="${
        row.status === 'resolved' ? '#93b784' : '#d87956'
      }" fill-opacity=".45" stroke="#c16d48" stroke-width=".3"/><text x="${x}" y="${
        y + 0.7
      }" text-anchor="middle" font-size="2.2">${
        row.status === 'resolved' ? '✓' : '!'
      }</text>`;
      if (row.fleetMission) {
        return html;
      }
      const p = row.vehiclePose;
      const walking =
        row.footDeployment ||
        ['firstaid', 'security'].includes(row.responseMode || '');
      const stretcher = row.responseMode === 'stretcher';
      const vLen = row.vehicleLength || 2;
      const vWid = row.vehicleWidth || 2;
      if (row.path && row.status !== 'resolved') {
        html += `<polyline points="${row.path
          .map((pt) => pt.join(','))
          .join(' ')}" fill="none" stroke="${
          row.phase === 'transfer' ? '#a47eaf' : '#3b8aa4'
        }" stroke-width=".45" stroke-dasharray="1.5 1"/>`;
      }
      if (p && row.status !== 'resolved') {
        html += `<g transform="translate(${p.x} ${p.y}) rotate(${
          (p.angle * 180) / Math.PI
        })"><title>${esc(
          (row.resourceName || '') + ' · ' + (row.note || '')
        )}</title>`;
        if (walking) {
          html += `<ellipse cy=".15" rx=".48" ry=".28" fill="#294652"/><circle cy="-.25" r=".44" fill="${
            row.responseMode === 'security' ? '#263e64' : '#e9eff0'
          }" stroke="#3c6570" stroke-width=".15"/><path d="M-.22 0H.22M0-.22V.22" stroke="#c26d49" stroke-width=".12"/>`;
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
        const lights = police
          ? ['#ea2948', '#2476ff']
          : fire
            ? ['#ed3434', '#ff9823']
            : ['#20bc70', '#df2940'];
        const tag = police ? 'POL' : fire ? 'BOM' : 'SAN';
        html += `<circle cx="-.4" cy="0" r=".38" fill="${lights[0]}"/><circle cx=".4" cy="0" r=".38" fill="${lights[1]}"/>`;
        html += `<rect x="${-vLen / 2}" y="${
          -vWid / 2
        }" width="${vLen}" height="${vWid}" fill="none" stroke="#43889b" stroke-dasharray=".4 .3" stroke-width=".12"/></g><g transform="translate(${
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
