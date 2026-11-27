/**
 * «Notas (N)» inside a record's sheet: the notes, incidents, decisions and
 * questions about that record, newest first, with «Añadir nota» already
 * linked to it.
 *
 * Inside the record's own sheet the note is being read, so members see its
 * text here. Guests never do («Visible para el equipo»). The button that
 * opens a note is named by kind, status and author only: its accessible name
 * never carries the text (the text sits next to it, readable in order).
 */
import React, {useMemo, useState} from 'react';
import type {Note} from '../../../shared/logistics/contracts.ts';
import {NOTE_KIND_LABEL} from '../../../shared/logistics/rules.ts';
import {
  awaitsAsker,
  excerpt,
  isOpenNote,
  NOTE_KIND_ICON,
  notesAbout,
  resolvedLabel,
  type NoteTarget,
} from '../lib/inventory';
import {relativeTime} from '../lib/format';
import {UnsentMark, unsentSuffix, useUnsent} from '../offline/PendingMark';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Withheld} from '../ui';
import {useActions, type NotePrefill} from './actions';

const SHOWN = 4;

export const RecordNotes: React.FC<{
  target: NoteTarget;
  /** What a new note starts linked to. */
  prefill: NotePrefill;
  idPrefix: string;
  /** False for a record that no longer exists. */
  canAdd?: boolean;
}> = ({target, prefill, idPrefix, canAdd = true}) => {
  const all = useLogisticsStore(s => s.notes);
  const state = useLogisticsStore(s => s.notesState);
  const {canWrite, addNote} = useActions();
  const [expanded, setExpanded] = useState(false);
  const {type, id} = target;
  const notes = useMemo(
    () => notesAbout(all, {type, id} as NoteTarget),
    [all, type, id],
  );
  const shown = expanded ? notes : notes.slice(0, SHOWN);
  const open = notes.filter(isOpenNote).length;

  return (
    // `-notelist`, not `-notes`: that id belongs to the record's own
    // «Observaciones» field (e.g. #lx-task-notes).
    <section
      className="lx-subsection lx-recnotes"
      id={`${idPrefix}-notelist`}
      aria-labelledby={`${idPrefix}-notelist-title`}
    >
      <div className="lx-subsection__head">
        <h3 className="lx-subsection__title" id={`${idPrefix}-notelist-title`}>
          Notas
          <span className="lx-count lx-num">{notes.length}</span>
          {open > 0 && (
            <span className="lx-recnotes__open">
              {open === 1 ? '1 abierta' : `${open} abiertas`}
            </span>
          )}
        </h3>
        {canWrite && canAdd && (
          <Button
            size="sm"
            icon="plus"
            id={`${idPrefix}-add-note`}
            onClick={() => addNote(prefill)}
          >
            Añadir nota
          </Button>
        )}
      </div>
      {notes.length ? (
        <>
          <ul className="lx-notelist">
            {shown.map(n => (
              <NoteItem key={n.id} note={n} showRef={target.type === 'event'} />
            ))}
          </ul>
          {notes.length > SHOWN && (
            <Button
              size="sm"
              variant="ghost"
              icon={expanded ? 'minus' : 'plus'}
              aria-expanded={expanded}
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? 'Ver menos' : `Ver las ${notes.length} notas`}
            </Button>
          )}
        </>
      ) : (
        <p className="lx-muted">
          {state === 'error'
            ? 'No se han podido cargar las notas.'
            : state === 'loading' || state === 'idle'
              ? 'Cargando notas…'
              : canWrite
                ? 'Sin notas. Apunta aquí incidencias, decisiones o preguntas sobre este registro.'
                : 'Sin notas.'}
        </p>
      )}
    </section>
  );
};

/**
 * One note in a list that is not the note itself. `text` decides whether
 * the body may appear (the record's own sheet, Hoy); the open button never
 * carries it.
 */
export const NoteItem: React.FC<{
  note: Note;
  /** Show what the note points at (lists of an event, Hoy). */
  showRef?: boolean;
  /** Show the event too (Hoy). */
  showEvent?: boolean;
}> = ({note, showRef = false, showEvent = false}) => {
  const {openNote} = useActions();
  const timeZone = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.timezone,
  );
  const status = resolvedLabel(note);
  const openOne = isOpenNote(note);
  // Guests never see a person's name next to a note's kind («Incidencia ·
  // <name>»): for them a note about a person shows only its event.
  const refLabel =
    note.ref?.type === 'contact' && note.restricted ? null : note.ref?.label;
  const about = [
    showEvent ? note.event?.name : null,
    showRef ? refLabel : null,
  ].filter(Boolean);
  const when = relativeTime(note.createdAt, timeZone);
  const kind = NOTE_KIND_LABEL[note.kind];
  const label = [
    kind,
    ...about,
    status,
    `${note.createdBy.displayName}, ${when}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const unsent = useUnsent(note.id);

  return (
    <li
      className={`lx-noteitem lx-noteitem--${note.kind}${
        openOne ? ' is-open' : ''
      }`}
      data-note-id={note.id}
    >
      <button
        type="button"
        className="lx-noteitem__open"
        aria-label={`Abrir: ${label}${unsentSuffix(unsent)}`}
        onClick={() => openNote(note)}
      >
        <span className="lx-noteitem__icon" aria-hidden="true">
          <Icon name={NOTE_KIND_ICON[note.kind]} size={18} />
        </span>
        <span className="lx-noteitem__head" aria-hidden="true">
          <strong>{kind}</strong>
          {about.length > 0 && (
            <span className="lx-noteitem__about">{about.join(' · ')}</span>
          )}
          {status && (
            <span
              className={`lx-notestatus${
                awaitsAsker(note)
                  ? ' lx-notestatus--answered'
                  : openOne
                    ? ' lx-notestatus--open'
                    : ''
              }`}
            >
              {status}
            </span>
          )}
          <UnsentMark id={note.id} />
        </span>
        <span className="lx-noteitem__meta lx-num" aria-hidden="true">
          {note.createdBy.displayName} · {when}
        </span>
      </button>
      <p className="lx-noteitem__text">
        {note.restricted || note.text === null ? (
          <Withheld />
        ) : (
          excerpt(note.text)
        )}
      </p>
    </li>
  );
};
