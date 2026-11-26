/**
 * Month grid: per day, what happens (events with their time, a count of
 * tasks, a conflict mark), multi-day events as continuous bars across the
 * days they cover. Tap or Enter on a day opens its day view; arrow keys move
 * between days. On narrow widths the cells become dots and thin bars.
 */
import React, {useMemo, useRef} from 'react';
import type {
  LocalDate,
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {addDays} from '../../../shared/logistics/time.ts';
import type {DayBucket} from '../lib/calendar';
import {monthCells, monthOf, weekBars} from '../lib/calendar';
import {dayMonth, plural} from '../lib/format';
import {recordDays, recordSlot} from '../lib/tasks';
import {Icon} from '../ui';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const WEEKDAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];
const MAX_LINES = 2;

export interface MonthViewProps {
  year: number;
  month: number;
  today: LocalDate;
  /** Day that keeps keyboard focus (last selected). */
  focusDay: LocalDate;
  events: LogisticsEvent[];
  byDay: Map<LocalDate, DayBucket>;
  /** Filters applied to the buckets. */
  showEvent: (e: LogisticsEvent) => boolean;
  showTask: (t: Task) => boolean;
  onOpenDay: (date: LocalDate) => void;
  onFocusDay: (date: LocalDate) => void;
  /** Shows another month (keyboard focus moved beyond the visible weeks). */
  onMonth: (cursor: {year: number; month: number}) => void;
}

export const MonthView: React.FC<MonthViewProps> = ({
  year,
  month,
  today,
  focusDay,
  events,
  byDay,
  showEvent,
  showTask,
  onOpenDay,
  onFocusDay,
  onMonth,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const weeks = useMemo(
    () => Array.from({length: 6}, (_, w) => cells.slice(w * 7, w * 7 + 7)),
    [cells],
  );
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const multiDay = useMemo(
    () => events.filter(e => showEvent(e) && recordDays(e).length > 1),
    [events, showEvent],
  );
  const focusable = cells.includes(focusDay)
    ? focusDay
    : cells.find(d => d.startsWith(prefix))!;

  const move = (date: LocalDate) => {
    onFocusDay(date);
    // Leaving the six visible weeks turns the page, as in the Hoy calendar.
    if (!cells.includes(date)) onMonth(monthOf(date));
    requestAnimationFrame(() =>
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
        ?.focus(),
    );
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
      move(addDays(focusable, steps[e.key]));
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(today);
    }
  };

  return (
    <div className="lx-month" id="lx-month">
      <div className="lx-month__weekdays" aria-hidden="true">
        {WEEKDAYS.map(d => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div
        className="lx-month__grid"
        ref={gridRef}
        role="group"
        aria-label="Días del mes. Pulsa un día para ver su plan por horas."
        onKeyDown={onKeyDown}
      >
        {weeks.map(week => {
          const bars = weekBars(multiDay, week);
          const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
          return (
            <div
              className="lx-month__week"
              key={week[0]}
              style={{'--lx-lanes': Math.min(lanes, 3)} as React.CSSProperties}
            >
              {week.map((date, i) => {
                const b = byDay.get(date);
                const evs = (b?.events ?? []).filter(showEvent);
                const tks = (b?.tasks ?? []).filter(showTask);
                const single = evs.filter(e => recordDays(e).length === 1);
                const shownIds = new Set(tks.map(t => t.id));
                const conflicts = (b?.conflicts ?? []).filter(w =>
                  w.taskIds.some(id => shownIds.has(id)),
                ).length;
                const outside = !date.startsWith(prefix);
                const parts = [
                  evs.length ? plural(evs.length, 'evento', 'eventos') : '',
                  tks.length ? plural(tks.length, 'tarea', 'tareas') : '',
                  conflicts ? plural(conflicts, 'conflicto', 'conflictos') : '',
                ].filter(Boolean);
                const names = evs.map(e => e.name).join(', ');
                const label = `${WEEKDAY_NAMES[i]} ${dayMonth(date)}${
                  date === today ? ', hoy' : ''
                }: ${parts.length ? parts.join(', ') : 'sin nada registrado'}${
                  names ? `. ${names}` : ''
                }`;
                return (
                  <button
                    key={date}
                    type="button"
                    data-date={date}
                    className={[
                      'lx-month__day',
                      outside ? 'is-outside' : '',
                      date === today ? 'is-today' : '',
                      conflicts ? 'has-conflict' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{gridColumn: i + 1}}
                    tabIndex={date === focusable ? 0 : -1}
                    aria-label={label}
                    onClick={() => onOpenDay(date)}
                    onFocus={() => date !== focusDay && onFocusDay(date)}
                  >
                    <span className="lx-month__num lx-num">
                      {Number(date.slice(8))}
                    </span>
                    {conflicts > 0 && (
                      <span className="lx-month__conflict" aria-hidden="true">
                        <Icon name="alert" size={14} />
                        <span className="lx-num">{conflicts}</span>
                      </span>
                    )}
                    <span className="lx-month__body" aria-hidden="true">
                      {single.slice(0, MAX_LINES).map(e => (
                        <span key={e.id} className="lx-month__line">
                          <span className="lx-num">
                            {recordSlot(e).startTime ?? ''}
                          </span>{' '}
                          {e.name}
                        </span>
                      ))}
                      {single.length > MAX_LINES && (
                        <span className="lx-month__more">
                          +{single.length - MAX_LINES} más
                        </span>
                      )}
                      {tks.length > 0 && (
                        <span className="lx-month__tasks">
                          <Icon name="task" size={14} />
                          <span className="lx-num">{tks.length}</span>
                          <span className="lx-month__tasks-word">
                            {tks.length === 1 ? ' tarea' : ' tareas'}
                          </span>
                        </span>
                      )}
                      <span className="lx-month__dots">
                        {Array.from(
                          {length: Math.min(single.length, 3)},
                          (_, k) => (
                            <i key={`e${k}`} />
                          ),
                        )}
                        {Array.from(
                          {length: Math.min(tks.length, 3)},
                          (_, k) => (
                            <b key={`t${k}`} />
                          ),
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
              {bars
                .filter(bar => bar.lane < 3)
                .map(bar => (
                  <span
                    key={`${bar.event.id}-${week[0]}`}
                    className={[
                      'lx-month__bar',
                      `lx-month__bar--${bar.event.status}`,
                      bar.continuesBefore ? 'is-cont-before' : '',
                      bar.continuesAfter ? 'is-cont-after' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={
                      {
                        '--lx-start': bar.start,
                        '--lx-span': bar.span,
                        '--lx-lane': bar.lane,
                      } as React.CSSProperties
                    }
                    aria-hidden="true"
                  >
                    <span className="lx-month__bar-text">{bar.event.name}</span>
                  </span>
                ))}
            </div>
          );
        })}
      </div>
      <p className="lx-month__legend" aria-hidden="true">
        <span>
          <span className="lx-month__legend-bar" /> evento de varios días
        </span>
        <span>
          <i /> evento
        </span>
        <span>
          <b /> tarea
        </span>
        <span className="lx-month__legend-conflict">
          <Icon name="alert" size={14} /> conflicto
        </span>
      </p>
    </div>
  );
};
