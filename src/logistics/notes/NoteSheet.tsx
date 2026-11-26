/**
 * A note, incident, decision, open question or idea for the tool: read view
 * first, «Editar» turns the same sheet into the form (members only).
 *
 * Safety (invariant 3, Punto Violeta):
 * - «Incidencia» shows INCIDENT_SCOPE_NOTE in the form and in the sheet, in
 *   plain sight: logistics incidents only, never Punto Violeta cases or data
 *   about attended people.
 * - Every form shows NOTE_PRIVACY_HINT next to the text.
 * - The sheet's title (its accessible name) and every toast use the kind and
 *   what the note points at (`noteLabel`), never the text. Guests see
 *   «Visible para el equipo» instead of the text.
 * - No export or share action: notes are not exported without a safety
 *   review.
 */
import React, {useCallback, useMemo, useState} from 'react';
import type {
  DataSource,
  Note,
  NoteInput,
  NoteKind,
  NoteRefType,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {noteLabel} from '../../../shared/logistics/history.ts';
import {
  INCIDENT_SCOPE_NOTE,
  NOTE_KIND_LABEL,
  NOTE_KINDS,
  NOTE_PRIVACY_HINT,
  NOTE_REF_TYPES,
  NOTE_TEXT_MAX,
  RESOLVABLE_NOTE_KINDS,
} from '../../../shared/logistics/rules.ts';
import {SEARCH_TYPE_LABEL} from '../../../shared/logistics/search.ts';
import {errorMessage, isApiError} from '../api/client';
import {useActions, type NotePrefill} from '../common/actions';
import {RecordHistory} from '../common/RecordHistory';
import {useOpenRef} from '../common/useOpenRef';
import {GoneNotice, Value, useGone} from '../contacts/DirectoryParts';
import {DemoChip, VerificationChip} from '../events/EventChips';
import {
  DeleteStrip,
  DiscardStrip,
  FormNotices,
  Provenance,
  QualityFields,
  ReadOnlyNotice,
} from '../forms/FormParts';
import {useRecordForm, type FormErrors} from '../forms/useRecordForm';
import {SOURCE_LABEL, sortEvents, VERIFICATION_LABEL} from '../lib/events';
import {dayMonthShort} from '../lib/format';
import {isOpenNote, NOTE_KIND_ICON, resolvedLabel} from '../lib/inventory';
import {recordDate} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  Field,
  Icon,
  Segmented,
  Select,
  Sheet,
  Textarea,
  Withheld,
  describedBy,
} from '../ui';
import {REF_ICON, RefPicker, type RefValue} from './RefPicker';

type RescuedValues = Record<string, unknown>;

export type NoteSheetMode =
  | {kind: 'view'; note: Note}
  | {kind: 'create'; prefill?: NotePrefill; rescued?: RescuedValues}
  | {kind: 'edit'; note: Note; rescued?: RescuedValues};

interface FormValues {
  kind: NoteKind;
  text: string;
  eventId: string;
  ref: RefValue | null;
  resolved: boolean;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  kind: 'note',
  text: '',
  eventId: '',
  ref: null,
  resolved: false,
  source: null,
  verification: 'draft',
};

const toValues = (n: Note): FormValues => ({
  kind: n.kind,
  text: n.text ?? '',
  eventId: n.event?.id ?? '',
  ref: n.ref ? {...n.ref} : null,
  resolved: n.resolved,
  source: n.source,
  verification: n.verification,
});

function fromRescue(raw: RescuedValues, fallback: FormValues): FormValues {
  const out = {...fallback};
  if (typeof raw.kind === 'string' && raw.kind in NOTE_KIND_LABEL) {
    out.kind = raw.kind as NoteKind;
  }
  if (typeof raw.text === 'string') out.text = raw.text;
  if (typeof raw.eventId === 'string') out.eventId = raw.eventId;
  if (typeof raw.resolved === 'boolean') out.resolved = raw.resolved;
  const ref = raw.ref as Partial<RefValue> | null | undefined;
  if (ref === null) out.ref = null;
  else if (
    ref &&
    typeof ref.id === 'string' &&
    typeof ref.label === 'string' &&
    (NOTE_REF_TYPES as readonly string[]).includes(ref.type ?? '')
  ) {
    out.ref = {type: ref.type as NoteRefType, id: ref.id, label: ref.label};
  }
  if (raw.source === null) out.source = null;
  else if (typeof raw.source === 'string' && raw.source in SOURCE_LABEL) {
    out.source = raw.source as DataSource;
  }
  if (
    typeof raw.verification === 'string' &&
    raw.verification in VERIFICATION_LABEL
  ) {
    out.verification = raw.verification as Verification;
  }
  return out;
}

const SERVER_FIELD: Partial<Record<string, keyof FormValues>> = {
  kind: 'kind',
  text: 'text',
  eventId: 'eventId',
  event: 'eventId',
  ref: 'ref',
  resolved: 'resolved',
  source: 'source',
  verification: 'verification',
};

const KIND_HELP: Record<NoteKind, string> = {
  note: 'Un apunte cualquiera.',
  incident:
    'Algo que ha salido mal en la logística: un camión que no llega, una valla rota.',
  decision: 'Algo que se ha decidido, para que conste.',
  open_question: 'Algo que hay que averiguar o preguntar.',
  feature_idea: 'Algo que echáis en falta en esta herramienta.',
};

const TEXT_LABEL: Record<NoteKind, string> = {
  note: 'Nota',
  incident: 'Qué ha pasado',
  decision: 'Qué se ha decidido',
  open_question: 'Qué hay que averiguar',
  feature_idea: 'Qué echáis en falta',
};

const TEXT_PLACEHOLDER: Record<NoteKind, string> = {
  note: 'El almacén abre a las 7:30; preguntar por la llave en conserjería.',
  incident: 'El camión de las vallas llega con 40 minutos de retraso.',
  decision: 'Las carpas se montan el día antes, no el mismo día.',
  open_question: '¿Quién tiene la llave del cuadro eléctrico?',
  feature_idea: 'Poder hacer una foto del material desde la ficha.',
};

const KIND_OPTIONS = NOTE_KINDS.map(k => ({
  value: k,
  label: NOTE_KIND_LABEL[k],
  title: KIND_HELP[k],
  icon: NOTE_KIND_ICON[k],
}));

function validate(v: FormValues): FormErrors<FormValues> {
  const e: FormErrors<FormValues> = {};
  if (!v.text.trim()) e.text = 'Escribe la nota, aunque sea en dos palabras.';
  else if (v.text.trim().length > NOTE_TEXT_MAX) {
    e.text = `Como mucho ${NOTE_TEXT_MAX} caracteres.`;
  }
  return e;
}

/** What the sheet is about, for its title: never the note's text. */
function aboutTitle(n: Pick<Note, 'kind' | 'ref' | 'event'>): string {
  return n.ref?.label ?? n.event?.name ?? NOTE_KIND_LABEL[n.kind];
}

/**
 * The scope of an «Incidencia», in plain sight: what may and may not be
 * recorded here (invariant 3).
 */
export const IncidentScope: React.FC<{id: string}> = ({id}) => (
  <p className="lx-scope" id={id} role="note">
    <Icon name="lock" size={18} />
    <span>{INCIDENT_SCOPE_NOTE}</span>
  </p>
);

export const NoteSheet: React.FC<{
  mode: NoteSheetMode | null;
  onClose: () => void;
}> = ({mode, onClose}) =>
  mode ? <NoteSheetBody initial={mode} onClose={onClose} /> : null;

const NoteSheetBody: React.FC<{
  initial: NoteSheetMode;
  onClose: () => void;
}> = ({initial, onClose}) => {
  const [mode, setMode] = useState(initial);
  if (mode.kind === 'view') {
    return (
      <NoteView
        note={mode.note}
        onClose={onClose}
        onEdit={n => setMode({kind: 'edit', note: n})}
      />
    );
  }
  return (
    <NoteForm
      mode={mode}
      onClose={onClose}
      onSaved={n => setMode({kind: 'view', note: n})}
    />
  );
};

// ---------------------------------------------------------------- view

const NoteView: React.FC<{
  note: Note;
  onClose: () => void;
  onEdit: (note: Note) => void;
}> = ({note: opened, onClose, onEdit}) => {
  const live = useLogisticsStore(s => s.notes.find(n => n.id === opened.id));
  const loaded = useLogisticsStore(s => s.notesState === 'ready');
  const events = useLogisticsStore(s => s.events);
  const updateNote = useLogisticsStore(s => s.updateNote);
  const toast = useLogisticsStore(s => s.toast);
  const {canWrite, openEvent} = useActions();
  const openRef = useOpenRef();
  const note = live ?? opened;
  const gone = useGone(live, loaded);
  const [busy, setBusy] = useState(false);
  const event = note.event ? events.find(e => e.id === note.event!.id) : null;
  const goRef = note.ref ? openRef(note.ref) : null;
  const status = resolvedLabel(note);
  const resolvable = RESOLVABLE_NOTE_KINDS.has(note.kind);
  const withheld = note.restricted || note.text === null;

  const toggleResolved = async () => {
    setBusy(true);
    try {
      const updated = await updateNote(note.id, {
        version: note.version,
        resolved: !note.resolved,
      });
      toast(
        `${noteLabel(updated)}: ${resolvedLabel(updated)?.toLocaleLowerCase('es-ES')}`,
        'success',
      );
    } catch (err) {
      toast(
        isApiError(err) && err.code === 'VERSION_CONFLICT'
          ? 'Otra persona ha cambiado esta nota: ya ves la versión actual.'
          : `No se ha guardado. ${errorMessage(err)}`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-note-sheet"
      eyebrow={NOTE_KIND_LABEL[note.kind]}
      title={aboutTitle(note)}
      meta={
        <>
          {note.isDemo && <DemoChip />}
          {status && (
            <Chip
              size="sm"
              certainty={isOpenNote(note) ? 'pending' : 'confirmed'}
              tone={isOpenNote(note) ? 'danger' : 'accent'}
            >
              {status}
            </Chip>
          )}
          <VerificationChip verification={note.verification} />
        </>
      }
      footer={
        canWrite && !gone ? (
          <>
            <Button variant="ghost" onClick={onClose} id="lx-note-close">
              Cerrar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="primary"
              icon="edit"
              id="lx-note-edit"
              onClick={() => onEdit(note)}
            >
              Editar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} id="lx-note-close">
            Cerrar
          </Button>
        )
      }
    >
      <div className="lx-record">
        {gone && <GoneNotice what="Esta nota" />}
        {!canWrite && <ReadOnlyNotice />}
        {note.kind === 'incident' && <IncidentScope id="lx-note-scope" />}

        <div
          className={`lx-notetext lx-notetext--${note.kind}`}
          id="lx-note-text"
        >
          <span className="lx-notetext__icon" aria-hidden="true">
            <Icon name={NOTE_KIND_ICON[note.kind]} size={22} />
          </span>
          {withheld ? (
            <p>
              <Withheld />
            </p>
          ) : (
            <p className="lx-notetext__body">{note.text}</p>
          )}
        </div>

        {resolvable && canWrite && !gone && (
          <Button
            icon={note.resolved ? 'refresh' : 'check'}
            id="lx-note-toggle-resolved"
            busy={busy}
            className="lx-record__share"
            onClick={() => void toggleResolved()}
          >
            {note.resolved
              ? note.kind === 'open_question'
                ? 'Marcar sin responder'
                : 'Reabrir'
              : note.kind === 'open_question'
                ? 'Marcar como respondida'
                : 'Marcar como resuelta'}
          </Button>
        )}

        <dl className="lx-detail" id="lx-note-detail">
          <div>
            <dt>Evento</dt>
            <dd>
              {note.event ? (
                event ? (
                  <button
                    type="button"
                    className="lx-link"
                    id="lx-note-event-link"
                    onClick={() => openEvent(event)}
                  >
                    {note.event.name}
                  </button>
                ) : (
                  note.event.name
                )
              ) : (
                <span className="lx-muted">Sin evento</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Vinculada a</dt>
            <dd>
              {note.ref ? (
                <span className="lx-refview">
                  <Icon name={REF_ICON[note.ref.type]} size={16} />
                  {goRef ? (
                    <button
                      type="button"
                      className="lx-link"
                      id="lx-note-ref-link"
                      onClick={goRef}
                    >
                      {note.ref.label}
                    </button>
                  ) : (
                    note.ref.label
                  )}
                  <span className="lx-muted">
                    · {SEARCH_TYPE_LABEL[note.ref.type]}
                  </span>
                </span>
              ) : (
                <span className="lx-muted">Sin vincular</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Origen del dato</dt>
            <dd>
              <Value value={note.source && SOURCE_LABEL[note.source]} />
            </dd>
          </div>
        </dl>

        <RecordHistory
          entityType="note"
          entityId={note.id}
          version={note.version}
          idPrefix="lx-note"
        />
        <Provenance record={note} id="lx-note-provenance" />
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------- form

const NoteForm: React.FC<{
  mode: Exclude<NoteSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onSaved: (note: Note) => void;
}> = ({mode, onClose, onSaved}) => {
  const createNote = useLogisticsStore(s => s.createNote);
  const updateNote = useLogisticsStore(s => s.updateNote);
  const deleteNote = useLogisticsStore(s => s.deleteNote);
  const toast = useLogisticsStore(s => s.toast);
  const events = useLogisticsStore(s => s.events);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const editing = mode.kind === 'edit' ? mode.note : null;
  const blank = useMemo<FormValues>(
    () =>
      mode.kind === 'create'
        ? {
            ...EMPTY,
            kind: mode.prefill?.kind ?? 'note',
            eventId: mode.prefill?.eventId ?? '',
            ref: mode.prefill?.ref ?? null,
          }
        : EMPTY,
    // Only the opening values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const toValuesCb = useCallback(toValues, []);
  const f = useRecordForm<FormValues, Note>({
    entity: 'note',
    editing,
    blank,
    toValues: toValuesCb,
    rescued: mode.rescued,
    fromRescue,
    serverField: SERVER_FIELD,
    onClose: () => (f.base ? onSaved(f.base) : onClose()),
  });
  const {values, set, errors, base, saving} = f;
  const isCreate = !base;
  const resolvable = RESOLVABLE_NOTE_KINDS.has(values.kind);
  const sortedEvents = useMemo(() => sortEvents(events), [events]);

  const change = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    set(k, v);
    setSavedLabel(null);
  };

  const inputFrom = (v: FormValues): NoteInput => ({
    kind: v.kind,
    text: v.text.trim(),
    eventId: v.eventId || null,
    ref: v.ref ? {type: v.ref.type, id: v.ref.id} : null,
    resolved: RESOLVABLE_NOTE_KINDS.has(v.kind) ? v.resolved : false,
    source: v.source,
    verification: v.verification,
  });

  const submit = async (next: boolean) => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      f.setErrors(found);
      document.getElementById('lx-note-text-input')?.focus();
      return;
    }
    f.setSaving(next ? 'next' : 'save');
    f.setErrors({});
    try {
      if (!base) {
        const created = await createNote(inputFrom(values));
        f.markSaved();
        toast(`Guardada: ${noteLabel(created)}`, 'success');
        if (next) {
          // The next note about the same thing: kind, event and link stay.
          f.startNext({
            ...EMPTY,
            kind: values.kind,
            eventId: values.eventId,
            ref: values.ref,
            source: values.source,
            verification: values.verification,
          });
          setSavedLabel(noteLabel(created));
          document.getElementById('lx-note-text-input')?.focus();
        } else {
          onSaved(created);
        }
        return;
      }
      const full = inputFrom(values);
      const patch: NoteInput = {version: base.version};
      if (f.changed('kind')) patch.kind = full.kind;
      if (f.changed('text')) patch.text = full.text;
      if (f.changed('eventId')) patch.eventId = full.eventId;
      if (f.changed('ref')) patch.ref = full.ref;
      if (f.changed('resolved') || f.changed('kind')) {
        patch.resolved = full.resolved;
      }
      if (f.changed('source')) patch.source = full.source;
      if (f.changed('verification')) patch.verification = full.verification;
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        onSaved(base);
        return;
      }
      const updated = await updateNote(base.id, patch);
      f.markSaved();
      toast(`Cambios guardados: ${noteLabel(updated)}`, 'success');
      onSaved(updated);
    } catch (err) {
      f.applyServerError(err, 'save');
    } finally {
      f.setSaving(null);
    }
  };

  const remove = async () => {
    if (!base || saving) return;
    f.setSaving('delete');
    f.setErrors({});
    try {
      await deleteNote(base);
      toast(`Borrada: ${noteLabel(base)}`, 'success');
      onClose();
    } catch (err) {
      f.setConfirm(null);
      f.applyServerError(err, 'delete');
    } finally {
      f.setSaving(null);
    }
  };

  const statusOptions = [
    {
      value: 'open' as const,
      label: values.kind === 'open_question' ? 'Sin responder' : 'Abierta',
    },
    {
      value: 'resolved' as const,
      label: values.kind === 'open_question' ? 'Respondida' : 'Resuelta',
    },
  ];

  const footer =
    f.confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-note-discard"
        onKeep={f.keepEditing}
        onDiscard={f.discard}
      />
    ) : f.confirm === 'delete' && base ? (
      <DeleteStrip
        idPrefix="lx-note"
        question={<>¿Borrar «{noteLabel(base)}»?</>}
        detail="Desaparece de las fichas a las que estaba vinculada. No se puede deshacer."
        busy={saving === 'delete'}
        onKeep={() => f.setConfirm(null)}
        onDelete={() => void remove()}
      />
    ) : (
      <>
        {base ? (
          <Button
            variant="ghost"
            icon="trash"
            className="lx-btn--danger-text"
            id="lx-note-delete"
            disabled={!!saving}
            onClick={() => f.setConfirm('delete')}
          >
            Borrar
          </Button>
        ) : (
          <Button variant="ghost" onClick={f.requestClose} id="lx-note-cancel">
            Cancelar
          </Button>
        )}
        <span className="lx-sheet__foot-spacer" />
        {isCreate ? (
          <Button
            id="lx-note-save-next"
            busy={saving === 'next'}
            disabled={saving === 'save'}
            onClick={() => void submit(true)}
          >
            {saving === 'next' ? 'Guardando…' : 'Guardar y seguir'}
          </Button>
        ) : (
          <Button variant="ghost" onClick={f.requestClose} id="lx-note-cancel">
            Cancelar
          </Button>
        )}
        <Button
          variant="primary"
          id="lx-note-save"
          busy={saving === 'save'}
          disabled={saving === 'next' || saving === 'delete' || !!f.conflict}
          onClick={() => void submit(false)}
        >
          {saving === 'save' ? 'Guardando…' : 'Guardar'}
        </Button>
      </>
    );

  const textId = 'lx-note-text-input';
  const kindName = NOTE_KIND_LABEL[values.kind];

  return (
    <Sheet
      open
      onClose={f.requestClose}
      id="lx-note-sheet"
      eyebrow={isCreate ? `Nueva · ${kindName}` : `Editar · ${kindName}`}
      title={
        isCreate
          ? `Añadir ${kindName.toLocaleLowerCase('es-ES')}`
          : aboutTitle(base)
      }
      meta={
        base ? (
          <>
            {base.isDemo && <DemoChip />}
            <VerificationChip verification={base.verification} />
          </>
        ) : (
          <span className="lx-muted">
            Solo el texto es obligatorio. Lo demás puede quedar pendiente.
          </span>
        )
      }
      footer={footer}
    >
      <form
        id="lx-note-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <FormNotices
          idPrefix="lx-note"
          subject="esta nota"
          conflict={f.conflict}
          conflictOn={f.conflictOn}
          ownConflict={f.ownConflict}
          onLoadCurrent={f.loadCurrent}
          rescued={f.rescuedNotice}
          currentLoaded={f.conflictResolved}
          saved={
            savedLabel && (
              <>Guardada «{savedLabel}». Puedes añadir la siguiente.</>
            )
          }
          error={errors.form}
          alertRef={f.alertRef}
          merge={f.merge}
        />

        <Segmented<NoteKind>
          name="lx-note-kind"
          id="lx-note-kind"
          legend="Qué es"
          value={values.kind}
          options={KIND_OPTIONS}
          tiles
          onChange={v => v && change('kind', v)}
        />

        {values.kind === 'incident' && <IncidentScope id="lx-note-scope" />}

        <Field id={textId} label={TEXT_LABEL[values.kind]} error={errors.text}>
          <Textarea
            id={textId}
            name={textId}
            data-autofocus
            rows={4}
            value={values.text}
            invalid={!!errors.text}
            aria-describedby={[
              describedBy(textId, {error: errors.text}),
              'lx-note-privacy',
              values.kind === 'incident' ? 'lx-note-scope' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            placeholder={TEXT_PLACEHOLDER[values.kind]}
            onChange={e => change('text', e.target.value)}
          />
        </Field>
        <p className="lx-form__note lx-privacy" id="lx-note-privacy">
          <Icon name="lock" size={15} />
          {NOTE_PRIVACY_HINT}
        </p>

        {resolvable && (
          <Segmented<'open' | 'resolved'>
            name="lx-note-resolved"
            id="lx-note-resolved"
            legend="Estado"
            value={values.resolved ? 'resolved' : 'open'}
            options={statusOptions}
            onChange={v => v && change('resolved', v === 'resolved')}
          />
        )}

        <Field
          id="lx-note-event"
          label="Evento"
          optional
          error={errors.eventId}
        >
          <Select
            id="lx-note-event"
            name="lx-note-event"
            value={values.eventId}
            invalid={!!errors.eventId}
            onChange={e => change('eventId', e.target.value)}
          >
            <option value="">Sin evento</option>
            {sortedEvents.map(ev => {
              const d = recordDate(ev);
              return (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                  {d ? ` · ${dayMonthShort(d)}` : ''}
                </option>
              );
            })}
          </Select>
        </Field>

        <RefPicker
          idPrefix="lx-note"
          value={values.ref}
          onChange={v => change('ref', v)}
          error={errors.ref}
        />

        <QualityFields
          idPrefix="lx-note"
          source={values.source}
          verification={values.verification}
          onSource={v => change('source', v)}
          onVerification={v => change('verification', v)}
        />

        {base && (
          <RecordHistory
            entityType="note"
            entityId={base.id}
            version={base.version}
            idPrefix="lx-note-form"
          />
        )}
        {base && <Provenance record={base} id="lx-note-provenance" />}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
