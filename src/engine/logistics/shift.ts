/**
 * @module engine/logistics/shift
 * Motor de simulación de turnos logísticos (Pre-evento y Postevento):
 * camiones, carretillas, cuadrillas de montaje/desmontaje y recogida de residuos.
 */
import {allocate} from './companies';
import {membership} from './phases';
import type {MapMetadata, PhaseKey, Point2D, Scene} from '../../types';

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

export interface ShiftPlan {
  error?: string;
  installed: Array<{o: Record<string, any>; p: Point2D; at: number}>;
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
  const bay = assets.find(o => o.kind === 'loading');
  const yard = assets.find(o => o.kind === 'turning');
  const gate =
    scene.entrances.find(o => membership(o).includes(phase)) ||
    scene.entrances[0];
  const days = Math.round(clamp(scene.eventDays, 1, 30, 1));
  const night =
    phase === 'post' && (scene.cleanDay || 0) > 0 && (scene.cleanDay || 0) < days;

  if (!gate || (!night && (!bay || !yard))) {
    return {
      error:
        'Indica el acceso, la descarga y la maniobra. La limpieza calcula su propio recorrido.',
    } as ShiftPlan;
  }
  const gateP = position(gate, map);
  const dock = bay ? position(bay, map) : gateP;
  const yardP = yard ? position(yard, map) : gateP;

  if (!night && yard && Math.min(yard.width, yard.depth) < 3) {
    return {
      error:
        'La reserva de maniobra es demasiado estrecha para el camión supuesto.',
    } as ShiftPlan;
  }

  const bins = assets
    .filter(o => o.kind === 'bin')
    .map(o => ({name: o.name, p: position(o, map)}));
  const capacity = clamp(scene.bagLitres, 5, 240, 60);
  const crew = Math.round(clamp(scene.teamSize, 2, 6, 3));
  const batch = Math.round(clamp(scene.truckBatch, 1, 24, 5));
  const tasks = [
    ...scene.base.booths,
    ...scene.infrastructure.filter(
      o => o.role === 'cover' || o.kind === 'picnic',
    ),
  ].filter(o => membership(o).some(p => p === phase || p === 'event'));

  const structures = tasks.filter(
    o =>
      (o as any).type !== 'stage' &&
      (o as any).role !== 'stage' &&
      !(scene.progressByPhase?.[phase] || []).includes(o.id),
  );
  const installed: Array<{o: Record<string, any>; p: Point2D; at: number}> = [];
  const crewReturns: number[] = [];
  const stages: ShiftStage[] = [];
  const packages: Array<{p: Point2D; start: number; end: number}> = [];
  const stores: Array<{p: Point2D; angle: number}> = [];
  const alerts = new Set<string>();

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
    const bays = assets.filter(o => o.kind === 'loading');
    const dockFree = bays.map(() => truckTime);
    const first = truckTime;

    for (const {c, jobs, res} of groups) {
      if (!jobs.length) continue;
      if (!res?.trucks || !res?.forks || !res?.people) {
        alerts.add(c.name + ' · recursos insuficientes');
        continue;
      }
      const fleet = Array.from(
        {length: Math.min(res.trucks, res.forks)},
        () => first,
      );
      let groupCrew = first;
      let groupPos: Point2D = gateP;

      for (let i = 0; i < jobs.length; i += batch) {
        const lane = fleet.indexOf(Math.min(...fleet));
        const bayIndex = dockFree.indexOf(Math.min(...dockFree));
        const currentDock = position(bays[bayIndex], map);
        let localTruckTime = Math.max(dockFree[bayIndex], fleet[lane]);
        let localCrewTime = groupCrew;
        let localCrewPos = groupPos;
        const localCrewCount = res.people;

        const id = 'Camión ' + (lane + 1) + ' · ' + c.name;
        const fork = 'Carretilla ' + (lane + 1) + ' · ' + c.name;
        let t = walk(id, 'Entrada', localTruckTime, gateP, yardP, 1.2);
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
          const label = food
            ? 'Preparar toma y vallas'
            : phase === 'pre'
              ? 'Montar'
              : 'Desmontar';
          const minutes =
            (phase === 'pre' ? (scene.setupMin ?? 10) : (scene.strikeMin ?? 7)) *
            (food ? 0.45 : cover ? 1.8 : table ? 0.35 : 1);

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
          const start = Math.max(localCrewTime, phase === 'pre' ? t : 0);
          localCrewTime = step(
            'Montadores · ' + c.name,
            label + ' · ' + o.name,
            start,
            (60 * minutes * 3) / localCrewCount,
            target,
          );
          localCrewPos = target;
          installed.push({o, p, at: localCrewTime});

          if (phase === 'pre') {
            packages.push({p: target, start: t, end: start});
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
        localTruckTime = walk(id, 'Salida', t, currentDock, gateP, 1.15);

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
  return {
    installed,
    required: structures.length,
    stages,
    packages,
    stores,
    total,
    team: crew,
    limit: 3600 * clamp(scene.hoursLimit, 0.5, 8, 8),
    phase,
    capacity,
    binWalk,
    trips,
    alerts: [...alerts],
    days,
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
