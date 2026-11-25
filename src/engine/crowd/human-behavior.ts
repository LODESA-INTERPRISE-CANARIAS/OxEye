/**
 * @module engine/crowd/human-behavior
 * Rutinas horarias (`DailySchedule`), necesidades dinámicas (`NeedsEngine`),
 * cerebro sintético y decisiones por utilidad (`DecisionEngine`),
 * y grupos con separación/reencuentro (`SocialGroupManager`).
 */
import type {
  Agent,
  AgentPersonality,
  AttendanceCurveProfile,
  BehaviorHypotheses,
  BoothType,
  CrowdProfileKey,
  HumanNeedsState,
  Point,
  SimStation,
  SocialGroupKind,
  VisitorRoutine,
  VisitorRoutineKind,
  WeatherKind,
} from '../../types';
import type {SyntheticPersona} from './personas';

/** Asignador de rutinas y ventanas horarias de disponibilidad por visitante. */
export const DailySchedule = {
  assignRoutine(
    timeSec: number,
    durationSec: number,
    startHour: number,
    profile: CrowdProfileKey,
    curveProfile: AttendanceCurveProfile,
    random: () => number,
    stayMinutesBase: number,
    stayFactor: number,
    reentryShare = 0.08
  ): VisitorRoutine {
    const absHour = startHour + timeSec / 3600;
    const roll = random();
    let kind: VisitorRoutineKind = 'full_day_explorer';
    let plannedStaySec = Math.max(900, stayMinutesBase * 60 * stayFactor * (0.85 + random() * 0.35));
    let canReenter = false;
    let returnAfterSec: number | undefined;

    if (absHour < 13 && (profile === 'walker' || curveProfile === 'family') && roll < 0.45) {
      kind = 'morning_family';
      const maxBeforeLunch = Math.max(1200, (13.5 - absHour) * 3600);
      plannedStaySec = Math.min(plannedStaySec, maxBeforeLunch);
    } else if (absHour >= 17.5 && absHour <= 20 && roll < 0.55) {
      kind = 'post_work';
      plannedStaySec = Math.max(2400, Math.min(durationSec - timeSec, 3 * 3600));
    } else if (curveProfile === 'street_market' || (profile === 'buyer' && roll < 0.3)) {
      kind = 'quick_market';
      plannedStaySec = Math.max(1000, Math.min(plannedStaySec, 25 * 60));
    } else if (profile === 'music' || (curveProfile === 'festival' && absHour >= 17)) {
      kind = 'concert_evening';
      plannedStaySec = Math.max(plannedStaySec, durationSec - timeSec);
    } else if (roll < reentryShare && timeSec + plannedStaySec + 2400 < durationSec) {
      kind = 'split_reentry';
      canReenter = true;
      returnAfterSec = 1800 + Math.round(random() * 2400);
    } else if (roll < 0.14) {
      kind = 'spontaneous_passerby';
      plannedStaySec = Math.max(1200, Math.min(plannedStaySec, 45 * 60));
    }

    return {
      kind,
      arrivalTimeSec: timeSec,
      plannedDepartureSec: Math.min(durationSec, timeSec + plannedStaySec),
      canReenter,
      returnAfterSec,
    };
  },
};

/** Construye la personalidad funcional de 13 rasgos para el cerebro sintético del agente. */
export function buildAgentPersonality(
  persona: SyntheticPersona | undefined,
  random: () => number,
  behavior?: BehaviorHypotheses | null
): AgentPersonality {
  const patience = persona?.patience ?? 1;
  const spontaneity = persona?.spontaneity ?? 0.35;
  const archetype = persona?.archetype || 'walker';
  const congestionRoll = random();
  return {
    patience,
    impulsivity: Number((0.15 + spontaneity * 0.75).toFixed(2)),
    curiosity: Number((0.25 + random() * 0.65).toFixed(2)),
    planning: Number(Math.max(0.1, 1 - spontaneity * 0.8).toFixed(2)),
    spontaneity,
    commercialInterest: archetype === 'buyer' ? 0.88 : 0.42 + random() * 0.35,
    gastronomicInterest: archetype === 'foodie' ? 0.92 : 0.38 + random() * 0.4,
    quietPreference:
      (behavior?.shelterNeedBonus || 0) +
      (archetype === 'walker' ? 0.72 : 0.28 + random() * 0.4),
    priceSensitivity: Number(
      Math.max(0.15, Math.min(1, 1 - (persona?.budget ?? 35) / 100 + random() * 0.2)).toFixed(2)
    ),
    waitTolerance: Number((patience * (0.8 + random() * 0.4)).toFixed(2)),
    familiarity: Number((0.2 + random() * 0.65).toFixed(2)),
    activityKnowledge: Number((0.25 + random() * 0.65).toFixed(2)),
    congestionReaction:
      congestionRoll < 0.55 ? 'avoid' : congestionRoll < 0.82 ? 'tolerate' : 'wait',
  };
}

/** Motor dinámico de necesidades fisiológicas y motivaciones competitivas. */
export const NeedsEngine = {
  init(
    profile: CrowdProfileKey,
    personality: AgentPersonality,
    random: () => number,
    absHour: number
  ): HumanNeedsState {
    const lunchPeak = absHour >= 12.2 && absHour <= 15.2 ? 0.25 : 0;
    const dinnerPeak = absHour >= 19.2 && absHour <= 21.5 ? 0.25 : 0;
    return {
      hunger: Math.min(0.85, (profile === 'foodie' ? 0.45 : 0.15 + random() * 0.25) + lunchPeak + dinnerPeak),
      thirst: 0.15 + random() * 0.25,
      fatigue: 0.05 + random() * 0.15,
      toiletNeed: 0.05 + random() * 0.2,
      shadeNeed: 0.08 + random() * 0.2,
      shelterNeed: 0,
      quietPreference: personality.quietPreference,
      accessibilityNeed: personality.quietPreference > 0.75 ? 0.65 : 0.1,
    };
  },

  update(
    agent: Agent,
    dt: number,
    ctx: {
      absHour: number;
      weather: WeatherKind;
      nearStage: boolean;
      resting: boolean;
    }
  ): void {
    const needs = agent.humanNeeds;
    if (!needs) return;
    const inLunch = ctx.absHour >= 12.2 && ctx.absHour <= 15.2;
    const inDinner = ctx.absHour >= 19.2 && ctx.absHour <= 21.5;
    const hungerRate = inLunch || inDinner ? 0.00055 : 0.00022;
    const walkFactor = agent.state === 'walk' || agent.state === 'queue' ? 1.35 : 0.8;

    needs.hunger = Math.min(1, needs.hunger + hungerRate * dt);
    needs.thirst = Math.min(1, needs.thirst + (ctx.weather === 'sun' ? 0.00045 : 0.00022) * dt);
    needs.fatigue = ctx.resting
      ? Math.max(0, needs.fatigue - 0.0025 * dt)
      : Math.min(1, needs.fatigue + 0.00032 * walkFactor * dt);
    needs.toiletNeed = Math.min(1, needs.toiletNeed + 0.00024 * dt);
    needs.shadeNeed =
      ctx.weather === 'sun'
        ? Math.min(1, needs.shadeNeed + 0.0004 * dt)
        : Math.max(0, needs.shadeNeed - 0.001 * dt);
    needs.shelterNeed =
      ctx.weather === 'rain'
        ? Math.min(1, needs.shelterNeed + 0.0022 * dt)
        : Math.max(0, needs.shelterNeed - 0.002 * dt);
    if (ctx.nearStage && needs.quietPreference > 0.6) {
      needs.fatigue = Math.min(1, needs.fatigue + 0.0002 * dt);
    }
  },

  satisfyAfterService(agent: Agent, stationType: BoothType | string): void {
    const needs = agent.humanNeeds;
    if (!needs) return;
    if (stationType === 'food') {
      needs.hunger = Math.max(0, needs.hunger - 0.68);
      needs.thirst = Math.max(0, needs.thirst - 0.52);
      needs.toiletNeed = Math.min(1, needs.toiletNeed + 0.22);
    } else if (stationType === 'rest' || stationType === 'cover' || stationType === 'dining') {
      needs.fatigue = Math.max(0, needs.fatigue - 0.62);
      needs.shadeNeed = Math.max(0, needs.shadeNeed - 0.55);
    } else if (stationType === 'toilet') {
      needs.toiletNeed = Math.max(0, needs.toiletNeed - 0.85);
    }
  },

  /** Evalúa qué motivación o necesidad fisiológica gana prioridad competitiva en este instante. */
  dominantUrgentNeed(
    agent: Agent,
    hasType: (type: string) => boolean
  ): string | null {
    const needs = agent.humanNeeds;
    if (!needs) return null;
    if (needs.toiletNeed >= 0.78 && hasType('toilet')) return 'toilet';
    if (needs.hunger >= 0.72 && hasType('food')) return 'food';
    if (needs.fatigue >= 0.74 && hasType('rest')) return 'rest';
    return null;
  },
};

/** Motor de observación progresiva del recinto y decisión multicriterio por utilidad. */
export const DecisionEngine = {
  observeNearbyStations(
    engine: any,
    agent: Agent
  ): void {
    if (!agent.knownStationIds) agent.knownStationIds = [];
    const visionR = 20 + (agent.personality?.familiarity ?? 0.4) * 26;
    const known = new Set(agent.knownStationIds);
    for (const st of engine.stations as SimStation[]) {
      const sx = ((st.x || 50) * engine.g.m.widthMeters) / 100;
      const sy = ((st.y || 50) * engine.g.m.heightMeters) / 100;
      if (Math.hypot(sx - agent.x, sy - agent.y) <= visionR) {
        known.add(st.id || '');
      }
    }
    agent.knownStationIds = [...known].filter(Boolean);
  },

  selectStationByUtility(
    engine: any,
    agent: Agent,
    candidates: SimStation[],
    agentCell: number
  ): SimStation | null {
    if (!candidates.length) return null;
    const p = agent.personality;
    const known = new Set(agent.knownStationIds || []);
    const cellM = engine.g.cell || 0.75;
    const remainingMin = Math.max(1, ((agent.deadline || engine.time + 1800) - engine.time) / 60);

    const scored = candidates.map((b) => {
      const distCells = b.field?.[agentCell] >= 0 ? b.field[agentCell] : 80;
      const distMeters = distCells * cellM;
      const walkMin = distMeters / Math.max(0.6, (agent.speed || 1.1) * 60);
      const waitMin =
        ((b.queue.length || 0) / Math.max(1, b.capacity || 1)) * (b.minutes || 5);
      const totalTimeMin = walkMin + waitMin;

      // Penalización fuerte si la espera supera la tolerancia del agente o su tiempo restante
      const patienceBudgetMin =
        (engine.s.maxWait || 15) * (p?.waitTolerance ?? agent.persona?.patience ?? 1);
      const waitPenalty =
        waitMin > patienceBudgetMin * 0.85
          ? 2.8 + (waitMin - patienceBudgetMin * 0.85) * 0.25
          : 1 + waitMin / Math.max(3, patienceBudgetMin);

      const price = Number(b.price ?? engine.s.base?.ticket ?? 10);
      const remainingBudget = (agent.persona?.budget ?? 40) - (agent.spent || 0);
      const pricePenalty =
        price > remainingBudget
          ? 3.5
          : 1 + (price / Math.max(10, remainingBudget)) * (p?.priceSensitivity ?? 0.4) * 0.5;

      const localDensity = b.cell >= 0 ? engine.hashDensity(b.cell) : 0;
      const crowdPenalty =
        p?.congestionReaction === 'avoid' && localDensity >= 3
          ? 1 + localDensity * 0.22
          : 1;

      // Conocimiento parcial del recinto: los puestos ya observados o señalizados puntúan más
      const knowledgeFactor =
        known.has(b.id || '') || (p?.familiarity ?? 0.4) > 0.65 ? 1.25 : 0.85;

      const timeFit = totalTimeMin <= remainingMin ? 1 : 0.45;
      const utility =
        (((b.interest || 1) * knowledgeFactor * timeFit) /
          (waitPenalty * pricePenalty * crowdPenalty * (1 + distMeters / 220)));

      return {b, utility: Math.max(0.01, utility)};
    });

    scored.sort((x, y) => y.utility - x.utility);
    // Selección probabilística sesgada hacia la mayor utilidad (permite variación realista)
    const topPool = scored.slice(0, Math.min(3, scored.length));
    const rand = engine.humanRandom || engine.random;
    const sum = topPool.reduce((acc, s) => acc + s.utility, 0);
    let r = rand() * sum;
    for (const s of topPool) {
      r -= s.utility;
      if (r <= 0) return s.b;
    }
    return topPool[0].b;
  },
};

export interface SocialGroup {
  id: string;
  kind: SocialGroupKind;
  memberIds: number[];
  meetingPoint: Point;
  state: 'together' | 'split' | 'regrouping' | 'departing';
  regroupAtSec: number;
  sharedKnownStations: Set<string>;
}

/** Gestor de relaciones sociales: caminar juntos, separarse temporalmente y reencontrarse. */
export class SocialGroupManager {
  groups: Map<string, SocialGroup>;
  private seq = 1;

  constructor() {
    this.groups = new Map();
  }

  createGroup(
    kind: SocialGroupKind,
    members: Agent[],
    meetingPoint: Point
  ): SocialGroup {
    const id = `grp-${this.seq++}`;
    const group: SocialGroup = {
      id,
      kind,
      memberIds: members.map((m) => m.id),
      meetingPoint: [meetingPoint[0], meetingPoint[1]],
      state: 'together',
      regroupAtSec: 0,
      sharedKnownStations: new Set(),
    };
    members.forEach((m, idx) => {
      m.groupId = id;
      m.groupRole = idx === 0 ? 'leader' : 'member';
      for (const sid of m.knownStationIds || []) {
        group.sharedKnownStations.add(sid);
      }
    });
    this.groups.set(id, group);
    return group;
  }

  /** Comparte información conocida entre integrantes del mismo grupo. */
  shareKnowledge(group: SocialGroup, engine: any): void {
    for (const mid of group.memberIds) {
      const m = engine.byId.get(mid) as Agent | undefined;
      if (!m) continue;
      for (const sid of m.knownStationIds || []) {
        group.sharedKnownStations.add(sid);
      }
    }
    for (const mid of group.memberIds) {
      const m = engine.byId.get(mid) as Agent | undefined;
      if (!m) continue;
      m.knownStationIds = [...new Set([...(m.knownStationIds || []), ...group.sharedKnownStations])];
    }
  }

  /**
   * Separa temporalmente un grupo en actividades complementarias (ej. comida + mesa/descanso + comercio)
   * fijando un punto de encuentro posterior.
   */
  splitGroupForActivities(group: SocialGroup, engine: any, durationSec = 420): void {
    if (group.memberIds.length < 2) return;
    group.state = 'split';
    group.regroupAtSec = engine.time + durationSec;

    const restStation = engine.stations.find(
      (st: SimStation) => st.type === 'rest' || st.type === 'food'
    );
    if (restStation) {
      group.meetingPoint = [
        ((restStation.x || 50) * engine.g.m.widthMeters) / 100,
        ((restStation.y || 50) * engine.g.m.heightMeters) / 100,
      ];
    }

    const typesCycle: Array<'food' | 'rest' | 'commerce'> = ['food', 'rest', 'commerce'];
    group.memberIds.forEach((mid, idx) => {
      const m = engine.byId.get(mid) as Agent | undefined;
      if (!m || m.state === 'gone') return;
      const desired = typesCycle[idx % typesCycle.length];
      if (m.persona) {
        m.persona.needs = [desired, ...m.persona.needs.filter((n: string) => n !== desired)];
      }
    });
  }

  /** Coordina el reencuentro del grupo en el punto acordado y ajusta planes si alguien se marcha. */
  update(engine: any): void {
    for (const group of this.groups.values()) {
      group.memberIds = group.memberIds.filter((id) => {
        const a = engine.byId.get(id);
        return a && a.state !== 'gone';
      });
      if (!group.memberIds.length) continue;

      this.shareKnowledge(group, engine);

      const leaving = group.memberIds.some((id) => {
        const a = engine.byId.get(id) as Agent | undefined;
        return a && (a.state === 'exit' || engine.time >= (a.deadline || Infinity));
      });
      if (leaving && group.state !== 'departing') {
        group.state = 'departing';
        const rand = engine.humanRandom || engine.random;
        // Los acompañantes próximos adaptan su salida para abandonar juntos
        for (const id of group.memberIds) {
          const a = engine.byId.get(id) as Agent | undefined;
          if (a && a.state !== 'exit' && a.state !== 'gone' && rand() < 0.75) {
            engine.exit(a);
          }
        }
        continue;
      }

      if (group.state === 'split' && engine.time >= group.regroupAtSec) {
        group.state = 'regrouping';
        const meetCell = engine.g.nearest(group.meetingPoint[0], group.meetingPoint[1], 10);
        if (meetCell >= 0) {
          const field = engine.getFlow(meetCell);
          for (const id of group.memberIds) {
            const a = engine.byId.get(id) as Agent | undefined;
            if (!a || ['queue', 'service', 'serviceWalk', 'exit', 'gone'].includes(a.state)) {
              continue;
            }
            a.targetCell = meetCell;
            a.roamField = field;
            a.roamUntil = engine.time + 240;
            a.state = 'roam';
          }
        }
      } else if (group.state === 'regrouping') {
        const allNear = group.memberIds.every((id) => {
          const a = engine.byId.get(id) as Agent | undefined;
          return !a || Math.hypot(a.x - group.meetingPoint[0], a.y - group.meetingPoint[1]) <= 4.5;
        });
        if (allNear) {
          group.state = 'together';
        }
      }
    }
  }
}
