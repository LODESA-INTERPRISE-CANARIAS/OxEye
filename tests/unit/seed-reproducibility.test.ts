import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {phaseScene} from '../../src/engine/logistics/phases';

describe('Sistema híbrido de semillas deterministas', () => {
  const runWithSeed = (seed: number) => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const simScene = structuredClone(phaseScene(scene, 'event'));
    simScene.seed = seed;
    const engine = new EventEngine(simScene);
    engine.emergency = new ResponseSimulation(engine);
    for (let i = 0; i < 240; i++) {
      engine.tick(0.5);
    }
    return {
      seed: engine.s.seed,
      arrivals: engine.stats.arrivals,
      admitted: engine.stats.admitted,
      served: engine.stats.served,
      abandoned: engine.stats.abandoned,
      positions: engine.agents
        .slice(0, 10)
        .map((a) => [Math.round(a.x * 100), Math.round(a.y * 100)]),
    };
  };

  it('produces 100% identical simulation outcomes for the same JSON + same seed', () => {
    const a = runWithSeed(482917);
    const b = runWithSeed(482917);
    expect(a).toEqual(b);
  });

  it('produces distinct trajectories when the same JSON is run with a different seed', () => {
    const a = runWithSeed(482917);
    const b = runWithSeed(913504);
    expect(a.positions).not.toEqual(b.positions);
  });
});
