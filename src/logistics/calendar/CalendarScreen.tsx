/**
 * «Calendario»: month view and day view, an event filter and «Añadir tarea»
 * for the day being looked at. The day lives in the link
 * (`#logistica/calendario/2026-12-02`), so a day can be shared.
 *
 * The day is a timeline by venue on desktop, tablet and phones in landscape
 * (section swipe locked there, so horizontal gestures scroll the venues), and
 * a list by hour on phones held upright.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import type {
  LocalDate,
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {addDays, isLocalDate} from '../../../shared/logistics/time.ts';
import {useActions} from '../common/actions';
import {useMediaQuery} from '../common/useMediaQuery';
import {useNow} from '../common/useNow';
import {usePlan} from '../common/usePlan';
import {warningsSummary} from '../common/WarningList';
import {monthOf, nowMinutes, shiftMonth} from '../lib/calendar';
import {sortEvents} from '../lib/events';
import {
  dayMonthShort,
  longDate,
  monthTitle,
  plural,
  shortDate,
} from '../lib/format';
import {
  filterEvents,
  filterTasks,
  recordDate,
  sortTasks,
  type EventFilter,
} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  DateField,
  EmptyState,
  HelpTip,
  Icon,
  IconButton,
  LoadError,
  SelectField,
  SkeletonRows,
  type SelectOption,
} from '../ui';
import {DayView} from './DayView';
import {MonthView} from './MonthView';
import {clampHour, HOUR_MAX, HOUR_MIN} from './Timeline';

const HOUR_KEY = 'oxeye.logistics.hour.v1';
const DEFAULT_HOUR = 64;
const ZOOM_STEP = 1.25;
/** Phones held upright get the list by hour. */
const PORTRAIT_PHONE = '(max-width: 899px) and (orientation: portrait)';

function readHour(): number {
  try {
    const v = Number(localStorage.getItem(HOUR_KEY));
    return v ? clampHour(v) : DEFAULT_HOUR;
  } catch {
    return DEFAULT_HOUR;
  }
}

function writeHour(h: number) {
  try {
    localStorage.setItem(HOUR_KEY, String(h));
  } catch {
    // Not remembered; the default applies next time.
  }
}

export interface CalendarScreenProps {
  /** Day shown in the day view; null for the month view. */
  day: LocalDate | null;
  onDay: (day: LocalDate | null) => void;
  /** Tells the shell when the timeline is on screen (swipe lock, layout). */
  onTimelineChange: (active: boolean) => void;
}

export const CalendarScreen: React.FC<CalendarScreenProps> = ({
  day,
  onDay,
  onTimelineChange,
}) => {
  const {today, timeZone, canWrite, addTask} = useActions();
  const events = useLogisticsStore(s => s.events);
  const tasks = useLogisticsStore(s => s.tasks);
  const eventsState = useLogisticsStore(s => s.eventsState);
  const tasksState = useLogisticsStore(s => s.tasksState);
  const tasksError = useLogisticsStore(s => s.tasksError);
  const eventsError = useLogisticsStore(s => s.eventsError);
  const refresh = useLogisticsStore(s => s.refresh);
  const plan = usePlan();
  const portraitPhone = useMediaQuery(PORTRAIT_PHONE);
  // Re-renders every minute so the current-time line moves.
  useNow();

  const [focusDay, setFocusDay] = useState<LocalDate>(day ?? today);
  const [cursor, setCursor] = useState(() => monthOf(day ?? today));
  const [filter, setFilter] = useState<EventFilter>('all');
  const [hour, setHourState] = useState(readHour);

  const setHour = useCallback((h: number) => {
    const next = clampHour(h);
    setHourState(next);
    writeHour(next);
  }, []);

  // Follow day changes coming from the link or other screens.
  useEffect(() => {
    if (day) {
      setFocusDay(day);
      setCursor(monthOf(day));
    }
  }, [day]);

  const timeline = !!day && !portraitPhone;
  useEffect(() => {
    onTimelineChange(timeline);
  }, [timeline, onTimelineChange]);
  useEffect(() => () => onTimelineChange(false), [onTimelineChange]);

  // A filtered event that disappears (deleted, other organization) resets.
  const filterGone =
    filter !== 'all' && filter !== 'none' && !events.some(e => e.id === filter);
  const activeFilter: EventFilter = filterGone ? 'all' : filter;

  const shownEvents = useMemo(
    () => new Set(filterEvents(events, activeFilter).map(e => e.id)),
    [events, activeFilter],
  );
  const shownTasks = useMemo(
    () => new Set(filterTasks(tasks, activeFilter).map(t => t.id)),
    [tasks, activeFilter],
  );
  const showEvent = useCallback(
    (e: LogisticsEvent) => shownEvents.has(e.id),
    [shownEvents],
  );
  const showTask = useCallback((t: Task) => shownTasks.has(t.id), [shownTasks]);

  const loading =
    (eventsState === 'loading' || eventsState === 'idle') &&
    events.length === 0 &&
    tasks.length === 0;
  const failed = eventsState === 'error' && events.length === 0;

  const openDay = (date: LocalDate) => onDay(date);
  const goToday = () => {
    if (day) onDay(today);
    else {
      setCursor(monthOf(today));
      setFocusDay(today);
    }
  };
  const step = (delta: number) => {
    if (day) onDay(addDays(day, delta));
    else setCursor(c => shiftMonth(c, delta));
  };

  const bucket = day ? plan.byDay.get(day) : undefined;
  const dayTasks = useMemo(
    () => (bucket ? sortTasks(bucket.tasks.filter(showTask)) : []),
    [bucket, showTask],
  );
  const dayEvents = useMemo(
    () => (bucket ? sortEvents(bucket.events.filter(showEvent)) : []),
    [bucket, showEvent],
  );
  const dayWarnings = useMemo(() => {
    if (!bucket) return [];
    const ids = new Set(dayTasks.map(t => t.id));
    return [...bucket.conflicts, ...bucket.reminders].filter(w =>
      w.taskIds.some(id => ids.has(id)),
    );
  }, [bucket, dayTasks]);
  const undated = useMemo(
    () => tasks.filter(t => showTask(t) && !t.date && !t.startsAt),
    [tasks, showTask],
  );

  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  const filterOptions = useMemo<SelectOption[]>(
    () => [
      {value: 'all', label: 'Todos los eventos'},
      {value: 'none', label: 'Tareas sin evento'},
      ...sortedEvents.map(e => {
        const d = recordDate(e);
        return {
          value: e.id,
          label: e.name,
          hint: d ? dayMonthShort(d) : undefined,
          group: 'Eventos',
        };
      }),
    ],
    [sortedEvents],
  );
  const now = day ? nowMinutes(day, timeZone) : null;

  const title = day ? longDate(day) : monthTitle(cursor.year, cursor.month);
  const summary = day
    ? [
        dayEvents.length ? plural(dayEvents.length, 'evento', 'eventos') : '',
        plural(dayTasks.length, 'tarea', 'tareas'),
        dayWarnings.length ? warningsSummary(dayWarnings) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div
      className={`lx-calendar${day ? ' lx-calendar--day' : ''}`}
      id="lx-space-calendario"
    >
      <div className="lx-calbar" role="toolbar" aria-label="Calendario">
        <div className="lx-calbar__views" role="group" aria-label="Vista">
          <button
            type="button"
            className="lx-calbar__view"
            aria-pressed={!day}
            id="lx-cal-view-month"
            onClick={() => {
              if (day) {
                setCursor(monthOf(day));
                onDay(null);
              }
            }}
          >
            <Icon name="month" size={18} />
            Mes
          </button>
          <button
            type="button"
            className="lx-calbar__view"
            aria-pressed={!!day}
            id="lx-cal-view-day"
            onClick={() => !day && onDay(focusDay)}
          >
            <Icon name={portraitPhone ? 'list' : 'columns'} size={18} />
            Día
          </button>
        </div>

        <div className="lx-calbar__nav">
          <IconButton
            icon="chevronLeft"
            label={day ? 'Día anterior' : 'Mes anterior'}
            id="lx-cal-prev"
            onClick={() => step(-1)}
          />
          <h2 className="lx-calbar__title" aria-live="polite" id="lx-cal-title">
            {day ? (
              // The short form fits a phone; the long one is read out.
              <>
                <span className="lx-calbar__title-long">{title}</span>
                <span className="lx-calbar__title-short" aria-hidden="true">
                  {shortDate(day)}
                </span>
              </>
            ) : (
              title
            )}
          </h2>
          <IconButton
            icon="chevronRight"
            label={day ? 'Día siguiente' : 'Mes siguiente'}
            id="lx-cal-next"
            onClick={() => step(1)}
          />
          <Button
            size="sm"
            variant="secondary"
            id="lx-cal-today"
            onClick={goToday}
            disabled={
              day
                ? day === today
                : cursor.year === monthOf(today).year &&
                  cursor.month === monthOf(today).month
            }
          >
            Hoy
          </Button>
          {day && (
            <div className="lx-calbar__date">
              <DateField
                id="lx-cal-date"
                className="lx-calbar__dateinput"
                aria-label="Ir a la fecha"
                value={day}
                today={today}
                timeZone={timeZone}
                clearable={false}
                onChange={v => {
                  if (isLocalDate(v)) onDay(v);
                }}
              />
            </div>
          )}
        </div>

        <div className="lx-calbar__tools">
          <div className="lx-calbar__filter">
            <Icon name="calendar" size={16} />
            <SelectField
              id="lx-cal-filter"
              className="lx-calbar__select"
              aria-label="Filtrar por evento"
              value={activeFilter}
              onChange={setFilter}
              options={filterOptions}
            />
          </div>
          {timeline && (
            <div
              className="lx-calbar__zoom"
              role="group"
              aria-label="Escala de horas"
            >
              <IconButton
                icon="minus"
                variant="secondary"
                label="Reducir la escala de horas"
                id="lx-cal-zoom-out"
                disabled={hour <= HOUR_MIN}
                onClick={() => setHour(hour / ZOOM_STEP)}
              />
              <IconButton
                icon="plus"
                variant="secondary"
                label="Ampliar la escala de horas"
                id="lx-cal-zoom-in"
                disabled={hour >= HOUR_MAX}
                onClick={() => setHour(hour * ZOOM_STEP)}
              />
              <HelpTip label="la escala de horas y las columnas">
                Cambia la altura de cada hora para ver más detalle o más horas a
                la vez. En pantallas táctiles, también pellizcando con dos dedos
                sobre el plan. Cada lugar es una columna: arrastra su borde
                derecho para ensancharla o estrecharla, y contráela a sus siglas
                con el botón de su cabecera. Este dispositivo lo recuerda.
              </HelpTip>
            </div>
          )}
          {canWrite && (
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              id="lx-cal-add-task"
              onClick={() =>
                addTask({
                  date: day ?? focusDay,
                  eventId:
                    activeFilter !== 'all' && activeFilter !== 'none'
                      ? activeFilter
                      : null,
                })
              }
            >
              Tarea
            </Button>
          )}
        </div>
      </div>

      {summary && (
        <p className="lx-calendar__summary lx-num" id="lx-cal-summary">
          {summary}
          {day === today && <span className="lx-calendar__today">Hoy</span>}
        </p>
      )}

      {tasksState === 'error' && tasks.length === 0 && !failed && (
        <p className="lx-notice lx-notice--error" role="alert">
          <Icon name="alert" size={16} />
          No se han podido cargar las tareas. {tasksError}{' '}
          <Button size="sm" icon="refresh" onClick={() => void refresh()}>
            Reintentar
          </Button>
        </p>
      )}

      {loading ? (
        <SkeletonRows rows={6} label="Cargando el calendario" />
      ) : failed ? (
        <LoadError message={eventsError ?? ''} onRetry={() => void refresh()} />
      ) : day ? (
        <DayView
          date={day}
          tasks={dayTasks}
          events={dayEvents}
          warnings={dayWarnings}
          byTask={plan.byTask}
          tasksById={plan.tasksById}
          now={now}
          asList={portraitPhone}
          hour={hour}
          onHour={setHour}
        />
      ) : (
        <>
          <MonthView
            year={cursor.year}
            month={cursor.month}
            today={today}
            focusDay={focusDay}
            events={events}
            byDay={plan.byDay}
            showEvent={showEvent}
            showTask={showTask}
            onOpenDay={openDay}
            onFocusDay={setFocusDay}
            onMonth={setCursor}
          />
          {undated.length > 0 && <UndatedTasks tasks={undated} />}
          {events.length === 0 && tasks.length === 0 && (
            <EmptyState
              compact
              icon="calendar"
              title="El calendario está vacío"
              id="lx-cal-empty"
            >
              {canWrite
                ? 'Añade un evento o una tarea con «+ Añadir»; aparecerán aquí en su día.'
                : 'Cuando el equipo registre eventos o tareas, aparecerán aquí.'}
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
};

const UndatedTasks: React.FC<{tasks: Task[]}> = ({tasks}) => {
  const {openTask} = useActions();
  return (
    <section
      className="lx-calendar__undated"
      aria-labelledby="lx-cal-undated-title"
      id="lx-cal-undated"
    >
      <h3 className="lx-subtitle" id="lx-cal-undated-title">
        Tareas sin fecha · <span className="lx-num">{tasks.length}</span>
      </h3>
      <ul className="lx-chiplist">
        {tasks.map(t => (
          <li key={t.id}>
            <button
              type="button"
              className="lx-pendingchip"
              onClick={() => openTask(t)}
            >
              <span className="lx-chip__dot" aria-hidden="true" />
              {t.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
