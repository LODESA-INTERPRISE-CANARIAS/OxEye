/**
 * One task as an actionable row: time window, kind, title, venue, company,
 * contact person, status and warnings. Opens the task sheet. Used by «Hoy», the event sheet
 * and the calendar's list by hour.
 */
import React from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {missingForTask} from '../../../shared/logistics/quality.ts';
import {dayMonthShort} from '../lib/format';
import {UnsentMark, unsentSuffix, useUnsent} from '../offline/PendingMark';
import {
  recordSlot,
  TASK_KIND_ICON,
  TASK_KIND_LABEL,
  TASK_STATUS_LABEL,
} from '../lib/tasks';
import {Icon} from '../ui';
import {TaskStatusChip} from './TaskChips';
import {TimeWindow, windowText} from './TimeWindow';
import {warningsSummary} from './WarningList';

/** Full accessible name: title, kind, time, venue, status, warnings. */
export function taskLabel(
  task: Task,
  warnings: PlanWarning[] = [],
  opts: {date?: boolean} = {},
): string {
  const {date} = recordSlot(task);
  const parts = [
    task.title,
    TASK_KIND_LABEL[task.kind].toLocaleLowerCase('es-ES'),
    opts.date && date ? dayMonthShort(date) : '',
    windowText(task),
    task.venue ? task.venue.name : 'lugar pendiente de verificar',
    task.company ? task.company.name : '',
    task.contact ? `contacto ${task.contact.name}` : '',
    TASK_STATUS_LABEL[task.status].toLocaleLowerCase('es-ES'),
    warnings.length ? warningsSummary(warnings) : '',
  ];
  return parts.filter(Boolean).join(', ');
}

export type RowEmphasis = 'late' | 'now' | 'next' | 'past';

const EMPHASIS_LABEL: Record<RowEmphasis, string> = {
  late: 'Va tarde',
  now: 'Ahora',
  next: 'Siguiente',
  past: 'Ya pasó',
};

/** «Va tarde, +20 min: », «Debería empezar: », «Ahora: ». */
function emphasisPrefix(emphasis?: RowEmphasis, flag?: string | null): string {
  if (!emphasis || emphasis === 'past') return '';
  if (emphasis === 'late') {
    return flag
      ? `Va tarde, ${flag.toLocaleLowerCase('es-ES')}: `
      : 'Va tarde: ';
  }
  return `${flag ?? EMPHASIS_LABEL[emphasis]}: `;
}

export const TaskRow: React.FC<{
  task: Task;
  warnings?: PlanWarning[];
  showDate?: boolean;
  emphasis?: RowEmphasis;
  /** Text of the flag instead of the emphasis name («+20 min», «Debería empezar»). */
  flag?: string | null;
  onOpen: (task: Task) => void;
}> = ({task, warnings = [], showDate = false, emphasis, flag, onOpen}) => {
  const {date} = recordSlot(task);
  const conflict = warnings.some(w => w.severity === 'conflict');
  const reminder = !conflict && warnings.length > 0;
  const pending = missingForTask(task).length > 0;
  const flagText =
    emphasis && emphasis !== 'past' ? (flag ?? EMPHASIS_LABEL[emphasis]) : null;
  const unsent = useUnsent(task.id);
  return (
    <button
      type="button"
      className={[
        'lx-taskrow',
        `lx-taskrow--${task.status}`,
        emphasis ? `lx-taskrow--${emphasis}` : '',
        conflict ? 'lx-taskrow--conflict' : '',
        unsent ? 'lx-taskrow--unsent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-task-id={task.id}
      aria-label={`${emphasisPrefix(emphasis, flag)}${taskLabel(task, warnings, {date: showDate})}${unsentSuffix(unsent)}`}
      onClick={() => onOpen(task)}
    >
      <span className="lx-taskrow__time">
        {flagText && (
          <span className="lx-taskrow__flag lx-num">{flagText}</span>
        )}
        {showDate && date && (
          <span className="lx-taskrow__date lx-num">{dayMonthShort(date)}</span>
        )}
        <TimeWindow record={task} />
      </span>
      <span className="lx-taskrow__kind" aria-hidden="true">
        <Icon name={TASK_KIND_ICON[task.kind]} size={20} />
      </span>
      <span className="lx-taskrow__main">
        <span className="lx-taskrow__title">{task.title}</span>
        <span className="lx-taskrow__meta">
          <span
            className={`lx-venuechip${task.venue ? '' : ' lx-venuechip--none'}`}
          >
            <Icon name="pin" size={13} />
            {task.venue?.name ?? 'Sin lugar'}
          </span>
          {task.company && (
            <span className="lx-taskrow__company">{task.company.name}</span>
          )}
          {task.contact && (
            <span className="lx-taskrow__contact">
              <Icon name="user" size={13} />
              {task.contact.name}
            </span>
          )}
          {pending && (
            <span className="lx-pending lx-taskrow__pending">
              <span className="lx-chip__dot" aria-hidden="true" />
              Falta información
            </span>
          )}
          <UnsentMark id={task.id} />
        </span>
      </span>
      <span className="lx-taskrow__end">
        {(conflict || reminder) && (
          <span
            className={`lx-taskrow__warn${conflict ? ' is-conflict' : ''}`}
            title={warningsSummary(warnings)}
          >
            <Icon name={conflict ? 'alert' : 'bell'} size={16} />
            <span className="lx-num">{warnings.length}</span>
          </span>
        )}
        <TaskStatusChip status={task.status} />
      </span>
    </button>
  );
};
