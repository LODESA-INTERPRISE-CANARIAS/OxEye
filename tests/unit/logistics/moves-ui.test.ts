import {describe, expect, it} from 'vitest';
import {windowsFor} from '../../../shared/logistics/acceptance';
import {planWarnings} from '../../../shared/logistics/conflicts';
import type {
  ConflictAcceptance,
  Task,
} from '../../../shared/logistics/contracts';
import {
  dependantsOf,
  dependencyText,
  relationOf,
  whenText,
} from '../../../src/logistics/calendar/DependencyLinks';
import {buildPlan} from '../../../src/logistics/common/usePlan';
import {
  clampDrag,
  closedBands,
  dragMinutes,
  dragRefusal,
  edgeSpeed,
  shiftedWindow,
} from '../../../src/logistics/moves/drag';
import {
  conflictExits,
  durationText,
  shiftInstant,
  shiftText,
  undoExpectations,
} from '../../../src/logistics/moves/exits';

const CANARY = 'Atlantic/Canary';
/** December in Canarias is UTC+0, so the wall clock equals UTC. */
const at = (hhmm: string, day = '02') => `2026-12-${day}T${hhmm}:00.000Z`;
const plaza = {id: 'v1', name: 'Plaza del Adelantado'};

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
    venue: plaza,
    title: id,
    kind: 'assembly',
    status: 'planned',
    date: '2026-12-02',
    endDate: null,
    startsAt: at('09:00'),
    endsAt: at('10:00'),
    timezone: CANARY,
    company: null,
    contact: null,
    dependsOn: [],
    heavyLoad: false,
    notes: null,
    ...extra,
  } as Task;
}

const byId = (tasks: Task[]) => new Map(tasks.map(t => [t.id, t]));

describe('conflict exits', () => {
  it('a venue overlap offers delaying the later task and advancing the earlier one', () => {
    const a = task('A', {
      title: 'Escenario',
      startsAt: at('08:00'),
      endsAt: at('10:00'),
    });
    const b = task('B', {
      title: 'Sonido',
      startsAt: at('09:20'),
      endsAt: at('11:00'),
    });
    const w = planWarnings([a, b], []).find(x => x.kind === 'venue_overlap')!;
    const exits = conflictExits(w, byId([a, b]))!;
    expect(exits.first.id).toBe('A');
    expect(exits.second.id).toBe('B');
    // 40 minutes of overlap, already a whole step.
    expect(exits.minutes).toBe(40);
    expect(exits).toMatchObject({delay: true, advance: true, keep: true});
  });

  it('rounds the clash up to whole 5-minute steps', () => {
    const a = task('A', {startsAt: at('08:00'), endsAt: at('10:02')});
    const b = task('B', {startsAt: at('10:00'), endsAt: at('11:00')});
    const w = planWarnings([a, b], []).find(x => x.kind === 'venue_overlap')!;
    expect(conflictExits(w, byId([a, b]))!.minutes).toBe(5);
  });

  it('in a dependency, the task that waits is the one delayed', () => {
    const delivery = task('D', {
      title: 'Entrega del generador',
      venue: null,
      startsAt: at('08:00'),
      endsAt: at('09:00'),
    });
    const hookup = task('H', {
      title: 'Conexión',
      venue: null,
      startsAt: at('08:30'),
      endsAt: at('09:30'),
      dependsOn: ['D'],
    });
    const w = planWarnings([delivery, hookup], []).find(
      x => x.kind === 'dependency_order',
    )!;
    const exits = conflictExits(w, byId([delivery, hookup]))!;
    expect([exits.first.id, exits.second.id]).toEqual(['D', 'H']);
    expect(exits.minutes).toBe(30);
  });

  it('a task that cannot move loses its exit but the other stays', () => {
    const a = task('A', {
      status: 'in_progress',
      startsAt: at('08:00'),
      endsAt: at('10:00'),
    });
    const b = task('B', {startsAt: at('09:00'), endsAt: at('11:00')});
    const w = planWarnings([a, b], []).find(x => x.kind === 'venue_overlap')!;
    const exits = conflictExits(w, byId([a, b]))!;
    expect(exits.advance).toBe(false);
    expect(exits.delay).toBe(true);
    expect(exits.keep).toBe(true);
  });

  it('reminders and clashes of more than two tasks have no exits', () => {
    const heavy = task('A', {heavyLoad: true});
    const reminders = planWarnings([heavy], []);
    expect(reminders.length).toBeGreaterThan(0);
    for (const w of reminders) {
      expect(conflictExits(w, byId([heavy]))).toBeNull();
    }
    const fake = {
      ...planWarnings(
        [task('A'), task('B', {startsAt: at('09:30'), endsAt: at('10:30')})],
        [],
      ).find(x => x.kind === 'venue_overlap')!,
      taskIds: ['A', 'B', 'C'],
    };
    expect(
      conflictExits(fake, byId([task('A'), task('B'), task('C')])),
    ).toBeNull();
  });

  it('a clash longer than a day is not offered as a move', () => {
    const a = task('A', {
      startsAt: at('08:00', '01'),
      endsAt: at('10:00', '03'),
    });
    const b = task('B', {
      startsAt: at('09:00', '01'),
      endsAt: at('11:00', '01'),
    });
    const w = planWarnings([a, b], []).find(x => x.kind === 'venue_overlap')!;
    const exits = conflictExits(w, byId([a, b]))!;
    expect(exits.delay).toBe(false);
    expect(exits.advance).toBe(false);
    expect(exits.keep).toBe(true);
  });
});

describe('move texts and undo', () => {
  it('reads shifts in plain Spanish', () => {
    expect(durationText(45)).toBe('45 min');
    expect(durationText(60)).toBe('1 h');
    expect(durationText(-75)).toBe('1 h 15 min');
    expect(shiftText(30)).toBe('30 min más tarde');
    expect(shiftText(-60)).toBe('1 h antes');
    expect(shiftInstant(at('09:00'), 35)).toBe(at('09:35'));
  });

  it('«Deshacer» sends each moved task with its new version and its old window', () => {
    const before = byId([
      task('A'),
      task('B', {startsAt: at('10:00'), endsAt: at('11:00')}),
    ]);
    const moved = [
      {id: 'A', version: 2},
      {id: 'B', version: 4},
    ];
    expect(undoExpectations(before, moved)).toEqual([
      {id: 'A', version: 2, startsAt: at('09:00'), endsAt: at('10:00')},
      {id: 'B', version: 4, startsAt: at('10:00'), endsAt: at('11:00')},
    ]);
    // A task the plan did not have before is left out.
    expect(undoExpectations(before, [{id: 'Z', version: 1}])).toEqual([]);
  });
});

describe('calendar drag sums', () => {
  it('turns pixels into whole 5-minute steps', () => {
    expect(dragMinutes(32, 64)).toBe(30);
    expect(dragMinutes(-6, 64)).toBe(-5);
    expect(dragMinutes(2, 64)).toBe(0);
    expect(dragMinutes(10, 0)).toBe(0);
  });

  it('keeps the block inside its day and within a day of moves', () => {
    const span = {start: 8 * 60, end: 10 * 60};
    expect(clampDrag(span, -600)).toBe(-480);
    expect(clampDrag(span, 900)).toBe(840);
    expect(clampDrag(span, 25)).toBe(25);
    // A start off the 5-minute grid never gives a non-step move.
    expect(clampDrag({start: 3, end: 63}, -60)).toBe(0);
  });

  it('refuses a window outside known opening hours, never unknown ones', () => {
    const t = task('A', {startsAt: at('09:00'), endsAt: at('10:00')});
    const hours = {opensAt: '08:00', closesAt: '20:00'};
    const place = {name: 'Plaza del Adelantado', openingHours: hours};
    expect(dragRefusal(t, -60, place, CANARY)).toBeNull();
    expect(dragRefusal(t, -90, place, CANARY)).toMatch(
      /«Plaza del Adelantado» abre de 08:00 a 20:00/,
    );
    expect(
      dragRefusal(t, -300, {...place, openingHours: null}, CANARY),
    ).toBeNull();
    expect(dragRefusal(t, 0, place, CANARY)).toBeNull();
    expect(shiftedWindow({startsAt: null, endsAt: at('10:00')}, 5)).toBeNull();
  });

  it('shades the closed parts of the day', () => {
    expect(closedBands({opensAt: '08:00', closesAt: '20:00'})).toEqual([
      {start: 0, end: 480},
      {start: 1200, end: 1440},
    ]);
    expect(closedBands({opensAt: '00:00', closesAt: '24:00'})).toEqual([]);
    expect(closedBands(null)).toEqual([]);
  });

  it('scrolls faster the closer the pointer is to an edge', () => {
    expect(edgeSpeed(300, 100, 600)).toBe(0);
    expect(edgeSpeed(130, 100, 600)).toBeLessThan(0);
    expect(edgeSpeed(100, 100, 600)).toBe(-14);
    expect(edgeSpeed(590, 100, 600)).toBeGreaterThan(0);
  });
});

describe('dependencies on the timeline', () => {
  const delivery = task('D', {
    title: 'Entrega del generador',
    startsAt: at('08:00'),
    endsAt: at('09:00'),
  });
  const hookup = task('H', {
    title: 'Conexión',
    startsAt: at('09:00'),
    endsAt: at('10:00'),
    dependsOn: ['D'],
  });
  const test = task('T', {
    title: 'Prueba',
    startsAt: at('10:00', '03'),
    endsAt: at('11:00', '03'),
    dependsOn: ['H'],
  });
  const all = byId([delivery, hookup, test]);
  const deps = dependantsOf(all);

  it('knows what waits for each task, without cancelled ones', () => {
    expect(deps.get('D')?.map(t => t.id)).toEqual(['H']);
    const cancelled = byId([delivery, {...hookup, status: 'cancelled'}]);
    expect(dependantsOf(cancelled).get('D')).toBeUndefined();
  });

  it('marks what the active block waits for and what waits for it', () => {
    expect(relationOf(hookup, delivery, deps)).toBe('pred');
    expect(relationOf(hookup, test, deps)).toBe('succ');
    expect(relationOf(hookup, hookup, deps)).toBe('active');
    expect(relationOf(undefined, hookup, deps)).toBeNull();
    const lone = task('L');
    expect(relationOf(lone, lone, deps)).toBeNull();
  });

  it('names times, with the day when it is another one', () => {
    expect(whenText(delivery, '2026-12-02')).toBe('08:00');
    expect(whenText(test, '2026-12-02')).toMatch(/3 dic.* 10:00/);
    expect(whenText(task('X', {startsAt: null}), '2026-12-02')).toBe(
      'sin hora',
    );
    expect(dependencyText(hookup, all, deps, '2026-12-02')).toBe(
      'Espera a: Entrega del generador (08:00). La espera: Prueba (3 dic 10:00).',
    );
  });
});

describe('plan with accepted conflicts', () => {
  const a = task('A', {
    title: 'Escenario',
    startsAt: at('08:00'),
    endsAt: at('10:00'),
  });
  const b = task('B', {
    title: 'Sonido',
    startsAt: at('09:00'),
    endsAt: at('11:00'),
  });
  const warning = planWarnings([a, b], []).find(
    x => x.kind === 'venue_overlap',
  )!;
  const acceptance: ConflictAcceptance = {
    id: 'ca1',
    organizationId: 'org',
    warningKey: warning.key,
    windows: windowsFor(warning, [a, b])!,
    reason: 'Montan por accesos distintos.',
    acceptedBy: {id: 'u1', displayName: 'Elvis'},
    acceptedAt: at('07:00'),
    restricted: false,
  };

  it('lists an accepted conflict apart, on its day, and stops outlining it', () => {
    const plan = buildPlan([a, b], [], [], [acceptance]);
    expect(plan.warnings.some(w => w.key === warning.key)).toBe(false);
    expect(plan.byTask.get('A')?.some(w => w.key === warning.key)).toBeFalsy();
    expect(plan.accepted.map(x => x.acceptance.id)).toEqual(['ca1']);
    expect(
      plan.acceptedByDay.get('2026-12-02')?.map(x => x.warning.key),
    ).toEqual([warning.key]);
  });

  it('reopens by itself when one of the tasks moves', () => {
    const moved = {...b, startsAt: at('09:30'), endsAt: at('11:30')};
    const plan = buildPlan([a, moved], [], [], [acceptance]);
    expect(plan.accepted).toEqual([]);
    expect(plan.warnings.some(w => w.kind === 'venue_overlap')).toBe(true);
  });
});
