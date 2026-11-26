/**
 * «El día en cifras»: records touched per type (new, changed, deleted when
 * the day's activity is known), who registered them, and how much of
 * everything recorded is still pending verification (the same figure as
 * Hoy's «Información verificada», read the other way round).
 */
import React from 'react';
import type {DayReport} from '../../../shared/logistics/day-report.ts';
import {initials, plural} from '../lib/format';
import {Card, Gauge, HelpTip, Icon, SkeletonRows} from '../ui';
import {countTiles, tileDetail} from './day';
import {TYPE_ICON} from './parts';

export const DaySummary: React.FC<{
  report: DayReport;
  /** The day's activity is still loading: figures would jump. */
  loading: boolean;
}> = ({report, loading}) => {
  const tiles = countTiles(report);
  const {pending} = report;
  const toVerify = pending.total - pending.validated;
  return (
    <Card
      title="El día en cifras"
      id="lx-day-summary"
      className="lx-daysum"
      actions={
        <HelpTip label="las cifras del día">
          Cuántos registros se dieron de alta («nuevos») o se cambiaron este
          día, y quién lo hizo, según el historial del servidor. Sin conexión
          salen de las fechas de los registros guardados en este dispositivo y
          no incluyen lo borrado.
        </HelpTip>
      }
    >
      <div className="lx-daysum__body">
        {loading ? (
          <SkeletonRows rows={4} label="Cargando las cifras del día" />
        ) : (
          <ul className="lx-daysum__tiles" aria-label="Registros del día">
            {tiles.map(t => (
              <li
                key={t.type}
                className={`lx-daysum__tile${t.total + t.deleted === 0 ? ' is-zero' : ''}`}
              >
                <span className="lx-daysum__tilehead">
                  <Icon name={TYPE_ICON[t.type]} size={16} />
                  {t.label}
                </span>
                <span className="lx-daysum__fig lx-num">{t.total}</span>
                <span className="lx-daysum__detail lx-num">
                  {tileDetail(t)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="lx-daysum__pending">
          <Gauge
            value={pending.pendingPercent}
            caption="pendiente de verificar"
            label={
              pending.pendingPercent === null
                ? 'Aún no hay información registrada'
                : `${pending.pendingPercent} % de la información registrada pendiente de verificar`
            }
          />
          <p className="lx-daysum__pendingnote lx-num">
            {pending.total === 0 ? (
              'Aún no hay información registrada.'
            ) : (
              <>
                <span
                  className="lx-legend lx-legend--dotted"
                  aria-hidden="true"
                />
                {toVerify} por verificar de{' '}
                {plural(pending.total, 'registro', 'registros')}
                <HelpTip label="información pendiente de verificar">
                  Parte de todo lo registrado (eventos, tareas, personas,
                  empresas, ofertas, almacenes y recursos) que aún no está
                  marcada como «Validado», es decir, comprobada con su fuente.
                  Las notas no cuentan. Es una ayuda para saber qué falta, no
                  una certificación.
                </HelpTip>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="lx-daysum__people">
        <p className="lx-subtitle" id="lx-day-people-title">
          Quién registró
        </p>
        {loading ? (
          <SkeletonRows rows={1} label="Cargando quién registró" />
        ) : report.contributors.length === 0 ? (
          <p className="lx-muted">Nadie registró cambios este día.</p>
        ) : (
          <ul
            className="lx-daysum__peoplelist"
            aria-labelledby="lx-day-people-title"
          >
            {report.contributors.map(c => (
              <li key={c.user.id} className="lx-daysum__person">
                <span className="lx-avatar lx-avatar--sm" aria-hidden="true">
                  {initials(c.user.displayName)}
                </span>
                <span>
                  <span className="lx-daysum__name">{c.user.displayName}</span>
                  <span className="lx-daysum__changes lx-num">
                    {plural(c.changes, 'cambio', 'cambios')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
};
