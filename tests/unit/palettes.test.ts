import {describe, expect, it} from 'vitest';
import {
  COLOR_PALETTES,
  DEFAULT_PALETTE_ID,
  normalizePaletteId,
} from '../../src/data/palettes';

describe('Paletas de color predefinidas', () => {
  it('incluye exactamente las 6 paletas oficiales con sus colores exactos', () => {
    expect(COLOR_PALETTES.map((p) => `${p.code} · ${p.name}`)).toEqual([
      '01 · OxEye',
      '02 · Atlas',
      '03 · Noctis',
      '04 · Territorio',
      '05 · Vector',
      '06 · Bendy',
    ]);

    const byId = Object.fromEntries(COLOR_PALETTES.map((p) => [p.id, p]));
    expect(byId.oxeye.colors).toEqual({
      background: '#F7F6FA',
      surface: '#E7E3EF',
      text: '#24202C',
      accent: '#57367B',
      secondary: '#B59AD5',
      shadow: '#21172F',
    });
    expect(byId.atlas.colors).toEqual({
      background: '#F2F6F8',
      surface: '#DCE7EC',
      text: '#172E3C',
      accent: '#167A9B',
      secondary: '#87C8D9',
      shadow: '#102936',
    });
    expect(byId.noctis.colors).toEqual({
      background: '#111820',
      surface: '#222D39',
      text: '#F0F4F7',
      accent: '#52B6E5',
      secondary: '#9AA9BC',
      shadow: '#080D14',
    });
    expect(byId.territorio.colors).toEqual({
      background: '#F3F0E8',
      surface: '#DED8C9',
      text: '#28342F',
      accent: '#557B65',
      secondary: '#B79C71',
      shadow: '#242C25',
    });
    expect(byId.vector.colors).toEqual({
      background: '#EDEFF0',
      surface: '#CFD4D7',
      text: '#20262C',
      accent: '#B56838',
      secondary: '#82949F',
      shadow: '#161C21',
    });
    expect(byId.bendy.colors).toEqual({
      background: '#FFFFFF',
      surface: '#E9EDF0',
      text: '#111317',
      accent: '#00BDEB',
      secondary: '#FFE500',
      shadow: '#151A23',
    });
  });

  it('normaliza identificadores desconocidos a la paleta base oxeye', () => {
    expect(DEFAULT_PALETTE_ID).toBe('oxeye');
    expect(normalizePaletteId('noctis')).toBe('noctis');
    expect(normalizePaletteId('bendy')).toBe('bendy');
    expect(normalizePaletteId('custom')).toBe('oxeye');
    expect(normalizePaletteId(undefined)).toBe('oxeye');
    expect(normalizePaletteId(null)).toBe('oxeye');
  });
});
