import {describe, expect, it} from 'vitest';
import {
  baseAddress,
  isGestorAddress,
  isLegacyHash,
  legacyLocation,
  normalizeAddress,
  parseRoute,
  sameAddress,
  stripSheet,
  withSheet,
} from '../../../src/logistics/shell/route';
import {printableWindow} from '../../../src/logistics/closing/day';

const ID = '3f2b1c9e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';
const TOKEN = 'A'.repeat(20) + '_-' + 'z'.repeat(21);
const ROOT = '/gestor-logistico';

describe('Gestor addresses', () => {
  it('opens every space and day from its address', () => {
    expect(parseRoute(ROOT)).toMatchObject({space: 'hoy', sheet: null});
    expect(parseRoute(`${ROOT}/contactos`)).toMatchObject({
      space: 'contactos',
    });
    expect(parseRoute(`${ROOT}/calendario/2026-12-02`)).toMatchObject({
      space: 'calendario',
      calendarDay: '2026-12-02',
    });
    expect(parseRoute(`${ROOT}/cierre/2026-12-01`)).toMatchObject({
      space: 'cierre',
      closeDay: '2026-12-01',
    });
    expect(parseRoute(`${ROOT}/cierre`)).toMatchObject({
      space: 'cierre',
      closeDay: null,
    });
  });

  it('keeps every legacy deep link (fragment form)', () => {
    expect(parseRoute('#logistica')).toMatchObject({space: 'hoy', sheet: null});
    expect(parseRoute('#logistica/contactos')).toMatchObject({
      space: 'contactos',
    });
    expect(parseRoute('#logistica/calendario/2026-12-02')).toMatchObject({
      space: 'calendario',
      calendarDay: '2026-12-02',
    });
    expect(parseRoute('#logistica/cierre/2026-12-01')).toMatchObject({
      space: 'cierre',
      closeDay: '2026-12-01',
    });
    expect(parseRoute(`#logistica/tareas/ficha/tarea/${ID}`)).toMatchObject({
      space: 'tareas',
      sheet: {type: 'task', id: ID},
    });
  });

  it('reads a sheet over any base', () => {
    expect(parseRoute(`${ROOT}/ficha/tarea/${ID}`)).toMatchObject({
      space: 'hoy',
      sheet: {type: 'task', id: ID},
    });
    expect(
      parseRoute(`${ROOT}/calendario/2026-12-02/ficha/evento/${ID}`),
    ).toMatchObject({
      space: 'calendario',
      calendarDay: '2026-12-02',
      sheet: {type: 'event', id: ID},
    });
    expect(parseRoute(`${ROOT}/contactos/ficha/empresa/c1`).sheet).toEqual({
      type: 'company',
      id: 'c1',
    });
  });

  it('ignores malformed or unknown parts', () => {
    expect(parseRoute(`${ROOT}/ficha/cosa/x`).sheet).toBeNull();
    expect(parseRoute(`${ROOT}/ficha/tarea/`).sheet).toBeNull();
    expect(parseRoute(`${ROOT}/ficha/tarea/a b`).sheet).toBeNull();
    expect(parseRoute(`${ROOT}/ficha/tarea/x/y`).sheet).toBeNull();
    expect(parseRoute(`${ROOT}/nada`).space).toBe('hoy');
    expect(parseRoute('/gestor-logisticos/contactos').space).toBe('hoy');
    expect(parseRoute('/contactos').space).toBe('hoy');
    expect(parseRoute('#logisticas').space).toBe('hoy');
    expect(parseRoute(`${ROOT}/calendario/2026-13-40`).calendarDay).toBe(null);
    expect(parseRoute('').space).toBe('hoy');
    expect(parseRoute('/').space).toBe('hoy');
  });

  it('tolerates trailing and repeated slashes', () => {
    expect(parseRoute(`${ROOT}/`).space).toBe('hoy');
    expect(parseRoute(`/${ROOT}//contactos/`).space).toBe('contactos');
    expect(parseRoute(`${ROOT}/tareas/ficha/tarea/t1/`).sheet).toEqual({
      type: 'task',
      id: 't1',
    });
  });

  it('mock-ups have their own address', () => {
    expect(parseRoute(`${ROOT}/maquetas`).mockups).toBe(true);
    expect(parseRoute('#logistica/maquetas').mockups).toBe(true);
    expect(
      baseAddress({
        space: 'hoy',
        calendarDay: null,
        closeDay: null,
        mockups: true,
      }),
    ).toBe(`${ROOT}/maquetas`);
  });

  it('writes what it reads', () => {
    for (const address of [
      ROOT,
      `${ROOT}/inventarios`,
      `${ROOT}/calendario`,
      `${ROOT}/calendario/2026-12-02`,
      `${ROOT}/cierre`,
      `${ROOT}/cierre/2026-11-30`,
    ]) {
      expect(baseAddress(parseRoute(address))).toBe(address);
    }
    const withTask = withSheet(`${ROOT}/calendario/2026-12-02`, {
      type: 'task',
      id: ID,
    });
    expect(withTask).toBe(`${ROOT}/calendario/2026-12-02/ficha/tarea/${ID}`);
    expect(stripSheet(withTask)).toBe(`${ROOT}/calendario/2026-12-02`);
    expect(withSheet(ROOT, {type: 'warehouse', id: 'w1'})).toBe(
      `${ROOT}/ficha/almacen/w1`,
    );
    expect(parseRoute(`${ROOT}/ficha/almacen/w1`).sheet).toEqual({
      type: 'warehouse',
      id: 'w1',
    });
    expect(withSheet(ROOT, null)).toBe(ROOT);
  });

  it('an event budget has its own address (the event id)', () => {
    const address = withSheet(`${ROOT}/calendario/2026-12-02`, {
      type: 'budget',
      id: 'e1',
    });
    expect(address).toBe(`${ROOT}/calendario/2026-12-02/ficha/presupuesto/e1`);
    expect(parseRoute(address)).toMatchObject({
      space: 'calendario',
      calendarDay: '2026-12-02',
      sheet: {type: 'budget', id: 'e1'},
    });
    expect(stripSheet(address)).toBe(`${ROOT}/calendario/2026-12-02`);
  });

  it('compares addresses by type and id', () => {
    expect(sameAddress({type: 'task', id: 'a'}, {type: 'task', id: 'a'})).toBe(
      true,
    );
    expect(sameAddress({type: 'task', id: 'a'}, {type: 'note', id: 'a'})).toBe(
      false,
    );
    expect(sameAddress(null, {type: 'task', id: 'a'})).toBe(false);
  });

  it('knows its own addresses and the legacy fragment', () => {
    expect(isGestorAddress(ROOT)).toBe(true);
    expect(isGestorAddress(`${ROOT}/tareas`)).toBe(true);
    expect(isGestorAddress('/gestor-logisticos')).toBe(false);
    expect(isGestorAddress('/')).toBe(false);
    expect(isLegacyHash('#logistica')).toBe(true);
    expect(isLegacyHash('#logistica/tareas')).toBe(true);
    expect(isLegacyHash('#logisticas')).toBe(false);
    expect(isLegacyHash('')).toBe(false);
  });

  it('normalizes addresses and legacy fragments', () => {
    expect(normalizeAddress('#logistica')).toBe(ROOT);
    expect(normalizeAddress('#logistica/calendario/2026-12-02')).toBe(
      `${ROOT}/calendario/2026-12-02`,
    );
    expect(normalizeAddress('#logistica/')).toBe(ROOT);
    expect(normalizeAddress(`${ROOT}/`)).toBe(ROOT);
    expect(normalizeAddress('//gestor-logistico//tareas//')).toBe(
      `${ROOT}/tareas`,
    );
    expect(normalizeAddress('')).toBe('/');
    expect(normalizeAddress('/')).toBe('/');
  });
});

describe('legacy #logistica links', () => {
  it('moves every space, day and sheet to its path', () => {
    const cases: [string, string][] = [
      ['#logistica', ROOT],
      ['#logistica/', ROOT],
      ['#logistica/calendario', `${ROOT}/calendario`],
      ['#logistica/calendario/2026-12-02', `${ROOT}/calendario/2026-12-02`],
      ['#logistica/cierre/2026-12-01', `${ROOT}/cierre/2026-12-01`],
      ['#logistica/maquetas', `${ROOT}/maquetas`],
      [`#logistica/ficha/tarea/${ID}`, `${ROOT}/ficha/tarea/${ID}`],
      [
        '#logistica/calendario/2026-12-02/ficha/presupuesto/e1',
        `${ROOT}/calendario/2026-12-02/ficha/presupuesto/e1`,
      ],
    ];
    for (const [hash, address] of cases) {
      expect(legacyLocation(hash)).toEqual({address, hash: ''});
    }
  });

  it('moves account and supplier tokens to the fragment, never the path', () => {
    expect(legacyLocation(`#logistica/cuenta/restablecer/${TOKEN}`)).toEqual({
      address: `${ROOT}/cuenta/restablecer`,
      hash: `#${TOKEN}`,
    });
    expect(legacyLocation(`#logistica/cuenta/verificar/${TOKEN}`)).toEqual({
      address: `${ROOT}/cuenta/verificar`,
      hash: `#${TOKEN}`,
    });
    expect(legacyLocation(`#logistica/proveedor/${TOKEN}`)).toEqual({
      address: `${ROOT}/proveedor`,
      hash: `#${TOKEN}`,
    });
    expect(legacyLocation(`#logistica/proveedor/abierto/${TOKEN}`)).toEqual({
      address: `${ROOT}/proveedor/abierto`,
      hash: `#${TOKEN}`,
    });
  });

  it('keeps junk out of the fragment and ignores what is not a legacy link', () => {
    // A malformed token link may still carry a real token: nothing after
    // `cuenta` or `proveedor` may reach the path, so it opens the root.
    for (const bad of [
      '#logistica/proveedor/corto',
      `#logistica/proveedor/${TOKEN}/`,
      `#logistica/proveedor/${TOKEN}.`,
      `#logistica/proveedor/abierto/${TOKEN}x`,
      `#logistica/cuenta/restablecer/${TOKEN}/`,
      `#logistica/cuenta/verificar/${TOKEN}?a=1`,
      '#logistica/cuenta',
      '#logistica/proveedor',
    ]) {
      const moved = legacyLocation(bad);
      expect(moved).toEqual({address: ROOT, hash: ''});
      expect(moved!.address).not.toContain(TOKEN);
    }
    // A query or second fragment inside an old address is dropped.
    expect(legacyLocation('#logistica/calendario?x=1')).toEqual({
      address: `${ROOT}/calendario`,
      hash: '',
    });
    expect(legacyLocation('#logistica/nada/mas')).toEqual({
      address: `${ROOT}/nada/mas`,
      hash: '',
    });
    expect(legacyLocation('')).toBeNull();
    expect(legacyLocation('#')).toBeNull();
    expect(legacyLocation('#logisticas')).toBeNull();
    expect(legacyLocation('#otra/cosa')).toBeNull();
    expect(legacyLocation('/gestor-logistico')).toBeNull();
  });

  it('opens the same screen after moving', () => {
    for (const hash of [
      '#logistica/contactos',
      '#logistica/cierre/2026-12-01',
      `#logistica/tareas/ficha/tarea/${ID}`,
    ]) {
      expect(parseRoute(legacyLocation(hash)!.address)).toEqual(
        parseRoute(hash),
      );
    }
  });
});

describe('day close · printable windows', () => {
  const nb = String.fromCharCode(0xa0);
  it('glues each day and time so a long window wraps only after the dash', () => {
    expect(printableWindow('2 dic 07:00 – 3 dic 22:30')).toBe(
      `2${nb}dic${nb}07:00${nb}– 3${nb}dic${nb}22:30`,
    );
    expect(printableWindow('22:00 – 02:00 (día siguiente)')).toBe(
      `22:00${nb}– 02:00 (día${nb}siguiente)`,
    );
    expect(printableWindow('horario pendiente de verificar')).toBe(
      'horario pendiente de verificar',
    );
  });
});
