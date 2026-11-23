import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {inside, world} from '../../src/engine/cartography/geometry';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {phaseScene} from '../../src/engine/logistics/phases';

describe('FEATURE · Sistema de despacho, patrullaje y despliegue de vehículos de emergencia', () => {
  it('CA 1 & 11 · reserve ambulance stays parked without incidents and VehicleManager never spawns random emergency traffic', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.autoIncidents = false;
    scene.entrances.push({
      id: 'base-emg-1',
      name: 'Base emergencias exterior',
      x: 20,
      y: 25,
      role: 'both',
      clearWidth: 6,
      spawnType: 'vehicle',
      externalBase: true,
      vehicleCategory: 'emergency',
      phases: {event: 'both'},
    });
    scene.infrastructure.push({
      id: 'amb-reserve-1',
      name: 'Ambulancia Reserva 1',
      kind: 'ambulance',
      role: 'emergency',
      x: 20,
      y: 25,
      width: 2.5,
      depth: 6,
      staff: 2,
      crewCapacity: 2,
      capacity: 1,
      active: true,
      operationalMode: 'reserve',
      homeBaseId: 'base-emg-1',
      availableForReinforcement: true,
      phaseTags: ['event'],
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const sim = new ResponseSimulation(engine);
    engine.emergency = sim;
    const amb = sim.fleet.units.find(
      (u) => u.resourceId === 'amb-reserve-1'
    )!;
    expect(amb).toBeDefined();
    const startPos = [...amb.currentPosition];

    for (let i = 0; i < 200; i++) {
      engine.tick(0.5);
    }

    // Permanece estacionada en su base sin moverse ni entrar al recinto
    expect(amb.vehicleStatus).toBe('parked');
    expect(amb.available).toBe(true);
    expect(amb.currentPosition).toEqual(startPos);
    // VehicleManager nunca debe generar tráfico aleatorio (ni emergencias ni logística/ordinarios) durante el Evento
    expect(engine.vehicleManager.vehicles).toHaveLength(0);
  });

  it('CA 2 · exterior patrol circulates on exterior roads without crossing inside the event perimeter', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.autoIncidents = false;
    // Ruta exterior explícita fuera del perímetro de la plaza
    scene.roadPlans.push({
      id: 'patrol-ext-route-1',
      name: 'Ronda exterior norte',
      width: 5,
      points: [
        [10, 12],
        [30, 12],
        [50, 12],
      ],
    });
    scene.infrastructure.push({
      id: 'patrol-ext-1',
      name: 'Patrulla Exterior 1',
      kind: 'patrol',
      role: 'emergency',
      x: 10,
      y: 12,
      width: 1.9,
      depth: 4.6,
      staff: 2,
      crewCapacity: 2,
      capacity: 1,
      active: true,
      operationalMode: 'exterior_patrol',
      patrolRouteId: 'patrol-ext-route-1',
      availableForReinforcement: true,
      phaseTags: ['event'],
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const sim = new ResponseSimulation(engine);
    engine.emergency = sim;
    const boundaryMeters = scene.boundary.map((p) => world(p, map));
    const unit = sim.fleet.units.find(
      (u) => u.resourceId === 'patrol-ext-1'
    )!;
    expect(unit.vehicleStatus).toBe('patrolling');
    const initialX = unit.currentPosition[0];

    for (let i = 0; i < 80; i++) {
      engine.tick(0.5);
      expect(inside(unit.currentPosition, boundaryMeters)).toBe(false);
    }
    expect(Math.abs(unit.currentPosition[0] - initialX)).toBeGreaterThan(2);
    expect(unit.vehicleStatus).toBe('patrolling');
  });

  it('CA 3 · mild medical incident is handled by on-foot medical staff without mobilizing reserve ambulance', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.autoIncidents = false;
    scene.responseMode = 'firstaid';
    scene.infrastructure.push({
      id: 'med-onsite-1',
      name: 'Sanitarios en recinto',
      kind: 'medical',
      role: 'emergency',
      x: 48,
      y: 50,
      width: 3,
      depth: 3,
      staff: 2,
      capacity: 2,
      delay: 1,
      handling: 15,
      active: true,
      phaseTags: ['event'],
    });
    scene.infrastructure.push({
      id: 'amb-reserve-2',
      name: 'Ambulancia Reserva 2',
      kind: 'ambulance',
      role: 'emergency',
      x: 18,
      y: 22,
      width: 2.5,
      depth: 6,
      staff: 2,
      crewCapacity: 2,
      capacity: 1,
      active: true,
      operationalMode: 'reserve',
      availableForReinforcement: true,
      phaseTags: ['event'],
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const sim = new ResponseSimulation(engine);
    engine.emergency = sim;
    const row = sim.inject('minor');
    expect(row).not.toBeNull();
    row!.reportedAt = 0;
    row!.status = 'pending';

    for (let i = 0; i < 40; i++) {
      engine.tick(0.5);
    }

    const amb = sim.fleet.units.find(
      (u) => u.resourceId === 'amb-reserve-2'
    )!;
    // La ambulancia en reserva NO debe haberse movilizado para un malestar leve con sanitarios en recinto
    expect(amb.vehicleStatus).toBe('parked');
    expect(amb.assignedIncidentId).toBeNull();
    expect(row!.resourceId).toBe('med-onsite-1');
  });

  it('CA 4-10 · ambulance dispatches from real base without duplicates, deploys crew on foot, waits until crew returns, evacuates, and returns to base with full timestamps', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.autoIncidents = false;
    scene.responseMode = 'ambulance';
    // Hacer todas las puertas exclusivamente peatonales para forzar estacionamiento exterior + desembarco a pie
    scene.entrances = scene.entrances.map((e) => ({
      ...e,
      spawnType: 'pedestrian' as const,
      accessCategory: 'pedestrian_only' as const,
      recommendedAuthorities: ['foot' as const],
    }));
    scene.infrastructure.push({
      id: 'amb-disabled-reinf',
      name: 'Ambulancia sin refuerzo automático',
      kind: 'ambulance',
      role: 'emergency',
      x: 45,
      y: 45,
      width: 2.5,
      depth: 6,
      staff: 2,
      crewCapacity: 2,
      capacity: 1,
      delay: 1,
      handling: 15,
      active: true,
      operationalMode: 'reserve',
      availableForReinforcement: false,
      phaseTags: ['event'],
    });
    scene.infrastructure.push({
      id: 'amb-real-base',
      name: 'Ambulancia Base Real',
      kind: 'ambulance',
      role: 'emergency',
      x: 20,
      y: 25,
      width: 2.5,
      depth: 6,
      staff: 2,
      crewCapacity: 2,
      capacity: 1,
      delay: 2,
      handling: 15,
      active: true,
      operationalMode: 'reserve',
      availableForReinforcement: true,
      phaseTags: ['event'],
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const sim = new ResponseSimulation(engine);
    engine.emergency = sim;
    const row = sim.inject('fall');
    expect(row).not.toBeNull();
    row!.severity = 'moderada';
    row!.responseMode = 'ambulance';
    row!.reportedAt = 0;
    row!.status = 'pending';

    // Solicitar despacho repetido no debe generar vehículos duplicados
    const m1 = sim.fleet.dispatchForIncident(row!, 'ambulance');
    const m2 = sim.fleet.dispatchForIncident(row!, 'ambulance');
    expect(m1).not.toBeNull();
    expect(m2).toBe(m1);
    expect(m1!.unitId).toBe('amb-real-base'); // Respetó availableForReinforcement: false

    const disabledUnit = sim.fleet.units.find(
      (u) => u.resourceId === 'amb-disabled-reinf'
    )!;
    const activeUnit = sim.fleet.units.find(
      (u) => u.resourceId === 'amb-real-base'
    )!;
    expect(disabledUnit.vehicleStatus).toBe('parked');
    expect(disabledUnit.assignedIncidentId).toBeNull();

    let sawCrewDeploying = false;
    let sawInterveningWithVehicleWaiting = false;
    let sawCrewReturning = false;

    for (let i = 0; i < 600; i++) {
      engine.tick(0.5);
      if (activeUnit.crewStatus === 'deploying') {
        sawCrewDeploying = true;
        expect(sim.fleet.crew.length).toBeGreaterThanOrEqual(1);
        // El vehículo debe permanecer esperando mientras la tripulación actúa
        expect(activeUnit.vehicleStatus).toBe('intervening');
      }
      if (activeUnit.crewStatus === 'intervening') {
        sawInterveningWithVehicleWaiting = true;
        expect(activeUnit.vehicleStatus).toBe('intervening');
      }
      if (activeUnit.crewStatus === 'returning') {
        sawCrewReturning = true;
        expect(activeUnit.vehicleStatus).toBe('intervening');
      }
      if (m1!.stage === 'completed') break;
    }

    expect(sawCrewDeploying).toBe(true);
    expect(sawInterveningWithVehicleWaiting).toBe(true);
    expect(sawCrewReturning).toBe(true);
    expect(row!.status).toBe('resolved');
    expect(row!.dispatchedAt).toBeDefined();
    expect(row!.arrived).toBeDefined();
    expect(row!.closed).toBeDefined();
    expect(activeUnit.crewStatus).toBe('embarked');
    expect(activeUnit.vehicleStatus).toBe('parked');
    expect(activeUnit.available).toBe(true);
  });

  it('CA 9 · police_van supports configurable 8-agent crew and deploys without exceeding inventory', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.autoIncidents = false;
    scene.infrastructure.push({
      id: 'van-1',
      name: 'Furgón policial 1',
      kind: 'police_van',
      role: 'emergency',
      x: 24,
      y: 28,
      width: 2.2,
      depth: 5.8,
      staff: 8,
      crewCapacity: 8,
      capacity: 1,
      delay: 1,
      handling: 15,
      active: true,
      operationalMode: 'fixed_service',
      availableForReinforcement: true,
      phaseTags: ['event'],
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const sim = new ResponseSimulation(engine);
    engine.emergency = sim;
    const van = sim.fleet.units.find(
      (u) => u.resourceId === 'van-1'
    )!;
    expect(van.crewCapacity).toBe(8);
    expect(van.operationalMode).toBe('fixed_service');
    expect(van.vehicleStatus).toBe('parked');

    const row = sim.inject('conflict');
    expect(row).not.toBeNull();
    row!.severity = 'grave';
    row!.responseMode = 'police_van';
    row!.reportedAt = 0;
    row!.status = 'pending';

    const mission = sim.fleet.dispatchForIncident(row!, 'police_van', {
      preferHighCrew: true,
    });
    expect(mission).not.toBeNull();
    expect(mission!.unitId).toBe('van-1');
    // No se crean vehículos adicionales fuera del inventario
    expect(
      sim.fleet.units.filter((u) => u.kind === 'police_van')
    ).toHaveLength(1);
  });
});
