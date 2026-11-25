import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createDefaultProject, normalizeStoredProject} from '../../src/db/repository';
import {bootstrapWorkspace} from '../../src/db/workspace-migration';
import {MemoryWorkspaceRepository} from '../../src/db/workspace-repository';
import {useProjectStore} from '../../src/store/useProjectStore';
import {
  selectActiveProjectEvents,
  useWorkspaceStore,
  WORKSPACE_CACHE_TAG_KEY,
  WORKSPACE_SELECTION_KEY,
  type WizardConfig,
} from '../../src/store/useWorkspaceStore';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INITIAL_WORKSPACE_STATE = useWorkspaceStore.getState();

function wizardConfig(name: string): WizardConfig {
  return {
    name,
    example: false,
    startDate: '2026-06-01',
    endDate: '2026-06-01',
    from: '10:00',
    to: '20:00',
    goals: [],
    eventDays: 1,
    start: 10,
    hours: 10,
    endTime: '20:00',
    workDays: [
      {
        id: 'day-event',
        name: 'Jornada del evento',
        kind: 'event',
        date: '2026-06-01',
        from: '10:00',
        to: '20:00',
        hours: 10,
      },
      {
        id: 'day-pre',
        name: 'Montaje',
        kind: 'pre',
        date: '2026-05-31',
        from: '08:00',
        to: '14:00',
        hours: 6,
      },
    ],
    startTutorial: false,
  };
}

const ws = () => useWorkspaceStore.getState();
const ps = () => useProjectStore.getState();

/** Fresh repo + init with no legacy saved project: one org and one admin user. */
async function freshWorkspace() {
  const repo = new MemoryWorkspaceRepository();
  await ws().init(repo);
  return repo;
}

/** Creates one project with two events through the wizard path. */
async function twoEvents(repo: MemoryWorkspaceRepository) {
  expect(await ws().createEventFromWizard(wizardConfig('Evento 1'))).toBe(true);
  const ev1 = ws().activeEventId!;
  expect(await ws().createEventFromWizard(wizardConfig('Evento 2'))).toBe(true);
  const ev2 = ws().activeEventId!;
  expect(ev1).toBeTruthy();
  expect(ev2).toBeTruthy();
  expect(ev2).not.toBe(ev1);
  expect(repo.data.projects).toHaveLength(1);
  return {ev1, ev2};
}

/**
 * In-memory Storage. The unit environment does not reliably expose
 * `localStorage` (Node's experimental global can shadow jsdom's), so the
 * workspace selection key is backed by this deterministic stub.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  useProjectStore.setState({
    hasSavedProject: false,
    readOnly: false,
    history: [],
    future: [],
    activeVenue: 'cristo',
  });
  useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
});

afterEach(async () => {
  // Clear any pending debounced payload write before the next test.
  await ws().flush();
  useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
});

describe('useWorkspaceStore', () => {
  it('bootstraps an organization and an org_admin user on an empty repository', async () => {
    const repo = await freshWorkspace();
    const s = ws();
    expect(s.ready).toBe(true);
    expect(s.unavailable).toBe(false);
    expect(repo.data.organizations).toHaveLength(1);
    expect(repo.data.users).toHaveLength(1);
    expect(s.activeUserId).toBe(repo.data.users[0].id);
    expect(s.activeOrgId).toBe(repo.data.organizations[0].id);
    expect(s.can('project.create')).toBe(true);
    expect(repo.data.projects).toHaveLength(0);
  });

  it('createProject adds a project in the active organization', async () => {
    const repo = await freshWorkspace();
    const p = await ws().createProject('  Fiestas  ');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('Fiestas');
    expect(p!.orgId).toBe(ws().activeOrgId);
    expect(ws().activeProjectId).toBe(p!.id);
    expect(repo.data.projects.map((x) => x.id)).toEqual([p!.id]);
  });

  it('keeps one project with two events and two payloads across a re-init, without duplicates', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);

    expect(repo.data.events.map((e) => e.id).sort()).toEqual([ev1, ev2].sort());
    expect(repo.data.events.every((e) => e.projectId === repo.data.projects[0].id)).toBe(true);
    expect(repo.payloads.size).toBe(2);
    expect(repo.payloads.get(ev1)!.project.scenes.cristo.title).toBe('Evento 1');
    expect(repo.payloads.get(ev2)!.project.scenes.cristo.title).toBe('Evento 2');

    // Simulate an app reload: reset store state and initialise again on the same repo.
    await ws().flush();
    useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
    await ws().init(repo);

    expect(repo.data.organizations).toHaveLength(1);
    expect(repo.data.users).toHaveLength(1);
    expect(repo.data.memberships).toHaveLength(1);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(2);
    expect(repo.payloads.size).toBe(2);
    expect(ws().data.events).toHaveLength(2);
    expect(ws().activeEventId).toBe(ev2);
    expect(ws().activeProjectId).toBe(repo.data.projects[0].id);
    expect(selectActiveProjectEvents(ws()).map((e) => e.id).sort()).toEqual([ev1, ev2].sort());

    // Both events can be reopened after the reload.
    expect(await ws().openEvent(ev1)).toBe(true);
    expect(ps().project.scenes.cristo.title).toBe('Evento 1');
    expect(await ws().openEvent(ev2)).toBe(true);
    expect(ps().project.scenes.cristo.title).toBe('Evento 2');
    expect(repo.data.events).toHaveLength(2);
    expect(repo.payloads.size).toBe(2);
  });

  it('selects the Jornada of the current operational phase as active day', async () => {
    const repo = await freshWorkspace();
    await twoEvents(repo);
    // The wizard opens the event in the 'event' phase.
    expect(ps().phase).toBe('event');
    expect(ws().activeDayId).toBe('day-event');
    ws().setActiveDay('day-pre');
    expect(ps().phase).toBe('pre');
  });

  it('blocks undo and replaceProject for a read-only profile', async () => {
    const repo = await freshWorkspace();
    const {ev2} = await twoEvents(repo);
    const projectId = repo.data.projects[0].id;
    ps().updateScene((scene) => {
      scene.title = 'Con historial';
    }, true);
    await ws().invite({name: 'Lectora', role: 'read_only', scope: 'event', projectId, eventId: ev2});
    const reader = repo.data.memberships.find((m) => m.role === 'read_only')!;
    await ws().setActiveUser(reader.userId);
    expect(ps().readOnly).toBe(true);
    expect(ps().history).toEqual([]);
    const before = JSON.stringify(ps().project);
    ps().undo();
    ps().replaceProject(createDefaultProject());
    expect(JSON.stringify(ps().project)).toBe(before);
  });

  it('switching to a profile without access and back neither duplicates nor loses the event', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);
    const adminId = ws().activeUserId!;
    const projectId = repo.data.projects[0].id;
    await ws().invite({name: 'Solo E1', role: 'read_only', scope: 'event', projectId, eventId: ev1});
    const guest = repo.data.memberships.find((m) => m.role === 'read_only')!;

    await ws().setActiveUser(guest.userId);
    expect(ws().activeEventId).toBeNull();
    expect(ps().menuOpen).toBe(true);
    // A navigation change while hidden must not untag the cache.
    ps().setVenue('vega');
    expect(localStorage.getItem(WORKSPACE_CACHE_TAG_KEY)).toBe(ev2);

    await ws().setActiveUser(adminId);
    expect(ws().activeEventId).toBe(ev2);

    // Reload: still 1 project and 2 events.
    await ws().flush();
    useProjectStore.setState({hasSavedProject: true});
    useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
    await ws().init(repo);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(2);
    expect(ws().activeEventId).toBe(ev2);
  });

  it('prevents granting org_admin or more than the actor holds, and changing one’s own role', async () => {
    const repo = await freshWorkspace();
    await twoEvents(repo);
    const projectId = repo.data.projects[0].id;
    const orgId = repo.data.projects[0].orgId;
    await ws().invite({name: 'Coord', role: 'event_coordinator', scope: 'project', projectId});
    const coord = repo.data.memberships.find((m) => m.role === 'event_coordinator')!;
    // An org admin cannot grant org_admin at project scope either.
    await ws().invite({name: 'X', role: 'org_admin', scope: 'project', projectId});
    expect(repo.data.memberships.some((m) => m.role === 'org_admin' && m.scope !== 'organization')).toBe(false);

    await ws().setActiveUser(coord.userId);
    expect(ws().assignableRoles({orgId, projectId})).not.toContain('org_admin');
    await ws().changeRole(coord.id, 'org_admin');
    expect(repo.data.memberships.find((m) => m.id === coord.id)!.role).toBe('event_coordinator');
    await ws().changeRole(coord.id, 'read_only');
    expect(repo.data.memberships.find((m) => m.id === coord.id)!.role).toBe('event_coordinator');
  });

  it('openEvent restores the other event payload and clears undo history', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);
    const ev1Payload = structuredClone(repo.payloads.get(ev1)!.project);

    // Edit event 2 with an undo checkpoint.
    ps().updateScene((scene) => {
      scene.title = 'Evento 2 editado';
    }, true);
    expect(ps().history.length).toBeGreaterThan(0);

    // Opening runs the same validation/migrations as startup loading, which may
    // stamp `demandConfig.updatedAt`; freeze Date so the expectation matches.
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
    try {
      const expected = normalizeStoredProject(structuredClone(ev1Payload));
      expect(await ws().openEvent(ev1)).toBe(true);
      expect(ws().activeEventId).toBe(ev1);
      expect(ps().project).toEqual(expected);
    } finally {
      vi.useRealTimers();
    }
    expect(ps().history).toEqual([]);
    expect(ps().future).toEqual([]);

    // The pending edit of event 2 was flushed to its own payload before switching.
    expect(repo.payloads.get(ev2)!.project.scenes.cristo.title).toBe('Evento 2 editado');
    expect(repo.payloads.get(ev1)!.project.scenes.cristo.title).toBe('Evento 1');
  });

  it('flush writes the active event payload to the repository', async () => {
    const repo = await freshWorkspace();
    const {ev2} = await twoEvents(repo);
    ps().updateScene((scene) => {
      scene.title = 'Flushed';
    });
    await ws().flush();
    const stored = repo.payloads.get(ev2)!;
    expect(stored.project).toEqual(ps().project);
    expect(stored.updatedAt).toMatch(ISO_RE);
  });

  it('opens an event read-only for a read_only member and blocks edits', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);
    const projectId = repo.data.projects[0].id;
    const adminId = ws().activeUserId!;

    await ws().invite({
      name: 'Lectora',
      role: 'read_only',
      scope: 'event',
      projectId,
      eventId: ev1,
    });
    const guest = repo.data.memberships.find((m) => m.role === 'read_only')!;
    expect(guest).toBeDefined();
    expect(guest.eventId).toBe(ev1);

    await ws().setActiveUser(guest.userId);
    expect(ws().activeUserId).toBe(guest.userId);
    expect(ws().activeUserId).not.toBe(adminId);
    // The guest only sees the event they were invited to.
    expect(selectActiveProjectEvents(ws()).map((e) => e.id)).toEqual([ev1]);
    expect(await ws().openEvent(ev2)).toBe(false);

    expect(await ws().openEvent(ev1)).toBe(true);
    expect(ps().readOnly).toBe(true);

    const before = ps().project;
    const beforeJson = JSON.stringify(before);
    ps().updateScene((scene) => {
      scene.title = 'Intento de edición';
    }, true);
    expect(ps().project).toBe(before);
    expect(JSON.stringify(ps().project)).toBe(beforeJson);
    expect(ps().history).toEqual([]);

    // Back to the admin: editing is allowed again.
    await ws().setActiveUser(adminId);
    expect(ps().readOnly).toBe(false);
  });

  it('records invite, role change and revoke in the access log', async () => {
    const repo = await freshWorkspace();
    const {ev1} = await twoEvents(repo);
    const projectId = repo.data.projects[0].id;
    const orgId = ws().activeOrgId!;
    const adminId = ws().activeUserId!;

    await ws().invite({
      name: 'Proveedor',
      contact: 'proveedor@example.test',
      role: 'external_supplier',
      scope: 'event',
      projectId,
      eventId: ev1,
    });
    const m = repo.data.memberships.find((x) => x.role === 'external_supplier')!;
    expect(m).toMatchObject({orgId, scope: 'event', projectId, eventId: ev1, createdBy: adminId});

    await ws().changeRole(m.id, 'technician');
    expect(repo.data.memberships.find((x) => x.id === m.id)!.role).toBe('technician');

    await ws().revoke(m.id);
    expect(repo.data.memberships.some((x) => x.id === m.id)).toBe(false);

    const log = repo.data.accessLog;
    expect(log.map((e) => e.action)).toEqual(['invite', 'role_change', 'revoke']);
    for (const e of log) {
      expect(e.actorId).toBe(adminId);
      expect(e.targetUserId).toBe(m.userId);
      expect(e.orgId).toBe(orgId);
      expect(e.projectId).toBe(projectId);
      expect(e.eventId).toBe(ev1);
      expect(e.at).toMatch(ISO_RE);
      expect(new Date(e.at).toISOString()).toBe(e.at);
    }
    expect(log[0].role).toBe('external_supplier');
    expect(log[0].previousRole).toBeUndefined();
    expect(log[1].role).toBe('technician');
    expect(log[1].previousRole).toBe('external_supplier');
    expect(log[2].role).toBeUndefined();
    expect(log[2].previousRole).toBe('technician');
    expect(new Set(log.map((e) => e.id)).size).toBe(3);

    // The store view exposes the same log to the admin.
    expect(ws().data.accessLog.map((e) => e.action)).toEqual(['invite', 'role_change', 'revoke']);
  });

  it('does not log a role change to the same role', async () => {
    const repo = await freshWorkspace();
    const {ev1} = await twoEvents(repo);
    await ws().invite({
      name: 'Montador',
      role: 'installer',
      scope: 'event',
      projectId: repo.data.projects[0].id,
      eventId: ev1,
    });
    const m = repo.data.memberships.find((x) => x.role === 'installer')!;
    await ws().changeRole(m.id, 'installer');
    expect(repo.data.accessLog.map((e) => e.action)).toEqual(['invite']);
  });

  it('importAsNewProject creates and opens a new project, and re-import reuses it', async () => {
    const repo = await freshWorkspace();
    const source = createDefaultProject();
    source.scenes.cristo.title = 'Importado E2E';
    const text = JSON.stringify(source);

    const first = await ws().importAsNewProject(text);
    expect(first).toEqual({existing: false});
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    const eventId = repo.data.events[0].id;
    expect(ws().activeEventId).toBe(eventId);
    expect(ws().activeProjectId).toBe(repo.data.projects[0].id);
    expect(ps().project.scenes.cristo.title).toBe('Importado E2E');
    expect(ps().readOnly).toBe(false);

    const again = await ws().importAsNewProject(JSON.stringify(source, null, 2));
    expect(again).toEqual({existing: true});
    expect(ws().activeEventId).toBe(eventId);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    expect(repo.payloads.size).toBe(1);
  });

  it('deleteEvent refuses the open event but deletes another one', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);
    expect(ws().activeEventId).toBe(ev2);

    await ws().deleteEvent(ev2);
    expect(repo.data.events.map((e) => e.id).sort()).toEqual([ev1, ev2].sort());
    expect(repo.payloads.has(ev2)).toBe(true);

    await ws().deleteEvent(ev1);
    expect(repo.data.events.map((e) => e.id)).toEqual([ev2]);
    expect(repo.payloads.has(ev1)).toBe(false);
  });

  it('deleteProject refuses the project of the open event but deletes another one', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);
    const openProjectId = repo.data.projects[0].id;

    await ws().deleteProject(openProjectId);
    expect(repo.data.projects.map((p) => p.id)).toEqual([openProjectId]);
    expect(repo.data.events).toHaveLength(2);
    expect(repo.payloads.size).toBe(2);

    const other = await ws().createProject('Otro');
    expect(repo.data.projects).toHaveLength(2);
    await ws().deleteProject(other!.id);
    expect(repo.data.projects.map((p) => p.id)).toEqual([openProjectId]);
    expect(repo.data.events.map((e) => e.id).sort()).toEqual([ev1, ev2].sort());
    expect(ws().activeEventId).toBe(ev2);
  });

  it('init adopts a saved model without event once, without duplicates on later inits', async () => {
    const repo = new MemoryWorkspaceRepository();
    await bootstrapWorkspace(repo, null, '2026-01-01T00:00:00.000Z');
    useProjectStore.setState({hasSavedProject: true});

    await ws().init(repo);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    const eventId = repo.data.events[0].id;
    expect(ws().activeEventId).toBe(eventId);
    expect(repo.payloads.get(eventId)!.project).toEqual(ps().project);

    // Reload with the selection kept.
    await ws().flush();
    useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
    await ws().init(repo);
    expect(ws().activeEventId).toBe(eventId);

    // Reload with the selection lost: the payload hash matches, nothing new is created.
    await ws().flush();
    vi.stubGlobal('localStorage', memoryStorage());
    useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
    await ws().init(repo);
    expect(ws().activeEventId).toBe(eventId);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    expect(repo.payloads.size).toBe(1);
  });

  it('never writes the cached content into another event when tabs diverge (cache tag)', async () => {
    const repo = await freshWorkspace();
    const {ev1, ev2} = await twoEvents(repo);
    // Tab A edits event 2: the cache (and its tag) now hold event 2.
    ps().updateScene((scene) => {
      scene.title = 'Evento 2 · pestaña A';
    });
    await ws().flush();
    useProjectStore.setState({hasSavedProject: true});
    expect(localStorage.getItem(WORKSPACE_CACHE_TAG_KEY)).toBe(ev2);
    // Tab B selected event 1 meanwhile (shared selection key).
    const sel = JSON.parse(localStorage.getItem(WORKSPACE_SELECTION_KEY)!);
    localStorage.setItem(WORKSPACE_SELECTION_KEY, JSON.stringify({...sel, eventId: ev1}));

    useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
    await ws().init(repo);

    expect(ws().activeEventId).toBe(ev1);
    expect(ps().project.scenes.cristo.title).toBe('Evento 1');
    expect(repo.payloads.get(ev1)!.project.scenes.cristo.title).toBe('Evento 1');
    expect(repo.payloads.get(ev2)!.project.scenes.cristo.title).toBe('Evento 2 · pestaña A');
    expect(localStorage.getItem(WORKSPACE_CACHE_TAG_KEY)).toBe(ev1);
  });

  it('rejects an incompatible import without creating anything', async () => {
    const repo = await freshWorkspace();
    const {ev2} = await twoEvents(repo);
    await expect(ws().importAsNewProject('{"format":"ojo-de-buey","version":7}')).rejects.toThrow();
    expect(repo.data.projects).toHaveLength(1);
    expect(ws().activeEventId).toBe(ev2);
  });

  it('refuses member management to a member without members.manage', async () => {
    const repo = await freshWorkspace();
    const {ev1} = await twoEvents(repo);
    const projectId = repo.data.projects[0].id;
    await ws().invite({name: 'Técnico', role: 'technician', scope: 'project', projectId});
    const tech = repo.data.memberships.find((x) => x.role === 'technician')!;
    await ws().setActiveUser(tech.userId);

    const logBefore = repo.data.accessLog.length;
    const membersBefore = repo.data.memberships.length;
    await ws().invite({name: 'Otro', role: 'read_only', scope: 'event', projectId, eventId: ev1});
    await ws().changeRole(tech.id, 'event_coordinator');
    expect(repo.data.accessLog).toHaveLength(logBefore);
    expect(repo.data.memberships).toHaveLength(membersBefore);
    expect(repo.data.memberships.find((x) => x.id === tech.id)!.role).toBe('technician');
  });
});
