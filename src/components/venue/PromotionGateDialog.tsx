import React, {useEffect, useRef} from 'react';
import type {LayoutReview} from '../../engine/workspace/promotion-review';
import {
  GATE_CATEGORY_LABELS,
  GATE_CATEGORY_ORDER,
  REVIEW_DISCLAIMER,
} from './venueLabels';

/** What was attempted when the gate was evaluated. */
export type GateAction = 'proposal' | 'current' | 'review';

export interface GateOutcome {
  action: GateAction;
  layoutName: string;
  review: LayoutReview;
}

export interface PromotionGateDialogProps {
  outcome: GateOutcome | null;
  onClose: () => void;
}

const gateTitle = (action: GateAction, name: string): string =>
  action === 'proposal'
    ? `No se puede proponer «${name}»`
    : action === 'current'
      ? `No se puede confirmar «${name}» como vigente`
      : `«${name}» sigue pendiente de revisión con el recinto actual`;

/**
 * Result of a blocked promotion or review (`#gate-dialog`, OX-04 D9): each
 * blocking cause grouped by category, plus other critical issues that do not
 * block the promotion. The check is an indicative review, not a certification.
 */
export const PromotionGateDialog: React.FC<PromotionGateDialogProps> = ({outcome, onClose}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const open = !!outcome;

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  const gate = outcome?.review.gate;

  return (
    <dialog id="gate-dialog" ref={dlgRef} onClose={() => open && onClose()}>
      {outcome && gate && (
        <div id="gate-body">
          <h2>{gateTitle(outcome.action, outcome.layoutName)}</h2>
          <p className="venue-notice" role="note">
            {REVIEW_DISCLAIMER} Corrige estas causas y vuelve a intentarlo; el
            borrador se puede seguir guardando.
          </p>
          {GATE_CATEGORY_ORDER.map((category) => {
            const causes = gate.causes.filter((c) => c.category === category);
            if (!causes.length) return null;
            return (
              <section key={category} className="gate-group" data-gate-category={category}>
                <h3>{GATE_CATEGORY_LABELS[category]}</h3>
                <ul>
                  {causes.map((c) => (
                    <li key={c.issueId} data-issue-id={c.issueId}>
                      <b>{c.title}</b>
                      <span>{c.action}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {gate.otherCritical.length > 0 && (
            <section className="gate-group gate-other" data-gate-category="other">
              <h3>Otros bloqueos críticos (no impiden confirmar)</h3>
              <ul>
                {gate.otherCritical.map((i) => (
                  <li key={i.id} data-issue-id={i.id}>
                    <b>{i.title}</b>
                    <span>{i.action}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <form method="dialog">
        <button type="submit" id="gate-close">
          Cerrar
        </button>
      </form>
    </dialog>
  );
};
