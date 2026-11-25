import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {
  installationPerimeterStatus,
  installationsOutsidePerimeter,
} from '../../src/engine/cartography/perimeter-status';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import type {InfrastructureItem} from '../../src/types';
import {
  assessRisk,
  OUTSIDE_PERIMETER_ISSUE_PREFIX,
} from '../../src/engine/emergency/risk';
import type {BoothItem, MapMetadata, Point2D, Scene} from '../../src/types';

// 100 m × 100 m map: percentages equal metres.
const map = {
  bbox: [0, 0, 100, 100],
  widthMeters: 100,
  heightMeters: 100,
  source: 'test',
  crs: 'EPSG:32628',
  resolution: 1,
  retrieved: '',
  flightDate: '',
  attribution: '',
} as MapMetadata;

const square = (x0: number, y0: number, x1: number, y1: number): Point2D[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

type PerimeterScene = Pick<Scene, 'boundary' | 'passages' | 'reserves' | 'base' | 'infrastructure'>;

function scene(extra: Partial<PerimeterScene> = {}): PerimeterScene {
  return {
    boundary: square(20, 20, 80, 80),
    passages: [],
    reserves: [],
    base: {booths: []} as unknown as Scene['base'],
    infrastructure: [],
    ...extra,
  };
}

const booth = (id: string, x: number, y: number, extra: Partial<BoothItem> = {}): BoothItem => ({
  id,
  name: 'Caseta ' + id,
  type: 'food',
  x,
  y,
  width: 4,
  depth: 2,
  ...extra,
});

describe('installationPerimeterStatus', () => {
  it('reports inside when all four corners lie in the boundary', () => {
    expect(installationPerimeterStatus(booth('a', 50, 50), scene(), map)).toEqual({
      kind: 'inside',
      cornersOutside: 0,
      cornersInSubtract: 0,
    });
  });

  it('honours rotation: a footprint inside unrotated becomes partial when rotated across the edge', () => {
    // 4 × 2 m centred 1.5 m from the right edge (x = 80): half-width 2 would cross,
    // so use a 2 × 4 m piece (half-width 1) that fits until rotated 90°.
    const item = booth('r', 78.5, 50, {width: 2, depth: 4});
    expect(installationPerimeterStatus(item, scene(), map).kind).toBe('inside');
    const rotated = installationPerimeterStatus({...item, rotation: 90}, scene(), map);
    expect(rotated.kind).toBe('partial');
    expect(rotated.cornersOutside).toBe(2);
  });

  it('reports a single corner outside as partial', () => {
    // Rotated 45° next to the right edge: corner x offsets are ±1.59 / ±1.24 m,
    // so only the (+2, −0.25) corner reaches x ≈ 80.19 > 80.
    const item = booth('c', 78.6, 50, {width: 4, depth: 0.5, rotation: 45});
    expect(installationPerimeterStatus(item, scene(), map)).toEqual({
      kind: 'partial',
      cornersOutside: 1,
      cornersInSubtract: 0,
    });
  });

  it('reports outside when the footprint is fully outside the boundary', () => {
    expect(installationPerimeterStatus(booth('o', 10, 10), scene(), map)).toMatchObject({
      kind: 'outside',
      cornersOutside: 4,
      cornersInSubtract: 0,
    });
  });

  it('treats a footprint inside a boundary-subtract hole as outside', () => {
    const s = scene({
      reserves: [
        {
          id: 'hole',
          name: 'Área restada del perímetro',
          points: square(40, 40, 60, 60),
          origin: 'boundary-subtract',
        },
      ],
    });
    expect(installationPerimeterStatus(booth('h', 50, 50), s, map)).toEqual({
      kind: 'outside',
      cornersOutside: 4,
      cornersInSubtract: 4,
    });
  });

  it('ignores ordinary reserves (only boundary-subtract carves the perimeter)', () => {
    const s = scene({
      reserves: [{id: 'res', name: 'Reserva', points: square(40, 40, 60, 60)}],
    });
    expect(installationPerimeterStatus(booth('h', 50, 50), s, map).kind).toBe('inside');
  });

  it('treats a footprint inside a boundary-add extension as inside', () => {
    const s = scene({
      passages: [
        {
          id: 'ext',
          name: 'Ampliación del perímetro',
          points: square(80, 40, 95, 60),
          origin: 'boundary-add',
        },
      ],
    });
    expect(installationPerimeterStatus(booth('e', 88, 50), s, map).kind).toBe('inside');
    expect(installationPerimeterStatus(booth('e', 88, 50), scene(), map).kind).toBe('outside');
  });

  it('returns no-perimeter when the boundary has fewer than 3 points', () => {
    const s = scene({boundary: [[0, 0], [10, 10]]});
    expect(installationPerimeterStatus(booth('n', 50, 50), s, map).kind).toBe('no-perimeter');
    expect(installationsOutsidePerimeter(s, map)).toEqual([]);
  });

  it('lists only partial/outside booths and infrastructure items', () => {
    const s = scene({
      base: {booths: [booth('in', 50, 50), booth('out', 5, 5)]} as unknown as Scene['base'],
      infrastructure: [
        {id: 'wc', name: 'Aseo', kind: 'wc', role: 'service', x: 80, y: 50, width: 4, depth: 4},
      ],
    });
    const result = installationsOutsidePerimeter(s, map);
    expect(result.map((r) => [r.item.id, r.status.kind])).toEqual([
      ['out', 'outside'],
      ['wc', 'partial'],
    ]);
  });

  it('ignores emergency vehicles staged outside the venue', () => {
    const ambulance: InfrastructureItem = {
      id: 'amb',
      name: 'Ambulancia',
      kind: 'ambulance',
      role: 'emergency',
      x: 5,
      y: 5,
      width: 2.2,
      depth: 6,
    };
    const tent: InfrastructureItem = {...ambulance, id: 'post', kind: 'medical', name: 'Puesto'};
    const s = scene({infrastructure: [ambulance, tent]});
    expect(installationsOutsidePerimeter(s, map).map((r) => r.item.id)).toEqual(['post']);
  });
});

describe('assessRisk outside-perimeter issue', () => {
  it('emits a non-critical warning with the prefix for an installation outside the perimeter', () => {
    configure(MAPS_DATA);
    const s = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    expect(s.boundary.length).toBeGreaterThanOrEqual(3);
    const before = assessRisk(s).issues.filter((i) =>
      i.id.startsWith(OUTSIDE_PERIMETER_ISSUE_PREFIX)
    );
    expect(before.some((i) => i.id === OUTSIDE_PERIMETER_ISSUE_PREFIX + 'far')).toBe(false);

    s.base.booths.push(booth('far', 1, 1, {phaseTags: ['pre', 'event', 'post']}));
    const report = assessRisk(s);
    const issue = report.issues.find((i) => i.id === OUTSIDE_PERIMETER_ISSUE_PREFIX + 'far');
    expect(issue).toBeDefined();
    expect(issue?.level).toBe('warning');
    expect(issue?.origin).toBe('normative');
    expect(issue?.meta).toMatchObject({targetId: 'far', targetName: 'Caseta far'});
    expect(issue?.title).toContain('Caseta far');
    expect(issue?.action).toContain('no se desplaza automáticamente');
    expect(report.critical.some((i) => i.id.startsWith(OUTSIDE_PERIMETER_ISSUE_PREFIX))).toBe(false);
  });
});
