import {describe, expect, it} from 'vitest';
import {
  addResponseExample,
  buildHourlyAttendancePlan,
  CARTO_DATA,
  configure,
  DailySchedule,
  DecisionEngine,
  EventEngine,
  initialScene,
  MAPS_DATA,
  NeedsEngine,
  phaseScene,
  ResponseSimulation,
  smallExample,
} from '../../src/index';
import type {Agent, Scene} from '../../src/types';

function makeCrowdTestScene(): Scene {
  configure(MAPS_DATA);
  const s = addResponseExample(
    smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
  );
  s.seed = 202611;
  s.autoIncidents = false;
  s.base.hours = 12;
  s.base.start = 10;
  s.base.arrivals = 180;
  // Añadir un segundo foodtruck más lejano, aseos y zona de descanso explícita + personal de asistencia
  const refFood = s.base.booths[0];
  const refShop = s.base.booths[1];
  s.base.booths.push({
    id: 'food-far-2',
    name: 'Foodtruck Norte',
    type: 'food',
    x: refFood.x + 2.2,
    y: refFood.y - 1.5,
    width: 4,
    depth: 3,
    area: 12,
    time: 4,
    simultaneous: 3,
    interest: 1.2,
  });
  s.infrastructure.push(
    {
      id: 'power-point-1',
      name: 'Punto de recarga y cuadro',
      kind: 'power',
      role: 'service',
      x: refShop.x + 0.8,
      y: refShop.y,
      width: 1.5,
      depth: 1.5,
      active: true,
    },
    {
      id: 'rest-zone-1',
      name: 'Zona tranquila y descanso',
      kind: 'rest',
      role: 'rest',
      x: refFood.x - 1.5,
      y: refFood.y + 1.5,
      width: 4,
      depth: 3,
      capacity: 12,
      active: true,
    },
    {
      id: 'steward-team-1',
      name: 'Auxiliares de orientación',
      kind: 'steward',
      role: 'steward',
      x: refFood.x + 0.5,
      y: refFood.y + 0.5,
      width: 1.5,
      depth: 1.5,
      staff: 4,
      patrolRadius: 65,
      active: true,
    }
  );
  return s;
}

describe('Human behavior, dynamic attendance & smart crowd management (Pruebas A-J)', () => {
  it('Prueba A — Jornada completa (10:00–22:00): curva multipico, conservación exacta y reentradas sin duplicar asistentes únicos', () => {
    const s = makeCrowdTestScene();
    s.attendance = {
      uniqueAttendees: 720,
      curveProfile: 'full_day',
      reentryShare: 0.3,
    };
    const plan = buildHourlyAttendancePlan(s);
    expect(plan.hours).toBe(12);
    expect(new Set(plan.hourlyEntries).size).toBeGreaterThan(3);

    const eng = new EventEngine(phaseScene(s, 'event'));
    eng.emergency = new ResponseSimulation(eng);

    // Simular primera parte y salida/reentrada controlada manteniendo conservación exacta
    const a1 = eng.spawn({uniqueVisitorId: 'vis-101'}) as Agent;
    const a2 = eng.spawn({uniqueVisitorId: 'vis-102'}) as Agent;
    expect(a1).toBeTruthy();
    expect(a2).toBeTruthy();
    // Trabajador previo no falsea el aforo de público único
    eng.spawn({populationRole: 'worker', uniqueVisitorId: 'wrk-1'});

    expect(eng.attendance.uniqueAttendeesCount).toBe(2);
    expect(eng.attendance.simultaneousOccupancy).toBe(2);

    // Salida + reentrada de vis-101 no debe crear nuevo asistente único
    if (a1.routine) {
      a1.routine.canReenter = true;
      a1.routine.returnAfterSec = 10;
    }
    eng.depart(a1);
    expect(eng.attendance.simultaneousOccupancy).toBe(1);
    expect(eng.attendance.uniqueAttendeesCount).toBe(2);

    for (let i = 0; i < 30; i++) eng.tick(1);

    // Verificar invariante de conservación en cada paso registrado
    for (const entry of eng.attendance.conservationLog) {
      expect(entry.prev + entry.entries - entry.exits).toBe(entry.next);
    }
    expect(eng.attendance.uniqueAttendeesCount).toBeGreaterThanOrEqual(2);
    const cohorts = eng.attendance.getPopulationCohorts(1200, 300);
    expect(cohorts.activeAgents).toBe(1200);
    expect(cohorts.renderedParticles).toBe(300);
    expect(cohorts.cohortScale).toBe(4);
  });

  it('Prueba B — Hambre y descanso: evolución dinámica de necesidades y elección multicriterio (no siempre el puesto más cercano)', () => {
    const s = makeCrowdTestScene();
    s.attendance = {uniqueAttendees: 200, curveProfile: 'full_day'};
    const eng = new EventEngine(phaseScene(s, 'event'));
    eng.emergency = new ResponseSimulation(eng);

    const agent = eng.spawn() as Agent;
    expect(agent.humanNeeds).toBeDefined();
    expect(agent.personality).toBeDefined();
    expect(agent.routine).toBeDefined();

    // Simular evolución con hambre creciente al mediodía
    const initialHunger = agent.humanNeeds!.hunger;
    for (let t = 0; t < 600; t += 10) {
      NeedsEngine.update(agent, 10, {
        absHour: 13.0,
        weather: 'sun',
        nearStage: false,
        resting: false,
      });
    }
    expect(agent.humanNeeds!.hunger).toBeGreaterThan(initialHunger);

    // Puesto cercano con cola larga vs puesto más lejano sin cola: DecisionEngine compara espera vs distancia
    const foodSt = eng.stations.filter((st) => st.type === 'food');
    expect(foodSt.length).toBeGreaterThanOrEqual(2);
    foodSt[0].queue = Array.from({length: 25}, (_, i) => 5000 + i); // cola saturada ~15+ min
    foodSt[1].queue = [];
    if (agent.personality) {
      agent.personality.waitTolerance = 0.6;
    }
    const chosen = DecisionEngine.selectStationByUtility(
      eng,
      agent,
      foodSt,
      eng.g.index(agent.x, agent.y)
    );
    expect(chosen?.id).toBe(foodSt[1].id);
  });

  it('Prueba C — Grupos sociales: separación temporal en actividades distintas y reencuentro posterior', () => {
    const s = makeCrowdTestScene();
    const eng = new EventEngine(phaseScene(s, 'event'));
    eng.emergency = new ResponseSimulation(eng);

    const m1 = eng.spawn({groupId: 'pre-temp'}) as Agent;
    const m2 = eng.spawn({groupId: 'pre-temp'}) as Agent;
    const m3 = eng.spawn({groupId: 'pre-temp'}) as Agent;
    const grp = eng.socialGroups.createGroup('friends', [m1, m2, m3], [m1.x, m1.y]);

    eng.socialGroups.splitGroupForActivities(grp, eng, 40);
    expect(grp.state).toBe('split');
    expect(m1.persona?.needs[0]).not.toBe(m3.persona?.needs[0]);

    for (let i = 0; i < 90; i++) eng.tick(1);
    expect(['regrouping', 'together', 'departing']).toContain(grp.state);
  });

  it('Prueba D & E — Consulta cotidiana sin emergencia y falsa alarma con flujo comprobación → confirmación', () => {
    const s = makeCrowdTestScene();
    const eng = new EventEngine(phaseScene(s, 'event'));
    eng.emergency = new ResponseSimulation(eng);

    const visitor = eng.spawn() as Agent;
    const eventsBefore = eng.emergency.events.length;
    const qry = eng.everydayInteractions.requestQuery(eng, visitor, 'phone_charge');
    expect(qry.resolved).toBe(true);
    expect(qry.resourceFound).toBe(true);
    expect(eng.emergency.events.length).toBe(eventsBefore); // Nunca crea emergencia

    const fa = eng.falseAlarms.reportSuspectedAlarm(
      eng,
      'vapor_smoke',
      [visitor.x, visitor.y]
    );
    expect(fa.status).toBe('reported');
    for (let i = 0; i < 35; i++) eng.tick(1);
    expect(fa.status).toBe('confirmed_false_alarm');
    expect(fa.verificationSeconds).toBeGreaterThan(0);
    expect(fa.resourcesUsed.length).toBeGreaterThan(0);
  });

  it('Pruebas F, G, H, I & J — Congestión sin intervención, auxiliar con 1..10 visitantes, respuesta variable, efectos secundarios e Inspector', () => {
    const s = makeCrowdTestScene();
    s.crowdBehavior = {
      interventionMode: 'none',
      thresholds: {densityWarn: 0.3, minSpeedMs: 0.9, minDurationSec: 2, minPeople: 5},
    };
    const eng = new EventEngine(phaseScene(s, 'event'));
    eng.emergency = new ResponseSimulation(eng);

    const spot = eng.stations[0];
    const [sx, sy] = [
      ((spot.x || 50) * eng.g.m.widthMeters) / 100,
      ((spot.y || 50) * eng.g.m.heightMeters) / 100,
    ];
    // Formar acumulación persistente de 12 personas junto al puesto sin intervención automática
    const cellPt = eng.g.nearest(sx, sy, 6);
    const basePt = cellPt >= 0 ? eng.g.point(cellPt) : [sx, sy];
    for (let i = 0; i < 12; i++) {
      const a = eng.spawn() as Agent;
      eng.remove(a);
      a.x = basePt[0] + ((i % 3) - 1) * 0.65;
      a.y = basePt[1] + (Math.floor(i / 3) - 1.5) * 0.65;
      a.state = 'queue';
      a.stuck = 5;
      eng.insert(a);
    }

    // Prueba F: detectar congestión sin intervención automática
    for (let i = 0; i < 10; i++) eng.tick(1);
    const activeCongs = [...eng.crowdGuidance.zones.values()].filter(
      (z) => z.status !== 'resolved'
    );
    expect(activeCongs.length).toBeGreaterThanOrEqual(1);
    const z = activeCongs[0];
    expect(z.assignedStewardId).toBeUndefined();

    // Prueba J: estudiar alternativa sin aplicar e inspeccionar indicadores
    const insp = eng.crowdGuidance.buildInspectorData(z.id, eng);
    expect(insp).not.toBeNull();
    expect(insp!.peopleCountLabel).toContain('personas');
    const study = eng.crowdGuidance.studyAlternative(eng, z.id);
    expect(study).not.toBeNull();

    // Pruebas G, H & I: enviar auxiliar manualmente y orientar 1..10 visitantes con efectos secundarios
    const sw = eng.crowdGuidance.dispatchStewardToZone(eng, z.id);
    expect(sw).not.toBeNull();
    // Acercar auxiliar y completar guía colectiva
    if (sw) {
      sw.x = z.point[0] + 1;
      sw.y = z.point[1] + 1;
      sw.busyUntil = 0;
    }
    const guided = eng.crowdGuidance.guideGroupAtZone(eng, sw!, z);
    expect(guided).toBeGreaterThanOrEqual(1);
    expect(guided).toBeLessThanOrEqual(10);
    expect(guided).toBeLessThanOrEqual(z.peopleCount);
    expect(z.acceptedCount + z.hesitatedCount + z.rejectedCount + z.followGroupCount + z.supportRequestCount).toBe(guided);

    const summary = eng.getHumanMetricsSummary();
    expect(summary.congestion.totalGuided).toBeGreaterThanOrEqual(1);
    // Verificar rutina diaria asignada en cualquier horario
    const postWork = DailySchedule.assignRoutine(
      8.5 * 3600,
      12 * 3600,
      10,
      'buyer',
      'full_day',
      () => 0.1,
      60,
      1
    );
    expect(postWork.kind).toBe('post_work');
  });
});
