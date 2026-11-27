/**
 * The tax picker (Revisión 1 · E5), shared by companies, offers and
 * expenses: a regime from a list (IGIC, IVA, Otro, Ninguno, Sin saber), the
 * percentage prefilled for IGIC / IVA and editable, a name for «Otro», and
 * «Por verificar / Verificado». The first option is «nothing said» for a
 * company and «como la empresa» for an offer.
 */
import React from 'react';
import type {TaxInfo, TaxRegime} from '../../../shared/logistics/contracts.ts';
import {TAX_NAME_MAX} from '../../../shared/logistics/rules.ts';
import {
  Field,
  HelpTip,
  Input,
  Segmented,
  SelectField,
  describedBy,
} from '../ui';
import {
  pickRegime,
  TAX_HELP,
  TAX_REGIME_LABEL,
  TAX_REGIMES,
  taxLabel,
  type TaxDraft,
} from './tax';

const REGIME_HINT: Record<TaxRegime, string> = {
  igic: 'Canarias',
  iva: 'Península y Baleares',
  other: 'Escribe cuál',
  none: 'No cobra impuesto',
  unknown: 'Aún no se sabe',
};

export interface TaxFieldProps {
  /** Id prefix: `${id}` is the regime picker, `${id}-rate`, `${id}-name`. */
  id: string;
  legend: string;
  value: TaxDraft;
  onChange: (draft: TaxDraft) => void;
  /** Label of the first option ('' regime). */
  emptyLabel: string;
  /** Second line of the first option («IGIC 7 %» for «Como la empresa»). */
  emptyHint?: string;
  error?: {field: 'name' | 'rate' | 'regime'; message: string} | null;
  disabled?: boolean;
}

export const TaxField: React.FC<TaxFieldProps> = ({
  id,
  legend,
  value,
  onChange,
  emptyLabel,
  emptyHint,
  error,
  disabled,
}) => {
  const regime = value.regime;
  const hasRate = regime === 'igic' || regime === 'iva' || regime === 'other';
  const err = (field: 'name' | 'rate' | 'regime') =>
    error?.field === field ? error.message : undefined;
  // The note under an empty rate; the input only points at it while shown.
  const rateNote = hasRate && !value.rate.trim() && !err('rate');
  return (
    <fieldset className="lx-taxfield" id={`${id}-group`} disabled={disabled}>
      <legend className="lx-field__label lx-taxfield__legend">
        {legend}
        <span className="lx-field__optional"> · opcional</span>
        <HelpTip label="impuestos">{TAX_HELP}</HelpTip>
      </legend>
      <div className="lx-taxfield__row">
        <Field
          id={id}
          label="Impuesto"
          error={err('regime')}
          className="lx-taxfield__regime"
        >
          <SelectField
            id={id}
            value={regime}
            invalid={!!err('regime')}
            aria-describedby={describedBy(id, {error: err('regime')})}
            options={[
              {value: '', label: emptyLabel, hint: emptyHint},
              ...TAX_REGIMES.map(r => ({
                value: r,
                label: TAX_REGIME_LABEL[r],
                hint: REGIME_HINT[r],
              })),
            ]}
            onChange={v => onChange(pickRegime(value, v as TaxRegime | ''))}
          />
        </Field>
        {regime === 'other' && (
          <Field
            id={`${id}-name`}
            label="Nombre del impuesto"
            error={err('name')}
            className="lx-taxfield__name"
          >
            <Input
              id={`${id}-name`}
              value={value.name}
              maxLength={TAX_NAME_MAX + 10}
              invalid={!!err('name')}
              aria-describedby={describedBy(`${id}-name`, {error: err('name')})}
              placeholder="IPSI"
              autoComplete="off"
              onChange={e => onChange({...value, name: e.target.value})}
            />
          </Field>
        )}
        {hasRate && (
          <Field
            id={`${id}-rate`}
            label="Porcentaje"
            error={err('rate')}
            className="lx-taxfield__rate"
          >
            <span className="lx-money lx-money--rate">
              <Input
                id={`${id}-rate`}
                inputMode="decimal"
                className="lx-num"
                value={value.rate}
                invalid={!!err('rate')}
                aria-describedby={
                  describedBy(`${id}-rate`, {error: err('rate')}) ??
                  (rateNote ? `${id}-rate-note` : undefined)
                }
                placeholder="Sin saber"
                autoComplete="off"
                onChange={e => onChange({...value, rate: e.target.value})}
              />
              <span className="lx-money__unit" aria-hidden="true">
                %
              </span>
            </span>
          </Field>
        )}
        {regime === 'none' && <p className="lx-taxfield__fixed lx-num">0 %</p>}
      </div>
      {rateNote && (
        <p className="lx-field__hint" id={`${id}-rate-note`}>
          Sin porcentaje no se calcula la estimación con impuestos.
        </p>
      )}
      {regime === 'unknown' && (
        <p className="lx-field__hint">
          Queda «sin saber»: no se estima con impuestos hasta que se indique.
        </p>
      )}
      {regime !== '' && regime !== 'unknown' && (
        <Segmented<'to_verify' | 'validated'>
          name={`${id}-verification`}
          id={`${id}-verification`}
          legend="¿Confirmado?"
          value={value.verified ? 'validated' : 'to_verify'}
          options={[
            {value: 'to_verify', label: 'Por verificar'},
            {value: 'validated', label: 'Verificado'},
          ]}
          onChange={v => onChange({...value, verified: v === 'validated'})}
          help="Por verificar: es lo que creemos o lo propuesto por defecto. Verificado: la empresa lo ha confirmado."
        />
      )}
    </fieldset>
  );
};

/** «Como la empresa» hint: the company's tax, or that it has none recorded. */
export function inheritHint(companyTax: TaxInfo | null): string {
  return companyTax
    ? `Ahora: ${taxLabel(companyTax)}`
    : 'La empresa no tiene impuesto indicado';
}
