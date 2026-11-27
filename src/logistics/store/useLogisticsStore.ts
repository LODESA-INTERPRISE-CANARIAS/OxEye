/**
 * State of the Logistics Manager window: server availability, session,
 * selected organization and the records shown on screen.
 *
 * Kept separate from the simulator store on purpose: the module is lazy-loaded
 * and must not touch the simulation state.
 *
 * Milestone 6 («Sin cobertura»):
 * - Writes of members that can wait (creates and updates of eight record
 *   types, `canQueue`) go to an outbox on the device when there is no
 *   network, the server does not answer, or earlier changes are still
 *   waiting (to keep their order). The list shows the change at once
 *   (`optimisticRecord`), marked «Pendiente de enviar», and the outbox is
 *   replayed in order when the server answers again. A 409 is never
 *   overwritten: the entry waits for a person to merge it.
 * - Creates always carry a device id, so a lost response can be replayed.
 * - The lists are kept on the device (`offline/db.ts`, withheld fields
 *   removed for guests), so the window reopens without coverage.
 * - `…/changes` tells which lists to reload; a full reload runs on
 *   reconnect, on demand and every `FULL_REFRESH_MS` (or every poll when the
 *   server is older and has no such route).
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
  ConflictAcceptance,
  ConflictAcceptanceInput,
  CreateEventInput,
  CategoryScope,
  MoveTaskInput,
  MoveTaskResponse,
  VenueInput,
  DelayHypothesis,
  HypothesisInput,
  IsoInstant,
  LogisticsEvent,
  MediaInfo,
  MediaUploadInput,
  Note,
  NoteAnswer,
  NoteInput,
  Offer,
  OfferInput,
  Organization,
  OrganizationInput,
  RecentSearch,
  Resource,
  ResourceInput,
  LoginResponse,
  SessionUser,
  SupportSessionResponse,
  Task,
  TaskInput,
  UpdateEventInput,
  Venue,
  Warehouse,
  WarehouseInput,
} from '../../../shared/logistics/contracts.ts';
import {
  localIdsIn,
  type OptimisticContext,
  type OptimisticRecord,
} from '../../../shared/logistics/optimistic.ts';
import {
  canQueue,
  enqueue,
  guardSubsoil,
  MEDIA_QUEUE_MAX,
  nextToSend,
  outboxLabel,
  queuedMedia,
  settleAccepted,
  referencedIds,
  unsentRecordIds,
  type OutboxEntity,
  type OutboxEntry,
  type OutboxOp,
} from '../../../shared/logistics/outbox.ts';
import {
  withholdFor,
  type WithheldKind,
} from '../../../shared/logistics/redaction.ts';
import {
  ACTIVITY_RANGE_MAX,
  RECENT_SEARCHES_KEPT,
} from '../../../shared/logistics/rules.ts';
import {normalize} from '../../../shared/logistics/search.ts';
import {
  FULL_REFRESH_MS,
  listsToReload,
  replayOutcome,
  retryDelayMs,
  SYNC_LISTS,
  type SyncList,
} from '../../../shared/logistics/sync.ts';
import {DEFAULT_TIMEZONE} from '../../../shared/logistics/time.ts';
import {can} from '../../../shared/logistics/permissions.ts';
import {orgPermissions} from '../account/access';
import {
  ApiError,
  errorMessage,
  isApiError,
  resolveApiBaseUrl,
  setTokenRejectedHandler,
} from '../api/client';
import {api} from '../api/endpoints';
import {withMain, withMedia, withoutMedia} from '../inventory/media';
import {clearRescue} from '../lib/rescue';
import {sortCompanies, sortContacts, sortOffers} from '../lib/directory';
import {sortEvents} from '../lib/events';
import {sortNotes, sortResources, sortWarehouses} from '../lib/inventory';
import {sortTasks} from '../lib/tasks';
import {clearTasksPrefs} from '../tasks-space/filters';
import * as device from '../offline/db';
import {
  alreadyApplied,
  buildContext,
  entryRecord,
  isUnresolved,
  LIST_OF,
  overlayList,
  recordName,
  uuid,
  type RecordListKey,
} from '../offline/local';

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

/** M6: how a form's save relates to the outbox. */
export interface WriteOptions {
  /**
   * The outbox entry this save resolves («Revisar» a conflict or a rejected
   * change): it is removed once the new save is accepted or queued.
   */
  replaces?: string;
}

/** M6: leaving with changes that were never sent asks first. */
export type LeaveRequest = {kind: 'logout'} | {kind: 'org'; orgId: string};

/** What the toast says when a save stayed on this device. */
export const QUEUED_NOTE =
  'Guardado en este dispositivo. Se enviará al volver la conexión.';

/** Deletes, applying a hypothesis, categories… never wait in the outbox. */
export const NEEDS_CONNECTION =
  'Esto necesita conexión con el servidor. Inténtalo cuando vuelva la cobertura.';

const LOCAL_REF_MESSAGE =
  'Este cambio apunta a algo que aún no se ha enviado. Escríbelo por su nombre y vuelve a guardar.';
const DEVICE_STORAGE_FAILED =
  'No se ha podido guardar en este dispositivo (almacenamiento lleno o desactivado). Lo que has escrito sigue aquí.';

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
/** E4: the own session kept aside during a support session. */
const SUPPORT_KEY = 'oxeye.logistics.support-return.v1';

export interface SupportReturn {
  /** The support or «Ver como Invitado» session to end. */
  sessionId: string;
  kind: 'support' | 'view_as_guest';
  /** The administrator's own session. */
  session: StoredSession;
  /**
   * When it ends by this device's clock (the countdown), so a device whose
   * clock is off does not end it early or show a wrong time left.
   */
  endsAt?: string;
}

function readStoredSupport(): SupportReturn | null {
  try {
    // Session storage: the tab only, never the device's copy.
    const raw = sessionStorage.getItem(SUPPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SupportReturn;
    return parsed?.sessionId && parsed.session?.token ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSupport(value: SupportReturn | null): void {
  try {
    if (value) sessionStorage.setItem(SUPPORT_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SUPPORT_KEY);
  } catch {
    // Without storage the way back lasts the tab.
  }
}

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
    typeof err.current === 'object' &&
    !Array.isArray(err.current)
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
  /**
   * E4: during a support session or «Ver como Invitado», the
   * administrator's own session to go back to, and the session to end.
   */
  supportReturn: SupportReturn | null;

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
  /**
   * Revisión 1 · E2: accepted conflicts («Mantener ambas»), newest first. For
   * guests every `reason` is null (`restricted`).
   */
  acceptances: ConflictAcceptance[];
  acceptancesState: LoadState;
  /** The current user's five recent searches, newest first. */
  recentSearches: RecentSearch[];
  recentState: LoadState;
  activity: ActivityEntry[];
  activityState: LoadState;
  activityError: string | null;
  lastSyncAt: number | null;

  // Milestone 6: offline.
  /** Changes saved on this device for this user and organization, in order. */
  outbox: OutboxEntry[];
  /** Records with something not accepted by the server yet. */
  unsent: ReadonlySet<string>;
  /** The outbox is being sent right now. */
  syncing: boolean;
  /**
   * Opened from the device's copy without coverage: the session has not been
   * confirmed by the server yet and nothing is sent until it is.
   */
  fromCache: boolean;
  /** Logout or organization change waiting for the user's answer. */
  leave: LeaveRequest | null;

  toasts: Toast[];

  boot: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  /**
   * Signs out. With unsent changes it asks first (`leave`) unless
   * `discardUnsent`; then the device's copy is wiped. During a support
   * session or «Ver como Invitado» it ends that session instead. `notice`
   * is shown on the login screen (e.g. after a reset link in a session).
   */
  logout: (options?: {
    discardUnsent?: boolean;
    notice?: string;
  }) => Promise<void>;
  /**
   * E4: the own account changed (profile, password, welcome): takes the
   * user and the organizations' permissions again from `GET /me`, or uses
   * `user` as given. Quiet on failure.
   */
  refreshAccount: (user?: SessionUser) => Promise<void>;
  /**
   * E4: a support session or «Ver como Invitado» was opened: the
   * administrator's own session is kept aside (`supportReturn`) and this one
   * is used until it ends. Refused with unsent changes on the device.
   */
  beginSupport: (res: SupportSessionResponse, minutes: number) => Promise<void>;
  /** E4: ends the support session and goes back to the own session. */
  endSupport: () => Promise<void>;
  /** Same rule as `logout` for changing organization. */
  selectOrg: (id: string, options?: {discardUnsent?: boolean}) => void;
  /** Full reload of every list (or of `lists`). */
  refresh: (options?: {
    silent?: boolean;
    lists?: ReadonlySet<SyncList>;
  }) => Promise<void>;
  /** Asks `…/changes` and reloads only what changed (full reload fallback). */
  pull: () => Promise<void>;
  /**
   * Brings the device up to date: reconnects when needed, reloads (in full
   * when asked, after a reconnect or every `FULL_REFRESH_MS`) and sends the
   * outbox.
   */
  /** `now`: entries waiting for their retry are sent at once. */
  syncNow: (options?: {full?: boolean; now?: boolean}) => Promise<void>;
  /** Sends waiting changes one at a time, in order. */
  replay: () => Promise<void>;
  /** «Reintentar ahora»: the entry is sent again as soon as possible. */
  retryEntry: (id: string) => Promise<void>;
  /**
   * «Descartar»: drops a change that was never accepted (a new record also
   * drops the later changes of that record). The list shows the server copy.
   */
  discardEntry: (
    id: string,
    options?: {
      /**
       * «Usar la existente» of a duplicate create: waiting changes that
       * referenced the discarded record point at this id instead.
       */
      useInstead?: string;
    },
  ) => Promise<void>;
  cancelLeave: () => void;
  /** The success toast of a save, or `QUEUED_NOTE` when it stayed here. */
  toastSaved: (record: object, message: string, options?: ToastOptions) => void;

  createEvent: (
    input: Omit<CreateEventInput, 'organizationId'>,
    options?: WriteOptions,
  ) => Promise<LogisticsEvent>;
  updateEvent: (
    id: string,
    input: UpdateEventInput,
    options?: WriteOptions,
  ) => Promise<LogisticsEvent>;
  /** Puts a server copy of an event in the list (e.g. after a conflict). */
  upsertEvent: (event: LogisticsEvent) => void;
  createTask: (
    input: Omit<TaskInput, 'organizationId' | 'version'>,
    options?: WriteOptions,
  ) => Promise<Task>;
  /** `input.version` is required. */
  updateTask: (
    id: string,
    input: TaskInput,
    options?: WriteOptions,
  ) => Promise<Task>;
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
    options?: WriteOptions,
  ) => Promise<Company>;
  /** `input.version` is required. 409 VERSION_CONFLICT or DUPLICATE. */
  updateCompany: (
    id: string,
    input: CompanyInput,
    options?: WriteOptions,
  ) => Promise<Company>;
  /** Deletes its offers; its people and tasks lose the company. */
  deleteCompany: (company: Company) => Promise<void>;
  upsertCompany: (company: Company) => void;
  createContact: (
    input: Omit<ContactInput, 'organizationId' | 'version'>,
    options?: WriteOptions,
  ) => Promise<Contact>;
  updateContact: (
    id: string,
    input: ContactInput,
    options?: WriteOptions,
  ) => Promise<Contact>;
  /** Tasks and a company that had them as main contact lose the link. */
  deleteContact: (contact: Contact) => Promise<void>;
  upsertContact: (contact: Contact) => void;
  createOffer: (
    input: Omit<OfferInput, 'organizationId' | 'version'>,
    options?: WriteOptions,
  ) => Promise<Offer>;
  updateOffer: (
    id: string,
    input: OfferInput,
    options?: WriteOptions,
  ) => Promise<Offer>;
  deleteOffer: (offer: Offer) => Promise<void>;
  upsertOffer: (offer: Offer) => void;

  // Milestone 4.
  createWarehouse: (
    input: Omit<WarehouseInput, 'organizationId' | 'version'>,
    options?: WriteOptions,
  ) => Promise<Warehouse>;
  /** `input.version` is required. 409 VERSION_CONFLICT or DUPLICATE. */
  updateWarehouse: (
    id: string,
    input: WarehouseInput,
    options?: WriteOptions,
  ) => Promise<Warehouse>;
  /** Its resources lose the warehouse; notes lose the link. */
  deleteWarehouse: (warehouse: Warehouse) => Promise<void>;
  upsertWarehouse: (warehouse: Warehouse) => void;
  createResource: (
    input: Omit<ResourceInput, 'organizationId' | 'version'>,
    options?: WriteOptions,
  ) => Promise<Resource>;
  updateResource: (
    id: string,
    input: ResourceInput,
    options?: WriteOptions,
  ) => Promise<Resource>;
  /** Tasks and notes lose it. */
  deleteResource: (resource: Resource) => Promise<void>;
  upsertResource: (resource: Resource) => void;
  createNote: (
    input: Omit<NoteInput, 'organizationId' | 'version'>,
    options?: WriteOptions,
  ) => Promise<Note>;
  updateNote: (
    id: string,
    input: NoteInput,
    options?: WriteOptions,
  ) => Promise<Note>;
  deleteNote: (note: Note) => Promise<void>;
  upsertNote: (note: Note) => void;
  // Revisión 1 · E3: answers to open questions and material photos.
  /** Every answer of a question, newest first (needs the server). */
  noteAnswers: (noteId: string, signal?: AbortSignal) => Promise<NoteAnswer[]>;
  /**
   * Answers an open question. `replaces` is the current answer the user saw
   * (null when none): 409 VERSION_CONFLICT with `current` when it changed.
   * Needs the server (answers never wait in the outbox).
   */
  answerNote: (
    note: Note,
    text: string,
    replaces: string | null,
  ) => Promise<NoteAnswer>;
  /**
   * Adds a prepared photo to a resource. Without coverage (or when the
   * request does not get through) it waits in the outbox: `queued: true`.
   */
  addResourcePhoto: (
    resource: Resource,
    photo: Omit<
      MediaUploadInput,
      'organizationId' | 'ownerType' | 'ownerId' | 'id'
    >,
  ) => Promise<{queued: boolean; id: string; media: MediaInfo | null}>;
  /** Makes a stored photo the main one (needs the server). */
  setMainPhoto: (resource: Resource, media: MediaInfo) => Promise<void>;
  /** Removes a stored photo for everyone (needs the server). */
  deletePhoto: (resource: Resource, media: MediaInfo) => Promise<void>;
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
  // Revisión 1 · E2: moves, accepted conflicts, venue acronym and hours.
  /**
   * Moves a task after the member confirmed `input.expected` (never queued).
   * On a 409 the tasks as they are now are put in the list and the error is
   * rethrown: nothing moved.
   */
  moveTask: (id: string, input: MoveTaskInput) => Promise<MoveTaskResponse>;
  /** «Mantener ambas» (members). 409 VERSION_CONFLICT (warning gone) / DUPLICATE. */
  acceptConflict: (
    input: Omit<ConflictAcceptanceInput, 'organizationId'>,
  ) => Promise<ConflictAcceptance>;
  /** «Retirar»: the warning opens again. */
  withdrawAcceptance: (acceptance: ConflictAcceptance) => Promise<void>;
  upsertAcceptance: (acceptance: ConflictAcceptance) => void;
  /** Acronym and opening hours; `input.version` required (409 VERSION_CONFLICT). */
  updateVenue: (id: string, input: VenueInput) => Promise<Venue>;
  /**
   * E2: saves the current organization's acronym. On a 409 the store takes
   * the server's copy (so the form can show it) and the error is rethrown.
   */
  updateOrganization: (input: OrganizationInput) => Promise<Organization>;
  upsertVenue: (venue: Venue) => void;
  /** The history of one record, newest first (not kept in the store). */
  loadHistory: (
    entityType: string,
    entityId: string,
    limit?: number,
  ) => Promise<ActivityEntry[]>;
  /**
   * The organization's activity of `from` ≤ at < `to` (day close), newest
   * first, up to ACTIVITY_RANGE_MAX (not kept in the store). An expired
   * session ends the usual way; an abort rejects with an `AbortError`
   * that does not count as a lost connection.
   */
  loadDayActivity: (
    from: IsoInstant,
    to: IsoInstant,
    signal?: AbortSignal,
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

// ---------------------------------------------------------------- M6 memory

/** Opaque `…/changes` cursor of the current user and organization. */
let cursor: string | null = null;
/** null = not asked yet; false = the server has no `…/changes` route. */
let changesSupported: boolean | null = null;
/** When the last full reload finished. */
let lastFullAt = 0;
/** Latest server copy of records that have outbox entries. */
const serverCopy = new Map<string, unknown>();
/** Records with a waiting update that the server no longer has. */
const goneOnServer = new Set<string>();
/**
 * Device ids of creates whose request failed at network level, by content:
 * saving the same thing again reuses the id, so a create that did reach the
 * server is answered with the existing record instead of a duplicate.
 */
const deviceIds = new Map<string, string>();
/** Records returned by a save that stayed on this device. */
const queuedRecords = new WeakSet<object>();

/** Whether a save returned this record from the outbox (not the server). */
export const wasQueued = (record: object): boolean => queuedRecords.has(record);
let replaying = false;
let replayTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;
/** The session token already being expired (see `expireSession`). */
let expiredToken: string | null = null;
/** Bumped when the device copy is wiped: pending cache writes are dropped. */
let persistGen = 0;
/**
 * Whose outbox the device holds right now. Cleared before a wipe (logout,
 * organization change), kept on session expiry (same person comes back).
 */
let deviceOwner: {userId: string; orgId: string} | null = null;

const ownsDevice = (entry: OutboxEntry) =>
  deviceOwner?.userId === entry.userId && deviceOwner.orgId === entry.orgId;

const EMPTY_UNSENT: ReadonlySet<string> = new Set();

function resetOfflineMemory(): void {
  cursor = null;
  changesSupported = null;
  lastFullAt = 0;
  serverCopy.clear();
  goneOnServer.clear();
  deviceIds.clear();
  retryStep = 0;
  if (replayTimer) clearTimeout(replayTimer);
  if (retryTimer) clearTimeout(retryTimer);
  replayTimer = null;
  retryTimer = null;
  persistGen++;
  deviceOwner = null;
}

/** Waiting writes reloaded from the device: nothing is in flight anymore. */
function settleLoaded(entries: OutboxEntry[]): OutboxEntry[] {
  return entries.map(e =>
    e.status === 'sending' ? {...e, status: 'pending' as const} : e,
  );
}

const fingerprint = (entity: OutboxEntity, raw: unknown) =>
  `${entity}|${JSON.stringify(raw)}`;

/** `value` with every occurrence of id `from` (lowercase) replaced by `to`. */
function swapId(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') {
    return value.toLowerCase() === from ? to : value;
  }
  if (Array.isArray(value)) return value.map(v => swapId(v, from, to));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, swapId(v, from, to)]),
    );
  }
  return value;
}

// A photo lives in its resource's list too (E3): each list once.
const RECORD_LISTS = [...new Set(Object.values(LIST_OF))] as RecordListKey[];

const ENTITY_OF: Record<RecordListKey, OutboxEntity> = {
  events: 'event',
  tasks: 'task',
  companies: 'company',
  contacts: 'contact',
  offers: 'offer',
  warehouses: 'warehouse',
  resources: 'resource',
  notes: 'note',
};

type AnyList = {id: string}[];

const SORT_OF: Record<RecordListKey, (list: AnyList) => AnyList> = {
  events: l => sortEvents(l as LogisticsEvent[]),
  tasks: l => sortTasks(l as Task[]),
  companies: l => sortCompanies(l as Company[]),
  contacts: l => sortContacts(l as Contact[]),
  offers: l => sortOffers(l as Offer[]),
  warehouses: l => sortWarehouses(l as Warehouse[]),
  resources: l => sortResources(l as Resource[]),
  notes: l => sortNotes(l as Note[]),
};

/** API call of each outbox type. */
const SEND: Record<
  OutboxEntity,
  {
    create: (token: string, body: Record<string, unknown>) => Promise<unknown>;
    update: (
      token: string,
      id: string,
      body: Record<string, unknown>,
    ) => Promise<unknown>;
  }
> = {
  event: {
    create: (t, b) => api.createEvent(t, b as unknown as CreateEventInput),
    update: (t, id, b) =>
      api.updateEvent(t, id, b as unknown as UpdateEventInput),
  },
  task: {
    create: (t, b) => api.createTask(t, b as unknown as TaskInput),
    update: (t, id, b) => api.updateTask(t, id, b as unknown as TaskInput),
  },
  company: {
    create: (t, b) => api.createCompany(t, b as unknown as CompanyInput),
    update: (t, id, b) =>
      api.updateCompany(t, id, b as unknown as CompanyInput),
  },
  contact: {
    create: (t, b) => api.createContact(t, b as unknown as ContactInput),
    update: (t, id, b) =>
      api.updateContact(t, id, b as unknown as ContactInput),
  },
  offer: {
    create: (t, b) => api.createOffer(t, b as unknown as OfferInput),
    update: (t, id, b) => api.updateOffer(t, id, b as unknown as OfferInput),
  },
  warehouse: {
    create: (t, b) => api.createWarehouse(t, b as unknown as WarehouseInput),
    update: (t, id, b) =>
      api.updateWarehouse(t, id, b as unknown as WarehouseInput),
  },
  resource: {
    create: (t, b) => api.createResource(t, b as unknown as ResourceInput),
    update: (t, id, b) =>
      api.updateResource(t, id, b as unknown as ResourceInput),
  },
  note: {
    create: (t, b) => api.createNote(t, b as unknown as NoteInput),
    update: (t, id, b) => api.updateNote(t, id, b as unknown as NoteInput),
  },
  // E3: photos queue as creates only (`canQueue`).
  media: {
    create: (t, b) => api.uploadMedia(t, b as unknown as MediaUploadInput),
    update: () => Promise.reject(new ApiError({code: 'VALIDATION', status: 0})),
  },
};

/** Photos waiting on this device reached MEDIA_QUEUE_MAX. */
const PHOTO_QUEUE_FULL = `Ya hay ${MEDIA_QUEUE_MAX} fotos esperando en este dispositivo. Se enviarán al volver la conexión; después podrás añadir más.`;

/**
 * Whether a write must wait behind the outbox: no network, no server, or
 * something earlier is still to be sent (order), or this record (or a new
 * record it points at) has a change that has not gone through.
 */
function mustQueue(
  entries: readonly OutboxEntry[],
  connection: Connection,
  recordId: string,
  input: Record<string, unknown>,
): boolean {
  if (!browserOnline() || connection !== 'online') return true;
  if (entries.some(e => e.status === 'pending' || e.status === 'sending')) {
    return true;
  }
  const refs = referencedIds(input);
  return entries.some(
    e =>
      isUnresolved(e) &&
      (e.recordId === recordId ||
        (e.op === 'create' && refs.has(e.recordId.toLowerCase()))),
  );
}

function subsoilDroppedText(label: string): string {
  return `«Subsuelo revisado» se ha retirado de ${label}: la tarea cambió de lugar, de carga o de recursos mientras no había conexión. Revísalo de nuevo en el simulador si hace falta.`;
}

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
  acceptances: [],
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
  acceptancesState: 'idle',
  recentState: 'idle',
  activityState: 'idle',
} satisfies Partial<LogisticsState>;

const NO_OUTBOX = {
  outbox: [],
  unsent: EMPTY_UNSENT,
  syncing: false,
  leave: null,
} satisfies Partial<LogisticsState>;

const ALL_LISTS: ReadonlySet<SyncList> = new Set(SYNC_LISTS);

/** A rejected `Promise.allSettled` slot for a list that was not asked for. */
const SKIP = Symbol('skip');

/** E4: lists behind `directory.read` (Contactos and Catálogo). */
const DIRECTORY_LISTS: ReadonlySet<SyncList> = new Set([
  'companies',
  'contacts',
  'offers',
]);

/** How long the boot waits for the server when the device has a copy. */
const BOOT_PROBE_MS = 4000;
/** Waits before trying to reach the server again while working locally. */
const RECONNECT_STEPS_MS = [5_000, 15_000, 30_000, 60_000];

/** What the device has for a user, to open without the server. */
interface LocalCopy {
  orgId: string;
  organizations: Organization[];
  lists: Partial<Record<SyncList, unknown[]>>;
  savedAt: number | null;
  outbox: OutboxEntry[];
  cursor: string | null;
}

async function loadLocalCopy(stored: StoredSession): Promise<LocalCopy | null> {
  // Only the same person with the same role opens the copy: a member turned
  // guest must not see what was kept for members.
  const owner = await device.cacheOwner();
  if (!owner || !device.ownedBy(owner, stored.user)) return null;
  const cached = await device.loadSession(stored.user.id);
  if (!cached || cached.user.role !== stored.user.role) return null;
  const orgId = pickOrg(cached.organizations, readStoredOrg() ?? cached.orgId);
  if (!orgId) return null;
  const {lists, savedAt} = await device.loadLists(stored.user.id, orgId);
  if (!Object.keys(lists).length) return null;
  const [outbox, savedCursor] = await Promise.all([
    device.loadOutbox(stored.user.id, orgId),
    device.loadCursor(stored.user.id, orgId),
  ]);
  return {
    orgId,
    organizations: cached.organizations,
    lists,
    savedAt,
    outbox: settleLoaded(outbox),
    cursor: savedCursor,
  };
}

const arr = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

/** The context an entry's optimistic record is built in. */
function contextOf(s: LogisticsState, entry: OutboxEntry): OptimisticContext {
  const zone =
    s.organizations.find(o => o.id === entry.orgId)?.timezone ||
    DEFAULT_TIMEZONE;
  const name =
    s.session?.user.id === entry.userId ? s.session.user.displayName : '';
  return buildContext(
    s,
    {id: entry.userId, displayName: name},
    entry.orgId,
    zone,
    entry.queuedAt,
  );
}

/**
 * The record as the user queued it: the entry's change over the copy they
 * edited (`base`), or the new record of a create. «Revisar» opens it.
 */
export function queuedRecord(entry: OutboxEntry): OptimisticRecord {
  return entryRecord(
    entry,
    entry.op === 'update' ? (entry.base as OptimisticRecord | null) : null,
    contextOf(useLogisticsStore.getState(), entry),
  );
}

export const useLogisticsStore = create<LogisticsState>()((set, get) => {
  /** Records the outcome of a server call in the sync chip. */
  const markReachable = () => {
    const was = get().connection;
    set({connection: browserOnline() ? 'online' : 'offline'});
    // The server answers again: what waited goes out now.
    if (was !== 'online' && get().connection === 'online') {
      retryStep = 0;
      if (get().outbox.length) scheduleReplay(0);
    }
  };

  const markFailure = (err: unknown) => {
    if (isApiError(err) && err.isUnavailable) {
      set({connection: browserOnline() ? 'unavailable' : 'offline'});
      // Keep knocking, so the chip and the outbox recover by themselves.
      if (get().phase === 'ready' && browserOnline() && !retryTimer) {
        scheduleReconnect();
      }
    }
  };

  const expireSession = () => {
    // One 401 may be reported twice (the client's hook and `authed`): the
    // second must not end what the first started (e.g. back from support).
    const token = get().session?.token ?? null;
    if (token !== null && token === expiredToken) return;
    expiredToken = token;
    // E4: a support session that ran out takes the administrator back to
    // their own session instead of the login screen.
    if (get().supportReturn) {
      void restoreOwnSession();
      return;
    }
    writeStoredSession(null);
    // The device keeps its copy and the outbox for this person: signing in
    // again as the same user picks them up (`prepareDevice`).
    if (replayTimer) clearTimeout(replayTimer);
    if (retryTimer) clearTimeout(retryTimer);
    replayTimer = null;
    retryTimer = null;
    set({
      phase: 'login',
      session: null,
      organizations: [],
      ...EMPTY_RECORDS,
      ...IDLE_STATES,
      ...NO_OUTBOX,
      fromCache: false,
      sessionNotice: 'Tu sesión ha caducado. Vuelve a entrar para seguir.',
    });
  };

  // A screen's own `api.*` call, a budget call or a photo that gets a 401
  // ends the session the same way, if it is still the session in use.
  setTokenRejectedHandler(token => {
    if (get().session?.token === token) expireSession();
  });

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
   * Fails at once, without waiting for a timeout, when there is surely no
   * server (no network, or opened from the device's copy). After a failed
   * call (`unavailable`) it still tries: the server may be back.
   */
  const requireConnection = () => {
    const s = get();
    if (!browserOnline() || s.connection === 'offline' || s.fromCache) {
      throw new ApiError({
        code: 'UNAVAILABLE',
        status: 0,
        message: NEEDS_CONNECTION,
      });
    }
  };

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
        .pull()
        .catch(() => undefined);
    }
  };

  // -------------------------------------------------------------- outbox

  const ctxFor = (entry: OutboxEntry) => contextOf(get(), entry);

  const overlayed = (
    key: RecordListKey,
    list: AnyList,
    entries: readonly OutboxEntry[] = get().outbox,
  ): AnyList =>
    overlayList(
      list,
      entries,
      ENTITY_OF[key],
      ctxFor,
      serverCopy,
      goneOnServer,
      SORT_OF[key],
    );

  /** Sets the outbox and shows its changes in every record list. */
  const setOutbox = (next: OutboxEntry[]) => {
    const unsent = unsentRecordIds(next);
    for (const id of [...serverCopy.keys()]) {
      if (!unsent.has(id)) serverCopy.delete(id);
    }
    for (const id of [...goneOnServer]) {
      if (!unsent.has(id)) goneOnServer.delete(id);
    }
    const patch: Record<string, unknown> = {outbox: next, unsent};
    for (const key of RECORD_LISTS) {
      const list = get()[key] as AnyList;
      const shown = overlayed(key, list, next);
      if (shown !== list) patch[key] = shown;
    }
    set(patch as Partial<LogisticsState>);
  };

  /** Records the server copies of records with entries, before overlaying. */
  const captureServer = (
    key: RecordListKey,
    list: AnyList,
    complete: boolean,
  ) => {
    const entity = ENTITY_OF[key];
    for (const e of get().outbox) {
      if (e.entity !== entity || !isUnresolved(e)) continue;
      const hit = list.find(r => r.id === e.recordId);
      if (hit) {
        serverCopy.set(e.recordId, hit);
        goneOnServer.delete(e.recordId);
      } else if (complete && e.op === 'update') {
        serverCopy.delete(e.recordId);
        goneOnServer.add(e.recordId);
      }
    }
  };

  /** Puts a server copy of a record in its list (version-aware). */
  const upsertRecord = (entity: OutboxEntity, record: unknown) => {
    const s = get();
    switch (entity) {
      case 'event':
        return s.upsertEvent(record as LogisticsEvent);
      case 'task':
        return s.upsertTask(record as Task);
      case 'company':
        return s.upsertCompany(record as Company);
      case 'contact':
        return s.upsertContact(record as Contact);
      case 'offer':
        return s.upsertOffer(record as Offer);
      case 'warehouse':
        return s.upsertWarehouse(record as Warehouse);
      case 'resource':
        return s.upsertResource(record as Resource);
      case 'note':
        return s.upsertNote(record as Note);
      case 'media':
        return putMedia(record as MediaInfo);
    }
  };

  /**
   * E3: a stored photo joins its resource's local copy. The resource's
   * version does not change with photos, so the copy is replaced in place.
   */
  const putMedia = (info: MediaInfo) => {
    if (!info || typeof info !== 'object' || !info.ownerId) return;
    changeResource(info.ownerId, r => withMedia(r, info));
  };

  /** Drops a record from its list (a create that only existed here). */
  const dropRecord = (entity: OutboxEntity, id: string) => {
    const key = LIST_OF[entity];
    const list = get()[key] as AnyList;
    if (list.some(r => r.id === id)) {
      set({[key]: list.filter(r => r.id !== id)} as Partial<LogisticsState>);
    }
  };

  const replaceEntry = async (entry: OutboxEntry) => {
    // A reply that lands after logout or an organization change must not
    // put the entry back into a wiped device.
    if (!ownsDevice(entry)) return;
    await device.putEntry(entry);
    setOutbox(get().outbox.map(e => (e.id === entry.id ? entry : e)));
  };

  /** Removes entries and shows what the server has for their records. */
  const removeEntries = async (ids: readonly string[]) => {
    const all = get().outbox;
    const gone = all.filter(e => ids.includes(e.id));
    if (!gone.length) return;
    const rest = all.filter(e => !ids.includes(e.id));
    await Promise.all(gone.map(e => device.deleteEntry(e.id)));
    for (const e of gone) {
      if (rest.some(r => r.recordId === e.recordId)) continue;
      const key = LIST_OF[e.entity];
      const list = get()[key] as AnyList;
      // The server no longer has it: the edited copy must not come back.
      const gone =
        goneOnServer.has(e.recordId) || e.error?.code === 'NOT_FOUND';
      const server = gone
        ? null
        : (serverCopy.get(e.recordId) ??
          (e.op === 'update' ? (e.current ?? e.base) : null));
      if (!server) {
        if (e.op === 'create' || gone) dropRecord(e.entity, e.recordId);
        continue;
      }
      const next = SORT_OF[key]([
        ...list.filter(r => r.id !== e.recordId),
        server as {id: string},
      ]);
      set({[key]: next} as Partial<LogisticsState>);
    }
    setOutbox(rest);
  };

  /** Device id of a create (reused after a network failure, see `deviceIds`). */
  const deviceIdFor = (entity: OutboxEntity, raw: unknown) =>
    deviceIds.get(fingerprint(entity, raw)) ?? uuid();

  const scheduleReplay = (ms: number) => {
    if (replayTimer) clearTimeout(replayTimer);
    replayTimer = setTimeout(
      () => {
        replayTimer = null;
        void get().replay();
      },
      Math.max(0, ms),
    );
  };

  /** Next automatic attempt of entries waiting for a retry. */
  const scheduleNextAttempt = () => {
    const waits = get()
      .outbox.filter(e => e.status === 'pending' && e.nextAttemptAt !== null)
      .map(e => e.nextAttemptAt as number);
    if (waits.length) scheduleReplay(Math.min(...waits) - Date.now());
  };

  /** Keeps trying to reach the server while working on the device's copy. */
  const scheduleReconnect = () => {
    if (retryTimer) clearTimeout(retryTimer);
    const ms =
      RECONNECT_STEPS_MS[Math.min(retryStep, RECONNECT_STEPS_MS.length - 1)];
    retryStep++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void get().syncNow();
    }, ms);
  };

  /** Stores a write in the outbox and shows it at once. */
  const queueWrite = async (
    entity: OutboxEntity,
    op: OutboxOp,
    recordId: string,
    input: Record<string, unknown>,
    options: WriteOptions,
  ): Promise<OptimisticRecord> => {
    const s = get();
    const session = s.session!;
    const orgId = s.orgId!;
    if (
      deviceOwner?.userId !== session.user.id ||
      deviceOwner.orgId !== orgId
    ) {
      // The device copy is being switched over (organization change).
      throw new ApiError({
        code: 'UNAVAILABLE',
        status: 0,
        message: DEVICE_STORAGE_FAILED,
      });
    }
    const key = LIST_OF[entity];
    const list = s[key] as unknown as OptimisticRecord[];
    const shown =
      op === 'update' ? (list.find(r => r.id === recordId) ?? null) : null;
    if (op === 'update' && !shown) {
      throw new ApiError({code: 'NOT_FOUND', status: 0});
    }
    const draft: OutboxEntry = {
      id: uuid(),
      seq: 0,
      userId: session.user.id,
      orgId,
      entity,
      op,
      recordId,
      input,
      base: shown,
      values: null,
      label: '',
      queuedAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      error: null,
      current: null,
      dropped: [],
    };
    const replaced = options.replaces
      ? s.outbox.find(e => e.id === options.replaces)
      : undefined;
    if (
      replaced &&
      replaced.op === 'create' &&
      op === 'create' &&
      replaced.entity === entity &&
      replaced.recordId === recordId
    ) {
      // A reviewed create is rewritten where it stands (same id and seq):
      // later changes of the new record still replay after it.
      const rewritten: OutboxEntry = {
        ...replaced,
        input,
        values: null,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        error: null,
        current: null,
        dropped: [],
      };
      rewritten.label = outboxLabel(
        entity,
        'create',
        recordName(entity, entryRecord(rewritten, null, ctxFor(rewritten))),
      );
      if (!(await device.putEntry(rewritten))) {
        throw new ApiError({
          code: 'INTERNAL',
          status: 0,
          message: DEVICE_STORAGE_FAILED,
        });
      }
      setOutbox(get().outbox.map(e => (e.id === rewritten.id ? rewritten : e)));
      const record =
        (get()[key] as unknown as OptimisticRecord[]).find(
          r => r.id === recordId,
        ) ?? entryRecord(rewritten, null, ctxFor(rewritten));
      queuedRecords.add(record);
      scheduleReplay(0);
      return record;
    }
    const removed = replaced ? [replaced] : [];
    const before = s.outbox.filter(e => e.id !== options.replaces);
    const folded = enqueue(before, draft);
    // The label follows the entry's own operation (an edit of a record
    // created offline is still «Nueva …») and the record's current name.
    const name = recordName(entity, entryRecord(draft, shown, ctxFor(draft)));
    const next = folded.map(e =>
      before.includes(e) ? e : {...e, label: outboxLabel(e.entity, e.op, name)},
    );
    for (const e of next) {
      if (before.includes(e)) continue;
      if (!(await device.putEntry(e))) {
        throw new ApiError({
          code: 'INTERNAL',
          status: 0,
          message: DEVICE_STORAGE_FAILED,
        });
      }
    }
    await Promise.all(removed.map(e => device.deleteEntry(e.id)));
    setOutbox(next);
    const record =
      (get()[key] as unknown as OptimisticRecord[]).find(
        r => r.id === recordId,
      ) ?? entryRecord(draft, shown, ctxFor(draft));
    queuedRecords.add(record);
    scheduleReplay(0);
    return record;
  };

  /**
   * E3: stores a photo upload in the outbox. The resized image stays only in
   * the entry until the server accepts it; at most MEDIA_QUEUE_MAX wait.
   */
  const queuePhoto = async (
    resource: Resource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<void> => {
    const s = get();
    const session = s.session!;
    const orgId = s.orgId!;
    if (
      deviceOwner?.userId !== session.user.id ||
      deviceOwner.orgId !== orgId
    ) {
      throw new ApiError({
        code: 'UNAVAILABLE',
        status: 0,
        message: DEVICE_STORAGE_FAILED,
      });
    }
    if (queuedMedia(s.outbox).length >= MEDIA_QUEUE_MAX) {
      throw new ApiError({
        code: 'VALIDATION',
        status: 0,
        message: PHOTO_QUEUE_FULL,
      });
    }
    const draft: OutboxEntry = {
      id: uuid(),
      seq: 0,
      userId: session.user.id,
      orgId,
      entity: 'media',
      op: 'create',
      recordId: id,
      input,
      base: null,
      values: null,
      label: outboxLabel('media', 'create', resource.name),
      queuedAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      error: null,
      current: null,
      dropped: [],
    };
    const next = enqueue(s.outbox, draft);
    const added = next.find(e => e.id === draft.id);
    if (!added || !(await device.putEntry(added))) {
      throw new ApiError({
        code: 'INTERNAL',
        status: 0,
        message: DEVICE_STORAGE_FAILED,
      });
    }
    setOutbox(next);
    scheduleReplay(0);
  };

  /** E3: changes the photos of a resource's local copy. */
  const changeResource = (id: string, change: (r: Resource) => Resource) => {
    const list = get().resources;
    if (!list.some(r => r.id === id)) return;
    resourceEpoch++;
    set({resources: list.map(r => (r.id === id ? change(r) : r))});
  };

  /**
   * One write of a record: straight to the server when it can, otherwise to
   * the outbox. Online failures behave as before (the form keeps the text and
   * shows the error); after a network failure the next save waits here.
   */
  async function write<R>(
    entity: OutboxEntity,
    op: OutboxOp,
    id: string | null,
    raw: Record<string, unknown>,
    options: WriteOptions = {},
  ): Promise<R> {
    const s = get();
    const orgId = s.orgId;
    const session = s.session;
    if (!orgId || !session) throw new ApiError({code: 'VALIDATION', status: 0});
    const input: Record<string, unknown> = {...raw};
    const replaced = options.replaces
      ? s.outbox.find(e => e.id === options.replaces)
      : undefined;
    if (op === 'create') {
      input.organizationId = orgId;
      // A reviewed new record keeps its device id (later changes point at it).
      if (typeof input.id !== 'string') {
        input.id =
          replaced?.op === 'create' && replaced.entity === entity
            ? replaced.recordId
            : deviceIdFor(entity, raw);
      }
    }
    const recordId = op === 'create' ? String(input.id) : String(id);
    if (localIdsIn(input).length) {
      throw new ApiError({
        code: 'VALIDATION',
        status: 0,
        message: LOCAL_REF_MESSAGE,
      });
    }
    const others = s.outbox.filter(e => e.id !== options.replaces);
    if (
      canQueue(session.user.role, entity, op) &&
      mustQueue(others, s.connection, recordId, input)
    ) {
      const queued = await queueWrite(entity, op, recordId, input, options);
      // The entry carries the id now: a second save is a second record.
      if (op === 'create') deviceIds.delete(fingerprint(entity, raw));
      return queued as R;
    }
    // A reply that lands after logout or an organization change must not
    // touch the next person's lists.
    const stillHere = () =>
      get().session?.user.id === session.user.id && get().orgId === orgId;
    try {
      const saved = await authed(token =>
        op === 'create'
          ? SEND[entity].create(token, input)
          : SEND[entity].update(token, recordId, input),
      );
      if (!stillHere()) return saved as R;
      deviceIds.delete(fingerprint(entity, raw));
      if (options.replaces) await removeEntries([options.replaces]);
      upsertRecord(entity, saved);
      void get()
        .pull()
        .catch(() => undefined);
      return saved as R;
    } catch (err) {
      if (!stillHere()) throw err;
      if (op === 'create' && isApiError(err) && err.isUnavailable) {
        deviceIds.set(fingerprint(entity, raw), recordId);
      }
      if (op === 'update') {
        const current = conflictCopy<unknown>(err);
        // Keep the list honest: show what the server has now.
        if (current) upsertRecord(entity, current);
      }
      if (entity === 'company' || entity === 'warehouse') {
        keepDuplicate(err, entity);
      }
      throw err;
    }
  }

  /** The server accepted a replayed write (or already had it). */
  const accept = async (entry: OutboxEntry, saved: OptimisticRecord) => {
    if (!ownsDevice(entry)) return;
    const rest = get().outbox.filter(e => e.id !== entry.id);
    // Rebase later entries only past this user's own write (M6 review):
    // otherwise they meet a 409 and the merge.
    const rebased = settleAccepted(get().outbox, entry, saved.version);
    await Promise.all(
      rebased.filter(e => !rest.includes(e)).map(e => device.putEntry(e)),
    );
    await device.deleteEntry(entry.id);
    if (saved.id !== entry.recordId) {
      // An older server ignored the device id: the local placeholder goes.
      dropRecord(entry.entity, entry.recordId);
    }
    serverCopy.set(saved.id, saved);
    goneOnServer.delete(saved.id);
    upsertRecord(entry.entity, saved);
    setOutbox(rebased);
  };

  /** A replayed write failed; true when the replay should stop for now. */
  const fail = async (entry: OutboxEntry, err: unknown): Promise<boolean> => {
    // The device changed hands while the request ran: nothing to record.
    if (!ownsDevice(entry)) return true;
    const e = isApiError(err)
      ? err
      : new ApiError({code: 'INTERNAL', status: 0});
    if (
      e.code === 'VERSION_CONFLICT' &&
      // A photo has no optimistic record (and its upload never answers 409).
      entry.entity !== 'media' &&
      alreadyApplied(entry, e.current, ctxFor(entry))
    ) {
      // Our own change came back (a lost response): nothing to ask.
      await accept(entry, e.current as OptimisticRecord);
      return false;
    }
    const outcome = replayOutcome(e.code, entry.attempts);
    const error = {
      code: e.code,
      message: e.message,
      ...(e.fields ? {fields: e.fields} : {}),
    };
    if (outcome === 'retry') {
      await replaceEntry({
        ...entry,
        status: 'pending',
        nextAttemptAt:
          Date.now() + retryDelayMs(entry.attempts, e.retryAfterSeconds),
        error,
      });
      return true;
    }
    if (outcome === 'paused') {
      // The session ended: wait for the same person, as it was.
      await replaceEntry({
        ...entry,
        status: 'pending',
        attempts: Math.max(0, entry.attempts - 1),
        nextAttemptAt: null,
      });
      return true;
    }
    const current =
      e.current && typeof e.current === 'object' && !Array.isArray(e.current)
        ? e.current
        : null;
    if (outcome === 'conflict') {
      if (current) {
        if (entry.op === 'update') serverCopy.set(entry.recordId, current);
        // The list shows what the server has; nothing is overwritten.
        upsertRecord(entry.entity, current);
      }
      await replaceEntry({
        ...entry,
        status: 'conflict',
        error,
        current,
        nextAttemptAt: null,
      });
      get().toast(
        e.code === 'DUPLICATE'
          ? `No se ha enviado ${entry.label}: ya existe un registro con ese nombre. Revísalo en «Cambios pendientes».`
          : `${entry.label}: otra persona lo cambió mientras no había conexión. Nada se ha sobrescrito; revísalo en «Cambios pendientes».`,
        'info',
        {durationMs: 8000},
      );
      return false;
    }
    // Rejected: the server refused the content.
    if (e.code === 'NOT_FOUND' && entry.op === 'update') {
      goneOnServer.add(entry.recordId);
      serverCopy.delete(entry.recordId);
      dropRecord(entry.entity, entry.recordId);
    }
    await replaceEntry({
      ...entry,
      status: 'rejected',
      error,
      nextAttemptAt: null,
    });
    get().toast(
      `No se ha enviado ${entry.label}: ${e.message} Revísalo en «Cambios pendientes».`,
      'error',
      {durationMs: 8000},
    );
    return false;
  };

  /**
   * Deleting a record that only exists on this device: its waiting changes
   * are dropped instead of asking the server. True when that was the case.
   */
  const discardLocalCreate = async (
    entity: OutboxEntity,
    id: string,
  ): Promise<boolean> => {
    const entries = get().outbox.filter(
      e => e.entity === entity && e.recordId === id,
    );
    if (!entries.some(e => e.op === 'create')) return false;
    await removeEntries(entries.map(e => e.id));
    dropRecord(entity, id);
    return true;
  };

  /** After a delete accepted by the server, its waiting changes go too. */
  const forgetRecord = async (id: string) => {
    const ids = get()
      .outbox.filter(e => e.recordId === id)
      .map(e => e.id);
    if (!ids.length) return;
    await Promise.all(ids.map(x => device.deleteEntry(x)));
    setOutbox(get().outbox.filter(e => !ids.includes(e.id)));
  };

  /**
   * Before a user's data lands on this device: another person's copy is
   * wiped, the session is remembered, and the user's outbox comes back.
   */
  const prepareDevice = async (
    user: SessionUser,
    orgId: string | null,
    organizations: Organization[],
  ): Promise<OutboxEntry[]> => {
    const owner = await device.cacheOwner();
    if (device.wipePending() || !device.ownedBy(owner, user)) {
      // Another person, the same person with another role, or a wipe that
      // did not complete earlier.
      resetOfflineMemory();
      if (!(await device.wipeDevice())) {
        // Nothing is kept or queued here until a wipe succeeds (next boot).
        return [];
      }
    }
    await device.saveSession({
      user,
      organizations,
      orgId,
      savedAt: Date.now(),
    });
    deviceOwner = orgId ? {userId: user.id, orgId} : null;
    return orgId ? settleLoaded(await device.loadOutbox(user.id, orgId)) : [];
  };

  /**
   * Opens the window with a session the server just gave (login, support
   * session, or back to the own session): someone else's copy is wiped
   * before anything of this user lands.
   */
  async function enterSession(res: LoginResponse): Promise<void> {
    const session: StoredSession = {
      token: res.token,
      expiresAt: res.expiresAt,
      user: res.user,
    };
    writeStoredSession(session);
    const orgId = pickOrg(res.organizations, readStoredOrg());
    writeStoredOrg(orgId);
    resetOfflineMemory();
    expiredToken = null;
    const entries = await prepareDevice(res.user, orgId, res.organizations);
    set({
      phase: 'ready',
      session,
      organizations: res.organizations,
      orgId,
      sessionNotice: null,
      ...EMPTY_RECORDS,
      // Loading, not empty: no «nothing here» nor «No se encuentra esa
      // ficha» while the new session's lists arrive.
      ...IDLE_STATES,
      fromCache: false,
      outbox: entries,
      unsent: unsentRecordIds(entries),
      leave: null,
      // A «Deshacer» must never run under another account.
      ...dropToasts(),
    });
    markReachable();
    void get()
      .refresh()
      .then(() => get().replay());
  }

  /**
   * E4: leaves a support session (ended or run out) for the administrator's
   * own session. If that one is gone too, the login screen.
   */
  async function restoreOwnSession(): Promise<void> {
    const back = get().supportReturn;
    writeStoredSupport(null);
    set({supportReturn: null});
    if (!back) return;
    try {
      const me = await api.me(back.session.token);
      await enterSession({
        token: back.session.token,
        expiresAt: back.session.expiresAt,
        user: me.user,
        organizations: me.organizations,
      });
      get().toast(
        back.kind === 'support'
          ? 'Sesión de soporte terminada. Vuelves a tu cuenta.'
          : 'Has dejado de ver como Invitado.',
        'success',
      );
    } catch {
      writeStoredSession(null);
      resetOfflineMemory();
      set({
        phase: 'login',
        session: null,
        organizations: [],
        ...EMPTY_RECORDS,
        ...IDLE_STATES,
        ...NO_OUTBOX,
        fromCache: false,
        sessionNotice: 'La sesión de soporte ha terminado. Vuelve a entrar.',
        ...dropToasts(),
      });
      await device.wipeDevice();
    }
  }

  /** Opens the window from the device's copy, without the server. */
  const openLocal = (
    stored: StoredSession,
    local: LocalCopy,
    connection: Connection,
  ) => {
    cursor = local.cursor;
    changesSupported = null;
    deviceOwner = {userId: stored.user.id, orgId: local.orgId};
    const l = local.lists;
    set({
      phase: 'ready',
      session: stored,
      organizations: local.organizations,
      orgId: local.orgId,
      sessionNotice: null,
      connection,
      fromCache: true,
      events: arr(l.events),
      venues: arr(l.venues),
      tasks: arr(l.tasks),
      companies: arr(l.companies),
      categories: arr(l.categories),
      contacts: arr(l.contacts),
      offers: arr(l.offers),
      warehouses: arr(l.warehouses),
      resources: arr(l.resources),
      notes: arr(l.notes),
      hypotheses: arr(l.hypotheses),
      acceptances: arr(l.acceptances),
      activity: arr(l.activity),
      eventsState: 'ready',
      tasksState: 'ready',
      companiesState: 'ready',
      contactsState: 'ready',
      offersState: 'ready',
      warehousesState: 'ready',
      resourcesState: 'ready',
      notesState: 'ready',
      hypothesesState: 'ready',
      acceptancesState: 'ready',
      activityState: 'ready',
      lastSyncAt: local.savedAt,
    });
    // Changes queued just before the tab closed may be newer than the cached
    // lists: overlay them, so the lists and the day close show them.
    setOutbox(local.outbox);
    retryStep = 0;
    scheduleReconnect();
  };

  /**
   * The server answers again: confirms the session (opened from the device)
   * or simply the connection. False when it is still out of reach.
   */
  const reconnect = async (): Promise<boolean> => {
    const session = get().session;
    if (!session) return false;
    try {
      const health = await api.health();
      if (health.database !== 'ok') {
        set({connection: 'unavailable'});
        return false;
      }
    } catch {
      set({connection: browserOnline() ? 'unavailable' : 'offline'});
      return false;
    }
    if (!get().fromCache) {
      set({connection: 'online'});
      return true;
    }
    try {
      const me = await api.me(session.token);
      if (get().session?.token !== session.token) return false;
      const next = {...session, user: me.user};
      writeStoredSession(next);
      const orgId = pickOrg(me.organizations, get().orgId);
      const sameOrg = orgId === get().orgId;
      set({
        session: next,
        organizations: me.organizations,
        orgId,
        fromCache: false,
        connection: 'online',
        sessionNotice: null,
        ...(sameOrg ? {} : {...EMPTY_RECORDS, ...NO_OUTBOX}),
      });
      if (!sameOrg) {
        writeStoredOrg(orgId);
        const entries = await prepareDevice(me.user, orgId, me.organizations);
        if (get().orgId === orgId) setOutbox(entries);
      } else {
        void device.saveSession({
          user: me.user,
          organizations: me.organizations,
          orgId,
          savedAt: Date.now(),
        });
      }
      return true;
    } catch (err) {
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
        // The usual expiry: the outbox stays on the device, paused.
        expireSession();
        return false;
      }
      set({connection: browserOnline() ? 'unavailable' : 'offline'});
      return false;
    }
  };

  /**
   * Reloads `lists` from the server. A full reload also asks `…/changes`
   * for a fresh cursor. True when every list asked for arrived.
   */
  async function load(
    lists: ReadonlySet<SyncList>,
    silent: boolean,
  ): Promise<boolean> {
    const orgId = get().orgId;
    if (!orgId || get().phase !== 'ready' || !get().session) return false;
    if (get().fromCache) return false;
    const want = (l: SyncList) => lists.has(l);
    const full = SYNC_LISTS.every(want);
    if (!silent) {
      const loading: Partial<LogisticsState> = {};
      if (want('events')) {
        Object.assign(loading, {eventsState: 'loading', eventsError: null});
      }
      if (want('tasks')) {
        Object.assign(loading, {tasksState: 'loading', tasksError: null});
      }
      if (want('activity')) {
        Object.assign(loading, {activityState: 'loading', activityError: null});
      }
      if (want('companies')) {
        Object.assign(loading, {
          companiesState: 'loading',
          companiesError: null,
        });
      }
      if (want('contacts')) {
        Object.assign(loading, {contactsState: 'loading', contactsError: null});
      }
      if (want('offers')) {
        Object.assign(loading, {offersState: 'loading', offersError: null});
      }
      if (want('warehouses')) {
        Object.assign(loading, {
          warehousesState: 'loading',
          warehousesError: null,
        });
      }
      if (want('resources')) {
        Object.assign(loading, {
          resourcesState: 'loading',
          resourcesError: null,
        });
      }
      if (want('notes')) {
        Object.assign(loading, {notesState: 'loading', notesError: null});
      }
      set(loading);
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
    // E4: without `directory.read` the server answers 403 to these lists;
    // they are simply empty for this viewer (Contactos and Catálogo say why).
    const directory = can(
      orgPermissions(
        get().organizations.find(o => o.id === orgId),
        get().session?.user.role,
      ),
      'directory.read',
    );
    const ask = <T>(
      list: SyncList,
      call: (token: string) => Promise<T>,
    ): Promise<T> =>
      !want(list)
        ? Promise.reject(SKIP)
        : !directory && DIRECTORY_LISTS.has(list)
          ? Promise.resolve({items: []} as unknown as T)
          : authed(call);
    const [
      changes,
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
      acceptances,
    ] = await Promise.allSettled([
      full ? authed(token => api.changes(token, orgId)) : Promise.reject(SKIP),
      ask('events', token => api.events(token, orgId)),
      ask('activity', token => api.activity(token, orgId, 20)),
      ask('venues', token => api.venues(token, orgId)),
      ask('tasks', token => api.tasks(token, orgId)),
      ask('companies', token => api.companies(token, orgId)),
      ask('categories', token => api.categories(token, orgId)),
      ask('contacts', token => api.contacts(token, orgId)),
      ask('offers', token => api.offers(token, orgId)),
      ask('warehouses', token => api.warehouses(token, orgId)),
      ask('resources', token => api.resources(token, orgId)),
      ask('notes', token => api.notes(token, orgId)),
      ask('hypotheses', token => api.hypotheses(token, orgId)),
      ask('acceptances', token => api.acceptances(token, orgId)),
    ]);
    // The organization may have changed while loading.
    if (get().orgId !== orgId || get().phase !== 'ready') return false;
    const failed = (r: PromiseSettledResult<unknown>) =>
      r.status === 'rejected' && r.reason !== SKIP;
    const allOk = ![
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
    ].some(failed);

    if (full) {
      if (changes.status === 'fulfilled') {
        changesSupported = true;
        cursor = changes.value.cursor;
        const user = get().session?.user.id;
        if (user && allOk) void device.saveCursor(user, orgId, cursor);
      } else if (
        failed(changes) &&
        isApiError(changes.reason) &&
        changes.reason.code === 'NOT_FOUND'
      ) {
        // An older server: every poll is a full reload, as before M6.
        changesSupported = false;
        cursor = null;
      }
    }

    const patch: Partial<LogisticsState> = {};
    if (events.status === 'fulfilled' && epoch !== writeEpoch) {
      // A write finished while this request was in flight: its list may not
      // include it. The refresh that write triggered brings the fresh list.
    } else if (events.status === 'fulfilled') {
      patch.events = mergeServerEvents(get().events, events.value.items);
      patch.eventsState = 'ready';
      patch.eventsError = null;
      patch.lastSyncAt = Date.now();
    } else if (failed(events) && (!silent || get().eventsState !== 'ready')) {
      patch.eventsState = 'error';
      patch.eventsError = errorMessage(events.reason);
    }
    if (activity.status === 'fulfilled') {
      patch.activity = keepIfSame(get().activity, activity.value.items);
      patch.activityState = 'ready';
      patch.activityError = null;
    } else if (
      failed(activity) &&
      (!silent || get().activityState !== 'ready')
    ) {
      patch.activityState = 'error';
      patch.activityError = errorMessage(activity.reason);
    }
    if (tasks.status === 'fulfilled' && tEpoch !== taskEpoch) {
      // Same as events: a task write's own refresh brings the fresh list.
    } else if (tasks.status === 'fulfilled') {
      patch.tasks = mergeServerTasks(get().tasks, tasks.value.items);
      patch.tasksState = 'ready';
      patch.tasksError = null;
    } else if (failed(tasks) && (!silent || get().tasksState !== 'ready')) {
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
    } else if (
      failed(companies) &&
      (!silent || get().companiesState !== 'ready')
    ) {
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
    } else if (
      failed(contacts) &&
      (!silent || get().contactsState !== 'ready')
    ) {
      patch.contactsState = 'error';
      patch.contactsError = errorMessage(contacts.reason);
    }
    if (offers.status === 'fulfilled' && ofEpoch !== offerEpoch) {
      // Same as above.
    } else if (offers.status === 'fulfilled') {
      patch.offers = mergeServerOffers(get().offers, offers.value.items);
      patch.offersState = 'ready';
      patch.offersError = null;
    } else if (failed(offers) && (!silent || get().offersState !== 'ready')) {
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
    } else if (
      failed(warehouses) &&
      (!silent || get().warehousesState !== 'ready')
    ) {
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
    } else if (
      failed(resources) &&
      (!silent || get().resourcesState !== 'ready')
    ) {
      patch.resourcesState = 'error';
      patch.resourcesError = errorMessage(resources.reason);
    }
    if (notes.status === 'fulfilled' && noEpoch !== noteEpoch) {
      // Same as above.
    } else if (notes.status === 'fulfilled') {
      patch.notes = mergeServerNotes(get().notes, notes.value.items);
      patch.notesState = 'ready';
      patch.notesError = null;
    } else if (failed(notes) && (!silent || get().notesState !== 'ready')) {
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
    } else if (failed(hypotheses)) {
      if (!silent || get().hypothesesState !== 'ready') {
        patch.hypothesesState = 'error';
      }
    }
    // Accepted conflicts (Revisión 1 · E2): quiet on failure too; an older
    // server without the route (404) simply has none.
    if (acceptances.status === 'fulfilled') {
      patch.acceptances = keepIfSame(
        get().acceptances,
        acceptances.value.items,
      );
      patch.acceptancesState = 'ready';
    } else if (failed(acceptances)) {
      if (
        isApiError(acceptances.reason) &&
        acceptances.reason.code === 'NOT_FOUND'
      ) {
        patch.acceptances = [];
        patch.acceptancesState = 'ready';
      } else if (!silent || get().acceptancesState !== 'ready') {
        patch.acceptancesState = 'error';
      }
    }
    // M6: the device's waiting changes stay visible over the server lists.
    if (get().outbox.length) {
      for (const key of RECORD_LISTS) {
        const list = patch[key] as AnyList | undefined;
        if (!list) continue;
        captureServer(key, list, true);
        (patch as Record<string, unknown>)[key] = overlayed(key, list);
      }
    }
    set(patch);
    if (full && allOk) lastFullAt = Date.now();
    return allOk;
  }

  return {
    phase: 'checking',
    unreachableReason: 'network',
    connection: browserOnline() ? 'online' : 'offline',
    session: null,
    organizations: [],
    orgId: null,
    sessionNotice: null,
    supportReturn: readStoredSupport(),
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
    acceptances: [],
    acceptancesState: 'idle',
    recentSearches: [],
    recentState: 'idle',
    activity: [],
    activityState: 'idle',
    activityError: null,
    lastSyncAt: null,
    outbox: [],
    unsent: EMPTY_UNSENT,
    syncing: false,
    fromCache: false,
    leave: null,
    toasts: [],

    boot: async () => {
      if (!resolveApiBaseUrl()) {
        set({phase: 'not_configured'});
        return;
      }
      set({phase: 'checking'});
      const stored = readStoredSession();
      // A wipe that did not complete (logout, organization change) is done
      // first; while it is owed, nothing is opened from the device.
      const wipeOwed = device.wipePending() && !(await device.wipeDevice());
      // M6: what this device can open without the server, if it must.
      const local = stored && !wipeOwed ? await loadLocalCopy(stored) : null;
      if (stored && local && !browserOnline()) {
        openLocal(stored, local, 'offline');
        return;
      }
      const probe = new AbortController();
      const probeTimer = local
        ? setTimeout(() => probe.abort(), BOOT_PROBE_MS)
        : null;
      try {
        const health = await api.health(probe.signal);
        if (health.database !== 'ok') {
          if (stored && local) {
            openLocal(stored, local, 'unavailable');
            return;
          }
          set({phase: 'unreachable', unreachableReason: 'database'});
          return;
        }
        markReachable();
      } catch (err) {
        if (isApiError(err) && err.code === 'NOT_CONFIGURED') {
          set({phase: 'not_configured'});
          return;
        }
        if (stored && local) {
          openLocal(stored, local, browserOnline() ? 'unavailable' : 'offline');
          return;
        }
        set({
          phase: 'unreachable',
          unreachableReason: 'network',
          connection: browserOnline() ? 'unavailable' : 'offline',
        });
        return;
      } finally {
        if (probeTimer) clearTimeout(probeTimer);
      }

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
        const entries = await prepareDevice(me.user, orgId, me.organizations);
        set({
          phase: 'ready',
          session,
          organizations: me.organizations,
          orgId,
          sessionNotice: null,
          fromCache: false,
          outbox: entries,
          unsent: unsentRecordIds(entries),
        });
        void get()
          .refresh()
          .then(() => get().replay());
      } catch (err) {
        if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
          expireSession();
        } else if (local) {
          openLocal(stored, local, browserOnline() ? 'unavailable' : 'offline');
        } else {
          set({
            phase: 'unreachable',
            unreachableReason: 'network',
            connection: browserOnline() ? 'unavailable' : 'offline',
          });
        }
      }
    },

    login: async (username, password) => {
      // `displayName` too, so a server not yet migrated to E4 still accepts it.
      const res = await api.login({
        username,
        displayName: username,
        password,
      });
      await enterSession(res);
    },

    refreshAccount: async user => {
      const session = get().session;
      if (!session) return;
      if (user) {
        const next = {...session, user};
        writeStoredSession(next);
        set({session: next});
        return;
      }
      try {
        const me = await api.me(session.token);
        if (get().session?.token !== session.token) return;
        const next = {...session, user: me.user};
        writeStoredSession(next);
        const patch: Partial<LogisticsState> = {session: next};
        // Permissions change with the password (provisional or not).
        const orgId = get().orgId;
        const before = get().organizations.find(o => o.id === orgId);
        const after = me.organizations.find(o => o.id === orgId);
        if (after) patch.organizations = me.organizations;
        set(patch);
        const reads = (o: Organization | undefined) =>
          can(orgPermissions(o, me.user.role), 'directory.read');
        if (after && reads(after) !== reads(before)) {
          void get().refresh({silent: true});
        }
      } catch {
        // Not now: the next `GET /me` (reconnection, reload) brings it.
      }
    },

    beginSupport: async (res, minutes) => {
      const own = get().session;
      if (!own) throw new ApiError({code: 'UNAUTHENTICATED', status: 401});
      if (get().outbox.some(isUnresolved)) {
        // The server already opened it: close it again, unused.
        await api.logout(res.token).catch(() => undefined);
        throw new ApiError({
          code: 'VALIDATION',
          status: 0,
          message:
            'Tienes cambios sin enviar en este dispositivo. Envíalos antes de entrar en otra cuenta.',
        });
      }
      // The server's end, unless this device's clock disagrees with it.
      const serverEnds = Date.parse(res.user.support?.endsAt ?? res.expiresAt);
      const left = serverEnds - Date.now();
      const endsAt =
        left > 0 && left <= (minutes + 1) * 60_000
          ? new Date(serverEnds).toISOString()
          : new Date(Date.now() + minutes * 60_000).toISOString();
      const back: SupportReturn = {
        sessionId: res.sessionId,
        kind: res.user.support?.kind ?? 'support',
        // Kept as it is now; the own token never goes to the device's copy.
        session: get().supportReturn?.session ?? own,
        endsAt,
      };
      writeStoredSupport(back);
      set({supportReturn: back});
      await enterSession(res);
    },

    endSupport: async () => {
      const back = get().supportReturn;
      if (!back) return;
      const token = get().session?.token;
      // Signing out of the support token ends it on the server (logged);
      // best effort: it may have run out already. If that fails, the
      // administrator's own token ends it by id.
      if (token && token !== back.session.token) {
        const ended = await api.logout(token).then(
          () => true,
          () => false,
        );
        if (!ended) {
          await api
            .endSupportSession(back.session.token, back.sessionId)
            .catch(() => undefined);
        }
      }
      await restoreOwnSession();
    },

    logout: async ({discardUnsent = false, notice} = {}) => {
      // E4: signing out of a support session ends it and goes back.
      if (get().supportReturn) {
        await get().endSupport();
        return;
      }
      if (!discardUnsent && get().outbox.some(isUnresolved)) {
        set({leave: {kind: 'logout'}});
        return;
      }
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
      // «Tareas» filters stay with the person, not the device.
      clearTasksPrefs();
      writeStoredSession(null);
      resetOfflineMemory();
      set({
        phase: 'login',
        session: null,
        organizations: [],
        ...EMPTY_RECORDS,
        ...IDLE_STATES,
        ...NO_OUTBOX,
        fromCache: false,
        sessionNotice: notice ?? null,
        // A «Deshacer» left on screen must never run under the next person.
        ...dropToasts(),
      });
      // M6: the device's copy (contacts, notes, the outbox) goes too.
      await device.wipeDevice();
      if (token) {
        // Best effort: the local session is already gone either way.
        await api.logout(token).catch(() => undefined);
      }
    },

    selectOrg: (id, {discardUnsent = false} = {}) => {
      if (id === get().orgId) return;
      // The device keeps one organization: without the server the other one
      // could not be loaded, and this one would already be wiped.
      if (
        !browserOnline() ||
        get().connection === 'offline' ||
        get().fromCache
      ) {
        get().toast(
          'Cambiar de organización necesita conexión: se cargan sus datos del servidor.',
          'info',
        );
        set({leave: null});
        return;
      }
      if (!discardUnsent && get().outbox.some(isUnresolved)) {
        set({leave: {kind: 'org', orgId: id}});
        return;
      }
      writeStoredOrg(id);
      resetOfflineMemory();
      // Toasts (and their «Deshacer») belong to the organization left behind.
      set({
        orgId: id,
        ...EMPTY_RECORDS,
        // Idle until reloaded: the device copy never keeps an empty list.
        ...IDLE_STATES,
        ...dropToasts(),
        ...NO_OUTBOX,
      });
      const s = get();
      // The device keeps one organization at a time (shared devices).
      let wiped = false;
      void device
        .wipeDevice()
        .then(ok => {
          wiped = ok;
          return ok && s.session
            ? device.saveSession({
                user: s.session.user,
                organizations: s.organizations,
                orgId: id,
                savedAt: Date.now(),
              })
            : undefined;
        })
        .finally(() => {
          if (get().orgId !== id) return;
          // A failed wipe leaves the device out of use (online only) until
          // the next boot completes it.
          if (s.session && wiped) {
            deviceOwner = {userId: s.session.user.id, orgId: id};
          }
          void get().refresh();
        });
    },

    refresh: async ({silent = false, lists = ALL_LISTS} = {}) => {
      await load(lists, silent);
    },

    pull: async () => {
      const s = get();
      if (s.phase !== 'ready' || !s.orgId || !s.session || s.fromCache) return;
      const orgId = s.orgId;
      if (changesSupported !== true || !cursor) {
        await load(ALL_LISTS, true);
        return;
      }
      const since = cursor;
      let res;
      try {
        res = await authed(token => api.changes(token, orgId, since));
      } catch (err) {
        if (isApiError(err) && err.code === 'NOT_FOUND') {
          changesSupported = false;
          cursor = null;
          await load(ALL_LISTS, true);
        }
        return;
      }
      if (get().orgId !== orgId || get().phase !== 'ready') return;
      // E2: the acronym lives in the session's organizations (`GET /me`).
      if (res.types.includes('organization')) {
        void get().refreshAccount();
      }
      const lists = listsToReload(res);
      if (SYNC_LISTS.every(l => lists.has(l))) {
        await load(ALL_LISTS, true);
        return;
      }
      const ok = lists.size ? await load(lists, true) : true;
      if (!ok || get().orgId !== orgId) return;
      cursor = res.cursor;
      const user = get().session?.user.id;
      if (user) void device.saveCursor(user, orgId, cursor);
      if (!lists.has('events')) set({lastSyncAt: Date.now()});
    },

    syncNow: async ({full = false, now = false} = {}) => {
      const s = get();
      if (s.phase !== 'ready' || !s.session) return;
      if (now) {
        // «Enviar ahora»: a person asked, so entries waiting for their
        // back-off are due at once (QA M6).
        const waiting = s.outbox.filter(
          e => e.status === 'pending' && e.nextAttemptAt !== null,
        );
        if (waiting.length) {
          const due = waiting.map(e => ({...e, nextAttemptAt: null}));
          await Promise.all(due.map(e => device.putEntry(e)));
          setOutbox(get().outbox.map(e => due.find(d => d.id === e.id) ?? e));
        }
      }
      if (!browserOnline()) {
        if (s.connection !== 'offline') set({connection: 'offline'});
        return;
      }
      if (s.fromCache || s.connection !== 'online') {
        const back = await reconnect();
        if (!back) {
          if (get().phase === 'ready') scheduleReconnect();
          return;
        }
        retryStep = 0;
        full = true;
      }
      if (
        full ||
        changesSupported !== true ||
        !cursor ||
        Date.now() - lastFullAt >= FULL_REFRESH_MS
      ) {
        await load(ALL_LISTS, true);
      } else {
        await get().pull();
      }
      await get().replay();
    },

    replay: async () => {
      if (replaying) return;
      const start = get();
      if (
        start.phase !== 'ready' ||
        !start.session ||
        !start.orgId ||
        start.fromCache ||
        !browserOnline()
      ) {
        return;
      }
      if (!nextToSend(start.outbox, Date.now())) {
        scheduleNextAttempt();
        return;
      }
      replaying = true;
      set({syncing: true});
      const orgId = start.orgId;
      const userId = start.session.user.id;
      let accepted = 0;
      try {
        for (;;) {
          const s = get();
          if (
            s.phase !== 'ready' ||
            s.orgId !== orgId ||
            s.session?.user.id !== userId
          ) {
            break;
          }
          const entry = nextToSend(s.outbox, Date.now());
          if (!entry) break;
          // The review was for the placement the user saw (M5 audit).
          const guarded = guardSubsoil(
            entry,
            serverCopy.get(entry.recordId) ?? null,
          );
          if (
            guarded.dropped.includes('subsoilReviewed') &&
            !entry.dropped.includes('subsoilReviewed')
          ) {
            get().toast(subsoilDroppedText(entry.label), 'info', {
              durationMs: 10_000,
            });
          }
          const sending: OutboxEntry = {
            ...guarded,
            status: 'sending',
            attempts: guarded.attempts + 1,
            nextAttemptAt: null,
          };
          await replaceEntry(sending);
          let saved: unknown = null;
          let error: unknown = null;
          try {
            saved = await authed(token =>
              sending.op === 'create'
                ? SEND[sending.entity].create(token, sending.input)
                : SEND[sending.entity].update(
                    token,
                    sending.recordId,
                    sending.input,
                  ),
            );
          } catch (err) {
            error = err ?? new Error('replay');
          }
          if (error === null) {
            await accept(sending, saved as OptimisticRecord);
            accepted++;
            continue;
          }
          if (await fail(sending, error)) break;
        }
      } finally {
        replaying = false;
        set({syncing: false});
        scheduleNextAttempt();
      }
      if (accepted && get().phase === 'ready') {
        void get()
          .pull()
          .catch(() => undefined);
      }
    },

    retryEntry: async id => {
      const entry = get().outbox.find(e => e.id === id);
      if (!entry) return;
      await replaceEntry({
        ...entry,
        status: 'pending',
        attempts: entry.status === 'pending' ? entry.attempts : 0,
        nextAttemptAt: null,
        error: null,
      });
      await get().syncNow();
    },

    discardEntry: async (id, {useInstead} = {}) => {
      const entry = get().outbox.find(e => e.id === id);
      if (!entry) return;
      // A new record goes with every later change of it.
      const ids =
        entry.op === 'create'
          ? get()
              .outbox.filter(e => e.recordId === entry.recordId)
              .map(e => e.id)
          : [id];
      await removeEntries(ids);
      if (entry.op === 'create') dropRecord(entry.entity, entry.recordId);
      if (entry.op !== 'create' || !useInstead || !ownsDevice(entry)) return;
      // «Usar la existente»: waiting changes that pointed at the discarded
      // new record (a contact of that company) point at the existing one.
      const from = entry.recordId.toLowerCase();
      const moved: OutboxEntry[] = [];
      const next = get().outbox.map(e => {
        if (!referencedIds(e.input).has(from)) return e;
        const swapped = {
          ...e,
          input: swapId(e.input, from, useInstead) as Record<string, unknown>,
        };
        moved.push(swapped);
        return swapped;
      });
      if (!moved.length) return;
      await Promise.all(moved.map(e => device.putEntry(e)));
      setOutbox(next);
      scheduleReplay(0);
    },

    cancelLeave: () => set({leave: null}),

    toastSaved: (record, message, options) => {
      if (queuedRecords.has(record)) get().toast(QUEUED_NOTE, 'info', options);
      else get().toast(message, 'success', options);
    },

    createEvent: (input, options) =>
      write<LogisticsEvent>('event', 'create', null, {...input}, options),

    updateEvent: (id, input, options) =>
      write<LogisticsEvent>('event', 'update', id, {...input}, options),

    upsertEvent: event => {
      writeEpoch++;
      const current = get().events.find(e => e.id === event.id);
      // Never replace a newer copy with an older one.
      if (current && current.version > event.version) return;
      const rest = get().events.filter(e => e.id !== event.id);
      set({events: sortEvents([...rest, event]), eventsState: 'ready'});
    },

    createTask: (input, options) =>
      write<Task>('task', 'create', null, {...input}, options),

    updateTask: (id, input, options) =>
      write<Task>('task', 'update', id, {...input}, options),

    deleteTask: async task => {
      if (await discardLocalCreate('task', task.id)) return;
      requireConnection();
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
      await forgetRecord(task.id);
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
      const refreshed = get().pull();
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
      requireConnection();
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
      void get()
        .pull()
        .catch(() => undefined);
      return category;
    },

    deleteCategory: async category => {
      requireConnection();
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
        .pull()
        .catch(() => undefined);
    },

    createCompany: (input, options) =>
      write<Company>('company', 'create', null, {...input}, options),

    updateCompany: (id, input, options) =>
      write<Company>('company', 'update', id, {...input}, options),

    deleteCompany: async company => {
      if (await discardLocalCreate('company', company.id)) return;
      requireConnection();
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
      await forgetRecord(company.id);
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
        .pull()
        .catch(() => undefined);
    },

    upsertCompany: company => {
      companyEpoch++;
      const next = upsertInto(get().companies, company, sortCompanies);
      if (next) set({companies: next, companiesState: 'ready'});
    },

    createContact: (input, options) =>
      write<Contact>('contact', 'create', null, {...input}, options),

    updateContact: (id, input, options) =>
      write<Contact>('contact', 'update', id, {...input}, options),

    deleteContact: async contact => {
      if (await discardLocalCreate('contact', contact.id)) return;
      requireConnection();
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
      await forgetRecord(contact.id);
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
        .pull()
        .catch(() => undefined);
    },

    upsertContact: contact => {
      contactEpoch++;
      const next = upsertInto(get().contacts, contact, sortContacts);
      if (next) set({contacts: next, contactsState: 'ready'});
    },

    createOffer: (input, options) =>
      write<Offer>('offer', 'create', null, {...input}, options),

    updateOffer: (id, input, options) =>
      write<Offer>('offer', 'update', id, {...input}, options),

    deleteOffer: async offer => {
      if (await discardLocalCreate('offer', offer.id)) return;
      requireConnection();
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
      await forgetRecord(offer.id);
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
        .pull()
        .catch(() => undefined);
    },

    upsertOffer: offer => {
      offerEpoch++;
      const next = upsertInto(get().offers, offer, sortOffers);
      if (next) set({offers: next, offersState: 'ready'});
    },

    // ---------------------------------------------------- inventories (M4)

    createWarehouse: (input, options) =>
      write<Warehouse>('warehouse', 'create', null, {...input}, options),

    updateWarehouse: (id, input, options) =>
      write<Warehouse>('warehouse', 'update', id, {...input}, options),

    deleteWarehouse: async warehouse => {
      if (await discardLocalCreate('warehouse', warehouse.id)) return;
      requireConnection();
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
      await forgetRecord(warehouse.id);
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
        .pull()
        .catch(() => undefined);
    },

    upsertWarehouse: warehouse => {
      warehouseEpoch++;
      const next = upsertInto(get().warehouses, warehouse, sortWarehouses);
      if (next) set({warehouses: next, warehousesState: 'ready'});
    },

    createResource: (input, options) =>
      write<Resource>('resource', 'create', null, {...input}, options),

    updateResource: (id, input, options) =>
      write<Resource>('resource', 'update', id, {...input}, options),

    deleteResource: async resource => {
      // E3: photos still waiting for it go with it (the server would refuse
      // them: their material no longer exists).
      const dropPhotos = () =>
        removeEntries(queuedMedia(get().outbox, resource.id).map(e => e.id));
      if (await discardLocalCreate('resource', resource.id)) {
        await dropPhotos();
        return;
      }
      requireConnection();
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
      await forgetRecord(resource.id);
      await dropPhotos();
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
        .pull()
        .catch(() => undefined);
    },

    upsertResource: resource => {
      resourceEpoch++;
      const next = upsertInto(get().resources, resource, sortResources);
      if (next) set({resources: next, resourcesState: 'ready'});
    },

    createNote: (input, options) =>
      write<Note>('note', 'create', null, {...input}, options),

    updateNote: (id, input, options) =>
      write<Note>('note', 'update', id, {...input}, options),

    deleteNote: async note => {
      if (await discardLocalCreate('note', note.id)) return;
      requireConnection();
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
      await forgetRecord(note.id);
      noteEpoch++;
      set({notes: get().notes.filter(n => n.id !== note.id)});
      void get()
        .pull()
        .catch(() => undefined);
    },

    upsertNote: note => {
      noteEpoch++;
      const next = upsertInto(get().notes, note, sortNotes);
      if (next) set({notes: next, notesState: 'ready'});
    },

    // ------------------------------------- answers and photos (Revisión 1 · E3)

    noteAnswers: async (noteId, signal) => {
      requireConnection();
      const res = await authed(token => api.noteAnswers(token, noteId, signal));
      return res.items;
    },

    answerNote: async (note, text, replaces) => {
      requireConnection();
      const live = () => get().notes.find(n => n.id === note.id) ?? note;
      try {
        const answer = await authed(token =>
          api.createNoteAnswer(token, note.id, {text, replaces}),
        );
        // The server bumped the note's version (its `answer` changed); the
        // refresh below brings its exact copy.
        const n = live();
        get().upsertNote({
          ...n,
          answer,
          version: n.version + 1,
          updatedAt: answer.answeredAt,
          updatedBy: answer.answeredBy,
        });
        return answer;
      } catch (err) {
        if (
          isApiError(err) &&
          err.code === 'VERSION_CONFLICT' &&
          (err.current === null || typeof err.current === 'object')
        ) {
          // Someone answered meanwhile: show their answer at once.
          get().upsertNote({
            ...live(),
            answer: (err.current ?? null) as NoteAnswer | null,
          });
        }
        throw err;
      } finally {
        void get()
          .pull()
          .catch(() => undefined);
      }
    },

    addResourcePhoto: async (resource, photo) => {
      const s = get();
      const orgId = s.orgId;
      const session = s.session;
      if (!orgId || !session) {
        throw new ApiError({code: 'VALIDATION', status: 0});
      }
      const id = uuid();
      const input: Record<string, unknown> = {
        id,
        organizationId: orgId,
        ownerType: 'resource',
        ownerId: resource.id,
        contentType: photo.contentType,
        width: photo.width,
        height: photo.height,
        data: photo.data,
        ...(photo.main ? {main: true} : {}),
      };
      const queueable = canQueue(session.user.role, 'media', 'create');
      if (queueable && mustQueue(s.outbox, s.connection, id, input)) {
        await queuePhoto(resource, id, input);
        return {queued: true, id, media: null};
      }
      const stillHere = () =>
        get().session?.user.id === session.user.id && get().orgId === orgId;
      try {
        const saved = await authed(token =>
          api.uploadMedia(token, input as unknown as MediaUploadInput),
        );
        if (stillHere()) {
          putMedia(saved);
          void get()
            .pull()
            .catch(() => undefined);
        }
        return {queued: false, id: saved.id, media: saved};
      } catch (err) {
        // The upload did not get through: it waits here with the same id,
        // so a copy the server did store is answered, never duplicated.
        if (queueable && stillHere() && isApiError(err) && err.isUnavailable) {
          await queuePhoto(resource, id, input);
          return {queued: true, id, media: null};
        }
        throw err;
      }
    },

    setMainPhoto: async (resource, media) => {
      requireConnection();
      try {
        const saved = await authed(token => api.setMainMedia(token, media.id));
        changeResource(resource.id, r => withMain(r, saved.id));
      } catch (err) {
        if (isApiError(err) && err.code === 'NOT_FOUND') {
          changeResource(resource.id, r => withoutMedia(r, media.id));
        }
        throw err;
      } finally {
        void get()
          .pull()
          .catch(() => undefined);
      }
    },

    deletePhoto: async (resource, media) => {
      requireConnection();
      try {
        await authed(token => api.deleteMedia(token, media.id));
      } catch (err) {
        // Already removed by someone else: the result is the same.
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      changeResource(resource.id, r => withoutMedia(r, media.id));
      void get()
        .pull()
        .catch(() => undefined);
    },

    // ---------------------------------------------------- hypotheses (M5)

    createHypothesis: async input => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      requireConnection();
      const created = await authed(token =>
        api.createHypothesis(token, {...input, organizationId: orgId}),
      );
      get().upsertHypothesis(created);
      return created;
    },

    deleteHypothesis: async hypothesis => {
      requireConnection();
      try {
        await authed(token => api.deleteHypothesis(token, hypothesis.id));
      } catch (err) {
        // Already gone: the outcome is the same. Applied meanwhile (400):
        // bring the list up to date so the sheet shows it as applied.
        if (isApiError(err) && err.code === 'VALIDATION') {
          void get()
            .pull()
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
      // Never queued: applying always needs a live confirmation on the
      // plan as the server has it.
      requireConnection();
      try {
        const res = await authed(token =>
          api.applyHypothesis(token, id, input),
        );
        for (const task of res.tasks) get().upsertTask(task);
        get().upsertHypothesis(res.hypothesis);
        void get()
          .pull()
          .catch(() => undefined);
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

    // ---------------------------------------------------- Revisión 1 · E2

    moveTask: async (id, input) => {
      // Never queued: a move always needs a live confirmation on the plan
      // as the server has it.
      requireConnection();
      try {
        const res = await authed(token => api.moveTask(token, id, input));
        for (const task of res.tasks) get().upsertTask(task);
        void get()
          .pull()
          .catch(() => undefined);
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

    acceptConflict: async input => {
      requireConnection();
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      try {
        const created = await authed(token =>
          api.createAcceptance(token, {...input, organizationId: orgId}),
        );
        get().upsertAcceptance(created);
        return created;
      } catch (err) {
        if (isApiError(err) && err.current && typeof err.current === 'object') {
          if (err.code === 'DUPLICATE' && !Array.isArray(err.current)) {
            // Someone accepted it first: show theirs.
            get().upsertAcceptance(err.current as ConflictAcceptance);
          } else if (
            err.code === 'VERSION_CONFLICT' &&
            Array.isArray(err.current)
          ) {
            for (const task of err.current as Task[]) {
              if (task && typeof task === 'object') get().upsertTask(task);
            }
          }
        }
        void get()
          .pull()
          .catch(() => undefined);
        throw err;
      }
    },

    withdrawAcceptance: async acceptance => {
      requireConnection();
      try {
        await authed(token => api.deleteAcceptance(token, acceptance.id));
      } catch (err) {
        if (!(isApiError(err) && err.code === 'NOT_FOUND')) throw err;
      }
      set({
        acceptances: get().acceptances.filter(a => a.id !== acceptance.id),
      });
      void get()
        .pull()
        .catch(() => undefined);
    },

    upsertAcceptance: acceptance => {
      set({
        acceptances: [
          acceptance,
          ...get().acceptances.filter(a => a.id !== acceptance.id),
        ],
        acceptancesState: 'ready',
      });
    },

    updateOrganization: async input => {
      requireConnection();
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'NOT_FOUND', status: 404});
      const adopt = (org: Organization) => {
        if (get().orgId !== orgId) return;
        const current = get().organizations.find(o => o.id === org.id);
        if (current && current.version > org.version) return;
        // `/me` copies carry the viewer's roles and permissions: keep them.
        set({
          organizations: get().organizations.map(o =>
            o.id === org.id ? {...o, ...org} : o,
          ),
        });
      };
      try {
        const org = await authed(token =>
          api.updateOrganization(token, orgId, input),
        );
        adopt(org);
        return org;
      } catch (err) {
        const current = conflictCopy<Organization>(err);
        if (current) adopt(current);
        throw err;
      }
    },

    updateVenue: async (id, input) => {
      requireConnection();
      try {
        const venue = await authed(token => api.updateVenue(token, id, input));
        get().upsertVenue(venue);
        void get()
          .pull()
          .catch(() => undefined);
        return venue;
      } catch (err) {
        const current = conflictCopy<Venue>(err);
        if (current) get().upsertVenue(current);
        throw err;
      }
    },

    upsertVenue: venue => {
      writeEpoch++;
      const current = get().venues.find(v => v.id === venue.id);
      if (current && current.version > venue.version) return;
      set({
        venues: [...get().venues.filter(v => v.id !== venue.id), venue].sort(
          (a, b) => a.name.localeCompare(b.name, 'es'),
        ),
      });
    },

    loadHistory: async (entityType, entityId, limit = 50) => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const res = await authed(token =>
        api.history(token, orgId, entityType, entityId, limit),
      );
      return res.items;
    },

    loadDayActivity: async (from, to, signal) => {
      const orgId = get().orgId;
      if (!orgId) throw new ApiError({code: 'VALIDATION', status: 0});
      const res = await authed(token =>
        api
          .activityBetween(token, orgId, from, to, ACTIVITY_RANGE_MAX, signal)
          .catch((err: unknown) => {
            // The caller moved on (another day): not a lost connection.
            if (signal?.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            throw err;
          }),
      );
      return Array.isArray(res?.items) ? res.items : [];
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
      // Never queued (M6): without the server it stays for this session.
      if (get().connection !== 'online' || get().fromCache) return;
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
        requireConnection();
        await authed(token => api.clearRecentSearches(token, orgId));
      } catch (err) {
        set({recentSearches: before});
        throw err;
      }
    },

    removeDemo: async () => {
      const orgId = get().orgId;
      if (!orgId) return 0;
      requireConnection();
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
      else if (current === 'offline') {
        // The network is back; whether the server answers is checked next.
        set({connection: get().fromCache ? 'unavailable' : 'online'});
      }
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

// ---------------------------------------------------------------- device copy

/** Guests' copies go through the same withholding as the server's. */
const WITHHELD_KIND: Partial<Record<SyncList, WithheldKind>> = {
  events: 'event',
  tasks: 'task',
  contacts: 'contact',
  companies: 'company',
  offers: 'offer',
  warehouses: 'warehouse',
  resources: 'resource',
  notes: 'note',
  hypotheses: 'hypothesis',
  acceptances: 'acceptance',
};

/** A list is kept once it has really loaded (never an empty placeholder). */
const LOADED_BY: Record<SyncList, keyof LogisticsState> = {
  events: 'eventsState',
  venues: 'eventsState',
  tasks: 'tasksState',
  companies: 'companiesState',
  categories: 'companiesState',
  contacts: 'contactsState',
  offers: 'offersState',
  warehouses: 'warehousesState',
  resources: 'resourcesState',
  notes: 'notesState',
  hypotheses: 'hypothesesState',
  acceptances: 'acceptancesState',
  activity: 'activityState',
};

const dirtyLists = new Set<SyncList>();
let sessionDirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function flushDeviceCopy(gen: number): Promise<void> {
  const s = useLogisticsStore.getState();
  const lists = [...dirtyLists];
  dirtyLists.clear();
  const writeSession = sessionDirty;
  sessionDirty = false;
  if (gen !== persistGen || s.phase !== 'ready' || !s.session || !s.orgId) {
    return;
  }
  // A wipe still owed: nothing new lands on the device until it is done.
  if (device.wipePending()) return;
  const {id: userId, role} = s.session.user;
  const orgId = s.orgId;
  for (const list of lists) {
    if (gen !== persistGen) return;
    if (s[LOADED_BY[list]] !== 'ready') continue;
    const kind = WITHHELD_KIND[list];
    const items = s[list] as object[];
    await device.saveList(
      userId,
      orgId,
      list,
      kind ? items.map(r => withholdFor(kind, r, role)) : items,
    );
  }
  if (writeSession && gen === persistGen) {
    await device.saveSession({
      user: s.session.user,
      organizations: s.organizations,
      orgId,
      savedAt: Date.now(),
    });
  }
}

useLogisticsStore.subscribe((state, prev) => {
  if (state.phase !== 'ready' || !state.session || !state.orgId) return;
  for (const list of SYNC_LISTS) {
    if (state[list] !== prev[list]) dirtyLists.add(list);
  }
  if (
    state.organizations !== prev.organizations ||
    state.orgId !== prev.orgId
  ) {
    sessionDirty = true;
  }
  if ((!dirtyLists.size && !sessionDirty) || persistTimer) return;
  const gen = persistGen;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushDeviceCopy(gen);
  }, 400);
});
