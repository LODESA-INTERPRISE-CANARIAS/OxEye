import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {SUBSOIL_THRESHOLD_NOTE} from '../../../shared/logistics/conflicts';
import type {
  ActivityEntry,
  DelayHypothesis,
  Note,
  Task,
} from '../../../shared/logistics/contracts';
import {
  buildDayReport,
  type DayReportInput,
} from '../../../shared/logistics/day-report';
import {
  clampDay,
  countTiles,
  dayFromHash,
  groupByDay,
  hashForDay,
  includedTextTitles,
  isQuietDay,
  listJoin,
  listNi,
  noteTextSummary,
  stampText,
  tileDetail,
  totalChanges,
} from '../../../src/logistics/closing/day';
import {DayReportPage} from '../../../src/logistics/closing/DayReportPage';

const DAY = '2026-12-02';
const at = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;
const elvis = {id: 'u-elvis', displayName: 'Elvis'};
const meta = (created = at('08:00')) => ({
  version: 1,
  createdBy: elvis,
  createdAt: created,
  updatedBy: elvis,
  updatedAt: created,
  source: null,
  verification: 'draft' as const,
  isDemo: false,
  organizationId: 'org',
});

const TEXT = {
  incident: 'MARCA-TEXTO-INCIDENCIA',
  decision: 'MARCA-TEXTO-DECISION',
  hypothesis: 'MARCA-NOTA-HIPOTESIS',
  task: 'MARCA-OBSERVACION-TAREA',
};

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...meta(at('07:00', '2026-12-01')),
  id,
  eventId: null,
  venue: {id: 'v', name: 'Plaza del Cristo'},
  title: id,
  kind: 'assembly',
  status: 'planned',
  date: DAY,
  endDate: null,
  startsAt: at('09:00'),
  endsAt: at('11:00'),
  timezone: 'Atlantic/Canary',
  company: null,
  contact: null,
  dependsOn: [],
  heavyLoad: false,
  resourceIds: [],
  subsoilReview: null,
  notes: TEXT.task,
  restricted: false,
  ...extra,
});

const note = (id: string, extra: Partial<Note>): Note => ({
  ...meta(at('12:00')),
  id,
  kind: 'note',
  text: null,
  event: null,
  ref: null,
  resolved: false,
  answer: null,
  resolvedBy: null,
  resolvedAt: null,
  restricted: false,
  ...extra,
});

const hypothesis: DelayHypothesis = {
  id: 'h1',
  organizationId: 'org',
  taskId: 'stage',
  taskTitle: 'Escenario Demo',
  delayMinutes: 30,
  mode: 'shift',
  estimated: false,
  note: TEXT.hypothesis,
  createdBy: elvis,
  createdAt: at('13:00'),
  appliedAt: at('14:00'),
  appliedBy: elvis,
  restricted: false,
};

const input = (extra: Partial<DayReportInput> = {}): DayReportInput => ({
  date: DAY,
  timezone: 'Atlantic/Canary',
  viewer: {...elvis, role: 'member'},
  generatedAt: at('20:00'),
  activity: null,
  events: [],
  tasks: [
    task('stage', {heavyLoad: true, status: 'done', title: 'Escenario Demo'}),
    task('next', {
      title: 'Desmontaje Demo',
      date: '2026-12-03',
      startsAt: at('08:00', '2026-12-03'),
      endsAt: at('10:00', '2026-12-03'),
    }),
  ],
  contacts: [],
  companies: [],
  offers: [],
  warehouses: [],
  resources: [],
  notes: [
    note('n-inc', {kind: 'incident', text: TEXT.incident}),
    note('n-dec', {kind: 'decision', text: TEXT.decision}),
  ],
  hypotheses: [hypothesis],
  ...extra,
});

const pageHtml = (extra: Partial<DayReportInput> = {}) => {
  const report = buildDayReport(input(extra));
  return renderToStaticMarkup(
    createElement(DayReportPage, {
      report,
      orgName: 'La Laguna Demo',
      generatedAtText: '2 dic 2026, 20:00',
      windowOf: () => '09:00 – 11:00',
      daysOf: l => (l.date ? [l.date] : []),
      unsent: new Set<string>(),
    }),
  );
};

describe('day close link', () => {
  it('reads only well-formed days from the link', () => {
    expect(dayFromHash('#logistica/cierre/2026-12-02')).toBe('2026-12-02');
    expect(dayFromHash('#logistica/cierre')).toBeNull();
    expect(dayFromHash('#logistica/cierre/2026-13-40')).toBeNull();
    expect(dayFromHash('#logistica/calendario/2026-12-02')).toBeNull();
  });

  it('keeps the plain link for today and never goes past it', () => {
    expect(hashForDay(DAY, DAY)).toBe('#logistica/cierre');
    expect(hashForDay('2026-12-01', DAY)).toBe('#logistica/cierre/2026-12-01');
    expect(clampDay('2026-12-05', DAY)).toBe(DAY);
    expect(clampDay('2026-11-30', DAY)).toBe('2026-11-30');
  });
});

describe('summary figures', () => {
  it('counts per type and says only what applies', () => {
    const activity: ActivityEntry[] = [
      {
        id: 'a1',
        user: elvis,
        entityType: 'task',
        entityId: 'stage',
        entityLabel: 'Escenario Demo',
        action: 'update',
        changedFields: ['status'],
        at: at('10:00'),
      },
      {
        id: 'a2',
        user: elvis,
        entityType: 'task',
        entityId: 'gone',
        entityLabel: 'Borrada',
        action: 'delete',
        changedFields: [],
        at: at('11:00'),
      },
    ];
    const report = buildDayReport(input({activity}));
    const taskTile = countTiles(report).find(t => t.type === 'task')!;
    expect(taskTile).toMatchObject({total: 1, modified: 1, deleted: 1});
    expect(tileDetail(taskTile)).toBe('1 con cambios · 1 borrado');
    expect(totalChanges(report)).toBe(2);
    expect(isQuietDay(report)).toBe(false);
  });

  it('has no note tile for guests', () => {
    const report = buildDayReport(input({viewer: {...elvis, role: 'guest'}}));
    expect(countTiles(report).some(t => t.type === 'note')).toBe(false);
  });

  it('calls a day with nothing in it quiet', () => {
    const report = buildDayReport(
      input({date: '2026-11-20', activity: [], hypotheses: []}),
    );
    expect(isQuietDay(report)).toBe(true);
    expect(tileDetail(countTiles(report).find(t => t.type === 'event')!)).toBe(
      'Sin cambios',
    );
  });
});

describe('words', () => {
  it('joins lists the Spanish way', () => {
    expect(listJoin(['Decisiones'])).toBe('Decisiones');
    expect(listJoin(['Decisiones', 'Incidencias'])).toBe(
      'Decisiones e Incidencias',
    );
    expect(listJoin(['eventos', 'personas', 'almacenes'])).toBe(
      'eventos, personas y almacenes',
    );
    expect(listNi(['incidencias', 'decisiones', 'ideas'])).toBe(
      'incidencias, decisiones ni ideas',
    );
  });

  it('stamps the generation time in the organization zone', () => {
    // 20:00 UTC is 20:00 in Canarias in winter.
    expect(stampText(at('20:00'), 'Atlantic/Canary')).toBe('2 dic 2026, 20:00');
  });
});

describe('grouping the next days', () => {
  it('puts each line under the first listed day it occupies', () => {
    const lines = [
      {id: 'a', date: '2026-12-03'},
      {id: 'b', date: '2026-12-01'},
      {id: 'c', date: '2026-12-04'},
    ];
    const occupied: Record<string, string[]> = {
      a: ['2026-12-03'],
      b: ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'],
      c: ['2026-12-04'],
    };
    const groups = groupByDay(
      lines,
      ['2026-12-03', '2026-12-04'],
      l => occupied[l.id],
    );
    expect(groups.map(g => [g.day, g.items.map(i => i.id)])).toEqual([
      ['2026-12-03', ['a', 'b']],
      ['2026-12-04', ['c']],
    ]);
  });
});

describe('the printed page', () => {
  it('never carries note text, observations or the hypothesis note by default', () => {
    const html = pageHtml();
    for (const marker of Object.values(TEXT)) {
      expect(html).not.toContain(marker);
    }
    expect(html).toContain('Las notas aparecen por su tipo y estado');
  });

  it('carries only the text of the sections a member included', () => {
    const html = pageHtml({includeText: {decision: true}});
    expect(html).toContain(TEXT.decision);
    expect(html).not.toContain(TEXT.incident);
    expect(html).toContain('Incluye el texto de: Decisiones.');
    const report = buildDayReport(input({includeText: {decision: true}}));
    expect(includedTextTitles(report)).toEqual(['Decisiones']);
    expect(noteTextSummary(report)).toBe('Incluye el texto de: Decisiones.');
  });

  it('states included note text at the top of the page itself, not only in the preview', () => {
    const withText = pageHtml({includeText: {decision: true}});
    const top = withText.indexOf('lx-dayp__textnote');
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(withText.indexOf('El día en cifras'));
    expect(pageHtml()).not.toContain('lx-dayp__textnote');
  });

  it('shows guests no notes or hypotheses, whatever is ticked', () => {
    const html = pageHtml({
      viewer: {...elvis, role: 'guest'},
      includeText: {incident: true, decision: true},
    });
    expect(html).not.toContain(TEXT.incident);
    expect(html).not.toContain(TEXT.decision);
    expect(html).not.toContain('Hipótesis aplicadas');
    expect(html).toContain('Visibles para el equipo');
  });

  it('quotes the threshold once, never says «verificada» and calls hypotheses hipótesis', () => {
    const html = pageHtml();
    expect(html.split('500 kg/m²').length - 1).toBe(1);
    expect(html).toContain(SUBSOIL_THRESHOLD_NOTE);
    expect(html).toContain('Terminó sin revisión del subsuelo declarada');
    expect(html).not.toMatch(/verificada/i);
    expect(html).toContain('<strong>Hipótesis</strong>');
    expect(html).toContain('OxEye ayuda a decidir; no certifica.');
  });
});
