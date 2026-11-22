import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {percent, world} from '../../src/engine/cartography/geometry';
import {
  alignSelectedItems,
  distributeSelectedItems,
  findItemsInMarqueeBox,
  findOverlappingItemsAtPoint,
} from '../../src/engine/cartography/selection-tools';
import {configure, initialScene} from '../../src/engine/crowd/presets';

describe('Selección de superpuestos, caja Shift+arrastrar y alineación/distribución', () => {
  const map = MAPS_DATA.cristo;

  it('identifies overlapping table under tent in priority order (table first, then tent) including locked items', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [];
    scene.entrances = [];

    const [cx, cy] = percent([250, 200], map);
    scene.infrastructure.push(
      {
        id: 'tent-1',
        name: 'Carpa 6x6',
        kind: 'cover',
        role: 'cover',
        x: cx,
        y: cy,
        width: 6,
        depth: 6,
        locked: true,
      },
      {
        id: 'table-1',
        name: 'Mesa picnic',
        kind: 'picnic',
        role: 'furniture',
        x: cx,
        y: cy,
        width: 3,
        depth: 1.8,
        locked: false,
      }
    );

    const hits = findOverlappingItemsAtPoint([250, 200], scene, map);
    expect(hits.map((h) => h.id)).toEqual(['table-1', 'tent-1']);
    expect(hits[0].locked).toBe(false);
    expect(hits[1].locked).toBe(true);
  });

  it('marquee box selects all unlocked items inside the rectangle and skips locked ones', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [];
    scene.entrances = [];

    const [p1x, p1y] = percent([200, 200], map);
    const [p2x, p2y] = percent([210, 200], map);
    const [p3x, p3y] = percent([220, 200], map);
    scene.base.booths.push(
      {id: 'b1', name: 'Puesto 1', type: 'commerce', x: p1x, y: p1y, width: 4, depth: 3},
      {id: 'b2', name: 'Puesto 2 (bloq)', type: 'commerce', x: p2x, y: p2y, width: 4, depth: 3, locked: true},
      {id: 'b3', name: 'Puesto 3', type: 'commerce', x: p3x, y: p3y, width: 4, depth: 3}
    );

    const res = findItemsInMarqueeBox([195, 195], [225, 205], scene, map, {
      excludeLocked: true,
    });
    expect(res.ids).toEqual(['b1', 'b3']);
    expect(res.skippedLocked).toBe(1);
  });

  it('aligns and distributes selected items equidistantly while keeping locked items fixed', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [];
    scene.entrances = [];

    const [x1, y1] = percent([200, 180], map);
    const [x2, y2] = percent([212, 210], map);
    const [x3, y3] = percent([240, 195], map);
    scene.base.booths.push(
      {id: 'a1', name: 'A1', type: 'commerce', x: x1, y: y1, width: 4, depth: 4, locked: true},
      {id: 'a2', name: 'A2', type: 'commerce', x: x2, y: y2, width: 4, depth: 4},
      {id: 'a3', name: 'A3', type: 'commerce', x: x3, y: y3, width: 4, depth: 4}
    );

    // Alinear arriba (minTop = 180 - 2 = 178 -> cy = 180)
    const alignRes = alignSelectedItems(scene, ['a1', 'a2', 'a3'], map, 'top');
    expect(alignRes.movedCount).toBe(2);
    expect(alignRes.lockedSkipped).toBe(1);
    expect(world([scene.base.booths[0].x, scene.base.booths[0].y], map)[1]).toBeCloseTo(180, 1);
    expect(world([scene.base.booths[1].x, scene.base.booths[1].y], map)[1]).toBeCloseTo(180, 1);
    expect(world([scene.base.booths[2].x, scene.base.booths[2].y], map)[1]).toBeCloseTo(180, 1);

    // Distribuir horizontalmente entre 200 y 240 -> centro medio debe quedar en 220
    const distRes = distributeSelectedItems(scene, ['a1', 'a2', 'a3'], map, 'x');
    expect(distRes.movedCount).toBe(1);
    expect(world([scene.base.booths[1].x, scene.base.booths[1].y], map)[0]).toBeCloseTo(220, 1);
  });

  it('never stacks solid items on top of each other when aligning a row to the left', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [];
    scene.entrances = [];

    const [x1, y1] = percent([200, 200], map);
    const [x2, y2] = percent([210, 200], map);
    const [x3, y3] = percent([220, 200], map);
    scene.base.booths.push(
      {id: 'r1', name: 'R1', type: 'commerce', x: x1, y: y1, width: 4, depth: 3},
      {id: 'r2', name: 'R2', type: 'commerce', x: x2, y: y2, width: 4, depth: 3},
      {id: 'r3', name: 'R3', type: 'commerce', x: x3, y: y3, width: 4, depth: 3}
    );

    alignSelectedItems(scene, ['r1', 'r2', 'r3'], map, 'left');
    const pts = scene.base.booths.map((b) => world([b.x, b.y], map));
    // Todos alineados en X = 200, pero separados en Y (≥ 3.5 m) sin solaparse
    expect(pts[0][0]).toBeCloseTo(200, 1);
    expect(pts[1][0]).toBeCloseTo(200, 1);
    expect(pts[2][0]).toBeCloseTo(200, 1);
    expect(pts[1][1] - pts[0][1]).toBeGreaterThanOrEqual(3.4);
    expect(pts[2][1] - pts[1][1]).toBeGreaterThanOrEqual(3.4);
  });
});
