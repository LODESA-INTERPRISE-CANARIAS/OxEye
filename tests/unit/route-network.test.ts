import {describe, expect, it} from 'vitest';
import {MAPS_DATA} from '../../src/data/geodata';
import {percent} from '../../src/engine/cartography/geometry';
import {
  buildRouteNetwork,
  evaluateBranchFlow,
  routeBranchBias,
  routePathD,
  snapRoutePoint,
} from '../../src/engine/cartography/route-network';
import type {GeometryTrace} from '../../src/types';

describe('Red fluida de rutas y ramales (route-network)', () => {
  const map = MAPS_DATA.cristo; // 500 x 400 m

  it('snaps new route points onto existing route segments to form clean T-junctions', () => {
    const routes: GeometryTrace[] = [
      {
        id: 'r1',
        name: 'Corredor principal',
        width: 4,
        points: [percent([200, 200], map), percent([260, 200], map)],
      },
    ];
    const snap = snapRoutePoint([230, 201.1], routes, map, 1.8);
    expect(snap.snapped).toBe(true);
    expect(snap.point[0]).toBeCloseTo(230, 3);
    expect(snap.point[1]).toBeCloseTo(200, 3);
  });

  it('splits intersecting / T-joined routes into connected branches with junction nodes', () => {
    const routes: GeometryTrace[] = [
      {
        id: 'r1',
        name: 'Eje horizontal',
        width: 4,
        points: [percent([200, 200], map), percent([260, 200], map)],
      },
      {
        id: 'r2',
        name: 'Ramal norte',
        width: 3,
        points: [percent([230, 200], map), percent([230, 170], map)],
      },
    ];
    const net = buildRouteNetwork(routes, map);
    expect(net.junctions).toHaveLength(1);
    expect(net.junctions[0].degree).toBe(3);
    expect(net.edges).toHaveLength(3);
  });

  it('evaluates branch flow objectively based on width, local density and target speed', () => {
    const wideFluid = evaluateBranchFlow({width: 5, length: 20}, 0.5, 0, 1.3);
    const narrowCongested = evaluateBranchFlow({width: 1.5, length: 20}, 0.5, 6, 1.3);
    expect(wideFluid.effectiveSpeed).toBeGreaterThan(narrowCongested.effectiveSpeed);
    expect(wideFluid.costSeconds).toBeLessThan(narrowCongested.costSeconds);

    const routes: GeometryTrace[] = [
      {
        id: 'r1',
        name: 'Ramal amplio',
        width: 5,
        points: [percent([200, 200], map), percent([240, 200], map)],
      },
    ];
    const net = buildRouteNetwork(routes, map);
    const biasFluid = routeBranchBias([220, 200], net, 0, 1.3, 0.5);
    const biasCongested = routeBranchBias([220, 200], net, 12, 1.3, 0.5);
    expect(biasFluid).toBeLessThan(biasCongested);
  });

  it('builds straight or light quadratic Bézier SVG paths while keeping endpoints exact', () => {
    const pts: Array<[number, number]> = [
      [10, 10],
      [30, 10],
      [30, 30],
    ];
    const straight = routePathD(pts, false);
    expect(straight).toBe('M10,10 L30,10 L30,30');

    const curved = routePathD(pts, true, 2);
    expect(curved).toContain('Q30,10');
    expect(curved.startsWith('M10,10 ')).toBe(true);
    expect(curved.endsWith(' L30,30')).toBe(true);
  });
});
