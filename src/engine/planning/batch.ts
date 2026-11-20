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
import {redesign} from './layout';

/**
 * Dictionary of batch evaluation goal labels.
 */
export const goals: Record<string, string> = {
  comfort: 'Comer sentado y con refugio',
  queues: 'Esperas y accesos fluidos',
  emergency: 'Atender incidencias',
  experience: 'Variedad y satisfacción',
};

/**
 * Evaluates a batch of alternative floor-plan layouts across weather conditions and injected incidents.
 *
 * @param source - Base scene to evaluate and redesign.
 * @param map - Georeferenced venue map.
 * @param settings - Batch evaluation settings.
 * @param progress - Callback receiving live progress updates.
 * @param cancelled - Predicate returning `true` if the user cancelled the batch run.
 * @returns Ranked list of evaluated layout rows.
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

  for (let i = 0; i < settings.count; i++) {
    if (cancelled()) break;
    const scene = structuredClone(source);
    let proposal = null;
    if (i) {
      proposal = redesign(
        phaseScene(scene, 'event'),
        map,
        {
          seed: seed + i * 739,
          space: settings.space,
          strategy: (i - 1) % 3,
          onlyMove: true,
        },
        previous
      );
      if (!proposal.moves.length) {
        progress({skipped: i});
        continue;
      }
      previous.push(proposal.zones);
      for (const o of [...scene.base.booths, ...scene.infrastructure]) {
        const n = proposal.moves.find((m: {id: string}) => m.id === o.id);
        if (n) Object.assign(o, n);
      }
      Object.assign(scene, proposal.routing);
    }

    const runs: BatchEvaluationRow['runs'] = [];
    let preview: Array<{x: number; y: number}> = [];
    for (const weather of settings.rain
      ? (['cloud', 'rain'] as const)
      : (['cloud'] as const)) {
      if (cancelled()) break;
      const sample = phaseScene(scene, 'event');
      sample.base.weather = weather;
      sample.seed = seed;
      const e = new EventEngine(sample);
      if (!e.entries.length) {
        throw new Error('El recinto necesita accesos públicos conectados.');
      }
      const review = assessRisk(sample, e, {routes: true});
      if (review.critical.length) {
        throw new Error(
          'Comparación detenida: ' +
            review.critical.map((r) => r.title).join(' · ')
        );
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
          throw new Error(
            'Ensayo de alternativa cancelado: ' +
              failures.map((r) => r.title).join(' · ') +
              '. Corrige los recursos antes de comparar.'
          );
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
    const averages = Object.fromEntries(
      Object.keys(goals).map((k) => [
        k,
        runs.reduce((n, r) => n + r.scores[k], 0) / runs.length,
      ])
    ) as BatchEvaluationRow['averages'];
    const total =
      Object.values(settings.weights).reduce((a, b) => a + b, 0) || 1;
    const score =
      Object.entries(settings.weights).reduce(
        (sum, [k, w]) =>
          sum + averages[k as keyof BatchEvaluationRow['averages']] * w,
        0
      ) / total;
    const row: BatchEvaluationRow = {
      id: i,
      name: i ? 'Alternativa ' + i : 'Plano original',
      score,
      averages,
      runs,
      scene,
      preview,
    };
    results.push(row);
    progress({
      complete: row,
      ranking: results.slice().sort((a, b) => b.score - a.score),
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
