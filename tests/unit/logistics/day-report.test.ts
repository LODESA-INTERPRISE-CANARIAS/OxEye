import {describe, expect, it} from 'vitest';
import {SUBSOIL_THRESHOLD_NOTE} from '../../../shared/logistics/conflicts';
import type {
  ActivityEntry,
  ConflictAcceptance,
  Contact,
  DelayHypothesis,
  LogisticsEvent,
  Note,
  Task,
} from '../../../shared/logistics/contracts';
import {
  buildDayReport,
  dayBounds,
  dayReportText,
  subsoilLineLabel,
  type DayReportInput,
} from '../../../shared/logistics/day-report';

const DAY = '2026-12-02';
const at = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;
const elvis = {id: 'u-elvis', displayName: 'Elvis'};
const dailos = {id: 'u-dailos', displayName: 'Dailos'};
const meta = (created = at('08:00'), by = elvis) => ({
  version: 1,
  createdBy: by,
  createdAt: created,
  updatedBy: by,
  updatedAt: created,
  source: null,
  verification: 'draft' as const,
  isDemo: false,
  organizationId: 'org',
});

// Free-text markers: never in a report unless a member includes that text.
const M = {
  incident: 'MARCA-TEXTO-INCIDENCIA',
  decision: 'MARCA-TEXTO-DECISION',
  earlier: 'MARCA-TEXTO-ANTERIOR',
  idea: 'MARCA-TEXTO-IDEA',
  plain: 'MARCA-TEXTO-NOTA',
  hypothesis: 'MARCA-NOTA-HIPOTESIS',
  taskNotes: 'MARCA-OBSERVACION-TAREA',
  contactNotes: 'MARCA-NOTAS-PERSONA',
  answer: 'MARCA-TEXTO-RESPUESTA',
  reason: 'MARCA-MOTIVO-ACEPTADO',
};

const event: LogisticsEvent = {
  ...meta(),
  id: 'ev',
  name: 'Navidad Demo',
  venue: {id: 'v-cristo', name: 'Plaza del Cristo'},
  date: DAY,
  endDate: null,
  startsAt: at('10:00'),
  endsAt: at('20:00'),
  timezone: 'Atlantic/Canary',
  status: 'confirmed',
  notes: null,
  restricted: false,
};

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...meta(at('07:00', '2026-12-01')),
  id,
  eventId: 'ev',
  venue: {id: 'v-cristo', name: 'Plaza del Cristo'},
  title: id,
  kind: 'assembly',
  status: 'planned',
  date: DAY,
  endDate: null,
  startsAt: at('09:00'),
  endsAt: at('11:00'),
  timezone: 'Atlantic/Canary',
  company: {id: 'co', name: 'Escenarios Demo'},
  contact: null,
  dependsOn: [],
  heavyLoad: false,
  resourceIds: [],
  subsoilReview: null,
  notes: M.taskNotes,
  restricted: false,
  ...extra,
});

const note = (id: string, extra: Partial<Note>): Note => ({
  ...meta(at('12:00')),
  id,
  kind: 'note',
  text: null,
  event: {id: 'ev', name: 'Navidad Demo'},
  ref: null,
  resolved: false,
  answer: null,
  resolvedBy: null,
  resolvedAt: null,
  restricted: false,
  ...extra,
});

const contact: Contact = {
  ...meta(at('11:00')),
  id: 'ct',
  name: 'Ana Demo',
  role: 'Coordinación',
  company: {id: 'co', name: 'Escenarios Demo'},
  phone: '+34 000 000 001',
  email: 'ana@example.com',
  description: null,
  notes: M.contactNotes,
  eventIds: [],
  restricted: false,
};

const hypothesis = (
  id: string,
  extra: Partial<DelayHypothesis>,
): DelayHypothesis => ({
  id,
  organizationId: 'org',
  taskId: 'stage',
  taskTitle: 'Escenario Demo',
  delayMinutes: 15,
  mode: 'shift',
  estimated: true,
  note: M.hypothesis,
  createdBy: elvis,
  createdAt: at('13:00'),
  appliedAt: null,
  appliedBy: null,
  restricted: false,
  ...extra,
});

const act = (
  entityType: string,
  entityId: string,
  action: ActivityEntry['action'],
  hhmm: string,
  user = elvis,
): ActivityEntry => ({
  id: `${entityType}-${entityId}-${action}-${hhmm}`,
  user,
  entityType,
  entityId,
  entityLabel: entityId,
  action,
  changedFields: [],
  at: at(hhmm),
});

const tasks = [
  task('stage', {heavyLoad: true, status: 'done', title: 'Escenario Demo'}),
  task('gen', {
    heavyLoad: true,
    title: 'Generador Demo',
    subsoilReview: {by: dailos, at: at('10:30')},
  }),
  task('truck', {
    kind: 'delivery',
    title: 'Camión Demo',
    startsAt: at('12:00'),
    endsAt: at('13:00'),
  }),
  task('fences', {
    kind: 'dismantling',
    heavyLoad: null,
    title: 'Vallas Demo',
    date: '2026-12-03',
    startsAt: at('08:00', '2026-12-03'),
    endsAt: at('10:00', '2026-12-03'),
  }),
  task('far', {
    title: 'Lejana Demo',
    date: '2026-12-09',
    startsAt: at('08:00', '2026-12-09'),
    endsAt: at('09:00', '2026-12-09'),
  }),
];

const notes = [
  note('n-inc', {kind: 'incident', text: M.incident}),
  note('n-dec', {kind: 'decision', text: M.decision}),
  note('n-idea', {kind: 'feature_idea', text: M.idea}),
  note('n-plain', {kind: 'note', text: M.plain}),
  note('n-old', {
    kind: 'open_question',
    text: M.earlier,
    ...meta(at('09:00', '2026-11-30')),
  }),
  note('n-old-done', {
    kind: 'incident',
    text: M.earlier,
    resolved: true,
    ...meta(at('09:00', '2026-11-30')),
  }),
];

const input = (extra: Partial<DayReportInput> = {}): DayReportInput => ({
  date: DAY,
  timezone: 'Atlantic/Canary',
  viewer: {...elvis, role: 'member'},
  generatedAt: at('20:00'),
  activity: [
    act('event', 'ev', 'create', '08:00'),
    act('event', 'ev', 'update', '09:00', dailos),
    act('contact', 'ct', 'create', '11:00'),
    act('task', 'truck', 'update', '12:30', dailos),
    act('task', 'gone', 'create', '14:00'),
    act('task', 'gone', 'delete', '15:00'),
    act('note', 'n-inc', 'create', '12:00'),
    act('hypothesis', 'h1', 'create', '13:00'),
    act('task', 'old', 'update', '09:00', elvis),
  ].map((a, i) => (i === 8 ? {...a, at: at('23:30', '2026-12-01')} : a)),
  events: [event],
  tasks,
  contacts: [contact],
  companies: [],
  offers: [],
  warehouses: [],
  resources: [],
  notes,
  hypotheses: [
    hypothesis('h1', {}),
    hypothesis('h2', {
      appliedAt: at('14:00'),
      appliedBy: elvis,
      createdAt: at('13:30'),
    }),
    hypothesis('h-old', {createdAt: at('13:00', '2026-11-30')}),
  ],
  ...extra,
});

describe('day report: what changed', () => {
  it('counts from the day activity, once per record', () => {
    const r = buildDayReport(input());
    expect(r.activityAvailable).toBe(true);
    expect(r.counts.event).toEqual({created: 1, modified: 0, deleted: 0});
    expect(r.counts.contact.created).toBe(1);
    // Created and deleted the same day: one create and one delete.
    expect(r.counts.task).toEqual({created: 1, modified: 1, deleted: 1});
    // An entry of the previous evening does not count.
    expect(r.contributors).toEqual([
      {user: elvis, changes: 6},
      {user: dailos, changes: 2},
    ]);
    expect(r.records.events.map(l => [l.id, l.change])).toEqual([
      ['ev', 'created'],
    ]);
    expect(r.records.tasks.map(l => [l.id, l.change, l.by.id])).toEqual([
      ['truck', 'modified', 'u-dailos'],
    ]);
    expect(r.records.contacts[0]).toMatchObject({
      label: 'Ana Demo',
      detail: 'Coordinación · Escenarios Demo',
    });
  });

  it('falls back to record times without activity (offline)', () => {
    const r = buildDayReport(input({activity: null}));
    expect(r.activityAvailable).toBe(false);
    expect(r.counts.event.created).toBe(1);
    expect(r.counts.contact.created).toBe(1);
    expect(r.counts.note.created).toBe(4);
    expect(r.counts.task.deleted).toBe(0);
  });

  it('reports pending information like the Hoy gauge', () => {
    const r = buildDayReport(input());
    // 1 event + 5 tasks + 1 contact, none validated.
    expect(r.pending).toMatchObject({
      total: 7,
      validated: 0,
      verifiedPercent: 0,
      pendingPercent: 100,
    });
    // Events and tasks first (what the day depends on), then the directory.
    expect(r.pending.incomplete.at(-1)!.type).toBe('contact');
    expect(r.pending.incomplete[0].type).toBe('task');
    expect(
      r.pending.incomplete.every(i => i.missing.includes('validación')),
    ).toBe(true);
  });

  it('lists what is still open today and the next two days', () => {
    const r = buildDayReport(input());
    expect(r.unfinished.map(t => t.id)).toEqual(['gen', 'truck']);
    expect(r.nextTasks.map(t => t.id)).toEqual(['fences']);
  });
});

describe('day report: notes', () => {
  it('lists notes by label and status, without text by default', () => {
    const r = buildDayReport(input());
    const json = JSON.stringify(r);
    for (const marker of Object.values(M)) expect(json).not.toContain(marker);
    const inc = r.notes!.find(s => s.kind === 'incident')!;
    expect(inc.items).toEqual([
      expect.objectContaining({
        id: 'n-inc',
        label: 'Incidencia · Navidad Demo',
        status: 'Abierta',
        text: null,
        earlier: false,
      }),
    ]);
    // Still-open questions from earlier days come along; resolved ones not.
    const q = r.notes!.find(s => s.kind === 'open_question')!;
    expect(q.items.map(i => [i.id, i.earlier, i.status])).toEqual([
      ['n-old', true, 'Sin respuesta'],
    ]);
    expect(r.otherNotes).toBe(1);
  });

  it('includes a section text only when a member ticks it', () => {
    const r = buildDayReport(input({includeText: {decision: true}}));
    const dec = r.notes!.find(s => s.kind === 'decision')!;
    expect(dec.textIncluded).toBe(true);
    expect(dec.items[0].text).toBe(M.decision);
    expect(JSON.stringify(r)).not.toContain(M.incident);
    // The copied summary never carries note text.
    expect(dayReportText(r, '2 dic')).not.toContain(M.decision);
  });

  it('gives a guest no notes and no hypotheses at all', () => {
    const guestNotes = notes.map(n => ({...n, text: null, restricted: true}));
    const r = buildDayReport(
      input({
        viewer: {id: 'u-guest', displayName: 'Invitado', role: 'guest'},
        notes: guestNotes,
        includeText: {incident: true, decision: true},
      }),
    );
    expect(r.notes).toBeNull();
    expect(r.otherNotes).toBeNull();
    expect(r.hypotheses).toBeNull();
    expect(JSON.stringify(r)).not.toContain('Incidencia');
  });
});

describe('day report: open questions (E3)', () => {
  const answer = (hhmm: string, day = DAY) => ({
    id: `a-${hhmm}`,
    noteId: 'q',
    text: M.answer,
    answeredBy: dailos,
    answeredAt: at(hhmm, day),
    replacesId: null,
    restricted: false,
  });
  const questions = [
    note('q-answered', {kind: 'open_question', answer: answer('15:00')}),
    note('q-closed', {
      kind: 'open_question',
      ...meta(at('09:00', '2026-11-30')),
      answer: answer('10:00', '2026-12-01'),
      resolved: true,
      resolvedBy: elvis,
      resolvedAt: at('16:00'),
    }),
    note('q-closed-before', {
      kind: 'open_question',
      ...meta(at('09:00', '2026-11-30')),
      resolved: true,
      resolvedBy: elvis,
      resolvedAt: at('16:00', '2026-12-01'),
    }),
  ];

  it('shows the answered state, who answered and who closed it', () => {
    const r = buildDayReport(input({notes: questions}));
    const q = r.notes!.find(s => s.kind === 'open_question')!;
    expect(
      q.items.map(i => [
        i.id,
        i.status,
        i.answer?.by.id ?? null,
        i.closedBy?.id ?? null,
      ]),
    ).toEqual([
      ['q-answered', 'Con respuesta', 'u-dailos', null],
      // Closed that day: it comes along even though it was asked earlier.
      ['q-closed', 'Respondida', 'u-dailos', 'u-elvis'],
    ]);
    expect(q.items[1].closedAt).toBe(at('16:00'));
    // No answer text unless the section's text is included.
    expect(JSON.stringify(r)).not.toContain(M.answer);
  });

  it('gives the answer text under «Incluir el texto», never to guests', () => {
    const r = buildDayReport(
      input({notes: questions, includeText: {open_question: true}}),
    );
    const q = r.notes!.find(s => s.kind === 'open_question')!;
    expect(q.items[0].answer!.text).toBe(M.answer);
    expect(dayReportText(r, '2 dic')).not.toContain(M.answer);
    const guest = buildDayReport(
      input({
        viewer: {id: 'u-guest', displayName: 'Invitado', role: 'guest'},
        notes: questions,
        includeText: {open_question: true},
      }),
    );
    expect(JSON.stringify(guest)).not.toContain(M.answer);
  });
});

describe('day report: accepted conflicts (E2)', () => {
  const a = task('a', {title: 'Montaje Demo'});
  const b = task('b', {title: 'Reparto Demo', startsAt: at('10:00')});
  const acceptance = (extra: Partial<ConflictAcceptance> = {}) => ({
    id: 'acc',
    organizationId: 'org',
    warningKey: 'venue:a:b',
    windows: [
      {taskId: 'a', startsAt: a.startsAt!, endsAt: a.endsAt!},
      {taskId: 'b', startsAt: b.startsAt!, endsAt: b.endsAt!},
    ],
    reason: M.reason,
    acceptedBy: dailos,
    acceptedAt: at('17:00'),
    restricted: false,
    ...extra,
  });

  it('lists the day decisions with who and when; the reason only when included', () => {
    const r = buildDayReport(
      input({tasks: [a, b], acceptances: [acceptance()]}),
    );
    expect(r.accepted).toEqual([
      expect.objectContaining({
        id: 'acc',
        by: dailos,
        at: at('17:00'),
        applies: true,
        reason: null,
        taskIds: ['a', 'b'],
      }),
    ]);
    expect(JSON.stringify(r)).not.toContain(M.reason);
    const shown = buildDayReport(
      input({
        tasks: [a, b],
        acceptances: [acceptance()],
        includeText: {decision: true},
      }),
    );
    expect(shown.accepted[0].reason).toBe(M.reason);
    expect(dayReportText(shown, '2 dic')).not.toContain(M.reason);
    expect(dayReportText(shown, '2 dic')).toContain('(Dailos)');
  });

  it('says when it no longer applies and names the tasks', () => {
    const moved = {...b, startsAt: at('11:30'), endsAt: at('12:00')};
    const r = buildDayReport(
      input({tasks: [a, moved], acceptances: [acceptance()]}),
    );
    expect(r.accepted[0]).toMatchObject({
      applies: false,
      label: 'Conflicto entre Montaje Demo y Reparto Demo',
      tasks: 'Montaje Demo y Reparto Demo',
    });
    expect(dayReportText(r, '2 dic')).toContain(
      '- Conflicto entre Montaje Demo y Reparto Demo (',
    );
    expect(dayReportText(r, '2 dic')).toContain('ya no aplica');
  });

  it('leaves out other days and never shows a guest the reason', () => {
    const other = acceptance({
      id: 'old',
      acceptedAt: at('17:00', '2026-12-01'),
    });
    const guest = buildDayReport(
      input({
        viewer: {id: 'u-guest', displayName: 'Invitado', role: 'guest'},
        tasks: [a, b],
        acceptances: [acceptance({reason: null, restricted: true}), other],
        includeText: {decision: true},
      }),
    );
    expect(guest.accepted.map(l => [l.id, l.reason])).toEqual([['acc', null]]);
  });
});

describe('day report: hypotheses', () => {
  it('keeps open and applied apart, by label only', () => {
    const r = buildDayReport(input());
    expect(r.hypotheses!.open.map(h => h.id)).toEqual(['h1']);
    expect(r.hypotheses!.applied.map(h => h.id)).toEqual(['h2']);
    expect(r.hypotheses!.open[0].label).toBe(
      'Retraso ≈ 15 min · Escenario Demo',
    );
    expect(JSON.stringify(r)).not.toContain(M.hypothesis);
    expect(dayReportText(r, '2 dic')).toContain(
      '- Hipótesis: Retraso ≈ 15 min · Escenario Demo',
    );
  });
});

describe('day report: safety', () => {
  it('never lets a finished heavy task drop its pending review', () => {
    const r = buildDayReport(input());
    expect(r.safety.subsoil.map(s => [s.taskId, s.state])).toEqual([
      ['stage', 'finished_unreviewed'],
      ['fences', 'unknown_load'],
      ['gen', 'declared'],
    ]);
    const declared = r.safety.subsoil.find(s => s.state === 'declared')!;
    expect(subsoilLineLabel(declared)).toBe(
      'Revisión del subsuelo declarada por Dailos',
    );
    expect(JSON.stringify(r).toLowerCase()).not.toContain('verificad');
  });

  it('reminds routes A/B/C and Carpa Amarilla for a delivery in the event window', () => {
    const r = buildDayReport(input());
    expect(r.safety.routes.some(w => w.taskIds.includes('truck'))).toBe(true);
    expect(r.safety.routesNote).toContain('Carpa Amarilla');
  });

  it('quotes the threshold only through SUBSOIL_THRESHOLD_NOTE', () => {
    const r = buildDayReport(input());
    expect(r.safety.thresholdNote).toBe(SUBSOIL_THRESHOLD_NOTE);
    const rest = JSON.stringify({
      ...r,
      safety: {...r.safety, thresholdNote: ''},
    });
    expect(rest).not.toContain('kg/m');
  });
});

describe('day report: bounds and text', () => {
  it('uses the local day in Atlantic/Canary (winter and summer)', () => {
    expect(dayBounds(DAY, 'Atlantic/Canary')).toEqual({
      from: '2026-12-02T00:00:00.000Z',
      to: '2026-12-03T00:00:00.000Z',
    });
    expect(dayBounds('2026-07-15', 'Atlantic/Canary').from).toBe(
      '2026-07-14T23:00:00.000Z',
    );
  });

  it('summarises counts in plain words', () => {
    const text = dayReportText(
      buildDayReport(input()),
      'miércoles 2 de diciembre',
    );
    expect(text).toContain('Cierre de jornada · miércoles 2 de diciembre');
    expect(text).toContain('1 evento (1 de alta)');
    expect(text).toContain('Información pendiente de verificar: 100 %.');
    expect(text).toContain('no certifica');
    expect(text).not.toContain(M.taskNotes);
    expect(text).not.toContain('+34');
  });
});
