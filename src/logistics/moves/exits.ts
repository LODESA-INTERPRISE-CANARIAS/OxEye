/**
 * What a conflict warning offers as a way out (Revisión 1 · E2), and the
 * small sums a move needs: how many minutes clear a time clash, the
 * «Deshacer» of a confirmed move and plain words for a shift. Pure: no
 * React, no store.
 */
import {
  isAcceptable,
  windowsFor,
} from '../../../shared/logistics/acceptance.ts';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {
  ShiftExpectation,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {moveBlocker} from '../../../shared/logistics/move.ts';
import {
  isValidMove,
  MOVE_STEP_MINUTES,
} from '../../../shared/logistics/rules.ts';

/** Warnings about two tasks at clashing times: the ones with exits. */
export const EXIT_KINDS: ReadonlySet<PlanWarning['kind']> = new Set([
  'venue_overlap',
  'company_overlap',
  'resource_overlap',
  'dependency_order',
]);

export interface ConflictExits {
  /** The task that should go first (or that the other waits for). */
  first: Task;
  /** The task that starts too early. */
  second: Task;
  /** Minutes that clear the clash (a multiple of MOVE_STEP_MINUTES). */
  minutes: number;
  /** «Retrasar `second`»: it can move later by `minutes`. */
  delay: boolean;
  /** «Adelantar `first`»: it can move earlier by `minutes`. */
  advance: boolean;
  /** «Mantener ambas»: the conflict can be accepted with a reason. */
  keep: boolean;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * The exits of a conflict between two timed tasks, or null when it has none
 * (a reminder, a clash of more tasks, a task without times). Delaying
 * the second task makes it start when the first ends; advancing the first
 * makes it end when the second starts. Each exit is only offered when that
 * task can move (`moveBlocker`) and the shift is a valid move.
 */
export function conflictExits(
  warning: PlanWarning,
  tasksById: ReadonlyMap<string, Task>,
): ConflictExits | null {
  if (warning.severity !== 'conflict' || !EXIT_KINDS.has(warning.kind)) {
    return null;
  }
  if (warning.taskIds.length !== 2) return null;
  const [a, b] = warning.taskIds.map(id => tasksById.get(id));
  if (!a || !b) return null;
  if (
    [a, b].some(t => Number.isNaN(ms(t.startsAt)) || Number.isNaN(ms(t.endsAt)))
  ) {
    return null;
  }
  let first: Task;
  let second: Task;
  if (warning.kind === 'dependency_order') {
    // The one that depends on the other starts too early.
    [first, second] = b.dependsOn.includes(a.id) ? [a, b] : [b, a];
  } else {
    [first, second] =
      ms(a.startsAt) < ms(b.startsAt) ||
      (ms(a.startsAt) === ms(b.startsAt) && ms(a.endsAt) <= ms(b.endsAt))
        ? [a, b]
        : [b, a];
  }
  const clash = (ms(first.endsAt) - ms(second.startsAt)) / 60_000;
  if (!(clash > 0)) return null;
  const minutes = Math.ceil(clash / MOVE_STEP_MINUTES) * MOVE_STEP_MINUTES;
  const valid = isValidMove(minutes);
  return {
    first,
    second,
    minutes,
    delay: valid && !moveBlocker(second),
    advance: valid && !moveBlocker(first),
    keep: isAcceptable(warning) && !!windowsFor(warning, [a, b]),
  };
}

/**
 * «Deshacer» of a confirmed move: every task it changed, with the version it
 * has now and the window it had before (`before` is the plan as it was).
 */
export function undoExpectations(
  before: ReadonlyMap<string, Pick<Task, 'startsAt' | 'endsAt'>>,
  moved: readonly Pick<Task, 'id' | 'version'>[],
): ShiftExpectation[] {
  const out: ShiftExpectation[] = [];
  for (const t of moved) {
    const old = before.get(t.id);
    if (!old?.startsAt || !old.endsAt) continue;
    out.push({
      id: t.id,
      version: t.version,
      startsAt: old.startsAt,
      endsAt: old.endsAt,
    });
  }
  return out;
}

/** «1 h 15 min» for a positive number of minutes. */
export function durationText(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** «30 min más tarde», «1 h antes». */
export function shiftText(minutes: number): string {
  return `${durationText(minutes)} ${minutes > 0 ? 'más tarde' : 'antes'}`;
}

/** An instant moved by `minutes`. */
export function shiftInstant(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
