/**
 * @module types
 * Definiciones de tipos e interfaces globales para Ojo de Buey (OxEye).
 */

/** Identificadores de los recintos soportados en San Cristóbal de La Laguna. */
export type VenueKey = 'cristo' | 'constitucion' | 'vega';

/** Fases operativas del evento. */
export type PhaseKey = 'pre' | 'event' | 'post';

/** Filtros de vista de fase (incluye vista compuesta 'all'). */
export type PhaseViewKey = PhaseKey | 'all';

/** Paneles principales del espacio de trabajo. */
export type WorkspacePanel = 'design' | 'simulate' | 'review';

/** Base cartográfica activa en el visor. */
export type BaseMapMode = 'plan' | 'ortho';

/** Condiciones climáticas soportadas por el simulador. */
export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'wind';

/** Coordenada bidimensional `[x, y]`. */
export type Point2D = [number, number];

/** Clasificación de infraestructura / tránsito admitido en un punto de aparición (spawn). */
export type SpawnKind = 'pedestrian' | 'vehicle' | 'mixed';

/** Vía vectorial simplificada obtenida de OpenStreetMap para un emplazamiento personalizado. */
export interface CustomMapStreet {
  name: string;
  highway: string;
  kind: 'pedestrian' | 'vehicle';
  /** Puntos en coordenadas locales en metros `[x, y]` respecto a la esquina superior izquierda del mapa. */
  points: Point2D[];
}

/** Geometría vectorial simplificada de OpenStreetMap en metros locales para el plano vectorial limpio. */
export interface CustomMapFeature {
  id: string;
  tags: Record<string, string>;
  /** Puntos en coordenadas locales en metros `[x, y]` respecto a la esquina superior izquierda del mapa. */
  points: Point2D[];
}

/** Configuración de un emplazamiento personalizado elegido directamente sobre un mapa real. */
export interface CustomLocationConfig {
  /** Latitud WGS84 del centro de la escena. */
  lat: number;
  /** Longitud WGS84 del centro de la escena. */
  lon: number;
  /** Nombre o dirección descriptiva del emplazamiento. */
  label: string;
  /** Lado del área cuadrada operativa en metros (desde el centro hacia afuera: `±sizeMeters / 2`). */
  sizeMeters: number;
  /** Vías reales obtenidas de OpenStreetMap dentro del cuadrado operativo. */
  streets?: CustomMapStreet[];
  /** Capas vectoriales limpias (edificios, vías, parques, agua) obtenidas de OpenStreetMap. */
  features?: CustomMapFeature[];
}

/** Metadatos georreferenciados de un recinto en proyección UTM 28N (EPSG:32628) o local métrica. */
export interface MapMetadata {
  bbox: [number, number, number, number];
  widthMeters: number;
  heightMeters: number;
  source: string;
  crs: string;
  resolution: number;
  retrieved: string;
  flightDate: string;
  attribution: string;
  w?: number;
  h?: number;
  ppm?: number;
  customLocation?: CustomLocationConfig;
  features?: Array<{
    kind: string;
    name: string;
    points: Point2D[];
    osmId?: string;
  }>;
}

/** Elemento vectorial de OpenStreetMap proyectado en UTM 28N. */
export interface CartoFeature {
  id: string;
  tags: Record<string, string>;
  points: Point2D[];
}

/** Conjunto de datos cartográficos OpenStreetMap. */
export interface CartoData {
  crs: string;
  retrieved: string;
  source: string;
  attribution: string;
  features: CartoFeature[];
}

/** Configuración de sonido de un escenario. */
export interface SoundConfig {
  enabled: boolean;
  spl: number;
  reference: number;
  angle?: number;
}

/** Estructura o puesto de actividad dentro del recinto. */
export interface BoothItem {
  id: string;
  name: string;
  type: string;
  kind?: string;
  inventoryKind?: string;
  sector?: string;
  x: number;
  y: number;
  width?: number;
  depth?: number;
  area?: number;
  rotation?: number;
  facing?: number;
  time?: number;
  simultaneous?: number;
  labCapacity?: number;
  labTime?: number;
  interest?: number;
  covered?: boolean;
  local?: boolean;
  fee?: number | null;
  price?: number;
  open?: number;
  close?: number;
  locked?: boolean;
  heavyLoad?: boolean;
  phaseTags?: PhaseKey[];
  phases?: Record<string, string>;
  sound?: SoundConfig;
  coverGroup?: string;
}

/** Elemento de infraestructura (carpas, mesas picnic, baños, emergencias, logística). */
export interface InfrastructureItem {
  id: string;
  name: string;
  kind: string;
  role: string;
  inventoryKind?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  area?: number;
  rotation?: number;
  capacity?: number;
  accessibleUnits?: number;
  staff?: number;
  delay?: number;
  handling?: number;
  active?: boolean;
  reserve?: boolean;
  cost?: number;
  time?: number;
  price?: number;
  open?: number;
  close?: number;
  tableWidth?: number;
  benchWidth?: number;
  locked?: boolean;
  heavyLoad?: boolean;
  phaseTags?: PhaseKey[];
  phases?: Record<string, string>;
  coverGroup?: string;
}

/** Tipos de unidades de autoridades recomendadas para un acceso. */
export type AuthorityAccessUnit =
  | 'foot'
  | 'light_stretchers'
  | 'passenger_vehicles'
  | 'heavy_trucks';

/** Punto de acceso o salida del recinto. */
export interface EntranceItem {
  id: string;
  name: string;
  kind?: string;
  inventoryKind?: string;
  x: number;
  y: number;
  width?: number;
  depth?: number;
  area?: number;
  rotation?: number;
  role?: string;
  recommendedAuthorities?: AuthorityAccessUnit[];
  clearWidth?: number;
  gateAngle?: number;
  referenceAccess?: boolean;
  widthConfirmed?: boolean;
  description?: string;
  locked?: boolean;
  phaseTags?: PhaseKey[];
  phases?: Record<string, string>;
  /** Tipo de tránsito admitido en este punto de aparición (peatonal, vehicular o mixto). */
  spawnType?: SpawnKind;
  /** Peso o porcentaje relativo de flujo de entrada (0–100). */
  entryWeight?: number;
  /** Peso o porcentaje relativo de flujo de salida (0–100). */
  exitWeight?: number;
  /** Volumen máximo horario de tránsito en este acceso (pers/h; 0 = sin límite específico). */
  maxRatePerHour?: number;
  /** Frecuencia objetivo de aparición en segundos (opcional). */
  frequencySec?: number;
  /** Nombre de la calle o vía real sobre la que se sitúa el punto de aparición. */
  streetName?: string;
}

/** Trazo poligonal o polilínea en el plano (reservas, pasillos, vallas, mediciones, viales). */
export interface GeometryTrace {
  id?: string;
  name: string;
  points: Point2D[];
  width?: number;
  origin?: string;
  /** Origen de colocación para vallas: `'chain'` (encadenada) o `'loose'` (suelta). */
  fenceKind?: 'chain' | 'loose';
  /** Identificador compartido de cadena para vallas trazadas con la herramienta encadenada. */
  chainId?: string;
  locked?: boolean;
  phaseTags?: PhaseKey[];
}

/** Nota u observación georreferenciada del equipo sobre una celda de la cuadrícula. */
export interface AnnotationItem {
  id: string;
  x: number;
  y: number;
  text: string;
  cell: string;
  grid: number;
  locked?: boolean;
  phaseTags?: PhaseKey[];
}

/** Operación booleana secuencial de un polígono del perímetro de subsuelo. */
export type SubsoilPolygonOp = 'add' | 'subtract';

/** Tipo operativo de una jornada planificada en el calendario del evento. */
export type WorkDayKind = 'pre' | 'event' | 'post';

/** Jornada operativa con nombre, fase, fecha y horario (montaje, evento o recogida y limpieza). */
export interface WorkShiftDay {
  id: string;
  name: string;
  kind: WorkDayKind;
  date: string;
  from: string;
  to: string;
  hours: number;
}

/** Polígono con operación ordenada (`add` o `subtract`) que compone el perímetro del subsuelo. */
export interface SubsoilPolygon {
  id: string;
  op: SubsoilPolygonOp;
  points: Point2D[];
  name?: string;
  locked?: boolean;
}

/** Columna estructural del subsuelo (círculo sin rotación con radio de influencia de calor). */
export interface SubsoilColumn {
  id: string;
  name: string;
  x: number;
  y: number;
  diameter: number;
  influenceRadius: number;
  locked?: boolean;
}

/** Muro de carga del subsuelo definido por un segmento A→B con grosor y banda de influencia. */
export interface SubsoilWall {
  id: string;
  name: string;
  a: Point2D;
  b: Point2D;
  thickness: number;
  influenceDepth: number;
  locked?: boolean;
}

/**
 * Estructura única de subsuelo por recinto (aparcamiento, sótano, etc.).
 * El perímetro se representa como una lista ordenada de polígonos con operación
 * `add` o `subtract` aplicada secuencialmente; el mapa de calor estructural se
 * deriva dinámicamente de columnas y muros y no se persiste.
 */
export interface SubsoilStructure {
  polygons: SubsoilPolygon[];
  columns: SubsoilColumn[];
  walls: SubsoilWall[];
}

/** Dotación de recursos de una empresa en una fase logística. */
export interface CompanyPhaseResources {
  people: number;
  trucks: number;
  forks: number;
}

/** Empresa responsable de montaje, desmontaje o carpas. */
export interface CompanyItem {
  name: string;
  lead: string;
  scope: 'cover' | 'other' | 'all';
  pre: CompanyPhaseResources;
  post: CompanyPhaseResources;
}

/** Contacto de proveedor registrado en el proyecto. */
export interface ContactItem {
  id: string;
  name: string;
  kind: string;
  email?: string;
  phone?: string;
}

/** Recurso operativo requerido por una actividad del programa por días. */
export type ActivityNeed = 'roof' | 'stage' | 'tables' | 'power' | 'open';

/** Actividad personalizada creada por el usuario para el programa por días. */
export interface CustomActivityItem {
  id: string;
  name: string;
  category: string;
  minutes: number;
  cost: number;
  places: number;
  need: ActivityNeed;
  area: number;
}

/** Parámetros de entrada para el cálculo de demanda de servicios. */
export interface DemandInputs {
  arrivals: number;
  area: number;
  stayMinutes: number;
  foodShare: number;
  serviceHourly: number;
  utilization: number;
  seatedShare: number;
  mealMin: number;
  mealMax: number;
  tablesPerRoof: number;
  shopShare: number;
  shopMinutes: number;
  shopPlaces: number;
  toiletShare: number;
  toiletMinutes: number;
  children: number;
  older: number;
}

/** Resultado del dimensionamiento inicial de servicios por demanda. */
export interface DemandPlanResult {
  hourly: number;
  food: number;
  seats: number;
  tables: number;
  roofs: number;
  shops: number;
  toilets: number;
  occupied: number;
  modules: number;
  childSeats: number;
  olderSeats: number;
  remaining: number;
}

/** Configuración base del modelo de evento. */
export interface BaseScenarioConfig {
  site: VenueKey | string;
  hours: number;
  days: number;
  start: number;
  stay: number;
  arrivals: number;
  participation: number;
  interactions: number;
  space: number;
  circulation: number;
  queueArea: number;
  availability: number;
  exposure: number;
  weather: WeatherKind;
  rent: 'free' | 'paid';
  rate: number;
  ticket: number;
  conversion: number;
  margin: number;
  staff: number;
  logistics: number;
  organizerFixed: number;
  organizerHourly: number;
  funding: number;
  support: number;
  overrides: {
    area: string | number;
    excluded: string | number;
    limit: string | number;
    counts: string;
    weatherLoss: string | number;
    operation: string | number;
  };
  booths: BoothItem[];
}

/** Escena completa de un recinto dentro del proyecto. */
export interface Scene {
  version: number;
  title: string;
  site: VenueKey | string;
  preset?: string;
  presetRevision?: number;
  experienceRevision?: number;
  eventDate?: string;
  startDate?: string;
  endDate?: string;
  endTime?: string;
  eventDays?: number;
  cleanDay?: number;
  inspiration?: string;
  designNotes?: string[];
  eventGoals?: string[];
  smartGoal?: {
    specific: string;
    metric: string;
    target: string;
    feasible: string;
    relevant: string;
    deadline: string;
  };
  citizenWishes?: string;
  stockIntroShown?: boolean;
  base: BaseScenarioConfig;
  boundary: Point2D[];
  passages: GeometryTrace[];
  reserves: GeometryTrace[];
  fences: GeometryTrace[];
  flows?: GeometryTrace[];
  corridors?: GeometryTrace[];
  roadPlans: GeometryTrace[];
  measurements: GeometryTrace[];
  annotations: AnnotationItem[];
  infrastructure: InfrastructureItem[];
  entrances: EntranceItem[];
  subsoil?: SubsoilStructure;
  pendingStock?: Array<BoothItem | InfrastructureItem | EntranceItem>;
  companies?: CompanyItem[];
  contacts?: ContactItem[];
  demandInputs?: DemandInputs;
  mix: Record<string, number>;
  maxWait: number;
  diameter: number;
  seed: number;
  offerMix: boolean;
  collisionTolerance?: number;
  variety?: number;
  mealMin?: number;
  mealMax?: number;
  seatWaitMin?: number;
  dryStaff?: number;
  drySeconds?: number;
  parkMin?: number;
  truckBatch?: number;
  bagLitres?: number;
  wasteLitres?: number;
  teamSize?: number;
  rate?: number;
  burden?: number;
  hoursLimit?: number;
  setupMin?: number;
  strikeMin?: number;
  cleanMin?: number;
  estimateSource?: string;
  horizontalRain?: boolean;
  trained?: boolean;
  countStaff?: number;
  privateStaff?: number;
  fireSuccess?: number;
  autoIncidents?: boolean;
  incidentEvery?: number;
  fireFootAccess?: boolean;
  fireBurnSeconds?: number;
  fireSpreadSeconds?: number;
  fireSpreadGap?: number;
  localExtinguishSeconds?: number;
  reinforcementDelay?: number;
  incidentRadius?: number;
  curiosityShare?: number;
  sensoryShare?: number;
  mildAlcoholShare?: number;
  /** Fracción de asistentes ("rebeldes") que intentan saltar vallas (0–1; por defecto 0.01 = 1 %). */
  rebelShare?: number;
  policeMode?: string;
  responseMode?: string;
  responseExampleNote?: string;
  exampleRecommendation?: string;
  collaboratorNotes?: string[];
  riskInputs?: {
    medicalRate?: number | null;
    source?: string;
    autoRate?: number;
    maxWaitSeconds?: number;
  };
  safetyReview?: unknown;
  safetyHistory?: Array<{
    at: string;
    time: number;
    issues: Array<{id: string; level: string; title: string; action: string}>;
    status: string;
  }>;
  safetyLock?: {
    fingerprint: string;
    at: string;
  };
  reviewMemory?: Record<
    string,
    {
      key: string;
      type: string;
      target: string | null;
      description: string;
      count: number;
      observedRuns: number;
      status: string;
      lastDeferred?: string;
      firstDeferred?: string;
      lastObservedRun?: string;
    }
  >;
  lastSessionReview?: Record<string, unknown>;
  activityPrices?: Record<string, number>;
  /** Actividades personalizadas creadas por el usuario para el programa por días. */
  customActivities?: CustomActivityItem[];
  /** Asociación explícita entre ID de actividad y ID de contacto guardado (`activityId -> contactId`). */
  activityContacts?: Record<string, string>;
  /** Tipos de actividad personalizados añadidos por el usuario en Contactos. */
  contactKinds?: string[];
  programmeOptions?: {
    budget?: number;
    reserve?: number;
    sessions?: number;
    start?: number;
    finish?: number;
    area?: number;
    selected?: string[];
  };
  programme?: Record<string, unknown>;
  directorLog?: Array<{time: number; text: string}>;
  progressByPhase?: Partial<Record<PhaseKey, string[]>>;
  shiftDays?: Partial<Record<PhaseKey, number>>;
  workDays?: WorkShiftDay[];
  learning?: Array<{kind: string; gain: number}>;
  lastAudit?: Record<string, unknown>;
  serviceRoute?: GeometryTrace;
  vehicleRoute?: GeometryTrace;
  vehicleReference?: {length: number; width: number; note: string};
  emergency?: {
    random: boolean;
    rate: number;
    sirens: boolean;
    vehicleSpeed: number;
  };
  meta?: {
    version: number;
    grid: number;
    coordinateSystem: string;
  };
}

/** Estructura raíz del archivo de proyecto Ojo de Buey. */
export interface ProjectFile {
  version: number;
  format: 'ojo-de-buey';
  active: VenueKey;
  maps: Record<VenueKey, MapMetadata>;
  scenes: Record<VenueKey, Scene>;
}

/** Identificadores de las paletas de color predefinidas de la interfaz. */
export type PaletteId =
  | 'oxeye'
  | 'atlas'
  | 'noctis'
  | 'territorio'
  | 'vector'
  | 'bendy';

/** Preferencias de usuario persistidas localmente. */
export interface UserPreferences {
  speed?: number;
  reduceMotion?: boolean;
  help?: boolean;
  palette?: PaletteId;
}

/* -------------------------------------------------------------------------- */
/* Alias y tipos extendidos para compatibilidad con motores y componentes UI  */
/* -------------------------------------------------------------------------- */

export type ActivePanel = WorkspacePanel;
export type PhaseFilter = PhaseViewKey;
export type BaseLayerMode = BaseMapMode;
export type LensMode = 'people' | 'trails' | 'stalls';

export type Point = Point2D;
export type VenueMap = MapMetadata;
export type Booth = BoothItem;
export type Infrastructure = InfrastructureItem;
export type Entrance = EntranceItem;
export type Annotation = AnnotationItem;
export type PolygonElement = GeometryTrace;
export type CompanyResource = CompanyItem;
export type ContactEntry = ContactItem;
export type DemandPlanOutput = DemandPlanResult;
export type EventBaseConfig = BaseScenarioConfig;

export type BoothType =
  | 'commerce'
  | 'food'
  | 'stage'
  | 'rest'
  | 'workshop'
  | 'toilet'
  | 'cover'
  | 'emergency'
  | 'logistics';

export type CrowdProfileKey =
  | 'buyer'
  | 'foodie'
  | 'culture'
  | 'music'
  | 'walker';

/** Especificación de pieza del catálogo de diseño e inventario. */
export interface CatalogItemSpec {
  name: string;
  type?: string;
  role?: string;
  w: number;
  h: number;
  color: string;
  heavyLoad?: boolean;
}

/** Resultado de planificación de un turno logístico (pre/post). */
export interface ShiftPlanResult {
  phase: PhaseKey | string;
  total: number;
  limit: number;
  required: number;
  installed: Array<{
    o: {id?: string; [key: string]: any};
    at: number;
    [key: string]: any;
  }>;
  alerts: string[];
  [key: string]: any;
}

/** Cuadrícula de navegación peatonal del recinto. */
export interface NavigationGrid {
  w: number;
  h: number;
  cell: number;
  free: Uint8Array;
  count: number;
  area: number;
  index: (x: number, y: number) => number;
  point: (k: number) => Point2D;
  neighbors: (k: number) => number[];
  nearest: (x: number, y: number, max?: number) => number;
  [key: string]: any;
}

/** Área cubierta o refugio climático en la simulación. */
export interface ShelterArea {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  capacity?: number;
  [key: string]: any;
}

/** Estación operativa de la simulación (puesto, aseo, mesa, acceso). */
export interface SimStation {
  id?: string;
  name?: string;
  type?: BoothType | string;
  x?: number;
  y?: number;
  width?: number;
  depth?: number;
  capacity: number;
  queue: any[];
  [key: string]: any;
}

/** Agente peatonal simulado. */
export interface Agent {
  id: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  profile: CrowdProfileKey;
  persona?: any;
  born?: number;
  state?: string;
  [key: string]: any;
}

/** Punto de dolor o queja agregada. */
export interface PainPoint {
  id?: string;
  type: string;
  point: Point2D;
  place?: string;
  location?: string;
  title?: string;
  solution?: string;
  reason?: string;
  impact?: number;
  effort?: number;
  first?: number;
  [key: string]: any;
}

/** Muestra temporal del historial de simulación. */
export interface SimHistoryPoint {
  time: number;
  present?: number;
  active?: number;
  arrivals?: number;
  served?: number;
  abandoned: number;
  [key: string]: any;
}

/** Estadísticas agregadas de la simulación. */
export interface SimStats {
  arrivals: number;
  active?: number;
  served: number;
  abandoned: number;
  standing?: number;
  [key: string]: any;
}

/** Métrica por zona del recinto. */
export interface ZoneMetric {
  id: number | string;
  name: string;
  density?: number;
  present?: number;
  waiting?: number;
  area?: number;
  capacity?: number;
  load?: number;
  [key: string]: any;
}

/** Instantánea de estado de la simulación para renderizado en el visor. */
export interface SimSnapshot {
  time: number;
  present?: number;
  waiting?: number;
  load?: number;
  capacity?: number;
  zones?: ZoneMetric[];
  agents?: Agent[];
  stations?: SimStation[];
  stats?: SimStats;
  [key: string]: any;
}

/** Perfil de vehículo o equipo de respuesta a emergencias. */
export interface ResponseProfile {
  name: string;
  width: number;
  length: number;
  speed: number;
  staff: number;
}

/** Pose (posición y orientación) de un vehículo de emergencia. */
export interface VehiclePose {
  x: number;
  y: number;
  angle: number;
  [key: string]: any;
}

/** Incidencia de emergencia inyectada o detectada en simulación. */
export interface EmergencyIncident {
  id: number | string;
  type: 'fall' | 'cut' | 'fire' | 'conflict' | string;
  name?: string;
  service?: 'medical' | 'fire' | 'security' | string;
  x?: number;
  y?: number;
  time?: number;
  point?: Point2D;
  created?: number;
  status: string;
  [key: string]: any;
}

/** Episodio de experiencia de un visitante simulado. */
export interface ExperienceEpisode {
  id: string;
  visitId: string;
  type: string;
  detail: string;
  point: Point2D;
  first: number;
  closeReason?: string;
  [key: string]: any;
}

/** Configuración de ejecución del laboratorio de alternativas en lote. */
export interface BatchSettings {
  alternatives?: number;
  arrivals?: number[];
  weathers?: WeatherKind[];
  count?: number;
  minutes?: number;
  rain?: boolean;
  space?: number;
  weights: Record<string, number>;
  [key: string]: any;
}

/** Fila de resultado evaluado para una alternativa en el laboratorio. */
export interface BatchEvaluationRow {
  id: number;
  name: string;
  score: number;
  averages: Record<string, number>;
  runs: Array<{
    weather: WeatherKind | string;
    arrivals: number;
    abandoned: number;
    standing: number;
    completed: number;
    missing: number;
    scores: Record<string, number>;
    complaints: number;
    [key: string]: any;
  }>;
  scene: Scene;
  preview: Array<{x: number; y: number}>;
}
