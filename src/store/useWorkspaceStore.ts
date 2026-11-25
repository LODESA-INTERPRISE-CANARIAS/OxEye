/**
 * Workspace store (OX-03): organizations, local users, memberships, projects
 * and events, plus the active project / event / day context.
 *
 * LOCAL MODE: every record lives in this browser. Permission checks here are
 * indicative only and do not protect data (no server, UX-009 / SEC-001).
 */
import {create} from 'zustand';
import {
  adoptSavedProject,
  bootstrapWorkspace,
  ensureEventLayouts,
  importV1AsNewProject,
} from '../db/workspace-migration';
import {
  DexieWorkspaceRepository,
  emptyWorkspaceData,
  scopeToUser,
  type WorkspaceRepository,
} from '../db/workspace-repository';
import {normalizeStoredProject} from '../db/repository';
import {configure} from '../engine/crowd/presets';
import {eventDays} from '../engine/workspace/context';
import {
  assignableRoles as assignableRolesFor,
  can as canDo,
  canEditVenue as canEditVenueFor,
  effectiveRole,
  visibleEvents,
} from '../engine/workspace/permissions';
import {reviewLayoutScene, type LayoutReview} from '../engine/workspace/promotion-review';
import {
  affectedLayouts,
  blankLayout,
  composedListOverflow,
  composeScene,
  contentFingerprint,
  duplicateLayout,
  setLayoutState,
  splitScene,
  type ComposeMode,
} from '../engine/workspace/venue-layout';
import type {MapMetadata, PhaseKey, ProjectFile, VenueKey} from '../types';
import type {EditMode, Layout, Venue} from '../types/venue';
import type {
  AccessLogEntry,
  LocalUser,
  Membership,
  MembershipScope,
  PermissionTarget,
  WorkspaceAction,
  WorkspaceData,
  WorkspaceEvent,
  WorkspaceProject,
  WorkspaceRole,
} from '../types/workspace';
import {useProjectStore, type ProjectStoreState} from './useProjectStore';

export const WORKSPACE_SELECTION_KEY = 'oxeye-workspace-v1';
export const LOCAL_MODE_NOTICE =
  'Modo local de un solo usuario: los permisos son orientativos y no protegen los datos.';

interface Selection {
  userId: string | null;
  projectId: string | null;
  eventId: string | null;
  /** Open layout per slot of `eventId` (OX-04). */
  layoutIds: Partial<Record<VenueKey, string>>;
}

function readSelection(): Selection {
  try {
    const raw = localStorage.getItem(WORKSPACE_SELECTION_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return {
      userId: typeof p.userId === 'string' ? p.userId : null,
      projectId: typeof p.projectId === 'string' ? p.projectId : null,
      eventId: typeof p.eventId === 'string' ? p.eventId : null,
      layoutIds: p.layoutIds && typeof p.layoutIds === 'object' ? p.layoutIds : {},
    };
  } catch {
    return {userId: null, projectId: null, eventId: null, layoutIds: {}};
  }
}

function writeSelection(sel: Selection): void {
  try {
    localStorage.setItem(WORKSPACE_SELECTION_KEY, JSON.stringify(sel));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Id of the event whose content is in the localStorage project cache. Shared
 * by all tabs, like the cache itself, so a reload never writes one event's
 * content into another (multi-tab safety).
 */
export const WORKSPACE_CACHE_TAG_KEY = 'oxeye-workspace-cache-event';

function readCacheTag(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_CACHE_TAG_KEY);
  } catch {
    return null;
  }
}

function writeCacheTag(eventId: string | null): void {
  try {
    if (eventId) localStorage.setItem(WORKSPACE_CACHE_TAG_KEY, eventId);
    else localStorage.removeItem(WORKSPACE_CACHE_TAG_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Layouts and edit mode the localStorage cache was composed with (OX-04).
 * On reload the cache is split back into exactly these records, never into
 * another layout.
 */
export const WORKSPACE_CACHE_COMPOSITION_KEY = 'oxeye-workspace-cache-composition';

interface CacheComposition {
  eventId: string;
  layoutIds: Partial<Record<VenueKey, string>>;
  editMode: EditMode;
}

function readCacheComposition(): CacheComposition | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_CACHE_COMPOSITION_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (!p || typeof p.eventId !== 'string' || typeof p.layoutIds !== 'object') return null;
    return {
      eventId: p.eventId,
      layoutIds: p.layoutIds || {},
      editMode: p.editMode === 'venue' ? 'venue' : 'layout',
    };
  } catch {
    return null;
  }
}

function writeCacheComposition(c: CacheComposition | null): void {
  try {
    if (c) localStorage.setItem(WORKSPACE_CACHE_COMPOSITION_KEY, JSON.stringify(c));
    else localStorage.removeItem(WORKSPACE_CACHE_COMPOSITION_KEY);
  } catch {
    // Ignore storage errors
  }
}

/** Same base map, except for OSM vectors fetched for a custom location. */
function sameMapIgnoringVectors(a: MapMetadata, b: MapMetadata): boolean {
  const strip = (m: MapMetadata) => {
    const c = structuredClone(m);
    if (c.customLocation) {
      delete c.customLocation.streets;
      delete c.customLocation.features;
    }
    return c;
  };
  return contentFingerprint(strip(a)) === contentFingerprint(strip(b));
}

/** Venues whose version changed while editing them, and their affected layouts. */
export interface AffectedNotice {
  venueId: string;
  venueName: string;
  layoutIds: string[];
}

export type LayoutCreateInput =
  | {kind: 'blank'; name: string}
  | {kind: 'duplicate'; name: string; sourceId: string};

export interface InviteInput {
  name: string;
  contact?: string;
  role: WorkspaceRole;
  scope: Exclude<MembershipScope, 'organization'>;
  projectId: string;
  eventId?: string;
}

/** Wizard configuration, as accepted by `useProjectStore.createFromWizard`. */
export type WizardConfig = Parameters<ProjectStoreState['createFromWizard']>[0];

export interface WorkspaceStoreState {
  ready: boolean;
  /** Set when IndexedDB is unavailable; the editor keeps working without workspace. */
  unavailable: boolean;
  data: WorkspaceData;
  allUsers: LocalUser[];
  activeUserId: string | null;
  activeOrgId: string | null;
  activeProjectId: string | null;
  activeEventId: string | null;
  activeDayId: string | null;
  /** OX-04: venues and layouts of the active organization. */
  venues: Venue[];
  layouts: Layout[];
  /** Open layout per scene slot of the active event. */
  activeLayoutIds: Partial<Record<VenueKey, string>>;
  /** «Editar distribución» (default) or «Editar recinto». */
  editMode: EditMode;
  /** Shown after leaving «Editar recinto» when the venue changed (plan D8). */
  affectedNotice: AffectedNotice | null;

  init: (repo?: WorkspaceRepository) => Promise<void>;
  can: (action: WorkspaceAction, target?: Partial<PermissionTarget>) => boolean;
  /** Roles the active user may grant on `target` (never more than their own). */
  assignableRoles: (target: Partial<PermissionTarget>) => WorkspaceRole[];
  setActiveUser: (userId: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  setActiveDay: (dayId: string | null) => void;
  createProject: (name: string) => Promise<WorkspaceProject | null>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  openEvent: (eventId: string) => Promise<boolean>;
  /**
   * Creates a new event in the active project (or a new default project) from
   * the wizard. `venueId` reuses a saved venue (OX-04 D13, «Usar un recinto guardado»).
   */
  createEventFromWizard: (config: WizardConfig, opts?: {venueId?: string}) => Promise<boolean>;
  renameEvent: (eventId: string, name: string) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  /** Imports a v1 JSON as the first event of a new project and opens it. */
  importAsNewProject: (text: string) => Promise<{existing: boolean} | null>;
  invite: (input: InviteInput) => Promise<void>;
  changeRole: (membershipId: string, role: WorkspaceRole) => Promise<void>;
  revoke: (membershipId: string) => Promise<void>;
  /** Flushes the pending write of the active event payload. */
  flush: () => Promise<void>;

  // OX-04: venue and layouts
  /** Whether the active user may edit the venue of the active event (D16, provisional). */
  canEditVenue: () => boolean;
  setEditMode: (mode: EditMode) => Promise<boolean>;
  openLayout: (layoutId: string) => Promise<boolean>;
  createLayout: (input: LayoutCreateInput) => Promise<Layout | null>;
  renameLayout: (layoutId: string, name: string) => Promise<void>;
  setLayoutPhases: (layoutId: string, phases: PhaseKey[]) => Promise<void>;
  /** Re-evaluates a layout against the current venue (clears «Recinto modificado»). */
  reviewLayout: (layoutId: string) => Promise<LayoutReview | null>;
  /** «Confirmar como válida»: blocked with causes when the gate fails (D9). */
  promoteLayout: (layoutId: string, state: 'proposal' | 'current') => Promise<LayoutReview | null>;
  archiveLayout: (layoutId: string) => Promise<void>;
  dismissAffectedNotice: () => void;
  /** Active project composed without edit locks (export). */
  exportableProject: () => ProjectFile;
  /** Part an element of the open scene is stored in (`null`: new or not composed). */
  partOf: (elementId: string) => 'venue' | 'layout' | null;
}

let repo: WorkspaceRepository | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribeProject: (() => void) | undefined;
let initPromise: Promise<void> | null = null;
/** Venue versions when «Editar recinto» was entered (affected layouts, D8). */
let venueSessionStart: Array<{venueId: string; version: number}> = [];
/** Serializes venue/layout writes so a timed flush never interleaves with an action. */
let writeChain: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

const nowIso = () => new Date().toISOString();

function toast(msg: string, tone: 'default' | 'error' = 'error') {
  useProjectStore.getState().showToast(msg, tone);
}

/** Refusal by the local permission matrix; the suffix keeps it honest (UX-009). */
function deny(msg: string) {
  toast(msg + ' (modo local)');
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => {
  /** Reloads workspace data scoped to the active user. */
  async function reload(userId: string | null) {
    if (!repo) return;
    const all = await repo.loadAll();
    const uid =
      userId && all.users.some((u) => u.id === userId)
        ? userId
        : all.memberships.find((m) => m.role === 'org_admin')?.userId ||
          all.users[0]?.id ||
          null;
    const data = uid ? scopeToUser(all, uid) : emptyWorkspaceData();
    const orgId =
      data.memberships.find((m) => m.userId === uid)?.orgId ||
      data.organizations[0]?.id ||
      null;
    set({data, allUsers: all.users, activeUserId: uid, activeOrgId: orgId});
  }

  function persistSelection() {
    const s = get();
    writeSelection({
      userId: s.activeUserId,
      projectId: s.activeProjectId,
      eventId: s.activeEventId,
      layoutIds: s.activeLayoutIds,
    });
  }

  function eventTarget(e: WorkspaceEvent): PermissionTarget {
    return {orgId: e.orgId, projectId: e.projectId, eventId: e.id};
  }

  /** Recomputes the editor's read-only flag for the active event. */
  function syncReadOnly() {
    const s = get();
    const ev = s.data.events.find((e) => e.id === s.activeEventId);
    const editable =
      !s.ready ||
      s.unavailable ||
      (!!ev &&
        s.can('event.edit', eventTarget(ev)) &&
        (s.editMode !== 'venue' || canEditVenueFor(s.activeUserId, s.data.memberships, eventTarget(ev))));
    useProjectStore.getState().setReadOnly(!editable);
  }

  function schedulePayloadWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void get().flush();
    }, 300);
  }

  /** First Jornada of the current operational phase (or the first one). */
  function pickDay(): string | null {
    const {project, phase} = useProjectStore.getState();
    const days = eventDays(project);
    return (days.find((d) => d.kind === phase) ?? days[0])?.id ?? null;
  }

  /* ---------------- OX-04: venue / layout composition ---------------- */

  function activeEvent(): WorkspaceEvent | undefined {
    const s = get();
    return s.data.events.find((e) => e.id === s.activeEventId);
  }

  /** Records the layouts and mode the localStorage cache is composed with. */
  function tagCacheComposition(eventId: string) {
    const s = get();
    writeCacheComposition({eventId, layoutIds: s.activeLayoutIds, editMode: s.editMode});
  }

  async function loadVenueData(orgId: string) {
    if (!repo) return;
    const [venues, layouts] = await Promise.all([repo.listVenues(orgId), repo.listLayouts(orgId)]);
    set({venues, layouts});
  }

  /** Layout to open per slot: the preferred one, else the current one, else the latest. */
  function pickActiveLayouts(
    eventId: string,
    preferred: Partial<Record<VenueKey, string>>
  ): Partial<Record<VenueKey, string>> {
    const own = get().layouts.filter((l) => l.eventId === eventId);
    const out: Partial<Record<VenueKey, string>> = {};
    for (const site of new Set(own.map((l) => l.site))) {
      const inSite = own.filter((l) => l.site === site);
      const live = inSite.filter((l) => l.state !== 'archived');
      const pref = inSite.find((l) => l.id === preferred[site]);
      const pick =
        pref ??
        live.find((l) => l.state === 'current' && l.phases.includes('event')) ??
        live.find((l) => l.state === 'current') ??
        [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
        inSite[0];
      if (pick) out[site] = pick.id;
    }
    return out;
  }

  function recordsFor(site: VenueKey): {venue: Venue; layout: Layout} | null {
    const s = get();
    const layout = s.layouts.find((l) => l.id === s.activeLayoutIds[site]);
    const venue = layout && s.venues.find((v) => v.id === layout.venueId);
    return layout && venue ? {venue, layout} : null;
  }

  /** Event payload with every open layout composed on its venue. */
  function composeProject(payload: ProjectFile, mode: ComposeMode): ProjectFile {
    const p = structuredClone(payload);
    for (const site of Object.keys(get().activeLayoutIds) as VenueKey[]) {
      const r = recordsFor(site);
      if (!r || !p.scenes[site]) continue;
      p.scenes[site] = composeScene(p.scenes[site], r.venue, r.layout, mode);
      p.maps[site] = structuredClone(r.venue.map);
    }
    return p;
  }

  /**
   * Writes the editable part of the composed project back to its venue and
   * layout records (inverse of `composeProject`). Content changes bump the
   * record version (plan D6).
   */
  async function persistComposition(project: ProjectFile, mode: EditMode) {
    if (!repo) return;
    const s = get();
    const now = nowIso();
    const venues = [...s.venues];
    const layouts = [...s.layouts];
    const changed: Layout[] = [];
    for (const site of Object.keys(s.activeLayoutIds) as VenueKey[]) {
      const li = layouts.findIndex((l) => l.id === s.activeLayoutIds[site]);
      const layout = layouts[li];
      const vi = layout ? venues.findIndex((v) => v.id === layout.venueId) : -1;
      const venue = venues[vi];
      const scene = project.scenes[site];
      if (!layout || !venue || !scene) continue;
      const split = splitScene(scene, venue, layout, mode);

      const venueChanged = contentFingerprint(split.venue) !== contentFingerprint(venue.content);
      const map = project.maps[site];
      const mapChanged =
        !!map &&
        contentFingerprint(map) !== contentFingerprint(venue.map) &&
        (mode === 'venue' || sameMapIgnoringVectors(map, venue.map));
      let nextVenue = venue;
      if (venueChanged || mapChanged) {
        nextVenue = {
          ...venue,
          content: split.venue,
          map: mapChanged ? structuredClone(map) : venue.map,
          version: venueChanged ? venue.version + 1 : venue.version,
          updatedAt: now,
        };
        await repo.putVenue(nextVenue);
        venues[vi] = nextVenue;
      }

      const contentChanged =
        contentFingerprint([split.layout, split.accessOverrides]) !==
        contentFingerprint([layout.content, layout.accessOverrides]);
      const safetyChanged = contentFingerprint(split.safety) !== contentFingerprint(layout.safety);
      // First perimeter drawn while editing this layout: it was evaluated with it.
      const ownPerimeter = venueChanged && mode === 'layout';
      if (contentChanged || safetyChanged || ownPerimeter) {
        const next: Layout = {
          ...layout,
          content: split.layout,
          accessOverrides: split.accessOverrides,
          safety: split.safety,
          version: contentChanged ? layout.version + 1 : layout.version,
          baseVenueVersion: ownPerimeter ? nextVenue.version : layout.baseVenueVersion,
          updatedAt: now,
        };
        layouts[li] = next;
        changed.push(next);
      }
    }
    if (changed.length) await repo.putLayouts(changed);
    set({venues, layouts});
  }

  /**
   * Opens an event payload through its venue and layouts (lazy migration on
   * first open, plan D15). `cache` marks the payload as the localStorage copy:
   * it is first written back into the layouts it was composed with.
   */
  async function openComposed(
    ev: WorkspaceEvent,
    payload: ProjectFile,
    opts: {
      cache?: CacheComposition | null;
      useVenue?: Partial<Record<VenueKey, Venue>>;
      newEvent?: boolean;
    } = {}
  ): Promise<boolean> {
    if (!repo) return false;
    try {
      return await openComposedUnsafe(ev, payload, opts);
    } catch {
      // Venue/layout records unavailable: open the payload as a single scene.
      set({activeLayoutIds: {}, editMode: 'layout'});
      useProjectStore.getState().openEventPayload(payload);
      return true;
    }
  }

  async function openComposedUnsafe(
    ev: WorkspaceEvent,
    payload: ProjectFile,
    opts: {
      cache?: CacheComposition | null;
      useVenue?: Partial<Record<VenueKey, Venue>>;
      newEvent?: boolean;
    }
  ): Promise<boolean> {
    if (!repo) return false;
    const comp = await ensureEventLayouts(repo, ev, payload, {
      useVenue: opts.useVenue,
      initialState: opts.newEvent ? 'draft' : 'current',
      shareVenue: !opts.newEvent,
    });
    await loadVenueData(ev.orgId);
    const sel = readSelection();
    const cache = opts.cache && opts.cache.eventId === ev.id ? opts.cache : null;
    const preferred = cache?.layoutIds ?? (sel.eventId === ev.id ? sel.layoutIds : {});
    set({activeLayoutIds: pickActiveLayouts(ev.id, preferred)});
    if (cache && !comp.created) {
      const sameLayouts = Object.entries(cache.layoutIds).every(
        ([site, id]) => get().activeLayoutIds[site as VenueKey] === id
      );
      if (sameLayouts) await persistComposition(payload, cache.editMode);
    }
    for (const site of Object.keys(get().activeLayoutIds) as VenueKey[]) {
      const r = recordsFor(site);
      if (r && composedListOverflow(r.venue.content, r.layout.content)) {
        toast('El recinto y la distribución superan 500 elementos en una lista; no se puede abrir.');
        set({activeLayoutIds: {}});
        return false;
      }
    }
    // Leaving «Editar recinto» by opening another event still reports affected layouts.
    set({editMode: 'layout', affectedNotice: closeVenueSession()});
    useProjectStore.getState().openEventPayload(composeProject(payload, 'layout'));
    return true;
  }

  /** Recomposes the open event (layout switch, mode switch) from the live project. */
  function recompose(mode: EditMode) {
    const project = useProjectStore.getState().project;
    useProjectStore.getState().openEventPayload(composeProject(project, mode));
    const id = get().activeEventId;
    if (id) tagCacheComposition(id);
  }

  /**
   * Ends a «Editar recinto» session: the notice lists the layouts evaluated
   * against an older version of a venue changed during the session (D8).
   */
  function closeVenueSession(): AffectedNotice | null {
    let notice: AffectedNotice | null = null;
    for (const start of venueSessionStart) {
      const venue = get().venues.find((v) => v.id === start.venueId);
      if (!venue || venue.version === start.version) continue;
      notice = {
        venueId: venue.id,
        venueName: venue.name,
        layoutIds: affectedLayouts(venue, get().layouts).map((l) => l.id),
      };
    }
    venueSessionStart = [];
    return notice;
  }

  function layoutOfActiveEvent(layoutId: string): Layout | undefined {
    const s = get();
    return s.layouts.find((l) => l.id === layoutId && l.eventId === s.activeEventId);
  }

  /**
   * Re-applies edit locks to the live scene for elements that now belong to
   * the part not being edited (e.g. accesses stored in the venue with the
   * first perimeter, or items moved to the layout in venue mode), so later
   * edits are not silently reverted on the next split. History is kept.
   */
  function relockLive() {
    const s = get();
    const project = useProjectStore.getState().project;
    let next: ProjectFile | null = null;
    for (const site of Object.keys(s.activeLayoutIds) as VenueKey[]) {
      const r = recordsFor(site);
      const scene = project.scenes[site];
      if (!r || !scene) continue;
      const lockedPart =
        s.editMode === 'venue'
          ? r.layout.content
          : (r.venue.content.boundary || []).length >= 3
            ? r.venue.content
            : null;
      if (!lockedPart) continue;
      const ids = new Set<string>();
      for (const list of Object.values(lockedPart)) {
        if (!Array.isArray(list)) continue;
        for (const x of list as Array<{id?: unknown}>) {
          if (x && typeof x.id === 'string') ids.add(x.id);
        }
      }
      const lists = (sc: typeof scene) =>
        [
          sc.entrances,
          sc.base?.booths,
          sc.infrastructure,
          sc.passages,
          sc.reserves,
          sc.fences,
          sc.flows,
          sc.corridors,
          sc.roadPlans,
          sc.measurements,
          sc.annotations,
        ] as Array<Array<{id?: string; locked?: boolean}> | undefined>;
      const needs = lists(scene).some((l) => (l || []).some((x) => !!x.id && ids.has(x.id) && !x.locked));
      if (!needs) continue;
      next = next ?? structuredClone(project);
      for (const l of lists(next.scenes[site])) {
        for (const x of l || []) if (x.id && ids.has(x.id)) x.locked = true;
      }
    }
    if (next) useProjectStore.setState({project: next});
  }

  async function flushNow() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = undefined;
    }
    const s = get();
    if (!repo || !s.activeEventId) return;
    const ev = s.data.events.find((e) => e.id === s.activeEventId);
    if (!ev) return;
    const project = structuredClone(useProjectStore.getState().project);
    if (Object.keys(s.activeLayoutIds).length) {
      try {
        await persistComposition(project, s.editMode);
        if (get().activeEventId === ev.id) relockLive();
      } catch {
        // Keep the payload write below; the cache still holds the composed copy.
      }
    }
    try {
      await repo.putPayload({
        eventId: ev.id,
        orgId: ev.orgId,
        project,
        updatedAt: nowIso(),
      });
    } catch {
      // Ignore IndexedDB errors; the localStorage cache still holds the active event.
    }
  }

  /** Common checks for layout actions on the active event. */
  function layoutActionAllowed(layoutId?: string): {ev: WorkspaceEvent; layout?: Layout} | null {
    const s = get();
    const ev = activeEvent();
    if (!repo || !ev) return null;
    if (!s.can('event.edit', eventTarget(ev))) {
      deny('Tu perfil no permite modificar las distribuciones de este evento.');
      return null;
    }
    if (layoutId === undefined) return {ev};
    const layout = layoutOfActiveEvent(layoutId);
    return layout ? {ev, layout} : null;
  }

  /** Runs the promotion review of a layout on its composed scene (D9, D11). */
  function reviewOf(layout: Layout): LayoutReview | null {
    const s = get();
    const venue = s.venues.find((v) => v.id === layout.venueId);
    const live = useProjectStore.getState().project;
    const eventScene = live.scenes[layout.site];
    if (!venue || !eventScene) return null;
    return reviewLayoutScene(composeScene(eventScene, venue, layout, 'plain'));
  }

  async function runInit(repository?: WorkspaceRepository) {
    repo = repository ?? new DexieWorkspaceRepository();
    try {
      const sel = readSelection();
      const cacheTag = readCacheTag();
      const ps = useProjectStore.getState();
      const boot = await bootstrapWorkspace(
        repo,
        ps.hasSavedProject ? ps.project : null
      );
      if (boot) {
        sel.userId = boot.userId;
        sel.projectId = boot.projectId ?? null;
        sel.eventId = boot.eventId ?? null;
        if (boot.eventId) writeCacheTag(boot.eventId);
      }
      await reload(sel.userId);
      const findEvent = (id: string | null | undefined) =>
        id ? get().data.events.find((e) => e.id === id) : undefined;

      // 1. The localStorage cache belongs to the event it is tagged with
      //    (untagged legacy cache: the selected event). It is the most recent
      //    copy of that event, so it is written back to IndexedDB.
      let cacheEvent = findEvent(boot?.eventId ?? cacheTag ?? sel.eventId);
      if (ps.hasSavedProject && cacheEvent) {
        await repo.putPayload({
          eventId: cacheEvent.id,
          orgId: cacheEvent.orgId,
          project: structuredClone(ps.project),
          updatedAt: nowIso(),
        });
      } else if (ps.hasSavedProject && get().activeOrgId && get().can('project.create')) {
        // A model saved without any event is adopted, not lost.
        const adopted = await adoptSavedProject(repo, get().activeOrgId!, ps.project);
        await reload(get().activeUserId);
        cacheEvent = findEvent(adopted.id);
        writeCacheTag(adopted.id);
      }

      // 2. Open the selected event; if it is not the cached one, load it from
      //    IndexedDB. Either way it is opened through its venue and layouts (OX-04).
      let ev = findEvent(sel.eventId) ?? cacheEvent;
      if (ev && !get().can('event.view', eventTarget(ev))) ev = undefined;
      if (ev && (!ps.hasSavedProject || ev.id !== cacheEvent?.id)) {
        const stored = await repo.getPayload(ev.id);
        let loaded = false;
        if (stored) {
          try {
            loaded = await openComposed(ev, normalizeStoredProject(stored.project));
            if (loaded) writeCacheTag(ev.id);
          } catch {
            loaded = false;
          }
        }
        if (!loaded) ev = ps.hasSavedProject ? cacheEvent : undefined;
        if (ev && ev.id === cacheEvent?.id) {
          await openComposed(ev, useProjectStore.getState().project, {
            cache: readCacheComposition(),
          });
        }
      } else if (ev) {
        // The editor holds the cached copy of `ev`: write it back, then compose.
        await openComposed(ev, useProjectStore.getState().project, {
          cache: readCacheComposition(),
        });
      }
      if (ev) tagCacheComposition(ev.id);

      // Saved venues are listed even before any event is open (wizard, D13).
      if (!ev && get().activeOrgId) await loadVenueData(get().activeOrgId!);
      const {data} = get();
      const projectId =
        ev?.projectId ??
        (data.projects.some((p) => p.id === sel.projectId) ? sel.projectId : null) ??
        data.projects[0]?.id ??
        null;
      set({
        ready: true,
        unavailable: false,
        activeProjectId: projectId,
        activeEventId: ev ? ev.id : null,
        activeDayId: ev ? pickDay() : null,
      });
      persistSelection();
      syncReadOnly();
    } catch {
      set({ready: true, unavailable: true});
      syncReadOnly();
    }
    unsubscribeProject?.();
    unsubscribeProject = useProjectStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      const id = get().activeEventId;
      if (!id) return;
      // Keep the cache tag in step with the cache content (written by the project store).
      writeCacheTag(id);
      tagCacheComposition(id);
      schedulePayloadWrite();
    });
  }

  return {
    ready: false,
    unavailable: false,
    data: emptyWorkspaceData(),
    allUsers: [],
    activeUserId: null,
    activeOrgId: null,
    activeProjectId: null,
    activeEventId: null,
    activeDayId: null,
    venues: [],
    layouts: [],
    activeLayoutIds: {},
    editMode: 'layout',
    affectedNotice: null,

    init: (repository) => {
      // Idempotent: React StrictMode may call it twice; a second concurrent
      // bootstrap would create a duplicate organization.
      if (initPromise && !repository) return initPromise;
      initPromise = runInit(repository);
      return initPromise;
    },

    can: (action, target) => {
      const s = get();
      if (!s.activeUserId) return false;
      const t: PermissionTarget = {
        orgId: target?.orgId ?? s.activeOrgId ?? '',
        projectId: target?.projectId,
        eventId: target?.eventId,
      };
      return canDo(s.activeUserId, s.data.memberships, action, t);
    },

    assignableRoles: (target) => {
      const s = get();
      if (!s.activeUserId) return [];
      const role = effectiveRole(s.activeUserId, s.data.memberships, {
        orgId: target.orgId ?? s.activeOrgId ?? '',
        projectId: target.projectId,
        eventId: target.eventId,
      });
      return assignableRolesFor(role);
    },

    setActiveUser: async (userId) => {
      await get().flush();
      await reload(userId);
      const s = get();
      // The editor content always belongs to the cache-tagged event, even while
      // it is hidden from a profile without access; switching back restores it.
      const currentId = s.activeEventId ?? readCacheTag();
      const ev = s.data.events.find((e) => e.id === currentId);
      // Undo history belongs to the previous profile's session.
      useProjectStore.setState({history: [], future: []});
      if (ev && s.can('event.view', eventTarget(ev))) {
        set({
          activeEventId: ev.id,
          activeProjectId: ev.projectId,
          activeDayId: s.activeEventId ? s.activeDayId : pickDay(),
        });
      } else {
        set({activeEventId: null, activeDayId: null});
        // Hide the editor behind the menu: this profile may not view the event.
        useProjectStore.getState().setMenuOpen(true);
      }
      if (!s.data.projects.some((p) => p.id === get().activeProjectId)) {
        set({activeProjectId: s.data.projects[0]?.id ?? null});
      }
      // A profile that may not edit the venue leaves «Editar recinto».
      if (get().editMode === 'venue' && !get().canEditVenue()) {
        set({editMode: 'layout', affectedNotice: closeVenueSession()});
        recompose('layout');
      }
      persistSelection();
      syncReadOnly();
    },

    setActiveProject: (projectId) => {
      set({activeProjectId: projectId});
      persistSelection();
    },

    setActiveDay: (dayId) => {
      set({activeDayId: dayId});
      const day = eventDays(useProjectStore.getState().project).find((d) => d.id === dayId);
      if (day) useProjectStore.getState().setPhase(day.kind);
    },

    createProject: async (name) => {
      const s = get();
      if (!repo || !s.activeOrgId) return null;
      if (!s.can('project.create')) {
        deny('Tu perfil no permite crear proyectos.');
        return null;
      }
      const now = nowIso();
      const project: WorkspaceProject = {
        id: crypto.randomUUID(),
        orgId: s.activeOrgId,
        name: name.trim() || 'Proyecto sin nombre',
        createdAt: now,
        updatedAt: now,
      };
      await repo.putProject(project);
      await reload(s.activeUserId);
      set({activeProjectId: project.id});
      persistSelection();
      return project;
    },

    renameProject: async (projectId, name) => {
      const s = get();
      const p = s.data.projects.find((x) => x.id === projectId);
      if (!repo || !p || !name.trim()) return;
      if (!s.can('project.edit', {orgId: p.orgId, projectId})) {
        deny('Tu perfil no permite renombrar este proyecto.');
        return;
      }
      await repo.putProject({...p, name: name.trim(), updatedAt: nowIso()});
      await reload(s.activeUserId);
    },

    deleteProject: async (projectId) => {
      const s = get();
      const p = s.data.projects.find((x) => x.id === projectId);
      if (!repo || !p) return;
      if (!s.can('project.delete', {orgId: p.orgId, projectId})) {
        deny('Tu perfil no permite eliminar este proyecto.');
        return;
      }
      const active = s.data.events.find((e) => e.id === s.activeEventId);
      if (active?.projectId === projectId) {
        toast('No se puede eliminar el proyecto del evento abierto.');
        return;
      }
      await repo.deleteProject(projectId);
      await reload(s.activeUserId);
      if (get().activeProjectId === projectId) {
        set({activeProjectId: active?.projectId ?? get().data.projects[0]?.id ?? null});
      }
      persistSelection();
    },

    openEvent: async (eventId) => {
      const s = get();
      const ev = s.data.events.find((e) => e.id === eventId);
      if (!repo || !ev) return false;
      if (!s.can('event.view', eventTarget(ev))) {
        deny('Tu perfil no permite abrir este evento.');
        return false;
      }
      await get().flush();
      const stored = await repo.getPayload(eventId);
      if (!stored) {
        toast('No se encontró el contenido de este evento en este navegador.');
        return false;
      }
      let payload: ProjectFile;
      try {
        // Same validation and migrations as loading the active model at startup.
        payload = normalizeStoredProject(stored.project);
      } catch {
        toast('El contenido de este evento no es compatible con esta versión.');
        return false;
      }
      // Clear the active event first so loading the payload is not written elsewhere.
      const previous = {
        activeEventId: s.activeEventId,
        activeLayoutIds: s.activeLayoutIds,
        editMode: s.editMode,
      };
      set({activeEventId: null});
      const opened = await openComposed(ev, payload);
      if (!opened) {
        set(previous);
        return false;
      }
      set({activeEventId: ev.id, activeProjectId: ev.projectId, activeDayId: pickDay()});
      writeCacheTag(ev.id);
      tagCacheComposition(ev.id);
      persistSelection();
      syncReadOnly();
      return true;
    },

    createEventFromWizard: async (config, opts) => {
      // Never fall back to the legacy path just because startup is still loading.
      if (initPromise) await initPromise;
      let s = get();
      if (!repo || s.unavailable || !s.activeOrgId) {
        // Workspace unavailable: keep the legacy single-model behaviour.
        useProjectStore.getState().createFromWizard(config);
        return true;
      }
      let projectId = s.activeProjectId;
      if (!projectId || !s.data.projects.some((p) => p.id === projectId)) {
        const created = await get().createProject('Mi proyecto');
        if (!created) return false;
        projectId = created.id;
        s = get();
      }
      const orgId = s.data.projects.find((p) => p.id === projectId)!.orgId;
      if (!s.can('event.create', {orgId, projectId})) {
        deny('Tu perfil no permite crear eventos en este proyecto.');
        return false;
      }
      await get().flush();
      const now = nowIso();
      const event: WorkspaceEvent = {
        id: crypto.randomUUID(),
        orgId,
        projectId,
        name: config.name?.trim() || 'Evento sin nombre',
        createdAt: now,
        updatedAt: now,
      };
      await repo.putEvent(event);
      await reload(s.activeUserId);
      const previousEventId = s.activeEventId;
      set({activeEventId: null});
      try {
        useProjectStore.getState().createFromWizard(config);
      } catch (err) {
        // Roll back: no event without content, and the open event stays open.
        await repo.deleteEvent(event.id);
        await reload(s.activeUserId);
        configure(useProjectStore.getState().project.maps);
        set({activeEventId: previousEventId});
        syncReadOnly();
        throw err;
      }
      // The cache now holds the new event: tag it before any await, so a reload
      // never writes the wizard scene into the previous event's layout.
      writeCacheTag(event.id);
      writeCacheComposition({eventId: event.id, layoutIds: {}, editMode: 'layout'});
      // OX-04: the new event gets its own venue (or the chosen saved venue) and a draft layout.
      const project = useProjectStore.getState().project;
      const saved = opts?.venueId ? get().venues.find((v) => v.id === opts.venueId) : undefined;
      await openComposed(event, project, {
        newEvent: true,
        useVenue: saved ? {[project.active]: saved} : undefined,
      });
      set({activeEventId: event.id, activeProjectId: projectId, activeDayId: pickDay()});
      writeCacheTag(event.id);
      tagCacheComposition(event.id);
      // Persist the selection now: a reload during the flush must reopen this event.
      persistSelection();
      await get().flush();
      persistSelection();
      syncReadOnly();
      return true;
    },

    renameEvent: async (eventId, name) => {
      const s = get();
      const ev = s.data.events.find((e) => e.id === eventId);
      if (!repo || !ev || !name.trim()) return;
      if (!s.can('event.edit', eventTarget(ev))) {
        deny('Tu perfil no permite renombrar este evento.');
        return;
      }
      await repo.putEvent({...ev, name: name.trim(), updatedAt: nowIso()});
      await reload(s.activeUserId);
    },

    deleteEvent: async (eventId) => {
      const s = get();
      const ev = s.data.events.find((e) => e.id === eventId);
      if (!repo || !ev) return;
      if (eventId === s.activeEventId) {
        toast('No se puede eliminar el evento abierto.');
        return;
      }
      if (!s.can('event.delete', eventTarget(ev))) {
        deny('Tu perfil no permite eliminar este evento.');
        return;
      }
      await repo.deleteEvent(eventId);
      await reload(s.activeUserId);
    },

    importAsNewProject: async (text) => {
      const s = get();
      if (!repo || s.unavailable || !s.activeOrgId) return null;
      if (!s.can('project.create')) {
        deny('Tu perfil no permite crear proyectos.');
        return null;
      }
      // Parsing reconfigures the global venue maps (`configure`); if the file is
      // rejected or the event is not opened, restore the open event's maps.
      let opened = false;
      try {
        const result = await importV1AsNewProject(repo, text, s.activeOrgId);
        await reload(s.activeUserId);
        opened = await get().openEvent(result.event.id);
        return opened ? {existing: result.existing} : null;
      } finally {
        if (!opened) configure(useProjectStore.getState().project.maps);
      }
    },

    invite: async (input) => {
      const s = get();
      const project = s.data.projects.find((p) => p.id === input.projectId);
      if (!repo || !s.activeUserId || !project || !input.name.trim()) return;
      const target: PermissionTarget = {
        orgId: project.orgId,
        projectId: project.id,
        eventId: input.scope === 'event' ? input.eventId : undefined,
      };
      if (!s.can('members.manage', target)) {
        deny('Tu perfil no permite gestionar miembros.');
        return;
      }
      if (!get().assignableRoles(target).includes(input.role)) {
        deny('Tu perfil no puede asignar ese rol.');
        return;
      }
      const now = nowIso();
      const user: LocalUser = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        contact: input.contact?.trim() || undefined,
        createdAt: now,
      };
      const membership: Membership = {
        id: crypto.randomUUID(),
        orgId: project.orgId,
        userId: user.id,
        role: input.role,
        scope: input.scope,
        projectId: project.id,
        eventId: target.eventId,
        createdAt: now,
        createdBy: s.activeUserId,
      };
      const log: AccessLogEntry = {
        id: crypto.randomUUID(),
        orgId: project.orgId,
        projectId: project.id,
        eventId: target.eventId,
        at: now,
        actorId: s.activeUserId,
        action: 'invite',
        targetUserId: user.id,
        role: input.role,
      };
      await repo.putUser(user);
      await repo.putMembership(membership);
      await repo.appendAccessLog(log);
      await reload(s.activeUserId);
    },

    changeRole: async (membershipId, role) => {
      const s = get();
      const m = s.data.memberships.find((x) => x.id === membershipId);
      if (!repo || !s.activeUserId || !m || m.role === role) return;
      const target = {orgId: m.orgId, projectId: m.projectId, eventId: m.eventId};
      if (!s.can('members.manage', target)) {
        deny('Tu perfil no permite gestionar miembros.');
        return;
      }
      if (m.userId === s.activeUserId) {
        deny('No puedes cambiar tu propio rol.');
        return;
      }
      const allowed = get().assignableRoles(target);
      if (!allowed.includes(role) || !allowed.includes(m.role)) {
        deny('Tu perfil no puede asignar ese rol.');
        return;
      }
      await repo.putMembership({...m, role});
      await repo.appendAccessLog({
        id: crypto.randomUUID(),
        orgId: m.orgId,
        projectId: m.projectId,
        eventId: m.eventId,
        at: nowIso(),
        actorId: s.activeUserId,
        action: 'role_change',
        targetUserId: m.userId,
        role,
        previousRole: m.role,
      });
      await reload(s.activeUserId);
      syncReadOnly();
    },

    revoke: async (membershipId) => {
      const s = get();
      const m = s.data.memberships.find((x) => x.id === membershipId);
      if (!repo || !s.activeUserId || !m) return;
      if (!s.can('members.manage', {orgId: m.orgId, projectId: m.projectId, eventId: m.eventId})) {
        deny('Tu perfil no permite gestionar miembros.');
        return;
      }
      if (m.userId === s.activeUserId && m.scope === 'organization') {
        toast('No puedes retirarte a ti mismo la administración de la organización.');
        return;
      }
      if (m.userId !== s.activeUserId && !get().assignableRoles(m).includes(m.role)) {
        deny('Tu perfil no puede retirar el acceso a ese rol.');
        return;
      }
      await repo.deleteMembership(m.id);
      await repo.appendAccessLog({
        id: crypto.randomUUID(),
        orgId: m.orgId,
        projectId: m.projectId,
        eventId: m.eventId,
        at: nowIso(),
        actorId: s.activeUserId,
        action: 'revoke',
        targetUserId: m.userId,
        previousRole: m.role,
      });
      await reload(s.activeUserId);
      syncReadOnly();
    },

    flush: () => serial(flushNow),

    /* ---------------- OX-04: venue and layouts ---------------- */

    canEditVenue: () => {
      const s = get();
      const ev = activeEvent();
      return !!ev && canEditVenueFor(s.activeUserId, s.data.memberships, eventTarget(ev));
    },

    setEditMode: (mode) =>
      serial(async () => {
        const s = get();
        const ev = activeEvent();
        if (mode === s.editMode) return true;
        if (!repo || !ev || !Object.keys(s.activeLayoutIds).length) return false;
        if (mode === 'venue' && !get().canEditVenue()) {
          deny('Tu perfil no permite editar el recinto.');
          return false;
        }
        await flushNow();
        const venueIds = Object.values(get().activeLayoutIds)
          .map((id) => get().layouts.find((l) => l.id === id)?.venueId)
          .filter((x): x is string => !!x);
        if (mode === 'venue') {
          venueSessionStart = get()
            .venues.filter((v) => venueIds.includes(v.id))
            .map((v) => ({venueId: v.id, version: v.version}));
        } else {
          set({affectedNotice: closeVenueSession()});
        }
        set({editMode: mode});
        recompose(mode);
        syncReadOnly();
        return true;
      }),

    openLayout: (layoutId) =>
      serial(async () => {
        const s = get();
        const ev = activeEvent();
        const layout = layoutOfActiveEvent(layoutId);
        if (!repo || !ev || !layout) return false;
        if (s.editMode === 'venue') {
          toast('Termina la edición del recinto antes de cambiar de distribución.');
          return false;
        }
        if (s.activeLayoutIds[layout.site] === layoutId) return true;
        const venue = s.venues.find((v) => v.id === layout.venueId);
        if (!venue || composedListOverflow(venue.content, layout.content)) {
          toast('El recinto y la distribución superan 500 elementos en una lista; no se puede abrir.');
          return false;
        }
        await flushNow();
        set({activeLayoutIds: {...get().activeLayoutIds, [layout.site]: layoutId}});
        recompose('layout');
        persistSelection();
        syncReadOnly();
        return true;
      }),

    createLayout: (input) =>
      serial(async () => {
        const ok = layoutActionAllowed();
        if (!ok || !repo) return null;
        const s = get();
        if (s.editMode === 'venue') {
          toast('Termina la edición del recinto antes de crear una distribución.');
          return null;
        }
        const site = useProjectStore.getState().activeVenue as VenueKey;
        const current = s.layouts.find((l) => l.id === s.activeLayoutIds[site]);
        if (!current) return null;
        const now = nowIso();
        const name = input.name.trim() || 'Distribución sin nombre';
        let layout: Layout;
        if (input.kind === 'blank') {
          const venue = s.venues.find((v) => v.id === current.venueId);
          if (!venue) return null;
          layout = blankLayout({
            id: crypto.randomUUID(),
            orgId: ok.ev.orgId,
            eventId: ok.ev.id,
            venue,
            name,
            now,
            site,
          });
        } else {
          const source = s.layouts.find(
            (l) => l.id === input.sourceId && l.venueId === current.venueId
          );
          if (!source) return null;
          await flushNow();
          const fresh = get().layouts.find((l) => l.id === source.id)!;
          layout = {
            ...duplicateLayout(fresh, {
              id: crypto.randomUUID(),
              name,
              now,
              newId: () => crypto.randomUUID(),
            }),
            eventId: ok.ev.id,
            site,
          };
        }
        await repo.putLayouts([layout]);
        set({layouts: [...get().layouts, layout]});
        return layout;
      }),

    renameLayout: async (layoutId, name) => {
      await serial(async () => {
        const ok = layoutActionAllowed(layoutId);
        if (!ok?.layout || !repo || !name.trim()) return;
        const next = {...ok.layout, name: name.trim(), updatedAt: nowIso()};
        await repo.putLayouts([next]);
        set({layouts: get().layouts.map((l) => (l.id === next.id ? next : l))});
      });
    },

    setLayoutPhases: async (layoutId, phases) => {
      await serial(async () => {
        const ok = layoutActionAllowed(layoutId);
        if (!ok?.layout || !repo) return;
        if (!phases.length) {
          toast('Una distribución debe cubrir al menos una fase operativa.');
          return;
        }
        const now = nowIso();
        const updated: Layout = {...ok.layout, phases: [...phases], updatedAt: now};
        const list = get().layouts.map((l) => (l.id === layoutId ? updated : l));
        // A current layout keeps the one-current-per-phase rule (D5).
        const demoted =
          updated.state === 'current' ? setLayoutState(list, layoutId, 'current', now) : [];
        const changed = [updated, ...demoted.filter((l) => l.id !== layoutId)];
        await repo.putLayouts(changed);
        set({layouts: list.map((l) => changed.find((c) => c.id === l.id) ?? l)});
      });
    },

    reviewLayout: (layoutId) =>
      serial(async () => {
        const ok = layoutActionAllowed(layoutId);
        if (!ok?.layout || !repo) return null;
        await flushNow();
        const layout = get().layouts.find((l) => l.id === layoutId)!;
        const review = reviewOf(layout);
        if (!review) return null;
        const venue = get().venues.find((v) => v.id === layout.venueId)!;
        if (review.gate.ok && layout.baseVenueVersion !== venue.version) {
          const next = {...layout, baseVenueVersion: venue.version, updatedAt: nowIso()};
          await repo.putLayouts([next]);
          set({layouts: get().layouts.map((l) => (l.id === next.id ? next : l))});
        }
        return review;
      }),

    promoteLayout: (layoutId, state) =>
      serial(async () => {
        const ok = layoutActionAllowed(layoutId);
        if (!ok?.layout || !repo) return null;
        await flushNow();
        const layout = get().layouts.find((l) => l.id === layoutId)!;
        const review = reviewOf(layout);
        if (!review || !review.gate.ok) return review;
        const venue = get().venues.find((v) => v.id === layout.venueId)!;
        const now = nowIso();
        const changed = setLayoutState(get().layouts, layoutId, state, now).map((l) =>
          l.id === layoutId ? {...l, baseVenueVersion: venue.version} : l
        );
        if (!changed.some((l) => l.id === layoutId)) {
          changed.push({...layout, baseVenueVersion: venue.version, updatedAt: now});
        }
        await repo.putLayouts(changed);
        set({layouts: get().layouts.map((l) => changed.find((c) => c.id === l.id) ?? l)});
        return review;
      }),

    archiveLayout: async (layoutId) => {
      await serial(async () => {
        const ok = layoutActionAllowed(layoutId);
        if (!ok?.layout || !repo) return;
        if (Object.values(get().activeLayoutIds).includes(layoutId)) {
          toast('No se puede archivar la distribución abierta.');
          return;
        }
        const changed = setLayoutState(get().layouts, layoutId, 'archived', nowIso());
        await repo.putLayouts(changed);
        set({layouts: get().layouts.map((l) => changed.find((c) => c.id === l.id) ?? l)});
      });
    },

    dismissAffectedNotice: () => set({affectedNotice: null}),

    partOf: (elementId) => {
      const site = useProjectStore.getState().activeVenue as VenueKey;
      const r = recordsFor(site);
      if (!r || !elementId) return null;
      const has = (lists: Array<Array<{id?: string}> | undefined>) =>
        lists.some((list) => (list || []).some((x) => x.id === elementId));
      const v = r.venue.content;
      if (has([v.entrances, v.booths, v.infrastructure, v.passages, v.reserves])) return 'venue';
      if (v.subsoil && has([v.subsoil.polygons, v.subsoil.columns, v.subsoil.walls])) return 'venue';
      const l = r.layout.content;
      if (
        has([
          l.entrances,
          l.booths,
          l.infrastructure,
          l.passages,
          l.reserves,
          l.fences,
          l.flows,
          l.corridors,
          l.roadPlans,
          l.measurements,
          l.annotations,
        ])
      ) {
        return 'layout';
      }
      return null;
    },

    exportableProject: () => {
      const s = get();
      const live = useProjectStore.getState().project;
      const out = structuredClone(live);
      for (const site of Object.keys(s.activeLayoutIds) as VenueKey[]) {
        const r = recordsFor(site);
        const scene = live.scenes[site];
        if (!r || !scene) continue;
        // Split the live scene first so unsaved edits are exported, without locks.
        const split = splitScene(scene, r.venue, r.layout, s.editMode);
        out.scenes[site] = composeScene(
          scene,
          {...r.venue, content: split.venue},
          {...r.layout, content: split.layout, accessOverrides: split.accessOverrides, safety: split.safety},
          'plain'
        );
      }
      return out;
    },
  };
});

/**
 * Events of the active project visible to the active user.
 * Not a Zustand selector: it returns a new array on each call, so use it with
 * `getState()` or inside `useMemo`, never as `useWorkspaceStore(selectActiveProjectEvents)`.
 */
export function selectActiveProjectEvents(s: WorkspaceStoreState): WorkspaceEvent[] {
  if (!s.activeUserId || !s.activeProjectId) return [];
  return visibleEvents(s.activeUserId, s.data, s.activeProjectId);
}
