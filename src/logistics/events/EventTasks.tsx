/**
 * «Tareas» of an event inside its sheet: what has to happen for it (set-up,
 * deliveries, dismantling), in time order, with a way to add one.
 */
import React, {useMemo} from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {TaskRow} from '../common/TaskRow';
import {usePlan} from '../common/usePlan';
import {recordDate, tasksOfEvent} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, HelpTip} from '../ui';

export const EventTasks: React.FC<{event: LogisticsEvent}> = ({event}) => {
  const allTasks = useLogisticsStore(s => s.tasks);
  const tasksState = useLogisticsStore(s => s.tasksState);
  const {canWrite, openTask, addTask} = useActions();
  const plan = usePlan();
  const tasks = useMemo(
    () => tasksOfEvent(allTasks, event.id),
    [allTasks, event.id],
  );
  const conflicts = tasks.filter(t =>
    plan.byTask.get(t.id)?.some(w => w.severity === 'conflict'),
  ).length;

  return (
    <section
      className="lx-subsection"
      id="lx-event-tasks"
      aria-labelledby="lx-event-tasks-title"
    >
      <div className="lx-subsection__head">
        <h3 className="lx-subsection__title" id="lx-event-tasks-title">
          Tareas
          <span className="lx-count lx-num">{tasks.length}</span>
          <HelpTip label="tareas del evento">
            Lo que hay que hacer para este evento: montajes, entregas,
            transportes, la propia actividad y el desmontaje, con su empresa y
            su horario. Se ven también en el Calendario.
          </HelpTip>
        </h3>
        {canWrite && (
          <Button
            size="sm"
            icon="plus"
            id="lx-event-add-task"
            onClick={() =>
              addTask({
                eventId: event.id,
                date: recordDate(event),
                venueName: event.venue?.name ?? null,
              })
            }
          >
            Añadir tarea
          </Button>
        )}
      </div>
      {conflicts > 0 && (
        <p className="lx-notice lx-notice--error">
          {conflicts === 1
            ? '1 tarea tiene un conflicto.'
            : `${conflicts} tareas tienen conflictos.`}{' '}
          Ábrela para ver el detalle.
        </p>
      )}
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
        <p className="lx-muted">
          {tasksState === 'error'
            ? 'No se han podido cargar las tareas.'
            : canWrite
              ? 'Sin tareas todavía. Añade el montaje, las entregas o el desmontaje cuando los sepas.'
              : 'Sin tareas registradas.'}
        </p>
      )}
    </section>
  );
};
