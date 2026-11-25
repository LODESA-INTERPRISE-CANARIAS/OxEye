import Dexie, {type Table} from 'dexie';
import {VENUES} from '../data/catalog';
import {CARTO_DATA, MAPS_DATA} from '../data/geodata';
import {applyPalette, normalizePaletteId} from '../data/palettes';
import {remapScene, world} from '../engine/cartography/geometry';
import {
  configure,
  initialScene,
  ORIGINAL,
  validateScene,
} from '../engine/crowd/presets';
import {smallExample} from '../engine/crowd/small-example';
import {addResponseExample} from '../engine/emergency/response-example';
import {assessRisk} from '../engine/emergency/risk';
import {migrateSceneContactsAndProgramme} from '../engine/planning/contacts';
import {
  ensureEventDemandConfig,
  syncDemandConfigToScene,
} from '../engine/planning/event-demand';
import type {
  ProjectFile,
  UserPreferences,
  VenueKey,
  VenueMap,
} from '../types';
import type {
  AccessLogEntry,
  EventPayload,
  LocalUser,
  Membership,
  Organization,
  WorkspaceEvent,
  WorkspaceProject,
} from '../types/workspace';

export const PROJECT_STORAGE_KEY = 'ojo-de-buey-project-v1';
export const PREFS_STORAGE_KEY = 'ojo-prefs';

export interface StoredProjectRecord {
  id: string;
  project: ProjectFile;
  updatedAt: string;
}

export interface StoredSimulationRecord {
  id: string;
  venueKey: VenueKey;
  score: number;
  reportJson: string;
  createdAt: string;
}

/**
 * Dexie.js (IndexedDB) database instance for client-side relational storage.
 */
export class OxEyeDatabase extends Dexie {
  projects!: Table<StoredProjectRecord, string>;
  simulationRuns!: Table<StoredSimulationRecord, string>;
  // Workspace tables (OX-03, local mode)
  organizations!: Table<Organization, string>;
  users!: Table<LocalUser, string>;
  memberships!: Table<Membership, string>;
  workspaceProjects!: Table<WorkspaceProject, string>;
  events!: Table<WorkspaceEvent, string>;
  eventPayloads!: Table<EventPayload, string>;
  accessLog!: Table<AccessLogEntry, string>;

  constructor() {
    super('OxEyeDatabase');
    this.version(1).stores({
      projects: 'id, updatedAt',
      simulationRuns: 'id, venueKey, createdAt',
    });
    this.version(2).stores({
      organizations: 'id',
      users: 'id',
      memberships: 'id, orgId, userId',
      workspaceProjects: 'id, orgId',
      events: 'id, orgId, projectId, importHash',
      eventPayloads: 'eventId, orgId',
      accessLog: 'id, orgId, at',
    });
  }
}

export const db = new OxEyeDatabase();

/**
 * Creates a fresh default `ProjectFile` initialized with all three La Laguna venues.
 *
 * @returns Initialized `ProjectFile`.
 */
export function createDefaultProject(): ProjectFile {
  configure(MAPS_DATA);
  const scenes = Object.fromEntries(
    (Object.keys(VENUES) as VenueKey[]).map((k) => [
      k,
      initialScene(k, MAPS_DATA[k], CARTO_DATA),
    ])
  ) as Record<VenueKey, ReturnType<typeof initialScene>>;
  scenes.cristo = addResponseExample(smallExample(scenes.cristo));
  for (const scene of Object.values(scenes)) {
    for (const [i, f] of (scene.fences || []).entries()) {
      f.id ??= 'fence-' + i;
      f.name ??= 'Valla ' + (i + 1);
    }
    scene.safetyReview = assessRisk(scene);
  }
  return {
    version: 1,
    format: 'ojo-de-buey',
    active: 'cristo',
    maps: structuredClone(MAPS_DATA),
    scenes,
  };
}

/**
 * Valida si un mapa personalizado guardado o importado tiene una geometría cartográfica íntegra.
 */
function isValidCustomMap(m: VenueMap | undefined): boolean {
  if (!m?.customLocation) return false;
  const cl = m.customLocation;
  return (
    Array.isArray(m.bbox) &&
    m.bbox.length === 4 &&
    m.bbox.every((v) => Number.isFinite(v)) &&
    Number.isFinite(m.widthMeters) &&
    m.widthMeters >= 100 &&
    m.widthMeters <= 2000 &&
    Number.isFinite(m.heightMeters) &&
    m.heightMeters >= 100 &&
    m.heightMeters <= 2000 &&
    Number.isFinite(cl.lat) &&
    cl.lat >= -85 &&
    cl.lat <= 85 &&
    Number.isFinite(cl.lon) &&
    cl.lon >= -180 &&
    cl.lon <= 180 &&
    Number.isFinite(cl.sizeMeters) &&
    cl.sizeMeters >= 100 &&
    cl.sizeMeters <= 2000
  );
}

/**
 * Loads the active project synchronously from `localStorage` (falling back to `createDefaultProject`).
 *
 * @returns Validated `ProjectFile` and boolean `hasSaved` indicating whether a saved project existed.
 */
export function loadProjectFromStorage(): {
  project: ProjectFile;
  hasSaved: boolean;
} {
  configure(MAPS_DATA);
  const fallback = createDefaultProject();
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) return {project: fallback, hasSaved: false};
    const saved = JSON.parse(raw) as ProjectFile;
    if (saved?.format === 'ojo-de-buey' && saved.version === 1) {
      normalizeStoredProject(saved);
      configure(saved.maps);
      return {project: saved, hasSaved: true};
    }
  } catch {
    // Fallback to clean project if localStorage is corrupt or outdated
  }
  return {project: fallback, hasSaved: false};
}

/**
 * Validates and migrates a stored v1 project in place (same steps as loading
 * from localStorage). Used for the active cache and for event payloads opened
 * from IndexedDB (OX-03). Does not call `configure`.
 *
 * @throws Error if a scene is invalid or the cartographic base changed.
 */
export function normalizeStoredProject(saved: ProjectFile): ProjectFile {
  for (const k of Object.keys(VENUES) as VenueKey[]) {
    validateScene(saved.scenes[k]);
    const sameBase =
      JSON.stringify(saved.maps?.[k]?.bbox) ===
      JSON.stringify(MAPS_DATA[k].bbox);
    if (!sameBase && !isValidCustomMap(saved.maps?.[k])) {
      throw new Error('La base ha cambiado');
    }
    for (const [i, f] of (saved.scenes[k].fences || []).entries()) {
      f.id ??= 'fence-' + i;
      f.name ??= 'Valla ' + (i + 1);
    }
    migrateSceneContactsAndProgramme(saved.scenes[k]);
    syncDemandConfigToScene(
      saved.scenes[k],
      ensureEventDemandConfig(saved.scenes[k])
    );
  }
  return saved;
}

/**
 * Persists the project to both `localStorage` (synchronous fast access) and IndexedDB via Dexie.js.
 *
 * @param project - Project to persist.
 * @returns `true` if `localStorage` write succeeded, `false` if quota was exceeded.
 */
export function saveProjectToStorage(project: ProjectFile): boolean {
  let ok = true;
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
  } catch {
    ok = false;
  }
  db.projects
    .put({
      id: 'active',
      project: structuredClone(project),
      updatedAt: new Date().toISOString(),
    })
    .catch(() => {
      // Ignore IndexedDB errors in restricted environments
    });
  return ok;
}

/**
 * Loads user preferences from `localStorage`.
 *
 * @returns User preferences object.
 */
export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const palette = normalizePaletteId(parsed.palette);
    applyPalette(palette);
    return {
      speed: Number(parsed.speed) || 60,
      reduceMotion: !!parsed.reduceMotion,
      help: parsed.help !== false,
      palette,
    };
  } catch {
    applyPalette('oxeye');
    return {speed: 60, reduceMotion: false, help: true, palette: 'oxeye'};
  }
}

/**
 * Saves user preferences to `localStorage` and updates document body motion class and active color palette.
 *
 * @param prefs - User preferences to save.
 */
export function savePreferences(prefs: UserPreferences): void {
  document.body.classList.toggle('reduce-motion', !!prefs.reduceMotion);
  applyPalette(normalizePaletteId(prefs.palette));
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Triggers a browser file download with the given filename, text content, and MIME type.
 *
 * @param name - Target filename.
 * @param text - File content string.
 * @param type - MIME type (defaults to `'application/json'`).
 */
export function downloadFile(
  name: string,
  text: string,
  type = 'application/json'
): void {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports all georeferenced annotations across all venues to a UTF-8 BOM CSV file.
 *
 * @param project - Active project file.
 * @param maps - Georeferenced venue maps.
 */
export function exportNotesCSV(
  project: ProjectFile,
  maps: Record<VenueKey, VenueMap>
): void {
  const csv = (v: unknown): string =>
    '"' + String(v ?? '').replaceAll('"', '""') + '"';
  const rows: string[][] = [
    ['Espacio', 'Celda', 'Malla_m', 'Este_UTM', 'Norte_UTM', 'Observacion'],
  ];
  for (const [k, scene] of Object.entries(project.scenes) as Array<
    [VenueKey, ProjectFile['scenes'][VenueKey]]
  >) {
    for (const o of scene.annotations) {
      const map = maps[k];
      const p = world([o.x, o.y], map);
      rows.push([
        VENUES[k].name,
        o.cell,
        String(o.grid),
        (map.bbox[0] + p[0]).toFixed(2),
        (map.bbox[3] - p[1]).toFixed(2),
        /^[=+@-]/.test(o.text) ? "'" + o.text : o.text,
      ]);
    }
  }
  downloadFile(
    'Ojo_de_Buey_Observaciones.csv',
    '\uFEFF' + rows.map((r) => r.map(csv).join(';')).join('\r\n'),
    'text/csv;charset=utf-8'
  );
}

/**
 * Parses and validates an imported JSON file (either full `ojo-de-buey` project or legacy scenario).
 *
 * @param text - Raw JSON string.
 * @param currentProject - Current project state (used when merging a single-venue legacy file).
 * @param maps - Georeferenced venue maps.
 * @returns Validated `ProjectFile`.
 */
export function parseImportedProject(
  text: string,
  currentProject: ProjectFile,
  maps: Record<VenueKey, VenueMap>
): ProjectFile {
  let p: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON raíz inválido');
    }
    p = parsed as Record<string, unknown>;
  } catch {
    throw new Error(
      'El archivo subido no se corresponde con un modelo de OxEye (JSON no válido).'
    );
  }
  if (p.format === 'ojo-de-buey') {
    if (p.version !== 1 || !p.scenes || typeof p.scenes !== 'object') {
      throw new Error(
        'El archivo subido no se corresponde con un modelo compatible de OxEye.'
      );
    }
    const scenes = p.scenes as Record<VenueKey, ProjectFile['scenes'][VenueKey]>;
    const pMaps = p.maps as Record<VenueKey, VenueMap> | undefined;
    for (const k of Object.keys(VENUES) as VenueKey[]) {
      validateScene(scenes[k]);
      migrateSceneContactsAndProgramme(scenes[k]);
      syncDemandConfigToScene(scenes[k], ensureEventDemandConfig(scenes[k]));
      const sameBase =
        JSON.stringify(pMaps?.[k]?.bbox) === JSON.stringify(maps[k].bbox);
      if (!sameBase && !isValidCustomMap(pMaps?.[k])) {
        throw new Error(
          'La extensión cartográfica de este archivo es diferente.'
        );
      }
    }
    if (pMaps) configure(pMaps);
    return p as unknown as ProjectFile;
  } else {
    let old = (p.scenario || p) as ProjectFile['scenes'][VenueKey];
    const siteKey = old?.site as VenueKey;
    if (!siteKey || !ORIGINAL[siteKey] || !VENUES[siteKey]) {
      throw new Error(
        'El archivo subido no se corresponde con un modelo de los que se usan en OxEye.'
      );
    }
    old = remapScene(old, ORIGINAL[siteKey], maps[siteKey]);
    old.annotations = [];
    old.measurements = [];
    old.roadPlans = [];
    validateScene(old);
    migrateSceneContactsAndProgramme(old);
    syncDemandConfigToScene(old, ensureEventDemandConfig(old));
    const next = structuredClone(currentProject);
    next.scenes[siteKey] = old;
    next.active = siteKey;
    return next;
  }
}
