/**
 * @module engine/emergency/evacuation
 * Caution perimeter and venue evacuation routing model for simulated emergencies.
 */
import type {Agent, EmergencyIncident, Point} from '../../types';
import {flow} from '../crowd/grid-flow';

export interface EvacuationOrder {
  id: string | number;
  whole: boolean;
  point: Point;
  radius: number;
  time: number;
}

export interface EvacuationTask {
  order: EvacuationOrder;
  fields: Array<{gate: any; field: Int32Array}>;
  escape?: Array<{gate: any; field: Int32Array}>;
  react: number;
  started?: boolean;
  blocked?: boolean;
}

export class Evacuation {
  e: any;
  orders: EvacuationOrder[];
  pending: Map<number, EvacuationTask>;
  stats: {warned: number; departed: number; blocked: number};

  constructor(e: any) {
    this.e = e;
    this.orders = [];
    this.pending = new Map();
    this.stats = {warned: 0, departed: 0, blocked: 0};
  }

  order(row: EmergencyIncident | null, whole = false): void {
    if (
      this.orders.some(
        (o) => o.id === (row?.id || 'all') && o.whole === whole
      )
    ) {
      return;
    }
    const e = this.e;
    const radius =
      row && typeof e.emergency?.fire?.getSafetyRadius === 'function'
        ? e.emergency.fire.getSafetyRadius(row)
        : Math.max(3, Math.min(50, e.s.incidentRadius ?? 8));
    const point: Point = row?.point || [0, 0];
    const free = e.g.free.slice();
    for (let k = 0; k < free.length; k++) {
      const p = e.g.point(k);
      if (Math.hypot(p[0] - point[0], p[1] - point[1]) < radius) free[k] = 0;
    }
    const grid = {...e.g, free};
    const exits = e.entries.filter(
      (g: any) =>
        ['out', 'both', 'free'].includes(g.phases?.event || g.role || 'both') &&
        free[g.cell]
    );
    const fields = exits.map((g: any) => ({gate: g, field: flow(grid, g.cell)}));
    const order: EvacuationOrder = {
      id: row?.id || 'all',
      whole,
      point,
      radius,
      time: e.time,
    };
    this.orders.push(order);
    for (const a of e.agents as Agent[]) {
      if (
        ['gone', 'incident', 'transport'].includes(a.state || '') ||
        this.pending.has(a.id)
      ) {
        continue;
      }
      if (
        !whole &&
        Math.hypot(a.x - point[0], a.y - point[1]) > radius * 2
      ) {
        continue;
      }
      const profile = e.emergency.social.profile(a);
      this.pending.set(a.id, {order, fields, react: e.time + profile.delay});
      this.stats.warned++;
    }
  }

  step(a: Agent, dt: number): boolean {
    const task = this.pending.get(a.id);
    const e = this.e;
    if (!task) return false;
    if (e.time < task.react) return false;
    if (!task.started) {
      for (const b of e.stations) {
        b.queue = b.queue.filter((id: number) => id !== a.id);
        const served = b.serving.includes(a.id);
        b.serving = b.serving.filter((id: number) => id !== a.id);
        if (served && b.coverId) {
          e.coverLoad.set(
            b.coverId,
            Math.max(0, (e.coverLoad.get(b.coverId) || 0) - 1)
          );
        }
      }
      e.dining?.release(a);
      task.started = true;
      a.state = 'evacuating';
    }
    const here = e.g.index(a.x, a.y);
    const rank = task.fields
      .filter((o) => o.field[here] >= 0)
      .sort((x, y) => x.field[here] - y.field[here]);
    let chosen = rank[0];
    let field: Int32Array;
    if (chosen) {
      field = chosen.field;
      const gatePt = e.g.point(chosen.gate.cell);
      if (Math.hypot(a.x - gatePt[0], a.y - gatePt[1]) < 0.8) {
        this.pending.delete(a.id);
        e.depart(a);
        this.stats.departed++;
        return true;
      }
    } else {
      const choices =
        task.escape ||
        (task.escape = task.fields
          .map((f) => {
            const distance = f.field.slice();
            for (let k = 0; k < distance.length; k++) {
              if (distance[k] < 0 && e.g.free[k]) {
                const p = e.g.point(k);
                const d = Math.hypot(
                  p[0] - task.order.point[0],
                  p[1] - task.order.point[1]
                );
                if (d < task.order.radius) {
                  distance[k] =
                    100000 + Math.ceil((task.order.radius - d) / e.g.cell);
                }
              }
            }
            return {...f, field: distance};
          })
          .filter((o) => o.field[here] >= 0));
      chosen = choices[0];
      if (!chosen) {
        if (!task.blocked) {
          task.blocked = true;
          this.stats.blocked++;
        }
        return true;
      }
      field = chosen.field;
    }
    const neighbors = e.g
      .neighbors(here)
      .filter((k: number) => field[k] >= 0 && field[k] < field[here])
      .sort((x: number, y: number) => field[x] - field[y]);
    if (neighbors.length) {
      e.move(a, field, neighbors[0], dt, 0.25);
    } else if (!task.blocked) {
      task.blocked = true;
      this.stats.blocked++;
    }
    return true;
  }

  svg(): string {
    const fencedCordons: Array<{rowId: string | number; center: [number, number]}> =
      (this.e.emergency?.fire?.cordons || []).filter(
        (c: {state: string}) =>
          c.state === 'fenced' ||
          c.state === 'cleanup' ||
          c.state === 'inspection' ||
          c.state === 'reopened'
      );
    return this.orders
      .filter(
        (o) =>
          !fencedCordons.some(
            (c) =>
              c.rowId === o.id ||
              Math.hypot(c.center[0] - o.point[0], c.center[1] - o.point[1]) <= 1
          )
      )
      .map(
        (o) =>
          '<circle cx="' +
          o.point[0] +
          '" cy="' +
          o.point[1] +
          '" r="' +
          o.radius +
          '" fill="#e9866830" stroke="#b53438" stroke-width=".5" stroke-dasharray="1.5 1"/><text x="' +
          o.point[0] +
          '" y="' +
          (o.point[1] - o.radius - 2) +
          '" font-size="1.7" text-anchor="middle" fill="#8c243a">Zona de precaución · hipótesis ' +
          o.radius +
          ' m</text>'
      )
      .join('');
  }
}
