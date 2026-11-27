/**
 * Creates with a device id (M6). An offline device generates the UUID of a
 * record it creates, so the queued create can be sent again after a lost
 * answer without duplicating the record, and other queued writes can point
 * at it before the server has seen it.
 *
 * Rules, the same for every record type:
 * - no row of the table has the id → create it with that id (201);
 * - a row of the table has it, in the same organization and created by the
 *   same user → a replay: 200 with the record as it is now; nothing is
 *   written, no activity, no find-or-create side effects;
 * - any other existing use (other organization, other user) → 400
 *   `fields.id`, and nothing about that record is revealed.
 *
 * The check runs inside the create transaction right after the locks the
 * create takes and before anything else. Creates that hold the catalogue
 * lock see a committed replay there; the others (events, tasks without
 * catalogue links) can race: the second insert then fails on the primary key,
 * PostgreSQL aborts its transaction, and `createOnce` answers it as the
 * replay from a fresh transaction.
 */
import type {Db, Queryable} from '../db/db.ts';
import {pgErrorCode, UNIQUE_VIOLATION} from '../db/db.ts';
import {validationError} from '../errors.ts';
import {uuid} from '../http/validate.ts';

/** Tables whose create accepts a device id. Constant names, never input. */
export type DeviceIdTable =
  | 'events'
  | 'tasks'
  | 'companies'
  | 'contacts'
  | 'offers'
  | 'warehouses'
  | 'resources'
  | 'notes'
  /** Revisión 1 · E3: image uploads. */
  | 'media'
  /** Revisión 1 · E5: expenses (never queued offline, but safe to retry). */
  | 'expenses';

export const ID_IN_USE = 'Este identificador ya está en uso.';

/** The optional `id` of a create body, lower-cased. */
export const deviceIdField = uuid.transform(v => v.toLowerCase()).optional();

/** What a create returns: the record, and whether it was a replay (200). */
export interface Created<T> {
  record: T;
  replayed: boolean;
}

export interface DeviceCreate<T> {
  table: DeviceIdTable;
  /** The device id sent by the client, if any (lower-case). */
  id: string | undefined;
  /** As sent in the body; membership is checked by the create itself. */
  organizationId: string;
  actorId: string;
  /** The record as the actor may see it now (through `forViewer`). */
  load: (q: Queryable, id: string) => Promise<T | undefined>;
}

export function fresh<T>(record: T): Created<T> {
  return {record, replayed: false};
}

/**
 * The replay answer when `spec.id` is already this actor's record of the
 * table in `organizationId`; null when no id was sent or it is free. Any other
 * existing use → 400 `fields.id`. Call it inside the create transaction,
 * after the create's locks and before any validation or side effect.
 */
export async function findReplay<T>(
  q: Queryable,
  spec: DeviceCreate<T>,
  organizationId: string,
): Promise<Created<T> | null> {
  if (spec.id === undefined) return null;
  const rows = await q.query<{organization_id: string; created_by: string}>(
    `SELECT organization_id, created_by FROM ${spec.table} WHERE id = $1`,
    [spec.id],
  );
  const owner = rows[0];
  if (!owner) return null;
  if (
    owner.organization_id !== organizationId.toLowerCase() ||
    owner.created_by !== spec.actorId
  ) {
    throw validationError({id: ID_IN_USE});
  }
  const record = await spec.load(q, spec.id);
  if (record === undefined) throw new Error(`${spec.table} row vanished`);
  return {record, replayed: true};
}

/**
 * Runs a create transaction. When it fails on a unique violation and a row
 * with the device id now exists, a concurrent replay won the race: the
 * answer is that replay (or 400 when the id is someone else's).
 */
export async function createOnce<T>(
  db: Db,
  spec: DeviceCreate<T>,
  run: (tx: Queryable) => Promise<Created<T>>,
): Promise<Created<T>> {
  try {
    return await db.transaction(run);
  } catch (err) {
    if (spec.id === undefined || pgErrorCode(err) !== UNIQUE_VIOLATION) {
      throw err;
    }
    const replay = await db.transaction(tx =>
      findReplay(tx, spec, spec.organizationId),
    );
    if (replay) return replay;
    throw err;
  }
}
