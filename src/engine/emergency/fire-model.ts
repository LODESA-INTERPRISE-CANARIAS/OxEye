/**
 * @module engine/emergency/fire-model
 * Motor de propagación física de incendios multifoco, geometría separada
 * (huella, combustión localizada y perímetro de seguridad), amenaza a servicios
 * y ciclo independiente de recuperación y vallado post-incendio.
 */
import type {EmergencyIncident, FireLifecycleStage, Point} from '../../types';
import {inside, rect} from '../cartography/geometry';
import {appendIncidentMilestone, normalizeSeverity} from './incident-center';

export interface CombustibilityProfile {
  combustible: boolean;
  combustibility: number;
  ignitionThreshold: number;
  growthRate: number;
  hasGas: boolean;
  materialLabel: string;
}

export interface FireNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  o: any;
  rowId: string | number;
  litAt: number;
  damage: number;
  burning: boolean;
  exposure: Map<string, number>;
  /** Centro del foco localizado dentro de la huella de la instalación. */
  ignitionPoint: [number, number];
  /** Intensidad térmica normalizada (0..1). */
  intensity: number;
  /** Etapa operativa del foco. */
  stage: FireLifecycleStage;
  /** Radio activo de combustión/llamas (m), menor al inicio que la huella o el perímetro. */
  combustionRadius: number;
  /** Perímetro de seguridad / precaución (m), mayor que la combustión; no enciende vecinos por sí solo. */
  safetyRadius: number;
  /** Velocidad relativa de crecimiento del foco. */
  growthRate: number;
  /** ID de la incidencia padre si este foco procede de propagación. */
  parentRowId?: string | number;
  /** IDs de objetos vecinos hacia los que ya se ha propagado este foco. */
  spreadToIds: string[];
  /** Celdas bloqueadas por la huella ardiente o restos del elemento. */
  blockedFootprintCells: number[];
  controlledAt?: number;
  extinguishedAt?: number;
}

export interface SensitiveServiceThreat {
  serviceId: string;
  serviceName: string;
  serviceKind: 'yellow_tent' | 'violet_point';
  threatenedByRowId: string | number;
  threatenedByCode: string;
  distanceMeters: number;
  occupantsPresent: number;
  action: 'monitoring' | 'evacuating' | 'relocation_needed';
  detectedAt: number;
}

export interface FireCordon {
  id: string;
  rowId: string | number;
  center: [number, number];
  radius: number;
  state:
    | 'hot_zone'
    | 'approaching'
    | 'installing'
    | 'fenced'
    | 'cleanup'
    | 'inspection'
    | 'reopened';
  startedAt: number;
  hotZoneDuration: number;
  approachStartedAt: number;
  installAt: number;
  installDuration: number;
  fencedAt?: number;
  cleanupAt?: number;
  inspectionAt?: number;
  blockedApplied: boolean;
  blockedCells?: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  crew: any[];
  targetCell: number;
  field: Int32Array | null;
}

const NON_COMBUSTIBLE_KINDS = new Set([
  'toilet',
  'hydrant',
  'extinguisher',
  'ballast',
  'fence',
  'firstaid',
  'coordination',
  'medical',
  'security',
  'ambulance',
  'fire',
  'patrol',
  'police_van',
  'steward',
  'entrance',
  'gate',
]);

/** Perfil físico de combustibilidad según tipo, material y atributos reales del elemento. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCombustibilityProfile(o: any): CombustibilityProfile {
  if (!o) {
    return {
      combustible: false,
      combustibility: 0,
      ignitionThreshold: Infinity,
      growthRate: 0,
      hasGas: false,
      materialLabel: 'Sin datos',
    };
  }
  const kind = String(o.kind || o.type || o.inventoryKind || '').toLowerCase();
  const role = String(o.role || '').toLowerCase();
  const name = String(o.name || '').toLowerCase();
  const material = String(o.material || '').toLowerCase();

  if (
    o.combustible === false ||
    NON_COMBUSTIBLE_KINDS.has(kind) ||
    ['stone', 'metal', 'water', 'concrete', 'steel', 'non_combustible'].includes(material) ||
    name.includes('aseo') ||
    name.includes('piedra') ||
    name.includes('agua') ||
    name.includes('hormigón')
  ) {
    return {
      combustible: false,
      combustibility: 0,
      ignitionThreshold: Infinity,
      growthRate: 0,
      hasGas: false,
      materialLabel: material || 'No combustible',
    };
  }

  const hasGas =
    o.hasGas === true ||
    ((kind === 'food' || name.includes('foodtruck') || name.includes('cocina')) &&
      o.hasGas !== false &&
      o.noGas !== true);

  if (kind === 'food' || name.includes('foodtruck') || name.includes('cocina')) {
    return {
      combustible: true,
      combustibility: hasGas ? 0.94 : 0.82,
      ignitionThreshold: hasGas ? 18 : 24,
      growthRate: hasGas ? 1.18 : 0.96,
      hasGas,
      materialLabel: hasGas ? 'Cocina / gas y grasas' : 'Cocina eléctrica',
    };
  }
  if (role === 'cover' || kind === 'cover' || name.includes('carpa')) {
    if (kind === 'yellow_tent' || kind === 'violet_point' || name.includes('carpa amarilla') || name.includes('punto violeta')) {
      return {
        combustible: true,
        combustibility: 0.45,
        ignitionThreshold: 62,
        growthRate: 0.72,
        hasGas: false,
        materialLabel: 'Servicio sensible (ignifugado / evaluación prioritaria)',
      };
    }
    return {
      combustible: true,
      combustibility: 0.88,
      ignitionThreshold: 21,
      growthRate: 1.12,
      hasGas: false,
      materialLabel: 'Lona y estructura de carpa',
    };
  }
  if (kind === 'yellow_tent' || kind === 'violet_point' || name.includes('punto violeta')) {
    return {
      combustible: true,
      combustibility: 0.45,
      ignitionThreshold: 62,
      growthRate: 0.72,
      hasGas: false,
      materialLabel: 'Servicio sensible (ignifugado / evaluación prioritaria)',
    };
  }
  if (kind === 'picnic' || kind === 'rest') {
    return {
      combustible: true,
      combustibility: 0.72,
      ignitionThreshold: 28,
      growthRate: 0.9,
      hasGas: false,
      materialLabel: 'Madera / mobiliario',
    };
  }
  if (kind === 'stage' || name.includes('escenario')) {
    return {
      combustible: true,
      combustibility: 0.65,
      ignitionThreshold: 34,
      growthRate: 0.88,
      hasGas: false,
      materialLabel: 'Tarima técnica y cableado',
    };
  }
  if (kind === 'power' || kind === 'generator' || role === 'logistics') {
    return {
      combustible: true,
      combustibility: 0.62,
      ignitionThreshold: 36,
      growthRate: 0.95,
      hasGas: false,
      materialLabel: 'Equipo eléctrico / logístico',
    };
  }
  // Comercio / taller / puesto por defecto
  return {
    combustible: true,
    combustibility: 0.76,
    ignitionThreshold: 26,
    growthRate: 0.98,
    hasGas: false,
    materialLabel: kind === 'workshop' ? 'Taller y materiales' : 'Puesto comercial y género',
  };
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / lenSq));
  const projX = a[0] + t * vx;
  const projY = a[1] + t * vy;
  return Math.hypot(p[0] - projX, p[1] - projY);
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function rectEdgeGap(polyA: Point[], polyB: Point[]): number {
  let minD = Infinity;
  for (const p of polyA) {
    if (inside(p, polyB)) return 0;
    for (let i = 0; i < polyB.length; i++) {
      minD = Math.min(minD, pointToSegmentDist(p, polyB[i], polyB[(i + 1) % polyB.length]));
    }
  }
  for (const q of polyB) {
    if (inside(q, polyA)) return 0;
    for (let i = 0; i < polyA.length; i++) {
      minD = Math.min(minD, pointToSegmentDist(q, polyA[i], polyA[(i + 1) % polyA.length]));
    }
  }
  return minD;
}

export class FireModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  nodes: Map<string, FireNode>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workers: any[];
  usedExtinguishers: Set<string>;
  cordons: FireCordon[];
  serviceThreats: SensitiveServiceThreat[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.nodes = new Map();
    this.workers = [];
    this.usedExtinguishers = new Set();
    this.cordons = [];
    this.serviceThreats = [];
  }

  /** Localiza cualquier objeto instalable del plano por su ID. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findObject(objectId: string | undefined): any {
    if (!objectId) return null;
    return (
      [
        ...(this.e.s.base?.booths || []),
        ...(this.e.s.infrastructure || []),
      ].find((o: {id: string}) => o.id === objectId) || null
    );
  }

  start(row: EmergencyIncident): void {
    const targetId = row.targetObjectId || row.stationId;
    const source = this.findObject(targetId);
    if (source) {
      this.ignite(source, row, {
        parentRowId: row.parentIncidentId,
        initialIntensity: row.hasGasInstallation ? 0.28 : undefined,
      });
    }
  }

  private blockFootprintCells(node: FireNode): void {
    const e = this.e;
    if (!e?.g?.free) return;
    const poly = rect(node.o, e.g.m);
    const [cx, cy] = node.ignitionPoint;
    const w = node.o.width || 3;
    const d = node.o.depth || 3;
    const blockR = Math.max(node.combustionRadius + 0.65, Math.max(w, d) * 0.5 + 0.85);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs, cx - blockR) - 0.15;
    const maxX = Math.max(...xs, cx + blockR) + 0.15;
    const minY = Math.min(...ys, cy - blockR) - 0.15;
    const maxY = Math.max(...ys, cy + blockR) + 0.15;
    const cell = e.g.cell || 0.75;
    const iMin = Math.max(0, Math.floor(minX / cell));
    const iMax = Math.min(e.g.w - 1, Math.ceil(maxX / cell));
    const jMin = Math.max(0, Math.floor(minY / cell));
    const jMax = Math.min(e.g.h - 1, Math.ceil(maxY / cell));
    const blocked: number[] = [];
    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        const k = j * e.g.w + i;
        const p = e.g.point(k);
        const inZone =
          inside(p, poly) || Math.hypot(p[0] - cx, p[1] - cy) <= blockR;
        if (inZone && e.g.free[k]) {
          e.g.free[k] = 0;
          blocked.push(k);
        }
      }
    }
    node.blockedFootprintCells = [...new Set([...node.blockedFootprintCells, ...blocked])];
    e.flow?.clear?.();
    // Desalojar visitantes de la huella y combustión incendiada para que ningún agente la cruce
    const pushR = Math.max(blockR + 0.8, 2.5);
    for (const a of e.agents || []) {
      if (a.state === 'gone') continue;
      if (inside([a.x, a.y], poly) || Math.hypot(a.x - cx, a.y - cy) <= blockR) {
        const dx = a.x - cx;
        const dy = a.y - cy;
        const d = Math.hypot(dx, dy);
        const ux = d > 0.05 ? dx / d : 1;
        const uy = d > 0.05 ? dy / d : 0;
        const safe = e.g.nearest(cx + ux * pushR, cy + uy * pushR, 10);
        if (safe >= 0) {
          const sp = e.g.point(safe);
          e.remove(a);
          a.x = sp[0];
          a.y = sp[1];
          e.insert(a);
        }
      }
    }
  }

  private canReleaseCell(cellIndex: number, ignoreCordonId?: string): boolean {
    const e = this.e;
    const p = e.g.point(cellIndex);
    for (const n of this.nodes.values()) {
      if (n.burning && n.blockedFootprintCells.includes(cellIndex)) return false;
      if (!n.burning && n.damage > 0) {
        const cordon = this.cordons.find((c) => c.rowId === n.rowId);
        if (cordon && cordon.id !== ignoreCordonId && cordon.state !== 'reopened') {
          if (n.blockedFootprintCells.includes(cellIndex)) return false;
        }
      }
    }
    for (const c of this.cordons) {
      if (c.id === ignoreCordonId || c.state === 'reopened') continue;
      if (Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) <= c.radius - 0.15) {
        return false;
      }
    }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ignite(
    o: any,
    row: EmergencyIncident,
    opts?: {parentRowId?: string | number; initialIntensity?: number; growthRate?: number}
  ): void {
    if (this.nodes.has(o.id)) return;
    const m = this.e.g.m;
    const cx = (o.x * m.widthMeters) / 100;
    const cy = (o.y * m.heightMeters) / 100;
    const w = o.width || 3;
    const d = o.depth || 3;
    const minDim = Math.max(1.2, Math.min(w, d));
    const prof = getCombustibilityProfile(o);
    const initialIntensity = Math.max(
      0.12,
      Math.min(
        0.55,
        opts?.initialIntensity ??
          (row.severity === 'critica' ? 0.22 : row.severity === 'grave' ? 0.19 : 0.15)
      )
    );
    // Foco localizado inicialmente dentro de la geometría del objeto
    const combustionRadius = Math.max(0.65, Math.min(1.45, minDim * (0.24 + initialIntensity * 0.35)));
    const safetyRadius = Math.max(4.5, Math.min(16, combustionRadius * 2.1 + 3.0));
    const offsetMag = Math.min(minDim * 0.18, 0.55);
    const node: FireNode = {
      o,
      rowId: row.id,
      litAt: this.e.time,
      damage: 0,
      burning: true,
      exposure: new Map(),
      ignitionPoint: [cx - offsetMag * 0.6, cy - offsetMag * 0.4],
      intensity: initialIntensity,
      stage: 'conato',
      combustionRadius,
      safetyRadius,
      growthRate: opts?.growthRate ?? prof.growthRate ?? 1.0,
      parentRowId: opts?.parentRowId,
      spreadToIds: [],
      blockedFootprintCells: [],
    };
    this.nodes.set(o.id, node);
    row.fireStage = 'conato';
    this.blockFootprintCells(node);

    const station = this.e.stations.find((b: {id: string}) => b.id === o.id);
    if (station) {
      const ids = [...station.queue, ...station.serving];
      station.queue = [];
      station.serving = [];
      for (const id of ids) {
        const a = this.e.byId.get(id);
        if (
          a &&
          !['incident', 'transport', 'evacuating'].includes(a.state || '')
        ) {
          a.failed++;
          a.left = Math.max(0, a.left - 1);
          this.e.assign(a);
        }
      }
    }
  }

  getSafetyRadius(row: EmergencyIncident): number {
    const primary = [...this.nodes.values()].find((n) => n.rowId === row.id);
    if (primary) return Number(primary.safetyRadius.toFixed(1));
    return Math.max(3, Math.min(50, this.e.s.incidentRadius ?? 8));
  }

  isClosed(id: string): boolean {
    const node = this.nodes.get(id);
    if (node) {
      const cordon = this.cordons.find((c) => c.rowId === node.rowId);
      if (cordon?.state === 'reopened' && node.damage < 1) return false;
      if (node.burning || node.damage > 0) return true;
    }
    const station = this.e.stations.find((b: {id: string}) => b.id === id);
    if (!station) return false;
    const p: [number, number] = [
      (station.x * this.e.g.m.widthMeters) / 100,
      (station.y * this.e.g.m.heightMeters) / 100,
    ];
    return [...this.nodes.values()].some(
      (n) =>
        (n.burning || n.damage > 0) &&
        n.o.role === 'cover' &&
        inside(p, rect(n.o, this.e.g.m))
    );
  }

  tryWorker(row: EmergencyIncident): boolean {
    const e = this.e;
    if (!e.s.trained) return false;
    const targetObjId = row.targetObjectId || row.stationId;
    const source = this.findObject(targetObjId);
    if (!source || !row.point) return false;
    const items = e.s.infrastructure.filter(
      (o: {id: string; kind: string; active?: boolean}) =>
        o.kind === 'extinguisher' &&
        o.active !== false &&
        !this.usedExtinguishers.has(o.id)
    );
    const pos = (o: {x: number; y: number}): [number, number] => [
      (o.x * e.g.m.widthMeters) / 100,
      (o.y * e.g.m.heightMeters) / 100,
    ];
    const target = row.point;
    items.sort(
      (a: {x: number; y: number}, b: {x: number; y: number}) =>
        Math.hypot(pos(a)[0] - target[0], pos(a)[1] - target[1]) -
        Math.hypot(pos(b)[0] - target[0], pos(b)[1] - target[1])
    );
    for (const item of items) {
      const point = pos(item);
      const start = e.g.nearest(point[0], point[1], 5);
      if (start < 0) continue;
      const goal = e.g.nearest(target[0] - 2, target[1] + 2, 5);
      if (goal < 0) continue;
      const field = e.getFlow(goal);
      if (field[start] < 0) continue;
      const p = e.g.point(start);
      row.extinguisherWorker = {
        id: 'ext-' + row.id,
        x: p[0],
        y: p[1],
        r: 0.3,
        speed: 0.9,
        target: goal,
        field,
        state: 'approach',
        walked: 0,
        started: e.time,
      };
      row.localTeam = 1;
      row.localAttempt = true;
      row.status = 'local';
      this.usedExtinguishers.add(item.id);
      row.note =
        'Persona formada recoge un extintor y se aproxima por una ruta peatonal.';
      return true;
    }
    return false;
  }

  localStep(row: EmergencyIncident, dt: number): void {
    const e = this.e;
    const w = row.extinguisherWorker;
    if (!w) return;
    if (w.state === 'approach' && e.time - w.started > 180) {
      e.remove(w);
      w.state = 'finished';
      row.localTeam = 0;
      row.status = 'pending';
      row.note =
        'El equipo con extintor no pudo alcanzar el foco en el tiempo de ensayo. Se mantiene la solicitud de bomberos.';
      return;
    }
    if (w.state === 'approach') {
      const before = [w.x, w.y];
      const arrived = e.move(w, w.field, w.target, dt, 0.6);
      w.walked += Math.hypot(w.x - before[0], w.y - before[1]);
      if (arrived) {
        w.state = 'extinguishing';
        w.at = e.time;
        row.note =
          'Primera intervención con extintor durante el tiempo de ensayo.';
      }
    }
    if (
      w.state === 'extinguishing' &&
      e.time - w.at >= (e.s.localExtinguishSeconds ?? 45)
    ) {
      w.state = 'finished';
      e.remove(w);
      row.localTeam = 0;
      if (
        e.emergency.random() <
        Math.max(0, Math.min(100, e.s.fireSuccess ?? 85)) / 100
      ) {
        row.fireOutcome = 'Extinguido por el equipo del puesto';
        e.emergency.resolve(row);
      } else {
        row.fireOutcome = 'Primera intervención insuficiente';
        row.status = 'pending';
        row.note =
          'El extintor no ha controlado el foco; se mantienen la solicitud de bomberos y el desalojo.';
      }
    }
  }

  /**
   * Extingue ÚNICAMENTE el foco asociado a `row`, preservando independientes
   * otros focos secundarios (`FUE-002`) y activando recuperación de zona caliente.
   */
  extinguish(row: EmergencyIncident): void {
    let hadNode = false;
    for (const n of this.nodes.values()) {
      if (n.rowId === row.id) {
        n.burning = false;
        n.stage = 'extinguido';
        n.extinguishedAt = this.e.time;
        n.intensity = Math.min(n.intensity, 0.15);
        hadNode = true;
      }
    }
    row.fireStage = 'extinguido';
    if (row.extinguisherWorker) this.e.remove(row.extinguisherWorker);
    row.localTeam = 0;
    if (hadNode || row.point) {
      this.scheduleCordon(row);
    }
  }

  /**
   * Inicia el protocolo post-extinción independiente por foco:
   * Zona caliente -> Aproximación montaje -> Vallado -> Limpieza -> Inspección -> Reapertura.
   */
  scheduleCordon(row: EmergencyIncident): void {
    if (this.cordons.some((c) => c.rowId === row.id)) return;
    const e = this.e;
    const rowNodes = [...this.nodes.values()].filter((n) => n.rowId === row.id);
    let cx = row.point?.[0];
    let cy = row.point?.[1];
    let radius = 4.8;
    if (rowNodes.length) {
      const n0 = rowNodes[0];
      if (cx == null || cy == null) {
        cx = (n0.o.x * e.g.m.widthMeters) / 100;
        cy = (n0.o.y * e.g.m.heightMeters) / 100;
      }
      const maxDim = Math.max(
        ...rowNodes.map((n) => Math.max(n.o.width || 3, n.o.depth || 3))
      );
      radius = Math.max(4.0, Math.min(8.5, Math.max(n0.combustionRadius + 1.4, maxDim * 0.58 + 1.8)));
    }
    if (cx == null || cy == null) return;

    const perimeterPt: [number, number] = [cx + radius + 0.6, cy];
    const goal =
      e.g.nearest(perimeterPt[0], perimeterPt[1], 10) >= 0
        ? e.g.nearest(perimeterPt[0], perimeterPt[1], 10)
        : e.g.nearest(cx, cy, 12);
    if (goal < 0) return;

    const field = e.getFlow(goal);
    let spawnPt: [number, number] | null = null;
    let bestD = Infinity;
    for (const ent of e.s.entrances || []) {
      const ex = (ent.x * e.g.m.widthMeters) / 100;
      const ey = (ent.y * e.g.m.heightMeters) / 100;
      const k = e.g.nearest(ex, ey, 6);
      if (k >= 0 && field[k] >= 0) {
        const d = Math.hypot(ex - cx, ey - cy);
        if (d < bestD) {
          bestD = d;
          spawnPt = e.g.point(k);
        }
      }
    }
    if (!spawnPt) {
      const fallbackCell = e.g.nearest(cx + radius + 3, cy + 3, 14);
      spawnPt = fallbackCell >= 0 ? e.g.point(fallbackCell) : e.g.point(goal);
    }

    const crew = [0, 1].map((idx) => ({
      id: `cordon-${row.id}-${idx}`,
      x: spawnPt![0] + (idx === 0 ? -0.35 : 0.35),
      y: spawnPt![1] + (idx === 0 ? -0.25 : 0.25),
      r: 0.32,
      speed: 1.15,
      state: 'cordon-crew',
      target: goal,
      field,
    }));

    this.cordons.push({
      id: `cordon-${row.id}`,
      rowId: row.id,
      center: [cx, cy],
      radius,
      state: 'hot_zone',
      startedAt: e.time,
      hotZoneDuration: 45,
      approachStartedAt: 0,
      installAt: 0,
      installDuration: 150,
      blockedApplied: false,
      crew,
      targetCell: goal,
      field,
    });
    row.fireStage = 'hot_zone';
    row.note =
      (row.note ? row.note + ' · ' : '') +
      'Zona caliente en enfriamiento; montaje de perímetro en espera.';
  }

  private blockCordonCells(cordon: FireCordon): void {
    if (cordon.blockedApplied) return;
    cordon.blockedApplied = true;
    const e = this.e;
    const [cx, cy] = cordon.center;
    const r = cordon.radius;
    const cell = e.g.cell || 0.75;
    const iMin = Math.max(0, Math.floor((cx - r) / cell));
    const iMax = Math.min(e.g.w - 1, Math.ceil((cx + r) / cell));
    const jMin = Math.max(0, Math.floor((cy - r) / cell));
    const jMax = Math.min(e.g.h - 1, Math.ceil((cy + r) / cell));
    const blockedCells: number[] = [];
    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        const k = j * e.g.w + i;
        const p = e.g.point(k);
        if (Math.hypot(p[0] - cx, p[1] - cy) <= r - 0.15 && e.g.free[k]) {
          e.g.free[k] = 0;
          blockedCells.push(k);
        }
      }
    }
    cordon.blockedCells = blockedCells;
    e.flow?.clear?.();
    for (const a of e.agents || []) {
      if (a.state === 'gone') continue;
      const dx = a.x - cx;
      const dy = a.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < r) {
        const ux = d > 0.05 ? dx / d : 1;
        const uy = d > 0.05 ? dy / d : 0;
        const safe = e.g.nearest(cx + ux * (r + 1), cy + uy * (r + 1), 8);
        if (safe >= 0) {
          const sp = e.g.point(safe);
          e.remove(a);
          a.x = sp[0];
          a.y = sp[1];
          e.insert(a);
        }
      }
    }
  }

  private updateCordons(dt: number, events: EmergencyIncident[]): void {
    const e = this.e;
    for (const c of this.cordons) {
      const row = events.find((r) => r.id === c.rowId);
      if (c.state === 'hot_zone') {
        if (e.time - c.startedAt >= c.hotZoneDuration) {
          c.state = 'approaching';
          c.approachStartedAt = e.time;
          if (row) {
            row.fireStage = 'approaching';
            row.note = 'Zona enfriada; equipo de montaje en camino para asegurar el perímetro.';
          }
        }
      } else if (c.state === 'approaching') {
        let arrivedCount = 0;
        for (const w of c.crew) {
          if (c.field && c.targetCell >= 0) {
            const reached = e.move(w, c.field, c.targetCell, dt, 0.7);
            if (
              reached ||
              Math.hypot(w.x - c.center[0], w.y - c.center[1]) <= c.radius + 1.4
            ) {
              arrivedCount++;
            }
          } else {
            arrivedCount++;
          }
        }
        if (arrivedCount >= c.crew.length || e.time - c.approachStartedAt >= 110) {
          c.state = 'installing';
          c.installAt = e.time;
          for (const w of c.crew) e.remove(w);
          if (row) {
            row.fireStage = 'installing';
            row.note =
              'Equipo de montaje instalando vallas perimetrales alrededor de la zona afectada.';
          }
        }
      } else if (c.state === 'installing') {
        const elapsed = e.time - c.installAt;
        const progress = Math.min(1, elapsed / c.installDuration);
        c.crew.forEach((w, idx) => {
          const ang = progress * Math.PI * 2 + idx * Math.PI;
          w.x = c.center[0] + Math.cos(ang) * (c.radius + 0.45);
          w.y = c.center[1] + Math.sin(ang) * (c.radius + 0.45);
        });
        if (progress >= 0.35) {
          this.blockCordonCells(c);
        }
        if (elapsed >= c.installDuration) {
          c.state = 'fenced';
          c.fencedAt = e.time;
          this.blockCordonCells(c);
          c.crew = [];
          if (row) {
            row.fireStage = 'fenced';
            row.note =
              'Zona asegurada y vallada perimetralmente; circulación restringida.';
          }
        }
      } else if (c.state === 'fenced' && c.fencedAt != null && e.time - c.fencedAt >= 300) {
        c.state = 'cleanup';
        c.cleanupAt = e.time;
        if (row) {
          row.fireStage = 'cleanup';
          row.note = 'Retirada de escombros, cenizas y limpieza técnica en curso.';
        }
      } else if (c.state === 'cleanup' && c.cleanupAt != null && e.time - c.cleanupAt >= 150) {
        c.state = 'inspection';
        c.inspectionAt = e.time;
        if (row) {
          row.fireStage = 'inspection';
          row.note = 'Inspección técnica previa a la reapertura del entorno.';
        }
      } else if (c.state === 'inspection' && c.inspectionAt != null && e.time - c.inspectionAt >= 90) {
        c.state = 'reopened';
        for (const k of c.blockedCells || []) {
          if (this.canReleaseCell(k, c.id)) e.g.free[k] = 1;
        }
        const rowNodes = [...this.nodes.values()].filter((n) => n.rowId === c.rowId);
        for (const rn of rowNodes) {
          if (rn.damage < 1) {
            for (const k of rn.blockedFootprintCells) {
              if (this.canReleaseCell(k, c.id)) e.g.free[k] = 1;
            }
          }
          rn.stage = 'reopened';
        }
        e.flow?.clear?.();
        if (row) {
          row.fireStage = 'reopened';
          row.note = 'Inspección favorable; perímetro y paso peatonal reabiertos.';
        }
      }
    }
  }

  private evaluateSensitiveServiceThreats(
    fireNode: FireNode,
    row: EmergencyIncident
  ): void {
    const e = this.e;
    const m = e.g.m;
    const services = (e.s.infrastructure || []).filter(
      (o: {kind?: string; name?: string}) =>
        o.kind === 'yellow_tent' ||
        o.kind === 'violet_point' ||
        String(o.name || '').toLowerCase().includes('carpa amarilla') ||
        String(o.name || '').toLowerCase().includes('punto violeta')
    );
    const code = row.code || `FUE-${row.id}`;
    const fc = fireNode.ignitionPoint;
    for (const svc of services) {
      if (svc.id === fireNode.o.id) continue;
      const sp: [number, number] = [
        (svc.x * m.widthMeters) / 100,
        (svc.y * m.heightMeters) / 100,
      ];
      const d = Math.hypot(sp[0] - fc[0], sp[1] - fc[1]);
      if (d <= fireNode.safetyRadius + 2.5) {
        const svcKind: 'yellow_tent' | 'violet_point' =
          svc.kind === 'violet_point' || String(svc.name || '').toLowerCase().includes('punto violeta')
            ? 'violet_point'
            : 'yellow_tent';
        const occupants = (e.agents || []).filter(
          (a: {state?: string; x: number; y: number}) =>
            a.state !== 'gone' && Math.hypot(a.x - sp[0], a.y - sp[1]) <= 4.5
        ).length;
        const action: SensitiveServiceThreat['action'] =
          d <= fireNode.combustionRadius + 5.5
            ? 'relocation_needed'
            : fireNode.intensity >= 0.5
              ? 'evacuating'
              : 'monitoring';
        const existing = this.serviceThreats.find(
          (t) => t.serviceId === svc.id && t.threatenedByRowId === row.id
        );
        if (existing) {
          existing.distanceMeters = Number(d.toFixed(1));
          existing.occupantsPresent = occupants;
          existing.action = action;
        } else {
          this.serviceThreats.push({
            serviceId: svc.id,
            serviceName: svc.name || (svcKind === 'violet_point' ? 'Punto Violeta' : 'Carpa Amarilla'),
            serviceKind: svcKind,
            threatenedByRowId: row.id,
            threatenedByCode: String(code),
            distanceMeters: Number(d.toFixed(1)),
            occupantsPresent: occupants,
            action,
            detectedAt: e.time,
          });
          appendIncidentMilestone(row, {
            time: e.time,
            kind: 'threat',
            label: `Amenaza próxima a ${svc.name || svcKind}`,
            detail:
              svcKind === 'violet_point'
                ? `Proximidad térmica al Punto Violeta (${d.toFixed(1)} m): evaluar evacuación discreta, continuidad del servicio y resguardo de material sin exponer datos personales.`
                : `Proximidad térmica a Carpa Amarilla (${d.toFixed(1)} m, ~${occupants} personas en entorno): evaluar evacuación accesible y posible reubicación.`,
            status: row.status,
            severity: normalizeSeverity(row.severity, row.type),
            point: sp,
          });
        }
      }
    }
  }

  private barrierAttenuation(originPt: Point, targetPt: Point): number {
    const e = this.e;
    const m = e.g.m;
    let factor = 1.0;
    for (const f of e.s.fences || []) {
      const fPts = (f.points || []).map(
        (pt: [number, number]): Point => [(pt[0] * m.widthMeters) / 100, (pt[1] * m.heightMeters) / 100]
      );
      for (let i = 1; i < fPts.length; i++) {
        if (segmentsIntersect(originPt, targetPt, fPts[i - 1], fPts[i])) {
          factor *= 0.55;
          break;
        }
      }
    }
    return Math.max(0.3, factor);
  }

  update(dt: number, events: EmergencyIncident[]): void {
    const e = this.e;
    const objects = [
      ...(e.s.base?.booths || []),
      ...(e.s.infrastructure || []),
    ];
    const weatherKey = String(e.s?.base?.weather || e.weather || 'sun');
    const weatherFactor =
      weatherKey === 'wind'
        ? 1.35
        : weatherKey === 'rain'
          ? 0.55
          : weatherKey === 'cloud'
            ? 0.95
            : 1.05;

    for (const n of [...this.nodes.values()]) {
      if (!n.burning) continue;
      const row = events.find((r) => r.id === n.rowId);
      if (!row || row.status === 'resolved') {
        n.burning = false;
        n.stage = 'extinguido';
        continue;
      }

      const duration = Math.max(60, e.s.fireBurnSeconds ?? 600);
      const suppressed =
        row.status === 'assisting' ||
        row.extinguisherWorker?.state === 'extinguishing';

      n.damage = Math.min(
        1,
        n.damage + (dt / duration) * (suppressed ? 0.12 : 1)
      );

      // Evolución física de intensidad y de las 3 geometrías separadas
      if (suppressed) {
        n.intensity = Math.max(0.1, n.intensity - (dt / 120));
        n.stage = 'controlado';
        n.controlledAt ??= e.time;
      } else {
        n.intensity = Math.min(1, n.intensity + (dt / 160) * n.growthRate * (weatherKey === 'rain' ? 0.6 : 1));
        if (n.spreadToIds.length > 0) {
          n.stage = 'propagacion';
        } else if (n.intensity >= 0.36) {
          n.stage = 'desarrollado';
        } else {
          n.stage = 'conato';
        }
      }

      const w = n.o.width || 3;
      const d = n.o.depth || 3;
      const minDim = Math.max(1.2, Math.min(w, d));
      const maxDim = Math.max(w, d);
      n.combustionRadius = Number(
        Math.max(
          0.65,
          Math.min(maxDim * 0.72 + 1.2, minDim * 0.28 + n.intensity * (maxDim * 0.45 + 0.8))
        ).toFixed(2)
      );
      n.safetyRadius = Number(
        Math.max(4.5, Math.min(18, n.combustionRadius * 2.1 + 3.0)).toFixed(2)
      );

      row.fireStage = n.stage;
      if (n.damage >= 1) {
        n.burning = false;
        n.stage = 'extinguido';
        row.fireStage = 'extinguido';
      }

      this.evaluateSensitiveServiceThreats(n, row);

      const spreadWait = e.s.fireSpreadSeconds ?? 90;
      if (suppressed || e.time - n.litAt < spreadWait || n.intensity < 0.34) {
        continue;
      }

      const aPoly = rect(n.o, e.g.m);
      const ac: Point = [
        (n.o.x * e.g.m.widthMeters) / 100,
        (n.o.y * e.g.m.heightMeters) / 100,
      ];

      for (const o of objects) {
        if (this.nodes.has(o.id) || o.id === n.o.id) continue;
        const prof = getCombustibilityProfile(o);
        if (!prof.combustible) continue; // Estructuras no combustibles jamás arden por círculo de seguridad

        const bPoly = rect(o, e.g.m);
        const bc: Point = [
          (o.x * e.g.m.widthMeters) / 100,
          (o.y * e.g.m.heightMeters) / 100,
        ];
        const gap = rectEdgeGap(aPoly, bPoly);
        const contains = inside(ac, bPoly) || inside(bc, aPoly);
        const configuredGap = e.s.fireSpreadGap ?? 3.5;
        const maxGap = Math.max(2.0, configuredGap * (0.68 + n.intensity * 0.55) * weatherFactor);

        if (contains || gap <= maxGap) {
          if (n.stage === 'desarrollado') {
            n.stage = 'exposicion';
            row.fireStage = 'exposicion';
          }
          const barrierFactor = this.barrierAttenuation(ac, bc);
          const thermalRate =
            n.intensity *
            prof.combustibility *
            weatherFactor *
            barrierFactor *
            (1 / (1 + gap * 0.38));
          const exposure = (n.exposure.get(o.id) || 0) + dt * thermalRate;
          n.exposure.set(o.id, exposure);

          if (exposure >= prof.ignitionThreshold) {
            n.spreadToIds.push(o.id);
            n.stage = 'propagacion';
            row.fireStage = 'propagacion';
            if (typeof e.emergency?.spawnSecondaryFire === 'function') {
              e.emergency.spawnSecondaryFire(row, n, o);
            } else {
              this.ignite(o, row, {parentRowId: row.id});
            }
          }
        }
      }
    }

    for (const row of events.filter(
      (r) => r.type === 'fire' && r.status !== 'resolved'
    )) {
      const rowNodes = [...this.nodes.values()].filter((n) => n.rowId === row.id);
      if (rowNodes.length > 0 && !rowNodes.some((n) => n.burning)) {
        row.fireOutcome = 'Combustión agotada; daños en estructuras';
        e.emergency.resolve(row);
      }
    }
    this.updateCordons(dt, events);
  }

  svg(): string {
    const e = this.e;
    const events: EmergencyIncident[] = e.emergency?.events || [];
    let html = '';

    for (const n of this.nodes.values()) {
      const poly = rect(n.o, e.g.m);
      const [x, y] = [
        (n.o.x * e.g.m.widthMeters) / 100,
        (n.o.y * e.g.m.heightMeters) / 100,
      ];
      const row = events.find((r) => r.id === n.rowId);
      const code = row?.code || `FUE-${n.rowId}`;
      const stageLabel =
        n.stage === 'conato'
          ? 'Conato'
          : n.stage === 'desarrollado'
            ? 'Desarrollado'
            : n.stage === 'exposicion'
              ? 'Exposición térmica'
              : n.stage === 'propagacion'
                ? 'Propagación activa'
                : n.stage === 'controlado'
                  ? 'Controlado'
                  : n.damage >= 1
                    ? 'Destruida'
                    : 'Extinguido';

      // A) Perímetro de seguridad diferenciado (precaución, no equivale a foco de llamas)
      if (n.burning) {
        html += `<circle cx="${n.ignitionPoint[0]}" cy="${n.ignitionPoint[1]}" r="${n.safetyRadius}" fill="#D94841" fill-opacity=".07" stroke="#E69A26" stroke-width=".32" stroke-dasharray="1.4 .9" pointer-events="none"/>`;
      }

      // B) Contorno / huella del objeto afectado
      html += `<polygon data-investigate-incident="${n.rowId}" class="incident-map-marker" style="cursor:pointer" points="${poly
        .map((p) => p.join(','))
        .join(' ')}" fill="${n.damage >= 1 ? '#353039' : '#D94841'}" fill-opacity="${
        n.damage >= 1 ? 0.92 : 0.16 + n.damage * 0.55
      }" stroke="#7c2531" stroke-width=".34"><title>${code} · ${n.o.name} (${stageLabel} · ${Math.round(
        n.damage * 100
      )} % daño)</title></polygon>`;

      // C) Zona activa de combustión localizada
      if (n.burning) {
        html += `<circle cx="${n.ignitionPoint[0]}" cy="${n.ignitionPoint[1]}" r="${n.combustionRadius}" fill="#D94841" fill-opacity=".38" stroke="#b91c1c" stroke-width=".38" pointer-events="none"/><path transform="translate(${n.ignitionPoint[0]} ${n.ignitionPoint[1]})" d="M-0.95 1Q-1.8 -0.9 0 -2.6Q0 -0.9 0.95 -1.8Q2.6 0.95 0 1.8Z" fill="#f6a42b" stroke="#991b1b" stroke-width=".12" pointer-events="none"/>`;
      }

      html += `<text x="${x}" y="${y - 1.2}" font-size="1.25" font-weight="700" text-anchor="middle" fill="${
        n.damage >= 1 ? '#ffffff' : '#7f1d1d'
      }" paint-order="stroke" stroke="${
        n.damage >= 1 ? '#1e293b' : '#ffffff'
      }" stroke-width=".35" pointer-events="none">${code} · ${n.o.name}</text><text x="${x}" y="${
        y + 0.5
      }" font-size="1.15" text-anchor="middle" fill="${
        n.damage >= 1 ? '#e2e8f0' : '#991b1b'
      }" pointer-events="none">${stageLabel} (${Math.round(n.damage * 100)} %)</text>`;
    }

    // Indicador de amenaza sobre Carpa Amarilla / Punto Violeta dentro de zona de seguridad
    for (const t of this.serviceThreats) {
      const svc = this.findObject(t.serviceId);
      if (!svc) continue;
      const sx = (svc.x * e.g.m.widthMeters) / 100;
      const sy = (svc.y * e.g.m.heightMeters) / 100;
      const color = t.serviceKind === 'violet_point' ? '#9755C2' : '#E69A26';
      html += `<g pointer-events="none"><circle cx="${sx}" cy="${sy}" r="3.1" fill="none" stroke="${color}" stroke-width=".3" stroke-dasharray=".9 .6"/><text x="${sx}" y="${
        sy - 3.6
      }" text-anchor="middle" font-size="1.1" font-weight="700" fill="${color}" paint-order="stroke" stroke="#ffffff" stroke-width=".35">Amenaza térmica (${t.threatenedByCode})</text></g>`;
    }

    for (const row of events) {
      const w = row.extinguisherWorker;
      if (!w || w.state === 'finished' || row.status === 'resolved') continue;
      html +=
        '<circle cx="' +
        w.x +
        '" cy="' +
        w.y +
        '" r=".5" fill="#405470"/><rect x="' +
        (w.x + 0.3) +
        '" y="' +
        w.y +
        '" width=".4" height=".7" fill="#c62e36"/><text x="' +
        w.x +
        '" y="' +
        (w.y - 1.5) +
        '" font-size="1.4" text-anchor="middle">Extintor</text>';
      if (w.state === 'extinguishing' && row.point) {
        html +=
          '<line x1="' +
          w.x +
          '" y1="' +
          w.y +
          '" x2="' +
          row.point[0] +
          '" y2="' +
          row.point[1] +
          '" stroke="#fff" stroke-width=".7"/>';
      }
    }

    for (const c of this.cordons) {
      const [cx, cy] = c.center;
      const r = c.radius;
      if (c.state === 'reopened') {
        html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#64748b" fill-opacity=".08" stroke="#199A87" stroke-opacity=".45" stroke-width=".2" stroke-dasharray=".8 .8" pointer-events="none"/><text x="${cx}" y="${cy - r - 1}" font-size="1.25" text-anchor="middle" fill="#199A87" font-weight="700">Zona reabierta</text>`;
        continue;
      }
      html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#4b4550" fill-opacity=".22" stroke="#7c2531" stroke-opacity=".35" stroke-width=".2" stroke-dasharray=".9 .6" pointer-events="none"/>`;
      if (c.state === 'hot_zone' || c.state === 'approaching') {
        html += `<text x="${cx}" y="${cy - r - 1}" font-size="1.25" text-anchor="middle" fill="#9a3412" font-weight="700" paint-order="stroke" stroke="#ffffff" stroke-width=".35">${
          c.state === 'hot_zone' ? 'Zona caliente · enfriando' : 'Asegurando perímetro…'
        }</text>`;
      }
      if (
        c.state === 'installing' ||
        c.state === 'fenced' ||
        c.state === 'cleanup' ||
        c.state === 'inspection'
      ) {
        const segs = 12;
        const progress =
          c.state === 'installing'
            ? Math.max(0.15, Math.min(1, (e.time - c.installAt) / c.installDuration))
            : 1;
        const activeSegs = Math.max(2, Math.round(segs * progress));
        const pts: string[] = [];
        for (let i = 0; i <= activeSegs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)},${(cy + Math.sin(ang) * r).toFixed(2)}`);
        }
        const pAttr = pts.join(' ');
        html += `<polyline points="${pAttr}" fill="none" stroke="#9a6532" stroke-width=".5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${pAttr}" fill="none" stroke="#f7dfb4" stroke-width=".22" stroke-dasharray=".7 .55" stroke-linecap="butt"/>`;
        for (let i = 0; i <= activeSegs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          html += `<circle cx="${(cx + Math.cos(ang) * r).toFixed(2)}" cy="${(cy + Math.sin(ang) * r).toFixed(2)}" r=".32" fill="#7c4f24" stroke="#fff" stroke-width=".12"/>`;
        }
        html += `<text x="${cx}" y="${cy - r - 1.2}" font-size="1.35" text-anchor="middle" fill="#682630" font-weight="700">${
          c.state === 'inspection'
            ? 'Inspección previa a reapertura…'
            : c.state === 'cleanup'
              ? 'Retirada de restos…'
              : c.state === 'fenced'
                ? 'Zona vallada · cenizas'
                : 'Vallando cenizas…'
        }</text>`;
      }
      for (const w of c.crew) {
        html += `<g transform="translate(${w.x} ${w.y})"><circle cx="0" cy="0" r=".48" fill="#eab308" stroke="#1e293b" stroke-width=".16"/><text x="0" y="-1.1" font-size="1.25" text-anchor="middle" fill="#1e293b" font-weight="700">Montaje</text></g>`;
      }
    }
    return html;
  }
}
