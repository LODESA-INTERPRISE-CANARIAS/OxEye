/**
 * Builds the day's report from what the store holds (the server's
 * `forViewer` copies, also from the device cache) and the day's activity.
 * Never from anything else: the report sees exactly what this viewer may
 * see, and `buildDayReport` decides what of it goes into the report.
 */
import {useMemo} from 'react';
import type {LocalDate, Uuid} from '../../../shared/logistics/contracts.ts';
import {
  buildDayReport,
  type DayNoteKind,
  type DayReport,
} from '../../../shared/logistics/day-report.ts';
import {
  entriesFor,
  type OutboxEntry,
} from '../../../shared/logistics/outbox.ts';
import {useNow} from '../common/useNow';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {useDayActivity, type DayActivity} from './useDayActivity';

const pending = (state: string) => state === 'loading' || state === 'idle';

export interface DayCloseData {
  report: DayReport | null;
  activity: DayActivity & {retry: () => void};
  /** Records with a write still on this device («Pendiente de enviar»). */
  unsent: ReadonlySet<Uuid>;
  /** This user's unresolved outbox entries (labels only, never free text). */
  unsentEntries: OutboxEntry[];
  /** Nothing in the store yet and the lists are still loading. */
  recordsLoading: boolean;
}

export function useDayReport(
  date: LocalDate,
  timeZone: string,
  today: LocalDate,
  includeText: Partial<Record<DayNoteKind, boolean>>,
): DayCloseData {
  const events = useLogisticsStore(s => s.events);
  const tasks = useLogisticsStore(s => s.tasks);
  const contacts = useLogisticsStore(s => s.contacts);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const resources = useLogisticsStore(s => s.resources);
  const notes = useLogisticsStore(s => s.notes);
  const hypotheses = useLogisticsStore(s => s.hypotheses);
  const acceptances = useLogisticsStore(s => s.acceptances);
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const orgId = useLogisticsStore(s => s.orgId);
  const outbox = useLogisticsStore(s => s.outbox);
  const unsent = useLogisticsStore(s => s.unsent);
  const listsLoading = useLogisticsStore(
    s => pending(s.eventsState) || pending(s.tasksState),
  );
  const now = useNow(60_000);

  // Today's activity follows the records: when one changes, reload it.
  const refreshKey = useMemo(() => {
    if (date !== today) return '';
    let latest = '';
    let count = 0;
    for (const list of [
      events,
      tasks,
      contacts,
      companies,
      offers,
      warehouses,
      resources,
      notes,
    ] as readonly (readonly {updatedAt: string}[])[]) {
      count += list.length;
      for (const r of list) if (r.updatedAt > latest) latest = r.updatedAt;
    }
    for (const h of hypotheses) {
      const at = h.appliedAt ?? h.createdAt;
      if (at > latest) latest = at;
    }
    for (const a of acceptances) {
      if (a.acceptedAt > latest) latest = a.acceptedAt;
    }
    return `${count}|${hypotheses.length}|${acceptances.length}|${latest}`;
  }, [
    date,
    today,
    events,
    tasks,
    contacts,
    companies,
    offers,
    warehouses,
    resources,
    notes,
    hypotheses,
    acceptances,
  ]);

  const activity = useDayActivity(date, timeZone, refreshKey);

  // The store's outbox is already this user's and organization's; the
  // filter is a cheap second guard for the labels shown in the notice.
  const unsentEntries = useMemo(
    () => (user && orgId ? entriesFor(outbox, user.id, orgId) : []),
    [outbox, user, orgId],
  );

  const report = useMemo(() => {
    if (!user) return null;
    return buildDayReport({
      date,
      timezone: timeZone,
      viewer: {id: user.id, displayName: user.displayName, role: user.role},
      generatedAt: new Date(now).toISOString(),
      activity: activity.status === 'ready' ? activity.items : null,
      events,
      tasks,
      contacts,
      companies,
      offers,
      warehouses,
      resources,
      notes,
      hypotheses,
      acceptances,
      includeText,
    });
  }, [
    user,
    date,
    timeZone,
    now,
    activity.status,
    activity.items,
    events,
    tasks,
    contacts,
    companies,
    offers,
    warehouses,
    resources,
    notes,
    hypotheses,
    acceptances,
    includeText,
  ]);

  const empty =
    events.length === 0 && tasks.length === 0 && contacts.length === 0;
  return {
    report,
    activity,
    unsent,
    unsentEntries,
    recordsLoading: listsLoading && empty,
  };
}
