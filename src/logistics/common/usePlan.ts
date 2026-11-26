/**
 * The organization's plan as the screens need it: warnings computed once per
 * change of tasks or events (shared `planWarnings`), indexed by task and by
 * local day.
 */
import {
  planWarnings,
  warningsByTask,
  type PlanWarning,
} from '../../../shared/logistics/conflicts.ts';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {buildDayIndex, type DayBucket} from '../lib/calendar';
import {useLogisticsStore} from '../store/useLogisticsStore';

export interface Plan {
  warnings: PlanWarning[];
  byTask: Map<string, PlanWarning[]>;
  byDay: Map<string, DayBucket>;
  tasksById: Map<string, Task>;
}

/** Builds the plan; pure, exported for tests. */
export function buildPlan(tasks: Task[], events: LogisticsEvent[]): Plan {
  const warnings = planWarnings(tasks, events);
  return {
    warnings,
    byTask: warningsByTask(warnings),
    byDay: buildDayIndex(events, tasks, warnings),
    tasksById: new Map(tasks.map(t => [t.id, t])),
  };
}

/**
 * One plan for the whole window, shared by every consumer: it is rebuilt only
 * when the task or event list changes identity (the store keeps identities
 * when a refresh brings nothing new), never once per component.
 */
let cache: {tasks: Task[]; events: LogisticsEvent[]; plan: Plan} | null = null;

function selectPlan(s: {tasks: Task[]; events: LogisticsEvent[]}): Plan {
  if (!cache || cache.tasks !== s.tasks || cache.events !== s.events) {
    cache = {
      tasks: s.tasks,
      events: s.events,
      plan: buildPlan(s.tasks, s.events),
    };
  }
  return cache.plan;
}

export function usePlan(): Plan {
  return useLogisticsStore(selectPlan);
}
