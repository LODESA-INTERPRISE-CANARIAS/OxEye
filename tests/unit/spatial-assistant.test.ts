import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {
  analyzeSpatialCorrections,
  applySpatialCorrection,
} from '../../src/engine/planning/spatial-assistant';

describe('Asistente de corrección espacial inteligente', () => {
  it('detects colliding elements, proposes a geometrically valid minimal separation, respects locked items, and applies cleanly', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);

    // Place two booths overlapping at the center of the boundary
    scene.base.booths = [
      {
        id: 'booth-a',
        name: 'Puesto A',
        kind: 'craft',
        type: 'commerce',
        x: 45,
        y: 48,
        width: 4,
        depth: 3,
        rotation: 0,
        phaseTags: ['event'],
      },
      {
        id: 'booth-b',
        name: 'Puesto B',
        kind: 'craft',
        type: 'commerce',
        x: 45.2,
        y: 48.1,
        width: 4,
        depth: 3,
        rotation: 0,
        phaseTags: ['event'],
      },
    ];
    scene.infrastructure = [];

    const proposals = analyzeSpatialCorrections(scene, map);
    const conflict = proposals.find((p) => p.incidentKind === 'element_conflict');
    expect(conflict).toBeDefined();
    expect(conflict!.viable).toBe(true);
    expect(conflict!.moves).toHaveLength(1);
    expect(conflict!.instruction).toContain('Separar');

    // Applying resolves the geometric collision
    const res = applySpatialCorrection(scene, conflict!, map);
    expect(res.applied).toBe(true);
    const after = analyzeSpatialCorrections(scene, map);
    expect(after.some((p) => p.incidentKind === 'element_conflict')).toBe(false);

    // Locked items are never moved automatically; assistant explains why
    scene.base.booths[0].locked = true;
    scene.base.booths[1].locked = true;
    scene.base.booths[1].x = scene.base.booths[0].x;
    scene.base.booths[1].y = scene.base.booths[0].y;
    const lockedProposals = analyzeSpatialCorrections(scene, map);
    const lockedConflict = lockedProposals.find(
      (p) => p.incidentKind === 'element_conflict'
    );
    expect(lockedConflict).toBeDefined();
    expect(lockedConflict!.viable).toBe(false);
    expect(lockedConflict!.unviableReason).toContain('bloqueados');
  });
});
