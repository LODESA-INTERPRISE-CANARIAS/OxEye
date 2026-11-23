import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {goalChart} from '../../src/engine/director/director-logic';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {assessRisk} from '../../src/engine/emergency/risk';
import {phaseScene} from '../../src/engine/logistics/phases';
import {evaluateBatch} from '../../src/engine/planning/batch';
import {
  buildObjectiveDemandReport,
  demandDefaults,
} from '../../src/engine/planning/demand';
import {redesign} from '../../src/engine/planning/layout';
import {
  convertLegacySmartToObjectives,
  createProjectObjectives,
  NON_NEGOTIABLE_CONSTRAINTS,
  OBJECTIVE_CATALOG,
  syncObjectivesFromAxisChange,
} from '../../src/engine/planning/objectives';
import {activities, planProgramme} from '../../src/engine/planning/programme';

function makeIdenticalBaseScene() {
  configure(MAPS_DATA);
  const map = MAPS_DATA.cristo;
  const raw = initialScene('cristo', map, CARTO_DATA);
  const scene = addResponseExample(smallExample(raw));
  scene.seed = 2026;
  scene.seedMode = 'fixed';
  scene.base.arrivals = 220;
  scene.base.hours = 4;
  scene.demandInputs = {...demandDefaults};
  return {scene, map};
}

describe('SUPER FEATURE · Motor inteligente de objetivos SMART, comportamiento y optimización', () => {
  it('CA 1, 2, 3 & 14 · Models A, B, C on identical Plaza del Cristo produce distinct profiles, radars, demand needs, and activity programmes', () => {
    const {scene: baseScene} = makeIdenticalBaseScene();

    // Modelo A: familias, descanso y accesibilidad
    const sceneA = structuredClone(baseScene);
    sceneA.objectives = createProjectObjectives([
      {id: 'fam_kids_activities', priority: 'essential'},
      {id: 'fam_rest', priority: 'essential'},
      {id: 'acc_routes', priority: 'essential'},
    ]);

    // Modelo B: comercio local, gastronomía y reducción de colas
    const sceneB = structuredClone(baseScene);
    sceneB.objectives = createProjectObjectives([
      {id: 'com_boost_sales', priority: 'essential'},
      {id: 'com_distribute_visitors', priority: 'important'},
      {id: 'gas_eat_seated', priority: 'essential'},
      {
        id: 'gas_reduce_queues',
        priority: 'essential',
        targetValue: 8,
        contexts: ['gastronomy', 'commerce'],
      },
    ]);

    // Modelo C: música, cultura y participación
    const sceneC = structuredClone(baseScene);
    sceneC.objectives = createProjectObjectives([
      {id: 'mus_concerts', priority: 'essential'},
      {id: 'cul_workshops', priority: 'essential'},
      {id: 'cul_participation', priority: 'important'},
    ]);

    expect(OBJECTIVE_CATALOG.length).toBeGreaterThanOrEqual(30);
    expect(sceneA.objectives.profile.radar.family).toBeGreaterThan(
      sceneB.objectives.profile.radar.family
    );
    expect(sceneB.objectives.profile.radar.food).toBeGreaterThan(
      sceneA.objectives.profile.radar.food
    );
    expect(sceneC.objectives.profile.radar.music).toBeGreaterThan(
      sceneB.objectives.profile.radar.music
    );

    // Radar SVG refleja intensidades distintas
    const chartA = goalChart(
      sceneA.objectives.profile.activeAxes,
      sceneA.objectives.profile.radar
    );
    const chartC = goalChart(
      sceneC.objectives.profile.activeAxes,
      sceneC.objectives.profile.radar
    );
    expect(chartA).not.toBe(chartC);

    // Sincronización bidireccional desde «Carácter del evento»
    const synced = syncObjectivesFromAxisChange(
      sceneA.objectives,
      'music',
      true
    );
    expect(synced.profile.radar.music).toBeGreaterThan(0);

    // Calculadora de servicios adapta hipótesis y necesidades sin inyectar cantidades fijas arbitrarias
    const repA = buildObjectiveDemandReport(sceneA, demandDefaults);
    const repB = buildObjectiveDemandReport(sceneB, demandDefaults);
    expect(repA.objectiveNeeds.map((n) => n.objectiveId)).not.toEqual(
      repB.objectiveNeeds.map((n) => n.objectiveId)
    );
    expect(repB.suggestedInputs.shopShare).toBeGreaterThan(
      repA.suggestedInputs.shopShare
    );
    expect(repB.suggestedInputs.foodShare).toBeGreaterThan(
      repA.suggestedInputs.foodShare
    );

    // Programa por días propone sesiones distintas coherentes con cada perfil
    const progOpts = {
      budget: 2000,
      reserve: 10,
      sessions: 3,
      start: 10,
      finish: 14,
      area: 60,
      items: activities.map((a) => ({...a, enabled: true})),
    };
    const progA = planProgramme(sceneA, progOpts);
    const progB = planProgramme(sceneB, progOpts);
    const progC = planProgramme(sceneC, progOpts);
    expect(progA.schedule.map((s) => s.id)).not.toEqual(
      progC.schedule.map((s) => s.id)
    );
    expect(progB.schedule.map((s) => s.id)).not.toEqual(
      progC.schedule.map((s) => s.id)
    );
  });

  it('CA 7, 8 & 13 · same seed & inventory produce distinct simulated agent mixes/behaviors when confirmed hypotheses differ, and stay 100% reproducible', () => {
    const {scene: baseScene} = makeIdenticalBaseScene();

    const sceneA = structuredClone(baseScene);
    sceneA.objectives = createProjectObjectives([
      {id: 'fam_kids_activities', priority: 'essential'},
      {id: 'fam_rest', priority: 'essential'},
      {id: 'acc_rest', priority: 'important'},
    ]);
    sceneA.mix = {...sceneA.objectives.confirmedHypotheses.mix};

    const sceneB = structuredClone(baseScene);
    sceneB.objectives = createProjectObjectives([
      {id: 'com_boost_sales', priority: 'essential'},
      {id: 'com_distribute_visitors', priority: 'essential'},
      {id: 'gas_eat_seated', priority: 'essential'},
    ]);
    sceneB.mix = {...sceneB.objectives.confirmedHypotheses.mix};

    const runShort = (sc: typeof sceneA) => {
      const eng = new EventEngine(phaseScene(sc, 'event'));
      for (let i = 0; i < 400; i++) eng.tick(0.5);
      const commerceVisits = eng.stations
        .filter((st) => st.type === 'commerce')
        .reduce((n, st) => n + st.served + st.queue.length + st.serving.length, 0);
      const profiles = eng.agents.reduce(
        (acc, a) => {
          acc[a.profile] = (acc[a.profile] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      return {commerceVisits, profiles, admitted: eng.stats.admitted};
    };

    const resA1 = runShort(sceneA);
    const resA2 = runShort(sceneA);
    const resB = runShort(sceneB);

    // Misma semilla + mismo modelo => reproducibilidad 100 % idéntica
    expect(resA1).toEqual(resA2);
    // Distintos objetivos confirmados => distinta distribución de perfiles/destinos
    expect(resB.profiles.buyer || 0).toBeGreaterThan(resA1.profiles.buyer || 0);
  });

  it('CA 6 & 10 · redesign adapts spatial layout by objective focus while respecting locked elements and non-negotiable constraints', () => {
    const {scene, map} = makeIdenticalBaseScene();
    const lockedBooth = scene.base.booths[0];
    lockedBooth.locked = true;
    const origX = lockedBooth.x;
    const origY = lockedBooth.y;

    const layoutFamily = redesign(phaseScene(scene, 'event'), map, {
      space: 2.0,
      seed: 2026,
      onlyMove: true,
      strategy: 1,
      objectiveFocus: 'family',
    });
    const layoutGastro = redesign(phaseScene(scene, 'event'), map, {
      space: 2.0,
      seed: 2026,
      onlyMove: true,
      strategy: 1,
      objectiveFocus: 'gastronomy',
    });

    // Ninguna propuesta puede mover un elemento bloqueado
    expect(
      layoutFamily.moves.some((m: {id: string}) => m.id === lockedBooth.id)
    ).toBe(false);
    expect(
      layoutGastro.moves.some((m: {id: string}) => m.id === lockedBooth.id)
    ).toBe(false);
    expect(lockedBooth.x).toBe(origX);
    expect(lockedBooth.y).toBe(origY);

    // Si hay movimientos, las dos estrategias con distinto objectiveFocus difieren
    if (layoutFamily.moves.length && layoutGastro.moves.length) {
      expect(layoutFamily.moves).not.toEqual(layoutGastro.moves);
    }

    // Restricciones no negociables: incluso eligiendo solo economía, bloquear salidas sigue siendo crítico
    const economyScene = structuredClone(scene);
    economyScene.objectives = createProjectObjectives([
      {id: 'eco_reduce_costs', priority: 'essential'},
    ]);
    economyScene.entrances = economyScene.entrances.map((e) => ({
      ...e,
      role: 'closed',
      phases: {event: 'closed'},
    }));
    const risk = assessRisk(economyScene);
    expect(risk.critical.length).toBeGreaterThan(0);
    expect(NON_NEGOTIABLE_CONSTRAINTS.length).toBeGreaterThanOrEqual(4);
  });

  it('CA 9, 14 & 15 · contradictory objectives (Model D) surface explicit trade-offs and generate viable A/B/C alternatives', async () => {
    const {scene, map} = makeIdenticalBaseScene();
    // Modelo D con objetivos en tensión directa
    scene.objectives = createProjectObjectives([
      {id: 'gas_eat_seated', priority: 'essential'},
      {id: 'gas_shelter', priority: 'important'},
      {id: 'acc_routes', priority: 'essential'},
      {id: 'eco_reduce_costs', priority: 'essential'},
      {id: 'log_efficient_setup', priority: 'important'},
    ]);

    expect(scene.objectives.profile.tradeoffs.length).toBeGreaterThanOrEqual(2);

    const rows = await evaluateBatch(
      scene,
      map,
      {
        count: 4,
        minutes: 5,
        rain: false,
        space: 2.0,
        weights: {
          comfort: scene.objectives.profile.comparisonWeights.comfort,
          queues: scene.objectives.profile.comparisonWeights.queues,
          emergency: scene.objectives.profile.comparisonWeights.emergency,
          experience: scene.objectives.profile.comparisonWeights.experience,
        },
      },
      () => {},
      () => false
    );

    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => r.strategyKey === 'spatial_efficiency')).toBe(true);
    expect(rows.some((r) => r.strategyKey === 'visitor_experience')).toBe(true);
    expect(rows.every((r) => typeof r.estimatedCost === 'number')).toBe(true);
    expect(rows.every((r) => typeof r.setupMinutes === 'number')).toBe(true);
    expect(rows.every((r) => !!r.explanation)).toBe(true);
  });

  it('CA 12 · preserves legacy smartGoal texts untouched while assisting conversion to ProjectObjectives', () => {
    const {scene} = makeIdenticalBaseScene();
    delete scene.objectives;
    scene.smartGoal = {
      specific: 'Reducir colas en comida y fomentar comercios locales',
      metric: 'Espera media',
      target: '10 min',
      feasible: 'Inventario actual',
      relevant: 'Visitantes y puestos',
      deadline: '2026-12-20',
    };
    scene.eventGoals = ['food', 'local'];

    const converted = convertLegacySmartToObjectives(scene);
    expect(converted.legacySmartGoal?.specific).toBe(scene.smartGoal.specific);
    expect(converted.selected.some((s) => s.id === 'gas_reduce_queues')).toBe(true);
    expect(converted.selected.some((s) => s.id === 'com_boost_sales')).toBe(true);
    // Conversión asistida no fuerza confirm=true hasta revisión del usuario
    expect(converted.confirmedHypotheses.confirmed).toBe(false);
  });
});
