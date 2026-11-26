/**
 * A work order as a page: Georgia title, the recipient and the day(s), the
 * OxEye mark, then each task with its time in tabular figures. Times not yet
 * confirmed are outlined and say «por confirmar» (OxEye's certainty grammar);
 * the routes A/B/C and Carpa Amarilla reminder stands apart. The same markup
 * is the on-screen preview and the printed page (`orders.css`).
 */
import React from 'react';
import type {WorkOrder} from '../../../shared/logistics/work-order.ts';
import {EyeMark, Icon} from '../ui';
import {orderDaysLabel} from './text';

export const WorkOrderPreview: React.FC<{
  order: WorkOrder;
  /** Id of the root element (the screen preview and the print copy differ). */
  id?: string;
}> = ({order, id}) => {
  const days = orderDaysLabel(order);
  const manyDays = !!days && days.includes(' · ');
  // A day heading where the day changes (orders spanning several days).
  const heads = order.items.map((item, i) =>
    manyDays && item.day && item.day !== order.items[i - 1]?.day
      ? item.day
      : null,
  );
  return (
    <article className="lx-order" id={id} aria-label={order.title}>
      <header className="lx-order__head">
        <div className="lx-order__titles">
          <p className="lx-order__eyebrow">Orden de trabajo</p>
          <h1 className="lx-order__recipient">{order.recipient.name}</h1>
          {days && <p className="lx-order__days">{days}</p>}
        </div>
        <div className="lx-order__brand">
          <EyeMark size={34} />
          <span>
            OxEye
            <br />
            <small>Gestor logístico</small>
          </span>
        </div>
      </header>

      {order.items.length === 0 ? (
        <p className="lx-order__empty">Ninguna tarea elegida.</p>
      ) : (
        <ol className="lx-order__items">
          {order.items.map((item, i) => {
            return (
              <li
                key={item.taskId}
                className={`lx-order__item${item.cancelled ? ' is-cancelled' : ''}`}
              >
                {heads[i] && <p className="lx-order__dayhead">{heads[i]}</p>}
                <div className="lx-order__row">
                  <div className="lx-order__when">
                    <span
                      className={`lx-order__time lx-num${item.toConfirm ? ' is-planned' : ''}`}
                    >
                      {item.time ??
                        (order.fields.includes('schedule')
                          ? 'Sin hora'
                          : `${i + 1}.`)}
                    </span>
                    {item.toConfirm && (
                      <span className="lx-order__toconfirm">por confirmar</span>
                    )}
                  </div>
                  <div className="lx-order__main">
                    <h2 className="lx-order__task">
                      {item.title}
                      {item.cancelled && (
                        <span className="lx-order__cancelled">Cancelada</span>
                      )}
                    </h2>
                    <p className="lx-order__kind">
                      {item.kindLabel} · {item.statusLabel}
                      {item.heavyLoad && (
                        <>
                          {' · '}
                          <span className="lx-order__heavy">Carga pesada</span>
                        </>
                      )}
                    </p>
                    <dl className="lx-order__facts">
                      {item.venue && (
                        <div>
                          <dt>Lugar</dt>
                          <dd>{item.venue}</dd>
                        </div>
                      )}
                      {item.eventName && (
                        <div>
                          <dt>Evento</dt>
                          <dd>{item.eventName}</dd>
                        </div>
                      )}
                      {item.materials.length > 0 && (
                        <div>
                          <dt>Material</dt>
                          <dd>
                            <ul className="lx-order__materials">
                              {item.materials.map((m, j) => (
                                <li key={j}>
                                  {m.name}{' '}
                                  <span className="lx-num">({m.quantity})</span>
                                  {[m.warehouse, m.location, m.address]
                                    .filter(Boolean)
                                    .map(w => (
                                      <span className="lx-order__where" key={w}>
                                        {' · '}
                                        {w}
                                      </span>
                                    ))}
                                </li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                      )}
                      {item.contact && (
                        <div>
                          <dt>Contacto</dt>
                          <dd>
                            {item.contact.name}
                            {item.contact.phone && (
                              <span className="lx-num">
                                {' · '}
                                {item.contact.phone}
                              </span>
                            )}
                          </dd>
                        </div>
                      )}
                      {item.dependencies.length > 0 && (
                        <div>
                          <dt>Antes</dt>
                          <dd>
                            Empieza cuando termine{' '}
                            {item.dependencies
                              .map(
                                d =>
                                  `«${d.title}»${d.when ? ` (${d.when})` : ''}`,
                              )
                              .join(', ')}
                          </dd>
                        </div>
                      )}
                      {item.observations && (
                        <div>
                          <dt>Observaciones</dt>
                          <dd className="lx-order__notes">
                            {item.observations}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {order.routesNote && (
        <aside className="lx-order__routes">
          <Icon name="transport" size={18} />
          <p>{order.routesNote}</p>
        </aside>
      )}

      <footer className="lx-order__foot">
        <p className="lx-num">
          Generada por {order.generatedBy} desde OxEye · {order.generatedAt}.
        </p>
        <p>{order.footer}</p>
      </footer>
    </article>
  );
};
