/**
 * @module engine/planning/spatial-assistant
 * Asistente de corrección espacial inteligente: analiza incidencias espaciales
 * (colisiones, accesos bloqueados, cuellos de botella, colas, rutas de emergencia
 * y cargas pesadas en subsuelo) usando coordenadas y dimensiones reales, y
 * propone modificaciones mínimas geométricamente viables (desplazamiento,
 * rotación, reubicación o separación) sin automatizar el diseño completo.
 */
import type {
  Booth,
  Infrastructure,
  MapMetadata,
  Point,
  Scene,
} from '../../types';
import {inside, percent, rect, world} from '../cartography/geometry';
import {assessRisk} from '../emergency/risk';
import {
  evaluateHeavyLoadConflicts,
  evaluateItemSubsoilHeat,
  isHeavyLoadItem,
} from '../subsoil/heat';

export type SpatialIncidentKind =
  | 'element_conflict'
  | 'access_blocked'
  | 'bottleneck'
  | 'queue_congestion'
  | 'emergency_access'
  | 'subsoil_load';

export type SpatialProposalAction = 'move' | 'rotate' | 'relocate' | 'separate';

export interface SpatialCorrectionMove {
  itemId: string;
  itemName: string;
  fromX: number;
  fromY: number;
  fromRotation: number;
  toX: number;
  toY: number;
  toRotation: number;
  dxMeters: number;
  dyMeters: number;
  distanceMeters: number;
  directionLabel: string;
  deltaRotationDeg: number;
}

export interface SpatialCorrectionProposal {
  id: string;
  incidentKind: SpatialIncidentKind;
  title: string;
  diagnosis: string;
  criterion: string;
  affectedIds: string[];
  viable: boolean;
  actionType?: SpatialProposalAction;
  instruction: string;
  expectedEffect: string;
  moves: SpatialCorrectionMove[];
  unviableReason?: string;
}

type Placeable = Booth | Infrastructure;

const COMPASS_8: Array<{dx: number; dy: number; label: string}> = [
  {dx: 0, dy: -1, label: 'el norte'},
  {dx: 1, dy: 0, label: 'el este'},
  {dx: 0, dy: 1, label: 'el sur'},
  {dx: -1, dy: 0, label: 'el oeste'},
  {dx: Math.SQRT1_2, dy: -Math.SQRT1_2, label: 'el noreste'},
  {dx: Math.SQRT1_2, dy: Math.SQRT1_2, label: 'el sureste'},
  {dx: -Math.SQRT1_2, dy: Math.SQRT1_2, label: 'el suroeste'},
  {dx: -Math.SQRT1_2, dy: -Math.SQRT1_2, label: 'el noroeste'},
];

function compassLabel(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // 0° = East, 90° = South, -90° = North, ±180° = West
  const norm = ((angle % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'el este';
  if (norm < 67.5) return 'el sureste';
  if (norm < 112.5) return 'el sur';
  if (norm < 157.5) return 'el suroeste';
  if (norm < 202.5) return 'el oeste';
  if (norm < 247.5) return 'el noroeste';
  if (norm < 292.5) return 'el norte';
  return 'el noreste';
}

function fmtMeters(v: number): string {
  return (Math.round(v * 10) / 10).toLocaleString('es-ES', {
    maximumFractionDigits: 1,
  });
}

function polysOverlap(a: Point[], b: Point[]): boolean {
  if (!a.length || !b.length) return false;
  const minAx = Math.min(...a.map((p) => p[0]));
  const maxAx = Math.max(...a.map((p) => p[0]));
  const minAy = Math.min(...a.map((p) => p[1]));
  const maxAy = Math.max(...a.map((p) => p[1]));
  const minBx = Math.min(...b.map((p) => p[0]));
  const maxBx = Math.max(...b.map((p) => p[0]));
  const minBy = Math.min(...b.map((p) => p[1]));
  const maxBy = Math.max(...b.map((p) => p[1]));
  if (maxAx < minBx || maxBx < minAx || maxAy < minBy || maxBy < minAy) {
    return false;
  }
  const samplePts = (poly: Point[]): Point[] => {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const out: Point[] = [[cx, cy], ...poly];
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      out.push([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]);
    }
    return out;
  };
  return (
    samplePts(a).some((pt) => inside(pt, b)) ||
    samplePts(b).some((pt) => inside(pt, a))
  );
}

/**
 * Comprueba si colocar `item` en `(candX, candY, candRot)` respeta todas las
 * restricciones geométricas y estructurales: perímetro, zonas excluidas,
 * zonas libres/de interés, accesos, colisiones con otras piezas y subsuelo.
 */
export function validateCandidatePlacement(
  scene: Scene,
  item: Placeable,
  candX: number,
  candY: number,
  candRot: number,
  map: MapMetadata,
  ignoreIds: ReadonlySet<string> = new Set([item.id])
): {valid: boolean; reason?: string} {
  if (candX < 1 || candX > 99 || candY < 1 || candY > 99) {
    return {valid: false, reason: 'Fuera de la extensión del plano'};
  }
  const cand = {...item, x: candX, y: candY, rotation: candRot};
  const corners = rect(cand as unknown as Record<string, unknown>, map);
  const center = world([candX, candY], map);

  // 1. Dentro del perímetro operativo (o ampliaciones `boundary-add`)
  if (scene.boundary && scene.boundary.length >= 3) {
    const bndMeters = scene.boundary.map((pt) => world(pt, map));
    const addPolys = (scene.passages || [])
      .filter((r) => r.origin === 'boundary-add' && r.points.length >= 3)
      .map((r) => r.points.map((pt) => world(pt, map)));
    const inBoundary = (pt: Point) =>
      inside(pt, bndMeters) || addPolys.some((ap) => inside(pt, ap));
    if (!inBoundary(center) || !corners.every(inBoundary)) {
      return {valid: false, reason: 'Sale del perímetro operativo'};
    }
  }

  // 2. Fuera de reservas / zonas excluidas y zonas libres / de interés
  for (const res of scene.reserves || []) {
    if (res.points.length < 3) continue;
    const rMeters = res.points.map((pt) => world(pt, map));
    if (polysOverlap(corners, rMeters)) {
      return {valid: false, reason: `Invade «${res.name}»`};
    }
  }
  for (const pas of scene.passages || []) {
    if (pas.origin !== 'interest-zone' || pas.points.length < 3) continue;
    const pMeters = pas.points.map((pt) => world(pt, map));
    if (polysOverlap(corners, pMeters)) {
      return {valid: false, reason: `Invade zona libre «${pas.name}»`};
    }
  }

  // 3. Despeje mínimo respecto a accesos (2,6 m)
  for (const gate of scene.entrances || []) {
    const gPos = world([gate.x, gate.y], map);
    const gateBox: Point[] = [
      [gPos[0] - 1.8, gPos[1] - 1.8],
      [gPos[0] + 1.8, gPos[1] - 1.8],
      [gPos[0] + 1.8, gPos[1] + 1.8],
      [gPos[0] - 1.8, gPos[1] + 1.8],
    ];
    if (polysOverlap(corners, gateBox)) {
      return {valid: false, reason: `Obstruye acceso «${gate.name}»`};
    }
  }

  // 4. Sin colisión con otras piezas (permitiendo mobiliario bajo carpas)
  const isCover = (item as Infrastructure).role === 'cover';
  const others: Placeable[] = [
    ...scene.base.booths,
    ...scene.infrastructure.filter((r) => r.active !== false),
  ];
  for (const other of others) {
    if (ignoreIds.has(other.id) || other.id === item.id) continue;
    const otherIsCover = (other as Infrastructure).role === 'cover';
    if (isCover !== otherIsCover) continue;
    const otherCorners = rect(other as unknown as Record<string, unknown>, map);
    if (polysOverlap(corners, otherCorners)) {
      return {valid: false, reason: `Colisiona con «${other.name}»`};
    }
  }

  // 5. Restricciones estructurales del subsuelo para elementos pesados
  if (scene.subsoil && isHeavyLoadItem(cand)) {
    const conflict = evaluateItemSubsoilHeat(cand, scene.subsoil, map);
    if (conflict && conflict.level === 'critical') {
      return {
        valid: false,
        reason: 'Quedaría sobre forjado de subsuelo sin apoyo',
      };
    }
  }

  return {valid: true};
}

function buildMove(
  item: Placeable,
  toX: number,
  toY: number,
  toRotation: number,
  map: MapMetadata
): SpatialCorrectionMove {
  const fromM = world([item.x, item.y], map);
  const toM = world([toX, toY], map);
  const dxMeters = toM[0] - fromM[0];
  const dyMeters = toM[1] - fromM[1];
  const distanceMeters = Math.hypot(dxMeters, dyMeters);
  const fromRot = item.rotation || 0;
  return {
    itemId: item.id,
    itemName: item.name,
    fromX: item.x,
    fromY: item.y,
    fromRotation: fromRot,
    toX,
    toY,
    toRotation,
    dxMeters,
    dyMeters,
    distanceMeters,
    directionLabel: compassLabel(dxMeters, dyMeters),
    deltaRotationDeg: toRotation - fromRot,
  };
}

function findMinimalDisplacement(
  scene: Scene,
  item: Placeable,
  map: MapMetadata,
  preferredDir?: Point,
  distances = [0.8, 1.5, 2.2, 3, 4.5, 6]
): SpatialCorrectionMove | null {
  if (item.locked) return null;
  const originM = world([item.x, item.y], map);
  const dirs = [...COMPASS_8];
  if (preferredDir && Math.hypot(preferredDir[0], preferredDir[1]) > 0.01) {
    const len = Math.hypot(preferredDir[0], preferredDir[1]);
    const ux = preferredDir[0] / len;
    const uy = preferredDir[1] / len;
    dirs.sort((a, b) => b.dx * ux + b.dy * uy - (a.dx * ux + a.dy * uy));
  }
  for (const dist of distances) {
    for (const dir of dirs) {
      const candM: Point = [originM[0] + dir.dx * dist, originM[1] + dir.dy * dist];
      const [cx, cy] = percent(candM, map);
      const check = validateCandidatePlacement(
        scene,
        item,
        cx,
        cy,
        item.rotation || 0,
        map
      );
      if (check.valid) {
        return buildMove(item, cx, cy, item.rotation || 0, map);
      }
    }
  }
  return null;
}

/**
 * Analiza incidencias espaciales (simuladas y geométricas) y genera propuestas
 * de corrección concretas, mínimas y geométricamente verificadas.
 */
export function analyzeSpatialCorrections(
  scene: Scene,
  map: MapMetadata,
  engine?: any
): SpatialCorrectionProposal[] {
  const proposals: SpatialCorrectionProposal[] = [];
  const seenKeys = new Set<string>();
  const allItems: Placeable[] = [
    ...scene.base.booths,
    ...scene.infrastructure.filter((r) => r.active !== false),
  ];

  // 1. Accesos bloqueados por una pieza demasiado próxima
  for (const gate of scene.entrances || []) {
    const gPos = world([gate.x, gate.y], map);
    const gateBox: Point[] = [
      [gPos[0] - 1.8, gPos[1] - 1.8],
      [gPos[0] + 1.8, gPos[1] - 1.8],
      [gPos[0] + 1.8, gPos[1] + 1.8],
      [gPos[0] - 1.8, gPos[1] + 1.8],
    ];
    for (const item of allItems) {
      const key = `access-${gate.id}-${item.id}`;
      if (seenKeys.has(key)) continue;
      const corners = rect(item as unknown as Record<string, unknown>, map);
      if (!polysOverlap(corners, gateBox)) continue;
      seenKeys.add(key);

      if (item.locked) {
        proposals.push({
          id: key,
          incidentKind: 'access_blocked',
          title: `Acceso «${gate.name}» obstruido por «${item.name}»`,
          diagnosis: `La pieza «${item.name}» invade la zona de despeje del acceso «${gate.name}», generando tapón en entradas y salidas.`,
          criterion: 'Distancia libre mínima de 1,8 m alrededor del eje del acceso.',
          affectedIds: [item.id],
          viable: false,
          instruction: 'Intervención manual requerida: el elemento está bloqueado.',
          expectedEffect: 'Despejar el acceso mejorará el caudal de entrada y salida.',
          moves: [],
          unviableReason: `«${item.name}» tiene el bloqueo de posición activado. Desbloquéalo o reubica el acceso manualmente.`,
        });
        continue;
      }

      // Intentar primero rotación de 90° (cambio mínimo)
      const rotCand = ((item.rotation || 0) + 90) % 360;
      const rotCheck = validateCandidatePlacement(
        scene,
        item,
        item.x,
        item.y,
        rotCand,
        map
      );
      if (rotCheck.valid) {
        const move = buildMove(item, item.x, item.y, rotCand, map);
        proposals.push({
          id: key,
          incidentKind: 'access_blocked',
          title: `Acceso «${gate.name}» obstruido por «${item.name}»`,
          diagnosis: `La orientación actual de «${item.name}» invade el despeje del acceso «${gate.name}».`,
          criterion: 'Solapamiento de huella rotada con el área libre del acceso.',
          affectedIds: [item.id],
          viable: true,
          actionType: 'rotate',
          instruction: `Girar «${item.name}» 90° en sentido horario para despejar el acceso «${gate.name}».`,
          expectedEffect:
            'Libera el paso en el acceso sin desplazar la pieza de su ubicación.',
          moves: [move],
        });
        continue;
      }

      const itemM = world([item.x, item.y], map);
      const shift = findMinimalDisplacement(scene, item, map, [
        itemM[0] - gPos[0],
        itemM[1] - gPos[1],
      ]);
      if (shift) {
        proposals.push({
          id: key,
          incidentKind: 'access_blocked',
          title: `Acceso «${gate.name}» obstruido por «${item.name}»`,
          diagnosis: `«${item.name}» bloquea la entrada/salida «${gate.name}» y reduce el ancho útil de paso.`,
          criterion: 'Distancia libre mínima respecto al borde del acceso.',
          affectedIds: [item.id],
          viable: true,
          actionType: 'move',
          instruction: `Mover «${item.name}» ${fmtMeters(shift.distanceMeters)} m hacia ${shift.directionLabel} para despejar el acceso «${gate.name}».`,
          expectedEffect:
            'Descongestiona el acceso y permite paso fluido y de emergencias.',
          moves: [shift],
        });
      } else {
        proposals.push({
          id: key,
          incidentKind: 'access_blocked',
          title: `Acceso «${gate.name}» obstruido por «${item.name}»`,
          diagnosis: `«${item.name}» invade el despeje de «${gate.name}».`,
          criterion: 'Zona libre mínima de acceso.',
          affectedIds: [item.id],
          viable: false,
          instruction: 'Intervención manual requerida.',
          expectedEffect: 'Despejar el acceso reducirá bloqueos de entrada.',
          moves: [],
          unviableReason:
            'No se encontró un desplazamiento libre dentro del perímetro sin colisionar con otras piezas o zonas restringidas.',
        });
      }
    }
  }

  // 2. Conflictos / colisiones entre dos piezas colocadas
  for (let i = 0; i < allItems.length; i++) {
    for (let j = i + 1; j < allItems.length; j++) {
      const a = allItems[i];
      const b = allItems[j];
      const aCover = (a as Infrastructure).role === 'cover';
      const bCover = (b as Infrastructure).role === 'cover';
      if (aCover !== bCover) continue;
      const key = `conflict-${a.id}-${b.id}`;
      if (seenKeys.has(key)) continue;
      const ca = rect(a as unknown as Record<string, unknown>, map);
      const cb = rect(b as unknown as Record<string, unknown>, map);
      if (!polysOverlap(ca, cb)) continue;
      seenKeys.add(key);

      const movable = !b.locked ? b : !a.locked ? a : null;
      const fixed = movable === b ? a : b;
      if (!movable) {
        proposals.push({
          id: key,
          incidentKind: 'element_conflict',
          title: `Solapamiento entre «${a.name}» y «${b.name}»`,
          diagnosis: `Las huellas de «${a.name}» y «${b.name}» se solapan físicamente sobre el plano.`,
          criterion: 'Intersección de huellas rectangulares en metros reales.',
          affectedIds: [a.id, b.id],
          viable: false,
          instruction: 'Intervención manual requerida: ambos elementos están bloqueados.',
          expectedEffect: 'Eliminar la colisión física y recuperar el paso entre piezas.',
          moves: [],
          unviableReason:
            'Tanto «' +
            a.name +
            '» como «' +
            b.name +
            '» están bloqueados. Desbloquea al menos uno para separarlos.',
        });
        continue;
      }

      const mPos = world([movable.x, movable.y], map);
      const fPos = world([fixed.x, fixed.y], map);
      const shift = findMinimalDisplacement(
        scene,
        movable,
        map,
        [mPos[0] - fPos[0], mPos[1] - fPos[1]],
        [0.8, 1.5, 2.2, 3, 4.5]
      );
      if (shift) {
        proposals.push({
          id: key,
          incidentKind: 'element_conflict',
          title: `Solapamiento entre «${a.name}» y «${b.name}»`,
          diagnosis: `«${a.name}» y «${b.name}» se solapan físicamente, impidiendo el montaje real y cerrando el paso peatonal.`,
          criterion: 'Intersección geométrica de huellas en coordenadas reales.',
          affectedIds: [a.id, b.id],
          viable: true,
          actionType: 'separate',
          instruction: `Separar «${movable.name}» ${fmtMeters(shift.distanceMeters)} m hacia ${shift.directionLabel} respecto a «${fixed.name}».`,
          expectedEffect:
            'Elimina el solapamiento físico y abre paso peatonal entre ambas piezas.',
          moves: [shift],
        });
      }
    }
  }

  // 3. Cargas pesadas sobre forjado de subsuelo sin apoyo
  if (scene.subsoil?.polygons.length) {
    const conflicts = evaluateHeavyLoadConflicts(scene, map);
    for (const c of conflicts) {
      const item = allItems.find((o) => o.id === c.itemId);
      if (!item) continue;
      const key = `subsoil-${item.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const shift = findMinimalDisplacement(
        scene,
        item,
        map,
        undefined,
        [1.5, 3, 5, 7, 10]
      );
      if (shift) {
        proposals.push({
          id: key,
          incidentKind: 'subsoil_load',
          title: `Elemento pesado sin apoyo en subsuelo: «${item.name}»`,
          diagnosis: `«${item.name}» apoya sobre el vano hueco del subsuelo (apoyo mínimo ${Math.round(c.support * 100)} %).`,
          criterion: 'Evaluación estructural de huella sobre forjado de subsuelo.',
          affectedIds: [item.id],
          viable: true,
          actionType: 'relocate',
          instruction: `Trasladar «${item.name}» ${fmtMeters(shift.distanceMeters)} m hacia ${shift.directionLabel} a una zona con apoyo estructural o fuera del garaje.`,
          expectedEffect:
            'Resuelve la restricción de carga pesada sobre el forjado del subsuelo.',
          moves: [shift],
        });
      } else {
        proposals.push({
          id: key,
          incidentKind: 'subsoil_load',
          title: `Elemento pesado sin apoyo en subsuelo: «${item.name}»`,
          diagnosis: `«${item.name}» está sobre el forjado hueco del subsuelo.`,
          criterion: 'Evaluación estructural del subsuelo.',
          affectedIds: [item.id],
          viable: false,
          instruction: 'Intervención manual requerida.',
          expectedEffect: 'Colocar sobre un apoyo estructural o fuera del garaje.',
          moves: [],
          unviableReason: item.locked
            ? `«${item.name}» está bloqueado.`
            : 'No se encontró una posición libre cercana con apoyo estructural suficiente.',
        });
      }
    }
  }

  // 4. Cuellos de botella, obstrucciones y colas detectadas en la simulación
  if (engine?.experience) {
    const episodes = (engine.experience.list?.() || []) as Array<{
      type: string;
      target?: string | null;
      point: Point;
      detail: string;
    }>;
    const spatialEpisodes = episodes.filter((ep) =>
      ['blocked', 'queue', 'exit'].includes(ep.type)
    );
    const groupedByTarget = new Map<
      string,
      {type: string; point: Point; count: number; targetId?: string | null}
    >();
    for (const ep of spatialEpisodes) {
      const k = `${ep.type}:${ep.target || Math.round(ep.point[0] / 5) + ',' + Math.round(ep.point[1] / 5)}`;
      const prev = groupedByTarget.get(k);
      if (prev) prev.count++;
      else {
        groupedByTarget.set(k, {
          type: ep.type,
          point: ep.point,
          count: 1,
          targetId: ep.target,
        });
      }
    }

    const sortedEp = [...groupedByTarget.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    for (const ep of sortedEp) {
      const targetItem =
        (ep.targetId && allItems.find((o) => o.id === ep.targetId)) ||
        allItems
          .filter((o) => (o as Infrastructure).role !== 'cover')
          .map((o) => {
            const pos = world([o.x, o.y], map);
            return {o, d: Math.hypot(pos[0] - ep.point[0], pos[1] - ep.point[1])};
          })
          .sort((a, b) => a.d - b.d)[0]?.o;

      if (!targetItem) continue;
      const key = `sim-${ep.type}-${targetItem.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const itemPos = world([targetItem.x, targetItem.y], map);
      const shift = findMinimalDisplacement(
        scene,
        targetItem,
        map,
        [itemPos[0] - ep.point[0], itemPos[1] - ep.point[1]],
        [1.5, 2.5, 3.5, 5]
      );
      const isQueue = ep.type === 'queue';
      if (shift) {
        proposals.push({
          id: key,
          incidentKind: isQueue ? 'queue_congestion' : 'bottleneck',
          title: isQueue
            ? `Congestión de espera en «${targetItem.name}» (${ep.count} avisos)`
            : `Cuello de botella junto a «${targetItem.name}» (${ep.count} avisos)`,
          diagnosis: isQueue
            ? `Se acumularon ${ep.count} episodios de cola/espera en torno a «${targetItem.name}», afectando el bienestar de los asistentes.`
            : `Se detectaron ${ep.count} episodios de paso bloqueado junto a «${targetItem.name}», estrechando el recorrido peatonal.`,
          criterion:
            'Episodios registrados durante la simulación por el monitor de experiencia.',
          affectedIds: [targetItem.id],
          viable: true,
          actionType: isQueue ? 'relocate' : 'move',
          instruction: isQueue
            ? `Trasladar «${targetItem.name}» ${fmtMeters(shift.distanceMeters)} m hacia ${shift.directionLabel} para ampliar el espacio de espera.`
            : `Mover «${targetItem.name}» ${fmtMeters(shift.distanceMeters)} m hacia ${shift.directionLabel} para liberar el recorrido peatonal.`,
          expectedEffect: isQueue
            ? 'Amplía la bolsa de cola y reduce el cruce con el flujo principal.'
            : 'Ensancha el pasillo afectado para reducir retenciones.',
          moves: [shift],
        });
      }
    }
  }

  // 5. Dificultades para la intervención de emergencias
  if (engine) {
    const risk = assessRisk(scene, engine, {routes: true});
    for (const issue of risk.critical.filter((i) => i.id.startsWith('route-'))) {
      const resId = issue.meta?.resourceId;
      const resItem = resId ? allItems.find((o) => o.id === resId) : undefined;
      if (!resItem) continue;
      const key = `emg-${issue.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const shift = findMinimalDisplacement(
        scene,
        resItem,
        map,
        undefined,
        [2, 3.5, 5, 7.5]
      );
      if (shift) {
        proposals.push({
          id: key,
          incidentKind: 'emergency_access',
          title: issue.title,
          diagnosis: issue.action,
          criterion:
            'Comprobación geométrica de corredor libre y radio de giro para emergencias.',
          affectedIds: [resItem.id],
          viable: true,
          actionType: 'relocate',
          instruction: `Reubicar «${resItem.name}» ${fmtMeters(shift.distanceMeters)} m hacia ${shift.directionLabel} sobre un paso despejado.`,
          expectedEffect:
            'Desbloquea la salida inicial del equipo de emergencias hacia las zonas de actividad.',
          moves: [shift],
        });
      }
    }
  }

  return proposals;
}

/**
 * Aplica los movimientos de una propuesta sobre `scene` (in-place dentro de
 * `updateScene(..., true)`) y verifica posibles conflictos residuales.
 */
export function applySpatialCorrection(
  scene: Scene,
  proposal: SpatialCorrectionProposal,
  map: MapMetadata
): {applied: boolean; warnings: string[]} {
  if (!proposal.viable || !proposal.moves.length) {
    return {applied: false, warnings: ['La propuesta no contiene cambios aplicables.']};
  }
  const allItems: Placeable[] = [...scene.base.booths, ...scene.infrastructure];
  const warnings: string[] = [];
  let count = 0;

  for (const mv of proposal.moves) {
    const target = allItems.find((o) => o.id === mv.itemId);
    if (!target || target.locked) {
      warnings.push(`No se pudo mover «${mv.itemName}» (bloqueado o inexistente).`);
      continue;
    }
    const check = validateCandidatePlacement(
      scene,
      target,
      mv.toX,
      mv.toY,
      mv.toRotation,
      map
    );
    target.x = mv.toX;
    target.y = mv.toY;
    target.rotation = mv.toRotation;
    count++;
    if (!check.valid && check.reason) {
      warnings.push(`Revisar «${mv.itemName}»: ${check.reason}.`);
    }
  }

  return {applied: count > 0, warnings};
}
