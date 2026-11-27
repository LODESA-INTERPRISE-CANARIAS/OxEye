/**
 * How a tax and an estimate with tax read on a sheet (Revisión 1 · E5).
 * The estimate always carries the word «estimación» and the tax it used;
 * a tax still «por verificar» is drawn with the pending (dotted) grammar.
 */
import React from 'react';
import type {TaxInfo} from '../../../shared/logistics/contracts.ts';
import {Icon, Pending} from '../ui';
import {taxLabel, type EstimateLine} from './tax';

/** The tax as a small tag: solid when verified, dotted while «por verificar». */
export const TaxTag: React.FC<{
  tax: TaxInfo | null;
  inherited?: boolean;
  id?: string;
}> = ({tax, inherited, id}) => {
  if (!tax) return <Pending>Impuesto sin indicar</Pending>;
  const toVerify = tax.verification === 'to_verify' && tax.regime !== 'unknown';
  return (
    <span
      id={id}
      className={`lx-taxtag${toVerify ? ' is-to-verify' : ''}`}
      data-regime={tax.regime}
    >
      {toVerify && <span className="lx-chip__dot" aria-hidden="true" />}
      <span className="lx-num">{taxLabel(tax)}</span>
      {inherited && (
        <span className="lx-taxtag__from">heredado de la empresa</span>
      )}
      {toVerify && <span className="lx-taxtag__state">por verificar</span>}
    </span>
  );
};

/** The line under a price: «≈ 128,40 € / día con impuestos · estimación». */
export const EstimateNote: React.FC<{
  line: EstimateLine | null;
  id?: string;
  compact?: boolean;
}> = ({line, id, compact}) => {
  if (!line) return null;
  return (
    <p
      id={id}
      className={`lx-estimate lx-estimate--${line.kind}${
        compact ? ' lx-estimate--compact' : ''
      }`}
      data-estimate={line.kind}
    >
      {line.kind === 'none' ? (
        <Icon name="alert" size={15} />
      ) : (
        <span className="lx-estimate__approx" aria-hidden="true">
          ≈
        </span>
      )}
      <span>
        {line.amount && (
          <strong className="lx-num lx-estimate__amount">{line.amount}</strong>
        )}{' '}
        {line.text}
        {line.tax && line.kind !== 'none' && (
          <span className="lx-estimate__tax"> · {line.tax}</span>
        )}
      </span>
    </p>
  );
};
