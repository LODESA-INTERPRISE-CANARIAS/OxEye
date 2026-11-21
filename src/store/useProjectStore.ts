import {create} from 'zustand';
import {VENUES} from '../data/catalog';
import {CARTO_DATA, MAPS_DATA} from '../data/geodata';
import {
  loadPreferences,
  loadProjectFromStorage,
  savePreferences,
  saveProjectToStorage,
} from '../db/repository';
import {initialScene} from '../engine/crowd/presets';
import {smallExample} from '../engine/crowd/small-example';
import {addResponseExample} from '../engine/emergency/response-example';
import {assessRisk} from '../engine/emergency/risk';
import type {ClipboardPayload} from '../components/map/selectionActions';
import {isXrayTool, subsoilIdsInScene} from '../components/map/selectionActions';
import type {
  ActivePanel,
  BaseLayerMode,
  LensMode,
  PhaseFilter,
  ProjectFile,
  Scene,
  UserPreferences,
  VenueKey,
  VenueMap,
  WorkShiftDay,
} from '../types';

export type ActiveModal =
  | null
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
  | 'small-example'
  | 'developer-reference';

export interface ProjectStoreState {
  project: ProjectFile;
  activeVenue: VenueKey;
  panel: ActivePanel;
  phase: PhaseFilter;
  base: BaseLayerMode;
  tool: string;
  selectedId: string | null;
  selectedIds: string[];
  clipboard: ClipboardPayload | null;
  grid: number;
  gridVisible: boolean;
  labelsVisible: boolean;
  routesVisible: boolean;
  xrayVisible: boolean;
  layerPanelOpen: boolean;
  lens: LensMode;
  daylight: number;
  immersive: boolean;
  menuOpen: boolean;
  activeModal: ActiveModal;
  saveStatusText: string;
  toastMessage: string | null;
  toastTone: 'default' | 'error';
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
  setGridVisible: (visible: boolean) => void;
  setLabelsVisible: (visible: boolean) => void;
  setRoutesVisible: (visible: boolean) => void;
  setXrayVisible: (visible: boolean) => void;
  setLayerPanelOpen: (open: boolean) => void;
  setLens: (lens: LensMode) => void;
  setDaylight: (hour: number) => void;
  toggleImmersive: () => void;
  setMenuOpen: (open: boolean) => void;
  setActiveModal: (modal: ActiveModal) => void;
  showToast: (msg: string, tone?: 'default' | 'error') => void;
  clearToast: () => void;
  checkpoint: () => void;
  undo: (isRedo?: boolean) => void;
  updateScene: (updater: (scene: Scene) => void, recordCheckpoint?: boolean) => void;
  replaceScene: (scene: Scene, recordCheckpoint?: boolean) => void;
  replaceProject: (project: ProjectFile, recordCheckpoint?: boolean) => void;
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
  }) => void;
}

let toastTimeout: ReturnType<typeof setTimeout> | undefined;

const initialLoaded = loadProjectFromStorage();
const initialPrefs = loadPreferences();

/**
 * Global Zustand store for OxEye project, active venue, tools, history, and UI modals.
 */
export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  project: initialLoaded.project,
  activeVenue: VENUES[initialLoaded.project.active]
    ? initialLoaded.project.active
    : 'cristo',
  panel: 'design',
  phase: 'event',
  base: 'plan',
  tool: 'select',
  selectedId: null,
  selectedIds: [],
  clipboard: null,
  grid: 10,
  gridVisible: true,
  labelsVisible: true,
  routesVisible: true,
  xrayVisible: false,
  layerPanelOpen: false,
  lens: 'people',
  daylight: 15,
  immersive: false,
  menuOpen: true,
  activeModal: null,
  saveStatusText: 'Guardado en este navegador',
  toastMessage: null,
  toastTone: 'default',
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
    return MAPS_DATA[state.activeVenue];
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
      selectedId: null,
      selectedIds: [],
      tool: 'select',
      revision: state.revision + 1,
    }));
  },

  setBase: (base) => set({base}),

  setTool: (tool) => {
    set((state) => {
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
  setGridVisible: (gridVisible) => set({gridVisible}),
  setLabelsVisible: (labelsVisible) => set({labelsVisible}),
  setRoutesVisible: (routesVisible) => set({routesVisible}),
  setXrayVisible: (xrayVisible) => {
    set((state) => {
      if (xrayVisible) return {xrayVisible: true};
      const subIds = subsoilIdsInScene(state.project.scenes[state.activeVenue]);
      const nextIds = state.selectedIds.filter((id) => !subIds.has(id));
      return {
        xrayVisible: false,
        tool: isXrayTool(state.tool) ? 'select' : state.tool,
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

  setActiveModal: (activeModal) => set({activeModal}),

  showToast: (msg, tone = 'default') => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({toastMessage: msg, toastTone: tone});
    toastTimeout = setTimeout(() => {
      set({toastMessage: null, toastTone: 'default'});
    }, 4200);
  },

  clearToast: () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({toastMessage: null, toastTone: 'default'});
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
    const from = isRedo ? [...state.future] : [...state.history];
    const to = isRedo ? [...state.history] : [...state.future];
    if (!from.length) return;
    to.push(JSON.stringify(state.project));
    const popped = from.pop()!;
    const nextProject = JSON.parse(popped) as ProjectFile;
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

  replaceScene: (scene, recordCheckpoint = false) => {
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
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  replaceProject: (project, recordCheckpoint = false) => {
    if (recordCheckpoint) get().checkpoint();
    const state = get();
    const nextVenue = VENUES[project.active] ? project.active : 'cristo';
    const ok = saveProjectToStorage(project);
    set({
      project: structuredClone(project),
      activeVenue: nextVenue,
      selectedId: null,
      selectedIds: [],
      tool: 'select',
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

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
    get().checkpoint();
    const state = get();
    const next = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    if (!config.example) {
      next.base.booths = [];
      next.infrastructure = [];
      next.flows = [];
      next.corridors = [];
      next.fences = [];
    }
    const workDays = config.workDays || [];
    const preDays = workDays.filter((d) => d.kind === 'pre');
    const postDays = workDays.filter((d) => d.kind === 'post');
    const firstLogHours =
      preDays[0]?.hours || postDays[0]?.hours || next.hoursLimit || 8;
    Object.assign(next, {
      title: config.name,
      eventDays: config.eventDays,
      startDate: config.startDate,
      endDate: config.endDate,
      endTime: config.endTime,
      eventGoals: config.goals,
      smartGoal: config.smartGoal,
      stockIntroShown: true,
      workDays,
      shiftDays: {
        pre: Math.max(1, preDays.length),
        post: Math.max(1, postDays.length),
      },
      hoursLimit: Math.max(0.5, Math.min(8, firstLogHours)),
    });
    if (config.example) {
      Object.assign(next, addResponseExample(smallExample(next)));
    }
    if (
      config.example &&
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
    next.mix = {
      buyer: config.goals.includes('local') ? 35 : 15,
      foodie: config.goals.includes('food') ? 35 : 15,
      culture:
        config.goals.includes('culture') || config.goals.includes('family')
          ? 35
          : 15,
      music: config.goals.includes('music') ? 35 : 15,
      walker: config.goals.includes('comfort') ? 30 : 15,
    };
    const nextProject = structuredClone(state.project);
    nextProject.scenes.cristo = next;
    nextProject.active = 'cristo';
    saveProjectToStorage(nextProject);
    document.body.classList.remove('at-menu');
    set({
      project: nextProject,
      activeVenue: 'cristo',
      phase: 'event',
      panel: 'design',
      selectedId: null,
      selectedIds: [],
      tool: 'select',
      menuOpen: false,
      activeModal: 'inventory',
      revision: state.revision + 1,
    });
  },
}));
