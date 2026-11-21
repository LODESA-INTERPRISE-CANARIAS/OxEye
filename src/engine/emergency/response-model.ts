import type {
  Agent,
  EmergencyIncident,
  Infrastructure,
  Point,
  ResponseProfile,
  VehiclePose,
} from '../../types';
import {flow} from '../crowd/grid-flow';
import {gateAllowsAuthority} from './priority';
import {EmergencyLab, INCIDENTS} from './emergency-lab';
import {Evacuation} from './evacuation';
import {FireModel} from './fire-model';
import {IncidentCrowd} from './incident-crowd';
import {vehiclePath} from './motion';
import {inVehicle, poseAt} from './priority';
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
      (r) => r.kind === kind && r.active !== false
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
  patrol: {name: 'Coche policial', width: 1.9, length: 4.6, speed: 1.8, staff: 1},
  firstaid: {
    name: 'Atención en el lugar',
    width: 0.9,
    length: 0.9,
    speed: 1.1,
    staff: 1,
  },
  stretcher: {
    name: 'Camilla + equipo',
    width: 1.1,
    length: 3.6,
    speed: 0.7,
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
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const u = -l / 2 + (i * l) / nx;
      const v = -w / 2 + (j * w) / ny;
      const x = pose.x + Math.cos(pose.angle) * u - Math.sin(pose.angle) * v;
      const y = pose.y + Math.sin(pose.angle) * u + Math.cos(pose.angle) * v;
      const k = e.g.index(x, y);
      if (k < 0 || !e.g.free[k]) return false;
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
  const free = new Uint8Array(g.free.length);
  const r = profile.width / 2 + 0.15;
  for (let k = 0; k < g.free.length; k++) {
    if (!g.free[k]) continue;
    const p = g.point(k);
    let clear = true;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const j = g.index(p[0] + r * Math.cos(a), p[1] + r * Math.sin(a));
      if (j < 0 || !g.free[j]) {
        clear = false;
        break;
      }
    }
    if (clear) free[k] = 1;
  }

  const grid = {...g, free};
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
  let k = start;
  let p: Point[] | null = [origin, g.point(k)];
  for (let i = 0; i < free.length && k !== target; i++) {
    const n = g
      .neighbors(k)
      .filter((nIdx: number) => free[nIdx] && field[nIdx] >= 0 && field[nIdx] < field[k])
      .sort((a: number, b: number) => field[a] - field[b])[0];
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
    const p = RESPONSE_PROFILES[row.responseMode || 'firstaid'];
    const kind =
      row.responseMode === 'ambulance'
        ? 'ambulance'
        : row.responseMode === 'fire'
          ? 'fire'
          : row.responseMode === 'security'
            ? 'security'
            : row.responseMode === 'patrol'
              ? 'patrol'
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
      const reserve = this.resources().find(
        (r) =>
          r.reserve === true &&
          r.active === false &&
          r.kind === kind &&
          (r.staff || 0) >= p.staff
      );
      if (reserve && !this.incoming.has(reserve.id)) {
        this.incoming.set(
          reserve.id,
          e.time + Math.max(30, e.s.reinforcementDelay ?? 600)
        );
      }
      row.status = 'waiting';
      row.reinforcements ??= {
        requestedAt: e.time,
        status: reserve
          ? 'Refuerzo de reserva movilizado en el ensayo'
          : 'Solicitud simulada · falta dotación compatible',
      };
      row.note =
        (this.resources().some(
          (r) =>
            r.kind === kind && r.active !== false && (r.staff || 0) >= p.staff
        )
          ? 'Servicio sobrepasado: todos los equipos de ' +
            kind +
            ' están ocupados. '
          : 'Sin dotación operativa de ' + kind + '. ') +
        (reserve
          ? 'Refuerzo de reserva solicitado; aún no está disponible.'
          : 'No existe un refuerzo compatible configurado.');
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
    if (needsAuthorityCheck) {
      const requiredWidth = ['ambulance', 'fire', 'patrol'].includes(
        responseMode
      )
        ? profile.width + 0.3
        : profile.width;
      if (
        !e.s.entrances.some((g: Record<string, unknown>) =>
          gateAllowsAuthority(g as never, responseMode, requiredWidth)
        )
      ) {
        row.status = 'blocked';
        row.note =
          'No hay un acceso autorizado para esta unidad con la anchura de ensayo declarada.';
        row.reinforcements ??= {
          requestedAt: e.time,
          status: 'Solicitud simulada · acceso autorizado pendiente',
        };
        return;
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
    let route = responseRoute(
      e,
      row.origin,
      row.point!,
      profile,
      profile.length / 2 + 1
    );
    if (
      route.error &&
      row.responseMode === 'fire' &&
      e.s.fireFootAccess === true
    ) {
      row.vehicleBlock = route.error;
      Object.assign(profile, {width: 0.9, length: 1.8, speed: 0.85});
      route = responseRoute(e, row.origin, row.point!, profile, 2);
      row.footDeployment = !route.error;
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
    row.alertDelay = Math.max(
      0,
      resource.delay ??
        (({fire: 90, security: 15, patrol: 30, medical: 30, ambulance: 60} as Record<
          string,
          number
        >)[resource.kind] ||
          60)
    );
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
      ? 'Dotación de bomberos a pie desde el vehículo; aproximación del camión bloqueada: ' +
        row.vehicleBlock
      : row.whistleDispersal || row.type === 'conflict'
        ? 'Oficial desalojando paso con silbato y avisos de voz para intervenir.'
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
        row.status = 'blocked';
        row.note =
          'La huella queda bloqueada por un elemento fijo o por el giro.';
        return false;
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
    let target = row.origin || row.point;
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
      row.profile || RESPONSE_PROFILES[row.responseMode || 'firstaid'];
    const route = responseRoute(
      e,
      origin,
      target,
      profile,
      profile.length / 2 + 1
    );
    if (route.error || !route.path) {
      row.status = 'blocked';
      row.note = 'Traslado bloqueado: ' + route.error;
      return;
    }
    row.path = route.path;
    row.pathLength = route.length;
    row.vehicleDistance = 0;
    row.vehiclePose = poseAt(row.path, 0);
    row.assigned = e.time;
    row.alertDelay = 0;
    row.phase = 'transfer';
    row.status = 'assigned';
    row.note =
      row.responseMode === 'stretcher'
        ? 'Traslado en camilla al punto de entrega supuesto.'
        : 'Regreso de la ambulancia al punto de transferencia del recinto.';
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

    for (const row of this.events) {
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
  const eventsSvg = (engine.emergency.events as EmergencyIncident[])
    .filter((row) => row.status !== 'resolved' && row.status !== 'unreported')
    .map((row) => {
      const [x, y] = row.point!;
      const p = row.vehiclePose;
      const walking =
        row.footDeployment ||
        ['firstaid', 'security'].includes(row.responseMode || '');
      const stretcher = row.responseMode === 'stretcher';
      const vLen = row.vehicleLength || 2;
      const vWid = row.vehicleWidth || 2;
      let html = `<circle cx="${x}" cy="${y}" r="2.4" fill="${
        row.status === 'resolved' ? '#93b784' : '#d87956'
      }" fill-opacity=".45" stroke="#c16d48" stroke-width=".3"/><text x="${x}" y="${
        y + 0.7
      }" text-anchor="middle" font-size="2.2">${
        row.status === 'resolved' ? '✓' : '!'
      }</text>`;
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
  return fireSvg + evacSvg + watchSvg + eventsSvg;
}
