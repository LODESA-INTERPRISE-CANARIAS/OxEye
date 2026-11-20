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
  grid: number;
  gridVisible: boolean;
  labelsVisible: boolean;
  routesVisible: boolean;
  layerPanelOpen: boolean;
  lens: LensMode;
  daylight: number;
  immersive: boolean;
  menuOpen: boolean;
  activeModal: ActiveModal;
  saveStatusText: string;
  toastMessage: string | null;
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
  setGrid: (grid: number) => void;
  setGridVisible: (visible: boolean) => void;
  setLabelsVisible: (visible: boolean) => void;
  setRoutesVisible: (visible: boolean) => void;
  setLayerPanelOpen: (open: boolean) => void;
  setLens: (lens: LensMode) => void;
  setDaylight: (hour: number) => void;
  toggleImmersive: () => void;
  setMenuOpen: (open: boolean) => void;
  setActiveModal: (modal: ActiveModal) => void;
  showToast: (msg: string) => void;
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
  grid: 10,
  gridVisible: true,
  labelsVisible: true,
  routesVisible: true,
  layerPanelOpen: false,
  lens: 'people',
  daylight: 15,
  immersive: false,
  menuOpen: true,
  activeModal: null,
  saveStatusText: 'Guardado en este navegador',
  toastMessage: null,
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
      tool: 'select',
      saveStatusText: ok
        ? 'Guardado en este navegador'
        : 'Sin guardar · exporta el proyecto',
      revision: state.revision + 1,
    });
  },

  setPanel: (panel) => {
    set((state) => ({
      panel,
      tool: panel === 'simulate' ? 'select' : state.tool,
      selectedId: panel === 'simulate' ? null : state.selectedId,
      revision: state.revision + 1,
    }));
  },

  setPhase: (phase) => {
    set((state) => ({
      phase,
      selectedId: null,
      tool: 'select',
      revision: state.revision + 1,
    }));
  },

  setBase: (base) => set({base}),

  setTool: (tool) => {
    set((state) => {
      if (state.panel === 'simulate' && tool !== 'select') return state;
      return {
        tool,
        selectedId: tool !== 'select' ? null : state.selectedId,
      };
    });
  },

  setSelectedId: (selectedId) => {
    set((state) => {
      if (state.panel === 'simulate' && selectedId !== null) return state;
      return {
        selectedId,
        tool: selectedId !== null ? 'select' : state.tool,
      };
    });
  },

  setGrid: (grid) => set({grid}),
  setGridVisible: (gridVisible) => set({gridVisible}),
  setLabelsVisible: (labelsVisible) => set({labelsVisible}),
  setRoutesVisible: (routesVisible) => set({routesVisible}),
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

  showToast: (msg) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({toastMessage: msg});
    toastTimeout = setTimeout(() => {
      set({toastMessage: null});
    }, 4200);
  },

  clearToast: () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({toastMessage: null});
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
    Object.assign(next, {
      title: config.name,
      eventDays: config.eventDays,
      startDate: config.startDate,
      endDate: config.endDate,
      endTime: config.endTime,
      eventGoals: config.goals,
      smartGoal: config.smartGoal,
      stockIntroShown: true,
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
      tool: 'select',
      menuOpen: false,
      activeModal: 'inventory',
      revision: state.revision + 1,
    });
  },
}));
