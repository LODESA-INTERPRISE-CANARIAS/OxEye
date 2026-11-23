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

/** Clasificación operativa detallada de un acceso del recinto. */
export type AccessCategory =
  | 'emergency_vehicle'
  | 'pedestrian_only'
  | 'mixed'
  | 'conditional'
  | 'physically_blocked';

/** Estado operativo de un acceso condicionado (vallas móviles, bolardos o puertas retirables). */
export type ConditionalAccessState = 'closed' | 'open_on_demand' | 'open';

/** Modo operativo de un vehículo de emergencias. */
export type EmergencyOperationalMode =
  | 'reserve'
  | 'exterior_patrol'
  | 'fixed_service';

/** Estado de ciclo de vida de un vehículo de emergencias. */
export type EmergencyVehicleStatus =
  | 'parked'
  | 'patrolling'
  | 'dispatched'
  | 'en_route'
  | 'intervening'
  | 'returning';

/** Estado de la tripulación embarcada / desplegada a pie. */
export type EmergencyCrewStatus =
  | 'embarked'
  | 'deploying'
  | 'intervening'
  | 'returning';

/** Estado físico de una camilla sanitaria. */
export type StretcherState = 'folded' | 'deployed';

/** Propiedades configurables del equipamiento camilla (`stretcher`). */
export interface StretcherConfig {
  /** Longitud física de la camilla desplegada en metros (por defecto 2,00 m). */
  length: number;
  /** Anchura física de la camilla desplegada en metros (por defecto 0,65 m). */
  width: number;
  /** Espacio adicional de manipulación longitudinal para los operarios (m). */
  handlingMarginLength: number;
  /** Espacio adicional de manipulación lateral en giros y pasillos (m). */
  handlingMarginWidth: number;
  /** Número de operarios sanitarios necesarios para portar la camilla (por defecto 2). */
  requiredOperators: number;
  /** Estado operativo inicial o actual (`folded` plegada / `deployed` desplegada). */
  state: StretcherState;
  /** Indica si permite transporte de paciente. */
  canTransportPatient: boolean;
  /** Velocidad de desplazamiento sin paciente (m/s). */
  speedEmpty: number;
  /** Velocidad de desplazamiento transportando paciente (m/s). */
  speedLoaded: number;
}

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
  hasGas?: boolean;
  noGas?: boolean;
  combustible?: boolean;
  material?: string;
  /** Si es `true`, es un elemento permanente del emplazamiento (no se monta ni se desmonta). */
  permanent?: boolean;
  /** Tiempo estimado de montaje en minutos (opcional; si se omite usa el valor por defecto del tipo). */
  assemblyMinutes?: number;
  heavyLoad?: boolean;
  /** Masa propia del elemento en kg (opcional). */
  massKg?: number;
  /** Superficie de apoyo sobre el suelo en m² (opcional; por defecto width × depth). */
  supportAreaM2?: number;
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
  hasGas?: boolean;
  noGas?: boolean;
  combustible?: boolean;
  material?: string;
  /** Si es `true`, es un elemento permanente del emplazamiento (no se monta ni se desmonta). */
  permanent?: boolean;
  /** Tiempo estimado de montaje en minutos (opcional; si se omite usa el valor por defecto del tipo). */
  assemblyMinutes?: number;
  heavyLoad?: boolean;
  /** Masa propia del elemento en kg (opcional). */
  massKg?: number;
  /** Superficie de apoyo sobre el suelo en m² (opcional; por defecto width × depth). */
  supportAreaM2?: number;
  /** Peso propio de la carpa en kg (mantenido separado de sus lastres y de la carga al suelo). */
  tentMassKg?: number;
  /** Longitud de tramo (m) según ficha del fabricante para calcular la dotación de lastres de una carpa. */
  ballastSpanMeters?: number;
  /** Número de lastres necesarios por cada tramo de `ballastSpanMeters` m. */
  ballastsPerSpan?: number;
  /** Masa mínima requerida por lastre (kg) según ficha técnica del fabricante (opcional). */
  ballastRequiredMassKg?: number;
  /** ID de la carpa a la que se vincula explícitamente un lastre (opcional). */
  attachedCoverId?: string;
  /** Radio de actuación o vigilancia en metros para personal de asistencia y policía. */
  patrolRadius?: number;
  /** Si es `true` (o `patrolMode === 'fixed'`), la unidad policial mantiene posición fija vigilando su zona en vez de patrullar todo el recinto. */
  fixedPost?: boolean;
  /** Modo de vigilancia policial a pie: `'patrol'` (patrulla itinerante) o `'fixed'` (posición fija / vigilancia de zona). */
  patrolMode?: 'patrol' | 'fixed';
  /** Modo operativo de vehículos de emergencia: reserva/refuerzo (predeterminado), patrulla exterior o servicio fijo. */
  operationalMode?: EmergencyOperationalMode;
  /** Identificador de la base o estacionamiento asignado (ID de `EntranceItem` o vacío para usar su posición en el plano). */
  homeBaseId?: string;
  /** Si es `true` (por defecto), la unidad responde a solicitudes automáticas de refuerzo (independiente del modo de patrullaje). */
  availableForReinforcement?: boolean;
  /** Capacidad de operarios embarcados en el vehículo (p. ej. 2 en coche policial, hasta 8 en furgón policial). */
  crewCapacity?: number;
  /** Identificador de ruta de patrullaje exterior (`roadPlans` / `flows`) cuando `operationalMode === 'exterior_patrol'`. */
  patrolRouteId?: string;
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
  /** Clasificación operativa explícita del acceso (emergencias, peatonal, mixto, condicionado o bloqueado). */
  accessCategory?: AccessCategory;
  /** Estado actual si el acceso es condicionado (`closed`, `open_on_demand` o `open`). */
  conditionalState?: ConditionalAccessState;
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
  /** Si es `true`, representa una base/aparcamiento vehicular exterior conectado a la red viaria. */
  externalBase?: boolean;
  /** Categoría de vehículos que genera este spawn o base exterior. */
  vehicleCategory?: 'all' | 'ordinary' | 'logistics' | 'emergency';
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
  /** Si es `true` en una zona libre (`origin === 'interest-zone'`), atrae público como área de interés. */
  interestZone?: boolean;
  /** Si es `true` en una ruta (`flows` o `roadPlans`), suaviza los giros con una curva Bézier ligera. */
  curved?: boolean;
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

/** Perfil horario de curva de afluencia del evento. */
export type AttendanceCurveProfile =
  | 'morning'
  | 'afternoon'
  | 'night'
  | 'full_day'
  | 'family'
  | 'trade_fair'
  | 'festival'
  | 'street_market'
  | 'custom';

/** Configuración de afluencia dinámica centrada en asistentes únicos y curva horaria. */
export interface AttendanceConfig {
  /** ¿Cuántas personas distintas esperas recibir durante el evento? */
  uniqueAttendees: number;
  /** Perfil de curva horaria seleccionado o personalizado. */
  curveProfile: AttendanceCurveProfile;
  /** Pesos personalizados por hora (longitud = base.hours), modificables gráficamente. */
  customWeights?: number[];
  /** Ocupación simultánea máxima estimada (referencia/tope). */
  maxSimultaneousTarget?: number;
  /** Capacidad autorizada del recinto (si se conoce). */
  authorizedCapacity?: number;
  /** Fracción de visitantes que salen y vuelven a entrar más tarde (0–0.5). */
  reentryShare?: number;
  /** Fracción de transeúntes previos que descubren el evento y deciden entrar (0–1). */
  spontaneousDiscoveryShare?: number;
  /** Público y personal ya presente antes de la apertura oficial. */
  preOpeningAmbient?: {
    passersby: number;
    waitingEarly: number;
    workers: number;
    earlyGroups: number;
  };
}

/** Modo de intervención del personal ante congestiones. */
export type CongestionInterventionMode =
  | 'none'
  | 'major_only'
  | 'all_compatible';

/** Umbrales calibrables para detección y clasificación objetiva de aglomeraciones. */
export interface CongestionThresholds {
  densityWarn: number;
  densityCritical: number;
  minSpeedMs: number;
  minDurationSec: number;
  minPeople: number;
}

/** Configuración de comportamiento humano, consultas, falsas alarmas y escalabilidad. */
export interface CrowdBehaviorConfig {
  interventionMode: CongestionInterventionMode;
  thresholds?: Partial<CongestionThresholds>;
  maxRenderedAgents?: number;
  enableEverydayInteractions?: boolean;
  enableFalseAlarms?: boolean;
  enableSocialGroups?: boolean;
}

/** Necesidades fisiológicas y de confort dinámicas de un agente. */
export interface HumanNeedsState {
  hunger: number;
  thirst: number;
  fatigue: number;
  toiletNeed: number;
  shadeNeed: number;
  shelterNeed: number;
  quietPreference: number;
  accessibilityNeed: number;
}

/** Personalidad funcional extendida del visitante sintético. */
export interface AgentPersonality {
  patience: number;
  impulsivity: number;
  curiosity: number;
  planning: number;
  spontaneity: number;
  commercialInterest: number;
  gastronomicInterest: number;
  quietPreference: number;
  priceSensitivity: number;
  waitTolerance: number;
  familiarity: number;
  activityKnowledge: number;
  congestionReaction: 'avoid' | 'tolerate' | 'wait';
}

export type VisitorRoutineKind =
  | 'post_work'
  | 'morning_family'
  | 'quick_market'
  | 'concert_evening'
  | 'split_reentry'
  | 'spontaneous_passerby'
  | 'full_day_explorer';

export interface VisitorRoutine {
  kind: VisitorRoutineKind;
  arrivalTimeSec: number;
  plannedDepartureSec: number;
  canReenter: boolean;
  reentered?: boolean;
  returnAfterSec?: number;
}

export type SocialGroupKind =
  | 'family'
  | 'couple'
  | 'friends'
  | 'tour_group'
  | 'workshop_peers'
  | 'solo';

export type CongestionClassification =
  | 'spectators'
  | 'organized_queue'
  | 'pedestrian_congestion'
  | 'corridor_block'
  | 'persistent_accumulation'
  | 'potentially_dangerous';

export type GuidanceResponseKind =
  | 'accept'
  | 'hesitate'
  | 'reject'
  | 'follow_group'
  | 'request_support';

export interface CongestionZoneEvent {
  id: string;
  cell: number;
  point: Point2D;
  classification: CongestionClassification;
  status: 'active' | 'mitigating' | 'resolved';
  startedAt: number;
  lastSeenAt: number;
  durationSec: number;
  peopleCount: number;
  densityPerM2: number;
  avgSpeedMs: number;
  stoppedCount: number;
  usefulWidthM: number;
  opposingFlows: boolean;
  possibleCause: string;
  nearStage: boolean;
  isQueue: boolean;
  assignedStewardId?: string;
  assignedStewardName?: string;
  alternativeRoutesCount: number;
  recommendedTargetPoint?: Point2D;
  recommendedTargetLabel?: string;
  guidedCount: number;
  acceptedCount: number;
  hesitatedCount: number;
  rejectedCount: number;
  followGroupCount: number;
  supportRequestCount: number;
  sideEffectLoadDelta?: number;
  sideEffectNote?: string;
}

export interface EverydayInteractionRecord {
  id: string;
  kind: string;
  label: string;
  agentId: number;
  stewardId?: string;
  stewardName?: string;
  startedAt: number;
  completedAt?: number;
  durationSec: number;
  resolved: boolean;
  resourceFound: boolean;
  outcomeText: string;
  point: Point2D;
}

export type FalseAlarmKind =
  | 'vapor_smoke'
  | 'setup_noise'
  | 'resolved_dispute'
  | 'oriented_person'
  | 'forgotten_bag';

export interface FalseAlarmRecord {
  id: string;
  kind: FalseAlarmKind;
  label: string;
  status: 'reported' | 'verifying' | 'confirmed_false_alarm' | 'escalated_real';
  reportedAt: number;
  verifyingAt?: number;
  resolvedAt?: number;
  verificationSeconds?: number;
  stewardId?: string;
  stewardName?: string;
  resourcesUsed: string[];
  outcome: string;
  waitingImpactCount: number;
  point: Point2D;
}

/** Origen o procedencia de los parámetros de demanda de un proyecto. */
export type DemandSourceKind =
  | 'manual'
  | 'curve_preset'
  | 'smart_suggestion'
  | 'programme_suggestion'
  | 'legacy_hourly_migration';

/** Distribución de permanencia utilizada para derivar salidas y ocupación simultánea. */
export interface DwellTimeDistribution {
  meanMinutes: number;
  spreadRatio: number;
  shortShare?: number;
  longShare?: number;
}

/** Fuente única canónica de planificación de demanda, afluencia horaria y servicios. */
export interface EventDemandConfig {
  date: string;
  startHour: number;
  hours: number;
  uniqueAttendees: number;
  curveProfile: AttendanceCurveProfile;
  hourlyArrivals: number[];
  dwellTimeMinutes: number;
  dwellDistribution: DwellTimeDistribution;
  desiredMaxOccupancy: number | null;
  authorizedCapacity: number | null;
  operationalAreaM2: number | null;
  reentryRate: number;
  provenance: DemandSourceKind;
  legacyHourlyRate?: number;
  serviceParams: {
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
  };
  updatedAt: string;
  revision: number;
}

/** Instantánea guardada de una variante de demanda para comparación sin perder el escenario actual. */
export interface DemandVariantSnapshot {
  id: string;
  name: string;
  createdAt: string;
  demandConfig: EventDemandConfig;
}

/** Parámetros de entrada para el cálculo de demanda de servicios. */
export interface DemandInputs {
  arrivals: number;
  uniqueAttendees?: number;
  curveProfile?: AttendanceCurveProfile;
  hours?: number;
  maxSimultaneousTarget?: number;
  authorizedCapacity?: number;
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

/** Grupo jerárquico de elementos del plano (p. ej. lastres agrupados entre sí y luego con una carpa). */
export interface ElementGroup {
  id: string;
  name?: string;
  /** IDs de hijos directos (elementos del plano o subgrupos). */
  memberIds: string[];
  /** ID del grupo padre si este grupo está anidado dentro de otro. */
  parentGroupId?: string;
}

/** Condiciones editables de tiempos de respuesta externa (referencia Tenerife). */
export interface ResponseConditions {
  /** Tiempo base de detección del riesgo y aviso al 1-1-2 / sala (segundos). */
  detectionSec: number;
  /** Desplazamiento externo Bomberos de Tenerife desde Parque La Laguna/SC (segundos). */
  fireExternalSec: number;
  /** Desplazamiento externo Policía Local / Nacional desde comisaría (segundos). */
  policeExternalSec: number;
  /** Desplazamiento externo SUC / Ambulancia 1-1-2 Canarias (segundos). */
  medicalExternalSec: number;
}

/** Escena completa de un recinto dentro del proyecto. */
export interface Scene {
  version: number;
  title: string;
  site: VenueKey | string;
  preset?: string;
  presetRevision?: number;
  experienceRevision?: number;
  responseConditions?: ResponseConditions;
  eventDate?: string;
  startDate?: string;
  endDate?: string;
  endTime?: string;
  eventDays?: number;
  cleanDay?: number;
  inspiration?: string;
  designNotes?: string[];
  eventGoals?: string[];
  objectives?: ProjectObjectives;
  simulationHistory?: SimulationHistoryEntry[];
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
  /** Grupos jerárquicos de elementos (Ctrl+G / Mayús+G). */
  groups?: ElementGroup[];
  subsoil?: SubsoilStructure;
  pendingStock?: Array<BoothItem | InfrastructureItem | EntranceItem>;
  companies?: CompanyItem[];
  contacts?: ContactItem[];
  demandInputs?: DemandInputs;
  mix: Record<string, number>;
  maxWait: number;
  diameter: number;
  seed: number;
  /** Modo de semilla preferido al simular ('random' genera una nueva en cada ensayo; 'fixed' reproduce `seed`). */
  seedMode?: 'random' | 'fixed';
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
  /** Modo de generación de incidencias: automático, manual o mixto (ambos a la vez). */
  incidentMode?: IncidentGenerationMode;
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
  /** Configuración editable de la camilla sanitaria (`stretcher`). */
  stretcher?: Partial<StretcherConfig>;
  /** Fuente única canónica de configuración de demanda, afluencia y capacidad de servicios. */
  demandConfig?: EventDemandConfig;
  /** Variantes guardadas de escenarios de demanda para comparación. */
  demandVariants?: DemandVariantSnapshot[];
  /** Modelo de afluencia dinámica centrado en asistentes únicos y curva horaria. */
  attendance?: AttendanceConfig;
  /** Configuración de comportamiento humano, congestiones, consultas y falsas alarmas. */
  crowdBehavior?: CrowdBehaviorConfig;
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
  /** Máscara de celdas transitables para servicios de emergencia y personal autorizado (incluye subperímetros restringidos a civiles). */
  staffFree?: Uint8Array;
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
  populationRole?: 'public' | 'passerby' | 'early_waiter' | 'worker' | 'early_group';
  uniqueVisitorId?: string;
  isReentry?: boolean;
  routine?: VisitorRoutine;
  humanNeeds?: HumanNeedsState;
  personality?: AgentPersonality;
  groupId?: string;
  groupRole?: 'leader' | 'member';
  knownStationIds?: string[];
  lastSpeedMs?: number;
  guidanceCooldownUntil?: number;
  destinationChanges?: number;
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

/** Categoría normalizada de incidencia para notificaciones, mapa e informes. */
export type IncidentAlertCategory =
  | 'fire'
  | 'medical'
  | 'accessibility'
  | 'violet_point'
  | 'security'
  | 'logistics'
  | 'congestion'
  | 'information';

/** Gravedad independiente de la categoría de incidencia. */
export type IncidentSeverityLevel =
  | 'informativa'
  | 'leve'
  | 'moderada'
  | 'grave'
  | 'critica';

/** Modo de generación de incidencias durante la simulación. */
export type IncidentGenerationMode = 'auto' | 'manual' | 'mixed';

/** Origen de creación de una incidencia individual (sin contaminar tasas espontáneas). */
export type IncidentOriginMode = 'auto' | 'manual' | 'spread';

/** Ciclo de vida detallado de cada foco de incendio y recuperación del entorno. */
export type FireLifecycleStage =
  | 'conato'
  | 'desarrollado'
  | 'exposicion'
  | 'propagacion'
  | 'controlado'
  | 'extinguido'
  | 'hot_zone'
  | 'approaching'
  | 'installing'
  | 'fenced'
  | 'cleanup'
  | 'inspection'
  | 'reopened';

/** Modo de disparo para incidencias provocadas o programadas en ensayo. */
export type ScheduledIncidentTrigger =
  | 'immediate'
  | 'at_time'
  | 'after_delay'
  | 'condition';

/** Condición operativa para disparar una incidencia programada. */
export type ScheduledIncidentCondition =
  | 'crowd_threshold'
  | 'active_fire'
  | 'after_incident';

/** Incidencia contextual programada durante la simulación. */
export interface ScheduledIncident {
  id: string;
  targetId: string;
  targetName: string;
  templateId: string;
  incidentType: string;
  label: string;
  severity: IncidentSeverityLevel;
  trigger: ScheduledIncidentTrigger;
  triggerAtSec?: number;
  delaySec?: number;
  scheduledAtSec?: number;
  condition?: ScheduledIncidentCondition;
  conditionValue?: number;
  conditionIncidentId?: string | number;
  executed?: boolean;
  executedAt?: number;
  spawnedIncidentId?: string | number;
  sensitive?: boolean;
  customParams?: {
    hasGas?: boolean;
    fireGrowthRate?: number;
  };
}

/** Evento cronológico registrado en la evolución de una incidencia. */
export interface IncidentTimelineEvent {
  id: string;
  time: number;
  relTime: number;
  kind:
    | 'origin'
    | 'detection'
    | 'assignment'
    | 'dispatch'
    | 'arrival'
    | 'intervention'
    | 'transfer'
    | 'spread'
    | 'reinforcement'
    | 'limitation'
    | 'threat'
    | 'extinguished'
    | 'hot_zone'
    | 'cordon_approach'
    | 'cordon_install'
    | 'cordon_fenced'
    | 'cleanup'
    | 'inspection'
    | 'reopened'
    | 'waiting'
    | 'blocked'
    | 'severity_change'
    | 'consequence'
    | 'resolution';
  label: string;
  detail: string;
  status: string;
  severity?: IncidentSeverityLevel;
  resourceId?: string;
  resourceName?: string;
  point?: Point2D;
  distanceMeters?: number;
  calibrated?: 'simulated' | 'exploratory_estimate';
}

/** Incidencia de emergencia inyectada o detectada en simulación. */
export interface EmergencyIncident {
  id: number | string;
  /** Código único categorizado, p. ej. `SAN-014`, `ACC-008`, `VIO-003`, `FUE-002`. */
  code?: string;
  /** Categoría visual y operativa de la incidencia. */
  category?: IncidentAlertCategory;
  /** Nivel de gravedad independiente del color de categoría. */
  severity?: IncidentSeverityLevel | string;
  /** Indica si requiere tratamiento reservado (p. ej. Punto Violeta). */
  sensitive?: boolean;
  /** Origen (`auto`, `manual`, `spread`) para separar ensayo manual de estadística espontánea. */
  originMode?: IncidentOriginMode;
  /** ID del foco padre si esta incidencia surgió por propagación. */
  parentIncidentId?: number | string;
  /** Código legible del foco padre (p. ej. `FUE-001`). */
  parentCode?: string;
  /** Trazabilidad causal explícita (p. ej. `FUE-001 → SPREAD → FUE-002`). */
  spreadCause?: string;
  /** ID del elemento del plano sobre el que se provocó o inició la incidencia. */
  targetObjectId?: string;
  /** Nombre legible del elemento origen. */
  targetObjectName?: string;
  /** ID de plantilla contextual utilizada cuando proviene del menú contextual. */
  contextualTemplateId?: string;
  /** Etapa actual del foco de incendio / recuperación independiente. */
  fireStage?: FireLifecycleStage;
  /** Limitación explícita de recursos si no hay camiones/dotación adicional disponible. */
  resourceLimitation?: string;
  /** Unidad desde la que se redistribuyó tripulación en refuerzo parcial. */
  redistributedFromUnitId?: string;
  /** Indica si el elemento afectado dispone de instalación compatible con gas. */
  hasGasInstallation?: boolean;
  type: 'fall' | 'cut' | 'fire' | 'conflict' | string;
  name?: string;
  service?: 'medical' | 'fire' | 'security' | 'accessibility' | 'violet_point' | string;
  x?: number;
  y?: number;
  time?: number;
  point?: Point2D;
  created?: number;
  reportedAt?: number;
  assigned?: number;
  arrived?: number;
  closed?: number;
  status: string;
  /** Historial estructurado de hitos y cambios de estado. */
  timeline?: IncidentTimelineEvent[];
  /** Indica si existe registro del instante previo a la detección. */
  hasPreDetectionData?: boolean;
  /** IDs de incidencias activas simultáneamente durante el ciclo de vida. */
  simultaneousIds?: Array<number | string>;
  /** Obstáculos o desvíos encontrados durante la respuesta. */
  obstaclesEncountered?: string[];
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

/** Categorías del catálogo extensible de objetivos SMART. */
export type ObjectiveCategoryKey =
  | 'families'
  | 'local_commerce'
  | 'gastronomy'
  | 'culture'
  | 'music'
  | 'accessibility'
  | 'safety'
  | 'logistics'
  | 'economy'
  | 'sustainability';

/** Nivel de prioridad del objetivo para el organizador. */
export type ObjectivePriority = 'essential' | 'important' | 'desirable';

/** Dirección de mejora de los indicadores de un objetivo. */
export type ObjectiveDirection = 'increase' | 'decrease' | 'maintain';

/** Ejes clásicos de 6 vértices de «Carácter del evento». */
export type EventAxisKey =
  | 'family'
  | 'local'
  | 'food'
  | 'culture'
  | 'music'
  | 'comfort';

/** Opción contextual desplegada al activar una tarjeta de objetivo. */
export interface ObjectiveContextOption {
  key: string;
  label: string;
}

/** Definición en catálogo de un objetivo SMART calculable. */
export interface ObjectiveCatalogItem {
  id: string;
  category: ObjectiveCategoryKey;
  subcategory: string;
  label: string;
  shortDesc: string;
  desiredOutcome: string;
  indicators: string[];
  unit: string;
  direction: ObjectiveDirection;
  defaultTarget?: number;
  targetLabel?: string;
  contextOptions?: ObjectiveContextOption[];
  relatedResources: string[];
  relatedActivityCategories: string[];
  feasibilityConditions: string[];
  calibrationStatus: 'exploratory' | 'calibrated';
  axisWeights: Partial<Record<EventAxisKey, number>>;
  evalWeights: Partial<
    Record<'comfort' | 'queues' | 'emergency' | 'experience' | 'cost' | 'logistics', number>
  >;
}

/** Objetivo SMART concreto seleccionado por el organizador. */
export interface SelectedObjective {
  id: string;
  priority: ObjectivePriority;
  /** Peso explícito de 0 a 5 en modo avanzado (opcional; si se omite se deriva de `priority`). */
  weight?: number;
  /** Meta cuantitativa opcional (p. ej. 10 minutos de espera media). */
  targetValue?: number;
  /** Sub-opciones contextuales activadas (p. ej. `['gastronomy', 'toilets']`). */
  contexts?: string[];
  /** Horizonte temporal (p. ej. `'Jornada completa'` o `'Horas punta'`). */
  horizon?: string;
}

/** Compromiso o conflicto entre objetivos seleccionados simultáneamente. */
export interface ObjectiveTradeoff {
  id: string;
  title: string;
  description: string;
  objectiveIds: string[];
}

/** Hipótesis de demanda y comportamiento de agentes vinculadas a los objetivos. */
export interface BehaviorHypotheses {
  /** Origen declarativo para trazabilidad (`'suggested_from_objectives' | 'user_confirmed' | 'legacy_default'`). */
  origin: 'suggested_from_objectives' | 'user_confirmed' | 'legacy_default';
  /** Solo si es `true` altera la mezcla y destinos de los agentes en simulación. */
  confirmed: boolean;
  /** Mezcla orientativa de arquetipos (`buyer`, `foodie`, `culture`, `music`, `walker`). */
  mix: Record<CrowdProfileKey, number>;
  /** Multiplicadores por tipo de destino/actividad (`commerce`, `food`, `workshop`, `stage`, `rest`). */
  destinationBoosts: Record<'commerce' | 'food' | 'workshop' | 'stage' | 'rest', number>;
  /** Factor multiplicador sobre estancia media (`stayMinutes`). */
  stayMultiplier: number;
  /** Factor sobre tolerancia/paciencia en colas. */
  queueToleranceMultiplier: number;
  /** Bonificación de preferencia por refugio/sombra/descanso. */
  shelterNeedBonus: number;
  /** Nota de calibración y trazabilidad para el usuario. */
  rationale: string[];
}

/** Perfil operativo calculado a partir de los objetivos SMART. */
export interface OperationalProfile {
  /** Puntuaciones normalizadas `0–100` en los 6 ejes de «Carácter del evento». */
  radar: Record<EventAxisKey, number>;
  /** Claves activas para compatibilidad con `scene.eventGoals`. */
  activeAxes: EventAxisKey[];
  /** Pesos de evaluación para comparación unificada (Lista de deseos + Calcular servicios). */
  comparisonWeights: {
    comfort: number;
    queues: number;
    emergency: number;
    experience: number;
    cost: number;
    logistics: number;
  };
  /** Enfoque espacial dominante sugerido para `redesign`. */
  layoutFocus:
    | 'family'
    | 'commerce'
    | 'gastronomy'
    | 'music'
    | 'logistics'
    | 'economy'
    | 'balanced';
  /** Categorías de programa recomendadas. */
  recommendedActivityCategories: string[];
  /** Tipos de recursos recomendados del catálogo. */
  recommendedResources: string[];
  /** Compromisos detectados entre objetivos en tensión. */
  tradeoffs: ObjectiveTradeoff[];
  /** Resumen legible de orientaciones clave. */
  highlights: string[];
}

/** Modelo central compartido de objetivos del evento (`Scene.objectives`). */
export interface ProjectObjectives {
  version: number;
  catalogVersion: number;
  selected: SelectedObjective[];
  profile: OperationalProfile;
  suggestedHypotheses: BehaviorHypotheses;
  confirmedHypotheses: BehaviorHypotheses;
  /** Texto heredado manual SMART preservado si el proyecto venía de versiones anteriores. */
  legacySmartGoal?: {
    specific: string;
    metric: string;
    target: string;
    feasible: string;
    relevant: string;
    deadline: string;
  };
  updatedAt: string;
}

/** Registro histórico de ejecución para marcar resultados obsoletos al cambiar objetivos. */
export interface SimulationHistoryEntry {
  at: string;
  seed: number;
  objectivesVersion: number;
  stale: boolean;
  served: number;
  abandoned: number;
  score: number;
  summary: string;
}

/** Fila de resultado evaluado para una alternativa en el laboratorio. */
export interface BatchEvaluationRow {
  id: number;
  name: string;
  strategyKey?:
    | 'baseline'
    | 'spatial_efficiency'
    | 'visitor_experience'
    | 'economic_balance';
  viable?: boolean;
  criticalIssues?: string[];
  score: number;
  averages: Record<string, number>;
  objectiveScores?: Record<string, number>;
  estimatedCost?: number;
  setupMinutes?: number;
  freeAreaM2?: number;
  occupiedAreaM2?: number;
  advantages?: string[];
  drawbacks?: string[];
  explanation?: string;
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
