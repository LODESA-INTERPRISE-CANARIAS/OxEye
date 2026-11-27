/**
 * Event card for «Hoy»: name, venue, local time window, status, its tasks,
 * and the main action (edit for members, detail for guests). Missing data is
 * shown as «Pendiente de verificar», never guessed.
 *
 * With a `summary` (upcoming and undated events) the card also says what the
 * event needs without opening it: tasks and how many are closed, its plan
 * warnings and the companies involved. A narrow card (four columns) keeps the
 * same facts in a shorter form; a wider one spells the companies out.
 */
import React from 'react';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {daysBetween} from '../../../shared/logistics/time.ts';
import {TimeWindow} from '../common/TimeWindow';
import {plural, shortDate} from '../lib/format';
import {UnsentMark} from '../offline/PendingMark';
import {recordDate, recordDays} from '../lib/tasks';
import {companiesText, warningsText, type EventSummary} from '../hoy/upcoming';
import {Button, Icon, Pending} from '../ui';
import {DemoChip, StatusChip, VerificationChip} from './EventChips';

export interface EventCardProps {
  event: LogisticsEvent;
  canWrite: boolean;
  /** Shows the date (for upcoming events). */
  showDate?: boolean;
  /** Local today, to say «día 2 de 3» on multi-day events. */
  today?: string;
  /** Number of tasks of this event, when known. */
  taskCount?: number;
  /** Tasks, warnings and companies of the event (replaces `taskCount`). */
  summary?: EventSummary;
  /**
   * How much room the card has in «Próximos eventos»: `full` (the only
   * one in the row), `half` (one of two) or the regular narrow card.
   */
  size?: 'full' | 'half';
  /** The event's open tasks in time order, for the wider cards. */
  nextTasks?: Task[];
  onOpenTask?: (task: Task) => void;
  onOpen: (event: LogisticsEvent) => void;
}

/** «Mañana», «En 5 días»; null for today, the past or no date. */
function countdownText(event: LogisticsEvent, today?: string): string | null {
  const date = recordDate(event);
  if (!date || !today) return null;
  const days = daysBetween(today, date);
  if (days <= 0) return null;
  return days === 1 ? 'Mañana' : `En ${days} días`;
}

/** The first open tasks of the event, each one opening its sheet. */
const NextTasks: React.FC<{
  eventId: string;
  tasks: Task[];
  max: number;
  onOpenTask?: (task: Task) => void;
}> = ({eventId, tasks, max, onOpenTask}) => {
  const shown = tasks.slice(0, max);
  return (
    <section
      className="lx-event__next"
      aria-labelledby={`lx-event-next-${eventId}`}
    >
      <h4 className="lx-event__subtitle" id={`lx-event-next-${eventId}`}>
        Próximas tareas
      </h4>
      {shown.length === 0 ? (
        <p className="lx-muted lx-event__none">Ninguna tarea por hacer.</p>
      ) : (
        <ul className="lx-event__tasks">
          {shown.map(t => {
            const date = recordDate(t);
            const body = (
              <>
                <span className="lx-event__taskwhen lx-num">
                  {date ? shortDate(date) : 'Sin fecha'}
                  {' · '}
                  <TimeWindow record={t} />
                </span>
                <span className="lx-event__tasktitle">{t.title}</span>
                {t.company && (
                  <span className="lx-event__taskco lx-muted">
                    {t.company.name}
                  </span>
                )}
              </>
            );
            return (
              <li key={t.id} data-task-id={t.id}>
                {onOpenTask ? (
                  <button
                    type="button"
                    className="lx-event__task"
                    onClick={() => onOpenTask(t)}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="lx-event__task">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tasks.length > shown.length && (
        <p className="lx-muted lx-event__more lx-num">
          Y {plural(tasks.length - shown.length, 'tarea más', 'tareas más')}.
        </p>
      )}
    </section>
  );
};

/** Share of closed tasks, as a thin bar with its number. */
const Progress: React.FC<{summary: EventSummary}> = ({summary}) => {
  if (summary.tasks === 0) return null;
  const pct = Math.round((summary.closed / summary.tasks) * 100);
  return (
    <div className="lx-event__progress">
      <div
        className="lx-event__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Tareas cerradas"
      >
        <span style={{width: `${pct}%`}} />
      </div>
      <span className="lx-muted lx-num">
        {summary.closed} de {summary.tasks} cerradas
      </span>
    </div>
  );
};

function whenText(
  event: LogisticsEvent,
  showDate: boolean,
  today?: string,
): string {
  const date = recordDate(event);
  const days = recordDays(event);
  if (!showDate) {
    const i = today ? days.indexOf(today) : -1;
    return days.length > 1 && i >= 0
      ? `Hoy · día ${i + 1} de ${days.length}`
      : 'Hoy';
  }
  if (!date) return 'Sin fecha';
  return days.length > 1
    ? `${shortDate(date)} · ${days.length} días`
    : shortDate(date);
}

const SummaryFacts: React.FC<{summary: EventSummary; wide?: boolean}> = ({
  summary,
  wide = false,
}) => {
  const warnings = warningsText(summary);
  const open = summary.tasks - summary.closed;
  return (
    <>
      <div className="lx-event__fact--tasks">
        <dt>
          <Icon name="task" size={16} label="Tareas" />
        </dt>
        <dd className="lx-num">
          {summary.tasks === 0 ? (
            <span className="lx-muted">Sin tareas registradas</span>
          ) : (
            <>
              {plural(summary.tasks, 'tarea', 'tareas')}
              {summary.closed > 0 && (
                <span className="lx-muted">
                  {' '}
                  · {open === 0 ? 'todas cerradas' : `${open} por hacer`}
                </span>
              )}
            </>
          )}
        </dd>
      </div>
      {summary.tasks > 0 && (
        <div
          className={`lx-event__fact--warnings${
            summary.conflicts ? ' is-conflict' : ''
          }`}
        >
          <dt>
            <Icon
              name={warnings ? 'alert' : 'check'}
              size={16}
              label="Avisos"
            />
          </dt>
          <dd className="lx-num">
            {warnings ?? <span className="lx-muted">Sin avisos</span>}
          </dd>
        </div>
      )}
      {summary.companies.length > 0 && (
        <div className="lx-event__fact--companies">
          <dt>
            <Icon name="building" size={16} label="Empresas" />
          </dt>
          <dd>
            <span className="lx-event__long">
              {companiesText(summary.companies, wide ? 8 : 3)}
            </span>
            <span className="lx-event__short lx-num">
              {plural(summary.companies.length, 'empresa', 'empresas')}
            </span>
          </dd>
        </div>
      )}
    </>
  );
};

export const EventCard: React.FC<EventCardProps> = ({
  event,
  canWrite,
  showDate = false,
  today,
  taskCount,
  summary,
  size,
  nextTasks,
  onOpenTask,
  onOpen,
}) => {
  const wide = !!size && !!summary;
  const countdown = wide ? countdownText(event, today) : null;
  const notes =
    size === 'full' && event.notes && !event.restricted
      ? event.notes.trim()
      : '';
  const facts = (
    <dl className="lx-event__facts">
      <div>
        <dt>
          <Icon name="pin" size={16} label="Lugar" />
        </dt>
        <dd>
          {event.venue?.name ?? <Pending>Lugar pendiente de verificar</Pending>}
        </dd>
      </div>
      <div>
        <dt>
          <Icon name="clock" size={16} label="Horario" />
        </dt>
        <dd>
          <TimeWindow record={event} />
        </dd>
      </div>
      {summary ? (
        <SummaryFacts summary={summary} wide={wide} />
      ) : (
        taskCount != null &&
        taskCount > 0 && (
          <div>
            <dt>
              <Icon name="task" size={16} label="Tareas" />
            </dt>
            <dd className="lx-num">
              {taskCount === 1 ? '1 tarea' : `${taskCount} tareas`}
            </dd>
          </div>
        )
      )}
    </dl>
  );
  return (
    <article
      className={`lx-event${event.status === 'cancelled' ? ' lx-event--cancelled' : ''}${
        wide ? ` lx-event--${size}` : ''
      }`}
      data-event-id={event.id}
      data-size={wide ? size : undefined}
      aria-labelledby={`lx-event-title-${event.id}`}
    >
      <div className="lx-event__top">
        <p className="lx-event__when lx-num">
          {whenText(event, showDate, today)}
          {countdown && (
            <span className="lx-event__countdown"> · {countdown}</span>
          )}
        </p>
        <div className="lx-event__chips">
          <UnsentMark id={event.id} />
          {event.isDemo && <DemoChip />}
          <StatusChip status={event.status} />
        </div>
      </div>
      <h3 className="lx-event__title" id={`lx-event-title-${event.id}`}>
        {event.name}
      </h3>
      {wide ? (
        <div className="lx-event__body">
          <div className="lx-event__main">
            {facts}
            <Progress summary={summary!} />
            {notes && (
              <p className="lx-event__notes">
                {notes.length > 220
                  ? `${notes.slice(0, 220).trimEnd()}…`
                  : notes}
              </p>
            )}
          </div>
          <NextTasks
            eventId={event.id}
            tasks={nextTasks ?? []}
            max={size === 'full' ? 5 : 3}
            onOpenTask={onOpenTask}
          />
        </div>
      ) : (
        facts
      )}
      <div className="lx-event__foot">
        <VerificationChip verification={event.verification} />
        <Button
          size="sm"
          variant={canWrite ? 'secondary' : 'ghost'}
          icon={canWrite ? 'edit' : 'eye'}
          className="lx-event__action"
          onClick={() => onOpen(event)}
          aria-label={`${canWrite ? 'Editar' : 'Ver detalle de'} ${event.name}`}
        >
          {canWrite ? 'Editar' : 'Ver detalle'}
        </Button>
      </div>
    </article>
  );
};
