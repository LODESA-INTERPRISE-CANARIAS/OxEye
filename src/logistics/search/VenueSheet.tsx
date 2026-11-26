/**
 * A place found by the universal search: its address and what happens there
 * (events and tasks), so «¿qué hay en la Plaza del Cristo?» has an answer.
 */
import React, {useMemo} from 'react';
import {useActions} from '../common/actions';
import {TaskRow} from '../common/TaskRow';
import {usePlan} from '../common/usePlan';
import {sortEvents} from '../lib/events';
import {dayMonthShort} from '../lib/format';
import {recordDate, sortTasks} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Pending, Sheet} from '../ui';

export const VenueSheet: React.FC<{venueId: string; onClose: () => void}> = ({
  venueId,
  onClose,
}) => {
  const venue = useLogisticsStore(s => s.venues.find(v => v.id === venueId));
  const allEvents = useLogisticsStore(s => s.events);
  const allTasks = useLogisticsStore(s => s.tasks);
  const {openEvent, openTask} = useActions();
  const plan = usePlan();
  const events = useMemo(
    () => sortEvents(allEvents.filter(e => e.venue?.id === venueId)),
    [allEvents, venueId],
  );
  const tasks = useMemo(
    () => sortTasks(allTasks.filter(t => t.venue?.id === venueId)),
    [allTasks, venueId],
  );

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-venue-sheet"
      eyebrow="Lugar"
      title={venue?.name ?? 'Lugar'}
      footer={
        <Button variant="primary" onClick={onClose} id="lx-venue-close">
          Cerrar
        </Button>
      }
    >
      <div className="lx-record">
        <p className="lx-venue__address">
          <Icon name="pin" size={18} />
          {venue?.address ?? (
            <Pending>Dirección pendiente de verificar</Pending>
          )}
        </p>
        <section className="lx-subsection" aria-labelledby="lx-venue-events">
          <h3 className="lx-subsection__title" id="lx-venue-events">
            Eventos
            <span className="lx-count lx-num">{events.length}</span>
          </h3>
          {events.length ? (
            <ul className="lx-linklist">
              {events.map(e => {
                const d = recordDate(e);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="lx-linkrow"
                      onClick={() => openEvent(e)}
                    >
                      <Icon name="calendar" size={18} />
                      <span className="lx-linkrow__title">{e.name}</span>
                      <span className="lx-linkrow__meta lx-num">
                        {d ? dayMonthShort(d) : 'Sin fecha'}
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="lx-muted">Ningún evento en este lugar.</p>
          )}
        </section>
        <section className="lx-subsection" aria-labelledby="lx-venue-tasks">
          <h3 className="lx-subsection__title" id="lx-venue-tasks">
            Tareas
            <span className="lx-count lx-num">{tasks.length}</span>
          </h3>
          {tasks.length ? (
            <ul className="lx-tasklist">
              {tasks.map(t => (
                <li key={t.id}>
                  <TaskRow
                    task={t}
                    warnings={plan.byTask.get(t.id)}
                    showDate
                    onOpen={openTask}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="lx-muted">Ninguna tarea en este lugar.</p>
          )}
        </section>
      </div>
    </Sheet>
  );
};
