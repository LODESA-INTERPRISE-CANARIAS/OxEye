/**
 * @module engine/cartography/perimeter-status
 * Pure check of whether an installation footprint lies inside the effective
 * operational perimeter (boundary ∪ boundary-add − boundary-subtract).
 * Detection only: items are never moved here (VAL-MAP-BOUNDARY-001).
 */
import type {
  BoothItem,
  InfrastructureItem,
  MapMetadata,
  Point2D,
  Scene,
} from '../../types';
import {inside, rect, world} from './geometry';
import {collectPerimeterPolygons} from './spawns';

export type PerimeterStatusKind = 'inside' | 'partial' | 'outside' | 'no-perimeter';

export interface PerimeterStatus {
  kind: PerimeterStatusKind;
  /** Footprint corners (of 4) not inside the effective perimeter. */
  cornersOutside: number;
  /** Subset of `cornersOutside` that fall inside the added area but within a subtracted zone. */
  cornersInSubtract: number;
}

export type PerimeterInstallation = BoothItem | InfrastructureItem;

type PerimeterScene = Pick<Scene, 'boundary' | 'passages' | 'reserves'>;

/** Polygons (local metres) of the effective perimeter: additive and subtractive parts. */
export interface EffectivePerimeter {
  add: Point2D[][];
  subtract: Point2D[][];
}

/**
 * Builds the effective perimeter. Returns `null` when the scene has no valid
 * boundary (< 3 points); boundary-add traces alone do not define a perimeter.
 */
export function effectivePerimeter(
  scene: PerimeterScene,
  map: MapMetadata
): EffectivePerimeter | null {
  if (!scene.boundary || scene.boundary.length < 3) return null;
  const subtract = (scene.reserves || [])
    .filter((r) => r.origin === 'boundary-subtract' && r.points && r.points.length >= 3)
    .map((r) => r.points.map((p) => world(p, map)));
  return {add: collectPerimeterPolygons(scene, map), subtract};
}

/** Classifies the four footprint corners (`rect()`, honouring width/depth/rotation). */
export function installationPerimeterStatus(
  item: PerimeterInstallation,
  scene: PerimeterScene,
  map: MapMetadata
): PerimeterStatus {
  const perimeter = effectivePerimeter(scene, map);
  if (!perimeter) return {kind: 'no-perimeter', cornersOutside: 0, cornersInSubtract: 0};
  const corners = rect(item as unknown as Record<string, unknown>, map);
  let cornersOutside = 0;
  let cornersInSubtract = 0;
  for (const c of corners) {
    const inAdd = perimeter.add.some((poly) => inside(c, poly));
    const inSub = perimeter.subtract.some((poly) => inside(c, poly));
    if (!inAdd || inSub) {
      cornersOutside++;
      if (inAdd && inSub) cornersInSubtract++;
    }
  }
  const kind: PerimeterStatusKind =
    cornersOutside === 0
      ? 'inside'
      : cornersOutside === corners.length
        ? 'outside'
        : 'partial';
  return {kind, cornersOutside, cornersInSubtract};
}

/** Emergency vehicle kinds (same set as `gateAllowsAuthority` in emergency/priority.ts). */
export const EMERGENCY_VEHICLE_KINDS: ReadonlySet<string> = new Set([
  'ambulance',
  'fire',
  'patrol',
  'police_van',
]);

/**
 * Lists booths and infrastructure items whose footprint is partially or
 * totally outside the effective perimeter. Empty when there is no perimeter.
 */
export function installationsOutsidePerimeter(
  scene: Pick<Scene, 'boundary' | 'passages' | 'reserves' | 'base' | 'infrastructure'>,
  map: MapMetadata
): Array<{item: PerimeterInstallation; status: PerimeterStatus}> {
  if (!effectivePerimeter(scene, map)) return [];
  const items: PerimeterInstallation[] = [
    ...(scene.base?.booths || []),
    ...(scene.infrastructure || []),
  ];
  const out: Array<{item: PerimeterInstallation; status: PerimeterStatus}> = [];
  for (const item of items) {
    // Emergency vehicles are staged outside the venue by design (route A
    // origin, exterior bases); they are resources, not installations.
    if ('role' in item && item.role === 'emergency' && EMERGENCY_VEHICLE_KINDS.has(item.kind)) {
      continue;
    }
    const status = installationPerimeterStatus(item, scene, map);
    if (status.kind === 'partial' || status.kind === 'outside') out.push({item, status});
  }
  return out;
}
