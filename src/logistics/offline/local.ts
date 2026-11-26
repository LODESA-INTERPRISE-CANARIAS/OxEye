/**
 * Device-side helpers for the outbox (M6), with no React and no store: what
 * a list shows while writes wait to be sent, the label of a queued write and
 * whether a 409 is only the user's own change coming back. The rules
 * themselves live in `shared/logistics/` (outbox.ts, optimistic.ts, sync.ts).
 */
import type {
  Company,
  Contact,
  LogisticsEvent,
  Note,
  NoteRefType,
  Offer,
  Resource,
  Task,
  UserRef,
  Uuid,
  Venue,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';
import {noteLabel} from '../../../shared/logistics/history.ts';
import {
  optimisticRecord,
  type OptimisticContext,
  type OptimisticRecord,
} from '../../../shared/logistics/optimistic.ts';
import type {
  OutboxEntity,
  OutboxEntry,
} from '../../../shared/logistics/outbox.ts';
import type {SyncList} from '../../../shared/logistics/sync.ts';

/** The store list each outbox type lives in. */
export const LIST_OF = {
  event: 'events',
  task: 'tasks',
  company: 'companies',
  contact: 'contacts',
  offer: 'offers',
  warehouse: 'warehouses',
  resource: 'resources',
  note: 'notes',
} as const satisfies Record<OutboxEntity, SyncList>;

export type RecordListKey = (typeof LIST_OF)[OutboxEntity];

/** A v4 UUID; `crypto.randomUUID` is missing on plain-http LAN addresses. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The lists an optimistic record is built from. */
export interface LocalLists {
  events: LogisticsEvent[];
  venues: Venue[];
  tasks: Task[];
  companies: Company[];
  contacts: Contact[];
  offers: Offer[];
  warehouses: Warehouse[];
  resources: Resource[];
}

export function buildContext(
  lists: LocalLists,
  user: UserRef,
  orgId: Uuid,
  timezone: string,
  now: string,
): OptimisticContext {
  const refLabel = (type: NoteRefType, id: Uuid): string | null => {
    switch (type) {
      case 'task':
        return lists.tasks.find(t => t.id === id)?.title ?? null;
      case 'company':
        return lists.companies.find(c => c.id === id)?.name ?? null;
      case 'contact':
        return lists.contacts.find(c => c.id === id)?.name ?? null;
      case 'offer':
        return lists.offers.find(o => o.id === id)?.name ?? null;
      case 'warehouse':
        return lists.warehouses.find(w => w.id === id)?.name ?? null;
      case 'resource':
        return lists.resources.find(r => r.id === id)?.name ?? null;
      default:
        return null;
    }
  };
  return {
    user,
    now,
    orgId,
    timezone,
    venues: lists.venues,
    companies: lists.companies,
    contacts: lists.contacts,
    events: lists.events,
    warehouses: lists.warehouses,
    refLabel,
  };
}

/** A record's name for labels: title, name or `noteLabel` (never text). */
export function recordName(
  entity: OutboxEntity,
  record: OptimisticRecord | null | undefined,
): string {
  if (!record) return '';
  if (entity === 'task') return (record as Task).title ?? '';
  if (entity === 'note') return noteLabel(record as Note);
  return (record as {name?: string}).name ?? '';
}

const UNRESOLVED = new Set(['pending', 'sending', 'conflict', 'rejected']);

export const isUnresolved = (e: OutboxEntry) => UNRESOLVED.has(e.status);

/**
 * Whether the list shows this entry's change. Waiting writes always do; a
 * create stuck in a conflict or rejected stays visible so it can be found;
 * an update stuck in a conflict or rejected shows the server's copy (the
 * change was not applied, and nothing is overwritten).
 */
export function overlays(e: OutboxEntry): boolean {
  if (e.status === 'pending' || e.status === 'sending') return true;
  return e.op === 'create' && isUnresolved(e);
}

const recordCache = new WeakMap<
  OutboxEntry,
  {prior: unknown; ctx: unknown; record: OptimisticRecord}
>();

/** `optimisticRecord` for one entry over `prior`, memoised per entry. */
export function entryRecord(
  entry: OutboxEntry,
  prior: OptimisticRecord | null,
  ctx: OptimisticContext,
): OptimisticRecord {
  const hit = recordCache.get(entry);
  if (hit && hit.prior === prior && hit.ctx === ctx) return hit.record;
  const record = optimisticRecord(entry.entity, entry.input, prior, ctx);
  recordCache.set(entry, {prior, ctx, record});
  return record;
}

const sameJson = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The list with the device's waiting changes applied, in the list's order.
 * `serverCopy` holds the latest server copy of records with entries; ids in
 * `gone` were deleted on the server and are never brought back by an update.
 * Returns `list` itself when nothing changes.
 */
export function overlayList<T extends {id: string}>(
  list: T[],
  entries: readonly OutboxEntry[],
  entity: OutboxEntity,
  ctxFor: (entry: OutboxEntry) => OptimisticContext,
  serverCopy: ReadonlyMap<string, unknown>,
  gone: ReadonlySet<string>,
  sort: (list: T[]) => T[],
): T[] {
  const relevant = entries
    .filter(e => e.entity === entity && overlays(e))
    .sort((a, b) => a.seq - b.seq);
  if (!relevant.length) return list;
  const byId = new Map(list.map(r => [r.id, r]));
  const acc = new Map<string, OptimisticRecord>();
  for (const e of relevant) {
    if (e.op === 'update' && gone.has(e.recordId)) continue;
    const prior =
      acc.get(e.recordId) ??
      (e.op === 'create'
        ? null
        : ((serverCopy.get(e.recordId) as OptimisticRecord | undefined) ??
          (byId.get(e.recordId) as unknown as OptimisticRecord | undefined) ??
          (e.base as OptimisticRecord | null) ??
          null));
    if (e.op === 'update' && !prior) continue;
    acc.set(e.recordId, entryRecord(e, prior, ctxFor(e)));
  }
  let changed = false;
  for (const [id, record] of acc) {
    const current = byId.get(id);
    if (current && sameJson(current, record)) continue;
    byId.set(id, record as unknown as T);
    changed = true;
  }
  return changed ? sort([...byId.values()]) : list;
}

/** Fields that change on every save, not part of what the user changed. */
const META_KEYS = new Set([
  'version',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'restricted',
  'isDemo',
  'contactCount',
  'offerCount',
  'resourceCount',
  'taskIds',
]);

/** Comparable shape: meta dropped, embedded references by name only. */
function comparable(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map(v => comparable(v, false));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      !top &&
      keys.includes('id') &&
      keys.includes('name') &&
      keys.length <= 3
    ) {
      return String(obj.name ?? '')
        .trim()
        .toLocaleLowerCase('es');
    }
    // A note's link: what it points at, not the label shown for it.
    if (!top && keys.includes('id') && keys.includes('label')) {
      return `${String(obj.type ?? '')}:${String(obj.id)}`;
    }
    // A declared review: whether there is one, not who or when.
    if (!top && 'by' in obj && 'at' in obj) return true;
    const out: Record<string, unknown> = {};
    for (const k of keys.sort()) {
      if (top && META_KEYS.has(k)) continue;
      out[k] = comparable(obj[k], false);
    }
    return out;
  }
  return value;
}

/**
 * A replayed write answered 409 with `current`: when applying the queued
 * change to `current` changes nothing, the change is already there (the
 * user's own lost response, or the same change made by someone else) and
 * the entry resolves without asking anyone.
 */
export function alreadyApplied(
  entry: OutboxEntry,
  current: unknown,
  ctx: OptimisticContext,
): boolean {
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return false;
  }
  const applied = optimisticRecord(
    entry.entity,
    entry.input,
    current as OptimisticRecord,
    ctx,
  );
  return sameJson(comparable(applied), comparable(current));
}
