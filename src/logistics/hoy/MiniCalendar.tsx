/**
 * Month calendar with a dot per event on each day (up to three). Arrow keys
 * move between days; selecting a day lists its events below.
 */
import React, {useMemo, useRef, useState} from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {addDays} from '../../../shared/logistics/time.ts';
import {eventsByDate, eventSlot} from '../lib/events';
import {dayMonth, monthTitle, shortDate} from '../lib/format';
import {Card, IconButton, Pending} from '../ui';

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

function monthCells(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const start = addDays(first.toISOString().slice(0, 10), -offset);
  return Array.from({length: 42}, (_, i) => addDays(start, i));
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export const MiniCalendar: React.FC<{
  events: LogisticsEvent[];
  today: string;
  onOpenEvent: (event: LogisticsEvent) => void;
}> = ({events, today, onOpenEvent}) => {
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [selected, setSelected] = useState(today);
  const gridRef = useRef<HTMLDivElement>(null);
  const byDate = useMemo(() => eventsByDate(events), [events]);
  const cells = useMemo(
    () => monthCells(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );
  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const focusable = cells.includes(selected)
    ? selected
    : cells.find(d => d.startsWith(monthPrefix))!;

  const shiftMonth = (delta: number) => {
    setCursor(c => {
      const m = c.month + delta;
      return {year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12};
    });
  };

  const select = (date: string, focus = false) => {
    setSelected(date);
    if (!date.startsWith(monthPrefix)) {
      setCursor({
        year: Number(date.slice(0, 4)),
        month: Number(date.slice(5, 7)) - 1,
      });
    }
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

  const dayEvents = byDate.get(selected) ?? [];

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
            onClick={() => shiftMonth(-1)}
          />
          <IconButton
            icon="chevronRight"
            label="Mes siguiente"
            onClick={() => shiftMonth(1)}
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
          const count = byDate.get(date)?.length ?? 0;
          const outside = !date.startsWith(monthPrefix);
          const label = `${WEEKDAY_NAMES[i % 7]} ${dayMonth(date)}${
            date === today ? ', hoy' : ''
          }, ${count ? plural(count, 'evento', 'eventos') : 'sin eventos'}`;
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
                {Array.from({length: Math.min(count, 3)}, (_, k) => (
                  <i key={k} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="lx-cal__day-list" id="lx-calendar-day">
        <p className="lx-cal__day-title">
          {selected === today ? 'Hoy' : shortDate(selected)}
          <span className="lx-muted">
            {' · '}
            {dayEvents.length
              ? plural(dayEvents.length, 'evento', 'eventos')
              : 'sin eventos'}
          </span>
        </p>
        {dayEvents.length > 0 && (
          <ul>
            {dayEvents.map(ev => {
              const {startTime} = eventSlot(ev);
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    className="lx-listrow"
                    onClick={() => onOpenEvent(ev)}
                  >
                    <span className="lx-listrow__time lx-num">
                      {startTime ?? <Pending>—</Pending>}
                    </span>
                    <span className="lx-listrow__main">{ev.name}</span>
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
