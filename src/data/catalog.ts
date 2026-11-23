/**
 * @module data/catalog
 * Catálogo de estructuras, iconos, recintos y campos presupuestarios de Ojo de Buey.
 */
import {logistics} from '../engine/logistics/phases';
import type {VenueKey} from '../types';

/** Información descriptiva de los tres recintos de San Cristóbal de La Laguna. */
export const VENUES: Record<
  VenueKey,
  {name: string; short: string; tag: string; num: string}
> = {
  cristo: {
    name: 'Plaza del Cristo',
    short: 'El Cristo',
    tag: 'PLAZA · CASCO HISTÓRICO',
    num: '01',
  },
  constitucion: {
    name: 'Parque de la Constitución',
    short: 'La Constitución',
    tag: 'PARQUE · CAMINO LARGO',
    num: '02',
  },
  vega: {
    name: 'Parque de La Vega',
    short: 'La Vega',
    tag: 'PARQUE · PEDRO GONZÁLEZ',
    num: '03',
  },
};

/** Definición de una pieza del catálogo de diseño e inventario. */
export interface CatalogEntry {
  name: string;
  type?: string;
  role?: string;
  w: number;
  h: number;
  color: string;
  /** Indica si la pieza se considera elemento pesado por defecto frente al subsuelo. */
  heavyLoad?: boolean;
  /** Masa inicial en kg para piezas con cálculo de carga superficial (p. ej. lastres). */
  defaultMassKg?: number;
}

/** Iconos simbólicos por tipo o rol de pieza. */
export const icons: Record<string, string> = {
  commerce: '▤',
  food: '▣',
  stage: '▱',
  rest: '▥',
  cover: '⌂',
  ballast: '⛁',
  toilet: 'WC',
  medical: '✚',
  yellow_tent: 'A',
  violet_point: 'V',
  ambulance: '✚',
  fire: '▣',
  patrol: '◈',
  police_van: '◈',
  security: '◈',
  steward: '✦',
  gate: '⇄',
  cleaning: 'L',
  prep: 'A',
  assembly: 'M',
  dismantle: 'D',
  turning: '↻',
  loading: 'C/D',
  power: 'ϟ',
  storage: 'AC',
};

/** Catálogo completo de piezas colocables en el plano. */
export const catalog: Record<string, CatalogEntry> = {
  extinguisher: {
    name: 'Extintor',
    role: 'facility',
    w: 0.5,
    h: 0.5,
    color: '#d9686b',
  },
  craft: {
    name: 'Comercio · artesanía',
    type: 'commerce',
    w: 4,
    h: 3,
    color: '#ddbd7d',
  },
  books: {
    name: 'Comercio · libros',
    type: 'commerce',
    w: 4,
    h: 3,
    color: '#ddbd7d',
  },
  local: {
    name: 'Comercio · producto local',
    type: 'commerce',
    w: 4,
    h: 3,
    color: '#ddbd7d',
  },
  ventorrillo: {
    name: 'Ventorrillo',
    type: 'food',
    w: 4,
    h: 3,
    color: '#d4a56e',
  },
  workshop: {
    name: 'Taller',
    type: 'workshop',
    w: 6,
    h: 4,
    color: '#a1b7ac',
  },
  picnic: {
    name: 'Mesa picnic',
    role: 'furniture',
    w: 3,
    h: 1.8,
    color: '#bb9667',
  },
  bin: {
    name: 'Contenedor',
    role: 'logistics',
    w: 1.5,
    h: 1.2,
    color: '#73916c',
  },
  commerce: {
    name: 'Puesto',
    type: 'commerce',
    w: 4,
    h: 3,
    color: '#e8bc6d',
  },
  food: {
    name: 'Foodtruck',
    type: 'food',
    w: 5,
    h: 2.5,
    color: '#df9a72',
    heavyLoad: true,
  },
  stage: {
    name: 'Escenario',
    type: 'stage',
    w: 12,
    h: 8,
    color: '#9dabc4',
    heavyLoad: true,
  },
  rest: {
    name: 'Descanso',
    type: 'rest',
    w: 6,
    h: 4,
    color: '#b3c78f',
  },
  cover: {
    name: 'Carpa',
    role: 'cover',
    w: 10,
    h: 10,
    color: '#bdd4c0',
    heavyLoad: false,
  },
  ballast: {
    name: 'Lastre / contrapeso',
    role: 'logistics',
    w: 1,
    h: 1,
    color: '#7c8594',
    heavyLoad: true,
    defaultMassKg: 500,
  },
  toilet: {
    name: 'Aseos',
    role: 'facility',
    w: 3,
    h: 2,
    color: '#aaaac0',
  },
  medical: {
    name: 'Equipo sanitario',
    role: 'emergency',
    w: 6,
    h: 4,
    color: '#dd9c8b',
  },
  yellow_tent: {
    name: 'Carpa Amarilla',
    role: 'emergency',
    w: 4,
    h: 4,
    color: '#E69A26',
  },
  violet_point: {
    name: 'Punto Violeta',
    role: 'emergency',
    w: 3.5,
    h: 3.5,
    color: '#9755C2',
  },
  ambulance: {
    name: 'Ambulancia',
    role: 'emergency',
    w: 2.5,
    h: 6,
    color: '#cadde1',
    heavyLoad: true,
  },
  fire: {
    name: 'Bomberos',
    role: 'emergency',
    w: 3,
    h: 8,
    color: '#cc8b75',
    heavyLoad: true,
  },
  patrol: {
    name: 'Coche policial',
    role: 'emergency',
    w: 1.9,
    h: 4.6,
    color: '#6888b5',
  },
  police_van: {
    name: 'Furgón policial',
    role: 'emergency',
    w: 2.2,
    h: 5.8,
    color: '#47699a',
    heavyLoad: true,
  },
  security: {
    name: 'Policía a pie',
    role: 'emergency',
    w: 0.5,
    h: 0.5,
    color: '#a5b8ca',
  },
  steward: {
    name: 'Personal de asistencia',
    role: 'steward',
    w: 0.5,
    h: 0.5,
    color: '#14b8a6',
  },
  gate: {
    name: 'Acceso',
    w: 4,
    h: 1,
    color: '#86ae88',
  },
};

for (const [kind, [name, w, h]] of Object.entries(logistics).filter(
  ([k]) => !['cleaning', 'prep', 'assembly', 'dismantle'].includes(k)
)) {
  catalog[kind] = {
    name,
    w,
    h,
    role: 'logistics',
    color: kind === 'power' ? '#ebc44d' : '#b4c5cd',
    heavyLoad: ['loading', 'turning', 'storage'].includes(kind),
  };
}

/**
 * Campos configurables en la Ficha de Producción (`[key, label, default, min, max, step]`).
 */
export const budgetFields: Array<[string, string, number, number, number, number]> =
  [
    [
      'fireBurnSeconds',
      'Tiempo de destrucción de una estructura en el ensayo (s)',
      600,
      60,
      3600,
      30,
    ],
    [
      'fireSpreadSeconds',
      'Tiempo previo a propagación en el ensayo (s)',
      120,
      30,
      1200,
      10,
    ],
    [
      'fireSpreadGap',
      'Distancia de propagación entre estructuras (m)',
      3,
      0,
      10,
      0.5,
    ],
    [
      'localExtinguishSeconds',
      'Duración del intento con extintor (s)',
      45,
      10,
      300,
      5,
    ],
    [
      'reinforcementDelay',
      'Segundos de llegada de un refuerzo de reserva',
      600,
      30,
      7200,
      30,
    ],
    ['incidentRadius', 'Radio de precaución del ensayo (m)', 8, 3, 50, 1],
    [
      'curiosityShare',
      'Visitantes con curiosidad en este ensayo (%)',
      20,
      0,
      100,
      1,
    ],
    [
      'sensoryShare',
      'Visitantes con percepción reducida simulada (%)',
      10,
      0,
      100,
      1,
    ],
    [
      'mildAlcoholShare',
      'Adultos con consumo leve simulado (%)',
      5,
      0,
      100,
      1,
    ],
    ['mealMin', 'Comida · duración mínima (min)', 10, 1, 120, 1],
    ['mealMax', 'Comida · duración máxima (min)', 20, 1, 120, 1],
    [
      'seatWaitMin',
      'Búsqueda de asiento antes de comer de pie (min)',
      3,
      0,
      30,
      1,
    ],
    ['dryStaff', 'Personal de secado', 1, 0, 10, 1],
    ['drySeconds', 'Segundos para secar una mesa', 45, 5, 600, 5],
    ['eventDays', 'Días de evento', 1, 1, 30, 1],
    ['parkMin', 'Aparcamiento por camión (min)', 2, 0.5, 10, 0.5],
    ['truckBatch', 'Lotes de estructuras por camión', 5, 1, 24, 1],
    ['bagLitres', 'Capacidad útil de bolsa (L)', 60, 5, 240, 1],
    ['wasteLitres', 'Residuos por pieza y jornada (L)', 12, 1, 150, 1],
    ['teamSize', 'Personas por turno', 3, 2, 6, 1],
    ['rate', 'Salario bruto por hora (€)', 16, 0, 300, 0.01],
    ['burden', 'Costes adicionales de personal (%)', 0, 0, 150, 0.1],
    ['hoursLimit', 'Duración máxima del turno (h)', 8, 0.5, 8, 0.5],
    ['setupMin', 'Montaje por pieza (min con 3 personas)', 10, 0.5, 480, 0.5],
    [
      'strikeMin',
      'Desmontaje por pieza (min con 3 personas)',
      7,
      0.5,
      480,
      0.5,
    ],
    ['cleanMin', 'Segundos de recogida por 5 L', 15, 1, 480, 1],
  ];

/** Alias en mayúsculas para compatibilidad con componentes y pruebas. */
export const CATALOG = catalog;
export const ICONS = icons;
export const BUDGET_FIELDS = budgetFields;
