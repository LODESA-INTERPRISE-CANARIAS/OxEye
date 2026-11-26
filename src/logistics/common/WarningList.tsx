/**
 * Plan warnings from `shared/logistics/conflicts.ts`: conflicts first (two
 * things cannot both happen as planned), then reminders (check it in the
 * simulator). They are calculations to support decisions, not certainties.
 */
import React from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {Icon, type IconName} from '../ui';

export const WARNINGS_HELP =
  'Avisos calculados a partir del plan: dos tareas en el mismo lugar a la vez, una empresa en dos sitios, el mismo recurso en dos tareas a la vez, una tarea que cuenta con material dañado o en reparación, una tarea que empieza antes de que termine aquella de la que depende, cargas pesadas que piden revisar el subsuelo y vehículos que se mueven durante el evento. Son una ayuda para revisar; no certifican nada.';

const ICON: Record<PlanWarning['kind'], IconName> = {
  venue_overlap: 'alert',
  company_overlap: 'alert',
  resource_overlap: 'inventory',
  resource_unavailable: 'alert',
  dependency_order: 'link',
  heavy_load: 'weight',
  heavy_load_unknown: 'weight',
  route_window: 'transport',
};

/** Short Spanish summary: «2 conflictos y 1 recordatorio». */
export function warningsSummary(warnings: PlanWarning[]): string {
  const c = warnings.filter(w => w.severity === 'conflict').length;
  const r = warnings.length - c;
  const parts = [
    c ? `${c} ${c === 1 ? 'conflicto' : 'conflictos'}` : '',
    r ? `${r} ${r === 1 ? 'recordatorio' : 'recordatorios'}` : '',
  ].filter(Boolean);
  return parts.join(' y ') || 'sin avisos';
}

export const WarningList: React.FC<{
  warnings: PlanWarning[];
  /** When given, each warning links to the first task it involves. */
  tasksById?: Map<string, Task>;
  onOpenTask?: (task: Task) => void;
  /** Task the list is about (its own sheet): link to the other one instead. */
  selfId?: string;
  id?: string;
}> = ({warnings, tasksById, onOpenTask, selfId, id}) => (
  <ul className="lx-warnings" id={id}>
    {warnings.map(w => {
      const targetId = w.taskIds.find(t => t !== selfId) ?? w.taskIds[0];
      const target =
        onOpenTask && targetId !== selfId
          ? tasksById?.get(targetId)
          : undefined;
      const body = (
        <>
          <span className="lx-warning__icon" aria-hidden="true">
            <Icon name={ICON[w.kind]} size={18} />
          </span>
          <span className="lx-warning__text">
            <span className="lx-warning__kind">
              {w.severity === 'conflict' ? 'Conflicto' : 'Recordatorio'}
            </span>
            <strong>{w.title}</strong>
            <span>{w.detail}</span>
          </span>
          {target && <Icon name="chevronRight" size={18} />}
        </>
      );
      return (
        <li
          key={w.key}
          className={`lx-warning lx-warning--${w.severity}`}
          data-warning={w.kind}
        >
          {target ? (
            <button
              type="button"
              className="lx-warning__row"
              onClick={() => onOpenTask!(target)}
              aria-label={`${w.severity === 'conflict' ? 'Conflicto' : 'Recordatorio'}: ${w.title}. ${w.detail} Abrir «${target.title}».`}
            >
              {body}
            </button>
          ) : (
            <div className="lx-warning__row">{body}</div>
          )}
        </li>
      );
    })}
  </ul>
);
