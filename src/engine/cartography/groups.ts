/**
 * @module engine/cartography/groups
 * Motor puro de agrupación jerárquica (Ctrl+G / Mayús+G) y transformaciones
 * rígidas (traslación y rotación) que conservan las posiciones y ángulos
 * relativos de los elementos agrupados (p. ej. lastres agrupados entre sí y
 * luego con una carpa).
 */
import type {ElementGroup, MapMetadata, Point2D, Scene} from '../../types';
import {percent, world} from './geometry';

export interface MovableItemRef {
  id: string;
  x: number;
  y: number;
  width?: number;
  depth?: number;
  area?: number;
  rotation?: number;
  locked?: boolean;
}

export interface GroupTransformSnapshot {
  x: number;
  y: number;
  rotation: number;
}

/** Localiza los elementos posicionables (`x`, `y`) de la escena por ID. */
export function findMovableItemsById(
  scene: Scene
): Map<string, MovableItemRef> {
  const map = new Map<string, MovableItemRef>();
  for (const b of scene.base.booths) map.set(b.id, b);
  for (const r of scene.infrastructure) map.set(r.id, r);
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
 * Si alguno de los elementos ya pertenece a un grupo, se agrupa su grupo raíz
 * entero como subgrupo (permitiendo p. ej. agrupar lastres entre sí y después
 * agrupar ese subgrupo con la carpa).
 */
export function groupSelection(
  scene: Scene,
  selectedIds: string[]
): {groupId: string; memberLeafIds: string[]} | null {
  const movable = findMovableItemsById(scene);
  const validIds = [...new Set(selectedIds)].filter((id) => movable.has(id));
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
  // Si todos ya estaban en el mismo grupo raíz, no hay nada nuevo que agrupar
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

/** Calcula la caja envolvente y centroide (en metros locales) de un conjunto de elementos. */
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
  const movable = findMovableItemsById(scene);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const id of leafIds) {
    const item = movable.get(id);
    if (!item) continue;
    const [x, y] = world([item.x, item.y], map);
    const w = item.width || Math.sqrt(item.area || 16);
    const h = item.depth || Math.sqrt(item.area || 16);
    const rad = ((item.rotation || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const halfW = (w * c + h * s) / 2;
    const halfH = (w * s + h * c) / 2;
    minX = Math.min(minX, x - halfW);
    minY = Math.min(minY, y - halfH);
    maxX = Math.max(maxX, x + halfW);
    maxY = Math.max(maxY, y + halfH);
    count++;
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
 * Captura la posición y rotación inicial de un conjunto de elementos para una
 * operación de arrastre o rotación rígida de grupo.
 */
export function snapshotGroupTransform(
  scene: Scene,
  leafIds: string[]
): Map<string, GroupTransformSnapshot> {
  const movable = findMovableItemsById(scene);
  const snaps = new Map<string, GroupTransformSnapshot>();
  for (const id of leafIds) {
    const item = movable.get(id);
    if (!item) continue;
    snaps.set(id, {
      x: item.x,
      y: item.y,
      rotation: item.rotation || 0,
    });
  }
  return snaps;
}

/**
 * Traslada rígidamente un conjunto de elementos desde sus snapshots conservando
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
  const movable = findMovableItemsById(scene);
  const items: Array<{item: MovableItemRef; snap: GroupTransformSnapshot}> = [];
  for (const id of leafIds) {
    const item = movable.get(id);
    const snap = snapshots.get(id);
    if (!item || !snap) continue;
    if (item.locked) return false;
    items.push({item, snap});
  }
  if (!items.length) return false;

  const dPctX = (dxMeters / map.widthMeters) * 100;
  const dPctY = (dyMeters / map.heightMeters) * 100;

  // Acotar el desplazamiento global para que ningún miembro salga del recinto [0..100]
  let clampedDx = dPctX;
  let clampedDy = dPctY;
  for (const {snap} of items) {
    if (snap.x + clampedDx < 0) clampedDx = Math.max(clampedDx, -snap.x);
    if (snap.x + clampedDx > 100) clampedDx = Math.min(clampedDx, 100 - snap.x);
    if (snap.y + clampedDy < 0) clampedDy = Math.max(clampedDy, -snap.y);
    if (snap.y + clampedDy > 100) clampedDy = Math.min(clampedDy, 100 - snap.y);
  }

  for (const {item, snap} of items) {
    item.x = snap.x + clampedDx;
    item.y = snap.y + clampedDy;
  }
  return true;
}

/**
 * Rota rígidamente un conjunto de elementos alrededor de `pivotMeters` por
 * `deltaDeg` grados, conservando distancias y ángulos relativos exactos.
 */
export function rotateItemsRigid(
  scene: Scene,
  leafIds: string[],
  snapshots: Map<string, GroupTransformSnapshot>,
  pivotMeters: Point2D,
  deltaDeg: number,
  map: MapMetadata
): boolean {
  const movable = findMovableItemsById(scene);
  const items: Array<{item: MovableItemRef; snap: GroupTransformSnapshot}> = [];
  for (const id of leafIds) {
    const item = movable.get(id);
    const snap = snapshots.get(id);
    if (!item || !snap) continue;
    if (item.locked) return false;
    items.push({item, snap});
  }
  if (!items.length) return false;

  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const nextCoords: Array<{
    item: MovableItemRef;
    x: number;
    y: number;
    rotation: number;
  }> = [];

  for (const {item, snap} of items) {
    const [mx, my] = world([snap.x, snap.y], map);
    const rx = mx - pivotMeters[0];
    const ry = my - pivotMeters[1];
    const nx = pivotMeters[0] + rx * cos - ry * sin;
    const ny = pivotMeters[1] + rx * sin + ry * cos;
    const [px, py] = percent([nx, ny], map);
    if (px < 0 || px > 100 || py < 0 || py > 100) return false;
    nextCoords.push({
      item,
      x: px,
      y: py,
      rotation: ((snap.rotation + deltaDeg) % 360 + 360) % 360,
    });
  }

  for (const n of nextCoords) {
    n.item.x = n.x;
    n.item.y = n.y;
    n.item.rotation = Math.round(n.rotation * 10) / 10;
  }
  return true;
}
