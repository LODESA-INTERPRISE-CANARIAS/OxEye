import {describe, expect, it} from 'vitest';
import {
  normalize,
  pushRecent,
  rank,
  scoreMatch,
} from '../../../shared/logistics/search';
import {
  missingForEvent,
  missingForOffer,
  missingForResource,
  missingForTask,
  verifiedPercent,
} from '../../../shared/logistics/quality';

describe('logistics search', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalize('  Plaza del CRISTO, La Laguna ')).toBe(
      'plaza del cristo la laguna',
    );
    expect(normalize('Iluminación')).toBe('iluminacion');
  });

  it('matches prefixes in any order, title first', () => {
    const items = [
      {name: 'Nova Staff', tags: 'personal azafatos'},
      {name: 'Carpas Teide', tags: 'carpas estructuras'},
      {name: 'Aseos Norte', tags: 'aseos portátiles transporte'},
    ];
    expect(
      rank('carp', items, i => [i.name, i.tags]).map(r => r.item.name),
    ).toEqual(['Carpas Teide']);
    expect(
      rank('portatiles aseos', items, i => [i.name, i.tags]).map(
        r => r.item.name,
      ),
    ).toEqual(['Aseos Norte']);
    expect(rank('azafat', items, i => [i.name, i.tags])[0].item.name).toBe(
      'Nova Staff',
    );
  });

  it('tolerates one typo in longer words and requires every word', () => {
    expect(scoreMatch('vallas', ['Valas metálicas'])).toBeGreaterThan(0);
    expect(scoreMatch('carpa sonido', ['Carpas Teide'])).toBe(0);
    expect(scoreMatch('', ['x'])).toBe(0);
  });

  it('keeps five recent distinct searches, newest first', () => {
    let r: string[] = [];
    for (const q of [
      'vallas',
      'carpas',
      'Vallas',
      'aseos',
      'sonido',
      'catering',
      'mario',
    ]) {
      r = pushRecent(r, q);
    }
    expect(r).toEqual(['mario', 'catering', 'sonido', 'aseos', 'Vallas']);
    expect(pushRecent(r, '  ')).toBe(r);
  });
});

describe('logistics quality', () => {
  it('lists what an event lacks', () => {
    expect(
      missingForEvent({venue: null, startsAt: null, endsAt: null}),
    ).toEqual(['lugar', 'fecha y hora de inicio', 'hora de fin']);
    expect(
      missingForEvent({
        venue: {id: '1', name: 'Plaza'},
        startsAt: 'x',
        endsAt: 'y',
      }),
    ).toEqual([]);
  });

  it('asks whether a load-bearing task is heavy instead of assuming it is not', () => {
    const base = {
      startsAt: 'x',
      endsAt: 'y',
      company: {id: 'c', name: 'Escenarios'},
      venue: {id: 'v', name: 'Plaza'},
    };
    expect(
      missingForTask({...base, kind: 'assembly', heavyLoad: null}),
    ).toEqual(['carga pesada']);
    expect(
      missingForTask({...base, kind: 'assembly', heavyLoad: false}),
    ).toEqual([]);
    expect(
      missingForTask({...base, kind: 'activity', heavyLoad: null}),
    ).toEqual([]);
  });

  it('never treats an unknown price as zero', () => {
    expect(
      missingForOffer({price: null, unit: 'day', customUnit: null}),
    ).toEqual(['precio']);
    expect(missingForOffer({price: 0, unit: 'day', customUnit: null})).toEqual(
      [],
    );
    expect(
      missingForOffer({price: 10, unit: 'custom', customUnit: null}),
    ).toEqual(['unidad de contratación']);
  });

  it('flags resources still to assess', () => {
    expect(
      missingForResource({
        quantity: 200,
        dimensions: '2 m',
        warehouse: {id: 'w', name: 'Almacén'},
        condition: 'good',
        toAssess: true,
      }),
    ).toEqual(['cantidad']);
  });

  it('computes the verified percentage', () => {
    expect(verifiedPercent([])).toBe(0);
    expect(
      verifiedPercent([
        {verification: 'validated'},
        {verification: 'draft'},
        {verification: 'to_verify'},
      ]),
    ).toBe(33);
  });
});
