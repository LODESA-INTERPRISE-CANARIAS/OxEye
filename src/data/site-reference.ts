/**
 * @module data/site-reference
 * Reference access gates for Plaza del Cristo and explanatory descriptions for inventory categories.
 */
import type {EntranceItem, VenueMap} from '../types';

export function cristoAccesses(map: VenueMap): EntranceItem[] {
  const specs: Array<[string, string, number, number, number, number, boolean]> =
    [
      ['market', 'Mercado', 228, 187, 4, 101, false],
      ['alley', 'Callejón · ubicación por confirmar', 219, 205, 6, 111, true],
      ['rua', 'Camino La Rúa', 314, 181, 8, 105, true],
      ['viana', 'Calle Viana', 243, 234, 8, 19, true],
      ['rear', 'Callejón del mercado', 176, 153, 2.5, 10, false],
    ];
  return specs.map(([id, name, x, y, width, angle, userWidth]) => ({
    id: 'cristo-access-' + id,
    name,
    kind: 'gate',
    inventoryKind: 'gate',
    x: (x / map.widthMeters) * 100,
    y: (y / map.heightMeters) * 100,
    clearWidth: width,
    gateAngle: angle,
    role: 'both',
    phases: {setup: 'vehicles', event: 'both', strike: 'vehicles'},
    phaseTags: ['pre', 'event', 'post'],
    locked: true,
    referenceAccess: true,
    widthConfirmed: false,
    description: userWidth
      ? 'Anchura solicitada por el usuario; ubicación y paso real pendientes de comprobar.'
      : 'Anchura provisional del ejemplo; confirmar medida y posición sobre plano técnico.',
  }));
}

export const inventoryInfo: Record<string, [string, string]> = {
  ambulance: [
    'Ambulancias disponibles',
    'Número de vehículos, cada uno con su dotación de personal configurable.',
  ],
  fire: [
    'Vehículos de bomberos disponibles',
    'Número de vehículos y dotaciones previstos. No es el número de bomberos individuales.',
  ],
  patrol: [
    'Coches policiales disponibles',
    'Vehículos que pueden intervenir en el ensayo. Su dotación se configura en la ficha.',
  ],
  security: [
    'Equipos de policía a pie',
    'Cada unidad representa un equipo. En su ficha se indica cuántas personas lo forman.',
  ],
  gate: [
    'Accesos físicos del recinto',
    'Tramos de entrada o salida. Deben situarse donde exista un paso real.',
  ],
  loading: [
    'Zonas de carga y descarga',
    'Reservas de superficie para operaciones logísticas. Una zona no equivale a un camión.',
  ],
  turning: [
    'Reservas para maniobra de vehículos',
    'Superficies que deben quedar libres para maniobrar. No representan vehículos.',
  ],
  power: [
    'Puntos de suministro eléctrico',
    'Ubicaciones para conexiones. La potencia y adecuación deben confirmarse con el instalador.',
  ],
  storage: [
    'Zonas de almacenamiento temporal',
    'Espacio para guardar material durante la jornada.',
  ],
  extinguisher: [
    'Extintores disponibles',
    'Unidades materiales. Su uso en el ensayo también requiere personal formado.',
  ],
  cover: [
    'Carpas y cubiertas',
    'Cada unidad es una estructura. Las mesas y actividades bajo ella se cuentan por separado.',
  ],
  picnic: [
    'Mesas con bancos',
    'Cada mesa tiene plazas individuales y un estado de humedad propio.',
  ],
  toilet: [
    'Módulos de aseos',
    'Cada unidad representa un módulo del tamaño indicado. Comprueba su equipamiento y accesibilidad con el proveedor.',
  ],
  bin: [
    'Contenedores de residuos',
    'Destinos donde el equipo de limpieza vacía las bolsas.',
  ],
  medical: [
    'Equipos sanitarios',
    'Cada unidad representa un equipo con personal y capacidad configurables.',
  ],
};
