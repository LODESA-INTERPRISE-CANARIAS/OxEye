import {afterEach, describe, expect, it} from 'vitest';
import {
  addressOf,
  addressUrl,
  currentAddress,
  inGestor,
  linkLocation,
  rewriteLegacyLocation,
} from '../../../src/logistics/shell/address';

const TOKEN = 'A'.repeat(20) + '_-' + 'z'.repeat(21);

function at(url: string, state: unknown = null): void {
  window.history.replaceState(state, '', url);
}

afterEach(() => at('/'));

describe('Gestor address on the location (base /)', () => {
  it('reads the address of a pathname', () => {
    expect(addressOf('/')).toBe('/');
    expect(addressOf('')).toBe('/');
    expect(addressOf('/gestor-logistico')).toBe('/gestor-logistico');
    expect(addressOf('/gestor-logistico/')).toBe('/gestor-logistico');
    expect(addressOf('//gestor-logistico//calendario/2026-12-02/')).toBe(
      '/gestor-logistico/calendario/2026-12-02',
    );
    expect(addressOf('/ajustes')).toBe('/ajustes');
  });

  it('knows when the Gestor is on screen', () => {
    at('/gestor-logistico/tareas?x=1');
    expect(currentAddress()).toBe('/gestor-logistico/tareas');
    expect(inGestor()).toBe(true);
    at('/ajustes');
    expect(inGestor()).toBe(false);
    at('/gestor-logisticos');
    expect(inGestor()).toBe(false);
  });

  it('writes an address keeping the query, a token only when given', () => {
    at('/ajustes?modo=demo#algo');
    expect(addressUrl('/gestor-logistico/contactos')).toBe(
      '/gestor-logistico/contactos?modo=demo',
    );
    expect(addressUrl('/')).toBe('/?modo=demo');
    expect(addressUrl('/gestor-logistico/proveedor', `#${TOKEN}`)).toBe(
      `/gestor-logistico/proveedor?modo=demo#${TOKEN}`,
    );
  });

  it('gives the link parsers the address and fragment, or a legacy fragment alone', () => {
    at(`/gestor-logistico/proveedor#${TOKEN}`);
    expect(linkLocation()).toBe(`/gestor-logistico/proveedor#${TOKEN}`);
    at(`/ajustes#logistica/proveedor/${TOKEN}`);
    expect(linkLocation()).toBe(`#logistica/proveedor/${TOKEN}`);
    at('/');
    expect(linkLocation()).toBe('/');
  });
});

describe('legacy #logistica addresses on load', () => {
  it('rewrites them to the clean address, keeping the history entry', () => {
    const state = {lx: 1, depth: 0, index: 3};
    at('/#logistica/calendario/2026-12-02', state);
    expect(rewriteLegacyLocation()).toBe(true);
    expect(window.location.pathname).toBe(
      '/gestor-logistico/calendario/2026-12-02',
    );
    expect(window.location.hash).toBe('');
    expect(window.history.state).toEqual(state);
  });

  it('moves a token to the fragment of the new address', () => {
    at(`/?v=2#logistica/cuenta/restablecer/${TOKEN}`);
    expect(rewriteLegacyLocation()).toBe(true);
    expect(window.location.pathname).toBe(
      '/gestor-logistico/cuenta/restablecer',
    );
    expect(window.location.pathname).not.toContain(TOKEN);
    expect(window.location.search).toBe('?v=2');
    expect(window.location.hash).toBe(`#${TOKEN}`);
  });

  it('leaves every other address alone', () => {
    for (const url of ['/', '/ajustes', '/gestor-logistico/tareas', '/#otra']) {
      at(url);
      expect(rewriteLegacyLocation()).toBe(false);
      expect(`${window.location.pathname}${window.location.hash}`).toBe(url);
    }
  });
});
