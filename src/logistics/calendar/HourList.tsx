/**
 * The day as a list grouped by hour, for phones held upright: each task with
 * its venue chip, the current hour marked on today.
 */
import React, {useMemo} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {LocalDate, Task} from '../../../shared/logistics/contracts.ts';
import {TaskRow} from '../common/TaskRow';
import {clock, spanOnDate} from '../lib/calendar';

export const HourList: React.FC<{
  date: LocalDate;
  tasks: Task[];
  byTask: Map<string, PlanWarning[]>;
  now: number | null;
  onOpenTask: (task: Task) => void;
}> = ({date, tasks, byTask, now, onOpenTask}) => {
  const groups = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of tasks) {
      const span = spanOnDate(t, date);
      if (!span) continue;
      const h = Math.floor(span.start / 60);
      const list = map.get(h);
      if (list) list.push(t);
      else map.set(h, [t]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [tasks, date]);
  const nowHour = now === null ? null : Math.floor(now / 60);

  return (
    <ol className="lx-hours" id="lx-hour-list" aria-label="Tareas por hora">
      {groups.map(([h, list]) => (
        <li
          key={h}
          className={`lx-hours__group${h === nowHour ? ' is-now' : ''}`}
        >
          <h3 className="lx-hours__label lx-num">
            {clock(h * 60)}
            {h === nowHour && <span className="lx-hours__now">Ahora</span>}
          </h3>
          <ul className="lx-tasklist">
            {list.map(t => (
              <li key={t.id}>
                <TaskRow
                  task={t}
                  warnings={byTask.get(t.id)}
                  onOpen={onOpenTask}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
};
