/**
 * «Mantener ambas» (Revisión 1 · E2): a conflict warning the team decided to
 * live with, with a short reason. Pure and shared by the UI, the day close
 * and the server.
 *
 * An acceptance applies while every task it names keeps exactly the window
 * it had when it was accepted; if one moves, the warning opens again (the
 * acceptance stays as a record). Only conflicts can be accepted: reminders
 * (routes A/B/C and Carpa Amarilla, subsoil, resources to check) always stay
 * visible.
 */
import type {AcceptedWindow, ConflictAcceptance, Task} from './contracts.ts';
import type {PlanWarning} from './conflicts.ts';

type Timed = Pick<Task, 'id' | 'startsAt' | 'endsAt'>;

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Only a conflict can be kept with a reason; reminders never are. */
export function isAcceptable(warning: Pick<PlanWarning, 'severity'>): boolean {
  return warning.severity === 'conflict';
}

/**
 * The windows to accept for a warning: each of its tasks with its current
 * times. Null when a task is missing or has no times.
 */
export function windowsFor(
  warning: Pick<PlanWarning, 'taskIds'>,
  tasks: readonly Timed[],
): AcceptedWindow[] | null {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const out: AcceptedWindow[] = [];
  for (const id of warning.taskIds) {
    const t = byId.get(id);
    if (!t || !t.startsAt || !t.endsAt) return null;
    out.push({taskId: id, startsAt: t.startsAt, endsAt: t.endsAt});
  }
  return out;
}

/** Same tasks with the same instants (order and instant spelling do not matter). */
export function sameWindows(
  a: readonly AcceptedWindow[],
  b: readonly AcceptedWindow[],
): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map(w => [w.taskId.toLowerCase(), w]));
  if (byId.size !== b.length) return false;
  return a.every(w => {
    const other = byId.get(w.taskId.toLowerCase());
    return (
      !!other &&
      ms(other.startsAt) === ms(w.startsAt) &&
      ms(other.endsAt) === ms(w.endsAt)
    );
  });
}

/** True while every task of the acceptance keeps exactly its accepted window. */
export function acceptanceApplies(
  acceptance: Pick<ConflictAcceptance, 'windows'>,
  tasks: readonly Timed[],
): boolean {
  if (acceptance.windows.length === 0) return false;
  const byId = new Map(tasks.map(t => [t.id, t]));
  return acceptance.windows.every(w => {
    const t = byId.get(w.taskId);
    return (
      !!t && ms(t.startsAt) === ms(w.startsAt) && ms(t.endsAt) === ms(w.endsAt)
    );
  });
}

/** The newest acceptance of this warning that still applies, or null. */
export function acceptanceFor<A extends ConflictAcceptance>(
  warning: Pick<PlanWarning, 'key' | 'severity'>,
  acceptances: readonly A[],
  tasks: readonly Timed[],
): A | null {
  if (!isAcceptable(warning)) return null;
  let best: A | null = null;
  for (const a of acceptances) {
    if (a.warningKey !== warning.key || !acceptanceApplies(a, tasks)) continue;
    if (!best || Date.parse(a.acceptedAt) > Date.parse(best.acceptedAt)) {
      best = a;
    }
  }
  return best;
}

/**
 * Warnings split into those still open and those accepted («aceptado»,
 * shown with the reason and who signed it, and kept in the day close).
 */
export function splitAccepted<
  W extends PlanWarning,
  A extends ConflictAcceptance,
>(
  warnings: readonly W[],
  acceptances: readonly A[],
  tasks: readonly Timed[],
): {open: W[]; accepted: {warning: W; acceptance: A}[]} {
  const open: W[] = [];
  const accepted: {warning: W; acceptance: A}[] = [];
  for (const warning of warnings) {
    const acceptance = acceptanceFor(warning, acceptances, tasks);
    if (acceptance) accepted.push({warning, acceptance});
    else open.push(warning);
  }
  return {open, accepted};
}
