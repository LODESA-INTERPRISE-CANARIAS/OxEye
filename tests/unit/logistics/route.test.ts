import {describe, expect, it} from 'vitest';
import {
  baseHash,
  parseRoute,
  sameAddress,
  stripSheet,
  withSheet,
} from '../../../src/logistics/shell/route';
import {printableWindow} from '../../../src/logistics/closing/day';

const ID = '3f2b1c9e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';

describe('Gestor addresses', () => {
  it('keeps every existing deep link', () => {
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
    expect(parseRoute('#logistica/cierre')).toMatchObject({
      space: 'cierre',
      closeDay: null,
    });
  });

  it('reads a sheet over any base', () => {
    expect(parseRoute(`#logistica/ficha/tarea/${ID}`)).toMatchObject({
      space: 'hoy',
      sheet: {type: 'task', id: ID},
    });
    expect(
      parseRoute(`#logistica/calendario/2026-12-02/ficha/evento/${ID}`),
    ).toMatchObject({
      space: 'calendario',
      calendarDay: '2026-12-02',
      sheet: {type: 'event', id: ID},
    });
    expect(parseRoute('#logistica/contactos/ficha/empresa/c1').sheet).toEqual({
      type: 'company',
      id: 'c1',
    });
  });

  it('ignores malformed or unknown parts', () => {
    expect(parseRoute('#logistica/ficha/cosa/x').sheet).toBeNull();
    expect(parseRoute('#logistica/ficha/tarea/').sheet).toBeNull();
    expect(parseRoute('#logistica/ficha/tarea/a b').sheet).toBeNull();
    expect(parseRoute('#logistica/ficha/tarea/x/y').sheet).toBeNull();
    expect(parseRoute('#logistica/nada').space).toBe('hoy');
    expect(parseRoute('#logisticas').space).toBe('hoy');
    expect(parseRoute('#logistica/calendario/2026-13-40').calendarDay).toBe(
      null,
    );
    expect(parseRoute('').space).toBe('hoy');
  });

  it('mock-ups have their own address', () => {
    expect(parseRoute('#logistica/maquetas').mockups).toBe(true);
    expect(
      baseHash({
        space: 'hoy',
        calendarDay: null,
        closeDay: null,
        mockups: true,
      }),
    ).toBe('#logistica/maquetas');
  });

  it('writes what it reads', () => {
    for (const hash of [
      '#logistica',
      '#logistica/inventarios',
      '#logistica/calendario',
      '#logistica/calendario/2026-12-02',
      '#logistica/cierre',
      '#logistica/cierre/2026-11-30',
    ]) {
      expect(baseHash(parseRoute(hash))).toBe(hash);
    }
    const withTask = withSheet('#logistica/calendario/2026-12-02', {
      type: 'task',
      id: ID,
    });
    expect(withTask).toBe(`#logistica/calendario/2026-12-02/ficha/tarea/${ID}`);
    expect(stripSheet(withTask)).toBe('#logistica/calendario/2026-12-02');
    expect(withSheet('#logistica', {type: 'warehouse', id: 'w1'})).toBe(
      '#logistica/ficha/almacen/w1',
    );
    expect(parseRoute('#logistica/ficha/almacen/w1').sheet).toEqual({
      type: 'warehouse',
      id: 'w1',
    });
    expect(withSheet('#logistica', null)).toBe('#logistica');
  });

  it('an event budget has its own address (the event id)', () => {
    const hash = withSheet('#logistica/calendario/2026-12-02', {
      type: 'budget',
      id: 'e1',
    });
    expect(hash).toBe('#logistica/calendario/2026-12-02/ficha/presupuesto/e1');
    expect(parseRoute(hash)).toMatchObject({
      space: 'calendario',
      calendarDay: '2026-12-02',
      sheet: {type: 'budget', id: 'e1'},
    });
    expect(stripSheet(hash)).toBe('#logistica/calendario/2026-12-02');
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
