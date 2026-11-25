/**
 * Venue (Recinto) and Layout (Distribución) types (OX-04).
 *
 * A `Venue` holds what does not change between events (perimeter, accesses,
 * restricted zones, subsoil, permanent elements, base map and provenance).
 * A `Layout` holds what is placed for one event. The editor works on a
 * composed `Scene` (venue + layout + event-level data); these records are the
 * single source of each part (data authority map, INV-003).
 */
import type {
  BoothItem,
  ElementGroup,
  EntranceItem,
  GeometryTrace,
  InfrastructureItem,
  AnnotationItem,
  MapMetadata,
  PhaseKey,
  Point2D,
  Scene,
  SubsoilStructure,
  VenueKey,
} from './index';

/** Which part of the composed scene the editor is allowed to change. */
export type EditMode = 'layout' | 'venue';

/** Lifecycle of a layout. At most one `current` per (event, venue, phase). */
export type LayoutState = 'draft' | 'proposal' | 'current' | 'archived';

/** Venue content: the reusable, physical part of a scene. */
export interface VenueContent {
  boundary: Point2D[];
  /** `boundary-add` extensions and reference passages of the venue. */
  passages: GeometryTrace[];
  /** `boundary-subtract` holes, venue restricted zones and reference reserves. */
  reserves: GeometryTrace[];
  /** Every physical access of the venue (plan D1). */
  entrances: EntranceItem[];
  /** Permanent booths (`permanent: true`). */
  booths: BoothItem[];
  /** Permanent infrastructure (`permanent: true`). */
  infrastructure: InfrastructureItem[];
  subsoil?: SubsoilStructure;
}

export interface Venue {
  id: string;
  orgId: string;
  name: string;
  /** Scene slot of the event payload the venue is drawn in. */
  site: VenueKey;
  /** Incremented on every persisted content change (plan D6). */
  version: number;
  /** Base map with its provenance (source, retrieved, attribution, custom location). */
  map: MapMetadata;
  content: VenueContent;
  createdAt: string;
  updatedAt: string;
}

/** Operational fields of an access that a layout may override (plan D2). */
export const ACCESS_OVERRIDE_FIELDS = [
  'phases',
  'role',
  'entryWeight',
  'exitWeight',
  'conditionalState',
  'maxRatePerHour',
] as const;

export type AccessOverrideField = (typeof ACCESS_OVERRIDE_FIELDS)[number];
export type AccessOverride = Partial<Pick<EntranceItem, AccessOverrideField>>;

/** Layout content: what is placed on the venue for one event (plan D3). */
export interface LayoutContent {
  /** Interest-zone and other non-venue passages. */
  passages: GeometryTrace[];
  /** Turning/loading/exclusion reserves and layout-only restricted zones. */
  reserves: GeometryTrace[];
  /** Accesses that exist only in this layout (fallback; new accesses belong to the venue). */
  entrances: EntranceItem[];
  booths: BoothItem[];
  infrastructure: InfrastructureItem[];
  fences: GeometryTrace[];
  flows?: GeometryTrace[];
  corridors?: GeometryTrace[];
  roadPlans: GeometryTrace[];
  measurements: GeometryTrace[];
  annotations: AnnotationItem[];
  groups?: ElementGroup[];
  pendingStock?: Scene['pendingStock'];
  serviceRoute?: GeometryTrace;
  vehicleRoute?: GeometryTrace;
  vehicleReference?: Scene['vehicleReference'];
}

/** Safety review state that belongs to one layout and is never copied (plan D11). */
export interface LayoutSafety {
  safetyReview?: Scene['safetyReview'];
  safetyLock?: Scene['safetyLock'];
  safetyHistory?: Scene['safetyHistory'];
}

export interface Layout {
  id: string;
  orgId: string;
  eventId: string;
  venueId: string;
  site: VenueKey;
  name: string;
  state: LayoutState;
  /** Operational phases covered by this layout (plan D5). */
  phases: PhaseKey[];
  /** Incremented on every persisted content change (plan D6). */
  version: number;
  /** Venue version this layout was last evaluated against (plan D8). */
  baseVenueVersion: number;
  originLayoutId?: string;
  /** New item id → source item id, for duplicated layouts (plan D12). */
  originItemIds?: Record<string, string>;
  content: LayoutContent;
  accessOverrides: Record<string, AccessOverride>;
  safety: LayoutSafety;
  createdAt: string;
  updatedAt: string;
}
