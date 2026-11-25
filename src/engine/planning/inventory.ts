import type {
  Booth,
  CatalogItemSpec,
  Entrance,
  Infrastructure,
  Point,
  Scene,
  VenueMap,
} from '../../types';
import {inside, rect} from '../cartography/geometry';

/**
 * Classifies an element into its catalog key (`commerce`, `ventorrillo`, `food`, `stage`, etc.).
 *
 * @param o - Scene element.
 * @returns Catalog key string.
 */
export function classify(o: {
  inventoryKind?: string;
  kind?: string;
  role?: string;
  type?: string;
}): string {
  if (o.inventoryKind) return o.inventoryKind;
  if (o.kind === 'ventorrillo') return 'ventorrillo';
  if (o.kind === 'picnic') return 'picnic';
  if (o.role === 'cover') return 'cover';
  if (o.type === 'food') return 'food';
  return o.type || o.kind || 'commerce';
}

/**
 * Reconciles target inventory counts against current scene elements and pending stock,
 * respecting locked elements (`o.locked === true`) and the 150-element cap.
 *
 * @param scene - Current scene.
 * @param counts - Desired counts by catalog key.
 * @param catalog - Catalog dictionary (`CATALOG`).
 * @returns Updated scene and counts of removed/added items.
 */
export function reconcile(
  scene: Scene,
  counts: Record<string, number>,
  catalog: Record<string, CatalogItemSpec>
): {scene: Scene; removed: number; added: number} {
  const next = structuredClone(scene);
  const pending = next.pendingStock || [];
  const remove: string[] = [];
  const add: any[] = [];

  for (const [kind, count] of Object.entries(counts)) {
    if (!Number.isInteger(count) || count < 0 || count > 500) {
      throw new Error('Introduce cantidades enteras entre 0 y 500.');
    }
    const current = [
      ...next.base.booths,
      ...next.infrastructure,
      ...next.entrances,
      ...pending,
    ].filter((o) => classify(o) === kind);
    const fixed = current.filter((o) => o.locked);
    if (count < fixed.length) {
      throw new Error(
        catalog[kind].name + ': hay ' + fixed.length + ' piezas fijadas.'
      );
    }
    const ordered = [...fixed, ...current.filter((o) => !o.locked)];
    for (const o of ordered.slice(count)) remove.push(o.id);
    for (let i = current.length; i < count; i++) {
      const c = catalog[kind];
      const o: any = {
        id: crypto.randomUUID(),
        inventoryKind: kind,
        kind,
        name: c.name + ' ' + (i + 1),
        width: c.w,
        depth: c.h,
        area: c.w * c.h,
        rotation: 0,
        phaseTags: ['event'],
      };
      if (c.role) {
        const isEmergencyVeh = ['ambulance', 'patrol', 'police_van', 'fire'].includes(kind);
        const defaultStaff =
          kind === 'police_van'
            ? 8
            : kind === 'fire'
              ? 4
              : c.role === 'emergency'
                ? 2
                : 0;
        Object.assign(o, {
          role: c.role,
          capacity:
            kind === 'picnic'
              ? 6
              : kind === 'yellow_tent'
                ? 2
                : c.role === 'emergency'
                  ? 1
                  : 10,
          staff: defaultStaff,
          ...(isEmergencyVeh
            ? {
                operationalMode: 'reserve',
                availableForReinforcement: true,
                crewCapacity: defaultStaff,
              }
            : {}),
          delay:
            ({
              fire: 90,
              medical: 30,
              yellow_tent: 20,
              violet_point: 15,
              security: 15,
              patrol: 30,
              police_van: 45,
              ambulance: 60,
            } as Record<string, number>)[kind] ?? 60,
          handling:
            ({
              fire: 360,
              medical: 180,
              security: 120,
              patrol: 120,
              police_van: 150,
              ambulance: 240,
            } as Record<string, number>)[kind] ?? 240,
          active: true,
        });
      } else {
        Object.assign(o, {
          type: c.type,
          labCapacity: kind === 'stage' ? 40 : 3,
          labTime: 5,
          interest: 1,
          price:
            kind === 'food' || kind === 'ventorrillo'
              ? 8
              : kind === 'commerce'
                ? 10
                : 0,
          open: 0,
          close: scene.base.hours,
        });
      }
      if (kind === 'gate') {
        Object.assign(o, {
          role: 'both',
          clearWidth: 4,
          phases: {event: 'both'},
        });
      }
      add.push(o);
    }
  }

  const gone = new Set(remove);
  for (const arr of [
    next.base.booths,
    next.infrastructure,
    next.entrances,
  ]) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (gone.has(arr[i].id)) arr.splice(i, 1);
    }
  }
  for (const o of [
    ...next.base.booths,
    ...next.infrastructure,
    ...pending,
  ] as Array<{coverGroup?: string}>) {
    if (o.coverGroup && gone.has(o.coverGroup)) delete o.coverGroup;
  }
  next.pendingStock = [...pending.filter((o) => !gone.has(o.id)), ...add];
  if (
    next.base.booths.length +
      next.infrastructure.length +
      next.entrances.length +
      next.pendingStock.length >
    500
  ) {
    throw new Error('El inventario admite 500 piezas en total.');
  }
  return {scene: next, removed: remove.length, added: add.length};
}

/**
 * Inserts a pending stock item into the active scene array (`entrances`, `infrastructure`, or `booths`).
 *
 * @param scene - Target scene.
 * @param o - Item to insert.
 */
export function insertStock(scene: Scene, o: any): void {
  if (classify(o) === 'gate') {
    scene.entrances.push(o as Entrance);
  } else if (o.role) {
    scene.infrastructure.push(o as Infrastructure);
  } else {
    scene.base.booths.push(o as Booth);
  }
  scene.pendingStock = (scene.pendingStock || []).filter(
    (p) => p.id !== o.id
  );
}

function collide(a: Point[], b: Point[]): boolean {
  for (const p of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const q = p[i + 1];
      const axis: Point = [q[1] - p[i][1], p[i][0] - q[0]];
      const aa = a.map((pt) => pt[0] * axis[0] + pt[1] * axis[1]);
      const bb = b.map((pt) => pt[0] * axis[0] + pt[1] * axis[1]);
      if (
        Math.max(...aa) <= Math.min(...bb) ||
        Math.max(...bb) <= Math.min(...aa)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Automatically arranges items from `scene.pendingStock` onto the map without overlapping
 * boundaries, reserves, corridors, fences, or existing footprints.
 *
 * @param raw - Source scene.
 * @param map - Georeferenced venue map.
 * @param seed - Random seed.
 * @returns Scene with placed items.
 */
export function arrangeStock(raw: Scene, map: VenueMap, seed: number): Scene {
  const s = structuredClone(raw);
  const boundary: Point[] = s.boundary.map(([x, y]) => [
    (x * map.widthMeters) / 100,
    (y * map.heightMeters) / 100,
  ]);
  const solids = (): Point[][] =>
    [
      ...s.base.booths,
      ...s.infrastructure.filter((o) => o.role !== 'cover'),
    ].map((o) => rect(o, map));
  const reserves: Point[][] = s.reserves.map((r) =>
    r.points.map(([x, y]) => [
      (x * map.widthMeters) / 100,
      (y * map.heightMeters) / 100,
    ])
  );
  const minx = Math.min(...boundary.map((p) => p[0]));
  const maxx = Math.max(...boundary.map((p) => p[0]));
  const miny = Math.min(...boundary.map((p) => p[1]));
  const maxy = Math.max(...boundary.map((p) => p[1]));
  let n = seed >>> 0;
  const rand = (): number => ((n = (1664525 * n + 1013904223) >>> 0) / 4294967296);

  const list = (s.pendingStock || [])
    .slice()
    .sort(
      (a, b) =>
        Number((b as Infrastructure).role === 'cover') -
          Number((a as Infrastructure).role === 'cover') ||
        ((b as Booth).area || 0) - ((a as Booth).area || 0)
    );

  for (const o of list) {
    if (classify(o) === 'gate') continue;
    const rawItem = o as any;
    for (let attempt = 0; attempt < 1200; attempt++) {
      const covers = s.infrastructure.filter((inf) => inf.role === 'cover');
      const roof =
        rawItem.kind === 'picnic' && covers.length
          ? covers[Math.floor(rand() * covers.length)]
          : null;
      let x = minx + rand() * (maxx - minx);
      let y = miny + rand() * (maxy - miny);
      if (roof) {
        x =
          (roof.x * map.widthMeters) / 100 +
          (rand() - 0.5) * ((roof.width || 6) - 3);
        y =
          (roof.y * map.heightMeters) / 100 +
          (rand() - 0.5) * ((roof.depth || 6) - 2);
      }
      const item = {
        ...rawItem,
        x: (x / map.widthMeters) * 100,
        y: (y / map.heightMeters) * 100,
        rotation: roof ? roof.rotation : rand() < 0.5 ? 0 : 90,
        ...(roof ? {coverGroup: roof.id} : {}),
      };
      const poly = rect(
        {
          ...item,
          width: (item.width || 4) + 0.8,
          depth: (item.depth || 3) + 0.8,
        },
        map
      );
      if (
        !poly.every((p) => inside(p, boundary)) ||
        reserves.some((p) => collide(poly, p))
      ) {
        continue;
      }
      if (solids().some((p) => collide(poly, p))) continue;
      if (
        item.role === 'cover' &&
        s.infrastructure
          .filter((inf) => inf.role === 'cover')
          .some((p) => collide(poly, rect(p, map)))
      ) {
        continue;
      }
      if (roof && !rect(item, map).every((p) => inside(p, rect(roof, map)))) {
        continue;
      }
      if (
        s.entrances.some(
          (g) =>
            Math.hypot(
              (g.x * map.widthMeters) / 100 - x,
              (g.y * map.heightMeters) / 100 - y
            ) <
            Math.hypot(item.width || 4, item.depth || 3) / 2 + 3
        )
      ) {
        continue;
      }
      const blocked = [
        ...(s.flows || []),
        ...(s.corridors || []),
        ...(s.fences || []),
      ].some((line) =>
        line.points.slice(1).some((q, i) => {
          const a = line.points[i];
          const ax = (a[0] * map.widthMeters) / 100;
          const ay = (a[1] * map.heightMeters) / 100;
          const bx = (q[0] * map.widthMeters) / 100;
          const by = (q[1] * map.heightMeters) / 100;
          const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.4);
          for (let j = 0; j <= steps; j++) {
            if (
              inside(
                [
                  ax + ((bx - ax) * j) / (steps || 1),
                  ay + ((by - ay) * j) / (steps || 1),
                ],
                poly
              )
            ) {
              return true;
            }
          }
          return false;
        })
      );
      if (blocked) continue;
      insertStock(s, item);
      break;
    }
  }
  return s;
}
