import {describe, expect, it} from 'vitest';
import {CATALOG} from '../../src/data/catalog';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {cristoAccesses} from '../../src/data/site-reference';
import {cellAt, column, percent, world} from '../../src/engine/cartography/geometry';
import {objectSkin} from '../../src/engine/cartography/object-skin';
import {transformHandles, transformObject} from '../../src/engine/cartography/transform';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {
  configure,
  initialScene,
  validateScene,
} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {eventSchedule} from '../../src/engine/director/director-logic';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {ResponseSimulation, serviceLoad} from '../../src/engine/emergency/response-model';
import {assessRisk, poissonTail, safetyFingerprint} from '../../src/engine/emergency/risk';
import {deferIssue, issueKey, issuePriority, observeIssues} from '../../src/engine/experience/review-memory';
import {demandDefaults, demandPlan} from '../../src/engine/planning/demand';
import {classify, reconcile} from '../../src/engine/planning/inventory';
import {activities, planProgramme} from '../../src/engine/planning/programme';

describe('Cartography & Geometry Engine', () => {
  it('converts column index to spreadsheet-style label', () => {
    expect(column(0)).toBe('A');
    expect(column(25)).toBe('Z');
    expect(column(26)).toBe('AA');
  });

  it('calculates cellAt reference from meter coordinates', () => {
    expect(cellAt([5, 5], 10)).toBe('A1');
    expect(cellAt([15, 25], 10)).toBe('B3');
    expect(cellAt([-5, 10], 10)).toBe('Fuera del plano');
  });

  it('round-trips world and percent coordinates', () => {
    const map = MAPS_DATA.cristo;
    const p: [number, number] = [45, 60];
    const w = world(p, map);
    const back = percent(w, map);
    expect(back[0]).toBeCloseTo(p[0], 5);
    expect(back[1]).toBeCloseTo(p[1], 5);
  });
});

describe('Demand & Inventory Planning', () => {
  it('calculates initial service demand from default inputs', () => {
    const plan = demandPlan(demandDefaults);
    expect(plan.food).toBeGreaterThan(0);
    expect(plan.tables).toBeGreaterThan(0);
    expect(plan.roofs).toBeGreaterThan(0);
    expect(plan.shops).toBeGreaterThan(0);
    expect(plan.toilets).toBeGreaterThan(0);
    expect(plan.occupied).toBe(200);
  });

  it('reconciles inventory quantities and respects the 150-element cap', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    validateScene(scene);

    const all = [
      ...scene.base.booths,
      ...scene.infrastructure,
      ...scene.entrances,
    ];
    const counts = Object.fromEntries(
      Object.keys(CATALOG).map((k) => [
        k,
        all.filter((o) => classify(o) === k).length,
      ])
    );
    counts.picnic = (counts.picnic || 0) + 2;

    const reconciled = reconcile(scene, counts, CATALOG);
    expect(reconciled.added).toBe(2);
    expect(reconciled.removed).toBe(0);
    expect(reconciled.scene.pendingStock?.length).toBe(2);
  });
});

describe('Multi-Agent EventEngine & Schedule', () => {
  it('validates event schedule dates and hours', () => {
    const sched = eventSchedule('2026-12-19', '2026-12-20', '17:00', '22:00');
    expect(sched.eventDays).toBe(2);
    expect(sched.start).toBe(17);
    expect(sched.hours).toBe(5);
  });

  it('initializes EventEngine and advances simulation ticks deterministically', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const engine = new EventEngine(scene);
    expect(engine.g.area).toBeGreaterThan(100);
    expect(engine.entries.length).toBeGreaterThan(0);

    for (let i = 0; i < 40; i++) {
      engine.tick(0.5);
    }
    expect(engine.time).toBeCloseTo(20, 2);
    const snap = engine.snapshot();
    expect(snap.capacity).toBeGreaterThan(0);
  });
});

describe('Reference Edition 21 Functional Modules', () => {
  it('builds smallExample and addResponseExample and passes assessRisk without critical blocks', () => {
    configure(MAPS_DATA);
    const base = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    expect(base.entrances.length).toBe(cristoAccesses(MAPS_DATA.cristo).length);
    const op = addResponseExample(smallExample(base));
    const engine = new EventEngine(op);
    engine.emergency = new ResponseSimulation(engine);
    const risk = assessRisk(op, engine, {routes: true});
    expect(risk.critical.length).toBe(0);
    expect(safetyFingerprint(op).length).toBeGreaterThan(10);
    expect(poissonTail(0, 1)).toBe(0);
    expect(poissonTail(2, 0)).toBeGreaterThan(0.8);
  });

  it('computes objectSkin and transformObject resize and rotation', () => {
    const item = {
      id: 'b1',
      kind: 'food',
      type: 'food',
      x: 50,
      y: 50,
      width: 4,
      depth: 3,
      rotation: 0,
    };
    expect(objectSkin(item, 4, 3)).toContain('class="object-skin"');
    expect(transformHandles(item, MAPS_DATA.cristo, 5)).toContain(
      'class="transform-controls"'
    );
    const rotated = transformObject(
      item,
      MAPS_DATA.cristo,
      [250, 180],
      [270, 200],
      'rotate',
      true
    );
    expect(rotated?.rotation).toBeDefined();
    expect((rotated?.rotation || 0) % 15).toBe(0);

    const resized = transformObject(
      item,
      MAPS_DATA.cristo,
      [252, 201.5],
      [254, 203],
      'se',
      false
    );
    expect(resized?.width).toBeGreaterThan(4);
    expect(resized?.depth).toBeGreaterThan(3);
  });

  it('plans multi-day activity programme within budget', () => {
    configure(MAPS_DATA);
    const scene = addResponseExample(
      smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
    );
    scene.eventDays = 2;
    const res = planProgramme(scene, {
      budget: 2000,
      reserve: 20,
      sessions: 2,
      start: 10,
      finish: 14,
      area: 60,
      items: activities.map((a) => ({...a, enabled: true})),
    });
    expect(res.schedule.length).toBeGreaterThan(0);
    expect(res.spent).toBeLessThanOrEqual(1600);
  });

  it('tracks reviewMemory deferrals and observations and simulates fire/evacuation', () => {
    configure(MAPS_DATA);
    const scene = addResponseExample(
      smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
    );
    const issue = {type: 'queue', target: 'b1', action: 'Ampliar capacidad'};
    deferIssue(scene, issue);
    observeIssues(scene, [issue], 'run-1');
    observeIssues(scene, [issue], 'run-2');
    const mem = scene.reviewMemory?.[issueKey(issue)];
    expect(mem?.count).toBe(1);
    expect(mem?.observedRuns).toBe(2);
    expect(issuePriority(mem)).toBe(2);

    const engine = new EventEngine(scene);
    const resp = new ResponseSimulation(engine);
    engine.emergency = resp;
    const fireEv = resp.inject('fire');
    expect(fireEv).not.toBeNull();
    expect(resp.fire.nodes.size).toBe(1);
    resp.evacuation.order(fireEv, true);
    expect(resp.evacuation.orders.length).toBe(1);
    expect(serviceLoad(resp).length).toBe(5);
  });
});
