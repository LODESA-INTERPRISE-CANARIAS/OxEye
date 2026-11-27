import {describe, expect, it} from 'vitest';
import {acronymFor} from '../../../shared/logistics/acronym';
import {
  planWarnings,
  type PlanWarning,
} from '../../../shared/logistics/conflicts';
import type {LogisticsEvent, Task} from '../../../shared/logistics/contracts';
import {
  bandVars,
  blockTimeParts,
  blockVars,
  clampColumnWidth,
  COLUMN,
  columnTracks,
  columnWarnings,
  frameTimeLabel,
  MAX_COLUMN_PREFS,
  maxColumnWidth,
  minuteToPx,
  nextColumnScroll,
  parseColumnPrefs,
  pxToMinute,
  withColumnPref,
} from '../../../src/logistics/calendar/layout';
import {
  buildDayIndex,
  layoutColumn,
  minutesInDay,
  monthCells,
  spanOnDate,
  weekBars,
  type Span,
} from '../../../src/logistics/lib/calendar';
import {sortTasks} from '../../../src/logistics/lib/tasks';

const CANARY = 'Atlantic/Canary';
const MADRID = 'Europe/Madrid';
/** December in Canarias is UTC+0, so the wall clock equals UTC. */
const at = (day: string, hhmm: string) => `2026-12-${day}T${hhmm}:00.000Z`;

const meta = {
  version: 1,
  createdBy: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedBy: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  source: null,
  verification: 'draft',
  isDemo: false,
} as const;

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    ...meta,
    id,
    organizationId: 'org',
    eventId: null,
    venue: {id: 'v-cristo', name: 'Plaza del Cristo'},
    title: id,
    kind: 'activity',
    status: 'planned',
    date: null,
    endDate: null,
    startsAt: null,
    endsAt: null,
    timezone: CANARY,
    company: null,
    contact: null,
    dependsOn: [],
    heavyLoad: false,
    notes: null,
    ...extra,
  } as Task;
}

function event(
  id: string,
  extra: Partial<LogisticsEvent> = {},
): LogisticsEvent {
  return {
    ...meta,
    id,
    organizationId: 'org',
    name: id,
    venue: null,
    date: null,
    endDate: null,
    startsAt: null,
    endsAt: null,
    timezone: CANARY,
    status: 'planned',
    notes: null,
    ...extra,
  } as LogisticsEvent;
}

/** A timed task on one December day (Canarias). */
const timed = (id: string, day: string, from: string, to: string | null) =>
  task(id, {
    date: `2026-12-${day}`,
    startsAt: at(day, from),
    endsAt: to ? at(day, to) : null,
  });

describe('minutesInDay', () => {
  it('counts local minutes from midnight and clamps to the day', () => {
    expect(minutesInDay(at('02', '09:30'), '2026-12-02', CANARY)).toBe(570);
    expect(minutesInDay(at('01', '23:00'), '2026-12-02', CANARY)).toBe(0);
    expect(minutesInDay(at('03', '01:00'), '2026-12-02', CANARY)).toBe(1440);
  });

  it('follows summer time (Europe/Madrid in July is UTC+2)', () => {
    // 08:00 UTC is 10:00 in Madrid.
    expect(minutesInDay('2026-07-15T08:00:00.000Z', '2026-07-15', MADRID)).toBe(
      600,
    );
    // 22:30 UTC is already 00:30 of the next local day.
    expect(minutesInDay('2026-07-15T22:30:00.000Z', '2026-07-16', MADRID)).toBe(
      30,
    );
    expect(minutesInDay('2026-07-15T22:30:00.000Z', '2026-07-15', MADRID)).toBe(
      1440,
    );
  });
});

describe('spanOnDate', () => {
  it('is null for a record without a start time', () => {
    expect(spanOnDate(task('a', {date: '2026-12-02'}), '2026-12-02')).toBe(
      null,
    );
  });

  it('draws a plain slot within its day', () => {
    expect(
      spanOnDate(timed('a', '02', '09:00', '11:30'), '2026-12-02'),
    ).toEqual({
      start: 540,
      end: 690,
      openEnd: false,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('splits an overnight slot (22:00–02:00) across both days', () => {
    const t = task('night', {
      date: '2026-12-02',
      startsAt: at('02', '22:00'),
      endsAt: at('03', '02:00'),
    });
    expect(spanOnDate(t, '2026-12-02')).toEqual({
      start: 1320,
      end: 1440,
      openEnd: false,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(spanOnDate(t, '2026-12-03')).toEqual({
      start: 0,
      end: 120,
      openEnd: false,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('ends the day at midnight without continuing when the end is 00:00', () => {
    const t = task('late', {
      date: '2026-12-02',
      startsAt: at('02', '20:00'),
      endsAt: at('03', '00:00'),
    });
    expect(spanOnDate(t, '2026-12-02')).toEqual({
      start: 1200,
      end: 1440,
      openEnd: false,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('fills the middle days of a multi-day slot', () => {
    const t = task('fair', {
      date: '2026-12-02',
      endDate: '2026-12-04',
      startsAt: at('02', '08:00'),
      endsAt: at('04', '18:00'),
    });
    expect(spanOnDate(t, '2026-12-02')).toMatchObject({
      start: 480,
      end: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(spanOnDate(t, '2026-12-03')).toEqual({
      start: 0,
      end: 1440,
      openEnd: false,
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(spanOnDate(t, '2026-12-04')).toEqual({
      start: 0,
      end: 1080,
      openEnd: false,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('gives a single-day open end a default length, capped at midnight', () => {
    expect(spanOnDate(timed('a', '02', '09:00', null), '2026-12-02')).toEqual({
      start: 540,
      end: 570,
      openEnd: true,
      continuesBefore: false,
      continuesAfter: false,
    });
    expect(
      spanOnDate(timed('b', '02', '23:50', null), '2026-12-02'),
    ).toMatchObject({start: 1430, end: 1440, openEnd: true});
  });

  it('runs a multi-day open end through every day, open only on the last', () => {
    const t = task('setup', {
      date: '2026-12-02',
      endDate: '2026-12-04',
      startsAt: at('02', '09:00'),
      endsAt: null,
    });
    expect(spanOnDate(t, '2026-12-02')).toEqual({
      start: 540,
      end: 1440,
      openEnd: false,
      continuesBefore: false,
      continuesAfter: true,
    });
    // Not a 30-minute block at midnight any more.
    expect(spanOnDate(t, '2026-12-03')).toEqual({
      start: 0,
      end: 1440,
      openEnd: false,
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(spanOnDate(t, '2026-12-04')).toEqual({
      start: 0,
      end: 1440,
      openEnd: true,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('uses the record time zone in summer (Europe/Madrid, July)', () => {
    const day = task('m', {
      timezone: MADRID,
      date: '2026-07-15',
      startsAt: '2026-07-15T06:00:00.000Z',
      endsAt: '2026-07-15T10:30:00.000Z',
    });
    expect(spanOnDate(day, '2026-07-15')).toMatchObject({start: 480, end: 750});
    // 22:00–02:00 local: the end is still 15 July in UTC.
    const night = task('n', {
      timezone: MADRID,
      date: '2026-07-15',
      startsAt: '2026-07-15T20:00:00.000Z',
      endsAt: '2026-07-16T00:00:00.000Z',
    });
    expect(spanOnDate(night, '2026-07-15')).toMatchObject({
      start: 1320,
      end: 1440,
      continuesAfter: true,
    });
    expect(spanOnDate(night, '2026-07-16')).toMatchObject({
      start: 0,
      end: 120,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('never draws an empty block', () => {
    expect(
      spanOnDate(timed('z', '02', '10:00', '10:00'), '2026-12-02'),
    ).toMatchObject({start: 600, end: 615});
  });
});

describe('layoutColumn', () => {
  it('packs overlapping blocks side by side and reuses free lanes', () => {
    const blocks = layoutColumn(
      [
        timed('A', '02', '09:00', '11:00'),
        timed('B', '02', '10:00', '12:00'),
        timed('C', '02', '11:00', '12:00'),
        timed('D', '02', '13:00', '14:00'),
        task('untimed', {date: '2026-12-02'}),
      ],
      '2026-12-02',
    );
    const by = Object.fromEntries(
      blocks.map(b => [b.task.id, {lane: b.lane, lanes: b.lanes}]),
    );
    expect(by).toEqual({
      // C starts when A ends: it takes A's lane back.
      A: {lane: 0, lanes: 2},
      B: {lane: 1, lanes: 2},
      C: {lane: 0, lanes: 2},
      // A separate cluster gets the full width.
      D: {lane: 0, lanes: 1},
    });
  });

  it('counts the minimum drawn height so short blocks do not cover each other', () => {
    const short = [
      timed('a', '02', '09:00', '09:05'),
      timed('b', '02', '09:10', '09:15'),
    ];
    expect(layoutColumn(short, '2026-12-02', 20).map(b => b.lanes)).toEqual([
      2, 2,
    ]);
    expect(layoutColumn(short, '2026-12-02', 5).map(b => b.lanes)).toEqual([
      1, 1,
    ]);
  });
});

describe('buildDayIndex', () => {
  it('puts multi-day and overnight records on every day they occupy', () => {
    const fair = event('fair', {
      date: '2026-12-02',
      endDate: '2026-12-04',
      startsAt: at('02', '10:00'),
      endsAt: at('04', '20:00'),
    });
    const night = task('night', {
      date: '2026-12-02',
      startsAt: at('02', '22:00'),
      endsAt: at('03', '02:00'),
    });
    const undated = task('undated');
    const index = buildDayIndex([fair], [night, undated], []);
    expect([...index.keys()].sort()).toEqual([
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
    ]);
    expect(index.get('2026-12-03')!.events).toEqual([fair]);
    expect(index.get('2026-12-03')!.tasks).toEqual([night]);
    expect(index.get('2026-12-04')!.tasks).toEqual([]);
  });

  it('places conflicts on shared days and reminders on every day', () => {
    const a = timed('a', '02', '09:00', '11:00');
    const b = timed('b', '02', '10:00', '12:00');
    // Depends on «prep» (next day) but is planned the day before.
    const prep = timed('prep', '03', '08:00', '10:00');
    const early = task('early', {
      venue: {id: 'v-other', name: 'Plaza del Adelantado'},
      date: '2026-12-02',
      startsAt: at('02', '23:00'),
      endsAt: at('02', '23:30'),
      dependsOn: ['prep'],
    });
    const heavy = task('stage', {
      kind: 'assembly',
      heavyLoad: true,
      venue: null,
      date: '2026-12-02',
      endDate: '2026-12-03',
    });
    const tasks = [a, b, prep, early, heavy];
    const index = buildDayIndex([], tasks, planWarnings(tasks, []));
    const kinds = (day: string, list: 'conflicts' | 'reminders') =>
      index
        .get(day)!
        [list].map(w => w.kind)
        .sort();
    expect(kinds('2026-12-02', 'conflicts')).toEqual([
      'dependency_order',
      'venue_overlap',
    ]);
    expect(kinds('2026-12-03', 'conflicts')).toEqual([]);
    expect(kinds('2026-12-02', 'reminders')).toEqual(['heavy_load']);
    expect(kinds('2026-12-03', 'reminders')).toEqual(['heavy_load']);
  });
});

describe('weekBars', () => {
  // Monday 30 November to Sunday 6 December 2026.
  const week = monthCells(2026, 11).slice(0, 7);

  it('starts the month grid on a Monday with six full weeks', () => {
    expect(week[0]).toBe('2026-11-30');
    expect(week[6]).toBe('2026-12-06');
    expect(monthCells(2026, 11)).toHaveLength(42);
  });

  it('stacks multi-day events in lanes and marks what continues', () => {
    const span = (id: string, from: string, to: string) =>
      event(id, {date: from, endDate: to});
    const bars = weekBars(
      [
        span('A', '2026-12-02', '2026-12-04'),
        span('B', '2026-12-03', '2026-12-09'),
        span('C', '2026-12-05', '2026-12-06'),
        event('single', {date: '2026-12-02'}),
        span('E', '2026-11-25', '2026-12-01'),
        span('outside', '2026-12-08', '2026-12-10'),
      ],
      week,
    );
    const by = Object.fromEntries(bars.map(b => [b.event.id, b]));
    expect(Object.keys(by).sort()).toEqual(['A', 'B', 'C', 'E']);
    expect(by.E).toMatchObject({
      start: 0,
      span: 2,
      lane: 0,
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(by.A).toMatchObject({start: 2, span: 3, lane: 0});
    expect(by.B).toMatchObject({
      start: 3,
      span: 4,
      lane: 1,
      continuesAfter: true,
    });
    // C starts the day after A ends: same lane.
    expect(by.C).toMatchObject({start: 5, span: 2, lane: 0});
  });
});

describe('sortTasks', () => {
  it('orders by day, timed before untimed, undated last, then title', () => {
    const list = [
      task('sin fecha'),
      task('b sin hora', {date: '2026-12-02'}),
      timed('tarde', '02', '18:00', '19:00'),
      timed('ayer', '01', '20:00', '21:00'),
      task('a sin hora', {date: '2026-12-02'}),
      timed('mañana', '02', '08:00', '09:00'),
    ];
    expect(sortTasks(list).map(t => t.id)).toEqual([
      'ayer',
      'mañana',
      'tarde',
      'a sin hora',
      'b sin hora',
      'sin fecha',
    ]);
  });
});

// ---------------------------------------------------------------- day timeline layout (Revisión 1)

const span = (start: number, end: number, extra: Partial<Span> = {}): Span => ({
  start,
  end,
  openEnd: false,
  continuesBefore: false,
  continuesAfter: false,
  ...extra,
});

const warning = (
  key: string,
  severity: PlanWarning['severity'],
  taskIds: string[],
): PlanWarning => ({
  key,
  kind: severity === 'conflict' ? 'venue_overlap' : 'heavy_load',
  severity,
  taskIds,
  minutes: null,
  title: key,
  detail: '',
});

describe('venue column preferences', () => {
  it('reads only well-formed entries and keeps widths within limits', () => {
    expect(parseColumnPrefs(null)).toEqual({});
    expect(parseColumnPrefs('not json')).toEqual({});
    expect(parseColumnPrefs('[1,2]')).toEqual({});
    expect(
      parseColumnPrefs(
        JSON.stringify({
          v1: {width: 250.4},
          v2: {collapsed: true},
          v3: {width: 20},
          v4: {width: 'wide', collapsed: 'yes'},
          v5: {width: 5000, collapsed: true},
        }),
      ),
    ).toEqual({
      v1: {width: 250},
      v2: {collapsed: true},
      v3: {width: COLUMN.min},
      v5: {width: COLUMN.max, collapsed: true},
    });
  });

  it('changes one venue, drops empty entries and keeps the newest', () => {
    let prefs = withColumnPref({}, 'v1', {width: 300});
    prefs = withColumnPref(prefs, 'v1', {collapsed: true});
    expect(prefs).toEqual({v1: {width: 300, collapsed: true}});
    prefs = withColumnPref(prefs, 'v1', {width: null});
    expect(prefs).toEqual({v1: {collapsed: true}});
    prefs = withColumnPref(prefs, 'v1', {collapsed: false});
    expect(prefs).toEqual({});

    let many = {};
    for (let i = 0; i < MAX_COLUMN_PREFS + 5; i++) {
      many = withColumnPref(many, `v${i}`, {collapsed: true});
    }
    const keys = Object.keys(many);
    expect(keys).toHaveLength(MAX_COLUMN_PREFS);
    expect(keys[0]).toBe('v5');
    expect(keys.at(-1)).toBe(`v${MAX_COLUMN_PREFS + 4}`);
  });
});

describe('venue column tracks', () => {
  it('never lets a hand-sized column outgrow the visible plan', () => {
    expect(maxColumnWidth(null)).toBe(COLUMN.max);
    expect(maxColumnWidth(400)).toBe(400);
    expect(maxColumnWidth(90)).toBe(COLUMN.min);
    expect(clampColumnWidth(900, 400)).toBe(400);
    expect(clampColumnWidth(10, 400)).toBe(COLUMN.min);
  });

  it('stretches automatic columns, fixes sized and collapsed ones', () => {
    const t = columnTracks(
      [
        {lanes: 1},
        {lanes: 2},
        {pref: {width: 260}, lanes: 3},
        {pref: {width: 260, collapsed: true}, lanes: 1},
      ],
      1000,
    );
    expect(t.columns).toEqual([
      'minmax(var(--lx-colw), 1fr)',
      'minmax(max(var(--lx-colw), calc(2 * var(--lx-lanew))), 1fr)',
      '260px',
      'var(--lx-colw-collapsed)',
    ]);
    expect(t.filler).toBe(false);
  });

  it('adds a filler when no column stretches', () => {
    expect(
      columnTracks(
        [
          {pref: {collapsed: true}, lanes: 1},
          {pref: {width: 900}, lanes: 1},
        ],
        500,
      ),
    ).toEqual({columns: ['var(--lx-colw-collapsed)', '500px'], filler: true});
    expect(columnTracks([], 500).filler).toBe(false);
  });
});

describe('stepping between venues', () => {
  // Columns start at 0, 190, 380, 570; 300 px of scroll at most.
  const starts = [0, 190, 380, 570];
  it('moves one venue right or left and stops at the ends', () => {
    expect(nextColumnScroll(starts, 0, 1, 300)).toBe(190);
    expect(nextColumnScroll(starts, 190, 1, 300)).toBe(300);
    expect(nextColumnScroll(starts, 300, 1, 300)).toBeNull();
    expect(nextColumnScroll(starts, 300, -1, 300)).toBe(190);
    expect(nextColumnScroll(starts, 100, -1, 300)).toBe(0);
    expect(nextColumnScroll(starts, 0, -1, 300)).toBeNull();
  });
});

describe('warnings per venue', () => {
  it('gives each column the warnings of its tasks, conflicts first', () => {
    const columns = [
      {tasks: [{id: 't1'}, {id: 't2'}]},
      {tasks: [{id: 't3'}]},
      {tasks: [{id: 't4'}]},
    ];
    const list = [
      warning('heavy', 'reminder', ['t1']),
      warning('overlap', 'conflict', ['t1', 't2']),
      warning('company', 'conflict', ['t2', 't3']),
    ];
    expect(columnWarnings(columns, list).map(ws => ws.map(w => w.key))).toEqual(
      [['overlap', 'company', 'heavy'], ['company'], []],
    );
  });
});

describe('timeline labels', () => {
  it('names the event frame hours for the header', () => {
    expect(frameTimeLabel(span(17 * 60, 21 * 60))).toBe('17:00 – 21:00');
    expect(frameTimeLabel(span(600, 1440, {continuesAfter: true}))).toBe(
      'desde 10:00',
    );
    expect(frameTimeLabel(span(0, 1200, {continuesBefore: true}))).toBe(
      'hasta 20:00',
    );
    expect(
      frameTimeLabel(
        span(0, 1440, {continuesBefore: true, continuesAfter: true}),
      ),
    ).toBe('todo el día');
    expect(frameTimeLabel(span(540, 570, {openEnd: true}))).toBe(
      '09:00 · fin pendiente',
    );
    expect(frameTimeLabel(span(1320, 1440))).toBe('22:00 – 24:00');
  });

  it('always leads a block with its start', () => {
    expect(blockTimeParts('08:00 – 13:00', span(480, 780))).toEqual({
      lead: '08:00',
      tail: ' – 13:00',
    });
    expect(
      blockTimeParts('22:00 – 02:00 (día siguiente)', span(1320, 1440)),
    ).toEqual({lead: '22:00', tail: ' – 02:00 (día siguiente)'});
    expect(
      blockTimeParts(
        '2 dic 22:00 – 3 dic 02:00',
        span(0, 120, {continuesBefore: true}),
      ),
    ).toEqual({lead: 'Sigue', tail: ' hasta 3 dic 02:00'});
    expect(blockTimeParts('09:00 – fin pendiente', span(540, 570))).toEqual({
      lead: '09:00',
      tail: ' – fin pendiente',
    });
  });

  it('acronyms fold venue names («Almacén Municipal» → «A.M.»)', () => {
    expect(acronymFor({name: 'Almacén Municipal'}, {dotted: true})).toBe(
      'A.M.',
    );
    expect(
      acronymFor({name: 'Almacén Municipal', acronym: 'ALM'}, {dotted: true}),
    ).toBe('ALM');
  });
});

describe('timeline geometry', () => {
  it('places blocks and bands with CSS variables', () => {
    const [block] = layoutColumn(
      [timed('a', '02', '08:00', '09:30')],
      '2026-12-02',
    );
    expect(blockVars(block)).toEqual({
      '--lx-s': 480,
      '--lx-e': 570,
      '--lx-lane': 0,
      '--lx-lanes': 1,
    });
    expect(bandVars(span(600, 720))).toEqual({'--lx-s': 600, '--lx-e': 720});
  });

  it('converts minutes and pixels, snapping to 5 minutes within the day', () => {
    expect(minuteToPx(90, 64)).toBe(96);
    expect(pxToMinute(96, 64)).toBe(90);
    expect(pxToMinute(99, 64)).toBe(95);
    expect(pxToMinute(-40, 64)).toBe(0);
    expect(pxToMinute(64 * 30, 64)).toBe(1440);
  });
});
