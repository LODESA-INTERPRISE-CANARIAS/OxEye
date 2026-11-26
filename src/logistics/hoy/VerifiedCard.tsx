/**
 * «Información verificada»: share of events and tasks validated against their
 * source, plus an actionable list of what is still missing.
 */
import React, {useMemo} from 'react';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {verificationSummary} from '../lib/events';
import {TASK_KIND_ICON} from '../lib/tasks';
import {Card, EmptyState, Gauge, HelpTip, Icon} from '../ui';

const MAX_ROWS = 4;

export const VerifiedCard: React.FC<{
  events: LogisticsEvent[];
  tasks: Task[];
  canWrite: boolean;
  onOpenEvent: (event: LogisticsEvent) => void;
}> = ({events, tasks, canWrite, onOpenEvent}) => {
  const {openTask} = useActions();
  const summary = useMemo(
    () => verificationSummary(events, tasks),
    [events, tasks],
  );
  const pending = summary.total - summary.validated;
  const rows = summary.incomplete.slice(0, MAX_ROWS);
  const more = summary.incomplete.length - rows.length;

  return (
    <Card
      title="Información verificada"
      id="lx-verified"
      className="lx-verified"
      actions={
        <HelpTip label="información verificada">
          Porcentaje de eventos y tareas marcados como «Validado», es decir,
          comprobados con su fuente. Lo demás es borrador o está por verificar.
          Es una ayuda para saber qué falta, no una certificación.
        </HelpTip>
      }
    >
      {summary.total === 0 ? (
        <EmptyState compact icon="check" title="Aún no hay nada que comprobar">
          Cuando registréis eventos y tareas, aquí verás cuánta información está
          comprobada y qué falta.
        </EmptyState>
      ) : (
        <div className="lx-verified__body">
          <div className="lx-verified__gauge">
            <Gauge
              value={summary.percent}
              caption="validado"
              label={`${summary.percent} % de los eventos y tareas validados`}
            />
            <dl className="lx-verified__legend">
              <div>
                <dt>
                  <span
                    className="lx-legend lx-legend--solid"
                    aria-hidden="true"
                  />
                  Validados
                </dt>
                <dd className="lx-num">{summary.validated}</dd>
              </div>
              <div>
                <dt>
                  <span
                    className="lx-legend lx-legend--dotted"
                    aria-hidden="true"
                  />
                  Por verificar
                </dt>
                <dd className="lx-num">{pending}</dd>
              </div>
            </dl>
          </div>
          <div className="lx-verified__missing">
            <p className="lx-subtitle">Qué falta</p>
            {rows.length === 0 ? (
              <p className="lx-muted">
                <Icon name="check" size={16} /> Todo validado y completo.
              </p>
            ) : (
              <ul className="lx-missing">
                {rows.map(row => (
                  <li key={`${row.kind}:${row.id}`}>
                    <button
                      type="button"
                      className="lx-missing__row"
                      onClick={() =>
                        row.kind === 'event'
                          ? onOpenEvent(row.event)
                          : openTask(row.task)
                      }
                      aria-label={`${canWrite ? 'Completar' : 'Ver'} ${
                        row.kind === 'event' ? 'el evento' : 'la tarea'
                      } ${row.name}: falta ${row.missing.join(', ')}`}
                    >
                      <Icon
                        name={
                          row.kind === 'event'
                            ? 'calendar'
                            : TASK_KIND_ICON[row.task.kind]
                        }
                        size={18}
                        className="lx-missing__kind"
                      />
                      <span className="lx-missing__name">{row.name}</span>
                      <span className="lx-missing__tags">
                        {row.missing.map(m => (
                          <span key={m} className="lx-missing__tag">
                            {m}
                          </span>
                        ))}
                      </span>
                      <Icon name="chevronRight" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {more > 0 && (
              <p className="lx-muted lx-num">
                y {more} {more === 1 ? 'registro más' : 'registros más'} con
                datos pendientes
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
