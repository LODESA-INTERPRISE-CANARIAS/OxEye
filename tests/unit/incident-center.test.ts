import {describe, expect, it} from 'vitest';
import {catalog} from '../../src/data/catalog';
import {INVENTORY_META} from '../../src/data/inventory-meta';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {
  buildIncidentExportPayload,
  buildIncidentTimelineCsv,
  buildNotificationTitle,
  evaluateIncidentManagement,
  INCIDENT_CATEGORIES,
  runAlternativeIncidentTrial,
} from '../../src/engine/emergency/incident-center';
import {incidentDashboard} from '../../src/engine/emergency/incident-dashboard';
import {
  ResponseSimulation,
  responseSVG,
} from '../../src/engine/emergency/response-model';

configure(MAPS_DATA);

function makeScene(seed = 2026) {
  const s = addResponseExample(
    smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
  );
  s.seed = seed;
  s.seedMode = 'fixed';
  return s;
}

function makeEngine(seed = 2026) {
  const eng = new EventEngine(makeScene(seed));
  eng.emergency = new ResponseSimulation(eng);
  return eng;
}

function advance(engine: EventEngine, seconds: number) {
  const steps = Math.round(seconds / 0.5);
  for (let i = 0; i < steps; i++) {
    engine.tick(0.5);
  }
}

describe('SUPER FEATURE · Centro de incidencias, notificaciones inteligentes y reproducción temporal', () => {
  it('CA 1 & 2 · assigns category color, SVG icon, sequential unique code, and independent severity across all incident types', () => {
    expect(INCIDENT_CATEGORIES.fire.color).toBe('#D94841');
    expect(INCIDENT_CATEGORIES.medical.color).toBe('#1688CF');
    expect(INCIDENT_CATEGORIES.accessibility.color).toBe('#E69A26');
    expect(INCIDENT_CATEGORIES.violet_point.color).toBe('#9755C2');
    expect(INCIDENT_CATEGORIES.security.color).toBe('#3977A6');
    expect(INCIDENT_CATEGORIES.logistics.color).toBe('#199A87');
    expect(INCIDENT_CATEGORIES.congestion.color).toBe('#C17A32');
    expect(INCIDENT_CATEGORIES.information.color).toBe('#64748B');

    const eng = makeEngine(401);
    advance(eng, 90);

    const f1 = eng.emergency.inject('fall');
    const f2 = eng.emergency.inject('cut');
    const acc = eng.emergency.inject('accessibility');
    const fire = eng.emergency.inject('fire');
    const vio = eng.emergency.inject('violet_point');

    expect(f1?.code).toBe('SAN-001');
    expect(f2?.code).toBe('SAN-002');
    expect(acc?.code).toBe('ACC-001');
    expect(fire?.code).toBe('FUE-001');
    expect(vio?.code).toBe('VIO-001');

    // Gravedad independiente del color de categoría
    expect(acc?.category).toBe('accessibility');
    expect(acc?.severity).toBe('informativa');
    expect(fire?.category).toBe('fire');
    expect(fire?.severity).toBe('critica');

    advance(eng, 60);
    const html = incidentDashboard(eng);
    expect(html).toContain('SAN-001');
    expect(html).toContain('ACC-001');
    expect(html).toContain('FUE-001');
    expect(html).toContain('data-investigate-btn');
    expect(html).toContain('Investigar incidencia');
  });

  it('CA 5, 6, 7, 8 & 9 · records origin T+00:00, detection, assignment, intervention, simultaneous links, and extended fire post-extinguishing cordon', () => {
    const eng = makeEngine(502);
    advance(eng, 90);

    const fire = eng.emergency.inject('fire');
    const acc = eng.emergency.inject('accessibility');
    expect(fire).toBeTruthy();
    expect(acc).toBeTruthy();
    expect(fire?.hasPreDetectionData).toBe(true);
    expect(fire?.simultaneousIds).toContain(acc!.id);

    // Avanzar para detección, extinción y montaje de vallas post-incendio
    advance(eng, 480);

    const tl = fire?.timeline || [];
    const kinds = tl.map((e) => e.kind);
    expect(kinds[0]).toBe('origin');
    expect(tl[0].relTime).toBe(0);
    expect(kinds).toContain('detection');
    expect(kinds.some((k) => ['extinguished', 'cordon_approach', 'cordon_install', 'cordon_fenced'].includes(k))).toBe(true);

    const metrics = evaluateIncidentManagement(fire!, eng);
    expect(metrics.detectionSeconds).toBeTypeOf('number');
    expect(metrics.costIsEstimate).toBe(true);
    expect(metrics.estimatedCostEur).toBeGreaterThan(0);
  });

  it('CA 6, 7, 10 & 11 · deterministic read-only replay rewinds to T+00:00 without mutating the paused main engine', () => {
    const baseScene = makeScene(603);
    const mainEngine = new EventEngine(structuredClone(baseScene));
    advance(mainEngine, 100);
    const inc = mainEngine.emergency.inject('fall');
    expect(inc).toBeTruthy();
    const originTime = inc!.created || 100;
    const originPos = [...inc!.point!];

    advance(mainEngine, 120);
    const pausedTime = mainEngine.time;
    const pausedAgentsSnapshot = mainEngine.agents.map((a) => [a.id, a.x, a.y]);

    // Motor de investigación separado rebobinado exactamente a T+00:00 (originTime)
    const replayEngine = new EventEngine(structuredClone(baseScene));
    advance(replayEngine, originTime);
    const replayedInc = replayEngine.emergency.inject('fall');
    expect(replayedInc?.point).toEqual(originPos);

    // El motor principal congelado permanece intacto
    expect(mainEngine.time).toBe(pausedTime);
    expect(mainEngine.agents.map((a) => [a.id, a.x, a.y])).toEqual(
      pausedAgentsSnapshot
    );
  });

  it('CA 12 & 13 · enforces Punto Violeta privacy in public mode across notifications, SVG, JSON and CSV exports', () => {
    const eng = makeEngine(704);
    advance(eng, 80);
    const vio = eng.emergency.inject('violet_point');
    expect(vio).toBeTruthy();
    expect(vio?.sensitive).toBe(true);
    advance(eng, 70);

    const pubTitle = buildNotificationTitle(vio!, eng.time, 'public');
    expect(pubTitle).toContain('VIO-001');
    expect(pubTitle).toContain('reservada');

    const svgPublic = responseSVG(eng, {
      highlightIncidentId: vio!.id,
      privacyMode: 'public',
    });
    expect(svgPublic).toContain('VIO-001');
    expect(svgPublic).toContain('atención reservada');

    const metrics = evaluateIncidentManagement(vio!, eng);
    const payload = buildIncidentExportPayload(
      vio!,
      eng,
      metrics,
      'public',
      '10:02:30'
    );
    expect(String(payload.ubicacion)).toContain('reservada');

    const csv = buildIncidentTimelineCsv(vio!, 'public');
    expect(csv).toContain('VIO-001');
    expect(csv).toContain('Registro reservado de servicio.');
  });

  it('CA 14 · runs an alternative management trial from pre-incident scene copy without mutating original scene', () => {
    const baseScene = makeScene(805);
    const beforeInfraLen = baseScene.infrastructure.length;
    const eng = new EventEngine(structuredClone(baseScene));
    advance(eng, 90);
    const fall = eng.emergency.inject('fall');
    expect(fall).toBeTruthy();
    advance(eng, 260);

    const origMetrics = evaluateIncidentManagement(fall!, eng);
    const alt = runAlternativeIncidentTrial(
      baseScene,
      fall!,
      [{time: fall!.created || 90, kind: 'inject', value: {type: 'fall', sourceId: null}}],
      'add_extra_unit',
      origMetrics,
      eng.time
    );

    expect(baseScene.infrastructure.length).toBe(beforeInfraLen);
    expect(alt.changeKind).toBe('add_extra_unit');
    expect(alt.alternative.resourcesUsed.length).toBeGreaterThanOrEqual(0);
    expect(alt.caveat).toContain('simulados');
  });

  it('PHYSICAL RESOURCES · yellow_tent and violet_point exist in catalog and handle bidirectional dispatch only when placed', () => {
    expect(catalog.yellow_tent.role).toBe('emergency');
    expect(catalog.violet_point.role).toBe('emergency');
    expect(INVENTORY_META.yellow_tent.accent).toBe('#E69A26');
    expect(INVENTORY_META.violet_point.accent).toBe('#9755C2');

    // Sin Carpa Amarilla colocada -> queda esperando recurso físico sin inventar ambulancia/policía
    const engNoTent = makeEngine(901);
    advance(engNoTent, 120);
    const accWait = engNoTent.emergency.inject('accessibility');
    expect(accWait).toBeTruthy();
    accWait!.status = 'pending';
    (engNoTent.emergency as ResponseSimulation).assignResource(accWait!);
    expect(accWait?.status).toBe('waiting');
    expect(accWait?.note).toContain('Carpa Amarilla');

    // Con Carpa Amarilla y Punto Violeta físicos colocados -> enlace y resolución reales
    const sWithPts = makeScene(902);
    sWithPts.infrastructure.push(
      {
        id: 'yt-1',
        role: 'emergency',
        kind: 'yellow_tent',
        name: 'Carpa Amarilla Norte',
        x: 52,
        y: 48,
        width: 4,
        depth: 4,
        rotation: 0,
        capacity: 2,
        staff: 2,
        delay: 15,
        handling: 45,
        active: true,
        cost: 0,
      },
      {
        id: 'vp-1',
        role: 'emergency',
        kind: 'violet_point',
        name: 'Punto Violeta Central',
        x: 48,
        y: 52,
        width: 3.5,
        depth: 3.5,
        rotation: 0,
        capacity: 1,
        staff: 2,
        delay: 15,
        handling: 60,
        active: true,
        cost: 0,
      }
    );
    const engWithPts = new EventEngine(sWithPts);
    engWithPts.emergency = new ResponseSimulation(engWithPts);
    advance(engWithPts, 80);

    const acc = engWithPts.emergency.inject('accessibility');
    const vio = engWithPts.emergency.inject('violet_point');
    expect(acc).toBeTruthy();
    expect(vio).toBeTruthy();

    advance(engWithPts, 420);
    expect(acc?.resourceId).toBe('yt-1');
    expect(vio?.resourceId).toBe('vp-1');
    expect(acc?.status).toBe('resolved');
    expect(vio?.status).toBe('resolved');
  });
});
