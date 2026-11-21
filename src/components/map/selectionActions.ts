/**
 * @module components/map/selectionActions
 * Operaciones puras y utilidades compartidas para selección múltiple,
 * portapapeles (Ctrl+C / Ctrl+V), duplicado y borrado (Supr) sobre todos
 * los elementos colocables del plano, incluido el subsuelo («Rayos X»).
 */
import {cellAt, world} from '../../engine/cartography/geometry';
import {pruneGroupsAfterDelete} from '../../engine/cartography/groups';
import {emptySubsoil} from '../../engine/subsoil/heat';
import type {
  ActivePanel,
  MapMetadata,
  Point2D,
  Scene,
  SubsoilColumn,
  SubsoilPolygon,
  SubsoilWall,
} from '../../types';

/** Colecciones soportadas para selección, copia, pegado y borrado. */
export type CollectionKey =
  | 'booths'
  | 'infrastructure'
  | 'entrances'
  | 'annotations'
  | 'roadPlans'
  | 'measurements'
  | 'reserves'
  | 'flows'
  | 'fences'
  | 'passages'
  | 'subsoilColumns'
  | 'subsoilWalls'
  | 'subsoilPolygons';

/** Elemento serializado en el portapapeles interno. */
export interface ClipboardEntry {
  collection: CollectionKey;
  item: Record<string, any>;
}

/** Carga útil del portapapeles de selección múltiple. */
export interface ClipboardPayload {
  entries: ClipboardEntry[];
}

/** Resultado de pegar o duplicar elementos. */
export interface PasteResult {
  newIds: string[];
  skippedCatalogLimit: number;
  skippedSimulateOrPanel: number;
}

/** Resultado de eliminar elementos seleccionados. */
export interface DeleteResult {
  deletedIds: string[];
  lockedIds: string[];
  skippedPanelIds: string[];
}

/** Límite máximo de piezas del catálogo (puestos + infraestructura + accesos) por recinto. */
export const CATALOG_ITEM_LIMIT = 500;

const CATALOG_COLLECTIONS: ReadonlySet<CollectionKey> = new Set([
  'booths',
  'infrastructure',
  'entrances',
]);

const SUBSOIL_COLLECTIONS: ReadonlySet<CollectionKey> = new Set([
  'subsoilColumns',
  'subsoilWalls',
  'subsoilPolygons',
]);

/** Devuelve `true` si el objetivo del evento de teclado es un campo de texto editable. */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/** Comprueba si una herramienta pertenece a la capa Rayos X. */
export function isXrayTool(tool: string): boolean {
  return tool.startsWith('xray:');
}

/** Devuelve `true` si la colección corresponde a un elemento del subsuelo. */
export function isSubsoilCollection(collection: CollectionKey): boolean {
  return SUBSOIL_COLLECTIONS.has(collection);
}

/** Devuelve el array de la escena asociado a una colección (creándolo si es necesario). */
function getCollectionArray(
  scene: Scene,
  key: CollectionKey,
  ensure = false
): Array<Record<string, any>> {
  switch (key) {
    case 'booths':
      return scene.base.booths;
    case 'infrastructure':
      return scene.infrastructure;
    case 'entrances':
      return scene.entrances;
    case 'annotations':
      return scene.annotations;
    case 'roadPlans':
      return scene.roadPlans;
    case 'measurements':
      return scene.measurements;
    case 'reserves':
      return scene.reserves;
    case 'flows':
      if (ensure) scene.flows ??= [];
      return scene.flows || [];
    case 'fences':
      if (ensure) scene.fences ??= [];
      return scene.fences || [];
    case 'passages':
      if (ensure) scene.passages ??= [];
      return scene.passages || [];
    case 'subsoilColumns':
      if (ensure) scene.subsoil ??= emptySubsoil();
      return scene.subsoil?.columns || [];
    case 'subsoilWalls':
      if (ensure) scene.subsoil ??= emptySubsoil();
      return scene.subsoil?.walls || [];
    case 'subsoilPolygons':
      if (ensure) scene.subsoil ??= emptySubsoil();
      return scene.subsoil?.polygons || [];
  }
}

const ALL_COLLECTIONS: CollectionKey[] = [
  'booths',
  'infrastructure',
  'entrances',
  'annotations',
  'roadPlans',
  'measurements',
  'reserves',
  'flows',
  'fences',
  'passages',
  'subsoilColumns',
  'subsoilWalls',
  'subsoilPolygons',
];

/**
 * Busca un elemento por `id` en todas las colecciones de la escena (incluido el subsuelo).
 */
export function findItemInScene(
  scene: Scene,
  id: string
): {
  collection: CollectionKey;
  item: Record<string, any>;
} | null {
  for (const key of ALL_COLLECTIONS) {
    const arr = getCollectionArray(scene, key, false);
    const found = arr.find((o) => o.id === id);
    if (found) return {collection: key, item: found};
  }
  return null;
}

/** Devuelve el conjunto de IDs del subsuelo presentes en la escena. */
export function subsoilIdsInScene(scene: Scene): Set<string> {
  const ids = new Set<string>();
  if (!scene.subsoil) return ids;
  for (const c of scene.subsoil.columns) ids.add(c.id);
  for (const w of scene.subsoil.walls) ids.add(w.id);
  for (const p of scene.subsoil.polygons) ids.add(p.id);
  return ids;
}

/** Cuenta el total de piezas del catálogo en la escena (límite de 150). */
export function countCatalogItems(scene: Scene): number {
  return (
    scene.base.booths.length +
    scene.infrastructure.length +
    scene.entrances.length
  );
}

/**
 * Construye una carga de portapapeles con clones profundos de los elementos seleccionados.
 */
export function copyItemsFromScene(
  scene: Scene,
  ids: string[]
): ClipboardPayload {
  const entries: ClipboardEntry[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const found = findItemInScene(scene, id);
    if (found) {
      entries.push({
        collection: found.collection,
        item: structuredClone(found.item),
      });
    }
  }
  return {entries};
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function offsetPointPct(
  pt: Point2D,
  dxPct: number,
  dyPct: number
): Point2D {
  return [clampPct(pt[0] + dxPct), clampPct(pt[1] + dyPct)];
}

/**
 * Aplica un desplazamiento en metros y asigna un nuevo UUID a un elemento clonado.
 */
function cloneWithOffset(
  entry: ClipboardEntry,
  map: MapMetadata,
  grid: number,
  offsetMeters = 2
): Record<string, any> {
  const clone = structuredClone(entry.item);
  clone.id = crypto.randomUUID();
  const dxDefault = (offsetMeters / map.widthMeters) * 100;
  const dyDefault = (offsetMeters / map.heightMeters) * 100;

  if (entry.collection === 'subsoilWalls') {
    const wall = clone as SubsoilWall;
    wall.a = offsetPointPct(wall.a, dxDefault, dyDefault);
    wall.b = offsetPointPct(wall.b, dxDefault, dyDefault);
  } else if (entry.collection === 'subsoilColumns') {
    const col = clone as SubsoilColumn;
    const stepM = Math.max(offsetMeters, col.diameter + 1);
    const dx = (stepM / map.widthMeters) * 100;
    col.x = col.x + dx <= 98 ? col.x + dx : Math.max(2, col.x - dx);
    col.y =
      col.y + dyDefault <= 98
        ? col.y + dyDefault
        : Math.max(2, col.y - dyDefault);
  } else if (Array.isArray(clone.points)) {
    clone.points = (clone.points as Point2D[]).map((pt) =>
      offsetPointPct(pt, dxDefault, dyDefault)
    );
  } else if (typeof clone.x === 'number' && typeof clone.y === 'number') {
    const stepMeters =
      typeof clone.width === 'number'
        ? Math.max(offsetMeters, clone.width * 0.5 + 1)
        : offsetMeters;
    const dx = (stepMeters / map.widthMeters) * 100;
    clone.x = clone.x + dx <= 98 ? clone.x + dx : Math.max(2, clone.x - dx);
    clone.y =
      clone.y + dyDefault <= 98
        ? clone.y + dyDefault
        : Math.max(2, clone.y - dyDefault);
    if (entry.collection === 'annotations') {
      clone.cell = cellAt(
        world([clone.x as number, clone.y as number], map),
        (clone.grid as number) || grid
      );
    }
  }
  return clone;
}

/**
 * Pega los elementos del portapapeles en la escena mutándola in-place (dentro de `updateScene`).
 * Respeta el bloqueo en Simular, la edición exclusiva de subsuelo en Diseñar y el límite de 150 piezas.
 */
export function pasteItemsIntoScene(
  scene: Scene,
  clipboard: ClipboardPayload,
  map: MapMetadata,
  grid: number,
  panel: ActivePanel,
  offsetMeters = 2
): PasteResult {
  const result: PasteResult = {
    newIds: [],
    skippedCatalogLimit: 0,
    skippedSimulateOrPanel: 0,
  };
  if (panel === 'simulate' || !clipboard.entries.length) {
    result.skippedSimulateOrPanel = clipboard.entries.length;
    return result;
  }
  let catalogCount = countCatalogItems(scene);
  let touchedFlows = false;

  for (const entry of clipboard.entries) {
    if (isSubsoilCollection(entry.collection) && panel !== 'design') {
      result.skippedSimulateOrPanel++;
      continue;
    }
    if (CATALOG_COLLECTIONS.has(entry.collection)) {
      if (catalogCount >= CATALOG_ITEM_LIMIT) {
        result.skippedCatalogLimit++;
        continue;
      }
      catalogCount++;
    }
    const clone = cloneWithOffset(entry, map, grid, offsetMeters);
    const arr = getCollectionArray(scene, entry.collection, true);
    arr.push(clone);
    if (entry.collection === 'flows') touchedFlows = true;
    result.newIds.push(clone.id as string);
  }

  if (touchedFlows) {
    scene.corridors = structuredClone(scene.flows || []);
  }
  return result;
}

/**
 * Duplica directamente los elementos seleccionados en la escena.
 */
export function duplicateItemsInScene(
  scene: Scene,
  ids: string[],
  map: MapMetadata,
  grid: number,
  panel: ActivePanel
): PasteResult {
  const payload = copyItemsFromScene(scene, ids);
  return pasteItemsIntoScene(scene, payload, map, grid, panel);
}

/**
 * Elimina los elementos seleccionados de la escena respetando `locked` y el panel activo.
 */
export function deleteItemsFromScene(
  scene: Scene,
  ids: string[],
  panel: ActivePanel
): DeleteResult {
  const result: DeleteResult = {
    deletedIds: [],
    lockedIds: [],
    skippedPanelIds: [],
  };
  if (panel === 'simulate' || !ids.length) {
    result.skippedPanelIds = [...ids];
    return result;
  }
  const idSet = new Set(ids);
  // Al eliminar una carpa, eliminar también sus lastres subcomponente no bloqueados
  for (const r of scene.infrastructure) {
    if (r.kind === 'ballast' && r.attachedCoverId && idSet.has(r.attachedCoverId)) {
      const parentCover = scene.infrastructure.find((c) => c.id === r.attachedCoverId);
      if (parentCover && !parentCover.locked && !r.locked) {
        idSet.add(r.id);
      }
    }
  }
  let touchedFlows = false;

  for (const key of ALL_COLLECTIONS) {
    const arr = getCollectionArray(scene, key, false);
    if (!arr.length) continue;
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      if (!o?.id || !idSet.has(o.id)) continue;
      if (isSubsoilCollection(key) && panel !== 'design') {
        result.skippedPanelIds.push(o.id);
        continue;
      }
      if (o.locked) {
        result.lockedIds.push(o.id);
        continue;
      }
      arr.splice(i, 1);
      result.deletedIds.push(o.id);
      if (key === 'flows') touchedFlows = true;
    }
  }
  if (touchedFlows) {
    scene.corridors = structuredClone(scene.flows || []);
  }
  if (result.deletedIds.length) {
    pruneGroupsAfterDelete(scene, result.deletedIds);
  }
  return result;
}

/** Devuelve el polígono de subsuelo por id, si existe. */
export function findSubsoilPolygon(
  scene: Scene,
  id: string
): SubsoilPolygon | undefined {
  return scene.subsoil?.polygons.find((p) => p.id === id);
}
