/**
 * «Avisos» on «Hoy»: today's conflicts first, then reminders, each linking to
 * a task involved. Calculated from the plan; never presented as certain.
 */
import React from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import {useActions} from '../common/actions';
import type {Plan} from '../common/usePlan';
import {
  WARNINGS_HELP,
  WarningList,
  warningsSummary,
} from '../common/WarningList';
import {Button, Card, HelpTip, Icon} from '../ui';

const MAX_ROWS = 5;

export const WarningsCard: React.FC<{plan: Plan}> = ({plan}) => {
  const {today, openTask, openDay} = useActions();
  const bucket = plan.byDay.get(today);
  const warnings: PlanWarning[] = bucket
    ? [...bucket.conflicts, ...bucket.reminders]
    : [];
  const rows = warnings.slice(0, MAX_ROWS);
  const more = warnings.length - rows.length;
  const conflicts = bucket?.conflicts.length ?? 0;
  // Revisión 1: conflicts the team kept today, listed apart with the reason.
  const accepted = plan.acceptedByDay.get(today) ?? [];

  return (
    <Card
      title={
        <>
          Avisos de hoy
          {warnings.length > 0 && (
            <span
              className={`lx-count lx-num${conflicts ? ' lx-count--danger' : ''}`}
            >
              {warnings.length}
            </span>
          )}
        </>
      }
      id="lx-warnings"
      className="lx-warnings-card"
      actions={<HelpTip label="avisos">{WARNINGS_HELP}</HelpTip>}
    >
      {warnings.length === 0 && (
        <p className="lx-muted lx-warnings__none" id="lx-warnings-empty">
          <Icon name="check" size={16} />{' '}
          {accepted.length
            ? 'Sin avisos abiertos para hoy: los conflictos que quedan están aceptados.'
            : 'Sin avisos para hoy con lo que hay registrado.'}
        </p>
      )}
      {(warnings.length > 0 || accepted.length > 0) && (
        <>
          {warnings.length > 0 && (
            <p className="lx-visually-hidden">{warningsSummary(warnings)}</p>
          )}
          <WarningList
            warnings={rows}
            tasksById={plan.tasksById}
            onOpenTask={openTask}
            accepted={accepted}
            id="lx-warnings-list"
          />
          {more > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon="columns"
              className="lx-warnings__more"
              onClick={() => openDay(today)}
            >
              {more === 1 ? 'Ver 1 aviso más' : `Ver ${more} avisos más`} en el
              día
            </Button>
          )}
        </>
      )}
    </Card>
  );
};
