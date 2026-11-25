import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createDefaultProject} from '../../src/db/repository';
import {MemoryWorkspaceRepository} from '../../src/db/workspace-repository';
import {installationsOutsidePerimeter} from '../../src/engine/cartography/perimeter-status';
import {affectedLayouts, COMPOSED_LIST_LIMIT} from '../../src/engine/workspace/venue-layout';
import {useProjectStore} from '../../src/store/useProjectStore';
import {useWorkspaceStore} from '../../src/store/useWorkspaceStore';
import type {BoothItem, InfrastructureItem, ProjectFile} from '../../src/types';
import type {Layout} from '../../src/types/venue';

const INITIAL_WORKSPACE_STATE = useWorkspaceStore.getState();
const FIXED_NOW = new Date('2026-11-25T10:00:00.000Z');

const ws = () => useWorkspaceStore.getState();
const ps = () => useProjectStore.getState();

/** Same deterministic in-memory Storage stub as `workspace-store.test.ts`. */
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

const FOUNTAIN: InfrastructureItem = {
  id: 'fountain-qa',
  name: 'Fuente',
  kind: 'fountain',
  role: 'fixed',
  x: 45,
  y: 50,
  width: 2,
  depth: 2,
  permanent: true,
};
const YELLOW_TENT: InfrastructureItem = {
  id: 'yellow-qa',
  name: 'Carpa Amarilla',
  kind: 'yellow_tent',
  role: 'support',
  x: 40,
  y: 45,
  width: 3,
  depth: 3,
  rotation: 0,
};

/** Legacy v1 file: Plaza del Cristo preset with perimeter, a permanent fountain and a Carpa Amarilla. */
function legacyProject(): ProjectFile {
  const p = createDefaultProject();
  p.scenes.constitucion.boundary = [];
  p.scenes.vega.boundary = [];
  p.scenes.cristo.infrastructure.push(structuredClone(FOUNTAIN), structuredClone(YELLOW_TENT));
  return p;
}

interface Opened {
  repo: MemoryWorkspaceRepository;
  eventId: string;
  layoutId: string;
  venueId: string;
}

/** Fresh workspace; imports the legacy file, which opens as venue + current layout. */
async function openLegacyEvent(): Promise<Opened> {
  const repo = new MemoryWorkspaceRepository();
  await ws().init(repo);
  expect(await ws().importAsNewProject(JSON.stringify(legacyProject()))).toEqual({existing: false});
  const eventId = ws().activeEventId!;
  const layoutId = ws().activeLayoutIds.cristo!;
  expect(eventId).toBeTruthy();
  expect(layoutId).toBeTruthy();
  expect(ws().editMode).toBe('layout');
  const layout = repo.layouts.get(layoutId)!;
  expect(layout.state).toBe('current');
  return {repo, eventId, layoutId, venueId: layout.venueId};
}

/** Simulates an app reload on the same repository. */
async function reinit(repo: MemoryWorkspaceRepository, opts: {fromIndexedDb?: boolean} = {}) {
  await ws().flush();
  if (opts.fromIndexedDb) {
    // Nothing kept in memory or in the localStorage cache: reopen from the repository.
    useProjectStore.setState({hasSavedProject: false, project: createDefaultProject()});
  } else {
    useProjectStore.setState({hasSavedProject: true});
  }
  useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
  await ws().init(repo);
}

const liveScene = () => ps().project.scenes.cristo;
const metresToPercentX = (m: number) => (m / ps().project.maps.cristo.widthMeters) * 100;

function itemIds(l: Layout): string[] {
  const c = l.content;
  return [...c.booths, ...c.infrastructure, ...c.entrances, ...c.passages, ...c.reserves, ...c.fences].map(
    (x) => x.id!
  );
}

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(FIXED_NOW);
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
  await ws().flush();
  useWorkspaceStore.setState(INITIAL_WORKSPACE_STATE, true);
  vi.useRealTimers();
});

describe('venue / layout store integration (OX-04)', () => {
  it('VAL-MAP-CORE-001: a placed tent keeps id, position, rotation, dimensions and layout version after reopen', async () => {
    const {repo, eventId, layoutId} = await openLegacyEvent();
    const v0 = repo.layouts.get(layoutId)!.version;

    ps().updateScene((s) => {
      s.infrastructure.push({
        id: 'tent-qa',
        name: 'Carpa 3×6',
        kind: 'tent',
        role: 'support',
        x: 42,
        y: 50,
        width: 3,
        depth: 6,
        rotation: 0,
      });
    });
    ps().updateScene((s) => {
      s.infrastructure.find((o) => o.id === 'tent-qa')!.rotation = 90;
    });
    const dx = metresToPercentX(4);
    ps().updateScene((s) => {
      s.infrastructure.find((o) => o.id === 'tent-qa')!.x += dx;
    });
    await ws().flush();

    const stored = repo.layouts.get(layoutId)!;
    const v1 = stored.version;
    expect(v1).toBeGreaterThan(v0);
    const expected = stored.content.infrastructure.find((o) => o.id === 'tent-qa')!;
    expect(expected).toMatchObject({x: 42 + dx, y: 50, rotation: 90, width: 3, depth: 6});

    // Reload with the localStorage cache.
    await reinit(repo);
    expect(ws().activeEventId).toBe(eventId);
    expect(ws().activeLayoutIds.cristo).toBe(layoutId);
    expect(liveScene().infrastructure.find((o) => o.id === 'tent-qa')).toEqual(expected);
    expect(repo.layouts.get(layoutId)!.version).toBe(v1);

    // Reload from IndexedDB only: the layout record is the source, not the payload copy (D14).
    repo.payloads.get(eventId)!.project.scenes.cristo.infrastructure.find((o) => o.id === 'tent-qa')!.x = 1;
    await reinit(repo, {fromIndexedDb: true});
    expect(ws().activeEventId).toBe(eventId);
    const reopened = liveScene().infrastructure.find((o) => o.id === 'tent-qa')!;
    expect(reopened).toEqual(expected);
    expect(reopened.locked).toBeUndefined();
    expect(repo.layouts.get(layoutId)!.version).toBe(v1);
  });

  it('never changes the venue from layout mode; access operation goes to accessOverrides', async () => {
    const {repo, layoutId, venueId} = await openLegacyEvent();
    const venueBefore = structuredClone(repo.venues.get(venueId)!);
    const gate = venueBefore.content.entrances.find((e) => e.role !== 'closed')!;
    expect(gate).toBeDefined();
    // Venue elements are shown locked while editing the layout.
    expect(liveScene().entrances.find((e) => e.id === gate.id)!.locked).toBe(true);

    ps().updateScene((s) => {
      s.entrances.find((e) => e.id === gate.id)!.x += 5;
    });
    await ws().flush();
    expect(repo.venues.get(venueId)).toEqual(venueBefore);

    ps().updateScene((s) => {
      s.entrances.find((e) => e.id === gate.id)!.role = 'closed';
    });
    await ws().flush();
    expect(repo.layouts.get(layoutId)!.accessOverrides).toEqual({[gate.id]: {role: 'closed'}});
    expect(repo.venues.get(venueId)).toEqual(venueBefore);
  });

  it('venue mode: a new access bumps the venue version and lists affected layouts without changing them', async () => {
    const {repo, layoutId, venueId} = await openLegacyEvent();
    const b = await ws().createLayout({kind: 'blank', name: 'Distribución B'});
    expect(b).not.toBeNull();
    await ws().flush();
    const bBefore = structuredClone(repo.layouts.get(b!.id)!);
    const aBefore = structuredClone(repo.layouts.get(layoutId)!);
    const venueVersion = repo.venues.get(venueId)!.version;

    expect(await ws().setEditMode('venue')).toBe(true);
    expect(ws().editMode).toBe('venue');
    // Layout elements are shown locked while editing the venue.
    expect(liveScene().infrastructure.find((o) => o.id === 'yellow-qa')!.locked).toBe(true);
    ps().updateScene((s) => {
      s.entrances.push({id: 'gate-qa', name: 'Acceso nuevo', x: 40, y: 30});
    });
    expect(await ws().setEditMode('layout')).toBe(true);
    expect(ws().editMode).toBe('layout');

    const venue = repo.venues.get(venueId)!;
    expect(venue.version).toBe(venueVersion + 1);
    expect(venue.content.entrances.some((e) => e.id === 'gate-qa')).toBe(true);

    const notice = ws().affectedNotice!;
    expect(notice).not.toBeNull();
    expect(notice.venueId).toBe(venueId);
    expect(notice.layoutIds).toContain(b!.id);
    expect([...notice.layoutIds].sort()).toEqual(
      affectedLayouts(venue, [...repo.layouts.values()])
        .map((l) => l.id)
        .sort()
    );

    // Affected layouts are not modified.
    expect(repo.layouts.get(b!.id)).toEqual(bBefore);
    const a = repo.layouts.get(layoutId)!;
    expect(a.content).toEqual(aBefore.content);
    expect(a.version).toBe(aBefore.version);
    expect(a.accessOverrides).toEqual(aBefore.accessOverrides);
    // The new access is a venue element, locked in layout mode.
    expect(liveScene().entrances.find((e) => e.id === 'gate-qa')!.locked).toBe(true);
  });

  it('re-locks an element that moved to the locked part after a flush, so it is not edited in vain', async () => {
    const {repo, layoutId} = await openLegacyEvent();
    expect(await ws().setEditMode('venue')).toBe(true);
    // Unchecking «permanente» in venue mode moves the fountain to the open layout.
    ps().updateScene((s) => {
      s.infrastructure.find((o) => o.id === FOUNTAIN.id)!.permanent = false;
    });
    await ws().flush();
    expect(repo.layouts.get(layoutId)!.content.infrastructure.some((o) => o.id === FOUNTAIN.id)).toBe(
      true
    );
    // It is now layout content: locked while the venue is being edited.
    expect(liveScene().infrastructure.find((o) => o.id === FOUNTAIN.id)!.locked).toBe(true);
  });

  it('refuses venue mode to read-only and technician profiles (D16, provisional)', async () => {
    const {repo, eventId} = await openLegacyEvent();
    const adminId = ws().activeUserId!;
    const projectId = repo.data.projects[0].id;
    const orgId = repo.data.projects[0].orgId;
    await ws().invite({name: 'Lectora', role: 'read_only', scope: 'event', projectId, eventId});
    await ws().invite({name: 'Técnico', role: 'technician', scope: 'project', projectId});
    const reader = repo.data.memberships.find((m) => m.role === 'read_only')!;
    const tech = repo.data.memberships.find((m) => m.role === 'technician')!;

    await ws().setActiveUser(reader.userId);
    expect(ws().activeEventId).toBe(eventId);
    expect(ws().canEditVenue()).toBe(false);
    expect(await ws().setEditMode('venue')).toBe(false);
    expect(ws().editMode).toBe('layout');

    await ws().setActiveUser(tech.userId);
    expect(ws().activeEventId).toBe(eventId);
    expect(ws().can('event.edit', {orgId, projectId, eventId})).toBe(true);
    expect(ws().canEditVenue()).toBe(false);
    expect(await ws().setEditMode('venue')).toBe(false);
    expect(ws().editMode).toBe('layout');
    expect(ps().readOnly).toBe(false);

    // Control: the organization administrator may enter venue mode; switching
    // to the technician leaves it.
    await ws().setActiveUser(adminId);
    expect(await ws().setEditMode('venue')).toBe(true);
    await ws().setActiveUser(tech.userId);
    expect(ws().editMode).toBe('layout');
  });

  it('duplicates a layout with new ids and origins, without the safety review, leaving the source unchanged', async () => {
    const {repo, eventId, layoutId, venueId} = await openLegacyEvent();
    await ws().flush();
    const src = structuredClone(repo.layouts.get(layoutId)!);
    expect(Object.keys(src.safety).length).toBeGreaterThan(0);

    const copy = await ws().createLayout({kind: 'duplicate', name: 'Copia', sourceId: layoutId});
    expect(copy).not.toBeNull();
    expect(copy).toMatchObject({
      eventId,
      venueId,
      state: 'draft',
      version: 1,
      originLayoutId: layoutId,
      safety: {},
    });
    const srcIds = new Set(itemIds(src));
    const copyIds = itemIds(copy!);
    expect(copyIds.length).toBe(srcIds.size);
    expect(copyIds.some((id) => srcIds.has(id))).toBe(false);
    for (const o of copy!.content.infrastructure) {
      const origin = copy!.originItemIds![o.id];
      expect(srcIds.has(origin)).toBe(true);
      const source = src.content.infrastructure.find((x) => x.id === origin)!;
      expect({...o, id: origin}).toMatchObject({
        id: source.id,
        kind: source.kind,
        x: source.x,
        y: source.y,
        width: source.width,
        depth: source.depth,
      });
    }
    expect(repo.layouts.get(copy!.id)).toEqual(copy);

    expect(await ws().openLayout(copy!.id)).toBe(true);
    expect(ws().activeLayoutIds.cristo).toBe(copy!.id);
    const venue = repo.venues.get(venueId)!;
    const liveIds = liveScene().infrastructure.map((o) => o.id).sort();
    expect(liveIds).toEqual(
      [...venue.content.infrastructure, ...copy!.content.infrastructure].map((o) => o.id).sort()
    );
    expect(liveScene().safetyReview).toBeUndefined();
    expect(repo.layouts.get(layoutId)).toEqual(src);
  });

  it('VAL-MAP-BOUNDARY-001: an installation outside the perimeter blocks promotion; inside, promotion demotes the previous current layout', async () => {
    const {repo, layoutId} = await openLegacyEvent();
    const b = await ws().createLayout({kind: 'duplicate', name: 'Propuesta', sourceId: layoutId});
    expect(await ws().openLayout(b!.id)).toBe(true);
    ps().updateScene((s) => {
      s.infrastructure.push({
        id: 'outside-qa',
        name: 'Carpa fuera',
        kind: 'tent',
        role: 'support',
        x: 3,
        y: 3,
        width: 2,
        depth: 2,
        rotation: 0,
      });
    });
    const issueId = 'outside-perimeter-outside-qa';

    const blocked = await ws().promoteLayout(b!.id, 'current');
    expect(blocked).not.toBeNull();
    expect(blocked!.gate.ok).toBe(false);
    expect(blocked!.gate.causes).toContainEqual(
      expect.objectContaining({category: 'perimeter', issueId})
    );
    expect(repo.layouts.get(b!.id)!.state).toBe('draft');
    expect(repo.layouts.get(layoutId)!.state).toBe('current');

    // Move it inside the Plaza del Cristo perimeter (vertex centroid of the venue boundary).
    const boundary = repo.venues.get(repo.layouts.get(b!.id)!.venueId)!.content.boundary;
    const cx = boundary.reduce((a, p) => a + p[0], 0) / boundary.length;
    const cy = boundary.reduce((a, p) => a + p[1], 0) / boundary.length;
    ps().updateScene((s) => {
      const o = s.infrastructure.find((x) => x.id === 'outside-qa')!;
      o.x = cx;
      o.y = cy;
    });
    await ws().flush();
    const partial = await ws().promoteLayout(b!.id, 'current');
    expect(partial!.gate.causes.some((c) => c.issueId === issueId)).toBe(false);

    // The preset example itself has installations outside its reference
    // perimeter; they block too until moved inside (no inherited conformity).
    const presetOutside = installationsOutsidePerimeter(liveScene(), ps().project.maps.cristo).map(
      (x) => x.item.id
    );
    expect([...partial!.gate.causes.map((c) => c.issueId)].sort()).toEqual(
      presetOutside.map((id) => 'outside-perimeter-' + id).sort()
    );
    if (presetOutside.length) {
      expect(partial!.gate.ok).toBe(false);
      expect(repo.layouts.get(b!.id)!.state).toBe('draft');
    }
    ps().updateScene((s) => {
      presetOutside.forEach((id, i) => {
        const o = [...s.infrastructure, ...s.base.booths].find((x) => x.id === id)!;
        o.x = cx + (i + 1) * 0.5;
        o.y = cy;
      });
    });
    await ws().flush();
    const review = await ws().promoteLayout(b!.id, 'current');
    expect(review).not.toBeNull();
    expect(review!.gate.causes).toEqual([]);
    expect(review!.gate.ok).toBe(true);
    expect(repo.layouts.get(b!.id)!.state).toBe('current');
    expect(repo.layouts.get(layoutId)!.state).toBe('proposal');
    expect(ws().layouts.find((l) => l.id === layoutId)!.state).toBe('proposal');
  });

  it('exportableProject has no injected locks on venue elements and includes unsaved edits', async () => {
    const {repo, layoutId, venueId} = await openLegacyEvent();
    const venue = repo.venues.get(venueId)!;
    // Precondition: the fountain is a venue element shown locked in layout mode.
    expect(venue.content.infrastructure.find((o) => o.id === 'fountain-qa')!.locked).toBeUndefined();
    expect(liveScene().infrastructure.find((o) => o.id === 'fountain-qa')!.locked).toBe(true);

    ps().updateScene((s) => {
      s.infrastructure.push({
        id: 'unsaved-qa',
        name: 'Mesa',
        kind: 'table',
        role: 'support',
        x: 44,
        y: 52,
        width: 1,
        depth: 1,
      });
    });
    const out = ws().exportableProject();
    expect(repo.layouts.get(layoutId)!.content.infrastructure.some((o) => o.id === 'unsaved-qa')).toBe(false);

    const scene = out.scenes.cristo;
    expect(scene.infrastructure.some((o) => o.id === 'unsaved-qa')).toBe(true);
    for (const o of venue.content.infrastructure) {
      expect(scene.infrastructure.find((x) => x.id === o.id)!.locked).toBe(o.locked);
    }
    for (const b of venue.content.booths) {
      expect(scene.base.booths.find((x) => x.id === b.id)!.locked).toBe(b.locked);
    }
    for (const e of venue.content.entrances) {
      expect(scene.entrances.find((x) => x.id === e.id)!.locked).toBe(e.locked);
    }
    for (const r of [...venue.content.passages, ...venue.content.reserves]) {
      const t = [...scene.passages, ...scene.reserves].find((x) => x.id === r.id)!;
      expect(t.locked).toBe(r.locked);
    }
  });

  it(`refuses to open a layout whose composed list exceeds ${COMPOSED_LIST_LIMIT} elements`, async () => {
    const {repo, layoutId, venueId} = await openLegacyEvent();
    const blank = await ws().createLayout({kind: 'blank', name: 'Grande'});
    await ws().flush();
    const venueBooths = repo.venues.get(venueId)!.content.booths.length;
    const booths = (n: number): BoothItem[] =>
      Array.from({length: n}, (_, i) => ({
        id: 'big-' + i,
        name: 'Puesto ' + i,
        type: 'stall',
        x: 35 + (i % 20),
        y: 40 + Math.floor(i / 20) * 0.5,
        width: 1,
        depth: 1,
      }));

    const over = structuredClone(repo.layouts.get(blank!.id)!);
    over.content.booths = booths(COMPOSED_LIST_LIMIT - venueBooths + 1);
    await repo.putLayouts([over]);
    await reinit(repo);
    expect(ws().activeLayoutIds.cristo).toBe(layoutId);
    expect(await ws().openLayout(blank!.id)).toBe(false);
    expect(ws().activeLayoutIds.cristo).toBe(layoutId);

    // Exactly at the limit it opens.
    over.content.booths = booths(COMPOSED_LIST_LIMIT - venueBooths);
    await repo.putLayouts([over]);
    await reinit(repo);
    expect(await ws().openLayout(blank!.id)).toBe(true);
    expect(liveScene().base.booths).toHaveLength(COMPOSED_LIST_LIMIT);
  });
});
