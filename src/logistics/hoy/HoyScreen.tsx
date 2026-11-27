/**
 * «Hoy»: today's events and tasks (now / next first), today's warnings,
 * open incidents and today's notes, upcoming events, how much information
 * is verified, the month at a glance and recent activity.
 *
 * Wide screens: the day and the notes side by side, «Próximos eventos»
 * across the whole width (up to four columns), then the rest beside the
 * month and the activity. Narrower screens stack everything in that order.
 */
import React, {useMemo} from 'react';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {useMediaQuery} from '../common/useMediaQuery';
import {usePlan} from '../common/usePlan';
import {EventCard} from '../events/EventCard';
import {groupForToday} from '../lib/events';
import {shortDate} from '../lib/format';
import {sortTasks} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, EmptyState, LoadError} from '../ui';
import {ActivityCard} from './ActivityCard';
import {DemoNotice, type DemoCounts} from './DemoNotice';
import {MiniCalendar} from './MiniCalendar';
import {NotesCard} from './NotesCard';
import {TodayTasks} from './TodayTasks';
import {emptySummary, summarizeEvents} from './upcoming';
import {VerifiedCard} from './VerifiedCard';
import {WarningsCard} from './WarningsCard';

/**
 * Upcoming events shown before «Y N más»: two rows of four on a wide screen,
 * fewer on a phone, where each card takes the whole width.
 */
const MAX_UPCOMING = 8;
const MAX_UPCOMING_PHONE = 4;

export interface HoyScreenProps {
  today: string;
  timeZone: string;
  canWrite: boolean;
  onOpenEvent: (event: LogisticsEvent) => void;
  onAdd: () => void;
}

const Section: React.FC<{
  id: string;
  title: React.ReactNode;
  count?: number;
  className?: string;
  children: React.ReactNode;
}> = ({id, title, count, className, children}) => (
  <section
    className={className ? `lx-section ${className}` : 'lx-section'}
    aria-labelledby={`${id}-title`}
    id={id}
  >
    <h2 className="lx-section__title" id={`${id}-title`}>
      {title}
      {count != null && <span className="lx-count lx-num">{count}</span>}
    </h2>
    {children}
  </section>
);

const CardsSkeleton: React.FC = () => (
  <div className="lx-event-grid" role="status" aria-label="Cargando eventos">
    {[0, 1].map(i => (
      <div key={i} className="lx-event lx-event--skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    ))}
  </div>
);

export const HoyScreen: React.FC<HoyScreenProps> = ({
  today,
  timeZone,
  canWrite,
  onOpenEvent,
  onAdd,
}) => {
  const events = useLogisticsStore(s => s.events);
  const state = useLogisticsStore(s => s.eventsState);
  const error = useLogisticsStore(s => s.eventsError);
  const tasks = useLogisticsStore(s => s.tasks);
  const tasksState = useLogisticsStore(s => s.tasksState);
  const tasksError = useLogisticsStore(s => s.tasksError);
  const refresh = useLogisticsStore(s => s.refresh);
  const hasOrg = useLogisticsStore(s => !!s.orgId);
  const {addTask, openDay, openTask} = useActions();
  const plan = usePlan();
  // Same breakpoint as the single-column layout in screens.css.
  const phone = useMediaQuery('(max-width: 599px)');
  const maxUpcoming = phone ? MAX_UPCOMING_PHONE : MAX_UPCOMING;

  const {todayEvents, upcoming, undated} = useMemo(
    () => groupForToday(events, today),
    [events, today],
  );
  // The plan's day index already holds them (in the store's time order).
  const todayTasks = useMemo(
    () => sortTasks(plan.byDay.get(today)?.tasks ?? []),
    [plan, today],
  );
  // Tasks, warnings and companies per event, from the shared plan.
  const summaries = useMemo(
    () => summarizeEvents(tasks, plan.warnings),
    [tasks, plan],
  );
  // Each event's open tasks in time order, for the wider upcoming cards.
  const openTasksOf = useMemo(() => {
    const out = new Map<string, Task[]>();
    for (const t of sortTasks(tasks)) {
      if (!t.eventId || t.status === 'done' || t.status === 'cancelled') {
        continue;
      }
      const list = out.get(t.eventId) ?? [];
      list.push(t);
      out.set(t.eventId, list);
    }
    return out;
  }, [tasks]);
  const contacts = useLogisticsStore(s => s.contacts);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const resources = useLogisticsStore(s => s.resources);
  const notes = useLogisticsStore(s => s.notes);
  // Every kind the demo seed creates, so the notice (and the only way to
  // remove them) stays while any removable demo record is left.
  const demo = useMemo<DemoCounts>(() => {
    const count = (list: {isDemo: boolean}[]) =>
      list.filter(r => r.isDemo).length;
    // As on the server: a demo company or warehouse still used by a real
    // record is kept, so it is not counted (the notice would never go away).
    const usedByReal = new Set<string>();
    for (const r of [...tasks, ...contacts, ...resources]) {
      if (!r.isDemo && r.company) usedByReal.add(r.company.id);
    }
    for (const o of offers) if (!o.isDemo) usedByReal.add(o.company.id);
    for (const r of resources) {
      if (!r.isDemo && r.warehouse) usedByReal.add(r.warehouse.id);
    }
    for (const n of notes) if (!n.isDemo && n.ref) usedByReal.add(n.ref.id);
    return {
      events: count(events),
      tasks: count(tasks),
      contacts: count(contacts),
      companies: companies.filter(c => c.isDemo && !usedByReal.has(c.id))
        .length,
      offers: count(offers),
      warehouses: warehouses.filter(w => w.isDemo && !usedByReal.has(w.id))
        .length,
      resources: count(resources),
      notes: count(notes),
    };
  }, [
    events,
    tasks,
    contacts,
    companies,
    offers,
    warehouses,
    resources,
    notes,
  ]);
  const demoCount = Object.values(demo).reduce((a, b) => a + b, 0);
  const loading =
    (state === 'loading' || state === 'idle') && events.length === 0;
  const failed = state === 'error' && events.length === 0;
  const tasksReady = tasksState === 'ready' || tasks.length > 0;
  const nothingToday = todayEvents.length === 0 && todayTasks.length === 0;

  /**
   * Today's cards keep the short form (the day's tasks and warnings follow
   * right below); upcoming and undated ones say what the event needs.
   */
  const card = (
    event: LogisticsEvent,
    showDate: boolean,
    size?: 'full' | 'half',
  ) => (
    <EventCard
      key={event.id}
      event={event}
      canWrite={canWrite}
      showDate={showDate}
      today={today}
      taskCount={summaries.get(event.id)?.tasks}
      summary={
        showDate && tasksReady
          ? (summaries.get(event.id) ?? emptySummary())
          : undefined
      }
      size={size}
      nextTasks={size ? openTasksOf.get(event.id) : undefined}
      onOpenTask={openTask}
      onOpen={onOpenEvent}
    />
  );
  // One or two upcoming events use the whole row with a richer card; three
  // or more keep the regular one (never on a portrait phone).
  const shownUpcoming = upcoming.slice(0, maxUpcoming);
  const upcomingSize: 'full' | 'half' | undefined = phone
    ? undefined
    : shownUpcoming.length === 1
      ? 'full'
      : shownUpcoming.length === 2
        ? 'half'
        : undefined;

  // Nothing will load without an organization (`refresh` has nothing to ask
  // for), so say why instead of showing a skeleton forever.
  if (!hasOrg) {
    return (
      <div className="lx-hoy" id="lx-space-hoy">
        <EmptyState icon="user" title="Sin organización" id="lx-no-org">
          No perteneces a ninguna organización todavía. Pide acceso a quien
          gestiona el Gestor logístico.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="lx-hoy" id="lx-space-hoy">
      {demoCount > 0 && <DemoNotice counts={demo} canWrite={canWrite} />}
      <div className="lx-hoy__grid">
        {/* Two independent columns on a wide screen, so a long notes card
            never leaves a gap under the day (CSS orders them on a phone). */}
        <div className="lx-hoy__col lx-hoy__col--main">
          <div className="lx-hoy__main">
            <Section
              id="lx-today"
              title={<>Hoy · {shortDate(today)}</>}
              count={loading || failed ? undefined : todayEvents.length}
            >
              {loading ? (
                <CardsSkeleton />
              ) : failed ? (
                <LoadError
                  message={error ?? ''}
                  onRetry={() => void refresh()}
                />
              ) : nothingToday && tasksState !== 'error' ? (
                <EmptyState
                  icon="today"
                  title="Hoy no hay nada registrado"
                  id="lx-today-empty"
                  action={
                    canWrite && (
                      <div className="lx-empty__actions">
                        <Button variant="primary" icon="plus" onClick={onAdd}>
                          Añadir evento
                        </Button>
                        <Button
                          icon="task"
                          id="lx-today-empty-add-task"
                          onClick={() => addTask({date: today})}
                        >
                          Añadir tarea
                        </Button>
                      </div>
                    )
                  }
                >
                  {canWrite
                    ? 'Apunta lo que sepas ahora; podrás completarlo después.'
                    : 'Cuando el equipo registre algo para hoy, aparecerá aquí.'}
                </EmptyState>
              ) : (
                <>
                  {todayEvents.length > 0 ? (
                    <div className="lx-event-grid">
                      {todayEvents.map(e => card(e, false))}
                    </div>
                  ) : (
                    nothingToday && (
                      <p className="lx-muted" id="lx-today-empty">
                        Hoy no hay eventos registrados.
                      </p>
                    )
                  )}
                  {(todayTasks.length > 0 || tasksState === 'error') && (
                    <TodayTasks
                      tasks={todayTasks}
                      plan={plan}
                      state={tasksState}
                      error={tasksError}
                      onRetry={() => void refresh()}
                    />
                  )}
                </>
              )}
            </Section>

            {/* Only with tasks today: «sin avisos» means something then. */}
            {!loading && !failed && tasksReady && todayTasks.length > 0 && (
              <WarningsCard plan={plan} />
            )}
          </div>

          {!loading && !failed && (
            <Section
              id="lx-upcoming"
              title="Próximos eventos"
              count={upcoming.length}
              className="lx-hoy__wide"
            >
              {upcoming.length ? (
                <>
                  <div
                    className="lx-event-grid lx-event-grid--upcoming"
                    data-count={Math.min(shownUpcoming.length, 3)}
                  >
                    {shownUpcoming.map(e => card(e, true, upcomingSize))}
                  </div>
                  {upcoming.length > maxUpcoming && (
                    <p className="lx-section__more" id="lx-upcoming-more">
                      <span className="lx-muted">
                        Y {upcoming.length - maxUpcoming} más.
                      </span>{' '}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="month"
                        onClick={() =>
                          openDay(upcoming[maxUpcoming].date ?? today)
                        }
                      >
                        Verlos en el calendario
                      </Button>
                    </p>
                  )}
                </>
              ) : (
                <EmptyState
                  compact
                  icon="calendar"
                  title="Sin eventos próximos"
                >
                  Los eventos con fecha posterior a hoy aparecerán aquí.
                </EmptyState>
              )}
            </Section>
          )}

          {!loading && !failed && (
            <div className="lx-hoy__rest">
              {undated.length > 0 && (
                <Section
                  id="lx-undated"
                  title="Sin fecha"
                  count={undated.length}
                >
                  <div className="lx-event-grid">
                    {undated.map(e => card(e, true))}
                  </div>
                </Section>
              )}
              <VerifiedCard
                events={events}
                tasks={tasks}
                canWrite={canWrite}
                onOpenEvent={onOpenEvent}
              />
            </div>
          )}
        </div>

        <div className="lx-hoy__col lx-hoy__col--side">
          {/* Right after the day (beside it on a wide screen): on site it is
            the first thing to check and to write. */}
          <div className="lx-hoy__notes">
            <NotesCard />
          </div>

          <div className="lx-hoy__side">
            <MiniCalendar today={today} plan={plan} onOpenEvent={onOpenEvent} />
            <ActivityCard timeZone={timeZone} />
          </div>
        </div>
      </div>
    </div>
  );
};
