/**
 * @module engine/emergency/fire-model
 * Geometric fire damage, structural spread, and trained extinguisher worker intervention model.
 */
import type {EmergencyIncident} from '../../types';
import {inside, rect} from '../cartography/geometry';

export interface FireNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  o: any;
  rowId: string | number;
  litAt: number;
  damage: number;
  burning: boolean;
  exposure: Map<string, number>;
}

export interface FireCordon {
  id: string;
  rowId: string | number;
  center: [number, number];
  radius: number;
  state: 'approaching' | 'installing' | 'fenced' | 'cleanup' | 'reopened';
  startedAt: number;
  installAt: number;
  installDuration: number;
  fencedAt?: number;
  cleanupAt?: number;
  blockedApplied: boolean;
  blockedCells?: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  crew: any[];
  targetCell: number;
  field: Int32Array | null;
}

export class FireModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  nodes: Map<string, FireNode>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workers: any[];
  usedExtinguishers: Set<string>;
  cordons: FireCordon[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.nodes = new Map();
    this.workers = [];
    this.usedExtinguishers = new Set();
    this.cordons = [];
  }

  start(row: EmergencyIncident): void {
    const source = this.e.s.base.booths.find(
      (o: {id: string}) => o.id === row.stationId
    );
    if (source) this.ignite(source, row);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ignite(o: any, row: EmergencyIncident): void {
    if (this.nodes.has(o.id)) return;
    this.nodes.set(o.id, {
      o,
      rowId: row.id,
      litAt: this.e.time,
      damage: 0,
      burning: true,
      exposure: new Map(),
    });
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

  isClosed(id: string): boolean {
    const node = this.nodes.get(id);
    if (node && (node.burning || node.damage > 0)) return true;
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
    const source = e.s.base.booths.find(
      (o: {id: string}) => o.id === row.stationId
    );
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

  extinguish(row: EmergencyIncident): void {
    let hadDamage = false;
    for (const n of this.nodes.values()) {
      if (n.rowId === row.id) {
        n.burning = false;
        if (n.damage > 0) hadDamage = true;
      }
    }
    if (row.extinguisherWorker) this.e.remove(row.extinguisherWorker);
    row.localTeam = 0;
    if (hadDamage || row.point) {
      this.scheduleCordon(row);
    }
  }

  /**
   * Despliega un equipo de montaje tras extinguir el incendio para vallar
   * perimetralmente el círculo afectado y evitar el paso sobre las cenizas.
   */
  scheduleCordon(row: EmergencyIncident): void {
    if (this.cordons.some((c) => c.rowId === row.id)) return;
    const e = this.e;
    const rowNodes = [...this.nodes.values()].filter((n) => n.rowId === row.id);
    let cx = row.point?.[0];
    let cy = row.point?.[1];
    let radius = 5.5;
    if (rowNodes.length) {
      const n0 = rowNodes[0];
      if (cx == null || cy == null) {
        cx = (n0.o.x * e.g.m.widthMeters) / 100;
        cy = (n0.o.y * e.g.m.heightMeters) / 100;
      }
      const maxDim = Math.max(
        ...rowNodes.map((n) => Math.max(n.o.width || 3, n.o.depth || 3))
      );
      radius = Math.max(4.5, Math.min(8, maxDim * 0.65 + 2.5));
    }
    if (cx == null || cy == null) return;

    const perimeterPt: [number, number] = [cx + radius + 0.6, cy];
    const goal =
      e.g.nearest(perimeterPt[0], perimeterPt[1], 10) >= 0
        ? e.g.nearest(perimeterPt[0], perimeterPt[1], 10)
        : e.g.nearest(cx, cy, 12);
    if (goal < 0) return;

    const field = e.getFlow(goal);
    // Origen del equipo de montaje: acceso más cercano o punto transitable
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
      state: 'approaching',
      startedAt: e.time,
      installAt: 0,
      installDuration: 180,
      blockedApplied: false,
      crew,
      targetCell: goal,
      field,
    });
    row.note =
      (row.note ? row.note + ' · ' : '') +
      'Equipo de montaje en camino para vallar el círculo de cenizas.';
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
    // Desalojar visitantes que estuvieran dentro del círculo de cenizas
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
      if (c.state === 'approaching') {
        let arrivedCount = 0;
        for (const w of c.crew) {
          if (c.field && c.targetCell >= 0) {
            const reached = e.move(w, c.field, c.targetCell, dt, 0.7);
            if (reached || Math.hypot(w.x - c.center[0], w.y - c.center[1]) <= c.radius + 1.4) {
              arrivedCount++;
            }
          } else {
            arrivedCount++;
          }
        }
        if (arrivedCount >= c.crew.length || e.time - c.startedAt >= 120) {
          c.state = 'installing';
          c.installAt = e.time;
          for (const w of c.crew) e.remove(w);
          if (row) {
            row.note =
              'Equipo de montaje instalando vallas perimetrales alrededor de las cenizas.';
          }
        }
      } else if (c.state === 'installing') {
        const elapsed = e.time - c.installAt;
        const progress = Math.min(1, elapsed / c.installDuration);
        // Posicionar a los 2 operarios recorriendo el perímetro mientras montan las vallas
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
            row.note =
              'Zona de cenizas vallada perimetralmente por el equipo de montaje; paso bloqueado.';
          }
        }
      } else if (c.state === 'fenced' && c.fencedAt != null && e.time - c.fencedAt >= 360) {
        c.state = 'cleanup';
        c.cleanupAt = e.time;
        if (row) {
          row.note = 'Retirada de restos y enfriamiento de la zona afectada en curso.';
        }
      } else if (c.state === 'cleanup' && c.cleanupAt != null && e.time - c.cleanupAt >= 180) {
        c.state = 'reopened';
        for (const k of c.blockedCells || []) {
          e.g.free[k] = 1;
        }
        e.flow?.clear?.();
        if (row) {
          row.note = 'Restos retirados; perímetro reabierto al tránsito.';
        }
      }
    }
  }

  update(dt: number, events: EmergencyIncident[]): void {
    const e = this.e;
    const objects = [
      ...e.s.base.booths,
      ...e.s.infrastructure.filter(
        (o: {role?: string; kind?: string}) =>
          o.role === 'cover' || o.kind === 'picnic'
      ),
    ];
    for (const n of [...this.nodes.values()]) {
      if (!n.burning) continue;
      const row = events.find((r) => r.id === n.rowId);
      if (!row || row.status === 'resolved') {
        n.burning = false;
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
      if (n.damage >= 1) n.burning = false;
      if (suppressed || e.time - n.litAt < (e.s.fireSpreadSeconds ?? 120)) {
        continue;
      }
      const a = rect(n.o, e.g.m);
      const ac: [number, number] = [
        (n.o.x * e.g.m.widthMeters) / 100,
        (n.o.y * e.g.m.heightMeters) / 100,
      ];
      for (const o of objects) {
        if (this.nodes.has(o.id) || o.id === n.o.id) continue;
        const b = rect(o, e.g.m);
        const gap = Math.min(
          ...a.flatMap((p) =>
            b.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]))
          )
        );
        const contains =
          inside(ac, b) ||
          inside(
            [(o.x * e.g.m.widthMeters) / 100, (o.y * e.g.m.heightMeters) / 100],
            a
          );
        if (contains || gap <= (e.s.fireSpreadGap ?? 3)) {
          const exposure = (n.exposure.get(o.id) || 0) + dt;
          n.exposure.set(o.id, exposure);
          if (exposure >= 30) {
            this.ignite(o, row);
            row.note =
              'Propagación a ' +
              o.name +
              '. Urge revisar el acceso de bomberos.';
          }
        }
      }
    }
    for (const row of events.filter(
      (r) => r.type === 'fire' && r.status !== 'resolved'
    )) {
      if (
        ![...this.nodes.values()].some(
          (n) => n.rowId === row.id && n.burning
        ) &&
        this.nodes.size
      ) {
        row.fireOutcome = 'Combustión agotada; daños en estructuras';
        e.emergency.resolve(row);
      }
    }
    this.updateCordons(dt, events);
  }

  svg(): string {
    const e = this.e;
    let html = '';
    for (const n of this.nodes.values()) {
      const poly = rect(n.o, e.g.m);
      const [x, y] = [
        (n.o.x * e.g.m.widthMeters) / 100,
        (n.o.y * e.g.m.heightMeters) / 100,
      ];
      html +=
        '<polygon points="' +
        poly.map((p) => p.join(',')).join(' ') +
        '" fill="' +
        (n.damage >= 1 ? '#353039' : '#d7562c') +
        '" fill-opacity="' +
        (n.damage >= 1 ? 1 : 0.2 + n.damage * 0.7) +
        '" stroke="#7c2531" stroke-width=".3"/><text x="' +
        x +
        '" y="' +
        (y - 1) +
        '" font-size="1.4" text-anchor="middle" fill="' +
        (n.damage >= 1 ? 'white' : '#682630') +
        '">' +
        (n.damage >= 1
          ? 'Destruida'
          : Math.round(n.damage * 100) + ' % de daño') +
        '</text>';
      if (n.burning) {
        html +=
          '<path transform="translate(' +
          x +
          ' ' +
          y +
          ')" d="M-1 1Q-2 -1 0 -3Q0 -1 1 -2Q3 1 0 2Z" fill="#f6a42b"/>';
      }
    }
    for (const row of e.emergency.events as EmergencyIncident[]) {
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
      if (c.state === 'installing' || c.state === 'fenced' || c.state === 'cleanup') {
        const segs = 12;
        const progress =
          c.state === 'fenced' || c.state === 'cleanup'
            ? 1
            : Math.max(0.15, Math.min(1, (e.time - c.installAt) / c.installDuration));
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
          c.state === 'cleanup'
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
