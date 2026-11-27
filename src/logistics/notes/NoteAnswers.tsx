/**
 * The answer to an open question, inside its sheet (Revisión 1 · E3).
 *
 * - The question and its current answer read together, each with who wrote
 *   it and when. Any member can answer.
 * - There is one current answer. Writing another while it stands asks first,
 *   showing the answer and its author; the earlier ones stay in «Respuestas
 *   anteriores».
 * - The person who asked closes it («Dar por respondida»); then it is
 *   read-only and everyone sees who closed it and when. While it has no
 *   answer any member may close or reopen it (the server's rule).
 * - Guests see that there is an answer and who gave it, never its text
 *   («Visible para el equipo»).
 * - Answers need the server: without coverage the text stays in the box.
 *   Like notes, answers are never quoted in labels, toasts or history.
 */
import React, {useEffect, useState} from 'react';
import type {Note, NoteAnswer} from '../../../shared/logistics/contracts.ts';
import {noteLabel} from '../../../shared/logistics/history.ts';
import {
  NOTE_PRIVACY_HINT,
  NOTE_TEXT_MAX,
} from '../../../shared/logistics/rules.ts';
import {errorMessage, isApiError} from '../api/client';
import {relativeTime} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  HelpTip,
  Icon,
  LoadError,
  SkeletonRows,
  Textarea,
  Withheld,
  describedBy,
} from '../ui';

const HELP =
  'Cualquier persona del equipo puede responder. Hay una sola respuesta vigente: si das otra, sustituye a la anterior, que queda en «Respuestas anteriores». Quien hizo la pregunta la da por respondida cuando le sirve, y desde entonces queda cerrada.';

/** Who and when, «Elvis · hace 5 min». */
function byLine(
  who: {displayName: string},
  at: string,
  timeZone: string | undefined,
): string {
  return `${who.displayName} · ${relativeTime(at, timeZone)}`;
}

const AnswerText: React.FC<{answer: NoteAnswer; className?: string}> = ({
  answer,
  className = 'lx-answer__text',
}) =>
  answer.restricted || answer.text === null ? (
    <p className={className}>
      <Withheld />
    </p>
  ) : (
    <p className={className}>{answer.text}</p>
  );

export const NoteAnswers: React.FC<{
  note: Note;
  canWrite: boolean;
  /** False once the note no longer exists. */
  canEdit: boolean;
}> = ({note, canWrite, canEdit}) => {
  const me = useLogisticsStore(s => s.session?.user.id ?? null);
  const timeZone = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.timezone,
  );
  const answerNote = useLogisticsStore(s => s.answerNote);
  const updateNote = useLogisticsStore(s => s.updateNote);
  const toast = useLogisticsStore(s => s.toast);
  const toastSaved = useLogisticsStore(s => s.toastSaved);
  const pull = useLogisticsStore(s => s.pull);

  const answer = note.answer;
  const asker = note.createdBy;
  const isAsker = !!me && asker.id === me;
  const closed = note.resolved;
  const members = canWrite && canEdit;
  // Server rule: the asker, or anyone while there is no current answer.
  const canToggle = members && (isAsker || !answer);
  const canAnswer = members && !closed;

  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);

  // A closed question (maybe closed meanwhile by its asker) takes no answer;
  // text already typed keeps its box even if an answer arrives meanwhile.
  const composerOpen = canAnswer && (writing || !answer || draft.trim() !== '');
  const inputId = 'lx-note-answer-input';

  const send = async (replaces: string | null) => {
    const text = draft.trim();
    if (!text) {
      setFieldError('Escribe la respuesta, aunque sea en dos palabras.');
      document.getElementById(inputId)?.focus();
      return;
    }
    if (text.length > NOTE_TEXT_MAX) {
      setFieldError(`Como mucho ${NOTE_TEXT_MAX} caracteres.`);
      return;
    }
    setSending(true);
    setFieldError(null);
    setNotice(null);
    try {
      await answerNote(note, text, replaces);
      setDraft('');
      setWriting(false);
      setConfirming(false);
      toast(
        replaces
          ? `Respuesta sustituida: ${noteLabel(note)}`
          : `Respuesta guardada: ${noteLabel(note)}`,
        'success',
      );
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        // Someone answered while this was being written: show theirs first.
        setNotice(err.message);
        setConfirming(true);
      } else if (isApiError(err) && err.fields?.text) {
        setFieldError(err.fields.text);
        setConfirming(false);
      } else {
        setNotice(errorMessage(err));
        setConfirming(false);
      }
    } finally {
      setSending(false);
    }
  };

  const submit = () => {
    if (!draft.trim()) {
      void send(null);
      return;
    }
    // A current answer is replaced only after looking at it.
    if (answer) setConfirming(true);
    else void send(null);
  };

  const toggle = async () => {
    setToggling(true);
    setNotice(null);
    try {
      const updated = await updateNote(note.id, {
        version: note.version,
        resolved: !closed,
      });
      toastSaved(
        updated,
        updated.resolved
          ? `${noteLabel(updated)}: respondida`
          : `${noteLabel(updated)}: reabierta`,
      );
    } catch (err) {
      setNotice(
        isApiError(err) && err.code === 'VERSION_CONFLICT'
          ? 'Otra persona ha cambiado esta pregunta: ya ves la versión actual.'
          : errorMessage(err),
      );
      // ONLY_THE_ASKER means an answer arrived meanwhile: show it.
      if (isApiError(err) && err.code === 'FORBIDDEN') {
        void pull().catch(() => undefined);
      }
    } finally {
      setToggling(false);
    }
  };

  return (
    <section
      className={`lx-answer${closed ? ' is-closed' : ''}`}
      id="lx-note-answer"
      aria-labelledby="lx-note-answer-title"
    >
      <div className="lx-subsection__head">
        <h3 className="lx-subsection__title" id="lx-note-answer-title">
          Respuesta
          <HelpTip label="respuestas">{HELP}</HelpTip>
        </h3>
      </div>

      <p className="lx-answer__asked lx-num" id="lx-note-asked">
        Preguntó {byLine(asker, note.createdAt, timeZone)}
      </p>

      {answer ? (
        <div className="lx-answer__current" id="lx-note-answer-current">
          <AnswerText answer={answer} />
          <p className="lx-answer__by lx-num" id="lx-note-answer-by">
            <Icon name="chat" size={14} />
            Respondió {byLine(answer.answeredBy, answer.answeredAt, timeZone)}
          </p>
        </div>
      ) : (
        <p className="lx-answer__none" id="lx-note-answer-none">
          Aún sin respuesta.
          {!canWrite && ' Cuando alguien del equipo responda, aparecerá aquí.'}
        </p>
      )}

      {closed ? (
        <p className="lx-answer__closed" id="lx-note-answer-closed">
          <Icon name="lock" size={15} />
          <span>
            {note.resolvedBy && note.resolvedAt
              ? `Dada por respondida por ${byLine(note.resolvedBy, note.resolvedAt, timeZone)}.`
              : 'Dada por respondida.'}{' '}
            {answer && !isAsker
              ? `Solo ${asker.displayName} puede reabrirla.`
              : 'Ya no recibe respuestas.'}
          </span>
        </p>
      ) : (
        answer &&
        (isAsker ? (
          <p className="lx-answer__ask" id="lx-note-answer-ask">
            ¿Te sirve esta respuesta? Dala por respondida para cerrar la
            pregunta.
          </p>
        ) : (
          <p className="lx-answer__ask lx-muted" id="lx-note-answer-ask">
            {asker.displayName} la dará por respondida cuando le sirva.
          </p>
        ))
      )}

      {closed && members && draft.trim() && (
        <div
          className="lx-answer__notice"
          role="alert"
          id="lx-note-answer-lost"
        >
          <Icon name="alert" size={16} />
          <div>
            <p>
              Se ha dado por respondida mientras escribías: tu texto no se ha
              enviado. Cópialo si lo necesitas.
            </p>
            <p className="lx-answer__draft">{draft}</p>
          </div>
        </div>
      )}

      {notice && (
        <p
          className="lx-answer__notice"
          role="alert"
          id="lx-note-answer-notice"
        >
          <Icon name="alert" size={16} />
          <span>{notice}</span>
        </p>
      )}

      {(canToggle || (canAnswer && answer && !composerOpen)) && (
        <div className="lx-answer__actions">
          {canToggle && (
            <Button
              variant={answer && !closed ? 'primary' : 'secondary'}
              icon={closed ? 'refresh' : 'check'}
              id="lx-note-toggle-resolved"
              busy={toggling}
              disabled={sending}
              onClick={() => void toggle()}
            >
              {closed
                ? 'Reabrir pregunta'
                : answer
                  ? 'Dar por respondida'
                  : 'Marcar como respondida'}
            </Button>
          )}
          {canAnswer && answer && !composerOpen && (
            <Button
              variant="ghost"
              icon="chat"
              id="lx-note-answer-again"
              onClick={() => {
                setWriting(true);
                setNotice(null);
                setTimeout(() => document.getElementById(inputId)?.focus());
              }}
            >
              Dar otra respuesta
            </Button>
          )}
        </div>
      )}

      {composerOpen && (
        <div className="lx-answer__compose" id="lx-note-answer-compose">
          <Field
            id={inputId}
            label={answer ? 'Otra respuesta' : 'Tu respuesta'}
            error={fieldError ?? undefined}
          >
            <Textarea
              id={inputId}
              name={inputId}
              rows={3}
              value={draft}
              invalid={!!fieldError}
              disabled={sending}
              aria-describedby={[
                describedBy(inputId, {error: fieldError ?? undefined}),
                'lx-note-answer-privacy',
              ]
                .filter(Boolean)
                .join(' ')}
              placeholder="La llave la tiene conserjería; se recoge a partir de las 7:30."
              onChange={e => {
                setDraft(e.target.value);
                setFieldError(null);
              }}
            />
          </Field>
          <p className="lx-form__note lx-privacy" id="lx-note-answer-privacy">
            <Icon name="lock" size={15} />
            {NOTE_PRIVACY_HINT}
          </p>

          {confirming && answer ? (
            <div
              className="lx-answer__confirm"
              role="group"
              aria-labelledby="lx-note-answer-confirm-q"
              id="lx-note-answer-confirm"
            >
              <p id="lx-note-answer-confirm-q">
                <strong>¿Sustituir la respuesta actual?</strong> La dio{' '}
                {byLine(answer.answeredBy, answer.answeredAt, timeZone)}.
                Quedará en «Respuestas anteriores».
              </p>
              <blockquote className="lx-answer__quote">
                <AnswerText answer={answer} className="lx-answer__quote-text" />
              </blockquote>
              <div className="lx-answer__actions">
                <Button
                  variant="ghost"
                  id="lx-note-answer-keep"
                  disabled={sending}
                  onClick={() => setConfirming(false)}
                >
                  Seguir escribiendo
                </Button>
                <Button
                  variant="primary"
                  id="lx-note-answer-replace"
                  data-autofocus
                  busy={sending}
                  onClick={() => void send(answer.id)}
                >
                  Sustituir respuesta
                </Button>
              </div>
            </div>
          ) : (
            <div className="lx-answer__actions">
              {answer && (
                <Button
                  variant="ghost"
                  id="lx-note-answer-cancel"
                  disabled={sending}
                  onClick={() => {
                    setWriting(false);
                    setDraft('');
                    setFieldError(null);
                    setNotice(null);
                  }}
                >
                  Cancelar
                </Button>
              )}
              <Button
                variant="primary"
                icon="send"
                id="lx-note-answer-send"
                busy={sending}
                onClick={submit}
              >
                {sending ? 'Enviando…' : 'Responder'}
              </Button>
            </div>
          )}
        </div>
      )}

      {answer?.replacesId && (
        <EarlierAnswers note={note} current={answer} timeZone={timeZone} />
      )}
    </section>
  );
};

/** «Respuestas anteriores»: loaded when opened, reloaded when it changes. */
const EarlierAnswers: React.FC<{
  note: Note;
  current: NoteAnswer;
  timeZone: string | undefined;
}> = ({note, current, timeZone}) => {
  const noteAnswers = useLogisticsStore(s => s.noteAnswers);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'error';
    items: NoteAnswer[];
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${current.id}|${attempt}`;

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setState({key, status: 'loading', items: [], error: null});
    noteAnswers(note.id, ctrl.signal).then(
      items => setState({key, status: 'ready', items, error: null}),
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({key, status: 'error', items: [], error: errorMessage(err)});
      },
    );
    return () => ctrl.abort();
  }, [open, key, note.id, noteAnswers]);

  const earlier = (state?.items ?? []).filter(a => a.id !== current.id);
  const panelId = 'lx-note-answers-earlier';

  return (
    <div className="lx-answer__history">
      <Button
        size="sm"
        variant="ghost"
        icon={open ? 'minus' : 'history'}
        aria-expanded={open}
        aria-controls={panelId}
        id="lx-note-answers-toggle"
        onClick={() => setOpen(o => !o)}
      >
        {open ? 'Ocultar respuestas anteriores' : 'Respuestas anteriores'}
      </Button>
      {open && (
        <div id={panelId} className="lx-answer__earlier">
          {!state || state.status === 'loading' ? (
            <SkeletonRows rows={2} label="Cargando respuestas anteriores" />
          ) : state.status === 'error' ? (
            <LoadError
              message={state.error ?? ''}
              onRetry={() => setAttempt(a => a + 1)}
            />
          ) : earlier.length === 0 ? (
            <p className="lx-muted">No hay respuestas anteriores.</p>
          ) : (
            <ol className="lx-answer__list">
              {earlier.map(a => (
                <li key={a.id} className="lx-answer__old" data-answer-id={a.id}>
                  <AnswerText answer={a} className="lx-answer__old-text" />
                  <p className="lx-answer__by lx-num">
                    {byLine(a.answeredBy, a.answeredAt, timeZone)} · sustituida
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};
