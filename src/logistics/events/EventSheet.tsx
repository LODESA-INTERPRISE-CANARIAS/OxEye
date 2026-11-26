/**
 * Create, edit or view an event in a sheet.
 *
 * - Only the name is required; anything else can stay «Pendiente de verificar».
 * - «Guardar y seguir» keeps the sheet open for the next event (same date).
 * - A version conflict (409) never overwrites: the user sees who changed it
 *   and can load the current version before saving again.
 * - Guests get a read-only detail view.
 * - If the session expires mid-edit, the values are rescued for this tab and
 *   the form reopens with them after signing in again (`lib/rescue.ts`).
 * - Multi-day events («Varios días») and the event's tasks («Tareas»).
 */
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DataSource,
  EventStatus,
  LogisticsEvent,
  UpdateEventInput,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {EVENT_STATUSES} from '../../../shared/logistics/rules.ts';
import {DEFAULT_TIMEZONE} from '../../../shared/logistics/time.ts';
import {errorMessage, isApiError} from '../api/client';
import {TimeWindow} from '../common/TimeWindow';
import {
  ConflictNotice,
  DiscardStrip,
  Provenance,
  QualityFields,
  ReadOnlyNotice,
  useAlertFocus,
} from '../forms/FormParts';
import {
  SlotFields,
  slotChanged,
  slotInput,
  validateSlot,
  type SlotValues,
} from '../forms/SlotFields';
import {
  SOURCE_LABEL,
  STATUS_HELP,
  STATUS_LABEL,
  VERIFICATION_LABEL,
} from '../lib/events';
import {longDate} from '../lib/format';
import {clearRescue, saveRescue} from '../lib/rescue';
import {recordSlot} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  Icon,
  Input,
  Pending,
  Segmented,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';
import {DemoChip, StatusChip, VerificationChip} from './EventChips';
import {EventTasks} from './EventTasks';

/** Form values recovered from `lib/rescue.ts`; checked before use. */
export type RescuedValues = Record<string, unknown>;

export type EventSheetMode =
  | {kind: 'create'; rescued?: RescuedValues}
  | {kind: 'edit'; event: LogisticsEvent; rescued?: RescuedValues}
  | {kind: 'view'; event: LogisticsEvent};

interface FormValues extends SlotValues {
  name: string;
  venueName: string;
  status: EventStatus;
  notes: string;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  name: '',
  venueName: '',
  date: '',
  endDate: '',
  multiDay: false,
  startTime: '',
  endTime: '',
  status: 'planned',
  notes: '',
  source: null,
  verification: 'draft',
};

function valuesFromEvent(event: LogisticsEvent): FormValues {
  const slot = recordSlot(event);
  return {
    name: event.name,
    venueName: event.venue?.name ?? '',
    date: slot.date ?? '',
    endDate: event.endDate ?? '',
    multiDay: !!event.endDate,
    startTime: slot.startTime ?? '',
    endTime: slot.endTime ?? '',
    status: event.status,
    notes: event.notes ?? '',
    source: event.source,
    verification: event.verification,
  };
}

const TEXT_KEYS = [
  'name',
  'venueName',
  'date',
  'endDate',
  'startTime',
  'endTime',
  'notes',
] as const;

/** Rescued values over `fallback`, keeping only fields of the right shape. */
function valuesFromRescue(
  raw: RescuedValues,
  fallback: FormValues,
): FormValues {
  const oneOf = <T extends string>(value: unknown, allowed: object) =>
    typeof value === 'string' && Object.hasOwn(allowed, value)
      ? (value as T)
      : undefined;
  const out: FormValues = {...fallback};
  for (const key of TEXT_KEYS) {
    if (typeof raw[key] === 'string') out[key] = raw[key];
  }
  if (typeof raw.multiDay === 'boolean') out.multiDay = raw.multiDay;
  out.status = oneOf<EventStatus>(raw.status, STATUS_LABEL) ?? fallback.status;
  out.source =
    raw.source === null
      ? null
      : (oneOf<DataSource>(raw.source, SOURCE_LABEL) ?? fallback.source);
  out.verification =
    oneOf<Verification>(raw.verification, VERIFICATION_LABEL) ??
    fallback.verification;
  return out;
}

interface FormSnapshot {
  values: FormValues;
  base: LogisticsEvent | null;
  dirty: boolean;
  userId: string | null;
  orgId: string | null;
}

/** Keeps what was typed for this tab, to reopen it after signing in. */
function rescueForm(form: FormSnapshot): void {
  if (!form.dirty || !form.userId) return;
  saveRescue({
    entity: 'event',
    userId: form.userId,
    orgId: form.orgId,
    base: form.base,
    values: form.values,
    savedAt: new Date().toISOString(),
  });
}

type Errors = Partial<Record<keyof FormValues | 'form', string>>;

/** Server field names → form fields. */
const SERVER_FIELD: Record<string, keyof FormValues> = {
  name: 'name',
  venueName: 'venueName',
  venue: 'venueName',
  date: 'date',
  endDate: 'endDate',
  startTime: 'startTime',
  endTime: 'endTime',
  startsAt: 'startTime',
  endsAt: 'endTime',
  status: 'status',
  notes: 'notes',
  source: 'source',
  verification: 'verification',
};

function validate(v: FormValues): Errors {
  const errors: Errors = {};
  if (!v.name.trim()) {
    errors.name = 'Escribe un nombre, aunque sea provisional.';
  }
  return {...errors, ...validateSlot(v)};
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

const STATUS_OPTIONS = EVENT_STATUSES.map(v => ({
  value: v,
  label: STATUS_LABEL[v],
  title: STATUS_HELP[v],
}));

export interface EventSheetProps {
  mode: EventSheetMode | null;
  onClose: () => void;
  /** Told whether the form has unsaved changes (so it is never replaced). */
  onDirty?: (dirty: boolean) => void;
}

export const EventSheet: React.FC<EventSheetProps> = ({
  mode,
  onClose,
  onDirty,
}) => {
  // Mounted only while open, so every opening starts from fresh values.
  if (!mode) return null;

  if (mode.kind === 'view') {
    return (
      <Sheet
        open
        onClose={onClose}
        id="lx-event-sheet"
        eyebrow="Evento"
        title={mode.event.name}
        meta={
          <>
            {mode.event.isDemo && <DemoChip />}
            <StatusChip status={mode.event.status} />
            <VerificationChip verification={mode.event.verification} />
          </>
        }
        footer={
          <Button variant="primary" onClick={onClose} id="lx-event-close">
            Cerrar
          </Button>
        }
      >
        <EventDetail event={mode.event} />
      </Sheet>
    );
  }

  return <EventForm mode={mode} onClose={onClose} onDirty={onDirty} />;
};

const EventDetail: React.FC<{event: LogisticsEvent}> = ({event}) => {
  const {date, endDate} = recordSlot(event);
  return (
    <>
      <ReadOnlyNotice />
      <dl className="lx-detail">
        <div>
          <dt>Lugar</dt>
          <dd>{event.venue?.name ?? <Pending />}</dd>
        </div>
        <div>
          <dt>{endDate ? 'Fechas' : 'Fecha'}</dt>
          <dd>
            {date ? (
              endDate ? (
                `Del ${longDate(date)} al ${longDate(endDate)}`
              ) : (
                longDate(date)
              )
            ) : (
              <Pending />
            )}
          </dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd>
            <TimeWindow record={event} />
          </dd>
        </div>
        <div>
          <dt>Origen del dato</dt>
          <dd>{event.source ? SOURCE_LABEL[event.source] : <Pending />}</dd>
        </div>
        <div>
          <dt>Notas</dt>
          <dd className="lx-detail__notes">{event.notes || '—'}</dd>
        </div>
      </dl>
      <EventTasks event={event} />
      <Provenance record={event} id="lx-event-provenance" />
    </>
  );
};

interface EventFormProps {
  mode: Exclude<EventSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onDirty?: (dirty: boolean) => void;
}

const EventForm: React.FC<EventFormProps> = ({mode, onClose, onDirty}) => {
  const createEvent = useLogisticsStore(s => s.createEvent);
  const updateEvent = useLogisticsStore(s => s.updateEvent);
  const toast = useLogisticsStore(s => s.toast);
  const venues = useLogisticsStore(s => s.venues);
  const userId = useLogisticsStore(s => s.session?.user.id ?? null);
  const orgId = useLogisticsStore(s => s.orgId);
  const orgZone = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.timezone,
  );

  const editing = mode.kind === 'edit' ? mode.event : null;
  const [base, setBase] = useState<LogisticsEvent | null>(editing);
  const initial = useMemo(() => (base ? valuesFromEvent(base) : EMPTY), [base]);
  const [values, setValues] = useState<FormValues>(() =>
    mode.rescued ? valuesFromRescue(mode.rescued, initial) : initial,
  );
  const [rescuedNotice, setRescuedNotice] = useState(!!mode.rescued);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<'save' | 'next' | null>(null);
  const [conflict, setConflict] = useState<LogisticsEvent | null>(null);
  const [conflictResolved, setConflictResolved] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Conflict and form error are exclusive; whichever is shown owns the ref.
  const alertRef = useAlertFocus(conflict ?? errors.form);

  const dirty = (Object.keys(values) as (keyof FormValues)[]).some(
    k => values[k] !== initial[k],
  );

  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  // Latest form state for the rescue, readable after the session is gone.
  const latest = useRef<FormSnapshot>({values, base, dirty, userId, orgId});
  useLayoutEffect(() => {
    const prev = latest.current;
    latest.current = {
      values,
      base,
      dirty,
      userId: userId ?? prev.userId,
      orgId: orgId ?? prev.orgId,
    };
  });

  // The app unmounts the sheet when the session expires (e.g. a background
  // refresh got a 401): rescue the unsaved values instead of losing them.
  useLayoutEffect(() => {
    const state = latest;
    return () => {
      if (useLogisticsStore.getState().phase !== 'ready') {
        rescueForm(state.current);
      }
    };
  }, []);

  /** Leaving on purpose (cancel, discard, close): the rescue is spent. */
  const close = () => {
    if (mode.rescued) clearRescue();
    onClose();
  };

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues(v => ({...v, [key]: value}));
    setSavedName(null);
    if (errors[key] || errors.form) {
      setErrors(e => ({...e, [key]: undefined, form: undefined}));
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) {
      // Discarding takes the explicit «Descartar» button: a second Escape or
      // close while asking goes back to editing instead of losing the work.
      setConfirmDiscard(asking => !asking);
      return;
    }
    close();
  };

  const applyServerError = (err: unknown) => {
    if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
      // The store has already sent everyone to the login screen.
      rescueForm(latest.current);
      return;
    }
    if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
      const current =
        err.current && typeof err.current === 'object'
          ? (err.current as LogisticsEvent)
          : null;
      setConflict(current ?? base);
      setConflictResolved(false);
      return;
    }
    if (isApiError(err) && err.code === 'VALIDATION' && err.fields) {
      const mapped: Errors = {};
      for (const [field, message] of Object.entries(err.fields)) {
        mapped[SERVER_FIELD[field] ?? 'form'] = message;
      }
      setErrors(mapped);
      return;
    }
    if (isApiError(err) && err.isUnavailable) {
      setErrors({
        form: 'Servidor no disponible: el evento no se ha guardado. Lo que has escrito sigue aquí; vuelve a intentarlo cuando haya conexión.',
      });
      return;
    }
    setErrors({form: `No se ha guardado. ${errorMessage(err)}`});
  };

  const submit = async (next: boolean) => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = Object.keys(found)[0];
      document.getElementById(`lx-event-${fieldDomId(first)}`)?.focus();
      return;
    }
    setSaving(next ? 'next' : 'save');
    setErrors({});
    try {
      if (!base) {
        const created = await createEvent({
          name: values.name.trim(),
          venueName: nullIfEmpty(values.venueName),
          ...slotInput(values),
          status: values.status,
          notes: nullIfEmpty(values.notes),
          source: values.source,
          verification: values.verification,
        });
        toast(`Evento guardado: ${created.name}`, 'success');
        if (mode.rescued) clearRescue();
        setRescuedNotice(false);
        if (next) {
          setValues(v => ({
            ...EMPTY,
            date: v.date,
            status: v.status,
            source: v.source,
            verification: v.verification,
          }));
          setSavedName(created.name);
          nameRef.current?.focus();
        } else {
          close();
        }
        return;
      }
      const patch: UpdateEventInput = {version: base.version};
      if (values.name !== initial.name) patch.name = values.name.trim();
      if (values.venueName !== initial.venueName) {
        patch.venueName = nullIfEmpty(values.venueName);
      }
      if (slotChanged(values, initial)) {
        // Date and times travel together so the server can rebuild the slot.
        Object.assign(patch, slotInput(values));
      }
      if (values.status !== initial.status) patch.status = values.status;
      if (values.notes !== initial.notes) {
        patch.notes = nullIfEmpty(values.notes);
      }
      if (values.source !== initial.source) patch.source = values.source;
      if (values.verification !== initial.verification) {
        patch.verification = values.verification;
      }
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        close();
        return;
      }
      const updated = await updateEvent(base.id, patch);
      toast(`Cambios guardados: ${updated.name}`, 'success');
      close();
    } catch (err) {
      applyServerError(err);
    } finally {
      setSaving(null);
    }
  };

  const loadCurrent = () => {
    if (!conflict) return;
    setBase(conflict);
    setValues(valuesFromEvent(conflict));
    setErrors({});
    setConflictResolved(true);
    setConflict(null);
    setRescuedNotice(false);
  };

  const isCreate = !base;
  const venueListId = 'lx-event-venues';
  const ownConflict =
    !!conflict && !!userId && conflict.updatedBy?.id === userId;
  const zone = (base ? base.timezone : orgZone) || DEFAULT_TIMEZONE;

  return (
    <Sheet
      open
      onClose={requestClose}
      id="lx-event-sheet"
      eyebrow={isCreate ? 'Nuevo evento' : 'Editar evento'}
      title={isCreate ? 'Añadir evento' : base.name}
      meta={
        base ? (
          <>
            {base.isDemo && <DemoChip />}
            <StatusChip status={base.status} />
            <VerificationChip verification={base.verification} />
          </>
        ) : (
          <span className="lx-muted">
            Solo el nombre es obligatorio. Lo demás puede quedar pendiente.
          </span>
        )
      }
      footer={
        confirmDiscard ? (
          <DiscardStrip
            idPrefix="lx-discard"
            onKeep={() => setConfirmDiscard(false)}
            onDiscard={close}
          />
        ) : (
          <>
            <Button variant="ghost" onClick={requestClose} id="lx-event-cancel">
              Cancelar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            {isCreate && (
              <Button
                id="lx-event-save-next"
                busy={saving === 'next'}
                disabled={saving === 'save'}
                onClick={() => void submit(true)}
              >
                {saving === 'next' ? 'Guardando…' : 'Guardar y seguir'}
              </Button>
            )}
            <Button
              variant="primary"
              id="lx-event-save"
              busy={saving === 'save'}
              disabled={saving === 'next' || !!conflict}
              onClick={() => void submit(false)}
            >
              {saving === 'save' ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        )
      }
    >
      <form
        id="lx-event-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {conflict && (
          <ConflictNotice
            id="lx-event-conflict"
            loadId="lx-event-load-current"
            subject="este evento"
            current={conflict}
            ownConflict={ownConflict}
            onLoad={loadCurrent}
            alertRef={alertRef}
          />
        )}
        {rescuedNotice && (
          <p className="lx-notice" role="status" id="lx-event-rescued">
            <Icon name="refresh" size={16} />
            Hemos recuperado lo que estabas escribiendo. Revísalo y guarda.
          </p>
        )}
        {conflictResolved && (
          <p className="lx-notice" role="status" id="lx-event-current-loaded">
            <Icon name="refresh" size={16} />
            Estás viendo la versión actual. Vuelve a aplicar tus cambios si
            siguen haciendo falta y guarda.
          </p>
        )}
        {savedName && (
          <p
            className="lx-notice lx-notice--success"
            role="status"
            id="lx-event-saved"
          >
            <Icon name="check" size={16} />
            Guardado «{savedName}». Puedes añadir el siguiente.
          </p>
        )}
        {errors.form && (
          <p
            className="lx-notice lx-notice--error"
            role="alert"
            id="lx-event-error"
            tabIndex={-1}
            ref={el => {
              alertRef.current = el;
            }}
          >
            <Icon name="alert" size={16} />
            {errors.form}
          </p>
        )}

        <Field id="lx-event-name" label="Nombre del evento" error={errors.name}>
          <Input
            ref={nameRef}
            id="lx-event-name"
            name="lx-event-name"
            data-autofocus
            value={values.name}
            invalid={!!errors.name}
            aria-describedby={describedBy('lx-event-name', {
              error: errors.name,
            })}
            placeholder="Navidad en la Plaza del Cristo"
            autoComplete="off"
            enterKeyHint="next"
            onChange={e => set('name', e.target.value)}
          />
        </Field>

        <Field
          id="lx-event-venue"
          label="Lugar"
          optional
          error={errors.venueName}
          hint="Si el lugar no existe, se crea con este nombre."
        >
          <Input
            id="lx-event-venue"
            name="lx-event-venue"
            list={venueListId}
            value={values.venueName}
            invalid={!!errors.venueName}
            aria-describedby={describedBy('lx-event-venue', {
              error: errors.venueName,
              hint: true,
            })}
            placeholder="Plaza del Adelantado"
            autoComplete="off"
            onChange={e => set('venueName', e.target.value)}
          />
          <datalist id={venueListId}>
            {venues.map(v => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
        </Field>

        <SlotFields
          idPrefix="lx-event"
          values={values}
          errors={errors}
          onChange={set}
          zone={zone}
          subject="el evento"
        />

        <Segmented<EventStatus>
          name="lx-event-status"
          id="lx-event-status"
          legend="Estado"
          value={values.status}
          options={STATUS_OPTIONS}
          onChange={v => v && set('status', v)}
          help="Previsto: está en el plan. Confirmado: lo ha confirmado quien organiza. Con retraso: va tarde respecto a lo previsto. Cancelado: no se celebrará."
        />

        <QualityFields
          idPrefix="lx-event"
          source={values.source}
          verification={values.verification}
          onSource={v => set('source', v)}
          onVerification={v => set('verification', v)}
        />

        <Field id="lx-event-notes" label="Notas" optional error={errors.notes}>
          <Textarea
            id="lx-event-notes"
            name="lx-event-notes"
            rows={3}
            value={values.notes}
            invalid={!!errors.notes}
            placeholder="Quién lo organiza, qué falta por confirmar…"
            onChange={e => set('notes', e.target.value)}
          />
        </Field>

        {base && <EventTasks event={base} />}
        {base && <Provenance record={base} id="lx-event-provenance" />}
        {/* Enter in a text field submits. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};

function fieldDomId(field: string): string {
  switch (field) {
    case 'venueName':
      return 'venue';
    case 'startTime':
      return 'start';
    case 'endTime':
      return 'end';
    case 'endDate':
      return 'enddate';
    default:
      return field;
  }
}
