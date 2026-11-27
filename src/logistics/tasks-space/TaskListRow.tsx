/**
 * One task in «Tareas»: time, title, venue, company, status, a warning dot
 * and its dependencies. The row opens the task sheet; the chain button
 * highlights everything it waits for and everything that waits for it.
 */
import React from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {TaskStatusChip} from '../common/TaskChips';
import {taskLabel} from '../common/TaskRow';
import {TimeWindow} from '../common/TimeWindow';
import {warningsSummary} from '../common/WarningList';
import {dayMonthShort, plural} from '../lib/format';
import {recordSlot, TASK_KIND_ICON, TASK_KIND_LABEL} from '../lib/tasks';
import {UnsentMark, unsentSuffix, useUnsent} from '../offline/PendingMark';
import {Icon} from '../ui';
import {waitsForText} from './filters';

/** Where a row stands in the highlighted chain. */
export type ChainRole = 'root' | 'before' | 'after' | 'out' | null;

const CHAIN_WORD: Record<'root' | 'before' | 'after', string> = {
  root: 'Tarea elegida',
  before: 'Va antes',
  after: 'Va después',
};

export const TaskListRow: React.FC<{
  task: Task;
  warnings: readonly PlanWarning[];
  waitsFor: readonly Task[];
  waitedBy: readonly Task[];
  /** Grouped view and filtered lists across days show the date. */
  showDate: boolean;
  chain: ChainRole;
  onOpen: (task: Task) => void;
  onChain: (task: Task) => void;
}> = ({
  task,
  warnings,
  waitsFor,
  waitedBy,
  showDate,
  chain,
  onOpen,
  onChain,
}) => {
  const conflict = warnings.some(w => w.severity === 'conflict');
  const linked = waitsFor.length + waitedBy.length > 0;
  const unsent = useUnsent(task.id);
  const {date} = recordSlot(task);
  const chainLabel = [
    waitsFor.length
      ? `espera a ${plural(waitsFor.length, 'tarea', 'tareas')}`
      : '',
    waitedBy.length
      ? `${plural(waitedBy.length, 'tarea espera', 'tareas esperan')} por ella`
      : '',
  ]
    .filter(Boolean)
    .join(' y ');
  return (
    <li
      className={[
        'lx-tlrow',
        `lx-tlrow--${task.status}`,
        conflict ? 'lx-tlrow--conflict' : '',
        chain ? `is-chain-${chain}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-task-id={task.id}
    >
      <button
        type="button"
        className="lx-tlrow__open"
        aria-label={`${chain && chain !== 'out' ? `${CHAIN_WORD[chain]}: ` : ''}${taskLabel(task, [...warnings], {date: showDate})}${waitsFor.length ? `, ${waitsForText(waitsFor).toLocaleLowerCase('es-ES')}` : ''}${unsentSuffix(unsent)}`}
        onClick={() => onOpen(task)}
      >
        <span className="lx-tlrow__time lx-num">
          {showDate && date && (
            <span className="lx-tlrow__date">{dayMonthShort(date)}</span>
          )}
          <TimeWindow record={task} />
        </span>
        <span className="lx-tlrow__main">
          <span className="lx-tlrow__title">
            <Icon
              name={TASK_KIND_ICON[task.kind]}
              size={16}
              className="lx-tlrow__kind"
              label={TASK_KIND_LABEL[task.kind]}
            />
            <span>{task.title}</span>
          </span>
          <span className="lx-tlrow__meta">
            <span
              className={`lx-venuechip${task.venue ? '' : ' lx-venuechip--none'}`}
            >
              <Icon name="pin" size={13} />
              {task.venue?.name ?? 'Sin lugar'}
            </span>
            {task.company && (
              <span className="lx-tlrow__company">{task.company.name}</span>
            )}
            <UnsentMark id={task.id} />
          </span>
          {waitsFor.length > 0 && (
            <span className="lx-tlrow__waits">
              <Icon name="link" size={13} />
              {waitsForText(waitsFor)}
            </span>
          )}
          {chain && chain !== 'out' && (
            <span className={`lx-tlrow__role is-${chain}`}>
              {CHAIN_WORD[chain]}
            </span>
          )}
        </span>
        <span className="lx-tlrow__end">
          {warnings.length > 0 && (
            <span
              className={`lx-tlrow__warn${conflict ? ' is-conflict' : ''}`}
              title={warningsSummary([...warnings])}
            >
              <span className="lx-tlrow__dot" aria-hidden="true" />
              <span className="lx-num">{warnings.length}</span>
            </span>
          )}
          <TaskStatusChip status={task.status} />
        </span>
      </button>
      {linked && (
        <button
          type="button"
          className="lx-tlrow__chain"
          aria-pressed={chain === 'root'}
          aria-label={`${chain === 'root' ? 'Quitar el resaltado de la cadena' : 'Resaltar su cadena'} de «${task.title}»: ${chainLabel}`}
          title={
            chain === 'root'
              ? 'Quitar el resaltado'
              : `Resaltar su cadena: ${chainLabel}`
          }
          onClick={() => onChain(task)}
        >
          <Icon name="link" size={16} />
          <span className="lx-num">{waitsFor.length + waitedBy.length}</span>
        </button>
      )}
    </li>
  );
};
