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
  CreateEventInput,
  LogisticsEvent,
  Organization,
  SessionUser,
  UpdateEventInput,
  Venue,
} from '../../../shared/logistics/contracts.ts';
import {
  ApiError,
  errorMessage,
  isApiError,
  resolveApiBaseUrl,
} from '../api/client';
import {api} from '../api/endpoints';
import {sortEvents} from '../lib/events';

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

/**
 * Merges a server list over the local one without going back in time: a local
 * copy with a higher `version` (saved by us while the request was in flight)
 * wins over the server copy of the same event.
 */
export function mergeServerEvents(
  local: LogisticsEvent[],
  server: LogisticsEvent[],
): LogisticsEvent[] {
  const byId = new Map(local.map(e => [e.id, e]));
  return sortEvents(
    server.map(remote => {
      const mine = byId.get(remote.id);
      return mine && mine.version > remote.version ? mine : remote;
    }),
  );
}

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
      events: [],
      venues: [],
      activity: [],
      eventsState: 'idle',
      activityState: 'idle',
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
        events: [],
        activity: [],
        venues: [],
      });
      markReachable();
      void get().refresh();
    },

    logout: async () => {
      const token = get().session?.token;
      writeStoredSession(null);
      set({
        phase: 'login',
        session: null,
        organizations: [],
        events: [],
        venues: [],
        activity: [],
        eventsState: 'idle',
        activityState: 'idle',
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
      set({orgId: id, events: [], activity: [], venues: []});
      void get().refresh();
    },

    refresh: async ({silent = false} = {}) => {
      const orgId = get().orgId;
      if (!orgId || get().phase !== 'ready') return;
      if (!silent) {
        set({
          eventsState: 'loading',
          eventsError: null,
          activityState: 'loading',
          activityError: null,
        });
      }
      const epoch = writeEpoch;
      const [events, activity, venues] = await Promise.allSettled([
        authed(token => api.events(token, orgId)),
        authed(token => api.activity(token, orgId, 20)),
        authed(token => api.venues(token, orgId)),
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
        patch.activity = activity.value.items;
        patch.activityState = 'ready';
        patch.activityError = null;
      } else if (!silent || get().activityState !== 'ready') {
        patch.activityState = 'error';
        patch.activityError = errorMessage(activity.reason);
      }
      if (venues.status === 'fulfilled') patch.venues = venues.value.items;
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

    removeDemo: async () => {
      const orgId = get().orgId;
      if (!orgId) return 0;
      const res = await authed(token => api.removeDemo(token, orgId));
      writeEpoch++;
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
