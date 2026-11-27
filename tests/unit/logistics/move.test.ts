import {describe, expect, it} from 'vitest';
import {
  acceptanceApplies,
  acceptanceFor,
  isAcceptable,
  sameWindows,
  splitAccepted,
  windowsFor,
} from '../../../shared/logistics/acceptance';
import {
  planWarnings,
  ROUTES_REMINDER,
  SUBSOIL_THRESHOLD_NOTE,
  type PlanEvent,
  type PlanTask,
} from '../../../shared/logistics/conflicts';
import type {ConflictAcceptance} from '../../../shared/logistics/contracts';
import {FIELD_LABEL} from '../../../shared/logistics/history';
import {
  analyzeMove,
  MOVE_BLOCKED,
  moveBlocker,
  moveItems,
  openingHoursLabel,
  openingHoursProblem,
  outsideHoursMessage,
  withinOpeningHours,
} from '../../../shared/logistics/move';
import {withholdFor} from '../../../shared/logistics/redaction';
import {
  ROUTES_HELP,
  SUBSOIL_HELP,
} from '../../../src/logistics/moves/MoveSheet';
import {
  ACCEPT_REASON_MAX,
  ACCEPT_REASON_MIN,
  isValidMove,
  MEDIA_MAX_BYTES,
  MEDIA_PER_RECORD,
  MOVE_STEP_MINUTES,
} from '../../../shared/logistics/rules';
import {
  simulateDelay,
  simulateMove,
  type ScheduleItem,
} from '../../../shared/logistics/schedule';
import {listsToReload, SYNC_LISTS} from '../../../shared/logistics/sync';

// December in the Canaries is UTC+0, so local = UTC here.
const at = (hhmm: string, day = '10') => `2026-12-${day}T${hhmm}:00.000Z`;
const plaza = {id: 'v-plaza', name: 'Plaza del Adelantado'};

const item = (
  id: string,
  start: string,
  end: string,
  extra: Partial<ScheduleItem> = {},
): ScheduleItem => ({
  id,
  label: id,
  startsAt: at(start),
  endsAt: at(end),
  lane: 'v-plaza',
  dependsOn: [],
  ...extra,
});

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  kind: 'other',
  status: 'planned',
  eventId: null,
  venue: plaza,
  company: null,
  startsAt: at('09:00'),
  endsAt: at('10:00'),
  dependsOn: [],
  heavyLoad: false,
  ...extra,
});

describe('rules for moves, acceptances and images', () => {
  it('moves are signed whole multiples of five minutes, at most a day', () => {
    expect(MOVE_STEP_MINUTES).toBe(5);
    for (const ok of [5, -5, 30, -60, 1440, -1440]) {
      expect(isValidMove(ok)).toBe(true);
    }
    for (const bad of [0, 7, -3, 1445, 2.5, Number.NaN]) {
      expect(isValidMove(bad)).toBe(false);
    }
  });

  it('limits for reasons and images', () => {
    expect([ACCEPT_REASON_MIN, ACCEPT_REASON_MAX]).toEqual([3, 280]);
    expect(MEDIA_PER_RECORD).toBe(5);
    // Resized photos are < 400 KB; the server accepts up to 600 KB.
    expect(MEDIA_MAX_BYTES).toBe(600 * 1024);
  });

  it('history names the new fields in Spanish', () => {
    expect(FIELD_LABEL.acronym).toBe('siglas');
    expect(FIELD_LABEL.openingHours).toBe('horario');
    expect(FIELD_LABEL.answer).toBe('respuesta');
    expect(FIELD_LABEL.media).toBe('fotos');
  });
});

describe('simulateMove', () => {
  const chain = () => [
    item('A', '09:00', '10:00'),
    item('B', '10:00', '11:00', {dependsOn: ['A']}),
    item('C', '12:00', '13:00', {dependsOn: ['B']}),
  ];

  it('later is exactly a shift delay: dependants out of slack move too', () => {
    const move = simulateMove(chain(), 'A', 30);
    expect(move).toEqual(simulateDelay(chain(), 'A', 30, 'shift'));
    expect(move.shifted.map(s => [s.id, s.startsAt])).toEqual([
      ['A', at('09:30')],
      ['B', at('10:30')],
    ]);
    // C had an hour of slack: absorbed.
    expect(move.absorbed.map(a => a.id)).toEqual(['C']);
  });

  it('earlier moves only the root; dependants are never pulled earlier', () => {
    const move = simulateMove(chain(), 'A', -30);
    expect(move.delayMinutes).toBe(-30);
    expect(move.shifted).toEqual([
      {
        id: 'A',
        label: 'A',
        deltaMinutes: -30,
        endDeltaMinutes: -30,
        startsAt: at('08:30'),
        endsAt: at('09:30'),
        slackBefore: null,
      },
    ]);
    expect(move.absorbed).toEqual([]);
  });

  it('earlier reports overlaps it creates', () => {
    const items = [item('A', '09:00', '10:00'), item('B', '10:30', '11:30')];
    expect(simulateMove(items, 'B', -60).newOverlaps).toEqual([
      {a: 'A', b: 'B', lane: 'v-plaza', minutes: 30},
    ]);
  });

  it('fixed and cancelled items never move, as root or as dependant', () => {
    const items = [
      item('A', '09:00', '10:00'),
      item('B', '10:00', '11:00', {dependsOn: ['A'], fixed: true}),
    ];
    expect(simulateMove(items, 'A', 30).shifted.map(s => s.id)).toEqual(['A']);
    expect(simulateMove(items, 'B', 30).shifted).toEqual([]);
    expect(simulateMove(items, 'B', -30).shifted).toEqual([]);
    const cancelled = [item('A', '09:00', '10:00', {cancelled: true})];
    expect(simulateMove(cancelled, 'A', -30).shifted).toEqual([]);
  });

  it('zero, unknown roots and untimed roots move nothing', () => {
    expect(simulateMove(chain(), 'A', 0).shifted).toEqual([]);
    expect(simulateMove(chain(), 'Z', 30).shifted).toEqual([]);
    const untimed = [{...item('A', '09:00', '10:00'), endsAt: null}];
    expect(simulateMove(untimed, 'A', -30)).toMatchObject({
      shifted: [],
      unknown: ['A'],
    });
  });

  it('never mutates its input', () => {
    const items = chain();
    const copy = structuredClone(items);
    simulateMove(items, 'A', -30);
    simulateMove(items, 'A', 30);
    expect(items).toEqual(copy);
  });
});

describe('what can move', () => {
  it('finished, cancelled, under way and untimed tasks cannot', () => {
    expect(moveBlocker(task('a'))).toBeNull();
    expect(moveBlocker(task('a', {status: 'delayed'}))).toBeNull();
    expect(moveBlocker(task('a', {status: 'done'}))).toBe('finished');
    expect(moveBlocker(task('a', {status: 'cancelled'}))).toBe('cancelled');
    expect(moveBlocker(task('a', {status: 'in_progress'}))).toBe('in_progress');
    expect(moveBlocker(task('a', {endsAt: null}))).toBe('untimed');
    for (const message of Object.values(MOVE_BLOCKED)) {
      expect(message).toMatch(/^Esa tarea/);
    }
  });

  it('moveItems: lanes are venues; under way and done are fixed (root too)', () => {
    const items = moveItems([
      task('a'),
      task('b', {status: 'in_progress'}),
      task('c', {status: 'done', venue: null}),
      task('d', {status: 'cancelled'}),
    ]);
    expect(items.map(i => [i.id, i.lane, !!i.fixed, !!i.cancelled])).toEqual([
      ['a', 'v-plaza', false, false],
      ['b', 'v-plaza', true, false],
      ['c', null, true, false],
      ['d', 'v-plaza', false, true],
    ]);
  });
});

describe('opening hours', () => {
  const hours = {opensAt: '08:00', closesAt: '20:00'};
  const w = (start: string, end: string, sd = '10', ed = sd) => ({
    startsAt: at(start, sd),
    endsAt: at(end, ed),
  });

  it('validates a daily window without crossing midnight', () => {
    expect(openingHoursProblem(hours)).toBeNull();
    expect(openingHoursProblem({opensAt: '20:00', closesAt: '08:00'})).toMatch(
      /anterior/,
    );
    expect(openingHoursProblem({opensAt: '08:00', closesAt: '08:00'})).toMatch(
      /anterior/,
    );
    expect(openingHoursProblem({opensAt: '8:00', closesAt: '20:00'})).toMatch(
      /HH:MM/,
    );
    expect(openingHoursLabel(hours)).toBe('08:00–20:00');
    expect(openingHoursLabel(null)).toBe('Pendiente de verificar');
  });

  it('a window fits when it starts at or after opening and ends at or before closing', () => {
    expect(withinOpeningHours(w('08:00', '20:00'), hours)).toBe(true);
    expect(withinOpeningHours(w('07:55', '09:00'), hours)).toBe(false);
    expect(withinOpeningHours(w('19:00', '20:05'), hours)).toBe(false);
    expect(withinOpeningHours(w('20:00', '21:00'), hours)).toBe(false);
    // Overnight never fits a day window.
    expect(withinOpeningHours(w('19:00', '01:00', '10', '11'), hours)).toBe(
      false,
    );
    // Several days: checked on the first and last day.
    expect(withinOpeningHours(w('09:00', '19:00', '10', '12'), hours)).toBe(
      true,
    );
  });

  it('an end at midnight is 24:00 of the day before', () => {
    const late = {opensAt: '18:00', closesAt: '23:59'};
    expect(withinOpeningHours(w('22:00', '00:00', '10', '11'), late)).toBe(
      false,
    );
    expect(withinOpeningHours(w('22:00', '23:59'), late)).toBe(true);
  });

  it('unknown hours or times never limit anything', () => {
    expect(withinOpeningHours(w('03:00', '04:00'), null)).toBe(true);
    expect(
      withinOpeningHours({startsAt: null, endsAt: at('04:00')}, hours),
    ).toBe(true);
  });

  it('uses the organization’s time zone (summer time is UTC+1 in the Canaries)', () => {
    // 07:30Z on 1 July is 08:30 local: inside.
    const july = {
      startsAt: '2026-07-01T07:30:00.000Z',
      endsAt: '2026-07-01T08:30:00.000Z',
    };
    expect(withinOpeningHours(july, hours, 'Atlantic/Canary')).toBe(true);
    expect(withinOpeningHours(july, hours, 'UTC')).toBe(false);
  });

  it('the refusal names the place and the hours', () => {
    expect(outsideHoursMessage('Nave Municipal', hours)).toBe(
      '«Nave Municipal» abre de 08:00 a 20:00: la tarea quedaría fuera de ese horario.',
    );
  });
});

describe('analyzeMove: the preview re-runs the plan warnings', () => {
  const event: PlanEvent & {name: string} = {
    id: 'ev',
    name: 'Concierto Prueba',
    startsAt: at('11:00'),
    endsAt: at('14:00'),
    status: 'planned',
    venue: plaza,
  };

  it('shows new and cleared conflicts, and route and subsoil reminders of what moves', () => {
    const tasks = [
      task('truck', {
        title: 'Camión Prueba',
        kind: 'delivery',
        eventId: 'ev',
        startsAt: at('09:00'),
        endsAt: at('10:00'),
        heavyLoad: true,
      }),
      task('stage', {
        title: 'Escenario Prueba',
        startsAt: at('10:00'),
        endsAt: at('11:00'),
      }),
    ];
    const later = analyzeMove({
      tasks,
      events: [event],
      rootId: 'truck',
      minutes: 30,
    });
    expect(later.impact.shifted.map(s => s.id)).toEqual(['truck']);
    expect(later.newWarnings.map(w => w.kind)).toContain('venue_overlap');
    // Outside the event a vehicle still gets the fixed routes reminder.
    expect(later.routeReminders.map(w => w.key)).toEqual([
      'routes-moved:truck',
    ]);
    expect(later.routeReminders[0]?.detail).toBe(ROUTES_REMINDER);
    // Pushed into the event window: the route reminder is shown.
    const intoEvent = analyzeMove({
      tasks,
      events: [event],
      rootId: 'truck',
      minutes: 120,
    });
    expect(intoEvent.routeReminders.map(w => w.key)).toEqual(['routes:truck']);
    expect(intoEvent.routeReminders[0]?.detail).toContain(ROUTES_REMINDER);
    // Heavy load stays a reminder in every preview; the threshold is only quoted.
    for (const a of [later, intoEvent]) {
      expect(a.subsoilReminders.map(w => w.key)).toEqual(['heavy:truck']);
      expect(a.subsoilReminders[0]?.detail).toContain(SUBSOIL_THRESHOLD_NOTE);
    }
    // Moving back earlier clears a conflict.
    const clash = [
      task('a', {startsAt: at('09:00'), endsAt: at('10:00')}),
      task('b', {startsAt: at('09:30'), endsAt: at('10:30')}),
    ];
    const advance = analyzeMove({tasks: clash, rootId: 'a', minutes: -30});
    expect(advance.clearedWarnings.map(w => w.key)).toEqual(['venue:a:b']);
    expect(advance.tasks.find(t => t.id === 'a')?.startsAt).toBe(at('08:30'));
    expect(clash[0]?.startsAt).toBe(at('09:00'));
    // Tasks without vehicles, load-bearing work or heavy load get none.
    expect(advance.routeReminders).toEqual([]);
  });

  it('the move sheet help quotes the threshold only through SUBSOIL_THRESHOLD_NOTE', () => {
    expect(SUBSOIL_HELP).toContain(SUBSOIL_THRESHOLD_NOTE);
    expect(SUBSOIL_HELP.split('500').length).toBe(2);
    // The routes block shows on every move of a vehicle, load-bearing work or heavy load.
    expect(ROUTES_HELP).toContain(
      'aparece siempre que se mueve una tarea con vehículos o carga',
    );
  });

  it('moving out of the event never «solves» the routes: it says so and keeps the reminder', () => {
    const tasks = [
      task('crane', {
        title: 'Grúa Prueba',
        kind: 'assembly',
        startsAt: at('12:00'),
        endsAt: at('13:00'),
      }),
      task('generator', {
        title: 'Generador Prueba',
        heavyLoad: true,
        startsAt: at('15:00'),
        endsAt: at('16:00'),
        venue: {id: 'v-nave', name: 'Nave'},
      }),
    ];
    expect(planWarnings(tasks, [event]).map(w => w.key)).toContain(
      'routes:crane',
    );
    const out = analyzeMove({
      tasks,
      events: [event],
      rootId: 'crane',
      minutes: 180,
    });
    expect(out.clearedWarnings).toEqual([]);
    expect(out.routeReminders).toEqual([
      expect.objectContaining({
        key: 'routes-moved:crane',
        kind: 'route_window',
        title:
          '«Grúa Prueba»: Ya no coincide con el evento; revísalo igualmente en el simulador.',
        detail: ROUTES_REMINDER,
      }),
    ]);
    // A known heavy load of any kind gets it too; heavy-load reminders never clear.
    const heavy = analyzeMove({
      tasks,
      events: [event],
      rootId: 'generator',
      minutes: 30,
    });
    expect(heavy.routeReminders.map(w => w.key)).toEqual([
      'routes-moved:generator',
    ]);
    expect(heavy.subsoilReminders.map(w => w.key)).toEqual(['heavy:generator']);
    expect(
      heavy.clearedWarnings.some(w => w.kind.startsWith('heavy_load')),
    ).toBe(false);
  });

  it('lists moved tasks that fall outside their venue’s known hours (root and dependants)', () => {
    const tasks = [
      task('a', {startsAt: at('18:00'), endsAt: at('19:00')}),
      task('b', {
        startsAt: at('19:00'),
        endsAt: at('20:00'),
        dependsOn: ['a'],
        venue: {id: 'v-nave', name: 'Nave'},
      }),
    ];
    const venues = [
      {
        id: 'v-plaza',
        name: 'Plaza',
        openingHours: {opensAt: '08:00', closesAt: '22:00'},
      },
      {
        id: 'v-nave',
        name: 'Nave',
        openingHours: {opensAt: '08:00', closesAt: '20:00'},
      },
    ];
    const a = analyzeMove({tasks, venues, rootId: 'a', minutes: 30});
    expect(a.outsideHours).toEqual(['b']);
    // Ending exactly at closing time still fits.
    expect(
      analyzeMove({tasks, venues, rootId: 'a', minutes: 180}).outsideHours,
    ).toEqual(['b']);
    const b = analyzeMove({tasks, venues, rootId: 'a', minutes: 240});
    expect(b.outsideHours).toEqual(['a', 'b']);
    expect(
      analyzeMove({tasks, rootId: 'a', minutes: 240}).outsideHours,
    ).toEqual([]);
  });
});

describe('accepted conflicts', () => {
  const tasks = [
    task('a', {startsAt: at('09:00'), endsAt: at('11:00')}),
    task('b', {startsAt: at('10:00'), endsAt: at('12:00')}),
    task('h', {heavyLoad: true, venue: null}),
  ];
  const warnings = planWarnings(tasks);
  const venue = warnings.find(w => w.kind === 'venue_overlap')!;
  const heavy = warnings.find(w => w.kind === 'heavy_load')!;
  const acceptance = (
    id: string,
    acceptedAt: string,
    windows = windowsFor(venue, tasks)!,
  ): ConflictAcceptance => ({
    id,
    organizationId: 'org',
    warningKey: venue.key,
    windows,
    reason: 'Comparten montaje',
    acceptedBy: {id: 'u', displayName: 'Elvis'},
    acceptedAt,
    restricted: false,
  });

  it('only conflicts are acceptable, never reminders', () => {
    expect(isAcceptable(venue)).toBe(true);
    expect(isAcceptable(heavy)).toBe(false);
    expect(
      acceptanceFor(
        heavy,
        [{...acceptance('x', at('08:00')), warningKey: heavy.key}],
        tasks,
      ),
    ).toBeNull();
  });

  it('windows of a warning; same windows ignore order and instant spelling', () => {
    const windows = windowsFor(venue, tasks)!;
    expect(windows).toEqual([
      {taskId: 'a', startsAt: at('09:00'), endsAt: at('11:00')},
      {taskId: 'b', startsAt: at('10:00'), endsAt: at('12:00')},
    ]);
    expect(
      sameWindows(
        [...windows]
          .reverse()
          .map(w => ({...w, startsAt: w.startsAt.replace('.000Z', 'Z')})),
        windows,
      ),
    ).toBe(true);
    expect(sameWindows(windows.slice(0, 1), windows)).toBe(false);
    expect(windowsFor(venue, tasks.slice(0, 1))).toBeNull();
  });

  it('applies while every task keeps its window; lapses when one moves', () => {
    const acc = acceptance('x', at('08:00'));
    expect(acceptanceApplies(acc, tasks)).toBe(true);
    const moved = analyzeMove({tasks, rootId: 'b', minutes: 15}).tasks;
    expect(acceptanceApplies(acc, moved)).toBe(false);
    expect(
      acceptanceApplies(
        acc,
        tasks.filter(t => t.id !== 'b'),
      ),
    ).toBe(false);
    expect(acceptanceApplies({windows: []}, tasks)).toBe(false);
  });

  it('splits warnings into open and accepted, with the newest acceptance that applies', () => {
    const old = acceptance('old', at('07:00'));
    const newer = acceptance('new', at('08:00'));
    const stale = acceptance('stale', at('09:00'), [
      {taskId: 'a', startsAt: at('08:00'), endsAt: at('10:00')},
      {taskId: 'b', startsAt: at('10:00'), endsAt: at('12:00')},
    ]);
    const split = splitAccepted(warnings, [old, stale, newer], tasks);
    expect(split.accepted.map(x => [x.warning.key, x.acceptance.id])).toEqual([
      [venue.key, 'new'],
    ]);
    expect(split.open.map(w => w.key)).toContain(heavy.key);
    expect(split.open.map(w => w.key)).not.toContain(venue.key);
  });
});

describe('guest withholding and sync for Revisión 1', () => {
  it('a note withholds its nested answer; an acceptance its reason', () => {
    const note = {
      id: 'n',
      text: 'Pregunta privada',
      answer: {
        id: 'a',
        noteId: 'n',
        text: 'Respuesta privada',
        restricted: false,
      },
    };
    const guest = withholdFor('note', note, 'guest');
    expect(guest).toMatchObject({
      text: null,
      restricted: true,
      answer: {id: 'a', text: null, restricted: true},
    });
    expect(note.answer.text).toBe('Respuesta privada');
    expect(
      withholdFor('note', {...note, answer: null}, 'guest').answer,
    ).toBeNull();
    expect(withholdFor('note', note, 'member').answer?.text).toBe(
      'Respuesta privada',
    );
    expect(withholdFor('acceptance', {reason: 'Motivo'}, 'guest')).toEqual({
      reason: null,
      restricted: true,
    });
  });

  it('the new activity types reload what they touch, never everything', () => {
    expect(SYNC_LISTS).toContain('acceptances');
    expect(
      [
        ...listsToReload({
          cursor: '1',
          types: ['conflict_acceptance'],
          full: false,
        }),
      ].sort(),
    ).toEqual(['acceptances', 'activity']);
    // The acronym lives in the session (GET /me): only the feed reloads.
    expect([
      ...listsToReload({cursor: '1', types: ['organization'], full: false}),
    ]).toEqual(['activity']);
    // Answers and photos are logged as note and resource updates.
    expect(
      listsToReload({cursor: '1', types: ['note'], full: false}).has('notes'),
    ).toBe(true);
    expect(
      listsToReload({cursor: '1', types: ['resource'], full: false}).has(
        'resources',
      ),
    ).toBe(true);
    expect(
      listsToReload({cursor: '1', types: ['venue'], full: false}).has('venues'),
    ).toBe(true);
  });
});
