import {describe, expect, it} from 'vitest';
import {
  fileSlug,
  printFileName,
  printFooterLead,
  PRINT_SUBJECT_MAX,
} from '../../../shared/logistics/print-name.ts';

const LA_LAGUNA = {name: 'Ayuntamiento de San Cristóbal de La Laguna'};
// 2026-12-02 18:30 in the Canary Islands (UTC+0 in winter).
const AT = Date.parse('2026-12-02T18:30:00.000Z');

describe('fileSlug', () => {
  it('turns accents, ñ and spaces into plain ASCII words joined by hyphens', () => {
    expect(fileSlug('Nova Staff · Demo')).toBe('Nova-Staff-Demo');
    expect(fileSlug('Peñas Ñáñez & Cía.')).toBe('Penas-Nanez-Cia');
    expect(fileSlug('Cierre de jornada')).toBe('Cierre-de-jornada');
    expect(fileSlug('  Über Straße  ')).toBe('Uber-Strasse');
  });

  it('never keeps a character Windows refuses in a file name', () => {
    const slug = fileSlug('A<b>c:d"e/f\\g|h?i*j. ');
    expect(slug).toBe('A-b-c-d-e-f-g-h-i-j');
    expect(slug).not.toMatch(/[<>:"/\\|?*\s.]/);
  });

  it('is empty when nothing usable is left, and capped without a trailing hyphen', () => {
    expect(fileSlug('· — ·')).toBe('');
    const long = fileSlug(
      'Montajes y Escenarios del Atlántico Sociedad Limitada Unipersonal',
    );
    expect(long.length).toBeLessThanOrEqual(PRINT_SUBJECT_MAX);
    expect(long).not.toMatch(/-$/);
  });
});

describe('printFileName', () => {
  it('day close: SIGLAS_Tipo_fecha_hora in the organization time zone', () => {
    expect(
      printFileName({
        organization: LA_LAGUNA,
        document: 'dayClose',
        at: AT,
        timeZone: 'Atlantic/Canary',
      }),
    ).toBe('SCLL_Cierre-de-jornada_2026-12-02_18-30');
  });

  it('work order: the recipient company follows the type', () => {
    expect(
      printFileName({
        organization: LA_LAGUNA,
        document: 'workOrder',
        subject: 'Nova Staff Demo',
        at: AT,
        timeZone: 'Atlantic/Canary',
      }),
    ).toBe('SCLL_Ficha-de-trabajo_Nova-Staff-Demo_2026-12-02_18-30');
  });

  it('a stored acronym wins; its dots are dropped', () => {
    expect(
      printFileName({
        organization: {...LA_LAGUNA, acronym: 'S.C.L.L.'},
        document: 'dayClose',
        at: AT,
      }),
    ).toBe('SCLL_Cierre-de-jornada_2026-12-02_18-30');
  });

  it('uses local time: summer time in Madrid moves the clock', () => {
    expect(
      printFileName({
        organization: LA_LAGUNA,
        document: 'dayClose',
        at: Date.parse('2026-07-01T22:30:00.000Z'),
        timeZone: 'Europe/Madrid',
      }),
    ).toBe('SCLL_Cierre-de-jornada_2026-07-02_00-30');
  });

  it('without an organization the name starts with the type', () => {
    expect(
      printFileName({organization: null, document: 'dayClose', at: AT}),
    ).toBe('Cierre-de-jornada_2026-12-02_18-30');
  });

  it('only safe characters in the whole name', () => {
    const name = printFileName({
      organization: {name: 'Cabildo de Tenerife'},
      document: 'workOrder',
      subject: 'Sonido «Atlántico»: luces/escenario?',
      at: AT,
    });
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(name).toBe(
      'TEN_Ficha-de-trabajo_Sonido-Atlantico-luces-escenario_2026-12-02_18-30',
    );
  });
});

describe('printFooterLead', () => {
  it('names Ox Eye and the moment of printing', () => {
    expect(printFooterLead('2 dic 2026, 18:30')).toBe(
      'Generado por Ox Eye · 2 dic 2026, 18:30',
    );
    expect(printFooterLead(null)).toBe('Generado por Ox Eye');
  });
});
