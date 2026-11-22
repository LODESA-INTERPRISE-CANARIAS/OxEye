import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {percent} from '../../src/engine/cartography/geometry';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {phaseScene} from '../../src/engine/logistics/phases';
import {shift} from '../../src/engine/logistics/shift';

describe('Logística Pre/Post: reservas poligonales, camiones escalonados, secuenciación y cuadrillas', () => {
  const map = MAPS_DATA.cristo;

  it('Captura 3 & 4 · recognizes freehand polygon reserves for loading and turning in pre-event shift', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    // Retirar infraestructuras loading/turning antiguas y dejar SOLO polígonos en scene.reserves
    scene.infrastructure = scene.infrastructure.filter(
      (i) => i.kind !== 'loading' && i.kind !== 'turning'
    );
    scene.reserves.push(
      {
        id: 'poly-load',
        name: 'Carga poligonal',
        origin: 'loading',
        points: [
          [40, 40],
          [46, 40],
          [46, 46],
          [40, 46],
        ],
      },
      {
        id: 'poly-turn',
        name: 'Maniobra poligonal',
        origin: 'turning',
        points: [
          [50, 40],
          [58, 40],
          [58, 48],
          [50, 48],
        ],
      }
    );

    const plan = shift(scene, map, 'pre');
    expect(plan.error).toBeUndefined();
    expect(plan.required).toBeGreaterThan(0);
  });

  it('Captura 1 · staggers truck arrivals across a 0-10 min window instead of stacking all trucks at t=0', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    const plan = shift(scene, map, 'pre');
    expect(plan.error).toBeUndefined();

    const firstEntriesByTruck = new Map<string, number>();
    for (const st of plan.stages) {
      if (st.label === 'Entrada' && st.id.startsWith('Camión')) {
        if (!firstEntriesByTruck.has(st.id)) {
          firstEntriesByTruck.set(st.id, st.start);
        }
      }
    }
    const starts = [...firstEntriesByTruck.values()].sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    // No todos arrancan en 0; el escalonamiento está dentro de 600 s (10 min)
    expect(starts[starts.length - 1] - starts[0]).toBeGreaterThanOrEqual(60);
    expect(starts[starts.length - 1] - starts[0]).toBeLessThanOrEqual(600);
  });

  it('Captura 6 + Secuenciación · excludes permanent items and disassembles near-to-far in post-event', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    const gate = scene.entrances[0];
    scene.base.booths = [];
    scene.infrastructure = scene.infrastructure.filter(
      (i) => i.kind === 'loading' || i.kind === 'turning' || i.kind === 'bin'
    );
    // 1 elemento permanente (no debe desmontarse) + 2 carpas (una cerca del acceso, otra al fondo)
    scene.infrastructure.push(
      {
        id: 'perm-1',
        name: 'Quiosco permanente',
        kind: 'cover',
        role: 'cover',
        x: gate.x + 2,
        y: gate.y + 2,
        width: 4,
        depth: 4,
        permanent: true,
        phaseTags: ['pre', 'event', 'post'],
      },
      {
        id: 'tent-near',
        name: 'Carpa delantera',
        kind: 'cover',
        role: 'cover',
        x: gate.x + 4,
        y: gate.y + 4,
        width: 6,
        depth: 6,
        phaseTags: ['pre', 'event', 'post'],
      },
      {
        id: 'tent-far',
        name: 'Carpa fondo',
        kind: 'cover',
        role: 'cover',
        x: gate.x + 25,
        y: gate.y + 25,
        width: 6,
        depth: 6,
        phaseTags: ['pre', 'event', 'post'],
      }
    );

    const postPlan = shift(scene, map, 'post');
    expect(postPlan.error).toBeUndefined();
    const ids = postPlan.schedule.map((t) => t.itemId);
    expect(ids).not.toContain('perm-1');
    expect(ids.indexOf('tent-near')).toBeLessThan(ids.indexOf('tent-far'));
    // Verifica pasos inversos de desmontaje
    expect(postPlan.schedule[0].steps[0]).toBe('Lastrado y fijación');
  });

  it('Capacidad operativa · assigns 1 crew to 3 tents sequentially without overlapping workers', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = scene.infrastructure.filter(
      (i) => i.kind === 'loading' || i.kind === 'turning' || i.kind === 'bin'
    );
    scene.companies = [
      {
        name: 'Cuadrilla Única',
        lead: 'Jefe',
        scope: 'all',
        pre: {people: 3, trucks: 1, forks: 1},
        post: {people: 3, trucks: 1, forks: 1},
      },
    ];
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = percent([210 + i * 10, 200], map);
      scene.infrastructure.push({
        id: `tent-${i + 1}`,
        name: `Carpa ${i + 1}`,
        kind: 'cover',
        role: 'cover',
        x: tx,
        y: ty,
        width: 6,
        depth: 6,
        assemblyMinutes: 15,
        phaseTags: ['pre', 'event', 'post'],
      });
    }

    const plan = shift(scene, map, 'pre');
    expect(plan.error).toBeUndefined();
    expect(plan.schedule).toHaveLength(3);
    // Cada tarea empieza después de terminar la anterior (0 duplicación de cuadrilla)
    expect(plan.schedule[1].start).toBeGreaterThanOrEqual(plan.schedule[0].end);
    expect(plan.schedule[2].start).toBeGreaterThanOrEqual(plan.schedule[1].end);
  });

  it('Captura 5 · resolves fence_breach emergency without hard-blocking via fence move / single-file foot squad', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    const engine = new EventEngine(phaseScene(scene, 'event'));
    engine.emergency = new ResponseSimulation(engine);
    const agent = {id: 999, x: 240, y: 200};
    const row = engine.emergency.injectAtAgent('fence_breach', agent, 'Valla 8');
    expect(row).not.toBeNull();
    for (let i = 0; i < 60; i++) engine.tick(0.5);
    expect(row!.status).not.toBe('blocked');
  });
});
