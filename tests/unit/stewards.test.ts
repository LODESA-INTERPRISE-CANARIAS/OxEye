import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {assessRisk} from '../../src/engine/emergency/risk';
import {phaseScene} from '../../src/engine/logistics/phases';

describe('Personal de asistencia y orientación (StewardSystem)', () => {
  it('spawns autonomous steward agents independent of police/medical slots and performs measurable interventions', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);

    // Confirm stewards do NOT count as emergency medical/security/fire slots
    const slotsBefore = assessRisk(scene).slots;
    scene.infrastructure.push({
      id: 'steward-post-1',
      name: 'Personal de asistencia 1',
      kind: 'steward',
      role: 'steward',
      x: 45,
      y: 48,
      width: 0.5,
      depth: 0.5,
      rotation: 0,
      staff: 3,
      patrolRadius: 35,
      active: true,
      phaseTags: ['event'],
    });
    const slotsAfter = assessRisk(scene).slots;
    expect(slotsAfter).toEqual(slotsBefore);

    const engine = new EventEngine(phaseScene(scene, 'event'));
    expect(engine.stewards.agents).toHaveLength(3);

    // Inject an unreported incident near the steward post and verify early coordination/reporting
    const sw0 = engine.stewards.agents[0];
    engine.emergency.events.push({
      id: 'inc-unrep-1',
      type: 'minor',
      name: 'Mareo leve',
      status: 'unreported',
      point: [sw0.x + 1, sw0.y],
      created: 0,
    });

    for (let i = 0; i < 40; i++) {
      engine.tick(0.5);
    }

    const inc = engine.emergency.events.find((r) => r.id === 'inc-unrep-1');
    expect(inc?.status).not.toBe('unreported');
    expect(engine.stewards.metrics.escalations).toBeGreaterThanOrEqual(1);
    expect(engine.stewards.svg()).toContain('steward-agent');
  });
});
