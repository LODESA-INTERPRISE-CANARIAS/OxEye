import type {Scene} from '../../types';
import {EventEngine} from '../crowd/event-engine';
import {ResponseSimulation} from '../emergency/response-model';
import {assessRisk, liveFailures} from '../emergency/risk';
import {
  ExperienceMonitor,
  moveCandidate,
} from '../experience/experience-monitor';
import {phaseScene} from '../logistics/phases';

export interface TrialResult {
  seconds: number;
  arrivals: number;
  admitted: number;
  served: number;
  abandoned: number;
  entryBlocked: number;
  counts: Record<string, number>;
  score: number;
}

/**
 * Runs a fast trial simulation on a scene for `seconds` (default 900s = 15 min)
 * and computes a penalty score.
 *
 * @param scene - Scene to simulate.
 * @param seconds - Duration in simulated seconds.
 * @param yieldTask - Async yield callback to keep UI responsive.
 * @returns Trial rows, engine instance, and summary metrics.
 */
export async function trial(
  scene: Scene,
  seconds = 900,
  yieldTask: () => Promise<void> = async () => {}
) {
  const engine = new EventEngine(phaseScene(scene, 'event'));
  if (
    !engine.entries.some((g) =>
      ['both', 'in'].includes(g.phases?.event || g.role || '')
    )
  ) {
    throw new Error('Añade una entrada pública conectada.');
  }
  const review = assessRisk(scene, engine, {routes: true});
  if (review.critical.length) {
    throw new Error(
      'Ensayo detenido: ' + review.critical.map((r) => r.title).join(' · ')
    );
  }
  engine.emergency = new ResponseSimulation(engine);
  const monitor = new ExperienceMonitor(engine);
  for (let i = 0; i < seconds * 2 && !engine.finished; i++) {
    engine.tick(0.5);
    monitor.update();
    if (liveFailures(engine).length) {
      throw new Error(
        'Ensayo cancelado: hay una incidencia sin respuesta disponible. Corrige los recursos.'
      );
    }
    if (i % 120 === 0) await yieldTask();
  }
  const rows = monitor.list();
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.type] = (counts[row.type] || 0) + 1;
  const stats = engine.stats;
  return {
    rows,
    engine,
    result: {
      seconds: engine.time,
      arrivals: stats.arrivals,
      admitted: stats.admitted,
      served: stats.served,
      abandoned: stats.abandoned,
      entryBlocked: stats.entryBlocked,
      counts,
      score: rows.length + stats.abandoned * 2 + stats.entryBlocked * 3,
    } as TrialResult,
  };
}

/**
 * Compares the baseline scene against up to 2 automated improvement candidates
 * (price reduction, extra service slot, position shift, or sound reduction).
 *
 * @param scene - Baseline scene.
 * @param history - Prior experiment log for prioritizing candidate types.
 * @param yieldTask - Async yield callback.
 * @returns Comparison report with baseline and ranked alternatives.
 */
export async function compare(
  scene: Scene,
  history: Array<{kind: string; gain: number}> = [],
  yieldTask?: () => Promise<void>
) {
  const before = await trial(scene, 900, yieldTask);
  const options: Array<{
    kind: string;
    id: string;
    desc: string;
    patch: Record<string, unknown>;
  }> = [];
  const failures = before.rows
    .slice()
    .sort((a, b) => b.last - b.first - (a.last - a.first));

  for (const r of failures) {
    const b = scene.base.booths.find((o) => o.id === r.target);
    const add = (
      kind: string,
      id: string,
      desc: string,
      patch: Record<string, unknown>
    ) => {
      if (!options.some((o) => o.kind === kind && o.id === id)) {
        options.push({kind, id, desc, patch});
      }
    };
    if (b && r.type === 'price') {
      add(
        'precio',
        b.id,
        'Probar un precio un 15 % menor en ' + b.name,
        {price: Math.round((b.price || 10) * 0.85 * 100) / 100}
      );
    }
    if (b && r.type === 'queue') {
      add(
        'cola',
        b.id,
        'Probar una plaza de atención adicional en ' + b.name,
        {labCapacity: (b.labCapacity || b.simultaneous || 1) + 1}
      );
    }
    if (r.type === 'queue' || r.type === 'blocked') {
      const c = moveCandidate(before.engine, r.point);
      if (c) add('posición', c.id, c.text, {x: c.x, y: c.y});
    }
    if (r.type === 'sound') {
      const stage = scene.base.booths.find((o) => o.sound?.enabled);
      if (stage && stage.sound) {
        add('sonido', stage.id, 'Probar 3 dB menos en ' + stage.name, {
          sound: {...stage.sound, spl: stage.sound.spl - 3},
        });
      }
    }
  }

  if (!options.length && before.result.abandoned) {
    for (const complaint of before.engine.complaints()) {
      const c = moveCandidate(before.engine, complaint.point);
      if (c) {
        options.push({
          kind: 'posición',
          id: c.id,
          desc: c.text,
          patch: {x: c.x, y: c.y},
        });
        break;
      }
    }
  }

  const gain = (k: string): number => {
    const past = history.filter((r) => r.kind === k);
    return past.length
      ? past.reduce((n, r) => n + r.gain, 0) / past.length
      : 0;
  };
  options.sort((a, b) => gain(b.kind) - gain(a.kind));

  const alternatives: Array<{
    change: {
      kind: string;
      id: string;
      desc: string;
      patch: Record<string, unknown>;
    };
    after: TrialResult;
    gain: number;
  }> = [];

  for (const change of options.slice(0, 2)) {
    const candidate = structuredClone(scene);
    const o = [...candidate.base.booths, ...candidate.infrastructure].find(
      (item) => item.id === change.id
    );
    if (!o) continue;
    Object.assign(o, change.patch);
    const after = await trial(candidate, 900, yieldTask);
    alternatives.push({
      change,
      after: after.result,
      gain: before.result.score - after.result.score,
    });
  }
  alternatives.sort((a, b) => b.gain - a.gain);
  return {
    before: before.result,
    alternatives,
    seed: scene.seed,
    issues: before.result.counts,
    visitors: before.rows.length,
  };
}
