/**
 * «Lo registrado y cambiado»: one block per record type with something new
 * that day; the types without news fold into a single quiet line. Each
 * line opens its record.
 */
import React from 'react';
import type {Uuid} from '../../../shared/logistics/contracts.ts';
import {
  DAY_RECORD_LABEL,
  type DayReport,
} from '../../../shared/logistics/day-report.ts';
import {Card, EmptyState, SkeletonRows} from '../ui';
import {listJoin, RECORD_SECTIONS} from './day';
import {QuietLine, RecordLineRow, ShowMore} from './parts';

const SHOWN = 6;

export const DayRecords: React.FC<{
  report: DayReport;
  timeZone: string;
  unsent: ReadonlySet<Uuid>;
  loading: boolean;
  quiet: boolean;
}> = ({report, timeZone, unsent, loading, quiet}) => {
  const full = RECORD_SECTIONS.filter(s => report.records[s.key].length > 0);
  const empty = RECORD_SECTIONS.filter(s => report.records[s.key].length === 0);
  return (
    <Card
      title="Lo registrado y cambiado"
      id="lx-day-records"
      className="lx-dayrecords"
    >
      {loading ? (
        <SkeletonRows rows={5} label="Cargando lo registrado este día" />
      ) : quiet ? (
        <EmptyState
          compact
          icon="dayClose"
          title="No hubo cambios este día"
          id="lx-day-quiet"
        >
          Nadie registró ni cambió nada. Abajo sigue lo que falta por completar
          y lo previsto para los próximos días.
        </EmptyState>
      ) : (
        <div className="lx-dayrecords__groups">
          {full.map(s => {
            const lines = report.records[s.key];
            const titleId = `lx-day-rec-${s.key}`;
            return (
              <section
                key={s.key}
                className="lx-daygroup"
                aria-labelledby={titleId}
                id={`lx-day-records-${s.key}`}
              >
                <h3 className="lx-daygroup__title" id={titleId}>
                  {s.title}
                  <span className="lx-count lx-num">{lines.length}</span>
                </h3>
                <ShowMore
                  items={lines}
                  shown={SHOWN}
                  noun={lines.length === 1 ? 'registro' : 'registros'}
                  className="lx-daylines"
                  labelledBy={titleId}
                  render={line => (
                    <RecordLineRow
                      key={line.id}
                      line={line}
                      timeZone={timeZone}
                      unsent={unsent.has(line.id)}
                    />
                  )}
                />
              </section>
            );
          })}
          {full.length === 0 && (
            <p className="lx-muted">
              Hubo cambios en notas o borrados, pero ningún registro nuevo ni
              modificado.
            </p>
          )}
          {empty.length > 0 && (
            <QuietLine id="lx-day-records-none">
              Sin novedades en{' '}
              {listJoin(
                empty.map(s =>
                  DAY_RECORD_LABEL[s.type].toLocaleLowerCase('es-ES'),
                ),
              )}
              .
            </QuietLine>
          )}
        </div>
      )}
    </Card>
  );
};
