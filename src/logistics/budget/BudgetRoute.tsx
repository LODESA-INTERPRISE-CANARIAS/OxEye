/**
 * The budget sheet with its own address (Revisión 1 · E5):
 * `#logistica/…/ficha/presupuesto/<eventId>`, rendered by `LogisticsApp` like
 * every other record sheet so a link opens it and Back / Forward step over
 * it.
 *
 * Without `budget.read` the address opens on «Sin acceso» (or the
 * provisional-password hold) and the server is asked nothing; the server
 * refuses the data anyway.
 */
import React from 'react';
import type {LogisticsEvent} from '../../../shared/logistics/contracts.ts';
import {NoAccess} from '../account/NoAccess';
import {useAccess} from '../account/useAccess';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Sheet} from '../ui';
import {BudgetSheet} from './BudgetSheet';
import {useEventBudget} from './useEventBudget';

export const BudgetRoute: React.FC<{
  /** The event as it was when the sheet opened; the live copy wins. */
  event: LogisticsEvent;
  onClose: () => void;
}> = ({event: opened, onClose}) => {
  const live = useLogisticsStore(s => s.events.find(e => e.id === opened.id));
  const event = live ?? opened;
  const readable = useAccess().can('budget.read');
  const budget = useEventBudget(event.id, readable);

  if (!readable) {
    return (
      <Sheet
        open
        onClose={onClose}
        id="lx-budget-sheet"
        eyebrow="Presupuesto del evento"
        title={event.name}
        size="md"
        footer={
          <>
            <span className="lx-sheet__foot-spacer" />
            <Button variant="primary" onClick={onClose} id="lx-budget-close">
              Cerrar
            </Button>
          </>
        }
      >
        <NoAccess
          permission="budget.read"
          what="Presupuesto"
          id="lx-budget-noaccess"
          compact
        />
      </Sheet>
    );
  }
  return <BudgetSheet event={event} budget={budget} onClose={onClose} />;
};
