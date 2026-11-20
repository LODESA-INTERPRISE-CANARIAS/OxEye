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

export class FireModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  nodes: Map<string, FireNode>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workers: any[];
  usedExtinguishers: Set<string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.nodes = new Map();
    this.workers = [];
    this.usedExtinguishers = new Set();
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
    for (const n of this.nodes.values()) {
      if (n.rowId === row.id) n.burning = false;
    }
    if (row.extinguisherWorker) this.e.remove(row.extinguisherWorker);
    row.localTeam = 0;
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
    return html;
  }
}
