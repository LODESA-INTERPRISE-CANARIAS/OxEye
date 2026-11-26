/**
 * «Hoy»: today's events and tasks (now / next first), today's warnings,
 * upcoming events, how much information is verified, the month at a glance
 * and recent activity.
 */
import React, {useMemo} from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
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
import {TodayTasks} from './TodayTasks';
import {VerifiedCard} from './VerifiedCard';
import {WarningsCard} from './WarningsCard';

const MAX_UPCOMING = 6;

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
  children: React.ReactNode;
}> = ({id, title, count, children}) => (
  <section className="lx-section" aria-labelledby={`${id}-title`} id={id}>
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
  const {addTask, openDay} = useActions();
  const plan = usePlan();

  const {todayEvents, upcoming, undated} = useMemo(
    () => groupForToday(events, today),
    [events, today],
  );
  // The plan's day index already holds them (in the store's time order).
  const todayTasks = useMemo(
    () => sortTasks(plan.byDay.get(today)?.tasks ?? []),
    [plan, today],
  );
  const taskCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      if (t.eventId) counts.set(t.eventId, (counts.get(t.eventId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);
  const contacts = useLogisticsStore(s => s.contacts);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  // Every kind the demo seed creates, so the notice (and the only way to
  // remove them) stays while any removable demo record is left.
  const demo = useMemo<DemoCounts>(() => {
    const count = (list: {isDemo: boolean}[]) =>
      list.filter(r => r.isDemo).length;
    // As on the server: a demo company still used by a real task, person or
    // offer is kept, so it is not counted (the notice would never go away).
    const usedByReal = new Set<string>();
    for (const r of [...tasks, ...contacts]) {
      if (!r.isDemo && r.company) usedByReal.add(r.company.id);
    }
    for (const o of offers) if (!o.isDemo) usedByReal.add(o.company.id);
    return {
      events: count(events),
      tasks: count(tasks),
      contacts: count(contacts),
      companies: companies.filter(c => c.isDemo && !usedByReal.has(c.id))
        .length,
      offers: count(offers),
    };
  }, [events, tasks, contacts, companies, offers]);
  const demoCount = Object.values(demo).reduce((a, b) => a + b, 0);
  const loading =
    (state === 'loading' || state === 'idle') && events.length === 0;
  const failed = state === 'error' && events.length === 0;
  const tasksReady = tasksState === 'ready' || tasks.length > 0;
  const nothingToday = todayEvents.length === 0 && todayTasks.length === 0;

  const card = (event: LogisticsEvent, showDate: boolean) => (
    <EventCard
      key={event.id}
      event={event}
      canWrite={canWrite}
      showDate={showDate}
      today={today}
      taskCount={taskCount.get(event.id)}
      onOpen={onOpenEvent}
    />
  );

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
        <div className="lx-hoy__main">
          <Section
            id="lx-today"
            title={<>Hoy · {shortDate(today)}</>}
            count={loading || failed ? undefined : todayEvents.length}
          >
            {loading ? (
              <CardsSkeleton />
            ) : failed ? (
              <LoadError message={error ?? ''} onRetry={() => void refresh()} />
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

          {!loading && !failed && (
            <Section id="lx-upcoming" title="Próximos" count={upcoming.length}>
              {upcoming.length ? (
                <>
                  <div className="lx-event-grid">
                    {upcoming.slice(0, MAX_UPCOMING).map(e => card(e, true))}
                  </div>
                  {upcoming.length > MAX_UPCOMING && (
                    <p className="lx-section__more">
                      <span className="lx-muted">
                        Y {upcoming.length - MAX_UPCOMING} más.
                      </span>{' '}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="month"
                        onClick={() =>
                          openDay(upcoming[MAX_UPCOMING].date ?? today)
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

          {!loading && !failed && undated.length > 0 && (
            <Section id="lx-undated" title="Sin fecha" count={undated.length}>
              <div className="lx-event-grid">
                {undated.map(e => card(e, true))}
              </div>
            </Section>
          )}

          {!loading && !failed && (
            <VerifiedCard
              events={events}
              tasks={tasks}
              canWrite={canWrite}
              onOpenEvent={onOpenEvent}
            />
          )}
        </div>

        <div className="lx-hoy__side">
          <MiniCalendar today={today} plan={plan} onOpenEvent={onOpenEvent} />
          <ActivityCard timeZone={timeZone} />
        </div>
      </div>
    </div>
  );
};
