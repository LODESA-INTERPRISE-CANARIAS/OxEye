/**
 * «Información verificada»: share of the recorded information (events, tasks,
 * people, companies, offers, warehouses and resources) validated against its
 * source, plus an
 * actionable list of what is still missing.
 */
import React, {useMemo} from 'react';
import type {
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {verificationSummary, type PendingRow} from '../lib/events';
import {TASK_KIND_ICON} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Card, EmptyState, Gauge, HelpTip, Icon, type IconName} from '../ui';

const MAX_ROWS = 4;

const NOUN: Record<PendingRow['kind'], string> = {
  event: 'el evento',
  task: 'la tarea',
  contact: 'la persona',
  company: 'la empresa o entidad',
  offer: 'la oferta',
  warehouse: 'el almacén',
  resource: 'el recurso',
};

function rowIcon(row: PendingRow): IconName {
  switch (row.kind) {
    case 'event':
      return 'calendar';
    case 'task':
      return TASK_KIND_ICON[row.task.kind];
    case 'contact':
      return 'user';
    case 'company':
      return 'building';
    case 'offer':
      return 'offer';
    case 'warehouse':
      return 'warehouse';
    case 'resource':
      return 'inventory';
  }
}

export const VerifiedCard: React.FC<{
  events: LogisticsEvent[];
  tasks: Task[];
  canWrite: boolean;
  onOpenEvent: (event: LogisticsEvent) => void;
}> = ({events, tasks, canWrite, onOpenEvent}) => {
  const {
    openTask,
    openContact,
    openCompany,
    openOffer,
    openWarehouse,
    openResource,
  } = useActions();
  const contacts = useLogisticsStore(s => s.contacts);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const resources = useLogisticsStore(s => s.resources);
  const summary = useMemo(
    () =>
      verificationSummary(events, tasks, {
        contacts,
        companies,
        offers,
        warehouses,
        resources,
      }),
    [events, tasks, contacts, companies, offers, warehouses, resources],
  );
  const directoryCount =
    contacts.length +
    companies.length +
    offers.length +
    warehouses.length +
    resources.length;
  const pending = summary.total - summary.validated;
  const rows = summary.incomplete.slice(0, MAX_ROWS);
  const more = summary.incomplete.length - rows.length;

  const open = (row: PendingRow) => {
    switch (row.kind) {
      case 'event':
        return onOpenEvent(row.event);
      case 'task':
        return openTask(row.task);
      case 'contact':
        return openContact(row.contact);
      case 'company':
        return openCompany(row.company);
      case 'offer':
        return openOffer(row.offer);
      case 'warehouse':
        return openWarehouse(row.warehouse);
      case 'resource':
        return openResource(row.resource);
    }
  };

  return (
    <Card
      title="Información verificada"
      id="lx-verified"
      className="lx-verified"
      actions={
        <HelpTip label="información verificada">
          Porcentaje de lo registrado (eventos, tareas, personas, empresas,
          ofertas, almacenes y recursos) marcado como «Validado», es decir,
          comprobado con su fuente. Las notas no cuentan. Lo demás es borrador o
          está por verificar. Es una ayuda para saber qué falta, no una
          certificación.
        </HelpTip>
      }
    >
      {summary.total === 0 ? (
        <EmptyState compact icon="check" title="Aún no hay nada que comprobar">
          Cuando registréis eventos, tareas o contactos, aquí verás cuánta
          información está comprobada y qué falta.
        </EmptyState>
      ) : (
        <div className="lx-verified__body">
          <div className="lx-verified__gauge">
            <Gauge
              value={summary.percent}
              caption="validado"
              label={`${summary.percent} % de ${
                directoryCount ? 'los registros' : 'los eventos y tareas'
              } validados`}
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
                      onClick={() => open(row)}
                      aria-label={`${canWrite ? 'Completar' : 'Ver'} ${
                        NOUN[row.kind]
                      } ${row.name}: falta ${row.missing.join(', ')}`}
                    >
                      <Icon
                        name={rowIcon(row)}
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
