/**
 * The day's warnings as a pill in the calendar bar: its icon and how many
 * conflicts and reminders there are, red when there is a conflict. A click
 * opens the same panel as a venue header (each row opens its task; a
 * conflict's exits go through the move preview, which outlives the panel).
 */
import React, {useCallback, useRef, useState} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import type {AcceptedWarning} from '../common/usePlan';
import {warningsSummary} from '../common/WarningList';
import {useMoveFlow} from '../moves/useMoveFlow';
import {Icon} from '../ui';
import {acceptedText} from './VenueHeader';
import {VenueWarnings} from './VenueWarnings';

export const DayWarnings: React.FC<{
  /** «Miércoles, 2 de diciembre», the panel's title. */
  dayName: string;
  warnings: PlanWarning[];
  accepted: AcceptedWarning[];
  tasksById: Map<string, Task>;
  onOpenTask: (task: Task) => void;
}> = ({dayName, warnings, accepted, tasksById, onOpenTask}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const flow = useMoveFlow();
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) ref.current?.focus();
  }, []);

  if (!warnings.length && !accepted.length) return flow.element;
  const conflicts = warnings.filter(w => w.severity === 'conflict').length;
  const reminders = warnings.length - conflicts;
  const label = [
    warnings.length ? warningsSummary(warnings) : 'Sin avisos abiertos',
    accepted.length ? acceptedText(accepted.length) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <button
        ref={ref}
        type="button"
        id="lx-day-warnings-toggle"
        className={`lx-daywarn${conflicts ? ' has-conflict' : ''}`}
        aria-expanded={open}
        aria-controls={open ? 'lx-day-warnings' : undefined}
        aria-haspopup="dialog"
        aria-label={`Avisos del día: ${label}`}
        title={`Avisos del día: ${label}`}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={conflicts ? 'alert' : 'bell'} size={16} />
        {conflicts > 0 && (
          <span className="lx-daywarn__part lx-num">
            {conflicts}
            <span className="lx-daywarn__word">
              {conflicts === 1 ? ' conflicto' : ' conflictos'}
            </span>
          </span>
        )}
        {reminders > 0 && (
          <span className="lx-daywarn__part lx-daywarn__part--soft lx-num">
            {conflicts > 0 && (
              <Icon name="bell" size={14} className="lx-daywarn__bell" />
            )}
            {reminders}
            <span className="lx-daywarn__word">
              {reminders === 1 ? ' recordatorio' : ' recordatorios'}
            </span>
          </span>
        )}
        {!warnings.length && (
          <span className="lx-daywarn__part lx-num">
            {acceptedText(accepted.length)}
          </span>
        )}
        <Icon name="chevronDown" size={14} className="lx-daywarn__chevron" />
      </button>
      {open && ref.current && (
        <VenueWarnings
          id="lx-day-warnings"
          eyebrow="Avisos del día"
          label="Avisos del día"
          name={dayName}
          warnings={warnings}
          accepted={accepted}
          anchor={ref.current}
          tasksById={tasksById}
          onOpenTask={onOpenTask}
          onMove={request => flow.open(request)}
          onClose={close}
        />
      )}
      {flow.element}
    </>
  );
};
