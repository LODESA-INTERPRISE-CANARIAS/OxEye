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
  /** Colores del emblema Ojo de Buey adaptados a la paleta. */
  logo: {
    bg: string;
    eye: string;
    pupil: string;
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
    logo: {bg: '#4b2665', eye: '#e4d4f7', pupil: '#4b2665'},
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
    logo: {bg: '#167A9B', eye: '#E3F4F9', pupil: '#102936'},
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
    logo: {bg: '#1B2836', eye: '#52B6E5', pupil: '#111820'},
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
    logo: {bg: '#446853', eye: '#F3F0E8', pupil: '#28342F'},
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
    logo: {bg: '#B56838', eye: '#F4EAE2', pupil: '#20262C'},
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
    logo: {bg: '#111317', eye: '#00BDEB', pupil: '#111317'},
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

/** Devuelve los colores del emblema Ojo de Buey para una paleta dada. */
export function getPaletteLogoColors(
  palette: PaletteId
): ColorPaletteDefinition['logo'] {
  const id = normalizePaletteId(palette);
  return (COLOR_PALETTES.find((p) => p.id === id) || COLOR_PALETTES[0]).logo;
}

/** Aplica la paleta seleccionada al elemento raíz del documento (`data-palette`) y actualiza el favicon. */
export function applyPalette(palette: PaletteId): void {
  if (typeof document === 'undefined') return;
  const id = normalizePaletteId(palette);
  document.documentElement.dataset.palette = id;
  const logo = getPaletteLogoColors(id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="19" fill="${logo.bg}"/><path d="M9 32Q32 6 55 32Q32 58 9 32Z" fill="none" stroke="${logo.eye}" stroke-width="3"/><circle cx="32" cy="32" r="11" fill="${logo.eye}"/><circle cx="32" cy="32" r="4" fill="${logo.pupil}"/></svg>`;
  const iconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (iconEl) {
    iconEl.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}
