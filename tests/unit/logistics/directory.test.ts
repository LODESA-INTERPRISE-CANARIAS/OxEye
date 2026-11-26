import {describe, expect, it} from 'vitest';
import type {
  Company,
  Contact,
  Offer,
} from '../../../shared/logistics/contracts';
import {
  euroProblem,
  eurosForInput,
  groupByLetter,
  letterOf,
  parseEuros,
} from '../../../src/logistics/lib/directory';
import {verificationSummary} from '../../../src/logistics/lib/events';

const meta = {
  version: 1,
  createdBy: {id: 'u1', displayName: 'Equipo'},
  createdAt: '2026-12-02T09:00:00.000Z',
  updatedBy: {id: 'u1', displayName: 'Equipo'},
  updatedAt: '2026-12-02T09:00:00.000Z',
  source: null,
  isDemo: false,
  organizationId: 'org',
};

const contact = (over: Partial<Contact>): Contact => ({
  ...meta,
  id: 'p1',
  name: 'Ana Prueba',
  role: null,
  company: null,
  phone: null,
  email: null,
  description: null,
  notes: null,
  eventIds: [],
  restricted: false,
  verification: 'draft',
  ...over,
});

const company = (over: Partial<Company>): Company => ({
  ...meta,
  id: 'k1',
  name: 'Carpas Prueba',
  kind: 'supplier',
  categoryIds: [],
  phone: null,
  email: null,
  website: null,
  notes: null,
  mainContactId: null,
  contactCount: 0,
  offerCount: 0,
  restricted: false,
  verification: 'draft',
  ...over,
});

const offer = (over: Partial<Offer>): Offer => ({
  ...meta,
  id: 'o1',
  company: {id: 'k1', name: 'Carpas Prueba'},
  categoryId: 'carpas',
  name: 'Carpa 3×3',
  description: null,
  price: 120,
  unit: 'day',
  customUnit: null,
  transportCost: null,
  assemblyCost: null,
  maintenanceCost: null,
  conditions: null,
  vatIncluded: null,
  restricted: false,
  verification: 'draft',
  ...over,
});

describe('euros typed on a Spanish keyboard', () => {
  it.each([
    ['85,50', 85.5],
    ['1.250', 1250],
    ['1.250,5', 1250.5],
    ['12.5', 12.5],
    ['0.500', 0.5],
    ['0,5', 0.5],
    ['120 €', 120],
    [' 1 250 ', 1250],
    ['0', 0],
  ])('«%s» → %d', (text, value) => {
    expect(parseEuros(text)).toBe(value);
    expect(euroProblem(text)).toBeNull();
  });

  it('keeps empty as unknown, never 0', () => {
    expect(parseEuros('')).toBeNull();
    expect(parseEuros('  € ')).toBeNull();
    expect(euroProblem('')).toBeNull();
  });

  it.each([',', '-5', 'abc', '1,2,3', '12.34.5'])('refuses «%s»', text => {
    expect(Number.isNaN(parseEuros(text))).toBe(true);
    expect(euroProblem(text)).toMatch(/importe en euros/);
  });

  it('asks for at most two decimals and a sane range', () => {
    expect(euroProblem('1250,505')).toMatch(/dos decimales/);
    expect(euroProblem('20.000.000')).toMatch(/entre 0 y 10\.000\.000/);
  });

  it('writes amounts back the way the input reads them', () => {
    expect(eurosForInput(null)).toBe('');
    expect(eurosForInput(120)).toBe('120');
    expect(eurosForInput(1250.5)).toBe('1250,50');
    expect(parseEuros(eurosForInput(1250.5))).toBe(1250.5);
  });
});

describe('address-book letters', () => {
  it('files accents with their letter and Ñ on its own', () => {
    expect(letterOf('Álvaro Prueba')).toBe('A');
    expect(letterOf('ñandú Prueba')).toBe('Ñ');
    expect(letterOf('Ñandú Prueba')).toBe('Ñ');
    expect(letterOf('Nadia Prueba')).toBe('N');
    expect(letterOf('3D Prueba')).toBe('#');
    expect(letterOf('«Prueba»')).toBe('P');
  });

  it('groups a sorted list and puts «#» last', () => {
    const groups = groupByLetter([
      {name: '24h Prueba'},
      {name: 'Ana Prueba'},
      {name: 'Álvaro Prueba'},
      {name: 'Nadia Prueba'},
      {name: 'Ñandú Prueba'},
    ]);
    expect(groups.map(g => g.letter)).toEqual(['A', 'N', 'Ñ', '#']);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe('«Información verificada» with people, companies and offers', () => {
  it('counts every record and lists the plan before the directory', () => {
    const summary = verificationSummary([], [], {
      contacts: [
        contact({
          verification: 'validated',
          phone: '+34 000 000 001',
          role: 'Jefa',
          company: {id: 'k1', name: 'Carpas Prueba'},
        }),
      ],
      companies: [company({})],
      offers: [offer({price: null})],
    });
    expect(summary.total).toBe(3);
    expect(summary.validated).toBe(1);
    expect(summary.percent).toBe(33);
    expect(summary.incomplete.map(r => r.kind)).toEqual(['company', 'offer']);
    const offerRow = summary.incomplete.find(r => r.kind === 'offer')!;
    expect(offerRow.missing).toEqual(['precio', 'validación']);
    expect(offerRow.name).toBe('Carpa 3×3 · Carpas Prueba');
  });

  it('does not ask a guest for what it cannot see', () => {
    const summary = verificationSummary([], [], {
      contacts: [
        contact({
          restricted: true,
          role: 'Jefa',
          company: {id: 'k1', name: 'Carpas Prueba'},
        }),
      ],
      offers: [offer({restricted: true, price: null})],
    });
    const missing = summary.incomplete.flatMap(r => r.missing);
    expect(missing).not.toContain('teléfono o correo');
    expect(missing).not.toContain('precio');
  });

  it('has no percentage when nothing is recorded', () => {
    expect(verificationSummary([], [], {}).percent).toBeNull();
  });
});
