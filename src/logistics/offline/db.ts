/**
 * The Logistics Manager's copy on this device (M6): its own IndexedDB
 * database (`oxeye-logistics`), separate from the simulator's
 * `OxEyeDatabase` (`src/db/repository.ts`), which is never touched here.
 *
 * What it keeps, always per user and organization:
 * - the lists as the viewer received them, after `withholdFor` (a guest's
 *   copy never holds a withheld value, even if the server sent one);
 * - the outbox: writes saved without coverage, replayed in order later;
 * - the `…/changes` cursor and the organizations seen at the last sign-in.
 *
 * Shared devices («Equipo» login): logout and switching organization wipe
 * the whole database; signing in as someone else wipes it first. Every call
 * fails soft (private mode, storage full, no IndexedDB): the app then works
 * as before, online only, and says so where it matters.
 */
import Dexie, {type Table} from 'dexie';
import type {
  Organization,
  Role,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';
import type {OutboxEntry} from '../../../shared/logistics/outbox.ts';
import type {SyncList} from '../../../shared/logistics/sync.ts';

export const DEVICE_DB_NAME = 'oxeye-logistics';

interface ListRow {
  /** `${userId}|${orgId}|${list}` */
  key: string;
  userId: string;
  orgId: string;
  list: SyncList;
  items: unknown[];
  savedAt: number;
}

interface MetaRow {
  key: string;
  value: unknown;
}

/** What the device remembers about the last session of a user. */
export interface CachedSession {
  user: SessionUser;
  organizations: Organization[];
  orgId: string | null;
  savedAt: number;
}

/**
 * Whose data the device holds. The role counts too: a member turned guest
 * under the same id must not open the member's copy (withheld fields).
 */
export interface DeviceOwner {
  userId: string;
  role: Role;
}

class LogisticsDeviceDb extends Dexie {
  lists!: Table<ListRow, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super(DEVICE_DB_NAME);
    this.version(1).stores({
      lists: 'key, [userId+orgId]',
      outbox: 'id, [userId+orgId], seq',
      meta: 'key',
    });
  }
}

let db: LogisticsDeviceDb | null = null;
let unavailable = false;

function open(): LogisticsDeviceDb | null {
  if (unavailable) return null;
  if (db) return db;
  try {
    if (typeof indexedDB === 'undefined') {
      unavailable = true;
      return null;
    }
    db = new LogisticsDeviceDb();
    return db;
  } catch {
    unavailable = true;
    return null;
  }
}

async function soft<T>(
  run: (d: LogisticsDeviceDb) => Promise<T>,
  fallback: T,
): Promise<T> {
  const d = open();
  if (!d) return fallback;
  try {
    return await run(d);
  } catch {
    return fallback;
  }
}

const listKey = (userId: string, orgId: string, list: SyncList) =>
  `${userId}|${orgId}|${list}`;
const cursorKey = (userId: string, orgId: string) =>
  `cursor|${userId}|${orgId}`;
const sessionKey = (userId: string) => `session|${userId}`;
const OWNER_KEY = 'owner';

// ---------------------------------------------------------------- lists

export function saveList(
  userId: string,
  orgId: string,
  list: SyncList,
  items: unknown[],
): Promise<void> {
  return soft(async d => {
    await d.lists.put({
      key: listKey(userId, orgId, list),
      userId,
      orgId,
      list,
      items,
      savedAt: Date.now(),
    });
  }, undefined);
}

export interface CachedLists {
  lists: Partial<Record<SyncList, unknown[]>>;
  /** When the newest list was saved (null when there is none). */
  savedAt: number | null;
}

/** Every cached list of a user and organization (empty when none). */
export function loadLists(userId: string, orgId: string): Promise<CachedLists> {
  return soft(
    async d => {
      const rows = await d.lists
        .where('[userId+orgId]')
        .equals([userId, orgId])
        .toArray();
      const lists: Partial<Record<SyncList, unknown[]>> = {};
      let savedAt: number | null = null;
      for (const row of rows) {
        if (!Array.isArray(row.items)) continue;
        lists[row.list] = row.items;
        savedAt = Math.max(savedAt ?? 0, row.savedAt);
      }
      return {lists, savedAt};
    },
    {lists: {}, savedAt: null},
  );
}

// ---------------------------------------------------------------- outbox

export function loadOutbox(
  userId: string,
  orgId: string,
): Promise<OutboxEntry[]> {
  return soft(
    d => d.outbox.where('[userId+orgId]').equals([userId, orgId]).sortBy('seq'),
    [] as OutboxEntry[],
  );
}

/**
 * Stores one entry. Unlike the cache, a failure here matters (the change
 * would only live in memory), so it is reported to the caller.
 */
export async function putEntry(entry: OutboxEntry): Promise<boolean> {
  const d = open();
  if (!d) return false;
  try {
    await d.outbox.put(entry);
    return true;
  } catch {
    return false;
  }
}

export function deleteEntry(id: string): Promise<void> {
  return soft(async d => {
    await d.outbox.delete(id);
  }, undefined);
}

// ---------------------------------------------------------------- meta

export function saveCursor(
  userId: string,
  orgId: string,
  cursor: string | null,
): Promise<void> {
  return soft(async d => {
    if (cursor) {
      await d.meta.put({key: cursorKey(userId, orgId), value: cursor});
    } else await d.meta.delete(cursorKey(userId, orgId));
  }, undefined);
}

export function loadCursor(
  userId: string,
  orgId: string,
): Promise<string | null> {
  return soft(async d => {
    const row = await d.meta.get(cursorKey(userId, orgId));
    return typeof row?.value === 'string' ? row.value : null;
  }, null);
}

export function saveSession(session: CachedSession): Promise<void> {
  const owner: DeviceOwner = {
    userId: session.user.id,
    role: session.user.role,
  };
  return soft(async d => {
    await d.meta.bulkPut([
      {key: sessionKey(session.user.id), value: session},
      {key: OWNER_KEY, value: owner},
    ]);
  }, undefined);
}

export function loadSession(userId: string): Promise<CachedSession | null> {
  return soft(async d => {
    const row = await d.meta.get(sessionKey(userId));
    const value = row?.value as CachedSession | undefined;
    return value &&
      value.user?.id === userId &&
      Array.isArray(value.organizations)
      ? value
      : null;
  }, null);
}

/**
 * The user whose data this device holds, if any. `role` is null for a copy
 * saved before the role was recorded: it never matches, so it is wiped.
 */
export function cacheOwner(): Promise<{
  userId: string;
  role: Role | null;
} | null> {
  return soft(async d => {
    const value = (await d.meta.get(OWNER_KEY))?.value;
    if (typeof value === 'string') return {userId: value, role: null};
    if (!value || typeof value !== 'object') return null;
    const {userId, role} = value as Partial<DeviceOwner>;
    if (typeof userId !== 'string') return null;
    return {userId, role: role === 'member' || role === 'guest' ? role : null};
  }, null);
}

/** Whether the device's copy belongs to this user, with this role. */
export function ownedBy(
  owner: {userId: string; role: Role | null} | null,
  user: SessionUser,
): boolean {
  return !owner || (owner.userId === user.id && owner.role === user.role);
}

/**
 * Set while a wipe has not completed: the next boot wipes again before it
 * opens anything from the device (localStorage, so it survives a broken
 * IndexedDB).
 */
const WIPE_PENDING_KEY = 'oxeye.logistics.wipePending.v1';

function markWipePending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(WIPE_PENDING_KEY, '1');
    else localStorage.removeItem(WIPE_PENDING_KEY);
  } catch {
    // No localStorage: nothing to remember the retry with.
  }
}

/** Whether an earlier wipe did not complete. */
export function wipePending(): boolean {
  try {
    return localStorage.getItem(WIPE_PENDING_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Empties the whole database: cache, outbox, cursors and sessions. False
 * when it could not; the flag then stays and the next boot tries again.
 */
export async function wipeDevice(): Promise<boolean> {
  // Raised first: a tab closed halfway through also retries.
  markWipePending(true);
  const d = open();
  if (!d) {
    // Without IndexedDB there is nothing to read either; keep the flag for
    // a later session in which it works.
    return false;
  }
  try {
    await d.transaction('rw', d.lists, d.outbox, d.meta, async () => {
      await Promise.all([d.lists.clear(), d.outbox.clear(), d.meta.clear()]);
    });
  } catch {
    try {
      // Last resort: drop the database itself.
      d.close();
      db = null;
      await Dexie.delete(DEVICE_DB_NAME);
    } catch {
      return false;
    }
  }
  markWipePending(false);
  return true;
}
