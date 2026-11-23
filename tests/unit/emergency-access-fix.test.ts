import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {percent} from '../../src/engine/cartography/geometry';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {
  gateAllowsAuthority,
  isPedestrianOnlyAccess,
  resolveAccessCategory,
} from '../../src/engine/emergency/priority';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {ResponseSimulation} from '../../src/engine/emergency/response-model';
import {assessRisk} from '../../src/engine/emergency/risk';
import {phaseScene} from '../../src/engine/logistics/phases';
import {shift} from '../../src/engine/logistics/shift';

describe('FIX CRÍTICO · Sistema de acceso y respuesta de vehículos de emergencia y logística dinámica', () => {
  const map = MAPS_DATA.cristo;

  it('2A · differentiates access categories and never allows vehicles through pedestrian-only doors', () => {
    expect(
      resolveAccessCategory({spawnType: 'pedestrian', clearWidth: 5})
    ).toBe('pedestrian_only');
    expect(
      isPedestrianOnlyAccess({spawnType: 'pedestrian', clearWidth: 5})
    ).toBe(true);
    expect(
      gateAllowsAuthority(
        {spawnType: 'pedestrian', clearWidth: 5, role: 'both'},
        'ambulance',
        2.8
      )
    ).toBe(false);

    // Acceso condicionado (valla móvil retirable): permite paso en open_on_demand y bloquea si está closed
    expect(
      gateAllowsAuthority(
        {
          accessCategory: 'conditional',
          conditionalState: 'open_on_demand',
          clearWidth: 4,
          role: 'both',
        },
        'ambulance',
        2.8
      )
    ).toBe(true);
    expect(
      gateAllowsAuthority(
        {
          accessCategory: 'conditional',
          conditionalState: 'closed',
          clearWidth: 4,
          role: 'both',
        },
        'ambulance',
        2.8
      )
    ).toBe(false);
    expect(
      gateAllowsAuthority(
        {accessCategory: 'physically_blocked', clearWidth: 6, role: 'both'},
        'ambulance',
        2.8
      )
    ).toBe(false);
  });

  it('2B & 2C · evaluates ambulance staging + foot/stretcher intervention as warning instead of fatal critical block, ignoring pedestrian-only doors', () => {
    configure(MAPS_DATA);
    const scene = addResponseExample(
      smallExample(initialScene('cristo', map, CARTO_DATA))
    );
    scene.responseMode = 'ambulance';
    const med = scene.infrastructure.find((r) => r.kind === 'medical')!;
    scene.infrastructure.push({
      id: 'amb-test-1',
      name: 'Ambulancia SUC',
      kind: 'ambulance',
      role: 'emergency',
      x: med.x,
      y: med.y,
      width: 2.5,
      depth: 6,
      staff: 2,
      capacity: 1,
      delay: 30,
      handling: 180,
      active: true,
      phaseTags: ['event'],
    });
    // Marcar todos los accesos como exclusivamente peatonales y estrechos
    for (const g of scene.entrances) {
      g.spawnType = 'pedestrian';
      g.accessCategory = 'pedestrian_only';
      g.clearWidth = 2.0;
    }

    const engine = new EventEngine(phaseScene(scene, 'event'));
    engine.emergency = new ResponseSimulation(engine);
    const report = assessRisk(scene, engine, {routes: true});

    // Ningún bloqueo fatal por puertas peatonales o ambulancia con desembarco a pie
    const ambRouteCritical = report.critical.filter(
      (i) => i.id === 'route-ambulance' || i.id === 'gate-ambulance'
    );
    expect(ambRouteCritical).toHaveLength(0);
    // Debe existir advertencia operativa explicando el desembarco a pie / estacionamiento exterior
    expect(
      report.warnings.some(
        (w) =>
          w.id === 'gate-ambulance-staging' || w.id === 'route-staging-ambulance'
      )
    ).toBe(true);

    // Simular incidencia médica y comprobar que la ambulancia interviene con desembarco a pie + evacuación de vuelta
    const ev = engine.emergency.inject('fall');
    expect(ev).not.toBeNull();
    const resp = engine.emergency as ResponseSimulation;
    resp.assignResource(ev!);
    expect(ev!.status).toBe('assigned');
    resp.startTransfer(ev!);
    expect(ev!.status).toBe('assigned');
    expect(ev!.phase).toBe('transfer');
    expect(ev!.evacuationPath?.length).toBeGreaterThanOrEqual(2);
  });

  it('3 · pre-event temporal validation ignores event-only fences and falls back to other available zones without fatal error', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', map, CARTO_DATA);
    const turning = scene.infrastructure.find((i) => i.kind === 'turning')!;
    expect(turning).toBeDefined();
    const [tx, ty] = [
      (turning.x * map.widthMeters) / 100,
      (turning.y * map.heightMeters) / 100,
    ];

    // 1) Añadir una valla que solo existe en fase Evento atravesando la zona de maniobra:
    // en Pre-evento todavía no está montada, por lo que NO debe producir error.
    scene.fences = [
      {
        id: 'valla-evento-17',
        name: 'Valla 17',
        points: [percent([tx - 4, ty], map), percent([tx + 4, ty], map)],
        phaseTags: ['event'],
      },
    ];
    const planWithEventFence = shift(scene, map, 'pre');
    expect(planWithEventFence.error).toBeUndefined();

    // 2) Si una zona de maniobra está bloqueada por una valla presente en Pre-evento,
    // pero existe una segunda zona de maniobra despejada, opera con la disponible y emite alerta sin error fatal.
    scene.fences[0].phaseTags = ['pre', 'event'];
    scene.reserves.push({
      id: 'turning-backup',
      name: 'Maniobra alternativa libre',
      origin: 'turning',
      phaseTags: ['pre', 'event', 'post'],
      points: [
        [52, 48],
        [60, 48],
        [60, 56],
        [52, 56],
      ],
    });
    const planWithBackup = shift(scene, map, 'pre');
    expect(planWithBackup.error).toBeUndefined();
    expect(planWithBackup.alerts.some((a) => a.includes('omitida'))).toBe(true);
  });
});
