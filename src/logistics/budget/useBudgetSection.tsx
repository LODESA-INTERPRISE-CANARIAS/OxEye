/**
 * The event sheet's «Presupuesto» card (Revisión 1 · E5). «Abrir» opens the
 * budget sheet through `openBudget`: it has its own address
 * (`…/ficha/presupuesto/<eventId>`) and is rendered by `LogisticsApp`
 * (`BudgetRoute`), outside the event form, so its own forms never nest.
 * The card and the sheet keep their own copy of the budget and reload
 * after each other's writes (`useEventBudget`).
 */
import React from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {useAccess} from '../account/useAccess';
import {useActions} from '../common/actions';
import {BudgetCard} from './BudgetCard';
import {useEventBudget} from './useEventBudget';

export function useBudgetSection(event: LogisticsEvent | null): {
  card: React.ReactNode;
} {
  const {can, denial} = useAccess();
  const {openBudget} = useActions();
  const readable = !!event && can('budget.read');
  const budget = useEventBudget(event?.id ?? '', readable);
  if (!event) return {card: null};
  // Nothing at all for viewers who never see budgets (no request either).
  if (!readable && denial('budget.read')?.kind !== 'held') {
    return {card: null};
  }
  return {
    card: <BudgetCard budget={budget} onOpen={() => openBudget(event)} />,
  };
}
