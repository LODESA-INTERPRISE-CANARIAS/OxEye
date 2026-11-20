import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  CATALOG_ITEM_LIMIT,
  copyItemsFromScene,
  deleteItemsFromScene,
  pasteItemsIntoScene,
} from '../../src/components/map/selectionActions';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {
  createDefaultProject,
  parseImportedProject,
} from '../../src/db/repository';
import {percent, remapScene, world} from '../../src/engine/cartography/geometry';
import {
  configure,
  initialScene,
  validateScene,
} from '../../src/engine/crowd/presets';
import {assessRisk, safetyFingerprint} from '../../src/engine/emergency/risk';
import {
  calor,
  columnHeat,
  evaluateHeavyLoadConflicts,
  isHeavyLoadItem,
  pointInSubsoil,
  rotateWall,
  structuralHeat,
  wallHeat,
  wallMetrics,
} from '../../src/engine/subsoil/heat';
import type {SubsoilColumn, SubsoilStructure, SubsoilWall} from '../../src/types';

describe('Subsoil Structural Heat Engine (Rayos X)', () => {
  const map = MAPS_DATA.cristo; // 500 x 400 m

  it('returns 0 when subsoil is undefined or empty', () => {
    expect(structuralHeat([250, 200], undefined, map)).toBe(0);
    expect(
      calor([250, 200], {polygons: [], columns: [], walls: []}, map)
    ).toBe(0);
  });

  it('computes circular column heat: 1 inside core, monotonic falloff to 0', () => {
    const col: SubsoilColumn = {
      id: 'c1',
      name: 'Columna 1',
      x: 50, // 250 m
      y: 50, // 200 m
      diameter: 2, // r0 = 1 m
      influenceRadius: 4, // reaches 0 at d = 5 m
    };
    expect(columnHeat([250, 200], col, map)).toBe(1);
    expect(columnHeat([251, 200], col, map)).toBe(1);
    expect(columnHeat([253, 200], col, map)).toBeCloseTo(0.5, 5);
    expect(columnHeat([250, 203], col, map)).toBeCloseTo(0.5, 5);
    expect(columnHeat([255, 200], col, map)).toBe(0);
    expect(columnHeat([260, 200], col, map)).toBe(0);
  });

  it('computes symmetric wall heat band that follows arbitrary wall rotation', () => {
    const wall: SubsoilWall = {
      id: 'w1',
      name: 'Muro 1',
      a: percent([240, 200], map),
      b: percent([260, 200], map),
      thickness: 1, // halfThickness = 0.5 m
      influenceDepth: 4, // reaches 0 at perpendicular d = 4.5 m
    };
    // Horizontal wall along y = 200
    expect(wallHeat([250, 200], wall, map)).toBe(1);
    expect(wallHeat([250, 200.5], wall, map)).toBe(1);
    const north = wallHeat([250, 197.5], wall, map); // d = 2.5 -> (2.5-0.5)/4 = 0.5
    const south = wallHeat([250, 202.5], wall, map);
    expect(north).toBeCloseTo(0.5, 5);
    expect(south).toBeCloseTo(north, 5);
    expect(wallHeat([250, 204.5], wall, map)).toBe(0);

    // Rotate wall 90° (vertical along x = 250, y in [190, 210])
    const rotatedEndpoints = rotateWall(wall, 90, map);
    const rotatedWall: SubsoilWall = {...wall, ...rotatedEndpoints};
    expect(wallMetrics(rotatedWall, map).angleDeg).toBeCloseTo(90, 2);
    expect(wallHeat([250, 200], rotatedWall, map)).toBe(1);
    expect(wallHeat([252.5, 200], rotatedWall, map)).toBeCloseTo(0.5, 4);
    expect(wallHeat([247.5, 200], rotatedWall, map)).toBeCloseTo(0.5, 4);
    // Point that used to be on the horizontal wall (240, 200) is now 10 m away -> 0
    expect(wallHeat([240, 200], rotatedWall, map)).toBe(0);
  });

  it('combines overlapping column and wall heat within [0, 1]', () => {
    const subsoil: SubsoilStructure = {
      polygons: [],
      columns: [
        {
          id: 'c1',
          name: 'C1',
          x: 50,
          y: 50,
          diameter: 2,
          influenceRadius: 4,
        },
      ],
      walls: [
        {
          id: 'w1',
          name: 'W1',
          a: percent([245, 203], map),
          b: percent([255, 203], map),
          thickness: 1,
          influenceDepth: 4,
        },
      ],
    };
    const pt: [number, number] = [250, 201.5];
    const hCol = columnHeat(pt, subsoil.columns[0], map);
    const hWall = wallHeat(pt, subsoil.walls[0], map);
    const combined = structuralHeat(pt, subsoil, map);
    expect(combined).toBeGreaterThan(hCol);
    expect(combined).toBeGreaterThan(hWall);
    expect(combined).toBeLessThanOrEqual(1);
    expect(combined).toBeCloseTo(1 - (1 - hCol) * (1 - hWall), 5);
  });

  it('evaluates sequential add/subtract subsoil perimeter polygons in order', () => {
    const subsoil: SubsoilStructure = {
      polygons: [
        {
          id: 'p1',
          op: 'add',
          points: [
            [20, 20],
            [60, 20],
            [60, 60],
            [20, 60],
          ],
        },
        {
          id: 'p2',
          op: 'subtract',
          points: [
            [30, 30],
            [50, 30],
            [50, 50],
            [30, 50],
          ],
        },
        {
          id: 'p3',
          op: 'add',
          points: [
            [35, 35],
            [45, 35],
            [45, 45],
            [35, 45],
          ],
        },
      ],
      columns: [],
      walls: [],
    };
    expect(pointInSubsoil([25, 25], subsoil)).toBe(true);
    expect(pointInSubsoil([32, 32], subsoil)).toBe(false);
    expect(pointInSubsoil([40, 40], subsoil)).toBe(true);
    expect(pointInSubsoil([10, 10], subsoil)).toBe(false);
  });
});

describe('Subsoil Persistence, Validation & Legacy Compatibility', () => {
  it('validates scenes with subsoil and rejects invalid subsoil definitions', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    scene.subsoil = {
      polygons: [
        {
          id: 'sp-1',
          op: 'add',
          points: [
            [30, 30],
            [60, 30],
            [60, 60],
          ],
        },
      ],
      columns: [
        {
          id: 'sc-1',
          name: 'Columna A',
          x: 45,
          y: 45,
          diameter: 0.8,
          influenceRadius: 4,
        },
      ],
      walls: [
        {
          id: 'sw-1',
          name: 'Muro A',
          a: [35, 40],
          b: [55, 40],
          thickness: 0.4,
          influenceDepth: 3,
        },
      ],
    };
    expect(() => validateScene(scene)).not.toThrow();

    const bad = structuredClone(scene);
    bad.subsoil!.columns[0].diameter = -1;
    expect(() => validateScene(bad)).toThrow();

    const badPoly = structuredClone(scene);
    badPoly.subsoil!.polygons[0].points = [
      [30, 30],
      [40, 40],
    ];
    expect(() => validateScene(badPoly)).toThrow();
  });

  it('round-trips JSON export/import preserving subsoil and loads legacy jsons/Test.json', () => {
    const project = createDefaultProject();
    project.scenes.cristo.subsoil = {
      polygons: [
        {
          id: 'poly-1',
          op: 'add',
          points: [
            [35, 35],
            [55, 35],
            [55, 55],
            [35, 55],
          ],
        },
      ],
      columns: [
        {
          id: 'col-1',
          name: 'Pilar central',
          x: 45,
          y: 45,
          diameter: 1.2,
          influenceRadius: 5,
        },
      ],
      walls: [
        {
          id: 'wall-1',
          name: 'Muro norte',
          a: [38, 40],
          b: [52, 40],
          thickness: 0.5,
          influenceDepth: 3.5,
        },
      ],
    };

    const json = JSON.stringify(project);
    const reimported = parseImportedProject(json, project, MAPS_DATA);
    expect(reimported.scenes.cristo.subsoil).toEqual(
      project.scenes.cristo.subsoil
    );

    // Legacy Test.json without subsoil must still load cleanly
    const legacyRaw = readFileSync(
      resolve(__dirname, '../../jsons/Test.json'),
      'utf-8'
    );
    const loadedLegacy = parseImportedProject(legacyRaw, project, MAPS_DATA);
    expect(loadedLegacy.format).toBe('ojo-de-buey');
    expect(loadedLegacy.scenes.cristo.subsoil).toBeUndefined();
  });

  it('remaps subsoil coordinates in remapScene', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    scene.subsoil = {
      polygons: [
        {
          id: 'p1',
          op: 'add',
          points: [
            [40, 40],
            [50, 40],
            [50, 50],
          ],
        },
      ],
      columns: [
        {
          id: 'c1',
          name: 'C1',
          x: 45,
          y: 45,
          diameter: 1,
          influenceRadius: 3,
        },
      ],
      walls: [
        {
          id: 'w1',
          name: 'W1',
          a: [40, 45],
          b: [50, 45],
          thickness: 0.4,
          influenceDepth: 2,
        },
      ],
    };
    const remapped = remapScene(scene, MAPS_DATA.cristo, MAPS_DATA.cristo);
    expect(remapped.subsoil?.columns[0].x).toBeCloseTo(45, 5);
    expect(remapped.subsoil?.walls[0].b[0]).toBeCloseTo(50, 5);
  });
});

describe('Multi-Selection, Clipboard & Locked Rules', () => {
  it('copies, pastes with offset and new IDs, respects locked on delete and 150-item cap', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.subsoil = {
      polygons: [],
      columns: [
        {
          id: 'sub-col-1',
          name: 'Columna 1',
          x: 45,
          y: 45,
          diameter: 1,
          influenceRadius: 4,
        },
      ],
      walls: [],
    };
    const boothId = scene.base.booths[0].id;
    scene.base.booths[0].locked = true;
    const oldPos = world([scene.base.booths[0].x, scene.base.booths[0].y], map);

    // Copy booth + subsoil column together
    const clip = copyItemsFromScene(scene, [boothId, 'sub-col-1']);
    expect(clip.entries.length).toBe(2);

    // Blocked in simulate panel
    const simRes = pasteItemsIntoScene(scene, clip, map, 10, 'simulate');
    expect(simRes.newIds.length).toBe(0);

    // Paste in design panel
    const pasteRes = pasteItemsIntoScene(scene, clip, map, 10, 'design');
    expect(pasteRes.newIds.length).toBe(2);
    expect(pasteRes.newIds).not.toContain(boothId);
    expect(pasteRes.newIds).not.toContain('sub-col-1');
    const pastedBooth = scene.base.booths.find(
      (b) => b.id === pasteRes.newIds[0]
    );
    expect(pastedBooth).toBeDefined();
    const newPos = world([pastedBooth!.x, pastedBooth!.y], map);
    expect(Math.hypot(newPos[0] - oldPos[0], newPos[1] - oldPos[1])).toBeGreaterThan(
      1
    );

    // Delete respects locked booth, deletes unlocked column
    const delRes = deleteItemsFromScene(scene, [boothId, 'sub-col-1'], 'design');
    expect(delRes.lockedIds).toEqual([boothId]);
    expect(delRes.deletedIds).toEqual(['sub-col-1']);
    expect(scene.base.booths.some((b) => b.id === boothId)).toBe(true);
    expect(scene.subsoil.columns.some((c) => c.id === 'sub-col-1')).toBe(false);

    // 150 catalog item cap
    while (
      scene.base.booths.length +
        scene.infrastructure.length +
        scene.entrances.length <
      CATALOG_ITEM_LIMIT
    ) {
      scene.base.booths.push({
        ...structuredClone(scene.base.booths[0]),
        id: crypto.randomUUID(),
        locked: false,
      });
    }
    const boothClip = copyItemsFromScene(scene, [boothId]);
    const capRes = pasteItemsIntoScene(scene, boothClip, map, 10, 'design');
    expect(capRes.newIds.length).toBe(0);
    expect(capRes.skippedCatalogLimit).toBe(1);
  });
});

describe('Heavy Load Structural Risk Assessment', () => {
  it('classifies heavy loads by catalog defaults and respects explicit heavyLoad override', () => {
    expect(isHeavyLoadItem({kind: 'stage', type: 'stage'})).toBe(true);
    expect(isHeavyLoadItem({kind: 'food', type: 'food'})).toBe(true);
    expect(isHeavyLoadItem({kind: 'cover', role: 'cover'})).toBe(true);
    expect(isHeavyLoadItem({kind: 'fire', role: 'emergency'})).toBe(true);
    expect(isHeavyLoadItem({kind: 'craft', type: 'commerce'})).toBe(false);
    expect(isHeavyLoadItem({kind: 'picnic', role: 'furniture'})).toBe(false);

    // Explicit override takes precedence
    expect(
      isHeavyLoadItem({kind: 'craft', type: 'commerce', heavyLoad: true})
    ).toBe(true);
    expect(
      isHeavyLoadItem({kind: 'stage', type: 'stage', heavyLoad: false})
    ).toBe(false);
  });

  it('detects heavy loads over subsoil columns/walls and emits critical risk in assessRisk', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);

    // Place a column directly under a heavy stage and a wall near a light craft booth
    scene.infrastructure = [];
    scene.base.booths = [
      {
        id: 'heavy-stage-1',
        name: 'Escenario principal',
        kind: 'stage',
        type: 'stage',
        x: 50,
        y: 50,
        width: 12,
        depth: 8,
        rotation: 0,
        phaseTags: ['event'],
      },
      {
        id: 'light-craft-1',
        name: 'Puesto artesanía',
        kind: 'craft',
        type: 'commerce',
        x: 30,
        y: 30,
        width: 4,
        depth: 3,
        rotation: 0,
        phaseTags: ['event'],
      },
    ];
    scene.subsoil = {
      polygons: [],
      columns: [
        {
          id: 'col-under-stage',
          name: 'Pilar S1',
          x: 50,
          y: 50,
          diameter: 1,
          influenceRadius: 4,
        },
      ],
      walls: [
        {
          id: 'wall-under-craft',
          name: 'Muro M1',
          a: [28, 30],
          b: [32, 30],
          thickness: 0.5,
          influenceDepth: 3,
        },
      ],
    };

    const conflicts = evaluateHeavyLoadConflicts(scene, map);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].itemId).toBe('heavy-stage-1');
    expect(conflicts[0].level).toBe('critical');
    expect(conflicts[0].sources[0].name).toBe('Pilar S1');

    const report = assessRisk(scene);
    const loadIssue = report.critical.find(
      (i) => i.id === 'subsoil-load-heavy-stage-1'
    );
    expect(loadIssue).toBeDefined();
    expect(loadIssue?.title).toContain('Escenario principal');
    expect(loadIssue?.action).toContain('Pilar S1');

    // Moving stage away clears the risk and changes safetyFingerprint
    const fpBefore = safetyFingerprint(scene);
    scene.base.booths[0].x = 80;
    scene.base.booths[0].y = 80;
    const fpAfter = safetyFingerprint(scene);
    expect(fpAfter).not.toBe(fpBefore);
    const reportAfter = assessRisk(scene);
    expect(
      reportAfter.issues.some((i) => i.id === 'subsoil-load-heavy-stage-1')
    ).toBe(false);
  });
});
