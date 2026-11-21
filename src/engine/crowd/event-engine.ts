import type {
  Agent,
  BoothType,
  CrowdProfileKey,
  Entrance,
  Infrastructure,
  NavigationGrid,
  PainPoint,
  Point,
  Scene,
  ShelterArea,
  SimHistoryPoint,
  SimSnapshot,
  SimStats,
  SimStation,
  ZoneMetric,
} from '../../types';
import {
  fenceSegmentsMeters,
  projectPointToSegment,
  segmentsIntersect,
} from '../cartography/fences';
import {inside, rect, segmentDistance} from '../cartography/geometry';
import {Dining} from '../dining/dining';
import {picnicSlots} from '../dining/furniture';
import {EmergencyLab} from '../emergency/emergency-lab';
import {yieldForPriority} from '../emergency/priority';
import {FeedbackLog} from './feedback';
import {buildGrid, flow, rng} from './grid-flow';
import {pickPersona} from './personas';
import {gateMode} from './presets';
import {StewardSystem} from './steward-system';
import {recordMovement} from './route-traces';
import {buildShelters, seekShelter} from './shelter';

/**
 * Behavioral profiles for simulated visitors.
 */
export const PROFILES: Record<
  CrowdProfileKey,
  {name: string; color: string; needs: BoothType[]}
> = {
  buyer: {
    name: 'Compras',
    color: '#e4a553',
    needs: ['commerce', 'commerce', 'food'],
  },
  foodie: {
    name: 'Gastronomía',
    color: '#e47862',
    needs: ['food', 'food', 'commerce'],
  },
  culture: {
    name: 'Talleres y cultura',
    color: '#73b79c',
    needs: ['workshop', 'stage', 'commerce'],
  },
  music: {
    name: 'Música y espectáculo',
    color: '#b6a4e6',
    needs: ['stage', 'food', 'stage'],
  },
  walker: {
    name: 'Paseo y descanso',
    color: '#86b8d0',
    needs: ['rest'],
  },
};

/**
 * Discrete-step multi-agent simulation engine (`dt = 0.5 s`).
 * Simulates pedestrian navigation, queues, service slots, dining, shelters, and emergency yielding.
 */
export class EventEngine {
  s: Scene;
  routeEdges: Map<string, {a: number; b: number; count: number}>;
  navPointCache: Map<number, Point | null>;
  feedback: FeedbackLog;
  g: NavigationGrid;
  furniture: Point[][];
  furnitureZones: Map<string, Point[][]>;
  random: () => number;
  time: number;
  closing: boolean;
  flowCache: Map<number, Int32Array>;
  fenceSegments: Array<{id: string; name: string; a: Point; b: Point}>;
  rebelGrid: NavigationGrid | null;
  rebelFlowCache: Map<number, Int32Array>;
  agents: Agent[];
  nextId: number;
  byId: Map<number, Agent>;
  accumulator: number;
  finished: boolean;
  dayClosed: boolean;
  hash: Map<string, Set<Agent>>;
  trails: Float64Array;
  stalls: Float64Array;
  peak: Uint16Array;
  history: SimHistoryPoint[];
  pains: Map<
    string,
    {type: string; cell: number; count: number; seconds: number; detail: string}
  >;
  stats: SimStats;
  duration: number;
  capacity: number;
  waypoints: number[];
  entries: Array<Entrance & {cell: number; field: Int32Array}>;
  entryStats: Map<
    string,
    {
      arrivals: number;
      exits: number;
      capped: number;
      hourBucket: number;
      hourCount: number;
    }
  >;
  stations: SimStation[];
  coverLoad: Map<string, number>;
  hourly: number[];
  shelters: ShelterArea[];
  emergency: EmergencyLab;
  dining: Dining;
  stewards: StewardSystem;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  experience?: any;
  reviewRunId?: string;

  constructor(raw: Scene) {
    this.s = structuredClone(raw);
    this.routeEdges = new Map();
    this.navPointCache = new Map();
    this.feedback = new FeedbackLog(this.s.base.start);
    this.g = buildGrid(this.s);
    this.furniture = this.s.infrastructure
      .filter((o) => o.role === 'furniture')
      .map((o) => rect(o, this.g.m));
    this.furnitureZones = new Map();
    for (const poly of this.furniture) {
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      for (
        let j = Math.floor((Math.min(...ys) - 0.5) / 4);
        j <= Math.floor((Math.max(...ys) + 0.5) / 4);
        j++
      ) {
        for (
          let i = Math.floor((Math.min(...xs) - 0.5) / 4);
          i <= Math.floor((Math.max(...xs) + 0.5) / 4);
          i++
        ) {
          const key = i + ':' + j;
          if (!this.furnitureZones.has(key)) {
            this.furnitureZones.set(key, []);
          }
          this.furnitureZones.get(key)!.push(poly);
        }
      }
    }
    this.random = rng(this.s.seed);
    this.time = 0;
    this.closing = false;
    this.flowCache = new Map();
    this.fenceSegments = fenceSegmentsMeters(this.s.fences || [], this.g.m);
    this.rebelGrid = null;
    this.rebelFlowCache = new Map();
    this.agents = [];
    this.nextId = 1;
    this.byId = new Map();
    this.accumulator = 0;
    this.finished = false;
    this.dayClosed = false;
    this.hash = new Map();
    this.trails = new Float64Array(this.g.free.length);
    this.stalls = new Float64Array(this.g.free.length);
    this.peak = new Uint16Array(this.g.free.length);
    this.history = [];
    this.pains = new Map();
    this.stats = {
      arrivals: 0,
      admitted: 0,
      rejected: 0,
      entryBlocked: 0,
      departed: 0,
      satisfied: 0,
      dissatisfied: 0,
      neutral: 0,
      served: 0,
      abandoned: 0,
      transactions: 0,
      sales: 0,
      waitingSeconds: 0,
      servedWaitCount: 0,
      stuckSeconds: 0,
      technical: 0,
      shelterVisits: 0,
      shelterSeconds: 0,
      fenceBreaches: 0,
      stewardOriented: 0,
      stewardDecongested: 0,
      stewardAssisted: 0,
      stewardPrevented: 0,
      stewardEscalations: 0,
    };
    this.duration = this.s.base.hours * 3600;
    const override = this.s.base.overrides?.limit;
    this.capacity = Math.max(
      0,
      Math.floor(
        (this.g.area * (1 - this.s.base.circulation / 100)) / this.s.base.space
      )
    );
    if (override !== '' && override !== undefined && override !== null) {
      this.capacity = Math.min(
        this.capacity,
        Math.max(0, Number(override) || 0)
      );
    }

    this.waypoints = [];
    this.entries = this.s.entrances
      .filter(
        (e) =>
          ['in', 'out', 'both', 'free'].includes(gateMode(e)) &&
          (e.clearWidth || 3) >= this.s.diameter
      )
      .map((e) => ({
        ...e,
        cell: this.g.nearest(
          (e.x * this.g.m.widthMeters) / 100,
          (e.y * this.g.m.heightMeters) / 100,
          8
        ),
      }))
      .filter((e) => e.cell >= 0)
      .map((e) => ({...e, field: flow(this.g, e.cell)}));

    this.entryStats = new Map(
      this.entries.map((e) => [
        e.id,
        {arrivals: 0, exits: 0, capped: 0, hourBucket: 0, hourCount: 0},
      ])
    );

    for (let i = 0; i < 48; i++) {
      for (let j = 0; j < 80; j++) {
        const k = Math.floor(this.random() * this.g.free.length);
        if (this.g.free[k] && this.entries.some((e) => e.field[k] >= 0)) {
          this.waypoints.push(k);
          break;
        }
      }
    }

    const m = this.g.m;
    const activity = this.s.infrastructure
      .filter(
        (o) =>
          ['activity', 'rest', 'stage', 'furniture'].includes(o.role || '') &&
          o.kind !== 'picnic'
      )
      .map((o) => ({
        ...o,
        type: (o.role === 'stage'
          ? 'stage'
          : ['rest', 'furniture'].includes(o.role || '')
            ? 'rest'
            : 'workshop') as BoothType,
        labCapacity: o.capacity,
        labTime: o.time || 15,
        price: o.price || 0,
        interest: 1,
        open: o.open || 0,
        close: o.close ?? this.s.base.hours,
      }));

      const interestZones = (this.s.passages || [])
        .filter(
          (r) =>
            r.origin === 'interest-zone' &&
            r.interestZone !== false &&
            Array.isArray(r.points) &&
            r.points.length >= 3
        )
        .map((r) => {
          const cx =
            r.points.reduce((sum, pt) => sum + pt[0], 0) / r.points.length;
          const cy =
            r.points.reduce((sum, pt) => sum + pt[1], 0) / r.points.length;
          return {
            id: r.id || crypto.randomUUID(),
            name: r.name || 'Zona de interés',
            type: 'rest' as BoothType,
            x: cx,
            y: cy,
            width: 2,
            depth: 2,
            area: 4,
            rotation: 0,
            labCapacity: 18,
            labTime: 3,
            price: 0,
            interest: 1,
            open: 0,
            close: this.s.base.hours,
          };
        });

      this.stations = [...this.s.base.booths, ...activity, ...interestZones].map(
      (b: Record<string, any>) => {
      const a =
        (((b.facing ?? (b.rotation || 0) + 90) * Math.PI) / 180);
      const depth = b.depth || Math.sqrt(b.area || 24);
      const x = (b.x * m.widthMeters) / 100;
      const y = (b.y * m.heightMeters) / 100;
      const cell = this.g.nearest(
        x + Math.cos(a) * (depth / 2 + 1.7),
        y + Math.sin(a) * (depth / 2 + 1.7),
        8
      );
      const cover = this.s.infrastructure.find(
        (o) =>
          o.role === 'cover' &&
          rect(b, m).every((p) => inside(p, rect(o, m)))
      );
      return {
        ...b,
        cell,
        field: flow(this.g, cell),
        capacity: Math.max(
          1,
          Math.round(
            b.labCapacity ?? (b.type === 'stage' ? 40 : b.simultaneous || 8)
          )
        ),
        minutes: Math.max(0.5, b.labTime ?? b.time ?? 15),
        covered: !!cover || !!b.covered,
        coverId: cover?.id,
        queue: [],
        serving: [],
        served: 0,
        sales: 0,
        wait: 0,
        abandoned: 0,
        slots: [],
        queueCell: cell,
        queueField: new Int32Array(0),
      };
    });

    for (const b of this.stations) {
      const p: Point = b.cell >= 0 ? this.g.point(b.cell) : [0, 0];
      const angle =
        (((b.facing ?? (b.rotation || 0) + 90) * Math.PI) / 180);
      const spacing = Math.max(0.8, this.s.diameter + 0.15);
      const cols = Math.max(2, Math.ceil(Math.sqrt(b.capacity)));
      const slots: Array<{x: number; y: number; cell: number}> = [];
      for (
        let row = 0;
        row < Math.ceil(b.capacity / cols) + 4 && slots.length < b.capacity;
        row++
      ) {
        for (let col = 0; col < cols && slots.length < b.capacity; col++) {
          const u = (col - (cols - 1) / 2) * spacing;
          const v = (row + 1) * spacing;
          const x = p[0] + Math.cos(angle) * v - Math.sin(angle) * u;
          const y = p[1] + Math.sin(angle) * v + Math.cos(angle) * u;
          const k = this.g.index(x, y);
          const coverObj = b.coverId
            ? this.s.infrastructure.find((o) => o.id === b.coverId)
            : undefined;
          if (
            k >= 0 &&
            this.g.free[k] &&
            (b.type !== 'rest' ||
              !coverObj ||
              inside([x, y], rect(coverObj, this.g.m))) &&
            slots.every(
              (q) => Math.hypot(q.x - x, q.y - y) >= this.s.diameter + 0.05
            )
          ) {
            slots.push({x, y, cell: k});
          }
        }
      }
      if (b.kind === 'picnic') {
        slots.splice(0);
        for (const q of picnicSlots(
          b as unknown as Infrastructure,
          this.g.m,
          (x, y) => this.clearAt(x, y),
          this.s.diameter
        )) {
          slots.push({...q, cell: this.g.index(q.x, q.y)});
        }
      }
      b.slots = slots;
      b.capacity = Math.min(b.capacity, slots.length);
      const lateral = (b.width || 4) / 2 + 2;
      const center: Point = b.cell >= 0 ? this.g.point(b.cell) : [0, 0];
      b.queueCell = this.g.nearest(
        center[0] - Math.sin(angle) * lateral,
        center[1] + Math.cos(angle) * lateral,
        6
      );
      if (b.queueCell < 0) b.queueCell = b.cell;
      b.queueField = flow(this.g, b.queueCell);
      if (!b.capacity) {
        this.pain(
          'oferta',
          b.cell >= 0 ? b.cell : 0,
          b.name + ' sin espacio de atención'
        );
      }
    }

    this.coverLoad = new Map();
    this.hourly = this.arrivalProfile();
    this.shelters = buildShelters(this);
    this.emergency = new EmergencyLab(this);
    this.dining = new Dining(this);
    this.stewards = new StewardSystem(this);
    this.updateHash();
    this.record();
  }

  arrivalProfile(): number[] {
    const {hours, arrivals, overrides, weather, exposure} = this.s.base;
    if (overrides?.counts?.trim()) {
      const c = overrides.counts.trim().split(/[;,\s]+/).map(Number);
      if (c.length === hours && c.every((n) => Number.isFinite(n) && n >= 0)) {
        return c;
      }
    }
    const loss = weather === 'rain' ? 0.4 : weather === 'wind' ? 0.25 : 0;
    const weights = Array.from(
      {length: hours},
      (_, h) =>
        0.6 +
        1.1 * Math.exp(-((h - (hours - 1) * 0.65) ** 2) / Math.max(1, hours / 4))
    );
    const mean = weights.reduce((a, b) => a + b, 0) / hours;
    return weights.map((w) => ((arrivals * w) / mean) * (1 - (exposure / 100) * loss));
  }

  key(x: number, y: number): string {
    return Math.floor(x) + ':' + Math.floor(y);
  }

  updateHash(): void {
    this.hash.clear();
    for (const a of this.agents) this.insert(a);
  }

  insert(a: Agent): void {
    const k = this.key(a.x, a.y);
    if (!this.hash.has(k)) this.hash.set(k, new Set());
    this.hash.get(k)!.add(a);
  }

  remove(a: Agent): void {
    const k = this.key(a.x, a.y);
    const set = this.hash.get(k);
    set?.delete(a);
    if (!set?.size) this.hash.delete(k);
  }

  staticClearAt(x: number, y: number): boolean {
    const r = this.s.diameter / 2;
    const k = this.g.index(x, y);
    return (
      k >= 0 &&
      !!this.g.free[k] &&
      !(
        this.furnitureZones.get(Math.floor(x / 4) + ':' + Math.floor(y / 4)) ||
        []
      ).some(
        (poly) =>
          inside([x, y], poly) ||
          poly.some(
            (p, i) =>
              segmentDistance([x, y], p, poly[(i + 1) % poly.length]) <
              r - 0.02
          )
      )
    );
  }

  clearAt(x: number, y: number, id: number | null = null): boolean {
    const r = this.s.diameter / 2;
    if (!this.staticClearAt(x, y) || this.emergency?.blocksPerson(x, y, r)) {
      return false;
    }
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    for (let j = iy - 1; j <= iy + 1; j++) {
      for (let i = ix - 1; i <= ix + 1; i++) {
        for (const o of this.hash.get(i + ':' + j) || []) {
          if (
            o.id !== id &&
            Math.hypot(o.x - x, o.y - y) <
              r +
                o.r -
                Math.max(0, Math.min(0.08, this.s.collisionTolerance || 0)) -
                0.00001
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }

  navigationPoint(k: number): Point | null {
    if (this.navPointCache.has(k)) return this.navPointCache.get(k)!;
    const p = this.g.point(k);
    let found: Point | null = null;
    for (const [x, y] of [
      [0, 0],
      [0.2, 0],
      [-0.2, 0],
      [0, 0.2],
      [0, -0.2],
      [0.32, 0],
      [-0.32, 0],
      [0, 0.32],
      [0, -0.32],
      [0.25, 0.25],
      [-0.25, 0.25],
      [0.25, -0.25],
      [-0.25, -0.25],
    ]) {
      if (this.staticClearAt(p[0] + x, p[1] + y)) {
        found = [p[0] + x, p[1] + y];
        break;
      }
    }
    this.navPointCache.set(k, found);
    return found;
  }

  lineClear(a: Point, b: Point): boolean {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25);
    for (let i = 1; i <= n; i++) {
      if (
        !this.staticClearAt(
          a[0] + ((b[0] - a[0]) * i) / n,
          a[1] + ((b[1] - a[1]) * i) / n
        )
      ) {
        return false;
      }
    }
    return true;
  }

  pickProfile(): CrowdProfileKey {
    const weights = (
      Object.entries(this.s.mix) as Array<[CrowdProfileKey, number]>
    ).map(
      ([k, v]) =>
        [
          k,
          Math.max(0, v) *
            (this.s.offerMix &&
            ((k === 'foodie' &&
              !this.stations.some((b) => b.type === 'food')) ||
              (k === 'music' &&
                !this.stations.some((b) => b.type === 'stage')))
              ? 0.25
              : 1),
        ] as [CrowdProfileKey, number]
    );
    const sum = weights.reduce((n, [, v]) => n + v, 0);
    let n = this.random() * sum;
    for (const [k, v] of weights) {
      n -= v;
      if (n <= 0) return k;
    }
    return 'walker';
  }

  pain(
    type: string,
    cell: number,
    detail = '',
    agent: Agent | null = null,
    seconds = 0,
    cause = ''
  ): void {
    const key =
      type +
      ':' +
      Math.floor(cell / this.g.w / 10) +
      ':' +
      Math.floor((cell % this.g.w) / 10);
    const old = this.pains.get(key) || {
      type,
      cell,
      count: 0,
      seconds: 0,
      detail,
    };
    old.count++;
    old.seconds += 0.5;
    this.pains.set(key, old);
    if (agent) {
      this.feedback.record({
        type,
        agent,
        time: this.time,
        place: this.location(cell),
        point: this.g.point(cell),
        detail,
        seconds,
        cause,
        tolerance: this.s.maxWait * 60 * (agent.persona?.patience || 1),
      });
    }
  }

  complaints() {
    return this.feedback.list();
  }

  spawn(): void {
    this.stats.arrivals++;
    if (this.agents.length >= this.capacity) {
      this.stats.rejected++;
      return;
    }
    if (this.agents.length >= 3000) {
      this.stats.technical++;
      return;
    }
    const allIncoming = this.entries.filter((e) =>
      ['in', 'both', 'free'].includes(gateMode(e))
    );
    if (!allIncoming.length) {
      this.stats.entryBlocked++;
      return;
    }
    const pedIncoming = allIncoming.filter((e) => e.spawnType !== 'vehicle');
    const pool = pedIncoming.length ? pedIncoming : allIncoming;
    const hourBucket = Math.floor(this.time / 3600);
    const eligible = pool.filter((e) => {
      const cap = Math.max(0, Number(e.maxRatePerHour) || 0);
      if (!cap) return true;
      const st = this.entryStats.get(e.id);
      if (!st) return true;
      if (st.hourBucket !== hourBucket) {
        st.hourBucket = hourBucket;
        st.hourCount = 0;
      }
      if (st.hourCount >= cap) {
        st.capped++;
        return false;
      }
      return true;
    });
    if (!eligible.length) {
      this.stats.entryBlocked++;
      return;
    }
    const hasWeights = eligible.some((e) => Number.isFinite(e.entryWeight));
    let entry = eligible[0];
    if (!hasWeights) {
      entry = eligible[Math.floor(this.random() * eligible.length)];
    } else {
      const weights = eligible.map((e) =>
        Number.isFinite(e.entryWeight) ? Math.max(0, Number(e.entryWeight)) : 1
      );
      const totalW = weights.reduce((acc, w) => acc + w, 0);
      if (totalW <= 0) {
        entry = eligible[Math.floor(this.random() * eligible.length)];
      } else {
        let pick = this.random() * totalW;
        for (let i = 0; i < eligible.length; i++) {
          pick -= weights[i];
          if (pick <= 0) {
            entry = eligible[i];
            break;
          }
        }
      }
    }
    const p = this.g.point(entry.cell);
    let point: Point | null = null;
    for (let i = 0; i < 35; i++) {
      const angle = this.random() * Math.PI * 2;
      const r = i === 0 ? 0 : this.random() * 2.8;
      const x = p[0] + Math.cos(angle) * r;
      const y = p[1] + Math.sin(angle) * r;
      if (this.clearAt(x, y)) {
        point = [x, y];
        break;
      }
    }
    if (!point) {
      this.stats.entryBlocked++;
      this.pain('acceso', entry.cell, entry.name);
      return;
    }
    const st = this.entryStats.get(entry.id);
    if (st) {
      if (st.hourBucket !== hourBucket) {
        st.hourBucket = hourBucket;
        st.hourCount = 0;
      }
      st.arrivals++;
      st.hourCount++;
    }
    const profile = this.pickProfile();
    const persona = pickPersona(profile, this.random, this.s.variety ?? 1);
    const rebelShare = Math.max(0, Math.min(1, this.s.rebelShare ?? 0.01));
    const rebelRoll = this.random();
    const rebel = rebelShare > 0 && rebelRoll < rebelShare;
    const goals =
      profile === 'walker'
        ? 0
        : Math.max(
            1,
            Math.min(
              3,
              Math.round((this.s.base.interactions + persona.goalCount) / 2)
            )
          );
    const a: Agent = {
      id: this.nextId++,
      x: point[0],
      y: point[1],
      r: this.s.diameter / 2,
      profile,
      persona,
      rebel,
      spent: 0,
      goals,
      left: goals,
      completed: 0,
      failed: 0,
      born: this.time,
      deadline:
        this.time +
        Math.max(
          600,
          this.s.base.stay *
            60 *
            persona.stayFactor *
            (0.85 + this.random() * 0.3)
        ),
      speed: persona.pace * (0.9 + this.random() * 0.2),
      state: 'walk',
      target: null,
      stuck: 0,
      waitStart: 0,
      roamUntil: 0,
    };
    this.agents.push(a);
    this.byId.set(a.id, a);
    this.insert(a);
    this.stats.admitted++;
    if (profile === 'walker') {
      a.state = 'roam';
      this.roam(a);
    } else {
      this.assign(a);
    }
  }

  roam(a: Agent): void {
    a.stuck = 0;
    const reachable = this.entries[0]?.field;
    if (!reachable) {
      this.exit(a);
      return;
    }
    let cell = -1;
    for (let i = 0; i < 50; i++) {
      const k =
        this.waypoints[Math.floor(this.random() * this.waypoints.length)];
      if (k >= 0 && reachable[k] >= 0) {
        cell = k;
        break;
      }
    }
    if (cell < 0) {
      this.exit(a);
      return;
    }
    a.targetCell = cell;
    a.roamField = this.getFlow(cell);
    a.roamUntil = this.time + Math.min(180, a.deadline - this.time);
    a.state = 'roam';
  }

  getFlow(cell: number): Int32Array {
    if (!this.flowCache.has(cell)) {
      if (this.flowCache.size >= 96) {
        const firstKey = this.flowCache.keys().next().value;
        if (firstKey !== undefined) this.flowCache.delete(firstKey);
      }
      this.flowCache.set(cell, flow(this.g, cell));
    }
    return this.flowCache.get(cell)!;
  }

  /** Construye perezosamente la cuadrícula sin vallas solo cuando hay rebeldes y vallas. */
  getRebelGrid(): NavigationGrid {
    if (!this.rebelGrid) {
      this.rebelGrid = buildGrid(this.s, this.g.cell, {ignoreFences: true});
    }
    return this.rebelGrid;
  }

  /** Campo de flujo sin vallas con caché LRU acotada (solo para agentes rebeldes). */
  getRebelFlow(cell: number): Int32Array {
    if (!this.rebelFlowCache.has(cell)) {
      if (this.rebelFlowCache.size >= 32) {
        const firstKey = this.rebelFlowCache.keys().next().value;
        if (firstKey !== undefined) this.rebelFlowCache.delete(firstKey);
      }
      this.rebelFlowCache.set(cell, flow(this.getRebelGrid(), cell));
    }
    return this.rebelFlowCache.get(cell)!;
  }

  /**
   * Gestiona el intento de salto de valla por parte de un agente rebelde:
   * detecta la barrera interpuesta hacia su objetivo, aplica un tiempo de salto (3 s),
   * lo traslada al lado opuesto libre y genera una incidencia de seguridad (`fence_breach`).
   */
  stepRebelFenceCross(a: Agent, goalPoint: Point): boolean {
    if (!a.rebel || !this.fenceSegments.length) return false;
    if (a.climbingFence) {
      if (this.time >= a.climbingFence.until) {
        const [tx, ty] = a.climbingFence.target;
        this.remove(a);
        a.x = tx;
        a.y = ty;
        a.stuck = 0;
        this.insert(a);
        delete a.climbingFence;
      }
      return true;
    }
    if (this.time < (a.fenceCrossCooldown || 0)) return false;

    const pos: Point = [a.x, a.y];
    let hitSeg: {id: string; name: string; a: Point; b: Point} | null = null;
    let bestProj: {point: Point; dist: number} | null = null;
    for (const seg of this.fenceSegments) {
      const proj = projectPointToSegment(pos, seg.a, seg.b);
      if (proj.dist > 1.8) continue;
      const crossesDirect = segmentsIntersect(pos, goalPoint, seg.a, seg.b);
      if ((crossesDirect || a.stuck > 3) && (!bestProj || proj.dist < bestProj.dist)) {
        hitSeg = seg;
        bestProj = proj;
      }
    }
    if (!hitSeg || !bestProj) return false;

    // Vector unitario perpendicular a la valla apuntando hacia el lado contrario al agente
    const vx = hitSeg.b[0] - hitSeg.a[0];
    const vy = hitSeg.b[1] - hitSeg.a[1];
    const vLen = Math.hypot(vx, vy) || 1;
    let nx = -vy / vLen;
    let ny = vx / vLen;
    // Asegurar que (nx, ny) apunta desde el agente hacia el otro lado de la valla
    const toProjX = bestProj.point[0] - a.x;
    const toProjY = bestProj.point[1] - a.y;
    if (toProjX * nx + toProjY * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const landRawX = bestProj.point[0] + nx * 1.45;
    const landRawY = bestProj.point[1] + ny * 1.45;
    const landCell = this.g.nearest(landRawX, landRawY, 3.5);
    if (landCell < 0) return false;
    const landPt = this.g.point(landCell);
    // Verificar que aterriza efectivamente al otro lado de la línea de la valla
    const sideDot =
      (landPt[0] - bestProj.point[0]) * nx +
      (landPt[1] - bestProj.point[1]) * ny;
    if (sideDot <= 0.25) return false;

    a.climbingFence = {
      until: this.time + 3,
      target: landPt,
      fenceId: hitSeg.id,
      fenceName: hitSeg.name,
    };
    a.fenceCrossCooldown = this.time + 90;
    this.stats.fenceBreaches = (this.stats.fenceBreaches || 0) + 1;
    const cell = Math.max(0, this.g.index(a.x, a.y));
    this.pain('valla', cell, hitSeg.name, a, 0, 'salto_valla');
    this.emergency.injectAtAgent('fence_breach', a, hitSeg.name);
    return true;
  }

  assign(a: Agent): void {
    if (
      a.left > 0 &&
      this.time < this.duration &&
      this.time < (a.deadline || Infinity) &&
      this.time > (a.detourAfter || 0) &&
      this.random() < (1 - (a.persona?.directness ?? 0.8)) * 0.3
    ) {
      a.detourAfter = this.time + 300;
      this.roam(a);
      return;
    }
    if (
      a.left <= 0 &&
      a.failed === 0 &&
      this.time < a.deadline &&
      this.time < this.duration
    ) {
      this.roam(a);
      return;
    }
    if (a.left <= 0 || this.time >= a.deadline || this.time >= this.duration) {
      this.exit(a);
      return;
    }
    const wants = a.persona?.needs || PROFILES[a.profile].needs;
    const need =
      wants[
        this.random() < (a.persona?.spontaneity || 0)
          ? Math.floor(this.random() * wants.length)
          : Math.min(a.completed + a.failed, wants.length - 1)
      ];
    const cell = this.g.index(a.x, a.y);
    const rebelFlowCheck = a.rebel && this.fenceSegments.length > 0;
    const options = this.stations
      .filter(
        (b) =>
          b.capacity > 0 &&
          b.type === need &&
          b.cell >= 0 &&
          (b.field[cell] >= 0 ||
            (rebelFlowCheck && this.getRebelFlow(b.cell)[cell] >= 0)) &&
          this.available(b)
      )
      .map((b) => {
        const distCells =
          b.field[cell] >= 0
            ? b.field[cell]
            : this.getRebelFlow(b.cell)[cell];
        return {
          b,
          score:
            (b.interest || 1) /
            (1 +
              (distCells * this.g.cell) / 600 +
              ((b.queue.length / Math.max(1, b.capacity)) * b.minutes) / 10),
        };
      });
    if (!options.length) {
      if (
        this.stations.some(
          (b) =>
            b.capacity > 0 &&
            b.type === need &&
            (b.open || 0) * 3600 > this.time &&
            (b.open || 0) * 3600 < this.time + 1800
        ) &&
        !this.closing
      ) {
        a.detourAfter = this.time + 300;
        this.roam(a);
        return;
      }
      a.left--;
      a.failed++;
      this.stats.abandoned++;
      this.pain('oferta', cell, PROFILES[a.profile].name, a, 0);
      if (a.left > 0) this.assign(a);
      else this.exit(a);
      return;
    }
    const sum = options.reduce((n, o) => n + o.score, 0);
    let n = this.random() * sum;
    const choice =
      options.find((o) => (n -= o.score) <= 0) || options[options.length - 1];
    a.target = choice.b.id;
    const rest = choice.b.type === 'rest';
    const occupied = new Set(
      choice.b.serving.map((id) => this.byId.get(id)?.slot)
    );
    const freeSlots = choice.b.slots.filter(
      (q, i) => !occupied.has(i) && this.clearAt(q.x, q.y, a.id)
    );
    const approach = rest
      ? freeSlots[Math.floor(this.random() * freeSlots.length)]
      : null;
    a.approachPoint = approach ? [approach.x, approach.y] : null;
    a.approachCell = approach?.cell ?? choice.b.queueCell;
    a.approachField = this.getFlow(a.approachCell);
    a.state = 'walk';
    a.stuck = 0;
  }

  available(b: SimStation): boolean {
    if (this.emergency?.isClosed(b.id)) return false;
    const h = this.time / 3600;
    return h >= (b.open || 0) && h < (b.close ?? this.s.base.hours);
  }

  exit(a: Agent): void {
    const cell = this.g.index(a.x, a.y);
    const reachable = this.entries
      .filter(
        (e) =>
          ['out', 'both', 'free'].includes(gateMode(e)) && e.field[cell] >= 0
      )
      .sort((x, y) => x.field[cell] - y.field[cell]);
    if (!reachable.length) {
      a.state = 'trapped';
      this.pain('sin_salida', cell, '', a, a.stuck || 0);
      return;
    }
    const pedExits = reachable.filter((e) => e.spawnType !== 'vehicle');
    const options = pedExits.length ? pedExits : reachable;
    const hasCustomExitWeights = options.some((e) =>
      Number.isFinite(e.exitWeight)
    );
    let chosen = options[0];
    if (hasCustomExitWeights && options.length > 1) {
      const scores = options.map((e) => {
        const w = Number.isFinite(e.exitWeight)
          ? Math.max(0, Number(e.exitWeight))
          : 10;
        const dist = Math.max(0, e.field[cell]);
        return w / (1 + dist * 0.015);
      });
      const total = scores.reduce((acc, v) => acc + v, 0);
      if (total > 0) {
        let pick = this.random() * total;
        for (let i = 0; i < options.length; i++) {
          pick -= scores[i];
          if (pick <= 0) {
            chosen = options[i];
            break;
          }
        }
      }
    }
    a.state = 'exit';
    a.target = chosen.id;
    a.stuck = 0;
    const st = this.entryStats.get(chosen.id);
    if (st) st.exits++;
  }

  /** Devuelve el recuento acumulado de entradas, salidas y saturaciones por acceso. */
  accessFlowSummary(): Array<{
    id: string;
    name: string;
    spawnType: string;
    arrivals: number;
    exits: number;
    capped: number;
  }> {
    return this.entries.map((e) => {
      const st = this.entryStats.get(e.id);
      return {
        id: e.id,
        name: e.name,
        spawnType: e.spawnType || 'pedestrian',
        arrivals: st?.arrivals || 0,
        exits: st?.exits || 0,
        capped: st?.capped || 0,
      };
    });
  }

  depart(a: Agent): void {
    if (a.state === 'gone') return;
    this.dining?.release(a);
    a.state = 'gone';
    this.remove(a);
    this.byId.delete(a.id);
    this.stats.departed++;
    if (a.goals === 0) this.stats.neutral++;
    else if (a.completed >= a.goals && a.failed === 0) this.stats.satisfied++;
    else this.stats.dissatisfied++;
  }

  nextCell(a: Agent, field: Int32Array, goal: number): Point | null {
    const origin: Point = [a.x, a.y];
    const destination = this.navigationPoint(goal) || this.g.point(goal);
    const length = Math.hypot(destination[0] - a.x, destination[1] - a.y);
    if (
      length < 4 + 8 * (a.persona?.directness ?? 0.8) &&
      this.lineClear(origin, destination)
    ) {
      return destination;
    }
    const k = this.g.index(a.x, a.y);
    if (k < 0 || field[k] < 0) return null;
    if (k === goal) return destination;
    const rank = (u: number, v: number): number =>
      field[u] - field[v] ||
      Math.abs(
        Math.atan2(this.g.point(u)[1] - a.y, this.g.point(u)[0] - a.x) -
          (a.heading || 0)
      ) -
        Math.abs(
          Math.atan2(this.g.point(v)[1] - a.y, this.g.point(v)[0] - a.x) -
            (a.heading || 0)
        );
    const options = this.g
      .neighbors(k)
      .filter(
        (n) =>
          field[n] >= 0 &&
          field[n] < field[k] + (a.stuck > 3 ? 2 : 0) &&
          this.navigationPoint(n)
      )
      .sort(rank);
    if (!options.length) return null;
    let next = options[0];
    let point = this.navigationPoint(next);
    for (let i = 0; i < 8; i++) {
      const candidates = this.g
        .neighbors(next)
        .filter(
          (n) =>
            field[n] >= 0 &&
            field[n] < field[next] &&
            this.navigationPoint(n)
        )
        .sort(rank);
      if (!candidates.length) break;
      const n = candidates[0];
      const p = this.navigationPoint(n);
      if (!p || !this.lineClear(origin, p)) break;
      next = n;
      point = p;
    }
    return point;
  }

  hashDensity(k: number): number {
    const p = this.g.point(k);
    return this.hash.get(this.key(p[0], p[1]))?.size || 0;
  }

  move(
    a: Agent,
    field: Int32Array | undefined,
    goal: number | undefined,
    dt: number,
    stopDistance = 0.45,
    precise: Point | null = null
  ): boolean {
    if (!field || goal === undefined) return false;
    const end = precise || this.g.point(goal);
    if (a.rebel && this.fenceSegments.length > 0) {
      if (this.stepRebelFenceCross(a, end)) return false;
      field = this.getRebelFlow(goal);
    }
    let target = this.nextCell(a, field, goal);
    if (!target) {
      if (a.rebel && this.fenceSegments.length > 0) {
        // Permite acercarse a la valla para intentar cruzarla cuando el campo normal está bloqueado
        target = end;
      } else {
        return false;
      }
    }
    if (precise && this.g.index(a.x, a.y) === goal) target = precise;
    if (Math.hypot(a.x - end[0], a.y - end[1]) < stopDistance) return true;
    const dx = target[0] - a.x;
    const dy = target[1] - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.05) return false;
    const distance = Math.min(a.speed * dt, length);
    const steps = Math.max(1, Math.ceil(distance / (a.r * 0.8)));
    let moved = 0;
    const oldX = a.x;
    const oldY = a.y;
    for (let i = 0; i < steps; i++) {
      const step = distance / steps;
      const ux = dx / length;
      const uy = dy / length;
      let choice: Point | null = null;
      for (const angle of [0, 0.55, -0.55, 1, -1, 1.57, -1.57, 2.1, -2.1]) {
        const cs = Math.cos(angle);
        const sn = Math.sin(angle);
        const x = a.x + (ux * cs - uy * sn) * step;
        const y = a.y + (ux * sn + uy * cs) * step;
        if (
          this.clearAt(x, y, a.id) &&
          field[this.g.index(x, y)] >= 0 &&
          field[this.g.index(x, y)] <= field[this.g.index(a.x, a.y)] + 1
        ) {
          choice = [x, y];
          break;
        }
      }
      if (!choice) break;
      this.remove(a);
      a.x = choice[0];
      a.y = choice[1];
      this.insert(a);
      moved += step;
    }
    if (moved) {
      a.heading = Math.atan2(a.y - oldY, a.x - oldX);
      recordMovement(this, a, oldX, oldY);
    }
    a.stuck = moved < distance * 0.12 ? a.stuck + dt : 0;
    if (a.stuck > 15) {
      const k = this.g.index(a.x, a.y);
      this.stalls[k] += dt;
      this.stats.stuckSeconds += dt;
      if (this.time - (a.lastPainTime || 0) > 60) {
        this.pain('cuello', k, '', a, a.stuck);
        a.lastPainTime = this.time;
      }
    }
    return Math.hypot(a.x - end[0], a.y - end[1]) < stopDistance;
  }

  startServices(): void {
    for (const b of this.stations) {
      if (!this.available(b)) continue;
      b.queue = b.queue.filter(
        (id) =>
          this.byId.get(id)?.state === 'queue' &&
          this.byId.get(id)?.target === b.id
      );
      const cover = this.s.infrastructure.find((o) => o.id === b.coverId);
      while (
        b.serving.length < b.capacity &&
        b.queue.length &&
        (!cover || (this.coverLoad.get(cover.id) || 0) < (cover.capacity || 0))
      ) {
        const id = b.queue.shift()!;
        const a = this.byId.get(id);
        if (!a) continue;
        const wait = this.time - a.waitStart;
        b.wait += wait;
        this.stats.waitingSeconds += wait;
        this.stats.servedWaitCount++;
        const occupied = new Set(
          b.serving.map((sId) => this.byId.get(sId)?.slot)
        );
        const slot = b.slots
          .filter((_q, i) => !occupied.has(i))
          .sort(
            (p, q) =>
              Math.hypot(p.x - a.x, p.y - a.y) -
              Math.hypot(q.x - a.x, q.y - a.y)
          )[0];
        if (!slot) {
          b.queue.unshift(a.id);
          break;
        }
        a.slot = b.slots.indexOf(slot);
        a.state = 'serviceWalk';
        a.slotField = this.getFlow(slot.cell);
        const weather = b.covered
          ? 1
          : this.s.base.weather === 'rain'
            ? 0.85
            : this.s.base.weather === 'wind'
              ? 0.9
              : 1;
        const eff = Math.max(0.1, this.s.base.availability / 100) * weather;
        a.serviceDuration = (b.minutes * 60) / eff;
        b.serving.push(a.id);
        if (cover) {
          this.coverLoad.set(cover.id, (this.coverLoad.get(cover.id) || 0) + 1);
        }
      }
    }
  }

  tick(dt = 0.5): void {
    if (this.finished) return;
    this.time = Math.min(this.duration + 1800, this.time + dt);
    if (this.time < this.duration) {
      this.accumulator +=
        (this.hourly[
          Math.min(this.hourly.length - 1, Math.floor(this.time / 3600))
        ] *
          dt) /
        3600;
      while (this.accumulator >= 1) {
        this.accumulator--;
        this.spawn();
      }
    }

    if (this.time >= this.duration && !this.closing) {
      this.closing = true;
      for (const a of this.agents) {
        if (
          ['walk', 'queue', 'roam', 'serviceWalk', 'shelter'].includes(a.state)
        ) {
          const station = this.stations.find((b) => b.id === a.target);
          if (station) {
            station.queue = station.queue.filter((id) => id !== a.id);
            station.serving = station.serving.filter((id) => id !== a.id);
            if (station.coverId) {
              this.coverLoad.set(
                station.coverId,
                Math.max(0, (this.coverLoad.get(station.coverId) || 0) - 1)
              );
            }
          }
          if (a.goals > 0) {
            a.failed += a.left;
            a.left = 0;
          }
          this.exit(a);
        }
      }
    }

    this.dining.update(dt);
    for (const a of this.agents) {
      if (a.state === 'gone' || a.state === 'transport') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((this.emergency as any)?.evacuation?.step(a, dt)) continue;
      if (yieldForPriority(this, a, dt)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((this.emergency as any)?.social?.step(a, dt)) continue;
      if (this.dining.step(a, dt)) continue;
      const k = this.g.index(a.x, a.y);
      if (k >= 0) this.trails[k] += dt;
      const b = this.stations.find((st) => st.id === a.target);
      seekShelter(this, a);

      if (a.state === 'shelter') {
        if (this.time >= a.deadline || this.time >= this.duration) {
          a.shelterId = null;
          this.exit(a);
        } else if (this.time >= (a.shelterUntil || 0)) {
          a.shelterId = null;
          this.assign(a);
        } else {
          this.move(a, a.shelterField, a.shelterCell, dt, 0.5);
          const sh = this.shelters.find((o) => o.id === a.shelterId);
          if (sh?.polygon && inside([a.x, a.y], sh.polygon)) {
            this.stats.shelterSeconds += dt;
          }
        }
      } else if (a.state === 'serviceWalk' && b) {
        const slot = a.slot !== undefined ? b.slots[a.slot] : undefined;
        if (
          slot &&
          this.move(a, a.slotField, slot.cell, dt, 0.15, [slot.x, slot.y])
        ) {
          a.state = 'service';
          a.done = this.time + (a.serviceDuration || 60);
        } else if (
          a.stuck >
          this.s.maxWait * 60 * (a.persona?.patience || 1)
        ) {
          b.serving = b.serving.filter((id) => id !== a.id);
          if (b.coverId) {
            this.coverLoad.set(
              b.coverId,
              Math.max(0, (this.coverLoad.get(b.coverId) || 0) - 1)
            );
          }
          a.failed++;
          a.left--;
          this.stats.abandoned++;
          this.pain('recorrido', k, b.name, a, a.stuck);
          this.assign(a);
        }
      } else if (a.state === 'roam') {
        if (this.time >= a.deadline) {
          this.exit(a);
        } else if (
          this.move(a, a.roamField, a.targetCell, dt, 0.6) ||
          this.time >= a.roamUntil
        ) {
          if (a.left > 0) this.assign(a);
          else this.roam(a);
        }
      } else if (a.state === 'service' && b && this.time >= (a.done || 0)) {
        b.serving = b.serving.filter((id) => id !== a.id);
        if (b.coverId) {
          this.coverLoad.set(
            b.coverId,
            Math.max(0, (this.coverLoad.get(b.coverId) || 0) - 1)
          );
        }
        b.served++;
        this.stats.served++;
        a.completed++;
        a.left--;
        let meal = false;
        if (
          ['commerce', 'food'].includes(b.type) &&
          this.random() <
            Math.min(
              1,
              (this.s.base.conversion / 100) * (a.persona?.purchaseFactor || 1)
            ) &&
          a.spent + Number(b.price ?? this.s.base.ticket) <=
            (a.persona?.budget ?? Infinity)
        ) {
          const sale = Number(b.price ?? this.s.base.ticket);
          a.spent += sale;
          b.sales += sale;
          this.stats.sales += sale;
          this.stats.transactions++;
          meal = b.type === 'food';
        }
        if (meal) this.dining.start(a);
        else this.assign(a);
      } else if (a.state === 'queue' && b) {
        if (k >= 0) this.stalls[k] += dt;
        if (
          this.time - a.waitStart >
            this.s.maxWait * 60 * (a.persona?.patience || 1) ||
          !this.available(b) ||
          this.time >= a.deadline
        ) {
          b.queue = b.queue.filter((id) => id !== a.id);
          b.abandoned++;
          this.stats.abandoned++;
          a.failed++;
          a.left--;
          this.pain(
            'espera',
            k,
            b.name,
            a,
            this.time - a.waitStart,
            this.time >= a.deadline
              ? 'agenda'
              : !this.available(b)
                ? 'horario'
                : 'paciencia'
          );
          this.assign(a);
        }
      } else if (a.state === 'walk') {
        if (!b || !this.available(b)) {
          this.assign(a);
          continue;
        }
        if (this.time >= a.deadline) {
          a.failed += a.left;
          a.left = 0;
          this.exit(a);
          continue;
        }
        if (
          this.move(
            a,
            a.approachField || b.field,
            a.approachCell ?? b.cell,
            dt,
            b.type === 'rest' ? 0.45 : Math.max(0.8, this.s.diameter),
            a.approachPoint
          )
        ) {
          a.state = 'queue';
          a.waitStart = this.time;
          b.queue.push(a.id);
        } else if (
          a.stuck >
          this.s.maxWait * 60 * (a.persona?.patience || 1)
        ) {
          a.failed++;
          a.left--;
          this.stats.abandoned++;
          this.pain('recorrido', k, b.name, a, a.stuck);
          this.assign(a);
        }
      } else if (a.state === 'exit') {
        const e = this.entries.find((en) => en.id === a.target);
        if (e && this.move(a, e.field, e.cell, dt, 0.65)) {
          this.depart(a);
        }
      } else if (a.state === 'trapped') {
        if (k >= 0) this.stalls[k] += dt;
        this.stats.stuckSeconds += dt;
      }
    }

    this.emergency.update(dt);
    this.stewards.step(dt);
    this.startServices();
    this.agents = this.agents.filter((a) => a.state !== 'gone');
    const counts = new Map<number, number>();
    for (const a of this.agents) {
      const k = this.g.index(a.x, a.y);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const [k, n] of counts) {
      if (k >= 0) this.peak[k] = Math.max(this.peak[k], n);
    }
    if (Math.floor(this.time / 60) !== Math.floor((this.time - dt) / 60)) {
      this.record();
    }
    if (
      this.closing &&
      (!this.agents.length || this.time >= this.duration + 1800)
    ) {
      this.finished = true;
      this.record();
    }
  }

  record(): void {
    this.history.push({
      time: this.time,
      present: this.agents.length,
      sales: this.stats.sales,
      satisfied: this.stats.satisfied,
      abandoned: this.stats.abandoned,
    });
    if (this.history.length > 1500) this.history.shift();
  }

  snapshot(): SimSnapshot {
    const waiting = this.agents.filter((a) => a.state === 'queue').length;
    const load = this.capacity ? this.agents.length / this.capacity : 0;
    const zones: ZoneMetric[] = Array.from({length: 6}, (_, i) => ({
      id: i,
      name: ['Noroeste', 'Norte', 'Noreste', 'Suroeste', 'Sur', 'Sureste'][i],
      present: 0,
      waiting: 0,
      area: 0,
      capacity: 0,
      load: 0,
    }));
    for (let k = 0; k < this.g.free.length; k++) {
      if (this.g.free[k]) {
        const p = this.g.point(k);
        const i =
          Math.min(2, Math.floor((p[0] / this.g.m.widthMeters) * 3)) +
          Math.min(1, Math.floor((p[1] / this.g.m.heightMeters) * 2)) * 3;
        zones[i].area += this.g.cell ** 2;
      }
    }
    for (const a of this.agents) {
      const i =
        Math.min(2, Math.floor((a.x / this.g.m.widthMeters) * 3)) +
        Math.min(1, Math.floor((a.y / this.g.m.heightMeters) * 2)) * 3;
      zones[i].present++;
      if (a.state === 'queue' || a.stuck > 15) zones[i].waiting++;
    }
    for (const z of zones) {
      z.capacity = Math.floor(
        (z.area * (1 - this.s.base.circulation / 100)) / this.s.base.space
      );
      z.load = z.capacity ? z.present / z.capacity : 0;
    }
    const days = 1;
    const infraCost =
      this.s.infrastructure.reduce((n, b) => n + (Number(b.cost) || 0), 0) *
      days;
    const rental =
      this.s.base.rent === 'paid'
        ? this.s.base.booths
            .filter((b) => ['food', 'commerce'].includes(b.type))
            .reduce((n, b) => n + b.area * this.s.base.rate, 0)
        : 0;
    const balance =
      this.s.base.funding +
      rental -
      this.s.base.organizerFixed -
      infraCost -
      (this.time / 3600) * this.s.base.organizerHourly;
    return {
      ...this.stats,
      time: this.time,
      present: this.agents.length,
      waiting,
      load,
      capacity: this.capacity,
      area: this.g.area,
      zones,
      balance,
      infraCost,
      averageWait: this.stats.servedWaitCount
        ? this.stats.waitingSeconds / this.stats.servedWaitCount / 60
        : 0,
      completion:
        this.stats.satisfied + this.stats.dissatisfied
          ? this.stats.satisfied /
            (this.stats.satisfied + this.stats.dissatisfied)
          : null,
    };
  }

  location(cell: number): string {
    const [x, y] = this.g.point(cell);
    const near = this.stations
      .map((b) => ({
        name: b.name,
        d: Math.hypot(
          x - (b.x * this.g.m.widthMeters) / 100,
          y - (b.y * this.g.m.heightMeters) / 100
        ),
      }))
      .sort((a, b) => a.d - b.d)[0];
    return (
      (near && near.d < 25
        ? 'Entorno de ' + near.name
        : y < this.g.m.heightMeters / 2
          ? 'Sector norte'
          : 'Sector sur') +
      ' · ' +
      Math.round(x) +
      ' m E / ' +
      Math.round(y) +
      ' m S desde origen del plano'
    );
  }

  report(): PainPoint[] {
    const suggestions: Record<string, [string, string]> = {
      acceso: [
        'Acceso bloqueado o saturado',
        'Separar entrada y salida, repartir las llegadas o ampliar el paso previsto.',
      ],
      cuello: [
        'Movimiento retenido',
        'Retirar módulos del paso, ensanchar la separación entre vallas o crear una alternativa.',
      ],
      espera: [
        'Abandono de cola',
        'Aumentar atención simultánea, simplificar el servicio o repartir la demanda.',
      ],
      recorrido: [
        'Objetivo difícil de alcanzar',
        'Acercar la actividad a un acceso conectado y despejar su zona de aproximación.',
      ],
      sin_salida: [
        'Salida sin recorrido conectado',
        'Abrir un paso continuo entre el área y alguno de los accesos.',
      ],
      oferta: [
        'Interés sin oferta disponible',
        'Ajustar horarios o añadir la actividad que busca este perfil.',
      ],
      valla: [
        'Intentos de saltar vallas',
        'Abrir un paso peatonal cercano, reorientar las vallas sueltas o reforzar la vigilancia.',
      ],
    };
    return [...this.pains.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((p) => ({
        ...p,
        title: suggestions[p.type]?.[0] || p.type,
        solution: suggestions[p.type]?.[1] || '',
        point: this.g.point(p.cell),
        location: this.location(p.cell),
      }));
  }
}
