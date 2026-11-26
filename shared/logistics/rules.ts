/**
 * Domain constants shared by the server (validation) and the UI (forms,
 * labels), so both sides accept exactly the same values.
 */
import type {EventStatus, TaskKind, TaskStatus} from './contracts.ts';

/** Display order: the life of an event, from set-up to tear-down. */
export const TASK_KINDS = [
  'assembly',
  'activity',
  'dismantling',
  'transport',
  'delivery',
  'other',
] as const satisfies readonly TaskKind[];

export const TASK_STATUSES = [
  'planned',
  'confirmed',
  'in_progress',
  'done',
  'delayed',
  'cancelled',
] as const satisfies readonly TaskStatus[];

export const EVENT_STATUSES = [
  'planned',
  'confirmed',
  'delayed',
  'cancelled',
] as const satisfies readonly EventStatus[];

/** Longest multi-day span accepted (a typo in the year would fill the calendar). */
export const MAX_SPAN_DAYS = 366;
