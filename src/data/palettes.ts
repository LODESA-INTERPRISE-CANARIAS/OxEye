/**
 * @module data/palettes
 * Paletas de color predefinidas y no personalizables para la interfaz de Ojo de Buey (OxEye).
 */
import type {PaletteId} from '../types';

/** Definición de una paleta de color predefinida. */
export interface ColorPaletteDefinition {
  id: PaletteId;
  code: string;
  name: string;
  dark: boolean;
  /** Colores oficiales de muestra mostrados en el selector de Ajustes. */
  swatches: [string, string, string, string, string];
  /** Tokens base documentados de la paleta. */
  colors: {
    background: string;
    surface: string;
    text: string;
    accent: string;
    secondary: string;
    shadow: string;
  };
}

/** Catálogo cerrado de las 6 paletas oficiales de OxEye. */
export const COLOR_PALETTES: readonly ColorPaletteDefinition[] = [
  {
    id: 'oxeye',
    code: '01',
    name: 'Ox Eye',
    dark: false,
    swatches: ['#F7F6FA', '#E7E3EF', '#24202C', '#57367B', '#B59AD5'],
    colors: {
      background: '#F7F6FA',
      surface: '#E7E3EF',
      text: '#24202C',
      accent: '#57367B',
      secondary: '#B59AD5',
      shadow: '#21172F',
    },
  },
  {
    id: 'atlas',
    code: '02',
    name: 'Atlas',
    dark: false,
    swatches: ['#F2F6F8', '#DCE7EC', '#172E3C', '#167A9B', '#87C8D9'],
    colors: {
      background: '#F2F6F8',
      surface: '#DCE7EC',
      text: '#172E3C',
      accent: '#167A9B',
      secondary: '#87C8D9',
      shadow: '#102936',
    },
  },
  {
    id: 'noctis',
    code: '03',
    name: 'Noctis',
    dark: true,
    swatches: ['#111820', '#222D39', '#F0F4F7', '#52B6E5', '#9AA9BC'],
    colors: {
      background: '#111820',
      surface: '#222D39',
      text: '#F0F4F7',
      accent: '#52B6E5',
      secondary: '#9AA9BC',
      shadow: '#080D14',
    },
  },
  {
    id: 'territorio',
    code: '04',
    name: 'Territorio',
    dark: false,
    swatches: ['#F3F0E8', '#DED8C9', '#28342F', '#557B65', '#B79C71'],
    colors: {
      background: '#F3F0E8',
      surface: '#DED8C9',
      text: '#28342F',
      accent: '#557B65',
      secondary: '#B79C71',
      shadow: '#242C25',
    },
  },
  {
    id: 'vector',
    code: '05',
    name: 'Vector',
    dark: false,
    swatches: ['#EDEFF0', '#CFD4D7', '#20262C', '#B56838', '#82949F'],
    colors: {
      background: '#EDEFF0',
      surface: '#CFD4D7',
      text: '#20262C',
      accent: '#B56838',
      secondary: '#82949F',
      shadow: '#161C21',
    },
  },
  {
    id: 'bendy',
    code: '06',
    name: 'Bendy',
    dark: false,
    swatches: ['#FFFFFF', '#E9EDF0', '#111317', '#00BDEB', '#FFE500'],
    colors: {
      background: '#FFFFFF',
      surface: '#E9EDF0',
      text: '#111317',
      accent: '#00BDEB',
      secondary: '#FFE500',
      shadow: '#151A23',
    },
  },
] as const;

export const DEFAULT_PALETTE_ID: PaletteId = 'oxeye';

const VALID_PALETTE_IDS = new Set<string>(COLOR_PALETTES.map((p) => p.id));

/** Valida un identificador de paleta y devuelve `'oxeye'` si no pertenece al catálogo oficial. */
export function normalizePaletteId(raw: unknown): PaletteId {
  return typeof raw === 'string' && VALID_PALETTE_IDS.has(raw)
    ? (raw as PaletteId)
    : DEFAULT_PALETTE_ID;
}

/** Aplica la paleta seleccionada al elemento raíz del documento (`data-palette`). */
export function applyPalette(palette: PaletteId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.palette = normalizePaletteId(palette);
}
