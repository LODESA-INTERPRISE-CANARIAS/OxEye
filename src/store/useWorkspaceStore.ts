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
  effectiveRole,
  visibleEvents,
} from '../engine/workspace/permissions';
import type {ProjectFile} from '../types';
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
}

function readSelection(): Selection {
  try {
    const raw = localStorage.getItem(WORKSPACE_SELECTION_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return {
      userId: typeof p.userId === 'string' ? p.userId : null,
      projectId: typeof p.projectId === 'string' ? p.projectId : null,
      eventId: typeof p.eventId === 'string' ? p.eventId : null,
    };
  } catch {
    return {userId: null, projectId: null, eventId: null};
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
  /** Creates a new event in the active project (or a new default project) from the wizard. */
  createEventFromWizard: (config: WizardConfig) => Promise<boolean>;
  renameEvent: (eventId: string, name: string) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  /** Imports a v1 JSON as the first event of a new project and opens it. */
  importAsNewProject: (text: string) => Promise<{existing: boolean} | null>;
  invite: (input: InviteInput) => Promise<void>;
  changeRole: (membershipId: string, role: WorkspaceRole) => Promise<void>;
  revoke: (membershipId: string) => Promise<void>;
  /** Flushes the pending write of the active event payload. */
  flush: () => Promise<void>;
}

let repo: WorkspaceRepository | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribeProject: (() => void) | undefined;
let initPromise: Promise<void> | null = null;

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
      !s.ready || s.unavailable || (!!ev && s.can('event.edit', eventTarget(ev)));
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

      // 2. Open the selected event; if it is not the cached one, load it from IndexedDB.
      let ev = findEvent(sel.eventId) ?? cacheEvent;
      if (ev && !get().can('event.view', eventTarget(ev))) ev = undefined;
      if (ev && (!ps.hasSavedProject || ev.id !== cacheEvent?.id)) {
        const stored = await repo.getPayload(ev.id);
        let loaded = false;
        if (stored) {
          try {
            useProjectStore.getState().openEventPayload(normalizeStoredProject(stored.project));
            writeCacheTag(ev.id);
            loaded = true;
          } catch {
            loaded = false;
          }
        }
        if (!loaded) ev = ps.hasSavedProject ? cacheEvent : undefined;
      }

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
      set({activeEventId: null});
      useProjectStore.getState().openEventPayload(payload);
      set({activeEventId: ev.id, activeProjectId: ev.projectId, activeDayId: pickDay()});
      writeCacheTag(ev.id);
      persistSelection();
      syncReadOnly();
      return true;
    },

    createEventFromWizard: async (config) => {
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
      set({activeEventId: event.id, activeProjectId: projectId, activeDayId: pickDay()});
      writeCacheTag(event.id);
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

    flush: async () => {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = undefined;
      }
      const s = get();
      if (!repo || !s.activeEventId) return;
      const ev = s.data.events.find((e) => e.id === s.activeEventId);
      if (!ev) return;
      try {
        await repo.putPayload({
          eventId: ev.id,
          orgId: ev.orgId,
          project: structuredClone(useProjectStore.getState().project),
          updatedAt: nowIso(),
        });
      } catch {
        // Ignore IndexedDB errors; the localStorage cache still holds the active event.
      }
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
