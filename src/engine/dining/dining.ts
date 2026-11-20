/**
 * @module engine/dining/dining
 * Subsistema de comedor: búsqueda de asiento, mesas mojadas por lluvia y cuadrilla de secado.
 */
import {inside, rect} from '../cartography/geometry';
import {picnicSlots} from './furniture';
import type {Point2D} from '../../types';

export interface DiningTableState {
  id: string;
  name: string;
  o: Record<string, any>;
  polygon: Point2D[];
  slots: Array<{x: number; y: number}>;
  wet: number;
  lastDried: number;
}

/**
 * Gestiona las comidas de los visitantes, la ocupación de mesas picnic y el secado en lluvia.
 */
export class Dining {
  e: any;
  tables: DiningTableState[];
  cleaners: Array<Record<string, any>>;
  stats: {
    meals: number;
    seated: number;
    standing: number;
    seatWait: number;
    dried: number;
  };

  constructor(e: any) {
    this.e = e;
    this.tables = e.s.infrastructure
      .filter((o: any) => o.kind === 'picnic')
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        o,
        polygon: rect(o, e.g.m),
        slots: picnicSlots(
          o,
          e.g.m,
          (x, y) => e.staticClearAt(x, y),
          e.s.diameter,
        ).slice(0, Math.max(0, o.capacity ?? 6)),
        wet: 0,
        lastDried: -Infinity,
      }));
    this.cleaners = Array.from(
      {length: Math.max(0, Math.min(10, e.s.dryStaff ?? 1))},
      () => ({
        x: e.entries[0] ? e.g.point(e.entries[0].cell)[0] : 0,
        y: e.entries[0] ? e.g.point(e.entries[0].cell)[1] : 0,
        target: null,
      }),
    );
    this.stats = {meals: 0, seated: 0, standing: 0, seatWait: 0, dried: 0};
  }

  covered(t: DiningTableState): boolean {
    return this.e.s.infrastructure.some(
      (o: any) =>
        o.role === 'cover' &&
        t.polygon.every(p => inside(p, rect(o, this.e.g.m))),
    );
  }

  release(a: Record<string, any>) {
    delete a.diningSeat;
    delete a.diningTable;
  }

  start(a: Record<string, any>) {
    this.stats.meals++;
    a.mealSeconds =
      60 *
      ((this.e.s.mealMin ?? 10) +
        this.e.random() *
          Math.max(0, (this.e.s.mealMax ?? 20) - (this.e.s.mealMin ?? 10)));
    a.foodSince = this.e.time;
    a.state = 'mealSearch';
    a.lastSeatSearch = -Infinity;
  }

  update(dt: number) {
    const e = this.e;
    const rain = e.s.base.weather === 'rain';
    const horizontal = e.s.horizontalRain === true;
    for (const t of this.tables) {
      if (rain && (!this.covered(t) || horizontal)) {
        t.wet = Math.min(1, t.wet + dt / (this.covered(t) ? 240 : 45));
      } else {
        t.wet = Math.max(0, t.wet - dt / 900);
      }
    }
    for (const c of this.cleaners) {
      let t = this.tables.find(tbl => tbl.id === c.target);
      if (!t || t.wet < 0.1) {
        c.target = null;
        t = this.tables
          .filter(
            tbl =>
              tbl.wet > 0.25 &&
              e.time - tbl.lastDried > 45 &&
              !this.cleaners.some(o => o !== c && o.target === tbl.id),
          )
          .sort((a, b) => b.wet - a.wet)[0];
        if (!t) continue;
        const slot = t.slots[0];
        if (!slot) continue;
        const cell = e.g.index(c.x, c.y);
        const field = e.getFlow(e.g.index(slot.x, slot.y));
        if (cell < 0 || field[cell] < 0) continue;
        c.target = t.id;
        c.field = field;
        c.cell = e.g.index(slot.x, slot.y);
        c.point = [slot.x, slot.y];
        c.r = e.s.diameter / 2;
        c.speed = 1;
        c.id = 'dry' + this.cleaners.indexOf(c);
      }
      if (Math.hypot(c.x - c.point[0], c.y - c.point[1]) > 0.6) {
        e.move(c, c.field, c.cell, dt, 0.5, c.point);
      } else {
        c.work = (c.work || 0) + dt;
        if (c.work >= (e.s.drySeconds ?? 45)) {
          t.wet = 0;
          t.lastDried = e.time;
          c.work = 0;
          c.target = null;
          this.stats.dried++;
        }
      }
    }
  }

  step(a: Record<string, any>, dt: number): boolean {
    const e = this.e;
    if (!['mealSearch', 'mealWalk', 'eating', 'mealStanding'].includes(a.state)) {
      return false;
    }
    if (a.state === 'mealSearch') {
      if (e.time - a.lastSeatSearch >= 10) {
        a.lastSeatSearch = e.time;
        const k = e.g.index(a.x, a.y);
        const occupied = new Set(
          e.agents.filter((o: any) => o.diningSeat).map((o: any) => o.diningSeat),
        );
        const options = this.tables
          .filter(t => t.wet < 0.25)
          .flatMap(t =>
            t.slots.map((slot, i) => ({t, slot, key: t.id + ':' + i})),
          )
          .filter(
            o =>
              !occupied.has(o.key) &&
              e.getFlow(e.g.index(o.slot.x, o.slot.y))[k] >= 0,
          )
          .sort(
            (a1, b) =>
              Math.hypot(a.x - a1.slot.x, a.y - a1.slot.y) -
              Math.hypot(a.x - b.slot.x, a.y - b.slot.y),
          );
        const seat = options[0];
        if (seat) {
          a.diningSeat = seat.key;
          a.diningTable = seat.t.id;
          a.diningPoint = [seat.slot.x, seat.slot.y];
          a.diningCell = e.g.index(...a.diningPoint);
          a.state = 'mealWalk';
        }
      }
      if (e.time - a.foodSince >= (e.s.seatWaitMin ?? 3) * 60) {
        a.state = 'mealStanding';
        a.eatUntil = e.time + a.mealSeconds;
        this.stats.standing++;
        e.pain(
          'espera',
          e.g.index(a.x, a.y),
          'Sin mesa seca para comer',
          a,
          e.time - a.foodSince,
        );
        this.stats.seatWait += e.time - a.foodSince;
      }
      return true;
    }
    if (a.state === 'eating') {
      const table = this.tables.find(t => t.id === a.diningTable);
      if (table && table.wet >= 0.25) {
        a.mealSeconds = Math.max(1, a.eatUntil - e.time);
        this.release(a);
        a.state = 'mealSearch';
        a.foodSince = e.time;
        a.lastSeatSearch = -Infinity;
        return true;
      }
    }
    if (a.state === 'mealWalk') {
      const t = this.tables.find(tbl => tbl.id === a.diningTable);
      if (!t || t.wet >= 0.25) {
        this.release(a);
        a.state = 'mealSearch';
        return true;
      }
      if (
        e.move(
          a,
          e.getFlow(a.diningCell),
          a.diningCell,
          dt,
          0.4,
          a.diningPoint,
        )
      ) {
        a.state = 'eating';
        a.eatUntil = e.time + a.mealSeconds;
        this.stats.seated++;
        this.stats.seatWait += e.time - a.foodSince;
      } else if (e.time - a.foodSince > 600) {
        this.release(a);
        a.state = 'mealSearch';
      }
      return true;
    }
    if (e.time >= a.eatUntil) {
      this.release(a);
      e.assign(a);
    }
    return true;
  }

  summary() {
    const e = this.e;
    const food = e.stations.filter(
      (o: any) => o.type === 'food' && e.available(o),
    );
    const seats = this.tables.reduce(
      (n, t) => n + (t.wet < 0.25 ? t.slots.length : 0),
      0,
    );
    const mean = ((e.s.mealMin ?? 10) + (e.s.mealMax ?? 20)) / 2;
    return {
      ...this.stats,
      tables: this.tables.length,
      seats,
      wet: this.tables.filter(t => t.wet >= 0.25).length,
      occupied: e.agents.filter((a: any) => a.state === 'eating').length,
      foodHourly: food.reduce(
        (n: number, b: any) => n + (b.capacity * 60) / b.minutes,
        0,
      ),
      seatHourly: (seats * 60) / Math.max(1, mean),
    };
  }

  svg(): string {
    return (
      this.tables
        .map(t => {
          const [x, y] = [
            (t.o.x * this.e.g.m.widthMeters) / 100,
            (t.o.y * this.e.g.m.heightMeters) / 100,
          ];
          return (
            '<text x="' +
            x +
            '" y="' +
            (y - 2) +
            '" font-size="1.2" text-anchor="middle" fill="' +
            (t.wet >= 0.25 ? '#147aaa' : '#335637') +
            '">' +
            (t.wet >= 0.25
              ? 'Mojada'
              : this.e.agents.filter((a: any) => a.diningTable === t.id)
                  .length +
                '/' +
                t.slots.length) +
            '</text>'
          );
        })
        .join('') +
      this.cleaners
        .filter(c => c.target)
        .map(
          c =>
            '<g><circle cx="' +
            c.x +
            '" cy="' +
            c.y +
            '" r=".5" fill="#863c96"/><text x="' +
            c.x +
            '" y="' +
            (c.y - 1) +
            '" font-size="1.4">Secado</text></g>',
        )
        .join('')
    );
  }
}
