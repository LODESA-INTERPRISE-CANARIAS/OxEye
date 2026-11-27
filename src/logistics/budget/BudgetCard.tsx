/**
 * «Presupuesto» section of the event sheet (Revisión 1 · E5): the budget at
 * a glance (what is left, the ribbon) and the way into the budget sheet.
 * Rendered only for viewers with `budget.read`; a provisional password that
 * holds it back gets a one-line hint instead.
 */
import React, {useMemo} from 'react';
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import {budgetSummary} from '../../../shared/logistics/money.ts';
import {TAX_ESTIMATE_LABEL} from '../../../shared/logistics/rules.ts';
import {useAccess} from '../account/useAccess';
import {Button, Icon, Pending, Spinner} from '../ui';
import {BudgetRibbon} from './BudgetParts';
import {countText, headlineOf} from './summary';
import type {EventBudgetState} from './useEventBudget';

export const BudgetCard: React.FC<{
  budget: EventBudgetState;
  onOpen: () => void;
}> = ({budget, onOpen}) => {
  const {can, denial} = useAccess();
  const {load} = budget;
  const data = load.data;
  const summary = useMemo(
    () => (data ? budgetSummary(data.budget, data.expenses) : null),
    [data],
  );
  if (!can('budget.read')) {
    const d = denial('budget.read');
    // Nothing for those who never see budgets; a hint when only the
    // provisional password stands in the way.
    return d?.kind === 'held' ? (
      <p className="lx-notice lx-notice--quiet" id="lx-event-budget-held">
        <Icon name="lock" size={16} />
        {d.message}
      </p>
    ) : null;
  }

  let line: React.ReactNode;
  if (summary) {
    const h = headlineOf(summary);
    line = (
      <>
        <span className="lx-budgetcard__figure lx-num">
          {summary.amount === null ? (
            <Pending>Sin presupuesto fijado</Pending>
          ) : (
            <>
              <strong>
                {h.kind === 'left'
                  ? `Quedan ≈ ${h.amount}`
                  : h.kind === 'over'
                    ? `≈ ${h.amount} por encima`
                    : 'Justo en el presupuesto'}
              </strong>{' '}
              de {formatEuros(summary.amount)}
            </>
          )}
        </span>
        <span className="lx-budgetcard__meta lx-num">
          {countText(summary)}
          {summary.total.count > 0 &&
            ` · ≈ ${formatEuros(summary.total.withTax)} con impuestos`}
          {` · ${TAX_ESTIMATE_LABEL}`}
          {summary.incomplete && ' incompleta'}
        </span>
      </>
    );
  } else if (load.status === 'offline') {
    line = (
      <span className="lx-budgetcard__meta">
        <Icon name="cloudOff" size={14} /> Necesita conexión
      </span>
    );
  } else if (load.status === 'error' || load.status === 'forbidden') {
    line = <span className="lx-budgetcard__meta">{load.message}</span>;
  } else {
    line = <Spinner label="Cargando el presupuesto" />;
  }

  return (
    <section
      className={`lx-budgetcard${
        summary?.remaining !== null && (summary?.remaining ?? 0) < 0
          ? ' is-over'
          : ''
      }`}
      aria-labelledby="lx-event-budget-title"
      id="lx-event-budget"
    >
      <div className="lx-budgetcard__head">
        <span className="lx-budgetcard__icon" aria-hidden="true">
          <Icon name="budget" size={20} />
        </span>
        <div className="lx-budgetcard__text">
          <h3 className="lx-budgetcard__title" id="lx-event-budget-title">
            Presupuesto
          </h3>
          {line}
        </div>
        <Button
          size="sm"
          id="lx-event-budget-open"
          onClick={onOpen}
          aria-describedby="lx-event-budget-title"
        >
          Abrir
        </Button>
      </div>
      {summary && summary.total.count > 0 && (
        <BudgetRibbon summary={summary} compact id="lx-event-budget-ribbon" />
      )}
    </section>
  );
};
