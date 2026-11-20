import type {EmergencyIncident, Infrastructure, Scene} from '../../types';
import {advancePriority, inVehicle, priorityRoute} from './priority';

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
 * Dictionary of emergency incident definitions for simulation testing.
 */
export const INCIDENTS: Record<
  string,
  {
    name: string;
    service: 'medical' | 'fire' | 'security';
    duration: number;
    question: string;
  }
> = {
  fall: {
    name: 'Caída de una persona',
    service: 'medical',
    duration: 240,
    question: '¿Se identifica el punto y hay un recorrido hasta la persona?',
  },
  cut: {
    name: 'Corte en un puesto',
    service: 'medical',
    duration: 180,
    question: '¿Quién avisa y cómo llega el equipo de primera atención?',
  },
  fire: {
    name: 'Incendio en cocina · hipótesis',
    service: 'fire',
    duration: 360,
    question:
      '¿Se detiene la actividad afectada y queda libre el acceso reservado?',
  },
  conflict: {
    name: 'Conflicto entre asistentes',
    service: 'security',
    duration: 240,
    question:
      '¿Hay personal previsto y una vía de coordinación sin ocupar los pasos?',
  },
  minor: {
    name: 'Malestar leve · supuesto',
    service: 'medical',
    duration: 60,
    question:
      '¿Puede atenderse sin dejar sin cobertura otras incidencias?',
  },
  orientation: {
    name: 'Consulta de orientación',
    service: 'security',
    duration: 45,
    question:
      '¿Hay personal disponible para orientar y mantener su patrulla?',
  },
  obstacle: {
    name: 'Aviso de obstáculo en un paso',
    service: 'security',
    duration: 90,
    question: '¿Se protege el paso y se solicita su retirada?',
  },
};

/**
 * Ensures default emergency response resources and gate are present in a scene.
 *
 * @param s - Scene to enrich.
 * @returns Updated scene.
 */
export function ensureEmergencyResources(s: Scene): Scene {
  s.emergency ??= {random: false, rate: 2, sirens: true, vehicleSpeed: 1.5};
  if (s.infrastructure.some((o) => o.role === 'emergency')) return s;
  const cristo = s.site === 'cristo';
  const entry = s.entrances[0] || {x: 50, y: 50};
  const x = cristo ? 62 : entry.x;
  const y = cristo ? 54 : entry.y;
  const add = (
    kind: string,
    name: string,
    dx: number,
    dy: number,
    width: number,
    depth: number,
    staff: number,
    teams: number
  ) =>
    s.infrastructure.push({
      id: 'response-' + kind,
      role: 'emergency',
      kind,
      name,
      x: Math.max(3, Math.min(96, x + dx)),
      y: Math.max(3, Math.min(96, y + dy)),
      width,
      depth,
      rotation: 0,
      capacity: teams,
      staff,
      delay: 60,
      handling: 240,
      active: true,
      cost: 0,
    });
  add('medical', 'Primera atención · supuesto', 0, 0, 4, 3, 2, 1);
  add('ambulance', 'Ambulancia · reserva propuesta', -1, 9, 2.5, 6, 2, 1);
  add('security', 'Seguridad · punto de equipo', -1, -9, 4, 3, 4, 2);
  add('fire', 'Bomberos · reserva propuesta', -3, 16, 3, 8, 4, 1);
  add('coordination', 'Coordinación del ensayo', -6, -9, 3, 3, 1, 1);
  if (cristo && !s.entrances.some((o) => o.id === 'gate-emergency')) {
    s.entrances.push({
      id: 'gate-emergency',
      name: 'Acceso reservado · emergencias',
      x: 62,
      y: 57,
      clearWidth: 4.5,
      role: 'emergency',
      phases: {setup: 'vehicles', event: 'emergency', strike: 'vehicles'},
    });
  }
  return s;
}

/**
 * Base emergency response simulation laboratory.
 */
export class EmergencyLab {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  events: EmergencyIncident[];
  next: number;
  seed?: number;
  random: () => number;
  nextRandom: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  watch?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.events = [];
    this.next = 1;
    this.random = () => {
      this.seed =
        (((this.seed ?? e.s.seed ^ 541) * 1664525 + 1013904223) >>> 0);
      return this.seed / 4294967296;
    };
    this.nextRandom = 60;
  }

  resources(): Infrastructure[] {
    return this.e.s.infrastructure.filter(
      (o: Infrastructure) => o.role === 'emergency'
    );
  }

  inject(
    type: string,
    sourceId: string | null = null
  ): EmergencyIncident | null {
    const e = this.e;
    const spec = INCIDENTS[type];
    if (!spec || this.events.length >= 100 || e.finished) return null;
    const eligible = e.stations.filter(
      (o: {id: string; type: string}) =>
        o.type === (type === 'fire' ? 'food' : 'commerce') &&
        !this.isClosed(o.id)
    );
    const station = ['fire', 'cut'].includes(type)
      ? eligible.find((o: {id: string}) => o.id === sourceId) ||
        eligible[Math.floor(this.random() * eligible.length)]
      : null;
    if ((type === 'fire' || type === 'cut') && !station) return null;
    const people = e.agents.filter(
      (o: {state: string; persona?: {age: number}}) =>
        o.state !== 'gone' &&
        o.state !== 'incident' &&
        (type !== 'conflict' || (o.persona?.age ?? 18) >= 18)
    );
    const agent = station
      ? null
      : people[Math.floor(this.random() * people.length)];
    const anchor =
      station?.cell ??
      (agent ? e.g.index(agent.x, agent.y) : e.entries[0]?.cell);
    if (anchor === undefined || anchor === null || anchor < 0) return null;
    const row: EmergencyIncident = {
      id: this.next++,
      type,
      name: spec.name,
      created: e.time,
      cell: anchor,
      point: e.g.point(anchor),
      stationId: station?.id,
      agentId: agent?.id,
      status: 'pending',
      question: spec.question,
    };
    this.events.push(row);
    if (agent) {
      const prior = e.stations.find(
        (o: {id: string}) => o.id === agent.target
      );
      if (prior) {
        const wasServing = prior.serving.includes(agent.id);
        prior.queue = prior.queue.filter((id: number) => id !== agent.id);
        prior.serving = prior.serving.filter((id: number) => id !== agent.id);
        if (prior.coverId && wasServing) {
          e.coverLoad.set(
            prior.coverId,
            Math.max(0, (e.coverLoad.get(prior.coverId) || 0) - 1)
          );
        }
      }
      agent.state = 'incident';
    }
    if (station) {
      const ids = [...station.queue, ...station.serving];
      station.queue = [];
      station.serving = [];
      if (station.coverId) {
        e.coverLoad.set(
          station.coverId,
          Math.max(0, (e.coverLoad.get(station.coverId) || 0) - ids.length)
        );
      }
      for (const id of ids) {
        const a = e.byId.get(id);
        if (a) {
          a.failed++;
          a.left = Math.max(0, a.left - 1);
          e.roam(a);
        }
      }
    }
    return row;
  }

  isClosed(id: string): boolean {
    return this.events.some(
      (o) => o.stationId === id && o.status !== 'resolved'
    );
  }

  update(dt: number): void {
    const e = this.e;
    if (
      e.s.emergency?.random &&
      e.time >= this.nextRandom &&
      e.time < e.duration
    ) {
      this.nextRandom = e.time + 60;
      const chance =
        (Math.max(0, Math.min(100, e.s.emergency.rate ?? 2)) *
          e.agents.length) /
        60000;
      if (this.random() < chance) {
        const keys = Object.keys(INCIDENTS) as Array<
          'fall' | 'cut' | 'fire' | 'conflict'
        >;
        this.inject(keys[Math.floor(this.random() * 4)]);
      }
    }

    for (const row of this.events) {
      const spec = INCIDENTS[row.type];
      if (row.status === 'pending' || row.status === 'waiting') {
        const options = this.resources()
          .filter(
            (o) =>
              o.active !== false &&
              (+(o.staff || 0) || 0) > 0 &&
              o.kind ===
                (e.s.emergency?.sirens && row.type === 'fall'
                  ? 'ambulance'
                  : spec.service)
          )
          .filter(
            (o) =>
              this.events.filter(
                (p) =>
                  p.resourceId === o.id &&
                  !['resolved', 'blocked'].includes(p.status)
              ).length < Math.max(0, o.capacity || 0)
          );
        const resource = options[0];
        if (!resource) {
          row.status = 'waiting';
          continue;
        }
        const k = e.g.nearest(
          (resource.x * e.g.m.widthMeters) / 100,
          (resource.y * e.g.m.heightMeters) / 100,
          10
        );
        const field = e.getFlow(row.cell);
        if (k < 0 || field[k] < 0) {
          row.status = 'blocked';
          row.note =
            'No hay recorrido peatonal conectado desde el recurso previsto.';
          continue;
        }
        row.resourceId = resource.id;
        row.resourceName = resource.name;
        row.vehicle =
          !!e.s.emergency?.sirens &&
          ['ambulance', 'fire'].includes(resource.kind || '');
        if (row.vehicle) {
          const route = priorityRoute(e, row, resource);
          if (route.error) {
            row.status = 'blocked';
            row.fixedBlock = true;
            row.note = route.error;
            continue;
          }
          row.path = route.path;
          row.vehicleWidth = route.width;
          row.vehicleLength = route.length;
          row.originOffset = route.offset;
          row.lastLeg = route.lastLeg;
        }
        const path = [e.g.point(k)];
        let current = k;
        for (let i = 0; i < e.g.free.length && current !== row.cell; i++) {
          const n = e.g
            .neighbors(current)
            .filter((nIdx: number) => field[nIdx] >= 0 && field[nIdx] < field[current])
            .sort((a: number, b: number) => field[a] - field[b])[0];
          if (n === undefined) break;
          current = n;
          path.push(e.g.point(n));
        }
        row.resourceId = resource.id;
        row.resourceName = resource.name;
        if (!row.vehicle) row.path = path;
        row.pathLength = ((row.path?.length || 1) - 1) * e.g.cell;
        row.assigned = e.time;
        row.alertDelay = Math.max(0, resource.delay ?? 60);
        row.travel = row.pathLength / 1.1;
        row.handling = Math.max(1, resource.handling ?? spec.duration);
        row.status = 'assigned';
      }
      if (
        row.status === 'assigned' &&
        e.time >= (row.assigned || 0) + (row.alertDelay || 0) &&
        (row.vehicle
          ? advancePriority(e, row, dt)
          : e.time >=
            (row.assigned || 0) + (row.alertDelay || 0) + (row.travel || 0))
      ) {
        row.status = 'assisting';
        row.arrived = e.time;
      }
      if (
        row.status === 'assisting' &&
        e.time >= (row.arrived || 0) + (row.handling || 0)
      ) {
        row.status = 'resolved';
        row.closed = e.time;
        const a = e.byId.get(row.agentId);
        if (a?.state === 'incident') e.assign(a);
      }
    }
  }

  blocksPerson(x: number, y: number, r: number): boolean {
    return this.events.some(
      (o) =>
        o.vehiclePose &&
        o.status !== 'resolved' &&
        inVehicle(
          [x, y],
          o.vehiclePose,
          o.vehicleWidth || 2.5,
          o.vehicleLength || 6,
          r
        )
    );
  }

  snapshot(): {
    created: number;
    pending: number;
    resolved: number;
    staff: number;
  } {
    return {
      created: this.events.length,
      pending: this.events.filter((o) => o.status !== 'resolved').length,
      resolved: this.events.filter((o) => o.status === 'resolved').length,
      staff: this.resources().reduce(
        (n, o) => n + (o.active === false ? 0 : +(o.staff || 0) || 0),
        0
      ),
    };
  }
}

const statusLabels: Record<string, string> = {
  pending: 'Aviso simulado',
  waiting: 'Sin equipo disponible',
  assigned: 'Recurso supuesto en camino',
  assisting: 'Tiempo de atención configurado',
  resolved: 'Ensayo cerrado',
  blocked: 'Ruta sin conexión',
};

/**
 * Generates an SVG overlay string for emergency resources and active incidents.
 *
 * @param e - EventEngine instance.
 * @returns SVG markup string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emergencySVG(e: any): string {
  const m = e.g.m;
  let html = '';
  for (const o of e.emergency.resources()) {
    const x = (o.x * m.widthMeters) / 100;
    const y = (o.y * m.heightMeters) / 100;
    const symbol =
      o.kind === 'medical'
        ? '+'
        : o.kind === 'ambulance'
          ? 'A'
          : o.kind === 'fire'
            ? 'B'
            : o.kind === 'security'
              ? 'S'
              : 'C';
    html +=
      '<g data-item="' +
      esc(o.id) +
      '" opacity="' +
      (o.active === false ? 0.35 : 1) +
      '"><rect x="' +
      (x - (o.width || 3) / 2) +
      '" y="' +
      (y - (o.depth || 3) / 2) +
      '" width="' +
      (o.width || 3) +
      '" height="' +
      (o.depth || 3) +
      '" rx=".5" fill="#e7f0f5" stroke="#497d96" stroke-width=".3"/><text x="' +
      x +
      '" y="' +
      (y + 0.65) +
      '" text-anchor="middle" font-size="2.1" font-family="Arial" fill="#356d89">' +
      symbol +
      '</text><text x="' +
      x +
      '" y="' +
      (y + (o.depth || 3) / 2 + 1.3) +
      '" text-anchor="middle" font-size="1.1" fill="#356d89" paint-order="stroke" stroke="#fffdf5" stroke-width=".5">' +
      esc(
        o.name
          .replace(' · supuesto', '')
          .replace(' · reserva propuesta', '')
      ) +
      '</text></g>';
  }
  for (const o of e.emergency.events as EmergencyIncident[]) {
    const [x, y] = o.point;
    html +=
      '<g><circle cx="' +
      x +
      '" cy="' +
      y +
      '" r="2.4" fill="' +
      (o.status === 'resolved' ? '#86ad91' : '#e27754') +
      '" fill-opacity=".35" stroke="#bc6949" stroke-width=".25"/><text x="' +
      x +
      '" y="' +
      (y + 0.6) +
      '" text-anchor="middle" font-size="2" fill="#842f23">' +
      (o.status === 'resolved' ? '✓' : '!') +
      '</text><title>' +
      esc(o.name + ' · ' + (statusLabels[o.status] || o.status)) +
      '</title></g>';
    if (o.path && o.status !== 'resolved') {
      html +=
        '<polyline points="' +
        o.path.map((p) => p.join(',')).join(' ') +
        '" stroke="#427e9c" stroke-width=".45" stroke-dasharray="1 .6" fill="none"/>';
      const t = Math.max(
        0,
        e.time - (o.assigned || 0) - (o.alertDelay || 0)
      );
      const i = Math.min(
        o.path.length - 1,
        Math.floor((t * 1.1) / e.g.cell)
      );
      const p = o.path[i];
      if (o.vehiclePose) {
        const v = o.vehiclePose;
        const vLen = o.vehicleLength || 6;
        const vWid = o.vehicleWidth || 2.5;
        html +=
          '<g transform="translate(' +
          v.x +
          ' ' +
          v.y +
          ') rotate(' +
          (v.angle * 180) / Math.PI +
          ')"><rect x="' +
          -vLen / 2 +
          '" y="' +
          -vWid / 2 +
          '" width="' +
          vLen +
          '" height="' +
          vWid +
          '" rx=".3" fill="#f6fcff" stroke="#427e9c" stroke-width=".4"/><path d="M-1 0H1M0-1V1" stroke="#d36c50" stroke-width=".6"/></g><circle cx="' +
          v.x +
          '" cy="' +
          v.y +
          '" r="' +
          (vLen / 2 + 2) +
          '" fill="none" stroke="#5c9aba" stroke-width=".3" stroke-dasharray="1.4 1" opacity=".6"/>';
      } else if (p) {
        html +=
          '<circle cx="' +
          p[0] +
          '" cy="' +
          p[1] +
          '" r=".8" fill="#3e7593" stroke="#fff" stroke-width=".2"/>';
      }
    }
  }
  return '<g class="emergency-overlay">' + html + '</g>';
}

/**
 * Generates HTML summary markup for the emergency laboratory panel.
 *
 * @param e - EventEngine instance.
 * @returns HTML string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emergencyPanel(e: any): string {
  const r = e.emergency.snapshot();
  return (
    '<div class="response-summary"><b>' +
    r.pending +
    ' incidencias abiertas · ' +
    r.resolved +
    ' ensayos cerrados</b><small>' +
    r.staff +
    ' personas de equipo supuestas · prioridad y huellas simplificadas</small></div>' +
    (e.emergency.events as EmergencyIncident[])
      .slice(-6)
      .reverse()
      .map(
        (o) =>
          '<article><b>' +
          esc(o.name) +
          '</b><span>' +
          (statusLabels[o.status] || o.status) +
          '</span><small>' +
          esc(o.resourceName || o.note || 'Pendiente de recurso previsto') +
          '</small><p>' +
          esc(o.question) +
          '</p>' +
          (o.vehicle
            ? '<small>Prioridad con sirena visual · ' +
              (o.yieldedIds?.length || 0) +
              ' personas requeridas a ceder · ' +
              (o.yieldBlockedIds?.length || 0) +
              ' sin hueco encontrado · ' +
              Math.round(o.peopleDelay || 0) +
              ' s de demora ante personas.</small>'
            : '') +
          (o.note ? '<p>' + esc(o.note) + '</p>' : '') +
          '</article>'
      )
      .join('')
  );
}
