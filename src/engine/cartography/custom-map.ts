/**
 * @module engine/cartography/custom-map
 * Proyección métrica local, cálculo de teselas cartográficas (OSM / satélite),
 * búsqueda de direcciones (Nominatim) y extracción de vías reales (Overpass)
 * para emplazamientos personalizados elegidos directamente sobre un mapa real.
 */
import type {
  BaseMapMode,
  CustomLocationConfig,
  CustomMapFeature,
  CustomMapStreet,
  MapMetadata,
  Point2D,
} from '../../types';

const EARTH_RADIUS = 6378137;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_MERCATOR_LAT = 85.05112878;

/** Centro por defecto sobre la Plaza del Cristo (San Cristóbal de La Laguna). */
export const DEFAULT_MAP_CENTER = {
  lat: 28.4903,
  lon: -16.3133,
  label: 'Plaza del Cristo, San Cristóbal de La Laguna',
  sizeMeters: 400,
};

/** Resultado simplificado de búsqueda por dirección. */
export interface AddressSearchResult {
  label: string;
  lat: number;
  lon: number;
}

/** Tesela cartográfica proyectada en metros locales dentro del SVG. */
export interface ProjectedMapTile {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  tx: number;
  ty: number;
}

/**
 * Restringe una latitud al rango válido de Web Mercator.
 */
export function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

/**
 * Convierte coordenadas geográficas WGS84 `(lat, lon)` a metros Web Mercator (EPSG:3857).
 */
export function latLonToMercator(lat: number, lon: number): Point2D {
  const phi = clampLat(lat) * DEG2RAD;
  const x = EARTH_RADIUS * lon * DEG2RAD;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2));
  return [x, y];
}

/**
 * Convierte coordenadas Web Mercator (EPSG:3857) a WGS84 `(lat, lon)`.
 */
export function mercatorToLatLon(
  mx: number,
  my: number
): {lat: number; lon: number} {
  const lon = (mx / EARTH_RADIUS) * RAD2DEG;
  const lat = (2 * Math.atan(Math.exp(my / EARTH_RADIUS)) - Math.PI / 2) * RAD2DEG;
  return {lat, lon};
}

/**
 * Factor de escala métrica en superficie a una latitud dada (`cos(lat)`).
 */
export function mercatorScaleAt(lat: number): number {
  return Math.max(0.05, Math.cos(clampLat(lat) * DEG2RAD));
}

/**
 * Proyecta un punto WGS84 `(lat, lon)` a coordenadas locales en metros `[x, y]`
 * dentro del cuadrado operativo `[0, sizeMeters] × [0, sizeMeters]`,
 * donde el centro `(centerLat, centerLon)` queda en `(sizeMeters / 2, sizeMeters / 2)`
 * y el eje `+y` apunta hacia el sur (convención del visor SVG de OxEye).
 */
export function latLonToLocalMeters(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number
): Point2D {
  const [cx, cy] = latLonToMercator(centerLat, centerLon);
  const [px, py] = latLonToMercator(lat, lon);
  const scale = mercatorScaleAt(centerLat);
  const half = sizeMeters / 2;
  const dx = (px - cx) * scale;
  const dy = (cy - py) * scale;
  return [half + dx, half + dy];
}

/**
 * Convierte una coordenada local en metros `[x, y]` dentro del cuadrado operativo a WGS84.
 */
export function localMetersToLatLon(
  x: number,
  y: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number
): {lat: number; lon: number} {
  const [cx, cy] = latLonToMercator(centerLat, centerLon);
  const scale = mercatorScaleAt(centerLat);
  const half = sizeMeters / 2;
  const mx = cx + (x - half) / scale;
  const my = cy - (y - half) / scale;
  return mercatorToLatLon(mx, my);
}

/**
 * Devuelve los límites geográficos WGS84 `[south, west, north, east]` del cuadrado operativo.
 */
export function customAreaBounds(
  lat: number,
  lon: number,
  sizeMeters: number
): {south: number; west: number; north: number; east: number} {
  const nw = localMetersToLatLon(0, 0, lat, lon, sizeMeters);
  const se = localMetersToLatLon(sizeMeters, sizeMeters, lat, lon, sizeMeters);
  return {
    south: se.lat,
    west: nw.lon,
    north: nw.lat,
    east: se.lon,
  };
}

/**
 * Construye el objeto `MapMetadata` compatible con el motor de OxEye para un emplazamiento personalizado.
 */
export function buildCustomMapMetadata(
  config: CustomLocationConfig
): MapMetadata {
  const size = Math.max(150, Math.min(1000, Math.round(config.sizeMeters || 400)));
  const lat = clampLat(config.lat);
  const lon = Math.max(-180, Math.min(180, config.lon));
  const [cx, cy] = latLonToMercator(lat, lon);
  const scale = mercatorScaleAt(lat);
  const centerE = Math.round(cx * scale);
  const centerN = Math.round(cy * scale);
  const half = size / 2;

  const normalized: CustomLocationConfig = {
    lat,
    lon,
    label: (config.label || '').trim() || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    sizeMeters: size,
    streets: config.streets ? structuredClone(config.streets) : [],
    features: config.features ? structuredClone(config.features) : [],
  };

  return {
    bbox: [centerE - half, centerN - half, centerE + half, centerN + half],
    widthMeters: size,
    heightMeters: size,
    source: `custom:${lat.toFixed(6)},${lon.toFixed(6)}:${size}`,
    crs: 'WGS84 / Local Metric',
    resolution: 0.25,
    retrieved: new Date().toISOString().slice(0, 10),
    flightDate: isInsideSpain(lat, lon) ? 'PNOA–IGN en línea' : 'Teselas en línea',
    attribution: isInsideSpain(lat, lon)
      ? '© OpenStreetMap contributors · PNOA–IGN'
      : '© OpenStreetMap contributors · Esri World Imagery',
    customLocation: normalized,
  };
}

/** Convierte `(lat, lon, z)` a índices fraccionales de tesela slippy-map. */
export function latLonToTileFloat(
  lat: number,
  lon: number,
  z: number
): [number, number] {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const rad = clampLat(lat) * DEG2RAD;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Convierte índices enteros de esquina NW de tesela `(tx, ty, z)` a WGS84 `(lat, lon)`. */
export function tileToLatLon(
  tx: number,
  ty: number,
  z: number
): {lat: number; lon: number} {
  const n = 2 ** z;
  const lon = (tx / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  return {lat: latRad * RAD2DEG, lon};
}

/**
 * Comprueba si las coordenadas caen dentro de la cobertura de PNOA–IGN
 * (Península, Baleares, Ceuta, Melilla e Islas Canarias).
 */
export function isInsideSpain(lat: number, lon: number): boolean {
  const mainlandAndBalearics =
    lat >= 35.1 && lat <= 43.9 && lon >= -9.5 && lon <= 4.5;
  const canaries =
    lat >= 27.5 && lat <= 29.6 && lon >= -18.3 && lon <= -13.3;
  return mainlandAndBalearics || canaries;
}

/**
 * URL pública de una tesela cartográfica (plano OSM, ortofoto PNOA–IGN de alta resolución
 * dentro de España o imagen satelital Esri World Imagery en el resto del mundo).
 */
export function tileUrl(
  z: number,
  tx: number,
  ty: number,
  mode: BaseMapMode,
  usePnoa = false
): string {
  if (mode === 'ortho') {
    if (usePnoa) {
      return (
        'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=OI.OrthoimageCoverage&STYLE=default&FORMAT=image/jpeg' +
        `&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX=${z}&TILEROW=${ty}&TILECOL=${tx}`
      );
    }
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
  }
  return `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
}

/**
 * Calcula el conjunto de teselas cartográficas que cubren el cuadrado operativo
 * con sus coordenadas exactas en metros locales para renderizarlas dentro de `<svg>`.
 *
 * En modo `ortho` utiliza un nivel de zoom alto (z19–z20 en zonas ≤ 550 m, z18 hasta 1000 m)
 * y ortofotografía PNOA–IGN en España para ofrecer nitidez equivalente a los recintos base (~0,15–0,26 m/px).
 */
export function computeMapTiles(
  lat: number,
  lon: number,
  sizeMeters: number,
  mode: BaseMapMode
): ProjectedMapTile[] {
  const usePnoa = mode === 'ortho' && isInsideSpain(lat, lon);
  const z =
    mode === 'ortho'
      ? sizeMeters <= 250
        ? usePnoa
          ? 20
          : 19
        : sizeMeters <= 550
          ? 19
          : 18
      : sizeMeters <= 320
        ? 18
        : sizeMeters <= 700
          ? 17
          : 16;
  const bounds = customAreaBounds(lat, lon, sizeMeters);
  const [xMinF, yMinF] = latLonToTileFloat(bounds.north, bounds.west, z);
  const [xMaxF, yMaxF] = latLonToTileFloat(bounds.south, bounds.east, z);
  const maxIdx = 2 ** z - 1;
  const txMin = Math.max(0, Math.floor(xMinF));
  const txMax = Math.min(maxIdx, Math.floor(xMaxF));
  const tyMin = Math.max(0, Math.floor(yMinF));
  const tyMax = Math.min(maxIdx, Math.floor(yMaxF));

  const tiles: ProjectedMapTile[] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const nw = tileToLatLon(tx, ty, z);
      const se = tileToLatLon(tx + 1, ty + 1, z);
      const p0 = latLonToLocalMeters(nw.lat, nw.lon, lat, lon, sizeMeters);
      const p1 = latLonToLocalMeters(se.lat, se.lon, lat, lon, sizeMeters);
      tiles.push({
        url: tileUrl(z, tx, ty, mode, usePnoa),
        x: p0[0],
        y: p0[1],
        width: p1[0] - p0[0],
        height: p1[1] - p0[1],
        z,
        tx,
        ty,
      });
    }
  }
  return tiles;
}

/**
 * Clasifica una etiqueta `highway` de OpenStreetMap en vía peatonal o vehicular.
 */
export function classifyOsmHighway(
  highway: string
): 'pedestrian' | 'vehicle' | null {
  const h = (highway || '').toLowerCase();
  if (
    [
      'footway',
      'pedestrian',
      'path',
      'steps',
      'cycleway',
      'living_street',
      'track',
    ].includes(h)
  ) {
    return 'pedestrian';
  }
  if (
    [
      'motorway',
      'trunk',
      'primary',
      'secondary',
      'tertiary',
      'unclassified',
      'residential',
      'service',
      'road',
      'primary_link',
      'secondary_link',
      'tertiary_link',
    ].includes(h)
  ) {
    return 'vehicle';
  }
  return null;
}

/**
 * Busca direcciones reales mediante el servicio abierto Nominatim de OpenStreetMap.
 */
export async function searchAddress(
  query: string,
  signal?: AbortSignal
): Promise<AddressSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, {
    signal,
    headers: {Accept: 'application/json', 'Accept-Language': 'es'},
  });
  if (!res.ok) {
    throw new Error('No se pudo consultar el buscador de direcciones.');
  }
  const rows = (await res.json()) as Array<{
    display_name?: string;
    lat?: string;
    lon?: string;
  }>;
  return rows
    .map((r) => ({
      label: r.display_name || q,
      lat: Number(r.lat),
      lon: Number(r.lon),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

const KEPT_OSM_TAGS = [
  'highway',
  'name',
  'building',
  'leisure',
  'landuse',
  'natural',
  'area',
  'place',
] as const;

const ALLOWED_LEISURE = new Set([
  'park',
  'garden',
  'pitch',
  'track',
  'playground',
]);
const ALLOWED_LANDUSE = new Set(['grass', 'forest', 'meadow']);
const ALLOWED_NATURAL = new Set(['water', 'wood']);

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Elemento crudo devuelto por OpenStreetMap API v0.6 o Overpass API. */
export interface RawOsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/**
 * Convierte elementos crudos de OpenStreetMap (nodos + vías) en capas vectoriales
 * limpias en metros locales (sin comercios, paradas ni iconos) y en vías estructuradas
 * para detección de spawns.
 */
export function parseOsmVectorElements(
  elements: RawOsmElement[],
  lat: number,
  lon: number,
  sizeMeters: number
): {streets: CustomMapStreet[]; features: CustomMapFeature[]} {
  const nodes = new Map<number, Point2D>();
  for (const el of elements) {
    if (
      el.type === 'node' &&
      Number.isFinite(el.lat) &&
      Number.isFinite(el.lon)
    ) {
      const [lx, ly] = latLonToLocalMeters(
        el.lat!,
        el.lon!,
        lat,
        lon,
        sizeMeters
      );
      nodes.set(el.id, [round1(lx), round1(ly)]);
    }
  }

  const margin = 45;
  const features: CustomMapFeature[] = [];
  const streets: CustomMapStreet[] = [];

  for (const el of elements) {
    if (el.type !== 'way' || !el.nodes?.length || !el.tags) continue;
    const t = el.tags;
    const isVisual =
      !!t.highway ||
      !!t.building ||
      (!!t.leisure && ALLOWED_LEISURE.has(t.leisure)) ||
      (!!t.landuse && ALLOWED_LANDUSE.has(t.landuse)) ||
      (!!t.natural && ALLOWED_NATURAL.has(t.natural)) ||
      t.place === 'square';
    if (!isVisual) continue;

    const pts = el.nodes
      .map((nid) => nodes.get(nid))
      .filter((p): p is Point2D => !!p);
    if (pts.length < 2) continue;

    // Descarta geometrías totalmente fuera del cuadrado operativo + margen
    const touchesArea = pts.some(
      ([x, y]) =>
        x >= -margin &&
        y >= -margin &&
        x <= sizeMeters + margin &&
        y <= sizeMeters + margin
    );
    if (!touchesArea) continue;

    const cleanTags: Record<string, string> = {};
    for (const k of KEPT_OSM_TAGS) {
      if (t[k]) cleanTags[k] = t[k];
    }

    features.push({
      id: 'way/' + el.id,
      tags: cleanTags,
      points: pts,
    });

    if (cleanTags.highway && cleanTags.area !== 'yes') {
      const kind = classifyOsmHighway(cleanTags.highway);
      if (kind) {
        streets.push({
          name: cleanTags.name || '',
          highway: cleanTags.highway,
          kind,
          points: pts,
        });
      }
    }
  }

  return {
    streets: streets.slice(0, 260),
    features: features.slice(0, 1200),
  };
}

/**
 * Descarga las capas vectoriales limpias de OpenStreetMap (vías, edificios, plazas,
 * zonas verdes, pistas y agua) dentro del cuadrado operativo.
 *
 * Usa primero la API oficial de OpenStreetMap v0.6 (`/api/0.6/map.json`, ~0,5–1 s y CORS
 * habilitado) y recurre a servidores Overpass como respaldo si fuera necesario.
 */
export async function fetchOsmVectorContext(
  lat: number,
  lon: number,
  sizeMeters: number,
  timeoutMs = 9000
): Promise<{streets: CustomMapStreet[]; features: CustomMapFeature[]}> {
  // Margen exterior de +35 m por lado para que edificios y calles del borde no queden cortados antes del clip SVG
  const bounds = customAreaBounds(lat, lon, sizeMeters + 70);

  // 1. Fuente principal: OpenStreetMap API v0.6 (rápida, fiable y con CORS)
  {
    const osmBbox = `${bounds.west.toFixed(6)},${bounds.south.toFixed(6)},${bounds.east.toFixed(6)},${bounds.north.toFixed(6)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://api.openstreetmap.org/api/0.6/map.json?bbox=${osmBbox}`,
        {
          headers: {Accept: 'application/json'},
          signal: controller.signal,
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {elements?: RawOsmElement[]};
        const parsed = parseOsmVectorElements(
          data.elements || [],
          lat,
          lon,
          sizeMeters
        );
        if (parsed.features.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback a Overpass API
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Respaldo: Overpass API (en caso de fallo temporal de api.openstreetmap.org)
  const bboxStr = `${bounds.south.toFixed(6)},${bounds.west.toFixed(6)},${bounds.north.toFixed(6)},${bounds.east.toFixed(6)}`;
  const ql =
    '[out:json][timeout:6];(' +
    `way["highway"](${bboxStr});` +
    `way["building"](${bboxStr});` +
    `way["leisure"~"^(park|garden|pitch|track|playground)$"](${bboxStr});` +
    `way["landuse"~"^(grass|forest|meadow)$"](${bboxStr});` +
    `way["natural"~"^(water|wood)$"](${bboxStr});` +
    ');out body;>;out skel qt;';

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 6000));
    try {
      const res = await fetch(
        `${endpoint}?data=${encodeURIComponent(ql)}`,
        {
          headers: {Accept: 'application/json'},
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {elements?: RawOsmElement[]};
      const parsed = parseOsmVectorElements(
        data.elements || [],
        lat,
        lon,
        sizeMeters
      );
      if (parsed.features.length > 0) {
        return parsed;
      }
    } catch {
      // Try next Overpass mirror
    } finally {
      clearTimeout(timer);
    }
  }
  return {streets: [], features: []};
}

/**
 * Descarga las vías reales (calles, avenidas, pasos peatonales) de OpenStreetMap
 * dentro del cuadrado operativo mediante Overpass API.
 */
export async function fetchOsmStreets(
  lat: number,
  lon: number,
  sizeMeters: number,
  timeoutMs = 4000
): Promise<CustomMapStreet[]> {
  const {streets} = await fetchOsmVectorContext(lat, lon, sizeMeters, timeoutMs);
  return streets;
}
