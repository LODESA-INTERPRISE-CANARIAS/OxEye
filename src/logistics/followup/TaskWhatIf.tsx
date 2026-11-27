/**
 * «¿Y si se retrasa?» inside a task sheet: the entry to the hypothesis sheet
 * for this task, and its open (saved, not applied) hypotheses as dashed,
 * labelled chips. Computed on the saved plan, never on unsaved edits.
 */
import React, {useMemo, useState} from 'react';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, HelpTip, Icon} from '../ui';
import {canDelay} from './day';
import {HypothesisSheet, type HypothesisStart} from './HypothesisSheet';
import {HypothesisTag} from './HypothesisTag';
import {hypothesisChipLabel} from './text';

export const TaskWhatIf: React.FC<{
  task: Task;
  /** The form around has unsaved changes. */
  dirty?: boolean;
  /**
   * Opens the hypothesis sheet elsewhere. Inside a <form> the sheet must be
   * rendered outside it, or Enter in its fields would submit the task form.
   */
  onOpen?: (start: HypothesisStart) => void;
}> = ({task, dirty = false, onOpen}) => {
  const {today, timeZone} = useActions();
  const all = useLogisticsStore(s => s.hypotheses);
  const open = useMemo(
    () => all.filter(h => h.taskId === task.id && !h.appliedAt),
    [all, task.id],
  );
  const [own, setOwn] = useState<HypothesisStart | null>(null);
  const setStart = onOpen ?? setOwn;
  const start = onOpen ? null : own;
  if (!canDelay(task)) return null;
  const extend = task.status === 'in_progress';
  return (
    <section
      className="lx-subsection lx-whatif"
      id="lx-task-whatif"
      aria-labelledby="lx-task-whatif-title"
    >
      <h3 className="lx-subsection__title" id="lx-task-whatif-title">
        ¿Y si se retrasa?
        <HelpTip label="¿y si se retrasa?">
          Calcula qué tareas se moverían si esta empieza más tarde o se alarga,
          cuánto margen queda hasta el evento y qué avisos aparecerían. Es una
          hipótesis: no cambia el plan hasta que alguien del equipo la aplica y
          lo confirma.
        </HelpTip>
      </h3>
      <div className="lx-whatif__row">
        <Button
          size="sm"
          icon="flask"
          id="lx-task-whatif-open"
          onClick={() => setStart({kind: 'task', taskId: task.id})}
        >
          {extend ? '¿Y si se alarga?' : '¿Y si empieza más tarde?'}
        </Button>
        {dirty && (
          <span className="lx-muted lx-whatif__note">
            <Icon name="eye" size={14} /> Calcula con lo guardado, no con los
            cambios sin guardar.
          </span>
        )}
      </div>
      {open.length > 0 && (
        <ul className="lx-hypochips__list" id="lx-task-hypotheses">
          {open.map(h => (
            <li key={h.id}>
              <button
                type="button"
                className="lx-hypochip lx-num"
                id={`lx-task-hypo-${h.id}`}
                onClick={() => setStart({kind: 'saved', hypothesis: h})}
              >
                <HypothesisTag />{' '}
                <span>{hypothesisChipLabel(h, today, timeZone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {start && <HypothesisSheet start={start} onClose={() => setOwn(null)} />}
    </section>
  );
};
