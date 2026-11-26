/**
 * Incidents, decisions, open questions and tool ideas of the day (members
 * only), and the hypotheses explored or applied. Notes appear by their
 * label and status; a section's text joins the report only when a member
 * ticks «Incluir el texto», and incidents ask first, showing what must not
 * be written in them. Guests get one «Visible para el equipo» block.
 */
import React, {useEffect, useRef, useState} from 'react';
import type {
  DayHypothesisLine,
  DayNoteKind,
  DayNoteLine,
  DayNoteSection,
  DayReport,
} from '../../../shared/logistics/day-report.ts';
import {
  HYPOTHESIS_APPLIED_TITLE,
  HYPOTHESIS_OPEN_TITLE,
} from '../../../shared/logistics/day-report.ts';
import {
  INCIDENT_SCOPE_NOTE,
  NOTE_PRIVACY_HINT,
} from '../../../shared/logistics/rules.ts';
import {NOTE_KIND_ICON} from '../lib/inventory';
import {Button, Card, Chip, HelpTip, Icon, Withheld} from '../ui';
import {listNi} from './day';
import {QuietLine, timeIn, useOpenLine} from './parts';

const OPEN_STATUS = new Set(['Abierta', 'Sin respuesta']);

const NoteStatus: React.FC<{status: string}> = ({status}) =>
  OPEN_STATUS.has(status) ? (
    <Chip certainty="planned" tone="danger" size="sm">
      {status}
    </Chip>
  ) : (
    <Chip tag tone="neutral" size="sm">
      <Icon name="check" size={13} />
      {status}
    </Chip>
  );

const NoteLineRow: React.FC<{
  line: DayNoteLine;
  kind: DayNoteKind;
  timeZone: string;
}> = ({line, kind, timeZone}) => {
  const open = useOpenLine();
  return (
    <li className="lx-daynote">
      <button
        type="button"
        className="lx-dayline"
        onClick={() => open('note', line.id)}
      >
        <Icon
          name={NOTE_KIND_ICON[kind]}
          size={18}
          className="lx-dayline__icon"
        />
        <span className="lx-dayline__main">
          <span className="lx-dayline__name">{line.label}</span>
          <span className="lx-dayline__meta lx-num">
            {line.earlier && (
              <span className="lx-daynote__earlier">De días anteriores · </span>
            )}
            {line.by.displayName} ·{' '}
            {line.earlier ? 'sigue pendiente' : timeIn(line.at, timeZone)}
          </span>
        </span>
        <span className="lx-dayline__chips">
          {line.status && <NoteStatus status={line.status} />}
        </span>
        <Icon name="chevronRight" size={18} className="lx-dayline__go" />
      </button>
      {line.text && (
        <blockquote className="lx-daynote__text">{line.text}</blockquote>
      )}
    </li>
  );
};

/** Asks before the text of the incidents joins the report. */
const IncidentConfirm: React.FC<{
  onConfirm: () => void;
  onCancel: () => void;
}> = ({onConfirm, onCancel}) => {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      className="lx-dayconfirm"
      role="group"
      aria-labelledby="lx-day-incident-confirm-title"
      id="lx-day-incident-confirm"
    >
      <p className="lx-dayconfirm__title" id="lx-day-incident-confirm-title">
        <Icon name="lock" size={16} /> Antes de incluir el texto de las
        incidencias
      </p>
      <p>{INCIDENT_SCOPE_NOTE}</p>
      <p>{NOTE_PRIVACY_HINT}</p>
      <p>
        El PDF y la copia impresa los puede leer cualquiera que los reciba:
        léelos antes de compartirlos.
      </p>
      <div className="lx-dayconfirm__actions">
        <Button
          ref={ref}
          variant="primary"
          size="sm"
          id="lx-day-incident-confirm-yes"
          onClick={onConfirm}
        >
          Incluir el texto
        </Button>
        <Button
          variant="ghost"
          size="sm"
          id="lx-day-incident-confirm-no"
          onClick={onCancel}
        >
          No incluir
        </Button>
      </div>
    </div>
  );
};

const NoteGroup: React.FC<{
  section: DayNoteSection;
  timeZone: string;
  onInclude: (kind: DayNoteKind, on: boolean) => void;
}> = ({section, timeZone, onInclude}) => {
  const {kind} = section;
  const [confirming, setConfirming] = useState(false);
  const titleId = `lx-day-notes-${kind}-title`;
  const toggleId = `lx-day-include-${kind}`;
  const hintId = `${toggleId}-hint`;
  return (
    <section
      className="lx-daygroup"
      aria-labelledby={titleId}
      id={`lx-day-notes-${kind}`}
    >
      <div className="lx-daygroup__head">
        <h3 className="lx-daygroup__title" id={titleId}>
          <Icon name={NOTE_KIND_ICON[kind]} size={18} />
          {section.title}
          <span className="lx-count lx-num">{section.items.length}</span>
        </h3>
        <label className="lx-daytoggle" htmlFor={toggleId}>
          <input
            type="checkbox"
            id={toggleId}
            checked={section.textIncluded}
            aria-describedby={
              kind === 'incident' && confirming
                ? `${hintId} lx-day-incident-confirm`
                : hintId
            }
            onChange={e => {
              const on = e.target.checked;
              if (on && kind === 'incident') {
                setConfirming(true);
                return;
              }
              setConfirming(false);
              onInclude(kind, on);
            }}
          />
          <span>Incluir el texto</span>
        </label>
      </div>
      {/* Read before ticking: what must never be in a note, and where the
          text goes once included. */}
      <p className="lx-daytoggle__hint" id={hintId}>
        <Icon name="lock" size={14} />
        <span>
          {NOTE_PRIVACY_HINT} Si lo incluyes, el texto entra en la vista para
          imprimir y en el PDF.
        </span>
      </p>
      {confirming && !section.textIncluded && (
        <IncidentConfirm
          onConfirm={() => {
            setConfirming(false);
            onInclude(kind, true);
            document.getElementById(toggleId)?.focus();
          }}
          onCancel={() => {
            setConfirming(false);
            document.getElementById(toggleId)?.focus();
          }}
        />
      )}
      <ul className="lx-daylines" aria-labelledby={titleId}>
        {section.items.map(n => (
          <NoteLineRow key={n.id} line={n} kind={kind} timeZone={timeZone} />
        ))}
      </ul>
    </section>
  );
};

export const DayNotes: React.FC<{
  report: DayReport;
  timeZone: string;
  onInclude: (kind: DayNoteKind, on: boolean) => void;
}> = ({report, timeZone, onInclude}) => {
  if (!report.notes) return null;
  const full = report.notes.filter(s => s.items.length > 0);
  const empty = report.notes.filter(s => s.items.length === 0);
  return (
    <Card
      title="Notas del equipo"
      id="lx-day-notes"
      className="lx-daynotes"
      actions={
        <HelpTip label="las notas en el cierre">
          Las notas aparecen por su tipo, de qué tratan y su estado, nunca por
          su texto. Si marcas «Incluir el texto» en una sección, su texto entra
          en la vista para imprimir y en el PDF; nunca en «Copiar resumen». Las
          incidencias y preguntas abiertas de días anteriores siguen aquí hasta
          que se resuelvan.
        </HelpTip>
      }
    >
      <div className="lx-dayrecords__groups">
        {full.map(s => (
          <NoteGroup
            key={s.kind}
            section={s}
            timeZone={timeZone}
            onInclude={onInclude}
          />
        ))}
        {empty.length > 0 && (
          <QuietLine id="lx-day-notes-none">
            Sin {listNi(empty.map(s => s.title.toLocaleLowerCase('es-ES')))}{' '}
            este día.
          </QuietLine>
        )}
        {!!report.otherNotes && (
          <p className="lx-muted lx-num" id="lx-day-notes-other">
            Además, {report.otherNotes}{' '}
            {report.otherNotes === 1
              ? 'nota del día, que no se lista aquí.'
              : 'notas del día, que no se listan aquí.'}
          </p>
        )}
      </div>
    </Card>
  );
};

const HypothesisRow: React.FC<{
  line: DayHypothesisLine;
  applied: boolean;
  timeZone: string;
}> = ({line, applied, timeZone}) => {
  const open = useOpenLine();
  return (
    <li>
      <button
        type="button"
        className={`lx-dayline lx-dayhypo${applied ? ' is-applied' : ''}`}
        onClick={() => open('hypothesis', line.id)}
      >
        <Icon name="flask" size={18} className="lx-dayline__icon" />
        <span className="lx-dayline__main">
          <span className="lx-dayline__name">
            <span className="lx-dayhypo__word">Hipótesis</span> · {line.label}
          </span>
          <span className="lx-dayline__meta lx-num">
            {applied && line.appliedAt
              ? `Aplicada por ${line.appliedBy?.displayName ?? 'el equipo'} a las ${timeIn(line.appliedAt, timeZone)}`
              : `Explorada por ${line.by.displayName} a las ${timeIn(line.at, timeZone)}`}
          </span>
        </span>
        <Icon name="chevronRight" size={18} className="lx-dayline__go" />
      </button>
    </li>
  );
};

export const DayHypotheses: React.FC<{
  report: DayReport;
  timeZone: string;
}> = ({report, timeZone}) => {
  if (!report.hypotheses) return null;
  const {open, applied} = report.hypotheses;
  const none = open.length === 0 && applied.length === 0;
  return (
    <Card
      title="Hipótesis del día"
      id="lx-day-hypotheses"
      className="lx-dayhypos"
      actions={
        <HelpTip label="hipótesis">
          Una hipótesis es un «¿y si…?» sobre el plan (un retraso, algo que se
          alarga). Las exploradas no cambian nada. Las aplicadas movieron el
          plan cuando alguien lo confirmó, pero siguen siendo hipótesis: una
          estimación, no lo que pasó.
        </HelpTip>
      }
    >
      {none ? (
        <QuietLine id="lx-day-hypotheses-none">
          No se exploró ni se aplicó ninguna hipótesis este día.
        </QuietLine>
      ) : (
        <div className="lx-dayrecords__groups">
          {[
            {key: 'applied', title: HYPOTHESIS_APPLIED_TITLE, list: applied},
            {key: 'open', title: HYPOTHESIS_OPEN_TITLE, list: open},
          ]
            .filter(g => g.list.length > 0)
            .map(g => (
              <section
                key={g.key}
                className="lx-daygroup"
                aria-labelledby={`lx-day-hypo-${g.key}`}
                id={`lx-day-hypotheses-${g.key}`}
              >
                <h3 className="lx-daygroup__title" id={`lx-day-hypo-${g.key}`}>
                  {g.title}
                  <span className="lx-count lx-num">{g.list.length}</span>
                </h3>
                <ul className="lx-daylines">
                  {g.list.map(h => (
                    <HypothesisRow
                      key={h.id}
                      line={h}
                      applied={g.key === 'applied'}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Card>
  );
};

/** Guests: notes, incidents and hypotheses stay with the team. */
export const GuestNotesBlock: React.FC = () => (
  <Card title="Notas e hipótesis" id="lx-day-guest" className="lx-dayguest">
    <p className="lx-dayguest__text">
      <Withheld />
      <span>
        Las incidencias, decisiones, preguntas, ideas e hipótesis las ve el
        equipo con su propio usuario.
      </span>
    </p>
  </Card>
);
