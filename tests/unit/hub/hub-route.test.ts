import {describe, expect, it} from 'vitest';
import {
  hubPath,
  isCanonical,
  normalizeBase,
  parseHubPath,
  type HubRoute,
} from '../../../src/components/menu/hubRoute';

const ROUTES: [HubRoute, string][] = [
  ['home', '/'],
  ['simulator', '/simulador'],
  ['new-model', '/simulador/nuevo'],
  ['workspace', '/simulador/modelo'],
  ['settings', '/ajustes'],
  ['about', '/acerca'],
];

describe('hub routes', () => {
  it.each(ROUTES)('%s ↔ %s round-trips at the root', (route, path) => {
    expect(hubPath(route)).toBe(path);
    expect(parseHubPath(path)).toEqual({route, known: true});
    expect(isCanonical(path)).toBe(true);
  });

  it('round-trips under a sub-folder base', () => {
    for (const [route] of ROUTES) {
      const path = hubPath(route, '/OxEye/');
      expect(path.startsWith('/OxEye/')).toBe(true);
      expect(parseHubPath(path, '/OxEye/')).toEqual({route, known: true});
    }
    expect(parseHubPath('/OxEye', '/OxEye/')).toEqual({
      route: 'home',
      known: true,
    });
  });

  it('tolerates trailing and repeated slashes, case, index.html and encoding', () => {
    expect(parseHubPath('/ajustes/').route).toBe('settings');
    expect(parseHubPath('//simulador//nuevo/').route).toBe('new-model');
    expect(parseHubPath('/Ajustes').route).toBe('settings');
    expect(parseHubPath('/index.html')).toEqual({route: 'home', known: true});
    expect(parseHubPath('/%61justes').route).toBe('settings');
  });

  it('only the exact form is canonical', () => {
    expect(isCanonical('/ajustes/')).toBe(false);
    expect(isCanonical('/Ajustes')).toBe(false);
    expect(isCanonical('/index.html')).toBe(false);
    expect(isCanonical('/nada')).toBe(false);
  });

  it('unknown or malformed paths fall back to the portada', () => {
    for (const p of ['/nada', '/simulador/otra', '/gestor', '/%E0%A4%A', '']) {
      const parsed = parseHubPath(p);
      expect(parsed.route).toBe('home');
      if (p) expect(parsed.known).toBe(false);
    }
    expect(parseHubPath('/ajustes', '/OxEye/').known).toBe(false);
  });

  it('normalizes the base', () => {
    expect(normalizeBase(undefined)).toBe('/');
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase('/OxEye')).toBe('/OxEye/');
    expect(normalizeBase('OxEye/')).toBe('/OxEye/');
  });
});
