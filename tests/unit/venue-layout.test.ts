import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {configure, initialScene} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import type {RiskIssue} from '../../src/engine/emergency/risk';
import {
  affectedLayouts,
  blankLayout,
  composeScene,
  duplicateLayout,
  evaluatePromotionGate,
  setLayoutState,
  splitLegacyScene,
  splitScene,
} from '../../src/engine/workspace/venue-layout';
import type {InfrastructureItem, Scene} from '../../src/types';
import type {Layout, Venue} from '../../src/types/venue';

const NOW = '2026-11-25T10:00:00.000Z';

function baseScene(): Scene {
  configure(MAPS_DATA);
  const s = smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA));
  s.boundary = [
    [5, 5],
    [95, 5],
    [95, 95],
    [5, 95],
  ];
  const tent: InfrastructureItem = {
    id: 'yellow-1',
    name: 'Carpa Amarilla',
    kind: 'yellow_tent',
    role: 'support',
    x: 40,
    y: 40,
    width: 3,
    depth: 3,
    rotation: 0,
  };
  const fountain: InfrastructureItem = {
    id: 'fountain-1',
    name: 'Fuente',
    kind: 'fountain',
    role: 'fixed',
    x: 50,
    y: 50,
    width: 2,
    depth: 2,
    permanent: true,
  };
  s.infrastructure.push(tent, fountain);
  s.reserves.push({
    id: 'restricted-venue',
    name: 'Zona restringida',
    origin: 'subperimeter',
    points: [
      [10, 10],
      [20, 10],
      [20, 20],
    ],
  });
  s.demandConfig = {marker: 'demand'} as unknown as Scene['demandConfig'];
  s.safetyLock = {fingerprint: 'abc', at: NOW};
  return s;
}

function records(scene: Scene): {venue: Venue; layout: Layout} {
  const split = splitLegacyScene(scene);
  const venue: Venue = {
    id: 'venue-1',
    orgId: 'org',
    name: 'Plaza del Cristo',
    site: 'cristo',
    version: 1,
    map: MAPS_DATA.cristo,
    content: split.venue,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const layout: Layout = {
    ...blankLayout({id: 'layout-1', orgId: 'org', eventId: 'ev', venue, name: 'A', now: NOW}),
    content: split.layout,
    safety: split.safety,
    state: 'current',
  };
  return {venue, layout};
}

const byId = <T extends {id?: string}>(list: T[]) =>
  [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));

describe('venue / layout composition (OX-04)', () => {
  it('splits a legacy scene and composes it back without losing elements', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    expect(venue.content.entrances.length).toBe(scene.entrances.length);
    expect(venue.content.infrastructure.map((o) => o.id)).toEqual(['fountain-1']);
    expect(venue.content.reserves.some((r) => r.id === 'restricted-venue')).toBe(true);
    expect(layout.content.infrastructure.some((o) => o.kind === 'yellow_tent')).toBe(true);

    const composed = composeScene(scene, venue, layout, 'plain');
    expect(byId(composed.infrastructure)).toEqual(byId(scene.infrastructure));
    expect(byId(composed.base.booths)).toEqual(byId(scene.base.booths));
    expect(byId(composed.entrances)).toEqual(byId(scene.entrances));
    expect(composed.boundary).toEqual(scene.boundary);
    expect(composed.reserves.map((r) => r.name).sort()).toEqual(
      scene.reserves.map((r) => r.name).sort()
    );
    // Event-level demand stays the single source (CLAUDE §5.5).
    expect(composed.demandConfig).toEqual(scene.demandConfig);
  });

  it('keeps identity, position, rotation and dimensions of a moved tent (VAL-MAP-CORE-001)', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const composed = composeScene(scene, venue, layout, 'layout');
    const tent = composed.infrastructure.find((o) => o.id === 'yellow-1')!;
    tent.rotation = 90;
    tent.x += 4;
    const split = splitScene(composed, venue, layout, 'layout');
    const nextLayout = {...layout, content: split.layout, accessOverrides: split.accessOverrides};
    const reopened = composeScene(scene, venue, nextLayout, 'layout');
    const again = reopened.infrastructure.find((o) => o.id === 'yellow-1')!;
    expect(again).toMatchObject({id: 'yellow-1', x: 44, y: 40, rotation: 90, width: 3, depth: 3});
    expect(again.locked).toBeUndefined();
  });

  it('never changes the venue while editing a layout', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const composed = composeScene(scene, venue, layout, 'layout');
    // Venue elements are shown locked in layout mode.
    expect(composed.infrastructure.find((o) => o.id === 'fountain-1')!.locked).toBe(true);
    composed.infrastructure.find((o) => o.id === 'fountain-1')!.x = 1;
    composed.boundary = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const split = splitScene(composed, venue, layout, 'layout');
    expect(split.venue).toEqual(venue.content);
    expect(split.layout.infrastructure.some((o) => o.id === 'fountain-1')).toBe(false);
  });

  it('stores access operation per layout and physical data in the venue', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const gateId = venue.content.entrances[0].id;
    const composed = composeScene(scene, venue, layout, 'layout');
    composed.entrances.find((e) => e.id === gateId)!.role = 'closed';
    const split = splitScene(composed, venue, layout, 'layout');
    expect(split.accessOverrides[gateId]).toEqual({role: 'closed'});
    expect(split.venue.entrances.find((e) => e.id === gateId)!.role).not.toBe('closed');

    const next = {...layout, content: split.layout, accessOverrides: split.accessOverrides};
    expect(composeScene(scene, venue, next, 'layout').entrances.find((e) => e.id === gateId)!.role).toBe(
      'closed'
    );
    // «Editar recinto» shows the venue's own operation.
    expect(composeScene(scene, venue, next, 'venue').entrances.find((e) => e.id === gateId)!.role).not.toBe(
      'closed'
    );
  });

  it('puts a new access drawn in venue mode in the venue, leaving the layout untouched', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const composed = composeScene(scene, venue, layout, 'venue');
    expect(composed.infrastructure.find((o) => o.id === 'yellow-1')!.locked).toBe(true);
    composed.entrances.push({id: 'gate-new', name: 'Acceso nuevo', x: 5, y: 50});
    const split = splitScene(composed, venue, layout, 'venue');
    expect(split.venue.entrances.some((e) => e.id === 'gate-new')).toBe(true);
    expect(split.layout).toEqual(layout.content);
    // Injected locks never reach the stored layout.
    expect(split.layout.infrastructure.find((o) => o.id === 'yellow-1')!.locked).toBeUndefined();
  });

  it('assigns restricted zones to the venue or the layout by edit mode', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const zone = {
      name: 'Backstage',
      origin: 'subperimeter',
      points: [
        [60, 60],
        [70, 60],
        [70, 70],
      ] as [number, number][],
    };
    const inLayout = composeScene(scene, venue, layout, 'layout');
    inLayout.reserves.push({...zone});
    const a = splitScene(inLayout, venue, layout, 'layout');
    expect(a.layout.reserves.some((r) => r.name === 'Backstage')).toBe(true);
    expect(a.venue.reserves.some((r) => r.name === 'Backstage')).toBe(false);

    const inVenue = composeScene(scene, venue, layout, 'venue');
    inVenue.reserves.push({...zone});
    const b = splitScene(inVenue, venue, layout, 'venue');
    expect(b.venue.reserves.some((r) => r.name === 'Backstage')).toBe(true);
    expect(b.layout.reserves.some((r) => r.name === 'Backstage')).toBe(false);
  });

  it('keeps team-drawn exclusion zones in the layout on migration', () => {
    const scene = baseScene();
    scene.reserves.push({
      id: 'excl-1',
      name: 'Zona excluida',
      origin: 'Dibujada por el equipo',
      points: [
        [30, 30],
        [35, 30],
        [35, 35],
      ],
    });
    const {venue, layout} = records(scene);
    expect(layout.content.reserves.some((r) => r.id === 'excl-1')).toBe(true);
    expect(venue.content.reserves.some((r) => r.id === 'excl-1')).toBe(false);
  });

  it('never injects locks into the subsoil (safety fingerprint stays stable)', () => {
    const scene = baseScene();
    scene.subsoil = {
      polygons: [{id: 'p1', op: 'add', points: [[1, 1], [9, 1], [9, 9]]}],
      columns: [],
      walls: [],
    };
    const {venue, layout} = records(scene);
    expect(composeScene(scene, venue, layout, 'layout').subsoil).toEqual(scene.subsoil);
  });

  it('stores a pasted copy of a permanent venue item as an ordinary layout item', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const composed = composeScene(scene, venue, layout, 'layout');
    const source = composed.infrastructure.find((o) => o.id === 'fountain-1')!;
    composed.infrastructure.push({...source, id: 'fountain-copy', x: 60});
    const split = splitScene(composed, venue, layout, 'layout');
    const copy = split.layout.infrastructure.find((o) => o.id === 'fountain-copy')!;
    expect(copy.permanent).toBeUndefined();
    expect(copy.locked).toBeUndefined();
    expect(split.venue).toEqual(venue.content);
  });

  it('lets the first perimeter of a venue be drawn from the layout', () => {
    const scene = baseScene();
    scene.boundary = [];
    const {venue, layout} = records(scene);
    const composed = composeScene(scene, venue, layout, 'layout');
    composed.boundary = [
      [1, 1],
      [9, 1],
      [9, 9],
    ];
    expect(splitScene(composed, venue, layout, 'layout').venue.boundary).toHaveLength(3);
  });

  it('stores accesses generated with the first perimeter in the venue, replacing the old ones', () => {
    const scene = baseScene();
    scene.boundary = [];
    const {venue, layout} = records(scene);
    const composed = composeScene(scene, venue, layout, 'layout');
    // Venue still being set up: its accesses are not locked.
    expect(composed.entrances.map((e) => e.locked)).toEqual(
      venue.content.entrances.map((e) => e.locked)
    );
    composed.boundary = [
      [1, 1],
      [9, 1],
      [9, 9],
    ];
    composed.entrances = [{id: 'generated-1', name: 'Acceso generado', x: 1, y: 5}];
    const split = splitScene(composed, venue, layout, 'layout');
    expect(split.venue.entrances.map((e) => e.id)).toEqual(['generated-1']);
    expect(split.layout.entrances).toEqual([]);
    expect(split.accessOverrides).toEqual({});
  });

  it('duplicates a layout with new ids, origins, remapped references and no safety review', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const roof = layout.content.infrastructure.find((o) => o.coverGroup === undefined)!;
    const ballast: InfrastructureItem = {
      id: 'ballast-1',
      name: 'Lastre',
      kind: 'ballast',
      role: 'fixed',
      x: 1,
      y: 1,
      width: 1,
      depth: 1,
      attachedCoverId: roof.id,
      homeBaseId: venue.content.entrances[0].id,
    };
    layout.content.infrastructure.push(ballast);
    layout.content.groups = [{id: 'g1', memberIds: [roof.id, 'ballast-1']}];
    let n = 0;
    const copy = duplicateLayout(layout, {id: 'layout-2', name: 'B', now: NOW, newId: () => 'n' + ++n});
    expect(copy).toMatchObject({id: 'layout-2', state: 'draft', version: 1, originLayoutId: 'layout-1'});
    expect(copy.safety).toEqual({});
    const oldIds = new Set(layout.content.infrastructure.map((o) => o.id));
    expect(copy.content.infrastructure.every((o) => !oldIds.has(o.id))).toBe(true);
    const newBallast = copy.content.infrastructure.find((o) => copy.originItemIds![o.id] === 'ballast-1')!;
    expect(copy.originItemIds![newBallast.attachedCoverId!]).toBe(roof.id);
    expect(newBallast.homeBaseId).toBe(venue.content.entrances[0].id);
    expect(copy.content.groups![0].memberIds.map((m) => copy.originItemIds![m])).toEqual([
      roof.id,
      'ballast-1',
    ]);
    // Same positions, rotations and dimensions.
    expect(newBallast).toMatchObject({x: 1, y: 1, width: 1, depth: 1});
    // The source layout is not modified.
    expect(layout.content.infrastructure.find((o) => o.id === 'ballast-1')).toBeDefined();
  });

  it('keeps one current layout per event, venue and phase', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const other = blankLayout({
      id: 'layout-2',
      orgId: 'org',
      eventId: 'ev',
      venue,
      name: 'B',
      now: NOW,
      phases: ['event'],
    });
    const unrelated = {
      ...blankLayout({id: 'layout-3', orgId: 'org', eventId: 'ev', venue, name: 'C', now: NOW, phases: ['post']}),
      state: 'current' as const,
    };
    const changed = setLayoutState([{...layout, phases: ['pre', 'event']}, other, unrelated], 'layout-2', 'current', NOW);
    expect(changed.find((l) => l.id === 'layout-1')!.state).toBe('proposal');
    expect(changed.find((l) => l.id === 'layout-2')!.state).toBe('current');
    expect(changed.some((l) => l.id === 'layout-3')).toBe(false);
  });

  it('lists layouts evaluated against an older venue version', () => {
    const scene = baseScene();
    const {venue, layout} = records(scene);
    const archived = {...layout, id: 'old', state: 'archived' as const};
    const fresh = {...layout, id: 'fresh', baseVenueVersion: 2};
    const v2 = {...venue, version: 2};
    expect(affectedLayouts(v2, [layout, archived, fresh]).map((l) => l.id)).toEqual(['layout-1']);
  });

  it('blocks promotion on perimeter, access, subsoil and medical-route issues only', () => {
    const issue = (id: string, level: RiskIssue['level']): RiskIssue => ({
      id,
      level,
      title: id,
      action: 'a',
    });
    const r = evaluatePromotionGate([
      issue('outside-perimeter-x', 'warning'),
      issue('gate-ambulance', 'critical'),
      issue('subsoil-load-y', 'critical'),
      issue('subsoil-load-z', 'warning'),
      issue('route-stretcher-ambulance', 'critical'),
      issue('pending', 'critical'),
      issue('technical', 'warning'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.causes.map((c) => c.category)).toEqual(['perimeter', 'access', 'subsoil', 'medical']);
    expect(r.otherCritical.map((i) => i.id)).toEqual(['pending']);
    expect(evaluatePromotionGate([issue('technical', 'warning')]).ok).toBe(true);
    // Fire / police approach routes block but are not medical routes A/B/C.
    expect(evaluatePromotionGate([issue('route-fire', 'critical')]).causes[0].category).toBe(
      'response'
    );
    expect(evaluatePromotionGate([issue('route-ambulance', 'critical')]).causes[0].category).toBe(
      'medical'
    );
  });
});
