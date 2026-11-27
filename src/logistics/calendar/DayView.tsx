/**
 * One day: its events, warnings and tasks without a time on top, then the
 * timed plan as a timeline by venue (desktop, tablet, phone in landscape) or
 * as a list by hour (phone upright). On the timeline each venue also carries
 * its own warnings in its header; the day's list stays as the overview.
 */
import React, {useMemo} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {
  LocalDate,
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {TaskRow} from '../common/TaskRow';
import {TimeWindow} from '../common/TimeWindow';
import {usePlan} from '../common/usePlan';
import {StatusChip} from '../events/EventChips';
import {spanOnDate, venueColumns} from '../lib/calendar';
import {recordDate} from '../lib/tasks';
import {Button, EmptyState, Icon} from '../ui';
import {HourList} from './HourList';
import {Timeline} from './Timeline';

export const DayView: React.FC<{
  date: LocalDate;
  tasks: Task[];
  events: LogisticsEvent[];
  warnings: PlanWarning[];
  byTask: Map<string, PlanWarning[]>;
  tasksById: Map<string, Task>;
  now: number | null;
  asList: boolean;
  hour: number;
  onHour: (hour: number) => void;
}> = ({
  date,
  tasks,
  events,
  warnings,
  byTask,
  tasksById,
  now,
  asList,
  hour,
  onHour,
}) => {
  const {canWrite, openTask, openEvent, addTask, addEvent} = useActions();
  const timed = useMemo(
    () => tasks.filter(t => spanOnDate(t, date)),
    [tasks, date],
  );
  const untimed = useMemo(
    () => tasks.filter(t => !spanOnDate(t, date)),
    [tasks, date],
  );
  const columns = useMemo(
    () =>
      venueColumns(
        timed,
        events.filter(e => spanOnDate(e, date)),
      ),
    [timed, events, date],
  );
  const {acceptedByDay} = usePlan();
  const accepted = useMemo(
    () => acceptedByDay.get(date) ?? [],
    [acceptedByDay, date],
  );

  if (!tasks.length && !events.length) {
    return (
      <EmptyState
        icon="calendar"
        title="Nada registrado para este día"
        id="lx-day-empty"
        action={
          canWrite && (
            <div className="lx-empty__actions">
              <Button
                variant="primary"
                icon="plus"
                onClick={() => addTask({date})}
              >
                Añadir tarea
              </Button>
              <Button icon="calendar" onClick={addEvent}>
                Añadir evento
              </Button>
            </div>
          )
        }
      >
        {canWrite
          ? 'Añade el montaje, las entregas o la actividad cuando los sepas.'
          : 'Cuando el equipo registre algo para este día, aparecerá aquí.'}
      </EmptyState>
    );
  }

  return (
    <div className="lx-day" id="lx-day">
      <div className="lx-day__extras">
        {events.length > 0 && (
          <section className="lx-day__events" aria-label="Eventos del día">
            {events.map(e => {
              const first = recordDate(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`lx-daychip lx-daychip--${e.status}`}
                  data-event-id={e.id}
                  onClick={() => openEvent(e)}
                >
                  <Icon name="calendar" size={18} />
                  <span className="lx-daychip__text">
                    <strong>{e.name}</strong>
                    <span>
                      <TimeWindow record={e} />
                      {e.venue ? ` · ${e.venue.name}` : ''}
                      {first && first !== date ? ' · continúa' : ''}
                    </span>
                  </span>
                  <StatusChip status={e.status} />
                </button>
              );
            })}
          </section>
        )}

        {/* The day's warnings live in the calendar bar (DayWarnings). */}
      </div>

      {timed.length === 0 && !columns.length ? (
        <p className="lx-muted lx-day__notimed">
          Ninguna tarea de este día tiene hora todavía.
        </p>
      ) : asList ? (
        timed.length ? (
          <HourList
            date={date}
            tasks={timed}
            byTask={byTask}
            now={now}
            onOpenTask={openTask}
          />
        ) : (
          <p className="lx-muted lx-day__notimed">
            Ninguna tarea de este día tiene hora todavía.
          </p>
        )
      ) : (
        <Timeline
          date={date}
          columns={columns}
          hour={hour}
          onHour={onHour}
          byTask={byTask}
          warnings={warnings}
          tasksById={tasksById}
          now={now}
          onOpenTask={openTask}
          accepted={accepted}
        />
      )}

      {untimed.length > 0 && (
        <section
          className="lx-day__untimed"
          aria-labelledby="lx-day-untimed-title"
          id="lx-day-untimed"
        >
          <h3 className="lx-subtitle" id="lx-day-untimed-title">
            Sin hora · <span className="lx-num">{untimed.length}</span>
          </h3>
          <ul className="lx-tasklist">
            {untimed.map(t => (
              <li key={t.id}>
                <TaskRow
                  task={t}
                  warnings={byTask.get(t.id)}
                  onOpen={openTask}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
