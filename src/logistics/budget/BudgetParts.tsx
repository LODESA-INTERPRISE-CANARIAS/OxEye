/**
 * Pieces of the budget (Revisión 1 · E5) shared by the event sheet's card
 * and the budget sheet: the ribbon (confirmed solid, planned outlined, the
 * rest of the budget as a track, any excess beyond a marked budget line),
 * its legend, and one expense row.
 *
 * The ribbon follows OxEye's certainty grammar: confirmed = solid fill,
 * planned = outlined and hatched. Every figure with tax reads «≈» and
 * «estimación».
 */
import React from 'react';
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import type {
  BudgetSummary,
  Expense,
} from '../../../shared/logistics/contracts.ts';
import {
  EXPENSE_STATUS_LABEL,
  TAX_ESTIMATE_LABEL,
} from '../../../shared/logistics/rules.ts';
import {Chip, Icon, Pending} from '../ui';
import {
  expenseEstimate,
  ribbonOf,
  snapshotText,
  type Headline,
} from './summary';
import {TaxTag} from './TaxParts';

export const BudgetRibbon: React.FC<{
  summary: BudgetSummary;
  id?: string;
  /** Thinner, for the card in the event sheet. */
  compact?: boolean;
}> = ({summary, id, compact}) => {
  const r = ribbonOf(summary);
  const label = [
    `Confirmado ≈ ${formatEuros(summary.confirmed.withTax)}`,
    `previsto ≈ ${formatEuros(summary.planned.withTax)}`,
    summary.amount !== null
      ? `de un presupuesto de ${formatEuros(summary.amount)}`
      : 'sin presupuesto fijado',
    TAX_ESTIMATE_LABEL,
  ].join(', ');
  return (
    <div
      className={`lx-ribbon${compact ? ' lx-ribbon--compact' : ''}${
        r.over ? ' is-over' : ''
      }`}
      id={id}
      role="img"
      aria-label={label}
    >
      <span className="lx-ribbon__track" aria-hidden="true">
        {r.confirmed > 0 && (
          <span
            className="lx-ribbon__part lx-ribbon__part--confirmed"
            style={{width: `${r.confirmed}%`}}
          />
        )}
        {r.planned > 0 && (
          <span
            className="lx-ribbon__part lx-ribbon__part--planned"
            style={{width: `${r.planned}%`}}
          />
        )}
        {r.over > 0 && (
          <span
            className="lx-ribbon__part lx-ribbon__part--over"
            style={{width: `${r.over}%`}}
          />
        )}
      </span>
      {r.mark !== null && (
        <span
          className="lx-ribbon__mark"
          style={{left: `${r.mark}%`}}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

/** «≈ 770,40 € estimación»: a legend figure, with tax, said as an estimate. */
const LegendFigure: React.FC<{amount: number}> = ({amount}) => (
  <dd>
    ≈ {formatEuros(amount)}{' '}
    <span className="lx-ribbonlegend__est">{TAX_ESTIMATE_LABEL}</span>
  </dd>
);

/** Confirmed, planned and left (or over), each with its swatch. */
export const BudgetLegend: React.FC<{summary: BudgetSummary; id?: string}> = ({
  summary,
  id,
}) => (
  <dl className="lx-ribbonlegend lx-num" id={id}>
    <div data-part="confirmed">
      <dt>
        <span className="lx-ribbonlegend__swatch" aria-hidden="true" />
        {EXPENSE_STATUS_LABEL.confirmed}
      </dt>
      <LegendFigure amount={summary.confirmed.withTax} />
    </div>
    <div data-part="planned">
      <dt>
        <span className="lx-ribbonlegend__swatch" aria-hidden="true" />
        {EXPENSE_STATUS_LABEL.planned}
      </dt>
      <LegendFigure amount={summary.planned.withTax} />
    </div>
    {summary.remaining !== null && (
      <div data-part={summary.remaining < 0 ? 'over' : 'free'}>
        <dt>
          <span className="lx-ribbonlegend__swatch" aria-hidden="true" />
          {summary.remaining < 0 ? 'Por encima' : 'Libre'}
        </dt>
        <LegendFigure amount={Math.abs(summary.remaining)} />
      </div>
    )}
  </dl>
);

/** «Quedan ≈ 1.240 € · estimación», big, in the editorial serif. */
export const BudgetHeadline: React.FC<{
  headline: Headline;
  incomplete: boolean;
  id?: string;
}> = ({headline, incomplete, id}) => (
  <p
    className={`lx-budgethead lx-budgethead--${headline.kind}`}
    id={id}
    data-headline={headline.kind}
  >
    <span className="lx-budgethead__label">{headline.label}</span>
    {headline.amount && (
      <span className="lx-budgethead__amount lx-num">
        {headline.kind === 'none' ? '' : '≈ '}
        {headline.amount}
        {headline.kind === 'none' && (
          <span className="lx-budgethead__sub"> gastado con impuestos</span>
        )}
      </span>
    )}
    <span className="lx-budgethead__note">
      {TAX_ESTIMATE_LABEL}
      {incomplete && (
        <span className="lx-budgethead__incomplete"> · incompleta</span>
      )}
    </span>
  </p>
);

/** One expense: concept, company, amount before tax, ≈ with tax, status. */
export const ExpenseRow: React.FC<{
  expense: Expense;
  /** Opens it for editing; without it the row only reads. */
  onOpen?: (expense: Expense) => void;
  timeZone?: string;
}> = ({expense, onOpen, timeZone}) => {
  const est = expenseEstimate(expense);
  const snap = expense.snapshot
    ? snapshotText(expense.snapshot, timeZone)
    : null;
  const confirmed = expense.status === 'confirmed';
  const body = (
    <>
      <span className="lx-expense__main">
        <span className="lx-expense__concept">{expense.concept}</span>
        <span className="lx-expense__company">
          {expense.company ? (
            <>
              <Icon name="building" size={14} />
              {expense.company.name}
              {expense.company.id === null && (
                <span className="lx-muted"> · empresa eliminada</span>
              )}
            </>
          ) : (
            <span className="lx-muted">Sin empresa</span>
          )}
        </span>
        {snap && (
          <span className="lx-expense__snap" title={snap.what}>
            <Icon name="copy" size={13} />
            {snap.when}
          </span>
        )}
      </span>
      <span className="lx-expense__money lx-num">
        <span className="lx-expense__amount">
          {expense.amount === null ? (
            <Pending>Importe sin indicar</Pending>
          ) : (
            <>
              {formatEuros(expense.amount)}
              <small> sin impuestos</small>
            </>
          )}
        </span>
        {est.amount ? (
          <span className="lx-expense__estimate">
            ≈ {est.amount} · {TAX_ESTIMATE_LABEL}
          </span>
        ) : (
          expense.amount !== null && (
            <span className="lx-expense__estimate is-missing">{est.text}</span>
          )
        )}
        <span className="lx-expense__tax">
          <TaxTag tax={expense.tax} />
        </span>
      </span>
      <span className="lx-expense__status">
        <Chip size="sm" certainty={confirmed ? 'confirmed' : 'planned'}>
          {EXPENSE_STATUS_LABEL[expense.status]}
        </Chip>
      </span>
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="lx-expense"
      data-expense-id={expense.id}
      data-status={expense.status}
      onClick={() => onOpen(expense)}
    >
      {body}
      <Icon name="chevronRight" size={18} className="lx-expense__chev" />
    </button>
  ) : (
    <div
      className="lx-expense"
      data-expense-id={expense.id}
      data-status={expense.status}
    >
      {body}
    </div>
  );
};
