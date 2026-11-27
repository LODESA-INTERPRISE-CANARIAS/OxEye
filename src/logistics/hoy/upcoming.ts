/**
 * What an event card on «Hoy» can say without opening the event: how many
 * tasks it has (and how many are finished), its open plan warnings and the
 * companies involved, all derived from data already in the store. Pure, for
 * the cards and the tests.
 */
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';

export interface EventSummary {
  tasks: number;
  /** Finished or cancelled: nothing left to do for them. */
  closed: number;
  /** Warnings that involve at least one task of the event, counted once. */
  conflicts: number;
  reminders: number;
  /** Companies of the event's live tasks, by name (es-ES order). */
  companies: string[];
}

const EMPTY: EventSummary = {
  tasks: 0,
  closed: 0,
  conflicts: 0,
  reminders: 0,
  companies: [],
};

export function emptySummary(): EventSummary {
  return {...EMPTY, companies: []};
}

/** One summary per event id that has at least one task. */
export function summarizeEvents(
  tasks: readonly Pick<Task, 'id' | 'eventId' | 'status' | 'company'>[],
  warnings: readonly Pick<PlanWarning, 'key' | 'severity' | 'taskIds'>[],
): Map<string, EventSummary> {
  const out = new Map<string, EventSummary>();
  const eventOf = new Map<string, string>();
  const names = new Map<string, Map<string, string>>();
  for (const t of tasks) {
    if (!t.eventId) continue;
    eventOf.set(t.id, t.eventId);
    const s = out.get(t.eventId) ?? emptySummary();
    s.tasks += 1;
    const closed = t.status === 'done' || t.status === 'cancelled';
    if (closed) s.closed += 1;
    if (t.company && !closed) {
      const byId = names.get(t.eventId) ?? new Map<string, string>();
      byId.set(t.company.id, t.company.name);
      names.set(t.eventId, byId);
    }
    out.set(t.eventId, s);
  }
  for (const w of warnings) {
    const events = new Set(
      w.taskIds.map(id => eventOf.get(id)).filter((e): e is string => !!e),
    );
    for (const e of events) {
      const s = out.get(e);
      if (!s) continue;
      if (w.severity === 'conflict') s.conflicts += 1;
      else s.reminders += 1;
    }
  }
  for (const [eventId, byId] of names) {
    const s = out.get(eventId);
    if (s) {
      s.companies = [...new Set(byId.values())].sort((a, b) =>
        a.localeCompare(b, 'es'),
      );
    }
  }
  return out;
}

/** «Escenarios Demo, Sonido Demo y 2 más» (at most `max` names). */
export function companiesText(names: readonly string[], max = 3): string {
  if (names.length <= max) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(', ')} y ${rest} más`;
}

/** «1 conflicto · 2 recordatorios», or null when there is nothing to check. */
export function warningsText(
  s: Pick<EventSummary, 'conflicts' | 'reminders'>,
): string | null {
  const parts: string[] = [];
  if (s.conflicts) {
    parts.push(s.conflicts === 1 ? '1 conflicto' : `${s.conflicts} conflictos`);
  }
  if (s.reminders) {
    parts.push(
      s.reminders === 1 ? '1 recordatorio' : `${s.reminders} recordatorios`,
    );
  }
  return parts.length ? parts.join(' · ') : null;
}
