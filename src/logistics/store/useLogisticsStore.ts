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
  ApplyHypothesisInput,
  ApplyHypothesisResponse,
  Category,
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  CreateEventInput,
  CategoryScope,
  DelayHypothesis,
  HypothesisInput,
  LogisticsEvent,
  Note,
  NoteInput,
  Offer,
  OfferInput,
  Organization,
  RecentSearch,
  Resource,
  ResourceInput,
  SessionUser,
  Task,
  TaskInput,
  UpdateEventInput,
  Venue,
  Warehouse,
  WarehouseInput,
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
import {clearRescue} from '../lib/rescue';
import {sortCompanies, sortContacts, sortOffers} from '../lib/directory';
import {sortEvents} from '../lib/events';
import {sortNotes, sortResources, sortWarehouses} from '../lib/inventory';
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

/** A button inside a toast, e.g. «Deshacer». */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** How long it stays; a toast with an action stays 6 s by default. */
  durationMs?: number;
}

/** Newest first, as the server sends them. */
function sortHypotheses(list: DelayHypothesis[]): DelayHypothesis[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Same as `upsertInto`, for hypotheses (no version: applied wins over open). */
function upsertHypothesisInto(
  list: DelayHypothesis[],
  item: DelayHypothesis,
): DelayHypothesis[] | null {
  const current = list.find(h => h.id === item.id);
  if (current?.appliedAt && !item.appliedAt) return null;
  if (current && JSON.stringify(current) === JSON.stringify(item)) return null;
  return sortHypotheses([...list.filter(h => h.id !== item.id), item]);
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
  // Milestone 4: inventories and notes.
  warehouses: Warehouse[];
  warehousesState: LoadState;
  warehousesError: string | null;
  resources: Resource[];
  resourcesState: LoadState;
  resourcesError: string | null;
  /** Newest first. For guests every `text` is null (`restricted`). */
  notes: Note[];
  notesState: LoadState;
  notesError: string | null;
  /**
   * Milestone 5: stored «¿Y si…?» delay hypotheses, newest first. For guests
   * every `note` is null (`restricted`).
   */
  hypotheses: DelayHypothesis[];
  hypothesesState: LoadState;
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

  /** Finds or creates a category by name (any case); `service` by default. */
  createCategory: (name: string, scope?: CategoryScope) => Promise<Category>;
  /**
   * Deletes a custom category: companies, offers and resources lose it
   * (their versions increase).
   */
  deleteCategory: (category: Category) => Promise<void>;
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

  // Milestone 4.
  createWarehouse: (
    input: Omit<WarehouseInput, 'organizationId' | 'version'>,
  ) => Promise<Warehouse>;
  /** `input.version` is required. 409 VERSION_CONFLICT or DUPLICATE. */
  updateWarehouse: (id: string, input: WarehouseInput) => Promise<Warehouse>;
  /** Its resources lose the warehouse; notes lose the link. */
  deleteWarehouse: (warehouse: Warehouse) => Promise<void>;
  upsertWarehouse: (warehouse: Warehouse) => void;
  createResource: (
    input: Omit<ResourceInput, 'organizationId' | 'version'>,
  ) => Promise<Resource>;
  updateResource: (id: string, input: ResourceInput) => Promise<Resource>;
  /** Tasks and notes lose it. */
  deleteResource: (resource: Resource) => Promise<void>;
  upsertResource: (resource: Resource) => void;
  createNote: (
    input: Omit<NoteInput, 'organizationId' | 'version'>,
  ) => Promise<Note>;
  updateNote: (id: string, input: NoteInput) => Promise<Note>;
  deleteNote: (note: Note) => Promise<void>;
  upsertNote: (note: Note) => void;
  // Milestone 5: delay hypotheses.
  /** Stores a hypothesis for the team; it never changes the plan. */
  createHypothesis: (
    input: Omit<HypothesisInput, 'organizationId'>,
  ) => Promise<DelayHypothesis>;
  /** Discards an open hypothesis (applied ones stay as a record). */
  deleteHypothesis: (hypothesis: DelayHypothesis) => Promise<void>;
  /**
   * Applies a stored hypothesis after the member confirmed `expected`. On a
   * 409 the tasks as they are now are put in the list and the error is
   * rethrown: nothing was applied.
   */
  applyHypothesis: (
    id: string,
    input: ApplyHypothesisInput,
  ) => Promise<ApplyHypothesisResponse>;
  upsertHypothesis: (hypothesis: DelayHypothesis) => void;
  /** The history of one record, newest first (not kept in the store). */
  loadHistory: (
    entityType: string,
    entityId: string,
    limit?: number,
  ) => Promise<ActivityEntry[]>;

  /** Loads the recent searches (server for members, device for guests). */
  loadRecentSearches: () => Promise<void>;
  /** Records a query the user opened a result for or submitted. */
  recordSearch: (query: string) => void;
  clearRecentSearches: () => Promise<void>;

  removeDemo: () => Promise<number>;
  setBrowserOnline: (online: boolean) => void;
  toast: (message: string, tone?: ToastTone, options?: ToastOptions) => void;
  dismissToast: (id: number) => void;
  /**
   * Pauses a toast's timer while it has hover or focus (so «Deshacer» stays
   * reachable); it resumes only when neither holds it.
   */
  holdToast: (id: number, reason: ToastHold, held: boolean) => void;
}

export type ToastHold = 'hover' | 'focus';

let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
const toastHolds = new Map<number, Set<ToastHold>>();
/** Time a toast stays after hover or focus leaves it. */
const TOAST_RESUME_MS = 4000;

/** Stops every toast timer; spread into `set` to empty the list too. */
function dropToasts(): {toasts: Toast[]} {
  for (const timer of toastTimers.values()) clearTimeout(timer);
  toastTimers.clear();
  toastHolds.clear();
  return {toasts: []};
}

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
/** Same as `writeEpoch`, for inventories and notes (milestone 4). */
let warehouseEpoch = 0;
let resourceEpoch = 0;
let noteEpoch = 0;
/** Same as `writeEpoch`, for delay hypotheses (milestone 5). */
let hypothesisEpoch = 0;

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

export function mergeServerWarehouses(
  local: Warehouse[],
  server: Warehouse[],
): Warehouse[] {
  return mergeByVersion(local, server, sortWarehouses);
}

export function mergeServerResources(
  local: Resource[],
  server: Resource[],
): Resource[] {
  return mergeByVersion(local, server, sortResources);
}

export function mergeServerNotes(local: Note[], server: Note[]): Note[] {
  return mergeByVersion(local, server, sortNotes);
}

/** Removes the link of every note that pointed at a deleted record. */
function unlinkNotes(notes: Note[], type: string, id: string): Note[] {
  return notes.map(n =>
    n.ref?.type === type && n.ref.id === id ? {...n, ref: null} : n,
  );
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
  warehouses: [],
  resources: [],
  notes: [],
  hypotheses: [],
  recentSearches: [],
  activity: [],
} satisfies Partial<LogisticsState>;

const IDLE_STATES = {
  eventsState: 'idle',
  tasksState: 'idle',
  companiesState: 'idle',
  contactsState: 'idle',
  offersState: 'idle',
  warehousesState: 'idle',
  resourcesState: 'idle',
  notesState: 'idle',
  hypothesesState: 'idle',
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
  const keepDuplicate = (err: unknown, kind: 'company' | 'warehouse') => {
    if (
      isApiError(err) &&
      err.code === 'DUPLICATE' &&
      err.current &&
      typeof err.current === 'object'
    ) {
      if (kind === 'company') get().upsertCompany(err.current as Company);
      else get().upsertWarehouse(err.current as Warehouse);
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
    warehouses: [],
    warehousesState: 'idle',
    warehousesError: null,
    resources: [],
    resourcesState: 'idle',
    resourcesError: null,
    notes: [],
    notesState: 'idle',
    notesError: null,
    hypotheses: [],
    hypothesesState: 'idle',
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
      // An explicit logout drops the unsaved-form rescue too: logins such as
      // «Equipo» are shared, and a rescued note must not be offered to the
      // next person. (Session expiry keeps it: that is what it is for.)
      clearRescue();
      writeStoredSession(null);
      set({
        phase: 'login',
        session: null,
        organizations: [],
        ...EMPTY_RECORDS,
        ...IDLE_STATES,
        sessionNotice: null,
        // A «Deshacer» left on screen must never run under the next person.
        ...dropToasts(),
      });
      if (token) {
        // Best effort: the local session is already gone either way.
        await api.logout(token).catch(() => undefined);
      }
    },

    selectOrg: id => {
      if (id === get().orgId) return;
      writeStoredOrg(id);
      // Toasts (and their «Deshacer») belong to the organization left behind.
      set({orgId: id, ...EMPTY_RECORDS, recentState: 'idle', ...dropToasts()});
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
          warehousesState: 'loading',
          warehousesError: null,
          resourcesState: 'loading',
          resourcesError: null,
          notesState: 'loading',
          notesError: null,
        });
      }
      const epoch = writeEpoch;
      const tEpoch = taskEpoch;
      const coEpoch = companyEpoch;
      const ctEpoch = contactEpoch;
      const ofEpoch = offerEpoch;
      const caEpoch = categoryEpoch;
      const whEpoch = warehouseEpoch;
      const reEpoch = resourceEpoch;
      const noEpoch = noteEpoch;
      const hyEpoch = hypothesisEpoch;
      const [
        events,
        activity,
        venues,
        tasks,
        companies,
        categories,
        contacts,
        offers,
        warehouses,
        resources,
        notes,
        hypotheses,
      ] = await Promise.allSettled([
        authed(token => api.events(token, orgId)),
        authed(token => api.activity(token, orgId, 20)),
        authed(token => api.venues(token, orgId)),
        authed(token => api.tasks(token, orgId)),
        authed(token => api.companies(token, orgId)),
        authed(token => api.categories(token, orgId)),
        authed(token => api.contacts(token, orgId)),
        authed(token => api.offers(token, orgId)),
        authed(token => api.warehouses(token, orgId)),
        authed(token => api.resources(token, orgId)),
        authed(token => api.notes(token, orgId)),
        authed(token => api.hypotheses(token, orgId)),
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
      // Inventories and notes (milestone 4): same rules again.
      if (warehouses.status === 'fulfilled' && whEpoch !== warehouseEpoch) {
        // A warehouse write's own refresh brings the fresh list.
      } else if (warehouses.status === 'fulfilled') {
        patch.warehouses = mergeServerWarehouses(
          get().warehouses,
          warehouses.value.items,
        );
        patch.warehousesState = 'ready';
        patch.warehousesError = null;
      } else if (!silent || get().warehousesState !== 'ready') {
        patch.warehousesState = 'error';
        patch.warehousesError = errorMessage(warehouses.reason);
      }
      if (resources.status === 'fulfilled' && reEpoch !== resourceEpoch) {
        // Same as above.
      } else if (resources.status === 'fulfilled') {
        patch.resources = mergeServerResources(
          get().resources,
          resources.value.items,
        );
        patch.resourcesState = 'ready';
        patch.resourcesError = null;
      } else if (!silent || get().resourcesState !== 'ready') {
        patch.resourcesState = 'error';
        patch.resourcesError = errorMessage(resources.reason);
      }
      if (notes.status === 'fulfilled' && noEpoch !== noteEpoch) {
        // Same as above.
      } else if (notes.status === 'fulfilled') {
        patch.notes = mergeServerNotes(get().notes, notes.value.items);
        patch.notesState = 'ready';
        patch.notesError = null;
      } else if (!silent || get().notesState !== 'ready') {
        patch.notesState = 'error';
        patch.notesError = errorMessage(notes.reason);
      }
      // Hypotheses (milestone 5): not essential to the day, so a failure is
      // quiet (the «¿Y si…?» sheet still computes from the plan).
      if (hypotheses.status === 'fulfilled' && hyEpoch === hypothesisEpoch) {
        patch.hypotheses = keepIfSame(
          get().hypotheses,
          sortHypotheses(hypotheses.value.items),
        );
        patch.hypothesesState = 'ready';
      } else if (hypotheses.status === 'rejected') {
        if (!silent || get().hypothesesState !== 'ready') {
          patch.hypothesesState = 'error';
        }
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
      resourceEpoch++;
      noteEpoch++;
      // Dependents lose the link on the server (their version increases);
      // mirror it until the refresh brings their new copies. Resources stop
      // listing it and notes that pointed at it lose the link.
      const hadDependents = get().tasks.some(t =>
        t.dependsOn.includes(task.id),
      );
      const linkedNote = get().notes.some(
        n => n.ref?.type === 'task' && n.ref.id === task.id,
      );
      set({
        tasks: get()
          .tasks.filter(t => t.id !== task.id)
          .map(t =>
            t.dependsOn.includes(task.id)
              ? {...t, dependsOn: t.dependsOn.filter(d => d !== task.id)}
              : t,
          ),
        resources: get().resources.map(r =>
          r.taskIds.includes(task.id)
            ? {...r, taskIds: r.taskIds.filter(id => id !== task.id)}
            : r,
        ),
        notes: linkedNote
          ? unlinkNotes(get().notes, 'task', task.id)
          : get().notes,
        // Its open hypotheses go with it; applied ones keep their label.
        hypotheses: get().hypotheses.some(h => h.taskId === task.id)
          ? get()
              .hypotheses.filter(h => h.taskId !== task.id || h.appliedAt)
              .map(h => (h.taskId === task.id ? {...h, taskId: null} : h))
          : get().hypotheses,
      });
      hypothesisEpoch++;
      const refreshed = get().refresh({silent: true});
      // With dependents, wait for their new versions before the caller moves
      // on: editing one with the old version would be rejected as a conflict
      // with our own change.
      // The delete itself succeeded either way.
      if (hadDependents || linkedNote) await refreshed.catch(() => undefined);
    },

    upsertTask: task => {
      taskEpoch++;
      const current = get().tasks.find(t => t.id === task.id);
      if (current && current.version > task.version) return;
      const rest = get().tasks.filter(t => t.id !== task.id);
      set({tasks: sortTasks([...rest, task]), tasksState: 'ready'});
    },

    // ---------------------------------------------------- directory (M3)

    createCategory: async (name, scope = 'service') => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const category = await authed(token =>
        api.createCategory(token, {
          organizationId: orgId,
          scope,
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

    deleteCategory: async category => {
      try {
        await authed(token => api.deleteCategory(token, category.id));
      } catch (err) {
        // Already gone: the outcome is the same.
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      categoryEpoch++;
      companyEpoch++;
      offerEpoch++;
      resourceEpoch++;
      const id = category.id;
      // Mirror the server until the refresh brings the new versions.
      set({
        categories: get().categories.filter(c => c.id !== id),
        companies: get().companies.map(c =>
          c.categoryIds.includes(id)
            ? {...c, categoryIds: c.categoryIds.filter(x => x !== id)}
            : c,
        ),
        offers: get().offers.map(o =>
          o.categoryId === id ? {...o, categoryId: null} : o,
        ),
        resources: get().resources.map(r =>
          r.categoryId === id ? {...r, categoryId: null} : r,
        ),
      });
      // Editing one of them right after with the old version would be
      // rejected as a conflict with our own change.
      await get()
        .refresh({silent: true})
        .catch(() => undefined);
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
        keepDuplicate(err, 'company');
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
        keepDuplicate(err, 'company');
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
      resourceEpoch++;
      noteEpoch++;
      // Mirror the server until the refresh brings the new versions: its
      // offers are deleted, its people, tasks and resources lose the company
      // (resources also an offer of it), notes about it or its offers lose
      // the link.
      const id = company.id;
      const goneOffers = new Set(
        get()
          .offers.filter(o => o.company.id === id)
          .map(o => o.id),
      );
      set({
        notes: get().notes.map(n =>
          (n.ref?.type === 'company' && n.ref.id === id) ||
          (n.ref?.type === 'offer' && goneOffers.has(n.ref.id))
            ? {...n, ref: null}
            : n,
        ),
        companies: get().companies.filter(c => c.id !== id),
        offers: get().offers.filter(o => o.company.id !== id),
        contacts: get().contacts.map(c =>
          c.company?.id === id ? {...c, company: null} : c,
        ),
        tasks: get().tasks.map(t =>
          t.company?.id === id ? {...t, company: null} : t,
        ),
        resources: get().resources.map(r =>
          r.company?.id === id ||
          (r.offerId !== null && goneOffers.has(r.offerId))
            ? {
                ...r,
                company: r.company?.id === id ? null : r.company,
                offerId:
                  r.offerId !== null && goneOffers.has(r.offerId)
                    ? null
                    : r.offerId,
              }
            : r,
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
      noteEpoch++;
      const id = contact.id;
      set({
        notes: unlinkNotes(get().notes, 'contact', id),
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
      resourceEpoch++;
      noteEpoch++;
      set({
        notes: unlinkNotes(get().notes, 'offer', offer.id),
        resources: get().resources.map(r =>
          r.offerId === offer.id ? {...r, offerId: null} : r,
        ),
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

    // ---------------------------------------------------- inventories (M4)

    createWarehouse: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      try {
        const created = await authed(token =>
          api.createWarehouse(token, {...input, organizationId: orgId}),
        );
        get().upsertWarehouse(created);
        void get().refresh({silent: true});
        return created;
      } catch (err) {
        keepDuplicate(err, 'warehouse');
        throw err;
      }
    },

    updateWarehouse: async (id, input) => {
      try {
        const updated = await authed(token =>
          api.updateWarehouse(token, id, input),
        );
        get().upsertWarehouse(updated);
        // Resources embed the warehouse name.
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        const current = conflictCopy<Warehouse>(err);
        if (current) get().upsertWarehouse(current);
        keepDuplicate(err, 'warehouse');
        throw err;
      }
    },

    deleteWarehouse: async warehouse => {
      try {
        await authed(token =>
          api.deleteWarehouse(token, warehouse.id, warehouse.version),
        );
      } catch (err) {
        const current = conflictCopy<Warehouse>(err);
        if (current) {
          get().upsertWarehouse(current);
          throw err;
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      warehouseEpoch++;
      resourceEpoch++;
      noteEpoch++;
      const id = warehouse.id;
      // Its resources stay, without a warehouse; notes lose the link.
      set({
        warehouses: get().warehouses.filter(w => w.id !== id),
        resources: get().resources.map(r =>
          r.warehouse?.id === id ? {...r, warehouse: null} : r,
        ),
        notes: unlinkNotes(get().notes, 'warehouse', id),
      });
      await get()
        .refresh({silent: true})
        .catch(() => undefined);
    },

    upsertWarehouse: warehouse => {
      warehouseEpoch++;
      const next = upsertInto(get().warehouses, warehouse, sortWarehouses);
      if (next) set({warehouses: next, warehousesState: 'ready'});
    },

    createResource: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createResource(token, {...input, organizationId: orgId}),
      );
      get().upsertResource(created);
      // A warehouse or company may have been created by name.
      void get().refresh({silent: true});
      return created;
    },

    updateResource: async (id, input) => {
      try {
        const updated = await authed(token =>
          api.updateResource(token, id, input),
        );
        get().upsertResource(updated);
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        const current = conflictCopy<Resource>(err);
        if (current) get().upsertResource(current);
        throw err;
      }
    },

    deleteResource: async resource => {
      try {
        await authed(token =>
          api.deleteResource(token, resource.id, resource.version),
        );
      } catch (err) {
        const current = conflictCopy<Resource>(err);
        if (current) {
          get().upsertResource(current);
          throw err;
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      resourceEpoch++;
      warehouseEpoch++;
      taskEpoch++;
      noteEpoch++;
      const id = resource.id;
      set({
        resources: get().resources.filter(r => r.id !== id),
        warehouses: get().warehouses.map(w =>
          w.id === resource.warehouse?.id
            ? {...w, resourceCount: Math.max(0, w.resourceCount - 1)}
            : w,
        ),
        tasks: get().tasks.map(t =>
          t.resourceIds.includes(id)
            ? {...t, resourceIds: t.resourceIds.filter(x => x !== id)}
            : t,
        ),
        notes: unlinkNotes(get().notes, 'resource', id),
      });
      // The tasks' new versions must be in before anyone edits them.
      await get()
        .refresh({silent: true})
        .catch(() => undefined);
    },

    upsertResource: resource => {
      resourceEpoch++;
      const next = upsertInto(get().resources, resource, sortResources);
      if (next) set({resources: next, resourcesState: 'ready'});
    },

    createNote: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createNote(token, {...input, organizationId: orgId}),
      );
      get().upsertNote(created);
      void get().refresh({silent: true});
      return created;
    },

    updateNote: async (id, input) => {
      try {
        const updated = await authed(token => api.updateNote(token, id, input));
        get().upsertNote(updated);
        void get().refresh({silent: true});
        return updated;
      } catch (err) {
        const current = conflictCopy<Note>(err);
        if (current) get().upsertNote(current);
        throw err;
      }
    },

    deleteNote: async note => {
      try {
        await authed(token => api.deleteNote(token, note.id, note.version));
      } catch (err) {
        const current = conflictCopy<Note>(err);
        if (current) {
          get().upsertNote(current);
          throw err;
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      noteEpoch++;
      set({notes: get().notes.filter(n => n.id !== note.id)});
      void get()
        .refresh({silent: true})
        .catch(() => undefined);
    },

    upsertNote: note => {
      noteEpoch++;
      const next = upsertInto(get().notes, note, sortNotes);
      if (next) set({notes: next, notesState: 'ready'});
    },

    // ---------------------------------------------------- hypotheses (M5)

    createHypothesis: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const created = await authed(token =>
        api.createHypothesis(token, {...input, organizationId: orgId}),
      );
      get().upsertHypothesis(created);
      return created;
    },

    deleteHypothesis: async hypothesis => {
      try {
        await authed(token => api.deleteHypothesis(token, hypothesis.id));
      } catch (err) {
        // Already gone: the outcome is the same. Applied meanwhile (400):
        // bring the list up to date so the sheet shows it as applied.
        if (isApiError(err) && err.code === 'VALIDATION') {
          void get()
            .refresh({silent: true})
            .catch(() => undefined);
        }
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      hypothesisEpoch++;
      set({
        hypotheses: get().hypotheses.filter(h => h.id !== hypothesis.id),
      });
    },

    applyHypothesis: async (id, input) => {
      try {
        const res = await authed(token =>
          api.applyHypothesis(token, id, input),
        );
        for (const task of res.tasks) get().upsertTask(task);
        get().upsertHypothesis(res.hypothesis);
        void get().refresh({silent: true});
        return res;
      } catch (err) {
        if (
          isApiError(err) &&
          err.code === 'VERSION_CONFLICT' &&
          Array.isArray(err.current)
        ) {
          // The plan changed: show the tasks as they are now; nothing moved.
          for (const task of err.current as Task[]) {
            if (task && typeof task === 'object') get().upsertTask(task);
          }
        }
        throw err;
      }
    },

    upsertHypothesis: hypothesis => {
      hypothesisEpoch++;
      const next = upsertHypothesisInto(get().hypotheses, hypothesis);
      if (next) set({hypotheses: next, hypothesesState: 'ready'});
    },

    loadHistory: async (entityType, entityId, limit = 50) => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const res = await authed(token =>
        api.history(token, orgId, entityType, entityId, limit),
      );
      return res.items;
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
      warehouseEpoch++;
      resourceEpoch++;
      noteEpoch++;
      hypothesisEpoch++;
      await get().refresh({silent: true});
      return res?.removed ?? 0;
    },

    setBrowserOnline: online => {
      const current = get().connection;
      if (!online) set({connection: 'offline'});
      else if (current === 'offline') set({connection: 'online'});
    },

    toast: (message, tone = 'info', options = {}) => {
      const id = ++toastSeq;
      const {action, durationMs} = options;
      set({
        toasts: [...get().toasts, {id, message, tone, action}].slice(-3),
      });
      const ms = durationMs ?? (action ? 6000 : tone === 'error' ? 7000 : 4000);
      toastTimers.set(
        id,
        setTimeout(() => get().dismissToast(id), ms),
      );
    },

    dismissToast: id => {
      clearTimeout(toastTimers.get(id));
      toastTimers.delete(id);
      toastHolds.delete(id);
      set({toasts: get().toasts.filter(t => t.id !== id)});
    },

    holdToast: (id, reason, held) => {
      if (!get().toasts.some(t => t.id === id)) return;
      const holds = toastHolds.get(id) ?? new Set<ToastHold>();
      if (held) holds.add(reason);
      else holds.delete(reason);
      toastHolds.set(id, holds);
      clearTimeout(toastTimers.get(id));
      toastTimers.delete(id);
      if (holds.size === 0) {
        toastTimers.set(
          id,
          setTimeout(() => get().dismissToast(id), TOAST_RESUME_MS),
        );
      }
    },
  };
});
