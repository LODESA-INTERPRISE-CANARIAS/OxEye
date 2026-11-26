/**
 * «La jornada»: today's tasks for someone on site with a phone in one hand.
 * What is late first, then what should be happening now, what comes next,
 * the rest by hour, tasks without a time, and (folded) what is finished.
 *
 * Members move tasks on with one tap («Empezar», «Hecha», with «Deshacer»)
 * and open «¿Y si…?» from a late or running task. Open hypotheses for today
 * show as hatched chips: they never change the plan until someone applies
 * one.
 */
import React, {useMemo, useState} from 'react';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {minutesLabel} from '../../../shared/logistics/conflicts.ts';
import {useActions} from '../common/actions';
import {TaskRow, type RowEmphasis} from '../common/TaskRow';
import {useNow} from '../common/useNow';
import type {Plan} from '../common/usePlan';
import {
  DAY_GROUP_TITLE,
  canDelay,
  delayCandidates,
  groupDay,
  minutesUntilNext,
  type DayGroupId,
  type DayItem,
} from '../followup/day';
import {
  HypothesisSheet,
  type HypothesisStart,
} from '../followup/HypothesisSheet';
import {hypothesisChipLabel} from '../followup/text';
import {useQuickStatus} from '../followup/useQuickStatus';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Card, HelpTip, Icon, LoadError} from '../ui';

const EMPHASIS: Partial<Record<DayGroupId, RowEmphasis>> = {
  late: 'late',
  now: 'now',
  next: 'next',
  done: 'past',
};

/** Groups whose rows carry quick actions («Más tarde» stays quiet). */
const ACTION_GROUPS: ReadonlySet<DayGroupId> = new Set([
  'late',
  'now',
  'next',
  'untimed',
]);

const QuickActions: React.FC<{
  task: Task;
  busy: boolean;
  onStatus: (task: Task, next: 'in_progress' | 'done') => void;
  onDelay: (task: Task) => void;
}> = ({task, busy, onStatus, onDelay}) => {
  const running = task.status === 'in_progress';
  const delayable = canDelay(task);
  return (
    <div
      className="lx-dayrow__actions"
      role="group"
      aria-label={`Acciones rápidas: ${task.title}`}
    >
      {running ? (
        <Button
          size="sm"
          variant="primary"
          icon="check"
          id={`lx-quick-done-${task.id}`}
          busy={busy}
          onClick={() => onStatus(task, 'done')}
        >
          Hecha
        </Button>
      ) : (
        <Button
          size="sm"
          icon="play"
          id={`lx-quick-start-${task.id}`}
          busy={busy}
          onClick={() => onStatus(task, 'in_progress')}
        >
          Empezar
        </Button>
      )}
      {delayable && (
        <Button
          size="sm"
          variant="ghost"
          icon="clock"
          id={`lx-quick-delay-${task.id}`}
          disabled={busy}
          onClick={() => onDelay(task)}
        >
          {running ? 'Se alarga…' : 'Retraso…'}
        </Button>
      )}
    </div>
  );
};

export const TodayTasks: React.FC<{
  tasks: Task[];
  plan: Plan;
  state: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry: () => void;
}> = ({tasks, plan, state, error, onRetry}) => {
  const {today, timeZone, canWrite, openTask, addTask, openDay} = useActions();
  const now = useNow(30_000);
  const hypotheses = useLogisticsStore(s => s.hypotheses);
  const quick = useQuickStatus();
  const [hypo, setHypo] = useState<HypothesisStart | null>(null);

  const groups = useMemo(() => groupDay(tasks, now), [tasks, now]);
  const candidates = useMemo(() => delayCandidates(groups), [groups]);
  const untilNext = minutesUntilNext(groups, now);
  const openHypotheses = useMemo(() => {
    const ids = new Set(tasks.map(t => t.id));
    return hypotheses.filter(
      h => !h.appliedAt && h.taskId !== null && ids.has(h.taskId),
    );
  }, [hypotheses, tasks]);

  const pending =
    groups.late.length +
    groups.now.length +
    groups.next.length +
    groups.later.length +
    groups.untimed.length;

  const row = (item: DayItem) => {
    const {task, group} = item;
    const actions = canWrite && ACTION_GROUPS.has(group);
    return (
      <li key={task.id} className={`lx-dayrow${actions ? ' has-actions' : ''}`}>
        <TaskRow
          task={task}
          warnings={plan.byTask.get(task.id)}
          emphasis={EMPHASIS[group]}
          flag={item.flag}
          onOpen={openTask}
        />
        {actions && (
          <QuickActions
            task={task}
            busy={quick.busy.has(task.id)}
            onStatus={(t, next) => void quick.run(t, next)}
            onDelay={t => setHypo({kind: 'task', taskId: t.id})}
          />
        )}
      </li>
    );
  };

  const group = (id: Exclude<DayGroupId, 'done'>) => {
    const items = groups[id];
    if (!items.length) return null;
    const title = DAY_GROUP_TITLE[id];
    return (
      <section
        className={`lx-daygroup lx-daygroup--${id}`}
        id={`lx-day-${id}`}
        aria-labelledby={`lx-day-${id}-title`}
      >
        <h3
          className={`lx-daygroup__title${id === 'untimed' ? ' lx-tasklist__label' : ''}`}
          id={`lx-day-${id}-title`}
        >
          {id === 'late' && <Icon name="alert" size={15} />}
          {title}
          {id === 'next' && untilNext !== null && untilNext > 0 && (
            <span className="lx-daygroup__when lx-num">
              en {minutesLabel(untilNext)}
            </span>
          )}
          <span className="lx-daygroup__count lx-num">{items.length}</span>
        </h3>
        <ul className="lx-tasklist">{items.map(row)}</ul>
      </section>
    );
  };

  const anyCancelled = groups.done.some(i => i.task.status === 'cancelled');

  return (
    <Card
      title={
        <>
          La jornada
          {state === 'ready' && (
            <span className="lx-count lx-num">{tasks.length}</span>
          )}
          {groups.late.length > 0 && (
            <span
              className="lx-count lx-count--danger lx-num"
              title="Van tarde"
            >
              {groups.late.length} tarde
            </span>
          )}
        </>
      }
      id="lx-today-tasks"
      className="lx-todaytasks"
      actions={
        <>
          <HelpTip label="la jornada">
            Primero lo que va tarde, después lo que debería estar pasando ahora
            y lo siguiente; luego el resto por hora. Las terminadas quedan
            plegadas al final. «¿Y si…?» calcula qué se movería si una tarea se
            retrasa, sin cambiar el plan.
          </HelpTip>
          {candidates.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon="flask"
              id="lx-today-whatif"
              onClick={() =>
                setHypo({
                  kind: 'pick',
                  candidateIds: candidates.map(t => t.id),
                })
              }
            >
              ¿Y si…?
            </Button>
          )}
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
          {openHypotheses.length > 0 && (
            <div className="lx-hypochips" id="lx-today-hypotheses">
              <p className="lx-hypochips__label">
                <Icon name="flask" size={14} />
                Hipótesis abiertas · no cambian el plan
              </p>
              <ul className="lx-hypochips__list">
                {openHypotheses.map(h => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="lx-hypochip lx-num"
                      id={`lx-hypo-chip-${h.id}`}
                      onClick={() => setHypo({kind: 'saved', hypothesis: h})}
                    >
                      {hypothesisChipLabel(h, today, timeZone)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {group('late')}
          {group('now')}
          {group('next')}
          {group('later')}
          {group('untimed')}

          {pending === 0 && (
            <p className="lx-muted lx-todaytasks__none">
              {groups.done.length
                ? 'No queda nada pendiente para hoy.'
                : 'Hoy no hay tareas registradas.'}
            </p>
          )}
          {groups.done.length > 0 && (
            <details
              className="lx-disclosure lx-todaytasks__past"
              id="lx-day-done"
            >
              <summary>
                {anyCancelled ? 'Terminadas o canceladas' : 'Terminadas'}{' '}
                <span className="lx-num">({groups.done.length})</span>
              </summary>
              <ul className="lx-tasklist">{groups.done.map(row)}</ul>
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
      {hypo && <HypothesisSheet start={hypo} onClose={() => setHypo(null)} />}
    </Card>
  );
};
