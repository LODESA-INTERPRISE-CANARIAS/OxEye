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
 *
 * Milestone 2 (tasks and calendar):
 *
 *   GET    /organizations/:orgId/tasks[?eventId=] → ListResponse<Task>
 *          (all tasks of the organization, or of one event; sorted like events)
 *   POST   /tasks              TaskInput          → 201 Task
 *   PATCH  /tasks/:id          TaskInput          → Task (409 VERSION_CONFLICT with `current`)
 *   DELETE /tasks/:id?version=N                   → 204 (409 VERSION_CONFLICT with `current`);
 *          removes it from other tasks' `dependsOn` (their version increases)
 *   GET    /organizations/:orgId/companies        → ListResponse<Company> (by name, ignoring case)
 *
 * Milestone 3 (contacts and catalogue):
 *
 *   GET    /organizations/:orgId/categories       → ListResponse<Category>
 *          (built-ins in BUILT_IN_SERVICE_CATEGORIES order, then custom by name)
 *   POST   /categories         CategoryInput      → 201 Category; an existing name
 *          (any case) in the same scope returns 200 with that category
 *   DELETE /categories/:id                        → 204; custom only (400 for built-in);
 *          companies and offers lose it (their version increases)
 *   POST   /companies          CompanyInput       → 201 Company (409 DUPLICATE with `current`)
 *   PATCH  /companies/:id      CompanyInput       → Company (409 VERSION_CONFLICT | DUPLICATE)
 *   DELETE /companies/:id?version=N               → 204 (409 VERSION_CONFLICT); deletes
 *          its offers; its contacts and tasks lose the company (versions increase)
 *   GET    /organizations/:orgId/contacts         → ListResponse<Contact> (by name, ignoring case)
 *   POST   /contacts           ContactInput       → 201 Contact
 *   PATCH  /contacts/:id       ContactInput       → Contact (409 VERSION_CONFLICT)
 *   DELETE /contacts/:id?version=N                → 204 (409); tasks lose the contact and
 *          a company that had it as main contact loses it (versions increase)
 *   GET    /organizations/:orgId/offers           → ListResponse<Offer> (by company, then name)
 *   POST   /offers             OfferInput         → 201 Offer
 *   PATCH  /offers/:id         OfferInput         → Offer (409 VERSION_CONFLICT)
 *   DELETE /offers/:id?version=N                  → 204 (409)
 *   GET    /organizations/:orgId/recent-searches  → ListResponse<RecentSearch>
 *          (the current user's, newest first, at most 5)
 *   POST   /organizations/:orgId/recent-searches  RecentSearchInput → ListResponse<RecentSearch>
 *          (403 for guests: a shared login keeps its searches on the device)
 *   DELETE /organizations/:orgId/recent-searches  → 204 (clears the current user's)
 *
 * Guests (role `guest`, a shared login) never receive contact details,
 * prices or free-text observations of people, companies and offers: the
 * server sends those fields as null and sets `restricted: true`, and the UI
 * shows «Visible para el equipo» instead of «Pendiente de verificar».
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
  /**
   * Last local day for events spanning several days (fairs, multi-day
   * set-ups); `null` = same day (or the next one for an overnight end time).
   */
  endDate: LocalDate | null;
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
  /** Must be after `date`; requires `date`. */
  endDate?: LocalDate | null;
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
  endDate?: LocalDate | null;
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
  /** Optional: a task can stand alone (e.g. collect fences from the warehouse). */
  eventId: Uuid | null;
  venue: {id: Uuid; name: string} | null;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  /** Local day in `timezone`; kept even when the times are still unknown. */
  date: LocalDate | null;
  /** Last local day for multi-day tasks; `null` = same day (or overnight). */
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  company: {id: Uuid; name: string} | null;
  /** Person to call about this task (milestone 3). */
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

/**
 * Create: `organizationId` and `title` required; everything else optional.
 * Update: `version` required; only the fields sent change.
 * `venueName` / `companyName` find or create by name (case-insensitive) in the
 * same organization; `companyId` wins over `companyName` when both are sent.
 * `dependsOn` replaces the whole list: same-organization tasks only, no self
 * reference, no cycles (400 VALIDATION with `fields.dependsOn`).
 * Times without `date` are rejected; `endDate` must be after `date`.
 * `kind` defaults to `other`. Moving `date` onto or past a stored `endDate`
 * is a 400: send `endDate` too (or null) when moving a multi-day record.
 * Clearing `date` clears `endDate`. Same rules for events.
 */
export interface TaskInput extends ProvenanceInput {
  organizationId?: Uuid;
  eventId?: Uuid | null;
  venueName?: string | null;
  title?: string;
  kind?: TaskKind;
  status?: TaskStatus;
  date?: LocalDate | null;
  endDate?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  companyId?: Uuid | null;
  companyName?: string | null;
  /**
   * A contact of the same organization (any company: the UI suggests the
   * task company's people first). Unknown or foreign id → 400.
   */
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

export type CategoryScope = 'service' | 'resource';

export interface Category {
  id: Uuid;
  organizationId: Uuid;
  /** Which lists use it: `service` = companies and offers (M3), `resource` = inventory (M4). */
  scope: CategoryScope;
  name: string;
  /** Built-in categories cannot be deleted; users can add more. */
  builtIn: boolean;
}

export interface CategoryInput {
  organizationId: Uuid;
  scope: CategoryScope;
  /** 1–60 characters; trimmed, inner whitespace collapsed. */
  name: string;
}

/**
 * Not every counterpart is a supplier: municipal departments, associations
 * and the like live in the same list («Empresas y entidades»).
 */
export type CompanyKind = 'supplier' | 'public_body' | 'association' | 'other';

export interface Company extends RecordMeta {
  organizationId: Uuid;
  name: string;
  /** Defaults to `supplier` (also when created by name from a task or offer). */
  kind: CompanyKind;
  /** Scope `service`, in category order. */
  categoryIds: Uuid[];
  /** Null for guests (`restricted`). */
  phone: string | null;
  /** Null for guests (`restricted`). */
  email: string | null;
  website: string | null;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** Main contact person: always one of this company's contacts. */
  mainContactId: Uuid | null;
  contactCount: number;
  offerCount: number;
  /** True when contact details and notes were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId` and `name` required. Update: `version` required;
 * only the fields sent change. `categoryIds` replaces the whole list (scope
 * `service`, same organization). `mainContactId` must be a contact whose
 * company is this one (400 otherwise). Same name as another company of the
 * organization (any case) → 409 DUPLICATE with `current` = that company.
 */
export interface CompanyInput extends ProvenanceInput {
  organizationId?: Uuid;
  name?: string;
  kind?: CompanyKind;
  categoryIds?: Uuid[];
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  mainContactId?: Uuid | null;
  version?: number;
}

export interface Contact extends RecordMeta {
  organizationId: Uuid;
  name: string;
  role: string | null;
  company: {id: Uuid; name: string} | null;
  /** Null for guests (`restricted`). */
  phone: string | null;
  /** Null for guests (`restricted`). */
  email: string | null;
  /** Null for guests (`restricted`). */
  description: string | null;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** Linked events of the same organization. */
  eventIds: Uuid[];
  /** True when contact details and observations were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId` and `name` required (two people may share a
 * name). Update: `version` required. `companyId` wins over `companyName`
 * (find-or-create by name). Moving a contact to another company (or none)
 * clears it as main contact of the old one (whose version increases).
 * `eventIds` replaces the whole list (same organization).
 */
export interface ContactInput extends ProvenanceInput {
  organizationId?: Uuid;
  name?: string;
  role?: string | null;
  companyId?: Uuid | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  notes?: string | null;
  eventIds?: Uuid[];
  version?: number;
}

export type PriceUnit =
  'unit' | 'metre' | 'hour' | 'day' | 'km' | 'pack' | 'custom';

/**
 * A product or service a company offers. Amounts are euros with at most two
 * decimals (0 – MAX_AMOUNT_EUR); `null` = unknown, never 0. Costs are kept
 * apart and never summed into an invented total when one is unknown.
 * A unit such as «kg» is only a billing unit: it never derives a load per
 * square metre and never answers a task's heavy-load question.
 */
export interface Offer extends RecordMeta {
  organizationId: Uuid;
  company: {id: Uuid; name: string};
  /** Scope `service`. */
  categoryId: Uuid | null;
  name: string;
  description: string | null;
  /** Euros per unit, null when unknown («Pendiente de verificar») or `restricted`. */
  price: number | null;
  unit: PriceUnit;
  /** Wording of a custom unit (e.g. «por escenario»); null until known. Cleared when unit ≠ custom. */
  customUnit: string | null;
  /** Null when unknown or `restricted`. */
  transportCost: number | null;
  /** Null when unknown or `restricted`. */
  assemblyCost: number | null;
  /** Null when unknown or `restricted`. */
  maintenanceCost: number | null;
  /** Null when unknown or `restricted`. */
  conditions: string | null;
  /** VAT treatment as recorded; null = not known, never assumed. */
  vatIncluded: boolean | null;
  /** True when prices, costs and conditions were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId`, `name` and a company (`companyId`, or
 * `companyName` to find or create it) required; `unit` defaults to `unit`.
 * Update: `version` required; only the fields sent change.
 */
export interface OfferInput extends ProvenanceInput {
  organizationId?: Uuid;
  companyId?: Uuid;
  companyName?: string;
  categoryId?: Uuid | null;
  name?: string;
  description?: string | null;
  price?: number | null;
  unit?: PriceUnit;
  customUnit?: string | null;
  transportCost?: number | null;
  assemblyCost?: number | null;
  maintenanceCost?: number | null;
  conditions?: string | null;
  vatIncluded?: boolean | null;
  version?: number;
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

/** 1–100 characters; the same query (accent/case-insensitive) moves to the top. */
export interface RecentSearchInput {
  query: string;
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
  /** A record with the same unique name exists; `current` holds it. */
  | 'DUPLICATE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Every error response has this body. `message` is plain Spanish for the UI. */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level problems for VALIDATION: field name → Spanish message. */
  fields?: Record<string, string>;
  /** For VERSION_CONFLICT: the record as it is now on the server; for DUPLICATE: the existing record. */
  current?: unknown;
}
