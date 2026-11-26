/**
 * Categories of companies and offers (scope `service`) and, from milestone 4,
 * of inventory resources (scope `resource`). Every organization starts with
 * the built-in service categories; users add more by name (the same name, in
 * any letter case, resolves to the existing category) and may delete their
 * own. Built-ins stay.
 */
import type {Db, Queryable} from '../db/db.ts';
import {AppError, notFound} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {isUuid, requireMembership} from '../organizations/service.ts';
import {normalizeName} from '../records/find-or-create.ts';
import {byId} from '../records/ids.ts';
import {lockCatalogue} from '../records/locks.ts';
import {unlinkResources} from '../resources/links.ts';
import {
  BUILT_IN_RESOURCE_CATEGORIES,
  BUILT_IN_SERVICE_CATEGORIES,
} from '../../../shared/logistics/rules.ts';
import type {CreateCategoryBody} from './schemas.ts';
import type {
  Category,
  CategoryScope,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

interface CategoryRow {
  id: string;
  organization_id: string;
  scope: CategoryScope;
  name: string;
  built_in: boolean;
}

const SELECT_CATEGORY =
  'SELECT id, organization_id, scope, name, built_in FROM categories';

/**
 * Display order of categories of table alias `t`: service before resource,
 * built-ins in their fixed order, then the organization's own by name.
 */
export function categoryOrder(t: string): string {
  return `CASE ${t}.scope WHEN 'service' THEN 0 ELSE 1 END,
          ${t}.position ASC NULLS LAST, lower(${t}.name), ${t}.id`;
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    organizationId: row.organization_id,
    scope: row.scope,
    name: row.name,
    builtIn: Boolean(row.built_in),
  };
}

export async function listCategories(
  db: Queryable,
  organizationId: string,
): Promise<Category[]> {
  const rows = await db.query<CategoryRow>(
    `${SELECT_CATEGORY} c WHERE c.organization_id = $1 ORDER BY ${categoryOrder('c')}`,
    [organizationId],
  );
  return rows.map(toCategory);
}

/**
 * Gives the organization the built-in service and resource categories it
 * lacks, in the shared order. Idempotent; a custom category with a
 * built-in's name stays.
 */
export async function ensureBuiltInCategories(
  tx: Queryable,
  organizationId: string,
): Promise<void> {
  const builtIns: [CategoryScope, readonly string[]][] = [
    ['service', BUILT_IN_SERVICE_CATEGORIES],
    ['resource', BUILT_IN_RESOURCE_CATEGORIES],
  ];
  for (const [scope, names] of builtIns) {
    await tx.query(
      `INSERT INTO categories (organization_id, scope, name, built_in, position)
       SELECT $1::uuid, $2, b.name, true, b.position::int
         FROM jsonb_array_elements_text($3::jsonb) WITH ORDINALITY AS b (name, position)
       ON CONFLICT (organization_id, scope, (lower(name))) DO NOTHING`,
      [organizationId, scope, JSON.stringify(names)],
    );
  }
}

/** True when every id is a category of the organization in that scope. */
export async function areCategoriesOfScope(
  tx: Queryable,
  organizationId: string,
  scope: CategoryScope,
  ids: readonly string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await tx.query<{n: number}>(
    `SELECT count(*)::int AS n FROM categories
      WHERE organization_id = $1 AND scope = $2
        AND id IN (SELECT value::uuid FROM jsonb_array_elements_text($3::jsonb))`,
    [organizationId, scope, JSON.stringify(ids)],
  );
  return rows[0]?.n === ids.length;
}

/**
 * True when every id is a service category of the organization (companies
 * and offers use service categories only).
 */
export function areServiceCategories(
  tx: Queryable,
  organizationId: string,
  ids: readonly string[],
): Promise<boolean> {
  return areCategoriesOfScope(tx, organizationId, 'service', ids);
}

export const CATEGORIES_UNKNOWN =
  'Alguna de las categorías ya no existe o no es de esta organización.';

/**
 * Finds the category by name in the scope (ignoring letter case) or creates
 * it. `created` tells the route whether to answer 201 or 200.
 */
export async function createCategory(
  db: Db,
  actor: SessionUser,
  input: CreateCategoryBody,
  now: Date,
): Promise<{category: Category; created: boolean}> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    const name = normalizeName(input.name) as string;
    const inserted = await tx.query<CategoryRow>(
      `INSERT INTO categories (organization_id, scope, name, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (organization_id, scope, (lower(name))) DO NOTHING
       RETURNING id, organization_id, scope, name, built_in`,
      [org.id, input.scope, name, actor.id, now.toISOString()],
    );
    const created = inserted[0];
    if (created) {
      await appendActivity(tx, {
        organizationId: org.id,
        userId: actor.id,
        entityType: 'category',
        entityId: created.id,
        entityLabel: created.name,
        action: 'create',
        at: now,
      });
      return {category: toCategory(created), created: true};
    }
    const existing = await tx.query<CategoryRow>(
      `${SELECT_CATEGORY}
        WHERE organization_id = $1 AND scope = $2 AND lower(name) = lower($3)`,
      [org.id, input.scope, name],
    );
    const found = existing[0];
    if (!found) throw new Error('category vanished during find-or-create');
    return {category: toCategory(found), created: false};
  });
}

function categoryNotFound(): AppError {
  return notFound('No encontramos esa categoría: puede que se haya eliminado.');
}

/**
 * Deletes a custom category. Companies, offers and resources that used it
 * lose it: their version increases and the change is logged, so a stale edit
 * cannot put the category back silently. Categories carry no version: they
 * are only created and deleted.
 */
export async function deleteCategory(
  db: Db,
  actor: SessionUser,
  id: string,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) throw categoryNotFound();
  await db.transaction(async tx => {
    const unlocked = (
      await tx.query<CategoryRow>(`${SELECT_CATEGORY} WHERE id = $1`, [id])
    )[0];
    if (!unlocked) throw categoryNotFound();
    try {
      await requireMembership(tx, actor.id, unlocked.organization_id);
    } catch {
      throw categoryNotFound();
    }
    const orgId = unlocked.organization_id;
    await lockCatalogue(tx, orgId);
    const row = (
      await tx.query<CategoryRow>(
        `${SELECT_CATEGORY} WHERE id = $1 FOR UPDATE`,
        [id],
      )
    )[0];
    if (!row) throw categoryNotFound();
    if (row.built_in) {
      const where =
        row.scope === 'resource' ? 'cada recurso' : 'cada empresa u oferta';
      throw new AppError(
        'VALIDATION',
        `«${row.name}» es una categoría de serie y no se puede borrar. Puedes quitarla de ${where}.`,
      );
    }

    const at = now.toISOString();
    const companies = await tx.query<{
      id: string;
      name: string;
      is_demo: boolean;
    }>(
      `UPDATE companies c
          SET version = version + 1, updated_by = $2, updated_at = $3::timestamptz
         FROM company_categories cc
        WHERE cc.company_id = c.id AND cc.category_id = $1
        RETURNING c.id, c.name, c.is_demo`,
      [id, actor.id, at],
    );
    const offers = await tx.query<{id: string; name: string; is_demo: boolean}>(
      `UPDATE offers
          SET category_id = NULL, version = version + 1,
              updated_by = $2, updated_at = $3::timestamptz
        WHERE category_id = $1
        RETURNING id, name, is_demo`,
      [id, actor.id, at],
    );
    await unlinkResources(tx, {
      organizationId: orgId,
      link: 'category',
      ids: [id],
      actorId: actor.id,
      now,
    });
    // company_categories rows go with the category (ON DELETE CASCADE).
    await tx.query('DELETE FROM categories WHERE id = $1', [id]);

    for (const c of [...companies].sort(byId)) {
      await appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType: 'company',
        entityId: c.id,
        entityLabel: c.name,
        action: 'update',
        changedFields: ['categoryIds'],
        at: now,
        isDemo: c.is_demo,
      });
    }
    for (const o of [...offers].sort(byId)) {
      await appendActivity(tx, {
        organizationId: orgId,
        userId: actor.id,
        entityType: 'offer',
        entityId: o.id,
        entityLabel: o.name,
        action: 'update',
        changedFields: ['categoryId'],
        at: now,
        isDemo: o.is_demo,
      });
    }
    await appendActivity(tx, {
      organizationId: orgId,
      userId: actor.id,
      entityType: 'category',
      entityId: id,
      entityLabel: row.name,
      action: 'delete',
      at: now,
    });
  });
}
