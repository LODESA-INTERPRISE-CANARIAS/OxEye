/**
 * The organization's plan as the screens need it: warnings computed once per
 * change of tasks, events, resources or accepted conflicts (shared
 * `planWarnings`), indexed by task and by local day. Accepted conflicts that
 * still apply are kept apart (Revisión 1 · E2).
 */
import {splitAccepted} from '../../../shared/logistics/acceptance.ts';
import {
  planWarnings,
  warningsByTask,
  type PlanWarning,
} from '../../../shared/logistics/conflicts.ts';
import type {
  ConflictAcceptance,
  LogisticsEvent,
  Resource,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {buildDayIndex, type DayBucket} from '../lib/calendar';
import {useLogisticsStore} from '../store/useLogisticsStore';

/** A conflict the team decided to keep («Mantener ambas», Revisión 1 · E2). */
export interface AcceptedWarning {
  warning: PlanWarning;
  acceptance: ConflictAcceptance;
}

export interface Plan {
  /**
   * Open warnings: conflicts still to resolve and every reminder. Accepted
   * conflicts are not here (they no longer outline blocks or count).
   */
  warnings: PlanWarning[];
  byTask: Map<string, PlanWarning[]>;
  byDay: Map<string, DayBucket>;
  tasksById: Map<string, Task>;
  /** Accepted conflicts that still apply, listed apart with their reason. */
  accepted: AcceptedWarning[];
  /** The same, on each local day they happen. */
  acceptedByDay: Map<string, AcceptedWarning[]>;
}

/** Builds the plan; pure, exported for tests. */
export function buildPlan(
  tasks: Task[],
  events: LogisticsEvent[],
  resources: Resource[] = [],
  acceptances: ConflictAcceptance[] = [],
): Plan {
  const all = planWarnings(tasks, events, resources);
  const {open: warnings, accepted} = acceptances.length
    ? splitAccepted(all, acceptances, tasks)
    : {open: all, accepted: [] as AcceptedWarning[]};
  const acceptedByDay = new Map<string, AcceptedWarning[]>();
  if (accepted.length) {
    const byKey = new Map(accepted.map(a => [a.warning.key, a]));
    // Same day placement as open conflicts.
    for (const [day, bucket] of buildDayIndex(
      [],
      tasks,
      accepted.map(a => a.warning),
    )) {
      const list = bucket.conflicts
        .map(w => byKey.get(w.key))
        .filter((a): a is AcceptedWarning => !!a);
      if (list.length) acceptedByDay.set(day, list);
    }
  }
  return {
    warnings,
    byTask: warningsByTask(warnings),
    byDay: buildDayIndex(events, tasks, warnings),
    tasksById: new Map(tasks.map(t => [t.id, t])),
    accepted,
    acceptedByDay,
  };
}

/**
 * One plan for the whole window, shared by every consumer: it is rebuilt only
 * when the task, event or resource list changes identity (the store keeps
 * identities when a refresh brings nothing new), never once per component.
 */
let cache: {
  tasks: Task[];
  events: LogisticsEvent[];
  resources: Resource[];
  acceptances: ConflictAcceptance[];
  plan: Plan;
} | null = null;

function selectPlan(s: {
  tasks: Task[];
  events: LogisticsEvent[];
  resources: Resource[];
  acceptances: ConflictAcceptance[];
}): Plan {
  if (
    !cache ||
    cache.tasks !== s.tasks ||
    cache.events !== s.events ||
    cache.resources !== s.resources ||
    cache.acceptances !== s.acceptances
  ) {
    cache = {
      tasks: s.tasks,
      events: s.events,
      resources: s.resources,
      acceptances: s.acceptances,
      plan: buildPlan(s.tasks, s.events, s.resources, s.acceptances),
    };
  }
  return cache.plan;
}

// Never keep another session's or organization's plan around.
useLogisticsStore.subscribe((state, prev) => {
  if (state.orgId !== prev.orgId || state.session !== prev.session) {
    cache = null;
  }
});

export function usePlan(): Plan {
  return useLogisticsStore(selectPlan);
}
