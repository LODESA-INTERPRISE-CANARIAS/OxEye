/**
 * Logistics Manager API contract shared by the frontend (src/logistics) and the
 * backend (server). Types only: this file must not import anything, so the
 * frontend build never depends on server packages.
 *
 * Conventions:
 * - Identifiers are UUID strings.
 * - Instants are ISO 8601 strings in UTC (`2026-12-02T09:00:00.000Z`).
 * - Local dates are `YYYY-MM-DD`, local times `HH:MM`, interpreted in the
 *   record's IANA time zone (`Atlantic/Canary` by default).
 * - Missing information is `null`, never invented; the UI shows it as
 *   «Pendiente de verificar».
 *
 * Routes (prefix `/api`; all except health, auth/users and auth/login need
 * `Authorization: Bearer <token>`; writes by a `guest` return 403 FORBIDDEN):
 *
 *   GET    /health                               → HealthResponse
 *   GET    /auth/users                           → ListResponse<LoginUserOption>
 *   POST   /auth/login         LoginRequest      → LoginResponse (401, 429)
 *   POST   /auth/logout                          → 204
 *   GET    /me                                   → MeResponse
 *   GET    /organizations/:orgId/events          → ListResponse<LogisticsEvent>
 *          (sorted by date, then startsAt, undated last, then name)
 *   POST   /events             CreateEventInput  → 201 LogisticsEvent
 *   PATCH  /events/:id         UpdateEventInput  → LogisticsEvent (409 VERSION_CONFLICT with `current`)
 *   GET    /organizations/:orgId/venues          → ListResponse<Venue>
 *   GET    /organizations/:orgId/activity?limit= → ListResponse<ActivityEntry> (newest first, default 20, max 100)
 *   DELETE /organizations/:orgId/demo            → {removed: number} (deletes every isDemo record)
 */

export type Uuid = string;
export type IsoInstant = string;
export type LocalDate = string;
export type LocalTime = string;

/** Where a piece of information came from. */
export type DataSource = 'observed' | 'reported' | 'document';
/** How trustworthy a record is. */
export type Verification = 'draft' | 'to_verify' | 'validated';

export interface UserRef {
  id: Uuid;
  displayName: string;
}

/** Fields carried by every mutable record. */
export interface RecordMeta {
  id: Uuid;
  /** Optimistic concurrency counter; send it back on update. */
  version: number;
  createdBy: UserRef;
  createdAt: IsoInstant;
  updatedBy: UserRef;
  updatedAt: IsoInstant;
  source: DataSource | null;
  verification: Verification;
  /** Fictitious demo data, removable in one action. */
  isDemo: boolean;
}

/** Common optional input for records that carry provenance. */
export interface ProvenanceInput {
  source?: DataSource | null;
  verification?: Verification;
}

// ---------------------------------------------------------------- auth

export type Role = 'member' | 'guest';

export interface SessionUser {
  id: Uuid;
  displayName: string;
  role: Role;
}

export interface Organization {
  id: Uuid;
  name: string;
  timezone: string;
}

export interface LoginUserOption {
  displayName: string;
  role: Role;
}

export interface LoginRequest {
  displayName: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: IsoInstant;
  user: SessionUser;
  organizations: Organization[];
}

export interface MeResponse {
  user: SessionUser;
  organizations: Organization[];
}

// ---------------------------------------------------------------- venues and events

export interface Venue extends RecordMeta {
  organizationId: Uuid;
  name: string;
  address: string | null;
}

export type EventStatus = 'planned' | 'confirmed' | 'delayed' | 'cancelled';

export interface LogisticsEvent extends RecordMeta {
  organizationId: Uuid;
  name: string;
  venue: {id: Uuid; name: string} | null;
  /** Local day in `timezone`; kept even when the times are still unknown. */
  date: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  status: EventStatus;
  notes: string | null;
}

/**
 * Creating an event needs only a name. Date and times are local to the
 * organization's time zone; the server converts them to UTC instants.
 * `venueName` finds or creates a venue of the same organization by name.
 */
export interface CreateEventInput extends ProvenanceInput {
  organizationId: Uuid;
  name: string;
  venueName?: string | null;
  date?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  status?: EventStatus;
  notes?: string | null;
}

export interface UpdateEventInput extends ProvenanceInput {
  version: number;
  name?: string;
  venueName?: string | null;
  date?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  status?: EventStatus;
  notes?: string | null;
}

export interface ListResponse<T> {
  items: T[];
}

// ---------------------------------------------------------------- activity

export type ActivityAction = 'create' | 'update' | 'delete';

export interface ActivityEntry {
  id: string;
  user: UserRef;
  entityType: string;
  entityId: Uuid;
  /** Human label of the entity at the time of the change (e.g. event name). */
  entityLabel: string;
  action: ActivityAction;
  /** Field names that changed (update only). */
  changedFields: string[];
  at: IsoInstant;
}

// ================================================================ milestones 2–6
// Routes for these types are added to the header table when each milestone
// starts. Shapes below are the agreed contract.

// ---------------------------------------------------------------- tasks (M2)

export type TaskKind =
  'assembly' | 'activity' | 'dismantling' | 'transport' | 'delivery' | 'other';
export type TaskStatus =
  'planned' | 'confirmed' | 'in_progress' | 'done' | 'delayed' | 'cancelled';

export interface Task extends RecordMeta {
  organizationId: Uuid;
  eventId: Uuid | null;
  venue: {id: Uuid; name: string} | null;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  company: {id: Uuid; name: string} | null;
  contact: {id: Uuid; name: string} | null;
  /** Finish-to-start predecessors. */
  dependsOn: Uuid[];
  /**
   * Involves heavy loads (stage, generator, tank, ballast): the subsoil check
   * must be run in the simulator. `null` = not yet known, never assumed light.
   */
  heavyLoad: boolean | null;
  notes: string | null;
}

export interface TaskInput extends ProvenanceInput {
  organizationId?: Uuid;
  eventId?: Uuid | null;
  venueName?: string | null;
  title?: string;
  kind?: TaskKind;
  status?: TaskStatus;
  date?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  companyId?: Uuid | null;
  contactId?: Uuid | null;
  dependsOn?: Uuid[];
  heavyLoad?: boolean | null;
  notes?: string | null;
  /** Required on update. */
  version?: number;
}

/** A stored «¿y si…?» scenario. Never changes the plan until applied. */
export interface DelayHypothesis {
  id: Uuid;
  organizationId: Uuid;
  taskId: Uuid;
  delayMinutes: number;
  /** true when the user entered an estimate rather than a known delay. */
  estimated: boolean;
  note: string | null;
  createdBy: UserRef;
  createdAt: IsoInstant;
  appliedAt: IsoInstant | null;
}

// ---------------------------------------------------------------- contacts, companies, catalogue (M3)

export interface Category {
  id: Uuid;
  organizationId: Uuid;
  /** Which lists use it. */
  scope: 'service' | 'resource';
  name: string;
  /** Built-in categories cannot be deleted; users can add more. */
  builtIn: boolean;
}

export interface Company extends RecordMeta {
  organizationId: Uuid;
  name: string;
  categoryIds: Uuid[];
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  /** Main contact person, if known. */
  mainContactId: Uuid | null;
  offerCount: number;
}

export interface Contact extends RecordMeta {
  organizationId: Uuid;
  name: string;
  role: string | null;
  company: {id: Uuid; name: string} | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  notes: string | null;
  eventIds: Uuid[];
}

export type PriceUnit =
  'unit' | 'metre' | 'hour' | 'day' | 'km' | 'pack' | 'custom';

export interface Offer extends RecordMeta {
  organizationId: Uuid;
  company: {id: Uuid; name: string};
  categoryId: Uuid | null;
  name: string;
  description: string | null;
  /** Euros, null when unknown («Pendiente de verificar»). */
  price: number | null;
  unit: PriceUnit;
  /** Required when unit = custom (e.g. «por escenario»). */
  customUnit: string | null;
  transportCost: number | null;
  assemblyCost: number | null;
  maintenanceCost: number | null;
  conditions: string | null;
  /** VAT treatment as recorded; never assumed. */
  vatIncluded: boolean | null;
}

// ---------------------------------------------------------------- inventories (M4)

export interface Warehouse extends RecordMeta {
  organizationId: Uuid;
  name: string;
  address: string | null;
  notes: string | null;
  resourceCount: number;
}

export type ResourceCondition = 'good' | 'fair' | 'damaged' | 'unknown';
export type ResourceAvailability =
  'available' | 'in_use' | 'maintenance' | 'unknown';
/** owned = physical item of the organization; contracted = service from a company. */
export type ResourceOwnership = 'owned' | 'contracted';

export interface Resource extends RecordMeta {
  organizationId: Uuid;
  warehouse: {id: Uuid; name: string} | null;
  categoryId: Uuid | null;
  name: string;
  ownership: ResourceOwnership;
  /** For contracted resources: the offer they come from. */
  offerId: Uuid | null;
  quantity: number | null;
  /** «unidades», «m», «kg»… */
  unit: string;
  /** Free text dimensions as observed, e.g. «3 × 6 m». */
  dimensions: string | null;
  condition: ResourceCondition;
  availability: ResourceAvailability;
  location: string | null;
  /** «aún por evaluar»: quantity/condition not assessed yet. */
  toAssess: boolean;
  notes: string | null;
}

// ---------------------------------------------------------------- notes, search, report (M4–M6)

export type NoteKind =
  'note' | 'incident' | 'decision' | 'open_question' | 'feature_idea';

/**
 * Operational notes. An «incident» here is a logistics incident (late truck,
 * missing fence); Punto Violeta cases are never recorded in this tool.
 */
export interface Note extends RecordMeta {
  organizationId: Uuid;
  kind: NoteKind;
  text: string;
  eventId: Uuid | null;
  /** Optional link to any record. */
  ref: {type: SearchEntityType; id: Uuid; label: string} | null;
  resolved: boolean;
}

export type SearchEntityType =
  | 'event'
  | 'task'
  | 'venue'
  | 'company'
  | 'contact'
  | 'offer'
  | 'warehouse'
  | 'resource'
  | 'note';

export interface SearchHit {
  type: SearchEntityType;
  id: Uuid;
  title: string;
  subtitle: string | null;
  score: number;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
}

export interface RecentSearch {
  query: string;
  at: IsoInstant;
}

export interface DayReport {
  organizationId: Uuid;
  /** Local day covered, in the organization's time zone. */
  date: LocalDate;
  generatedAt: IsoInstant;
  generatedBy: UserRef;
  counts: {
    events: {created: number; modified: number};
    contacts: {created: number; modified: number};
    companies: {created: number; modified: number};
    offers: {created: number; modified: number};
    resources: {created: number; modified: number};
    tasks: {created: number; modified: number};
  };
  /** Share of the organization's records with verification = validated (0–100). */
  verifiedPercent: number;
  /** Records still missing information, with what is missing. */
  pending: {
    type: SearchEntityType;
    id: Uuid;
    label: string;
    missing: string[];
  }[];
  incidents: Note[];
  decisions: Note[];
  openQuestions: Note[];
  featureIdeas: Note[];
  /** Tasks agreed for the coming days. */
  nextTasks: Task[];
  contributors: {user: UserRef; changes: number}[];
}

// ---------------------------------------------------------------- health and errors

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  version: string;
}

export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Every error response has this body. `message` is plain Spanish for the UI. */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level problems for VALIDATION: field name → Spanish message. */
  fields?: Record<string, string>;
  /** For VERSION_CONFLICT: the record as it is now on the server. */
  current?: unknown;
}
