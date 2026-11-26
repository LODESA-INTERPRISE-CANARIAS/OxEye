/**
 * What happens to delay hypotheses when their task goes, for the writers that
 * delete tasks (task delete). Kept apart from hypotheses/service.ts so the task
 * service can use it without a circular import. Demo removal has its own SQL
 * in demo/service.ts with the same rule.
 *
 * `hypotheses.task_id` has no ON DELETE action: a delete path that forgot to
 * call this fails instead of losing hypotheses silently.
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {byId} from '../records/ids.ts';
import {hypothesisLabel} from '../../../shared/logistics/history.ts';
import type {DelayMode} from '../../../shared/logistics/contracts.ts';

/**
 * Before deleting tasks: their open hypotheses are deleted (logged, labelled
 * without the note) and the applied ones lose the link but keep their label
 * (`task_title`), as a record of the decision. The caller holds the graph
 * lock, like every hypothesis writer.
 */
export async function detachHypotheses(
  tx: Queryable,
  args: {taskIds: readonly string[]; actorId: string; now: Date},
): Promise<void> {
  if (args.taskIds.length === 0) return;
  const ids = JSON.stringify(args.taskIds);
  const removed = await tx.query<{
    id: string;
    organization_id: string;
    task_title: string;
    delay_minutes: number;
    mode: DelayMode;
    estimated: boolean;
    is_demo: boolean;
  }>(
    `DELETE FROM hypotheses
      WHERE applied_at IS NULL
        AND task_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))
      RETURNING id, organization_id, task_title, delay_minutes, mode, estimated,
                is_demo`,
    [ids],
  );
  await tx.query(
    `UPDATE hypotheses SET task_id = NULL
      WHERE task_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))`,
    [ids],
  );
  for (const h of [...removed].sort(byId)) {
    await appendActivity(tx, {
      organizationId: h.organization_id,
      userId: args.actorId,
      entityType: 'hypothesis',
      entityId: h.id,
      entityLabel: hypothesisLabel({
        delayMinutes: Number(h.delay_minutes),
        mode: h.mode,
        estimated: Boolean(h.estimated),
        taskTitle: h.task_title,
      }),
      action: 'delete',
      at: args.now,
      isDemo: h.is_demo,
    });
  }
}
