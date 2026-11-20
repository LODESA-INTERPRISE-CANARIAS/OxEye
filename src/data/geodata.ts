/**
 * @module data/geodata
 * Exporta los metadatos de mapas, la cartografía OpenStreetMap y las rutas de ortofotos PNOA.
 */
import mapsJson from './json/maps.json';
import cartoJson from './json/carto.json';
import type {CartoData, MapMetadata, VenueKey} from '../types';

/** Metadatos georreferenciados (UTM 28N · EPSG:32628) de los tres recintos. */
export const MAPS_DATA = mapsJson as unknown as Record<VenueKey, MapMetadata>;

/** Geometrías vectoriales de OpenStreetMap para el término de estudio en La Laguna. */
export const CARTO_DATA = cartoJson as unknown as CartoData;

const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');

/** Rutas públicas a las ortofotografías PNOA-IGN de cada recinto. */
export const ORTHO_IMAGES: Record<VenueKey, string> = {
  cristo: `${BASE_URL}assets/ortho/cristo.jpg`,
  constitucion: `${BASE_URL}assets/ortho/constitucion.jpg`,
  vega: `${BASE_URL}assets/ortho/vega.jpg`,
};
