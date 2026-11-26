/**
 * Form state shared by the person, company and offer sheets, with the same
 * guarantees as the event and task sheets:
 *
 * - dirty tracking against the record being edited (or the prefilled
 *   values), and a «¿Descartarlos?» step before losing changes;
 * - a 409 conflict never overwrites: the server copy is kept aside until the
 *   user chooses «Ver versión actual»;
 * - server field errors land on their fields, unavailability keeps the text;
 * - if the session expires mid-edit, the values are rescued for this tab and
 *   reopened after signing in again (`lib/rescue.ts`).
 */
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {RecordMeta} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {clearRescue, saveRescue, type RescuedForm} from '../lib/rescue';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {useAlertFocus} from './FormParts';

export type DirectoryEntity =
  'contact' | 'company' | 'offer' | 'warehouse' | 'resource' | 'note';

export type FormErrors<V> = Partial<Record<keyof V | 'form', string>>;

export type Confirm = 'discard' | 'delete' | null;

export interface RecordFormOptions<V extends object, R extends RecordMeta> {
  entity: DirectoryEntity;
  /** Record being edited; null when creating. */
  editing: R | null;
  /** Values of a new record (prefill included). */
  blank: V;
  toValues: (record: R) => V;
  rescued?: Record<string, unknown>;
  /** Rescued values over `fallback`, keeping only fields of the right shape. */
  fromRescue: (raw: Record<string, unknown>, fallback: V) => V;
  /** Server field names → form fields. */
  serverField: Partial<Record<string, keyof V>>;
  onClose: () => void;
  /** 409 DUPLICATE: the existing record with that name. */
  onDuplicate?: (current: unknown) => void;
}

const same = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export function useRecordForm<V extends object, R extends RecordMeta>(
  opts: RecordFormOptions<V, R>,
) {
  const {entity, toValues, serverField, onClose} = opts;
  const userId = useLogisticsStore(s => s.session?.user.id ?? null);
  const orgId = useLogisticsStore(s => s.orgId);

  const [base, setBase] = useState<R | null>(opts.editing);
  const [blank, setBlank] = useState(opts.blank);
  const initial = useMemo(
    () => (base ? toValues(base) : blank),
    [base, blank, toValues],
  );
  const [values, setValues] = useState<V>(() =>
    opts.rescued ? opts.fromRescue(opts.rescued, initial) : initial,
  );
  const [rescuedNotice, setRescuedNotice] = useState(!!opts.rescued);
  const [errors, setErrors] = useState<FormErrors<V>>({});
  const [saving, setSaving] = useState<'save' | 'next' | 'delete' | null>(null);
  const [conflict, setConflict] = useState<R | null>(null);
  const [conflictOn, setConflictOn] = useState<'save' | 'delete'>('save');
  const [conflictResolved, setConflictResolved] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Where the user asked to go while «¿Descartarlos?» is showing (another
  // record), instead of simply closing.
  const [leaveTo, setLeaveTo] = useState<{
    label: string;
    go: () => void;
  } | null>(null);
  const alertRef = useAlertFocus(conflict ?? errors.form);

  const dirty = (Object.keys(values) as (keyof V)[]).some(
    k => !same(values[k], initial[k]),
  );

  // Latest form state, readable after the session is gone.
  const latest = useRef({values, base, dirty, userId, orgId});
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

  const rescue = () => {
    const form = latest.current;
    if (!form.dirty || !form.userId) return;
    saveRescue({
      entity,
      userId: form.userId,
      orgId: form.orgId,
      base: form.base,
      values: form.values,
      savedAt: new Date().toISOString(),
    } as unknown as RescuedForm<unknown>);
  };
  const rescueRef = useRef(rescue);
  useLayoutEffect(() => {
    rescueRef.current = rescue;
  });

  // The app unmounts the sheet when the session expires: rescue the values.
  useLayoutEffect(() => {
    const save = rescueRef;
    return () => {
      if (useLogisticsStore.getState().phase !== 'ready') save.current();
    };
  }, []);

  /** Leaving on purpose (cancel, discard, close): the rescue is spent. */
  const close = () => {
    if (opts.rescued) clearRescue();
    onClose();
  };

  const set = <K extends keyof V>(key: K, value: V[K]) => {
    setValues(v => ({...v, [key]: value}));
    if (errors[key] || errors.form) {
      setErrors(e => ({...e, [key]: undefined, form: undefined}));
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (confirm === 'delete') {
      setConfirm(null);
      return;
    }
    if (confirm === 'discard') {
      // A second Escape while asking goes back to editing.
      keepEditing();
      return;
    }
    if (dirty) {
      setConfirm('discard');
      return;
    }
    close();
  };

  /** «Seguir editando»: back to the form, nowhere else to go. */
  const keepEditing = () => {
    setConfirm(null);
    setLeaveTo(null);
  };

  /** «Descartar»: leave for the pending record, or close. */
  const discard = () => {
    const pending = leaveTo;
    setLeaveTo(null);
    setConfirm(null);
    if (!pending) {
      close();
      return;
    }
    if (opts.rescued) clearRescue();
    pending.go();
  };

  /**
   * Opens another record from this form (a look-alike, the existing
   * duplicate). Asks first when anything beyond `keep` was typed, so a
   * half-filled form is never replaced silently.
   */
  const leaveFor = (label: string, go: () => void, keep: (keyof V)[] = []) => {
    if (saving) return;
    const loses = (Object.keys(values) as (keyof V)[]).some(
      k => !keep.includes(k) && !same(values[k], initial[k]),
    );
    if (!loses) {
      if (opts.rescued) clearRescue();
      go();
      return;
    }
    setLeaveTo({label, go});
    setConfirm('discard');
  };

  /** Puts a server error where the user will see it. */
  const applyServerError = (err: unknown, action: 'save' | 'delete') => {
    if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
      rescue();
      return;
    }
    if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
      const current =
        err.current && typeof err.current === 'object'
          ? (err.current as R)
          : null;
      setConflict(current ?? base);
      setConflictOn(action);
      setConflictResolved(false);
      return;
    }
    if (isApiError(err) && err.code === 'DUPLICATE' && opts.onDuplicate) {
      opts.onDuplicate(err.current ?? null);
      return;
    }
    if (isApiError(err) && err.code === 'VALIDATION' && err.fields) {
      const mapped: FormErrors<V> = {};
      for (const [field, message] of Object.entries(err.fields)) {
        mapped[serverField[field] ?? 'form'] = message;
      }
      setErrors(mapped);
      return;
    }
    const what = action === 'delete' ? 'borrado' : 'guardado';
    if (isApiError(err) && err.isUnavailable) {
      setErrors({
        form: `Servidor no disponible: no se ha ${what}. ${
          action === 'save'
            ? 'Lo que has escrito sigue aquí; vuelve a intentarlo cuando haya conexión.'
            : 'Vuelve a intentarlo cuando haya conexión.'
        }`,
      } as FormErrors<V>);
      return;
    }
    setErrors({
      form: `No se ha ${what}. ${errorMessage(err)}`,
    } as FormErrors<V>);
  };

  const loadCurrent = () => {
    if (!conflict) return;
    setBase(conflict);
    setValues(toValues(conflict));
    setErrors({});
    setConflictResolved(true);
    setConflict(null);
    setRescuedNotice(false);
    setConfirm(null);
  };

  /** After a successful save: the rescued values are spent. */
  const markSaved = () => {
    if (opts.rescued) clearRescue();
    setRescuedNotice(false);
  };

  /**
   * «Guardar y seguir»: a new blank form starting from `next` (what carries
   * over, e.g. the company), which is not a change of its own.
   */
  const startNext = (next: V) => {
    setBlank(next);
    setValues(next);
    setErrors({});
    setConfirm(null);
    setLeaveTo(null);
  };

  /** Fields that changed against the record being edited. */
  const changed = (key: keyof V) => !same(values[key], initial[key]);

  return {
    base,
    initial,
    values,
    setValues,
    set,
    dirty,
    changed,
    errors,
    setErrors,
    saving,
    setSaving,
    conflict,
    conflictOn,
    conflictResolved,
    ownConflict: !!conflict && !!userId && conflict.updatedBy?.id === userId,
    loadCurrent,
    markSaved,
    startNext,
    rescuedNotice,
    setRescuedNotice,
    confirm,
    setConfirm,
    close,
    requestClose,
    keepEditing,
    discard,
    leaveFor,
    /** The record the user wants to open once they discard, if any. */
    leavingFor: leaveTo?.label ?? null,
    alertRef,
    applyServerError,
  };
}
