/**
 * Pieces shared by the event and task sheets: the version-conflict notice,
 * the discard confirmation, provenance, data-quality choices, and a hook that
 * brings a blocking notice into view.
 */
import React, {useEffect, useRef} from 'react';
import type {
  DataSource,
  RecordMeta,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {DEFAULT_TIMEZONE} from '../../../shared/logistics/time.ts';
import {
  SOURCE_HELP,
  SOURCE_LABEL,
  VERIFICATION_HELP,
  VERIFICATION_LABEL,
} from '../lib/events';
import {instantShort, relativeTime} from '../lib/format';
import {Button, Icon, Segmented} from '../ui';
import type {MergeSlot} from './useRecordForm';

type Versioned = Pick<
  RecordMeta,
  'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'
> & {timezone?: string};

/**
 * A blocking notice (conflict, form error) appears at the top of a long form
 * while the user is at the bottom: bring it into view and focus it.
 */
export function useAlertFocus(active: unknown) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const reduce = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    // Scroll only the nearest scrolling container: `scrollIntoView` would
    // also scroll the sheet's clipped frame and push its header out of view.
    const scroller = scrollParent(el);
    if (scroller) {
      const top =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        8;
      scroller.scrollTo({
        top: Math.max(0, top),
        behavior: reduce ? 'auto' : 'smooth',
      });
    }
    el.focus({preventScroll: true});
  }, [active]);
  return ref;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const {overflowY} = getComputedStyle(p);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      p.scrollHeight > p.clientHeight
    ) {
      return p;
    }
  }
  return null;
}

export const ConflictNotice: React.FC<{
  id: string;
  loadId: string;
  /** «este evento», «esta tarea». */
  subject: string;
  /** What did not happen: «Tus cambios no se han guardado». */
  outcome?: string;
  current: Versioned;
  ownConflict: boolean;
  onLoad: () => void;
  alertRef: React.RefObject<HTMLElement | null>;
}> = ({
  id,
  loadId,
  subject,
  outcome = 'Tus cambios no se han guardado',
  current,
  ownConflict,
  onLoad,
  alertRef,
}) => {
  const when = current.updatedAt
    ? relativeTime(current.updatedAt, current.timezone)
    : 'hace poco';
  const Subject = subject[0].toLocaleUpperCase('es-ES') + subject.slice(1);
  return (
    <div
      className="lx-conflict"
      id={id}
      role="alert"
      tabIndex={-1}
      ref={el => {
        alertRef.current = el;
      }}
    >
      <Icon name="alert" size={20} />
      <div>
        <p className="lx-conflict__title">
          {ownConflict
            ? `${Subject} ha cambiado desde otra sesión tuya`
            : `Otra persona ha cambiado ${subject}`}
        </p>
        {ownConflict ? (
          <p>
            Lo guardaste tú {when} desde otra pestaña o dispositivo. {outcome}{' '}
            para no sobrescribir aquella versión.
          </p>
        ) : (
          <p>
            {current.updatedBy?.displayName ?? 'Alguien'} lo guardó {when}.{' '}
            {outcome} para no sobrescribir los suyos.
          </p>
        )}
        <Button size="sm" variant="primary" id={loadId} onClick={onLoad}>
          Ver versión actual
        </Button>
      </div>
    </div>
  );
};

export const DiscardStrip: React.FC<{
  idPrefix: string;
  onKeep: () => void;
  onDiscard: () => void;
  /** Name of the record that opens after discarding, if not just closing. */
  leavingFor?: string | null;
}> = ({idPrefix, onKeep, onDiscard, leavingFor}) => {
  const keepRef = useRef<HTMLButtonElement>(null);
  // Asked from the middle of the form («Abrir»): bring the question to the
  // user instead of leaving it unseen in the footer.
  useEffect(() => {
    if (leavingFor) keepRef.current?.focus();
  }, [leavingFor]);
  return (
    <div
      className="lx-confirm-strip"
      role="alertdialog"
      aria-labelledby={`${idPrefix}-text`}
    >
      <p id={`${idPrefix}-text`}>
        {leavingFor ? (
          <>
            Para abrir «{leavingFor}» se descartará lo que has escrito aquí.
            ¿Descartarlo?
          </>
        ) : (
          'Tienes cambios sin guardar. ¿Descartarlos?'
        )}
      </p>
      <div className="lx-confirm-strip__actions">
        <Button ref={keepRef} onClick={onKeep} id={`${idPrefix}-keep`}>
          Seguir editando
        </Button>
        <Button variant="danger" onClick={onDiscard} id={`${idPrefix}-confirm`}>
          Descartar
        </Button>
      </div>
    </div>
  );
};

export const Provenance: React.FC<{record: Versioned; id?: string}> = ({
  record,
  id,
}) => {
  const tz = record.timezone || DEFAULT_TIMEZONE;
  const edited = record.updatedAt !== record.createdAt;
  return (
    <p className="lx-provenance" id={id}>
      Registrado por <strong>{record.createdBy.displayName}</strong> el{' '}
      <span className="lx-num">{instantShort(record.createdAt, tz)}</span>
      {edited && (
        <>
          {' '}
          · última modificación de{' '}
          <strong>{record.updatedBy.displayName}</strong>,{' '}
          {relativeTime(record.updatedAt, tz)}
        </>
      )}
    </p>
  );
};

const SOURCE_OPTIONS = (Object.keys(SOURCE_LABEL) as DataSource[]).map(v => ({
  value: v,
  label: SOURCE_LABEL[v],
  title: SOURCE_HELP[v],
}));
const VERIFICATION_OPTIONS = (
  Object.keys(VERIFICATION_LABEL) as Verification[]
).map(v => ({
  value: v,
  label: VERIFICATION_LABEL[v],
  title: VERIFICATION_HELP[v],
}));

export const QualityFields: React.FC<{
  /**
   * Names the record being edited, so the group reads as part of it:
   * «Calidad de la tarea», «Calidad del evento», «Calidad del contacto»…
   */
  title: string;
  idPrefix: string;
  source: DataSource | null;
  verification: Verification;
  onSource: (value: DataSource | null) => void;
  onVerification: (value: Verification) => void;
}> = ({title, idPrefix, source, verification, onSource, onVerification}) => (
  <div className="lx-form__group" id={`${idPrefix}-quality`}>
    <p className="lx-form__group-title" id={`${idPrefix}-quality-title`}>
      {title}
    </p>
    <Segmented<DataSource>
      name={`${idPrefix}-source`}
      id={`${idPrefix}-source`}
      legend="¿De dónde sale?"
      value={source}
      options={SOURCE_OPTIONS}
      allowNone
      onChange={onSource}
      help="Observado: lo hemos visto. Comunicado: nos lo ha dicho alguien. Documento: consta en un papel, contrato o correo."
    />
    <Segmented<Verification>
      name={`${idPrefix}-verification`}
      id={`${idPrefix}-verification`}
      legend="Verificación"
      value={verification}
      options={VERIFICATION_OPTIONS}
      onChange={v => v && onVerification(v)}
      help="Borrador: apunte rápido. Por verificar: hay que comprobarlo. Validado: comprobado con la fuente. Validar no es certificar."
    />
  </div>
);

/**
 * The notices at the top of a form: conflict, rescued values, current
 * version loaded, «Guardado» after «Guardar y seguir», form-level error.
 */
export const FormNotices: React.FC<{
  idPrefix: string;
  /** «esta persona», «esta empresa», «esta oferta». */
  subject: string;
  conflict: Versioned | null;
  conflictOn: 'save' | 'delete';
  ownConflict: boolean;
  onLoadCurrent: () => void;
  rescued: boolean;
  currentLoaded: boolean;
  saved?: React.ReactNode;
  error?: string;
  alertRef: React.RefObject<HTMLElement | null>;
  /** The merge notice after a 409 on save (`useRecordForm().merge`). */
  merge?: MergeSlot | null;
}> = ({
  idPrefix,
  subject,
  conflict,
  conflictOn,
  ownConflict,
  onLoadCurrent,
  rescued,
  currentLoaded,
  saved,
  error,
  alertRef,
  merge,
}) => (
  <>
    {merge?.({idPrefix, subject, alertRef})}
    {conflict && (
      <ConflictNotice
        id={`${idPrefix}-conflict`}
        loadId={`${idPrefix}-load-current`}
        subject={subject}
        outcome={
          conflictOn === 'delete'
            ? 'No se ha borrado'
            : 'Tus cambios no se han guardado'
        }
        current={conflict}
        ownConflict={ownConflict}
        onLoad={onLoadCurrent}
        alertRef={alertRef}
      />
    )}
    {rescued && (
      <p className="lx-notice" role="status" id={`${idPrefix}-rescued`}>
        <Icon name="refresh" size={16} />
        Hemos recuperado lo que estabas escribiendo. Revísalo y guarda.
      </p>
    )}
    {currentLoaded && (
      <p className="lx-notice" role="status" id={`${idPrefix}-current-loaded`}>
        <Icon name="refresh" size={16} />
        Estás viendo la versión actual. Vuelve a aplicar tus cambios si siguen
        haciendo falta y guarda.
      </p>
    )}
    {saved && (
      <p
        className="lx-notice lx-notice--success"
        role="status"
        id={`${idPrefix}-saved`}
      >
        <Icon name="check" size={16} />
        {saved}
      </p>
    )}
    {error && (
      <p
        className="lx-notice lx-notice--error"
        role="alert"
        id={`${idPrefix}-error`}
        tabIndex={-1}
        ref={el => {
          alertRef.current = el;
        }}
      >
        <Icon name="alert" size={16} />
        {error}
      </p>
    )}
  </>
);

/** «¿Borrar …?» in a sheet's footer, saying exactly what else changes. */
export const DeleteStrip: React.FC<{
  idPrefix: string;
  question: React.ReactNode;
  detail: React.ReactNode;
  busy: boolean;
  onKeep: () => void;
  onDelete: () => void;
}> = ({idPrefix, question, detail, busy, onKeep, onDelete}) => (
  <div
    className="lx-confirm-strip"
    role="alertdialog"
    aria-labelledby={`${idPrefix}-delete-text`}
    aria-describedby={`${idPrefix}-delete-detail`}
  >
    <div>
      <p id={`${idPrefix}-delete-text`}>{question}</p>
      <p className="lx-confirm-strip__detail" id={`${idPrefix}-delete-detail`}>
        {detail}
      </p>
    </div>
    <div className="lx-confirm-strip__actions">
      <Button onClick={onKeep} id={`${idPrefix}-delete-keep`}>
        Cancelar
      </Button>
      <Button
        variant="danger"
        icon="trash"
        busy={busy}
        onClick={onDelete}
        id={`${idPrefix}-delete-confirm`}
      >
        {busy ? 'Borrando…' : 'Borrar'}
      </Button>
    </div>
  </div>
);

/** Read-only notice at the top of a guest's detail view. */
export const ReadOnlyNotice: React.FC = () => (
  <p className="lx-notice lx-notice--quiet">
    <Icon name="lock" size={16} />
    Estás en modo solo lectura: puedes consultar, pero no cambiar.
  </p>
);
