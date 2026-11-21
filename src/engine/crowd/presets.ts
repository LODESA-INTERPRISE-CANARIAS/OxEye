import {VENUES} from '../../data/catalog';
import {cristoAccesses} from '../../data/site-reference';
import {MAPS} from '../../data/venue-maps';
import type {
  CartoData,
  Entrance,
  EventBaseConfig,
  Point,
  PolygonElement,
  Scene,
  VenueKey,
  VenueMap,
} from '../../types';
import {inside, localPoint, percent, remapScene} from '../cartography/geometry';
import {addPicnicZone} from '../dining/furniture';
import {booth, defaults, SITES} from './event-model';

/**
 * Snapshot of the original unconfigured venue maps.
 */
export const ORIGINAL: Record<string, VenueMap> = structuredClone(MAPS);

/**
 * Source URL referenced in the Christmas example preset.
 */
export const CHRISTMAS_SOURCE =
  'https://www.aytolalaguna.es/actualidad/noticias/La-Plaza-de-la-Navidad-lagunera-abre-su-segundo-fin-de-semana-con-actuaciones-musicales-y-nuevas-atracciones-infantiles/';

/**
 * Returns the operational mode of an entrance gate for a given phase.
 *
 * @param g - Entrance gate element.
 * @param phase - Operational phase (`'setup'`, `'event'`, or `'strike'`).
 * @returns Gate mode string (`'in'`, `'out'`, `'both'`, `'vehicles'`, `'emergency'`, or `'closed'`).
 */
export function gateMode(
  g: Entrance,
  phase: 'setup' | 'event' | 'strike' = 'event'
): string {
  return (
    g.phases?.[phase] || (phase === 'event' ? g.role || 'both' : 'closed')
  );
}

const ellipse = (x: number, y: number, rx: number, ry: number): Point[] =>
  Array.from({length: 28}, (_, i) => [
    x + rx * Math.cos((i * Math.PI) / 14),
    y + ry * Math.sin((i * Math.PI) / 14),
  ]);

/**
 * Returns reference boundary, passages, and reserved polygons for a site.
 *
 * @param site - Venue key.
 * @returns Reference geometry object.
 */
export function reference(site: string): {
  passages: PolygonElement[];
  boundary: Point[];
  reserves: PolygonElement[];
} {
  const m = MAPS[site];
  const park = m?.features?.find((f) => f.kind === 'park');
  return {
    passages:
      site === 'cristo'
        ? [
            {
              id: 'market-rear',
              name: 'Pasillo trasero del mercado · salida',
              points: [
                [5, 16],
                [49, 25],
                [49, 30],
                [5, 21],
              ],
              origin:
                'Interpretación PNOA y eje peatonal OSM; anchura por comprobar.',
            },
          ]
        : [],
    boundary:
      site === 'cristo'
        ? [
            [30, 27],
            [67, 33],
            [58, 77],
            [22, 60],
            [28, 39],
          ]
        : site === 'adelantado'
          ? [
              [26, 20],
              [74, 28],
              [79, 79],
              [13, 77],
            ]
          : park?.points || [
              [18, 15],
              [88, 35],
              [74, 91],
              [8, 67],
            ],
    reserves:
      site === 'adelantado'
        ? [
            {
              id: 'ref-garden',
              name: 'Jardín y fuente · interpretación aérea',
              points: ellipse(51, 50, 18, 17),
              origin:
                'Interpretación orientativa de ortofoto; revisar en campo.',
            },
            {
              id: 'ref-east',
              name: 'Jardín este · aproximación',
              points: [
                [64, 29],
                [72, 30],
                [77, 48],
                [69, 50],
                [65, 40],
              ],
              origin: 'Interpretación aérea orientativa.',
            },
          ]
        : site === 'vega'
          ? [
              ...(m?.features || [])
                .filter((f) => ['pitch', 'track'].includes(f.kind))
                .map((f) => ({
                  id: 'osm-' + f.osmId,
                  name: f.name,
                  points: f.points,
                  origin:
                    'Geometría OpenStreetMap; usos existentes reservados.',
                })),
              {
                id: 'ref-pond',
                name: 'Charca · aproximación',
                points: [
                  [63, 41],
                  [70, 45],
                  [69, 55],
                  [64, 64],
                  [60, 70],
                  [56, 66],
                  [56, 61],
                  [63, 57],
                ],
                origin: 'Interpretación aérea orientativa.',
              },
              {
                id: 'ref-trees',
                name: 'Jardín central · aproximación',
                points: [
                  [42, 33],
                  [51, 34],
                  [55, 42],
                  [52, 50],
                  [44, 48],
                  [40, 43],
                ],
                origin:
                  'Interpretación aérea orientativa; caminos bajo arbolado incompletos.',
              },
            ]
          : [],
  };
}

/**
 * Creates a clean laboratory scene from a base event configuration.
 *
 * @param base - Base event configuration.
 * @returns Initialized `Scene` instance.
 */
export function createLab(base: EventBaseConfig = defaults()): Scene {
  const refs = reference(base.site);
  return {
    version: 1,
    title: 'Mi evento',
    site: base.site,
    base: structuredClone(base),
    boundary: refs.boundary,
    passages: refs.passages,
    reserves: refs.reserves,
    fences: [],
    roadPlans: [],
    measurements: [],
    annotations: [],
    infrastructure: [],
    entrances: [
      {
        id: 'entry-1',
        name: 'Acceso propuesto',
        x:
          base.site === 'cristo'
            ? 43
            : base.site === 'adelantado'
              ? 44
              : 29,
        y:
          base.site === 'cristo'
            ? 68
            : base.site === 'adelantado'
              ? 23
              : 26,
      },
    ],
    mix: {buyer: 25, foodie: 25, culture: 20, music: 20, walker: 10},
    maxWait: 12,
    diameter: 0.6,
    seed: 2026,
    offerMix: true,
  };
}

/**
 * Applies operational preset facilities, logistics areas, passages, and corridors.
 *
 * @param s - Scene to enrich.
 * @returns Updated scene.
 */
export function applyOperationalPreset(s: Scene): Scene {
  const obj = (
    id: string,
    name: string,
    role: 'facility' | 'logistics',
    kind: string,
    x: number,
    y: number,
    width: number,
    depth: number,
    extra: Record<string, unknown> = {}
  ) => ({
    id,
    name,
    role,
    kind,
    x,
    y,
    width,
    depth,
    rotation: 0,
    capacity: 0,
    cost: 0,
    ...extra,
  });

  s.infrastructure.push(
    obj('wc-north', 'WC · pasillo oeste', 'facility', 'toilet', 17, 20.2, 6, 2.4, {
      capacity: 3,
      accessibleUnits: 1,
      cost: 120,
    }),
    obj('wc-south', 'WC · trasera mercado', 'facility', 'toilet', 26, 22.1, 6, 2.4, {
      capacity: 3,
      accessibleUnits: 1,
      cost: 120,
    }),
    obj('loading-a', 'Carga A · comercio', 'logistics', 'loading', 36, 46, 3.5, 10),
    obj('loading-b', 'Carga B · talleres', 'logistics', 'loading', 36, 54, 3.5, 10),
    obj('loading-c', 'Carga C · escenario', 'logistics', 'loading', 54, 61, 3.5, 10),
    obj('turning', 'Maniobra · mantener libre', 'logistics', 'turning', 48, 51, 24, 20)
  );
  s.passages = [
    {
      id: 'market-rear',
      name: 'Pasillo trasero del mercado · salida',
      points: [
        [5, 16],
        [49, 25],
        [49, 30],
        [5, 21],
      ],
      origin:
        'Trazado interpretado de PNOA y eje peatonal OSM; anchura pendiente de comprobación.',
    },
  ];
  s.entrances.push({
    id: 'exit-market-rear',
    name: 'SALIDA · Trasera del mercado',
    x: 6.5,
    y: 19,
    role: 'out',
    clearWidth: 3,
  });
  s.flows = [
    {
      id: 'flow-rear',
      name: 'Salida por detrás del mercado',
      width: 2.5,
      points: [
        [46, 32],
        [46, 27.8],
        [32, 25],
        [20, 22.8],
        [6.5, 19.5],
      ],
    },
    {
      id: 'flow-market',
      name: 'Mercado → talleres',
      width: 4,
      points: [
        [29, 39],
        [35, 41],
        [41, 45],
        [41, 55],
        [41, 68],
      ],
    },
    {
      id: 'flow-stage',
      name: 'Comercio → espectáculo → salida sur',
      width: 3,
      points: [
        [34, 41],
        [56.5, 41],
        [57.5, 47],
        [57.5, 58],
        [51, 62],
        [47, 71],
      ],
    },
    {
      id: 'flow-east',
      name: 'Salida lateral',
      width: 3,
      points: [
        [54, 47],
        [58, 49],
        [62, 49],
      ],
    },
  ];
  s.corridors = s.flows.map((f) => ({...f}));
  s.vehicleRoute = {
    name: 'Acceso técnico → descarga → maniobra → salida',
    width: 4.5,
    points: [
      [57, 80],
      [57, 73],
      [54, 64],
      [54, 55],
      [52, 48],
      [48, 45],
      [43, 46],
      [41, 51],
      [43, 56],
      [48, 58],
      [54, 63],
      [57, 73],
      [57, 80],
    ],
  };
  s.vehicleReference = {
    length: 8,
    width: 2.5,
    note: 'Vehículo ilustrativo de referencia; no es un cálculo de barrido.',
  };
  s.entrances.forEach((g) => {
    g.phases = {
      setup: g.id === 'gate-technical' ? 'vehicles' : 'closed',
      event: g.role || 'both',
      strike: g.id === 'gate-technical' ? 'vehicles' : 'closed',
    };
    if (g.id === 'gate-technical') g.clearWidth = 4.5;
  });
  return s;
}

/**
 * Replaces default flows with a branched pedestrian circulation spine.
 *
 * @param s - Scene to update.
 * @returns Updated scene.
 */
export function branchPreset(s: Scene): Scene {
  const known = new Set(['flow-market', 'flow-stage', 'flow-east']);
  s.flows = (s.flows || []).filter((o) => !known.has(o.id || ''));
  s.flows.push(
    {
      id: 'branch-spine',
      name: 'Eje central · tronco',
      width: 4,
      points: [
        [41, 68],
        [41, 58],
        [41, 50],
        [41, 41],
        [41, 32],
        [46, 28],
      ],
    },
    {
      id: 'branch-market',
      name: 'Mercado · ramal de entrada',
      width: 3,
      points: [
        [29, 39],
        [35, 41],
        [41, 41],
      ],
    },
    {
      id: 'branch-food',
      name: 'Comedor · ramal en fila',
      width: 1,
      points: [
        [41, 50.15],
        [39.2, 50.15],
        [35, 50.15],
        [35, 44],
      ],
    },
    {
      id: 'branch-shops',
      name: 'Casetas · ramal comercial',
      width: 3,
      points: [
        [41, 41],
        [57.5, 41],
        [57.5, 49],
        [62, 49],
      ],
    },
    {
      id: 'branch-stage',
      name: 'Escenario · conexión y salida',
      width: 3,
      points: [
        [41, 58],
        [51, 58],
        [57.5, 58],
        [57.5, 49],
      ],
    },
    {
      id: 'branch-exit',
      name: 'Casco · ramal de salida',
      width: 3,
      points: [
        [51, 58],
        [51, 62],
        [47, 71],
      ],
    }
  );
  s.corridors = s.flows.map((o) => structuredClone(o));
  return s;
}

/**
 * Snaps a point in percentage coordinates to the closest flow branch within tolerance.
 *
 * @param p - Point `{x, y}` in percentages.
 * @param flows - Array of flow polylines.
 * @param m - Venue map metadata.
 * @param tolerance - Snap tolerance in meters (defaults to `1.4`).
 * @returns Snapped `{x, y}` in percentages.
 */
export function snapBranch(
  p: {x: number; y: number},
  flows: PolygonElement[] | undefined,
  m: VenueMap,
  tolerance = 1.4
): {x: number; y: number} {
  let best = p;
  let distance = tolerance;
  for (const f of flows || []) {
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1].map(
        (v, j) => (v * (j ? m.heightMeters : m.widthMeters)) / 100
      );
      const b = f.points[i].map(
        (v, j) => (v * (j ? m.heightMeters : m.widthMeters)) / 100
      );
      const q = [(p.x * m.widthMeters) / 100, (p.y * m.heightMeters) / 100];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)
        )
      );
      const x = a[0] + t * dx;
      const y = a[1] + t * dy;
      const d = Math.hypot(q[0] - x, q[1] - y);
      if (d < distance) {
        best = {x: (x / m.widthMeters) * 100, y: (y / m.heightMeters) * 100};
        distance = d;
      }
    }
  }
  return best;
}

/**
 * Builds the "Noche abierta · Plaza del Cristo" example scene.
 *
 * @returns Configured `Scene`.
 */
export function nightExample(): Scene {
  const b = defaults();
  Object.assign(b, {
    site: 'cristo',
    hours: 6,
    days: 1,
    start: 17,
    arrivals: 280,
    stay: 65,
    weather: 'cloud',
    circulation: 25,
    space: 2,
    availability: 85,
    ticket: 14,
    conversion: 55,
    margin: 55,
    organizerFixed: 1600,
    organizerHourly: 55,
    funding: 3400,
    rent: 'free',
  });
  const modules: Array<
    [
      'stage' | 'commerce' | 'food' | 'workshop' | 'rest',
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  > = [
    ['stage', 'Escenario principal', 54, 69, 14, 8, 72, 18, 2, 6],
    ['commerce', 'Artesanía', 34, 36, 4, 3, 3, 3, 0, 6],
    ['commerce', 'Librería', 39.2, 36, 4, 3, 3, 3, 0, 6],
    ['commerce', 'Diseño canario', 44.4, 36, 4, 3, 3, 3, 0, 6],
    ['commerce', 'Juegos canarios', 49.6, 36, 4, 3, 3, 3, 0, 6],
    ['commerce', 'Moda', 54.8, 36, 4, 3, 3, 3, 0, 6],
    ['commerce', 'Producto local', 60, 36, 4, 3, 3, 3, 0, 6],
    ['food', 'Hamburguesas', 30, 44, 4, 3, 4, 3, 0, 6],
    ['food', 'Arepas', 30, 49.8, 4, 3, 4, 3, 0, 6],
    ['food', 'Pizza', 30, 55.6, 4, 3, 4, 3, 0, 6],
    ['food', 'Dulces', 30, 61.4, 4, 3, 4, 3, 0, 6],
    ['workshop', 'Juego tradicional', 38, 62.5, 6, 5, 12, 15, 0, 6],
    ['workshop', 'Oficios en vivo', 44, 62.5, 6, 5, 12, 15, 0, 6],
    ['rest', 'Público sentado', 49, 53, 12, 6, 24, 12, 0, 6],
    ['stage', 'Música acústica', 59, 43, 5, 4, 20, 10, 0, 3],
  ];
  b.booths = modules.map(
    ([type, name, x, y, width, depth, capacity, time, open, close], i) => ({
      ...booth(type, i),
      id: 'night-' + i,
      name,
      x,
      y,
      width,
      depth,
      area: width * depth,
      rotation: 0,
      facing: i === 0 ? 270 : type === 'food' ? 0 : 90,
      labCapacity: capacity,
      labTime: time,
      open,
      close,
      price: type === 'food' ? 14 : type === 'commerce' ? 18 : 0,
      interest: 1,
      covered: false,
      ...(type === 'stage'
        ? {
            sound: {
              enabled: true,
              spl: i === 0 ? 83 : 65,
              reference: 5,
              angle: i === 0 ? 240 : 200,
            },
          }
        : {}),
    })
  );
  const s = createLab(b);
  s.presetRevision = 12;
  s.eventDate = '2026-11-28';
  s.title = 'Noche abierta · Plaza del Cristo';
  s.inspiration =
    'Propuesta ficticia, no montaje municipal. Cuatro foodtrucks de 4 × 3 m toman como referencia la convocatoria municipal de 2025. Sectores comerciales, programa, costes y asistencia son hipótesis; ningún comercio está confirmado. Escenario próximo al extremo de Nava y Grimón, ubicación aproximada pendiente del plano de montaje.';
  s.entrances = [
    {id: 'entry-market', name: 'ENTRADA · Mercado', x: 29, y: 39, role: 'in'},
    {id: 'entry-south', name: 'ENTRADA · Casco', x: 41, y: 68, role: 'in'},
    {id: 'exit-south', name: 'SALIDA · Casco', x: 47, y: 71, role: 'out'},
    {id: 'exit-east', name: 'SALIDA · Lateral', x: 62, y: 49, role: 'out'},
  ];
  const cover = (
    id: string,
    name: string,
    x: number,
    y: number,
    width: number,
    depth: number,
    rotation: number,
    capacity: number,
    cost: number
  ) => ({
    id,
    name,
    kind: 'tent',
    role: 'cover' as const,
    x,
    y,
    width,
    depth,
    rotation,
    capacity,
    cost,
  });
  s.infrastructure = [
    cover('tent-stage', 'Cubierta del escenario', 54, 69, 18, 12, 0, 80, 180),
    cover('tent-commerce-a', 'Comercio cubierto · oeste', 39.2, 37, 31, 10, 0, 24, 150),
    cover('tent-commerce-b', 'Comercio cubierto · este', 54.8, 37, 31, 10, 0, 24, 130),
    cover('tent-workshops', 'Talleres cubiertos', 41, 62.5, 25, 12, 0, 28, 150),
    cover('tent-tables', 'Cubierta de público sentado', 49, 53, 16, 22, 0, 24, 190),
  ];
  s.fences = [
    {
      id: 'fence-stage-a',
      name: 'Frente de escenario · tramo A',
      points: [
        [49.5, 65.5],
        [52, 65.5],
      ],
    },
    {
      id: 'fence-stage-b',
      name: 'Frente de escenario · tramo B',
      points: [
        [54, 65.5],
        [57, 65.5],
      ],
    },
    ...[
      [30, 44],
      [30, 49.8],
      [30, 55.6],
      [30, 61.4],
    ].flatMap(([x, y], i) =>
      [-1, 1].map((side, j) => ({
        id: 'queue-' + i + '-' + j,
        name: 'Guía de cola · foodtruck ' + (i + 1),
        points: [
          [x + 1.5, y + side * 1.6],
          [x + 4, y + side * 1.6],
        ] as Point[],
      }))
    ),
    {
      id: 'fence-service',
      name: 'Separación técnica · escenario',
      points: [
        [59, 67],
        [59, 63],
        [59, 59],
      ],
    },
  ];
  s.entrances.forEach((e, i) => {
    e.clearWidth = i === 0 ? 4 : 3;
    e.phases = {
      setup: i === 0 ? 'vehicles' : 'closed',
      event: e.role || 'both',
      strike: i === 0 ? 'vehicles' : 'closed',
    };
  });
  s.entrances.push({
    id: 'gate-technical',
    name: 'Acceso técnico · Nava',
    x: 57,
    y: 73,
    clearWidth: 4,
    phases: {setup: 'vehicles', event: 'closed', strike: 'vehicles'},
    role: 'closed',
  });
  s.corridors = [
    {
      name: 'Paso público · mantener libre',
      width: 4,
      points: [
        [29, 38],
        [35, 40],
        [41, 43],
        [43, 48],
        [40, 56],
        [39, 60],
        [40, 66],
      ],
    },
    {
      name: 'Conexión lateral · mantener libre',
      width: 3,
      points: [
        [55, 41],
        [56, 47],
        [56, 55],
        [55, 60],
      ],
    },
  ];
  s.serviceRoute = {
    name: 'Reposición antes de abrir · sin público',
    points: [
      [57, 80],
      [60, 70],
      [64, 57],
    ],
  };
  return applyOperationalPreset(s);
}

/**
 * Builds the "Navidad en el Cristo · mercado abierto" example preset.
 *
 * @returns Configured `Scene`.
 */
export function christmasExample(): Scene {
  const s = nightExample();
  s.title = 'Navidad en el Cristo · mercado abierto';
  s.eventDate = '2026-12-19';
  s.preset = 'christmas';
  s.inspiration =
    'Propuesta ficticia inspirada en la Plaza de la Navidad lagunera: casetas, artesanía, dulces, gastronomía y actuaciones. Distribución, comercios, horarios y cifras son hipótesis propias; no reproducen un montaje oficial. Referencia municipal 2025: ' +
    CHRISTMAS_SOURCE;
  s.base.start = 16;
  s.base.arrivals = 240;
  s.base.weather = 'cloud';
  s.base.exposure = 65;
  s.mix = {buyer: 30, foodie: 25, culture: 20, music: 15, walker: 10};
  const shops: Array<[string, number, number, number]> = [
    ['Artesanía canaria', 18, 3, 3],
    ['Libros e ilustración', 16, 3, 4],
    ['Juguetes y juegos', 24, 4, 4],
    ['Diseño y regalos', 20, 3, 3],
    ['Adornos navideños', 9, 3, 2],
    ['Producto local gourmet', 15, 4, 3],
  ];
  s.base.booths
    .filter((o) => o.type === 'commerce')
    .forEach((o, i) => {
      const [name, price, labCapacity, labTime] = shops[i];
      Object.assign(o, {name, price, labCapacity, labTime, sector: name});
    });
  s.base.booths = s.base.booths.filter((o) => o.name !== 'Música acústica');
  for (const [i, [name, price, labTime]] of (
    [
      ['Cerámica y belenes', 28, 4],
      ['Textil y complementos', 22, 4],
      ['Cosmética artesanal', 14, 3],
      ['Papel y envoltorios', 6, 2],
    ] as Array<[string, number, number]>
  ).entries()) {
    s.base.booths.push({
      ...booth('commerce', i),
      id: 'xmas-shop-' + i,
      name,
      sector: name,
      x: 44.4 + i * 5.2,
      y: 44,
      width: 4,
      depth: 3,
      area: 12,
      rotation: 0,
      facing: 90,
      labCapacity: 3,
      labTime,
      price,
      interest: 1,
      open: 0,
      close: 6,
    });
  }
  const foods: Array<[string, number, number, number]> = [
    ['Arepas y opción vegetal', 11, 4, 3],
    ['Pizza artesanal', 12, 4, 3],
    ['Chocolate y churros', 7, 5, 2],
    ['Dulces tradicionales', 6, 4, 2],
  ];
  s.base.booths
    .filter((o) => o.type === 'food')
    .forEach((o, i) => {
      const [name, price, labCapacity, labTime] = foods[i];
      Object.assign(o, {name, price, labCapacity, labTime});
    });
  const b11 = s.base.booths.find((o) => o.id === 'night-11');
  if (b11) b11.name = 'Taller de adornos';
  const b12 = s.base.booths.find((o) => o.id === 'night-12');
  if (b12) b12.name = 'Oficios y regalos';
  const b0 = s.base.booths.find((o) => o.id === 'night-0');
  if (b0) b0.name = 'Escenario · música y cuentos';
  s.infrastructure.push({
    id: 'xmas-cover-shops',
    name: 'Casetas de regalo · cubierta',
    kind: 'tent',
    role: 'cover',
    x: 52.2,
    y: 45,
    width: 42,
    depth: 10,
    rotation: 0,
    capacity: 30,
    cost: 180,
  });
  const flowMarket = s.flows?.find((o) => o.id === 'flow-market');
  if (flowMarket) {
    flowMarket.points = [
      [29, 39],
      [41, 41],
      [41, 55],
      [41, 68],
    ];
  }
  s.corridors = (s.flows || []).map((o) => structuredClone(o));
  s.designNotes = [
    'Dos filas de comercio con conexiones transversales abiertas.',
    'Colas gastronómicas fuera del eje central; atención distinta por negocio.',
    'Una sola fuente principal de espectáculo; sillas cubiertas separadas del escenario y de las salidas.',
    'Pasillo trasero disponible como salida, con cabinas a un lado.',
  ];
  s.collisionTolerance = 0.04;
  s.experienceRevision = 13;
  addPicnicZone(s);
  branchPreset(s);
  return s;
}

const originalChristmas = christmasExample();
const originalVega = createLab({...defaults(), site: 'vega', booths: []});

/**
 * Configures global `MAPS` and `SITES` dictionaries from georeferenced map metadata.
 *
 * @param maps - Dictionary of venue maps.
 */
export function configure(maps: Record<string, VenueMap>): void {
  for (const [key, m] of Object.entries(maps)) {
    MAPS[key] = {...m, w: m.widthMeters, h: m.heightMeters, ppm: 1, features: []};
    SITES[key] ??= {
      name: VENUES[key as VenueKey]?.name || key,
      area: 0,
      excluded: 0,
      kind: 'parque',
    };
  }
}

/**
 * Creates the initial scene for a venue (`cristo`, `constitucion`, or `vega`),
 * remapping coordinates to the calibrated georeferenced bounding box and importing OSM buildings/water.
 *
 * @param key - Venue key.
 * @param m - Georeferenced venue map.
 * @param carto - Cartographic OSM dataset.
 * @returns Initialized `Scene`.
 */
export function initialScene(
  key: VenueKey,
  m: VenueMap,
  carto: CartoData
): Scene {
  let s: Scene;
  if (key === 'cristo') {
    s = remapScene(originalChristmas, ORIGINAL.cristo, m);
  } else if (key === 'vega') {
    s = remapScene(originalVega, ORIGINAL.vega, m);
  } else {
    const park = carto.features.find((f) => f.id === '220519647');
    const boundary: Point[] = park
      ? park.points.map((p) => percent(localPoint(p, m), m))
      : [
          [20, 20],
          [80, 20],
          [80, 80],
          [20, 80],
        ];
    s = {
      ...structuredClone(originalVega),
      site: key,
      base: {...defaults(), site: key, booths: []},
      boundary,
      reserves: [],
      passages: [],
      entrances: [],
    };
  }
  s.site = key;
  s.base.site = key;
  s.title =
    key === 'cristo'
      ? 'Mercadillo de Navidad · estudio'
      : 'Estudio · ' + VENUES[key].short;
  s.base.days = 1;
  s.base.arrivals = 180;
  s.seed = 2026;
  s.annotations = [];
  s.measurements = [];
  s.roadPlans = [];
  s.meta = {version: 1, grid: 10, coordinateSystem: 'EPSG:32628'};
  if (key !== 'cristo') {
    s.base.booths = [];
    s.infrastructure = [];
    s.entrances = [];
    s.flows = [];
    s.corridors = [];
  }
  const current = new Set(s.reserves.map((o) => o.id));
  for (const f of carto.features) {
    if (!(f.tags.building || f.tags.natural === 'water')) continue;
    const points = f.points.map((p) => percent(localPoint(p, m), m));
    if (points.some((p) => inside(p, s.boundary)) && !current.has('base-' + f.id)) {
      s.reserves.push({
        id: 'base-' + f.id,
        name: f.tags.name || (f.tags.building ? 'Edificio · OSM' : 'Agua · OSM'),
        points,
        origin: 'Geometría OSM; revisar actualidad.',
      });
    }
  }
  if (key === 'cristo') {
    s.entrances = cristoAccesses(m);
    const gate =
      s.entrances.find((g) => g.phases?.setup === 'vehicles') || s.entrances[0];
    if (gate) {
      s.infrastructure.push({
        id: 'example-bin',
        kind: 'bin',
        name: 'Contenedor de ensayo',
        role: 'logistics',
        x: gate.x + (100 * 8) / m.widthMeters,
        y: gate.y + (100 * 3) / m.heightMeters,
        width: 1.5,
        depth: 1.2,
        phaseTags: ['pre', 'event', 'post'],
      });
      for (const [kind, name, offset, width, depth] of [
        ['turning', 'Maniobra · ejemplo ficticio', 6, 10, 8],
        ['loading', 'Descarga · ejemplo ficticio', 17, 8, 4],
      ] as Array<[string, string, number, number, number]>) {
        s.infrastructure.push({
          id: 'example-' + kind,
          kind,
          role: 'logistics',
          name,
          x: gate.x + (100 * offset) / m.widthMeters,
          y: gate.y,
          width,
          depth,
          rotation: 0,
          phaseTags: ['pre', 'post'],
        });
      }
    }
  }
  return s;
}

/**
 * Validates that an imported or persisted scene conforms to structural and numerical bounds.
 *
 * @param s - Scene to validate.
 * @returns Validated `Scene` (throws Error on invalid data).
 */
export function validateScene(s: Scene): Scene {
  if (!s || !VENUES[s.site as VenueKey] || !s.base || s.base.site !== s.site) {
    throw new Error('El escenario no corresponde a uno de los tres espacios.');
  }
  const validPoints = (p: unknown): p is Point[] =>
    Array.isArray(p) &&
    p.length <= 2000 &&
    p.every(
      (q) =>
        Array.isArray(q) &&
        q.length === 2 &&
        q.every(
          (v) =>
            typeof v === 'number' &&
            Number.isFinite(v) &&
            v >= -100 &&
            v <= 200
        )
    );
  if (
    !Array.isArray(s.boundary) ||
    (s.boundary.length > 0 && (!validPoints(s.boundary) || s.boundary.length < 3))
  ) {
    throw new Error('El perímetro no es válido.');
  }
  for (const a of [
    s.base.booths,
    s.infrastructure,
    s.entrances,
    s.fences,
    s.reserves,
  ]) {
    if (!Array.isArray(a) || a.length > 500) {
      throw new Error('La lista de elementos no es válida.');
    }
  }
  for (const a of [s.base.booths, s.infrastructure, s.entrances]) {
    for (const o of a) {
      if (
        typeof o.id !== 'string' ||
        typeof o.name !== 'string' ||
        !Number.isFinite(o.x) ||
        !Number.isFinite(o.y) ||
        o.x < 0 ||
        o.x > 100 ||
        o.y < 0 ||
        o.y > 100
      ) {
        throw new Error('Hay elementos con posiciones no válidas.');
      }
      const rec = o as unknown as Record<string, unknown>;
      for (const k of ['width', 'depth']) {
        if (
          rec[k] !== undefined &&
          rec[k] !== null &&
          (!Number.isFinite(Number(rec[k])) ||
            Number(rec[k]) <= 0 ||
            Number(rec[k]) > 200)
        ) {
          throw new Error('Dimensión no válida.');
        }
      }
    }
  }
  for (const e of s.entrances) {
    if (
      e.spawnType !== undefined &&
      !['pedestrian', 'vehicle', 'mixed'].includes(e.spawnType)
    ) {
      throw new Error('Tipo de acceso no válido.');
    }
    for (const k of ['entryWeight', 'exitWeight', 'maxRatePerHour'] as const) {
      const v = e[k];
      if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 100000)) {
        throw new Error('Flujo de acceso fuera de rango.');
      }
    }
  }
  for (const a of [
    s.fences,
    s.reserves,
    s.passages || [],
    s.flows || [],
    s.corridors || [],
  ]) {
    for (const o of a) {
      if (!validPoints(o.points)) {
        throw new Error('Geometría no válida.');
      }
    }
  }
  const baseRec = s.base as unknown as Record<string, unknown>;
  for (const k of [
    'arrivals',
    'hours',
    'start',
    'space',
    'circulation',
    'stay',
    'availability',
    'exposure',
  ]) {
    if (!Number.isFinite(Number(baseRec[k]))) {
      throw new Error('Parámetros de simulación incompletos.');
    }
  }
  if (
    s.base.arrivals < 0 ||
    s.base.arrivals > 3000 ||
    s.base.hours < 1 ||
    s.base.hours > 24 ||
    s.base.space <= 0 ||
    s.base.circulation < 0 ||
    s.base.circulation > 100
  ) {
    throw new Error('Parámetros fuera de rango.');
  }
  if (
    !Number.isFinite(s.diameter) ||
    s.diameter < 0.4 ||
    s.diameter > 1 ||
    !Number.isFinite(s.seed)
  ) {
    throw new Error('Configuración de peatones no válida.');
  }
  s.annotations ??= [];
  s.measurements ??= [];
  s.roadPlans ??= [];
  for (const arr of [s.annotations, s.measurements, s.roadPlans]) {
    if (!Array.isArray(arr) || arr.length > 500) {
      throw new Error('Demasiados elementos de revisión.');
    }
  }
  for (const o of s.annotations) {
    if (
      !validPoints([[o.x, o.y]]) ||
      typeof o.text !== 'string' ||
      o.text.length > 2000
    ) {
      throw new Error('Nota no válida.');
    }
  }
  for (const o of [...s.measurements, ...s.roadPlans]) {
    if (!validPoints(o.points)) {
      throw new Error('Trazado no válido.');
    }
  }
  if (s.contacts !== undefined) {
    if (!Array.isArray(s.contacts) || s.contacts.length > 500) {
      throw new Error('Lista de contactos no válida.');
    }
    for (const c of s.contacts) {
      if (
        !c ||
        typeof c !== 'object' ||
        typeof c.name !== 'string' ||
        typeof c.kind !== 'string'
      ) {
        throw new Error('Contacto no válido.');
      }
    }
  }
  if (s.customActivities !== undefined) {
    if (!Array.isArray(s.customActivities) || s.customActivities.length > 200) {
      throw new Error('Lista de actividades personalizadas no válida.');
    }
    const validNeeds = new Set(['roof', 'stage', 'tables', 'power', 'open']);
    for (const a of s.customActivities) {
      if (
        !a ||
        typeof a !== 'object' ||
        typeof a.id !== 'string' ||
        !a.id.trim() ||
        typeof a.name !== 'string' ||
        !a.name.trim() ||
        typeof a.category !== 'string' ||
        !Number.isFinite(a.minutes) ||
        a.minutes < 5 ||
        a.minutes > 600 ||
        !Number.isFinite(a.cost) ||
        a.cost < 0 ||
        a.cost > 200000 ||
        !Number.isFinite(a.places) ||
        a.places < 1 ||
        a.places > 5000 ||
        !Number.isFinite(a.area) ||
        a.area < 1 ||
        a.area > 5000 ||
        !validNeeds.has(a.need)
      ) {
        throw new Error('Actividad personalizada no válida.');
      }
    }
  }
  if (s.activityContacts !== undefined) {
    if (
      !s.activityContacts ||
      typeof s.activityContacts !== 'object' ||
      Array.isArray(s.activityContacts)
    ) {
      throw new Error('Asociación de contactos no válida.');
    }
    for (const [k, v] of Object.entries(s.activityContacts)) {
      if (typeof k !== 'string' || typeof v !== 'string') {
        throw new Error('Asociación de contactos no válida.');
      }
    }
  }
  if (s.contactKinds !== undefined) {
    if (
      !Array.isArray(s.contactKinds) ||
      s.contactKinds.length > 100 ||
      s.contactKinds.some((k) => typeof k !== 'string')
    ) {
      throw new Error('Tipos de actividad de contactos no válidos.');
    }
  }
  if (s.subsoil !== undefined) {
    const sub = s.subsoil;
    if (
      !sub ||
      typeof sub !== 'object' ||
      !Array.isArray(sub.polygons) ||
      !Array.isArray(sub.columns) ||
      !Array.isArray(sub.walls)
    ) {
      throw new Error('Estructura de subsuelo no válida.');
    }
    if (
      sub.polygons.length > 200 ||
      sub.columns.length > 500 ||
      sub.walls.length > 500
    ) {
      throw new Error('Demasiados elementos en el subsuelo.');
    }
    for (const poly of sub.polygons) {
      if (
        typeof poly.id !== 'string' ||
        (poly.op !== 'add' && poly.op !== 'subtract') ||
        !validPoints(poly.points) ||
        poly.points.length < 3
      ) {
        throw new Error('Polígono de subsuelo no válido.');
      }
    }
    for (const col of sub.columns) {
      if (
        typeof col.id !== 'string' ||
        typeof col.name !== 'string' ||
        !Number.isFinite(col.x) ||
        !Number.isFinite(col.y) ||
        col.x < 0 ||
        col.x > 100 ||
        col.y < 0 ||
        col.y > 100 ||
        !Number.isFinite(col.diameter) ||
        col.diameter <= 0 ||
        col.diameter > 50 ||
        !Number.isFinite(col.influenceRadius) ||
        col.influenceRadius < 0 ||
        col.influenceRadius > 100
      ) {
        throw new Error('Columna de subsuelo no válida.');
      }
    }
    for (const wall of sub.walls) {
      if (
        typeof wall.id !== 'string' ||
        typeof wall.name !== 'string' ||
        !validPoints([wall.a, wall.b]) ||
        !Number.isFinite(wall.thickness) ||
        wall.thickness <= 0 ||
        wall.thickness > 50 ||
        !Number.isFinite(wall.influenceDepth) ||
        wall.influenceDepth < 0 ||
        wall.influenceDepth > 100
      ) {
        throw new Error('Muro de carga de subsuelo no válido.');
      }
    }
  }
  return s;
}
