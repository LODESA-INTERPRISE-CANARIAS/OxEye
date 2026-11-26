/**
 * Today's tasks for «Hoy», ordered for someone on site: what should be
 * happening now, what comes next, the rest by hour, tasks without a time,
 * and (folded) what is already over.
 */
import React, {useMemo} from 'react';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {TaskRow, type RowEmphasis} from '../common/TaskRow';
import {useNow} from '../common/useNow';
import type {Plan} from '../common/usePlan';
import {minutesInDay, spanOnDate} from '../lib/calendar';
import {taskZone} from '../lib/tasks';
import {Button, Card, HelpTip, LoadError} from '../ui';

interface Groups {
  current: {task: Task; emphasis: RowEmphasis | undefined}[];
  untimed: Task[];
  past: Task[];
}

function groupTasks(tasks: Task[], today: string, now: number): Groups {
  const nowIso = new Date(now).toISOString();
  const current: Groups['current'] = [];
  const untimed: Task[] = [];
  const past: Task[] = [];
  let nextStart: number | null = null;
  const timed: {task: Task; start: number; end: number}[] = [];
  for (const task of tasks) {
    const span = spanOnDate(task, today);
    if (!span) {
      untimed.push(task);
      continue;
    }
    timed.push({task, start: span.start, end: span.end});
  }
  for (const {task, start, end} of timed) {
    const nowMin = minutesInDay(nowIso, today, taskZone(task));
    const over =
      task.status === 'done' ||
      task.status === 'cancelled' ||
      (end <= nowMin && task.status !== 'in_progress');
    if (over) {
      past.push(task);
      continue;
    }
    const running =
      task.status === 'in_progress' || (start <= nowMin && nowMin < end);
    if (!running && (nextStart === null || start < nextStart)) {
      nextStart = start;
    }
    current.push({task, emphasis: running ? 'now' : undefined});
  }
  for (const row of current) {
    if (row.emphasis) continue;
    const span = spanOnDate(row.task, today);
    if (span && span.start === nextStart) row.emphasis = 'next';
  }
  // Running first, then by start (already in time order).
  current.sort(
    (a, b) => Number(b.emphasis === 'now') - Number(a.emphasis === 'now'),
  );
  return {current, untimed, past};
}

export const TodayTasks: React.FC<{
  tasks: Task[];
  plan: Plan;
  state: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry: () => void;
}> = ({tasks, plan, state, error, onRetry}) => {
  const {today, canWrite, openTask, addTask, openDay} = useActions();
  const now = useNow();
  const groups = useMemo(
    () => groupTasks(tasks, today, now),
    [tasks, today, now],
  );
  const row = (task: Task, emphasis?: RowEmphasis) => (
    <li key={task.id}>
      <TaskRow
        task={task}
        warnings={plan.byTask.get(task.id)}
        emphasis={emphasis}
        onOpen={openTask}
      />
    </li>
  );

  return (
    <Card
      title={
        <>
          Tareas de hoy
          {state === 'ready' && (
            <span className="lx-count lx-num">{tasks.length}</span>
          )}
        </>
      }
      id="lx-today-tasks"
      className="lx-todaytasks"
      actions={
        <>
          <HelpTip label="tareas de hoy">
            Primero lo que debería estar pasando ahora y lo siguiente; después,
            el resto por hora. Las que ya han terminado quedan plegadas al
            final.
          </HelpTip>
          <Button
            size="sm"
            variant="ghost"
            icon="columns"
            id="lx-today-open-day"
            onClick={() => openDay(today)}
          >
            Ver el día
          </Button>
        </>
      }
    >
      {state === 'error' && tasks.length === 0 ? (
        <LoadError message={error ?? ''} onRetry={onRetry} />
      ) : (
        <>
          {groups.current.length > 0 && (
            <ul className="lx-tasklist">
              {groups.current.map(r => row(r.task, r.emphasis))}
            </ul>
          )}
          {groups.untimed.length > 0 && (
            <>
              <p className="lx-subtitle lx-tasklist__label">Sin hora</p>
              <ul className="lx-tasklist">{groups.untimed.map(t => row(t))}</ul>
            </>
          )}
          {groups.current.length === 0 && groups.untimed.length === 0 && (
            <p className="lx-muted lx-todaytasks__none">
              {groups.past.length
                ? 'No queda nada pendiente para hoy.'
                : 'Hoy no hay tareas registradas.'}
            </p>
          )}
          {groups.past.length > 0 && (
            <details className="lx-disclosure lx-todaytasks__past">
              <summary>
                Ya terminadas o pasadas{' '}
                <span className="lx-num">({groups.past.length})</span>
              </summary>
              <ul className="lx-tasklist">
                {groups.past.map(t => row(t, 'past'))}
              </ul>
            </details>
          )}
          {canWrite && (
            <Button
              size="sm"
              icon="plus"
              className="lx-todaytasks__add"
              id="lx-today-add-task"
              onClick={() => addTask({date: today})}
            >
              Añadir tarea para hoy
            </Button>
          )}
        </>
      )}
    </Card>
  );
};
