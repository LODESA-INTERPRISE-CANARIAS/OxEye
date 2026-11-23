import {describe, expect, it} from 'vitest';
import {
  addResponseExample,
  CARTO_DATA,
  compareFireDesignScenarios,
  configure,
  EventEngine,
  getCombustibilityProfile,
  getContextualIncidentsForItem,
  incidentFrequencyStats,
  initialScene,
  MAPS_DATA,
  phaseScene,
  ResponseSimulation,
  smallExample,
} from '../../src/index';
import type {Scene} from '../../src/types';

function makeBaseTestScene(): Scene {
  configure(MAPS_DATA);
  const s = addResponseExample(
    smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
  );
  s.seed = 4242;
  s.autoIncidents = false;
  s.incidentMode = 'manual';
  s.trained = false;
  // Asegurar acceso vehicular amplio para camiones de bomberos
  s.entrances = s.entrances.map((e, idx) =>
    idx === 0
      ? {
          ...e,
          role: 'free',
          clearWidth: 6,
          spawnType: 'mixed' as const,
          recommendedAuthorities: [
            'foot' as const,
            'light_stretchers' as const,
            'passenger_vehicles' as const,
            'heavy_trucks' as const,
          ],
          phases: {setup: 'free', event: 'free', strike: 'free'},
        }
      : e
  );
  return s;
}

describe('Contextual incidents & multi-focus fire propagation (Super Feature)', () => {
  it('generates compatible contextual catalogs per real element properties and protects Punto Violeta privacy', () => {
    const s = makeBaseTestScene();
    const ceramicWorkshop = {
      id: 'ws-ceram-1',
      name: 'Taller de cerámica',
      type: 'workshop',
      x: 40,
      y: 45,
      width: 4,
      depth: 4,
    };
    const ftWithGas = {
      id: 'ft-gas-1',
      name: 'Foodtruck 01',
      type: 'food',
      x: 45,
      y: 45,
      width: 4,
      depth: 3,
      hasGas: true,
    };
    const ftColdNoGas = {
      id: 'ft-cold-2',
      name: 'Foodtruck Helados',
      type: 'food',
      x: 50,
      y: 45,
      width: 4,
      depth: 3,
      hasGas: false,
    };
    const toilet = {
      id: 'wc-1',
      name: 'Aseos portátiles',
      kind: 'toilet',
      x: 55,
      y: 45,
      width: 3,
      depth: 2,
    };
    const violet = {
      id: 'vio-1',
      name: 'Punto Violeta',
      kind: 'violet_point',
      x: 60,
      y: 45,
      width: 3,
      depth: 3,
    };
    const yellow = {
      id: 'acc-1',
      name: 'Carpa Amarilla',
      kind: 'yellow_tent',
      x: 65,
      y: 45,
      width: 3,
      depth: 3,
    };

    const ceramOpts = getContextualIncidentsForItem(ceramicWorkshop, s);
    expect(ceramOpts.some((t) => t.id === 'ceramic_cut')).toBe(true);
    expect(ceramOpts.some((t) => t.id === 'foodtruck_gas_leak')).toBe(false);

    const ftGasOpts = getContextualIncidentsForItem(ftWithGas, s);
    const ftColdOpts = getContextualIncidentsForItem(ftColdNoGas, s);
    expect(ftGasOpts.some((t) => t.id === 'foodtruck_gas_leak')).toBe(true);
    expect(ftColdOpts.some((t) => t.id === 'foodtruck_gas_leak')).toBe(false);

    const wcOpts = getContextualIncidentsForItem(toilet, s);
    expect(wcOpts.some((t) => t.id === 'toilet_wet_slip')).toBe(true);
    expect(wcOpts.some((t) => t.engineType === 'fire')).toBe(false);

    const vioOpts = getContextualIncidentsForItem(violet, s);
    expect(vioOpts.length).toBeGreaterThanOrEqual(5);
    expect(vioOpts.every((t) => t.sensitive === true)).toBe(true);

    const accOpts = getContextualIncidentsForItem(yellow, s);
    expect(accOpts.some((t) => t.id === 'acc_wheelchair_loan')).toBe(true);
  });

  it('supports auto/manual/mixed modes, scheduled triggers, and excludes manual incidents from spontaneous rate stats', () => {
    const s = makeBaseTestScene();
    const target = s.base.booths[0];
    s.incidentMode = 'manual';
    s.autoIncidents = false;

    const eng = new EventEngine(phaseScene(s, 'event'));
    const sim = new ResponseSimulation(eng);
    eng.emergency = sim;

    const manualEv = sim.triggerContextualIncident(target.id, 'commerce_trip', {
      severity: 'moderada',
      originMode: 'manual',
    });
    expect(manualEv).not.toBeNull();
    expect(manualEv?.originMode).toBe('manual');

    sim.scheduleIncident({
      targetId: target.id,
      targetName: target.name,
      templateId: 'commerce_merch_fall',
      incidentType: 'obstacle',
      label: 'Caída de mercancía',
      severity: 'leve',
      trigger: 'after_delay',
      delaySec: 12,
    });

    for (let i = 0; i < 40; i++) eng.tick(1);

    const stats = incidentFrequencyStats(sim.events);
    expect(stats.spontaneous).toBe(0);
    expect(stats.manual).toBe(2);
    expect(sim.scheduledIncidents[0].executed).toBe(true);
  });

  it('separates combustion vs safety perimeter, does not ignite non-combustible objects, and evaluates threats on Carpa Amarilla & Punto Violeta without auto-igniting them', () => {
    const s = makeBaseTestScene();
    const refFood = s.base.booths[0];
    const ax = refFood.x;
    const ay = refFood.y;
    s.base.booths = [
      {
        id: 'ft-01',
        name: 'Foodtruck 01',
        type: 'food',
        x: ax,
        y: ay,
        width: 4,
        depth: 3,
      },
    ];
    // Colocar aseo, Carpa Amarilla y Punto Violeta dentro del radio de seguridad (~5–6 m; mapa 500x400 m)
    s.infrastructure.push(
      {
        id: 'wc-near',
        name: 'Aseos cercanos',
        kind: 'toilet',
        role: 'service',
        x: ax + 1.0,
        y: ay,
        width: 2.5,
        depth: 2.5,
        active: true,
      },
      {
        id: 'yt-near',
        name: 'Carpa Amarilla',
        kind: 'yellow_tent',
        role: 'emergency',
        x: ax,
        y: ay + 1.3,
        width: 3,
        depth: 3,
        staff: 2,
        capacity: 2,
        active: true,
      },
      {
        id: 'vp-near',
        name: 'Punto Violeta',
        kind: 'violet_point',
        role: 'emergency',
        x: ax - 1.1,
        y: ay,
        width: 3,
        depth: 3,
        staff: 2,
        capacity: 2,
        active: true,
      }
    );
    // Quitar bomberos para observar propagación/evaluación sin extinción inmediata
    s.infrastructure = s.infrastructure.filter((r) => r.kind !== 'fire');
    s.fireSpreadSeconds = 20;
    s.fireSpreadGap = 6;

    const eng = new EventEngine(phaseScene(s, 'event'));
    const sim = new ResponseSimulation(eng);
    eng.emergency = sim;

    expect(getCombustibilityProfile(s.infrastructure.find((i) => i.id === 'wc-near')).combustible).toBe(false);

    const row = sim.triggerContextualIncident('ft-01', 'foodtruck_kitchen_fire', {
      severity: 'critica',
      immediateDetect: true,
    })!;
    const node0 = sim.fire.nodes.get('ft-01')!;
    expect(node0.stage).toBe('conato');
    expect(node0.combustionRadius).toBeLessThan(node0.safetyRadius);
    expect(node0.blockedFootprintCells.length).toBeGreaterThan(0);

    for (let i = 0; i < 65; i++) eng.tick(1);

    // El aseo jamás debe incendiarse por exposición pasiva
    expect(sim.fire.nodes.has('wc-near')).toBe(false);
    // Carpa Amarilla y Punto Violeta evalúan amenaza sin incendiarse automáticamente
    expect(sim.fire.serviceThreats.some((t) => t.serviceId === 'yt-near')).toBe(true);
    expect(sim.fire.serviceThreats.some((t) => t.serviceId === 'vp-near')).toBe(true);
    // Sin camiones configurados, no fabrica vehículos falsos y registra limitación explícita
    expect(s.infrastructure.some((r) => r.id.startsWith('ext-fire-'))).toBe(false);
    expect(row.resourceLimitation).toBeTruthy();
  });

  it('mandatory validation (Section 17): Foodtruck 01 + Carpa 02 + Comercio 03 — Trial A spread vs Trial B spacing vs Trial C rapid control', () => {
    const buildLayout = (gapPxX: number) => {
      const s = makeBaseTestScene();
      const refFood = s.base.booths[0];
      const ax = refFood.x;
      const ay = refFood.y;
      s.base.booths = [
        {
          id: 'ft-01',
          name: 'Foodtruck 01',
          type: 'food',
          x: ax,
          y: ay,
          width: 4,
          depth: 3,
          hasGas: true,
        },
        {
          id: 'com-03',
          name: 'Comercio 03',
          type: 'commerce',
          x: ax + gapPxX * 2,
          y: ay,
          width: 4,
          depth: 3,
        },
      ];
      s.infrastructure.push({
        id: 'carpa-02',
        name: 'Carpa 02',
        kind: 'cover',
        role: 'cover',
        x: ax + gapPxX,
        y: ay,
        width: 4,
        depth: 4,
        active: true,
      });
      // Eliminar bomberos automáticos cercanos en A/B para verificar propagación determinista A vs B
      s.infrastructure = s.infrastructure.filter((r) => r.kind !== 'fire');
      return s;
    };

    // Ensayo A: disposición próxima (1% de 500 m = 5 m entre centros -> ~1 m gap borde-borde)
    const sceneA = buildLayout(1.0);
    // Ensayo B: mayor separación (2.8% de 500 m = 14 m entre centros -> ~10 m gap)
    const sceneB = buildLayout(2.8);

    const comparison = compareFireDesignScenarios(sceneA, sceneB, {
      seed: 9001,
      targetBoothId: 'ft-01',
      templateId: 'foodtruck_kitchen_fire',
      durationSec: 220,
      stepSec: 2,
      fireSpreadSeconds: 20,
      fireSpreadGap: 4.5,
      weather: 'wind',
      labelA: 'Ensayo A (próximo)',
      labelB: 'Ensayo B (separado)',
    });

    expect(comparison.designA.focusCount).toBeGreaterThanOrEqual(2);
    expect(comparison.designA.spreadChain.some((c) => c.includes('SPREAD'))).toBe(true);
    expect(comparison.designB.focusCount).toBe(1);
    expect(comparison.deltaFocusCount).toBeLessThan(0);

    // Ensayo independiente adicional sobre extinción selectiva y persistencia de exclusión
    const sceneIndep = buildLayout(1.0);
    sceneIndep.fireSpreadSeconds = 20;
    sceneIndep.fireSpreadGap = 4.5;
    const engIndep = new EventEngine(phaseScene(sceneIndep, 'event'));
    const simIndep = new ResponseSimulation(engIndep);
    engIndep.emergency = simIndep;
    const f1 = simIndep.triggerContextualIncident('ft-01', 'foodtruck_kitchen_fire', {
      severity: 'critica',
      immediateDetect: true,
    })!;
    for (let i = 0; i < 80; i++) engIndep.tick(1);
    const f2 = simIndep.events.find((e) => e.parentIncidentId === f1.id);
    expect(f2).toBeDefined();

    // Extinguir foco 1 NO apaga el foco secundario 2 ni libera su zona caliente inmediatamente
    simIndep.resolve(f1);
    expect(simIndep.fire.nodes.get('ft-01')?.burning).toBe(false);
    expect(simIndep.fire.nodes.get('carpa-02')?.burning).toBe(true);
    expect(simIndep.fire.isClosed('ft-01')).toBe(true);

    // Ensayo C: misma disposición próxima que A, pero con equipo entrenado + extintor cercano para respuesta inicial rápida
    const sceneC = buildLayout(1.0);
    sceneC.trained = true;
    sceneC.fireSuccess = 100;
    sceneC.localExtinguishSeconds = 12;
    sceneC.fireSpreadSeconds = 40;
    sceneC.fireSpreadGap = 4.5;
    const ftC = sceneC.base.booths[0];
    sceneC.infrastructure.push({
      id: 'ext-fast-c',
      name: 'Extintor cocina',
      kind: 'extinguisher',
      role: 'safety',
      x: ftC.x - 0.5,
      y: ftC.y + 0.8,
      width: 0.6,
      depth: 0.6,
      active: true,
    });
    const engC = new EventEngine(phaseScene(sceneC, 'event'));
    const simC = new ResponseSimulation(engC);
    engC.emergency = simC;
    const fc = simC.triggerContextualIncident('ft-01', 'foodtruck_kitchen_fire', {
      severity: 'critica',
      immediateDetect: true,
    })!;
    for (let i = 0; i < 90; i++) engC.tick(1);

    expect(fc.status).toBe('resolved');
    expect(simC.events.filter((ev) => ev.type === 'fire').length).toBe(1);
  });
});
