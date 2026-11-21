/**
 * @module engine/planning/ballast
 * Motor puro para lastres/contrapesos editables, cálculo de carga superficial
 * (kg/m²), umbral de revisión de 500 kg/m² y dotación de lastres por carpa.
 *
 * Nota técnica: el peso propio de la carpa, la masa de sus lastres y la carga
 * superficial transmitida al suelo se mantienen estrictamente separados. El
 * umbral de 500 kg/m² es un indicador de revisión del proyecto, nunca una
 * validación estructural certificada.
 */
import type {
  InfrastructureItem,
  MapMetadata,
  Point2D,
  Scene,
} from '../../types';
import {percent, world} from '../cartography/geometry';
import {shareAncestorGroup} from '../cartography/groups';

/** Umbral orientativo de revisión del proyecto (kg/m²) para activar «Elemento pesado». */
export const HEAVY_LOAD_THRESHOLD_KG_M2 = 500;

/** Masa por defecto en kg de un nuevo bloque de lastre/contrapeso. */
export const DEFAULT_BALLAST_MASS_KG = 500;

/** Estado de dotación de lastres de una carpa. */
export interface CoverBallastStatus {
  configured: boolean;
  /** Longitud principal de la carpa (m). */
  lengthMeters: number;
  /** Tramo de longitud configurado según ficha del fabricante (m). */
  spanMeters: number;
  /** Número de tramos calculados: `ceil(lengthMeters / spanMeters)`. */
  spansCount: number;
  /** Lastres necesarios por tramo configurado. */
  ballastsPerSpan: number;
  /** Total de lastres necesarios (`spansCount * ballastsPerSpan`). */
  requiredCount: number;
  /** Masa mínima requerida por lastre en kg (0 = no especificada). */
  requiredMassPerUnitKg: number;
  /** Lastres vinculados a esta carpa (por grupo, vínculo explícito o proximidad). */
  linkedBallasts: InfrastructureItem[];
  linkedCount: number;
  missingCount: number;
  /** Lastres vinculados cuya masa es inferior a la mínima especificada. */
  underMassBallasts: InfrastructureItem[];
  /** Peso propio declarado de la carpa (kg), separado de sus lastres. */
  tentMassKg: number;
  /** Masa total acumulada de los lastres vinculados (kg), separada del peso propio. */
  totalBallastMassKg: number;
  /** Carga superficial máxima transmitida al suelo por un lastre vinculado (kg/m²). */
  maxBallastSurfaceLoadKgM2: number;
  complete: boolean;
}

/** Devuelve la superficie de apoyo efectiva en m² de un elemento. */
export function effectiveSupportAreaM2(item: {
  width?: number;
  depth?: number;
  area?: number;
  supportAreaM2?: number;
}): number {
  if (
    typeof item.supportAreaM2 === 'number' &&
    Number.isFinite(item.supportAreaM2) &&
    item.supportAreaM2 > 0
  ) {
    return item.supportAreaM2;
  }
  const w = Number(item.width) || 0;
  const d = Number(item.depth) || 0;
  if (w > 0 && d > 0) return w * d;
  if (typeof item.area === 'number' && item.area > 0) return item.area;
  return 0;
}

/**
 * Calcula la carga superficial en kg/m² (`masa / superficie de apoyo`) si el
 * elemento declara masa y superficie válidas.
 */
export function surfaceLoadKgM2(item: {
  massKg?: number;
  width?: number;
  depth?: number;
  area?: number;
  supportAreaM2?: number;
}): number | null {
  if (
    typeof item.massKg !== 'number' ||
    !Number.isFinite(item.massKg) ||
    item.massKg <= 0
  ) {
    return null;
  }
  const area = effectiveSupportAreaM2(item);
  if (area <= 0) return null;
  return item.massKg / area;
}

/** Devuelve `true` si la carga superficial alcanza o supera el umbral de 500 kg/m². */
export function meetsHeavyLoadThreshold(item: {
  massKg?: number;
  width?: number;
  depth?: number;
  area?: number;
  supportAreaM2?: number;
}): boolean {
  const load = surfaceLoadKgM2(item);
  return load !== null && load >= HEAVY_LOAD_THRESHOLD_KG_M2;
}

/** Devuelve los IDs de la carpa y de todos sus lastres subcomponente (`attachedCoverId === coverId`). */
export function coverSubcomponentBallastIds(
  scene: Scene,
  coverId: string
): string[] {
  return scene.infrastructure
    .filter((r) => r.kind === 'ballast' && r.attachedCoverId === coverId)
    .map((r) => r.id);
}

/**
 * Calcula posiciones ordenadas a lo largo del perímetro de la carpa (en sus dos
 * lados largos, respetando su rotación) para crear lastres subcomponente.
 */
function computeCoverBallastSlotMeters(
  cover: InfrastructureItem,
  map: MapMetadata,
  slotIndex: number,
  totalSlots: number
): Point2D {
  const [cx, cy] = world([cover.x, cover.y], map);
  const w = Number(cover.width) || 10;
  const d = Number(cover.depth) || 10;
  const rad = ((Number(cover.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const alongWidth = w >= d;
  const longLen = alongWidth ? w : d;
  const shortLen = alongWidth ? d : w;
  const perSide = Math.max(1, Math.ceil(totalSlots / 2));
  const side = slotIndex % 2 === 0 ? -1 : 1;
  const idxOnSide = Math.floor(slotIndex / 2);
  const frac =
    perSide === 1 ? 0.5 : (idxOnSide % perSide) / (perSide - 1);
  const localLong = -longLen / 2 + frac * longLen;
  const localShort = side * (shortLen / 2 + 0.55);

  const lx = alongWidth ? localLong : localShort;
  const ly = alongWidth ? localShort : localLong;

  const wx = Math.max(0.5, Math.min(map.widthMeters - 0.5, cx + lx * cos - ly * sin));
  const wy = Math.max(0.5, Math.min(map.heightMeters - 0.5, cy + lx * sin + ly * cos));
  return [wx, wy];
}

/**
 * Crea uno o varios lastres como subcomponentes directos de una carpa (`attachedCoverId`),
 * colocados en su perímetro y listos para editarse de forma independiente.
 */
export function addBallastSubcomponentsToCover(
  cover: InfrastructureItem,
  scene: Scene,
  map: MapMetadata,
  count = 1
): string[] {
  const existing = scene.infrastructure.filter(
    (r) => r.kind === 'ballast' && r.attachedCoverId === cover.id
  );
  const massKg =
    typeof cover.ballastRequiredMassKg === 'number' &&
    Number.isFinite(cover.ballastRequiredMassKg) &&
    cover.ballastRequiredMassKg > 0
      ? cover.ballastRequiredMassKg
      : DEFAULT_BALLAST_MASS_KG;
  const totalSlots = Math.max(existing.length + count, 2);
  const createdIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const slotMeters = computeCoverBallastSlotMeters(
      cover,
      map,
      existing.length + i,
      totalSlots
    );
    const [px, py] = percent(slotMeters, map);
    const id = crypto.randomUUID();
    const w = 1;
    const d = 1;
    const area = w * d;
    scene.infrastructure.push({
      id,
      name: `Lastre ${existing.length + i + 1}`,
      kind: 'ballast',
      role: 'logistics',
      x: px,
      y: py,
      width: w,
      depth: d,
      area,
      rotation: cover.rotation || 0,
      massKg,
      supportAreaM2: area,
      heavyLoad: massKg / area >= HEAVY_LOAD_THRESHOLD_KG_M2,
      attachedCoverId: cover.id,
      active: true,
      phaseTags: cover.phaseTags ? [...cover.phaseTags] : ['event'],
    });
    createdIds.push(id);
  }
  return createdIds;
}

/**
 * Evalúa la dotación de lastres de una carpa manteniendo separados el peso
 * propio de la carpa, la masa de sus lastres y la carga transmitida al suelo.
 * Solo cuenta lastres que sean subcomponentes de la carpa (`attachedCoverId`)
 * o agrupados explícitamente con ella (`Ctrl+G`), sin asociación automática por proximidad.
 */
export function evaluateCoverBallast(
  cover: InfrastructureItem,
  scene: Scene,
  _map?: MapMetadata
): CoverBallastStatus {
  const lengthMeters = Math.max(Number(cover.width) || 0, Number(cover.depth) || 0);
  const spanMeters =
    typeof cover.ballastSpanMeters === 'number' &&
    Number.isFinite(cover.ballastSpanMeters) &&
    cover.ballastSpanMeters > 0
      ? cover.ballastSpanMeters
      : 0;
  const ballastsPerSpan =
    typeof cover.ballastsPerSpan === 'number' &&
    Number.isFinite(cover.ballastsPerSpan) &&
    cover.ballastsPerSpan > 0
      ? Math.round(cover.ballastsPerSpan)
      : 0;
  const requiredMassPerUnitKg =
    typeof cover.ballastRequiredMassKg === 'number' &&
    Number.isFinite(cover.ballastRequiredMassKg) &&
    cover.ballastRequiredMassKg > 0
      ? cover.ballastRequiredMassKg
      : 0;
  const tentMassKg =
    typeof cover.tentMassKg === 'number' &&
    Number.isFinite(cover.tentMassKg) &&
    cover.tentMassKg > 0
      ? cover.tentMassKg
      : 0;

  const configured = spanMeters > 0 && ballastsPerSpan > 0 && lengthMeters > 0;
  const spansCount = configured ? Math.ceil(lengthMeters / spanMeters) : 0;
  const requiredCount = configured ? spansCount * ballastsPerSpan : 0;

  const allBallasts = scene.infrastructure.filter(
    (r) => r.kind === 'ballast' && r.active !== false
  );

  const linkedBallasts: InfrastructureItem[] = [];
  for (const b of allBallasts) {
    // 1. Subcomponente directo de esta carpa
    if (b.attachedCoverId === cover.id) {
      linkedBallasts.push(b);
      continue;
    }
    // 2. Agrupado explícitamente con esta carpa mediante Ctrl+G
    if (shareAncestorGroup(scene.groups, b.id, cover.id)) {
      linkedBallasts.push(b);
    }
  }

  const linkedCount = linkedBallasts.length;
  const missingCount = configured ? Math.max(0, requiredCount - linkedCount) : 0;
  const underMassBallasts =
    requiredMassPerUnitKg > 0
      ? linkedBallasts.filter((b) => (Number(b.massKg) || 0) < requiredMassPerUnitKg)
      : [];
  const totalBallastMassKg = linkedBallasts.reduce(
    (sum, b) => sum + Math.max(0, Number(b.massKg) || 0),
    0
  );
  const maxBallastSurfaceLoadKgM2 = linkedBallasts.reduce((max, b) => {
    const load = surfaceLoadKgM2(b) || 0;
    return load > max ? load : max;
  }, 0);

  return {
    configured,
    lengthMeters,
    spanMeters,
    spansCount,
    ballastsPerSpan,
    requiredCount,
    requiredMassPerUnitKg,
    linkedBallasts,
    linkedCount,
    missingCount,
    underMassBallasts,
    tentMassKg,
    totalBallastMassKg,
    maxBallastSurfaceLoadKgM2,
    complete: !configured || (missingCount === 0 && underMassBallasts.length === 0),
  };
}

/** Evalúa la dotación de lastres de todas las carpas activas de una escena. */
export function evaluateAllCoverBallasts(
  scene: Scene,
  map: MapMetadata
): Array<{cover: InfrastructureItem; status: CoverBallastStatus}> {
  return scene.infrastructure
    .filter((r) => r.role === 'cover' && r.active !== false)
    .map((cover) => ({
      cover,
      status: evaluateCoverBallast(cover, scene, map),
    }));
}
