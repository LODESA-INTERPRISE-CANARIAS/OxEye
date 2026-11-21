import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {
  computeFixedFenceEnd,
  DEFAULT_FENCE_LENGTH,
  fenceChainAnchors,
  fenceMetrics,
  pivotFenceAroundAnchor,
  rotateFenceChainBranch,
  snapAngleDeg,
  snapFencePoint,
  translateFenceChain,
  updateFenceGeometry,
} from '../../src/engine/cartography/fences';
import {percent} from '../../src/engine/cartography/geometry';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {buildGrid, flow} from '../../src/engine/crowd/grid-flow';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {buildPostSimDiagnostics} from '../../src/engine/experience/post-sim-diagnostics';
import {createDefaultProject, parseImportedProject} from '../../src/db/repository';
import type {GeometryTrace, Point2D, Scene} from '../../src/types';

describe('Vallas (geometría, imán, barrera continua y rebeldes)', () => {
  it('calcula largo fijo, ajuste a 15° con Shift, imán a 0,5 m y edición de largo/ángulo', () => {
    const map = MAPS_DATA.cristo;
    expect(DEFAULT_FENCE_LENGTH).toBe(3.5);
    expect(snapAngleDeg(22, true)).toBe(15);
    expect(snapAngleDeg(23, true)).toBe(30);
    expect(snapAngleDeg(22, false)).toBe(22);

    const existing: GeometryTrace[] = [
      {
        id: 'f-1',
        name: 'Valla 1',
        points: [percent([100, 100], map), percent([103.5, 100], map)],
        fenceKind: 'chain',
      },
    ];

    // Imán a extremo dentro de 0,5 m
    const snappedEnd = snapFencePoint([103.7, 100.2], existing, map);
    expect(snappedEnd.snapped).toBe(true);
    expect(snappedEnd.snapKind).toBe('endpoint');
    expect(snappedEnd.point[0]).toBeCloseTo(103.5, 2);
    expect(snappedEnd.point[1]).toBeCloseTo(100, 2);

    // Imán a tramo dentro de 0,5 m
    const snappedSeg = snapFencePoint([101.8, 100.3], existing, map);
    expect(snappedSeg.snapped).toBe(true);
    expect(snappedSeg.snapKind).toBe('segment');
    expect(snappedSeg.point[1]).toBeCloseTo(100, 2);

    // Fuera de radio (> 0,5 m) no engancha
    const noSnap = snapFencePoint([101.8, 101.2], existing, map);
    expect(noSnap.snapped).toBe(false);

    // Largo fijo y Shift a 15°
    const fixed = computeFixedFenceEnd(
      [103.5, 100],
      [110, 102],
      3.5,
      true,
      existing,
      map
    );
    expect(fixed.angleDeg).toBe(15);
    expect(Math.hypot(fixed.end[0] - 103.5, fixed.end[1] - 100)).toBeCloseTo(3.5, 2);

    // Edición de largo y ángulo en el Inspector
    const updatedPts = updateFenceGeometry(existing[0], map, {
      length: 5,
      angleDeg: 90,
    });
    const metrics = fenceMetrics({...existing[0], points: updatedPts}, map);
    expect(metrics.length).toBeCloseTo(5, 1);
    expect(Math.round(metrics.angleDeg)).toBe(90);
  });

  it('forma una barrera continua sin huecos en buildGrid cuando las vallas se tocan o solapan', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const s = initialScene('cristo', map, CARTO_DATA);
    s.base.booths = [];
    s.infrastructure = [];
    s.reserves = [];
    // Perímetro cuadrado limpio [100..140] x [100..140] m
    s.boundary = [
      percent([100, 100], map),
      percent([140, 100], map),
      percent([140, 140], map),
      percent([100, 140], map),
    ];
    // Cadena de vallas de 3,5 m cruzando de lado a lado en y = 120 m (tocándose extremo con extremo)
    s.fences = [];
    for (let x = 99; x < 141; x += 3.5) {
      s.fences.push({
        id: `chain-${x}`,
        name: `Valla ${x}`,
        points: [percent([x, 120], map), percent([x + 3.5, 120], map)],
        fenceKind: 'chain',
        chainId: 'chain-1',
      });
    }

    const g = buildGrid(s, 0.75);
    const northCell = g.nearest(120, 110, 4);
    const southCell = g.nearest(120, 130, 4);
    expect(northCell).toBeGreaterThanOrEqual(0);
    expect(southCell).toBeGreaterThanOrEqual(0);

    // Con la barrera continua, el lado sur es completamente inalcanzable desde el norte
    const f = flow(g, southCell);
    expect(f[northCell]).toBe(-1);

    // En modo ignoreFences (usado perezosamente solo para rebeldes), sí hay camino
    const gRebel = buildGrid(s, 0.75, {ignoreFences: true});
    const fRebel = flow(gRebel, southCell);
    expect(fRebel[northCell]).toBeGreaterThan(0);
  });

  it('asigna rebeldes de forma determinista con la semilla, respeta rebelShare=0 y genera incidencias al cruzar', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const makeSplitScene = (rebelShare: number): Scene => {
      const s = initialScene('cristo', map, CARTO_DATA);
      s.seed = 4242;
      s.rebelShare = rebelShare;
      s.mix = {foodie: 100, buyer: 0, culture: 0, music: 0, walker: 0};
      s.base.arrivals = 1800;
      s.base.booths = [
        {
          id: 'booth-south',
          name: 'Puesto Sur',
          type: 'food',
          x: percent([120, 132], map)[0],
          y: percent([120, 132], map)[1],
          width: 3,
          depth: 2,
          area: 6,
          simultaneous: 6,
          time: 2,
          interest: 5,
          open: 0,
          close: 12,
        },
      ];
      s.infrastructure = [
        {
          id: 'sec-1',
          name: 'Seguridad Norte',
          kind: 'security',
          role: 'emergency',
          x: percent([112, 108], map)[0],
          y: percent([112, 108], map)[1],
          width: 3,
          depth: 3,
          capacity: 2,
          staff: 4,
          delay: 5,
          handling: 30,
          active: true,
        },
      ];
      s.reserves = [];
      s.boundary = [
        percent([100, 100], map),
        percent([140, 100], map),
        percent([140, 140], map),
        percent([100, 140], map),
      ];
      s.entrances = [
        {
          id: 'gate-north',
          name: 'Acceso Norte',
          x: percent([120, 104], map)[0],
          y: percent([120, 104], map)[1],
          clearWidth: 5,
          role: 'both',
          phases: {event: 'both'},
          spawnType: 'pedestrian',
        },
      ];
      // Barrera continua en y = 118 m entre acceso norte y puesto sur
      s.fences = [];
      for (let x = 99; x < 141; x += 3.5) {
        s.fences.push({
          id: `f-${x}`,
          name: `Valla ${x}`,
          points: [percent([x, 118], map), percent([x + 3.5, 118], map)],
          fenceKind: 'chain',
          chainId: 'c1',
        });
      }
      return s;
    };

    // 1. Con rebelShare = 0 nadie es rebelde ni cruza vallas
    const engZero = new EventEngine(makeSplitScene(0));
    engZero.emergency = new ResponseSimulation(engZero);
    for (let i = 0; i < 120; i++) engZero.tick(0.5);
    expect(engZero.agents.some((a) => a.rebel)).toBe(false);
    expect(engZero.stats.fenceBreaches).toBe(0);
    expect(
      engZero.emergency.events.filter((ev) => ev.type === 'fence_breach')
    ).toHaveLength(0);

    // 2. Determinismo con la misma semilla (rebelShare = 0.25 para muestra rápida en test)
    const runWithSeed = () => {
      const eng = new EventEngine(makeSplitScene(0.25));
      eng.emergency = new ResponseSimulation(eng);
      for (let i = 0; i < 180; i++) eng.tick(0.5);
      return eng;
    };
    const engA = runWithSeed();
    const engB = runWithSeed();
    expect(engA.agents.map((a) => !!a.rebel)).toEqual(
      engB.agents.map((a) => !!a.rebel)
    );
    expect(engA.stats.fenceBreaches).toBe(engB.stats.fenceBreaches);
    expect(engA.stats.fenceBreaches).toBeGreaterThan(0);

    // 3. Incidencia de seguridad generada y reflejada en el diagnóstico post-simulación
    const breachEvents = engA.emergency.events.filter(
      (ev) => ev.type === 'fence_breach'
    );
    expect(breachEvents.length).toBeGreaterThan(0);
    const diag = buildPostSimDiagnostics(engA, engA.s);
    const breachCard = diag.incidents.find((c) => c.key === 'fence_breach');
    expect(breachCard).toBeDefined();
    expect(breachCard?.label).toBe('Intentos de saltar vallas');
  });

  it('conserva las vallas encadenadas, sueltas y rebelShare al exportar e importar JSON', () => {
    const proj = createDefaultProject();
    proj.scenes.cristo.rebelShare = 0.02;
    proj.scenes.cristo.fences.push({
      id: 'loose-1',
      name: 'Valla guía',
      points: [
        [40, 40] as Point2D,
        [42, 40] as Point2D,
      ],
      fenceKind: 'loose',
      phaseTags: ['event'],
    });
    const imported = parseImportedProject(
      JSON.stringify(proj),
      proj,
      MAPS_DATA
    );
    expect(imported.scenes.cristo.rebelShare).toBe(0.02);
    const loose = imported.scenes.cristo.fences.find((f) => f.id === 'loose-1');
    expect(loose?.fenceKind).toBe('loose');
  });

  it('restringe el movimiento de vallas encadenadas a rotación alrededor de su anclaje', () => {
    const map = MAPS_DATA.cristo;
    const f1: GeometryTrace = {
      id: 'c-1',
      name: 'Valla 1',
      points: [percent([100, 100], map), percent([103.5, 100], map)],
      fenceKind: 'chain',
      chainId: 'chain-a',
    };
    const f2: GeometryTrace = {
      id: 'c-2',
      name: 'Valla 2',
      points: [percent([103.5, 100], map), percent([107, 100], map)],
      fenceKind: 'chain',
      chainId: 'chain-a',
    };
    const f3: GeometryTrace = {
      id: 'c-3',
      name: 'Valla 3',
      points: [percent([107, 100], map), percent([110.5, 100], map)],
      fenceKind: 'chain',
      chainId: 'chain-a',
    };
    const chain = [f1, f2, f3];

    // Tramo borde izquierdo: anclado solo en B (103.5, 100)
    const a1 = fenceChainAnchors(f1, chain, map);
    expect(a1).toEqual({anchorA: false, anchorB: true});

    // Tramo intermedio: anclado en A y B
    const a2 = fenceChainAnchors(f2, chain, map);
    expect(a2).toEqual({anchorA: true, anchorB: true});
    const unchanged = updateFenceGeometry(f2, map, {angleDeg: 45}, a2);
    expect(unchanged).toEqual(f2.points);

    // Tramo borde derecho: anclado solo en A (107, 100) -> pivota manteniendo A fijo y largo 3.5 m
    const a3 = fenceChainAnchors(f3, chain, map);
    expect(a3).toEqual({anchorA: true, anchorB: false});
    const pivoted = pivotFenceAroundAnchor(f3, map, [107, 115], 'a', false);
    const pm = fenceMetrics({...f3, points: pivoted}, map);
    expect(pm.a[0]).toBeCloseTo(107, 2);
    expect(pm.a[1]).toBeCloseTo(100, 2);
    expect(pm.b[0]).toBeCloseTo(107, 2);
    expect(pm.b[1]).toBeCloseTo(103.5, 2);
    expect(pm.length).toBeCloseTo(3.5, 2);

    // Rotar el extremo B de la valla intermedia f2 (90° hacia abajo) arrastra también a f3, manteniendo f1 fija
    const branchRot = rotateFenceChainBranch(
      chain,
      'c-2',
      'b',
      map,
      [103.5, 115],
      false
    );
    expect(branchRot.has('c-1')).toBe(false);
    expect(branchRot.has('c-2')).toBe(true);
    expect(branchRot.has('c-3')).toBe(true);
    const f2Rot = fenceMetrics({...f2, points: branchRot.get('c-2')!}, map);
    const f3Rot = fenceMetrics({...f3, points: branchRot.get('c-3')!}, map);
    expect(f2Rot.a[0]).toBeCloseTo(103.5, 2);
    expect(f2Rot.a[1]).toBeCloseTo(100, 2);
    expect(f2Rot.b[0]).toBeCloseTo(103.5, 2);
    expect(f2Rot.b[1]).toBeCloseTo(103.5, 2);
    expect(f3Rot.a[0]).toBeCloseTo(103.5, 2);
    expect(f3Rot.a[1]).toBeCloseTo(103.5, 2);
    expect(f3Rot.b[0]).toBeCloseTo(103.5, 2);
    expect(f3Rot.b[1]).toBeCloseTo(107, 2);

    // Arrastrar el cuerpo de cualquier valla traslada toda la cadena junta manteniendo su forma
    const movedAll = translateFenceChain(chain, 'c-2', map, 10, -5);
    expect(movedAll.size).toBe(3);
    const f1Mov = fenceMetrics({...f1, points: movedAll.get('c-1')!}, map);
    const f3Mov = fenceMetrics({...f3, points: movedAll.get('c-3')!}, map);
    expect(f1Mov.a[0]).toBeCloseTo(110, 2);
    expect(f1Mov.a[1]).toBeCloseTo(95, 2);
    expect(f3Mov.b[0]).toBeCloseTo(120.5, 2);
    expect(f3Mov.b[1]).toBeCloseTo(95, 2);
  });
});
