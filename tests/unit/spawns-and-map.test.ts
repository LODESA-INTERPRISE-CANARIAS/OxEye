import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {
  buildCustomMapMetadata,
  classifyOsmHighway,
  computeMapTiles,
  DEFAULT_MAP_CENTER,
  latLonToLocalMeters,
  localMetersToLatLon,
  parseOsmVectorElements,
} from '../../src/engine/cartography/custom-map';
import {
  generateCoherentSpawns,
  normalizeAccessFlows,
  snapEntranceToPerimeter,
  snapPointToPerimeter,
} from '../../src/engine/cartography/spawns';
import {EventEngine} from '../../src/engine/crowd/event-engine';
import {
  configure,
  initialScene,
  validateScene,
} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {addResponseExample} from '../../src/engine/emergency/response-example';
import {assessRisk} from '../../src/engine/emergency/risk';
import {createDefaultProject, parseImportedProject} from '../../src/db/repository';
import type {Point2D} from '../../src/types';

describe('Custom Real-Map Location & Square Projection', () => {
  it('round-trips WGS84 and local square meters centered at (size/2, size/2)', () => {
    const {lat, lon} = DEFAULT_MAP_CENTER;
    const size = 400;
    const centerLocal = latLonToLocalMeters(lat, lon, lat, lon, size);
    expect(centerLocal[0]).toBeCloseTo(200, 4);
    expect(centerLocal[1]).toBeCloseTo(200, 4);

    const northEast = localMetersToLatLon(320, 80, lat, lon, size);
    expect(northEast.lat).toBeGreaterThan(lat);
    expect(northEast.lon).toBeGreaterThan(lon);

    const back = latLonToLocalMeters(northEast.lat, northEast.lon, lat, lon, size);
    expect(back[0]).toBeCloseTo(320, 3);
    expect(back[1]).toBeCloseTo(80, 3);
  });

  it('builds custom MapMetadata and stitched map tiles covering the operational square', () => {
    const map = buildCustomMapMetadata({
      lat: 28.4682,
      lon: -16.2546,
      label: 'Plaza de España, Santa Cruz',
      sizeMeters: 350,
    });
    expect(map.widthMeters).toBe(350);
    expect(map.heightMeters).toBe(350);
    expect(map.bbox[2] - map.bbox[0]).toBe(350);
    expect(map.bbox[3] - map.bbox[1]).toBe(350);
    expect(map.customLocation?.label).toContain('Plaza de España');

    const planTiles = computeMapTiles(28.4682, -16.2546, 350, 'plan');
    const orthoTiles = computeMapTiles(28.4682, -16.2546, 350, 'ortho');
    const orthoSmallTiles = computeMapTiles(28.4682, -16.2546, 200, 'ortho');
    const orthoForeignTiles = computeMapTiles(48.8566, 2.3522, 350, 'ortho');
    expect(planTiles.length).toBeGreaterThanOrEqual(4);
    expect(planTiles[0].url).toContain('tile.openstreetmap.org');
    // En España usa ortofoto PNOA–IGN de alta resolución (z=19 para 350 m, z=20 para ≤250 m)
    expect(orthoTiles[0].url).toContain('ign.es/wmts/pnoa-ma');
    expect(orthoTiles[0].z).toBe(19);
    expect(orthoSmallTiles[0].z).toBe(20);
    // Fuera de España usa Esri World Imagery a z=19
    expect(orthoForeignTiles[0].url).toContain('World_Imagery');
    expect(orthoForeignTiles[0].z).toBe(19);
    // Tiles must cover [0, 350] horizontally and vertically
    const minX = Math.min(...planTiles.map((t) => t.x));
    const maxX = Math.max(...planTiles.map((t) => t.x + t.width));
    const minY = Math.min(...planTiles.map((t) => t.y));
    const maxY = Math.max(...planTiles.map((t) => t.y + t.height));
    expect(minX).toBeLessThanOrEqual(0.5);
    expect(maxX).toBeGreaterThanOrEqual(349.5);
    expect(minY).toBeLessThanOrEqual(0.5);
    expect(maxY).toBeGreaterThanOrEqual(349.5);
  });

  it('classifies OSM highway types cleanly into pedestrian and vehicle', () => {
    expect(classifyOsmHighway('footway')).toBe('pedestrian');
    expect(classifyOsmHighway('pedestrian')).toBe('pedestrian');
    expect(classifyOsmHighway('residential')).toBe('vehicle');
    expect(classifyOsmHighway('secondary')).toBe('vehicle');
    expect(classifyOsmHighway('unknown_tag')).toBeNull();
  });

  it('parses raw OSM v0.6 elements into clean vector features and streets while filtering out POI noise', () => {
    const parsed = parseOsmVectorElements(
      [
        {type: 'node', id: 1, lat: 28.4647, lon: -16.2875, tags: {shop: 'supermarket'}},
        {type: 'node', id: 2, lat: 28.4647, lon: -16.2863, tags: {highway: 'bus_stop'}},
        {type: 'node', id: 3, lat: 28.4651, lon: -16.2872},
        {type: 'node', id: 4, lat: 28.4651, lon: -16.2867},
        {type: 'node', id: 5, lat: 28.4648, lon: -16.2867},
        {type: 'node', id: 6, lat: 28.4648, lon: -16.2872},
        {
          type: 'way',
          id: 100,
          nodes: [1, 2],
          tags: {highway: 'secondary', name: 'Avenida de los Menceyes', lit: 'yes'},
        },
        {
          type: 'way',
          id: 101,
          nodes: [3, 4, 5, 6, 3],
          tags: {building: 'yes', shop: 'bakery', name: 'Panadería Ruido'},
        },
        {
          type: 'way',
          id: 102,
          nodes: [3, 4, 5, 6, 3],
          tags: {amenity: 'parking', barrier: 'fence'},
        },
      ],
      28.4647,
      -16.2869,
      400
    );
    expect(parsed.features.length).toBe(2);
    expect(parsed.streets.length).toBe(1);
    expect(parsed.streets[0].name).toBe('Avenida de los Menceyes');
    expect(parsed.streets[0].kind).toBe('vehicle');
    // Commercial shop tags must be stripped out
    const bldg = parsed.features.find((f) => f.tags.building === 'yes');
    expect(bldg).toBeDefined();
    expect(bldg?.tags.shop).toBeUndefined();
  });

  it('persists and imports custom-location projects cleanly', () => {
    const proj = createDefaultProject();
    const customMap = buildCustomMapMetadata({
      lat: 28.4682,
      lon: -16.2546,
      label: 'Plaza de España',
      sizeMeters: 400,
    });
    proj.maps.cristo = customMap;
    const imported = parseImportedProject(JSON.stringify(proj), proj, MAPS_DATA);
    expect(imported.maps.cristo.customLocation?.label).toBe('Plaza de España');
    expect(imported.maps.cristo.widthMeters).toBe(400);
  });
});

describe('Coherent Spawns & Per-Access Flow Distribution', () => {
  it('generates both pedestrian and vehicle spawns from real OSM streets intersecting the perimeter', () => {
    const customMap = buildCustomMapMetadata({
      lat: 28.4682,
      lon: -16.2546,
      label: 'Escenario Urbano',
      sizeMeters: 400,
      streets: [
        {
          name: 'Paseo Peatonal Central',
          highway: 'pedestrian',
          kind: 'pedestrian',
          points: [
            [80, 200],
            [320, 200],
          ],
        },
        {
          name: 'Avenida Circunvalación',
          highway: 'secondary',
          kind: 'vehicle',
          points: [
            [200, 80],
            [200, 320],
          ],
        },
      ],
    });
    const boundaryPct: Point2D[] = [
      [30, 30],
      [70, 30],
      [70, 70],
      [30, 70],
    ];
    const spawns = generateCoherentSpawns(boundaryPct, customMap);
    expect(spawns.length).toBeGreaterThanOrEqual(3);
    expect(spawns.some((s) => s.spawnType === 'pedestrian')).toBe(true);
    expect(spawns.some((s) => s.spawnType === 'vehicle')).toBe(true);
    expect(
      spawns.some((s) => s.streetName === 'Paseo Peatonal Central')
    ).toBe(true);
    expect(
      spawns.some((s) => s.streetName === 'Avenida Circunvalación')
    ).toBe(true);
  });

  it('generates coherent pedestrian and vehicle spawns for Plaza del Cristo using CARTO_DATA', () => {
    configure(MAPS_DATA);
    const scene = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const spawns = generateCoherentSpawns(
      scene.boundary,
      MAPS_DATA.cristo,
      CARTO_DATA
    );
    expect(spawns.length).toBeGreaterThanOrEqual(3);
    expect(spawns.some((s) => s.spawnType === 'pedestrian')).toBe(true);
    expect(spawns.some((s) => s.spawnType === 'vehicle')).toBe(true);
  });

  it('normalizes entry/exit percentages, hourly volume caps, and frequencies', () => {
    const metrics = normalizeAccessFlows(
      [
        {
          id: 'g1',
          name: 'Acceso Norte',
          x: 50,
          y: 30,
          role: 'both',
          phases: {event: 'both'},
          spawnType: 'pedestrian',
          entryWeight: 75,
          exitWeight: 25,
          maxRatePerHour: 200,
        },
        {
          id: 'g2',
          name: 'Acceso Sur',
          x: 50,
          y: 70,
          role: 'both',
          phases: {event: 'both'},
          spawnType: 'pedestrian',
          entryWeight: 25,
          exitWeight: 75,
          maxRatePerHour: 0,
        },
      ],
      400
    );
    expect(metrics[0].entrySharePct).toBeCloseTo(75, 2);
    expect(metrics[1].entrySharePct).toBeCloseTo(25, 2);
    expect(metrics[0].exitSharePct).toBeCloseTo(25, 2);
    expect(metrics[1].exitSharePct).toBeCloseTo(75, 2);
    // 75% of 400 = 300 pers/h, capped at 200 pers/h
    expect(metrics[0].rawArrivalsPerHour).toBeCloseTo(300, 1);
    expect(metrics[0].effectiveArrivalsPerHour).toBeCloseTo(200, 1);
    expect(metrics[0].isCapped).toBe(true);
    expect(metrics[0].frequencySec).toBeCloseTo(18, 1);
    expect(metrics[1].effectiveArrivalsPerHour).toBeCloseTo(100, 1);
    expect(metrics[1].frequencySec).toBeCloseTo(36, 1);
  });

  it('respects entryWeight, maxRatePerHour, and exitWeight inside EventEngine simulation', () => {
    configure(MAPS_DATA);
    const base = addResponseExample(
      smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA))
    );
    expect(base.entrances.length).toBeGreaterThanOrEqual(2);
    const gA = {
      ...base.entrances[0],
      id: 'gate-heavy-in',
      name: 'Acceso Principal',
      role: 'both',
      phases: {event: 'both'},
      spawnType: 'pedestrian' as const,
      entryWeight: 90,
      exitWeight: 10,
      maxRatePerHour: 25,
    };
    const gB = {
      ...base.entrances[1],
      id: 'gate-light-in',
      name: 'Acceso Secundario',
      role: 'both',
      phases: {event: 'both'},
      spawnType: 'pedestrian' as const,
      entryWeight: 10,
      exitWeight: 90,
      maxRatePerHour: 0,
    };
    base.entrances = [gA, gB];
    validateScene(base);

    const engine = new EventEngine(base);
    for (let i = 0; i < 60; i++) {
      engine.spawn();
    }
    const summary = engine.accessFlowSummary();
    const statA = summary.find((r) => r.id === 'gate-heavy-in')!;
    const statB = summary.find((r) => r.id === 'gate-light-in')!;
    // gA must never exceed its hourly cap of 25 arrivals in hour 0
    expect(statA.arrivals).toBeLessThanOrEqual(25);
    expect(statA.arrivals).toBeGreaterThan(0);
    // Overflow & weighted traffic enters via gB
    expect(statB.arrivals).toBeGreaterThan(0);

    // Weighted exits: trigger exits for all agents and verify gB (exitWeight 90) receives majority
    for (const ag of engine.agents) {
      engine.exit(ag);
    }
    const postExit = engine.accessFlowSummary();
    const exitsA = postExit.find((r) => r.id === 'gate-heavy-in')!.exits;
    const exitsB = postExit.find((r) => r.id === 'gate-light-in')!.exits;
    expect(exitsB).toBeGreaterThan(exitsA);
  });

  it('clips entrances strictly to perimeter edges and orients inward normals accurately on all 4 sides', () => {
    const map = buildCustomMapMetadata({
      lat: 28.4903,
      lon: -16.3133,
      label: 'Cuadrado prueba',
      sizeMeters: 200,
    });
    // Square perimeter from 20%..80% (40m..160m)
    const sceneStub = {
      boundary: [
        [20, 20],
        [80, 20],
        [80, 80],
        [20, 80],
      ] as Point2D[],
      passages: [],
    };

    // Top edge (y=40m): inward must point DOWN (+y)
    const topSnap = snapPointToPerimeter([100, 35], sceneStub, map)!;
    expect(topSnap.point[1]).toBeCloseTo(40, 2);
    expect(topSnap.inwardNormal[0]).toBeCloseTo(0, 3);
    expect(topSnap.inwardNormal[1]).toBeCloseTo(1, 3);
    const topRad = (topSnap.gateAngle * Math.PI) / 180;
    expect(-Math.sin(topRad)).toBeCloseTo(topSnap.inwardNormal[0], 2);
    expect(Math.cos(topRad)).toBeCloseTo(topSnap.inwardNormal[1], 2);

    // Right edge (x=160m): inward must point LEFT (-x)
    const rightSnap = snapPointToPerimeter([168, 100], sceneStub, map)!;
    expect(rightSnap.point[0]).toBeCloseTo(160, 2);
    expect(rightSnap.inwardNormal[0]).toBeCloseTo(-1, 3);
    expect(rightSnap.inwardNormal[1]).toBeCloseTo(0, 3);

    // Bottom edge (y=160m): inward must point UP (-y)
    const bottomSnap = snapPointToPerimeter([100, 170], sceneStub, map)!;
    expect(bottomSnap.point[1]).toBeCloseTo(160, 2);
    expect(bottomSnap.inwardNormal[0]).toBeCloseTo(0, 3);
    expect(bottomSnap.inwardNormal[1]).toBeCloseTo(-1, 3);

    // Left edge (x=40m): inward must point RIGHT (+x)
    const leftSnap = snapPointToPerimeter([32, 100], sceneStub, map)!;
    expect(leftSnap.point[0]).toBeCloseTo(40, 2);
    expect(leftSnap.inwardNormal[0]).toBeCloseTo(1, 3);
    expect(leftSnap.inwardNormal[1]).toBeCloseTo(0, 3);

    // snapEntranceToPerimeter pulls a detached entrance onto the nearest edge
    const clipped = snapEntranceToPerimeter(
      {id: 'g-float', name: 'Acceso', x: 50, y: 15, role: 'in'},
      sceneStub,
      map
    );
    expect(clipped.y).toBeCloseTo(20, 2);
    expect(clipped.gateAngle).toBeCloseTo(topSnap.gateAngle, 1);
  });

  it('flags missing perimeter cleanly in assessRisk without throwing', () => {
    configure(MAPS_DATA);
    const s = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    s.boundary = [];
    const report = assessRisk(s);
    expect(report.critical.some((c) => c.id === 'boundary')).toBe(true);
  });
});
