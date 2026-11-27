/**
 * One plan warning as a row (icon, «Conflicto» / «Recordatorio», title,
 * detail), optionally a button that opens a task. Shared by `WarningList`
 * and the move preview, which lists warnings without exits.
 */
import React from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {Icon, type IconName} from '../ui';

export const WARNING_ICON: Record<PlanWarning['kind'], IconName> = {
  venue_overlap: 'alert',
  company_overlap: 'alert',
  resource_overlap: 'inventory',
  resource_unavailable: 'alert',
  dependency_order: 'link',
  heavy_load: 'weight',
  heavy_load_unknown: 'weight',
  route_window: 'transport',
};

export const severityLabel = (w: Pick<PlanWarning, 'severity'>) =>
  w.severity === 'conflict' ? 'Conflicto' : 'Recordatorio';

/** The row itself: a button when `target` and `onOpen` are given. */
export const WarningRow: React.FC<{
  warning: PlanWarning;
  target?: Task;
  onOpen?: (task: Task) => void;
  /** Replaces «Conflicto» (e.g. «Aceptado»). */
  kindLabel?: string;
}> = ({warning: w, target, onOpen, kindLabel}) => {
  const kind = kindLabel ?? severityLabel(w);
  const body = (
    <>
      <span className="lx-warning__icon" aria-hidden="true">
        <Icon name={WARNING_ICON[w.kind]} size={18} />
      </span>
      <span className="lx-warning__text">
        <span className="lx-warning__kind">{kind}</span>
        <strong>{w.title}</strong>
        <span>{w.detail}</span>
      </span>
      {target && onOpen && <Icon name="chevronRight" size={18} />}
    </>
  );
  return target && onOpen ? (
    <button
      type="button"
      className="lx-warning__row"
      onClick={() => onOpen(target)}
      aria-label={`${kind}: ${w.title}. ${w.detail} Abrir «${target.title}».`}
    >
      {body}
    </button>
  ) : (
    <div className="lx-warning__row">{body}</div>
  );
};

/** A plain list of warnings, no links and no exits (previews). */
export const WarningItems: React.FC<{warnings: PlanWarning[]; id?: string}> = ({
  warnings,
  id,
}) => (
  <ul className="lx-warnings" id={id}>
    {warnings.map(w => (
      <li
        key={w.key}
        className={`lx-warning lx-warning--${w.severity}`}
        data-warning={w.kind}
      >
        <WarningRow warning={w} />
      </li>
    ))}
  </ul>
);
