/**
 * «Renovaciones»: tasks Ox Eye creates by itself before an offer's price
 * expires, so nobody plans an event on a price that no longer holds. The
 * notice period is a setting; expired offers stay as history only.
 */
import React, {useState} from 'react';
import {Button, Chip, EyeMark, Icon, Segmented, Select} from '../../ui';
import {OFFERS, RENEWALS, type RenewalTask} from '../data';
import {Avatar, SectionTitle, useNotify} from '../kit';
import {eur} from '../pricing';

const NOTICE = [
  {value: '15', label: '15 días'},
  {value: '30', label: '30 días'},
  {value: '60', label: '60 días'},
  {value: '90', label: '90 días'},
];

const ADMINS = ['Yeray', 'Elvis', 'Dailos', 'Fabián'];

export const RenewalsView: React.FC<{
  isAdmin: boolean;
  onRenegotiate: (task: RenewalTask) => void;
}> = ({isAdmin, onRenegotiate}) => {
  const notify = useNotify();
  const [notice, setNotice] = useState('30');
  const [tasks, setTasks] = useState(RENEWALS);
  const open = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  const expired = OFFERS.filter(o => o.acceptUntil < '2026-11-27');

  return (
    <div className="lx-mk-view" id="mk-renewals">
      <section
        className="lx-card lx-mk-notice-card"
        aria-labelledby="mk-notice-title"
      >
        <div className="lx-mk-notice-card__text">
          <h2 className="lx-card__title" id="mk-notice-title">
            Avisos de renovación
          </h2>
          <p>
            Ox Eye revisa las ofertas cada día y crea una tarea cuando a una le
            quedan menos días que este aviso, asignada a quien aprobó la oferta.
            Las caducadas se guardan en el historial y nunca se usan como tarifa
            vigente.
          </p>
        </div>
        <Segmented
          name="mk-notice"
          legend="Crear la tarea con una antelación de"
          value={notice}
          options={NOTICE}
          disabled={!isAdmin}
          onChange={v => {
            if (!v) return;
            setNotice(v);
            notify(
              `Aviso cambiado a ${v} días · se aplica a todas las ofertas.`,
            );
          }}
        />
      </section>

      <SectionTitle count={open.length}>Por renegociar</SectionTitle>
      <ul className="lx-mk-cards">
        {open.map(t => {
          const offer = OFFERS.find(o => o.id === t.offerId);
          const urgent = t.daysLeft <= 15;
          return (
            <li
              key={t.id}
              className="lx-card lx-mk-task"
              data-urgent={urgent || undefined}
              data-task={t.id}
            >
              <div className="lx-mk-task__head">
                <span className="lx-mk-task__days lx-num" aria-hidden="true">
                  <strong>{t.daysLeft}</strong>
                  <span>días</span>
                </span>
                <div className="lx-mk-task__text">
                  <h3>
                    {t.title} · vence en {t.daysLeft} días
                  </h3>
                  <p className="lx-num">
                    Precio vigente hasta el {t.expires}
                    {offer &&
                      ` · ${eur(offer.unitPrice)} ${offer.priceUnit === 'unit_day' ? 'por unidad y jornada' : ''}`}
                  </p>
                  {t.affects && (
                    <p className="lx-mk-task__affects">
                      <Icon name="alert" size={15} /> {t.affects}
                    </p>
                  )}
                </div>
              </div>
              <div className="lx-mk-task__foot">
                <span className="lx-mk-signed lx-mk-signed--ox">
                  <EyeMark size={18} /> Generada por Ox Eye · {t.generatedAt}
                </span>
                <span className="lx-mk-task__assign">
                  <label
                    htmlFor={`mk-assign-${t.id}`}
                    className="lx-visually-hidden"
                  >
                    Asignar a
                  </label>
                  {t.assignee && <Avatar name={t.assignee} size="sm" />}
                  <Select
                    id={`mk-assign-${t.id}`}
                    value={t.assignee ?? ''}
                    disabled={!isAdmin}
                    onChange={e =>
                      setTasks(ts =>
                        ts.map(x =>
                          x.id === t.id
                            ? {...x, assignee: e.target.value || null}
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="">Sin asignar</option>
                    {ADMINS.map(a => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </Select>
                </span>
              </div>
              <div className="lx-mk-task__actions">
                <Button
                  size="sm"
                  variant="primary"
                  icon="send"
                  onClick={() => onRenegotiate(t)}
                >
                  Pedir precio nuevo
                </Button>
                <Button
                  size="sm"
                  icon="check"
                  onClick={() => {
                    setTasks(ts =>
                      ts.map(x =>
                        x.id === t.id
                          ? {...x, done: 'Hecha por Yeray · ahora'}
                          : x,
                      ),
                    );
                    notify(
                      'Tarea hecha. La oferta conserva su versión hasta que apruebes la nueva.',
                    );
                  }}
                >
                  Marcar como hecha
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {done.length > 0 && (
        <>
          <SectionTitle count={done.length}>Hechas</SectionTitle>
          <ul className="lx-mk-cards">
            {done.map(t => (
              <li key={t.id} className="lx-mk-apartrow lx-mk-apartrow--done">
                <span className="lx-mk-apartrow__who">
                  <strong>{t.title}</strong>
                  <span>{t.done}</span>
                </span>
                <Chip size="sm" certainty="confirmed">
                  Hecha
                </Chip>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle count={expired.length}>Historial de caducadas</SectionTitle>
      <ul className="lx-mk-cards">
        {expired.map(o => (
          <li key={o.id} className="lx-mk-apartrow lx-mk-apartrow--expired">
            <span className="lx-mk-apartrow__who">
              <strong>
                {o.company} · {o.product}
              </strong>
              <span>
                v{o.version} · {eur(o.unitPrice)} · caducó el 30 sep 2026 · no
                se usa como tarifa vigente
              </span>
            </span>
            <Chip size="sm" tag tone="neutral">
              Caducada
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
};
