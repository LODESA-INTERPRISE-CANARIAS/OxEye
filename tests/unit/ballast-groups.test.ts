import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {percent, world} from '../../src/engine/cartography/geometry';
import {
  groupDepthForId,
  groupSelection,
  resolveGroupLeafIds,
  rotateItemsRigid,
  snapshotGroupTransform,
  topGroupOf,
  translateItemsRigid,
  ungroupTopLevel,
} from '../../src/engine/cartography/groups';
import {configure, initialScene, validateScene} from '../../src/engine/crowd/presets';
import {assessRisk} from '../../src/engine/emergency/risk';
import {
  addBallastSubcomponentsToCover,
  coverSubcomponentBallastIds,
  evaluateCoverBallast,
  HEAVY_LOAD_THRESHOLD_KG_M2,
  meetsHeavyLoadThreshold,
  surfaceLoadKgM2,
} from '../../src/engine/planning/ballast';
import {
  evaluateHeavyLoadConflicts,
  isHeavyLoadItem,
} from '../../src/engine/subsoil/heat';

describe('Lastres editables, umbral de 500 kg/m² y dotación de carpas', () => {
  const map = MAPS_DATA.cristo; // 500 x 400 m

  it('computes surface load in kg/m² and triggers heavy-load threshold at >= 500 kg/m²', () => {
    expect(HEAVY_LOAD_THRESHOLD_KG_M2).toBe(500);
    expect(surfaceLoadKgM2({massKg: 500, width: 1, depth: 1})).toBe(500);
    expect(meetsHeavyLoadThreshold({massKg: 500, width: 1, depth: 1})).toBe(
      true
    );
    expect(meetsHeavyLoadThreshold({massKg: 499, width: 1, depth: 1})).toBe(
      false
    );
    // Custom supportAreaM2 overrides width * depth
    expect(
      surfaceLoadKgM2({massKg: 300, width: 1, depth: 1, supportAreaM2: 0.5})
    ).toBe(600);
    expect(
      meetsHeavyLoadThreshold({
        massKg: 300,
        width: 1,
        depth: 1,
        supportAreaM2: 0.5,
      })
    ).toBe(true);
  });

  it('keeps tent own weight, ballasts, and ground surface load separate and checks subsoil only for heavy ballasts', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [
      {
        id: 'cover-1',
        name: 'Carpa 15x10',
        kind: 'cover',
        role: 'cover',
        x: 50,
        y: 50,
        width: 15,
        depth: 10,
        rotation: 0,
        tentMassKg: 420,
        ballastSpanMeters: 5, // 3 spans -> 3 * 2 = 6 ballasts required
        ballastsPerSpan: 2,
        ballastRequiredMassKg: 400,
        active: true,
        phaseTags: ['event'],
      },
      {
        id: 'ballast-heavy',
        name: 'Lastre pesado',
        kind: 'ballast',
        role: 'logistics',
        x: 49,
        y: 50,
        width: 1,
        depth: 1,
        rotation: 0,
        massKg: 600, // 600 kg/m² >= 500 -> heavy
        supportAreaM2: 1,
        heavyLoad: true,
        attachedCoverId: 'cover-1',
        active: true,
        phaseTags: ['event'],
      },
      {
        id: 'ballast-light',
        name: 'Lastre ligero',
        kind: 'ballast',
        role: 'logistics',
        x: 51,
        y: 50,
        width: 1,
        depth: 1,
        rotation: 0,
        massKg: 300, // 300 kg/m² < 500 -> not heavy, also under 400 kg spec
        supportAreaM2: 1,
        heavyLoad: false,
        attachedCoverId: 'cover-1',
        active: true,
        phaseTags: ['event'],
      },
      {
        id: 'ballast-unrelated-nearby',
        name: 'Lastre suelto cercano',
        kind: 'ballast',
        role: 'logistics',
        x: 50.2,
        y: 50,
        width: 1,
        depth: 1,
        rotation: 0,
        massKg: 450,
        supportAreaM2: 1,
        heavyLoad: false,
        active: true,
        phaseTags: ['event'],
      },
    ];
    scene.subsoil = {
      polygons: [
        {
          id: 'garage-1',
          op: 'add',
          name: 'Garaje',
          points: [
            [35, 35],
            [65, 35],
            [65, 65],
            [35, 65],
          ],
        },
      ],
      columns: [],
      walls: [],
    };

    // Tent itself is NOT a heavy load; only ballast-heavy (>= 500 kg/m²) triggers subsoil conflict
    expect(isHeavyLoadItem(scene.infrastructure[0])).toBe(false);
    expect(isHeavyLoadItem(scene.infrastructure[1])).toBe(true);
    expect(isHeavyLoadItem(scene.infrastructure[2])).toBe(false);

    const conflicts = evaluateHeavyLoadConflicts(scene, map);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].itemId).toBe('ballast-heavy');
    expect(conflicts[0].surfaceLoadKgM2).toBe(600);

    // Tent provisioning: 15 m / 5 m = 3 spans × 2 = 6 required; 2 linked -> 4 missing, 1 under mass
    const status = evaluateCoverBallast(scene.infrastructure[0], scene, map);
    expect(status.configured).toBe(true);
    expect(status.spansCount).toBe(3);
    expect(status.requiredCount).toBe(6);
    expect(status.linkedCount).toBe(2);
    expect(status.missingCount).toBe(4);
    expect(status.underMassBallasts.map((b) => b.id)).toEqual(['ballast-light']);
    // Separated metrics
    expect(status.tentMassKg).toBe(420);
    expect(status.totalBallastMassKg).toBe(900);
    expect(status.maxBallastSurfaceLoadKgM2).toBe(600);

    const risk = assessRisk(scene);
    expect(
      risk.warnings.some((w) => w.id === 'ballast-missing-cover-1')
    ).toBe(true);
    expect(
      risk.critical.some((c) => c.id === 'subsoil-load-ballast-heavy')
    ).toBe(true);
  });

  it('supports nested grouping (ballasts -> group with cover), rigid move/rotate, and single-level ungrouping', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [
      {
        id: 'cover-1',
        name: 'Carpa',
        kind: 'cover',
        role: 'cover',
        x: 50, // 250 m
        y: 50, // 200 m
        width: 10,
        depth: 10,
        rotation: 0,
        active: true,
      },
      {
        id: 'b-1',
        name: 'Lastre 1',
        kind: 'ballast',
        role: 'logistics',
        x: 49, // 245 m (-5 m from cover)
        y: 50, // 200 m
        width: 1,
        depth: 1,
        rotation: 0,
        massKg: 500,
        active: true,
      },
      {
        id: 'b-2',
        name: 'Lastre 2',
        kind: 'ballast',
        role: 'logistics',
        x: 51, // 255 m (+5 m from cover)
        y: 50, // 200 m
        width: 1,
        depth: 1,
        rotation: 0,
        massKg: 500,
        active: true,
      },
    ];

    // 1. Group the two ballasts (level 1)
    const g1 = groupSelection(scene, ['b-1', 'b-2']);
    expect(g1).not.toBeNull();
    expect(g1!.memberLeafIds).toEqual(['b-1', 'b-2']);
    expect(groupDepthForId(scene.groups, 'b-1')).toBe(1);
    expect(groupDepthForId(scene.groups, 'cover-1')).toBe(0);

    // 2. Group the ballast subgroup with the cover (level 2)
    const g2 = groupSelection(scene, ['b-1', 'cover-1']);
    expect(g2).not.toBeNull();
    expect(g2!.memberLeafIds.sort()).toEqual(['b-1', 'b-2', 'cover-1']);
    expect(groupDepthForId(scene.groups, 'b-1')).toBe(2);
    expect(groupDepthForId(scene.groups, 'cover-1')).toBe(1);
    expect(() => validateScene(scene)).not.toThrow();

    // 3. Rigid translation preserves exact relative positions
    const allIds = resolveGroupLeafIds(scene.groups, g2!.groupId);
    const snapsMove = snapshotGroupTransform(scene, allIds);
    expect(translateItemsRigid(scene, allIds, snapsMove, 10, -8, map)).toBe(
      true
    );
    const cPos = world([scene.infrastructure[0].x, scene.infrastructure[0].y], map);
    const b1Pos = world([scene.infrastructure[1].x, scene.infrastructure[1].y], map);
    const b2Pos = world([scene.infrastructure[2].x, scene.infrastructure[2].y], map);
    expect(cPos[0]).toBeCloseTo(260, 3);
    expect(cPos[1]).toBeCloseTo(192, 3);
    expect(b1Pos[0] - cPos[0]).toBeCloseTo(-5, 3);
    expect(b2Pos[0] - cPos[0]).toBeCloseTo(5, 3);

    // 4. Rigid rotation by 90° around cover center rotates ballasts from (-5,0)/(+5,0) to (0,-5)/(0,+5)
    const snapsRot = snapshotGroupTransform(scene, allIds);
    expect(rotateItemsRigid(scene, allIds, snapsRot, cPos, 90, map)).toBe(true);
    const b1Rot = world([scene.infrastructure[1].x, scene.infrastructure[1].y], map);
    const b2Rot = world([scene.infrastructure[2].x, scene.infrastructure[2].y], map);
    expect(b1Rot[0]).toBeCloseTo(cPos[0], 2);
    expect(b1Rot[1]).toBeCloseTo(cPos[1] - 5, 2);
    expect(b2Rot[0]).toBeCloseTo(cPos[0], 2);
    expect(b2Rot[1]).toBeCloseTo(cPos[1] + 5, 2);
    expect(scene.infrastructure[0].rotation).toBeCloseTo(90, 1);

    // 5. Shift+G ungroups ONLY the top level (G2), preserving G1 and all positions
    const posBeforeUngroup = scene.infrastructure.map((o) => [o.x, o.y]);
    const u1 = ungroupTopLevel(scene, allIds);
    expect(u1?.dissolvedGroupIds).toEqual([g2!.groupId]);
    expect(topGroupOf(scene.groups, 'cover-1')).toBeNull();
    expect(topGroupOf(scene.groups, 'b-1')?.id).toBe(g1!.groupId);
    expect(scene.infrastructure.map((o) => [o.x, o.y])).toEqual(posBeforeUngroup);

    // 6. Second Shift+G dissolves G1 so each ballast is completely independent
    const u2 = ungroupTopLevel(scene, ['b-1', 'b-2']);
    expect(u2?.dissolvedGroupIds).toEqual([g1!.groupId]);
    expect(scene.groups).toHaveLength(0);
    expect(scene.infrastructure.map((o) => [o.x, o.y])).toEqual(posBeforeUngroup);

    // 7. Adding ballast subcomponents directly from a cover creates perimeter-attached ballasts
    const created = addBallastSubcomponentsToCover(
      scene.infrastructure[0],
      scene,
      map,
      2
    );
    expect(created).toHaveLength(2);
    expect(coverSubcomponentBallastIds(scene, 'cover-1')).toEqual(created);

    // Suppress unused helper warning
    expect(percent([250, 200], map)).toEqual([50, 50]);
  });
});
