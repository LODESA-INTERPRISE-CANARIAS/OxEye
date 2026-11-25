import {describe, expect, it} from 'vitest';
import {createDefaultProject} from '../../src/db/repository';
import {ensureEventLayouts, venueDisplayName, venueIdentity} from '../../src/db/workspace-migration';
import {MemoryWorkspaceRepository} from '../../src/db/workspace-repository';
import {splitLegacyScene} from '../../src/engine/workspace/venue-layout';
import type {BoothItem, InfrastructureItem, ProjectFile} from '../../src/types';
import type {Venue} from '../../src/types/venue';
import type {WorkspaceEvent} from '../../src/types/workspace';

const T = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';

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
const KIOSK: BoothItem = {
  id: 'kiosk-qa',
  name: 'Quiosco fijo',
  type: 'kiosk',
  x: 50,
  y: 55,
  width: 2,
  depth: 2,
  permanent: true,
};

/**
 * The default project generates some ids with `crypto.randomUUID()` (response
 * example), so it is built once and cloned: "identical content" means the same
 * payload stored for several events.
 */
const BASE_PROJECT = createDefaultProject();

/**
 * Legacy (pre-OX-04) payload: the Plaza del Cristo preset with its reference
 * perimeter, plus a permanent fountain and kiosk and a Carpa Amarilla. Only the
 * active slot has a perimeter, so the event uses a single venue.
 */
function legacyPayload(opts: {perimeter?: boolean} = {}): ProjectFile {
  const p = structuredClone(BASE_PROJECT);
  p.scenes.constitucion.boundary = [];
  p.scenes.vega.boundary = [];
  const s = p.scenes.cristo;
  s.infrastructure.push(structuredClone(YELLOW_TENT), structuredClone(FOUNTAIN));
  s.base.booths.push(structuredClone(KIOSK));
  if (opts.perimeter === false) s.boundary = [];
  return p;
}

function event(id: string, orgId = 'org-a'): WorkspaceEvent {
  return {id, orgId, projectId: 'p-' + orgId, name: id, createdAt: T, updatedAt: T};
}

describe('ensureEventLayouts · legacy migration (OX-04 D15)', () => {
  it('splits a legacy event into one venue and one current layout covering every phase', async () => {
    const repo = new MemoryWorkspaceRepository();
    const payload = legacyPayload();
    const scene = payload.scenes.cristo;
    expect(scene.boundary.length).toBeGreaterThanOrEqual(3);
    expect(scene.entrances.length).toBeGreaterThan(0);

    const r = await ensureEventLayouts(repo, event('ev-1'), payload, {now: T});
    expect(r.created).toBe(true);
    expect(r.venues).toHaveLength(1);
    expect(r.layouts).toHaveLength(1);
    expect(repo.venues.size).toBe(1);
    expect(repo.layouts.size).toBe(1);

    const [venue] = r.venues;
    const [layout] = r.layouts;
    expect(venue).toMatchObject({orgId: 'org-a', site: 'cristo', version: 1});
    expect(venue.name).toBe(venueDisplayName('cristo', payload.maps.cristo));
    expect(venue.map).toEqual(payload.maps.cristo);
    expect(venue.content.boundary).toEqual(scene.boundary);
    expect(layout).toMatchObject({
      orgId: 'org-a',
      eventId: 'ev-1',
      venueId: venue.id,
      site: 'cristo',
      state: 'current',
      version: 1,
      baseVenueVersion: venue.version,
      accessOverrides: {},
    });
    expect([...layout.phases].sort()).toEqual(['event', 'post', 'pre']);

    // Entrances and permanent items in the venue; everything else in the layout.
    expect(venue.content.entrances.map((e) => e.id)).toEqual(scene.entrances.map((e) => e.id));
    expect(venue.content.infrastructure.map((o) => o.id)).toEqual(['fountain-qa']);
    expect(venue.content.booths.map((b) => b.id)).toEqual(['kiosk-qa']);
    expect(layout.content.entrances).toEqual([]);
    expect(layout.content.infrastructure.map((o) => o.id)).toEqual(
      scene.infrastructure.filter((o) => !o.permanent).map((o) => o.id)
    );
    expect(layout.content.booths.map((b) => b.id)).toEqual(
      scene.base.booths.filter((b) => !b.permanent).map((b) => b.id)
    );
    expect(layout.content.booths.length).toBeGreaterThan(0);
    // Carpa Amarilla is layout content, copied verbatim (CLAUDE §5.2).
    expect(layout.content.infrastructure.find((o) => o.id === 'yellow-qa')).toEqual(YELLOW_TENT);
    expect(venue.content.infrastructure.some((o) => o.kind === 'yellow_tent')).toBe(false);
  });

  it('is idempotent: a second run creates nothing and keeps the same ids', async () => {
    const repo = new MemoryWorkspaceRepository();
    const ev = event('ev-1');
    const first = await ensureEventLayouts(repo, ev, legacyPayload(), {now: T});
    const venuesBefore = structuredClone([...repo.venues.values()]);
    const layoutsBefore = structuredClone([...repo.layouts.values()]);

    const second = await ensureEventLayouts(repo, ev, legacyPayload(), {now: T2});
    expect(second.created).toBe(false);
    expect(second.venues.map((v) => v.id)).toEqual(first.venues.map((v) => v.id));
    expect(second.layouts.map((l) => l.id)).toEqual(first.layouts.map((l) => l.id));
    expect(repo.venues.size).toBe(1);
    expect(repo.layouts.size).toBe(1);
    expect([...repo.venues.values()]).toEqual(venuesBefore);
    expect([...repo.layouts.values()]).toEqual(layoutsBefore);
  });

  it('shares identical venues with a perimeter within one organization only', async () => {
    const repo = new MemoryWorkspaceRepository();
    const a1 = await ensureEventLayouts(repo, event('ev-1'), legacyPayload(), {now: T});
    const a2 = await ensureEventLayouts(repo, event('ev-2'), legacyPayload(), {now: T});
    expect(a2.created).toBe(true);
    expect(a2.venues[0].id).toBe(a1.venues[0].id);
    expect(a2.layouts[0].id).not.toBe(a1.layouts[0].id);
    expect(repo.venues.size).toBe(1);
    expect(repo.layouts.size).toBe(2);

    // Another organization never reuses it.
    const b = await ensureEventLayouts(repo, event('ev-3', 'org-b'), legacyPayload(), {now: T});
    expect(b.venues[0].id).not.toBe(a1.venues[0].id);
    expect(b.venues[0].orgId).toBe('org-b');
    expect(repo.venues.size).toBe(2);

    // `shareVenue: false` (new events) always creates the event's own venue.
    const own = await ensureEventLayouts(repo, event('ev-4'), legacyPayload(), {
      now: T,
      shareVenue: false,
    });
    expect(own.venues[0].id).not.toBe(a1.venues[0].id);
    expect(repo.venues.size).toBe(3);
  });

  it('never shares a venue whose content has no perimeter', async () => {
    const repo = new MemoryWorkspaceRepository();
    const x = await ensureEventLayouts(repo, event('ev-1'), legacyPayload({perimeter: false}), {now: T});
    const y = await ensureEventLayouts(repo, event('ev-2'), legacyPayload({perimeter: false}), {now: T});
    expect(x.venues[0].content.boundary).toEqual([]);
    expect(y.venues[0].id).not.toBe(x.venues[0].id);
    expect(repo.venues.size).toBe(2);
    // Same content, different venue records.
    expect(venueIdentity('cristo', y.venues[0].map, y.venues[0].content)).toBe(
      venueIdentity('cristo', x.venues[0].map, x.venues[0].content)
    );
  });

  it('gives a third identical legacy event its own venue once the shared one was modified', async () => {
    const repo = new MemoryWorkspaceRepository();
    const a1 = await ensureEventLayouts(repo, event('ev-1'), legacyPayload(), {now: T});
    await ensureEventLayouts(repo, event('ev-2'), legacyPayload(), {now: T});
    const shared = repo.venues.get(a1.venues[0].id)!;
    const modified: Venue = {
      ...shared,
      version: 2,
      content: {
        ...shared.content,
        entrances: [...shared.content.entrances, {id: 'gate-new', name: 'Acceso nuevo', x: 30, y: 30}],
      },
      updatedAt: T2,
    };
    await repo.putVenue(modified);

    const c = await ensureEventLayouts(repo, event('ev-3'), legacyPayload(), {now: T2});
    expect(c.created).toBe(true);
    expect(c.venues[0].id).not.toBe(shared.id);
    expect(c.venues[0].version).toBe(1);
    expect(c.venues[0].content).toEqual(splitLegacyScene(legacyPayload().scenes.cristo).venue);
    expect(c.layouts[0].venueId).toBe(c.venues[0].id);
    expect(c.layouts[0].baseVenueVersion).toBe(1);
    // The modified shared venue is untouched.
    expect(repo.venues.get(shared.id)).toEqual(modified);
    expect(repo.venues.size).toBe(2);
  });

  it('assigns a saved venue with `useVenue` and honours `initialState: draft`', async () => {
    const repo = new MemoryWorkspaceRepository();
    const a = await ensureEventLayouts(repo, event('ev-1'), legacyPayload(), {now: T});
    const saved: Venue = {...repo.venues.get(a.venues[0].id)!, version: 3};
    await repo.putVenue(saved);

    // A new event drawn without perimeter, entrances or items (wizard).
    const fresh = legacyPayload({perimeter: false});
    fresh.scenes.cristo.entrances = [];
    const r = await ensureEventLayouts(repo, event('ev-new'), fresh, {
      now: T2,
      useVenue: {cristo: saved},
      initialState: 'draft',
      shareVenue: false,
    });
    expect(r.venues.map((v) => v.id)).toEqual([saved.id]);
    expect(r.layouts).toHaveLength(1);
    expect(r.layouts[0]).toMatchObject({
      eventId: 'ev-new',
      venueId: saved.id,
      state: 'draft',
      version: 1,
      baseVenueVersion: 3,
    });
    expect(repo.venues.size).toBe(1);
    expect(repo.venues.get(saved.id)).toEqual(saved);
  });
});
