import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {phaseScene} from '../../src/engine/logistics/phases';
import {
  blankLayout,
  composeScene,
  splitLegacyScene,
} from '../../src/engine/workspace/venue-layout';
import type {Scene} from '../../src/types';
import type {Layout, Venue} from '../../src/types/venue';

const NOW = '2026-11-25T10:00:00.000Z';

function run(scene: Scene, seed: number) {
  const simScene = structuredClone(phaseScene(scene, 'event'));
  simScene.seed = seed;
  const engine = new EventEngine(simScene);
  engine.emergency = new ResponseSimulation(engine);
  for (let i = 0; i < 240; i++) engine.tick(0.5);
  return {
    arrivals: engine.stats.arrivals,
    admitted: engine.stats.admitted,
    served: engine.stats.served,
    abandoned: engine.stats.abandoned,
    positions: engine.agents.slice(0, 10).map((a) => [Math.round(a.x * 100), Math.round(a.y * 100)]),
  };
}

function composedFromLegacy(scene: Scene): Scene {
  const split = splitLegacyScene(scene);
  const venue: Venue = {
    id: 'v',
    orgId: 'o',
    name: 'Plaza del Cristo',
    site: 'cristo',
    version: 1,
    map: MAPS_DATA.cristo,
    content: split.venue,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const layout: Layout = {
    ...blankLayout({id: 'l', orgId: 'o', eventId: 'e', venue, name: 'A', now: NOW}),
    content: split.layout,
    safety: split.safety,
  };
  return composeScene(scene, venue, layout, 'plain');
}

describe('venue / layout composition and seeded reproducibility (OX-04)', () => {
  it('a composed scene reproduces itself with the same seed', () => {
    configure(MAPS_DATA);
    const composed = composedFromLegacy(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA));
    expect(run(composed, 482917)).toEqual(run(structuredClone(composed), 482917));
  });

  it('composing the Plaza del Cristo preset does not change its seeded run', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    expect(run(composedFromLegacy(scene), 482917)).toEqual(run(scene, 482917));
  });
});
