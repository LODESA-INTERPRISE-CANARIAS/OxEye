/**
 * @module engine/crowd/everyday-interactions
 * Parte II — Consultas cotidianas sin activar emergencias y falsas alarmas
 * que exigen comprobación física del personal antes de clasificarse.
 */
import type {
  Agent,
  EverydayInteractionRecord,
  FalseAlarmKind,
  FalseAlarmRecord,
  Point,
} from '../../types';
import {world} from '../cartography/geometry';

export interface EverydayQueryTemplate {
  kind: string;
  label: string;
  durationSec: number;
  lookupResourceKinds: string[];
}

export const EVERYDAY_QUERY_CATALOG: EverydayQueryTemplate[] = [
  {
    kind: 'phone_charge',
    label: 'Dónde cargar el móvil',
    durationSec: 16,
    lookupResourceKinds: ['power', 'generator', 'yellow_tent'],
  },
  {
    kind: 'find_toilet',
    label: 'Dónde hay un aseo',
    durationSec: 12,
    lookupResourceKinds: ['toilet'],
  },
  {
    kind: 'workshop_schedule',
    label: 'Horario de taller',
    durationSec: 18,
    lookupResourceKinds: ['workshop'],
  },
  {
    kind: 'lost_bag',
    label: 'Bolsa olvidada / objetos perdidos',
    durationSec: 28,
    lookupResourceKinds: ['coordination', 'steward', 'security'],
  },
  {
    kind: 'bus_info',
    label: 'Información sobre la guagua / transporte',
    durationSec: 20,
    lookupResourceKinds: ['entrance'],
  },
  {
    kind: 'queue_complaint',
    label: 'Queja por espera en cola',
    durationSec: 15,
    lookupResourceKinds: ['food', 'commerce'],
  },
  {
    kind: 'quiet_zone',
    label: 'Zona tranquila / sombra',
    durationSec: 15,
    lookupResourceKinds: ['rest', 'picnic', 'cover', 'yellow_tent'],
  },
  {
    kind: 'shop_info',
    label: 'Información sobre comercio',
    durationSec: 14,
    lookupResourceKinds: ['commerce'],
  },
  {
    kind: 'rest_need',
    label: 'Necesita descansar',
    durationSec: 14,
    lookupResourceKinds: ['rest', 'picnic', 'cover'],
  },
  {
    kind: 'find_yellow_tent',
    label: 'Ubicación de la Carpa Amarilla',
    durationSec: 12,
    lookupResourceKinds: ['yellow_tent'],
  },
  {
    kind: 'alternative_exit',
    label: 'Salida alternativa',
    durationSec: 15,
    lookupResourceKinds: ['entrance'],
  },
  {
    kind: 'reentry_policy',
    label: 'Si puede salir y volver a entrar',
    durationSec: 14,
    lookupResourceKinds: ['entrance'],
  },
];

export const FALSE_ALARM_CATALOG: Record<
  FalseAlarmKind,
  {label: string; verificationSeconds: number; description: string}
> = {
  vapor_smoke: {
    label: 'Vapor confundido con humo de incendio',
    verificationSeconds: 22,
    description: 'Auxiliar comprueba visualmente cocina/puesto y descarta incendio.',
  },
  setup_noise: {
    label: 'Ruido de montaje confundido con avería',
    verificationSeconds: 18,
    description: 'Revisión rápida en zona técnica confirma ruido operativo normal.',
  },
  resolved_dispute: {
    label: 'Discusión aparentemente grave ya resuelta',
    verificationSeconds: 20,
    description: 'Mediación confirma situación calmada sin riesgo ni agresión.',
  },
  oriented_person: {
    label: 'Persona supuestamente perdida que solo necesita orientación',
    verificationSeconds: 16,
    description: 'El asistente se encuentra bien y recibe indicación de ruta.',
  },
  forgotten_bag: {
    label: 'Objeto abandonado que resulta ser una pertenencia olvidada',
    verificationSeconds: 25,
    description: 'Comprobación visual y entrega segura a objeto perdido sin riesgo.',
  },
};

export class ServiceInteractionManager {
  records: EverydayInteractionRecord[];
  pendingQueue: Array<{
    agentId: number;
    kind: string;
    requestedAt: number;
  }>;
  private seq = 1;
  private nextAutoQueryAt = 160;

  constructor() {
    this.records = [];
    this.pendingQueue = [];
  }

  /**
   * Un visitante realiza una consulta cotidiana a un auxiliar o punto de atención.
   * Nunca crea una emergencia en `engine.emergency.events`, pero consume tiempo del personal
   * y actualiza el destino o conocimiento del visitante.
   */
  requestQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: any,
    agent: Agent,
    kind: string
  ): EverydayInteractionRecord {
    const tpl =
      EVERYDAY_QUERY_CATALOG.find((q) => q.kind === kind) ||
      EVERYDAY_QUERY_CATALOG[0];

    const stewards = (engine.stewards?.agents || []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sw: any) => sw.busyUntil <= engine.time
    );
    const chosenSteward =
      stewards.sort(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any, b: any) =>
          Math.hypot(a.x - agent.x, a.y - agent.y) -
          Math.hypot(b.x - agent.x, b.y - agent.y)
      )[0] || null;

    if (!chosenSteward && (engine.stewards?.agents?.length || 0) > 0) {
      this.pendingQueue.push({agentId: agent.id, kind: tpl.kind, requestedAt: engine.time});
    }

    // Buscar recurso real en el diseño
    const m = engine.g.m;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const infraMatches = (engine.s.infrastructure || []).filter((o: any) =>
      tpl.lookupResourceKinds.includes(o.kind || o.role || '')
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boothMatches = (engine.s.base?.booths || []).filter((o: any) =>
      tpl.lookupResourceKinds.includes(o.type || '')
    );
    const entranceMatches = tpl.lookupResourceKinds.includes('entrance')
      ? engine.s.entrances || []
      : [];
    const allMatches = [...infraMatches, ...boothMatches, ...entranceMatches];

    let resourceFound = allMatches.length > 0;
    let outcomeText = '';
    if (tpl.kind === 'reentry_policy') {
      resourceFound = true;
      outcomeText =
        'El auxiliar confirma que se permite salir y volver a entrar presentando control de acceso.';
      if (agent.routine) agent.routine.canReenter = true;
    } else if (resourceFound) {
      const target = allMatches[0];
      const pt = world([target.x ?? 50, target.y ?? 50], m);
      outcomeText = `Auxiliar indica la ubicación de ${target.name || tpl.label} (${pt[0].toFixed(1)} m, ${pt[1].toFixed(1)} m).`;
      agent.knownStationIds = [...new Set([...(agent.knownStationIds || []), target.id])];
      // Si el visitante buscaba aseo, descanso o comercio, actualizar objetivo sin emergencia
      const matchingStation = engine.stations.find((st: {id?: string}) => st.id === target.id);
      if (matchingStation && matchingStation.cell >= 0 && agent.state === 'walk') {
        agent.target = matchingStation.id || agent.target;
        agent.approachCell = matchingStation.queueCell ?? matchingStation.cell;
        agent.approachField = engine.getFlow(agent.approachCell);
      }
    } else {
      outcomeText = `El auxiliar comprueba los servicios del evento e informa de que no existe recurso registrado para «${tpl.label}».`;
    }

    if (chosenSteward) {
      chosenSteward.busyUntil = engine.time + tpl.durationSec;
      chosenSteward.state = 'orient';
      chosenSteward.note = `Atendiendo consulta: ${tpl.label}`;
      chosenSteward.handled++;
      if (engine.stewards?.metrics) {
        engine.stewards.metrics.oriented++;
        engine.stats.stewardOriented = engine.stewards.metrics.oriented;
      }
    }

    const rec: EverydayInteractionRecord = {
      id: `qry-${this.seq++}`,
      kind: tpl.kind,
      label: tpl.label,
      agentId: agent.id,
      stewardId: chosenSteward?.id,
      stewardName: chosenSteward?.name,
      startedAt: engine.time,
      completedAt: chosenSteward ? engine.time + tpl.durationSec : undefined,
      durationSec: tpl.durationSec,
      resolved: !!chosenSteward || !(engine.stewards?.agents?.length > 0),
      resourceFound,
      outcomeText,
      point: [agent.x, agent.y],
    };
    this.records.push(rec);
    return rec;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(engine: any): void {
    // Atender cola pendiente si un auxiliar queda libre
    if (this.pendingQueue.length && engine.stewards?.agents?.length) {
      const free = engine.stewards.agents.find(
        (sw: {busyUntil: number}) => sw.busyUntil <= engine.time
      );
      if (free) {
        const nextQ = this.pendingQueue.shift()!;
        const ag = engine.byId.get(nextQ.agentId);
        if (ag && ag.state !== 'gone') {
          this.requestQuery(engine, ag, nextQ.kind);
        }
      }
    }

    // Consultas orgánicas periódicas durante el funcionamiento del evento
    if (
      engine.s.crowdBehavior?.enableEverydayInteractions === false ||
      engine.time < this.nextAutoQueryAt ||
      !engine.agents.length
    ) {
      return;
    }
    const rand = engine.humanRandom || engine.random;
    this.nextAutoQueryAt = engine.time + 45 + Math.round(rand() * 45);
    const active = engine.agents.filter((a: Agent) => a.state !== 'gone');
    if (!active.length) return;
    const sample = active[Math.floor(rand() * active.length)];
    const pick =
      EVERYDAY_QUERY_CATALOG[
        Math.floor(rand() * EVERYDAY_QUERY_CATALOG.length)
      ];
    this.requestQuery(engine, sample, pick.kind);
  }

  getMetrics() {
    const resolved = this.records.filter((r) => r.resolved).length;
    const staffTimeSec = this.records
      .filter((r) => r.stewardId)
      .reduce((acc, r) => acc + r.durationSec, 0);
    return {
      totalQueries: this.records.length,
      resolvedQueries: resolved,
      pendingQueries: Math.max(0, this.records.length - resolved) + this.pendingQueue.length,
      staffTimeSec: Math.round(staffTimeSec),
      avgAttentionSec: resolved
        ? Math.round(
            this.records
              .filter((r) => r.resolved)
              .reduce((a, r) => a + r.durationSec, 0) / resolved
          )
        : 0,
    };
  }
}

export class FalseAlarmManager {
  records: FalseAlarmRecord[];
  private seq = 1;
  private nextAutoCheckAt = 180;

  constructor() {
    this.records = [];
  }

  /** Registra un aviso preventivo que requiere comprobación física antes de descartarse. */
  reportSuspectedAlarm(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: any,
    kind: FalseAlarmKind,
    point: Point,
    customLabel?: string
  ): FalseAlarmRecord {
    const spec = FALSE_ALARM_CATALOG[kind];
    const rec: FalseAlarmRecord = {
      id: `fa-${this.seq++}`,
      kind,
      label: customLabel || spec.label,
      status: 'reported',
      reportedAt: engine.time,
      resourcesUsed: [],
      outcome: 'Aviso pendiente de comprobación sobre el terreno.',
      waitingImpactCount: 0,
      point: [point[0], point[1]],
    };
    this.records.push(rec);
    return rec;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(engine: any): void {
    for (const rec of this.records) {
      if (rec.status === 'reported') {
        const free = (engine.stewards?.agents || []).find(
          (sw: {busyUntil: number}) => sw.busyUntil <= engine.time
        );
        if (free) {
          rec.status = 'verifying';
          rec.verifyingAt = engine.time;
          rec.stewardId = free.id;
          rec.stewardName = free.name;
          rec.resourcesUsed = [free.name];
          const spec = FALSE_ALARM_CATALOG[rec.kind];
          const dur = spec.verificationSeconds;
          free.busyUntil = engine.time + dur;
          free.state = 'escalate';
          free.target = [rec.point[0], rec.point[1]];
          free.note = `Comprobando aviso: ${rec.label}`;
        } else if ((engine.stewards?.agents?.length || 0) === 0 && engine.time - rec.reportedAt >= 10) {
          rec.status = 'verifying';
          rec.verifyingAt = engine.time;
          rec.resourcesUsed = ['Revisión general de puesto'];
        }
      } else if (rec.status === 'verifying') {
        const spec = FALSE_ALARM_CATALOG[rec.kind];
        const elapsed = engine.time - (rec.verifyingAt ?? rec.reportedAt);
        if (elapsed >= spec.verificationSeconds) {
          rec.status = 'confirmed_false_alarm';
          rec.resolvedAt = engine.time;
          rec.verificationSeconds = Math.round(engine.time - rec.reportedAt);
          rec.outcome = spec.description;
          rec.waitingImpactCount = engine.everydayInteractions?.pendingQueue?.length || 0;
        }
      }
    }

    if (
      engine.s.crowdBehavior?.enableFalseAlarms &&
      engine.time >= this.nextAutoCheckAt &&
      engine.agents.length > 0
    ) {
      const rand = engine.humanRandom || engine.random;
      this.nextAutoCheckAt = engine.time + 260 + Math.round(rand() * 240);
      const kinds: FalseAlarmKind[] = [
        'vapor_smoke',
        'setup_noise',
        'resolved_dispute',
        'oriented_person',
        'forgotten_bag',
      ];
      const chosen = kinds[Math.floor(rand() * kinds.length)];
      const sample = engine.agents[Math.floor(rand() * engine.agents.length)];
      if (sample) {
        this.reportSuspectedAlarm(engine, chosen, [sample.x, sample.y]);
      }
    }
  }
}
