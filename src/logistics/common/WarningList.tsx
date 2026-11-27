/**
 * Plan warnings from `shared/logistics/conflicts.ts`: conflicts first (two
 * things cannot both happen as planned), then reminders (check it in the
 * simulator). They are calculations to support decisions, not certainties.
 *
 * Revisión 1 · E2: where the list links to tasks, a time conflict between two
 * tasks offers its way out to members («¿Retrasar…?», «¿Adelantar…?»,
 * «Mantener ambas»), each through the move preview first. Accepted conflicts
 * can be listed apart with their reason and who accepted them.
 */
import React, {useContext, useMemo, useState} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import {Signature} from '../account/Signature';
import {errorMessage} from '../api/client';
import {instantShort} from '../lib/format';
import {conflictExits, durationText} from '../moves/exits';
import {useMoveFlow, type MoveRequest} from '../moves/useMoveFlow';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Withheld} from '../ui';
import {ActionsContext} from './actions';
import type {AcceptedWarning} from './usePlan';
import {WarningRow} from './WarningItem';

export const WARNINGS_HELP =
  'Avisos calculados a partir del plan: dos tareas en el mismo lugar a la vez, una empresa en dos sitios, el mismo recurso en dos tareas a la vez, una tarea que cuenta con material dañado o en reparación, una tarea que empieza antes de que termine aquella de la que depende, cargas pesadas que piden revisar el subsuelo y vehículos que se mueven durante el evento. Son una ayuda para revisar; no certifican nada.';

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
  /**
   * Conflicts the team kept, listed after the open ones with their reason
   * (`plan.accepted` / `plan.acceptedByDay`).
   */
  accepted?: AcceptedWarning[];
  /**
   * Where an exit goes. By default the list opens the move preview itself;
   * a list inside a popover hands it to its owner so the preview outlives
   * the popover.
   */
  onMove?: (request: MoveRequest) => void;
}> = ({warnings, tasksById, onOpenTask, selfId, id, accepted, onMove}) => {
  // Outside the window (mock-ups) there are no actions: no exits.
  const actions = useContext(ActionsContext);
  const canWrite = !!actions?.canWrite;
  const flow = useMoveFlow();
  const move = onMove ?? ((r: MoveRequest) => flow.open(r));
  // Exits only where the list is about the plan (it links to tasks).
  const withExits = canWrite && !!tasksById && !!onOpenTask && !selfId;

  return (
    <>
      {(warnings.length > 0 || !accepted?.length) && (
        <ul className="lx-warnings" id={id}>
          {warnings.map(w => {
            const targetId = w.taskIds.find(t => t !== selfId) ?? w.taskIds[0];
            const target =
              onOpenTask && targetId !== selfId
                ? tasksById?.get(targetId)
                : undefined;
            const exits =
              withExits && tasksById ? conflictExits(w, tasksById) : null;
            return (
              <li
                key={w.key}
                className={`lx-warning lx-warning--${w.severity}${exits ? ' has-exits' : ''}`}
                data-warning={w.kind}
                data-warning-key={w.key}
              >
                <WarningRow warning={w} target={target} onOpen={onOpenTask} />
                {exits && (exits.delay || exits.advance || exits.keep) && (
                  <div
                    className="lx-warning__exits"
                    role="group"
                    aria-label={`Salidas para «${w.title}»`}
                  >
                    {exits.delay && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="lx-warning__exit"
                        data-exit="delay"
                        onClick={() =>
                          move({
                            kind: 'move',
                            taskId: exits.second.id,
                            minutes: exits.minutes,
                            origin: 'conflict_delay',
                            warningKey: w.key,
                          })
                        }
                      >
                        <span>
                          ¿Retrasar «{exits.second.title}» hasta que acabe «
                          {exits.first.title}»?
                        </span>
                        <span className="lx-warning__exit-amount lx-num">
                          +{durationText(exits.minutes)}
                        </span>
                      </Button>
                    )}
                    {exits.advance && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="lx-warning__exit"
                        data-exit="advance"
                        onClick={() =>
                          move({
                            kind: 'move',
                            taskId: exits.first.id,
                            minutes: -exits.minutes,
                            origin: 'conflict_advance',
                            warningKey: w.key,
                          })
                        }
                      >
                        <span>
                          ¿Adelantar «{exits.first.title}» para que acabe antes
                          de «{exits.second.title}»?
                        </span>
                        <span className="lx-warning__exit-amount lx-num">
                          −{durationText(exits.minutes)}
                        </span>
                      </Button>
                    )}
                    {exits.keep && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="lx-warning__exit lx-warning__exit--keep"
                        data-exit="keep"
                        onClick={() => move({kind: 'keep', warning: w})}
                      >
                        Mantener ambas
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {accepted && accepted.length > 0 && (
        <AcceptedList
          accepted={accepted}
          canWrite={canWrite}
          timeZone={actions?.timeZone}
          tasksById={tasksById}
          onOpenTask={onOpenTask}
          id={id ? `${id}-accepted` : undefined}
        />
      )}
      {!onMove && flow.element}
    </>
  );
};

/** «Aceptado · motivo · quién», with «Retirar» for members. */
const AcceptedList: React.FC<{
  accepted: AcceptedWarning[];
  canWrite: boolean;
  timeZone?: string;
  tasksById?: Map<string, Task>;
  onOpenTask?: (task: Task) => void;
  id?: string;
}> = ({accepted, canWrite, timeZone, tasksById, onOpenTask, id}) => {
  const withdraw = useLogisticsStore(s => s.withdrawAcceptance);
  const toast = useLogisticsStore(s => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = useMemo(
    () =>
      [...accepted].sort((a, b) =>
        a.warning.title.localeCompare(b.warning.title, 'es'),
      ),
    [accepted],
  );

  const run = async (a: AcceptedWarning) => {
    if (busy) return;
    setBusy(a.acceptance.id);
    try {
      await withdraw(a.acceptance);
      toast(
        `Aceptación retirada: «${a.warning.title}» vuelve a estar pendiente.`,
        'success',
      );
    } catch (err) {
      toast(`No se ha retirado. ${errorMessage(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="lx-warnings-accepted"
      id={id}
      aria-label="Conflictos aceptados"
    >
      <h4 className="lx-warnings-accepted__title">
        Aceptados · {accepted.length}
      </h4>
      <ul className="lx-warnings">
        {sorted.map(a => {
          const {warning: w, acceptance: acc} = a;
          const target = onOpenTask ? tasksById?.get(w.taskIds[0]) : undefined;
          return (
            <li
              key={acc.id}
              className="lx-warning lx-warning--accepted"
              data-warning={w.kind}
              data-warning-key={w.key}
            >
              <WarningRow
                warning={w}
                target={target}
                onOpen={onOpenTask}
                kindLabel="Aceptado"
              />
              <div className="lx-warning__accepted">
                <p className="lx-warning__reason">
                  {acc.reason && !acc.restricted ? (
                    <>«{acc.reason}»</>
                  ) : (
                    <Withheld>Motivo visible para el equipo</Withheld>
                  )}
                </p>
                <p className="lx-warning__who lx-muted lx-num">
                  <Signature
                    user={acc.acceptedBy}
                    supportBy={acc.acceptedBySupport}
                    strong={false}
                  />{' '}
                  · {instantShort(acc.acceptedAt, timeZone)}
                </p>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="lx-warning__withdraw"
                    busy={busy === acc.id}
                    onClick={() => void run(a)}
                    aria-label={`Retirar la aceptación de «${w.title}»`}
                  >
                    Retirar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
