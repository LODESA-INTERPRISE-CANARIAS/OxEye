/**
 * @module engine/cartography/groups
 * Motor puro de agrupación jerárquica (Ctrl+G / Mayús+G) y transformaciones
 * rígidas (traslación y rotación) para TODOS los elementos movibles del plano:
 * puestos, infraestructura, anotaciones, vallas, trazos/reservas y elementos
 * del subsuelo (columnas, muros de carga y polígonos).
 */
import type {
  ElementGroup,
  MapMetadata,
  Point2D,
  Scene,
} from '../../types';
import {percent, world} from './geometry';

export type GroupableKind = 'point' | 'wall' | 'points';

export interface GroupableItemEntry {
  id: string;
  kind: GroupableKind;
  isSubsoil: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any;
}

export interface GroupTransformSnapshot {
  kind: GroupableKind;
  x?: number;
  y?: number;
  rotation?: number;
  a?: Point2D;
  b?: Point2D;
  points?: Point2D[];
}

/** Localiza todos los elementos agrupables/movibles de la escena por ID. */
export function findGroupableItemsById(
  scene: Scene
): Map<string, GroupableItemEntry> {
  const map = new Map<string, GroupableItemEntry>();
  for (const b of scene.base.booths) {
    map.set(b.id, {id: b.id, kind: 'point', isSubsoil: false, item: b});
  }
  for (const r of scene.infrastructure) {
    map.set(r.id, {id: r.id, kind: 'point', isSubsoil: false, item: r});
  }
  for (const a of scene.annotations) {
    map.set(a.id, {id: a.id, kind: 'point', isSubsoil: false, item: a});
  }
  const traceLists = [
    scene.fences || [],
    scene.reserves || [],
    scene.passages || [],
    scene.flows || [],
    scene.roadPlans || [],
    scene.measurements || [],
  ];
  for (const list of traceLists) {
    for (const t of list) {
      if (t.id) {
        map.set(t.id, {id: t.id, kind: 'points', isSubsoil: false, item: t});
      }
    }
  }
  if (scene.subsoil) {
    for (const c of scene.subsoil.columns) {
      map.set(c.id, {id: c.id, kind: 'point', isSubsoil: true, item: c});
    }
    for (const w of scene.subsoil.walls) {
      map.set(w.id, {id: w.id, kind: 'wall', isSubsoil: true, item: w});
    }
    for (const p of scene.subsoil.polygons) {
      map.set(p.id, {id: p.id, kind: 'points', isSubsoil: true, item: p});
    }
  }
  return map;
}

/** Devuelve el grupo directo al que pertenece un elemento o subgrupo. */
export function directGroupOf(
  groups: ElementGroup[] | undefined,
  memberId: string
): ElementGroup | null {
  if (!groups?.length) return null;
  return groups.find((g) => g.memberIds.includes(memberId)) || null;
}

/** Sube por la jerarquía hasta el grupo raíz (nivel superior) de un elemento o grupo. */
export function topGroupOf(
  groups: ElementGroup[] | undefined,
  id: string
): ElementGroup | null {
  if (!groups?.length) return null;
  const byId = new Map(groups.map((g) => [g.id, g]));
  let current: ElementGroup | null = byId.get(id) || directGroupOf(groups, id);
  const visited = new Set<string>();
  while (current?.parentGroupId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentGroupId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** Devuelve todos los IDs de elementos hoja contenidos recursivamente en un grupo. */
export function resolveGroupLeafIds(
  groups: ElementGroup[] | undefined,
  groupId: string
): string[] {
  if (!groups?.length) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const result: string[] = [];
  const visited = new Set<string>();
  const walk = (gid: string) => {
    if (visited.has(gid)) return;
    visited.add(gid);
    const g = byId.get(gid);
    if (!g) return;
    for (const memberId of g.memberIds) {
      if (byId.has(memberId)) {
        walk(memberId);
      } else if (!result.includes(memberId)) {
        result.push(memberId);
      }
    }
  };
  walk(groupId);
  return result;
}

/**
 * Expande un conjunto de IDs seleccionados a todos los elementos hoja de los
 * grupos de nivel superior a los que pertenezcan.
 */
export function expandSelectionToGroups(scene: Scene, ids: string[]): string[] {
  const groups = scene.groups;
  if (!groups?.length || !ids.length) return [...ids];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const id of ids) {
    const top = topGroupOf(groups, id);
    if (top) {
      for (const leaf of resolveGroupLeafIds(groups, top.id)) {
        push(leaf);
      }
    } else {
      push(id);
    }
  }
  return out;
}

/** Comprueba si dos elementos comparten algún grupo ancestro en común. */
export function shareAncestorGroup(
  groups: ElementGroup[] | undefined,
  idA: string,
  idB: string
): boolean {
  const topA = topGroupOf(groups, idA);
  if (!topA) return false;
  const topB = topGroupOf(groups, idB);
  return !!topB && topA.id === topB.id;
}

/** Devuelve `true` si la selección pertenece al menos a un grupo. */
export function hasGroupInSelection(scene: Scene, ids: string[]): boolean {
  if (!scene.groups?.length || !ids.length) return false;
  return ids.some((id) => topGroupOf(scene.groups, id) !== null);
}

/** Devuelve la profundidad máxima de agrupación para una selección (0 = sin agrupar). */
export function groupDepthForId(
  groups: ElementGroup[] | undefined,
  itemId: string
): number {
  if (!groups?.length) return 0;
  const byId = new Map(groups.map((g) => [g.id, g]));
  let current = directGroupOf(groups, itemId);
  let depth = 0;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    depth++;
    current = current.parentGroupId
      ? byId.get(current.parentGroupId) || null
      : null;
  }
  return depth;
}

/**
 * Agrupa los elementos seleccionados (`Ctrl+G`) creando un nuevo nivel de grupo.
 * Admite cualquier elemento del plano o del subsuelo (columnas, muros, carpas,
 * lastres, puestos, vallas, etc.) y permite niveles anidados.
 */
export function groupSelection(
  scene: Scene,
  selectedIds: string[]
): {groupId: string; memberLeafIds: string[]} | null {
  const groupable = findGroupableItemsById(scene);
  const validIds = [...new Set(selectedIds)].filter((id) => groupable.has(id));
  if (validIds.length < 2) return null;

  scene.groups ??= [];
  const roots: string[] = [];
  const seenRoots = new Set<string>();
  for (const id of validIds) {
    const top = topGroupOf(scene.groups, id);
    const rootId = top ? top.id : id;
    if (!seenRoots.has(rootId)) {
      seenRoots.add(rootId);
      roots.push(rootId);
    }
  }
  if (roots.length < 2) return null;

  const groupId = crypto.randomUUID();
  const group: ElementGroup = {
    id: groupId,
    name: `Grupo ${scene.groups.length + 1}`,
    memberIds: roots,
  };
  for (const rootId of roots) {
    const childGroup = scene.groups.find((g) => g.id === rootId);
    if (childGroup) childGroup.parentGroupId = groupId;
  }
  scene.groups.push(group);

  return {
    groupId,
    memberLeafIds: resolveGroupLeafIds(scene.groups, groupId),
  };
}

/**
 * Deshace únicamente el último nivel (nivel superior) de agrupación (`Mayús+G`)
 * sin eliminar elementos ni alterar sus posiciones o propiedades.
 */
export function ungroupTopLevel(
  scene: Scene,
  selectedIds: string[]
): {dissolvedGroupIds: string[]; remainingLeafIds: string[]} | null {
  if (!scene.groups?.length || !selectedIds.length) return null;
  const topGroups = new Map<string, ElementGroup>();
  for (const id of selectedIds) {
    const top = topGroupOf(scene.groups, id);
    if (top) topGroups.set(top.id, top);
  }
  if (!topGroups.size) return null;

  const dissolvedIds = new Set(topGroups.keys());
  const remainingLeafIds: string[] = [];
  const seenLeaf = new Set<string>();
  for (const top of topGroups.values()) {
    for (const leaf of resolveGroupLeafIds(scene.groups, top.id)) {
      if (!seenLeaf.has(leaf)) {
        seenLeaf.add(leaf);
        remainingLeafIds.push(leaf);
      }
    }
  }

  for (const g of scene.groups) {
    if (g.parentGroupId && dissolvedIds.has(g.parentGroupId)) {
      delete g.parentGroupId;
    }
  }
  scene.groups = scene.groups.filter((g) => !dissolvedIds.has(g.id));

  return {
    dissolvedGroupIds: [...dissolvedIds],
    remainingLeafIds,
  };
}

/** Limpia referencias a elementos eliminados en `scene.groups` y poda grupos de < 2 miembros. */
export function pruneGroupsAfterDelete(
  scene: Scene,
  deletedIds: string[]
): void {
  if (!scene.groups?.length || !deletedIds.length) return;
  const removed = new Set(deletedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of scene.groups) {
      const before = g.memberIds.length;
      g.memberIds = g.memberIds.filter((id) => !removed.has(id));
      if (g.memberIds.length !== before) changed = true;
    }
    for (let i = scene.groups.length - 1; i >= 0; i--) {
      const g = scene.groups[i];
      if (g.memberIds.length < 2) {
        const survivingChild = g.memberIds[0];
        if (survivingChild) {
          const childGroup = scene.groups.find((c) => c.id === survivingChild);
          if (childGroup) {
            if (g.parentGroupId) childGroup.parentGroupId = g.parentGroupId;
            else delete childGroup.parentGroupId;
          }
          if (g.parentGroupId) {
            const parent = scene.groups.find((p) => p.id === g.parentGroupId);
            if (parent) {
              parent.memberIds = parent.memberIds.map((m) =>
                m === g.id ? survivingChild : m
              );
            }
          }
        }
        removed.add(g.id);
        scene.groups.splice(i, 1);
        changed = true;
      }
    }
  }
}

/** Calcula la caja envolvente y centroide (en metros locales) de cualquier conjunto de elementos. */
export function groupBoundingBoxMeters(
  scene: Scene,
  leafIds: string[],
  map: MapMetadata
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
} | null {
  const groupable = findGroupableItemsById(scene);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  const includePt = (x: number, y: number, padX = 0, padY = 0) => {
    minX = Math.min(minX, x - padX);
    minY = Math.min(minY, y - padY);
    maxX = Math.max(maxX, x + padX);
    maxY = Math.max(maxY, y + padY);
  };

  for (const id of leafIds) {
    const entry = groupable.get(id);
    if (!entry) continue;
    const item = entry.item;
    if (entry.kind === 'point') {
      const [x, y] = world([item.x, item.y], map);
      if (typeof item.diameter === 'number') {
        const r = Math.max(0.5, item.diameter / 2);
        includePt(x, y, r, r);
      } else {
        const w = item.width || Math.sqrt(item.area || 4);
        const h = item.depth || Math.sqrt(item.area || 4);
        const rad = ((item.rotation || 0) * Math.PI) / 180;
        const c = Math.abs(Math.cos(rad));
        const s = Math.abs(Math.sin(rad));
        includePt(x, y, (w * c + h * s) / 2, (w * s + h * c) / 2);
      }
      count++;
    } else if (entry.kind === 'wall') {
      const a = world(item.a, map);
      const b = world(item.b, map);
      const pad = Math.max(0.3, (item.thickness || 0.4) / 2);
      includePt(a[0], a[1], pad, pad);
      includePt(b[0], b[1], pad, pad);
      count++;
    } else if (entry.kind === 'points' && Array.isArray(item.points)) {
      for (const pt of item.points as Point2D[]) {
        const [mx, my] = world(pt, map);
        includePt(mx, my, 0.3, 0.3);
      }
      if (item.points.length) count++;
    }
  }
  if (!count) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Captura la geometría inicial de cualquier conjunto de elementos para una
 * operación de arrastre o rotación rígida (multiselección o grupo).
 */
export function snapshotGroupTransform(
  scene: Scene,
  leafIds: string[]
): Map<string, GroupTransformSnapshot> {
  const groupable = findGroupableItemsById(scene);
  const snaps = new Map<string, GroupTransformSnapshot>();
  for (const id of leafIds) {
    const entry = groupable.get(id);
    if (!entry) continue;
    const item = entry.item;
    if (entry.kind === 'point') {
      snaps.set(id, {
        kind: 'point',
        x: item.x,
        y: item.y,
        rotation: item.rotation || 0,
      });
    } else if (entry.kind === 'wall') {
      snaps.set(id, {
        kind: 'wall',
        a: [item.a[0], item.a[1]],
        b: [item.b[0], item.b[1]],
      });
    } else if (entry.kind === 'points' && Array.isArray(item.points)) {
      snaps.set(id, {
        kind: 'points',
        points: (item.points as Point2D[]).map((pt): Point2D => [pt[0], pt[1]]),
      });
    }
  }
  return snaps;
}

/** Devuelve `true` si algún ID del conjunto pertenece a la capa de subsuelo. */
export function selectionTouchesSubsoil(
  scene: Scene,
  leafIds: string[]
): boolean {
  const groupable = findGroupableItemsById(scene);
  return leafIds.some((id) => groupable.get(id)?.isSubsoil === true);
}

/**
 * Traslada rígidamente cualquier conjunto de elementos (incluyendo columnas,
 * muros y polígonos de subsuelo, puestos, carpas, lastres y vallas) conservando
 * sus posiciones relativas exactas. No mueve el conjunto si algún miembro está bloqueado.
 */
export function translateItemsRigid(
  scene: Scene,
  leafIds: string[],
  snapshots: Map<string, GroupTransformSnapshot>,
  dxMeters: number,
  dyMeters: number,
  map: MapMetadata
): boolean {
  const groupable = findGroupableItemsById(scene);
  const entries: Array<{
    entry: GroupableItemEntry;
    snap: GroupTransformSnapshot;
  }> = [];
  for (const id of leafIds) {
    const entry = groupable.get(id);
    const snap = snapshots.get(id);
    if (!entry || !snap) continue;
    if (entry.item.locked) return false;
    entries.push({entry, snap});
  }
  if (!entries.length) return false;

  const dPctX = (dxMeters / map.widthMeters) * 100;
  const dPctY = (dyMeters / map.heightMeters) * 100;

  let clampedDx = dPctX;
  let clampedDy = dPctY;
  const clampPoint = (px: number, py: number) => {
    if (px + clampedDx < 0) clampedDx = Math.max(clampedDx, -px);
    if (px + clampedDx > 100) clampedDx = Math.min(clampedDx, 100 - px);
    if (py + clampedDy < 0) clampedDy = Math.max(clampedDy, -py);
    if (py + clampedDy > 100) clampedDy = Math.min(clampedDy, 100 - py);
  };

  for (const {snap} of entries) {
    if (snap.kind === 'point' && snap.x !== undefined && snap.y !== undefined) {
      clampPoint(snap.x, snap.y);
    } else if (snap.kind === 'wall' && snap.a && snap.b) {
      clampPoint(snap.a[0], snap.a[1]);
      clampPoint(snap.b[0], snap.b[1]);
    } else if (snap.kind === 'points' && snap.points) {
      for (const pt of snap.points) clampPoint(pt[0], pt[1]);
    }
  }

  for (const {entry, snap} of entries) {
    if (snap.kind === 'point' && snap.x !== undefined && snap.y !== undefined) {
      entry.item.x = snap.x + clampedDx;
      entry.item.y = snap.y + clampedDy;
    } else if (snap.kind === 'wall' && snap.a && snap.b) {
      entry.item.a = [snap.a[0] + clampedDx, snap.a[1] + clampedDy];
      entry.item.b = [snap.b[0] + clampedDx, snap.b[1] + clampedDy];
    } else if (snap.kind === 'points' && snap.points) {
      entry.item.points = snap.points.map(
        (pt): Point2D => [pt[0] + clampedDx, pt[1] + clampedDy]
      );
    }
  }
  return true;
}

/**
 * Rota rígidamente cualquier conjunto de elementos alrededor de `pivotMeters`
 * por `deltaDeg` grados, conservando distancias y ángulos relativos exactos.
 */
export function rotateItemsRigid(
  scene: Scene,
  leafIds: string[],
  snapshots: Map<string, GroupTransformSnapshot>,
  pivotMeters: Point2D,
  deltaDeg: number,
  map: MapMetadata
): boolean {
  const groupable = findGroupableItemsById(scene);
  const entries: Array<{
    entry: GroupableItemEntry;
    snap: GroupTransformSnapshot;
  }> = [];
  for (const id of leafIds) {
    const entry = groupable.get(id);
    const snap = snapshots.get(id);
    if (!entry || !snap) continue;
    if (entry.item.locked) return false;
    entries.push({entry, snap});
  }
  if (!entries.length) return false;

  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotatePctPoint = (ptPct: Point2D): Point2D | null => {
    const [mx, my] = world(ptPct, map);
    const rx = mx - pivotMeters[0];
    const ry = my - pivotMeters[1];
    const nx = pivotMeters[0] + rx * cos - ry * sin;
    const ny = pivotMeters[1] + rx * sin + ry * cos;
    const [px, py] = percent([nx, ny], map);
    if (px < 0 || px > 100 || py < 0 || py > 100) return null;
    return [px, py];
  };

  const pending: Array<() => void> = [];
  for (const {entry, snap} of entries) {
    if (snap.kind === 'point' && snap.x !== undefined && snap.y !== undefined) {
      const next = rotatePctPoint([snap.x, snap.y]);
      if (!next) return false;
      const nextRot =
        Math.round((((snap.rotation || 0) + deltaDeg) % 360 + 360) % 360 * 10) /
        10;
      pending.push(() => {
        entry.item.x = next[0];
        entry.item.y = next[1];
        if ('rotation' in entry.item || typeof snap.rotation === 'number') {
          if (entry.item.diameter === undefined) entry.item.rotation = nextRot;
        }
      });
    } else if (snap.kind === 'wall' && snap.a && snap.b) {
      const na = rotatePctPoint(snap.a);
      const nb = rotatePctPoint(snap.b);
      if (!na || !nb) return false;
      pending.push(() => {
        entry.item.a = na;
        entry.item.b = nb;
      });
    } else if (snap.kind === 'points' && snap.points) {
      const nextPts: Point2D[] = [];
      for (const pt of snap.points) {
        const np = rotatePctPoint(pt);
        if (!np) return false;
        nextPts.push(np);
      }
      pending.push(() => {
        entry.item.points = nextPts;
      });
    }
  }

  for (const apply of pending) apply();
  return true;
}
