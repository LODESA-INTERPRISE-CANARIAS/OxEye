import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {parseImportedProject, createDefaultProject} from '../../src/db/repository';
import {
  applyLiveDemandFromNow,
  buildHourlyAttendancePlan,
} from '../../src/engine/crowd/attendance-model';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {phaseScene} from '../../src/engine/logistics/phases';
import {buildObjectiveDemandReport} from '../../src/engine/planning/demand';
import {
  deriveEventDemand,
  editHourlyArrivalBar,
  ensureEventDemandConfig,
  getDemandSyncStatus,
  proposeSmartDemandUpdates,
  resetCurveToProfile,
  scaleCurveToTotal,
  updateEventDemand,
} from '../../src/engine/planning/event-demand';

function makeTestScene() {
  configure(MAPS_DATA);
  const map = MAPS_DATA.cristo;
  const raw = initialScene('cristo', map, CARTO_DATA);
  const scene = addResponseExample(smallExample(raw));
  scene.seed = 2026;
  scene.seedMode = 'fixed';
  return scene;
}

describe('FEATURE + FIX · Sincronización bidireccional de demanda y fuente única', () => {
  it('Prueba 1 · Fuente única bidireccional entre Calcular servicios, Simular y Necesidades', () => {
    const scene = makeTestScene();

    // Edición desde Calculadora: 3.000 asistentes únicos en 8 horas con curva multipico
    const cfg = updateEventDemand(scene, {
      uniqueAttendees: 3000,
      hours: 8,
      startHour: 10,
      curveProfile: 'full_day',
      dwellTimeMinutes: 60,
      provenance: 'curve_preset',
    });

    const derived = deriveEventDemand(scene);
    const report = buildObjectiveDemandReport(scene, derived.legacyDemandInputs);

    expect(cfg.uniqueAttendees).toBe(3000);
    expect(cfg.hours).toBe(8);
    expect(derived.averageArrivalsPerHour).toBe(375);
    // Jamás sobrescribe base.arrivals con el pico horario
    expect(scene.base.arrivals).toBe(375);
    expect(derived.peakHourlyArrivals).toBeGreaterThan(375);
    expect(scene.attendance?.uniqueAttendees).toBe(3000);
    expect(report.base.occupied).toBe(derived.averageSimultaneousOccupancy);
    expect(report.base.occupied).not.toBe(derived.peakHourlyArrivals);

    // Edición inversa desde Simular: cambiar a 4.000 únicos en 10 horas actualiza todo coherentemente
    updateEventDemand(scene, {uniqueAttendees: 4000, hours: 10});
    const afterSidebar = deriveEventDemand(scene);
    expect(afterSidebar.plannedUniqueAttendees).toBe(4000);
    expect(afterSidebar.config.hourlyArrivals).toHaveLength(10);
    expect(afterSidebar.config.hourlyArrivals.reduce((a, b) => a + b, 0)).toBe(4000);
    expect(afterSidebar.averageArrivalsPerHour).toBe(400);
    expect(scene.base.hours).toBe(10);
  });

  it('Prueba 2 · Curva variable real trasladada íntegra al motor sin aplanarse al pico horario', () => {
    const scene = makeTestScene();
    updateEventDemand(scene, {
      uniqueAttendees: 3000,
      hours: 8,
      curveProfile: 'full_day',
      provenance: 'curve_preset',
    });

    const derived = deriveEventDemand(scene);
    const uniqueBars = new Set(derived.config.hourlyArrivals);
    expect(uniqueBars.size).toBeGreaterThan(2);
    expect(derived.config.hourlyArrivals.reduce((a, b) => a + b, 0)).toBe(3000);

    const plan = buildHourlyAttendancePlan(scene);
    expect(plan.uniqueAttendees).toBe(3000);
    expect(plan.hourlyEntries).toEqual(derived.config.hourlyArrivals);

    const engine = new EventEngine(phaseScene(scene, 'event'));
    expect(engine.hourly).toEqual(derived.config.hourlyArrivals);
    expect(engine.hourly.every((v) => v === derived.peakHourlyArrivals)).toBe(false);
  });

  it('Prueba 3 · Diferenciación matemática estricta y conservación ocupación(t+1) = ocupación(t) + entradas(t) - salidas(t)', () => {
    const scene = makeTestScene();
    updateEventDemand(scene, {
      uniqueAttendees: 3000,
      hours: 8,
      curveProfile: 'trade_fair',
      dwellTimeMinutes: 90,
      reentryRate: 0,
      provenance: 'curve_preset',
    });

    const derived = deriveEventDemand(scene);
    expect(derived.plannedUniqueAttendees).toBe(3000);
    expect(derived.averageArrivalsPerHour).toBe(375);
    expect(derived.peakHourlyArrivals).toBeGreaterThan(375);
    expect(derived.peakSimultaneousOccupancy).toBeLessThanOrEqual(3000);
    expect(derived.peakSimultaneousOccupancy).toBeGreaterThan(derived.averageSimultaneousOccupancy);

    // En cada franja horaria, cierre = inicio + entradas - salidas
    for (let h = 0; h < derived.hourly.length; h++) {
      const slot = derived.hourly[h];
      expect(slot.startOccupancy + slot.entries - slot.exits).toBe(slot.endOccupancy);
      if (h > 0) {
        expect(slot.startOccupancy).toBe(derived.hourly[h - 1].endOccupancy);
      }
    }
  });

  it('Prueba 4 · Cambiar la permanencia modifica la ocupación simultánea sin alterar el total de asistentes únicos', () => {
    const scene = makeTestScene();
    updateEventDemand(scene, {
      uniqueAttendees: 2400,
      hours: 8,
      curveProfile: 'family',
      dwellTimeMinutes: 45,
      provenance: 'curve_preset',
    });
    const shortStay = deriveEventDemand(scene);

    updateEventDemand(scene, {dwellTimeMinutes: 120});
    const longStay = deriveEventDemand(scene);

    expect(longStay.plannedUniqueAttendees).toBe(shortStay.plannedUniqueAttendees);
    expect(longStay.config.hourlyArrivals).toEqual(shortStay.config.hourlyArrivals);
    expect(longStay.peakSimultaneousOccupancy).toBeGreaterThan(shortStay.peakSimultaneousOccupancy);
    expect(longStay.averageSimultaneousOccupancy).toBeGreaterThan(
      shortStay.averageSimultaneousOccupancy
    );
  });

  it('Prueba 5 · Aforo autorizado ausente se muestra como «No definido» y nunca como 0 inventado', () => {
    const scene = makeTestScene();
    updateEventDemand(scene, {
      uniqueAttendees: 1800,
      hours: 6,
      authorizedCapacity: null,
      provenance: 'manual',
    });

    const noCap = deriveEventDemand(scene);
    expect(noCap.capacityStatus.defined).toBe(false);
    expect(noCap.capacityStatus.authorizedCapacity).toBeNull();
    expect(noCap.capacityStatus.label).toBe('No definido');
    expect(noCap.capacityStatus.exceedsAuthorized).toBe(false);

    // Al definir un aforo autorizado menor que la punta simultánea, detecta el rebase
    updateEventDemand(scene, {authorizedCapacity: 200});
    const tightCap = deriveEventDemand(scene);
    expect(tightCap.capacityStatus.defined).toBe(true);
    expect(tightCap.capacityStatus.exceedsAuthorized).toBe(true);
    expect(tightCap.capacityStatus.peakOccupancyPct).toBeGreaterThan(100);
  });

  it('Prueba 6 · Edición individual de barras ofrece mantener total o actualizarlo y conserva sumas exactas', () => {
    const scaled = scaleCurveToTotal([1, 2, 3, 2, 1], 1000);
    expect(scaled.reduce((a, b) => a + b, 0)).toBe(1000);

    const scene = makeTestScene();
    updateEventDemand(scene, {
      uniqueAttendees: 3000,
      hours: 8,
      curveProfile: 'full_day',
      provenance: 'curve_preset',
    });

    // Modo mantener total: fija barra 2 en 600 y redistribuye las demás manteniendo 3.000
    const keepCfg = editHourlyArrivalBar(scene, 2, 600, 'keep_total');
    expect(keepCfg.hourlyArrivals[2]).toBe(600);
    expect(keepCfg.uniqueAttendees).toBe(3000);
    expect(keepCfg.hourlyArrivals.reduce((a, b) => a + b, 0)).toBe(3000);

    // Modo actualizar total: cambia barra 0 a 500 y suma el nuevo total real
    const prevSum = keepCfg.hourlyArrivals.reduce((a, b) => a + b, 0);
    const diff = 500 - keepCfg.hourlyArrivals[0];
    const updCfg = editHourlyArrivalBar(scene, 0, 500, 'update_total');
    expect(updCfg.hourlyArrivals[0]).toBe(500);
    expect(updCfg.uniqueAttendees).toBe(prevSum + diff);
    expect(updCfg.hourlyArrivals.reduce((a, b) => a + b, 0)).toBe(updCfg.uniqueAttendees);

    // Restaurar a perfil recupera la forma predefinida conservando el total actual
    const resetCfg = resetCurveToProfile(scene, 'trade_fair');
    expect(resetCfg.curveProfile).toBe('trade_fair');
    expect(resetCfg.hourlyArrivals.reduce((a, b) => a + b, 0)).toBe(resetCfg.uniqueAttendees);
  });

  it('Prueba 7 · Aplicar cambios en caliente durante simulación activa preserva histórico y partículas sin duplicar', () => {
    const scene = makeTestScene();
    updateEventDemand(scene, {
      uniqueAttendees: 1600,
      hours: 8,
      curveProfile: 'trade_fair',
      provenance: 'curve_preset',
    });

    const engine = new EventEngine(phaseScene(scene, 'event'));
    // Simular más de 1 hora (3900 s) para entrar en franja 1 preservando franja 0
    for (let i = 0; i < 7800; i++) engine.tick(0.5);

    const prevTime = engine.time;
    const prevHour0Rate = engine.hourly[0];
    const prevAgentCount = engine.agents.length;
    const prevEntries = engine.attendance.entriesTotal;
    expect(prevTime).toBeGreaterThanOrEqual(3600);

    const updatedScene = structuredClone(scene);
    updateEventDemand(updatedScene, {
      uniqueAttendees: 3200,
      hours: 10,
      curveProfile: 'festival',
      provenance: 'curve_preset',
    });
    const statusPending = getDemandSyncStatus(
      updatedScene,
      ensureEventDemandConfig(scene).revision,
      engine.time
    );
    expect(statusPending.state).toBe('pending_changes');

    applyLiveDemandFromNow(engine, updatedScene);

    // Tiempo, franja ya transcurrida, población y contadores previos no se reinician ni duplican
    expect(engine.time).toBe(prevTime);
    expect(engine.hourly[0]).toBe(prevHour0Rate);
    expect(engine.agents.length).toBe(prevAgentCount);
    expect(engine.attendance.entriesTotal).toBe(prevEntries);
    // Franjas futuras y duración sí quedan actualizadas
    expect(engine.duration).toBe(10 * 3600);
    expect(engine.hourly).toHaveLength(10);
    expect(engine.hourly[5]).toBe(updatedScene.demandConfig!.hourlyArrivals[5]);
  });

  it('Prueba 8 · Migración de proyecto JSON heredado sin destruir tasas previas y sugerencias SMART no destructivas', () => {
    configure(MAPS_DATA);
    const project = createDefaultProject();
    // Simular escena heredada antigua sin demandConfig ni attendance
    delete project.scenes.cristo.demandConfig;
    delete project.scenes.cristo.attendance;
    delete project.scenes.cristo.demandInputs;
    project.scenes.cristo.base.arrivals = 250;
    project.scenes.cristo.base.hours = 6;

    const imported = parseImportedProject(
      JSON.stringify(project),
      project,
      MAPS_DATA
    );
    const migratedScene = imported.scenes.cristo;
    const cfg = ensureEventDemandConfig(migratedScene);

    expect(cfg.provenance).toBe('legacy_hourly_migration');
    expect(cfg.legacyHourlyRate).toBe(250);
    expect(cfg.uniqueAttendees).toBe(1500);
    expect(cfg.authorizedCapacity).toBeNull();
    expect(getDemandSyncStatus(migratedScene).state).toBe('uncalibrated');

    // Sugerencias SMART nunca modifican la configuración sin confirmación explícita
    const beforeSnapshot = structuredClone(migratedScene.demandConfig);
    const proposal = proposeSmartDemandUpdates(migratedScene);
    expect(migratedScene.demandConfig).toEqual(beforeSnapshot);
    if (proposal.hasSuggestions) {
      updateEventDemand(migratedScene, proposal.patch);
      expect(migratedScene.demandConfig!.provenance).toBe('smart_suggestion');
    }
  });
});
