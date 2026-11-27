import {describe, expect, it} from 'vitest';
import {
  planWarnings,
  ROUTES_NO_LONGER_COINCIDES,
  ROUTES_REMINDER,
  UNSOLVED_BY_MOVING,
  type PlanEvent,
  type PlanTask,
} from '../../../shared/logistics/conflicts';
import {
  analyzeDelay,
  delayBlocker,
  delayModeFor,
  lateness,
  sameShift,
  shiftExpectations,
  suggestedDelay,
} from '../../../shared/logistics/followup';
import {hypothesisLabel} from '../../../shared/logistics/history';
import {mergeThreeWay, sameValue} from '../../../shared/logistics/merge';
import {
  isValidDelay,
  SUBSOIL_REVIEW_LABEL,
  SUBSOIL_REVIEW_NOTE,
} from '../../../shared/logistics/rules';
import {
  delayBudget,
  simulateDelay,
  type ScheduleItem,
} from '../../../shared/logistics/schedule';
import {daysForInstants} from '../../../shared/logistics/time';

// 2 Dec 2026 is winter time in the Canaries: UTC+0, so local = UTC here.
const at = (hhmm: string, day = '02') => `2026-12-${day}T${hhmm}:00.000Z`;
const cristo = {id: 'v-cristo', name: 'Plaza del Cristo'};
const adelantado = {id: 'v-adel', name: 'Plaza del Adelantado'};

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  kind: 'other',
  status: 'planned',
  eventId: null,
  venue: cristo,
  company: null,
  startsAt: null,
  endsAt: null,
  dependsOn: [],
  heavyLoad: false,
  ...extra,
});

const timed = (
  id: string,
  start: string,
  end: string,
  extra: Partial<PlanTask> = {},
) => task(id, {startsAt: at(start), endsAt: at(end), ...extra});

describe('follow-up · lateness', () => {
  const now = Date.parse(at('10:00'));

  it('a task whose start passed beyond the grace and has not started is late', () => {
    expect(
      lateness(
        {status: 'planned', startsAt: at('09:40'), endsAt: at('11:00')},
        now,
      ),
    ).toEqual({kind: 'late_start', minutes: 20});
    expect(
      lateness(
        {status: 'confirmed', startsAt: at('09:57'), endsAt: at('11:00')},
        now,
      ),
    ).toBeNull();
  });

  it('a task under way past its end overruns; finished, cancelled or untimed never are late', () => {
    expect(
      lateness(
        {status: 'in_progress', startsAt: at('08:00'), endsAt: at('09:30')},
        now,
      ),
    ).toEqual({kind: 'overrun', minutes: 30});
    for (const status of ['done', 'cancelled'] as const) {
      expect(
        lateness({status, startsAt: at('08:00'), endsAt: at('09:00')}, now),
      ).toBeNull();
    }
    expect(
      lateness({status: 'planned', startsAt: null, endsAt: null}, now),
    ).toBeNull();
  });

  it('suggests the delay already accrued, rounded up to five minutes', () => {
    const t = {
      status: 'planned' as const,
      startsAt: at('09:48'),
      endsAt: at('11:00'),
    };
    expect(suggestedDelay(t, now)).toBe(15);
    expect(suggestedDelay({...t, startsAt: at('09:59')}, now)).toBe(5);
    expect(suggestedDelay({...t, startsAt: at('12:00')}, now)).toBe(15);
  });

  it('under way → extend; finished, cancelled and untimed cannot be delayed', () => {
    expect(delayModeFor({status: 'in_progress'})).toBe('extend');
    expect(delayModeFor({status: 'planned'})).toBe('shift');
    expect(
      delayBlocker({
        status: 'done',
        startsAt: at('08:00'),
        endsAt: at('09:00'),
      }),
    ).toBe('finished');
    expect(
      delayBlocker({
        status: 'cancelled',
        startsAt: at('08:00'),
        endsAt: at('09:00'),
      }),
    ).toBe('cancelled');
    expect(
      delayBlocker({status: 'planned', startsAt: at('08:00'), endsAt: null}),
    ).toBe('untimed');
    expect(
      delayBlocker({
        status: 'planned',
        startsAt: at('08:00'),
        endsAt: at('09:00'),
      }),
    ).toBeNull();
  });

  it('accepts whole delays from one minute to one day', () => {
    expect(isValidDelay(15)).toBe(true);
    expect(isValidDelay(0)).toBe(false);
    expect(isValidDelay(2.5)).toBe(false);
    expect(isValidDelay(24 * 60 + 1)).toBe(false);
  });
});

describe('schedule · extend, fixed items and budget', () => {
  const item = (
    id: string,
    start: string,
    end: string,
    deps: string[] = [],
    extra: Partial<ScheduleItem> = {},
  ): ScheduleItem => ({
    id,
    label: id,
    startsAt: at(start),
    endsAt: at(end),
    lane: 'cristo',
    dependsOn: deps,
    ...extra,
  });

  it('extend keeps the start of the delayed item and moves its end and successors', () => {
    const items = [
      item('montaje', '08:00', '10:00'),
      item('prueba', '10:00', '10:30', ['montaje']),
    ];
    const r = simulateDelay(items, 'montaje', 20, 'extend');
    expect(r.shifted[0]).toMatchObject({
      id: 'montaje',
      deltaMinutes: 0,
      endDeltaMinutes: 20,
      startsAt: at('08:00'),
      endsAt: at('10:20'),
    });
    expect(r.shifted[1]).toMatchObject({
      id: 'prueba',
      deltaMinutes: 20,
      endsAt: at('10:50'),
    });
  });

  it('a fixed successor never moves', () => {
    const items = [
      item('camion', '08:00', '08:30'),
      item('descarga', '08:30', '09:00', ['camion'], {fixed: true}),
    ];
    const r = simulateDelay(items, 'camion', 15);
    expect(r.shifted.map(s => s.id)).toEqual(['camion']);
    expect(r.absorbed).toEqual([]);
  });

  it('budget = smallest gap to a live successor; null without one', () => {
    const items = [
      item('camion', '08:00', '08:30'),
      item('descarga', '08:40', '09:00', ['camion']),
      item('revision', '09:00', '09:10', ['camion']),
      item('hecha', '08:31', '08:35', ['camion'], {fixed: true}),
    ];
    expect(delayBudget(items, 'camion')).toBe(10);
    expect(delayBudget(items, 'revision')).toBeNull();
    expect(
      delayBudget(
        [item('a', '08:00', '09:00'), item('b', '08:30', '09:30', ['a'])],
        'a',
      ),
    ).toBe(0);
  });
});

describe('follow-up · delay analysis', () => {
  const evento: PlanEvent & {name: string} = {
    id: 'ev-navidad',
    name: 'Navidad Demo',
    startsAt: at('12:00'),
    endsAt: at('20:00'),
    status: 'confirmed',
    venue: cristo,
  };
  const plan = (): PlanTask[] => [
    timed('camion', '10:30', '11:00', {
      kind: 'delivery',
      eventId: evento.id,
      venue: adelantado,
    }),
    timed('descarga', '11:00', '11:30', {
      kind: 'assembly',
      eventId: evento.id,
      dependsOn: ['camion'],
      heavyLoad: true,
      subsoilReview: {by: {id: 'u1', displayName: 'Prueba'}, at: at('09:00')},
    }),
    timed('feria', '11:45', '12:30', {kind: 'activity', venue: cristo}),
  ];

  it('moves successors, re-runs the plan warnings and never changes the input', () => {
    const tasks = plan();
    const frozen = JSON.stringify(tasks);
    const a = analyzeDelay({
      tasks,
      events: [evento],
      rootId: 'camion',
      minutes: 30,
    });
    expect(JSON.stringify(tasks)).toBe(frozen);
    expect(a.impact.shifted.map(s => [s.id, s.deltaMinutes])).toEqual([
      ['camion', 30],
      ['descarga', 30],
    ]);
    // «descarga» now runs 11:30–12:00 and meets «feria» at the same venue.
    expect(a.newWarnings.map(w => w.kind)).toContain('venue_overlap');
    expect(a.budget).toBe(0);
  });

  it('a hypothesis never changes heavy load or the declared subsoil review', () => {
    const a = analyzeDelay({
      tasks: plan(),
      events: [evento],
      rootId: 'camion',
      minutes: 30,
    });
    const moved = a.tasks.find(t => t.id === 'descarga')!;
    expect(moved.heavyLoad).toBe(true);
    expect(moved.subsoilReview).toEqual(plan()[1].subsoilReview);
    expect(a.newWarnings.some(w => w.kind === 'heavy_load')).toBe(false);
  });

  it('pushing a delivery into the event window shows the routes A/B/C and Carpa Amarilla reminder', () => {
    const before = planWarnings(plan(), [evento]);
    expect(
      before.some(w => w.kind === 'route_window' && w.taskIds[0] === 'camion'),
    ).toBe(false);
    const a = analyzeDelay({
      tasks: plan(),
      events: [evento],
      rootId: 'camion',
      minutes: 90,
    });
    const routes = a.routeReminders.find(w => w.taskIds[0] === 'camion');
    expect(routes?.detail).toBe(ROUTES_REMINDER);
    expect(routes?.detail).toMatch(/Carpa Amarilla/);
    expect(a.newWarnings).toContainEqual(routes);
  });

  it('every moved vehicle, load-bearing or heavy task gets the routes reminder, inside the event or not', () => {
    // 10 min: nothing reaches the event window, both moved tasks still get it.
    const a = analyzeDelay({
      tasks: plan(),
      events: [evento],
      rootId: 'camion',
      minutes: 10,
    });
    expect(a.routeReminders.map(w => w.key)).toEqual([
      'routes-moved:camion',
      'routes-moved:descarga',
    ]);
    for (const w of a.routeReminders) expect(w.detail).toBe(ROUTES_REMINDER);
    // An activity without heavy load is not a routes check.
    const feria = analyzeDelay({
      tasks: plan(),
      events: [evento],
      rootId: 'feria',
      minutes: 10,
    });
    expect(feria.routeReminders).toEqual([]);
    // A known heavy load of any kind is.
    const heavy = analyzeDelay({
      tasks: [timed('tanque', '09:00', '09:30', {heavyLoad: true})],
      rootId: 'tanque',
      minutes: 15,
    });
    expect(heavy.routeReminders.map(w => w.key)).toEqual([
      'routes-moved:tanque',
    ]);
  });

  it('delaying out of the event never «clears» the routes: it is relabelled and kept', () => {
    // «descarga» runs into the event (11:00–11:30 → 12:15–12:45 with 75 min).
    const into = analyzeDelay({
      tasks: plan(),
      events: [evento],
      rootId: 'camion',
      minutes: 75,
    });
    expect(into.routeReminders.map(w => w.key)).toContain('routes:descarga');
    // A long delay pushes «camion» past the event's end (20:00).
    const late = [
      timed('camion', '19:30', '19:50', {
        kind: 'delivery',
        eventId: evento.id,
        venue: adelantado,
      }),
    ];
    expect(planWarnings(late, [evento]).map(w => w.key)).toContain(
      'routes:camion',
    );
    const out = analyzeDelay({
      tasks: late,
      events: [evento],
      rootId: 'camion',
      minutes: 60,
    });
    expect(out.clearedWarnings).toEqual([]);
    expect(out.routeReminders).toEqual([
      expect.objectContaining({
        key: 'routes-moved:camion',
        kind: 'route_window',
        title: `«camion»: ${ROUTES_NO_LONGER_COINCIDES}`,
        detail: ROUTES_REMINDER,
      }),
    ]);
    // Heavy-load reminders never appear among the cleared ones either.
    for (const a of [into, out]) {
      expect(a.clearedWarnings.some(w => UNSOLVED_BY_MOVING.has(w.kind))).toBe(
        false,
      );
    }
  });

  it('reports the margin left before the event, negative when it runs into it', () => {
    const a = analyzeDelay({
      tasks: plan(),
      events: [evento],
      rootId: 'camion',
      minutes: 45,
    });
    expect(a.eventMargins).toEqual([
      {
        eventId: 'ev-navidad',
        eventName: 'Navidad Demo',
        before: 30,
        after: -15,
      },
    ]);
  });

  it('extend on a task under way leaves its start and fixes other running tasks', () => {
    const tasks = [
      timed('montaje', '09:00', '10:00', {status: 'in_progress'}),
      timed('luces', '10:00', '10:30', {
        dependsOn: ['montaje'],
        status: 'in_progress',
        venue: adelantado,
      }),
      timed('sonido', '10:00', '10:30', {
        dependsOn: ['montaje'],
        venue: adelantado,
      }),
    ];
    const a = analyzeDelay({
      tasks,
      rootId: 'montaje',
      minutes: 15,
      mode: 'extend',
    });
    expect(a.impact.shifted.map(s => s.id)).toEqual(['montaje', 'sonido']);
    expect(a.tasks[0].startsAt).toBe(at('09:00'));
    // «luces» stays put and now starts before what it depends on.
    expect(
      a.newWarnings.some(
        w => w.kind === 'dependency_order' && w.taskIds[0] === 'luces',
      ),
    ).toBe(true);
  });

  it('the server applies only the exact shift that was confirmed', () => {
    const tasks = plan().map((t, i) => ({...t, version: i + 1}));
    const a = analyzeDelay({
      tasks,
      events: [evento],
      rootId: 'camion',
      minutes: 15,
    });
    const expected = shiftExpectations(a.impact, tasks);
    expect(expected).toEqual([
      {id: 'camion', version: 1, startsAt: at('10:45'), endsAt: at('11:15')},
      {id: 'descarga', version: 2, startsAt: at('11:15'), endsAt: at('11:45')},
    ]);
    expect(sameShift(expected, [...expected].reverse())).toBe(true);
    expect(
      sameShift(expected, [{...expected[0], version: 9}, expected[1]]),
    ).toBe(false);
    expect(sameShift(expected, expected.slice(0, 1))).toBe(false);
    // A duplicated id cannot stand in for a task that was never confirmed.
    expect(sameShift([expected[0], expected[0]], expected)).toBe(false);
    expect(
      sameShift(expected, [expected[0], {...expected[1], endsAt: at('11:50')}]),
    ).toBe(false);
  });
});

describe('follow-up · stored days after a shift', () => {
  it('same day, overnight and multi-day', () => {
    expect(daysForInstants(at('10:00'), at('11:00'))).toEqual({
      date: '2026-12-02',
      endDate: null,
    });
    expect(daysForInstants(at('23:30'), at('00:20', '03'))).toEqual({
      date: '2026-12-02',
      endDate: null,
    });
    expect(daysForInstants(at('10:00'), at('12:00', '04'))).toEqual({
      date: '2026-12-02',
      endDate: '2026-12-04',
    });
  });
});

describe('subsoil review · a declared mark', () => {
  const heavy = (extra: Partial<PlanTask> = {}) =>
    timed('escenario', '08:00', '10:00', {
      kind: 'assembly',
      heavyLoad: true,
      ...extra,
    });
  const review = {by: {id: 'u1', displayName: 'Prueba'}, at: at('07:00')};

  it('a live heavy task keeps its reminder until someone declares the review', () => {
    expect(planWarnings([heavy()]).map(w => w.kind)).toContain('heavy_load');
    expect(
      planWarnings([heavy({subsoilReview: review})]).map(w => w.kind),
    ).not.toContain('heavy_load');
  });

  it('finishing a heavy task is not reviewing it', () => {
    const w = planWarnings([heavy({status: 'done'})]);
    expect(w.map(x => x.kind)).toEqual(['heavy_load']);
    expect(w[0].title).toMatch(/sin revisión del subsuelo declarada/);
    expect(
      planWarnings([heavy({status: 'done', subsoilReview: review})]),
    ).toEqual([]);
  });

  it('the mark never quotes or computes a threshold and never claims compliance', () => {
    for (const text of [SUBSOIL_REVIEW_LABEL, SUBSOIL_REVIEW_NOTE]) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/kg|cumple|apto|seguro\b|certificad[oa]\b/i);
    }
    expect(SUBSOIL_REVIEW_NOTE).toMatch(/no certifica/);
  });
});

describe('merge · after a 409', () => {
  const base = {
    name: 'Carpa',
    venue: 'Cristo',
    ids: ['a'],
    heavy: null as boolean | null,
  };

  it('takes what only they changed and keeps what only I changed', () => {
    const r = mergeThreeWay(
      base,
      {...base, name: 'Carpa grande'},
      {...base, venue: 'Adelantado', ids: ['a', 'b']},
    );
    expect(r.merged).toEqual({
      name: 'Carpa grande',
      venue: 'Adelantado',
      ids: ['a', 'b'],
      heavy: null,
    });
    expect(r.fromTheirs.sort()).toEqual(['ids', 'venue']);
    expect(r.clashes).toEqual([]);
  });

  it('both changed the same field differently → a clash that keeps my value', () => {
    const r = mergeThreeWay(
      base,
      {...base, heavy: true},
      {...base, heavy: false},
    );
    expect(r.clashes).toEqual(['heavy']);
    expect(r.merged.heavy).toBe(true);
  });

  it('both changed it to the same value → no clash', () => {
    const r = mergeThreeWay(base, {...base, name: 'X'}, {...base, name: 'X'});
    expect(r).toEqual({
      merged: {...base, name: 'X'},
      clashes: [],
      fromTheirs: [],
    });
  });

  it('compares arrays and objects by value', () => {
    expect(sameValue(['a', {b: 1}], ['a', {b: 1}])).toBe(true);
    expect(sameValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});

describe('history · hypothesis label', () => {
  it('names the delay and the task, never the note', () => {
    expect(
      hypothesisLabel({
        delayMinutes: 15,
        mode: 'shift',
        estimated: true,
        taskTitle: 'Camión Demo',
      }),
    ).toBe('Retraso ≈ 15 min · Camión Demo');
    expect(
      hypothesisLabel({
        delayMinutes: 75,
        mode: 'extend',
        estimated: false,
        taskTitle: 'Montaje Demo',
      }),
    ).toBe('Se alarga 1 h 15 min · Montaje Demo');
  });
});
