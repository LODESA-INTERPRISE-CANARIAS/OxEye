/**
 * Event card for «Hoy»: name, venue, local time window, status, its tasks,
 * and the main action (edit for members, detail for guests). Missing data is
 * shown as «Pendiente de verificar», never guessed.
 */
import React from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {TimeWindow} from '../common/TimeWindow';
import {shortDate} from '../lib/format';
import {recordDate, recordDays} from '../lib/tasks';
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
  onOpen: (event: LogisticsEvent) => void;
}

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

export const EventCard: React.FC<EventCardProps> = ({
  event,
  canWrite,
  showDate = false,
  today,
  taskCount,
  onOpen,
}) => (
  <article
    className={`lx-event${event.status === 'cancelled' ? ' lx-event--cancelled' : ''}`}
    data-event-id={event.id}
    aria-labelledby={`lx-event-title-${event.id}`}
  >
    <div className="lx-event__top">
      <p className="lx-event__when lx-num">
        {whenText(event, showDate, today)}
      </p>
      <div className="lx-event__chips">
        {event.isDemo && <DemoChip />}
        <StatusChip status={event.status} />
      </div>
    </div>
    <h3 className="lx-event__title" id={`lx-event-title-${event.id}`}>
      {event.name}
    </h3>
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
      {taskCount != null && taskCount > 0 && (
        <div>
          <dt>
            <Icon name="task" size={16} label="Tareas" />
          </dt>
          <dd className="lx-num">
            {taskCount === 1 ? '1 tarea' : `${taskCount} tareas`}
          </dd>
        </div>
      )}
    </dl>
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
