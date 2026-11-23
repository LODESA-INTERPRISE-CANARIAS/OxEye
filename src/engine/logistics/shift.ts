/**
 * @module engine/logistics/shift
 * Motor de simulación de turnos logísticos (Pre-evento y Postevento):
 * camiones, carretillas, cuadrillas de montaje/desmontaje y recogida de residuos.
 */
import {allocate} from './companies';
import {membership, phases} from './phases';
import type {MapMetadata, PhaseKey, Point2D, Scene} from '../../types';
import {cellAt, inside, rect, segmentDistance} from '../cartography/geometry';
import {segmentsIntersect} from '../cartography/fences';
import {rng} from '../crowd/grid-flow';

const distance = (a: Point2D, b: Point2D) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const position = (o: {x: number; y: number}, m: MapMetadata): Point2D => [
  (o.x * m.widthMeters) / 100,
  (o.y * m.heightMeters) / 100,
];
const text = (v: unknown) =>
  String(v).replace(
    /[<>&"]/g,
    c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c] || c,
  );
const clamp = (n: unknown, min: number, max: number, def: number) =>
  Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Number(n))) : def;

export interface ShiftStage {
  id: string;
  label: string;
  start: number;
  end: number;
  from: Point2D;
  to: Point2D;
  litres?: number;
  toLitres?: number;
  loaded?: boolean;
}

export interface ShiftTaskSchedule {
  itemId: string;
  itemName: string;
  company: string;
  workers: number;
  steps: string[];
  start: number;
  end: number;
  orderIndex: number;
}

export interface ShiftErrorDiagnostic {
  problem: string;
  location: string;
  action: string;
  targetId?: string;
  targetPoint?: Point2D;
}

export interface ShiftPlan {
  error?: string;
  diagnostic?: ShiftErrorDiagnostic;
  installed: Array<{o: Record<string, any>; p: Point2D; at: number}>;
  schedule: ShiftTaskSchedule[];
  required: number;
  stages: ShiftStage[];
  packages: Array<{p: Point2D; start: number; end: number}>;
  stores: Array<{p: Point2D; angle: number}>;
  total: number;
  team: number;
  limit: number;
  phase: PhaseKey;
  capacity: number;
  binWalk: number;
  trips: number;
  alerts: string[];
  days: number;
  night: boolean;
}

/** Devuelve los pasos operativos ordenados según tipo de estructura y fase (`pre` o `post`). */
function dependencyStepsFor(o: Record<string, any>, phase: PhaseKey): string[] {
  const isStage = o.type === 'stage' || o.role === 'stage' || o.kind === 'stage';
  const isCover = o.role === 'cover' || o.kind === 'cover';
  const isFood = o.type === 'food';
  const preSteps = isStage
    ? [
        'Descarga',
        'Estructura principal',
        'Equipos técnicos',
        'Conexión eléctrica',
        'Comprobaciones',
      ]
    : isCover
      ? ['Descarga', 'Estructura y lona', 'Lastrado y fijación']
      : isFood
        ? ['Descarga', 'Emplazamiento', 'Toma eléctrica y vallas']
        : ['Descarga', 'Colocación y nivelación', 'Equipamiento'];
  return phase === 'post' ? preSteps.slice().reverse() : preSteps;
}

/** Calcula el centroide y dimensiones aproximadas (m) de una reserva poligonal. */
function reserveZoneMetrics(
  r: {id?: string; name?: string; points: Point2D[]},
  map: MapMetadata
): {id: string; x: number; y: number; width: number; depth: number; p: Point2D; name: string} {
  const ptsM = r.points.map(([px, py]): Point2D => [
    (px * map.widthMeters) / 100,
    (py * map.heightMeters) / 100,
  ]);
  const xs = ptsM.map((q) => q[0]);
  const ys = ptsM.map((q) => q[1]);
  const cx = xs.reduce((a, b) => a + b, 0) / ptsM.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ptsM.length;
  return {
    id: r.id || 'reserve-zone',
    x: (cx / map.widthMeters) * 100,
    y: (cy / map.heightMeters) * 100,
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    depth: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    p: [cx, cy],
    name: r.name || 'Zona reservada',
  };
}

/**
 * Comprueba si una zona logística (descarga o maniobra) es inaccesible desde el acceso vehicular
 * debido a zonas excluidas, vallas, estructuras permanentes o ubicación fuera del perímetro sin conexión vial.
 */
function checkZoneAccessibility(
  zone: {id: string; name: string; x: number; y: number; width: number; depth: number; p: Point2D},
  kindLabel: 'descarga' | 'maniobra',
  gate: {id: string; name: string},
  gateP: Point2D,
  scene: Scene,
  map: MapMetadata,
  phase: PhaseKey
): ShiftErrorDiagnostic | null {
  const zoneCell = cellAt(zone.p, 10);
  const toMeters = (pts: Point2D[]): Point2D[] =>
    pts.map(([px, py]) => [(px * map.widthMeters) / 100, (py * map.heightMeters) / 100]);

  // 1. Validación temporal: solo comprobar reservas excluidas presentes físicamente en la fase actual
  const hardReserves = (scene.reserves || []).filter(
    (r) =>
      r.id !== zone.id &&
      r.origin !== 'loading' &&
      r.origin !== 'turning' &&
      r.origin !== 'subperimeter' &&
      r.points?.length >= 3 &&
      membership(r).includes(phase)
  );
  for (const r of hardReserves) {
    const polyM = toMeters(r.points);
    if (inside(zone.p, polyM)) {
      return {
        problem: `La zona de ${kindLabel} «${zone.name}» es inaccesible porque está situada dentro de «${r.name || 'Zona excluida'}»`,
        location: `«${zone.name}» · CELDA ${zoneCell}`,
        action: `Mueve «${zone.name}» fuera de «${r.name || 'Zona excluida'}» o convierte la reserva en un Subperímetro autorizado.`,
        targetId: zone.id,
        targetPoint: zone.p,
      };
    }
  }

  // 2. ¿Está bloqueada por una estructura permanente ya existente?
  const permanentBlockers = [
    ...scene.base.booths.filter((b) => b.permanent),
    ...scene.infrastructure.filter(
      (i) =>
        i.permanent &&
        i.id !== zone.id &&
        i.kind !== 'loading' &&
        i.kind !== 'turning'
    ),
  ];
  for (const perm of permanentBlockers) {
    const polyM = rect(perm as unknown as Record<string, unknown>, map);
    if (inside(zone.p, polyM)) {
      return {
        problem: `La zona de ${kindLabel} «${zone.name}» está ocupada por el elemento permanente «${perm.name}»`,
        location: `«${zone.name}» · CELDA ${zoneCell}`,
        action: `Desplaza «${zone.name}» a un espacio despejado o desmarca «Elemento permanente» en «${perm.name}».`,
        targetId: zone.id,
        targetPoint: zone.p,
      };
    }
  }

  // 3. Validación temporal: en Pre-evento las vallas con phaseTags solo de Evento aún no se han instalado
  const activeFences = (scene.fences || []).filter(
    (f) => f.points?.length >= 2 && membership(f).includes(phase)
  );
  const halfSpan = Math.max(1.6, Math.min(zone.width, zone.depth) * 0.45);
  let crossingFence: {id?: string; name: string} | null = null;
  let surroundingHits = 0;
  const cardinalRays: Point2D[] = [
    [zone.p[0] + 35, zone.p[1]],
    [zone.p[0] - 35, zone.p[1]],
    [zone.p[0], zone.p[1] + 35],
    [zone.p[0], zone.p[1] - 35],
  ];
  const rayBlocked = [false, false, false, false];

  for (const f of activeFences) {
    const ptsM = toMeters(f.points);
    for (let i = 1; i < ptsM.length; i++) {
      const a = ptsM[i - 1];
      const b = ptsM[i];
      if (segmentDistance(zone.p, a, b) <= halfSpan) {
        return {
          problem: `La zona de ${kindLabel} «${zone.name}» es inaccesible porque la valla «${f.name || 'Valla'}» atraviesa o cierra su área de operación`,
          location: `«${zone.name}» · CELDA ${zoneCell}`,
          action: `Retira o desplaza «${f.name || 'Valla'}» o reubica «${zone.name}» en un corredor despejado.`,
          targetId: zone.id,
          targetPoint: zone.p,
        };
      }
      if (segmentsIntersect(gateP, zone.p, a, b)) {
        crossingFence = {id: f.id, name: f.name || 'Valla'};
      }
      for (let rIdx = 0; rIdx < cardinalRays.length; rIdx++) {
        if (!rayBlocked[rIdx] && segmentsIntersect(zone.p, cardinalRays[rIdx], a, b)) {
          rayBlocked[rIdx] = true;
          surroundingHits++;
        }
      }
    }
  }

  if (surroundingHits >= 3 && crossingFence) {
    return {
      problem: `La zona de ${kindLabel} «${zone.name}» está encerrada por vallas («${crossingFence.name}») sin paso para camiones desde «${gate.name}»`,
      location: `«${zone.name}» · CELDA ${zoneCell}`,
      action: `Abre un hueco de al menos 3,5 m en la línea de vallas o mueve «${zone.name}» hacia el lado accesible del recinto.`,
      targetId: zone.id,
      targetPoint: zone.p,
    };
  }

  return null;
}

/**
 * Calcula el plan temporal completo de una jornada de montaje (`pre`) o desmontaje/limpieza (`post`).
 */
export function shift(
  scene: Scene,
  map: MapMetadata,
  phase: PhaseKey,
): ShiftPlan {
  const assets = scene.infrastructure.filter(o =>
    membership(o).includes(phase),
  );
  // Reconocer tanto elementos de infraestructura como polígonos dibujados en `reserves`
  const loadingReserves = (scene.reserves || [])
    .filter((r) => r.origin === 'loading' && r.points?.length >= 3)
    .map((r) => reserveZoneMetrics(r, map));
  const turningReserves = (scene.reserves || [])
    .filter((r) => r.origin === 'turning' && r.points?.length >= 3)
    .map((r) => reserveZoneMetrics(r, map));

  const infraBays = assets
    .filter((o) => o.kind === 'loading')
    .map((o) => ({
      id: o.id,
      x: o.x,
      y: o.y,
      width: o.width,
      depth: o.depth,
      p: position(o, map),
      name: o.name,
    }));
  const infraYards = assets
    .filter((o) => o.kind === 'turning')
    .map((o) => ({
      id: o.id,
      x: o.x,
      y: o.y,
      width: o.width,
      depth: o.depth,
      p: position(o, map),
      name: o.name,
    }));

  const allBays = [...infraBays, ...loadingReserves];
  const allYards = [...infraYards, ...turningReserves];
  const bay = allBays[0];
  const yard = allYards[0];

  // Priorizar siempre accesos aptos para vehículos (vehicular/mixto) y bases vehiculares exteriores.
  // Nunca meter camiones por un acceso exclusivamente peatonal (p. ej. Mercado 2 m) si existe acceso vehicular/mixto.
  const openEntrances = scene.entrances.filter(
    (g) => (g.phases?.event || g.role || 'both') !== 'closed'
  );
  const extBase =
    openEntrances.find(
      (g) =>
        g.externalBase &&
        (!g.vehicleCategory ||
          g.vehicleCategory === 'all' ||
          g.vehicleCategory === 'logistics')
    ) || openEntrances.find((g) => g.externalBase);

  const vehicleGates = openEntrances
    .filter(
      (g) =>
        !g.externalBase &&
        (g.spawnType === 'vehicle' || g.spawnType === 'mixed')
    )
    .sort((a, b) => (b.clearWidth || 4) - (a.clearWidth || 4));

  const gate =
    vehicleGates.find((g) => membership(g).includes(phase)) ||
    vehicleGates[0] ||
    extBase ||
    scene.entrances.find((o) => membership(o).includes(phase)) ||
    scene.entrances[0];

  const days = Math.round(clamp(scene.eventDays, 1, 30, 1));
  const night =
    phase === 'post' && (scene.cleanDay || 0) > 0 && (scene.cleanDay || 0) < days;
  const phaseLabel = phases[phase] || phase;

  if (!gate || (!night && (!bay || !yard))) {
    const anyBayInScene =
      scene.infrastructure.find((o) => o.kind === 'loading') ||
      (scene.reserves || []).find((r) => r.origin === 'loading');
    const anyYardInScene =
      scene.infrastructure.find((o) => o.kind === 'turning') ||
      (scene.reserves || []).find((r) => r.origin === 'turning');

    let diag: ShiftErrorDiagnostic;
    if (!gate) {
      diag = {
        problem: `Falta un acceso abierto al recinto para ${phaseLabel}`,
        location: `Perímetro de «${scene.title}»`,
        action: 'Dibuja un acceso vehicular o mixto en el borde del perímetro con «⇄ Acceso».',
      };
    } else if (!bay && anyBayInScene) {
      const pt = 'points' in anyBayInScene && Array.isArray(anyBayInScene.points)
        ? reserveZoneMetrics(anyBayInScene, map).p
        : position(anyBayInScene as {x: number; y: number}, map);
      diag = {
        problem: `La zona de descarga «${anyBayInScene.name}» no está habilitada en la fase ${phaseLabel}`,
        location: `«${anyBayInScene.name}» · CELDA ${cellAt(pt, 10)}`,
        action: `Selecciona «${anyBayInScene.name}» y activa la casilla «${phaseLabel}» en Visible durante.`,
        targetId: anyBayInScene.id,
        targetPoint: pt,
      };
    } else if (!yard && anyYardInScene) {
      const pt = 'points' in anyYardInScene && Array.isArray(anyYardInScene.points)
        ? reserveZoneMetrics(anyYardInScene, map).p
        : position(anyYardInScene as {x: number; y: number}, map);
      diag = {
        problem: `La zona de maniobra «${anyYardInScene.name}» no está habilitada en la fase ${phaseLabel}`,
        location: `«${anyYardInScene.name}» · CELDA ${cellAt(pt, 10)}`,
        action: `Selecciona «${anyYardInScene.name}» y activa la casilla «${phaseLabel}» en Visible durante.`,
        targetId: anyYardInScene.id,
        targetPoint: pt,
      };
    } else if (!bay && yard) {
      diag = {
        problem: `Falta una zona de carga y descarga activa en ${phaseLabel}`,
        location: `Próxima a «${yard.name}» · CELDA ${cellAt(yard.p, 10)}`,
        action: `Dibuja una reserva de descarga con «⇄ Carga / SP» conectada a «${yard.name}» y al acceso «${gate.name}».`,
        targetId: yard.id,
        targetPoint: yard.p,
      };
    } else if (bay && !yard) {
      diag = {
        problem: `Falta una zona de maniobra de camiones activa en ${phaseLabel}`,
        location: `Próxima a «${bay.name}» · CELDA ${cellAt(bay.p, 10)}`,
        action: `Dibuja una reserva de maniobra (mín. 3 × 3 m) con «⟲ Maniobra» junto a «${bay.name}».`,
        targetId: bay.id,
        targetPoint: bay.p,
      };
    } else {
      const gPt = position(gate, map);
      diag = {
        problem: `Faltan la zona de descarga y la zona de maniobra para ${phaseLabel}`,
        location: `Entorno del acceso «${gate.name}» · CELDA ${cellAt(gPt, 10)}`,
        action: 'Añade «⟲ Maniobra» y «⇄ Carga / SP» desde Infraestructura del espacio.',
        targetId: gate.id,
        targetPoint: gPt,
      };
    }
    return {
      error: `${diag.problem} (${diag.location}). ${diag.action}`,
      diagnostic: diag,
    } as ShiftPlan;
  }
  const gateP = position(gate, map);
  const truckStartP = extBase ? position(extBase, map) : gateP;
  const skippedZoneAlerts: string[] = [];

  // Evaluar todas las zonas de descarga y maniobra disponibles: si alguna está bloqueada pero existen otras
  // operativas en la plaza, evitar el fallo fatal, advertir y operar con las zonas disponibles.
  let usableBays = allBays;
  let usableYards = allYards;

  if (!night && allBays.length > 0) {
    const okBays: typeof allBays = [];
    let firstBayErr: ShiftErrorDiagnostic | null = null;
    for (const candidateBay of allBays) {
      const err = checkZoneAccessibility(
        candidateBay,
        'descarga',
        gate,
        gateP,
        scene,
        map,
        phase
      );
      if (err) {
        if (!firstBayErr) firstBayErr = err;
        skippedZoneAlerts.push(
          `Zona de descarga «${candidateBay.name}» omitida por bloqueo (${err.problem}).`
        );
      } else {
        okBays.push(candidateBay);
      }
    }
    if (!okBays.length && firstBayErr) {
      return {
        error: `${firstBayErr.problem} (${firstBayErr.location}). ${firstBayErr.action}`,
        diagnostic: firstBayErr,
      } as ShiftPlan;
    }
    usableBays = okBays;
  }

  if (!night && allYards.length > 0) {
    const okYards: typeof allYards = [];
    let firstYardErr: ShiftErrorDiagnostic | null = null;
    for (const candidateYard of allYards) {
      if (Math.min(candidateYard.width, candidateYard.depth) < 3) {
        const narrowErr: ShiftErrorDiagnostic = {
          problem: `La reserva de maniobra «${candidateYard.name}» (${candidateYard.width.toFixed(1)} × ${candidateYard.depth.toFixed(1)} m) es demasiado estrecha para el camión (mínimo 3,0 × 3,0 m)`,
          location: `«${candidateYard.name}» · CELDA ${cellAt(candidateYard.p, 10)}`,
          action: `Amplía las dimensiones de «${candidateYard.name}» a ≥ 3 m de lado en el Inspector o redibuja el polígono.`,
          targetId: candidateYard.id,
          targetPoint: candidateYard.p,
        };
        if (!firstYardErr) firstYardErr = narrowErr;
        skippedZoneAlerts.push(
          `Zona de maniobra «${candidateYard.name}» omitida por anchura insuficiente (< 3 m).`
        );
        continue;
      }
      const err = checkZoneAccessibility(
        candidateYard,
        'maniobra',
        gate,
        gateP,
        scene,
        map,
        phase
      );
      if (err) {
        if (!firstYardErr) firstYardErr = err;
        skippedZoneAlerts.push(
          `Zona de maniobra «${candidateYard.name}» omitida por bloqueo (${err.problem}).`
        );
      } else {
        okYards.push(candidateYard);
      }
    }
    if (!okYards.length && firstYardErr) {
      return {
        error: `${firstYardErr.problem} (${firstYardErr.location}). ${firstYardErr.action}`,
        diagnostic: firstYardErr,
      } as ShiftPlan;
    }
    usableYards = okYards;
  }

  const activeBay = usableBays[0];
  const activeYard = usableYards[0];
  const dock = activeBay ? activeBay.p : gateP;
  const yardP = activeYard ? activeYard.p : gateP;

  const bins = assets
    .filter(o => o.kind === 'bin')
    .map(o => ({name: o.name, p: position(o, map)}));
  const capacity = clamp(scene.bagLitres, 5, 240, 60);
  const crew = Math.round(clamp(scene.teamSize, 2, 6, 3));
  const batch = Math.round(clamp(scene.truckBatch, 1, 24, 5));
  // Excluir elementos marcados como permanentes (no se montan ni desmontan; permanecen tras el evento)
  const tasks = [
    ...scene.base.booths,
    ...scene.infrastructure.filter(
      o => o.role === 'cover' || o.kind === 'picnic',
    ),
  ].filter(
    o =>
      !o.permanent &&
      membership(o).some(p => p === phase || p === 'event'),
  );

  // Secuenciación espacial progresiva:
  // - En `pre` (montaje): de más lejos a más cerca del acceso (montar primero el fondo sin encerrar camiones).
  // - En `post` (desmontaje): de más cerca a más lejos del acceso (liberar primero lo delantero para entrar al fondo).
  const structures = tasks
    .filter(
      o => !(scene.progressByPhase?.[phase] || []).includes(o.id),
    )
    .slice()
    .sort((a, b) => {
      const da = distance(position(a as {x: number; y: number}, map), gateP);
      const db = distance(position(b as {x: number; y: number}, map), gateP);
      return phase === 'pre' ? db - da : da - db;
    });
  const installed: Array<{o: Record<string, any>; p: Point2D; at: number}> = [];
  const schedule: ShiftTaskSchedule[] = [];
  const crewReturns: number[] = [];
  const stages: ShiftStage[] = [];
  const packages: Array<{p: Point2D; start: number; end: number}> = [];
  const stores: Array<{p: Point2D; angle: number}> = [];
  const alerts = new Set<string>(skippedZoneAlerts);

  let cleanTime = 0;
  let cleanPos: Point2D = gateP;
  let bag = 0;
  let binWalk = 0;
  let trips = 0;
  let crewTime = 0;
  const crewPos: Point2D = gateP;
  let truckTime = 0;

  function step(
    id: string,
    label: string,
    start: number,
    duration: number,
    from: Point2D,
    to: Point2D = from,
    info: Partial<ShiftStage> = {},
  ) {
    const end = start + Math.max(0.01, duration);
    stages.push({id, label, start, end, from, to, ...info});
    return end;
  }

  const walk = (
    id: string,
    label: string,
    t: number,
    a: Point2D,
    b: Point2D,
    speed: number,
    info?: Partial<ShiftStage>,
  ) => step(id, label, t, distance(a, b) / speed, a, b, info);

  function empty(): boolean {
    if (!bag) return true;
    if (!bins.length) {
      alerts.add(
        'Falta un contenedor accesible en el plano. Limpieza pendiente.',
      );
      return false;
    }
    const bin = bins.reduce((best, v) =>
      distance(cleanPos, v.p) < distance(cleanPos, best.p) ? v : best,
    );
    const meters = distance(cleanPos, bin.p);
    binWalk += meters;
    trips++;
    cleanTime = walk(
      'limpieza',
      'Bolsa al contenedor',
      cleanTime,
      cleanPos,
      bin.p,
      1,
      {litres: bag},
    );
    cleanPos = bin.p;
    cleanTime = step('limpieza', 'Vaciar bolsa', cleanTime, 15, cleanPos, cleanPos, {
      litres: bag,
    });
    bag = 0;
    return true;
  }

  function clean(
    sites: Array<{name: string; p: Point2D; litres: number}>,
    ready: number,
    label: string,
  ) {
    cleanTime = Math.max(cleanTime, ready);
    const remaining = sites.slice();
    while (remaining.length) {
      remaining.sort((a, b) => distance(cleanPos, a.p) - distance(cleanPos, b.p));
      const site = remaining.shift()!;
      let waste = site.litres;
      while (waste > 0.001) {
        if (bag >= capacity - 0.001 && !empty()) return;
        cleanTime = walk('limpieza', label, cleanTime, cleanPos, site.p, 1.1, {
          litres: bag,
        });
        cleanPos = site.p;
        const amount = Math.min(waste, capacity - bag);
        cleanTime = step(
          'limpieza',
          label + ' · ' + site.name,
          cleanTime,
          (amount * clamp(scene.cleanMin, 0, 480, 15)) / 5,
          cleanPos,
          cleanPos,
          {litres: bag, toLitres: bag + amount},
        );
        bag += amount;
        waste -= amount;
      }
    }
    empty();
  }

  const litter = (o: Record<string, any>, scale: number) => ({
    name: o.name,
    p: position(o as {x: number; y: number}, map),
    litres:
      clamp(scene.wasteLitres, 1, 150, 12) * scale * (o.type === 'food' ? 2 : 1),
  });

  if (phase === 'post') {
    clean(
      tasks.map(o => litter(o, night ? 1 : 0.4)),
      0,
      night ? 'Limpieza entre jornadas' : 'Primera limpieza',
    );
  }

  if (!night) {
    if (phase === 'post') truckTime = cleanTime;
    const {groups, missing} = allocate(structures, scene, phase);
    if (missing.length) {
      alerts.add('Sin empresa asignada: ' + missing.join(', '));
    }
    const bays = usableBays;
    const dockFree = bays.map(() => truckTime);
    const first = truckTime;
    const rand = rng((scene.seed || 2026) ^ (phase === 'post' ? 7919 : 104729));
    // Calcular total de camiones para escalonar llegadas aleatoriamente en una ventana de 10 min (600 s)
    const totalTrucks = groups.reduce(
      (n, g) => n + (g.jobs.length && g.res ? Math.min(g.res.trucks, g.res.forks) : 0),
      0
    );
    let globalTruckIdx = 0;

    for (const {c, jobs, res} of groups) {
      if (!jobs.length) continue;
      if (!res?.trucks || !res?.forks || !res?.people) {
        alerts.add(c.name + ' · recursos insuficientes');
        continue;
      }
      // Mantener orden espacial progresivo dentro de cada empresa (far-to-near en pre, near-to-far en post)
      jobs.sort((a, b) => {
        const da = distance(position(a as {x: number; y: number}, map), gateP);
        const db = distance(position(b as {x: number; y: number}, map), gateP);
        return phase === 'pre' ? db - da : da - db;
      });
      const truckSlots = Math.min(res.trucks, res.forks);
      const fleet = Array.from({length: truckSlots}, () => {
        const slotIndex = globalTruckIdx++;
        if (slotIndex === 0 || totalTrucks <= 1) return first;
        const baseStep = (600 / Math.max(1, totalTrucks - 1)) * slotIndex;
        const jitter = (rand() - 0.5) * 90; // ±45 s aleatorio, acotado a [60 s, 600 s]
        return first + Math.max(60, Math.min(600, Math.round(baseStep + jitter)));
      });
      let groupCrew = Math.min(...fleet);
      let groupPos: Point2D = gateP;

      for (let i = 0; i < jobs.length; i += batch) {
        const lane = fleet.indexOf(Math.min(...fleet));
        const bayIndex = dockFree.indexOf(Math.min(...dockFree));
        const currentDock = bays[bayIndex].p;
        let localTruckTime = Math.max(dockFree[bayIndex], fleet[lane]);
        let localCrewTime = groupCrew;
        let localCrewPos = groupPos;
        const localCrewCount = res.people;

        const id = 'Camión ' + (lane + 1) + ' · ' + c.name;
        const fork = 'Carretilla ' + (lane + 1) + ' · ' + c.name;
        let t =
          extBase && distance(truckStartP, gateP) > 1
            ? walk(id, 'Desde base exterior', localTruckTime, truckStartP, gateP, 2.2)
            : localTruckTime;
        t = walk(id, 'Entrada', t, gateP, yardP, 1.2);
        t = step(
          id,
          'Aparcando',
          t,
          60 * clamp(scene.parkMin, 0.5, 10, 2),
          yardP,
          currentDock,
        );
        const parked = t;
        t = step(
          'Operario ' + (1 + i / batch),
          'Bajar de cabina',
          t,
          10,
          currentDock,
          [currentDock[0] + 1.5, currentDock[1] + 1],
        );
        if (i === 0) {
          localCrewTime = Math.max(localCrewTime, t);
          localCrewPos = currentDock;
        }
        let forkPos = currentDock;

        for (const o of jobs.slice(i, i + batch)) {
          const p = position(o as {x: number; y: number}, map);
          const food = o.type === 'food';
          const cover = o.role === 'cover';
          const stage = o.type === 'stage' || o.role === 'stage';
          const table = o.kind === 'picnic' || o.type === 'rest';
          const angle = ((o.rotation || 0) * Math.PI) / 180;
          const rear: Point2D = [
            p[0] - Math.sin(angle) * ((o.depth || 2.5) / 2 + 1),
            p[1] + Math.cos(angle) * ((o.depth || 2.5) / 2 + 1),
          ];
          if (food) {
            stores.push({p: rear, angle: o.rotation || 0});
            if (
              !scene.infrastructure.some(
                a => a.kind === 'power' && membership(a).includes('event'),
              )
            ) {
              alerts.add('Foodtruck: suministro eléctrico por confirmar.');
            }
          }
          const target = food ? rear : p;
          const depSteps = dependencyStepsFor(o, phase);
          const baseMin =
            Number.isFinite(Number(o.assemblyMinutes)) && Number(o.assemblyMinutes) > 0
              ? Number(o.assemblyMinutes) * (phase === 'post' ? 0.75 : 1)
              : (phase === 'pre' ? (scene.setupMin ?? 10) : (scene.strikeMin ?? 7)) *
                (stage ? 2.5 : food ? 0.45 : cover ? 1.8 : table ? 0.35 : 1);

          if (phase === 'pre') {
            t = step(fork, 'Recoger bulto', t, 18, currentDock);
            t = walk(fork, 'Entrega · ' + o.name, t, currentDock, target, 0.9, {
              loaded: true,
            });
          }
          localCrewTime = walk(
            'Montadores · ' + c.name,
            'Al siguiente elemento',
            Math.max(localCrewTime, phase === 'post' ? cleanTime : parked),
            localCrewPos,
            target,
            1.1,
          );
          const taskStart = Math.max(localCrewTime, phase === 'pre' ? t : 0);
          const totalTaskSec = (60 * baseMin * 3) / Math.max(1, localCrewCount);
          const stepDur = totalTaskSec / depSteps.length;
          let curT = taskStart;
          for (const depName of depSteps) {
            curT = step(
              'Montadores · ' + c.name,
              `${depName} · ${o.name}`,
              curT,
              stepDur,
              target,
            );
          }
          localCrewTime = curT;
          localCrewPos = target;
          installed.push({o, p, at: localCrewTime});
          schedule.push({
            itemId: o.id,
            itemName: o.name,
            company: c.name,
            workers: localCrewCount,
            steps: depSteps,
            start: taskStart,
            end: localCrewTime,
            orderIndex: schedule.length,
          });

          if (phase === 'pre') {
            packages.push({p: target, start: t, end: taskStart});
            t = walk(fork, 'Regreso al camión', t, target, currentDock, 1.1);
          } else {
            t = walk(fork, 'Recoger material', t, forkPos, target, 0.95);
            packages.push({
              p: target,
              start: localCrewTime,
              end: Math.max(t, localCrewTime) + 12,
            });
            t = walk(
              fork,
              'Carga · ' + o.name,
              Math.max(t, localCrewTime) + 12,
              target,
              currentDock,
              0.85,
              {loaded: true},
            );
            forkPos = currentDock;
          }
        }
        step(id, 'En descarga / carga', parked, t - parked, currentDock);
        let exitT = walk(id, 'Salida', t, currentDock, gateP, 1.15);
        if (extBase && distance(truckStartP, gateP) > 1) {
          exitT = walk(id, 'Regreso a base', exitT, gateP, truckStartP, 2.2);
        }
        localTruckTime = exitT;

        groupCrew = localCrewTime;
        groupPos = localCrewPos;
        fleet[lane] = localTruckTime;
        dockFree[bayIndex] = t;
      }
      crewReturns.push(
        walk(
          'Montadores · ' + c.name,
          'Salida del equipo',
          groupCrew,
          groupPos,
          gateP,
          1.1,
        ),
      );
      truckTime = Math.max(truckTime, ...fleet);
    }
    crewTime = Math.max(0, ...crewReturns);
    clean(
      structures.map(o => litter(o, phase === 'pre' ? 0.2 : 0.6)),
      Math.max(crewTime, truckTime),
      phase === 'pre' ? 'Limpieza de montaje' : 'Limpieza final',
    );
  }

  void dock;
  void crewPos;
  const total = Math.max(cleanTime, truckTime, crewTime);
  const phaseWorkDays = (scene.workDays || []).filter(
    d => d.kind === phase && Number.isFinite(d.hours) && d.hours > 0,
  );
  const configuredHours = phaseWorkDays.length
    ? phaseWorkDays.reduce((sum, d) => sum + clamp(d.hours, 0.5, 12, 8), 0)
    : clamp(scene.hoursLimit, 0.5, 8, 8);
  const limitSeconds = 3600 * configuredHours;
  if (phaseWorkDays.length && total > limitSeconds) {
    const missingH = ((total - limitSeconds) / 3600).toFixed(1);
    const names = phaseWorkDays.map(d => `${d.name} (${d.hours} h)`).join(', ');
    alerts.add(
      `Faltan ${missingH} h para completar el trabajo dentro de las jornadas planificadas: ${names}.`,
    );
  }
  return {
    installed,
    schedule,
    required: structures.length,
    stages,
    packages,
    stores,
    total,
    team: crew,
    limit: limitSeconds,
    phase,
    capacity,
    binWalk,
    trips,
    alerts: [...alerts],
    days: phaseWorkDays.length || days,
    night,
  };
}

/**
 * Evalúa el estado instantáneo del turno logístico en el segundo indicado.
 */
export function shiftAt(plan: ShiftPlan, seconds: number) {
  const time = Math.min(seconds, plan.total, plan.limit);
  const done = time >= Math.min(plan.total, plan.limit);
  const actors = plan.stages
    .filter(o => o.start <= time && time < o.end)
    .map(o => {
      const u = (time - o.start) / (o.end - o.start);
      return {
        ...o,
        x: o.from[0] + (o.to[0] - o.from[0]) * u,
        y: o.from[1] + (o.to[1] - o.from[1]) * u,
        litres:
          (o.litres || 0) +
          ((o.toLitres ?? o.litres ?? 0) - (o.litres || 0)) * u,
        angle:
          (Math.atan2(o.to[1] - o.from[1], o.to[0] - o.from[0]) * 180) /
          Math.PI,
      };
    });
  const label = done
    ? plan.total > plan.limit
      ? 'Fin de turno · trabajo pendiente'
      : plan.alerts.length
        ? 'Fin del recorrido · revisar pendientes'
        : 'Trabajo terminado'
    : actors
        .map(
          a =>
            a.id +
            ' · ' +
            a.label +
            (a.id === 'limpieza'
              ? ' ' + a.litres.toFixed(0) + '/' + plan.capacity + ' L'
              : ''),
        )
        .join(' | ');
  return {done, time, label, actors};
}

/**
 * Genera el fragmento SVG de la capa `#shift-layer` para visualizar camiones, carretillas y cuadrillas.
 */
export function shiftSVG(
  plan: ShiftPlan,
  state: ReturnType<typeof shiftAt>,
): string {
  const areas = plan.stores
    .map(
      o =>
        '<g transform="translate(' +
        o.p.join(' ') +
        ') rotate(' +
        o.angle +
        ')"><rect x="-1" y="-1" width="2" height="2" fill="#e3bd78" stroke="#795528" stroke-width=".16" stroke-dasharray=".3 .1"/><title>Reserva trasera · 4 m²</title></g>',
    )
    .join('');
  const boxes = plan.packages
    .filter(b => state.time >= b.start && state.time < b.end)
    .map(
      b =>
        '<rect x="' +
        b.p[0] +
        '" y="' +
        b.p[1] +
        '" width="1" height=".8" fill="#ae713f"/>',
    )
    .join('');
  const built = (plan.installed || [])
    .filter(j =>
      plan.phase === 'pre' ? j.at <= state.time : j.at > state.time,
    )
    .map(
      ({o, p}) =>
        '<g transform="translate(' +
        p.join(' ') +
        ') rotate(' +
        (o.rotation || 0) +
        ')"><rect x="' +
        -(o.width || 4) / 2 +
        '" y="' +
        -(o.depth || 3) / 2 +
        '" width="' +
        (o.width || 4) +
        '" height="' +
        (o.depth || 3) +
        '" fill="#a3bb8b" stroke="#314c42" stroke-width=".25"/><title>' +
        text(o.name) +
        '</title></g>',
    )
    .join('');
  return (
    built +
    areas +
    boxes +
    state.actors
      .map(a => {
        const truck = a.id.startsWith('Camión');
        const fork = a.id.startsWith('Carretilla');
        const crew = a.id.startsWith('Montadores');
        return (
          '<g transform="translate(' +
          a.x +
          ' ' +
          a.y +
          ')"><g transform="rotate(' +
          a.angle +
          ')">' +
          (truck
            ? '<rect x="-4" y="-1.4" width="8" height="2.8" rx=".3" fill="#355873"/><rect x="2" y="-1.3" width="1.6" height="2.6" fill="#799caf"/>'
            : fork
              ? '<rect x="-1" y="-.6" width="2" height="1.2" fill="#a67931"/><path d="M1 -.4h1 M1 .4h1" stroke="#604728" stroke-width=".16"/>' +
                (a.loaded
                  ? '<rect x="1" y="-.4" width=".8" height=".8" fill="#995d35"/>'
                  : '')
              : Array.from(
                  {length: crew ? plan.team : 1},
                  (_, i) =>
                    '<circle cx="' +
                    (i % 3) * 0.7 +
                    '" cy="' +
                    Math.floor(i / 3) * 0.75 +
                    '" r=".32" fill="' +
                    (crew ? '#1c656a' : '#843e78') +
                    '"/>',
                ).join('')) +
          '</g><text y="-2" font-size="1.5" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width=".35">' +
          text(a.id) +
          '</text></g>'
        );
      })
      .join('')
  );
}
