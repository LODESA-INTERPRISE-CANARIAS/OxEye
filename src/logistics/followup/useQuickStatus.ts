/**
 * One-tap progress from «La jornada»: «Empezar» (→ En curso) and «Hecha».
 *
 * - Every change shows a toast with «Deshacer» (about 6 s), which puts the
 *   previous status back with the version just saved.
 * - A 409 never overwrites: when the server copy still has the status the
 *   user acted on (someone changed other fields), the change is retried once
 *   with the current version; otherwise the list shows the server copy and
 *   the toast says who got there first («Ana Demo ya la marcó como Hecha»).
 * - Marking a heavy-load task «Hecha» without a declared subsoil review says
 *   the reminder stays: finishing is not reviewing.
 */
import {useCallback, useState} from 'react';
import type {Task, TaskStatus} from '../../../shared/logistics/contracts.ts';
import {TASK_STATUS_LABEL} from '../../../shared/logistics/rules.ts';
import {errorMessage, isApiError} from '../api/client';
import {
  QUEUED_NOTE,
  useLogisticsStore,
  wasQueued,
} from '../store/useLogisticsStore';

/** The server copy carried by a 409, if any. */
function conflictTask(err: unknown): Task | null {
  return isApiError(err) &&
    err.code === 'VERSION_CONFLICT' &&
    err.current &&
    typeof err.current === 'object' &&
    !Array.isArray(err.current)
    ? (err.current as Task)
    : null;
}

const lower = (s: string) => s.toLocaleLowerCase('es-ES');

/** ««Montaje del escenario»: Ana Demo ya la marcó como Hecha.» */
export function alreadyMarkedText(
  current: Pick<Task, 'title' | 'status' | 'updatedBy'>,
  userId: string | null,
): string {
  const label = TASK_STATUS_LABEL[current.status];
  return current.updatedBy?.id && current.updatedBy.id === userId
    ? `«${current.title}»: ya la marcaste como ${label} en otra sesión.`
    : `«${current.title}»: ${current.updatedBy?.displayName ?? 'Alguien'} ya la marcó como ${label}.`;
}

export const BUSY_ELSEWHERE_TEXT =
  'No se pudo guardar: alguien la está cambiando. Inténtalo de nuevo.';

/** Toast after a quick change. */
export function quickDoneText(
  task: Pick<Task, 'title' | 'heavyLoad' | 'subsoilReview'>,
  status: TaskStatus,
): string {
  if (status === 'in_progress') return `En curso: «${task.title}».`;
  if (status === 'done') {
    const reminder =
      task.heavyLoad === true && !task.subsoilReview
        ? ' El recordatorio del subsuelo sigue: nadie ha declarado la revisión en el simulador.'
        : '';
    return `Hecha: «${task.title}».${reminder}`;
  }
  return `«${task.title}»: ${lower(TASK_STATUS_LABEL[status])}.`;
}

export function useQuickStatus() {
  const updateTask = useLogisticsStore(s => s.updateTask);
  const toast = useLogisticsStore(s => s.toast);
  const userId = useLogisticsStore(s => s.session?.user.id ?? null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const mark = useCallback((id: string, on: boolean) => {
    setBusy(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const undo = useCallback(
    async (saved: Task, previous: TaskStatus) => {
      mark(saved.id, true);
      try {
        await updateTask(saved.id, {version: saved.version, status: previous});
        toast(
          `Deshecho: «${saved.title}» vuelve a estar ${lower(TASK_STATUS_LABEL[previous])}.`,
          'info',
        );
      } catch (err) {
        const current = conflictTask(err);
        toast(
          current
            ? `No se ha deshecho: ${current.updatedBy?.displayName ?? 'alguien'} ha cambiado «${saved.title}» mientras tanto.`
            : `No se ha deshecho. ${errorMessage(err)}`,
          'error',
        );
      } finally {
        mark(saved.id, false);
      }
    },
    [mark, toast, updateTask],
  );

  const run = useCallback(
    async (task: Task, next: TaskStatus) => {
      if (busy.has(task.id)) return;
      mark(task.id, true);
      try {
        let saved: Task;
        try {
          saved = await updateTask(task.id, {
            version: task.version,
            status: next,
          });
        } catch (err) {
          const current = conflictTask(err);
          if (!current) throw err;
          if (current.status !== task.status) {
            // Someone else moved it on: their change stands.
            toast(alreadyMarkedText(current, userId), 'info');
            return;
          }
          // Only other fields changed: same intent, current version.
          saved = await updateTask(current.id, {
            version: current.version,
            status: next,
          });
        }
        const previous = task.status;
        // Saved on this device only (M6): say so, the undo still works.
        const queued = wasQueued(saved);
        toast(
          queued
            ? `${quickDoneText(saved, next)} ${QUEUED_NOTE}`
            : quickDoneText(saved, next),
          queued ? 'info' : 'success',
          {action: {label: 'Deshacer', run: () => void undo(saved, previous)}},
        );
      } catch (err) {
        const current = conflictTask(err);
        // A second 409 where nobody moved the status: someone is editing it
        // right now; do not claim they marked it.
        const busyElsewhere = !!current && current.status === task.status;
        toast(
          busyElsewhere
            ? BUSY_ELSEWHERE_TEXT
            : current
              ? alreadyMarkedText(current, userId)
              : `No se ha cambiado «${task.title}». ${errorMessage(err)}`,
          current && !busyElsewhere ? 'info' : 'error',
        );
      } finally {
        mark(task.id, false);
      }
    },
    [busy, mark, toast, undo, updateTask, userId],
  );

  return {busy, run};
}
