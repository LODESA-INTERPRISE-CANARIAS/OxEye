import type {
  Booth,
  Infrastructure,
  Point,
  PolygonElement,
  Scene,
  VenueMap,
} from '../../types';
import {inside, rect} from '../cartography/geometry';
import {buildGrid, flow} from '../crowd/grid-flow';

const kinds: Array<{
  type: 'commerce' | 'rest' | 'cover';
  name: string;
  width: number;
  depth: number;
  weight: 'commerce' | 'rest' | 'cover';
}> = [
  {type: 'commerce', name: 'Puesto', width: 4, depth: 3, weight: 'commerce'},
  {type: 'rest', name: 'Descanso', width: 5, depth: 3, weight: 'rest'},
  {type: 'cover', name: 'Carpa', width: 6, depth: 6, weight: 'cover'},
];

const cross = (a: Point, b: Point, c: Point): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  ) {
    return false;
  }
  return (
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0
  );
}

function edges(poly: Point[]): Array<[Point, Point]> {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}

function overlaps(a: Point[], b: Point[]): boolean {
  return (
    inside(a[0], b) ||
    inside(b[0], a) ||
    edges(a).some(([p, q]) =>
      edges(b).some(([r, s]) => crosses(p, q, r, s))
    )
  );
}

export interface LayoutOptions {
  count: number;
  space: number;
  scale: number;
  commerce: number;
  rest: number;
  cover: number;
  seed: number;
  onlyMove?: boolean;
  strategy?: number;
  allowReplan?: boolean;
  objectiveFocus?:
    | 'spatial_efficiency'
    | 'visitor_experience'
    | 'economic_balance'
    | 'family'
    | 'commerce'
    | 'gastronomy'
    | 'music'
    | 'logistics';
}

/**
 * Generates new installations on free navigable cells respecting boundary, reserves, and corridors.
 *
 * @param scene - Current scene.
 * @param map - Georeferenced venue map.
 * @param opts - Layout generation options.
 * @returns Generated objects and summary reason.
 */
export function generateLayout(
  scene: Scene,
  map: VenueMap,
  opts: LayoutOptions
) {
  const count = Math.max(
    0,
    Math.min(
      opts.count,
      500 -
        scene.base.booths.length -
        scene.infrastructure.length -
        scene.entrances.length
    )
  );
  const toMeters = (points: Point[]): Point[] =>
    points.map(([x, y]) => [
      (x * map.widthMeters) / 100,
      (y * map.heightMeters) / 100,
    ]);
  const boundary = toMeters(scene.boundary);
  const perimeter = edges(boundary);
  const occupied = [...scene.base.booths, ...scene.infrastructure]
    .map((o) => rect(o, map))
    .concat(scene.reserves.map((o) => toMeters(o.points)));
  const passages = [
    ...(scene.flows || []),
    ...(scene.roadPlans || []),
    ...(scene.corridors || []),
    ...(scene.fences || []),
  ];
  const lines: Point[][] = passages.flatMap((o) => {
    const p = toMeters(o.points);
    const half = (o.width || 1) / 2;
    return p.slice(1).flatMap((q, i) => {
      const a = p[i];
      const dx = q[0] - a[0];
      const dy = q[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (!len) return [];
      const u = (-dy / len) * half;
      const v = (dx / len) * half;
      return [
        [
          [a[0] + u, a[1] + v],
          [q[0] + u, q[1] + v],
          [q[0] - u, q[1] - v],
          [a[0] - u, a[1] - v],
        ] as Point[],
      ];
    });
  });

  const grid = buildGrid(scene);
  const entrances = scene.entrances.filter((g) =>
    ['both', 'in', 'free'].includes(g.phases?.event || g.role || '')
  );
  const gateCells = entrances
    .map((g) =>
      grid.nearest(
        (g.x * map.widthMeters) / 100,
        (g.y * map.heightMeters) / 100,
        8
      )
    )
    .filter((k) => k >= 0);
  const reference = gateCells.length ? flow(grid, gateCells[0]) : null;
  let random = opts.seed >>> 0;
  const next = (): number =>
    ((random = (1664525 * random + 1013904223) >>> 0) / 4294967296);

  const minX = Math.min(...boundary.map((p) => p[0]));
  const maxX = Math.max(...boundary.map((p) => p[0]));
  const minY = Math.min(...boundary.map((p) => p[1]));
  const maxY = Math.max(...boundary.map((p) => p[1]));
  const weights = kinds.map((k) => Math.max(0, opts[k.weight] || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objects: any[] = [];
  const used = [0, 0, 0];
  if (!sum) {
    return {objects, reason: 'Sube al menos una prioridad.', count};
  }

  for (let i = 0; i < count; i++) {
    const priority = weights.map((w, j) =>
      w ? ((i + 1) * w) / sum - used[j] : -Infinity
    );
    const j = priority.indexOf(Math.max(...priority));
    const kind = kinds[j];
    used[j]++;
    for (let attempt = 0; attempt < 180; attempt++) {
      const x = minX + (maxX - minX) * next();
      const y = minY + (maxY - minY) * next();
      const k = grid.index(x, y);
      if (k < 0 || !grid.free[k] || (reference && reference[k] < 0)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o: any = {
        id: 'auto-' + opts.seed + '-' + i,
        name: kind.name + ' · ' + (i + 1),
        kind: kind.type,
        x: (100 * x) / map.widthMeters,
        y: (100 * y) / map.heightMeters,
        width: kind.width * (opts.scale || 1),
        depth: kind.depth * (opts.scale || 1),
        rotation: next() < 0.5 ? 0 : 90,
      };
      const footprint = rect(
        {
          ...o,
          width: o.width + 2 * opts.space,
          depth: o.depth + 2 * opts.space,
        },
        map
      );
      if (
        !footprint.every((p) => inside(p, boundary)) ||
        edges(footprint).some(([a, b]) =>
          perimeter.some(([c, d]) => crosses(a, b, c, d))
        )
      ) {
        continue;
      }
      if ([...occupied, ...lines].some((p) => overlaps(footprint, p))) continue;
      if (
        scene.entrances.some(
          (g) =>
            Math.hypot(
              (g.x * map.widthMeters) / 100 - x,
              (g.y * map.heightMeters) / 100 - y
            ) <
            Math.hypot(o.width, o.depth) / 2 + opts.space + 2
        )
      ) {
        continue;
      }
      o.area = o.width * o.depth;
      if (kind.type === 'cover') {
        o.role = 'cover';
        o.capacity = 12;
      } else {
        Object.assign(o, {
          type: kind.type,
          price: j === 0 ? 10 : 0,
          interest: 1,
          time: 5,
          labTime: 5,
          labCapacity: j === 0 ? 3 : 10,
          open: 0,
          close: scene.base.hours,
        });
      }
      objects.push(o);
      occupied.push(rect(o, map));
      break;
    }
  }

  const reason = [
    objects.length < count
      ? 'Solo caben ' +
        objects.length +
        ' de ' +
        count +
        ' piezas con estas restricciones.'
      : 'Se ha generado la cantidad solicitada.',
    reference
      ? 'Revisa los recorridos tras añadir las piezas.'
      : 'Falta una entrada pública conectada para ensayar.',
  ].join(' ');
  return {objects, reason, count};
}

/**
 * Scores existing placements by proximity to other installations and public entrances,
 * and suggests local adjustments (`moves`).
 *
 * @param scene - Active scene.
 * @param map - Georeferenced venue map.
 * @param opts - Layout options.
 * @param whole - Full scene reference.
 * @returns Rebalanced moves and optional generated objects.
 */
export function rebalance(
  scene: Scene,
  map: VenueMap,
  opts: LayoutOptions,
  whole: Scene = scene
) {
  const working = structuredClone(whole);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moves: any[] = [];
  const boxes = (): Array<Booth | Infrastructure> => [
    ...working.base.booths,
    ...working.infrastructure,
  ];
  const pt = (o: {x: number; y: number}): Point => [
    (o.x * map.widthMeters) / 100,
    (o.y * map.heightMeters) / 100,
  ];
  const separation = (a: Point, b: Point): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);
  const polygon = (ps: Point[]): Point[] => ps.map(([x, y]) => pt({x, y}));
  const bound = polygon(working.boundary);
  const edgesB = edges(bound);
  const gates = working.entrances.map(pt);
  const excluded = working.reserves.map((o) => polygon(o.points));
  const segments = [
    ...working.fences,
    ...(working.flows || []),
    ...(working.roadPlans || []),
    ...(working.corridors || []),
  ].flatMap((o) => {
    const p = polygon(o.points);
    return p.slice(1).map((q, i) => [p[i], q, (o.width || 1) / 2] as [Point, Point, number]);
  });

  const grid = buildGrid(scene);
  const entry = scene.entrances.find((g) =>
    ['in', 'both', 'free'].includes(g.phases?.event || g.role || '')
  );
  const field = entry
    ? flow(grid, grid.nearest(...pt(entry), 8))
    : null;
  const eligible = scene.base.booths.filter((o) => !o.locked);

  function penalty(
    o: Booth | Infrastructure,
    others: Array<Booth | Infrastructure>
  ): number {
    const p = pt(o);
    const radius = Math.hypot(o.width || 4, o.depth || 3) / 2;
    const neighbor = Math.min(
      30,
      ...others.map(
        (b) =>
          separation(p, pt(b)) - radius - Math.hypot(b.width || 4, b.depth || 3) / 2
      )
    );
    const gate = Math.min(30, ...gates.map((q) => separation(p, q) - radius));
    const oType = (o as Booth).type;
    const quiet = ['rest', 'workshop'].includes(oType || '');
    const music = others.filter((b) => (b as Booth).type === 'stage');
    const dining = others.filter((b) => (b as Booth).type === 'food');
    const mix =
      (quiet
        ? Math.max(0, 18 - Math.min(40, ...music.map((b) => separation(p, pt(b))))) *
          0.5
        : 0) +
      (oType === 'rest'
        ? Math.max(
            0,
            Math.min(50, ...dining.map((b) => separation(p, pt(b)))) - 20
          ) * 0.15
        : 0);
    return (
      mix +
      Math.max(0, opts.space + 4 - neighbor) +
      2 * Math.max(0, opts.space + 5 - gate)
    );
  }

  const ranked = eligible
    .map((o) => ({
      id: o.id,
      cost: penalty(
        o,
        boxes().filter(
          (b) => b.id !== o.id && (b as Infrastructure).role !== 'cover'
        )
      ),
    }))
    .sort((a, b) => b.cost - a.cost);

  for (const item of ranked) {
    if (moves.length >= Math.min(6, Math.max(1, opts.count))) break;
    const o = working.base.booths.find((b) => b.id === item.id);
    if (!o) continue;
    const others = boxes().filter((b) => b.id !== o.id);
    const solid = others.filter(
      (b) => (b as Infrastructure).role !== 'cover'
    );
    if (
      others.some(
        (b) =>
          (b as Infrastructure).role === 'cover' &&
          overlaps(rect(o, map), rect(b, map))
      )
    ) {
      continue;
    }
    const from = pt(o);
    const old = penalty(o, solid);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let best: any = null;
    for (const meters of [2, 4, 6, 9, 13]) {
      for (let bearing = (opts.seed || 0) % 30; bearing < 360; bearing += 30) {
        const angle = (bearing * Math.PI) / 180;
        const x = from[0] + meters * Math.sin(angle);
        const y = from[1] - meters * Math.cos(angle);
        const next = {
          ...o,
          x: (100 * x) / map.widthMeters,
          y: (100 * y) / map.heightMeters,
        };
        const margin = opts.space;
        const poly = rect(
          {
            ...next,
            width: (o.width || 4) + margin,
            depth: (o.depth || 3) + margin,
          },
          map
        );
        const e = edges(poly);
        if (
          !poly.every((p) => inside(p, bound)) ||
          edgesB.some(([a, b]) => e.some(([c, d]) => crosses(a, b, c, d)))
        ) {
          continue;
        }
        if (
          excluded.some((r) => overlaps(poly, r)) ||
          others.some((b) => overlaps(poly, rect(b, map)))
        ) {
          continue;
        }
        if (
          segments.some(([a, b, w]) => {
            const len = separation(a, b) || 1;
            const u = (-(b[1] - a[1]) * w) / len;
            const v = ((b[0] - a[0]) * w) / len;
            return overlaps(poly, [
              [a[0] + u, a[1] + v],
              [b[0] + u, b[1] + v],
              [b[0] - u, b[1] - v],
              [a[0] - u, a[1] - v],
            ]);
          })
        ) {
          continue;
        }
        if (
          gates.some(
            (g) =>
              separation([x, y], g) <
              Math.hypot(next.width || 4, next.depth || 3) / 2 + margin + 2
          )
        ) {
          continue;
        }
        const cell = grid.index(x, y);
        if (cell < 0 || !grid.free[cell] || (field && field[cell] < 0)) {
          continue;
        }
        const gain = old - penalty(next, solid) - meters * 0.08;
        if (gain > 0.4 && (!best || gain > best.gain)) {
          best = {...next, from, meters, bearing, gain};
        }
      }
    }
    if (best) {
      o.x = best.x;
      o.y = best.y;
      moves.push(best);
    }
  }

  const active = structuredClone(scene);
  for (const o of moves) {
    const b = active.base.booths.find((st) => st.id === o.id);
    if (b) {
      b.x = o.x;
      b.y = o.y;
    }
  }
  const result = opts.onlyMove
    ? {objects: [], reason: 'Solo se evalúan las piezas existentes.'}
    : generateLayout(active, map, opts);
  return {...result, moves};
}

/**
 * Recomposes whole activity areas while keeping each canopy with its contents.
 *
 * @param scene - Active scene.
 * @param map - Georeferenced venue map.
 * @param options - Layout options.
 * @returns Moved groups and summary.
 */
export function composeAreas(
  scene: Scene,
  map: VenueMap,
  options: LayoutOptions
) {
  const working = structuredClone(scene);
  const all: Array<Booth | Infrastructure> = [
    ...working.base.booths,
    ...working.infrastructure,
  ];
  const meters = (o: {x: number; y: number}): Point => [
    (o.x * map.widthMeters) / 100,
    (o.y * map.heightMeters) / 100,
  ];
  const toM = (points: Point[]): Point[] =>
    points.map(([x, y]) => meters({x, y}));
  let seed = options.seed >>> 0;
  const random = (): number =>
    ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);

  const groups: Array<Array<Booth | Infrastructure>> = [];
  const assigned = new Set<string>();
  for (const roof of working.infrastructure.filter((o) => o.role === 'cover')) {
    const outline = rect(roof, map);
    const members = all.filter(
      (o) =>
        !assigned.has(o.id) &&
        o.id !== roof.id &&
        (working.base.booths.includes(o as Booth) ||
          (o as Infrastructure).role === 'furniture') &&
        inside(meters(o), outline)
    );
    const group = [roof, ...members];
    group.forEach((o) => assigned.add(o.id));
    groups.push(group);
  }
  for (const o of working.base.booths) {
    if (!assigned.has(o.id)) groups.push([o]);
  }
  const fixed = all.filter((o) => !groups.some((g) => g.includes(o)));
  const boundary = toM(scene.boundary);
  const limits = edges(boundary);
  const reserves = scene.reserves.map((r) => toM(r.points));
  const lanes: Point[][] = [
    ...(scene.flows || []),
    ...(scene.corridors || []),
    ...(scene.roadPlans || []),
    ...(scene.fences || []),
  ].flatMap((r) => {
    const points = toM(r.points);
    return points.slice(1).map((b, i) => {
      const a = points[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const w = (r.width || 0.6) / 2;
      const u = (-dy * w) / l;
      const v = (dx * w) / l;
      return [
        [a[0] + u, a[1] + v],
        [b[0] + u, b[1] + v],
        [b[0] - u, b[1] - v],
        [a[0] - u, a[1] - v],
      ] as Point[];
    });
  });
  const obstacles = [
    ...reserves,
    ...lanes,
    ...fixed.map((o) => rect(o, map)),
    ...scene.entrances.map((g) => rect({...g, width: 4, depth: 4}, map)),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moves: any[] = [];
  const changes: string[] = [];
  const used = new Set<Array<Booth | Infrastructure>>();

  function place(
    group: Array<Booth | Infrastructure>,
    dx: number,
    dy: number
  ): Array<Booth | Infrastructure> {
    return group.map((o) => ({
      ...o,
      x: o.x + (dx / map.widthMeters) * 100,
      y: o.y + (dy / map.heightMeters) * 100,
    }));
  }

  function valid(
    group: Array<Booth | Infrastructure>,
    other: Array<Booth | Infrastructure>
  ): boolean {
    const solids = [...obstacles, ...other.map((o) => rect(o, map))];
    return group.every((o) => {
      const p = rect(o, map);
      return (
        p.every((q) => inside(q, boundary)) &&
        !edges(p).some(([a, b]) =>
          limits.some(([c, d]) => crosses(a, b, c, d))
        ) &&
        !solids.some((poly) => overlaps(p, poly))
      );
    });
  }

  function commit(
    group: Array<Booth | Infrastructure>,
    placed: Array<Booth | Infrastructure>
  ): void {
    const from = meters(group[0]);
    const to = meters(placed[0]);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    group.forEach((o, i) => {
      moves.push({
        ...placed[i],
        from: meters(o),
        meters: Math.round(Math.hypot(dx, dy)),
        bearing: Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360),
      });
      Object.assign(o, {x: placed[i].x, y: placed[i].y});
    });
    used.add(group);
    changes.push(group[0].name + ' (' + group.length + ' piezas)');
  }

  const ordered = groups
    .map((g) => ({g, r: random()}))
    .sort(
      (a, b) =>
        Number(b.g.length > 1) - Number(a.g.length > 1) || a.r - b.r
    )
    .map((v) => v.g);

  for (const a of ordered) {
    if (used.has(a) || a.some((o) => o.locked) || used.size >= 6) continue;
    const from = meters(a[0]);
    const pairs = ordered
      .filter(
        (b) =>
          a !== b &&
          !used.has(b) &&
          !b.some((o) => o.locked) &&
          (a.length > 1) === (b.length > 1)
      )
      .map((b) => ({b, r: random()}))
      .sort((x, y) => x.r - y.r);
    for (const {b} of pairs) {
      const dest = meters(b[0]);
      const dx = dest[0] - from[0];
      const dy = dest[1] - from[1];
      if (Math.hypot(dx, dy) < 5) continue;
      const pa = place(a, dx, dy);
      const pb = place(b, -dx, -dy);
      const others = groups.filter((g) => g !== a && g !== b).flat();
      const sameFootprints = (
        next: Array<Booth | Infrastructure>,
        current: Array<Booth | Infrastructure>
      ) =>
        next.length === current.length &&
        next.every((o) =>
          current.some((q) => {
            const mo = meters(o);
            const mq = meters(q);
            return (
              Math.hypot(mo[0] - mq[0], mo[1] - mq[1]) < 0.02 &&
              Math.abs((o.width || 4) - (q.width || 4)) < 0.01 &&
              Math.abs((o.depth || 3) - (q.depth || 3)) < 0.01 &&
              (o.rotation || 0) === (q.rotation || 0)
            );
          })
        );
      const unchangedOccupation =
        sameFootprints(pa, b) && sameFootprints(pb, a);
      if (
        unchangedOccupation ||
        (valid(pa, [...others, ...pb]) && valid(pb, [...others, ...pa]))
      ) {
        commit(a, pa);
        commit(b, pb);
        break;
      }
    }
    if (used.has(a)) continue;
    const others = groups.filter((g) => g !== a).flat();
    for (let j = 0; j < 160; j++) {
      const angle = random() * 2 * Math.PI;
      const l = 5 + random() * 22;
      const placed = place(a, l * Math.sin(angle), l * Math.cos(angle));
      if (valid(placed, others)) {
        commit(a, placed);
        break;
      }
    }
  }

  const additions = options.onlyMove
    ? []
    : generateLayout(working, map, options).objects;
  return {
    moves,
    objects: additions,
    changes,
    reason: changes.length
      ? 'Zonas redistribuidas: ' + changes.join(' · ')
      : 'Sin alternativa admisible para estas zonas y restricciones.',
  };
}

/**
 * Redesigns a floor plan using 2D prefix-sum grid placement and one of three spatial strategies:
 * `0` (Patio central), `1` (Paseo longitudinal), or `2` (Islas de actividad).
 *
 * @param scene - Active scene.
 * @param map - Georeferenced venue map.
 * @param opts - Redesign options.
 * @param previous - Previously generated zone bounding boxes to maximize diversity.
 * @returns Redesigned moves, zones, routing, and summary reason.
 */
export function redesign(
  scene: Scene,
  map: VenueMap,
  opts: Partial<LayoutOptions> & {seed: number; space: number},
  previous: Array<Array<{x: number; y: number; w: number; h: number}>> = []
) {
  let seed = opts.seed >>> 0;
  const rand = (): number =>
    ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const point = (o: {x: number; y: number}): Point => [
    (o.x * map.widthMeters) / 100,
    (o.y * map.heightMeters) / 100,
  ];
  const coords = (ps: Point[]): Point[] => ps.map(([x, y]) => point({x, y}));
  const keepLine = (l: PolygonElement) =>
    opts.allowReplan === false ||
    ![
      'branch-food',
      'branch-shops',
      'branch-stage',
      'branch-market',
    ].includes(l.id || '') ||
    l.locked;
  const routing = {
    fences: (scene.fences || []).filter(
      (f) =>
        opts.allowReplan === false ||
        f.locked ||
        !/^(queue-[0-3]-[01]|fence-stage-[ab]|fence-service)$/.test(f.id || '')
    ),
    flows: (scene.flows || []).filter(keepLine),
    corridors: (scene.corridors || []).filter(keepLine),
  };

  const bound = coords(scene.boundary);
  const xs = bound.map((p) => p[0]);
  const ys = bound.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const W = Math.max(...xs) - x0;
  const H = Math.max(...ys) - y0;
  const all: Array<Booth | Infrastructure> = [
    ...scene.base.booths,
    ...scene.infrastructure,
  ];
  const taken = new Set<Booth | Infrastructure>();
  const groups: Array<Array<Booth | Infrastructure>> = [];

  for (const roof of scene.infrastructure.filter((o) => o.role === 'cover')) {
    const members = all.filter(
      (o) =>
        !taken.has(o) &&
        o !== roof &&
        (scene.base.booths.includes(o as Booth) ||
          (o as Infrastructure).role === 'furniture') &&
        (o.coverGroup
          ? o.coverGroup === roof.id
          : inside(point(o), rect(roof, map)))
    );
    const group = [roof, ...members];
    group.forEach((o) => taken.add(o));
    groups.push(group);
  }
  for (const o of scene.base.booths) {
    if (!taken.has(o)) groups.push([o]);
  }
  const movable = groups.filter((g) => !g.some((o) => o.locked));
  const mobile = new Set(movable.flat());
  const obstacles = all
    .filter((o) => !mobile.has(o))
    .map((o) => rect(o, map))
    .concat(
      scene.reserves.map((o) => coords(o.points)),
      (scene.passages || [])
        .filter((o) => o.origin === 'interest-zone')
        .map((o) => coords(o.points)),
      scene.entrances.map((o) => rect({...o, width: 5, depth: 5}, map))
    );

  for (const line of [
    ...routing.fences,
    ...routing.flows,
    ...routing.corridors,
    ...(scene.roadPlans || []),
  ]) {
    const pts = coords(line.points);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const w = (line.width || 0.6) / 2;
      const u = (-dy * w) / l;
      const v = (dx * w) / l;
      obstacles.push([
        [a[0] + u, a[1] + v],
        [b[0] + u, b[1] + v],
        [b[0] - u, b[1] - v],
        [a[0] - u, a[1] - v],
      ]);
    }
  }

  const nx = Math.ceil(W) + 3;
  const ny = Math.ceil(H) + 3;
  const mask = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i;
      const y = y0 + j;
      const cell: Point[] = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      if (
        !cell.every((p) => inside(p, bound)) ||
        edges(cell).some(([a, b]) =>
          edges(bound).some(([c, d]) => crosses(a, b, c, d))
        )
      ) {
        mask[j * nx + i] = 1;
      }
    }
  }

  function paint(poly: Point[]): void {
    const pxs = poly.map((p) => p[0] - x0);
    const pys = poly.map((p) => p[1] - y0);
    for (
      let j = Math.max(0, Math.floor(Math.min(...pys)) - 1);
      j <= Math.min(ny - 1, Math.ceil(Math.max(...pys)));
      j++
    ) {
      for (
        let i = Math.max(0, Math.floor(Math.min(...pxs)) - 1);
        i <= Math.min(nx - 1, Math.ceil(Math.max(...pxs)));
        i++
      ) {
        const x = x0 + i;
        const y = y0 + j;
        if (
          overlaps(poly, [
            [x, y],
            [x + 1, y],
            [x + 1, y + 1],
            [x, y + 1],
          ])
        ) {
          mask[j * nx + i] = 1;
        }
      }
    }
  }

  obstacles.forEach(paint);
  const groupData = movable.map((g) => {
    const pts = g.flatMap((o) => rect(o, map));
    const gxs = pts.map((p) => p[0]);
    const gys = pts.map((p) => p[1]);
    const w = Math.max(...gxs) - Math.min(...gxs);
    const h = Math.max(...gys) - Math.min(...gys);
    return {
      g,
      w,
      h,
      c: [Math.min(...gxs) + w / 2, Math.min(...gys) + h / 2] as Point,
    };
  });

  const strategy = opts.strategy || 0;
  const names = ['Patio central', 'Paseo longitudinal', 'Islas de actividad'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let best: any = null;
  const fixedMask = mask.slice();

  for (let trial = 0; trial < 80; trial++) {
    mask.set(fixedMask);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moves: any[] = [];
    const zones: Array<{id: string; x: number; y: number; w: number; h: number}> =
      [];
    const ordered = groupData
      .map((d) => ({...d, rank: d.w * d.h * (0.7 + 0.6 * rand())}))
      .sort((a, b) => b.rank - a.rank);
    const selected =
      trial < 28
        ? ordered
        : ordered.slice(
            trial % Math.max(1, ordered.length - 2),
            (trial % Math.max(1, ordered.length - 2)) + (trial < 20 ? 3 : 1)
          );
    for (const d of ordered.filter((item) => !selected.includes(item))) {
      d.g.forEach((o) => paint(rect(o, map)));
      zones.push({
        id: d.g[0].id,
        x: d.c[0],
        y: d.c[1],
        w: d.w,
        h: d.h,
      });
    }
    const board = mask.slice();
    let failed = false;
    for (const d of selected) {
      let choice: {
        x: number;
        y: number;
        i: number;
        j: number;
        w: number;
        h: number;
        rot: boolean;
        score: number;
      } | null = null;
      const type =
        (d.g.find((o) => (o as Booth).type) as Booth | undefined)?.type ||
        'rest';
      const stride = nx + 1;
      const prefix = new Int32Array(stride * (ny + 1));
      for (let row = 0; row < ny; row++) {
        let sum = 0;
        for (let col = 0; col < nx; col++) {
          sum += board[row * nx + col];
          prefix[(row + 1) * stride + col + 1] =
            prefix[row * stride + col + 1] + sum;
        }
      }
      for (let k = 0; k < 2 * nx * ny; k++) {
        const rot = k >= nx * ny;
        const w = Math.ceil((rot ? d.h : d.w) + opts.space);
        const h = Math.ceil((rot ? d.w : d.h) + opts.space);
        const i = k % nx;
        const j = Math.floor(k / nx) % ny;
        if (i + w > nx || j + h > ny) continue;
        if (
          prefix[(j + h) * stride + i + w] -
          prefix[j * stride + i + w] -
          prefix[(j + h) * stride + i] +
          prefix[j * stride + i]
        ) {
          continue;
        }
        const x = x0 + i + w / 2;
        const y = y0 + j + h / 2;
        const u = (x - x0) / W;
        const v = (y - y0) / H;
        const focus = opts.objectiveFocus;
        const zone =
          type === 'food'
            ? focus === 'gastronomy'
              ? 0.45
              : 0.22
            : type === 'stage'
              ? focus === 'music'
                ? 0.52
                : 0.85
              : type === 'rest' || type === 'workshop'
                ? focus === 'family'
                  ? 0.5
                  : 0.35
                : focus === 'commerce'
                  ? 0.48
                  : 0.56;
        const focusBonus =
          focus === 'family' && (type === 'rest' || type === 'workshop')
            ? 0.35 * (1 - Math.hypot(u - 0.5, v - 0.5))
            : focus === 'gastronomy' && type === 'food'
              ? 0.35 * (1 - Math.abs(v - 0.45))
              : focus === 'commerce' && type === 'commerce'
                ? 0.35 * (1 - Math.abs(u - 0.5))
                : focus === 'music' && type === 'stage'
                  ? 0.35 * v
                  : focus === 'spatial_efficiency'
                    ? 0.3 * Math.hypot(u - 0.5, v - 0.5)
                    : 0;
        const style =
          strategy === 0
            ? Math.hypot(u - 0.5, v - 0.5)
            : strategy === 1
              ? 1 - Math.abs(v - zone)
              : 1 - Math.hypot(u - zone, v - (type === 'commerce' ? 0.28 : 0.68));
        const score = style + focusBonus + rand() * 0.45;
        if (!choice || score > choice.score) {
          choice = {x, y, i, j, w, h, rot, score};
        }
      }
      if (!choice) {
        failed = true;
        break;
      }
      const {x, y, i, j, w, h, rot} = choice;
      for (let row = j; row < j + h; row++) {
        board.fill(1, row * nx + i, row * nx + i + w);
      }
      zones.push({id: d.g[0].id, x, y, w, h});
      for (const o of d.g) {
        const [ox, oy] = point(o);
        const dx = ox - d.c[0];
        const dy = oy - d.c[1];
        const b = o as Booth;
        moves.push({
          ...o,
          x: ((x + (rot ? -dy : dx)) * 100) / map.widthMeters,
          y: ((y + (rot ? dx : dy)) * 100) / map.heightMeters,
          rotation: ((o.rotation || 0) + (rot ? 90 : 0)) % 360,
          ...(b.facing !== undefined
            ? {facing: (b.facing + (rot ? 90 : 0)) % 360}
            : {}),
        });
      }
    }
    if (failed) continue;
    const distance = (
      a: {x: number; y: number},
      b: {x: number; y: number}
    ) => Math.hypot(a.x - b.x, a.y - b.y);
    const nearest = (
      a: {x: number; y: number; w: number; h: number},
      list: Array<{x: number; y: number; w: number; h: number}>
    ) =>
      Math.min(
        ...list.map(
          (b) => distance(a, b) + 0.2 * (Math.abs(a.w - b.w) + Math.abs(a.h - b.h))
        )
      );
    const original = groupData.map((d) => ({
      x: d.c[0],
      y: d.c[1],
      w: d.w,
      h: d.h,
    }));
    const scored = zones.filter(
      (z) => moves.some((o) => o.id === z.id) && z.w * z.h >= 45
    );
    if (!scored.length) continue;
    const score = Math.min(
      ...[original, ...previous]
        .filter((a) => a.length)
        .map(
          (ref) =>
            scored.reduce((n, z) => n + nearest(z, ref), 0) / scored.length
        )
    );
    const rank = score + Math.min(12, scored.length * 2);
    if (score >= 3 && (!best || rank > best.rank)) {
      best = {moves, zones, score, rank};
    }
    if (score >= 10 && scored.length >= 2 && trial < 28) break;
  }

  const fullOpts: LayoutOptions = {
    count: opts.count ?? 4,
    space: opts.space,
    scale: opts.scale ?? 1,
    commerce: opts.commerce ?? 2,
    rest: opts.rest ?? 2,
    cover: opts.cover ?? 1,
    seed: opts.seed,
    onlyMove: opts.onlyMove,
    strategy: opts.strategy,
    allowReplan: opts.allowReplan,
    objectiveFocus: opts.objectiveFocus,
  };

  if (!best || best.score < 3) {
    return {
      moves: [],
      zones: [],
      routing,
      objects: opts.onlyMove ? [] : generateLayout(scene, map, fullOpts).objects,
      reason:
        'No se encontró una planta suficientemente distinta con estos pasillos y separaciones.',
    };
  }
  const staged = structuredClone(scene);
  for (const o of [...staged.base.booths, ...staged.infrastructure]) {
    const next = best.moves.find((n: {id: string}) => n.id === o.id);
    if (next) Object.assign(o, next);
  }
  return {
    ...best,
    routing,
    objects: opts.onlyMove ? [] : generateLayout(staged, map, fullOpts).objects,
    reason:
      names[strategy] +
      ' · ' +
      best.zones.filter((z: {id: string}) =>
        best.moves.some((o: {id: string}) => o.id === z.id)
      ).length +
      ' grupos redistribuidos. Variación espacial ' +
      best.score.toFixed(1) +
      ' m.',
  };
}
