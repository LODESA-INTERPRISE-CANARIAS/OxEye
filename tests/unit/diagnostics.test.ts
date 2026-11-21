import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {resolveRiskGuide} from '../../src/engine/emergency/risk-guidance';
import {shift} from '../../src/engine/logistics/shift';
import {
  buildPostSimDiagnostics,
  type IncidentCategoryKey,
} from '../../src/engine/experience/post-sim-diagnostics';

describe('Post-Simulation Satisfaction & Guided Diagnostics', () => {
  it('reports 100% satisfaction and zero incidents when a simulation has no friction', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const cleanEngine = {
      agents: [
        {id: 1, completed: 2, failed: 0, experiencePenalty: 0},
        {id: 2, completed: 1, failed: 0, experiencePenalty: 0},
      ],
      stats: {arrivals: 20, served: 18, abandoned: 0, entryBlocked: 0},
      dining: {summary: () => ({meals: 5, seated: 5, standing: 0, wet: 0})},
      experience: {list: () => []},
      complaints: () => [],
      emergency: {events: []},
      stations: [],
    };
    const report = buildPostSimDiagnostics(cleanEngine, scene);
    expect(report.satisfaction.satisfiedPct).toBe(100);
    expect(report.satisfaction.dissatisfiedPct).toBe(0);
    expect(report.totalIncidents).toBe(0);
    expect(report.incidents).toEqual([]);
  });

  it('aggregates all 10 incident categories with graphical shares, explanations, steps, and guided actions', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const foodBooth = scene.base.booths[0];
    scene.base.booths.push({
      id: 'stage-diag',
      name: 'Escenario principal',
      kind: 'stage',
      type: 'stage',
      x: 50,
      y: 50,
      width: 12,
      depth: 8,
      sound: {enabled: true, spl: 96, reference: 5},
    });

    const mockEngine = {
      agents: [
        {id: 1, completed: 2, failed: 0, experiencePenalty: 0}, // Satisfecho
        {id: 2, completed: 0, failed: 0, experiencePenalty: 10}, // Neutral (45)
        {id: 3, completed: 0, failed: 2, experiencePenalty: 35}, // Descontento (0)
      ],
      stats: {arrivals: 100, served: 40, abandoned: 12, entryBlocked: 4},
      dining: {
        summary: () => ({meals: 20, seated: 12, standing: 8, wet: 2}),
      },
      experience: {
        list: () => [
          {
            id: 'E1',
            agentId: 3,
            type: 'queue',
            target: foodBooth.id,
            detail: `${foodBooth.name}: 10 min de cola`,
            point: [200, 200],
            first: 60,
            last: 120,
            status: 'ended',
          },
          {
            id: 'E2',
            agentId: 3,
            type: 'price',
            target: foodBooth.id,
            detail: `${foodBooth.name}: 15 €`,
            point: [200, 200],
            first: 70,
            last: 120,
            status: 'closed',
          },
          {
            id: 'E3',
            agentId: 2,
            type: 'shelter',
            target: null,
            detail: 'Lluvia: 60 s sin refugio',
            point: [210, 210],
            first: 80,
            last: 140,
            status: 'active',
          },
          {
            id: 'E4',
            agentId: 2,
            type: 'sound',
            target: null,
            detail: '92 dB estimados',
            point: [220, 200],
            first: 90,
            last: 140,
            status: 'active',
          },
          {
            id: 'E5',
            agentId: 3,
            type: 'blocked',
            target: foodBooth.id,
            detail: 'Sin avance durante 25 s',
            point: [200, 200],
            first: 95,
            last: 130,
            status: 'active',
          },
          {
            id: 'E6',
            agentId: 3,
            type: 'exit',
            target: null,
            detail: 'No encuentra salida conectada',
            point: [200, 200],
            first: 100,
            last: 150,
            status: 'active',
          },
          {
            id: 'E7',
            agentId: 2,
            type: 'offer',
            target: null,
            detail: 'Sin puestos abiertos de cultura',
            point: [200, 200],
            first: 105,
            last: 150,
            status: 'active',
          },
        ],
      },
      complaints: () => [
        {
          id: 'C1',
          type: 'acceso',
          title: 'Acceso saturado',
          reason: 'Acceso norte bloqueado por cola',
        },
      ],
      emergency: {
        events: [
          {
            id: 1,
            type: 'fire',
            name: 'Incendio en cocina',
            status: 'blocked',
          },
        ],
      },
      stations: [{id: foodBooth.id, name: foodBooth.name, capacity: 2, queue: []}],
    };

    const report = buildPostSimDiagnostics(mockEngine, scene);

    expect(report.satisfaction.totalSampled).toBe(3);
    expect(report.satisfaction.satisfied).toBe(1);
    expect(report.satisfaction.neutral).toBe(1);
    expect(report.satisfaction.dissatisfied).toBe(1);
    expect(
      report.satisfaction.satisfiedPct +
        report.satisfaction.neutralPct +
        report.satisfaction.dissatisfiedPct
    ).toBe(100);

    const expectedKeys: IncidentCategoryKey[] = [
      'queue',
      'price',
      'shelter',
      'sound',
      'blocked',
      'exit',
      'offer',
      'access',
      'dining',
      'emergency',
    ];
    const presentKeys = report.incidents.map((i) => i.key);
    for (const k of expectedKeys) {
      expect(presentKeys).toContain(k);
    }

    // Every card must include plain-language explanation, steps, and at least one actionable button
    for (const card of report.incidents) {
      expect(card.whyItHurts.length).toBeGreaterThan(15);
      expect(card.steps.length).toBeGreaterThan(0);
      expect(card.actions.length).toBeGreaterThan(0);
      expect(card.sharePct).toBeGreaterThan(0);
    }

    // Quick-fix actions are attached to targetable categories
    const priceCard = report.incidents.find((i) => i.key === 'price')!;
    expect(
      priceCard.actions.some(
        (a) => a.kind === 'apply-quick-fix' && a.fixType === 'lower-price'
      )
    ).toBe(true);

    const soundCard = report.incidents.find((i) => i.key === 'sound')!;
    expect(
      soundCard.actions.some(
        (a) => a.kind === 'apply-quick-fix' && a.fixType === 'lower-sound'
      )
    ).toBe(true);
  });

  it('resolves actionable guidance, steps, and buttons for every possible RiskIssue ID', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const sampleIds = [
      'inputs',
      'demand-invalid',
      'wait-invalid',
      'vehicle-capacity-v1',
      'invalid-v1',
      'overbook-v1',
      'pending',
      'medical',
      'security',
      'fire',
      'transfer',
      'entry',
      'exit',
      'gate-fire',
      'gate-ambulance',
      'gate-patrol',
      'extinguisher',
      'wet-ground',
      'demand-sync',
      'seats',
      'area',
      'subsoil-load-stage-1',
      'technical',
      'connection-b1',
      'route-fire',
      'calibration',
      'statistical-load',
      'incident-10',
      'destroyed',
      'evacuation-blocked',
    ];
    for (const id of sampleIds) {
      const guide = resolveRiskGuide(
        {
          id,
          level: 'critical',
          title: 'Test ' + id,
          action:
            id === 'incident-10'
              ? 'La huella no cabe en un estrechamiento o giro del recorrido propuesto.'
              : 'Detalle de prueba',
        },
        scene
      );
      expect(guide.icon.length).toBeGreaterThan(0);
      expect(guide.cause.length).toBeGreaterThan(15);
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.actions.length).toBeGreaterThan(0);
    }

    const subsoilGuide = resolveRiskGuide(
      {
        id: 'subsoil-load-stage-1',
        level: 'critical',
        title: 'Carga pesada',
        action: 'Afecta a columna',
      },
      scene
    );
    expect(subsoilGuide.actions[0].enableXray).toBe(true);
    expect(subsoilGuide.actions[0].itemId).toBe('stage-1');
  });

  it('dispatches security officer to disperse attendees shouting/whistling instead of stalling on occupied start position', () => {
    configure(MAPS_DATA);
    const scene = addResponseExample(
      smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
    );
    const engine = new EventEngine(scene);
    const resp = new ResponseSimulation(engine);
    engine.emergency = resp;
    engine.spawn();
    engine.spawn();

    // Place an agent directly on top of the security officer's position
    const sec = scene.infrastructure.find((r) => r.kind === 'security');
    expect(sec).toBeDefined();
    const secX = (sec!.x * MAPS_DATA.cristo.widthMeters) / 100;
    const secY = (sec!.y * MAPS_DATA.cristo.heightMeters) / 100;
    engine.agents[0].x = secX;
    engine.agents[0].y = secY;

    const ev = resp.inject('conflict');
    expect(ev).not.toBeNull();
    resp.assignResource(ev!);
    expect(ev!.status).toBe('assigned');
    expect(ev!.note).toContain('silbato');
    expect(resp.social.stats.dispersed).toBeGreaterThan(0);
  });

  it('applies custom workDays hours functionally to shift() limit and pending-hours alerts', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.workDays = [
      {
        id: 'pre-1',
        name: 'Montaje escenario',
        kind: 'pre',
        date: '2026-12-18',
        from: '08:00',
        to: '14:00',
        hours: 6,
      },
      {
        id: 'pre-2',
        name: 'Montaje puestos',
        kind: 'pre',
        date: '2026-12-19',
        from: '08:00',
        to: '13:00',
        hours: 5,
      },
      {
        id: 'post-1',
        name: 'Recogida exprés',
        kind: 'post',
        date: '2026-12-21',
        from: '08:00',
        to: '08:30',
        hours: 0.5,
      },
    ];

    const prePlan = shift(scene, map, 'pre');
    expect(prePlan.limit).toBe(11 * 3600);
    expect(prePlan.days).toBe(2);

    const postPlan = shift(scene, map, 'post');
    expect(postPlan.limit).toBe(0.5 * 3600);
    expect(postPlan.days).toBe(1);
    if (postPlan.total > postPlan.limit) {
      expect(
        postPlan.alerts.some((a) => a.includes('Recogida exprés'))
      ).toBe(true);
    }
  });
});
