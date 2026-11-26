/**
 * Event card for «Hoy»: name, venue, local time window, status, and the main
 * action (edit for members, detail for guests). Missing data is shown as
 * «Pendiente de verificar», never guessed.
 */
import React from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {eventSlot} from '../lib/events';
import {shortDate} from '../lib/format';
import {Button, Icon, Pending} from '../ui';
import {DemoChip, StatusChip, VerificationChip} from './EventChips';

export function timeWindow(event: LogisticsEvent): React.ReactNode {
  const {startTime, endTime} = eventSlot(event);
  if (!startTime && !endTime) {
    return <Pending>Horario pendiente de verificar</Pending>;
  }
  return (
    <span className="lx-num">
      {startTime ?? <Pending>inicio</Pending>}
      {' – '}
      {endTime ?? <Pending>fin</Pending>}
    </span>
  );
}

export interface EventCardProps {
  event: LogisticsEvent;
  canWrite: boolean;
  /** Shows the date (for upcoming events). */
  showDate?: boolean;
  onOpen: (event: LogisticsEvent) => void;
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  canWrite,
  showDate = false,
  onOpen,
}) => {
  const {date} = eventSlot(event);
  return (
    <article
      className={`lx-event${event.status === 'cancelled' ? ' lx-event--cancelled' : ''}`}
      data-event-id={event.id}
      aria-labelledby={`lx-event-title-${event.id}`}
    >
      <div className="lx-event__top">
        <p className="lx-event__when lx-num">
          {!showDate ? 'Hoy' : date ? shortDate(date) : 'Sin fecha'}
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
            {event.venue?.name ?? (
              <Pending>Lugar pendiente de verificar</Pending>
            )}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="clock" size={16} label="Horario" />
          </dt>
          <dd>{timeWindow(event)}</dd>
        </div>
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
};
