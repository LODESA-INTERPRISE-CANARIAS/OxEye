/**
 * What the device shows for a write it has queued but the server has not
 * accepted yet (M6): the record built from the API input, with the rules the
 * server would apply (defaults, find-by-name, slots in the record's time
 * zone, the subsoil mark cleared when venue, heavy load or resources change).
 *
 * The device marks these records «Pendiente de enviar»; the server's answer
 * replaces them. Names typed for a venue, company or warehouse that is not
 * in the lists get a local placeholder reference (`local:<kind>:<name>`)
 * until the server creates the real one. Only members queue, so these
 * records are never `restricted`. A local version stays the base version
 * (0 for a create): the server assigns the next one.
 */
import type {
  Company,
  Contact,
  IsoInstant,
  LocalDate,
  LocalTime,
  LogisticsEvent,
  Note,
  NoteRefType,
  Offer,
  RecordMeta,
  Resource,
  Task,
  UserRef,
  Uuid,
  Warehouse,
} from './contracts.ts';
import {DEFAULT_RESOURCE_UNIT} from './rules.ts';
import {instantsToSlot, slotToInstants} from './time.ts';
import {sameValue} from './merge.ts';
import type {OutboxEntity} from './outbox.ts';

type Named = {id: Uuid; name: string};
type In = Record<string, unknown>;

export interface OptimisticContext {
  user: UserRef;
  now: IsoInstant;
  orgId: Uuid;
  /** The organization's time zone (records keep their own on update). */
  timezone: string;
  venues: readonly Named[];
  companies: readonly Named[];
  contacts: readonly Named[];
  events: readonly Named[];
  warehouses: readonly Named[];
  /** Name of the record a note points at (never note text). */
  refLabel?: (type: NoteRefType, id: Uuid) => string | null;
}

export type OptimisticRecord =
  | LogisticsEvent
  | Task
  | Company
  | Contact
  | Offer
  | Warehouse
  | Resource
  | Note;

/** Prefix of placeholder ids; never sent to the server. */
export const LOCAL_ID_PREFIX = 'local:';

export function isLocalId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(LOCAL_ID_PREFIX);
}

/**
 * Placeholder ids found anywhere in an API input. Must be empty before a
 * write is sent or queued: a form editing a pending record sends the typed
 * name (`venueName`, `companyName`, `warehouseName`) instead.
 */
export function localIdsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (isLocalId(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) localIdsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) localIdsIn(v, out);
  }
  return out;
}

const norm = (s: string) =>
  s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

/** Find by name like the server (case-insensitive), or a local placeholder. */
function byName(list: readonly Named[], name: string, kind: string): Named {
  const clean = name.trim().replace(/\s+/g, ' ');
  const hit = list.find(x => norm(x.name) === norm(clean));
  return hit
    ? {id: hit.id, name: hit.name}
    : {id: `${LOCAL_ID_PREFIX}${kind}:${norm(clean)}`, name: clean};
}

function byId(list: readonly Named[], id: Uuid): Named {
  const hit = list.find(x => x.id === id);
  return hit ? {id: hit.id, name: hit.name} : {id, name: ''};
}

const has = (input: In, key: string) =>
  Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;

/**
 * The reference a write sets: `undefined` = not sent (keep), `null` = cleared.
 * An id wins over a name, as on the server.
 */
function refFrom(
  input: In,
  idKey: string | null,
  nameKey: string | null,
  list: readonly Named[],
  kind: string,
): Named | null | undefined {
  if (idKey && has(input, idKey)) {
    const id = input[idKey] as Uuid | null;
    return id ? byId(list, id) : null;
  }
  if (nameKey && has(input, nameKey)) {
    const name = input[nameKey] as string | null;
    return name && name.trim() ? byName(list, name, kind) : null;
  }
  return undefined;
}

function pick<T>(input: In, key: string, fallback: T): T {
  return has(input, key) ? (input[key] as T) : fallback;
}

function meta(
  input: In,
  base: RecordMeta | null,
  ctx: OptimisticContext,
): RecordMeta {
  if (base) {
    return {
      ...base,
      updatedBy: ctx.user,
      updatedAt: ctx.now,
      source: pick(input, 'source', base.source),
      verification: pick(input, 'verification', base.verification),
    };
  }
  return {
    id: String(input.id),
    version: 0,
    createdBy: ctx.user,
    createdAt: ctx.now,
    updatedBy: ctx.user,
    updatedAt: ctx.now,
    source: pick(input, 'source', null),
    verification: pick(input, 'verification', 'draft'),
    isDemo: false,
  };
}

interface Slotted {
  date: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
}

/** Date, end date and instants after a write (unsent parts kept). */
function slot(input: In, base: Slotted | null, timezone: string): Slotted {
  const tz = base?.timezone ?? timezone;
  const was = base
    ? instantsToSlot(base.startsAt, base.endsAt, tz)
    : {date: null, startTime: null, endTime: null};
  const date = pick<LocalDate | null>(input, 'date', base?.date ?? null);
  const endDate = date
    ? pick<LocalDate | null>(input, 'endDate', base?.endDate ?? null)
    : null;
  const startTime = pick<LocalTime | null>(input, 'startTime', was.startTime);
  const endTime = pick<LocalTime | null>(input, 'endTime', was.endTime);
  const {startsAt, endsAt} = slotToInstants(
    date,
    startTime,
    endTime,
    tz,
    endDate,
  );
  return {date, endDate, startsAt, endsAt, timezone: tz};
}

function event(input: In, base: LogisticsEvent | null, ctx: OptimisticContext) {
  const venue = refFrom(input, null, 'venueName', ctx.venues, 'venue');
  const out: LogisticsEvent = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    name: pick(input, 'name', base?.name ?? ''),
    venue: venue === undefined ? (base?.venue ?? null) : venue,
    ...slot(input, base, ctx.timezone),
    status: pick(input, 'status', base?.status ?? 'planned'),
    notes: pick(input, 'notes', base?.notes ?? null),
    restricted: false,
  };
  return out;
}

function task(input: In, base: Task | null, ctx: OptimisticContext) {
  const venue = refFrom(input, null, 'venueName', ctx.venues, 'venue');
  const company = refFrom(
    input,
    'companyId',
    'companyName',
    ctx.companies,
    'company',
  );
  const contact = refFrom(input, 'contactId', null, ctx.contacts, 'contact');
  const nextVenue = venue === undefined ? (base?.venue ?? null) : venue;
  const heavyLoad = pick<boolean | null>(
    input,
    'heavyLoad',
    base?.heavyLoad ?? null,
  );
  const resourceIds = pick<Uuid[]>(
    input,
    'resourceIds',
    base?.resourceIds ?? [],
  );
  const placementChanged =
    !!base &&
    ((base.venue?.id ?? null) !== (nextVenue?.id ?? null) ||
      base.heavyLoad !== heavyLoad ||
      !sameValue([...base.resourceIds].sort(), [...resourceIds].sort()));
  let subsoilReview = base?.subsoilReview ?? null;
  if (input.subsoilReviewed === true) {
    subsoilReview =
      subsoilReview && !placementChanged
        ? subsoilReview
        : {by: ctx.user, at: ctx.now};
  } else if (input.subsoilReviewed === false || placementChanged) {
    subsoilReview = null;
  }
  const out: Task = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    eventId: pick(input, 'eventId', base?.eventId ?? null),
    venue: nextVenue,
    title: pick(input, 'title', base?.title ?? ''),
    kind: pick(input, 'kind', base?.kind ?? 'other'),
    status: pick(input, 'status', base?.status ?? 'planned'),
    ...slot(input, base, ctx.timezone),
    company: company === undefined ? (base?.company ?? null) : company,
    contact: contact === undefined ? (base?.contact ?? null) : contact,
    dependsOn: pick(input, 'dependsOn', base?.dependsOn ?? []),
    heavyLoad,
    resourceIds,
    subsoilReview,
    notes: pick(input, 'notes', base?.notes ?? null),
    restricted: false,
  };
  return out;
}

function company(input: In, base: Company | null, ctx: OptimisticContext) {
  const out: Company = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    name: pick(input, 'name', base?.name ?? ''),
    kind: pick(input, 'kind', base?.kind ?? 'supplier'),
    categoryIds: pick(input, 'categoryIds', base?.categoryIds ?? []),
    phone: pick(input, 'phone', base?.phone ?? null),
    email: pick(input, 'email', base?.email ?? null),
    website: pick(input, 'website', base?.website ?? null),
    notes: pick(input, 'notes', base?.notes ?? null),
    mainContactId: pick(input, 'mainContactId', base?.mainContactId ?? null),
    contactCount: base?.contactCount ?? 0,
    offerCount: base?.offerCount ?? 0,
    restricted: false,
  };
  return out;
}

function contact(input: In, base: Contact | null, ctx: OptimisticContext) {
  const co = refFrom(
    input,
    'companyId',
    'companyName',
    ctx.companies,
    'company',
  );
  const out: Contact = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    name: pick(input, 'name', base?.name ?? ''),
    role: pick(input, 'role', base?.role ?? null),
    company: co === undefined ? (base?.company ?? null) : co,
    phone: pick(input, 'phone', base?.phone ?? null),
    email: pick(input, 'email', base?.email ?? null),
    description: pick(input, 'description', base?.description ?? null),
    notes: pick(input, 'notes', base?.notes ?? null),
    eventIds: pick(input, 'eventIds', base?.eventIds ?? []),
    restricted: false,
  };
  return out;
}

function offer(input: In, base: Offer | null, ctx: OptimisticContext) {
  const co = refFrom(
    input,
    'companyId',
    'companyName',
    ctx.companies,
    'company',
  );
  const unit = pick(input, 'unit', base?.unit ?? 'unit');
  const out: Offer = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    company: co ??
      base?.company ?? {id: `${LOCAL_ID_PREFIX}company:`, name: ''},
    categoryId: pick(input, 'categoryId', base?.categoryId ?? null),
    name: pick(input, 'name', base?.name ?? ''),
    description: pick(input, 'description', base?.description ?? null),
    price: pick(input, 'price', base?.price ?? null),
    unit,
    customUnit:
      unit === 'custom'
        ? pick(input, 'customUnit', base?.customUnit ?? null)
        : null,
    transportCost: pick(input, 'transportCost', base?.transportCost ?? null),
    assemblyCost: pick(input, 'assemblyCost', base?.assemblyCost ?? null),
    maintenanceCost: pick(
      input,
      'maintenanceCost',
      base?.maintenanceCost ?? null,
    ),
    conditions: pick(input, 'conditions', base?.conditions ?? null),
    vatIncluded: pick(input, 'vatIncluded', base?.vatIncluded ?? null),
    restricted: false,
  };
  return out;
}

function warehouse(input: In, base: Warehouse | null, ctx: OptimisticContext) {
  const out: Warehouse = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    name: pick(input, 'name', base?.name ?? ''),
    address: pick(input, 'address', base?.address ?? null),
    notes: pick(input, 'notes', base?.notes ?? null),
    resourceCount: base?.resourceCount ?? 0,
    restricted: false,
  };
  return out;
}

function resource(input: In, base: Resource | null, ctx: OptimisticContext) {
  const ownership = pick(input, 'ownership', base?.ownership ?? 'owned');
  const wh = refFrom(
    input,
    'warehouseId',
    'warehouseName',
    ctx.warehouses,
    'warehouse',
  );
  const co = refFrom(
    input,
    'companyId',
    'companyName',
    ctx.companies,
    'company',
  );
  const unit = pick<string>(input, 'unit', base?.unit ?? DEFAULT_RESOURCE_UNIT);
  const out: Resource = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    name: pick(input, 'name', base?.name ?? ''),
    ownership,
    categoryId: pick(input, 'categoryId', base?.categoryId ?? null),
    warehouse: wh === undefined ? (base?.warehouse ?? null) : wh,
    company:
      ownership === 'owned'
        ? null
        : co === undefined
          ? (base?.company ?? null)
          : co,
    offerId:
      ownership === 'owned'
        ? null
        : pick(input, 'offerId', base?.offerId ?? null),
    quantity: pick(input, 'quantity', base?.quantity ?? null),
    unit: unit.trim() ? unit : DEFAULT_RESOURCE_UNIT,
    dimensions: pick(input, 'dimensions', base?.dimensions ?? null),
    condition: pick(input, 'condition', base?.condition ?? 'unknown'),
    availability: pick(input, 'availability', base?.availability ?? 'unknown'),
    location: pick(input, 'location', base?.location ?? null),
    toAssess: pick(input, 'toAssess', base?.toAssess ?? false),
    notes: pick(input, 'notes', base?.notes ?? null),
    taskIds: base?.taskIds ?? [],
    restricted: false,
  };
  return out;
}

function note(input: In, base: Note | null, ctx: OptimisticContext) {
  const ev = refFrom(input, 'eventId', null, ctx.events, 'event');
  let ref = base?.ref ?? null;
  if (has(input, 'ref')) {
    const r = input.ref as {type: NoteRefType; id: Uuid} | null;
    ref = r
      ? {type: r.type, id: r.id, label: ctx.refLabel?.(r.type, r.id) ?? ''}
      : null;
  }
  const out: Note = {
    ...meta(input, base, ctx),
    organizationId: base?.organizationId ?? ctx.orgId,
    kind: pick(input, 'kind', base?.kind ?? 'note'),
    text: pick(input, 'text', base?.text ?? null),
    event: ev === undefined ? (base?.event ?? null) : ev,
    ref,
    resolved: pick(input, 'resolved', base?.resolved ?? false),
    restricted: false,
  };
  return out;
}

/**
 * The record as the device shows it after a queued write. `base` is the
 * current local copy for an update, null for a create (whose `input.id` is
 * the device-generated id).
 */
export function optimisticRecord(
  entity: OutboxEntity,
  input: In,
  base: OptimisticRecord | null,
  ctx: OptimisticContext,
): OptimisticRecord {
  switch (entity) {
    case 'event':
      return event(input, base as LogisticsEvent | null, ctx);
    case 'task':
      return task(input, base as Task | null, ctx);
    case 'company':
      return company(input, base as Company | null, ctx);
    case 'contact':
      return contact(input, base as Contact | null, ctx);
    case 'offer':
      return offer(input, base as Offer | null, ctx);
    case 'warehouse':
      return warehouse(input, base as Warehouse | null, ctx);
    case 'resource':
      return resource(input, base as Resource | null, ctx);
    case 'note':
      return note(input, base as Note | null, ctx);
  }
}
