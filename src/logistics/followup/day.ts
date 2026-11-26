/**
 * «La jornada» in Hoy: today's tasks grouped for someone on site with a phone
 * in one hand. What is late first, then what should be happening now, what
 * comes next, the rest by hour, tasks without a time, and (folded) what is
 * finished. Pure: lateness comes from `shared/logistics/followup.ts`.
 */
import {minutesLabel} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {
  delayBlocker,
  lateness,
  type Lateness,
} from '../../../shared/logistics/followup.ts';
import {LATE_GRACE_MINUTES} from '../../../shared/logistics/rules.ts';

export type DayGroupId = 'late' | 'now' | 'next' | 'later' | 'untimed' | 'done';

/** Display order of the groups. */
export const DAY_GROUPS: readonly DayGroupId[] = [
  'late',
  'now',
  'next',
  'later',
  'untimed',
  'done',
];

export const DAY_GROUP_TITLE: Record<DayGroupId, string> = {
  late: 'Va tarde',
  now: 'Ahora',
  next: 'Lo siguiente',
  later: 'Más tarde',
  untimed: 'Sin hora',
  done: 'Terminadas',
};

export interface DayItem {
  task: Task;
  group: DayGroupId;
  /** Short flag on the row: «+20 min», «Se alarga 10 min», «Debería empezar»… */
  flag: string | null;
  late: Lateness | null;
}

export type DayGroups = Record<DayGroupId, DayItem[]>;

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** «+20 min» (should have started), «Se alarga 10 min» (still running). */
export function lateFlag(late: Lateness): string {
  return late.kind === 'late_start'
    ? `+${minutesLabel(late.minutes)}`
    : `Se alarga ${minutesLabel(late.minutes)}`;
}

/**
 * Groups today's tasks (in plan order) at `now` (ms). Finished and cancelled
 * tasks are «Terminadas»; a task is late when `lateness` says so (past its
 * start and not started, or under way past its end, beyond the grace
 * minutes); a task within the grace minutes of its start shows as «Debería
 * empezar» in «Ahora». «Lo siguiente» holds the earliest start still to come.
 */
export function groupDay(
  tasks: Task[],
  now: number,
  grace: number = LATE_GRACE_MINUTES,
): DayGroups {
  const groups: DayGroups = {
    late: [],
    now: [],
    next: [],
    later: [],
    untimed: [],
    done: [],
  };
  const future: DayItem[] = [];
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled') {
      groups.done.push({task, group: 'done', flag: null, late: null});
      continue;
    }
    const late = lateness(task, now, grace);
    if (late) {
      groups.late.push({task, group: 'late', flag: lateFlag(late), late});
      continue;
    }
    const start = ms(task.startsAt);
    if (Number.isNaN(start)) {
      // Under way without a start time still belongs to «Ahora».
      if (task.status === 'in_progress') {
        groups.now.push({task, group: 'now', flag: 'Ahora', late: null});
      } else {
        groups.untimed.push({task, group: 'untimed', flag: null, late: null});
      }
      continue;
    }
    if (task.status === 'in_progress') {
      const end = ms(task.endsAt);
      const flag =
        !Number.isNaN(end) && now >= end ? 'Debería terminar' : 'Ahora';
      groups.now.push({task, group: 'now', flag, late: null});
      continue;
    }
    if (start <= now) {
      groups.now.push({
        task,
        group: 'now',
        flag: 'Debería empezar',
        late: null,
      });
      continue;
    }
    future.push({task, group: 'later', flag: null, late: null});
  }
  // Under way first, then «Debería empezar», each in plan order.
  groups.now.sort(
    (a, b) =>
      Number(b.task.status === 'in_progress') -
      Number(a.task.status === 'in_progress'),
  );
  const firstStart = future.length
    ? Math.min(...future.map(i => ms(i.task.startsAt)))
    : null;
  for (const item of future) {
    if (ms(item.task.startsAt) === firstStart) {
      groups.next.push({...item, group: 'next', flag: 'Siguiente'});
    } else {
      groups.later.push(item);
    }
  }
  return groups;
}

/** Minutes from `now` to the start of the next tasks, or null. */
export function minutesUntilNext(
  groups: DayGroups,
  now: number,
): number | null {
  const first = groups.next[0];
  if (!first) return null;
  return Math.max(0, Math.round((ms(first.task.startsAt) - now) / 60_000));
}

/** Whether the «Retraso…» / «Se alarga…» action applies to a task. */
export function canDelay(task: Task): boolean {
  return delayBlocker(task) === null;
}

/** Today's tasks a «¿Y si…?» can start from: late and current first. */
export function delayCandidates(groups: DayGroups): Task[] {
  return (['late', 'now', 'next', 'later'] as const)
    .flatMap(g => groups[g])
    .map(i => i.task)
    .filter(canDelay);
}
