import type {
  BatchEvaluationRow,
  BatchSettings,
  Scene,
  VenueMap,
} from '../../types';
import {EventEngine} from '../crowd/event-engine';
import {ResponseSimulation} from '../emergency/response-model';
import {assessRisk, liveFailures} from '../emergency/risk';
import {ExperienceMonitor} from '../experience/experience-monitor';
import {phaseScene} from '../logistics/phases';
import {shift} from '../logistics/shift';
import {computeSceneSpatialMetrics} from './evaluator';
import {redesign} from './layout';
import {ensureProjectObjectives, OBJECTIVE_BY_ID} from './objectives';

/**
 * Dictionary of batch evaluation goal labels.
 */
export const goals: Record<string, string> = {
  comfort: 'Comer sentado y con refugio',
  queues: 'Esperas y accesos fluidos',
  emergency: 'Atender incidencias',
  experience: 'Variedad y satisfacción',
};

const STRATEGY_DEFS = [
  {
    key: 'baseline' as const,
    name: 'Plano original',
    focus: 'balanced' as const,
    spaceDelta: 0,
  },
  {
    key: 'spatial_efficiency' as const,
    name: 'A · Eficiencia espacial',
    focus: 'spatial_efficiency' as const,
    spaceDelta: 1.0,
  },
  {
    key: 'visitor_experience' as const,
    name: 'B · Experiencia del visitante',
    focus: 'visitor_experience' as const,
    spaceDelta: 0.25,
  },
  {
    key: 'economic_balance' as const,
    name: 'C · Equilibrio económico y operativo',
    focus: 'economic_balance' as const,
    spaceDelta: 0.5,
  },
];

function estimateSceneBudgetCost(scene: Scene): number {
  const boothCost = scene.base.booths.reduce(
    (s, b) => s + (b.type === 'stage' ? 1200 : b.type === 'food' ? 480 : 320),
    0
  );
  const infraCost = scene.infrastructure.reduce(
    (s, i) =>
      s +
      (i.cost ??
        (i.role === 'cover' ? 650 : i.kind === 'picnic' ? 90 : i.kind === 'toilet' ? 180 : 120)),
    0
  );
  return Math.round(boothCost + infraCost);
}

/**
 * Evaluates baseline + up to 3 strategic alternative layouts (Eficiencia espacial,
 * Experiencia del visitante según SMART, y Equilibrio económico/operativo), checking
 * mandatory viability first and normalizing scores against active SMART weights.
 */
export async function evaluateBatch(
  source: Scene,
  map: VenueMap,
  settings: BatchSettings,
  progress: (info: {
    skipped?: number;
    index?: number;
    weather?: string;
    seconds?: number;
    scene?: Scene;
    people?: Array<{x: number; y: number}>;
    complete?: BatchEvaluationRow;
    ranking?: BatchEvaluationRow[];
  }) => void,
  cancelled: () => boolean
): Promise<BatchEvaluationRow[]> {
  const results: BatchEvaluationRow[] = [];
  const previous: Array<Array<{x: number; y: number; w: number; h: number}>> =
    [];
  const seed = source.seed || 2026;
  const objectives = ensureProjectObjectives(source);
  const totalCount = Math.max(2, settings.count || 4);

  const mapLayoutFocus = ():
    | 'family'
    | 'commerce'
    | 'gastronomy'
    | 'music'
    | 'logistics'
    | 'spatial_efficiency' => {
    const f = objectives.profile.layoutFocus;
    if (f === 'family' || f === 'commerce' || f === 'gastronomy' || f === 'music' || f === 'logistics') {
      return f;
    }
    return 'spatial_efficiency';
  };

  for (let i = 0; i < totalCount; i++) {
    if (cancelled()) break;
    const strat = STRATEGY_DEFS[i] || STRATEGY_DEFS[1 + ((i - 1) % 3)];
    const scene = structuredClone(source);
    if (i) {
      const objFocus =
        strat.key === 'visitor_experience'
          ? mapLayoutFocus()
          : strat.focus === 'balanced'
            ? 'spatial_efficiency'
            : strat.focus;
      const proposal = redesign(
        phaseScene(scene, 'event'),
        map,
        {
          seed: seed + i * 739,
          space: Math.max(1.5, (settings.space || 2.5) + strat.spaceDelta),
          strategy: (i - 1) % 3,
          onlyMove: true,
          objectiveFocus: objFocus,
        },
        previous
      );
      if (!proposal.moves.length && i > 3) {
        progress({skipped: i});
        continue;
      }
      if (proposal.moves.length) {
        previous.push(proposal.zones);
        for (const o of [...scene.base.booths, ...scene.infrastructure]) {
          const n = proposal.moves.find((m: {id: string}) => m.id === o.id);
          if (n) Object.assign(o, n);
        }
        Object.assign(scene, proposal.routing);
      }
    }

    const runs: BatchEvaluationRow['runs'] = [];
    let preview: Array<{x: number; y: number}> = [];
    let viable = true;
    const criticalIssues: string[] = [];

    for (const weather of settings.rain
      ? (['cloud', 'rain'] as const)
      : (['cloud'] as const)) {
      if (cancelled()) break;
      const sample = phaseScene(scene, 'event');
      sample.base.weather = weather;
      sample.seed = seed;
      const e = new EventEngine(sample);
      if (!e.entries.length) {
        viable = false;
        criticalIssues.push('El recinto necesita accesos públicos conectados.');
        continue;
      }
      const review = assessRisk(sample, e, {routes: true});
      if (review.critical.length) {
        viable = false;
        criticalIssues.push(...review.critical.map((r) => r.title));
        preview = e.entries.map((ent) => e.g.point(ent.cell)).map(([x, y]) => ({x, y}));
        runs.push({
          weather,
          arrivals: 0,
          abandoned: 0,
          meals: 0,
          standing: 0,
          completed: 0,
          missing: 4,
          open: 0,
          scores: {comfort: 0, queues: 0, emergency: 0, experience: 0},
          complaints: 0,
        });
        continue;
      }
      e.emergency = new ResponseSimulation(e);
      e.experience = new ExperienceMonitor(e);
      const issued = new Set<string>();
      for (
        let step = 0;
        step < (settings.minutes || 15) * 120 && !e.finished;
        step++
      ) {
        if (cancelled()) break;
        e.tick(0.5);
        e.experience.update();
        const failures = liveFailures(e);
        if (failures.length) {
          viable = false;
          criticalIssues.push(...failures.map((r) => r.title));
          break;
        }
        for (const [j, type] of (
          ['fall', 'cut', 'fire', 'conflict'] as const
        ).entries()) {
          if (!issued.has(type) && e.time >= 120 + j * 90) {
            issued.add(type);
            e.emergency.inject(type);
          }
        }
        if (step % 120 === 0) {
          progress({
            index: i,
            weather,
            seconds: e.time,
            scene,
            people: e.agents.map((a) => ({x: a.x, y: a.y})),
          });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const st = e.stats;
      const d = e.dining.summary();
      const rows = e.experience.list();
      const sums: Record<string, number> = Object.fromEntries(
        Object.keys(goals).map((k) => [k, 0])
      );
      const completed = e.emergency.events.filter(
        (r) => r.status === 'resolved'
      ).length;
      const missing = 4 - e.emergency.events.length;
      sums.comfort =
        100 *
        Math.max(
          0,
          1 -
            (d.standing + rows.filter((r: {type: string}) => r.type === 'shelter').length) /
              Math.max(1, st.admitted)
        );
      sums.queues =
        100 *
        Math.max(
          0,
          1 - (st.abandoned + st.entryBlocked) / Math.max(1, st.arrivals)
        );
      sums.emergency = (completed / 4) * 100;
      sums.experience =
        100 * Math.max(0, 1 - rows.length / Math.max(1, st.admitted));
      runs.push({
        weather,
        arrivals: st.arrivals,
        abandoned: st.abandoned,
        meals: d.meals,
        standing: d.standing,
        completed,
        missing,
        open: e.emergency.events.length - completed,
        scores: sums,
        complaints: rows.length,
      });
      preview = e.agents.map((a) => ({x: a.x, y: a.y}));
    }

    if (cancelled()) break;
    const safeRuns = runs.length
      ? runs
      : [
          {
            weather: 'cloud',
            arrivals: 0,
            abandoned: 0,
            standing: 0,
            completed: 0,
            missing: 4,
            scores: {comfort: 0, queues: 0, emergency: 0, experience: 0},
            complaints: 0,
          },
        ];

    const averages = Object.fromEntries(
      Object.keys(goals).map((k) => [
        k,
        safeRuns.reduce((n, r) => n + r.scores[k], 0) / safeRuns.length,
      ])
    ) as BatchEvaluationRow['averages'];
    const totalW =
      Object.values(settings.weights).reduce((a, b) => a + b, 0) || 1;
    const rawScore =
      Object.entries(settings.weights).reduce(
        (sum, [k, w]) =>
          sum + (averages[k as keyof BatchEvaluationRow['averages']] || 0) * w,
        0
      ) / totalW;

    const spatial = computeSceneSpatialMetrics(scene, map);
    const totalArea = spatial.serviceSurfaceM2 + spatial.shelterSurfaceM2;
    const freeAreaM2 = Math.max(
      0,
      Math.round(((scene.base.overrides?.area as number) || 1200) - totalArea)
    );
    const estimatedCost = estimateSceneBudgetCost(scene);
    const shiftPre = shift(scene, map, 'pre');
    const setupMinutes = Math.round(shiftPre.total || 0);

    const objectiveScores: Record<string, number> = {};
    for (const sel of objectives.selected) {
      const def = OBJECTIVE_BY_ID[sel.id];
      if (!def) continue;
      if (def.category === 'economy') {
        objectiveScores[sel.id] = Math.max(20, Math.min(100, Math.round(100 - estimatedCost / 150)));
      } else if (def.category === 'logistics') {
        objectiveScores[sel.id] = Math.max(20, Math.min(100, Math.round(100 - setupMinutes / 8)));
      } else if (def.category === 'safety') {
        objectiveScores[sel.id] = Math.round(averages.emergency || 0);
      } else if (def.category === 'accessibility') {
        objectiveScores[sel.id] = Math.round(
          Math.min(100, (averages.comfort || 0) * 0.7 + ((spatial.minClearanceMeters || 2) >= 2.5 ? 30 : 10))
        );
      } else {
        objectiveScores[sel.id] = Math.round(((averages.queues || 0) + (averages.experience || 0)) / 2);
      }
    }

    const advantages: string[] = [];
    const drawbacks: string[] = [];
    if ((spatial.minClearanceMeters || 0) >= 2.5) {
      advantages.push(`Pasos amplios (mín. ${spatial.minClearanceMeters?.toFixed(1)} m)`);
    } else {
      drawbacks.push(`Pasos ajustados (mín. ${(spatial.minClearanceMeters || 0).toFixed(1)} m)`);
    }
    if (averages.queues >= 85) {
      advantages.push('Bajas esperas y mínima congestión de acceso');
    } else {
      drawbacks.push('Margen de espera mejorable en horas punta');
    }
    if (!viable) {
      drawbacks.unshift(`Inviable por restricción obligatoria: ${criticalIssues[0] || 'seguridad'}`);
    }

    const finalScore = viable ? rawScore : Math.min(25, rawScore * 0.3);
    const row: BatchEvaluationRow = {
      id: i,
      name: strat.name,
      strategyKey: strat.key,
      viable,
      criticalIssues: [...new Set(criticalIssues)],
      score: finalScore,
      averages,
      objectiveScores,
      estimatedCost,
      setupMinutes,
      freeAreaM2,
      occupiedAreaM2: Math.round(totalArea),
      advantages,
      drawbacks,
      explanation: viable
        ? `${strat.name}: cumple las restricciones obligatorias y pondera ${objectives.profile.activeAxes.join(', ')}.`
        : `${strat.name}: descartada como opción principal hasta resolver ${criticalIssues[0] || 'restricciones obligatorias'}.`,
      runs: safeRuns,
      scene,
      preview,
    };
    results.push(row);
    progress({
      complete: row,
      ranking: results
        .slice()
        .sort((a, b) => Number(!!b.viable) - Number(!!a.viable) || b.score - a.score),
    });
  }

  // Detectar empate técnico (< 3 puntos entre alternativas viables) y explicarlo
  const sorted = results.sort(
    (a, b) => Number(!!b.viable) - Number(!!a.viable) || b.score - a.score
  );
  if (
    sorted.length >= 2 &&
    sorted[0].viable &&
    sorted[1].viable &&
    Math.abs(sorted[0].score - sorted[1].score) < 3
  ) {
    sorted[0].explanation =
      `Equilibrio muy ajustado respecto a «${sorted[1].name}» (diferencia < 3 pts): elige según priorices ${sorted[0].advantages?.[0] || 'circulación'} o ${sorted[1].advantages?.[0] || 'experiencia'}.`;
  }

  return sorted;
}
