import {MAPS_DATA} from '../../data/geodata';
import type {InfrastructureItem, Scene, VenueMap} from '../../types';
import {inside, percent, world} from '../cartography/geometry';
import {EventEngine} from '../crowd/event-engine';
import {ResponseSimulation} from '../emergency/response-model';
import {assessRisk, liveFailures} from '../emergency/risk';
import {
  ExperienceMonitor,
  moveCandidate,
} from '../experience/experience-monitor';
import {phaseScene} from '../logistics/phases';
import {redesign} from './layout';

export interface SceneSpatialMetrics {
  minClearanceMeters: number | null;
  avgNearestSpacingMeters: number | null;
  serviceSurfaceM2: number;
  shelterSurfaceM2: number;
}

export interface ComparisonChange {
  kind: string;
  id: string;
  desc: string;
  patch: Record<string, unknown>;
  /** Nueva superficie / equipamiento propuesto si el escenario carece de ella. */
  addItem?: InfrastructureItem;
  /** Lista de desplazamientos múltiples si la propuesta redistribuye varios elementos. */
  moves?: Array<{id: string; x: number; y: number; rotation?: number}>;
  /** Categoría legible del cambio espacial u operativo. */
  spatialKind: 'espaciado' | 'nueva_superficie' | 'gestion';
  /** Distancia de desplazamiento en metros si se reubica un elemento. */
  moveDistanceMeters?: number;
  /** Superficie añadida en m² si se propone un elemento nuevo. */
  addedSurfaceM2?: number;
}

export interface TrialResult {
  seconds: number;
  arrivals: number;
  admitted: number;
  served: number;
  abandoned: number;
  entryBlocked: number;
  episodes: number;
  avgWaitSec: number;
  stuckSeconds: number;
  satisfied: number;
  dissatisfied: number;
  counts: Record<string, number>;
  score: number;
  spatial: SceneSpatialMetrics;
}

/**
 * Calcula métricas espaciales reales de la escena en metros y m²:
 * - Distanciamiento mínimo borde-a-borde entre elementos sólidos.
 * - Distanciamiento medio al vecino más cercano.
 * - Superficie total de servicio y superficie cubierta de refugio.
 */
export function computeSceneSpatialMetrics(
  scene: Scene,
  map?: VenueMap
): SceneSpatialMetrics {
  const m = map || MAPS_DATA[scene.site] || MAPS_DATA.cristo;
  const all = [...scene.base.booths, ...scene.infrastructure];

  let serviceSurfaceM2 = 0;
  let shelterSurfaceM2 = 0;
  const solids: Array<{cx: number; cy: number; hw: number; hd: number}> = [];

  for (const item of all) {
    const area = (item as {area?: number}).area || 0;
    const w = item.width || (area ? Math.sqrt(area) : 3);
    const d = item.depth || (area ? Math.sqrt(area) : 3);
    const footprint = w * d;
    const inf = item as InfrastructureItem;
    if (inf.role === 'cover') {
      shelterSurfaceM2 += footprint;
      continue;
    }
    if (inf.kind === 'security' || inf.kind === 'steward') continue;
    serviceSurfaceM2 += footprint;
    const [cx, cy] = world([item.x, item.y], m);
    solids.push({cx, cy, hw: w / 2, hd: d / 2});
  }

  if (solids.length < 2) {
    return {
      minClearanceMeters: null,
      avgNearestSpacingMeters: null,
      serviceSurfaceM2: Math.round(serviceSurfaceM2 * 10) / 10,
      shelterSurfaceM2: Math.round(shelterSurfaceM2 * 10) / 10,
    };
  }

  let globalMin = Infinity;
  let nearestSum = 0;
  for (let i = 0; i < solids.length; i++) {
    let best = Infinity;
    for (let j = 0; j < solids.length; j++) {
      if (i === j) continue;
      const dx = Math.max(0, Math.abs(solids[i].cx - solids[j].cx) - solids[i].hw - solids[j].hw);
      const dy = Math.max(0, Math.abs(solids[i].cy - solids[j].cy) - solids[i].hd - solids[j].hd);
      const dist = Math.hypot(dx, dy);
      if (dist < best) best = dist;
    }
    if (best < globalMin) globalMin = best;
    nearestSum += best;
  }

  return {
    minClearanceMeters: Math.round(globalMin * 100) / 100,
    avgNearestSpacingMeters:
      Math.round((nearestSum / solids.length) * 100) / 100,
    serviceSurfaceM2: Math.round(serviceSurfaceM2 * 10) / 10,
    shelterSurfaceM2: Math.round(shelterSurfaceM2 * 10) / 10,
  };
}

function findFreeSpotForSurface(
  scene: Scene,
  map: VenueMap,
  nearPoint: [number, number] | undefined,
  width: number,
  depth: number
): [number, number] | null {
  const placed = [...scene.base.booths, ...scene.infrastructure]
    .filter((o) => (o as InfrastructureItem).role !== 'cover')
    .map((o) => {
      const [cx, cy] = world([o.x, o.y], map);
      const w = o.width || 3;
      const d = o.depth || 3;
      return {cx, cy, hw: w / 2, hd: d / 2};
    });

  const anchor = nearPoint || [map.widthMeters / 2, map.heightMeters / 2];
  for (let radius = 4; radius <= 28; radius += 4) {
    for (let step = 0; step < 12; step++) {
      const ang = (step / 12) * Math.PI * 2;
      const wx = anchor[0] + Math.cos(ang) * radius;
      const wy = anchor[1] + Math.sin(ang) * radius;
      if (
        wx < width / 2 + 1 ||
        wy < depth / 2 + 1 ||
        wx > map.widthMeters - width / 2 - 1 ||
        wy > map.heightMeters - depth / 2 - 1
      ) {
        continue;
      }
      const pct = percent([wx, wy], map);
      if (scene.boundary?.length >= 3 && !inside(pct, scene.boundary)) continue;
      const collides = placed.some(
        (p) =>
          Math.abs(wx - p.cx) < p.hw + width / 2 + 1.5 &&
          Math.abs(wy - p.cy) < p.hd + depth / 2 + 1.5
      );
      if (!collides) return pct;
    }
  }
  return null;
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
      ['both', 'in', 'free'].includes(g.phases?.event || g.role || '')
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
  const avgWaitSec =
    stats.servedWaitCount > 0
      ? Math.round(stats.waitingSeconds / stats.servedWaitCount)
      : 0;
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
      episodes: rows.length,
      avgWaitSec,
      stuckSeconds: Math.round(stats.stuckSeconds),
      satisfied: stats.satisfied,
      dissatisfied: stats.dissatisfied,
      counts,
      score: rows.length + stats.abandoned * 2 + stats.entryBlocked * 3,
      spatial: computeSceneSpatialMetrics(scene, engine.g.m),
    } as TrialResult,
  };
}

/**
 * Compares the baseline scene against up to 3 automated improvement candidates
 * (spacing/position shift, new service/shelter surface, extra service slot,
 * price reduction, or sound reduction).
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
  const map = before.engine.g.m;
  const options: ComparisonChange[] = [];
  const failures = before.rows
    .slice()
    .sort((a, b) => b.last - b.first - (a.last - a.first));

  const add = (opt: ComparisonChange) => {
    if (!options.some((o) => o.kind === opt.kind && o.id === opt.id)) {
      options.push(opt);
    }
  };

  for (const r of failures) {
    const b = scene.base.booths.find((o) => o.id === r.target);
    if (b && r.type === 'price') {
      add({
        kind: 'precio',
        id: b.id,
        desc: 'Probar un precio un 15 % menor en ' + b.name,
        patch: {price: Math.round((b.price || 10) * 0.85 * 100) / 100},
        spatialKind: 'gestion',
      });
    }
    if (b && r.type === 'queue') {
      add({
        kind: 'cola',
        id: b.id,
        desc: 'Probar una plaza de atención adicional en ' + b.name,
        patch: {labCapacity: (b.labCapacity || b.simultaneous || 1) + 1},
        spatialKind: 'gestion',
      });
    }
    if (r.type === 'queue' || r.type === 'blocked') {
      const c = moveCandidate(before.engine, r.point);
      if (c) {
        const orig = [...scene.base.booths, ...scene.infrastructure].find(
          (o) => o.id === c.id
        );
        const moveDist = orig
          ? Math.round(
              Math.hypot(
                world([c.x, c.y], map)[0] - world([orig.x, orig.y], map)[0],
                world([c.x, c.y], map)[1] - world([orig.x, orig.y], map)[1]
              ) * 10
            ) / 10
          : undefined;
        add({
          kind: 'posición',
          id: c.id,
          desc:
            moveDist && moveDist > 0
              ? `${c.text} (desplazamiento ${moveDist.toLocaleString('es-ES')} m para ganar paso)`
              : c.text,
          patch: {x: c.x, y: c.y},
          spatialKind: 'espaciado',
          moveDistanceMeters: moveDist,
        });
      }
    }
    if (r.type === 'shelter') {
      const spot = findFreeSpotForSurface(scene, map, r.point, 6, 6);
      if (spot) {
        const newId = 'auto-shelter-' + (scene.infrastructure.length + 1);
        add({
          kind: 'superficie',
          id: newId,
          desc: 'Añadir carpa de sombra/refugio de 6 × 6 m (36 m²) para cubrir necesidad climática',
          patch: {},
          addItem: {
            id: newId,
            name: 'Carpa refugio (propuesta)',
            kind: 'tent',
            role: 'cover',
            x: spot[0],
            y: spot[1],
            width: 6,
            depth: 6,
            area: 36,
            rotation: 0,
            phaseTags: ['event'],
          },
          spatialKind: 'nueva_superficie',
          addedSurfaceM2: 36,
        });
      }
    }
    if (r.type === 'sound') {
      const stage = scene.base.booths.find((o) => o.sound?.enabled);
      if (stage && stage.sound) {
        add({
          kind: 'sonido',
          id: stage.id,
          desc: 'Probar 3 dB menos en ' + stage.name,
          patch: {
            sound: {...stage.sound, spl: stage.sound.spl - 3},
          },
          spatialKind: 'gestion',
        });
      }
    }
  }

  // Si hay abandonos o congestión y pocas zonas de descanso, proponer nueva superficie de descanso
  const picnicCount = scene.infrastructure.filter(
    (i) => i.kind === 'picnic'
  ).length;
  if (
    before.result.abandoned >= 3 &&
    picnicCount < 2 &&
    !options.some((o) => o.spatialKind === 'nueva_superficie')
  ) {
    const spot = findFreeSpotForSurface(scene, map, undefined, 3, 2);
    if (spot) {
      const newId = 'auto-rest-' + (scene.infrastructure.length + 1);
      add({
        kind: 'superficie',
        id: newId,
        desc: 'Añadir mesa picnic / zona de descanso (3 × 2 m · 6 m²) para mejorar la permanencia',
        patch: {},
        addItem: {
          id: newId,
          name: 'Mesa picnic (propuesta)',
          kind: 'picnic',
          role: 'furniture',
          x: spot[0],
          y: spot[1],
          width: 3,
          depth: 2,
          area: 6,
          capacity: 6,
          rotation: 0,
          phaseTags: ['event'],
        },
        spatialKind: 'nueva_superficie',
        addedSurfaceM2: 6,
      });
    }
  }

  if (!options.length && before.result.abandoned) {
    for (const complaint of before.engine.complaints()) {
      const c = moveCandidate(before.engine, complaint.point);
      if (c) {
        const orig = [...scene.base.booths, ...scene.infrastructure].find(
          (o) => o.id === c.id
        );
        const moveDist = orig
          ? Math.round(
              Math.hypot(
                world([c.x, c.y], map)[0] - world([orig.x, orig.y], map)[0],
                world([c.x, c.y], map)[1] - world([orig.x, orig.y], map)[1]
              ) * 10
            ) / 10
          : undefined;
        add({
          kind: 'posición',
          id: c.id,
          desc: c.text,
          patch: {x: c.x, y: c.y},
          spatialKind: 'espaciado',
          moveDistanceMeters: moveDist,
        });
        break;
      }
    }
  }

  // Si hay elementos pegados (distanciamiento < 1,5 m) o atascos/abandonos, proponer redistribución espacial
  const beforeMinClear = before.result.spatial.minClearanceMeters;
  if (
    (beforeMinClear !== null && beforeMinClear < 1.5) ||
    before.result.stuckSeconds >= 10 ||
    before.result.abandoned >= 5
  ) {
    try {
      const proposal = redesign(scene, map, {
        onlyMove: true,
        space: 2.5,
        seed: (scene.seed || 7) + 19,
        strategy: 0,
      });
      if (proposal.moves.length) {
        add({
          kind: 'redistribución',
          id: proposal.moves[0].id,
          desc: `Separar ${proposal.moves.length} elemento(s) para ganar pasillos de ≥ 2,5 m (${proposal.reason})`,
          patch: {},
          moves: proposal.moves.map((mv) => ({
            id: mv.id,
            x: mv.x,
            y: mv.y,
            rotation: mv.rotation,
          })),
          spatialKind: 'espaciado',
        });
      }
    } catch {
      // Ignorar si no hay redistribución viable
    }
  }

  const gain = (k: string): number => {
    const past = history.filter((r) => r.kind === k);
    return past.length
      ? past.reduce((n, r) => n + r.gain, 0) / past.length
      : 0;
  };
  options.sort((a, b) => gain(b.kind) - gain(a.kind));

  // Diversificar candidatos: como máximo 1 por tipo para evaluar siempre espaciado, superficies y gestión
  const diversified: ComparisonChange[] = [];
  const seenKinds = new Set<string>();
  for (const opt of options) {
    if (!seenKinds.has(opt.kind)) {
      seenKinds.add(opt.kind);
      diversified.push(opt);
    }
    if (diversified.length >= 4) break;
  }

  const alternatives: Array<{
    change: ComparisonChange;
    after: TrialResult;
    gain: number;
  }> = [];

  for (const change of diversified) {
    const candidate = structuredClone(scene);
    if (change.moves?.length) {
      const byId = new Map(change.moves.map((mv) => [mv.id, mv]));
      for (const o of [...candidate.base.booths, ...candidate.infrastructure]) {
        const mv = byId.get(o.id);
        if (mv) Object.assign(o, mv);
      }
    } else if (change.addItem) {
      candidate.infrastructure.push(structuredClone(change.addItem));
    } else {
      const o = [...candidate.base.booths, ...candidate.infrastructure].find(
        (item) => item.id === change.id
      );
      if (!o) continue;
      Object.assign(o, change.patch);
    }
    try {
      const after = await trial(candidate, 900, yieldTask);
      alternatives.push({
        change,
        after: after.result,
        gain: before.result.score - after.result.score,
      });
    } catch {
      // Si un candidato nuevo introduce un bloqueo de seguridad, se descarta
    }
  }
  alternatives.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    // En empate, preferir menor tiempo atascado y mayor distanciamiento mínimo
    if (a.after.stuckSeconds !== b.after.stuckSeconds) {
      return a.after.stuckSeconds - b.after.stuckSeconds;
    }
    return (
      (b.after.spatial.minClearanceMeters ?? 0) -
      (a.after.spatial.minClearanceMeters ?? 0)
    );
  });
  return {
    before: before.result,
    alternatives,
    seed: scene.seed,
    issues: before.result.counts,
    visitors: before.rows.length,
  };
}
