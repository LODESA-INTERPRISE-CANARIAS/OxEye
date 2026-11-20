/**
 * @module data/venue-maps
 * Configuración histórica de mapas base para compatibilidad y remapeo de escenas.
 */
import type {MapMetadata} from '../types';

export const MAPS: Record<string, MapMetadata & Record<string, any>> = {
  cristo: {
    bbox: [
      371411.2435595065, 3152409.219365287, 371641.2435595065,
      3152579.219365287,
    ],
    widthMeters: 230,
    heightMeters: 170,
    widthPixels: 1400,
    heightPixels: 1035,
    center: [-16.312613385620974, 28.49278001575563],
    crs: 'EPSG:32628',
    source:
      'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&CRS=EPSG%3A32628&BBOX=371411.2435595065%2C3152409.219365287%2C371641.2435595065%2C3152579.219365287&WIDTH=1400&HEIGHT=1035&FORMAT=image%2Fjpeg',
    attribution: 'Ortofoto PNOA máxima actualidad · CC BY 4.0 · scne.es',
    flightDate: 'No confirmada en esta extracción',
    retrieved: '2026-11-11',
    resolution: 0.16,
    w: 1000,
    h: 739.1304347826087,
    ppm: 4.3478260869565215,
    features: [],
  },
  adelantado: {
    bbox: [
      371386.0491564248, 3151851.2448963197, 371490.0491564248,
      3151967.2448963197,
    ],
    widthMeters: 104,
    heightMeters: 116,
    widthPixels: 910,
    heightPixels: 1015,
    center: [-16.313448919536526, 28.487492346217042],
    crs: 'EPSG:32628',
    source:
      'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG%3A32628&BBOX=371354.0491564248%2C3151831.2448963197%2C371514.0491564248%2C3151991.2448963197&WIDTH=1400&HEIGHT=1400&FORMAT=image%2Fjpeg',
    attribution: 'Ortofoto PNOA máxima actualidad · CC BY 4.0 · scne.es',
    flightDate: 'No confirmada en esta extracción',
    retrieved: '2026-11-11',
    resolution: 0.11,
    w: 1000,
    h: 1115.3846153846155,
    ppm: 9.615384615384615,
    features: [],
    sourceBbox: [
      371354.0491564248, 3151831.2448963197, 371514.0491564248,
      3151991.2448963197,
    ],
    assetProcessing:
      'Recorte de la ortofoto WMS original: 32 m al oeste, 24 m al este, 24 m al norte y 20 m al sur retirados. Extensión resultante indicada en bbox.',
  },
  vega: {
    bbox: [
      371329.10604290257, 3152793.0899543352, 371629.10604290257,
      3153003.0899543352,
    ],
    widthMeters: 300,
    heightMeters: 210,
    widthPixels: 1400,
    heightPixels: 980,
    center: [-16.31314, 28.496419999999993],
    crs: 'EPSG:32628',
    source:
      'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG%3A32628&BBOX=371329.10604290257%2C3152793.0899543352%2C371629.10604290257%2C3153003.0899543352&WIDTH=1400&HEIGHT=980&FORMAT=image%2Fjpeg',
    attribution: 'Ortofoto PNOA máxima actualidad · CC BY 4.0 · scne.es',
    flightDate: 'No confirmada en esta extracción',
    retrieved: '2026-11-11',
    resolution: 0.21,
    w: 1000,
    h: 700.0,
    ppm: 3.3333333333333335,
    features: [
      {
        kind: 'park',
        name: 'Parque de La Vega Pedro González',
        points: [
          [8.966726831005266, 54.17103292309635],
          [16.194357324158773, 15.869073057547212],
          [18.442144301118486, 6.5643131309410645],
          [18.962118109998606, 6.841559129811468],
          [43.93372677452862, 20.18110851602008],
          [63.916935422826405, 30.85689207073301],
          [69.72668081919741, 34.0873105458117],
          [90.99247062772822, 45.60609612392173],
          [65.05142915109172, 93.2514195514488],
          [10.521647805600272, 67.15512781692226],
          [11.88083517254563, 61.82044764559361],
          [11.074638188370347, 58.013833896922215],
          [8.966726831005266, 54.17103292309635],
        ],
        osmId: '78904856',
      },
      {
        kind: 'track',
        name: 'Circuito BMX del Parque de La Vega',
        points: [
          [30.92064049940867, 32.93223320772605],
          [21.50113498819216, 27.671780862091556],
          [16.38827535092908, 31.87131143130717],
          [15.472528629742252, 45.34444968282644],
          [15.414096560678445, 64.04445372832318],
          [22.86747349755994, 67.40620556819653],
          [56.0452780679916, 83.85000272498776],
          [57.37860528333113, 78.47796155893731],
          [35.7438043288809, 67.41223328458588],
          [33.52126221737126, 64.0478482631789],
          [27.069977362368565, 58.089783141345144],
          [26.78182301988515, 52.68185407987662],
          [30.92064049940867, 32.93223320772605],
        ],
        osmId: '998879503',
      },
      {
        kind: 'pitch',
        name: 'SkatePark del Parque de La Vega',
        points: [
          [74.55215651365386, 50.38348236076888],
          [81.89001039939467, 54.34482172397631],
          [78.36003919522045, 67.04368352579574],
          [71.15924643992912, 63.079199368311535],
          [74.55215651365386, 50.38348236076888],
        ],
        osmId: '998879504',
      },
      {
        kind: 'pitch',
        name: 'Deporte',
        points: [
          [35.05861665518023, 40.558537796272766],
          [38.59510469749027, 42.360422382175564],
          [36.061046565029145, 52.40474870073653],
          [32.52451234081915, 50.60813734063967],
          [35.05861665518023, 40.558537796272766],
        ],
        osmId: '998879505',
      },
    ],
  },
};

export const ZONES: Record<string, Array<[string, string, number, number]>> = {
  cristo: [
    ['mercado', 'Acceso del mercado', 29, 45],
    ['norte', 'Acceso norte', 48, 28],
    ['centro', 'Explanada central', 47, 49],
    ['escenario', 'Escenario propuesto', 60, 34],
    ['sur', 'Paseo sur', 45, 71],
    ['cruce', 'Cruce peatonal este', 56, 85],
  ],
  adelantado: [
    ['norte', 'Acceso norte', 41.53846153846154, 22.06896551724138],
    ['fuente', 'Entorno de la fuente', 50.76923076923078, 49.65517241379311],
    ['este', 'Paseo este', 72.3076923076923, 51.03448275862069],
    ['sur', 'Acceso sur', 44.61538461538462, 78.62068965517241],
    ['oeste', 'Paseo oeste', 21.538461538461544, 48.275862068965516],
  ],
  vega: [
    ['pista', 'Circuito deportivo', 24, 43],
    ['oeste', 'Acceso oeste', 14, 43],
    ['central', 'Plaza circular', 60, 56],
    ['skate', 'Skatepark', 78, 57],
    ['juegos', 'Zona de juegos', 46, 43],
    ['sur', 'Paseo sur', 50, 82],
  ],
};
