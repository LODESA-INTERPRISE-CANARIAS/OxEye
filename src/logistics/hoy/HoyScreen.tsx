/**
 * «Hoy»: today's and upcoming events, how much information is verified,
 * the month at a glance and recent activity.
 */
import React, {useMemo} from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {EventCard} from '../events/EventCard';
import {groupForToday} from '../lib/events';
import {shortDate} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, EmptyState, LoadError} from '../ui';
import {ActivityCard} from './ActivityCard';
import {DemoNotice} from './DemoNotice';
import {MiniCalendar} from './MiniCalendar';
import {VerifiedCard} from './VerifiedCard';

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
  const refresh = useLogisticsStore(s => s.refresh);
  const hasOrg = useLogisticsStore(s => !!s.orgId);

  const {todayEvents, upcoming, undated} = useMemo(
    () => groupForToday(events, today),
    [events, today],
  );
  const demoCount = events.filter(e => e.isDemo).length;
  const loading =
    (state === 'loading' || state === 'idle') && events.length === 0;
  const failed = state === 'error' && events.length === 0;

  const card = (event: LogisticsEvent, showDate: boolean) => (
    <EventCard
      key={event.id}
      event={event}
      canWrite={canWrite}
      showDate={showDate}
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
      {demoCount > 0 && <DemoNotice count={demoCount} canWrite={canWrite} />}
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
            ) : todayEvents.length ? (
              <div className="lx-event-grid">
                {todayEvents.map(e => card(e, false))}
              </div>
            ) : (
              <EmptyState
                icon="today"
                title="Hoy no hay eventos registrados"
                id="lx-today-empty"
                action={
                  canWrite && (
                    <Button variant="primary" icon="plus" onClick={onAdd}>
                      Añadir evento
                    </Button>
                  )
                }
              >
                {canWrite
                  ? 'Apunta lo que sepas ahora; podrás completarlo después.'
                  : 'Cuando el equipo registre algo para hoy, aparecerá aquí.'}
              </EmptyState>
            )}
          </Section>

          {!loading && !failed && (
            <Section id="lx-upcoming" title="Próximos" count={upcoming.length}>
              {upcoming.length ? (
                <>
                  <div className="lx-event-grid">
                    {upcoming.slice(0, MAX_UPCOMING).map(e => card(e, true))}
                  </div>
                  {upcoming.length > MAX_UPCOMING && (
                    <p className="lx-muted lx-section__more">
                      Y {upcoming.length - MAX_UPCOMING} más. El calendario
                      completo llega en la próxima entrega.
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
              canWrite={canWrite}
              onOpenEvent={onOpenEvent}
            />
          )}
        </div>

        <div className="lx-hoy__side">
          <MiniCalendar
            events={events}
            today={today}
            onOpenEvent={onOpenEvent}
          />
          <ActivityCard timeZone={timeZone} />
        </div>
      </div>
    </div>
  );
};
