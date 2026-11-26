/**
 * Links from inventory resources to other records, for the writers that own
 * those records: deleting a warehouse, company, offer or category unlinks the
 * resources that used it, and a task checks the resources it lists. Kept
 * apart from resources/service.ts so companies, offers and categories can use
 * it without a circular import.
 */
import type {Queryable} from '../db/db.ts';
import {appendActivity} from '../activity/service.ts';
import {byId} from '../records/ids.ts';

/** What a resource can lose: its warehouse, company (and so its offer), offer or category. */
export type ResourceLink = 'warehouse' | 'company' | 'offer' | 'category';

const COLUMN: Record<ResourceLink, string> = {
  warehouse: 'warehouse_id',
  company: 'company_id',
  offer: 'offer_id',
  category: 'category_id',
};

export const RESOURCES_UNKNOWN =
  'Alguno de los recursos ya no existe o no es de esta organización.';

/**
 * Removes the link from every resource that points at one of `ids`, with a
 * new version, author and time, and logs the change, so a stale edit cannot
 * restore the link silently. Losing the company also loses the offer (an
 * offer always belongs to the resource's company). The caller holds the
 * catalogue lock: resource rows have one writer per organization.
 */
export async function unlinkResources(
  tx: Queryable,
  args: {
    organizationId: string;
    link: ResourceLink;
    ids: readonly string[];
    actorId: string;
    now: Date;
  },
): Promise<void> {
  if (args.ids.length === 0) return;
  const column = COLUMN[args.link];
  const alsoOffer = args.link === 'company' ? ', offer_id = NULL' : '';
  const rows = await tx.query<{
    id: string;
    name: string;
    is_demo: boolean;
    had_offer: boolean;
  }>(
    `WITH old AS (
       SELECT id, offer_id FROM resources
        WHERE organization_id = $1
          AND ${column} IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))
     )
     UPDATE resources r
        SET ${column} = NULL${alsoOffer}, version = r.version + 1,
            updated_by = $3, updated_at = $4::timestamptz
       FROM old
      WHERE r.id = old.id
      RETURNING r.id, r.name, r.is_demo, old.offer_id IS NOT NULL AS had_offer`,
    [
      args.organizationId,
      JSON.stringify(args.ids),
      args.actorId,
      args.now.toISOString(),
    ],
  );
  const fields: Record<ResourceLink, string> = {
    warehouse: 'warehouse',
    company: 'company',
    offer: 'offerId',
    category: 'categoryId',
  };
  for (const r of [...rows].sort(byId)) {
    await appendActivity(tx, {
      organizationId: args.organizationId,
      userId: args.actorId,
      entityType: 'resource',
      entityId: r.id,
      entityLabel: r.name,
      action: 'update',
      changedFields:
        args.link === 'company' && r.had_offer
          ? ['company', 'offerId']
          : [fields[args.link]],
      at: args.now,
      isDemo: r.is_demo,
    });
  }
}

/** True when every id is a resource of the organization. */
export async function areOwnResources(
  tx: Queryable,
  organizationId: string,
  ids: readonly string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await tx.query<{n: number}>(
    `SELECT count(*)::int AS n FROM resources
      WHERE organization_id = $1
        AND id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))`,
    [organizationId, JSON.stringify(ids)],
  );
  return rows[0]?.n === ids.length;
}
