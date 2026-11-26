/**
 * «Subsuelo revisado en el simulador»: a mark a member declares on a task
 * with heavy load once they reviewed the subsoil in OxEye's simulator. It is
 * a declaration, never a verdict: OxEye does not check it, it carries no
 * figure and it is withdrawn when the venue, the heavy load or the resources
 * change (the server clears it).
 */
import React from 'react';
import type {SubsoilReview} from '../../../shared/logistics/contracts.ts';
import {
  SUBSOIL_REVIEW_LABEL,
  SUBSOIL_REVIEW_NOTE,
} from '../../../shared/logistics/rules.ts';
import {instantShort} from '../lib/format';
import {HelpTip, Icon} from '../ui';

/** «Declarado por Elvis Demo · 2 dic, 10:32». */
export function declaredText(review: SubsoilReview, timeZone: string): string {
  return `Declarado por ${review.by.displayName} · ${instantShort(review.at, timeZone)}`;
}

/** Read-only, for guests and the task view. */
export const SubsoilReviewValue: React.FC<{
  review: SubsoilReview | null;
  timeZone: string;
}> = ({review, timeZone}) =>
  review ? (
    <span className="lx-subsoil__value" id="lx-task-subsoil-value">
      <span className="lx-subsoil__mark">
        <Icon name="check" size={14} />
        {SUBSOIL_REVIEW_LABEL}
      </span>
      <span className="lx-muted lx-num">{declaredText(review, timeZone)}</span>
    </span>
  ) : (
    <span className="lx-pending" id="lx-task-subsoil-value">
      <span className="lx-chip__dot" aria-hidden="true" />
      Nadie ha declarado la revisión del subsuelo en el simulador
    </span>
  );

/** The checkbox in the task form, shown only when «Carga pesada: Sí». */
export const SubsoilReviewField: React.FC<{
  /** The mark as saved on the task, if any. */
  saved: SubsoilReview | null;
  checked: boolean;
  /** Venue, heavy load or resources changed: saving withdraws the mark. */
  stale: boolean;
  timeZone: string;
  onChange: (checked: boolean) => void;
}> = ({saved, checked, stale, timeZone, onChange}) => {
  const state = stale
    ? checked
      ? 'Se volverá a declarar a tu nombre al guardar, para el lugar, la carga y los recursos nuevos.'
      : 'Has cambiado el lugar, la carga pesada o los recursos: al guardar se retirará la marca. Vuelve a marcarla solo si ya revisaste el plan nuevo en el simulador.'
    : saved
      ? checked
        ? declaredText(saved, timeZone)
        : 'Al guardar se retirará la marca.'
      : checked
        ? 'Se declarará a tu nombre al guardar.'
        : 'Márcalo cuando hayas revisado el subsuelo en el simulador.';
  return (
    <div
      className={`lx-subsoil${stale ? ' is-stale' : ''}`}
      id="lx-task-subsoil"
    >
      <div className="lx-subsoil__row">
        <span className="lx-check">
          <input
            type="checkbox"
            id="lx-task-subsoil-reviewed"
            checked={checked}
            aria-describedby="lx-task-subsoil-state"
            onChange={e => onChange(e.target.checked)}
          />
          <label htmlFor="lx-task-subsoil-reviewed">
            {SUBSOIL_REVIEW_LABEL}
          </label>
        </span>
        <HelpTip label="subsuelo revisado">{SUBSOIL_REVIEW_NOTE}</HelpTip>
      </div>
      <p
        className={`lx-form__note lx-subsoil__state${stale && !checked ? ' is-warning' : ''}`}
        id="lx-task-subsoil-state"
        role="status"
      >
        {stale && !checked && <Icon name="alert" size={14} />}
        <span className="lx-num">{state}</span>
      </p>
    </div>
  );
};
