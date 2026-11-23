/**
 * @module engine/planning/objectives
 * Catálogo extensible y motor central de Objetivos SMART calculables (`ProjectObjectives`).
 * Actúa como fuente única de verdad para Carácter del evento, Calcular servicios,
 * Programa por días, Comportamiento de agentes, Generador espacial y Comparador.
 */
import type {
  BehaviorHypotheses,
  CrowdProfileKey,
  EventAxisKey,
  ObjectiveCatalogItem,
  ObjectiveCategoryKey,
  ObjectivePriority,
  ObjectiveTradeoff,
  OperationalProfile,
  ProjectObjectives,
  Scene,
  SelectedObjective,
} from '../../types';

export const OBJECTIVE_CATEGORIES: Array<{
  key: ObjectiveCategoryKey;
  label: string;
  icon: ObjectiveCategoryKey;
}> = [
  {key: 'families', label: 'Familias', icon: 'families'},
  {key: 'local_commerce', label: 'Comercio local', icon: 'local_commerce'},
  {key: 'gastronomy', label: 'Gastronomía', icon: 'gastronomy'},
  {key: 'culture', label: 'Cultura', icon: 'culture'},
  {key: 'music', label: 'Música', icon: 'music'},
  {key: 'accessibility', label: 'Accesibilidad', icon: 'accessibility'},
  {key: 'safety', label: 'Seguridad', icon: 'safety'},
  {key: 'logistics', label: 'Logística', icon: 'logistics'},
  {key: 'economy', label: 'Economía', icon: 'economy'},
  {key: 'sustainability', label: 'Sostenibilidad', icon: 'sustainability'},
];

export const NON_NEGOTIABLE_CONSTRAINTS: string[] = [
  'Evacuación y anchura mínima de pasos libres de obstáculos (no negociable).',
  'Accesibilidad física en recorridos principales, aseos y zonas de atención.',
  'Dotación mínima de seguridad, primera atención sanitaria y bomberos cuando hay cocina.',
  'Cumplimiento de cargas sobre subsuelo, lastres en carpas y faseado lógico de acceso vehicular.',
];

export const OBJECTIVE_CATALOG: ObjectiveCatalogItem[] = [
  // Familias
  {
    id: 'fam_kids_activities',
    category: 'families',
    subcategory: 'Programación infantil',
    label: 'Actividades infantiles',
    shortDesc: 'Talleres, juegos y programación segura orientada a menores.',
    desiredOutcome: 'Ofrecer sesiones continuas de entretenimiento infantil distribuidas en el horario.',
    indicators: ['Plazas infantiles por hora', 'Participación estimada en talleres'],
    unit: 'plazas/h',
    direction: 'increase',
    defaultTarget: 40,
    targetLabel: 'Plazas/h objetivo',
    relatedResources: ['cover', 'picnic', 'workshop'],
    relatedActivityCategories: ['Infantil', 'Navidad', 'Juego y patrimonio'],
    feasibilityConditions: ['Mesas o carpa de sombra disponibles', 'Monitorización en zonas de juego'],
    calibrationStatus: 'exploratory',
    axisWeights: {family: 35, culture: 15},
    evalWeights: {experience: 35, comfort: 25},
  },
  {
    id: 'fam_intergenerational',
    category: 'families',
    subcategory: 'Convivencia',
    label: 'Ocio intergeneracional',
    shortDesc: 'Espacios compartidos entre jóvenes, familias y mayores.',
    desiredOutcome: 'Fomentar actividades conjuntas entre distintas generaciones.',
    indicators: ['Diversidad de actividades compartidas', 'Zonas de estancia común'],
    unit: 'actividades',
    direction: 'increase',
    relatedResources: ['picnic', 'rest', 'workshop'],
    relatedActivityCategories: ['Juego y patrimonio', 'Lectura y cultura', 'Descanso'],
    feasibilityConditions: ['Asientos suficientes y separación del ruido excesivo'],
    calibrationStatus: 'exploratory',
    axisWeights: {family: 25, culture: 15, comfort: 15},
    evalWeights: {experience: 30, comfort: 25},
  },
  {
    id: 'fam_rest',
    category: 'families',
    subcategory: 'Comodidad',
    label: 'Descanso familiar',
    shortDesc: 'Áreas sombreadas y bancos cómodos próximos a las actividades.',
    desiredOutcome: 'Reducir la fatiga y asegurar plazas de descanso cercanas a la oferta infantil.',
    indicators: ['Plazas de asiento disponibles', 'Distancia media a zona de descanso'],
    unit: 'm',
    direction: 'decrease',
    defaultTarget: 35,
    targetLabel: 'Distancia máx. (m)',
    relatedResources: ['rest', 'cover', 'picnic'],
    relatedActivityCategories: ['Descanso', 'Lectura y cultura'],
    feasibilityConditions: ['Superficie libre para zonas de descanso fuera de ejes de evacuación'],
    calibrationStatus: 'calibrated',
    axisWeights: {family: 25, comfort: 35},
    evalWeights: {comfort: 45, experience: 20},
  },
  {
    id: 'fam_minors_care',
    category: 'families',
    subcategory: 'Protección',
    label: 'Atención a menores',
    shortDesc: 'Puntos de información, orientación y encuentro para familias.',
    desiredOutcome: 'Facilitar orientación visible y respuesta rápida ante extravíos o incidentes con menores.',
    indicators: ['Puntos de asistencia activos', 'Cobertura de vigilancia a pie'],
    unit: 'agentes',
    direction: 'increase',
    relatedResources: ['steward', 'security', 'medical'],
    relatedActivityCategories: ['Inclusión', 'Infantil'],
    feasibilityConditions: ['Personal de orientación y señalización en puntos centrales'],
    calibrationStatus: 'exploratory',
    axisWeights: {family: 25, comfort: 15},
    evalWeights: {emergency: 35, comfort: 25},
  },

  // Comercio local
  {
    id: 'com_boost_sales',
    category: 'local_commerce',
    subcategory: 'Dinamización',
    label: 'Impulsar ventas',
    shortDesc: 'Favorecer el flujo constante hacia puestos de comercio local.',
    desiredOutcome: 'Maximizar la capacidad de atención comercial evitando cuellos de botella en colas.',
    indicators: ['Comercios visitados', 'Atenciones comerciales completadas'],
    unit: 'visitas',
    direction: 'increase',
    relatedResources: ['commerce', 'craft', 'books', 'local'],
    relatedActivityCategories: ['Artesanía', 'Patrimonio'],
    feasibilityConditions: ['Pasillos frontales libres para colas sin bloquear el tránsito'],
    calibrationStatus: 'exploratory',
    axisWeights: {local: 35},
    evalWeights: {experience: 35, queues: 30},
  },
  {
    id: 'com_visibility',
    category: 'local_commerce',
    subcategory: 'Exposición',
    label: 'Aumentar visibilidad',
    shortDesc: 'Evitar zonas ciegas y situar los comercios en ejes visibles.',
    desiredOutcome: 'Conectar todos los puestos con recorridos peatonales principales desde los accesos.',
    indicators: ['Conectividad desde accesos', 'Equilibrio de afluencia por puesto'],
    unit: '%',
    direction: 'increase',
    relatedResources: ['commerce', 'local', 'steward'],
    relatedActivityCategories: ['Artesanía'],
    feasibilityConditions: ['Sin puestos bloqueados ni detrás de vallas ciegas'],
    calibrationStatus: 'exploratory',
    axisWeights: {local: 30},
    evalWeights: {experience: 30, queues: 20},
  },
  {
    id: 'com_diversify',
    category: 'local_commerce',
    subcategory: 'Mix comercial',
    label: 'Diversificar puestos',
    shortDesc: 'Combinar artesanía, libros, producto local y talleres.',
    desiredOutcome: 'Equilibrar distintas tipologías comerciales para ampliar el atractivo del recorrido.',
    indicators: ['Tipologías comerciales activas', 'Variedad de visitas por persona'],
    unit: 'tipos',
    direction: 'increase',
    relatedResources: ['craft', 'books', 'local', 'workshop'],
    relatedActivityCategories: ['Artesanía', 'Taller', 'Lectura y cultura'],
    feasibilityConditions: ['Superficie y tomas eléctricas adecuadas por tipología'],
    calibrationStatus: 'exploratory',
    axisWeights: {local: 25, culture: 15},
    evalWeights: {experience: 35},
  },
  {
    id: 'com_distribute_visitors',
    category: 'local_commerce',
    subcategory: 'Equilibrio espacial',
    label: 'Repartir visitantes',
    shortDesc: 'Evitar que todo el público se concentre en dos puestos frontales.',
    desiredOutcome: 'Distribuir las visitas sintéticas de manera uniforme entre todos los comercios.',
    indicators: ['Dispersión de visitas entre puestos', 'Saturación máxima por comercio'],
    unit: '%',
    direction: 'decrease',
    relatedResources: ['commerce', 'craft', 'books', 'local', 'steward'],
    relatedActivityCategories: ['Juego y patrimonio', 'Taller'],
    feasibilityConditions: ['Pasillos amplios entre hileras comerciales'],
    calibrationStatus: 'calibrated',
    axisWeights: {local: 30},
    evalWeights: {queues: 35, experience: 25},
  },

  // Gastronomía
  {
    id: 'gas_reduce_queues',
    category: 'gastronomy',
    subcategory: 'Fluidez de servicio',
    label: 'Reducir esperas',
    shortDesc: 'Limitar colas y tiempos de espera en los servicios seleccionados.',
    desiredOutcome: 'Mantener el tiempo de espera medio por debajo de la meta operativa.',
    indicators: ['Espera media por puesto', 'Abandonos de cola', 'Espera máxima'],
    unit: 'min',
    direction: 'decrease',
    defaultTarget: 10,
    targetLabel: 'Espera media máx. (min)',
    contextOptions: [
      {key: 'gastronomy', label: 'Gastronomía'},
      {key: 'commerce', label: 'Comercios'},
      {key: 'toilets', label: 'Aseos'},
      {key: 'accesses', label: 'Accesos'},
      {key: 'activities', label: 'Actividades programadas'},
    ],
    relatedResources: ['food', 'ventorrillo', 'toilet', 'gate'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Capacidad de atención acorde a la demanda horaria estimada'],
    calibrationStatus: 'calibrated',
    axisWeights: {food: 30, comfort: 15},
    evalWeights: {queues: 50, comfort: 20},
  },
  {
    id: 'gas_eat_seated',
    category: 'gastronomy',
    subcategory: 'Consumo cómodo',
    label: 'Comer sentado',
    shortDesc: 'Dimensionar mesas y plazas de asiento acordes al consumo estimado.',
    desiredOutcome: 'Minimizar las comidas de pie calculando las mesas necesarias según demanda.',
    indicators: ['Porcentaje de comidas con asiento', 'Déficit de plazas sentado'],
    unit: '%',
    direction: 'increase',
    defaultTarget: 85,
    targetLabel: '% mínimo con asiento',
    relatedResources: ['picnic', 'food', 'ventorrillo'],
    relatedActivityCategories: ['Descanso'],
    feasibilityConditions: ['Espacio para mesas accesible sin invadir rutas de evacuación'],
    calibrationStatus: 'calibrated',
    axisWeights: {food: 30, comfort: 25},
    evalWeights: {comfort: 50, experience: 20},
  },
  {
    id: 'gas_rotation',
    category: 'gastronomy',
    subcategory: 'Capacidad',
    label: 'Mejorar rotación',
    shortDesc: 'Agilizar tiempos de atención y despeje en zona gastronómica.',
    desiredOutcome: 'Aumentar atenciones por hora sin saturar las zonas de paso.',
    indicators: ['Servicios por hora', 'Tiempo medio de ocupación de mesa'],
    unit: 'serv/h',
    direction: 'increase',
    relatedResources: ['food', 'ventorrillo', 'picnic', 'bin'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Contenedores de residuos próximos y puntos eléctricos revisados'],
    calibrationStatus: 'exploratory',
    axisWeights: {food: 25},
    evalWeights: {queues: 35, experience: 20},
  },
  {
    id: 'gas_shelter',
    category: 'gastronomy',
    subcategory: 'Protección climática',
    label: 'Disponer de refugio',
    shortDesc: 'Cubrir zonas de comida y mesas ante lluvia o sol intenso.',
    desiredOutcome: 'Asegurar cobertura climática en zonas de consumo y descanso.',
    indicators: ['Superficie cubierta (m²)', 'Quejas por clima / falta de refugio'],
    unit: 'm²',
    direction: 'increase',
    relatedResources: ['cover', 'ballast', 'picnic'],
    relatedActivityCategories: ['Descanso'],
    feasibilityConditions: ['Lastres vinculados a cada carpa y resistencia al viento verificada'],
    calibrationStatus: 'calibrated',
    axisWeights: {food: 20, comfort: 30},
    evalWeights: {comfort: 45},
  },

  // Cultura
  {
    id: 'cul_workshops',
    category: 'culture',
    subcategory: 'Participación práctica',
    label: 'Talleres',
    shortDesc: 'Impulsar talleres creativos, artesanales y divulgativos.',
    desiredOutcome: 'Integrar sesiones de taller con espacios de mesas o carpas dedicadas.',
    indicators: ['Sesiones de taller programadas', 'Asistentes atendidos en talleres'],
    unit: 'sesiones',
    direction: 'increase',
    relatedResources: ['workshop', 'picnic', 'cover'],
    relatedActivityCategories: ['Taller', 'Artesanía'],
    feasibilityConditions: ['Mesas o carpa cubiertas libres de conflictos acústicos'],
    calibrationStatus: 'exploratory',
    axisWeights: {culture: 35},
    evalWeights: {experience: 35},
  },
  {
    id: 'cul_exhibitions',
    category: 'culture',
    subcategory: 'Divulgación',
    label: 'Exposiciones',
    shortDesc: 'Espacios tranquilos de lectura, patrimonio y muestra cultural.',
    desiredOutcome: 'Garantizar zonas culturales visibles sin congestión acústica.',
    indicators: ['Zonas culturales activas', 'Nivel de presión sonora compatible'],
    unit: 'espacios',
    direction: 'increase',
    relatedResources: ['cover', 'rest', 'workshop'],
    relatedActivityCategories: ['Lectura y cultura', 'Patrimonio'],
    feasibilityConditions: ['Separación acústica respecto a escenarios'],
    calibrationStatus: 'exploratory',
    axisWeights: {culture: 30, comfort: 10},
    evalWeights: {experience: 30, comfort: 20},
  },
  {
    id: 'cul_shows',
    category: 'culture',
    subcategory: 'Artes escénicas',
    label: 'Espectáculos',
    shortDesc: 'Teatro de títeres, cuentacuentos o magia en horario continuo.',
    desiredOutcome: 'Programar espectáculos culturales adaptados a la capacidad de escenario y carpa.',
    indicators: ['Espectáculos programados', 'Capacidad de público frontal'],
    unit: 'actos',
    direction: 'increase',
    relatedResources: ['stage', 'cover'],
    relatedActivityCategories: ['Espectáculo', 'Lectura y cultura'],
    feasibilityConditions: ['Escenario o carpa disponible sin bloquear accesos de emergencia'],
    calibrationStatus: 'exploratory',
    axisWeights: {culture: 30, family: 15, music: 10},
    evalWeights: {experience: 35},
  },
  {
    id: 'cul_participation',
    category: 'culture',
    subcategory: 'Comunidad',
    label: 'Participación ciudadana',
    shortDesc: 'Dinámicas abiertas y colaborativas para el público asistente.',
    desiredOutcome: 'Aumentar las interacciones sociales y participación activa en el recinto.',
    indicators: ['Interacciones medias por visitante', 'Actividades participativas'],
    unit: 'actividades',
    direction: 'increase',
    relatedResources: ['workshop', 'rest', 'stage'],
    relatedActivityCategories: ['Movimiento', 'Inclusión', 'Juego y patrimonio'],
    feasibilityConditions: ['Espacios abiertos de paso libre y orientación'],
    calibrationStatus: 'exploratory',
    axisWeights: {culture: 30, local: 15},
    evalWeights: {experience: 35},
  },

  // Música
  {
    id: 'mus_concerts',
    category: 'music',
    subcategory: 'Escenario principal',
    label: 'Conciertos',
    shortDesc: 'Actuaciones musicales de formato medio/grande en escenario.',
    desiredOutcome: 'Dar soporte seguro y acústico a la programación de conciertos.',
    indicators: ['Aforo frontal disponible', 'Tiempo de descongestión tras actuación'],
    unit: 'plazas',
    direction: 'increase',
    relatedResources: ['stage', 'power', 'security', 'toilet'],
    relatedActivityCategories: ['Música'],
    feasibilityConditions: ['Zona frontal despejada, suministro eléctrico y vías de evacuación amplias'],
    calibrationStatus: 'exploratory',
    axisWeights: {music: 40},
    evalWeights: {experience: 35, queues: 20, emergency: 20},
  },
  {
    id: 'mus_performances',
    category: 'music',
    subcategory: 'Formato cercano',
    label: 'Actuaciones',
    shortDesc: 'Dúos acústicos, villancicos o música ambiental de pequeño formato.',
    desiredOutcome: 'Amenizar el recorrido sin saturar los pasillos principales.',
    indicators: ['Sesiones musicales', 'Fluidez de paso alrededor de actuaciones'],
    unit: 'sesiones',
    direction: 'increase',
    relatedResources: ['stage', 'cover'],
    relatedActivityCategories: ['Música', 'Espectáculo'],
    feasibilityConditions: ['Control de nivel de presión sonora en zonas próximas'],
    calibrationStatus: 'exploratory',
    axisWeights: {music: 30, culture: 15},
    evalWeights: {experience: 30},
  },
  {
    id: 'mus_acoustic_coexistence',
    category: 'music',
    subcategory: 'Confort sonoro',
    label: 'Convivencia acústica',
    shortDesc: 'Compatible con zonas de descanso, lectura, talleres o viviendas cercanas.',
    desiredOutcome: 'Evitar solapes de ruido entre escenarios y zonas tranquilas.',
    indicators: ['Separación entre escenarios y descanso', 'Quejas por ruido/acústica'],
    unit: 'dB',
    direction: 'decrease',
    defaultTarget: 75,
    targetLabel: 'Referencia máx. a 5 m (dB)',
    relatedResources: ['stage', 'rest'],
    relatedActivityCategories: ['Descanso', 'Lectura y cultura'],
    feasibilityConditions: ['Distanciamiento físico y orientación del escenario hacia zona abierta'],
    calibrationStatus: 'calibrated',
    axisWeights: {music: 20, comfort: 25},
    evalWeights: {comfort: 35, experience: 25},
  },
  {
    id: 'mus_crowd_spread',
    category: 'music',
    subcategory: 'Flujos musicales',
    label: 'Distribución de espectadores',
    shortDesc: 'Evitar tapones antes y después de conciertos mediante servicios repartidos.',
    desiredOutcome: 'Mantener la circulación fluida en entradas y salidas tras los picos musicales.',
    indicators: ['Picos de densidad frontal', 'Tiempo atascado en picos de público'],
    unit: 'pers/m²',
    direction: 'decrease',
    relatedResources: ['steward', 'gate', 'toilet'],
    relatedActivityCategories: ['Movimiento'],
    feasibilityConditions: ['Múltiples rutas de salida y aseos alejados del cuello frontal'],
    calibrationStatus: 'calibrated',
    axisWeights: {music: 25},
    evalWeights: {queues: 40, emergency: 25},
  },

  // Accesibilidad
  {
    id: 'acc_routes',
    category: 'accessibility',
    subcategory: 'Movilidad universal',
    label: 'Recorridos accesibles',
    shortDesc: 'Itinerarios continuos, anchos y libres de obstáculos para todas las personas.',
    desiredOutcome: 'Garantizar paso continuo ≥ 2 m y separación entre mobiliario sin escalones ni bloqueos.',
    indicators: ['Anchura libre mínima entre elementos', 'Obstáculos en recorrido'],
    unit: 'm',
    direction: 'increase',
    defaultTarget: 2.5,
    targetLabel: 'Paso libre mín. (m)',
    relatedResources: ['rest', 'toilet'],
    relatedActivityCategories: ['Inclusión'],
    feasibilityConditions: ['Requisito obligatorio permanente: nunca condicionado por presupuesto'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 35},
    evalWeights: {comfort: 40, queues: 25, emergency: 25},
  },
  {
    id: 'acc_rest',
    category: 'accessibility',
    subcategory: 'Pausa y respiro',
    label: 'Descanso',
    shortDesc: 'Puntos tranquilos con asiento accesibles en todo el recinto.',
    desiredOutcome: 'Asegurar cobertura de zonas de descanso accesibles para personas mayores o con movilidad reducida.',
    indicators: ['Plazas de descanso accesibles', 'Cobertura espacial del descanso'],
    unit: 'plazas',
    direction: 'increase',
    relatedResources: ['rest', 'picnic', 'cover'],
    relatedActivityCategories: ['Descanso', 'Inclusión'],
    feasibilityConditions: ['Reserva de espacio libre para sillas de ruedas junto a mesas y bancos'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 35, family: 15},
    evalWeights: {comfort: 45},
  },
  {
    id: 'acc_orientation',
    category: 'accessibility',
    subcategory: 'Wayfinding',
    label: 'Orientación',
    shortDesc: 'Personal de asistencia, señalización y rutas comprensibles.',
    desiredOutcome: 'Reducir desorientación y tiempos de espera mediante personal de orientación.',
    indicators: ['Avisos de orientación', 'Agentes de asistencia desplegados'],
    unit: 'agentes',
    direction: 'increase',
    relatedResources: ['steward'],
    relatedActivityCategories: ['Inclusión'],
    feasibilityConditions: ['Cobertura visual de accesos, aseos y zonas de actividad'],
    calibrationStatus: 'exploratory',
    axisWeights: {comfort: 25},
    evalWeights: {queues: 25, experience: 25, emergency: 20},
  },
  {
    id: 'acc_inclusive_care',
    category: 'accessibility',
    subcategory: 'Inclusión',
    label: 'Atención inclusiva',
    shortDesc: 'Actividades inclusivas, aseos adaptados y menor sobrecarga sensorial.',
    desiredOutcome: 'Facilitar la participación cómoda de personas con diversidad funcional o sensorial.',
    indicators: ['Unidades de aseo accesibles', 'Espacios inclusivos y tranquilos'],
    unit: 'unidades',
    direction: 'increase',
    relatedResources: ['toilet', 'rest', 'steward'],
    relatedActivityCategories: ['Inclusión', 'Lectura y cultura', 'Descanso'],
    feasibilityConditions: ['Unidades de aseo adaptadas operativas y señalizadas'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 30, culture: 10},
    evalWeights: {comfort: 40, experience: 25},
  },

  // Seguridad
  {
    id: 'saf_fluid_access',
    category: 'safety',
    subcategory: 'Control de accesos',
    label: 'Accesos fluidos',
    shortDesc: 'Entradas y salidas dimensionadas sin colapsos ni tapones.',
    desiredOutcome: 'Evitar rechazos y esperas críticas en las puertas de acceso.',
    indicators: ['Entradas bloqueadas', 'Saturación de puertas'],
    unit: 'bloqueos',
    direction: 'decrease',
    defaultTarget: 0,
    targetLabel: 'Bloqueos máx.',
    relatedResources: ['gate', 'steward', 'security'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Mínimo una entrada y salida conectadas con anchura suficiente'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 15},
    evalWeights: {queues: 35, emergency: 40},
  },
  {
    id: 'saf_medical',
    category: 'safety',
    subcategory: 'Sanitario',
    label: 'Asistencia sanitaria',
    shortDesc: 'Puesto sanitario en recinto y ambulancia con ruta de camilla verificada.',
    desiredOutcome: 'Asegurar cobertura sanitaria rápida a pie y evacuación en camilla viable.',
    indicators: ['Tiempo de llegada sanitaria', 'Rutas de camilla sin bloqueos'],
    unit: 's',
    direction: 'decrease',
    relatedResources: ['medical', 'ambulance'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Paso continuo de camilla 2,00 × 0,65 m y punto de estacionamiento'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 15},
    evalWeights: {emergency: 50},
  },
  {
    id: 'saf_incident_response',
    category: 'safety',
    subcategory: 'Operativa de respuesta',
    label: 'Respuesta a incidencias',
    shortDesc: 'Coordinación rápida de policía, bomberos y sanitarios sin interferencias.',
    desiredOutcome: 'Resolver el 100 % de incidencias dentro del umbral operativo.',
    indicators: ['Incidencias resueltas (%)', 'Tiempo medio de resolución'],
    unit: '%',
    direction: 'increase',
    defaultTarget: 100,
    targetLabel: 'Resolución mín. (%)',
    relatedResources: ['security', 'patrol', 'police_van', 'fire', 'extinguisher'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Despacho real desde base exterior y personal suficiente'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 10},
    evalWeights: {emergency: 50},
  },
  {
    id: 'saf_evacuation',
    category: 'safety',
    subcategory: 'Emergencias',
    label: 'Evacuación',
    shortDesc: 'Recorridos de evacuación despejados y salidas seguras.',
    desiredOutcome: 'Garantizar vías de desalojo libres para todo el público desde cualquier zona.',
    indicators: ['Personas sin recorrido de evacuación', 'Ancho efectivo de salida'],
    unit: 'incidencias',
    direction: 'decrease',
    defaultTarget: 0,
    targetLabel: 'Bloqueos evacuación',
    relatedResources: ['gate', 'steward', 'security'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Restricción legal no negociable bajo cualquier objetivo'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 15},
    evalWeights: {emergency: 50, queues: 20},
  },

  // Logística
  {
    id: 'log_efficient_setup',
    category: 'logistics',
    subcategory: 'Planificación temporal',
    label: 'Montaje eficiente',
    shortDesc: 'Secuenciar cuadrillas y carpas sin superar la duración del turno.',
    desiredOutcome: 'Completar el montaje y desmontaje en el menor tiempo operativo posible.',
    indicators: ['Duración total del montaje (min)', 'Cumplimiento de jornada'],
    unit: 'min',
    direction: 'decrease',
    relatedResources: ['loading', 'turning', 'cover'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Cuadrillas sin solape y acceso vehicular libre en Pre/Post-evento'],
    calibrationStatus: 'calibrated',
    axisWeights: {},
    evalWeights: {logistics: 50},
  },
  {
    id: 'log_low_interference',
    category: 'logistics',
    subcategory: 'Secuencia limpia',
    label: 'Menor interferencia',
    shortDesc: 'Evitar que estructuras bloqueen el desmontaje de piezas al fondo.',
    desiredOutcome: 'Ordenar accesos y zonas de carga para liberar pasos progresivamente.',
    indicators: ['Dependencias bloqueantes', 'Conflictos de giro de camión'],
    unit: 'conflictos',
    direction: 'decrease',
    relatedResources: ['loading', 'turning'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Zona de carga/descarga y radio de giro libre'],
    calibrationStatus: 'calibrated',
    axisWeights: {},
    evalWeights: {logistics: 45, queues: 20},
  },
  {
    id: 'log_transport_opt',
    category: 'logistics',
    subcategory: 'Vehículos y flujos',
    label: 'Optimización de transportes',
    shortDesc: 'Reducir viajes en vacío y esperas entre camiones y carretillas.',
    desiredOutcome: 'Maximizar el aprovechamiento de camiones y proximidad a zonas de descarga.',
    indicators: ['Viajes de camión estimados', 'Distancia media desde zona de descarga'],
    unit: 'm',
    direction: 'decrease',
    relatedResources: ['loading', 'turning', 'storage'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Mínimo una zona de descarga y una de maniobra accesibles'],
    calibrationStatus: 'calibrated',
    axisWeights: {},
    evalWeights: {logistics: 45, cost: 20},
  },

  // Economía
  {
    id: 'eco_reduce_costs',
    category: 'economy',
    subcategory: 'Presupuesto',
    label: 'Reducir costes',
    shortDesc: 'Ajustar equipamiento y programa a un presupuesto contenido sin perder seguridad.',
    desiredOutcome: 'Minimizar coste total de infraestructura, turnos y actividades manteniendo mínimos obligatorios.',
    indicators: ['Coste estimado total (€)', 'Aprovechamiento presupuestario'],
    unit: '€',
    direction: 'decrease',
    relatedResources: ['commerce', 'picnic', 'cover'],
    relatedActivityCategories: ['Lectura y cultura', 'Descanso', 'Patrimonio'],
    feasibilityConditions: ['Nunca sacrifica salidas de emergencia, accesibilidad ni prevención mínima'],
    calibrationStatus: 'exploratory',
    axisWeights: {},
    evalWeights: {cost: 50, experience: 15},
  },
  {
    id: 'eco_better_use',
    category: 'economy',
    subcategory: 'Rendimiento de recursos',
    label: 'Mejorar aprovechamiento',
    shortDesc: 'Sacar máximo partido al inventario existente antes de añadir nuevas piezas.',
    desiredOutcome: 'Priorizar redistribuciones espaciales frente a compras adicionales de equipamiento.',
    indicators: ['Ocupación de puestos (%)', 'Superficie de servicio / coste'],
    unit: '%',
    direction: 'increase',
    relatedResources: ['commerce', 'food', 'picnic', 'cover'],
    relatedActivityCategories: [],
    feasibilityConditions: ['Evitar sobrecarga de capacidad que dispare colas'],
    calibrationStatus: 'calibrated',
    axisWeights: {local: 15},
    evalWeights: {cost: 40, queues: 25},
  },
  {
    id: 'eco_local_suppliers',
    category: 'economy',
    subcategory: 'Proximidad',
    label: 'Favorecer proveedores locales',
    shortDesc: 'Priorizar comerciantes, productores y colaboradores locales.',
    desiredOutcome: 'Integrar puestos de producto local, artesanía y proveedores cercanos en el programa.',
    indicators: ['Puestos y actividades locales', 'Equilibrio territorial de oferta'],
    unit: 'puestos',
    direction: 'increase',
    relatedResources: ['local', 'craft', 'ventorrillo'],
    relatedActivityCategories: ['Artesanía', 'Patrimonio', 'Juego y patrimonio'],
    feasibilityConditions: ['Confirmación de disponibilidad con contactos del proyecto'],
    calibrationStatus: 'exploratory',
    axisWeights: {local: 30, culture: 10},
    evalWeights: {experience: 25, cost: 20},
  },

  // Sostenibilidad
  {
    id: 'sus_reduce_waste',
    category: 'sustainability',
    subcategory: 'Residuos',
    label: 'Reducir residuos',
    shortDesc: 'Dimensionar contenedores y fomentar formatos de menor residuo.',
    desiredOutcome: 'Adecuar puntos de recogida de residuos a la demanda gastronómica y comercial.',
    indicators: ['Capacidad de contenedores (L)', 'Cobertura en zona gastronómica'],
    unit: 'L',
    direction: 'increase',
    relatedResources: ['bin', 'food', 'ventorrillo'],
    relatedActivityCategories: ['Taller', 'Navidad'],
    feasibilityConditions: ['Puntos de recogida accesibles para servicio de limpieza en Post-evento'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 10},
    evalWeights: {logistics: 25, comfort: 20},
  },
  {
    id: 'sus_reuse_materials',
    category: 'sustainability',
    subcategory: 'Economía circular',
    label: 'Reutilizar materiales',
    shortDesc: 'Talleres con material reutilizado y equipamiento modular duradero.',
    desiredOutcome: 'Promover actividades educativas de reutilización y mobiliario estándar.',
    indicators: ['Actividades con reutilización', 'Porcentaje de inventario modular'],
    unit: 'actividades',
    direction: 'increase',
    relatedResources: ['workshop', 'picnic'],
    relatedActivityCategories: ['Taller', 'Navidad'],
    feasibilityConditions: ['Disponibilidad de mesas o zona de taller'],
    calibrationStatus: 'exploratory',
    axisWeights: {culture: 15},
    evalWeights: {experience: 20, cost: 15},
  },
  {
    id: 'sus_min_impact',
    category: 'sustainability',
    subcategory: 'Entorno y subsuelo',
    label: 'Minimizar impacto',
    shortDesc: 'Proteger zonas verdes, subsuelo, lastres no agresivos y niveles sonoros.',
    desiredOutcome: 'Evitar cargas excesivas sobre subsuelo y reducir desplazamientos motorizados interiores.',
    indicators: ['Cargas pesadas verificadas', 'Control acústico y movilidad peatonal'],
    unit: 'conflictos',
    direction: 'decrease',
    relatedResources: ['ballast', 'rest', 'steward'],
    relatedActivityCategories: ['Descanso', 'Lectura y cultura', 'Patrimonio'],
    feasibilityConditions: ['Revisión en capa Rayos X / Subsuelo de elementos ≥ 500 kg/m²'],
    calibrationStatus: 'calibrated',
    axisWeights: {comfort: 20, culture: 10},
    evalWeights: {comfort: 25, logistics: 25},
  },
];

export const OBJECTIVE_BY_ID: Record<string, ObjectiveCatalogItem> =
  Object.fromEntries(OBJECTIVE_CATALOG.map((item) => [item.id, item]));

export function priorityToWeight(priority: ObjectivePriority): number {
  return priority === 'essential' ? 5 : priority === 'important' ? 3 : 1;
}

export function effectiveObjectiveWeight(sel: SelectedObjective): number {
  if (typeof sel.weight === 'number' && Number.isFinite(sel.weight)) {
    return Math.max(0, Math.min(5, sel.weight));
  }
  return priorityToWeight(sel.priority);
}

/**
 * Detecta compromisos y tensiones reales entre objetivos seleccionados simultáneamente
 * (p. ej. máxima oferta gastronómica vs espacios abiertos + bajo presupuesto + montaje rápido).
 */
export function detectObjectiveTradeoffs(
  selected: SelectedObjective[]
): ObjectiveTradeoff[] {
  const ids = new Set(selected.map((s) => s.id));
  const tradeoffs: ObjectiveTradeoff[] = [];

  const hasGastroHeavy =
    ids.has('gas_eat_seated') ||
    ids.has('gas_rotation') ||
    ids.has('gas_shelter') ||
    ids.has('gas_reduce_queues');
  const hasLowCost = ids.has('eco_reduce_costs') || ids.has('eco_better_use');
  const hasOpenSpaceOrAccess =
    ids.has('acc_routes') || ids.has('acc_rest') || ids.has('fam_rest');
  const hasFastSetup =
    ids.has('log_efficient_setup') || ids.has('log_transport_opt');
  const hasLoudMusic = ids.has('mus_concerts');
  const hasQuietRest =
    ids.has('mus_acoustic_coexistence') ||
    ids.has('acc_inclusive_care') ||
    ids.has('cul_exhibitions') ||
    ids.has('fam_rest');

  if (hasGastroHeavy && hasLowCost) {
    tradeoffs.push({
      id: 'tradeoff_gastro_vs_budget',
      title: 'Capacidad gastronómica / mesas vs. reducción de costes',
      description:
        'Ampliar puestos, mesas y carpas para eliminar colas incrementa el presupuesto y el montaje. El comparador propondrá alternativas que optimizan primero rotación y colocación antes de añadir unidades.',
      objectiveIds: ['gas_eat_seated', 'gas_reduce_queues', 'eco_reduce_costs'],
    });
  }
  if (hasGastroHeavy && hasOpenSpaceOrAccess) {
    tradeoffs.push({
      id: 'tradeoff_gastro_vs_space',
      title: 'Mobiliario de consumo vs. amplios pasillos y espacios libres',
      description:
        'Las mesas y puestos gastronómicos reducen la superficie peatonal libre. Conviene agrupar mesas en islas con paso ≥ 2,5 m y usar rutas periféricas.',
      objectiveIds: ['gas_eat_seated', 'gas_shelter', 'acc_routes'],
    });
  }
  if ((hasGastroHeavy || ids.has('fam_kids_activities')) && hasFastSetup) {
    tradeoffs.push({
      id: 'tradeoff_infra_vs_setup',
      title: 'Mayor equipamiento vs. montaje rápido',
      description:
        'Más carpas, lastres y mobiliario alargan los turnos logísticos y los viajes de camión. Las propuestas compararán configuraciones modulares con menor carga.',
      objectiveIds: ['gas_shelter', 'log_efficient_setup', 'log_transport_opt'],
    });
  }
  if (hasLoudMusic && hasQuietRest) {
    tradeoffs.push({
      id: 'tradeoff_music_vs_quiet',
      title: 'Conciertos vs. convivencia acústica y descanso tranquilo',
      description:
        'Un escenario activo requiere orientación y distanciamiento físico respecto a zonas familiares, talleres tranquilos o espacios inclusivos.',
      objectiveIds: ['mus_concerts', 'mus_acoustic_coexistence', 'fam_rest'],
    });
  }
  return tradeoffs;
}

/**
 * Deriva un perfil operativo estructurado a partir de los objetivos SMART seleccionados.
 */
export function deriveOperationalProfile(
  selected: SelectedObjective[],
  _confirmed?: BehaviorHypotheses | null
): OperationalProfile {
  const radar: Record<EventAxisKey, number> = {
    family: 0,
    local: 0,
    food: 0,
    culture: 0,
    music: 0,
    comfort: 0,
  };
  const evalAccum = {
    comfort: 25,
    queues: 25,
    emergency: 30,
    experience: 25,
    cost: 15,
    logistics: 15,
  };

  const actCats = new Set<string>();
  const recRes = new Set<string>();
  const highlights: string[] = [];

  for (const sel of selected) {
    const def = OBJECTIVE_BY_ID[sel.id];
    if (!def) continue;
    const w = effectiveObjectiveWeight(sel);
    const mult = w / 3; // peso normal 3 -> 1.0, esencial 5 -> 1.67
    for (const [axis, val] of Object.entries(def.axisWeights) as Array<
      [EventAxisKey, number]
    >) {
      radar[axis] = Math.min(100, Math.round(radar[axis] + (val || 0) * mult));
    }
    for (const [ek, ev] of Object.entries(def.evalWeights)) {
      if (ek in evalAccum) {
        evalAccum[ek as keyof typeof evalAccum] += Math.round((ev || 0) * mult);
      }
    }
    def.relatedActivityCategories.forEach((c) => actCats.add(c));
    def.relatedResources.forEach((r) => recRes.add(r));
    if (sel.priority === 'essential') {
      highlights.push(
        `${def.label}${sel.targetValue !== undefined ? ` (meta: ${sel.targetValue} ${def.unit})` : ''}`
      );
    }
  }

  // Normalizar pesos de comparación a 0–100 manteniendo seguridad siempre relevante (mín. 35)
  const maxEval = Math.max(1, ...Object.values(evalAccum));
  const norm = (v: number, min = 15) =>
    Math.max(min, Math.min(100, Math.round((v / maxEval) * 100)));

  const comparisonWeights = {
    comfort: norm(evalAccum.comfort, 20),
    queues: norm(evalAccum.queues, 20),
    emergency: norm(evalAccum.emergency, 35),
    experience: norm(evalAccum.experience, 20),
    cost: norm(evalAccum.cost, 15),
    logistics: norm(evalAccum.logistics, 15),
  };

  const activeAxes = (Object.keys(radar) as EventAxisKey[]).filter(
    (k) => radar[k] >= 25
  );
  if (!activeAxes.length) activeAxes.push('comfort');

  // Determinar foco espacial dominante según intensidades reales
  let layoutFocus: OperationalProfile['layoutFocus'] = 'balanced';
  if (evalAccum.logistics >= 75 && evalAccum.logistics > radar.food) {
    layoutFocus = 'logistics';
  } else if (evalAccum.cost >= 80 && evalAccum.cost > radar.local + 20) {
    layoutFocus = 'economy';
  } else if (radar.food >= radar.local && radar.food >= radar.music && radar.food >= 35) {
    layoutFocus = 'gastronomy';
  } else if (radar.local >= radar.family && radar.local >= radar.music && radar.local >= 35) {
    layoutFocus = 'commerce';
  } else if (radar.music >= radar.family && radar.music >= 40) {
    layoutFocus = 'music';
  } else if (radar.family >= 35 || radar.comfort >= 45) {
    layoutFocus = 'family';
  }

  return {
    radar,
    activeAxes,
    comparisonWeights,
    layoutFocus,
    recommendedActivityCategories: [...actCats],
    recommendedResources: [...recRes],
    tradeoffs: detectObjectiveTradeoffs(selected),
    highlights: highlights.slice(0, 5),
  };
}

/**
 * Propone hipótesis de comportamiento y mezcla de perfiles coherentes con el perfil operativo,
 * separando claramente la sugerencia (`suggested_from_objectives`) de la confirmación del usuario.
 */
export function suggestBehaviorHypotheses(
  selected: SelectedObjective[],
  profile: OperationalProfile
): BehaviorHypotheses {
  const {radar} = profile;
  const ids = new Set(selected.map((s) => s.id));

  const rawMix: Record<CrowdProfileKey, number> = {
    buyer: 12 + Math.round(radar.local * 0.42),
    foodie: 12 + Math.round(radar.food * 0.42),
    culture: 12 + Math.round((radar.culture + radar.family * 0.65) * 0.32),
    music: 10 + Math.round(radar.music * 0.42),
    walker: 12 + Math.round((radar.comfort + radar.family * 0.35) * 0.25),
  };
  const sum = Object.values(rawMix).reduce((a, b) => a + b, 0) || 1;
  const mix = Object.fromEntries(
    Object.entries(rawMix).map(([k, v]) => [k, Math.max(5, Math.round((v / sum) * 100))])
  ) as Record<CrowdProfileKey, number>;

  const boostScale = (score: number, bonus = 0) =>
    Math.round((0.8 + (score / 100) * 0.8 + bonus) * 100) / 100;

  const destinationBoosts = {
    commerce: boostScale(
      radar.local,
      ids.has('com_distribute_visitors') || ids.has('com_boost_sales') ? 0.25 : 0
    ),
    food: boostScale(
      radar.food,
      ids.has('gas_eat_seated') || ids.has('gas_rotation') ? 0.25 : 0
    ),
    workshop: boostScale(
      Math.max(radar.culture, radar.family * 0.8),
      ids.has('cul_workshops') || ids.has('fam_kids_activities') ? 0.25 : 0
    ),
    stage: boostScale(
      Math.max(radar.music, radar.culture * 0.5),
      ids.has('mus_concerts') || ids.has('cul_shows') ? 0.25 : 0
    ),
    rest: boostScale(
      Math.max(radar.comfort, radar.family * 0.7),
      ids.has('fam_rest') || ids.has('acc_rest') ? 0.3 : 0
    ),
  };

  const stayMultiplier =
    radar.family >= 40 || radar.culture >= 40
      ? 1.18
      : ids.has('gas_rotation')
        ? 0.92
        : 1.0;

  const queueObj = selected.find((s) => s.id === 'gas_reduce_queues');
  const queueToleranceMultiplier =
    queueObj?.targetValue && queueObj.targetValue <= 8 ? 0.85 : 1.0;

  const shelterNeedBonus =
    ids.has('gas_shelter') || ids.has('fam_rest') || ids.has('acc_rest')
      ? 0.2
      : 0;

  const rationale: string[] = [
    `Mezcla sugerida (no asumida automáticamente como público real): ${mix.buyer}% comprador · ${mix.foodie}% gastro · ${mix.culture}% cultura/talleres · ${mix.music}% música · ${mix.walker}% paseo/descanso.`,
  ];
  if (destinationBoosts.commerce > 1.2) {
    rationale.push('Favorece visitas comerciales y reparto equilibrado entre puestos locales.');
  }
  if (destinationBoosts.food > 1.2) {
    rationale.push('Aumenta frecuencia gastronómica y consumo en mesas respecto al valor neutro.');
  }
  if (destinationBoosts.rest > 1.2 || shelterNeedBonus > 0) {
    rationale.push('Refuerza la búsqueda de descanso, sombra y recorridos accesibles.');
  }

  return {
    origin: 'suggested_from_objectives',
    confirmed: true,
    mix,
    destinationBoosts,
    stayMultiplier,
    queueToleranceMultiplier,
    shelterNeedBonus,
    rationale,
  };
}

/** Genera resumen legible `smartGoal` retrocompatible a partir de los objetivos sin obligar a redactar. */
export function summarizeLegacySmartGoal(
  objectives: ProjectObjectives
): NonNullable<Scene['smartGoal']> {
  const firstLabels = objectives.selected
    .slice(0, 3)
    .map((s) => OBJECTIVE_BY_ID[s.id]?.label || s.id)
    .join(', ');
  const firstDef = objectives.selected[0]
    ? OBJECTIVE_BY_ID[objectives.selected[0].id]
    : undefined;
  return {
    specific: firstLabels || 'Evento operativo equilibrado',
    metric: firstDef ? `${firstDef.indicators[0] || firstDef.label} (${firstDef.unit})` : 'Satisfacción y espera media',
    target:
      objectives.selected[0]?.targetValue !== undefined
        ? `${objectives.selected[0].targetValue} ${firstDef?.unit || ''}`.trim()
        : 'Cumplimiento integral sin bloqueos',
    feasible: `${objectives.profile.recommendedResources.slice(0, 4).join(', ') || 'Recursos del recinto'} según inventario`,
    relevant: `Perfil ${objectives.profile.activeAxes.join(', ')}`,
    deadline: new Date().toISOString().slice(0, 10),
  };
}

/** Construye un objeto `ProjectObjectives` completo listo para guardar en `scene.objectives`. */
export function createProjectObjectives(
  selected: SelectedObjective[],
  opts?: {
    confirmedHypotheses?: BehaviorHypotheses | null;
    version?: number;
    legacySmartGoal?: ProjectObjectives['legacySmartGoal'];
  }
): ProjectObjectives {
  const cleanSelected = selected.filter((s) => !!OBJECTIVE_BY_ID[s.id]);
  const profile = deriveOperationalProfile(cleanSelected, opts?.confirmedHypotheses);
  const suggestedHypotheses = suggestBehaviorHypotheses(cleanSelected, profile);
  const confirmedHypotheses: BehaviorHypotheses = opts?.confirmedHypotheses
    ? {...opts.confirmedHypotheses}
    : {...suggestedHypotheses};

  return {
    version: opts?.version ?? 1,
    catalogVersion: 1,
    selected: cleanSelected,
    profile,
    suggestedHypotheses,
    confirmedHypotheses,
    ...(opts?.legacySmartGoal ? {legacySmartGoal: opts.legacySmartGoal} : {}),
    updatedAt: new Date().toISOString(),
  };
}

const AXIS_DEFAULT_OBJECTIVES: Record<EventAxisKey, string[]> = {
  family: ['fam_kids_activities', 'fam_rest'],
  local: ['com_boost_sales', 'com_distribute_visitors'],
  food: ['gas_eat_seated', 'gas_reduce_queues'],
  culture: ['cul_workshops', 'cul_participation'],
  music: ['mus_concerts', 'mus_crowd_spread'],
  comfort: ['acc_routes', 'acc_rest'],
};

/**
 * Sincronización bidireccional desde «Carácter del evento» (ejes 6 vértices) hacia `ProjectObjectives`.
 */
export function syncObjectivesFromAxisChange(
  current: ProjectObjectives,
  axis: EventAxisKey,
  enabled: boolean
): ProjectObjectives {
  const axisIds = OBJECTIVE_CATALOG.filter(
    (c) => (c.axisWeights[axis] || 0) >= 20
  ).map((c) => c.id);
  let nextSelected = current.selected.slice();

  if (enabled) {
    const defaults = AXIS_DEFAULT_OBJECTIVES[axis] || axisIds.slice(0, 2);
    if (!nextSelected.some((s) => axisIds.includes(s.id))) {
      for (const id of defaults) {
        if (!nextSelected.some((s) => s.id === id)) {
          nextSelected.push({id, priority: 'important'});
        }
      }
    }
  } else {
    nextSelected = nextSelected.filter((s) => !axisIds.includes(s.id));
  }

  return createProjectObjectives(nextSelected, {
    version: current.version + 1,
    legacySmartGoal: current.legacySmartGoal,
  });
}

/**
 * Actualiza los pesos de comparación compartidos en `ProjectObjectives` cuando se ajustan
 * desde «Lista de deseos» (`LaboratoryDialog`).
 */
export function updateObjectivesComparisonWeights(
  current: ProjectObjectives,
  weights: Partial<OperationalProfile['comparisonWeights']>
): ProjectObjectives {
  return {
    ...current,
    profile: {
      ...current.profile,
      comparisonWeights: {
        ...current.profile.comparisonWeights,
        ...weights,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Convierte un proyecto antiguo con `smartGoal` manual y/o `eventGoals` al nuevo catálogo sin borrar el texto original. */
export function convertLegacySmartToObjectives(scene: Scene): ProjectObjectives {
  const legacyText = [
    scene.smartGoal?.specific,
    scene.smartGoal?.metric,
    scene.smartGoal?.relevant,
    scene.citizenWishes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const chosen = new Map<string, SelectedObjective>();
  const addId = (id: string, priority: ObjectivePriority = 'important') => {
    if (!chosen.has(id) && OBJECTIVE_BY_ID[id]) {
      chosen.set(id, {id, priority});
    }
  };

  for (const ax of scene.eventGoals || []) {
    if (ax in AXIS_DEFAULT_OBJECTIVES) {
      for (const id of AXIS_DEFAULT_OBJECTIVES[ax as EventAxisKey]) {
        addId(id, 'important');
      }
    }
  }
  if (/cola|espera|rápid|fluidez/.test(legacyText)) addId('gas_reduce_queues', 'essential');
  if (/mesa|sentad|comida|gastro/.test(legacyText)) addId('gas_eat_seated', 'essential');
  if (/comercio|tienda|venta|local/.test(legacyText)) addId('com_boost_sales', 'essential');
  if (/famil|niñ|infantil|menor/.test(legacyText)) addId('fam_kids_activities', 'essential');
  if (/música|concierto|escenario/.test(legacyText)) addId('mus_concerts', 'essential');
  if (/accesib|descanso|mayor|sombra/.test(legacyText)) addId('acc_routes', 'essential');
  if (/coste|presupuesto|barat/.test(legacyText)) addId('eco_reduce_costs', 'important');

  if (!chosen.size) {
    addId('fam_kids_activities', 'important');
    addId('com_boost_sales', 'important');
    addId('acc_routes', 'important');
  }

  return createProjectObjectives([...chosen.values()], {
    legacySmartGoal: scene.smartGoal ? structuredClone(scene.smartGoal) : undefined,
    confirmedHypotheses: {
      ...suggestBehaviorHypotheses(
        [...chosen.values()],
        deriveOperationalProfile([...chosen.values()])
      ),
      origin: 'legacy_default',
      confirmed: false,
    },
  });
}

/** Devuelve `scene.objectives` si existe o lo sintetiza de forma no destructiva desde `eventGoals` / `smartGoal`. */
export function ensureProjectObjectives(scene: Scene): ProjectObjectives {
  if (scene.objectives?.selected?.length) {
    return scene.objectives;
  }
  return convertLegacySmartToObjectives(scene);
}
