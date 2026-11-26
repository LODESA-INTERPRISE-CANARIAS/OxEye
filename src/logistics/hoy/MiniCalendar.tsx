/**
 * Month calendar for «Hoy»: a round dot per event and a square per task on
 * each day (up to three of each), a mark on days with conflicts. Arrow keys
 * move between days; selecting a day lists what happens and links to the
 * full day in Calendario.
 */
import React, {useMemo, useRef, useState} from 'react';
import type {
  LocalDate,
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {addDays} from '../../../shared/logistics/time.ts';
import {useActions} from '../common/actions';
import type {Plan} from '../common/usePlan';
import {
  clock,
  monthCells,
  monthOf,
  shiftMonth,
  spanOnDate,
} from '../lib/calendar';
import {dayMonth, monthTitle, plural, shortDate} from '../lib/format';
import {TASK_KIND_ICON} from '../lib/tasks';
import {Button, Card, Icon, IconButton, Pending} from '../ui';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WEEKDAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];

type DayRow = {start: number | null; continues: boolean} & (
  {type: 'event'; event: LogisticsEvent} | {type: 'task'; task: Task}
);

/**
 * Events and tasks of one day in a single list by the time they start on that
 * day: what continues from the day before first, then by hour, then untimed.
 */
function dayRows(
  events: LogisticsEvent[],
  tasks: Task[],
  date: LocalDate,
): DayRow[] {
  const at = (r: LogisticsEvent | Task) => {
    const span = spanOnDate(r, date);
    return {start: span?.start ?? null, continues: !!span?.continuesBefore};
  };
  const rows: DayRow[] = [
    ...events.map(event => ({type: 'event' as const, event, ...at(event)})),
    ...tasks.map(task => ({type: 'task' as const, task, ...at(task)})),
  ];
  const key = (r: DayRow) =>
    r.start === null ? Infinity : r.continues ? -1 : r.start;
  return rows.sort((a, b) => key(a) - key(b));
}

export const MiniCalendar: React.FC<{
  today: string;
  plan: Plan;
  onOpenEvent: (event: LogisticsEvent) => void;
}> = ({today, plan, onOpenEvent}) => {
  const {openTask, openDay} = useActions();
  const [cursor, setCursor] = useState(() => monthOf(today));
  const [selected, setSelected] = useState(today);
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(
    () => monthCells(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );
  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const focusable = cells.includes(selected)
    ? selected
    : cells.find(d => d.startsWith(monthPrefix))!;

  const select = (date: string, focus = false) => {
    setSelected(date);
    if (!date.startsWith(monthPrefix)) setCursor(monthOf(date));
    if (focus) {
      requestAnimationFrame(() =>
        gridRef.current
          ?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
          ?.focus(),
      );
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in steps) {
      e.preventDefault();
      select(addDays(selected, steps[e.key]), true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      select(today, true);
    }
  };

  const day = plan.byDay.get(selected);
  const dayEvents = day?.events ?? [];
  const dayTasks = day?.tasks ?? [];
  const summary = [
    dayEvents.length ? plural(dayEvents.length, 'evento', 'eventos') : '',
    dayTasks.length ? plural(dayTasks.length, 'tarea', 'tareas') : '',
  ]
    .filter(Boolean)
    .join(' y ');
  const rows = dayRows(dayEvents, dayTasks, selected);

  return (
    <Card
      title="Calendario"
      className="lx-cal"
      id="lx-calendar"
      actions={
        <div className="lx-cal__nav">
          <IconButton
            icon="chevronLeft"
            label="Mes anterior"
            onClick={() => setCursor(c => shiftMonth(c, -1))}
          />
          <IconButton
            icon="chevronRight"
            label="Mes siguiente"
            onClick={() => setCursor(c => shiftMonth(c, 1))}
          />
        </div>
      }
    >
      <p className="lx-cal__month" aria-live="polite">
        {monthTitle(cursor.year, cursor.month)}
      </p>
      <div className="lx-cal__weekdays" aria-hidden="true">
        {WEEKDAYS.map(d => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div
        className="lx-cal__grid"
        ref={gridRef}
        role="group"
        aria-label={`Días de ${monthTitle(cursor.year, cursor.month)}`}
        onKeyDown={onKeyDown}
      >
        {cells.map((date, i) => {
          const b = plan.byDay.get(date);
          const ev = b?.events.length ?? 0;
          const tk = b?.tasks.length ?? 0;
          const cf = b?.conflicts.length ?? 0;
          const outside = !date.startsWith(monthPrefix);
          const parts = [
            ev ? plural(ev, 'evento', 'eventos') : '',
            tk ? plural(tk, 'tarea', 'tareas') : '',
            cf ? plural(cf, 'conflicto', 'conflictos') : '',
          ].filter(Boolean);
          const label = `${WEEKDAY_NAMES[i % 7]} ${dayMonth(date)}${
            date === today ? ', hoy' : ''
          }, ${parts.length ? parts.join(', ') : 'sin nada registrado'}`;
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              className={[
                'lx-cal__day',
                outside ? 'is-outside' : '',
                date === today ? 'is-today' : '',
                date === selected ? 'is-selected' : '',
                cf ? 'has-conflict' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={date === focusable ? 0 : -1}
              aria-pressed={date === selected}
              aria-label={label}
              onClick={() => select(date)}
            >
              <span className="lx-num">{Number(date.slice(8))}</span>
              <span className="lx-cal__dots" aria-hidden="true">
                {Array.from({length: Math.min(ev, 3)}, (_, k) => (
                  <i key={`e${k}`} />
                ))}
                {Array.from({length: Math.min(tk, 3)}, (_, k) => (
                  <b key={`t${k}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <p className="lx-cal__legend" aria-hidden="true">
        <span>
          <i /> evento
        </span>
        <span>
          <b /> tarea
        </span>
        <span className="lx-cal__legend-conflict">
          <em /> conflicto
        </span>
      </p>

      <div className="lx-cal__day-list" id="lx-calendar-day">
        <div className="lx-cal__day-head">
          <p className="lx-cal__day-title">
            {selected === today ? 'Hoy' : shortDate(selected)}
            <span className="lx-muted">
              {' '}
              · {summary || 'sin nada registrado'}
            </span>
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon="columns"
            id="lx-calendar-open-day"
            onClick={() => openDay(selected)}
            aria-label={`Abrir ${selected === today ? 'hoy' : shortDate(selected)} en el calendario`}
          >
            Abrir el día
          </Button>
        </div>
        {rows.length > 0 && (
          <ul>
            {rows.map(row => {
              const time =
                row.start === null ? (
                  <Pending>—</Pending>
                ) : row.continues ? (
                  'sigue'
                ) : (
                  clock(row.start)
                );
              if (row.type === 'event') {
                const ev = row.event;
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      className="lx-listrow"
                      onClick={() => onOpenEvent(ev)}
                    >
                      <span className="lx-listrow__time lx-num">{time}</span>
                      <Icon name="calendar" size={16} />
                      <span className="lx-listrow__main">{ev.name}</span>
                    </button>
                  </li>
                );
              }
              const t = row.task;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className="lx-listrow"
                    onClick={() => openTask(t)}
                  >
                    <span className="lx-listrow__time lx-num">{time}</span>
                    <Icon name={TASK_KIND_ICON[t.kind]} size={16} />
                    <span className="lx-listrow__main lx-listrow__main--task">
                      {t.title}
                    </span>
                    {plan.byTask
                      .get(t.id)
                      ?.some(w => w.severity === 'conflict') && (
                      <Icon
                        name="alert"
                        size={16}
                        className="lx-listrow__alert"
                        label="Conflicto"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
};
