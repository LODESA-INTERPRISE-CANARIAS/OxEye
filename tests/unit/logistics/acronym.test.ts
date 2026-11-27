import {describe, expect, it} from 'vitest';
import {
  acronymFor,
  acronymProblem,
  proposeAcronym,
} from '../../../shared/logistics/acronym.ts';

describe('proposeAcronym', () => {
  it('drops the body word and keeps capitalised articles of a proper name', () => {
    expect(proposeAcronym('Ayuntamiento de San Cristóbal de La Laguna')).toBe(
      'SCLL',
    );
  });

  it('dots place acronyms and skips lower-case linking words', () => {
    expect(proposeAcronym('Almacén Municipal', {dotted: true})).toBe('A.M.');
    expect(proposeAcronym('Plaza del Adelantado', {dotted: true})).toBe('P.A.');
    expect(proposeAcronym('Plaza del Cristo', {dotted: true})).toBe('P.C.');
  });

  it('keeps a body word when it is the whole name', () => {
    expect(proposeAcronym('Ayuntamiento')).toBe('AYU');
  });

  it('uses three letters for a single word', () => {
    expect(proposeAcronym('Recinto', {dotted: true})).toBe('Rec.');
    expect(proposeAcronym('Recinto')).toBe('REC');
  });

  it('returns null for an empty name', () => {
    expect(proposeAcronym('   ')).toBeNull();
  });
});

describe('acronymFor', () => {
  it('prefers the stored acronym', () => {
    expect(acronymFor({name: 'Almacén Municipal', acronym: 'AMUN'})).toBe('AMUN');
    expect(
      acronymFor({name: 'Almacén Municipal', acronym: null}, {dotted: true}),
    ).toBe('A.M.');
  });
});

describe('acronymProblem', () => {
  it('accepts letters, digits and dots up to the limit', () => {
    expect(acronymProblem('SCLL')).toBeNull();
    expect(acronymProblem('A.M.')).toBeNull();
    expect(acronymProblem('')).toBeNull();
  });

  it('rejects spaces and long values', () => {
    expect(acronymProblem('S C')).not.toBeNull();
    expect(acronymProblem('ABCDEFGHIJKLM')).not.toBeNull();
  });
});
