/**
 * Day timeline: one column per venue (plus «Sin lugar»), one row per hour.
 * Task blocks follow the certainty grammar (planned outlined, confirmed
 * solid, delayed in the danger tone, cancelled struck), overlapping blocks
 * sit side by side, conflicts get an outline, and events show as a faint
 * band behind the tasks of their venue. Today has a line at the current time.
 *
 * Scale: pinch on touch screens and Ctrl + wheel (trackpad pinch) change the
 * height of an hour; the toolbar's − / + buttons do the same for keyboard and
 * mouse. During a pinch only a CSS variable changes; the new height is
 * committed when the fingers lift.
 */
import React, {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {LocalDate, Task} from '../../../shared/logistics/contracts.ts';
import {taskLabel} from '../common/TaskRow';
import {windowText} from '../common/TimeWindow';
import {
  clock,
  layoutColumn,
  spanOnDate,
  type VenueColumn,
} from '../lib/calendar';
import {TASK_KIND_ICON} from '../lib/tasks';
import {Icon} from '../ui';

export const HOUR_MIN = 28;
export const HOUR_MAX = 180;
export const clampHour = (h: number) =>
  Math.round(Math.min(HOUR_MAX, Math.max(HOUR_MIN, h)));

/** Minimum drawn height of a block, in px. */
const MIN_BLOCK_PX = 30;
const HOURS = Array.from({length: 24}, (_, h) => h);

export interface TimelineProps {
  date: LocalDate;
  columns: VenueColumn[];
  hour: number;
  onHour: (hour: number) => void;
  byTask: Map<string, PlanWarning[]>;
  /** Minutes since midnight when the day is today. */
  now: number | null;
  onOpenTask: (task: Task) => void;
}

type Vars = React.CSSProperties & Record<`--${string}`, string | number>;

export const Timeline: React.FC<TimelineProps> = ({
  date,
  columns,
  hour,
  onHour,
  byTask,
  now,
  onOpenTask,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef(hour);
  useLayoutEffect(() => {
    hourRef.current = hour;
  });

  const layouts = useMemo(() => {
    const minMinutes = (MIN_BLOCK_PX / hour) * 60;
    return columns.map(c => layoutColumn(c.tasks, date, minMinutes));
  }, [columns, date, hour]);

  // Open at the current time on today, otherwise at the first block.
  const firstStart = useMemo(() => {
    let first: number | null = null;
    for (const blocks of layouts) {
      for (const b of blocks) {
        if (first === null || b.span.start < first) first = b.span.start;
      }
    }
    return first;
  }, [layouts]);
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || scrolledFor.current === date) return;
    scrolledFor.current = date;
    const target = now ?? firstStart ?? 8 * 60;
    el.scrollTop = Math.max(0, ((target - 60) / 60) * hourRef.current);
  }, [date, now, firstStart]);

  // Pinch (touch) and Ctrl + wheel (trackpad pinch, desktop) change the scale,
  // keeping the time under the fingers or pointer in place.
  useEffect(() => {
    const el = scrollerRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    let startDist = 0;
    let startHour = hourRef.current;
    let anchorMin = 0;
    let anchorY = 0;
    let live = hourRef.current;
    const headerH = () =>
      el.querySelector<HTMLElement>('.lx-tl__head')?.offsetHeight ?? 0;
    const apply = (h: number) => {
      live = clampHour(h);
      root.style.setProperty('--lx-hour', `${live}px`);
      el.scrollTop = (anchorMin / 60) * live + headerH() - anchorY;
    };
    const anchorAt = (clientY: number, h: number) => {
      anchorY = clientY - el.getBoundingClientRect().top;
      anchorMin = ((el.scrollTop + anchorY - headerH()) / h) * 60;
    };
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = dist(e.touches);
      startHour = hourRef.current;
      live = startHour;
      anchorAt((e.touches[0].clientY + e.touches[1].clientY) / 2, startHour);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      apply(startHour * (dist(e.touches) / startDist));
    };
    const onEnd = (e: TouchEvent) => {
      if (!startDist || e.touches.length >= 2) return;
      startDist = 0;
      if (live !== hourRef.current) onHour(live);
    };
    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (!wheelTimer) {
        startHour = hourRef.current;
        live = startHour;
      }
      anchorAt(e.clientY, live);
      apply(live * Math.exp(-e.deltaY * 0.01));
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelTimer = 0;
        if (live !== hourRef.current) onHour(live);
      }, 180);
    };
    el.addEventListener('touchstart', onStart, {passive: true});
    el.addEventListener('touchmove', onMove, {passive: false});
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('wheel', onWheel, {passive: false});
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheelTimer);
    };
  }, [onHour]);

  // A venue with blocks side by side gets wider, so each lane stays readable.
  const tracks = layouts
    .map(blocks => {
      const lanes = blocks.reduce((n, b) => Math.max(n, b.lanes), 1);
      return lanes > 1
        ? `minmax(max(var(--lx-colw), calc(${lanes} * var(--lx-lanew))), 1fr)`
        : 'minmax(var(--lx-colw), 1fr)';
    })
    .join(' ');
  const vars: Vars = {
    '--lx-hour': `${hour}px`,
    '--lx-cols': columns.length,
    '--lx-tracks': tracks,
    '--lx-minh': `${MIN_BLOCK_PX}px`,
  };

  return (
    <div className="lx-tl" ref={rootRef} style={vars} id="lx-timeline">
      <div
        className="lx-tl__scroller"
        ref={scrollerRef}
        data-no-swipe
        tabIndex={0}
        role="region"
        aria-label="Plan del día: una columna por lugar y una fila por hora. Pellizca o usa − y + para cambiar la escala."
      >
        <div className="lx-tl__grid">
          <div className="lx-tl__corner" aria-hidden="true">
            <Icon name="clock" size={16} />
          </div>
          {columns.map(c => (
            <div
              className={`lx-tl__head${c.id ? '' : ' lx-tl__head--none'}`}
              key={c.id ?? 'none'}
              aria-hidden="true"
            >
              <span className="lx-tl__venue">
                <Icon name="pin" size={14} />
                {c.name}
              </span>
              <span className="lx-tl__count lx-num">
                {c.tasks.length === 1 ? '1 tarea' : `${c.tasks.length} tareas`}
              </span>
            </div>
          ))}

          <div className="lx-tl__hours" aria-hidden="true">
            {HOURS.map(h => (
              <span
                key={h}
                className="lx-tl__hour lx-num"
                style={{'--lx-s': h * 60} as Vars}
              >
                {clock(h * 60)}
              </span>
            ))}
            {now !== null && (
              <span
                className="lx-tl__nowlabel lx-num"
                style={{'--lx-s': now} as Vars}
              >
                {clock(now)}
              </span>
            )}
          </div>

          {columns.map((c, ci) => (
            <div
              className="lx-tl__col"
              key={c.id ?? 'none'}
              role="group"
              aria-label={`${c.name}: ${
                c.tasks.length === 1 ? '1 tarea' : `${c.tasks.length} tareas`
              }`}
            >
              {c.events.map(e => {
                const span = spanOnDate(e, date);
                if (!span) return null;
                return (
                  <span
                    key={e.id}
                    className={`lx-tl__band lx-tl__band--${e.status}`}
                    style={{'--lx-s': span.start, '--lx-e': span.end} as Vars}
                    aria-hidden="true"
                  >
                    <span className="lx-tl__band-label">
                      Evento · {e.name} · {windowText(e)}
                    </span>
                  </span>
                );
              })}
              {now !== null && (
                <span
                  className="lx-tl__now"
                  style={{'--lx-s': now} as Vars}
                  aria-hidden="true"
                />
              )}
              {layouts[ci].map(({task, span, lane, lanes}) => {
                const warnings = byTask.get(task.id) ?? [];
                const conflict = warnings.some(w => w.severity === 'conflict');
                return (
                  <button
                    key={task.id}
                    type="button"
                    data-task-id={task.id}
                    className={[
                      'lx-tl__block',
                      `lx-tl__block--${task.status}`,
                      conflict ? 'has-conflict' : '',
                      span.openEnd ? 'is-open-end' : '',
                      span.continuesBefore ? 'is-cont-before' : '',
                      span.continuesAfter ? 'is-cont-after' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={
                      {
                        '--lx-s': span.start,
                        '--lx-e': span.end,
                        '--lx-lane': lane,
                        '--lx-lanes': lanes,
                      } as Vars
                    }
                    aria-label={taskLabel(task, warnings)}
                    onClick={() => onOpenTask(task)}
                  >
                    <span className="lx-tl__block-title">
                      <Icon name={TASK_KIND_ICON[task.kind]} size={15} />
                      <span>{task.title}</span>
                    </span>
                    <span className="lx-tl__block-time lx-num">
                      {windowText(task)}
                    </span>
                    {task.company && (
                      <span className="lx-tl__block-company">
                        {task.company.name}
                      </span>
                    )}
                    {warnings.length > 0 && (
                      <span className="lx-tl__block-warn" aria-hidden="true">
                        <Icon name={conflict ? 'alert' : 'bell'} size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
