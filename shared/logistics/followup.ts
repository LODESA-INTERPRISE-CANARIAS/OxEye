/**
 * Day follow-up (M5): what is running late, and the «¿Y si…?» delay
 * analysis. Pure and shared: the UI shows the analysis hatched as a
 * hypothesis, and the server recomputes the same shift before applying it,
 * so what a member confirmed is exactly what is written (or nothing is).
 *
 * A hypothesis only ever moves times. It never touches `heavyLoad`, the
 * declared subsoil review or resources.
 */
import type {DelayMode, ShiftExpectation, Task, Uuid} from './contracts.ts';
import {
  movedSafety,
  planWarnings,
  type PlanEvent,
  type PlanResource,
  type PlanTask,
  type PlanWarning,
} from './conflicts.ts';
import {LATE_GRACE_MINUTES} from './rules.ts';
import {
  delayBudget,
  simulateDelay,
  type DelayImpact,
  type ScheduleItem,
} from './schedule.ts';

const MIN = 60_000;
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

// ---------------------------------------------------------------- lateness

export interface Lateness {
  /** `late_start`: should have started; `overrun`: under way past its end. */
  kind: 'late_start' | 'overrun';
  minutes: number;
}

/** Statuses of a task that has not started yet. */
const NOT_STARTED: ReadonlySet<Task['status']> = new Set([
  'planned',
  'confirmed',
  'delayed',
]);

/**
 * Whether a task is late at `now` (ms): its start passed more than
 * `grace` minutes ago and nobody marked it started, or it is under way more
 * than `grace` minutes past its end. Finished and cancelled tasks are never
 * late; unknown times are never late (nothing to compare with).
 */
export function lateness(
  task: Pick<Task, 'status' | 'startsAt' | 'endsAt'>,
  now: number,
  grace: number = LATE_GRACE_MINUTES,
): Lateness | null {
  if (NOT_STARTED.has(task.status)) {
    const start = ms(task.startsAt);
    if (Number.isNaN(start)) return null;
    const minutes = Math.floor((now - start) / MIN);
    return minutes >= grace ? {kind: 'late_start', minutes} : null;
  }
  if (task.status === 'in_progress') {
    const end = ms(task.endsAt);
    if (Number.isNaN(end)) return null;
    const minutes = Math.floor((now - end) / MIN);
    return minutes >= grace ? {kind: 'overrun', minutes} : null;
  }
  return null;
}

/** Under way → it «se alarga» (its start stays); otherwise it starts later. */
export function delayModeFor(task: Pick<Task, 'status'>): DelayMode {
  return task.status === 'in_progress' ? 'extend' : 'shift';
}

/**
 * The delay to propose for a task: what it is already late, rounded up to
 * five minutes; 15 when it is not late.
 */
export function suggestedDelay(
  task: Pick<Task, 'status' | 'startsAt' | 'endsAt'>,
  now: number,
): number {
  const late = lateness(task, now, 1);
  if (!late) return 15;
  return Math.max(5, Math.ceil(late.minutes / 5) * 5);
}

/** Why a task cannot be delayed, or null when it can. */
export function delayBlocker(
  task: Pick<Task, 'status' | 'startsAt' | 'endsAt'>,
): 'finished' | 'cancelled' | 'untimed' | null {
  if (task.status === 'done') return 'finished';
  if (task.status === 'cancelled') return 'cancelled';
  if (Number.isNaN(ms(task.startsAt)) || Number.isNaN(ms(task.endsAt))) {
    return 'untimed';
  }
  return null;
}

// ---------------------------------------------------------------- delay analysis

/**
 * Tasks as schedule items for a delay of `rootId`. Lanes are venues.
 * Cancelled tasks are out; finished and under-way tasks (other than the
 * root) stay where they are.
 */
export function delayItems(tasks: PlanTask[], rootId: Uuid): ScheduleItem[] {
  return tasks.map(t => ({
    id: t.id,
    label: t.title,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    lane: t.venue?.id ?? null,
    dependsOn: t.dependsOn,
    cancelled: t.status === 'cancelled',
    fixed:
      t.id !== rootId && (t.status === 'done' || t.status === 'in_progress'),
  }));
}

export interface EventMargin {
  eventId: Uuid;
  eventName: string;
  /** Minutes between the last moved preparation task's end and the event start, before. */
  before: number;
  /** The same under the hypothesis; negative = it runs into the event. */
  after: number;
}

export interface DelayAnalysis<T extends PlanTask = PlanTask> {
  impact: DelayImpact;
  mode: DelayMode;
  /** Minutes the delayed task's end can slip before anything else moves. */
  budget: number | null;
  /** The plan under the hypothesis: moved tasks have new times; nothing else differs. */
  tasks: T[];
  /** Warnings that exist only under the hypothesis. */
  newWarnings: PlanWarning[];
  /** Warnings that already exist but get worse (more minutes). */
  worsened: PlanWarning[];
  /**
   * Warnings the hypothesis would make disappear. Never route or heavy-load
   * reminders (UNSOLVED_BY_MOVING): a delay does not solve those risks.
   */
  clearedWarnings: PlanWarning[];
  /**
   * Routes A/B/C and Carpa Amarilla: one reminder for every moved task with
   * vehicles, load-bearing work or a known heavy load, inside the event
   * window or not (`movedSafety`).
   */
  routeReminders: PlanWarning[];
  /** Events whose preparation the delay eats into, tightest first. */
  eventMargins: EventMargin[];
}

/**
 * Everything the «¿Y si…?» sheet shows: which tasks move (through
 * finish-to-start dependencies), which absorb it, the plan warnings re-run
 * on the hypothetical plan, and the margin left before each event starts.
 * Nothing is modified.
 */
export function analyzeDelay<T extends PlanTask>(input: {
  tasks: T[];
  events?: (PlanEvent & {name: string})[];
  resources?: PlanResource[];
  rootId: Uuid;
  minutes: number;
  mode?: DelayMode;
}): DelayAnalysis<T> {
  const {tasks, events = [], resources = [], rootId, minutes} = input;
  const mode = input.mode ?? 'shift';
  const items = delayItems(tasks, rootId);
  const impact = simulateDelay(items, rootId, minutes, mode);
  const moved = new Map(impact.shifted.map(s => [s.id, s]));
  const hypothetical = tasks.map(t => {
    const s = moved.get(t.id);
    return s ? {...t, startsAt: s.startsAt, endsAt: s.endsAt} : t;
  });

  const before = planWarnings(tasks, events, resources);
  const after = planWarnings(hypothetical, events, resources);
  const beforeByKey = new Map(before.map(w => [w.key, w]));
  const afterKeys = new Set(after.map(w => w.key));
  const newWarnings: PlanWarning[] = [];
  const worsened: PlanWarning[] = [];
  for (const w of after) {
    const old = beforeByKey.get(w.key);
    if (!old) newWarnings.push(w);
    else if ((w.minutes ?? 0) > (old.minutes ?? 0)) worsened.push(w);
  }
  // Routes A/B/C and Carpa Amarilla for every moved vehicle, load-bearing or
  // heavy task; a delay never «clears» a route or heavy-load reminder.
  const {routeReminders, cleared: clearedWarnings} = movedSafety({
    after: hypothetical,
    movedIds: moved,
    afterWarnings: after,
    cleared: before.filter(w => !afterKeys.has(w.key)),
  });

  const eventsById = new Map(events.map(e => [e.id, e]));
  const margins = new Map<Uuid, EventMargin>();
  for (const t of tasks) {
    const s = moved.get(t.id);
    const ev = t.eventId ? eventsById.get(t.eventId) : undefined;
    if (!s || !ev || ev.status === 'cancelled') continue;
    const evStart = ms(ev.startsAt);
    const oldEnd = ms(t.endsAt);
    if (Number.isNaN(evStart) || Number.isNaN(oldEnd) || oldEnd > evStart) {
      continue;
    }
    const margin: EventMargin = {
      eventId: ev.id,
      eventName: ev.name,
      before: Math.round((evStart - oldEnd) / MIN),
      after: Math.round((evStart - ms(s.endsAt)) / MIN),
    };
    const prev = margins.get(ev.id);
    if (!prev || margin.after < prev.after) margins.set(ev.id, margin);
  }

  return {
    impact,
    mode,
    budget: delayBudget(items, rootId),
    tasks: hypothetical,
    newWarnings,
    worsened,
    clearedWarnings,
    routeReminders,
    eventMargins: [...margins.values()].sort((a, b) => a.after - b.after),
  };
}

/** What the member confirms: every moved task with the version they saw. */
export function shiftExpectations(
  impact: DelayImpact,
  tasks: Pick<Task, 'id' | 'version'>[],
): ShiftExpectation[] {
  const versions = new Map(tasks.map(t => [t.id, t.version]));
  return impact.shifted.map(s => ({
    id: s.id,
    version: versions.get(s.id) ?? -1,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
  }));
}

/**
 * True when the shift recomputed now is exactly the one confirmed: same
 * tasks, same versions, same new times. Anything else means the plan
 * changed in between and the member must look again.
 */
export function sameShift(
  expected: ShiftExpectation[],
  computed: ShiftExpectation[],
): boolean {
  if (expected.length !== computed.length) return false;
  // Each moved task must be confirmed once: [root, root] must not stand in for [root, B].
  if (new Set(expected.map(e => e.id)).size !== expected.length) return false;
  const byId = new Map(computed.map(c => [c.id, c]));
  if (byId.size !== computed.length) return false;
  return expected.every(e => {
    const c = byId.get(e.id);
    return (
      !!c &&
      c.version === e.version &&
      ms(c.startsAt) === ms(e.startsAt) &&
      ms(c.endsAt) === ms(e.endsAt)
    );
  });
}
