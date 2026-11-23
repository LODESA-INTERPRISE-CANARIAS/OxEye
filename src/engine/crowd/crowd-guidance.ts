/**
 * @module engine/crowd/crowd-guidance
 * Parte III y IV — Detección objetiva de aglomeraciones (`CongestionDetector`),
 * asignación de auxiliares (`StaffDispatch`), orientación colectiva de 1 a 10 personas
 * con respuesta humana variable (`CrowdGuidanceManager`) y datos para el Inspector contextual.
 */
import type {
  Agent,
  CongestionClassification,
  CongestionInterventionMode,
  CongestionThresholds,
  CongestionZoneEvent,
  GuidanceResponseKind,
  Point,
  SimStation,
} from '../../types';
import {world} from '../cartography/geometry';
import type {StewardAgent} from './steward-system';

export const DEFAULT_CONGESTION_THRESHOLDS: CongestionThresholds = {
  densityWarn: 0.35,
  densityCritical: 1.05,
  minSpeedMs: 0.5,
  minDurationSec: 6,
  minPeople: 5,
};

export const CLASSIFICATION_LABELS: Record<CongestionClassification, string> = {
  spectators: 'Concentración de espectadores',
  organized_queue: 'Cola organizada',
  pedestrian_congestion: 'Congestión peatonal',
  corridor_block: 'Bloqueo de corredor',
  persistent_accumulation: 'Acumulación persistente',
  potentially_dangerous: 'Situación potencialmente peligrosa',
};

export interface ViableAlternativeOption {
  targetPoint: Point;
  targetCell: number;
  label: string;
  stationId?: string;
  currentLoad: number;
  estimatedSideEffectDelta: number;
}

export interface CongestionInspectorData {
  id: string;
  title: string;
  classificationLabel: string;
  statusLabel: string;
  startedAtLabel: string;
  durationLabel: string;
  peopleCountLabel: string;
  densityLabel: string;
  avgSpeedLabel: string;
  possibleCause: string;
  availableStaffLabel: string;
  alternativeRoutesLabel: string;
  sideEffectLabel: string;
  guidedSummaryLabel: string;
  point: Point;
  canDispatchSteward: boolean;
}

function fmtMMSS(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} min ${r} s`;
}

export class CrowdGuidanceManager {
  zones: Map<string, CongestionZoneEvent>;
  pendingDispatches: Map<string, string>; // zoneId -> stewardId
  private lastScanAt = -10;
  private seq = 1;

  constructor() {
    this.zones = new Map();
    this.pendingDispatches = new Map();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thresholds(engine: any): CongestionThresholds {
    return {
      ...DEFAULT_CONGESTION_THRESHOLDS,
      ...(engine.s.crowdBehavior?.thresholds || {}),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interventionMode(engine: any): CongestionInterventionMode {
    return engine.s.crowdBehavior?.interventionMode || 'major_only';
  }

  /** Verifica rutas alternativas practicables que no crucen emergencias ni incendios. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findViableAlternatives(engine: any, zone: CongestionZoneEvent): ViableAlternativeOption[] {
    const out: ViableAlternativeOption[] = [];
    const fireNodes = [...(engine.emergency?.fire?.nodes?.values?.() || [])];
    const evacOrders = engine.emergency?.evacuation?.orders || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isNearEmergency = (pt: Point): boolean => {
      for (const fn of fireNodes) {
        if (Math.hypot(pt[0] - fn.ignitionPoint[0], pt[1] - fn.ignitionPoint[1]) <= (fn.safetyRadius || 6) + 2) {
          return true;
        }
      }
      for (const eo of evacOrders) {
        if (Math.hypot(pt[0] - eo.point[0], pt[1] - eo.point[1]) <= (eo.radius || 8) + 1) {
          return true;
        }
      }
      return false;
    };

    // 1) Estaciones menos saturadas del mismo o cercano tipo
    for (const st of engine.stations as SimStation[]) {
      if (st.cell == null || st.cell < 0 || !engine.available(st)) continue;
      const pt: Point = [
        ((st.x || 50) * engine.g.m.widthMeters) / 100,
        ((st.y || 50) * engine.g.m.heightMeters) / 100,
      ];
      if (Math.hypot(pt[0] - zone.point[0], pt[1] - zone.point[1]) < 6) continue;
      if (isNearEmergency(pt)) continue;
      const qCell = st.queueCell ?? st.cell;
      const field = engine.getFlow(qCell);
      if (field[zone.cell] < 0) continue;
      const load = (st.queue?.length || 0) + (st.serving?.length || 0);
      out.push({
        targetPoint: pt,
        targetCell: qCell,
        label: `Desvío hacia ${st.name || st.type}`,
        stationId: st.id,
        currentLoad: load,
        estimatedSideEffectDelta: Math.min(8, Math.max(1, Math.round(zone.peopleCount * 0.35))),
      });
    }

    // 2) Puntos de paso despejados de la malla si no hay estación alternativa
    if (!out.length && Array.isArray(engine.waypoints)) {
      for (const wp of engine.waypoints) {
        const pt = engine.g.point(wp) as Point;
        const d = Math.hypot(pt[0] - zone.point[0], pt[1] - zone.point[1]);
        if (d < 8 || d > 38) continue;
        if (isNearEmergency(pt)) continue;
        const field = engine.getFlow(wp);
        if (field[zone.cell] < 0) continue;
        const dens = engine.hashDensity(wp);
        if (dens <= 1) {
          out.push({
            targetPoint: pt,
            targetCell: wp,
            label: `Corredor alternativo (${pt[0].toFixed(0)} m, ${pt[1].toFixed(0)} m)`,
            currentLoad: dens,
            estimatedSideEffectDelta: Math.max(1, Math.round(zone.peopleCount * 0.25)),
          });
          if (out.length >= 2) break;
        }
      }
    }

    out.sort((a, b) => a.currentLoad - b.currentLoad);
    return out.slice(0, 3);
  }

  /** Evalúa una alternativa sin aplicarla ni mover visitantes (estudio contextual). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  studyAlternative(engine: any, zoneId: string): {
    alternatives: ViableAlternativeOption[];
    recommended?: ViableAlternativeOption;
    projectedReductionPct: number;
    caveat: string;
  } | null {
    const z = this.zones.get(zoneId);
    if (!z) return null;
    const alts = this.findViableAlternatives(engine, z);
    const rec = alts[0];
    return {
      alternatives: alts,
      recommended: rec,
      projectedReductionPct: rec ? 35 : 0,
      caveat: rec
        ? `Desviar hacia «${rec.label}» puede incrementar la carga de esa zona en ~${rec.estimatedSideEffectDelta} pers.`
        : 'No se encontró un corredor alternativo despejado compatible.',
    };
  }

  /**
   * Evalúa la respuesta humana individual ante una indicación colectiva de un auxiliar:
   * nunca asigna obediencia automática del 100 %.
   */
  evaluateVisitorResponse(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: any,
    agent: Agent,
    steward: StewardAgent,
    zone: CongestionZoneEvent
  ): GuidanceResponseKind {
    const p = agent.personality;
    const distM = Math.hypot(agent.x - steward.x, agent.y - steward.y);
    const clarity = Math.max(0.25, 1 - distM / 8) * (zone.nearStage ? 0.72 : 1);
    const rand = engine.humanRandom || engine.random;
    const roll = rand();

    if (agent.groupId && roll < 0.22) {
      return 'follow_group';
    }
    if ((agent.humanNeeds?.accessibilityNeed ?? 0) > 0.55 && roll < 0.35) {
      return 'request_support';
    }
    const acceptScore =
      0.42 * clarity +
      (p?.congestionReaction === 'avoid' ? 0.28 : p?.congestionReaction === 'wait' ? -0.15 : 0.08) +
      (zone.densityPerM2 > 0.65 ? 0.16 : 0);

    if (roll < acceptScore) return 'accept';
    if (roll < acceptScore + 0.24) return 'hesitate';
    return 'reject';
  }

  /**
   * Un auxiliar llegado al punto orienta colectivamente a un grupo de entre 1 y 10 personas próximas,
   * consumiendo tiempo y redirigiendo únicamente a quienes aceptan o siguen al grupo.
   */
  guideGroupAtZone(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: any,
    steward: StewardAgent,
    zone: CongestionZoneEvent
  ): number {
    const nearby = (engine.agents as Agent[]).filter(
      (a) =>
        a.state !== 'gone' &&
        a.state !== 'exit' &&
        Math.hypot(a.x - zone.point[0], a.y - zone.point[1]) <= 6.0 &&
        engine.time >= (a.guidanceCooldownUntil || 0)
    );
    if (!nearby.length) return 0;

    const alts = this.findViableAlternatives(engine, zone);
    zone.alternativeRoutesCount = alts.length;
    const alt = alts[0];
    if (alt) {
      zone.recommendedTargetPoint = alt.targetPoint;
      zone.recommendedTargetLabel = alt.label;
    }

    // Grupo reproducible de entre 1 y 10 visitantes, nunca más que los presentes cercanos
    const rand = engine.humanRandom || engine.random;
    const maxBatch = 1 + Math.floor(rand() * 10);
    const groupSlice = nearby.slice(0, Math.min(nearby.length, maxBatch));

    let redirected = 0;
    for (const ag of groupSlice) {
      ag.guidanceCooldownUntil = engine.time + 35;
      const resp = this.evaluateVisitorResponse(engine, ag, steward, zone);
      zone.guidedCount++;
      if (resp === 'accept') {
        zone.acceptedCount++;
        if (alt && this.applyAlternativeToAgent(engine, ag, alt)) {
          redirected++;
        }
      } else if (resp === 'follow_group') {
        zone.followGroupCount++;
        if (alt && redirected > 0 && this.applyAlternativeToAgent(engine, ag, alt)) {
          redirected++;
        }
      } else if (resp === 'hesitate') {
        zone.hesitatedCount++;
      } else if (resp === 'request_support') {
        zone.supportRequestCount++;
        if (alts[1] && this.applyAlternativeToAgent(engine, ag, alts[1])) {
          redirected++;
        }
      } else {
        zone.rejectedCount++;
      }
    }

    if (alt && redirected > 0) {
      zone.sideEffectLoadDelta = (zone.sideEffectLoadDelta || 0) + redirected;
      zone.sideEffectNote = `${redirected} personas redirigidas hacia ${alt.label}; aumento estimado en destino alternativo: +${redirected} pers.`;
      zone.status = 'mitigating';
    }

    steward.busyUntil = engine.time + 5 + Math.round(groupSlice.length * 0.65);
    steward.handled += groupSlice.length;
    if (engine.stewards?.metrics) {
      engine.stewards.metrics.oriented += groupSlice.length;
      if (redirected > 0) engine.stewards.metrics.decongested++;
      engine.stats.stewardOriented = engine.stewards.metrics.oriented;
      engine.stats.stewardDecongested = engine.stewards.metrics.decongested;
    }
    return groupSlice.length;
  }

  private applyAlternativeToAgent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: any,
    agent: Agent,
    alt: ViableAlternativeOption
  ): boolean {
    if (agent.state === 'queue' && agent.target) {
      const oldSt = engine.stations.find((s: SimStation) => s.id === agent.target);
      if (oldSt) {
        oldSt.queue = oldSt.queue.filter((id: number) => id !== agent.id);
      }
    }
    if (alt.stationId) {
      const st = engine.stations.find((s: SimStation) => s.id === alt.stationId);
      if (st) {
        agent.target = st.id || null;
        agent.approachCell = st.queueCell ?? st.cell;
        agent.approachField = engine.getFlow(agent.approachCell);
        agent.approachPoint = null;
        agent.state = 'walk';
        agent.stuck = 0;
        return true;
      }
    }
    agent.targetCell = alt.targetCell;
    agent.roamField = engine.getFlow(alt.targetCell);
    agent.roamUntil = engine.time + 120;
    agent.state = 'roam';
    agent.stuck = 0;
    return true;
  }

  /** Asigna manualmente (o en automático) un auxiliar libre hacia una congestión. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatchStewardToZone(engine: any, zoneId: string): StewardAgent | null {
    const zone = this.zones.get(zoneId);
    if (!zone || zone.status === 'resolved') return null;
    const stewards: StewardAgent[] = engine.stewards?.agents || [];
    const available = stewards.filter((sw) => sw.busyUntil <= engine.time);
    const pool = available.length ? available : stewards;
    if (!pool.length) return null;

    const chosen = pool
      .slice()
      .sort(
        (a, b) =>
          Math.hypot(a.x - zone.point[0], a.y - zone.point[1]) -
          Math.hypot(b.x - zone.point[0], b.y - zone.point[1])
      )[0];

    zone.assignedStewardId = chosen.id;
    zone.assignedStewardName = chosen.name;
    this.pendingDispatches.set(zone.id, chosen.id);
    chosen.state = 'decongest';
    chosen.target = [zone.point[0], zone.point[1]];
    chosen.note = `En camino a orientar congestión (${zone.peopleCount} pers.)`;
    return chosen;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(engine: any): void {
    const th = this.thresholds(engine);
    const mode = this.interventionMode(engine);

    // Comprobar auxiliares asignados que ya han llegado cerca de su congestión
    for (const [zId, swId] of [...this.pendingDispatches.entries()]) {
      const zone = this.zones.get(zId);
      const sw = (engine.stewards?.agents || []).find((s: StewardAgent) => s.id === swId);
      if (!zone || zone.status === 'resolved' || !sw) {
        this.pendingDispatches.delete(zId);
        continue;
      }
      if (sw.busyUntil > engine.time) continue;
      if (Math.hypot(sw.x - zone.point[0], sw.y - zone.point[1]) <= 4.5) {
        this.guideGroupAtZone(engine, sw, zone);
        this.pendingDispatches.delete(zId);
      } else {
        sw.target = [zone.point[0], zone.point[1]];
        sw.state = 'decongest';
      }
    }

    if (engine.time - this.lastScanAt < 2) return;
    this.lastScanAt = engine.time;

    // Agrupar población activa en celdas de 4x4 m (16 m²)
    const bins = new Map<string, Agent[]>();
    for (const a of engine.agents as Agent[]) {
      if (a.state === 'gone' || a.state === 'transport') continue;
      const bx = Math.floor(a.x / 4);
      const by = Math.floor(a.y / 4);
      const key = `${bx}:${by}`;
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key)!.push(a);
    }

    const stages = (engine.stations || []).filter(
      (s: SimStation) => s.type === 'stage'
    );
    const seenKeys = new Set<string>();

    for (const [binKey, list] of bins) {
      if (list.length < th.minPeople) continue;
      const cx = list.reduce((s, a) => s + a.x, 0) / list.length;
      const cy = list.reduce((s, a) => s + a.y, 0) / list.length;
      const density = list.length / 16;
      const stoppedCount = list.filter(
        (a) => a.stuck >= 1 || a.state === 'queue' || a.state === 'trapped' || (a.lastSpeedMs ?? 0) < 0.2
      ).length;
      const avgSpeed =
        list.reduce(
          (s, a) =>
            s + (a.state === 'queue' || a.stuck >= 1 ? 0.08 : a.lastSpeedMs ?? a.speed ?? 0.9),
          0
        ) / list.length;

      if (density < th.densityWarn || (avgSpeed > th.minSpeedMs && stoppedCount < th.minPeople - 1)) {
        continue;
      }

      seenKeys.add(binKey);

      // Comprobar flujos opuestos
      let opposingFlows = false;
      for (let i = 0; i < Math.min(list.length, 10); i++) {
        for (let j = i + 1; j < Math.min(list.length, 10); j++) {
          const h1 = list[i].heading;
          const h2 = list[j].heading;
          if (h1 != null && h2 != null && Math.cos(h1 - h2) < -0.5) {
            opposingFlows = true;
            break;
          }
        }
        if (opposingFlows) break;
      }

      const nearStage = stages.some((st: SimStation) => {
        const sp = world([st.x || 50, st.y || 50], engine.g.m);
        return Math.hypot(sp[0] - cx, sp[1] - cy) <= 14;
      });
      const isQueue = list.filter((a) => a.state === 'queue').length >= list.length * 0.5;
      const centerCell = Math.max(0, engine.g.nearest(cx, cy, 4));
      let freeCellsAround = 0;
      const [bx, by] = binKey.split(':').map(Number);
      for (let yy = by * 4; yy < (by + 1) * 4; yy += 1) {
        for (let xx = bx * 4; xx < (bx + 1) * 4; xx += 1) {
          const k = engine.g.index(xx, yy);
          if (k >= 0 && engine.g.free[k]) freeCellsAround++;
        }
      }
      const usefulWidthM = Math.max(1.0, Number((freeCellsAround * 0.35).toFixed(1)));

      let existing = [...this.zones.values()].find(
        (z) => z.status !== 'resolved' && Math.hypot(z.point[0] - cx, z.point[1] - cy) <= 5.5
      );
      const durationSec = existing ? Math.round(engine.time - existing.startedAt) : 2;

      let classification: CongestionClassification = 'pedestrian_congestion';
      if (nearStage && !opposingFlows && density < th.densityCritical) {
        classification = 'spectators';
      } else if ((density >= th.densityCritical && opposingFlows) || (usefulWidthM < 1.5 && density >= th.densityWarn * 1.6)) {
        classification = 'potentially_dangerous';
      } else if (isQueue && !opposingFlows && usefulWidthM >= 2.2) {
        classification = 'organized_queue';
      } else if (usefulWidthM < 2.2 && stoppedCount >= 4) {
        classification = 'corridor_block';
      } else if (durationSec >= 25) {
        classification = 'persistent_accumulation';
      }

      const nearestSt = (engine.stations as SimStation[])
        .map((st) => ({
          st,
          d: Math.hypot(
            ((st.x || 50) * engine.g.m.widthMeters) / 100 - cx,
            ((st.y || 50) * engine.g.m.heightMeters) / 100 - cy
          ),
        }))
        .sort((a, b) => a.d - b.d)[0];

      const possibleCause = nearStage
        ? 'Concentración habitual de público frente al escenario'
        : isQueue && nearestSt
          ? `Cola acumulada junto a ${nearestSt.st.name || nearestSt.st.type}`
          : opposingFlows
            ? 'Cruce de flujos peatonales en sentidos opuestos'
            : usefulWidthM < 2.2
              ? 'Estrechamiento o cuello de botella del paso útil'
              : 'Acumulación de paso lento entre puestos';

      if (!existing) {
        existing = {
          id: `cong-${this.seq++}`,
          cell: centerCell,
          point: [Number(cx.toFixed(2)), Number(cy.toFixed(2))],
          classification,
          status: 'active',
          startedAt: engine.time,
          lastSeenAt: engine.time,
          durationSec: 2,
          peopleCount: list.length,
          densityPerM2: Number(density.toFixed(2)),
          avgSpeedMs: Number(avgSpeed.toFixed(2)),
          stoppedCount,
          usefulWidthM,
          opposingFlows,
          possibleCause,
          nearStage,
          isQueue,
          alternativeRoutesCount: 0,
          guidedCount: 0,
          acceptedCount: 0,
          hesitatedCount: 0,
          rejectedCount: 0,
          followGroupCount: 0,
          supportRequestCount: 0,
        };
        this.zones.set(existing.id, existing);
      } else {
        existing.point = [Number(cx.toFixed(2)), Number(cy.toFixed(2))];
        existing.classification = classification;
        existing.lastSeenAt = engine.time;
        existing.durationSec = Math.round(engine.time - existing.startedAt);
        existing.peopleCount = list.length;
        existing.densityPerM2 = Number(density.toFixed(2));
        existing.avgSpeedMs = Number(avgSpeed.toFixed(2));
        existing.stoppedCount = stoppedCount;
        existing.usefulWidthM = usefulWidthM;
        existing.opposingFlows = opposingFlows;
        existing.possibleCause = possibleCause;
      }

      const alts = this.findViableAlternatives(engine, existing);
      existing.alternativeRoutesCount = alts.length;
      if (alts[0] && !existing.recommendedTargetLabel) {
        existing.recommendedTargetPoint = alts[0].targetPoint;
        existing.recommendedTargetLabel = alts[0].label;
      }

      // Intervención automática configurable
      const majorKinds: CongestionClassification[] = [
        'pedestrian_congestion',
        'corridor_block',
        'persistent_accumulation',
      ];
      if (
        existing.durationSec >= th.minDurationSec &&
        !this.pendingDispatches.has(existing.id) &&
        !existing.assignedStewardId
      ) {
        if (classification === 'potentially_dangerous') {
          // Peligro potencial: escalar aviso preventivo al sistema existente sin solo orientar
          if (engine.emergency?.events && !engine.emergency.events.some((ev: {congestionZoneId?: string}) => ev.congestionZoneId === existing!.id)) {
            const ev = engine.emergency.inject('congestion');
            if (ev) {
              ev.congestionZoneId = existing.id;
              ev.point = [...existing.point];
              ev.name = `Aglomeración crítica · ${existing.possibleCause}`;
              ev.severity = 'grave';
            }
          }
        } else if (
          (mode === 'major_only' && majorKinds.includes(classification)) ||
          (mode === 'all_compatible' && classification !== 'spectators')
        ) {
          this.dispatchStewardToZone(engine, existing.id);
        }
      }
    }

    // Marcar resueltas las congestiones que se despejan durante más de 8 s
    for (const z of this.zones.values()) {
      if (z.status !== 'resolved' && engine.time - z.lastSeenAt > 8) {
        z.status = 'resolved';
        this.pendingDispatches.delete(z.id);
      }
    }
  }

  /** Construye datos contextuales para el Inspector, usando «Dato no disponible» sin inventar métricas. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildInspectorData(zoneId: string, engine: any): CongestionInspectorData | null {
    const z = this.zones.get(zoneId);
    if (!z) return null;
    const freeStewards = (engine?.stewards?.agents || []).filter(
      (s: StewardAgent) => s.busyUntil <= (engine?.time || 0)
    ).length;

    const hasVal = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v);

    return {
      id: z.id,
      title: `CONGESTIÓN — ${CLASSIFICATION_LABELS[z.classification].toUpperCase()}`,
      classificationLabel: CLASSIFICATION_LABELS[z.classification],
      statusLabel:
        z.status === 'resolved'
          ? 'Resuelta'
          : z.status === 'mitigating'
            ? 'En mitigación'
            : 'Activa',
      startedAtLabel: hasVal(z.startedAt) ? fmtMMSS(z.startedAt) : 'Dato no disponible',
      durationLabel: hasVal(z.durationSec) ? fmtMMSS(z.durationSec) : 'Dato no disponible',
      peopleCountLabel: hasVal(z.peopleCount) ? `${z.peopleCount} personas` : 'Dato no disponible',
      densityLabel: hasVal(z.densityPerM2) ? `${z.densityPerM2.toFixed(2)} pers/m²` : 'Dato no disponible',
      avgSpeedLabel: hasVal(z.avgSpeedMs) ? `${z.avgSpeedMs.toFixed(2)} m/s` : 'Dato no disponible',
      possibleCause: z.possibleCause || 'Dato no disponible',
      availableStaffLabel:
        engine?.stewards?.agents != null
          ? `${freeStewards} auxiliares libres${z.assignedStewardName ? ` (asignado: ${z.assignedStewardName})` : ''}`
          : 'Dato no disponible',
      alternativeRoutesLabel:
        z.alternativeRoutesCount > 0
          ? `${z.alternativeRoutesCount} compatible(s)${z.recommendedTargetLabel ? ` · ${z.recommendedTargetLabel}` : ''}`
          : 'Sin ruta alternativa libre',
      sideEffectLabel: z.sideEffectNote || 'Sin desplazamiento secundario medido',
      guidedSummaryLabel:
        z.guidedCount > 0
          ? `${z.guidedCount} orientadas (aceptan: ${z.acceptedCount}, dudan: ${z.hesitatedCount}, rechazan: ${z.rejectedCount})`
          : 'Aún sin intervención colectiva',
      point: z.point,
      canDispatchSteward: z.status !== 'resolved' && freeStewards > 0,
    };
  }

  getMetrics() {
    const all = [...this.zones.values()];
    const active = all.filter((z) => z.status !== 'resolved');
    return {
      detectedTotal: all.length,
      activeCount: active.length,
      avgDurationSec: all.length
        ? Math.round(all.reduce((a, z) => a + z.durationSec, 0) / all.length)
        : 0,
      affectedPeopleMax: all.length
        ? Math.max(...all.map((z) => z.peopleCount))
        : 0,
      stewardsMobilized: new Set(
        all.map((z) => z.assignedStewardId).filter(Boolean)
      ).size,
      totalGuided: all.reduce((a, z) => a + z.guidedCount, 0),
      totalAccepted: all.reduce((a, z) => a + z.acceptedCount, 0),
      sideEffectsCount: all.filter((z) => (z.sideEffectLoadDelta || 0) > 0).length,
    };
  }

  /** Capa SVG clicable para marcadores de congestión sobre el mapa. */
  svg(): string {
    const active = [...this.zones.values()].filter((z) => z.status !== 'resolved');
    if (!active.length) return '';
    return active
      .map((z) => {
        const [x, y] = z.point;
        const color =
          z.classification === 'potentially_dangerous'
            ? '#D94841'
            : z.classification === 'spectators'
              ? '#64748B'
              : '#C17A32';
        return `<g data-inspect-congestion="${z.id}" class="congestion-map-marker" style="cursor:pointer"><title>${CLASSIFICATION_LABELS[z.classification]} · ${z.peopleCount} pers. · ${z.densityPerM2} pers/m² (clic para inspeccionar)</title><circle cx="${x}" cy="${y}" r="2.6" fill="${color}" fill-opacity=".22" stroke="${color}" stroke-width=".32" stroke-dasharray="1 .55"/><rect x="${
          x - 2.6
        }" y="${y - 4.1}" width="5.2" height="1.5" rx=".4" fill="${color}"/><text x="${x}" y="${
          y - 3.05
        }" text-anchor="middle" font-size="1.0" font-weight="700" fill="#ffffff">CON · ${
          z.peopleCount
        }</text></g>`;
      })
      .join('');
  }
}
