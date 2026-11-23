/**
 * @module engine/crowd/attendance-model
 * Modelo de afluencia dinámica centrada en asistentes únicos, perfiles horarios reales,
 * conservación estricta de población `ocupación(t+1) = ocupación(t) + entradas(t) - salidas(t)`,
 * público previo a apertura, reentradas y cohortes escalables de renderizado.
 */
import type {
  Agent,
  AttendanceConfig,
  AttendanceCurveProfile,
  Scene,
} from '../../types';
import {
  CURVE_ANCHORS_BY_PROFILE,
  deriveEventDemand,
  ensureEventDemandConfig,
  syncDemandConfigToScene,
} from '../planning/event-demand';
import {activities} from '../planning/programme';
import type {EventEngine} from './event-engine';

export interface AttendanceCurvePresetMeta {
  key: AttendanceCurveProfile;
  label: string;
  description: string;
}

export const ATTENDANCE_CURVE_PRESETS: Record<
  AttendanceCurveProfile,
  AttendanceCurvePresetMeta
> = {
  morning: {
    key: 'morning',
    label: 'Matinal',
    description: 'Mayor afluencia en la primera mitad del horario con descenso tras el mediodía.',
  },
  afternoon: {
    key: 'afternoon',
    label: 'Vespertino',
    description: 'Crecimiento progresivo en horario de tarde y salida escalonada.',
  },
  night: {
    key: 'night',
    label: 'Nocturno',
    description: 'Concentración tardía orientada a espectáculos o franja nocturna.',
  },
  full_day: {
    key: 'full_day',
    label: 'Jornada completa (multipico)',
    description: 'Jornada larga con pico matinal familiar, valle/comida al mediodía y pico vespertino.',
  },
  family: {
    key: 'family',
    label: 'Evento familiar',
    description: 'Fuerte componente diurno familiar con salidas antes de comidas y regreso vespertino suave.',
  },
  trade_fair: {
    key: 'trade_fair',
    label: 'Feria comercial',
    description: 'Entrada sostenida de mañana y tarde con ligero valle en la pausa de almuerzo.',
  },
  festival: {
    key: 'festival',
    label: 'Festival con actuaciones',
    description: 'Afluencia creciente vinculada a los horarios de escenario y conciertos principales.',
  },
  street_market: {
    key: 'street_market',
    label: 'Mercadillo de rotación continua',
    description: 'Visitas cortas y rotación constante con alta renovación horaria.',
  },
  custom: {
    key: 'custom',
    label: 'Curva personalizada',
    description: 'Pesos horarios editados manualmente sobre la gráfica.',
  },
};

function interpolateNormalizedCurve(
  anchors: number[],
  hours: number
): number[] {
  const safeHours = Math.max(1, Math.min(24, Math.round(hours || 6)));
  if (safeHours === 1) return [1];
  const out: number[] = [];
  for (let h = 0; h < safeHours; h++) {
    const pos = (h / (safeHours - 1)) * (anchors.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(anchors.length - 1, Math.ceil(pos));
    const frac = pos - lo;
    const val = anchors[lo] * (1 - frac) + anchors[hi] * frac;
    out.push(Math.max(0.08, val));
  }
  return out;
}

export interface HourlyAttendancePlan {
  hours: number;
  startHour: number;
  uniqueAttendees: number;
  curveProfile: AttendanceCurveProfile;
  weights: number[];
  hourlyEntries: number[];
  expectedExits: number[];
  expectedOccupancy: number[];
  peakSimultaneous: number;
}

/**
 * Calcula entradas, salidas y ocupación esperada por hora a partir de asistentes únicos,
 * curva elegida, clima, programa por días y objetivos SMART.
 */
export function buildHourlyAttendancePlan(
  scene: Scene,
  override?: Partial<AttendanceConfig>
): HourlyAttendancePlan {
  if (!override && scene.demandConfig) {
    const derived = deriveEventDemand(scene);
    return {
      hours: derived.config.hours,
      startHour: derived.config.startHour,
      uniqueAttendees: derived.plannedUniqueAttendees,
      curveProfile: derived.config.curveProfile,
      weights: derived.config.hourlyArrivals.map((v) => Math.max(0.05, Number(v) || 0.05)),
      hourlyEntries: [...derived.effectiveHourlyArrivals],
      expectedExits: derived.hourly.map((h) => h.exits),
      expectedOccupancy: derived.hourly.map((h) => h.peakOccupancy),
      peakSimultaneous: derived.peakSimultaneousOccupancy,
    };
  }
  const hours = Math.max(1, Math.min(24, Math.round(scene.base?.hours || 6)));
  const startHour = Number.isFinite(scene.base?.start) ? Number(scene.base.start) : 10;
  const cfg: Partial<AttendanceConfig> = {...scene.attendance, ...override};
  const curveProfile: AttendanceCurveProfile =
    cfg.curveProfile ||
    (hours >= 10 ? 'full_day' : 'trade_fair');

  const uniqueAttendees = Math.max(
    1,
    Math.round(
      cfg.uniqueAttendees ??
        (scene.base?.arrivals || 180) * hours * 0.72
    )
  );

  let weights: number[];
  if (
    curveProfile === 'custom' &&
    Array.isArray(cfg.customWeights) &&
    cfg.customWeights.length === hours
  ) {
    weights = cfg.customWeights.map((w) => Math.max(0.05, Number(w) || 0.05));
  } else {
    weights = interpolateNormalizedCurve(
      CURVE_ANCHORS_BY_PROFILE[curveProfile] || CURVE_ANCHORS_BY_PROFILE.full_day,
      hours
    );
  }

  // Integrar peso de actividades programadas / SMART (escenarios y talleres atraen franja específica)
  const selectedIds = new Set(scene.programmeOptions?.selected || []);
  const hasStageBooth = (scene.base?.booths || []).some((b) => b.type === 'stage');
  const hasMusicActivity =
    hasStageBooth ||
    activities.some((a) => selectedIds.has(a.id) && (a.need === 'stage' || a.category === 'Música')) ||
    (scene.customActivities || []).some((a) => a.need === 'stage' || a.category === 'Música');
  if (hasMusicActivity && hours >= 6) {
    const latePeakIdx = Math.min(hours - 1, Math.floor(hours * 0.75));
    weights[latePeakIdx] *= 1.18;
    if (latePeakIdx - 1 >= 0) weights[latePeakIdx - 1] *= 1.1;
  }

  // Factor meteorológico sobre exposición al aire libre
  const weather = scene.base?.weather || 'sun';
  const exposure = Number(scene.base?.exposure ?? 80) / 100;
  const loss = weather === 'rain' ? 0.35 : weather === 'wind' ? 0.18 : 0;
  const weatherMult = 1 - exposure * loss;

  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const stayHours = Math.max(
    0.35,
    Math.min(
      hours,
      ((scene.demandInputs?.stayMinutes ?? scene.base?.stay ?? 60) *
        (scene.objectives?.confirmedHypotheses?.confirmed
          ? scene.objectives.confirmedHypotheses.stayMultiplier || 1
          : 1)) /
        60
    )
  );

  const effectiveTotal = Math.max(1, Math.round(uniqueAttendees * weatherMult));
  const rawEntries = weights.map((w) => (effectiveTotal * w) / totalW);
  const hourlyEntries = rawEntries.map((v) => Math.max(0, Math.round(v)));
  // Ajustar redondeo para conservar exactamente el total planificado
  const diff = effectiveTotal - hourlyEntries.reduce((a, b) => a + b, 0);
  if (diff !== 0 && hourlyEntries.length) {
    const maxIdx = weights.indexOf(Math.max(...weights));
    hourlyEntries[maxIdx] = Math.max(0, hourlyEntries[maxIdx] + diff);
  }

  // Modelo discreto de salidas y ocupación por intervalo manteniendo conservación exacta
  const expectedExits = Array.from({length: hours}, () => 0);
  const expectedOccupancy = Array.from({length: hours}, () => 0);
  let active = 0;
  const cohortsLeavingAt = Array.from({length: hours + 1}, () => 0);
  for (let h = 0; h < hours; h++) {
    const ent = hourlyEntries[h];
    active += ent;
    const leaveSlot = Math.min(hours, Math.max(h + 1, Math.round(h + stayHours)));
    cohortsLeavingAt[leaveSlot] += ent;
    const out = Math.min(active, cohortsLeavingAt[h]);
    expectedExits[h] = out;
    active = Math.max(0, active - out);
    expectedOccupancy[h] = active;
  }

  return {
    hours,
    startHour,
    uniqueAttendees: effectiveTotal,
    curveProfile,
    weights,
    hourlyEntries,
    expectedExits,
    expectedOccupancy,
    peakSimultaneous: Math.max(0, ...expectedOccupancy),
  };
}

export interface PopulationCohortSummary {
  plannedAttendees: number;
  presentPopulation: number;
  activeAgents: number;
  renderedParticles: number;
  cohortScale: number;
  renderCap: number;
}

/**
 * Controla la dinámica real en ejecución separando asistentes únicos, entradas,
 * salidas, reentradas, ocupación simultánea y público previo a apertura.
 */
export class AttendanceModel {
  plan: HourlyAttendancePlan;
  config: AttendanceConfig;
  uniqueVisitorIds: Set<string>;
  entriesTotal: number;
  exitsTotal: number;
  reentriesTotal: number;
  earlyDepartures: number;
  simultaneousOccupancy: number;
  hourlyObservedEntries: number[];
  hourlyObservedExits: number[];
  ambientCounts: {
    passersby: number;
    waitingEarly: number;
    workers: number;
    earlyGroups: number;
  };
  pendingReentries: Array<{
    dueTime: number;
    uniqueVisitorId: string;
    profile: Agent['profile'];
    groupId?: string;
  }>;
  conservationLog: Array<{
    time: number;
    prev: number;
    entries: number;
    exits: number;
    next: number;
  }>;

  private lastSnapshotOccupancy = 0;
  private stepEntries = 0;
  private stepExits = 0;

  constructor(scene: Scene) {
    this.plan = buildHourlyAttendancePlan(scene);
    this.config = {
      uniqueAttendees: this.plan.uniqueAttendees,
      curveProfile: this.plan.curveProfile,
      customWeights: [...this.plan.weights],
      maxSimultaneousTarget: scene.attendance?.maxSimultaneousTarget,
      authorizedCapacity: scene.attendance?.authorizedCapacity,
      reentryShare: scene.attendance?.reentryShare ?? 0.08,
      spontaneousDiscoveryShare: scene.attendance?.spontaneousDiscoveryShare ?? 0.25,
      preOpeningAmbient: scene.attendance?.preOpeningAmbient ?? {
        passersby: 4,
        waitingEarly: 3,
        workers: 2,
        earlyGroups: 2,
      },
    };
    this.uniqueVisitorIds = new Set();
    this.entriesTotal = 0;
    this.exitsTotal = 0;
    this.reentriesTotal = 0;
    this.earlyDepartures = 0;
    this.simultaneousOccupancy = 0;
    this.hourlyObservedEntries = Array.from({length: this.plan.hours}, () => 0);
    this.hourlyObservedExits = Array.from({length: this.plan.hours}, () => 0);
    this.ambientCounts = {...(this.config.preOpeningAmbient || {
      passersby: 0,
      waitingEarly: 0,
      workers: 0,
      earlyGroups: 0,
    })};
    this.pendingReentries = [];
    this.conservationLog = [];
  }

  /** Registra una entrada de visitante único (o conversión de transeúnte a visitante). */
  recordUniqueEntry(visitorId: string, timeSec: number): void {
    this.uniqueVisitorIds.add(visitorId);
    this.entriesTotal++;
    this.stepEntries++;
    this.simultaneousOccupancy++;
    const bucket = Math.min(
      this.hourlyObservedEntries.length - 1,
      Math.max(0, Math.floor(timeSec / 3600))
    );
    if (bucket >= 0) this.hourlyObservedEntries[bucket]++;
  }

  /** Registra una reentrada sin contar un nuevo asistente único. */
  recordReentry(visitorId: string, timeSec: number): void {
    this.uniqueVisitorIds.add(visitorId);
    this.entriesTotal++;
    this.reentriesTotal++;
    this.stepEntries++;
    this.simultaneousOccupancy++;
    const bucket = Math.min(
      this.hourlyObservedEntries.length - 1,
      Math.max(0, Math.floor(timeSec / 3600))
    );
    if (bucket >= 0) this.hourlyObservedEntries[bucket]++;
  }

  /** Registra la salida de un visitante del aforo público (con o sin abandono anticipado). */
  recordExit(
    agent: {
      populationRole?: Agent['populationRole'];
      routine?: Agent['routine'];
      uniqueVisitorId?: string;
    },
    timeSec: number,
    canReenterLater = false
  ): void {
    // Los trabajadores o transeúntes que no entraron como público no alteran el aforo público
    if (agent.populationRole === 'worker' || agent.populationRole === 'passerby') {
      return;
    }
    this.exitsTotal++;
    this.stepExits++;
    this.simultaneousOccupancy = Math.max(0, this.simultaneousOccupancy - 1);
    const bucket = Math.min(
      this.hourlyObservedExits.length - 1,
      Math.max(0, Math.floor(timeSec / 3600))
    );
    if (bucket >= 0) this.hourlyObservedExits[bucket]++;

    if (
      agent.routine &&
      timeSec < agent.routine.plannedDepartureSec - 120 &&
      !canReenterLater
    ) {
      this.earlyDepartures++;
    }
  }

  scheduleReentry(
    agent: Agent,
    returnTimeSec: number
  ): void {
    if (!agent.uniqueVisitorId) return;
    this.pendingReentries.push({
      dueTime: returnTimeSec,
      uniqueVisitorId: agent.uniqueVisitorId,
      profile: agent.profile,
      groupId: agent.groupId,
    });
  }

  popDueReentries(timeSec: number): Array<{
    dueTime: number;
    uniqueVisitorId: string;
    profile: Agent['profile'];
    groupId?: string;
  }> {
    const due: typeof this.pendingReentries = [];
    const rest: typeof this.pendingReentries = [];
    for (const r of this.pendingReentries) {
      if (r.dueTime <= timeSec) due.push(r);
      else rest.push(r);
    }
    this.pendingReentries = rest;
    return due;
  }

  /** Registra y verifica `ocupación(t+1) = ocupación(t) + entradas(t) - salidas(t)`. */
  commitConservationStep(timeSec: number): boolean {
    const expected = this.lastSnapshotOccupancy + this.stepEntries - this.stepExits;
    const valid = expected === this.simultaneousOccupancy;
    this.conservationLog.push({
      time: timeSec,
      prev: this.lastSnapshotOccupancy,
      entries: this.stepEntries,
      exits: this.stepExits,
      next: this.simultaneousOccupancy,
    });
    if (this.conservationLog.length > 720) this.conservationLog.shift();
    this.lastSnapshotOccupancy = this.simultaneousOccupancy;
    this.stepEntries = 0;
    this.stepExits = 0;
    return valid;
  }

  get uniqueAttendeesCount(): number {
    return this.uniqueVisitorIds.size;
  }

  getPopulationCohorts(
    activeAgentsCount: number,
    maxRenderedAgents = 450
  ): PopulationCohortSummary {
    const cap = Math.max(40, Math.round(maxRenderedAgents));
    const rendered = Math.min(activeAgentsCount, cap);
    const scale = rendered > 0 ? Math.max(1, activeAgentsCount / rendered) : 1;
    return {
      plannedAttendees: this.plan.uniqueAttendees,
      presentPopulation: this.simultaneousOccupancy,
      activeAgents: activeAgentsCount,
      renderedParticles: rendered,
      cohortScale: Number(scale.toFixed(2)),
      renderCap: cap,
    };
  }
}

/**
 * Aplica cambios de demanda desde el instante actual de una simulación iniciada sin perder
 * el histórico previo, sin reiniciar el tiempo y sin duplicar partículas existentes.
 */
export function applyLiveDemandFromNow(
  engine: EventEngine,
  updatedScene: Scene
): void {
  const nextCfg = structuredClone(ensureEventDemandConfig(updatedScene));
  syncDemandConfigToScene(engine.s, nextCfg);

  const nextPlan = buildHourlyAttendancePlan(engine.s);
  const currentBucket = Math.max(0, Math.floor(engine.time / 3600));
  const mergedHourly = nextPlan.hourlyEntries.map((val, idx) =>
    idx < currentBucket && idx < engine.hourly.length ? engine.hourly[idx] : val
  );

  engine.duration = Math.max(3600, nextPlan.hours * 3600);
  if (engine.time < engine.duration) {
    engine.closing = false;
  }

  engine.attendance.plan = {
    ...nextPlan,
    hourlyEntries: mergedHourly,
  };
  engine.attendance.config = {
    ...engine.attendance.config,
    uniqueAttendees: nextPlan.uniqueAttendees,
    curveProfile: nextPlan.curveProfile,
    customWeights: [...nextPlan.weights],
    maxSimultaneousTarget: nextCfg.desiredMaxOccupancy ?? undefined,
    authorizedCapacity: nextCfg.authorizedCapacity ?? undefined,
    reentryShare: nextCfg.reentryRate,
  };

  while (engine.attendance.hourlyObservedEntries.length < nextPlan.hours) {
    engine.attendance.hourlyObservedEntries.push(0);
  }
  while (engine.attendance.hourlyObservedExits.length < nextPlan.hours) {
    engine.attendance.hourlyObservedExits.push(0);
  }

  engine.hourly = [...mergedHourly];
}
