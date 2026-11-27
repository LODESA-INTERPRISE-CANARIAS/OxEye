/**
 * A venue's acronym and opening hours (Revisión 1 · E2), shown in its sheet
 * and edited there by members.
 *
 * The acronym names the venue's column when it is folded on the calendar; it
 * starts from a proposal («Plaza del Adelantado» → «P.A.»). The opening hours
 * are optional: unknown hours stay «Pendiente de verificar» and limit
 * nothing; known hours keep calendar moves inside them. A change saved by
 * someone else in between is never overwritten: the form shows their values.
 */
import React, {useState} from 'react';
import {
  ACRONYM_MAX,
  acronymProblem,
  proposeAcronym,
} from '../../../shared/logistics/acronym.ts';
import type {OpeningHours, Venue} from '../../../shared/logistics/contracts.ts';
import {
  OPENING_HOURS_INVALID,
  openingHoursProblem,
} from '../../../shared/logistics/move.ts';
import {errorMessage, isApiError} from '../api/client';
import {useActions} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  HelpTip,
  Icon,
  Input,
  Pending,
  TimeField,
  describedBy,
} from '../ui';

export const HOURS_HELP =
  'Horario en que el lugar está abierto para montar, entregar o desmontar, cada día, en la hora del lugar. Si se conoce, el calendario no deja mover una tarea fuera de él. Si no se conoce, queda «Pendiente de verificar» y no limita nada.';

interface Draft {
  acronym: string;
  opensAt: string;
  closesAt: string;
}

const draftOf = (venue: Venue): Draft => ({
  acronym: venue.acronym ?? proposeAcronym(venue.name, {dotted: true}) ?? '',
  opensAt: venue.openingHours?.opensAt ?? '',
  closesAt: venue.openingHours?.closesAt ?? '',
});

export const VenueDetails: React.FC<{venue: Venue}> = ({venue}) => {
  const {canWrite, timeZone} = useActions();
  const updateVenue = useLogisticsStore(s => s.updateVenue);
  const toast = useLogisticsStore(s => s.toast);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<{acronym?: string; hours?: string}>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const proposal = proposeAcronym(venue.name, {dotted: true});

  const start = () => {
    setDraft(draftOf(venue));
    setErrors({});
    setNotice(null);
  };

  const save = async () => {
    if (!draft || busy) return;
    const acronym = draft.acronym.trim();
    const next: {acronym?: string; hours?: string} = {};
    const acronymError = acronymProblem(acronym);
    if (acronymError) next.acronym = acronymError;
    let hours: OpeningHours | null = null;
    if (draft.opensAt || draft.closesAt) {
      if (!draft.opensAt || !draft.closesAt) {
        next.hours = OPENING_HOURS_INVALID;
      } else {
        hours = {opensAt: draft.opensAt, closesAt: draft.closesAt};
        const problem = openingHoursProblem(hours);
        if (problem) next.hours = problem;
      }
    }
    setErrors(next);
    if (next.acronym || next.hours) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateVenue(venue.id, {
        version: venue.version,
        // Empty means «use the proposal»: nothing stored.
        acronym: acronym || null,
        openingHours: hours,
      });
      toast(`«${venue.name}» actualizado.`, 'success');
      setDraft(null);
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        // The store already holds their version: start again from it.
        const current = useLogisticsStore
          .getState()
          .venues.find(v => v.id === venue.id);
        if (current) setDraft(draftOf(current));
        setNotice(
          'Otra persona ha cambiado este lugar mientras lo editabas: se muestran sus datos. Revisa y vuelve a guardar si hace falta.',
        );
      } else if (isApiError(err) && err.fields) {
        setErrors({
          acronym: err.fields.acronym,
          hours: err.fields.openingHours ?? err.fields.opensAt,
        });
        if (!err.fields.acronym && !err.fields.openingHours) {
          setNotice(`No se ha guardado. ${errorMessage(err)}`);
        }
      } else {
        setNotice(`No se ha guardado. ${errorMessage(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const hoursText = venue.openingHours
    ? `${venue.openingHours.opensAt}–${venue.openingHours.closesAt}`
    : null;

  return (
    <section
      className="lx-subsection lx-venue-details"
      aria-labelledby="lx-venue-details-title"
      id="lx-venue-details"
    >
      <h3 className="lx-subsection__title" id="lx-venue-details-title">
        Siglas y horario
        {canWrite && !draft && (
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            className="lx-venue-details__edit"
            onClick={start}
            id="lx-venue-edit"
          >
            Editar
          </Button>
        )}
      </h3>

      {notice && (
        <p
          className="lx-notice lx-notice--error"
          role="alert"
          id="lx-venue-notice"
        >
          <Icon name="alert" size={16} />
          {notice}
        </p>
      )}

      {!draft ? (
        <dl className="lx-detail lx-venue-details__view">
          <div>
            <dt>Siglas</dt>
            <dd id="lx-venue-acronym">
              {venue.acronym ? (
                <strong className="lx-num">{venue.acronym}</strong>
              ) : proposal ? (
                <>
                  <strong className="lx-num">{proposal}</strong>{' '}
                  <span className="lx-muted">· propuesta</span>
                </>
              ) : (
                <Pending />
              )}
            </dd>
          </div>
          <div>
            <dt>
              Horario
              <HelpTip label="horario">{HOURS_HELP}</HelpTip>
            </dt>
            <dd id="lx-venue-hours">
              {hoursText ? (
                <span className="lx-num">{hoursText}</span>
              ) : (
                <Pending />
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <form
          className="lx-venue-details__form"
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <Field
            id="lx-venue-acronym-input"
            label="Siglas"
            optional
            error={errors.acronym}
            hint={`Se ven cuando la columna del lugar está contraída en el calendario.${proposal ? ` Propuesta: ${proposal}` : ''}`}
          >
            <Input
              id="lx-venue-acronym-input"
              value={draft.acronym}
              maxLength={ACRONYM_MAX + 4}
              autoComplete="off"
              spellCheck={false}
              invalid={!!errors.acronym}
              aria-describedby={describedBy('lx-venue-acronym-input', {
                hint: !errors.acronym,
                error: errors.acronym,
              })}
              onChange={e => {
                setDraft({...draft, acronym: e.target.value});
                if (errors.acronym) setErrors({...errors, acronym: undefined});
              }}
            />
          </Field>
          <fieldset
            className="lx-venue-details__hours"
            id="lx-venue-hours-fields"
          >
            <legend className="lx-field__label">
              Horario <span className="lx-field__optional"> · opcional</span>
              <HelpTip label="horario">{HOURS_HELP}</HelpTip>
            </legend>
            <div className="lx-venue-details__times">
              <Field id="lx-venue-opens" label="Abre">
                <TimeField
                  id="lx-venue-opens"
                  value={draft.opensAt}
                  timeZone={timeZone}
                  invalid={!!errors.hours}
                  aria-describedby={
                    errors.hours
                      ? 'lx-venue-hours-error'
                      : 'lx-venue-hours-hint'
                  }
                  onChange={v => {
                    setDraft({...draft, opensAt: v});
                    if (errors.hours) setErrors({...errors, hours: undefined});
                  }}
                />
              </Field>
              <Field id="lx-venue-closes" label="Cierra">
                <TimeField
                  id="lx-venue-closes"
                  value={draft.closesAt}
                  timeZone={timeZone}
                  invalid={!!errors.hours}
                  aria-describedby={
                    errors.hours
                      ? 'lx-venue-hours-error'
                      : 'lx-venue-hours-hint'
                  }
                  onChange={v => {
                    setDraft({...draft, closesAt: v});
                    if (errors.hours) setErrors({...errors, hours: undefined});
                  }}
                />
              </Field>
            </div>
            {errors.hours ? (
              <p
                className="lx-field__error"
                id="lx-venue-hours-error"
                role="alert"
              >
                {errors.hours}
              </p>
            ) : (
              <p className="lx-field__hint" id="lx-venue-hours-hint">
                Déjalo vacío si no se sabe: quedará «Pendiente de verificar».
              </p>
            )}
          </fieldset>
          <div className="lx-venue-details__actions">
            {(draft.opensAt || draft.closesAt) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft({...draft, opensAt: '', closesAt: ''});
                  setErrors({...errors, hours: undefined});
                }}
                id="lx-venue-hours-clear"
              >
                Quitar el horario
              </Button>
            )}
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setErrors({});
                setNotice(null);
              }}
              disabled={busy}
              id="lx-venue-cancel"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="check"
              busy={busy}
              id="lx-venue-save"
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
};
