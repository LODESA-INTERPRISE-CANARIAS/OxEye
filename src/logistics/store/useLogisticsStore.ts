/**
 * State of the Logistics Manager window: server availability, session,
 * selected organization and the records shown on screen.
 *
 * Kept separate from the simulator store on purpose: the module is lazy-loaded
 * and must not touch the simulation state.
 */
import {create} from 'zustand';
import type {
  ActivityEntry,
  Category,
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  CreateEventInput,
  LogisticsEvent,
  Offer,
  OfferInput,
  Organization,
  RecentSearch,
  SessionUser,
  Task,
  TaskInput,
  UpdateEventInput,
  Venue,
} from '../../../shared/logistics/contracts.ts';
import {RECENT_SEARCHES_KEPT} from '../../../shared/logistics/rules.ts';
import {normalize} from '../../../shared/logistics/search.ts';
import {
  ApiError,
  errorMessage,
  isApiError,
  resolveApiBaseUrl,
} from '../api/client';
import {api} from '../api/endpoints';
import {sortCompanies, sortContacts, sortOffers} from '../lib/directory';
import {sortEvents} from '../lib/events';
import {sortTasks} from '../lib/tasks';

export type Phase =
  | 'checking'
  | 'not_configured'
  | 'unreachable'
  | 'login'
  | 'restoring'
  | 'ready';

/** Why the server is not usable when `phase === 'unreachable'`. */
export type UnreachableReason = 'network' | 'database';

/** What the sync chip shows. */
export type Connection = 'online' | 'offline' | 'unavailable';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface StoredSession {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

const SESSION_KEY = 'oxeye.logistics.session.v1';
const ORG_KEY = 'oxeye.logistics.org.v1';

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed.user) return null;
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage may be unavailable (private mode); the session then lasts the tab.
  }
}

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

function writeStoredOrg(id: string | null): void {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    // Ignore: the selection simply is not remembered.
  }
}

/**
 * Recent searches of a guest stay on this device (a shared login must not
 * show one guest's searches to the next), per organization.
 */
const RECENT_KEY = 'oxeye.logistics.recent.v1';

function readDeviceRecent(orgId: string): RecentSearch[] {
  try {
    const raw = localStorage.getItem(`${RECENT_KEY}:${orgId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentSearch =>
          !!r &&
          typeof (r as RecentSearch).query === 'string' &&
          typeof (r as RecentSearch).at === 'string',
      )
      .slice(0, RECENT_SEARCHES_KEPT);
  } catch {
    return [];
  }
}

function writeDeviceRecent(orgId: string, list: RecentSearch[]): void {
  try {
    if (list.length) {
      localStorage.setItem(`${RECENT_KEY}:${orgId}`, JSON.stringify(list));
    } else {
      localStorage.removeItem(`${RECENT_KEY}:${orgId}`);
    }
  } catch {
    // Not remembered on this device; the search itself still works.
  }
}

/** Puts `query` first, without accent/case duplicates, keeping five. */
function pushRecentSearch(list: RecentSearch[], query: string): RecentSearch[] {
  const q = query.trim();
  if (!q) return list;
  const key = normalize(q);
  return [
    {query: q, at: new Date().toISOString()},
    ...list.filter(r => normalize(r.query) !== key),
  ].slice(0, RECENT_SEARCHES_KEPT);
}

/** The server copy carried by a 409 VERSION_CONFLICT, if any. */
function conflictCopy<T>(err: unknown): T | null {
  return isApiError(err) &&
    err.code === 'VERSION_CONFLICT' &&
    err.current &&
    typeof err.current === 'object'
    ? (err.current as T)
    : null;
}

function pickOrg(
  orgs: Organization[],
  preferred: string | null,
): string | null {
  if (preferred && orgs.some(o => o.id === preferred)) return preferred;
  return orgs[0]?.id ?? null;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export interface LogisticsState {
  phase: Phase;
  unreachableReason: UnreachableReason;
  connection: Connection;
  session: StoredSession | null;
  organizations: Organization[];
  orgId: string | null;
  /** Message shown on the login screen (e.g. expired session). */
  sessionNotice: string | null;

  events: LogisticsEvent[];
  eventsState: LoadState;
  eventsError: string | null;
  venues: Venue[];
  tasks: Task[];
  tasksState: LoadState;
  tasksError: string | null;
  companies: Company[];
  companiesState: LoadState;
  companiesError: string | null;
  /** Service and resource categories (built-ins first, then custom). */
  categories: Category[];
  contacts: Contact[];
  contactsState: LoadState;
  contactsError: string | null;
  offers: Offer[];
  offersState: LoadState;
  offersError: string | null;
  /** The current user's five recent searches, newest first. */
  recentSearches: RecentSearch[];
  recentState: LoadState;
  activity: ActivityEntry[];
  activityState: LoadState;
  activityError: string | null;
  lastSyncAt: number | null;

  toasts: Toast[];

  boot: () => Promise<void>;
  login: (displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectOrg: (id: string) => void;
  refresh: (options?: {silent?: boolean}) => Promise<void>;
  createEvent: (
    input: Omit<CreateEventInput, 'organizationId'>,
  ) => Promise<LogisticsEvent>;
  updateEvent: (id: string, input: UpdateEventInput) => Promise<LogisticsEvent>;
  /** Puts a server copy of an event in the list (e.g. after a conflict). */
  upsertEvent: (event: LogisticsEvent) => void;
  createTask: (
    input: Omit<TaskInput, 'organizationId' | 'version'>,
  ) => Promise<Task>;
  /** `input.version` is required. */
  updateTask: (id: string, input: TaskInput) => Promise<Task>;
  /** Deletes with the version the user saw (409 if it changed since). */
  deleteTask: (task: Task) => Promise<void>;
  /** Puts a server copy of a task in the list (e.g. after a conflict). */
  upsertTask: (task: Task) => void;

  /** Finds or creates a service category by name (any case). */
  createCategory: (name: string) => Promise<Category>;
  createCompany: (
    input: Omit<CompanyInput, 'organizationId' | 'version'>,
  ) => Promise<Company>;
  /** `input.version` is required. 409 VERSION_CONFLICT or DUPLICATE. */
  updateCompany: (id: string, input: CompanyInput) => Promise<Company>;
  /** Deletes its offers; its people and tasks lose the company. */
  deleteCompany: (company: Company) => Promise<void>;
  upsertCompany: (company: Company) => void;
  createContact: (
    input: Omit<ContactInput, 'organizationId' | 'version'>,
  ) => Promise<Contact>;
  updateContact: (id: string, input: ContactInput) => Promise<Contact>;
  /** Tasks and a company that had them as main contact lose the link. */
  deleteContact: (contact: Contact) => Promise<void>;
  upsertContact: (contact: Contact) => void;
  createOffer: (
    input: Omit<OfferInput, 'organizationId' | 'version'>,
  ) => Promise<Offer>;
  updateOffer: (id: string, input: OfferInput) => Promise<Offer>;
  deleteOffer: (offer: Offer) => Promise<void>;
  upsertOffer: (offer: Offer) => void;

  /** Loads the recent searches (server for members, device for guests). */
  loadRecentSearches: () => Promise<void>;
  /** Records a query the user opened a result for or submitted. */
  recordSearch: (query: string) => void;
  clearRecentSearches: () => Promise<void>;

  removeDemo: () => Promise<number>;
  setBrowserOnline: (online: boolean) => void;
  toast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

/**
 * Bumped whenever this tab changes the event list from a write it made
 * (create, update, conflict copy, demo removal). A refresh whose request
 * started under an older epoch may predate that write, so its event list is
 * dropped: every write triggers its own follow-up refresh.
 */
let writeEpoch = 0;
/** Same as `writeEpoch`, for the task list. */
let taskEpoch = 0;
/** Same as `writeEpoch`, for the directory lists (milestone 3). */
let companyEpoch = 0;
let contactEpoch = 0;
let offerEpoch = 0;
let categoryEpoch = 0;

/**
 * Same content. Versions alone are not enough: a renamed venue or company
 * changes the name embedded in a record without bumping its version.
 */
function sameContent<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges a server list over the local one without going back in time: a local
 * copy with a higher `version` (saved by us while the request was in flight)
 * wins over the server copy of the same record, and an unchanged record keeps
 * its local object. When nothing changed at all, the local list itself comes
 * back, so the periodic refresh does not wake every screen up (or rebuild the
 * plan) for nothing.
 */
function mergeByVersion<T extends {id: string; version: number}>(
  local: T[],
  server: T[],
  sort: (list: T[]) => T[],
): T[] {
  const byId = new Map(local.map(e => [e.id, e]));
  let changed = server.length !== local.length;
  const merged = server.map(remote => {
    const mine = byId.get(remote.id);
    if (
      mine &&
      (mine.version > remote.version ||
        (mine.version === remote.version && sameContent(mine, remote)))
    ) {
      return mine;
    }
    changed = true;
    return remote;
  });
  // Same objects and same count: `local` is already in order.
  return changed ? sort(merged) : local;
}

export function mergeServerEvents(
  local: LogisticsEvent[],
  server: LogisticsEvent[],
): LogisticsEvent[] {
  return mergeByVersion(local, server, sortEvents);
}

export function mergeServerTasks(local: Task[], server: Task[]): Task[] {
  return mergeByVersion(local, server, sortTasks);
}

export function mergeServerCompanies(
  local: Company[],
  server: Company[],
): Company[] {
  return mergeByVersion(local, server, sortCompanies);
}

export function mergeServerContacts(
  local: Contact[],
  server: Contact[],
): Contact[] {
  return mergeByVersion(local, server, sortContacts);
}

export function mergeServerOffers(local: Offer[], server: Offer[]): Offer[] {
  return mergeByVersion(local, server, sortOffers);
}

/** The server list, or the local one when it holds exactly the same. */
function keepIfSame<T>(local: T[], server: T[]): T[] {
  return local.length === server.length &&
    local.every((item, i) => sameContent(item, server[i]))
    ? local
    : server;
}

/** Puts `item` in `list` unless a newer copy is there; null when unchanged. */
function upsertInto<T extends {id: string; version: number}>(
  list: T[],
  item: T,
  sort: (list: T[]) => T[],
): T[] | null {
  const current = list.find(x => x.id === item.id);
  if (current && current.version > item.version) return null;
  return sort([...list.filter(x => x.id !== item.id), item]);
}

const EMPTY_RECORDS = {
  events: [],
  venues: [],
  tasks: [],
  companies: [],
  categories: [],
  contacts: [],
  offers: [],
  recentSearches: [],
  activity: [],
} satisfies Partial<LogisticsState>;

const IDLE_STATES = {
  eventsState: 'idle',
  tasksState: 'idle',
  companiesState: 'idle',
  contactsState: 'idle',
  offersState: 'idle',
  recentState: 'idle',
  activityState: 'idle',
} satisfies Partial<LogisticsState>;

export const useLogisticsStore = create<LogisticsState>()((set, get) => {
  /** Records the outcome of a server call in the sync chip. */
  const markReachable = () =>
    set({connection: browserOnline() ? 'online' : 'offline'});

  const markFailure = (err: unknown) => {
    if (isApiError(err) && err.isUnavailable) {
      set({connection: browserOnline() ? 'unavailable' : 'offline'});
    }
  };

  const expireSession = () => {
    writeStoredSession(null);
    set({
      phase: 'login',
      session: null,
      organizations: [],
      ...EMPTY_RECORDS,
      ...IDLE_STATES,
      sessionNotice: 'Tu sesión ha caducado. Vuelve a entrar para seguir.',
    });
  };

  /** Runs an authenticated call, handling expiry and connectivity. */
  async function authed<T>(call: (token: string) => Promise<T>): Promise<T> {
    const token = get().session?.token;
    if (!token) {
      expireSession();
      throw new ApiError({code: 'UNAUTHENTICATED', status: 401});
    }
    try {
      const result = await call(token);
      markReachable();
      return result;
    } catch (err) {
      markFailure(err);
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') expireSession();
      throw err;
    }
  }

  /**
   * 409 DUPLICATE: the existing company may not be in our list yet (created
   * by someone else since the last refresh). Keep it, so «Abrir la existente»
   * opens a live record, and bring the rest up to date quietly.
   */
  const keepDuplicate = (err: unknown) => {
    if (
      isApiError(err) &&
      err.code === 'DUPLICATE' &&
      err.current &&
      typeof err.current === 'object'
    ) {
      get().upsertCompany(err.current as Company);
      void get()
        .refresh({silent: true})
        .catch(() => undefined);
    }
  };

  return {
    phase: 'checking',
    unreachableReason: 'network',
    connection: browserOnline() ? 'online' : 'offline',
    session: null,
    organizations: [],
    orgId: null,
    sessionNotice: null,
    events: [],
    eventsState: 'idle',
    eventsError: null,
    venues: [],
    tasks: [],
    tasksState: 'idle',
    tasksError: null,
    companies: [],
    companiesState: 'idle',
    companiesError: null,
    categories: [],
    contacts: [],
    contactsState: 'idle',
    contactsError: null,
    offers: [],
    offersState: 'idle',
    offersError: null,
    recentSearches: [],
    recentState: 'idle',
    activity: [],
    activityState: 'idle',
    activityError: null,
    lastSyncAt: null,
    toasts: [],

    boot: async () => {
      if (!resolveApiBaseUrl()) {
        set({phase: 'not_configured'});
        return;
      }
      set({phase: 'checking'});
      try {
        const health = await api.health();
        if (health.database !== 'ok') {
          set({phase: 'unreachable', unreachableReason: 'database'});
          return;
        }
        markReachable();
      } catch (err) {
        if (isApiError(err) && err.code === 'NOT_CONFIGURED') {
          set({phase: 'not_configured'});
          return;
        }
        set({
          phase: 'unreachable',
          unreachableReason: 'network',
          connection: browserOnline() ? 'unavailable' : 'offline',
        });
        return;
      }

      const stored = readStoredSession();
      if (!stored) {
        set({phase: 'login'});
        return;
      }
      set({phase: 'restoring', session: stored});
      try {
        const me = await api.me(stored.token);
        const session = {...stored, user: me.user};
        writeStoredSession(session);
        const orgId = pickOrg(me.organizations, readStoredOrg());
        set({
          phase: 'ready',
          session,
          organizations: me.organizations,
          orgId,
          sessionNotice: null,
        });
        void get().refresh();
      } catch (err) {
        if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
          expireSession();
        } else {
          set({
            phase: 'unreachable',
            unreachableReason: 'network',
            connection: browserOnline() ? 'unavailable' : 'offline',
          });
        }
      }
    },

    login: async (displayName, password) => {
      const res = await api.login({displayName, password});
      const session: StoredSession = {
        token: res.token,
        expiresAt: res.expiresAt,
        user: res.user,
      };
      writeStoredSession(session);
      const orgId = pickOrg(res.organizations, readStoredOrg());
      writeStoredOrg(orgId);
      set({
        phase: 'ready',
        session,
        organizations: res.organizations,
        orgId,
        sessionNotice: null,
        ...EMPTY_RECORDS,
        recentState: 'idle',
      });
      markReachable();
      void get().refresh();
    },

    logout: async () => {
      const token = get().session?.token;
      // A guest login is shared and so is the device: its recent searches
      // must not stay behind for the next person.
      if (get().session?.user.role !== 'member') {
        for (const org of get().organizations) writeDeviceRecent(org.id, []);
      }
      writeStoredSession(null);
      set({
        phase: 'login',
        session: null,
        organizations: [],
        ...EMPTY_RECORDS,
        ...IDLE_STATES,
        sessionNotice: null,
      });
      if (token) {
        // Best effort: the local session is already gone either way.
        await api.logout(token).catch(() => undefined);
      }
    },

    selectOrg: id => {
      if (id === get().orgId) return;
      writeStoredOrg(id);
      set({orgId: id, ...EMPTY_RECORDS, recentState: 'idle'});
      void get().refresh();
    },

    refresh: async ({silent = false} = {}) => {
      const orgId = get().orgId;
      if (!orgId || get().phase !== 'ready') return;
      if (!silent) {
        set({
          eventsState: 'loading',
          eventsError: null,
          tasksState: 'loading',
          tasksError: null,
          activityState: 'loading',
          activityError: null,
          companiesState: 'loading',
          companiesError: null,
          contactsState: 'loading',
          contactsError: null,
          offersState: 'loading',
          offersError: null,
        });
      }
      const epoch = writeEpoch;
      const tEpoch = taskEpoch;
      const coEpoch = companyEpoch;
      const ctEpoch = contactEpoch;
      const ofEpoch = offerEpoch;
      const caEpoch = categoryEpoch;
      const [
        events,
        activity,
        venues,
        tasks,
        companies,
        categories,
        contacts,
        offers,
      ] = await Promise.allSettled([
        authed(token => api.events(token, orgId)),
        authed(token => api.activity(token, orgId, 20)),
        authed(token => api.venues(token, orgId)),
        authed(token => api.tasks(token, orgId)),
        authed(token => api.companies(token, orgId)),
        authed(token => api.categories(token, orgId)),
        authed(token => api.contacts(token, orgId)),
        authed(token => api.offers(token, orgId)),
      ]);
      // The organization may have changed while loading.
      if (get().orgId !== orgId || get().phase !== 'ready') return;
      const patch: Partial<LogisticsState> = {};
      if (events.status === 'fulfilled' && epoch !== writeEpoch) {
        // A write finished while this request was in flight: its list may not
        // include it. The refresh that write triggered brings the fresh list.
      } else if (events.status === 'fulfilled') {
        patch.events = mergeServerEvents(get().events, events.value.items);
        patch.eventsState = 'ready';
        patch.eventsError = null;
        patch.lastSyncAt = Date.now();
      } else if (!silent || get().eventsState !== 'ready') {
        patch.eventsState = 'error';
        patch.eventsError = errorMessage(events.reason);
      }
      if (activity.status === 'fulfilled') {
        patch.activity = keepIfSame(get().activity, activity.value.items);
        patch.activityState = 'ready';
        patch.activityError = null;
      } else if (!silent || get().activityState !== 'ready') {
        patch.activityState = 'error';
        patch.activityError = errorMessage(activity.reason);
      }
      if (tasks.status === 'fulfilled' && tEpoch !== taskEpoch) {
        // Same as events: a task write's own refresh brings the fresh list.
      } else if (tasks.status === 'fulfilled') {
        patch.tasks = mergeServerTasks(get().tasks, tasks.value.items);
        patch.tasksState = 'ready';
        patch.tasksError = null;
      } else if (!silent || get().tasksState !== 'ready') {
        patch.tasksState = 'error';
        patch.tasksError = errorMessage(tasks.reason);
      }
      if (venues.status === 'fulfilled') {
        patch.venues = keepIfSame(get().venues, venues.value.items);
      }
      // Directory lists (milestone 3): same rules as tasks.
      if (companies.status === 'fulfilled' && coEpoch !== companyEpoch) {
        // A company write's own refresh brings the fresh list.
      } else if (companies.status === 'fulfilled') {
        patch.companies = mergeServerCompanies(
          get().companies,
          companies.value.items,
        );
        patch.companiesState = 'ready';
        patch.companiesError = null;
      } else if (!silent || get().companiesState !== 'ready') {
        patch.companiesState = 'error';
        patch.companiesError = errorMessage(companies.reason);
      }
      if (contacts.status === 'fulfilled' && ctEpoch !== contactEpoch) {
        // Same as above.
      } else if (contacts.status === 'fulfilled') {
        patch.contacts = mergeServerContacts(
          get().contacts,
          contacts.value.items,
        );
        patch.contactsState = 'ready';
        patch.contactsError = null;
      } else if (!silent || get().contactsState !== 'ready') {
        patch.contactsState = 'error';
        patch.contactsError = errorMessage(contacts.reason);
      }
      if (offers.status === 'fulfilled' && ofEpoch !== offerEpoch) {
        // Same as above.
      } else if (offers.status === 'fulfilled') {
        patch.offers = mergeServerOffers(get().offers, offers.value.items);
        patch.offersState = 'ready';
        patch.offersError = null;
      } else if (!silent || get().offersState !== 'ready') {
        patch.offersState = 'error';
        patch.offersError = errorMessage(offers.reason);
      }
      if (categories.status === 'fulfilled' && caEpoch === categoryEpoch) {
        patch.categories = keepIfSame(get().categories, categories.value.items);
      }
      set(patch);
    },

    createEvent: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createEvent(token, {...input, organizationId: orgId}),
      );
      get().upsertEvent(created);
      void get().refresh({silent: true});
      return created;
    },

    updateEvent: async (id, input) => {
      try {
        const updated = await authed(token =>
          api.updateEvent(token, id, input),
        );
        get().upsertEvent(updated);
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        if (
          isApiError(err) &&
          err.code === 'VERSION_CONFLICT' &&
          err.current &&
          typeof err.current === 'object'
        ) {
          // Keep the list honest: show what the server has now.
          get().upsertEvent(err.current as LogisticsEvent);
        }
        throw err;
      }
    },

    upsertEvent: event => {
      writeEpoch++;
      const current = get().events.find(e => e.id === event.id);
      // Never replace a newer copy with an older one.
      if (current && current.version > event.version) return;
      const rest = get().events.filter(e => e.id !== event.id);
      set({events: sortEvents([...rest, event]), eventsState: 'ready'});
    },

    createTask: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createTask(token, {...input, organizationId: orgId}),
      );
      get().upsertTask(created);
      void get().refresh({silent: true});
      return created;
    },

    updateTask: async (id, input) => {
      try {
        const updated = await authed(token => api.updateTask(token, id, input));
        get().upsertTask(updated);
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        if (
          isApiError(err) &&
          err.code === 'VERSION_CONFLICT' &&
          err.current &&
          typeof err.current === 'object'
        ) {
          get().upsertTask(err.current as Task);
        }
        throw err;
      }
    },

    deleteTask: async task => {
      try {
        await authed(token => api.deleteTask(token, task.id, task.version));
      } catch (err) {
        if (
          isApiError(err) &&
          err.code === 'VERSION_CONFLICT' &&
          err.current &&
          typeof err.current === 'object'
        ) {
          get().upsertTask(err.current as Task);
          throw err;
        }
        // Already gone (someone else deleted it): the outcome is the same.
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      taskEpoch++;
      // Dependents lose the link on the server (their version increases);
      // mirror it until the refresh brings their new copies.
      const hadDependents = get().tasks.some(t =>
        t.dependsOn.includes(task.id),
      );
      set({
        tasks: get()
          .tasks.filter(t => t.id !== task.id)
          .map(t =>
            t.dependsOn.includes(task.id)
              ? {...t, dependsOn: t.dependsOn.filter(d => d !== task.id)}
              : t,
          ),
      });
      const refreshed = get().refresh({silent: true});
      // With dependents, wait for their new versions before the caller moves
      // on: editing one with the old version would be rejected as a conflict
      // with our own change.
      // The delete itself succeeded either way.
      if (hadDependents) await refreshed.catch(() => undefined);
    },

    upsertTask: task => {
      taskEpoch++;
      const current = get().tasks.find(t => t.id === task.id);
      if (current && current.version > task.version) return;
      const rest = get().tasks.filter(t => t.id !== task.id);
      set({tasks: sortTasks([...rest, task]), tasksState: 'ready'});
    },

    // ---------------------------------------------------- directory (M3)

    createCategory: async name => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const category = await authed(token =>
        api.createCategory(token, {
          organizationId: orgId,
          scope: 'service',
          name,
        }),
      );
      categoryEpoch++;
      // An existing name comes back as that category (200): no duplicate.
      if (!get().categories.some(c => c.id === category.id)) {
        set({categories: [...get().categories, category]});
      }
      void get().refresh({silent: true});
      return category;
    },

    createCompany: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      try {
        const created = await authed(token =>
          api.createCompany(token, {...input, organizationId: orgId}),
        );
        get().upsertCompany(created);
        void get().refresh({silent: true});
        return created;
      } catch (err) {
        keepDuplicate(err);
        throw err;
      }
    },

    updateCompany: async (id, input) => {
      try {
        const updated = await authed(token =>
          api.updateCompany(token, id, input),
        );
        get().upsertCompany(updated);
        // Tasks, people and offers embed the company name.
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        const current = conflictCopy<Company>(err);
        if (current) get().upsertCompany(current);
        keepDuplicate(err);
        throw err;
      }
    },

    deleteCompany: async company => {
      try {
        await authed(token =>
          api.deleteCompany(token, company.id, company.version),
        );
      } catch (err) {
        const current = conflictCopy<Company>(err);
        if (current) {
          get().upsertCompany(current);
          throw err;
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      companyEpoch++;
      offerEpoch++;
      contactEpoch++;
      taskEpoch++;
      // Mirror the server until the refresh brings the new versions: its
      // offers are deleted, its people and tasks lose the company.
      const id = company.id;
      set({
        companies: get().companies.filter(c => c.id !== id),
        offers: get().offers.filter(o => o.company.id !== id),
        contacts: get().contacts.map(c =>
          c.company?.id === id ? {...c, company: null} : c,
        ),
        tasks: get().tasks.map(t =>
          t.company?.id === id ? {...t, company: null} : t,
        ),
      });
      // Wait for the new versions: editing a person right after with the
      // old one would be rejected as a conflict with our own change.
      await get()
        .refresh({silent: true})
        .catch(() => undefined);
    },

    upsertCompany: company => {
      companyEpoch++;
      const next = upsertInto(get().companies, company, sortCompanies);
      if (next) set({companies: next, companiesState: 'ready'});
    },

    createContact: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createContact(token, {...input, organizationId: orgId}),
      );
      get().upsertContact(created);
      // A company may have been created by name, or its count changed.
      void get().refresh({silent: true});
      return created;
    },

    updateContact: async (id, input) => {
      try {
        const updated = await authed(token =>
          api.updateContact(token, id, input),
        );
        get().upsertContact(updated);
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        const current = conflictCopy<Contact>(err);
        if (current) get().upsertContact(current);
        throw err;
      }
    },

    deleteContact: async contact => {
      try {
        await authed(token =>
          api.deleteContact(token, contact.id, contact.version),
        );
      } catch (err) {
        const current = conflictCopy<Contact>(err);
        if (current) {
          get().upsertContact(current);
          throw err;
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      contactEpoch++;
      companyEpoch++;
      taskEpoch++;
      const id = contact.id;
      set({
        contacts: get().contacts.filter(c => c.id !== id),
        companies: get().companies.map(c =>
          c.id === contact.company?.id || c.mainContactId === id
            ? {
                ...c,
                mainContactId: c.mainContactId === id ? null : c.mainContactId,
                contactCount:
                  c.id === contact.company?.id
                    ? Math.max(0, c.contactCount - 1)
                    : c.contactCount,
              }
            : c,
        ),
        tasks: get().tasks.map(t =>
          t.contact?.id === id ? {...t, contact: null} : t,
        ),
      });
      await get()
        .refresh({silent: true})
        .catch(() => undefined);
    },

    upsertContact: contact => {
      contactEpoch++;
      const next = upsertInto(get().contacts, contact, sortContacts);
      if (next) set({contacts: next, contactsState: 'ready'});
    },

    createOffer: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createOffer(token, {...input, organizationId: orgId}),
      );
      get().upsertOffer(created);
      void get().refresh({silent: true});
      return created;
    },

    updateOffer: async (id, input) => {
      try {
        const updated = await authed(token =>
          api.updateOffer(token, id, input),
        );
        get().upsertOffer(updated);
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        const current = conflictCopy<Offer>(err);
        if (current) get().upsertOffer(current);
        throw err;
      }
    },

    deleteOffer: async offer => {
      try {
        await authed(token => api.deleteOffer(token, offer.id, offer.version));
      } catch (err) {
        const current = conflictCopy<Offer>(err);
        if (current) {
          get().upsertOffer(current);
          throw err;
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      offerEpoch++;
      companyEpoch++;
      set({
        offers: get().offers.filter(o => o.id !== offer.id),
        companies: get().companies.map(c =>
          c.id === offer.company.id
            ? {...c, offerCount: Math.max(0, c.offerCount - 1)}
            : c,
        ),
      });
      // Same as the other deletes: the company's new version must be in.
      await get()
        .refresh({silent: true})
        .catch(() => undefined);
    },

    upsertOffer: offer => {
      offerEpoch++;
      const next = upsertInto(get().offers, offer, sortOffers);
      if (next) set({offers: next, offersState: 'ready'});
    },

    // ---------------------------------------------------- recent searches

    loadRecentSearches: async () => {
      const orgId = get().orgId;
      const role = get().session?.user.role;
      if (!orgId || get().recentState === 'loading') return;
      if (role !== 'member') {
        set({recentSearches: readDeviceRecent(orgId), recentState: 'ready'});
        return;
      }
      set({recentState: 'loading'});
      try {
        const res = await authed(token => api.recentSearches(token, orgId));
        if (get().orgId !== orgId) return;
        set({
          recentSearches: res.items.slice(0, RECENT_SEARCHES_KEPT),
          recentState: 'ready',
        });
      } catch {
        // Not essential: searching works without them.
        if (get().orgId === orgId) set({recentState: 'error'});
      }
    },

    recordSearch: query => {
      const orgId = get().orgId;
      const q = query.trim().slice(0, 100);
      if (!orgId || !q) return;
      const next = pushRecentSearch(get().recentSearches, q);
      set({recentSearches: next});
      if (get().session?.user.role !== 'member') {
        writeDeviceRecent(orgId, next);
        return;
      }
      void authed(token => api.pushRecentSearch(token, orgId, {query: q}))
        .then(res => {
          if (get().orgId === orgId) {
            set({recentSearches: res.items.slice(0, RECENT_SEARCHES_KEPT)});
          }
        })
        // Offline: the local list already shows it for this session.
        .catch(() => undefined);
    },

    clearRecentSearches: async () => {
      const orgId = get().orgId;
      if (!orgId) return;
      const before = get().recentSearches;
      set({recentSearches: []});
      if (get().session?.user.role !== 'member') {
        writeDeviceRecent(orgId, []);
        return;
      }
      try {
        await authed(token => api.clearRecentSearches(token, orgId));
      } catch (err) {
        set({recentSearches: before});
        throw err;
      }
    },

    removeDemo: async () => {
      const orgId = get().orgId;
      if (!orgId) return 0;
      const res = await authed(token => api.removeDemo(token, orgId));
      writeEpoch++;
      taskEpoch++;
      companyEpoch++;
      contactEpoch++;
      offerEpoch++;
      await get().refresh({silent: true});
      return res?.removed ?? 0;
    },

    setBrowserOnline: online => {
      const current = get().connection;
      if (!online) set({connection: 'offline'});
      else if (current === 'offline') set({connection: 'online'});
    },

    toast: (message, tone = 'info') => {
      const id = ++toastSeq;
      set({toasts: [...get().toasts, {id, message, tone}].slice(-3)});
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 4000);
    },

    dismissToast: id => set({toasts: get().toasts.filter(t => t.id !== id)}),
  };
});
