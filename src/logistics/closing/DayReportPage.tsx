/**
 * The day close as a page: the same markup is the A4 preview on screen and
 * the printed copy (`closing.css`). Georgia titles, tabular figures, the
 * certainty grammar in ink (validated solid, the rest dotted, hypotheses
 * dashed), and the safety reminders apart. Only empty sections are left
 * out; note text appears only where a member included it.
 */
import React from 'react';
import {
  ACCEPTED_TITLE,
  HYPOTHESIS_APPLIED_TITLE,
  HYPOTHESIS_OPEN_TITLE,
  NEXT_DAYS,
  subsoilLineLabel,
  type DayAcceptedLine,
  type DayHypothesisLine,
  type DayReport,
  type DayTaskLine,
} from '../../../shared/logistics/day-report.ts';
import {addDays} from '../../../shared/logistics/time.ts';
import {VERIFICATION_LABEL} from '../lib/events';
import {longDate, plural, shortDate, zoneNote} from '../lib/format';
import {EyeMark, Icon} from '../ui';
import {
  countTiles,
  decisionCount,
  groupByDay,
  includedTextTitles,
  isQuietDay,
  noteTextSummary,
  printableWindow,
  RECORD_SECTIONS,
  tileDetail,
} from './day';
import {timeIn} from './parts';

const NEEDS_MAX = 12;

export interface DayReportPageProps {
  report: DayReport;
  orgName: string | null;
  /** «2 dic 2026, 20:04». */
  generatedAtText: string;
  /** Time window of a task line («09:00 – 11:00»), in its own zone. */
  windowOf: (line: DayTaskLine) => string;
  /** Days a task line occupies (for the next-days grouping). */
  daysOf: (line: DayTaskLine) => readonly string[];
  /** Records with a write still on this device. */
  unsent: ReadonlySet<string>;
  id?: string;
}

const TaskItems: React.FC<{
  lines: readonly DayTaskLine[];
  windowOf: (line: DayTaskLine) => string;
}> = ({lines, windowOf}) => (
  <ul className="lx-dayp__tasks">
    {lines.map(l => (
      <li key={l.id}>
        <span
          className={`lx-dayp__time lx-num${l.startsAt ? '' : ' is-pending'}`}
        >
          {printableWindow(windowOf(l))}
        </span>
        <span>
          <strong>{l.title}</strong>
          <span className="lx-dayp__muted">
            {' · '}
            {[l.kindLabel, l.venue, l.company].filter(Boolean).join(' · ')}
          </span>
        </span>
      </li>
    ))}
  </ul>
);

const HypoItems: React.FC<{
  lines: readonly DayHypothesisLine[];
  applied: boolean;
  timeZone: string;
}> = ({lines, applied, timeZone}) => (
  <ul className="lx-dayp__list">
    {lines.map(h => (
      <li key={h.id} className="lx-dayp__hypo">
        <strong>Hipótesis</strong> · {h.label}
        <span className="lx-dayp__muted lx-num">
          {' · '}
          {applied && h.appliedAt
            ? `aplicada por ${h.appliedBy?.displayName ?? 'el equipo'}, ${timeIn(h.appliedAt, timeZone)}`
            : `explorada por ${h.by.displayName}, ${timeIn(h.at, timeZone)}`}
        </span>
      </li>
    ))}
  </ul>
);

const AcceptedItems: React.FC<{
  lines: readonly DayAcceptedLine[];
  timeZone: string;
}> = ({lines, timeZone}) => (
  <>
    <p className="lx-dayp__h4">{ACCEPTED_TITLE}</p>
    <ul className="lx-dayp__list">
      {lines.map(a => (
        <li key={a.id}>
          <strong>{a.label}</strong>
          {a.applies && <>: {a.tasks}</>}
          <span className="lx-dayp__muted lx-num">
            {' · '}
            {a.applies
              ? 'aceptado'
              : 'ya no aplica (una tarea cambió de hora)'}{' '}
            por {a.by.displayName}, {timeIn(a.at, timeZone)}
          </span>
          {a.reason && (
            <blockquote className="lx-dayp__quote">
              <strong>Motivo:</strong> {a.reason}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  </>
);

export const DayReportPage: React.FC<DayReportPageProps> = ({
  report,
  orgName,
  generatedAtText,
  windowOf,
  daysOf,
  unsent,
  id,
}) => {
  const tz = report.timezone;
  const tiles = countTiles(report);
  const quiet = isQuietDay(report);
  const sections = RECORD_SECTIONS.filter(
    s => report.records[s.key].length > 0,
  );
  const {pending, safety} = report;
  const notes =
    report.notes?.filter(
      s =>
        s.items.length > 0 ||
        (s.kind === 'decision' && report.accepted.length > 0),
    ) ?? [];
  const hypos = report.hypotheses;
  const nextDays = Array.from({length: NEXT_DAYS}, (_, i) =>
    addDays(report.date, i + 1),
  );
  const next = groupByDay(report.nextTasks, nextDays, daysOf);
  const textNote = noteTextSummary(report);

  return (
    <article
      className="lx-dayp"
      id={id}
      aria-label={`Cierre de jornada, ${longDate(report.date)}`}
    >
      <header className="lx-dayp__head">
        <div>
          <p className="lx-dayp__eyebrow">Cierre de jornada</p>
          <h1 className="lx-dayp__title lx-num">{longDate(report.date)}</h1>
          <p className="lx-dayp__sub">
            {[orgName, zoneNote(tz)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="lx-dayp__brand">
          <EyeMark size={34} />
          <span>
            Ox Eye
            <br />
            <small>Gestor logístico</small>
          </span>
        </div>
      </header>

      {/* On the page itself (also on Ctrl+P, which skips the preview
          banner): whoever reads the paper knows it carries note text. */}
      {includedTextTitles(report).length > 0 && (
        <p className="lx-dayp__textnote" id={id ? `${id}-textnote` : undefined}>
          <strong>{textNote}</strong> Contiene texto escrito por el equipo:
          léelo antes de compartirlo.
        </p>
      )}

      <section className="lx-dayp__block">
        <h2 className="lx-dayp__h2">El día en cifras</h2>
        <table className="lx-dayp__counts lx-num">
          <thead>
            <tr>
              <th scope="col">Registro</th>
              <th scope="col">Total</th>
              <th scope="col">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {tiles.map(t => (
              <tr key={t.type} className={t.total + t.deleted ? '' : 'is-zero'}>
                <th scope="row">{t.label}</th>
                <td>{t.total}</td>
                <td>{tileDetail(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="lx-dayp__fact lx-num">
          <strong>Información pendiente de verificar:</strong>{' '}
          {pending.pendingPercent === null
            ? 'aún no hay información registrada.'
            : `${pending.pendingPercent} % (${pending.total - pending.validated} de ${plural(pending.total, 'registro', 'registros')} sin validar).`}
        </p>
        <p className="lx-dayp__fact lx-num">
          <strong>Quién registró:</strong>{' '}
          {report.contributors.length
            ? report.contributors
                .map(
                  c =>
                    `${c.user.displayName} (${plural(c.changes, 'cambio', 'cambios')})`,
                )
                .join(', ')
            : 'nadie registró cambios este día.'}
        </p>
        {!report.activityAvailable && (
          <p className="lx-dayp__caveat">
            Sin el historial del servidor: las cifras salen de las fechas de los
            registros guardados y no incluyen lo borrado.
          </p>
        )}
      </section>

      <section className="lx-dayp__block">
        <h2 className="lx-dayp__h2">Lo registrado y cambiado</h2>
        {quiet ? (
          <p className="lx-dayp__empty">No hubo cambios este día.</p>
        ) : sections.length === 0 ? (
          <p className="lx-dayp__empty">Ningún registro nuevo ni modificado.</p>
        ) : (
          sections.map(s => (
            <div key={s.key} className="lx-dayp__group">
              <h3 className="lx-dayp__h3">
                {s.title}{' '}
                <span className="lx-num">({report.records[s.key].length})</span>
              </h3>
              <ul className="lx-dayp__list">
                {report.records[s.key].map(l => (
                  <li key={l.id}>
                    <span
                      className={`lx-dayp__cert${l.verification === 'validated' ? ' is-validated' : ''}`}
                    >
                      {VERIFICATION_LABEL[l.verification]}
                    </span>{' '}
                    <strong>{l.label}</strong>
                    {l.detail && (
                      <span className="lx-dayp__muted"> · {l.detail}</span>
                    )}
                    <span className="lx-dayp__muted lx-num">
                      {' · '}
                      {l.change === 'created' ? 'nuevo' : 'con cambios'},{' '}
                      {l.by.displayName}, {timeIn(l.at, tz)}
                    </span>
                    {l.isDemo && <span className="lx-dayp__tag">Demo</span>}
                    {unsent.has(l.id) && (
                      <span className="lx-dayp__tag">Pendiente de enviar</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="lx-dayp__block">
        <h2 className="lx-dayp__h2">Qué seguimos necesitando</h2>
        {pending.incomplete.length === 0 ? (
          <p className="lx-dayp__empty">
            {pending.total === 0
              ? 'Aún no hay nada registrado.'
              : 'Todo lo registrado está completo y validado.'}
          </p>
        ) : (
          <>
            <ul className="lx-dayp__list">
              {pending.incomplete.slice(0, NEEDS_MAX).map(r => (
                <li key={`${r.type}:${r.id}`}>
                  <strong>{r.label}</strong>
                  <span className="lx-dayp__muted">
                    {' · falta '}
                    {r.missing.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            {pending.incomplete.length > NEEDS_MAX && (
              <p className="lx-dayp__muted lx-num">
                Y {pending.incomplete.length - NEEDS_MAX} registros más con
                datos pendientes.
              </p>
            )}
          </>
        )}
      </section>

      {report.notes ? (
        notes.length > 0 && (
          <section className="lx-dayp__block">
            <h2 className="lx-dayp__h2">Notas del equipo</h2>
            {notes.map(s => (
              <div key={s.kind} className="lx-dayp__group">
                <h3 className="lx-dayp__h3">
                  {s.title}{' '}
                  <span className="lx-num">
                    (
                    {s.kind === 'decision'
                      ? decisionCount(report)
                      : s.items.length}
                    )
                  </span>
                </h3>
                <ul className="lx-dayp__list">
                  {s.items.map(n => (
                    <li key={n.id}>
                      <strong>{n.label}</strong>
                      {n.status && (
                        <span className="lx-dayp__muted"> · {n.status}</span>
                      )}
                      <span className="lx-dayp__muted lx-num">
                        {' · '}
                        {n.earlier
                          ? 'de días anteriores'
                          : `${n.by.displayName}, ${timeIn(n.at, tz)}`}
                        {n.answer &&
                          ` · respondió ${n.answer.by.displayName}, ${timeIn(n.answer.at, tz)}`}
                        {n.closedBy &&
                          n.closedAt &&
                          ` · ${s.kind === 'incident' ? 'resuelta' : 'cerrada'} por ${n.closedBy.displayName}, ${timeIn(n.closedAt, tz)}`}
                      </span>
                      {n.text && (
                        <blockquote className="lx-dayp__quote">
                          {n.text}
                        </blockquote>
                      )}
                      {n.answer?.text && (
                        <blockquote className="lx-dayp__quote">
                          <strong>Respuesta:</strong> {n.answer.text}
                        </blockquote>
                      )}
                    </li>
                  ))}
                </ul>
                {s.kind === 'decision' && report.accepted.length > 0 && (
                  <AcceptedItems lines={report.accepted} timeZone={tz} />
                )}
              </div>
            ))}
            {!!report.otherNotes && (
              <p className="lx-dayp__muted lx-num">
                Además, {plural(report.otherNotes, 'nota', 'notas')} del día sin
                listar.
              </p>
            )}
          </section>
        )
      ) : (
        <>
          {report.accepted.length > 0 && (
            <section className="lx-dayp__block">
              <h2 className="lx-dayp__h2">Decisiones del día</h2>
              <AcceptedItems lines={report.accepted} timeZone={tz} />
            </section>
          )}
          <section className="lx-dayp__block">
            <h2 className="lx-dayp__h2">Notas e hipótesis</h2>
            <p className="lx-dayp__empty">
              Visibles para el equipo con su propio usuario.
            </p>
          </section>
        </>
      )}

      {hypos && hypos.open.length + hypos.applied.length > 0 && (
        <section className="lx-dayp__block">
          <h2 className="lx-dayp__h2">Hipótesis del día</h2>
          {hypos.applied.length > 0 && (
            <div className="lx-dayp__group">
              <h3 className="lx-dayp__h3">{HYPOTHESIS_APPLIED_TITLE}</h3>
              <HypoItems lines={hypos.applied} applied timeZone={tz} />
            </div>
          )}
          {hypos.open.length > 0 && (
            <div className="lx-dayp__group">
              <h3 className="lx-dayp__h3">{HYPOTHESIS_OPEN_TITLE}</h3>
              <HypoItems lines={hypos.open} applied={false} timeZone={tz} />
            </div>
          )}
        </section>
      )}

      {(safety.subsoil.length > 0 || safety.routes.length > 0) && (
        <section className="lx-dayp__block lx-dayp__safety">
          <h2 className="lx-dayp__h2">Seguridad: subsuelo y rutas</h2>
          {safety.subsoil.length > 0 && (
            <div className="lx-dayp__group">
              <h3 className="lx-dayp__h3">Subsuelo</h3>
              <ul className="lx-dayp__list">
                {safety.subsoil.map(s => (
                  <li key={s.taskId}>
                    <strong>{s.title}</strong>
                    <span className="lx-num">
                      {s.date ? ` (${shortDate(s.date)})` : ''}
                    </span>
                    {': '}
                    {subsoilLineLabel(s)}
                  </li>
                ))}
              </ul>
              <p className="lx-dayp__fine">{safety.subsoilNote}</p>
              <p className="lx-dayp__fine">{safety.thresholdNote}</p>
            </div>
          )}
          {safety.routes.length > 0 && (
            <div className="lx-dayp__group">
              <h3 className="lx-dayp__h3">Rutas A/B/C y Carpa Amarilla</h3>
              <ul className="lx-dayp__list">
                {safety.routes.map(r => (
                  <li key={r.taskIds.join(',')}>{r.title}</li>
                ))}
              </ul>
              <aside className="lx-dayp__routes">
                <Icon name="transport" size={18} />
                <p>{safety.routesNote}</p>
              </aside>
            </div>
          )}
        </section>
      )}

      <section className="lx-dayp__block">
        <h2 className="lx-dayp__h2">Quedó sin terminar</h2>
        {report.unfinished.length === 0 ? (
          <p className="lx-dayp__empty">Nada pendiente de este día.</p>
        ) : (
          <TaskItems lines={report.unfinished} windowOf={windowOf} />
        )}
      </section>

      <section className="lx-dayp__block">
        <h2 className="lx-dayp__h2">Para los próximos días</h2>
        {next.length === 0 ? (
          <p className="lx-dayp__empty">
            Sin tareas previstas para los {NEXT_DAYS} días siguientes.
          </p>
        ) : (
          next.map(g => (
            <div key={g.day} className="lx-dayp__group">
              <h3 className="lx-dayp__h3 lx-num">{shortDate(g.day)}</h3>
              <TaskItems lines={g.items} windowOf={windowOf} />
            </div>
          ))
        )}
      </section>

      <footer className="lx-dayp__foot">
        <p className="lx-num">
          Generado por {report.generatedBy.displayName} desde Ox Eye ·{' '}
          {generatedAtText}.
        </p>
        {textNote && <p>{textNote}</p>}
        <p>Ox Eye ayuda a decidir; no certifica.</p>
      </footer>
    </article>
  );
};
