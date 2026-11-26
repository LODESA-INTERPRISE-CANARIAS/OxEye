/**
 * The notice after a save hit a newer version (409) and the form was merged
 * (`forms/merge.ts`): who saved, what was taken from their copy, that the
 * user's own changes are kept, and one choice per field both people changed
 * («Usar el mío» / «Usar el suyo», mine by default). Nothing is saved until
 * the user presses «Guardar» again; «Descartar mis cambios» shows the current
 * version instead.
 *
 * Keeps the ids and classes of the old conflict notice (`{prefix}-conflict`,
 * `.lx-conflict`, `{prefix}-load-current`).
 */
import React from 'react';
import type {RecordMeta} from '../../../shared/logistics/contracts.ts';
import {relativeTime} from '../lib/format';
import {Button, Icon} from '../ui';
import {
  clashChoice,
  fieldList,
  mergeFieldLabel,
  mergeValueText,
  type FormMerge,
  type MergeClash,
} from './merge';

type Versioned = Pick<RecordMeta, 'updatedBy' | 'updatedAt'> & {
  timezone?: string;
};

/** What a form keeps after merging: the notice's content. */
export interface MergeState<V> extends Omit<FormMerge<V>, 'merged'> {
  /** The server copy the form now builds on. */
  current: Versioned;
  /** Saved by the same user in another tab or device. */
  own: boolean;
  /** One extra line the form needs said (e.g. the subsoil mark was reset). */
  note?: string | null;
}

export type MergeDescribe<V> = (
  key: string,
  values: Partial<V>,
) => string | null | undefined;

/** Applies one side of a clash to the form values. */
export function chooseSide<V extends object>(
  values: V,
  clash: MergeClash<V>,
  side: 'mine' | 'theirs',
): V {
  return {...values, ...(side === 'mine' ? clash.mine : clash.theirs)};
}

export function MergeNotice<V extends object>({
  idPrefix,
  subject,
  merge,
  values,
  onChoose,
  onDiscardMine,
  describe,
  alertRef,
}: {
  idPrefix: string;
  /** «esta tarea», «esta persona». */
  subject: string;
  merge: MergeState<V>;
  values: V;
  onChoose: (clash: MergeClash<V>, side: 'mine' | 'theirs') => void;
  onDiscardMine: () => void;
  describe?: MergeDescribe<V>;
  alertRef: React.RefObject<HTMLElement | null>;
}) {
  const {current, own, clashes, fromTheirs} = merge;
  const when = current.updatedAt
    ? relativeTime(current.updatedAt, current.timezone)
    : 'hace poco';
  const Subject = subject[0].toLocaleUpperCase('es-ES') + subject.slice(1);
  const who = own ? 'tu otra sesión' : 'su versión';
  return (
    <div
      className="lx-conflict lx-merge"
      id={`${idPrefix}-conflict`}
      role="alert"
      tabIndex={-1}
      ref={el => {
        alertRef.current = el;
      }}
    >
      <Icon name="alert" size={20} />
      <div className="lx-merge__body">
        <p className="lx-conflict__title">
          {own
            ? `${Subject} ha cambiado desde otra sesión tuya`
            : `Otra persona ha cambiado ${subject}`}
        </p>
        <p>
          {own
            ? `Lo guardaste tú ${when} desde otra pestaña o dispositivo.`
            : `${current.updatedBy?.displayName ?? 'Alguien'} lo guardó ${when}, mientras editabas.`}{' '}
          Aún no se ha guardado nada: hemos juntado las dos versiones.
        </p>
        <ul className="lx-merge__facts">
          {fromTheirs.length > 0 && (
            <li id={`${idPrefix}-merge-theirs`}>
              <Icon name="refresh" size={14} />
              <span>
                De {who} se toma: <strong>{fieldList(fromTheirs)}</strong>.
              </span>
            </li>
          )}
          <li id={`${idPrefix}-merge-mine`}>
            <Icon name="check" size={14} />
            <span>Lo que tú has cambiado se mantiene.</span>
          </li>
          {merge.note && (
            <li id={`${idPrefix}-merge-note`} className="lx-merge__note">
              <Icon name="alert" size={14} />
              <span>{merge.note}</span>
            </li>
          )}
        </ul>

        {clashes.length > 0 && (
          <div className="lx-merge__clashes" id={`${idPrefix}-merge-clashes`}>
            <p className="lx-merge__ask">
              {clashes.length === 1
                ? 'Este dato lo habéis cambiado los dos: elige cuál se queda.'
                : 'Estos datos los habéis cambiado los dos: elige cuál se queda en cada uno.'}
            </p>
            {clashes.map(clash => {
              const choice = clashChoice(values, clash);
              const name = `${idPrefix}-clash-${clash.key}`;
              const mineText = mergeValueText(clash.key, clash.mine, describe);
              const theirsText = mergeValueText(
                clash.key,
                clash.theirs,
                describe,
              );
              return (
                <fieldset className="lx-merge__clash" id={name} key={clash.key}>
                  <legend>{mergeFieldLabel(clash.key)}</legend>
                  <div className="lx-merge__options">
                    <span className="lx-merge__option">
                      <input
                        type="radio"
                        name={name}
                        id={`${name}-mine`}
                        checked={choice === 'mine'}
                        onChange={() => onChoose(clash, 'mine')}
                      />
                      <label htmlFor={`${name}-mine`}>
                        <span className="lx-merge__side">Usar el mío</span>
                        <span className="lx-merge__value">
                          {mineText ?? 'tu selección'}
                        </span>
                      </label>
                    </span>
                    <span className="lx-merge__option">
                      <input
                        type="radio"
                        name={name}
                        id={`${name}-theirs`}
                        checked={choice === 'theirs'}
                        onChange={() => onChoose(clash, 'theirs')}
                      />
                      <label htmlFor={`${name}-theirs`}>
                        <span className="lx-merge__side">
                          {own ? 'Usar el de la otra sesión' : 'Usar el suyo'}
                        </span>
                        <span className="lx-merge__value">
                          {theirsText ?? (own ? 'la otra' : 'la suya')}
                        </span>
                      </label>
                    </span>
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}

        <div className="lx-merge__foot">
          <p className="lx-merge__next">
            Revisa el formulario y pulsa «Guardar».
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            id={`${idPrefix}-load-current`}
            onClick={onDiscardMine}
          >
            Descartar mis cambios
          </Button>
        </div>
      </div>
    </div>
  );
}
