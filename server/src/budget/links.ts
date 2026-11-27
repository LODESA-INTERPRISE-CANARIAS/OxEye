/**
 * Revisión 1 · E5: what deleting a company does to the expenses paid to it.
 * `expenses.company_id` has no ON DELETE action, so a company delete that
 * forgets this fails loudly instead of losing the link silently.
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';

/**
 * Removes the company from its expenses, keeping the name it has now
 * (`company_name`), with a new version, author and an `expense` update
 * ['company'] in the log (label: the concept; never an amount). The caller
 * holds the catalogue lock.
 */
export async function unlinkExpenses(
  tx: Queryable,
  args: {organizationId: string; companyId: string; actorId: string; now: Date},
): Promise<void> {
  const rows = await tx.query<{id: string; concept: string; is_demo: boolean}>(
    `UPDATE expenses x
        SET company_name = c.name, company_id = NULL, version = x.version + 1,
            updated_by = $3, updated_at = $4::timestamptz
       FROM companies c
      WHERE c.id = x.company_id AND x.company_id = $1 AND x.organization_id = $2
      RETURNING x.id, x.concept, x.is_demo`,
    [args.companyId, args.organizationId, args.actorId, args.now.toISOString()],
  );
  for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    await appendActivity(tx, {
      organizationId: args.organizationId,
      userId: args.actorId,
      entityType: 'expense',
      entityId: r.id,
      entityLabel: r.concept,
      action: 'update',
      changedFields: ['company'],
      at: args.now,
      isDemo: r.is_demo,
    });
  }
}
