/**
 * The device's outbox (M6): writes saved without coverage, replayed in order
 * when the server answers again. Pure list operations; the device stores the
 * entries in its own IndexedDB database (never `src/db/repository.ts`).
 *
 * Safety rules (M4–M5 audits):
 * - Only members queue, and only creates and updates of the eight record
 *   types below. Never queued: deletes, applying a hypothesis (it always
 *   needs a live confirmation on the current plan), demo removal, category
 *   deletes, hypotheses, recent searches. Guests never queue anything.
 * - Every queued update carries the `version` it was made from; a 409 is a
 *   conflict for a person to merge, never overwritten.
 * - A queued `subsoilReviewed: true` is dropped before replay when the
 *   server's copy changed venue, heavy load or resources since the edit
 *   (`guardSubsoil`): the review was for the placement the user saw.
 * - Entries are tied to the user and organization that made them; the device
 *   clears them on logout and on switching organization.
 * - `label` is a record name or `noteLabel`, never note text or observations.
 */
import type {Role, Uuid} from './contracts.ts';
import {sameValue} from './merge.ts';

export type OutboxEntity =
  | 'event'
  | 'task'
  | 'company'
  | 'contact'
  | 'offer'
  | 'warehouse'
  | 'resource'
  | 'note';

export const OUTBOX_ENTITIES: readonly OutboxEntity[] = [
  'event',
  'task',
  'company',
  'contact',
  'offer',
  'warehouse',
  'resource',
  'note',
];

export type OutboxOp = 'create' | 'update';

export type OutboxStatus =
  /** Waiting to be sent (or to be retried at `nextAttemptAt`). */
  | 'pending'
  /** In flight right now. */
  | 'sending'
  /** 409: someone changed the record, or the name exists. */
  | 'conflict'
  /** The server refused the content; a person fixes or discards it. */
  | 'rejected';

export interface OutboxError {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export interface OutboxEntry {
  /** Entry id (a UUID). */
  id: string;
  /** Replay order. */
  seq: number;
  userId: Uuid;
  orgId: Uuid;
  entity: OutboxEntity;
  op: OutboxOp;
  /** The record: a device-generated id for a create. */
  recordId: Uuid;
  /** The API body. A create carries `id`; an update carries `version`. */
  input: Record<string, unknown>;
  /** Update: the record as the user saw it when editing (merge base). */
  base: unknown;
  /** The form values, for the merge sheet (shape owned by the UI). */
  values: unknown;
  /** «Nueva tarea · Montaje», never free text. */
  label: string;
  queuedAt: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; null = as soon as possible. */
  nextAttemptAt: number | null;
  error: OutboxError | null;
  /** The server's copy that came with a 409. */
  current: unknown;
  /** Fields removed before sending, e.g. `subsoilReviewed`. */
  dropped: string[];
}

/** The version every record has right after its create. */
export const CREATED_VERSION = 1;

/** Members queue creates and updates of the outbox types; guests never. */
export function canQueue(role: Role, entity: string, op: string): boolean {
  return (
    role === 'member' &&
    (OUTBOX_ENTITIES as readonly string[]).includes(entity) &&
    (op === 'create' || op === 'update')
  );
}

const UNRESOLVED: ReadonlySet<OutboxStatus> = new Set([
  'pending',
  'sending',
  'conflict',
  'rejected',
]);

/** Entries of this user and organization only, in replay order. */
export function entriesFor(
  entries: readonly OutboxEntry[],
  userId: Uuid,
  orgId: Uuid,
): OutboxEntry[] {
  return entries
    .filter(e => e.userId === userId && e.orgId === orgId)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Adds a write. An edit of a record whose earlier entry has never been sent
 * folds into it (one request, one version): a create stays a create with
 * the later fields; an update keeps the first `version` and `base`.
 * Anything else is appended after the last entry, in particular an edit of
 * an entry that was sent once already: its response may have been lost and
 * the server may hold the first content, so folding would lose the edit
 * (a replayed create answers with what it stored). A create never folds
 * into an earlier update.
 */
export function enqueue(
  entries: readonly OutboxEntry[],
  next: OutboxEntry,
): OutboxEntry[] {
  const idx =
    next.op !== 'update'
      ? -1
      : findLastIndex(
          entries,
          e =>
            e.entity === next.entity &&
            e.recordId === next.recordId &&
            e.status === 'pending' &&
            e.attempts === 0 &&
            e.error === null &&
            e.userId === next.userId &&
            e.orgId === next.orgId,
        );
  if (idx === -1) {
    const seq = entries.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    return [...entries, {...next, seq}];
  }
  const prev = entries[idx];
  const input: Record<string, unknown> = {...prev.input, ...next.input};
  if (prev.op === 'create') {
    delete input.version;
    input.id = prev.recordId;
  } else {
    input.version = prev.input.version;
  }
  const folded: OutboxEntry = {
    ...prev,
    input,
    values: next.values,
    label: next.label,
  };
  return entries.map((e, i) => (i === idx ? folded : e));
}

/** UUID-looking strings anywhere in an input (ids, id lists, refs). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function referencedIds(value: unknown, out = new Set<string>()) {
  if (typeof value === 'string') {
    if (UUID_RE.test(value)) out.add(value.toLowerCase());
  } else if (Array.isArray(value)) {
    for (const v of value) referencedIds(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) referencedIds(v, out);
  }
  return out;
}

/**
 * The next entry to send, or null. An entry waits while an earlier entry of
 * the same record is unresolved, and while an earlier unresolved create of a
 * record it points at (e.g. a note about a resource created offline) has not
 * gone through. Other records are not held up by one conflict.
 */
export function nextToSend(
  entries: readonly OutboxEntry[],
  now: number,
): OutboxEntry | null {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  if (ordered.some(e => e.status === 'sending')) return null;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (e.status !== 'pending') continue;
    if (e.nextAttemptAt !== null && e.nextAttemptAt > now) continue;
    const refs = referencedIds(e.input);
    refs.delete(e.recordId.toLowerCase());
    const blocked = ordered
      .slice(0, i)
      .some(
        p =>
          UNRESOLVED.has(p.status) &&
          (p.recordId === e.recordId ||
            (p.op === 'create' && refs.has(p.recordId.toLowerCase()))),
      );
    if (!blocked) return e;
  }
  return null;
}

/**
 * After the server accepted a write of `recordId` (local version `from`,
 * server version now `to`): later entries of that record made from `from`
 * now carry `to`, because the change in between was this user's own.
 * A create's local version is 0.
 */
export function rebaseVersions(
  entries: readonly OutboxEntry[],
  recordId: Uuid,
  from: number,
  to: number,
): OutboxEntry[] {
  return entries.map(e =>
    e.recordId === recordId && e.op === 'update' && e.input.version === from
      ? {...e, input: {...e.input, version: to}}
      : e,
  );
}

/**
 * The server accepted a queued write (or answered with a copy that already
 * holds it). Returns the other entries, rebased only where the change in
 * between was certainly this user's own:
 * - a create: later entries made from the local copy (version 0) carry
 *   CREATED_VERSION, never the server's current version (a replay answers
 *   with the record as it is now, maybe after someone else's edit);
 * - an update: only when the server's version is exactly the next one.
 * Otherwise later entries keep their version and meet a 409, which goes
 * through the merge instead of overwriting someone else's change.
 */
export function settleAccepted(
  entries: readonly OutboxEntry[],
  entry: OutboxEntry,
  savedVersion: number,
): OutboxEntry[] {
  const rest = entries.filter(e => e.id !== entry.id);
  if (entry.op === 'create') {
    return rebaseVersions(rest, entry.recordId, 0, CREATED_VERSION);
  }
  const from = Number(entry.input.version ?? NaN);
  return savedVersion === from + 1
    ? rebaseVersions(rest, entry.recordId, from, savedVersion)
    : rest;
}

interface SubsoilShape {
  venue?: {id: string; name?: string} | null;
  heavyLoad?: boolean | null;
  resourceIds?: string[];
  version?: number;
}

/**
 * Before replaying a task update that declares «Subsuelo revisado»: if the
 * server's copy (`current`, from the latest refresh) has another venue,
 * heavy load or resources than the copy the user edited (`entry.base`), the
 * declaration is dropped (`dropped: ['subsoilReviewed']`) and the rest is
 * sent. Unknown `current` → unchanged (the server's version check decides).
 */
export function guardSubsoil(
  entry: OutboxEntry,
  current: unknown,
): OutboxEntry {
  if (
    entry.entity !== 'task' ||
    entry.op !== 'update' ||
    entry.input.subsoilReviewed !== true ||
    !entry.base ||
    !current
  ) {
    return entry;
  }
  const base = entry.base as SubsoilShape;
  const now = current as SubsoilShape;
  if (base.version !== undefined && base.version === now.version) return entry;
  const sameVenue = (base.venue?.id ?? null) === (now.venue?.id ?? null);
  const sameLoad = (base.heavyLoad ?? null) === (now.heavyLoad ?? null);
  const sameResources = sameValue(
    [...(base.resourceIds ?? [])].sort(),
    [...(now.resourceIds ?? [])].sort(),
  );
  if (sameVenue && sameLoad && sameResources) return entry;
  const input = {...entry.input};
  delete input.subsoilReviewed;
  return {
    ...entry,
    input,
    dropped: [...new Set([...entry.dropped, 'subsoilReviewed'])],
  };
}

/** Counts for the sync chip. */
export function outboxCounts(entries: readonly OutboxEntry[]): {
  pending: number;
  needsReview: number;
} {
  let pending = 0;
  let needsReview = 0;
  for (const e of entries) {
    if (e.status === 'pending' || e.status === 'sending') pending++;
    else if (e.status === 'conflict' || e.status === 'rejected') needsReview++;
  }
  return {pending, needsReview};
}

/** Records with something still on this device («Pendiente de enviar»). */
export function unsentRecordIds(entries: readonly OutboxEntry[]): Set<Uuid> {
  return new Set(
    entries.filter(e => UNRESOLVED.has(e.status)).map(e => e.recordId),
  );
}

export const OUTBOX_ENTITY_NOUN: Record<OutboxEntity, string> = {
  event: 'evento',
  task: 'tarea',
  company: 'empresa o entidad',
  contact: 'persona',
  offer: 'oferta',
  warehouse: 'almacén',
  resource: 'recurso',
  note: 'nota',
};

const NEW_WORD: Record<OutboxEntity, string> = {
  event: 'Nuevo evento',
  task: 'Nueva tarea',
  company: 'Nueva empresa o entidad',
  contact: 'Nueva persona',
  offer: 'Nueva oferta',
  warehouse: 'Nuevo almacén',
  resource: 'Nuevo recurso',
  note: 'Nueva nota',
};

/**
 * «Nueva tarea · Montaje», «Cambios en la tarea · Montaje». `name` must be
 * the record's name, or `noteLabel(note)` for notes: never their text.
 */
export function outboxLabel(
  entity: OutboxEntity,
  op: OutboxOp,
  name: string,
): string {
  const head =
    op === 'create'
      ? NEW_WORD[entity]
      : `Cambios en ${ARTICLE[entity]} ${OUTBOX_ENTITY_NOUN[entity]}`;
  const clean = name.trim();
  return clean ? `${head} · ${clean}` : head;
}

const ARTICLE: Record<OutboxEntity, string> = {
  event: 'el',
  task: 'la',
  company: 'la',
  contact: 'la',
  offer: 'la',
  warehouse: 'el',
  resource: 'el',
  note: 'la',
};

function findLastIndex<T>(list: readonly T[], test: (v: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
  return -1;
}
