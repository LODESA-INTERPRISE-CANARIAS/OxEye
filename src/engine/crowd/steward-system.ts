/**
 * @module engine/crowd/steward-system
 * Sistema autónomo de «Personal de asistencia y orientación» (`role: 'steward'`),
 * independiente de policía y servicios sanitarios.
 *
 * Funciones simuladas con impacto medible:
 * 1. Coordinación y prevención: detecta incidencias sin reportar (acorta demora
 *    de aviso a emergencias) y resuelve incidencias menores de orientación/obstáculo
 *    evitando que escalen.
 * 2. Asistencia básica: atiende fatiga, malestar leve o espera prolongada de
 *    asistentes reduciendo insatisfacción y guiando hacia descanso.
 * 3. Gestión de aglomeraciones: detecta cuellos de botella y redistribuye al
 *    personal disponible para agilizar colas y accesos congestionados.
 * 4. Orientación preventiva: ayuda a personas desorientadas o atascadas y patrulla
 *    dinámicamente su área de actuación.
 */
import type {Agent, EmergencyIncident, Point} from '../../types';
import {world} from '../cartography/geometry';

export type StewardState =
  | 'patrol'
  | 'orient'
  | 'decongest'
  | 'assist'
  | 'escalate';

export interface StewardAgent {
  id: string;
  stationId: string;
  name: string;
  home: Point;
  x: number;
  y: number;
  patrolRadius: number;
  speed: number;
  state: StewardState;
  target: Point | null;
  busyUntil: number;
  note: string;
  handled: number;
}

export interface StewardMetrics {
  activeAgents: number;
  oriented: number;
  decongested: number;
  assisted: number;
  prevented: number;
  escalations: number;
}

const TASK_LABELS: Record<StewardState, string> = {
  patrol: 'Patrulla preventiva',
  orient: 'Orientando asistente',
  decongest: 'Descongestionando cuello de botella',
  assist: 'Asistencia básica (descanso / hidratación)',
  escalate: 'Coordinando aviso con emergencias',
};

/**
 * Gestor de agentes autónomos de asistencia y orientación acoplado a `EventEngine`.
 */
export class StewardSystem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  agents: StewardAgent[];
  lastEvalTime: number;
  metrics: StewardMetrics;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(engine: any) {
    this.e = engine;
    this.agents = [];
    this.lastEvalTime = -10;
    this.metrics = {
      activeAgents: 0,
      oriented: 0,
      decongested: 0,
      assisted: 0,
      prevented: 0,
      escalations: 0,
    };

    const m = engine.g.m;
    const stations = (engine.s.infrastructure || []).filter(
      (r: {role?: string; kind?: string; active?: boolean}) =>
        (r.role === 'steward' || r.kind === 'steward') && r.active !== false
    );

    for (const st of stations) {
      const [hx, hy] = world([st.x, st.y], m);
      const staffCount = Math.max(1, Math.min(20, Math.round(Number(st.staff) || 2)));
      const radius = Math.max(5, Math.min(150, Number(st.patrolRadius) || 25));
      for (let i = 0; i < staffCount; i++) {
        const angle = (i / staffCount) * Math.PI * 2;
        const ox = hx + Math.cos(angle) * Math.min(1.5, radius * 0.1);
        const oy = hy + Math.sin(angle) * Math.min(1.5, radius * 0.1);
        const cell = engine.g.nearest(ox, oy, 10);
        const startPt: Point = cell >= 0 ? engine.g.point(cell) : [hx, hy];
        this.agents.push({
          id: `${st.id}-s${i + 1}`,
          stationId: st.id,
          name: `${st.name || 'Asistencia'} #${i + 1}`,
          home: [hx, hy],
          x: startPt[0],
          y: startPt[1],
          patrolRadius: radius,
          speed: 1.45,
          state: 'patrol',
          target: null,
          busyUntil: 0,
          note: TASK_LABELS.patrol,
          handled: 0,
        });
      }
    }
    this.metrics.activeAgents = this.agents.length;
  }

  /** Avanza la lógica autónoma y movimiento del personal de asistencia en `dt` segundos. */
  step(dt: number): void {
    if (!this.agents.length) return;
    const e = this.e;

    // Reevaluación de prioridades dinámicas y zonas de alta demanda cada 2 s
    if (e.time - this.lastEvalTime >= 2) {
      this.lastEvalTime = e.time;
      this.assignDynamicTasks();
    }

    for (const sw of this.agents) {
      if (sw.busyUntil > e.time) continue;
      if (!sw.target) {
        this.pickPatrolPoint(sw);
        continue;
      }
      const dx = sw.target[0] - sw.x;
      const dy = sw.target[1] - sw.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 1.2) {
        this.executeActionAtTarget(sw);
        continue;
      }
      const stepDist = Math.min(dist, sw.speed * dt);
      const nx = sw.x + (dx / dist) * stepDist;
      const ny = sw.y + (dy / dist) * stepDist;
      const k = e.g.index(nx, ny);
      if (k >= 0 && e.g.free[k]) {
        sw.x = nx;
        sw.y = ny;
      } else {
        // Rodea obstáculos menores eligiendo celda libre más próxima al destino
        const curK = e.g.index(sw.x, sw.y);
        if (curK >= 0) {
          const bestNeighbor = e.g
            .neighbors(curK)
            .map((nk: number) => ({
              nk,
              pt: e.g.point(nk) as Point,
            }))
            .sort(
              (a: {pt: Point}, b: {pt: Point}) =>
                Math.hypot(a.pt[0] - sw.target![0], a.pt[1] - sw.target![1]) -
                Math.hypot(b.pt[0] - sw.target![0], b.pt[1] - sw.target![1])
            )[0];
          if (bestNeighbor) {
            sw.x = bestNeighbor.pt[0];
            sw.y = bestNeighbor.pt[1];
          } else {
            sw.target = null;
          }
        } else {
          sw.target = null;
        }
      }
    }
  }

  private assignDynamicTasks(): void {
    const e = this.e;
    const incidents: EmergencyIncident[] = e.emergency?.events || [];
    const visitors: Agent[] = e.agents || [];

    // Identificar foco global de mayor demanda para redistribuir personal libre
    let hotspot: Point | null = null;
    let maxDemand = 0;
    for (const a of visitors) {
      if (a.stuck > 6 || (a.state === 'queue' && e.time - a.waitStart > 35)) {
        const d = a.stuck + (a.state === 'queue' ? (e.time - a.waitStart) / 10 : 0);
        if (d > maxDemand) {
          maxDemand = d;
          hotspot = [a.x, a.y];
        }
      }
    }

    for (const sw of this.agents) {
      if (sw.busyUntil > e.time) continue;

      // Prioridad 1: Coordinación y prevención sobre incidencias en el radio de actuación
      const nearIncident = incidents.find((inc) => {
        if (inc.status === 'resolved' || !inc.point) return false;
        const d = Math.hypot(inc.point[0] - sw.home[0], inc.point[1] - sw.home[1]);
        if (d > sw.patrolRadius) return false;
        return (
          inc.status === 'unreported' ||
          (['orientation', 'obstacle'].includes(inc.type) &&
            ['pending', 'waiting'].includes(inc.status))
        );
      });
      if (nearIncident && nearIncident.point) {
        sw.state = 'escalate';
        sw.target = [nearIncident.point[0], nearIncident.point[1]];
        sw.note = TASK_LABELS.escalate;
        continue;
      }

      // Prioridad 2: Asistencia básica (fatiga, malestar leve o espera prolongada)
      const needyVisitor = visitors.find((a) => {
        const d = Math.hypot(a.x - sw.home[0], a.y - sw.home[1]);
        if (d > sw.patrolRadius) return false;
        const waitSec = a.state === 'queue' ? e.time - a.waitStart : 0;
        return a.failed > 0 || a.stuck > 10 || waitSec > 45;
      });
      if (needyVisitor) {
        sw.state = 'assist';
        sw.target = [needyVisitor.x, needyVisitor.y];
        sw.note = TASK_LABELS.assist;
        continue;
      }

      // Prioridad 3: Gestión de aglomeraciones / cuellos de botella
      const congestedVisitor = visitors.find((a) => {
        const d = Math.hypot(a.x - sw.home[0], a.y - sw.home[1]);
        if (d > sw.patrolRadius) return false;
        const k = e.g.index(a.x, a.y);
        return a.stuck > 4 || (k >= 0 && e.hashDensity(k) >= 4);
      });
      if (congestedVisitor) {
        sw.state = 'decongest';
        sw.target = [congestedVisitor.x, congestedVisitor.y];
        sw.note = TASK_LABELS.decongest;
        continue;
      }

      // Prioridad 4: Orientación a visitantes en tránsito con dudas o percepción reducida
      const disoriented = visitors.find((a) => {
        const d = Math.hypot(a.x - sw.home[0], a.y - sw.home[1]);
        if (d > sw.patrolRadius) return false;
        return a.state === 'walk' && (a.stuck > 2 || a.persona?.sensory);
      });
      if (disoriented) {
        sw.state = 'orient';
        sw.target = [disoriented.x, disoriented.y];
        sw.note = TASK_LABELS.orient;
        continue;
      }

      // Redistribución dinámica hacia el foco de mayor demanda si está libre
      if (hotspot && sw.state === 'patrol') {
        const dHot = Math.hypot(hotspot[0] - sw.home[0], hotspot[1] - sw.home[1]);
        if (dHot <= sw.patrolRadius * 1.5) {
          sw.state = 'decongest';
          sw.target = [hotspot[0], hotspot[1]];
          sw.note = 'Redistribución hacia zona de alta demanda';
          continue;
        }
      }

      sw.state = 'patrol';
      sw.note = TASK_LABELS.patrol;
      if (!sw.target) this.pickPatrolPoint(sw);
    }
  }

  private executeActionAtTarget(sw: StewardAgent): void {
    const e = this.e;
    const visitors: Agent[] = e.agents || [];
    const incidents: EmergencyIncident[] = e.emergency?.events || [];

    if (sw.state === 'escalate') {
      const inc = incidents.find(
        (row) =>
          row.status !== 'resolved' &&
          row.point &&
          Math.hypot(row.point[0] - sw.x, row.point[1] - sw.y) <= 4
      );
      if (inc) {
        if (inc.status === 'unreported') {
          inc.reportedAt = e.time;
          inc.status = 'pending';
          inc.note =
            (inc.note ? inc.note + ' ' : '') +
            'Aviso inmediato comunicado por personal de asistencia.';
          this.metrics.escalations++;
          e.stats.stewardEscalations = this.metrics.escalations;
        } else if (
          ['orientation', 'obstacle'].includes(inc.type) &&
          ['pending', 'waiting'].includes(inc.status)
        ) {
          inc.status = 'resolved';
          inc.resolved = e.time;
          inc.note =
            'Resuelta en primera línea por personal de asistencia y orientación.';
          this.metrics.prevented++;
          e.stats.stewardPrevented = this.metrics.prevented;
        }
        sw.handled++;
      }
      sw.busyUntil = e.time + 3;
    } else if (sw.state === 'assist') {
      let helped = 0;
      for (const a of visitors) {
        if (Math.hypot(a.x - sw.x, a.y - sw.y) <= 3.5) {
          a.stuck = Math.max(0, a.stuck - 8);
          if (a.state === 'queue') {
            a.waitStart = Math.min(e.time, a.waitStart + 18);
          }
          if (a.failed > 0) a.failed = Math.max(0, a.failed - 1);
          helped++;
          if (helped >= 3) break;
        }
      }
      if (helped > 0) {
        this.metrics.assisted += helped;
        e.stats.stewardAssisted = this.metrics.assisted;
        sw.handled += helped;
      }
      sw.busyUntil = e.time + 4;
    } else if (sw.state === 'decongest') {
      let cleared = 0;
      for (const a of visitors) {
        if (Math.hypot(a.x - sw.x, a.y - sw.y) <= 4.5) {
          a.stuck = Math.max(0, a.stuck - 6);
          if (a.state === 'queue') {
            a.waitStart = Math.min(e.time, a.waitStart + 12);
          }
          cleared++;
        }
      }
      if (cleared > 0) {
        this.metrics.decongested++;
        e.stats.stewardDecongested = this.metrics.decongested;
        sw.handled++;
      }
      sw.busyUntil = e.time + 3;
    } else if (sw.state === 'orient') {
      let oriented = 0;
      for (const a of visitors) {
        if (Math.hypot(a.x - sw.x, a.y - sw.y) <= 4) {
          a.stuck = 0;
          oriented++;
          if (oriented >= 2) break;
        }
      }
      if (oriented > 0) {
        this.metrics.oriented += oriented;
        e.stats.stewardOriented = this.metrics.oriented;
        sw.handled += oriented;
      }
      sw.busyUntil = e.time + 2;
    }

    sw.state = 'patrol';
    sw.target = null;
    sw.note = TASK_LABELS.patrol;
  }

  private pickPatrolPoint(sw: StewardAgent): void {
    const e = this.e;
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = e.random() * Math.PI * 2;
      const r = e.random() * sw.patrolRadius;
      const px = sw.home[0] + Math.cos(ang) * r;
      const py = sw.home[1] + Math.sin(ang) * r;
      const k = e.g.index(px, py);
      if (k >= 0 && e.g.free[k]) {
        sw.target = e.g.point(k);
        return;
      }
    }
    sw.target = [sw.home[0], sw.home[1]];
  }

  /** Genera la capa SVG de los agentes autónomos de asistencia sobre el mapa. */
  svg(): string {
    if (!this.agents.length) return '';
    return this.agents
      .map((sw) => {
        const active = sw.state !== 'patrol';
        return `<g class="steward-agent" pointer-events="none"><title>${sw.name} · ${sw.note}</title>${
          active
            ? `<circle cx="${sw.x}" cy="${sw.y}" r="1.45" fill="#14b8a6" fill-opacity=".24" stroke="#0d9488" stroke-width=".18"/>`
            : ''
        }<circle cx="${sw.x}" cy="${sw.y}" r=".72" fill="#0d9488" stroke="#ffffff" stroke-width=".2"/><text x="${sw.x}" y="${
          sw.y + 0.28
        }" text-anchor="middle" font-size=".85" font-weight="700" fill="#ffffff">✦</text></g>`;
      })
      .join('');
  }
}
