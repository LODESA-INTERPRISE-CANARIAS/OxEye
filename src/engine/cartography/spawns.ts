/**
 * @module engine/cartography/spawns
 * Generación automática de puntos de aparición (spawns) peatonales y vehiculares
 * coherentes con la infraestructura viaria real (OpenStreetMap), así como cálculo
 * y normalización de porcentajes, frecuencias y volúmenes horarios de tránsito.
 */
import type {
  AuthorityAccessUnit,
  CartoData,
  CustomMapStreet,
  EntranceItem,
  MapMetadata,
  Point2D,
  Scene,
  SpawnKind,
} from '../../types';
import {classifyOsmHighway} from './custom-map';
import {gateMode, inside, localPoint, percent, world} from './geometry';

/** Resultado de acoplar (clip) un punto o acceso al borde más cercano del perímetro operativo. */
export interface PerimeterSnapResult {
  /** Punto acoplado en metros locales `[x, y]`. */
  point: Point2D;
  /** Punto acoplado en porcentaje del plano `[0..100, 0..100]`. */
  percentPoint: Point2D;
  /** Extremo A de la arista del perímetro en metros locales. */
  edgeA: Point2D;
  /** Extremo B de la arista del perímetro en metros locales. */
  edgeB: Point2D;
  /** Longitud de la arista del perímetro en metros. */
  edgeLength: number;
  /** Distancia original desde el punto consultado hasta el borde del perímetro (m). */
  dist: number;
  /**
   * Ángulo de la línea del acceso (grados) orientado de forma coherente para que
   * la normal `+90°` (`[-sin θ, cos θ]`) apunte siempre hacia el INTERIOR del perímetro.
   */
  gateAngle: number;
  /** Vector normal unitario que apunta estrictamente hacia el INTERIOR del perímetro. */
  inwardNormal: Point2D;
}

/**
 * Recopila todos los polígonos válidos del perímetro operativo (`boundary` y ampliaciones
 * `boundary-add`) en coordenadas locales en metros.
 */
export function collectPerimeterPolygons(
  scene: Pick<Scene, 'boundary' | 'passages'>,
  map: MapMetadata
): Point2D[][] {
  const polys: Point2D[][] = [];
  if (scene.boundary && scene.boundary.length >= 3) {
    polys.push(scene.boundary.map((p) => world(p, map)));
  }
  for (const pass of scene.passages || []) {
    if (pass.origin === 'boundary-add' && pass.points && pass.points.length >= 3) {
      polys.push(pass.points.map((p) => world(p, map)));
    }
  }
  return polys;
}

/**
 * Comprueba si un punto en metros locales se encuentra dentro de alguno de los
 * polígonos del perímetro operativo.
 */
export function pointInOperationalPerimeter(
  pointM: Point2D,
  polys: Point2D[][]
): boolean {
  return polys.some((poly) => inside(pointM, poly));
}

/**
 * Determina el vector normal unitario que apunta hacia el INTERIOR del perímetro
 * en un punto situado sobre la arista `edgeA → edgeB`, y devuelve el `gateAngle`
 * (grados) orientado de modo que `[-sin(gateAngle), cos(gateAngle)] === inwardNormal`.
 */
export function resolveInwardNormal(
  pointM: Point2D,
  edgeA: Point2D,
  edgeB: Point2D,
  polys: Point2D[][]
): {gateAngle: number; inwardNormal: Point2D} {
  const dx = edgeB[0] - edgeA[0];
  const dy = edgeB[1] - edgeA[1];
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;

  // n1 corresponde a rotar +90° en coordenadas SVG (+x derecha, +y abajo): [-ty, tx]
  const n1: Point2D = [-ty, tx];
  const n2: Point2D = [ty, -tx];

  let inward: Point2D = n1;
  let resolved = false;
  for (const eps of [0.5, 1.5, 0.15, 3.0]) {
    const in1 = pointInOperationalPerimeter(
      [pointM[0] + n1[0] * eps, pointM[1] + n1[1] * eps],
      polys
    );
    const in2 = pointInOperationalPerimeter(
      [pointM[0] + n2[0] * eps, pointM[1] + n2[1] * eps],
      polys
    );
    if (in1 !== in2) {
      inward = in1 ? n1 : n2;
      resolved = true;
      break;
    }
  }
  if (!resolved && polys.length) {
    // Respaldo: apuntar hacia el centroide del primer polígono
    const poly = polys[0];
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const dot1 = (cx - pointM[0]) * n1[0] + (cy - pointM[1]) * n1[1];
    inward = dot1 >= 0 ? n1 : n2;
  }

  // Si inward === n1 ([-ty, tx]), usamos dirección (tx, ty); si es n2, invertimos (-tx, -ty)
  const useFlipped = inward[0] * n1[0] + inward[1] * n1[1] < 0;
  const angleRad = useFlipped ? Math.atan2(-ty, -tx) : Math.atan2(ty, tx);
  const gateAngle = Math.round(((angleRad * 180) / Math.PI) * 10) / 10;

  return {gateAngle, inwardNormal: inward};
}

/**
 * Acopla (clip) un punto en metros locales al borde más cercano del perímetro operativo
 * y calcula su orientación e interior/exterior. Devuelve `null` si no existe perímetro.
 */
export function snapPointToPerimeter(
  pointM: Point2D,
  scene: Pick<Scene, 'boundary' | 'passages'>,
  map: MapMetadata
): PerimeterSnapResult | null {
  const polys = collectPerimeterPolygons(scene, map);
  if (!polys.length) return null;

  let best: {
    point: Point2D;
    edgeA: Point2D;
    edgeB: Point2D;
    edgeLength: number;
    dist: number;
  } | null = null;

  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (edgeLength < 0.2) continue;
      const proj = projectOnSegment(pointM, a, b);
      if (!best || proj.dist < best.dist) {
        best = {
          point: proj.point,
          edgeA: a,
          edgeB: b,
          edgeLength,
          dist: proj.dist,
        };
      }
    }
  }
  if (!best) return null;

  const {gateAngle, inwardNormal} = resolveInwardNormal(
    best.point,
    best.edgeA,
    best.edgeB,
    polys
  );
  const pct = percent(best.point, map);
  return {
    point: best.point,
    percentPoint: [
      Math.max(0.5, Math.min(99.5, pct[0])),
      Math.max(0.5, Math.min(99.5, pct[1])),
    ],
    edgeA: best.edgeA,
    edgeB: best.edgeB,
    edgeLength: best.edgeLength,
    dist: best.dist,
    gateAngle,
    inwardNormal,
  };
}

/**
 * Devuelve una copia de `entrance` acoplada al borde más cercano del perímetro operativo
 * con sus coordenadas `(x, y)` y su ángulo `gateAngle` actualizados hacia el interior.
 */
export function snapEntranceToPerimeter(
  entrance: EntranceItem,
  scene: Pick<Scene, 'boundary' | 'passages'>,
  map: MapMetadata
): EntranceItem {
  const snap = snapPointToPerimeter(world([entrance.x, entrance.y], map), scene, map);
  if (!snap) return entrance;
  return {
    ...entrance,
    x: snap.percentPoint[0],
    y: snap.percentPoint[1],
    gateAngle: snap.gateAngle,
  };
}

/** Resumen normalizado del flujo configurado para un acceso individual. */
export interface AccessFlowMetrics {
  id: string;
  name: string;
  spawnType: SpawnKind;
  canEnter: boolean;
  canExit: boolean;
  entryWeight: number;
  exitWeight: number;
  entrySharePct: number;
  exitSharePct: number;
  rawArrivalsPerHour: number;
  effectiveArrivalsPerHour: number;
  maxRatePerHour: number;
  frequencySec: number;
  utilizationPct: number;
  isCapped: boolean;
}

interface StreetCandidate {
  point: Point2D;
  angleDeg: number;
  kind: 'pedestrian' | 'vehicle';
  streetName: string;
  priority: number;
}

/**
 * Intersección entre dos segmentos AB y CD en 2D. Devuelve el punto de cruce o `null`.
 */
function segmentIntersection(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D
): Point2D | null {
  const rX = b[0] - a[0];
  const rY = b[1] - a[1];
  const sX = d[0] - c[0];
  const sY = d[1] - c[1];
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-6) return null;
  const qpX = c[0] - a[0];
  const qpY = c[1] - a[1];
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return [a[0] + t * rX, a[1] + t * rY];
  }
  return null;
}

/**
 * Proyecta un punto `p` sobre el segmento `a → b` y devuelve punto proyectado y distancia.
 */
function projectOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): {point: Point2D; dist: number} {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) {
    return {point: [a[0], a[1]], dist: Math.hypot(p[0] - a[0], p[1] - a[1])};
  }
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)
  );
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return {point: [px, py], dist: Math.hypot(p[0] - px, p[1] - py)};
}

/**
 * Recopila las vías reales en metros locales desde `map.customLocation.streets` o `CARTO_DATA`.
 */
function collectStreets(
  map: MapMetadata,
  carto?: CartoData
): CustomMapStreet[] {
  if (map.customLocation?.streets?.length) {
    return map.customLocation.streets;
  }
  if (!carto) return [];
  const out: CustomMapStreet[] = [];
  for (const f of carto.features) {
    if (!f.tags?.highway || f.points.length < 2) continue;
    const kind = classifyOsmHighway(f.tags.highway);
    if (!kind) continue;
    const pts = f.points.map((pt) => localPoint(pt, map));
    const nearMap = pts.some(
      ([x, y]) =>
        x >= -25 &&
        y >= -25 &&
        x <= map.widthMeters + 25 &&
        y <= map.heightMeters + 25
    );
    if (!nearMap) continue;
    out.push({
      name: f.tags.name || '',
      highway: f.tags.highway,
      kind,
      points: pts,
    });
  }
  return out;
}

/**
 * Extrae las aristas del polígono de perímetro en metros locales, orientando cada
 * `angleDeg` de modo que `+90°` apunte siempre al INTERIOR del polígono.
 */
function boundaryEdges(
  polyM: Point2D[]
): Array<{a: Point2D; b: Point2D; angleDeg: number; len: number}> {
  const edges: Array<{a: Point2D; b: Point2D; angleDeg: number; len: number}> =
    [];
  const polys = [polyM];
  for (let i = 0; i < polyM.length; i++) {
    const a = polyM[i];
    const b = polyM[(i + 1) % polyM.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const mid: Point2D = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const {gateAngle} = resolveInwardNormal(mid, a, b, polys);
    edges.push({a, b, angleDeg: gateAngle, len});
  }
  return edges;
}

/**
 * Construye un `EntranceItem` operativo a partir de un punto candidato sobre el perímetro.
 */
function buildEntrance(
  candidate: StreetCandidate,
  index: number,
  map: MapMetadata,
  spawnTypeOverride?: SpawnKind
): EntranceItem {
  const spawnType: SpawnKind = spawnTypeOverride || candidate.kind;
  const [x, y] = percent(candidate.point, map);
  const isVeh = spawnType === 'vehicle';
  const isMixed = spawnType === 'mixed';
  const prefix = isVeh
    ? 'Acceso vehicular'
    : isMixed
      ? 'Acceso mixto'
      : 'Acceso peatonal';
  const name = candidate.streetName
    ? `${prefix} · ${candidate.streetName}`
    : `${prefix} ${index + 1}`;
  const clearWidth = isVeh ? 6 : isMixed ? 5 : 4;
  const recommendedAuthorities: AuthorityAccessUnit[] = isVeh
    ? ['foot', 'light_stretchers', 'passenger_vehicles', 'heavy_trucks']
    : isMixed
      ? ['foot', 'light_stretchers', 'passenger_vehicles']
      : ['foot', 'light_stretchers'];
  const role = isVeh ? 'free' : 'both';

  return {
    id: `spawn-${spawnType}-${index + 1}-${Math.round(x * 10)}-${Math.round(y * 10)}`,
    name,
    kind: 'gate',
    x: Math.max(0.5, Math.min(99.5, x)),
    y: Math.max(0.5, Math.min(99.5, y)),
    clearWidth,
    gateAngle: Math.round(candidate.angleDeg),
    role,
    phases: {event: role},
    phaseTags: ['pre', 'event', 'post'],
    recommendedAuthorities,
    spawnType,
    streetName: candidate.streetName || undefined,
    entryWeight: 0,
    exitWeight: 0,
    maxRatePerHour: 0,
  };
}

/**
 * Distribuye pesos de entrada y salida coherentes (sumando 100 %) entre los accesos generados.
 */
function assignBalancedWeights(entrances: EntranceItem[]): EntranceItem[] {
  const pedAndMixed = entrances.filter((e) => e.spawnType !== 'vehicle');
  const vehicles = entrances.filter((e) => e.spawnType === 'vehicle');

  if (pedAndMixed.length > 0) {
    const share = Math.round(100 / pedAndMixed.length);
    let rem = 100;
    pedAndMixed.forEach((e, idx) => {
      const w = idx === pedAndMixed.length - 1 ? Math.max(1, rem) : share;
      rem -= w;
      e.entryWeight = w;
      e.exitWeight = w;
    });
    for (const v of vehicles) {
      v.entryWeight = 0;
      v.exitWeight = 0;
    }
  } else if (entrances.length > 0) {
    const share = Math.round(100 / entrances.length);
    let rem = 100;
    entrances.forEach((e, idx) => {
      const w = idx === entrances.length - 1 ? Math.max(1, rem) : share;
      rem -= w;
      e.entryWeight = w;
      e.exitWeight = w;
    });
  }
  return entrances;
}

/**
 * Genera puntos de aparición (spawns) peatonales y vehiculares coherentes con las
 * calles y vías reales que cruzan o bordean el perímetro operativo trazado.
 *
 * Si no se detectan vías OSM (por ejemplo sin conexión a Internet o en campo abierto),
 * genera accesos cardinales coherentes sobre las aristas del perímetro garantizando
 * siempre puntos de acceso tanto peatonales como vehiculares.
 */
export function generateCoherentSpawns(
  boundaryPct: Point2D[],
  map: MapMetadata,
  carto?: CartoData
): EntranceItem[] {
  if (!boundaryPct || boundaryPct.length < 3) return [];
  const polyM = boundaryPct.map((p) => world(p, map));
  const edges = boundaryEdges(polyM);
  if (!edges.length) return [];

  const streets = collectStreets(map, carto);
  const rawCandidates: StreetCandidate[] = [];

  for (const st of streets) {
    const nameBoost = st.name ? 2 : 0;
    // 1. Direct intersections of street segments with boundary edges
    for (let i = 1; i < st.points.length; i++) {
      const sa = st.points[i - 1];
      const sb = st.points[i];
      for (const edge of edges) {
        const hit = segmentIntersection(sa, sb, edge.a, edge.b);
        if (hit) {
          rawCandidates.push({
            point: hit,
            angleDeg: edge.angleDeg,
            kind: st.kind,
            streetName: st.name,
            priority: 10 + nameBoost,
          });
        }
      }
    }
    // 2. Nearby street vertices within 14 m of perimeter edges (for roads running alongside the plaza)
    for (const pt of st.points) {
      let bestDist = 14;
      let bestHit: Point2D | null = null;
      let bestAngle = 0;
      for (const edge of edges) {
        const proj = projectOnSegment(pt, edge.a, edge.b);
        if (proj.dist < bestDist) {
          bestDist = proj.dist;
          bestHit = proj.point;
          bestAngle = edge.angleDeg;
        }
      }
      if (bestHit) {
        rawCandidates.push({
          point: bestHit,
          angleDeg: bestAngle,
          kind: st.kind,
          streetName: st.name,
          priority: Math.max(1, 7 - bestDist * 0.3) + nameBoost,
        });
      }
    }
  }

  // Sort by priority (direct named crossings first) and spatially deduplicate (16 m spacing)
  rawCandidates.sort((a, b) => b.priority - a.priority);
  const picked: StreetCandidate[] = [];
  const minSpacing = 16;

  const tryPick = (cand: StreetCandidate): boolean => {
    if (
      picked.some(
        (p) =>
          Math.hypot(p.point[0] - cand.point[0], p.point[1] - cand.point[1]) <
          minSpacing
      )
    ) {
      return false;
    }
    picked.push(cand);
    return true;
  };

  // First pass: pick up to 3 pedestrian and 2 vehicle candidates to ensure balanced mix
  let pedCount = 0;
  let vehCount = 0;
  for (const cand of rawCandidates) {
    if (cand.kind === 'pedestrian' && pedCount < 3) {
      if (tryPick(cand)) pedCount++;
    } else if (cand.kind === 'vehicle' && vehCount < 2) {
      if (tryPick(cand)) vehCount++;
    }
    if (pedCount >= 3 && vehCount >= 2) break;
  }

  // Second pass: fill up to 6 total spawns from remaining candidates
  for (const cand of rawCandidates) {
    if (picked.length >= 6) break;
    tryPick(cand);
  }

  // Fallback or completion: ensure at least 2 pedestrian/mixed spawns and 1 vehicle spawn
  const sortedEdges = [...edges].sort((a, b) => b.len - a.len);
  const addEdgeFallback = (kind: 'pedestrian' | 'vehicle', label: string) => {
    for (const edge of sortedEdges) {
      const mid: Point2D = [
        (edge.a[0] + edge.b[0]) / 2,
        (edge.a[1] + edge.b[1]) / 2,
      ];
      if (
        !picked.some(
          (p) => Math.hypot(p.point[0] - mid[0], p.point[1] - mid[1]) < 12
        )
      ) {
        picked.push({
          point: mid,
          angleDeg: edge.angleDeg,
          kind,
          streetName: label,
          priority: 1,
        });
        return;
      }
    }
    // If polygon is tiny, pick a shifted point on longest edge
    const longest = sortedEdges[0];
    const t = kind === 'vehicle' ? 0.72 : 0.28;
    picked.push({
      point: [
        longest.a[0] + (longest.b[0] - longest.a[0]) * t,
        longest.a[1] + (longest.b[1] - longest.a[1]) * t,
      ],
      angleDeg: longest.angleDeg,
      kind,
      streetName: label,
      priority: 1,
    });
  };

  while (picked.filter((p) => p.kind === 'pedestrian').length < 2) {
    const n = picked.filter((p) => p.kind === 'pedestrian').length + 1;
    addEdgeFallback('pedestrian', `Paso perimetral ${n}`);
  }
  if (!picked.some((p) => p.kind === 'vehicle')) {
    addEdgeFallback('vehicle', 'Vía de servicio perimetral');
  }

  const entrances = picked.map((cand, idx) => buildEntrance(cand, idx, map));
  return assignBalancedWeights(entrances);
}

/**
 * Normaliza los porcentajes de entrada/salida, calcula el volumen horario efectivo (pers/h)
 * y la frecuencia media de aparición (`segundos / persona`) para cada acceso de la escena.
 */
export function normalizeAccessFlows(
  entrances: EntranceItem[],
  totalArrivalsPerHour: number
): AccessFlowMetrics[] {
  const arrivals = Math.max(0, Number(totalArrivalsPerHour) || 0);

  const canEnterFlags = entrances.map((e) => {
    const mode = gateMode(e);
    return ['in', 'both', 'free'].includes(mode);
  });
  const canExitFlags = entrances.map((e) => {
    const mode = gateMode(e);
    return ['out', 'both', 'free'].includes(mode);
  });

  // Check whether any pedestrian/mixed gate can enter; if so, vehicle-only gates default to 0 unless explicitly weighted
  const hasPedEntry = entrances.some(
    (e, i) => canEnterFlags[i] && e.spawnType !== 'vehicle'
  );
  const hasPedExit = entrances.some(
    (e, i) => canExitFlags[i] && e.spawnType !== 'vehicle'
  );

  const rawEntryWeights = entrances.map((e, i) => {
    if (!canEnterFlags[i]) return 0;
    if (Number.isFinite(e.entryWeight)) return Math.max(0, Number(e.entryWeight));
    if (e.spawnType === 'vehicle' && hasPedEntry) return 0;
    return 1;
  });
  const sumEntry = rawEntryWeights.reduce((a, b) => a + b, 0);
  const fallbackEntryCount = entrances.filter(
    (e, i) => canEnterFlags[i] && (!hasPedEntry || e.spawnType !== 'vehicle')
  ).length;

  const rawExitWeights = entrances.map((e, i) => {
    if (!canExitFlags[i]) return 0;
    if (Number.isFinite(e.exitWeight)) return Math.max(0, Number(e.exitWeight));
    if (e.spawnType === 'vehicle' && hasPedExit) return 0;
    return 1;
  });
  const sumExit = rawExitWeights.reduce((a, b) => a + b, 0);
  const fallbackExitCount = entrances.filter(
    (e, i) => canExitFlags[i] && (!hasPedExit || e.spawnType !== 'vehicle')
  ).length;

  return entrances.map((e, i) => {
    const canEnter = canEnterFlags[i];
    const canExit = canExitFlags[i];
    const spawnType: SpawnKind = e.spawnType || 'pedestrian';

    const entrySharePct = !canEnter
      ? 0
      : sumEntry > 0
        ? (rawEntryWeights[i] / sumEntry) * 100
        : !hasPedEntry || spawnType !== 'vehicle'
          ? fallbackEntryCount > 0
            ? 100 / fallbackEntryCount
            : 0
          : 0;

    const exitSharePct = !canExit
      ? 0
      : sumExit > 0
        ? (rawExitWeights[i] / sumExit) * 100
        : !hasPedExit || spawnType !== 'vehicle'
          ? fallbackExitCount > 0
            ? 100 / fallbackExitCount
            : 0
          : 0;

    const rawArrivalsPerHour = (arrivals * entrySharePct) / 100;
    const maxRatePerHour = Math.max(0, Number(e.maxRatePerHour) || 0);
    const effectiveArrivalsPerHour =
      maxRatePerHour > 0
        ? Math.min(rawArrivalsPerHour, maxRatePerHour)
        : rawArrivalsPerHour;
    const frequencySec =
      effectiveArrivalsPerHour > 0 ? 3600 / effectiveArrivalsPerHour : Infinity;
    const utilizationPct =
      maxRatePerHour > 0 ? (rawArrivalsPerHour / maxRatePerHour) * 100 : 0;

    return {
      id: e.id,
      name: e.name,
      spawnType,
      canEnter,
      canExit,
      entryWeight: Number.isFinite(e.entryWeight) ? Number(e.entryWeight) : Math.round(entrySharePct),
      exitWeight: Number.isFinite(e.exitWeight) ? Number(e.exitWeight) : Math.round(exitSharePct),
      entrySharePct,
      exitSharePct,
      rawArrivalsPerHour,
      effectiveArrivalsPerHour,
      maxRatePerHour,
      frequencySec,
      utilizationPct,
      isCapped: maxRatePerHour > 0 && rawArrivalsPerHour > maxRatePerHour,
    };
  });
}
