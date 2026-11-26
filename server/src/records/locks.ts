/**
 * Transaction-level advisory locks per organization, so writes that touch
 * several records cannot interleave badly.
 *
 * - The graph lock serialises writes to the task dependency graph and any
 *   write that updates several tasks at once (no concurrent cycles, no
 *   crossing row-lock orders between task rows).
 * - The catalogue lock serialises writes to categories, companies, contacts
 *   and offers, and task writes that link a company or a contact, so rules
 *   that span records (a main contact belongs to its company, unique company
 *   names, links to records being deleted) hold.
 *
 * Lock order, always: graph → catalogue → row locks. Every write to category,
 * company, contact or offer rows holds the catalogue lock, so those rows have
 * one writer per organization at a time. Task rows are also written by task
 * edits that hold neither lock (one row each); a write that updates several
 * tasks holds the graph lock and locks them by id. Keeping that order
 * everywhere means no two writers can wait on each other (no deadlock).
 */
import type {Queryable} from '../db/db.ts';

/** Namespace of the per-organization dependency-graph lock. */
const GRAPH_LOCK_CLASS = 727_274_002;
/** Namespace of the per-organization catalogue lock. */
const CATALOGUE_LOCK_CLASS = 727_274_003;

export async function lockGraph(
  tx: Queryable,
  organizationId: string,
): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [
    GRAPH_LOCK_CLASS,
    organizationId,
  ]);
}

export async function lockCatalogue(
  tx: Queryable,
  organizationId: string,
): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [
    CATALOGUE_LOCK_CLASS,
    organizationId,
  ]);
}
