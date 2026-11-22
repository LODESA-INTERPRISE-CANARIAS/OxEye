import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {percent} from '../../src/engine/cartography/geometry';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {phaseScene} from '../../src/engine/logistics/phases';
import {
  buildVehicleGrid,
  planVehicleRoute,
  VEHICLE_SPECS,
} from '../../src/engine/mobility/vehicle-system';

describe('Movilidad vehicular, bases exteriores y detección de bloqueos', () => {
  it('01 · spawns a vehicle from an exterior base outside the plaza and completes entry -> operation -> exit', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    // Despejar mobiliario interior para el ensayo de ciclo logístico desde base exterior
    scene.base.booths = [];
    scene.infrastructure = [];
    scene.reserves = [];
    // Colocar base vehicular exterior fuera del perímetro de la plaza
    const extBase = {
      id: 'ext-base-1',
      name: 'Base logística exterior',
      x: 24,
      y: 28,
      role: 'both' as const,
      clearWidth: 6,
      spawnType: 'vehicle' as const,
      externalBase: true,
      vehicleCategory: 'logistics' as const,
      phases: {event: 'both' as const},
    };
    scene.entrances.push(extBase);
    // Añadir zona de descarga despejada dentro del perímetro
    scene.reserves.push({
      id: 'load-1',
      name: 'Carga y descarga central',
      origin: 'loading',
      points: [
        [44, 46],
        [52, 46],
        [52, 54],
        [44, 54],
      ],
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    const veh = engine.vehicleManager.spawnFrom(extBase, 'logistics');
    expect(engine.vehicleManager.blockedReports).toEqual([]);
    expect(veh).not.toBeNull();
    expect(veh!.state).toBe('entering');
    expect(veh!.path.length).toBeGreaterThanOrEqual(2);

    // Simular hasta que complete entrada, operación y salida sin bloquearse
    let sawOperating = false;
    let sawExiting = false;
    for (let i = 0; i < 600; i++) {
      engine.tick(0.5);
      if (veh!.state === 'operating') sawOperating = true;
      if (veh!.state === 'exiting') sawExiting = true;
      if (veh!.state === 'departed') break;
    }
    expect(sawOperating).toBe(true);
    expect(sawExiting).toBe(true);
    expect(veh!.state).toBe('departed');
    expect(engine.vehicleManager.departedCount).toBeGreaterThanOrEqual(1);
  });

  it('02 · detects a blocked street / impossible truck turn, names the concrete obstacle, and proposes alternatives', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    // Crear un callejón muy estrecho cerrado con un puesto llamado "Puesto Bloqueador"
    const [bx, by] = percent([220, 200], map);
    scene.base.booths.push({
      id: 'blocker-booth',
      name: 'Puesto Bloqueador',
      type: 'commerce',
      x: bx,
      y: by,
      width: 14,
      depth: 14,
      rotation: 0,
    });
    const engine = new EventEngine(phaseScene(scene, 'event'));
    const vehGrid = buildVehicleGrid(engine.s, engine.g);

    // Intentar meter un camión pesado justo dentro del obstáculo sin espacio de giro
    const report = planVehicleRoute(
      engine.s,
      vehGrid,
      [205, 200],
      [220, 200],
      {
        width: VEHICLE_SPECS.logistics.width,
        length: 8.5,
        minTurnRadius: 6.5,
      }
    );
    expect(report.ok).toBe(false);
    expect(report.blockingObstacle).toBeTruthy();
    expect(report.alternatives.length).toBeGreaterThan(0);
  });

  it('Captura 1 · allows emergency vehicles to park at clear approach and dismount crew on foot instead of hard-blocking', () => {
    configure(MAPS_DATA);
    const map = MAPS_DATA.cristo;
    const scene = initialScene('cristo', map, CARTO_DATA);
    const engine = new EventEngine(phaseScene(scene, 'event'));
    engine.emergency = new ResponseSimulation(engine);

    const row = engine.emergency.inject('orientation');
    expect(row).not.toBeNull();
    // Avanzar para que el testigo avise y se asigne unidad
    for (let i = 0; i < 60; i++) {
      engine.tick(0.5);
    }
    // No debe quedarse bloqueada por huella vehicular en una consulta de orientación
    expect(row!.status).not.toBe('blocked');
  });
});
