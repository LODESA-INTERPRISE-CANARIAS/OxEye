/**
 * «Tareas» (Revisión 1 · E2, note 6): filters, groups and dependency chains
 * over every task of the organization. Pure: no React, no store, no DOM
 * (the device preferences at the end only touch `localStorage`).
 *
 * The plan warnings come from `usePlan` (shared `planWarnings`, accepted
 * conflicts apart); this file only reads them.
 */
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {
  LocalDate,
  Task,
  TaskStatus,
  Uuid,
} from '../../../shared/logistics/contracts.ts';
import {normalize} from '../../../shared/logistics/search.ts';
import {isLocalDate} from '../../../shared/logistics/time.ts';
import {recordDate, recordDays, sortTasks} from '../lib/tasks';

/** «Sin evento», «Sin lugar», «Sin empresa» in the multi-value filters. */
export const NONE = 'none';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'planned',
  'confirmed',
  'in_progress',
  'delayed',
  'done',
  'cancelled',
];

export interface TaskFilters {
  query: string;
  /** Event ids; `NONE` = tasks without an event. Empty = all. */
  events: string[];
  venues: string[];
  companies: string[];
  statuses: TaskStatus[];
  /** Days the task occupies, inclusive; '' = open. */
  from: LocalDate | '';
  to: LocalDate | '';
  withWarnings: boolean;
  noTime: boolean;
  noVenue: boolean;
}

export const EMPTY_FILTERS: TaskFilters = {
  query: '',
  events: [],
  venues: [],
  companies: [],
  statuses: [],
  from: '',
  to: '',
  withWarnings: false,
  noTime: false,
  noVenue: false,
};

export type TaskView = 'list' | 'grouped';
export type GroupBy = 'event' | 'venue' | 'company';

export const GROUP_LABEL: Record<GroupBy, string> = {
  event: 'Evento',
  venue: 'Lugar',
  company: 'Empresa',
};

/** How many filters narrow the list (the text search counts as one). */
export function activeFilterCount(f: TaskFilters): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.events.length ? 1 : 0) +
    (f.venues.length ? 1 : 0) +
    (f.companies.length ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    (f.withWarnings ? 1 : 0) +
    (f.noTime ? 1 : 0) +
    (f.noVenue ? 1 : 0)
  );
}

/** No time yet: «Sin hora» (the start or the end is unknown). */
export function lacksTime(t: Pick<Task, 'startsAt' | 'endsAt'>): boolean {
  return !t.startsAt || !t.endsAt;
}

const matchesId = (chosen: string[], id: string | null | undefined) =>
  chosen.length === 0 || chosen.includes(id ?? NONE);

/**
 * Words of the search, all of which must appear in the title, the event,
 * the venue, the company or the person in charge (accents and case
 * ignored). Never the task's observations.
 */
function haystack(t: Task, eventName: string | undefined): string {
  return normalize(
    [t.title, eventName, t.venue?.name, t.company?.name, t.contact?.name]
      .filter(Boolean)
      .join(' '),
  );
}

export interface FilterContext {
  /** Open warnings by task (`usePlan().byTask`). */
  byTask: ReadonlyMap<Uuid, readonly PlanWarning[]>;
  eventNames: ReadonlyMap<Uuid, string>;
}

/** The tasks that pass every filter, in time order (undated last). */
export function applyFilters(
  tasks: readonly Task[],
  f: TaskFilters,
  ctx: FilterContext,
): Task[] {
  const words = normalize(f.query).split(' ').filter(Boolean);
  const from = f.from && isLocalDate(f.from) ? f.from : null;
  const to = f.to && isLocalDate(f.to) ? f.to : null;
  const out = tasks.filter(t => {
    if (!matchesId(f.events, t.eventId)) return false;
    if (!matchesId(f.venues, t.venue?.id)) return false;
    if (!matchesId(f.companies, t.company?.id)) return false;
    if (f.statuses.length && !f.statuses.includes(t.status)) return false;
    if (f.noVenue && t.venue) return false;
    if (f.noTime && !lacksTime(t)) return false;
    if (f.withWarnings && !ctx.byTask.get(t.id)?.length) return false;
    if (from || to) {
      const days = recordDays(t);
      if (!days.some(d => (!from || d >= from) && (!to || d <= to))) {
        return false;
      }
    }
    if (words.length) {
      const text = haystack(t, t.eventId ? ctx.eventNames.get(t.eventId) : '');
      if (!words.every(w => text.includes(w))) return false;
    }
    return true;
  });
  return sortTasks(out);
}

export interface DayGroup {
  /** `YYYY-MM-DD`, or '' for undated tasks. */
  day: LocalDate | '';
  items: Task[];
}

/** The compact list, by first day («Sin fecha» last); keeps the order. */
export function groupByDay(tasks: readonly Task[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const t of tasks) {
    const day = recordDate(t) ?? '';
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(t);
    else out.push({day, items: [t]});
  }
  return out;
}

export interface TaskGroup {
  /** The record's id, or `NONE`. */
  key: string;
  label: string;
  items: Task[];
  /** Tasks of the group with an open conflict. */
  conflicts: number;
}

const NONE_LABEL: Record<GroupBy, string> = {
  event: 'Sin evento',
  venue: 'Sin lugar',
  company: 'Sin empresa',
};

/**
 * Groups for preparing the day: by event, venue or company, alphabetical,
 * «Sin …» last; each group keeps the time order of `tasks`.
 */
export function groupTasks(
  tasks: readonly Task[],
  by: GroupBy,
  ctx: FilterContext,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const t of tasks) {
    let key: string;
    let label: string;
    if (by === 'event') {
      key = t.eventId ?? NONE;
      label = t.eventId
        ? (ctx.eventNames.get(t.eventId) ?? 'Evento sin nombre')
        : NONE_LABEL.event;
    } else {
      const ref = by === 'venue' ? t.venue : t.company;
      key = ref?.id ?? NONE;
      label = ref?.name ?? NONE_LABEL[by];
    }
    const g = groups.get(key) ?? {key, label, items: [], conflicts: 0};
    g.items.push(t);
    if (ctx.byTask.get(t.id)?.some(w => w.severity === 'conflict')) {
      g.conflicts++;
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) =>
    a.key === NONE
      ? 1
      : b.key === NONE
        ? -1
        : a.label.localeCompare(b.label, 'es'),
  );
}

export interface Dependencies {
  /** Tasks this one waits for (its `dependsOn` that still exist). */
  waitsFor: ReadonlyMap<Uuid, Task[]>;
  /** Tasks that wait for this one. */
  waitedBy: ReadonlyMap<Uuid, Task[]>;
}

/** Both directions of the finish-to-start links, over every task. */
export function dependencies(tasks: readonly Task[]): Dependencies {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const waitsFor = new Map<Uuid, Task[]>();
  const waitedBy = new Map<Uuid, Task[]>();
  for (const t of tasks) {
    const before = t.dependsOn
      .map(id => byId.get(id))
      .filter((p): p is Task => !!p);
    if (before.length) waitsFor.set(t.id, sortTasks(before));
    for (const p of before) {
      const list = waitedBy.get(p.id);
      if (list) list.push(t);
      else waitedBy.set(p.id, [t]);
    }
  }
  for (const [id, list] of waitedBy) waitedBy.set(id, sortTasks(list));
  return {waitsFor, waitedBy};
}

export interface Chain {
  root: Uuid;
  /** Everything it waits for, directly or not. */
  before: Set<Uuid>;
  /** Everything that waits for it, directly or not. */
  after: Set<Uuid>;
}

/** The whole chain of one task, both ways (cycles stop where they close). */
export function chainOf(deps: Dependencies, root: Uuid): Chain {
  const walk = (map: ReadonlyMap<Uuid, Task[]>) => {
    const seen = new Set<Uuid>();
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      for (const t of map.get(id) ?? []) {
        if (t.id === root || seen.has(t.id)) continue;
        seen.add(t.id);
        stack.push(t.id);
      }
    }
    return seen;
  };
  return {root, before: walk(deps.waitsFor), after: walk(deps.waitedBy)};
}

/** «Espera a: Camión Demo y Vallas Demo». */
export function waitsForText(list: readonly Task[]): string {
  const names = list.map(t => t.title);
  if (names.length <= 1) return `Espera a: ${names[0] ?? ''}`;
  return `Espera a: ${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------- device

export interface TasksPrefs {
  filters: TaskFilters;
  view: TaskView;
  groupBy: GroupBy;
  /** The filter panel is open (phones start with it closed). */
  panel: boolean | null;
}

export const DEFAULT_PREFS: TasksPrefs = {
  filters: EMPTY_FILTERS,
  view: 'list',
  groupBy: 'event',
  panel: null,
};

/**
 * Per user and organization (v2). The free-text query is never stored: a
 * shared device must not show one person's search to the next. Logout
 * removes every stored copy (`clearTasksPrefs`), v1 ones included.
 */
const PREFS_PREFIX = 'oxeye.logistics.tasks-space.';
const PREFS_KEY = `${PREFS_PREFIX}v2`;

const prefsKey = (userId: string, orgId: string) =>
  `${PREFS_KEY}:${userId}:${orgId}`;

const strings = (v: unknown, max = 200): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').slice(0, max)
    : [];

/** Reads a stored copy, dropping anything malformed. */
export function parsePrefs(raw: unknown): TasksPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  const f = (r.filters ?? {}) as Record<string, unknown>;
  const date = (v: unknown) =>
    typeof v === 'string' && isLocalDate(v) ? v : '';
  return {
    filters: {
      // Never read back, even from an older copy that still holds one.
      query: '',
      events: strings(f.events),
      venues: strings(f.venues),
      companies: strings(f.companies),
      statuses: strings(f.statuses).filter((s): s is TaskStatus =>
        (TASK_STATUSES as readonly string[]).includes(s),
      ),
      from: date(f.from),
      to: date(f.to),
      withWarnings: f.withWarnings === true,
      noTime: f.noTime === true,
      noVenue: f.noVenue === true,
    },
    view: r.view === 'grouped' ? 'grouped' : 'list',
    groupBy:
      r.groupBy === 'venue' || r.groupBy === 'company' ? r.groupBy : 'event',
    panel: typeof r.panel === 'boolean' ? r.panel : null,
  };
}

/** Per user and organization: ids mean nothing in another organization. */
export function readPrefs(
  userId: string | null,
  orgId: string | null,
): TasksPrefs {
  if (!userId || !orgId) return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(prefsKey(userId, orgId));
    return raw ? parsePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(
  userId: string | null,
  orgId: string | null,
  prefs: TasksPrefs,
): void {
  if (!userId || !orgId) return;
  const stored: TasksPrefs = {
    ...prefs,
    filters: {...prefs.filters, query: ''},
  };
  try {
    localStorage.setItem(prefsKey(userId, orgId), JSON.stringify(stored));
  } catch {
    // Not remembered on this device; the screen still works.
  }
}

/** On logout: no filters stay behind for the next person on the device. */
export function clearTasksPrefs(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFS_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was stored either.
  }
}
