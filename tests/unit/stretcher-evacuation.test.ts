import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {percent} from '../../src/engine/cartography/geometry';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {RESPONSE_PROFILES, ResponseSimulation} from '../../src/engine/emergency/response-model';
import {liveFailures} from '../../src/engine/emergency/risk';
import {
  DEFAULT_STRETCHER_CONFIG,
  evaluateMedicalResponsePlan,
  resolveStretcherConfig,
} from '../../src/engine/emergency/stretcher-nav';
import {phaseScene} from '../../src/engine/logistics/phases';

describe('FIX · Despliegue de camillas y evacuación sanitaria a pie', () => {
  it('CA 3 · defines stretcher equipment with independent 2.00 m × 0.65 m dimensions and handling clearance', () => {
    const cfg = resolveStretcherConfig();
    expect(cfg.length).toBe(2.0);
    expect(cfg.width).toBe(0.65);
    expect(cfg.requiredOperators).toBe(2);
    expect(cfg.canTransportPatient).toBe(true);
    expect(cfg.handlingMarginWidth).toBeGreaterThan(0);
    expect(cfg.handlingMarginLength).toBeGreaterThan(0);
    expect(RESPONSE_PROFILES.stretcher.width).toBe(DEFAULT_STRETCHER_CONFIG.width);
    expect(RESPONSE_PROFILES.stretcher.length).toBe(DEFAULT_STRETCHER_CONFIG.length);
    // La camilla no hereda las dimensiones de la ambulancia (2.5 × 6.0 m)
    expect(RESPONSE_PROFILES.stretcher.width).toBeLessThan(RESPONSE_PROFILES.ambulance.width);
    expect(RESPONSE_PROFILES.stretcher.length).toBeLessThan(RESPONSE_PROFILES.ambulance.length);
  });

  it('CA 1, 2, 4, 6 & 7 · ambulance parks outside, medics deploy on foot, evacuate patient on stretcher, and ambulance waits until embarkation', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.autoIncidents = false;
    scene.responseMode = 'ambulance';
    // Puertas exclusivamente peatonales: la ambulancia debe estacionar fuera y desplegar sanitarios + camilla
    scene.entrances = scene.entrances.map((g) => ({
      ...g,
      spawnType: 'pedestrian' as const,
      accessCategory: 'pedestrian_only' as const,
      recommendedAuthorities: ['foot' as const],
    }));
    const gate = scene.entrances[0];
    scene.infrastructure.push({
      id: 'amb-ext-1',
      name: 'Ambulancia Exterior',
      kind: 'ambulance',
      role: 'emergency',
      x: gate.x,
      y: gate.y,
      width: 2.5,
      depth: 6,
      staff: 2,
      crewCapacity: 2,
      capacity: 1,
      delay: 1,
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

    const mission = sim.fleet.dispatchForIncident(row!, 'ambulance');
    expect(mission).not.toBeNull();
    expect(mission!.stretcherEvacuationPossible).toBe(true);

    const amb = sim.fleet.units.find((u) => u.resourceId === 'amb-ext-1')!;
    let sawFoldedApproach = false;
    let sawDeployedEvac = false;

    for (let i = 0; i < 600; i++) {
      engine.tick(0.5);
      const stretcherMedic = sim.fleet.crew.find((c) => c.carryingStretcher);
      if (stretcherMedic && stretcherMedic.status === 'deploying') {
        expect(stretcherMedic.stretcherState).toBe('folded');
        sawFoldedApproach = true;
      }
      if (stretcherMedic && stretcherMedic.status === 'returning') {
        expect(stretcherMedic.stretcherState).toBe('deployed');
        expect(stretcherMedic.carryingPatient).toBe(true);
        // La ambulancia permanece estacionada hasta completar el embarque
        expect(amb.vehicleStatus).toBe('intervening');
        sawDeployedEvac = true;
      }
      if (mission!.stage === 'completed') break;
    }

    expect(sawFoldedApproach).toBe(true);
    expect(sawDeployedEvac).toBe(true);
    expect(row!.status).toBe('resolved');
    expect(amb.crewStatus).toBe('embarked');
    expect(amb.vehicleStatus).toBe('parked');
    expect(liveFailures(engine)).toHaveLength(0);
  });

  it('CA 4, 5 & 8 · distinguishes medic foot assistance (Route B ok) from unresolved stretcher evacuation (Route C blocked by tight choke)', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    scene.base.booths = [];
    scene.infrastructure = [];
    scene.reserves = [];
    scene.fences = [];

    // Crear un callejón con giro en L de ~0,80 m libres dentro del recinto usando coordenadas en metros reales:
    // Un sanitario a pie (radio 0,30 m) puede entrar y asistir, pero una camilla desplegada (0,65 × 2,00 m + margen)
    // no cabe en el estrechamiento/giro.
    const cx = (50 * map.widthMeters) / 100;
    const cy = (50 * map.heightMeters) / 100;
    const [lx, ly] = percent([cx - 2.4, cy], map);
    const [rx, ry] = percent([cx + 2.4, cy], map);
    const [bx, by] = percent([cx, cy - 6.0], map);
    scene.base.booths.push(
      {
        id: 'wall-left',
        name: 'Puesto Izquierdo',
        type: 'commerce',
        x: lx,
        y: ly,
        width: 4,
        depth: 10,
        rotation: 0,
      },
      {
        id: 'wall-right',
        name: 'Puesto Derecho',
        type: 'commerce',
        x: rx,
        y: ry,
        width: 4,
        depth: 10,
        rotation: 0,
      },
      {
        id: 'wall-back',
        name: 'Puesto Fondo',
        type: 'commerce',
        x: bx,
        y: by,
        width: 9,
        depth: 2,
        rotation: 0,
      }
    );

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const victimPoint: [number, number] = [cx, cy - 1.5];
    const ambOrigin: [number, number] = [cx, cy + 12];

    const plan = evaluateMedicalResponsePlan({
      scene: engine.s,
      pedGrid: engine.g,
      ambulanceOrigin: ambOrigin,
      victimPoint,
      allowVehicleDirect: false,
    });

    // La asistencia a pie (Ruta B) debe evaluarse independientemente de la camilla (Ruta C)
    expect(plan.routeA.directToVictim).toBe(false);
    expect(plan.routeB.ok).toBe(true);
    expect(plan.assistancePossible).toBe(true);
    expect(plan.routeC.ok).toBe(false);
    expect(plan.stretcherEvacuationPossible).toBe(false);
    expect(plan.failedPhase).toBe('stretcher_evacuation');
    expect(plan.severity).toBe('critical');
    expect(plan.summaryTitle).toContain('Evacuación con camilla no resuelta');
  });
});
