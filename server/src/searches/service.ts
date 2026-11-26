/**
 * Each user's recent searches per organization: the five newest, one per
 * accent- and case-insensitive form (repeating a search moves it to the top
 * with the latest wording). Personal UI state, not shared logistics data: it
 * is not written to the activity log. Guests cannot store any (a shared login
 * keeps its searches on the device); the auth middleware answers 403.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {validationError} from '../errors.ts';
import {requireMembership} from '../organizations/service.ts';
import {normalizeName} from '../records/find-or-create.ts';
import {RECENT_SEARCHES_KEPT} from '../../../shared/logistics/rules.ts';
import {normalize} from '../../../shared/logistics/search.ts';
import type {
  RecentSearch,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

async function listFor(
  db: Queryable,
  userId: string,
  organizationId: string,
): Promise<RecentSearch[]> {
  const rows = await db.query<{query: string; searched_at: unknown}>(
    `SELECT query, searched_at FROM recent_searches
      WHERE user_id = $1 AND organization_id = $2
      ORDER BY seq DESC
      LIMIT $3`,
    [userId, organizationId, RECENT_SEARCHES_KEPT],
  );
  return rows.map(r => ({query: r.query, at: toIso(r.searched_at)}));
}

/** The current user's recent searches in the organization, newest first. */
export async function listRecentSearches(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
): Promise<RecentSearch[]> {
  const org = await requireMembership(db, user.id, organizationId);
  return listFor(db, user.id, org.id);
}

/** Stores a search (or moves it to the top) and keeps only the newest five. */
export async function pushRecentSearch(
  db: Db,
  user: SessionUser,
  organizationId: string,
  rawQuery: string,
  now: Date,
): Promise<RecentSearch[]> {
  return db.transaction(async tx => {
    const org = await requireMembership(tx, user.id, organizationId);
    const query = normalizeName(rawQuery) ?? '';
    const normalized = normalize(query);
    if (normalized === '') {
      throw validationError({
        query:
          'Escribe al menos una letra o un número para guardar la búsqueda.',
      });
    }
    await tx.query(
      `INSERT INTO recent_searches (user_id, organization_id, query, normalized, searched_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (user_id, organization_id, normalized)
       DO UPDATE SET query = EXCLUDED.query, searched_at = EXCLUDED.searched_at,
                     seq = EXCLUDED.seq`,
      [user.id, org.id, query, normalized, now.toISOString()],
    );
    await tx.query(
      `DELETE FROM recent_searches
        WHERE user_id = $1 AND organization_id = $2
          AND id NOT IN (SELECT id FROM recent_searches
                          WHERE user_id = $1 AND organization_id = $2
                          ORDER BY seq DESC LIMIT $3)`,
      [user.id, org.id, RECENT_SEARCHES_KEPT],
    );
    return listFor(tx, user.id, org.id);
  });
}

/** Forgets the current user's recent searches in the organization. */
export async function clearRecentSearches(
  db: Queryable,
  user: SessionUser,
  organizationId: string,
): Promise<void> {
  const org = await requireMembership(db, user.id, organizationId);
  await db.query(
    'DELETE FROM recent_searches WHERE user_id = $1 AND organization_id = $2',
    [user.id, org.id],
  );
}
