/**
 * @module engine/planning/event-demand
 * Fuente única canónica de configuración de demanda (`EventDemandConfig`) y cálculo derivado
 * de llegadas por hora, salidas, ocupación simultánea, aforo autorizado y balance de servicios.
 */
import type {
  AttendanceCurveProfile,
  DemandInputs,
  DemandPlanResult,
  DemandSourceKind,
  DwellTimeDistribution,
  EventDemandConfig,
  InfrastructureItem,
  Scene,
} from '../../types';
import {ensureProjectObjectives, OBJECTIVE_BY_ID} from './objectives';
import {activities} from './programme';

export const DEFAULT_SERVICE_PARAMS: EventDemandConfig['serviceParams'] = {
  foodShare: 35,
  serviceHourly: 30,
  utilization: 75,
  seatedShare: 80,
  mealMin: 10,
  mealMax: 20,
  tablesPerRoof: 8,
  shopShare: 40,
  shopMinutes: 8,
  shopPlaces: 3,
  toiletShare: 15,
  toiletMinutes: 4,
  children: 20,
  older: 20,
};

export const CURVE_ANCHORS_BY_PROFILE: Record<AttendanceCurveProfile, number[]> = {
  morning: [0.65, 1.15, 1.35, 1.1, 0.72, 0.42, 0.25],
  afternoon: [0.3, 0.55, 0.9, 1.25, 1.35, 1.05, 0.6],
  night: [0.22, 0.4, 0.78, 1.22, 1.45, 1.2, 0.58],
  full_day: [0.45, 0.92, 1.18, 1.05, 0.74, 0.86, 1.28, 1.36, 0.98, 0.45],
  family: [0.62, 1.2, 1.32, 0.85, 0.65, 1.05, 0.82, 0.38],
  trade_fair: [0.55, 1.08, 1.22, 0.75, 0.95, 1.18, 0.88, 0.42],
  festival: [0.28, 0.52, 0.78, 0.96, 1.18, 1.42, 1.34, 0.72],
  street_market: [0.75, 1.05, 1.18, 1.12, 0.98, 1.08, 0.92, 0.62],
  custom: [0.8, 1.0, 1.15, 1.0, 0.95, 0.85],
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function formatHourSlot(startHour: number, offsetHours: number): string {
  const from = ((Math.floor(startHour) + offsetHours) % 24 + 24) % 24;
  const to = (from + 1) % 24;
  return `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00`;
}

export function formatClockHour(startHour: number, elapsedSec: number): string {
  const totalMin = Math.floor(startHour * 60 + elapsedSec / 60);
  const hh = ((Math.floor(totalMin / 60) % 24) + 24) % 24;
  const mm = ((totalMin % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Interpola la curva base normalizada para un número de horas arbitrario. */
export function buildCurveWeightsForHours(
  profile: AttendanceCurveProfile,
  hours: number,
  scene?: Scene
): number[] {
  const safeHours = clampInt(hours, 1, 24);
  const anchors = CURVE_ANCHORS_BY_PROFILE[profile] || CURVE_ANCHORS_BY_PROFILE.full_day;
  const weights: number[] = [];
  if (safeHours === 1) {
    weights.push(1);
  } else {
    for (let h = 0; h < safeHours; h++) {
      const pos = (h / (safeHours - 1)) * (anchors.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(anchors.length - 1, Math.ceil(pos));
      const frac = pos - lo;
      weights.push(Math.max(0.08, anchors[lo] * (1 - frac) + anchors[hi] * frac));
    }
  }

  if (scene) {
    const selectedIds = new Set(scene.programmeOptions?.selected || []);
    const hasStageBooth = (scene.base?.booths || []).some((b) => b.type === 'stage');
    const hasMusicActivity =
      hasStageBooth ||
      activities.some(
        (a) => selectedIds.has(a.id) && (a.need === 'stage' || a.category === 'Música')
      ) ||
      (scene.customActivities || []).some(
        (a) => a.need === 'stage' || a.category === 'Música'
      );
    if (hasMusicActivity && safeHours >= 6 && profile !== 'custom') {
      const latePeakIdx = Math.min(safeHours - 1, Math.floor(safeHours * 0.75));
      weights[latePeakIdx] *= 1.18;
      if (latePeakIdx - 1 >= 0) weights[latePeakIdx - 1] *= 1.1;
    }
  }

  return weights;
}

/**
 * Escala un vector de pesos o barras a enteros no negativos cuya suma exacta equals `targetTotal`
 * usando reparto por resto mayor (Hamilton) para no introducir derivas de redondeo.
 */
export function scaleCurveToTotal(weights: number[], targetTotal: number): number[] {
  const len = Math.max(1, weights.length);
  const total = Math.max(0, Math.round(Number(targetTotal) || 0));
  if (total === 0) return Array.from({length: len}, () => 0);

  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = clean.reduce((a, b) => a + b, 0);
  const effective = weightSum > 0 ? clean : Array.from({length: len}, () => 1);
  const effectiveSum = effective.reduce((a, b) => a + b, 0);

  const raw = effective.map((w) => (w / effectiveSum) * total);
  const floors = raw.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const ranked = raw
    .map((v, i) => ({i, frac: v - floors[i]}))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  let k = 0;
  while (remainder > 0 && ranked.length > 0) {
    floors[ranked[k % ranked.length].i]++;
    remainder--;
    k++;
  }
  return floors;
}

function normalizeHourlyArray(
  raw: number[] | undefined,
  hours: number,
  profile: AttendanceCurveProfile,
  uniqueAttendees: number,
  scene?: Scene
): number[] {
  if (Array.isArray(raw) && raw.length === hours) {
    const clean = raw.map((v) => Math.max(0, Math.round(Number(v) || 0)));
    const sum = clean.reduce((a, b) => a + b, 0);
    if (sum === uniqueAttendees) return clean;
    if (sum > 0) return scaleCurveToTotal(clean, uniqueAttendees);
  }
  if (Array.isArray(raw) && raw.length > 1 && raw.some((v) => v > 0)) {
    // Reinterpolación suave cuando cambia la duración conservando la forma
    const resampled: number[] = [];
    for (let h = 0; h < hours; h++) {
      const pos = hours === 1 ? 0 : (h / (hours - 1)) * (raw.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(raw.length - 1, Math.ceil(pos));
      const frac = pos - lo;
      resampled.push(Math.max(0.05, (raw[lo] || 0) * (1 - frac) + (raw[hi] || 0) * frac));
    }
    return scaleCurveToTotal(resampled, uniqueAttendees);
  }
  return scaleCurveToTotal(buildCurveWeightsForHours(profile, hours, scene), uniqueAttendees);
}

/** Estima superficie libre operativa en m² a partir del perímetro o valor de entrada del escenario. */
export function estimateSceneOperatingArea(scene: Scene): number {
  if (scene.demandConfig?.operationalAreaM2 && scene.demandConfig.operationalAreaM2 > 0) {
    return Math.round(scene.demandConfig.operationalAreaM2);
  }
  if (scene.demandInputs?.area && scene.demandInputs.area > 0) {
    return Math.round(scene.demandInputs.area);
  }
  const spacePct = clampNum(Number(scene.base?.space ?? 65), 10, 100) / 100;
  return Math.max(250, Math.round(1600 * spacePct));
}

/**
 * Devuelve la configuración canónica `EventDemandConfig` de una escena, migrando
 * de forma no destructiva escenas antiguas sin inventar aforos ni borrar la tasa previa.
 */
export function ensureEventDemandConfig(scene: Scene): EventDemandConfig {
  const existing = scene.demandConfig;
  if (existing && Number.isFinite(existing.uniqueAttendees)) {
    const hours = clampInt(existing.hours ?? scene.base?.hours ?? 8, 1, 24);
    const startHour = clampNum(existing.startHour ?? scene.base?.start ?? 10, 0, 23.75);
    const uniqueAttendees = clampInt(existing.uniqueAttendees, 0, 500000);
    const profile: AttendanceCurveProfile = existing.curveProfile || (hours >= 10 ? 'full_day' : 'trade_fair');
    const dwellTimeMinutes = clampInt(existing.dwellTimeMinutes ?? scene.base?.stay ?? 60, 10, 720);
    const authCap =
      existing.authorizedCapacity != null && Number(existing.authorizedCapacity) > 0
        ? Math.round(Number(existing.authorizedCapacity))
        : null;
    const desiredMax =
      existing.desiredMaxOccupancy != null && Number(existing.desiredMaxOccupancy) > 0
        ? Math.round(Number(existing.desiredMaxOccupancy))
        : null;
    const hourlyArrivals = normalizeHourlyArray(
      existing.hourlyArrivals,
      hours,
      profile,
      uniqueAttendees,
      scene
    );
    return {
      date: existing.date || '2026-05-01',
      startHour,
      hours,
      uniqueAttendees,
      curveProfile: profile,
      hourlyArrivals,
      dwellTimeMinutes,
      dwellDistribution: {
        meanMinutes: dwellTimeMinutes,
        spreadRatio: clampNum(existing.dwellDistribution?.spreadRatio ?? 0.35, 0.05, 0.9),
        shortShare: clampNum(existing.dwellDistribution?.shortShare ?? 0.25, 0, 0.7),
        longShare: clampNum(existing.dwellDistribution?.longShare ?? 0.2, 0, 0.7),
      },
      desiredMaxOccupancy: desiredMax,
      authorizedCapacity: authCap,
      operationalAreaM2:
        existing.operationalAreaM2 != null && Number(existing.operationalAreaM2) > 0
          ? Math.round(Number(existing.operationalAreaM2))
          : null,
      reentryRate: clampNum(existing.reentryRate ?? scene.attendance?.reentryShare ?? 0.08, 0, 0.5),
      provenance: existing.provenance || 'manual',
      legacyHourlyRate: existing.legacyHourlyRate,
      serviceParams: {
        ...DEFAULT_SERVICE_PARAMS,
        ...existing.serviceParams,
      },
      updatedAt: existing.updatedAt || new Date().toISOString(),
      revision: Number.isFinite(existing.revision) ? existing.revision : 1,
    };
  }

  // Migración limpia desde modelos previos (`attendance`, `demandInputs`, `base.arrivals`)
  const hours = clampInt(scene.demandInputs?.hours ?? scene.base?.hours ?? 8, 1, 24);
  const startHour = clampNum(scene.base?.start ?? 10, 0, 23.75);
  const dwellTimeMinutes = clampInt(scene.demandInputs?.stayMinutes ?? scene.base?.stay ?? 60, 10, 720);
  const legacyRate = Math.max(0, Math.round(Number(scene.base?.arrivals ?? 200)));

  const hasExplicitAttendance = Boolean(
    scene.attendance &&
      typeof scene.attendance.uniqueAttendees === 'number' &&
      scene.attendance.uniqueAttendees > 0
  );
  const hasExplicitDemandUnique = Boolean(
    scene.demandInputs?.uniqueAttendees && scene.demandInputs.uniqueAttendees > 0
  );

  const uniqueAttendees = hasExplicitDemandUnique
    ? Math.round(scene.demandInputs!.uniqueAttendees!)
    : hasExplicitAttendance
      ? Math.round(scene.attendance!.uniqueAttendees)
      : Math.max(1, legacyRate * hours);

  const curveProfile: AttendanceCurveProfile =
    scene.demandInputs?.curveProfile ||
    scene.attendance?.curveProfile ||
    (hours >= 10 ? 'full_day' : 'trade_fair');

  const provenance: DemandSourceKind =
    hasExplicitAttendance || hasExplicitDemandUnique
      ? curveProfile === 'custom'
        ? 'manual'
        : 'curve_preset'
      : 'legacy_hourly_migration';

  const seedWeights =
    curveProfile === 'custom' &&
    Array.isArray(scene.attendance?.customWeights) &&
    scene.attendance!.customWeights!.length === hours
      ? scene.attendance!.customWeights!
      : buildCurveWeightsForHours(curveProfile, hours, scene);

  const hourlyArrivals = scaleCurveToTotal(seedWeights, uniqueAttendees);

  const rawCap =
    scene.demandInputs?.authorizedCapacity ?? scene.attendance?.authorizedCapacity ?? null;
  const authorizedCapacity = rawCap != null && Number(rawCap) > 0 ? Math.round(Number(rawCap)) : null;

  const rawTarget =
    scene.demandInputs?.maxSimultaneousTarget ?? scene.attendance?.maxSimultaneousTarget ?? null;
  const desiredMaxOccupancy =
    rawTarget != null && Number(rawTarget) > 0 ? Math.round(Number(rawTarget)) : null;

  return {
    date: '2026-05-01',
    startHour,
    hours,
    uniqueAttendees,
    curveProfile,
    hourlyArrivals,
    dwellTimeMinutes,
    dwellDistribution: {
      meanMinutes: dwellTimeMinutes,
      spreadRatio: 0.35,
      shortShare: 0.25,
      longShare: 0.2,
    },
    desiredMaxOccupancy,
    authorizedCapacity,
    operationalAreaM2:
      scene.demandInputs?.area && scene.demandInputs.area > 0
        ? Math.round(scene.demandInputs.area)
        : null,
    reentryRate: clampNum(scene.attendance?.reentryShare ?? 0.08, 0, 0.5),
    provenance,
    legacyHourlyRate: provenance === 'legacy_hourly_migration' ? legacyRate : undefined,
    serviceParams: {
      foodShare: scene.demandInputs?.foodShare ?? DEFAULT_SERVICE_PARAMS.foodShare,
      serviceHourly: scene.demandInputs?.serviceHourly ?? DEFAULT_SERVICE_PARAMS.serviceHourly,
      utilization: scene.demandInputs?.utilization ?? DEFAULT_SERVICE_PARAMS.utilization,
      seatedShare: scene.demandInputs?.seatedShare ?? DEFAULT_SERVICE_PARAMS.seatedShare,
      mealMin: scene.demandInputs?.mealMin ?? DEFAULT_SERVICE_PARAMS.mealMin,
      mealMax: scene.demandInputs?.mealMax ?? DEFAULT_SERVICE_PARAMS.mealMax,
      tablesPerRoof: scene.demandInputs?.tablesPerRoof ?? DEFAULT_SERVICE_PARAMS.tablesPerRoof,
      shopShare: scene.demandInputs?.shopShare ?? DEFAULT_SERVICE_PARAMS.shopShare,
      shopMinutes: scene.demandInputs?.shopMinutes ?? DEFAULT_SERVICE_PARAMS.shopMinutes,
      shopPlaces: scene.demandInputs?.shopPlaces ?? DEFAULT_SERVICE_PARAMS.shopPlaces,
      toiletShare: scene.demandInputs?.toiletShare ?? DEFAULT_SERVICE_PARAMS.toiletShare,
      toiletMinutes: scene.demandInputs?.toiletMinutes ?? DEFAULT_SERVICE_PARAMS.toiletMinutes,
      children: scene.demandInputs?.children ?? DEFAULT_SERVICE_PARAMS.children,
      older: scene.demandInputs?.older ?? DEFAULT_SERVICE_PARAMS.older,
    },
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
}

export interface DerivedHourlyDemandSlot {
  hourIndex: number;
  label: string;
  entries: number;
  exits: number;
  reentries: number;
  startOccupancy: number;
  peakOccupancy: number;
  endOccupancy: number;
  occupancyRatePct: number | null;
  isCriticalPeak: boolean;
}

export interface ServiceBalanceRow {
  key: 'food' | 'tables' | 'roofs' | 'shops' | 'toilets';
  label: string;
  placed: number;
  requiredAverage: number;
  requiredPeakSlot: number;
  deltaAtPeak: number;
  status: 'ok' | 'deficit' | 'surplus';
}

export interface DerivedEventDemand {
  config: EventDemandConfig;
  /** Suma real de llegadas por hora (= asistentes únicos planificados). */
  plannedUniqueAttendees: number;
  plannedReentriesTotal: number;
  plannedTotalEntries: number;
  /** Llegadas medias por hora de apertura (`uniqueAttendees / hours`). */
  averageArrivalsPerHour: number;
  /** Pico horario de llegadas entre todas las franjas. */
  peakHourlyArrivals: number;
  peakArrivalHourIndex: number;
  peakArrivalHourLabel: string;
  /** Ocupación simultánea media y máxima prevista (por subintervalos de 15 min). */
  averageSimultaneousOccupancy: number;
  peakSimultaneousOccupancy: number;
  peakOccupancyHourIndex: number;
  peakOccupancyHourLabel: string;
  /** Detalle por hora garantizando `occ(t+1) = occ(t) + entradas(t) - salidas(t)`. */
  hourly: DerivedHourlyDemandSlot[];
  /** Estado frente a aforo autorizado (sin inventar valores si es `null`). */
  capacityStatus: {
    defined: boolean;
    authorizedCapacity: number | null;
    label: string;
    peakOccupancyPct: number | null;
    remainingMargin: number | null;
    exceedsAuthorized: boolean;
    exceedsDesiredTarget: boolean;
  };
  /** Balance de servicios comparando media vs franja crítica e inventario colocado. */
  operatingAreaM2: number;
  averageServicesPlan: DemandPlanResult;
  criticalServicesPlan: DemandPlanResult;
  serviceBalance: ServiceBalanceRow[];
  /** Parámetros compatibles para llamadas puntuales a módulos heredados. */
  legacyDemandInputs: DemandInputs;
  weatherFactor: number;
  effectiveHourlyArrivals: number[];
}

function computePlanFromRates(
  hourlyRate: number,
  simultaneousOccupancy: number,
  area: number,
  cfg: EventDemandConfig
): DemandPlanResult {
  const sp = cfg.serviceParams;
  const foodDemandHourly = (hourlyRate * sp.foodShare) / 100;
  const meanMeal = (sp.mealMin + sp.mealMax) / 2;
  const food = Math.ceil(
    foodDemandHourly / Math.max(1, (sp.serviceHourly * sp.utilization) / 100)
  );
  const seats = Math.ceil((((foodDemandHourly * meanMeal) / 60) * sp.seatedShare) / 100);
  const tables = Math.ceil(seats / 6);
  const roofs = Math.ceil(tables / Math.max(1, sp.tablesPerRoof));
  const shops = Math.ceil(
    (((hourlyRate * sp.shopShare) / 100) * sp.shopMinutes) /
      60 /
      Math.max(1, sp.shopPlaces)
  );
  const toilets = Math.ceil(
    (((simultaneousOccupancy * sp.toiletShare) / 100) * sp.toiletMinutes) /
      60 /
      Math.max(0.1, sp.utilization / 100)
  );
  const modules = food * 20 + tables * 5.4 + shops * 12 + toilets * 2.5;
  const childSeats = Math.ceil((seats * sp.children) / 100);
  const olderSeats = Math.ceil((seats * sp.older) / 100);
  return {
    hourly: foodDemandHourly,
    food,
    seats,
    tables,
    roofs,
    shops,
    toilets,
    occupied: simultaneousOccupancy,
    modules,
    childSeats,
    olderSeats,
    remaining: area - modules,
  };
}

/**
 * Calcula todos los indicadores derivados de demanda desde `EventDemandConfig`.
 * Nunca usa el pico horario como ocupación media ni altera los valores de entrada.
 */
export function deriveEventDemand(
  scene: Scene,
  overrideConfig?: EventDemandConfig
): DerivedEventDemand {
  const cfg = overrideConfig ? overrideConfig : ensureEventDemandConfig(scene);
  const hours = clampInt(cfg.hours, 1, 24);
  const hourlyArrivals = normalizeHourlyArray(
    cfg.hourlyArrivals,
    hours,
    cfg.curveProfile,
    cfg.uniqueAttendees,
    scene
  );
  const plannedUniqueAttendees = hourlyArrivals.reduce((a, b) => a + b, 0);

  // Simulación discreta en pasos de 15 min (4 pasos/h) manteniendo conservación exacta
  const stepsPerHour = 4;
  const totalSteps = hours * stepsPerHour;
  const stepEntries = Array.from({length: totalSteps}, () => 0);
  for (let h = 0; h < hours; h++) {
    const prev = h > 0 ? hourlyArrivals[h - 1] : hourlyArrivals[h] * 0.85;
    const curr = hourlyArrivals[h];
    const next = h < hours - 1 ? hourlyArrivals[h + 1] : hourlyArrivals[h] * 0.75;
    const quarterWeights = [
      Math.max(0.1, curr * 0.75 + prev * 0.25),
      Math.max(0.1, curr),
      Math.max(0.1, curr),
      Math.max(0.1, curr * 0.75 + next * 0.25),
    ];
    const quarters = scaleCurveToTotal(quarterWeights, hourlyArrivals[h]);
    for (let q = 0; q < stepsPerHour; q++) {
      stepEntries[h * stepsPerHour + q] = quarters[q];
    }
  }

  const dist: DwellTimeDistribution = cfg.dwellDistribution || {
    meanMinutes: cfg.dwellTimeMinutes,
    spreadRatio: 0.35,
    shortShare: 0.25,
    longShare: 0.2,
  };
  const meanMin = clampNum(dist.meanMinutes || cfg.dwellTimeMinutes, 10, 720);
  const spread = clampNum(dist.spreadRatio ?? 0.35, 0.05, 0.9);
  const shortShare = clampNum(dist.shortShare ?? 0.25, 0, 0.7);
  const longShare = clampNum(dist.longShare ?? 0.2, 0, 0.7);
  const coreShare = Math.max(0.1, 1 - shortShare - longShare);

  const dShort = Math.max(1, Math.round((meanMin * Math.max(0.25, 1 - spread)) / 15));
  const dCore = Math.max(1, Math.round(meanMin / 15));
  const dLong = Math.max(1, Math.round((meanMin * (1 + spread * 1.4)) / 15));

  // Salidas programadas por paso (el índice `totalSteps` corresponde al desalojo final de cierre)
  const scheduledExits = Array.from({length: totalSteps + 1}, () => 0);
  const scheduledReentries = Array.from({length: totalSteps + 1}, () => 0);

  let active = 0;
  let plannedReentriesTotal = 0;
  const hourlyExits = Array.from({length: hours}, () => 0);
  const hourlyReentries = Array.from({length: hours}, () => 0);
  const hourlyStartOcc = Array.from({length: hours}, () => 0);
  const hourlyPeakOcc = Array.from({length: hours}, () => 0);
  const hourlyEndOcc = Array.from({length: hours}, () => 0);

  let stepOccSum = 0;

  for (let t = 0; t < totalSteps; t++) {
    const h = Math.floor(t / stepsPerHour);
    if (t % stepsPerHour === 0) {
      hourlyStartOcc[h] = active;
      hourlyPeakOcc[h] = active;
    }

    const reentryHere = scheduledReentries[t];
    const ent = stepEntries[t] + reentryHere;
    const rawTotalHere = stepEntries[t];
    if (rawTotalHere > 0) {
      const split = scaleCurveToTotal([shortShare, coreShare, longShare], rawTotalHere);
      const durations = [dShort, dCore, dLong];
      for (let i = 0; i < 3; i++) {
        if (split[i] <= 0) continue;
        const leaveStep = Math.min(totalSteps, t + durations[i]);
        scheduledExits[leaveStep] += split[i];
      }
    }
    if (reentryHere > 0) {
      const leaveReentry = Math.min(totalSteps, t + Math.max(1, Math.round(dShort)));
      scheduledExits[leaveReentry] += reentryHere;
      hourlyReentries[h] += reentryHere;
      plannedReentriesTotal += reentryHere;
    }

    const out = Math.min(active + ent, scheduledExits[t]);
    // Conservación exacta: ocupación(t+1) = ocupación(t) + entradas(t) - salidas(t)
    const nextActive = Math.max(0, active + ent - out);
    hourlyExits[h] += out;

    // Reentradas diferidas de parte de quienes salen temprano
    if (cfg.reentryRate > 0 && out > 0 && t + 3 < totalSteps) {
      const candidates = Math.floor(out * cfg.reentryRate);
      if (candidates > 0) {
        scheduledReentries[Math.min(totalSteps - 1, t + 2)] += candidates;
      }
    }

    active = nextActive;
    hourlyPeakOcc[h] = Math.max(hourlyPeakOcc[h], active);
    stepOccSum += active;

    if (t % stepsPerHour === stepsPerHour - 1) {
      hourlyEndOcc[h] = active;
    }
  }

  let peakHourlyArrivals = 0;
  let peakArrivalHourIndex = 0;
  let peakSimultaneousOccupancy = 0;
  let peakOccupancyHourIndex = 0;

  for (let h = 0; h < hours; h++) {
    if (hourlyArrivals[h] > peakHourlyArrivals) {
      peakHourlyArrivals = hourlyArrivals[h];
      peakArrivalHourIndex = h;
    }
    if (hourlyPeakOcc[h] > peakSimultaneousOccupancy) {
      peakSimultaneousOccupancy = hourlyPeakOcc[h];
      peakOccupancyHourIndex = h;
    }
  }

  const authorizedCapacity =
    cfg.authorizedCapacity != null && cfg.authorizedCapacity > 0 ? cfg.authorizedCapacity : null;

  const hourly: DerivedHourlyDemandSlot[] = Array.from({length: hours}, (_, h) => ({
    hourIndex: h,
    label: formatHourSlot(cfg.startHour, h),
    entries: hourlyArrivals[h],
    exits: hourlyExits[h],
    reentries: hourlyReentries[h],
    startOccupancy: hourlyStartOcc[h],
    peakOccupancy: hourlyPeakOcc[h],
    endOccupancy: hourlyEndOcc[h],
    occupancyRatePct:
      authorizedCapacity != null
        ? Math.round((hourlyPeakOcc[h] / authorizedCapacity) * 100)
        : null,
    isCriticalPeak: h === peakOccupancyHourIndex || h === peakArrivalHourIndex,
  }));

  const averageArrivalsPerHour = hours > 0 ? plannedUniqueAttendees / hours : 0;
  const averageSimultaneousOccupancy = totalSteps > 0 ? Math.round(stepOccSum / totalSteps) : 0;

  const operatingAreaM2 = estimateSceneOperatingArea(scene);
  const averageServicesPlan = computePlanFromRates(
    averageArrivalsPerHour,
    averageSimultaneousOccupancy,
    operatingAreaM2,
    cfg
  );
  const criticalServicesPlan = computePlanFromRates(
    peakHourlyArrivals,
    peakSimultaneousOccupancy,
    operatingAreaM2,
    cfg
  );

  const placedFood = (scene.base?.booths || []).filter((b) => b.type === 'food').length;
  const placedShops = (scene.base?.booths || []).filter((b) => b.type === 'commerce').length;
  const placedTables = (scene.infrastructure || []).filter((i) => i.kind === 'picnic').length;
  const placedRoofs = (scene.infrastructure || []).filter(
    (i: InfrastructureItem) => i.role === 'cover'
  ).length;
  const placedToilets = (scene.infrastructure || []).filter((i) => i.kind === 'toilet').length;

  const mkServiceRow = (
    key: ServiceBalanceRow['key'],
    label: string,
    placed: number,
    reqAvg: number,
    reqPeak: number
  ): ServiceBalanceRow => {
    const deltaAtPeak = placed - reqPeak;
    return {
      key,
      label,
      placed,
      requiredAverage: reqAvg,
      requiredPeakSlot: reqPeak,
      deltaAtPeak,
      status: deltaAtPeak < 0 ? 'deficit' : deltaAtPeak > 0 ? 'surplus' : 'ok',
    };
  };

  const serviceBalance: ServiceBalanceRow[] = [
    mkServiceRow(
      'food',
      'Puestos de comida',
      placedFood,
      averageServicesPlan.food,
      criticalServicesPlan.food
    ),
    mkServiceRow(
      'tables',
      'Mesas (6 plazas)',
      placedTables,
      averageServicesPlan.tables,
      criticalServicesPlan.tables
    ),
    mkServiceRow(
      'roofs',
      'Carpas de sombra/refugio',
      placedRoofs,
      averageServicesPlan.roofs,
      criticalServicesPlan.roofs
    ),
    mkServiceRow(
      'shops',
      'Comercios locales',
      placedShops,
      averageServicesPlan.shops,
      criticalServicesPlan.shops
    ),
    mkServiceRow(
      'toilets',
      'Aseos públicos',
      placedToilets,
      averageServicesPlan.toilets,
      criticalServicesPlan.toilets
    ),
  ];

  const weather = scene.base?.weather || 'sun';
  const exposure = Number(scene.base?.exposure ?? 80) / 100;
  const weatherLoss = weather === 'rain' ? 0.35 : weather === 'wind' ? 0.18 : 0;
  const weatherFactor = clampNum(1 - exposure * weatherLoss, 0.25, 1);
  const effectiveTotal = Math.max(0, Math.round(plannedUniqueAttendees * weatherFactor));
  const effectiveHourlyArrivals =
    weatherFactor < 0.999
      ? scaleCurveToTotal(hourlyArrivals, effectiveTotal)
      : [...hourlyArrivals];

  const legacyDemandInputs: DemandInputs = {
    arrivals: Math.round(averageArrivalsPerHour),
    uniqueAttendees: plannedUniqueAttendees,
    curveProfile: cfg.curveProfile,
    hours,
    maxSimultaneousTarget: cfg.desiredMaxOccupancy ?? undefined,
    authorizedCapacity: authorizedCapacity ?? undefined,
    area: operatingAreaM2,
    stayMinutes: cfg.dwellTimeMinutes,
    ...cfg.serviceParams,
  };

  const peakPct =
    authorizedCapacity != null
      ? Math.round((peakSimultaneousOccupancy / authorizedCapacity) * 100)
      : null;

  return {
    config: cfg,
    plannedUniqueAttendees,
    plannedReentriesTotal,
    plannedTotalEntries: plannedUniqueAttendees + plannedReentriesTotal,
    averageArrivalsPerHour: Number(averageArrivalsPerHour.toFixed(1)),
    peakHourlyArrivals,
    peakArrivalHourIndex,
    peakArrivalHourLabel: formatHourSlot(cfg.startHour, peakArrivalHourIndex),
    averageSimultaneousOccupancy,
    peakSimultaneousOccupancy,
    peakOccupancyHourIndex,
    peakOccupancyHourLabel: formatHourSlot(cfg.startHour, peakOccupancyHourIndex),
    hourly,
    capacityStatus: {
      defined: authorizedCapacity != null,
      authorizedCapacity,
      label:
        authorizedCapacity != null
          ? `${authorizedCapacity.toLocaleString('es-ES')} pers.`
          : 'No definido',
      peakOccupancyPct: peakPct,
      remainingMargin:
        authorizedCapacity != null ? authorizedCapacity - peakSimultaneousOccupancy : null,
      exceedsAuthorized:
        authorizedCapacity != null && peakSimultaneousOccupancy > authorizedCapacity,
      exceedsDesiredTarget:
        cfg.desiredMaxOccupancy != null &&
        cfg.desiredMaxOccupancy > 0 &&
        peakSimultaneousOccupancy > cfg.desiredMaxOccupancy,
    },
    operatingAreaM2,
    averageServicesPlan,
    criticalServicesPlan,
    serviceBalance,
    legacyDemandInputs,
    weatherFactor,
    effectiveHourlyArrivals,
  };
}

/**
 * Sincroniza la configuración canónica `EventDemandConfig` en `scene` y actualiza
 * los espejos retrocompatibles sin provocar ciclos inversos.
 */
export function syncDemandConfigToScene(scene: Scene, nextConfig: EventDemandConfig): Scene {
  const derived = deriveEventDemand(scene, nextConfig);
  const cfg = derived.config;

  scene.demandConfig = cfg;
  if (scene.base) {
    scene.base.hours = cfg.hours;
    scene.base.start = cfg.startHour;
    scene.base.stay = cfg.dwellTimeMinutes;
    // Jamás guardar el pico horario como tasa constante: `arrivals` refleja la media real
    scene.base.arrivals = Math.round(derived.averageArrivalsPerHour);
  }
  scene.attendance = {
    ...scene.attendance,
    uniqueAttendees: cfg.uniqueAttendees,
    curveProfile: cfg.curveProfile,
    customWeights: cfg.curveProfile === 'custom' ? [...cfg.hourlyArrivals] : scene.attendance?.customWeights,
    maxSimultaneousTarget: cfg.desiredMaxOccupancy ?? undefined,
    authorizedCapacity: cfg.authorizedCapacity ?? undefined,
    reentryShare: cfg.reentryRate,
  };
  scene.demandInputs = {
    ...scene.demandInputs,
    ...derived.legacyDemandInputs,
  };
  return scene;
}

/**
 * Aplica un cambio sobre `EventDemandConfig` conservando invariantes numéricas
 * (asistentes únicos = suma exacta de la curva horaria) y sincronizando toda la escena.
 */
export function updateEventDemand(
  scene: Scene,
  patch: Partial<EventDemandConfig> & {
    serviceParamsPatch?: Partial<EventDemandConfig['serviceParams']>;
  }
): EventDemandConfig {
  const current = ensureEventDemandConfig(scene);
  const nextHours = clampInt(patch.hours ?? current.hours, 1, 24);
  const nextStartHour = clampNum(patch.startHour ?? current.startHour, 0, 23.75);
  const nextUnique = clampInt(patch.uniqueAttendees ?? current.uniqueAttendees, 0, 500000);
  const nextDwell = clampInt(patch.dwellTimeMinutes ?? current.dwellTimeMinutes, 10, 720);
  const nextProfile: AttendanceCurveProfile = patch.curveProfile ?? current.curveProfile;

  let nextHourly: number[];
  if (Array.isArray(patch.hourlyArrivals) && patch.hourlyArrivals.length === nextHours) {
    const clean = patch.hourlyArrivals.map((v) => Math.max(0, Math.round(Number(v) || 0)));
    const sum = clean.reduce((a, b) => a + b, 0);
    if (patch.uniqueAttendees !== undefined && patch.uniqueAttendees !== sum) {
      nextHourly = scaleCurveToTotal(clean, nextUnique);
    } else {
      nextHourly = clean;
    }
  } else if (patch.curveProfile !== undefined && patch.curveProfile !== 'custom') {
    nextHourly = scaleCurveToTotal(
      buildCurveWeightsForHours(nextProfile, nextHours, scene),
      nextUnique
    );
  } else if (nextHours !== current.hours || nextUnique !== current.uniqueAttendees) {
    nextHourly = normalizeHourlyArray(
      current.hourlyArrivals,
      nextHours,
      nextProfile,
      nextUnique,
      scene
    );
  } else {
    nextHourly = [...current.hourlyArrivals];
  }

  const finalUnique =
    Array.isArray(patch.hourlyArrivals) && patch.uniqueAttendees === undefined
      ? nextHourly.reduce((a, b) => a + b, 0)
      : nextUnique;

  const nextConfig: EventDemandConfig = {
    ...current,
    ...patch,
    hours: nextHours,
    startHour: nextStartHour,
    uniqueAttendees: finalUnique,
    curveProfile: nextProfile,
    hourlyArrivals: nextHourly,
    dwellTimeMinutes: nextDwell,
    dwellDistribution: {
      ...current.dwellDistribution,
      ...patch.dwellDistribution,
      meanMinutes: nextDwell,
    },
    authorizedCapacity:
      patch.authorizedCapacity !== undefined
        ? patch.authorizedCapacity != null && patch.authorizedCapacity > 0
          ? Math.round(patch.authorizedCapacity)
          : null
        : current.authorizedCapacity,
    desiredMaxOccupancy:
      patch.desiredMaxOccupancy !== undefined
        ? patch.desiredMaxOccupancy != null && patch.desiredMaxOccupancy > 0
          ? Math.round(patch.desiredMaxOccupancy)
          : null
        : current.desiredMaxOccupancy,
    operationalAreaM2:
      patch.operationalAreaM2 !== undefined
        ? patch.operationalAreaM2 != null && patch.operationalAreaM2 > 0
          ? Math.round(patch.operationalAreaM2)
          : null
        : current.operationalAreaM2,
    serviceParams: {
      ...current.serviceParams,
      ...(patch.serviceParams || {}),
      ...(patch.serviceParamsPatch || {}),
    },
    provenance: patch.provenance || (patch.curveProfile && patch.curveProfile !== 'custom' ? 'curve_preset' : 'manual'),
    updatedAt: new Date().toISOString(),
    revision: (current.revision || 1) + 1,
  };

  syncDemandConfigToScene(scene, nextConfig);
  return nextConfig;
}

/**
 * Edita una barra individual de la curva horaria eligiendo explícitamente si se mantiene
 * el total de asistentes únicos (redistribuyendo el resto) o si se actualiza el total.
 */
export function editHourlyArrivalBar(
  scene: Scene,
  hourIndex: number,
  newValue: number,
  mode: 'keep_total' | 'update_total'
): EventDemandConfig {
  const current = ensureEventDemandConfig(scene);
  const idx = clampInt(hourIndex, 0, current.hours - 1);
  const val = clampInt(newValue, 0, 500000);
  const bars = [...current.hourlyArrivals];

  if (mode === 'update_total') {
    bars[idx] = val;
    const nextTotal = bars.reduce((a, b) => a + b, 0);
    return updateEventDemand(scene, {
      curveProfile: 'custom',
      hourlyArrivals: bars,
      uniqueAttendees: nextTotal,
      provenance: 'manual',
    });
  }

  // Modo `keep_total`: fijar la franja editada y redistribuir el resto manteniendo suma exacta
  const target = current.uniqueAttendees;
  const clampedVal = Math.min(val, target);
  const remaining = Math.max(0, target - clampedVal);
  const otherIndices: number[] = [];
  const otherWeights: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === idx) continue;
    otherIndices.push(i);
    otherWeights.push(bars[i] > 0 ? bars[i] : 1);
  }
  bars[idx] = clampedVal;
  if (otherIndices.length > 0) {
    const redistributed = scaleCurveToTotal(otherWeights, remaining);
    otherIndices.forEach((slot, k) => {
      bars[slot] = redistributed[k];
    });
  }

  return updateEventDemand(scene, {
    curveProfile: 'custom',
    hourlyArrivals: bars,
    uniqueAttendees: target,
    provenance: 'manual',
  });
}

/** Restaura la curva horaria a un perfil predefinido conservando el total de asistentes únicos. */
export function resetCurveToProfile(
  scene: Scene,
  profile: AttendanceCurveProfile
): EventDemandConfig {
  const current = ensureEventDemandConfig(scene);
  const weights = buildCurveWeightsForHours(profile, current.hours, scene);
  const hourlyArrivals = scaleCurveToTotal(weights, current.uniqueAttendees);
  return updateEventDemand(scene, {
    curveProfile: profile,
    hourlyArrivals,
    provenance: 'curve_preset',
  });
}

export interface DemandSuggestionItem {
  field: keyof Pick<
    EventDemandConfig,
    'dwellTimeMinutes' | 'curveProfile' | 'reentryRate'
  > | 'foodShare' | 'shopShare' | 'seatedShare' | 'utilization';
  label: string;
  currentDisplay: string;
  suggestedDisplay: string;
  reason: string;
}

export interface DemandSuggestionProposal {
  hasSuggestions: boolean;
  items: DemandSuggestionItem[];
  patch: Partial<EventDemandConfig> & {
    serviceParamsPatch?: Partial<EventDemandConfig['serviceParams']>;
  };
}

/**
 * Calcula sugerencias derivadas de Objetivos SMART y Programa por días sin aplicarlas
 * automáticamente hasta que el usuario las revise y confirme.
 */
export function proposeSmartDemandUpdates(scene: Scene): DemandSuggestionProposal {
  const current = ensureEventDemandConfig(scene);
  const obj = ensureProjectObjectives(scene);
  const ids = new Set(obj.selected.map((s) => s.id));
  const {radar} = obj.profile;

  const items: DemandSuggestionItem[] = [];
  const patch: DemandSuggestionProposal['patch'] = {
    provenance: 'smart_suggestion',
    serviceParamsPatch: {},
  };

  // Perfil sugerido según objetivos o escenario/programa
  const selectedProg = new Set(scene.programmeOptions?.selected || []);
  const hasStage =
    (scene.base?.booths || []).some((b) => b.type === 'stage') ||
    activities.some((a) => selectedProg.has(a.id) && a.need === 'stage');

  let suggestedProfile: AttendanceCurveProfile = current.curveProfile;
  if (hasStage || ids.has('mus_concerts')) {
    suggestedProfile = 'festival';
  } else if (radar.family >= 60 && current.hours >= 8) {
    suggestedProfile = 'family';
  } else if (radar.local >= 60 && current.hours <= 8) {
    suggestedProfile = 'trade_fair';
  }

  if (
    suggestedProfile !== current.curveProfile &&
    current.curveProfile !== 'custom'
  ) {
    items.push({
      field: 'curveProfile',
      label: 'Perfil horario recomendado',
      currentDisplay: current.curveProfile,
      suggestedDisplay: suggestedProfile,
      reason: hasStage
        ? 'Escenario / programa musical activo sugiere concentración vespertina.'
        : 'Alineado con los objetivos SMART prioritarios del proyecto.',
    });
    patch.curveProfile = suggestedProfile;
  }

  const stayMult = obj.confirmedHypotheses?.stayMultiplier || 1;
  const suggestedDwell = clampInt(current.dwellTimeMinutes * stayMult, 25, 240);
  if (Math.abs(suggestedDwell - current.dwellTimeMinutes) >= 10) {
    items.push({
      field: 'dwellTimeMinutes',
      label: 'Permanencia media esperada',
      currentDisplay: `${current.dwellTimeMinutes} min`,
      suggestedDisplay: `${suggestedDwell} min`,
      reason: 'Los objetivos de estancia y actividades programadas prolongan la visita.',
    });
    patch.dwellTimeMinutes = suggestedDwell;
  }

  const suggestedFood = clampInt(
    current.serviceParams.foodShare + (radar.food - 40) * 0.25,
    15,
    75
  );
  if (Math.abs(suggestedFood - current.serviceParams.foodShare) >= 5) {
    items.push({
      field: 'foodShare',
      label: 'Consumo gastronómico (%)',
      currentDisplay: `${current.serviceParams.foodShare} %`,
      suggestedDisplay: `${suggestedFood} %`,
      reason: 'Ajustado al peso de Gastronomía en Objetivos SMART.',
    });
    patch.serviceParamsPatch!.foodShare = suggestedFood;
  }

  const suggestedShop = clampInt(
    current.serviceParams.shopShare + (radar.local - 40) * 0.3,
    15,
    80
  );
  if (Math.abs(suggestedShop - current.serviceParams.shopShare) >= 5) {
    items.push({
      field: 'shopShare',
      label: 'Visita a comercio local (%)',
      currentDisplay: `${current.serviceParams.shopShare} %`,
      suggestedDisplay: `${suggestedShop} %`,
      reason: 'Ajustado al peso de Comercio local en Objetivos SMART.',
    });
    patch.serviceParamsPatch!.shopShare = suggestedShop;
  }

  if (ids.has('gas_reduce_queues') && current.serviceParams.utilization > 70) {
    items.push({
      field: 'utilization',
      label: 'Uso objetivo de puestos (holgura colas)',
      currentDisplay: `${current.serviceParams.utilization} %`,
      suggestedDisplay: '68 %',
      reason: 'Objetivo SMART de reducción de colas recomienda no superar el 68 % de saturación.',
    });
    patch.serviceParamsPatch!.utilization = 68;
  }

  // Registrar descripción de objetivos activos para trazabilidad
  void OBJECTIVE_BY_ID;

  return {
    hasSuggestions: items.length > 0,
    items,
    patch,
  };
}

export type DemandSyncBadgeState =
  | 'synced'
  | 'pending_changes'
  | 'outdated_results'
  | 'uncalibrated';

export interface DemandSyncStatus {
  state: DemandSyncBadgeState;
  label: string;
  detail: string;
}

/** Calcula el estado visible de sincronización entre planificación y ensayo de simulación. */
export function getDemandSyncStatus(
  scene: Scene,
  activeRunRevision?: number | null,
  activeTimeSec = 0
): DemandSyncStatus {
  const cfg = ensureEventDemandConfig(scene);
  if (
    activeTimeSec > 0 &&
    activeRunRevision != null &&
    cfg.revision !== activeRunRevision
  ) {
    return {
      state: 'pending_changes',
      label: 'Cambios pendientes',
      detail: 'Has editado la demanda mientras hay un ensayo iniciado.',
    };
  }
  const reviewRevision = Number(
    (scene.lastSessionReview as {demandRevision?: number} | undefined)?.demandRevision
  );
  if (
    scene.lastSessionReview &&
    Number.isFinite(reviewRevision) &&
    reviewRevision !== cfg.revision
  ) {
    return {
      state: 'outdated_results',
      label: 'Resultados desactualizados',
      detail: 'La revisión guardada corresponde a una hipótesis anterior de demanda.',
    };
  }
  if (
    cfg.provenance === 'legacy_hourly_migration' ||
    (cfg.provenance === 'smart_suggestion' &&
      scene.objectives?.confirmedHypotheses?.confirmed === false)
  ) {
    return {
      state: 'uncalibrated',
      label: 'Hipótesis sin calibrar',
      detail:
        cfg.provenance === 'legacy_hourly_migration'
          ? 'Datos migrados desde tasa horaria antigua; revisa el total diario y el aforo.'
          : 'Sugerencia pendiente de confirmar calibración local.',
    };
  }
  return {
    state: 'synced',
    label: 'Sincronizado',
    detail:
      cfg.authorizedCapacity == null
        ? 'Sincronizado entre módulos (aforo oficial sin definir).'
        : 'Calculadora, Simular y Necesidades comparten exactamente los mismos datos.',
  };
}
