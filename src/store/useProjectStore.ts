import {create} from 'zustand';
import {VENUES} from '../data/catalog';
import {CARTO_DATA, MAPS_DATA} from '../data/geodata';
import {
  createDefaultProject,
  loadPreferences,
  loadProjectFromStorage,
  savePreferences,
  saveProjectToStorage,
} from '../db/repository';
import {buildCustomMapMetadata} from '../engine/cartography/custom-map';
import {configure, initialScene} from '../engine/crowd/presets';
import {smallExample} from '../engine/crowd/small-example';
import {addResponseExample} from '../engine/emergency/response-example';
import {assessRisk} from '../engine/emergency/risk';
import type {SpatialCorrectionProposal} from '../engine/planning/spatial-assistant';
import type {ClipboardPayload} from '../components/map/selectionActions';
import {isXrayTool, subsoilIdsInScene} from '../components/map/selectionActions';
import type {
  ActivePanel,
  BaseLayerMode,
  CustomLocationConfig,
  CustomMapFeature,
  CustomMapStreet,
  LensMode,
  PhaseFilter,
  ProjectFile,
  ProjectObjectives,
  Scene,
  UserPreferences,
  VenueKey,
  VenueMap,
  WorkShiftDay,
} from '../types';
import {summarizeLegacySmartGoal} from '../engine/planning/objectives';

export type OnboardingStage = 'none' | 'perimeter' | 'inventory';

export interface ToastAction {
  label?: string;
  targetId?: string;
  targetPoint?: [number, number];
  panel?: ActivePanel;
  enableXray?: boolean;
}

export interface MapFocusRequest {
  id?: string;
  point?: [number, number];
  seq: number;
}

export type ActiveModal =
  | null
  | 'objectives'
  | 'demand'
  | 'programme'
  | 'inventory'
  | 'laboratory'
  | 'contacts'
  | 'org'
  | 'parameters'
  | 'closing'
  | 'comparison'
  | 'info'
  | 'risk'
  | 'small-example';

export interface ProjectStoreState {
  project: ProjectFile;
  hasSavedProject: boolean;
  activeVenue: VenueKey;
  panel: ActivePanel;
  phase: PhaseFilter;
  base: BaseLayerMode;
  tool: string;
  selectedId: string | null;
  selectedIds: string[];
  clipboard: ClipboardPayload | null;
  grid: number;
  fenceLength: number;
  gridVisible: boolean;
  labelsVisible: boolean;
  routesVisible: boolean;
  routesCurved: boolean;
  simSeedMode: 'random' | 'fixed';
  simSeedValue: number;
  activeRunSeed: number | null;
  xrayVisible: boolean;
  subsoilOnly: boolean;
  layerPanelOpen: boolean;
  lens: LensMode;
  daylight: number;
  immersive: boolean;
  menuOpen: boolean;
  activeModal: ActiveModal;
  lastEvaluationModal: 'risk' | 'comparison' | null;
  previewCorrection: SpatialCorrectionProposal | null;
  onboardingStage: OnboardingStage;
  tutorialActive: boolean;
  saveStatusText: string;
  toastMessage: string | null;
  toastTone: 'default' | 'error';
  toastAction: ToastAction | null;
  focusRequest: MapFocusRequest | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  inspectorWidth: number;
  inspectorExpanded: boolean;
  /** Cuando es `true`, ejecuta la simulación en modo diagnóstico (escenario no validado — uso exclusivamente analítico). */
  diagnosticSimMode: boolean;
  history: string[];
  future: string[];
  preferences: UserPreferences;
  revision: number;

  // Selectors
  currentScene: () => Scene;
  currentMap: () => VenueMap;

  // Actions
  setVenue: (venue: VenueKey) => void;
  setPanel: (panel: ActivePanel) => void;
  setPhase: (phase: PhaseFilter) => void;
  setBase: (base: BaseLayerMode) => void;
  setTool: (tool: string) => void;
  setSelectedId: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectedId: (id: string) => void;
  clearSelection: () => void;
  setClipboard: (clipboard: ClipboardPayload | null) => void;
  setGrid: (grid: number) => void;
  setFenceLength: (length: number) => void;
  setGridVisible: (visible: boolean) => void;
  setLabelsVisible: (visible: boolean) => void;
  setRoutesVisible: (visible: boolean) => void;
  setRoutesCurved: (curved: boolean) => void;
  setSimSeedMode: (mode: 'random' | 'fixed') => void;
  setSimSeedValue: (seed: number) => void;
  setActiveRunSeed: (seed: number | null) => void;
  randomizeSimSeed: () => number;
  setXrayVisible: (visible: boolean) => void;
  setSubsoilOnly: (only: boolean) => void;
  setLayerPanelOpen: (open: boolean) => void;
  setLens: (lens: LensMode) => void;
  setDaylight: (hour: number) => void;
  toggleImmersive: () => void;
  setMenuOpen: (open: boolean) => void;
  setActiveModal: (modal: ActiveModal) => void;
  setLastEvaluationModal: (modal: 'risk' | 'comparison' | null) => void;
  setPreviewCorrection: (proposal: SpatialCorrectionProposal | null) => void;
  setOnboardingStage: (stage: OnboardingStage) => void;
  setTutorialActive: (active: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebarCollapsed: () => void;
  setInspectorWidth: (width: number) => void;
  toggleInspectorExpanded: () => void;
  setDiagnosticSimMode: (enabled: boolean) => void;
  locateOnMap: (target: {
    id?: string;
    point?: [number, number];
    panel?: ActivePanel;
    enableXray?: boolean;
  }) => void;
  showToast: (
    msg: string,
    tone?: 'default' | 'error',
    action?: ToastAction | null
  ) => void;
  clearToast: () => void;
  checkpoint: () => void;
  undo: (isRedo?: boolean) => void;
  updateScene: (updater: (scene: Scene) => void, recordCheckpoint?: boolean) => void;
  setCustomMapVectors: (
    streets: CustomMapStreet[],
    features: CustomMapFeature[]
  ) => void;
  replaceScene: (scene: Scene, recordCheckpoint?: boolean) => void;
  replaceProject: (project: ProjectFile, recordCheckpoint?: boolean) => void;
  /** Opens another event's payload: replaces the project and clears undo history (OX-03 D11). */
  openEventPayload: (project: ProjectFile) => void;
  /** `true` when the active workspace role may not edit the event (local, indicative). */
  readOnly: boolean;
  setReadOnly: (readOnly: boolean) => void;
  save: () => void;
  updatePreferences: (partial: Partial<UserPreferences>) => void;
  createFromWizard: (config: {
    name: string;
    example: boolean;
    startDate: string;
    endDate: string;
    from: string;
    to: string;
    goals: string[];
    objectives?: ProjectObjectives;
    smartGoal?: {
      specific: string;
      metric: string;
      target: string;
      feasible: string;
      relevant: string;
      deadline: string;
    };
    eventDays: number;
    start: number;
    hours: number;
    endTime: string;
    workDays?: WorkShiftDay[];
    customLocation?: CustomLocationConfig;
    startTutorial?: boolean;
  }) => void;
}

let toastTimeout: ReturnType<typeof setTimeout> | undefined;

const initialLoaded = loadProjectFromStorage();
configure(initialLoaded.project.maps);
const initialPrefs = loadPreferences();

/**
 * Global Zustand store for OxEye project, active venue, tools, history, and UI modals.
 */
export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  project: initialLoaded.project,
  hasSavedProject: initialLoaded.hasSaved,
  activeVenue: VENUES[initialLoaded.project.active]
    ? initialLoaded.project.active
    : 'cristo',
  panel: 'design',
  phase: 'event',
  base: 'plan',
  tool:
    (initialLoaded.project.scenes[
      VENUES[initialLoaded.project.active]
        ? initialLoaded.project.active
        : 'cristo'
    ]?.boundary?.length || 0) < 3
      ? 'boundary'
      : 'select',
  selectedId: null,
  selectedIds: [],
  clipboard: null,
  grid: 10,
  fenceLength: 3.5,
  gridVisible: true,
  labelsVisible: true,
  routesVisible: true,
  routesCurved: false,
  simSeedMode: 'random',
  simSeedValue:
    initialLoaded.project.scenes[
      VENUES[initialLoaded.project.active]
        ? initialLoaded.project.active
        : 'cristo'
    ]?.seed || 2026,
  activeRunSeed: null,
  xrayVisible: false,
  subsoilOnly: false,
  layerPanelOpen: false,
  lens: 'people',
  daylight: 15,
  immersive: false,
  menuOpen: true,
  activeModal: null,
  lastEvaluationModal: null,
  previewCorrection: null,
  onboardingStage:
    (initialLoaded.project.scenes[
      VENUES[initialLoaded.project.active]
        ? initialLoaded.project.active
        : 'cristo'
    ]?.boundary?.length || 0) < 3
      ? 'perimeter'
      : 'none',
  tutorialActive: false,
  saveStatusText: 'Guardado en este navegador',
  toastMessage: null,
  toastTone: 'default',
  toastAction: null,
  focusRequest: null,
  sidebarWidth: 308,
  sidebarCollapsed: false,
  inspectorWidth: 312,
  inspectorExpanded: false,
  diagnosticSimMode: false,
  history: [],
  future: [],
  preferences: initialPrefs,
  revision: 0,

  currentScene: () => {
    const state = get();
    return state.project.scenes[state.activeVenue];
  },

  currentMap: () => {
    const state = get();
    return state.project.maps[state.activeVenue] || MAPS_DATA[state.activeVenue];
  },

  setVenue: (venue) => {
    const state = get();
    const nextProject = structuredClone(state.project);
    nextProject.active = venue;
    const ok = saveProjectToStorage(nextProject);
    set({
      project: nextProject,
      activeVenue: venue,
      selectedId: null,
      selectedIds: [],
      tool: 'select',
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  setPanel: (panel) => {
    set((state) => {
      if (state.onboardingStage === 'perimeter' && panel !== 'design') {
        return state;
      }
      if (panel === 'simulate') {
        return {
          panel,
          tool: 'select',
          selectedId: null,
          selectedIds: [],
          revision: state.revision + 1,
        };
      }
      const nextTool =
        panel !== 'design' && isXrayTool(state.tool) ? 'select' : state.tool;
      let nextIds = state.selectedIds;
      if (panel !== 'design' && nextIds.length) {
        const subIds = subsoilIdsInScene(state.project.scenes[state.activeVenue]);
        nextIds = nextIds.filter((id) => !subIds.has(id));
      }
      return {
        panel,
        tool: nextTool,
        selectedIds: nextIds,
        selectedId: nextIds.length === 1 ? nextIds[0] : null,
        revision: state.revision + 1,
      };
    });
  },

  setPhase: (phase) => {
    set((state) => ({
      phase,
      subsoilOnly: false,
      xrayVisible: state.subsoilOnly ? false : state.xrayVisible,
      selectedId: null,
      selectedIds: [],
      tool: 'select',
      revision: state.revision + 1,
    }));
  },

  setBase: (base) => set({base}),

  setTool: (tool) => {
    set((state) => {
      if (state.onboardingStage === 'perimeter' && tool !== 'boundary') {
        return state;
      }
      if (state.panel === 'simulate' && tool !== 'select') return state;
      if (isXrayTool(tool) && state.panel !== 'design') return state;
      const keepSelection = tool === 'select' || tool === 'xray:select';
      return {
        tool,
        xrayVisible: isXrayTool(tool) ? true : state.xrayVisible,
        selectedIds: keepSelection ? state.selectedIds : [],
        selectedId: keepSelection ? state.selectedId : null,
      };
    });
  },

  setSelectedIds: (ids) => {
    set((state) => {
      if (state.panel === 'simulate' && ids.length) return state;
      const unique = [...new Set(ids)];
      const nextTool =
        unique.length && state.tool !== 'xray:select' ? 'select' : state.tool;
      if (
        state.tool === nextTool &&
        state.selectedIds.length === unique.length &&
        state.selectedIds.every((v, i) => v === unique[i])
      ) {
        return state;
      }
      return {
        selectedIds: unique,
        selectedId: unique.length === 1 ? unique[0] : null,
        tool: nextTool,
      };
    });
  },

  setSelectedId: (selectedId) => {
    get().setSelectedIds(selectedId ? [selectedId] : []);
  },

  toggleSelectedId: (id) => {
    set((state) => {
      if (state.panel === 'simulate') return state;
      const exists = state.selectedIds.includes(id);
      const nextIds = exists
        ? state.selectedIds.filter((x) => x !== id)
        : [...state.selectedIds, id];
      const nextTool =
        nextIds.length && state.tool !== 'xray:select' ? 'select' : state.tool;
      return {
        selectedIds: nextIds,
        selectedId: nextIds.length === 1 ? nextIds[0] : null,
        tool: nextTool,
      };
    });
  },

  clearSelection: () => set({selectedIds: [], selectedId: null}),
  setClipboard: (clipboard) => set({clipboard}),

  setGrid: (grid) => set({grid}),
  setFenceLength: (length) =>
    set({
      fenceLength: Math.max(
        0.5,
        Math.min(10, Math.round((Number(length) || 3.5) * 100) / 100)
      ),
    }),
  setGridVisible: (gridVisible) => set({gridVisible}),
  setLabelsVisible: (labelsVisible) => set({labelsVisible}),
  setRoutesVisible: (routesVisible) => set({routesVisible}),
  setRoutesCurved: (routesCurved) => set({routesCurved}),
  setSimSeedMode: (simSeedMode) => set({simSeedMode}),
  setSimSeedValue: (seed) =>
    set({
      simSeedValue: Math.max(1, Math.floor(Math.abs(Number(seed) || 2026)) >>> 0),
    }),
  setActiveRunSeed: (activeRunSeed) => set({activeRunSeed}),
  randomizeSimSeed: () => {
    const buf = new Uint32Array(1);
    let next = 2026;
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(buf);
      next = (buf[0] % 900000) + 100000;
    } else {
      next = Math.floor(100000 + Math.random() * 899999);
    }
    set({simSeedValue: next});
    return next;
  },
  setXrayVisible: (xrayVisible) => {
    set((state) => {
      if (xrayVisible) return {xrayVisible: true};
      const subIds = subsoilIdsInScene(state.project.scenes[state.activeVenue]);
      const nextIds = state.selectedIds.filter((id) => !subIds.has(id));
      return {
        xrayVisible: false,
        subsoilOnly: false,
        tool: isXrayTool(state.tool) ? 'select' : state.tool,
        selectedIds: nextIds,
        selectedId: nextIds.length === 1 ? nextIds[0] : null,
      };
    });
  },
  setSubsoilOnly: (subsoilOnly) => {
    set((state) => {
      const subIds = subsoilIdsInScene(state.project.scenes[state.activeVenue]);
      if (!subsoilOnly) {
        const nextIds = state.selectedIds.filter((id) => !subIds.has(id));
        return {
          subsoilOnly: false,
          xrayVisible: false,
          tool: isXrayTool(state.tool) ? 'select' : state.tool,
          selectedIds: nextIds,
          selectedId: nextIds.length === 1 ? nextIds[0] : null,
        };
      }
      const nextIds = state.selectedIds.filter((id) => subIds.has(id));
      return {
        subsoilOnly: true,
        xrayVisible: true,
        selectedIds: nextIds,
        selectedId: nextIds.length === 1 ? nextIds[0] : null,
      };
    });
  },
  setLayerPanelOpen: (layerPanelOpen) => set({layerPanelOpen}),
  setLens: (lens) => set({lens}),
  setDaylight: (daylight) => set({daylight}),

  toggleImmersive: () => {
    set((state) => {
      const next = !state.immersive;
      document.body.classList.toggle('immersive', next);
      return {immersive: next};
    });
  },

  setMenuOpen: (menuOpen) => {
    document.body.classList.toggle('at-menu', menuOpen);
    set({menuOpen});
  },

  setActiveModal: (activeModal) =>
    set((state) => {
      if (
        state.onboardingStage === 'perimeter' &&
        activeModal !== null &&
        activeModal !== 'info'
      ) {
        return state;
      }
      return {
        activeModal,
        lastEvaluationModal:
          activeModal === 'risk' || activeModal === 'comparison'
            ? activeModal
            : state.lastEvaluationModal,
      };
    }),
  setLastEvaluationModal: (lastEvaluationModal) => set({lastEvaluationModal}),
  setPreviewCorrection: (previewCorrection) => set({previewCorrection}),

  setOnboardingStage: (onboardingStage) => set({onboardingStage}),
  setTutorialActive: (tutorialActive) => set({tutorialActive}),

  setSidebarWidth: (width) =>
    set({
      sidebarWidth: Math.max(220, Math.min(540, Math.round(Number(width) || 308))),
      sidebarCollapsed: false,
    }),

  toggleSidebarCollapsed: () =>
    set((state) => ({sidebarCollapsed: !state.sidebarCollapsed})),

  setInspectorWidth: (width) =>
    set({
      inspectorWidth: Math.max(250, Math.min(520, Math.round(Number(width) || 312))),
      inspectorExpanded: Number(width) >= 380,
    }),

  toggleInspectorExpanded: () =>
    set((state) => {
      const nextExpanded = !state.inspectorExpanded;
      return {
        inspectorExpanded: nextExpanded,
        inspectorWidth: nextExpanded ? 410 : 312,
      };
    }),

  setDiagnosticSimMode: (diagnosticSimMode) => set({diagnosticSimMode}),

  locateOnMap: (target) => {
    set((state) => {
      const nextPanel = target.panel || (state.panel === 'simulate' ? 'design' : state.panel);
      const nextIds = target.id ? [target.id] : state.selectedIds;
      return {
        panel: nextPanel,
        tool: 'select',
        xrayVisible: target.enableXray ? true : state.xrayVisible,
        selectedIds: nextIds,
        selectedId: nextIds.length === 1 ? nextIds[0] : null,
        activeModal: null,
        focusRequest: {
          id: target.id,
          point: target.point,
          seq: (state.focusRequest?.seq || 0) + 1,
        },
        revision: state.revision + 1,
      };
    });
  },

  showToast: (msg, tone = 'default', action = null) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    const hasAction = !!(action?.targetId || action?.targetPoint);
    const effectiveTone =
      tone === 'error' || hasAction ? 'error' : tone;
    set({
      toastMessage: msg,
      toastTone: effectiveTone,
      toastAction: action || null,
    });
    toastTimeout = setTimeout(
      () => {
        set({toastMessage: null, toastTone: 'default', toastAction: null});
      },
      hasAction || effectiveTone === 'error' ? 8000 : 4200
    );
  },

  clearToast: () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({toastMessage: null, toastTone: 'default', toastAction: null});
  },

  checkpoint: () => {
    const state = get();
    const snap = JSON.stringify(state.project);
    const nextHistory = [...state.history, snap];
    if (nextHistory.length > 35) nextHistory.shift();
    set({history: nextHistory, future: []});
  },

  undo: (isRedo = false) => {
    const state = get();
    if (state.panel === 'simulate') return;
    if (state.readOnly) {
      get().showToast('Tu perfil no permite modificar este evento (modo local).');
      return;
    }
    const from = isRedo ? [...state.future] : [...state.history];
    const to = isRedo ? [...state.history] : [...state.future];
    if (!from.length) return;
    to.push(JSON.stringify(state.project));
    const popped = from.pop()!;
    const nextProject = JSON.parse(popped) as ProjectFile;
    configure(nextProject.maps);
    const nextVenue = VENUES[nextProject.active]
      ? nextProject.active
      : 'cristo';
    const ok = saveProjectToStorage(nextProject);
    set({
      project: nextProject,
      activeVenue: nextVenue,
      selectedId: null,
      selectedIds: [],
      history: isRedo ? to : from,
      future: isRedo ? from : to,
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  updateScene: (updater, recordCheckpoint = false) => {
    if (get().readOnly) {
      get().showToast('Tu perfil no permite modificar este evento (modo local).');
      return;
    }
    if (recordCheckpoint) get().checkpoint();
    const state = get();
    const nextProject = structuredClone(state.project);
    const scene = nextProject.scenes[state.activeVenue];
    updater(scene);
    scene.safetyReview = assessRisk(scene);
    nextProject.active = state.activeVenue;
    const ok = saveProjectToStorage(nextProject);
    if (!ok) {
      get().showToast(
        'No queda espacio local. Exporta el proyecto para conservarlo.'
      );
    }
    set({
      project: nextProject,
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  setCustomMapVectors: (streets, features) => {
    if (get().readOnly) return;
    const state = get();
    const curMap = state.project.maps[state.activeVenue];
    if (!curMap?.customLocation) return;
    const nextProject = structuredClone(state.project);
    const targetMap = nextProject.maps[state.activeVenue];
    if (!targetMap?.customLocation) return;
    targetMap.customLocation.streets = structuredClone(streets);
    targetMap.customLocation.features = structuredClone(features);
    configure(nextProject.maps);
    const ok = saveProjectToStorage(nextProject);
    set({
      project: nextProject,
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  replaceScene: (scene, recordCheckpoint = false) => {
    if (get().readOnly) {
      get().showToast('Tu perfil no permite modificar este evento (modo local).');
      return;
    }
    if (recordCheckpoint) get().checkpoint();
    const state = get();
    const nextProject = structuredClone(state.project);
    const clonedScene = structuredClone(scene);
    clonedScene.safetyReview = assessRisk(clonedScene);
    nextProject.scenes[state.activeVenue] = clonedScene;
    nextProject.active = state.activeVenue;
    const ok = saveProjectToStorage(nextProject);
    set({
      project: nextProject,
      hasSavedProject: true,
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  replaceProject: (project, recordCheckpoint = false) => {
    if (get().readOnly) {
      get().showToast('Tu perfil no permite modificar este evento (modo local).');
      return;
    }
    if (recordCheckpoint) get().checkpoint();
    const state = get();
    const cloned = structuredClone(project);
    configure(cloned.maps);
    const nextVenue = VENUES[cloned.active] ? cloned.active : 'cristo';
    const ok = saveProjectToStorage(cloned);
    const needsPerimeter =
      (cloned.scenes[nextVenue]?.boundary?.length || 0) < 3;
    set({
      project: cloned,
      hasSavedProject: true,
      activeVenue: nextVenue,
      selectedId: null,
      selectedIds: [],
      tool: needsPerimeter ? 'boundary' : 'select',
      onboardingStage: needsPerimeter ? 'perimeter' : 'none',
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  openEventPayload: (project) => {
    // Opening is not an edit: lift the guard; the workspace store recomputes
    // `readOnly` for the newly opened event right after.
    set({readOnly: false});
    get().replaceProject(project, false);
    const scene = get().currentScene();
    set({
      history: [],
      future: [],
      activeModal: null,
      previewCorrection: null,
      simSeedValue: scene?.seed || 2026,
      activeRunSeed: null,
    });
  },

  readOnly: false,
  setReadOnly: (readOnly) => set({readOnly}),

  save: () => {
    const state = get();
    const ok = saveProjectToStorage(state.project);
    if (!ok) {
      get().showToast(
        'No queda espacio local. Exporta el proyecto para conservarlo.'
      );
    }
    set({
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
    });
  },

  updatePreferences: (partial) => {
    const state = get();
    const next = {...state.preferences, ...partial};
    savePreferences(next);
    set({preferences: next});
  },

  createFromWizard: (config) => {
    const state = get();
    // Each wizard run creates a new event: start from a fresh default project so
    // nothing is inherited from the previously open event (OX-03 D12).
    const nextProject = createDefaultProject();
    const isCustom = !!config.customLocation;
    const targetMap = isCustom
      ? buildCustomMapMetadata(config.customLocation!)
      : structuredClone(MAPS_DATA.cristo);
    nextProject.maps.cristo = targetMap;
    configure(nextProject.maps);

    const next = initialScene('cristo', targetMap, isCustom ? {
      crs: targetMap.crs,
      retrieved: targetMap.retrieved,
      source: targetMap.source,
      attribution: targetMap.attribution,
      features: [],
    } : CARTO_DATA);

    const useExample = !isCustom && config.example;
    if (!useExample) {
      next.base.booths = [];
      next.infrastructure = [];
      next.entrances = [];
      next.flows = [];
      next.corridors = [];
      next.fences = [];
      next.reserves = [];
      next.passages = [];
    }
    // El primer paso obligatorio tras elegir la zona es delimitar el perímetro operativo sobre el mapa.
    next.boundary = [];

    const workDays = config.workDays || [];
    const preDays = workDays.filter((d) => d.kind === 'pre');
    const postDays = workDays.filter((d) => d.kind === 'post');
    const firstLogHours =
      preDays[0]?.hours || postDays[0]?.hours || next.hoursLimit || 8;
    next.base.start = config.start;
    next.base.hours = config.hours;
    Object.assign(next, {
      title: config.name,
      eventDays: config.eventDays,
      startDate: config.startDate,
      endDate: config.endDate,
      endTime: config.endTime,
      eventGoals: config.objectives
        ? [...config.objectives.profile.activeAxes]
        : config.goals,
      objectives: config.objectives,
      smartGoal: config.objectives
        ? summarizeLegacySmartGoal(config.objectives)
        : config.smartGoal,
      stockIntroShown: true,
      workDays,
      shiftDays: {
        pre: Math.max(1, preDays.length),
        post: Math.max(1, postDays.length),
      },
      hoursLimit: Math.max(0.5, Math.min(8, firstLogHours)),
    });
    if (useExample) {
      Object.assign(next, addResponseExample(smallExample(next)));
      next.boundary = [];
    }
    if (
      useExample &&
      !next.infrastructure.some((o) => o.kind === 'security')
    ) {
      const g = next.entrances[0];
      if (g) {
        next.infrastructure.push({
          id: crypto.randomUUID(),
          name: 'Patrulla a pie · supuesto',
          kind: 'security',
          role: 'emergency',
          x: g.x,
          y: g.y,
          width: 0.9,
          depth: 0.9,
          staff: 2,
          capacity: 1,
          delay: 15,
          handling: 120,
          active: true,
          phaseTags: ['event'],
        });
      }
    }
    next.base.start = config.start;
    next.base.hours = config.hours;
    for (const b of next.base.booths) b.close = config.hours;
    next.mix = config.objectives?.confirmedHypotheses?.confirmed
      ? {...config.objectives.confirmedHypotheses.mix}
      : {
          buyer: config.goals.includes('local') ? 35 : 15,
          foodie: config.goals.includes('food') ? 35 : 15,
          culture:
            config.goals.includes('culture') || config.goals.includes('family')
              ? 35
              : 15,
          music: config.goals.includes('music') ? 35 : 15,
          walker: config.goals.includes('comfort') ? 30 : 15,
        };
    next.safetyReview = assessRisk(next);
    nextProject.scenes.cristo = next;
    nextProject.active = 'cristo';
    saveProjectToStorage(nextProject);
    document.body.classList.remove('at-menu');
    set({
      project: nextProject,
      hasSavedProject: true,
      activeVenue: 'cristo',
      phase: 'event',
      panel: 'design',
      selectedId: null,
      selectedIds: [],
      tool: 'boundary',
      onboardingStage: 'perimeter',
      tutorialActive: config.startTutorial ?? !state.hasSavedProject,
      menuOpen: false,
      activeModal: null,
      readOnly: false,
      history: [],
      future: [],
      simSeedValue: next.seed || 2026,
      activeRunSeed: null,
      saveStatusText: 'Guardado en este navegador',
      revision: state.revision + 1,
    });
  },
}));
