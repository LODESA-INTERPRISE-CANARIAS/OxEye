/**
 * «Notas e incidencias» on Hoy: open incidents and open questions first
 * (whatever their day: they are still waiting), then the notes written
 * today. Tapping one opens it; «Incidencia» and «Nota» capture a new one in
 * two taps.
 *
 * Members read the first line of each note here; guests see «Visible para
 * el equipo». The button that opens a note never carries its text.
 *
 * E3: a question with an answer reads «Con respuesta» and stays pending
 * until its asker closes it; the asker gets a one-line reminder here.
 */
import React, {useMemo, useState} from 'react';
import {useActions} from '../common/actions';
import {NoteItem} from '../common/RecordNotes';
import {awaitsAsker, notesForToday} from '../lib/inventory';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Card, EmptyState, Icon, LoadError, SkeletonRows} from '../ui';

/** Notes shown before «Ver todas». */
const SHOWN = 5;

export const NotesCard: React.FC = () => {
  const notes = useLogisticsStore(s => s.notes);
  const state = useLogisticsStore(s => s.notesState);
  const error = useLogisticsStore(s => s.notesError);
  const refresh = useLogisticsStore(s => s.refresh);
  const {canWrite, today, timeZone, addNote} = useActions();
  const [expanded, setExpanded] = useState(false);
  const {open, today: todays} = useMemo(
    () => notesForToday(notes, today, timeZone),
    [notes, today, timeZone],
  );
  const total = open.length + todays.length;
  // E3: questions of this person that have an answer waiting for them.
  const me = useLogisticsStore(s => s.session?.user.id ?? null);
  const mine = open.filter(n => awaitsAsker(n) && n.createdBy.id === me);
  // Open ones always show; today's fill up to SHOWN unless expanded.
  const collapsedRoom = Math.max(0, SHOWN - open.length);
  const shownToday = todays.slice(0, expanded ? todays.length : collapsedRoom);
  const hidden = todays.length - shownToday.length;
  const canToggle = todays.length > collapsedRoom;

  let body: React.ReactNode;
  if ((state === 'loading' || state === 'idle') && notes.length === 0) {
    body = <SkeletonRows rows={3} label="Cargando notas" />;
  } else if (state === 'error' && notes.length === 0) {
    body = <LoadError message={error ?? ''} onRetry={() => void refresh()} />;
  } else if (total === 0) {
    body = (
      <EmptyState
        compact
        icon="note"
        title="Nada pendiente ni apuntado hoy"
        id="lx-hoy-notes-empty"
      >
        {canWrite
          ? 'Apunta una incidencia en cuanto pase algo (un camión que no llega, una valla rota) o una nota para el equipo.'
          : 'Cuando el equipo apunte incidencias o notas, aparecerán aquí.'}
      </EmptyState>
    );
  } else {
    body = (
      <div className="lx-hoynotes">
        {open.length > 0 && (
          <div className="lx-hoynotes__group">
            <p className="lx-subtitle" id="lx-hoy-notes-open">
              Pendientes
              <span className="lx-count lx-count--danger lx-num">
                {open.length}
              </span>
            </p>
            {canWrite && mine.length > 0 && (
              <p className="lx-hoynotes__mine" id="lx-hoy-notes-answered">
                <Icon name="chat" size={15} />
                {mine.length === 1
                  ? 'Una pregunta tuya tiene respuesta: ábrela para darla por respondida.'
                  : `${mine.length} preguntas tuyas tienen respuesta: ábrelas para darlas por respondidas.`}
              </p>
            )}
            <ul className="lx-notelist" aria-labelledby="lx-hoy-notes-open">
              {open.map(n => (
                <NoteItem key={n.id} note={n} showRef showEvent />
              ))}
            </ul>
          </div>
        )}
        {todays.length > 0 && (
          <div className="lx-hoynotes__group">
            <p className="lx-subtitle" id="lx-hoy-notes-today">
              De hoy
              <span className="lx-count lx-num">{todays.length}</span>
            </p>
            {shownToday.length > 0 && (
              <ul className="lx-notelist" aria-labelledby="lx-hoy-notes-today">
                {shownToday.map(n => (
                  <NoteItem key={n.id} note={n} showRef showEvent />
                ))}
              </ul>
            )}
            {canToggle && (
              <Button
                size="sm"
                variant="ghost"
                icon={expanded ? 'minus' : 'plus'}
                aria-expanded={expanded}
                id="lx-hoy-notes-more"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded
                  ? 'Ver menos'
                  : hidden === 1
                    ? 'Ver 1 más'
                    : `Ver ${hidden} más`}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      title="Notas e incidencias"
      id="lx-hoy-notes"
      className="lx-hoynotes-card"
      actions={
        canWrite && (
          <div className="lx-hoynotes__actions">
            <Button
              size="sm"
              icon="alert"
              id="lx-hoy-add-incident"
              onClick={() => addNote({kind: 'incident'})}
            >
              Incidencia
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="note"
              id="lx-hoy-add-note"
              onClick={() => addNote({kind: 'note'})}
            >
              Nota
            </Button>
          </div>
        )
      }
    >
      {body}
    </Card>
  );
};
