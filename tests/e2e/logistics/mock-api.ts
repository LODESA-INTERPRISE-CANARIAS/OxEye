import {expect, type Page, type Route} from '@playwright/test';
import {
  delayBlocker,
  delayItems,
  sameShift,
  shiftExpectations,
} from '../../../shared/logistics/followup.ts';
import {hypothesisLabel, noteLabel} from '../../../shared/logistics/history.ts';
import {
  ACCEPT_REASON_MAX,
  ACCEPT_REASON_MIN,
  ACTIVITY_RANGE_MAX,
  ACTIVITY_RANGE_MAX_DAYS,
  BUILT_IN_RESOURCE_CATEGORIES,
  HYPOTHESIS_NOTE_MAX,
  MAX_RESOURCES_PER_TASK,
  MEDIA_CONTENT_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_SIDE,
  MEDIA_PER_RECORD,
  NOTE_KINDS,
  NOTE_TEXT_MAX,
  isValidDelay,
  isValidMove,
  isValidQuantity,
} from '../../../shared/logistics/rules.ts';
import {
  simulateDelay,
  simulateMove,
} from '../../../shared/logistics/schedule.ts';
// Revisión 1 · E2: moves, accepted conflicts, venue acronym and hours.
import {
  acceptanceApplies,
  isAcceptable,
  sameWindows,
  windowsFor,
} from '../../../shared/logistics/acceptance.ts';
import {acronymProblem} from '../../../shared/logistics/acronym.ts';
import {planWarnings} from '../../../shared/logistics/conflicts.ts';
import {
  MOVE_BLOCKED,
  moveBlocker,
  moveItems,
  openingHoursProblem,
  outsideHoursMessage,
  withinOpeningHours,
} from '../../../shared/logistics/move.ts';
import type {
  AcceptedWindow,
  DelayMode,
  NoteKind,
  OpeningHours,
  OrgRole,
  ShiftExpectation,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {
  effectivePermissions,
  isSharedAccount,
  normalizeRoles,
  rolePermissions,
} from '../../../shared/logistics/permissions.ts';
import {passwordProblem} from '../../../shared/logistics/account.ts';
// Revisión 1 · E5: taxes and budget.
import {
  budgetSummary,
  normalizeTax,
  priceEstimate,
  effectiveTax,
  sameTax,
  snapshotOf,
} from '../../../shared/logistics/money.ts';
import {
  NO_ACCESS,
  PROVISIONAL_HOLD,
  heldByProvisional,
} from '../../../shared/logistics/permissions.ts';
import {
  EXPENSE_STATUSES,
  MAX_EXPENSES_PER_EVENT,
  NOTES_MAX,
  isValidAmount,
} from '../../../shared/logistics/rules.ts';
import type {Offer, Permission} from '../../../shared/logistics/contracts.ts';
// Revisión 1 · E6–E7: offer versions, quote requests, proposals, renewals.
import {
  DEFAULT_RENEWAL_NOTICE_DAYS,
  RENEWAL_NOTICE_OPTIONS,
  renewalDue,
  versionStatus,
} from '../../../shared/logistics/offer-terms.ts';
import {
  LINK_TOKEN_RE,
  PROPOSAL_BODY_MAX_BYTES,
  PROPOSAL_ORIGIN_MAX,
  PROPOSAL_REASON_MAX,
  PROPOSAL_REASON_MIN,
  QUOTE_LINK_DAYS_DEFAULT,
  openOfferLinkHash,
  proposalFlags,
  proposalTax,
  proposalTerms,
  supplierLinkHash,
} from '../../../shared/logistics/proposals.ts';
import type {
  OfferTerms,
  ProposalContent,
  ProposalProductInput,
  TaxInfo,
} from '../../../shared/logistics/contracts.ts';
import {
  daysForInstants,
  slotToInstants,
  utcToLocal,
} from '../../../shared/logistics/time.ts';

/**
 * Stateful in-memory mock of the Logistics Manager API for behavioural E2E
 * tests (milestones 1 to 6). It follows the route table and error bodies of
 * `shared/logistics/contracts.ts` and `server/src`, keeps events, tasks,
 * venues and companies so refetches after a write see the change, and
 * records every request so tests can assert what the UI actually sent.
 *
 * Milestone 2 rules mirrored from `server/src/tasks`: only the title is
 * required; venue and company are found or created by name
 * (case-insensitive); times need a date and `endDate` must be after `date`;
 * `dependsOn` rejects unknown ids, self references and cycles (400
 * VALIDATION `fields.dependsOn`); PATCH and DELETE check `version` (409
 * VERSION_CONFLICT with `current`); DELETE needs `?version=` and removes the
 * task from its dependents' `dependsOn`, bumping their version.
 *
 * Milestone 4 rules mirrored from `server/src/{warehouses,resources,notes}`:
 * warehouse names are unique (409 DUPLICATE with `current`); a resource
 * finds or creates its warehouse (and, when contracted, its company) by
 * name, owned material never has a company or an offer, an offer must be of
 * the resource's company; `taskIds` and `resourceCount` are computed; notes
 * need a kind and a text and point at an event and/or one record. Deleting a
 * warehouse, resource, task, company, contact, offer or category unlinks
 * what pointed at it, bumping versions. Writes to warehouses, resources and
 * notes append to the activity log (a note's label is `noteLabel`, never its
 * text), and `/activity?entityType=&entityId=` returns one record's history.
 *
 * Milestone 5 rules mirrored from `server/src/{tasks,hypotheses}`:
 * `subsoilReviewed` is strict (400 `fields.subsoilReviewed` unless the
 * resulting `heavyLoad` is true); the declared `subsoilReview` is cleared when
 * the venue, `heavyLoad` or `resourceIds` change unless `true` is sent in the
 * same request, and declaring again with nothing relevant changed keeps the
 * original who and when. Delay hypotheses are listed newest first, created
 * (never applied), deleted while open (400 once applied) and applied only
 * when the shift recomputed with the shared `delayItems` / `simulateDelay` /
 * `shiftExpectations` equals the confirmed `expected` (`sameShift`);
 * otherwise 409 with `current` = the involved tasks and nothing changes.
 * `forceApplyConflict` answers the next applies with that 409 regardless.
 * Duplicate ids in `expected` are a 400. Deleting a task deletes its open
 * hypotheses and unlinks applied ones; deleting a resource clears the subsoil
 * mark of the tasks that used it, and changing its quantity, unit or
 * dimensions clears it on the live tasks that use it.
 *
 * Milestone 6 rules mirrored from `server/src/{records/device-id,activity}`:
 * the eight creates accept a device `id` (a free UUID creates the record
 * with it, 201; the same user's id again is a replay, 200 with the record as
 * it is and no side effect; anyone else's use is 400 `fields.id`).
 * `GET …/changes?since=` hands out integer cursors; without one, or with an
 * unknown one, it answers `full: true`; otherwise the types whose list
 * changed since that cursor (by fingerprint, so direct edits of `state`
 * count). `/activity?from=&to=` is the day-close range (`from` ≤ at < `to`,
 * same 400s). Faults for offline specs: `unreachable` (every call fails at
 * network level), `loseResponse` (handled, answer dropped), `forceConflict`
 * (next PATCH of a record is a 409), `rejectWrite` (next matching write is a
 * 400), `failActivityRange`, `changesSupported = false` (404, older server).
 * Revisión 1 · E3 mirrors `server/src/notes` (answers: one current answer
 * per open question, replaced only by naming it, 409 with `current`
 * otherwise; only the asker closes or reopens an answered question) and
 * `server/src/media` (photos on `resource.media` with their base64 `data`,
 * device-id replay, at most MEDIA_PER_RECORD, first one main).
 *
 * Guests are withheld `MOCK_WITHHELD`, a hand-written copy of the shared
 * `WITHHELD_FROM_GUESTS` (equality asserted in `mock-contract.spec.ts`).
 *
 * Only `/api/*` is intercepted: Vite module URLs such as
 * `/src/logistics/api/client.ts` must reach the dev server.
 */

export const ORG = '00000000-0000-4000-8000-000000000001';
export const SESSION_KEY = 'oxeye.logistics.session.v1';
export const TZ = 'Atlantic/Canary';
export const PASSWORD = 'secreto';
export const TOKEN = 'test-token';

/** Today in the organization's time zone, as the app computes it. */
export const today = new Intl.DateTimeFormat('en-CA', {timeZone: TZ}).format(
  new Date(),
);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const elvis = {id: 'u-elvis', displayName: 'Elvis'};
export const dailos = {id: 'u-dailos', displayName: 'Dailos'};

export const LOGIN_USERS = [
  {displayName: 'Elvis', role: 'member'},
  {displayName: 'Dailos', role: 'member'},
  {displayName: 'Yeray', role: 'member'},
  {displayName: 'Equipo', role: 'member'},
  {displayName: 'Invitado', role: 'guest'},
] as const;

// ---- Revisión 1 · E4 (roles and access): accounts as seeded on the server
// (server/src/seed/seed.ts `PILOT_USERS`). Login is by username, any case.
export const E4_ACCOUNTS: {
  username: string;
  role: 'member' | 'guest';
  roles: OrgRole[];
}[] = [
  {username: 'Elvis', role: 'member', roles: ['admin']},
  {username: 'Dailos', role: 'member', roles: ['admin']},
  {username: 'Yeray', role: 'member', roles: ['admin']},
  {username: 'Equipo', role: 'member', roles: ['team']},
  {username: 'Invitado', role: 'guest', roles: []},
  {username: 'Fabián', role: 'member', roles: ['admin', 'developer']},
];

/** E4 per-account state a spec may set (`MockOptions.accounts`). */
export interface MockAccount {
  passwordProvisional?: boolean;
  /** Default true, so the first-login welcome does not get in the way. */
  welcomed?: boolean;
  roles?: OrgRole[];
}

/** E4: an account as the mock keeps it (profile, password, sessions, log). */
export interface E4Live {
  username: string;
  role: 'member' | 'guest';
  roles: OrgRole[];
  displayName: string;
  bio: string | null;
  accent: string | null;
  avatarId: string | null;
  provisional: boolean;
  welcomed: boolean;
  /** Verified recovery address, in clear (the mock masks it on the way out). */
  recovery: string | null;
  pending: string | null;
  version: number;
  password: string;
  lastLoginAt: string | null;
  /** Other sessions of the account (the current one is added on the way out). */
  otherSessions: {id: string; device: string; createdAt: string}[];
  log: Record<string, unknown>[];
}

export const e4Id = (a: {username: string}) => `u-${a.username.toLowerCase()}`;

/** E4 link tokens the mock accepts (43 characters, as the server's). */
export const RESET_TOKEN = 'r'.repeat(43);
export const VERIFY_TOKEN = 'v'.repeat(43);
/** Token of a support or «Ver como Invitado» session in the mock. */
export const SUPPORT_TOKEN = 'support-token';
export const PROVISIONAL_PASSWORD = 'Provisional-2026';

function e4Accounts(overrides: Record<string, MockAccount> = {}) {
  const at = '2026-11-20T08:00:00.000Z';
  return Object.fromEntries(
    E4_ACCOUNTS.map(a => {
      const extra = overrides[a.username] ?? {};
      const shared = isSharedAccount(a.role, [extra.roles ?? a.roles]);
      const live: E4Live = {
        username: a.username,
        role: a.role,
        roles: extra.roles ?? a.roles,
        displayName: a.username,
        bio: null,
        accent: null,
        avatarId: null,
        provisional: a.role === 'guest' ? false : !!extra.passwordProvisional,
        welcomed: extra.welcomed ?? true,
        recovery: shared ? null : `${a.username.toLowerCase()}@example.com`,
        pending: null,
        version: 1,
        password: PASSWORD,
        lastLoginAt: at,
        otherSessions:
          a.role === 'guest'
            ? []
            : [
                {
                  id: `s-${a.username.toLowerCase()}-phone`,
                  device: 'Safari · iPhone',
                  createdAt: at,
                },
              ],
        log: [
          {
            id: `sec-${a.username.toLowerCase()}-1`,
            kind: 'login',
            user: {id: e4Id(a), displayName: a.username},
            actor: null,
            at,
            detail: null,
            device: 'Safari · iPhone',
          },
        ],
      };
      return [a.username, live];
    }),
  );
}

type Json = Record<string, unknown>;

export interface LocalSlot {
  date?: string | null;
  /** Last day of a multi-day record. */
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
}

/** A contract-shaped event; local slot converted with the shared helper. */
export function makeEvent(
  id: string,
  name: string,
  slot: LocalSlot,
  extra: Json = {},
): Json {
  const date = slot.date ?? null;
  const endDate = slot.endDate ?? null;
  const {startsAt, endsAt} = slotToInstants(
    date,
    slot.start,
    slot.end,
    TZ,
    endDate,
  );
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    venue: null,
    date,
    endDate,
    startsAt,
    endsAt,
    timezone: TZ,
    status: 'planned',
    notes: null,
    restricted: false,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
}

export function defaultEvents(): Json[] {
  return [
    makeEvent(
      'e1',
      'Navidad en la Plaza del Cristo',
      {date: today, start: '17:00', end: '21:00'},
      {
        venue: {id: 'v1', name: 'Plaza del Cristo'},
        status: 'confirmed',
        verification: 'validated',
        source: 'document',
      },
    ),
    makeEvent(
      'e2',
      'Concierto de villancicos',
      {date: today, start: '19:30', end: '22:00'},
      {
        venue: {id: 'v2', name: 'Plaza del Adelantado'},
        verification: 'to_verify',
        source: 'reported',
      },
    ),
    makeEvent('e3', 'Mercadillo navideño', {
      date: addDays(today, 1),
      start: '10:00',
    }),
  ];
}

export const demoEvent = (): Json =>
  makeEvent('e-demo', 'Cabalgata de demostración', {}, {isDemo: true});

/** A contract-shaped task (milestone 2); same slot rules as events. */
export function makeTask(
  id: string,
  title: string,
  slot: LocalSlot = {},
  extra: Json = {},
): Json {
  const date = slot.date ?? null;
  const endDate = slot.endDate ?? null;
  const {startsAt, endsAt} = slotToInstants(
    date,
    slot.start,
    slot.end,
    TZ,
    endDate,
  );
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    eventId: null,
    venue: null,
    title,
    kind: 'other',
    status: 'planned',
    date,
    endDate,
    startsAt,
    endsAt,
    timezone: TZ,
    company: null,
    contact: null,
    dependsOn: [],
    heavyLoad: null,
    resourceIds: [],
    subsoilReview: null,
    notes: null,
    restricted: false,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
}

/** A contract-shaped delay hypothesis (milestone 5). Fictitious note only. */
export function makeHypothesis(
  id: string,
  task: {id: string; title: string},
  delayMinutes: number,
  extra: Json = {},
): Json {
  return {
    id,
    organizationId: ORG,
    taskId: task.id,
    taskTitle: task.title,
    delayMinutes,
    mode: 'shift',
    estimated: false,
    note: null,
    createdBy: elvis,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    appliedAt: null,
    appliedBy: null,
    restricted: false,
    ...extra,
  };
}

/** A contract-shaped company (milestone 3 shape; M2 only lists them by name). */
export function makeCompany(id: string, name: string, extra: Json = {}): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    kind: 'supplier',
    contactCount: 0,
    restricted: false,
    categoryIds: [],
    phone: null,
    email: null,
    website: null,
    notes: null,
    mainContactId: null,
    offerCount: 0,
    source: null,
    verification: 'draft',
    isDemo: false,
    // Revisión 1 · E5: nobody has said which tax it charges.
    tax: null,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
}

/** Stable id of a built-in category: `cat-` + name without accents. */
export const categoryId = (name: string) =>
  `cat-${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;

/** The built-in service categories, as the server seeds them. */
export const BUILT_IN_CATEGORIES = [
  'Montaje',
  'Estructuras',
  'Carpas',
  'Vallas',
  'Transporte',
  'Catering',
  'Publicidad',
  'Personal',
  'Seguridad',
  'Sonido',
  'Iluminación',
  'Audiovisuales',
  'Limpieza',
  'Ocio',
  'Otros servicios',
];

/** Stable id of a built-in resource category (M4): `rcat-` + name. */
export const resourceCategoryId = (name: string) => `r${categoryId(name)}`;

/** The built-in service categories, then the resource ones (M4), as seeded. */
export function makeCategories(): Json[] {
  return [
    ...BUILT_IN_CATEGORIES.map(name => ({
      id: categoryId(name),
      organizationId: ORG,
      scope: 'service',
      name,
      builtIn: true,
    })),
    ...BUILT_IN_RESOURCE_CATEGORIES.map(name => ({
      id: resourceCategoryId(name),
      organizationId: ORG,
      scope: 'resource',
      name,
      builtIn: true,
    })),
  ];
}

const meta = (extra: Json = {}): Json => {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    version: 1,
    organizationId: ORG,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
};

/**
 * Revisión 1: a warehouse's acronym and opening hours, checked as the server
 * checks them (`fields.acronym`, `fields.openingHours`); null when valid.
 */
function placeProblems(input: Json): Record<string, string> | null {
  const fields: Record<string, string> = {};
  if (typeof input.acronym === 'string') {
    const problem = acronymProblem(input.acronym);
    if (problem) fields.acronym = problem;
  }
  const hours = input.openingHours as OpeningHours | null | undefined;
  if (hours) {
    const problem = openingHoursProblem(hours);
    if (problem) fields.openingHours = problem;
  }
  return Object.keys(fields).length ? fields : null;
}

/** A contract-shaped warehouse (milestone 4); `resourceCount` is computed. */
export function makeWarehouse(
  id: string,
  name: string,
  extra: Json = {},
): Json {
  return {
    id,
    name,
    address: null,
    notes: null,
    acronym: null,
    openingHours: null,
    resourceCount: 0,
    restricted: false,
    ...meta(extra),
  };
}

/** A contract-shaped inventory resource (milestone 4); `taskIds` is computed. */
export function makeResource(id: string, name: string, extra: Json = {}): Json {
  return {
    id,
    name,
    ownership: 'owned',
    categoryId: null,
    warehouse: null,
    company: null,
    offerId: null,
    quantity: null,
    unit: 'unidades',
    dimensions: null,
    condition: 'unknown',
    availability: 'unknown',
    location: null,
    toAssess: false,
    notes: null,
    taskIds: [],
    media: [],
    restricted: false,
    ...meta(extra),
  };
}

/** A contract-shaped note (milestone 4). Fictitious text only. */
export function makeNote(
  id: string,
  kind: NoteKind,
  text: string,
  extra: Json = {},
): Json {
  return {
    id,
    kind,
    text,
    event: null,
    ref: null,
    resolved: false,
    answer: null,
    resolvedBy: null,
    resolvedAt: null,
    restricted: false,
    ...meta(extra),
  };
}

/** A contract-shaped answer to an open question (Revisión 1 · E3). */
export function makeAnswer(
  id: string,
  noteId: string,
  text: string,
  extra: Json = {},
): Json {
  return {
    id,
    noteId,
    text,
    answeredBy: dailos,
    answeredAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    replacesId: null,
    restricted: false,
    ...extra,
  };
}

/**
 * A tiny real PNG (1 × 1 px), base64: the default bytes of a seeded photo
 * (`makeMedia`); specs that look at photos pass their own `data`.
 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A stored photo of a resource (MediaInfo shape plus its base64 `data`). */
export function makeMedia(id: string, ownerId: string, extra: Json = {}): Json {
  return {
    id,
    ownerType: 'resource',
    ownerId,
    contentType: 'image/png',
    bytes: 70,
    width: 1,
    height: 1,
    main: false,
    createdBy: dailos,
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    data: TINY_PNG_BASE64,
    ...extra,
  };
}

/** A contract-shaped activity entry, for seeding a record's history. */
export function makeActivity(
  id: string,
  entity: {type: string; id: string; label: string},
  action: 'create' | 'update' | 'delete',
  at: string,
  extra: Json = {},
): Json {
  return {
    id,
    user: elvis,
    entityType: entity.type,
    entityId: entity.id,
    entityLabel: entity.label,
    action,
    changedFields: [],
    at,
    ...extra,
  };
}

/** A contract-shaped person (milestone 3). Fictitious data only. */
export function makeContact(id: string, name: string, extra: Json = {}): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    name,
    role: null,
    company: null,
    phone: null,
    email: null,
    description: null,
    notes: null,
    eventIds: [],
    restricted: false,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
}

/** A contract-shaped catalogue offer (milestone 3). */
export function makeOffer(
  id: string,
  name: string,
  company: {id: string; name: string},
  extra: Json = {},
): Json {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id,
    version: 1,
    organizationId: ORG,
    company: {...company},
    categoryId: null,
    name,
    description: null,
    price: null,
    unit: 'unit',
    customUnit: null,
    transportCost: null,
    assemblyCost: null,
    maintenanceCost: null,
    conditions: null,
    vatIncluded: null,
    // Revisión 1 · E5: own tax (null = the company's); `companyTax` is
    // derived from the company when served.
    tax: null,
    companyTax: null,
    restricted: false,
    source: null,
    verification: 'draft',
    isDemo: false,
    createdBy: elvis,
    createdAt: created,
    updatedBy: elvis,
    updatedAt: created,
    ...extra,
  };
}

// ---- Revisión 1 · E6–E7 fixtures (contract shapes of shared/logistics/contracts.ts)

/** Link tokens the public routes accept in specs (43 characters, as the server's). */
export const SUPPLIER_TOKEN = 's'.repeat(43);
export const OPEN_TOKEN = 'o'.repeat(43);

/** The terms of an offer version; per unit and day, before tax by default. */
export function makeTerms(extra: Partial<OfferTerms> = {}): OfferTerms {
  return {
    basis: 'unit_day',
    customUnit: null,
    price: null,
    pricesIncludeTax: false,
    seasonal: [],
    supplements: [],
    notIncluded: [],
    minimumDays: null,
    minimumQuantity: null,
    minimumOrder: null,
    acceptUntil: null,
    serviceMonths: null,
    serviceNote: null,
    commitment: null,
    conditions: null,
    available: null,
    tax: null,
    ...extra,
  };
}

/** One offer version; `status` is computed when served. */
export function makeOfferVersion(
  id: string,
  offerId: string,
  number: number,
  terms: OfferTerms,
  extra: Json = {},
): Json {
  const created = new Date(
    Date.now() - (10 - number) * 86_400_000,
  ).toISOString();
  return {
    id,
    organizationId: ORG,
    offerId,
    number,
    status: 'current',
    terms,
    changeNote: null,
    proposalId: null,
    approvedBy: elvis,
    createdBy: elvis,
    createdAt: created,
    supersededAt: null,
    ...extra,
  };
}

/** One personal link of a request (`QuoteRequestLink`). */
export function makeQuoteLink(
  id: string,
  company: {id: string; name: string},
  extra: Json = {},
): Json {
  return {
    id,
    company: {...company},
    status: 'waiting',
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    expired: false,
    openedAt: null,
    answeredAt: null,
    declineReason: null,
    proposalId: null,
    ...extra,
  };
}

export function makeQuoteRequest(
  id: string,
  need: Json,
  links: Json[],
  extra: Json = {},
): Json {
  return {
    id,
    organizationId: ORG,
    need: {
      title: 'Carpas',
      categoryId: null,
      quantity: 1,
      unitLabel: null,
      days: 1,
      hoursPerDay: null,
      dateFrom: null,
      dateTo: null,
      note: null,
      ...need,
    },
    eventId: null,
    offerId: null,
    status: 'open',
    links,
    createdBy: elvis,
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    closedBy: null,
    closedAt: null,
    version: 1,
    ...extra,
  };
}

/** A pending proposal; `content` as stored (`ProposalContent`). */
export function makeProposal(
  id: string,
  content: Partial<ProposalContent> & {company: {name: string}},
  extra: Json = {},
): Json {
  return {
    id,
    organizationId: ORG,
    via: 'link',
    state: 'pending',
    receivedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    request: null,
    offer: null,
    company: null,
    content: {
      products: [],
      tax: null,
      pricesIncludeTax: false,
      acceptUntil: null,
      serviceMonths: null,
      privacyVersion: '2026-11-27-borrador',
      ...content,
    },
    origin: null,
    flags: [],
    createdBy: null,
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    result: [],
    version: 1,
    ...extra,
  };
}

export function makeRenewal(
  id: string,
  offer: {id: string; name: string},
  company: {id: string; name: string},
  extra: Json = {},
): Json {
  return {
    id,
    organizationId: ORG,
    taskId: null,
    offer: {...offer},
    company: {...company},
    versionNumber: 1,
    acceptUntil: addDays(today, 20),
    noticeDays: DEFAULT_RENEWAL_NOTICE_DAYS,
    assignee: elvis,
    generatedBy: 'ox_eye',
    generatedAt: new Date(Date.now() - 86_400_000).toISOString(),
    resolvedAt: null,
    resolvedByVersion: null,
    version: 1,
    ...extra,
  };
}

export interface RecordedRequest {
  method: string;
  /** Path without the `/api` prefix and without the query string. */
  path: string;
  /** Query string including the leading `?`, or '' when there is none. */
  query: string;
  body: unknown;
  authorization: string | null;
}

export interface MockOptions {
  health?: 'ok' | 'down' | 'database';
  events?: Json[];
  tasks?: Json[];
  /** E2: may carry `acronym`, `openingHours` and `version`. */
  venues?: ({id: string; name: string} & Json)[];
  companies?: Json[];
  /** Milestone 3. Categories default to the built-in service ones. */
  categories?: Json[];
  contacts?: Json[];
  offers?: Json[];
  /** Recent searches of the signed-in member, newest first. */
  recentSearches?: {query: string; at: string}[];
  /** Milestone 4. */
  warehouses?: Json[];
  /** E3: a resource's photos live in its `media` (with their `data`). */
  resources?: Json[];
  /** E3: a note's current answer lives in its `answer`. */
  notes?: Json[];
  /** E3: earlier (replaced) answers; current ones are added from notes. */
  answers?: Json[];
  /** Activity log entries (any order; served newest first). */
  activity?: Json[];
  /** Milestone 5: stored delay hypotheses (any order; served newest first). */
  hypotheses?: Json[];
  /** Revisión 1 · E2: accepted conflicts («Mantener ambas»). */
  acceptances?: Json[];
  /**
   * Fixed time for milestone 4 writes (`createdAt`, activity `at`), to match
   * a page whose clock is fixed (plan-fixtures.ts `NOW`).
   */
  now?: string;
  /** Revisión 1 · E4: per-account state by username (provisional, welcome). */
  accounts?: Record<string, MockAccount>;
  /** Revisión 1 · E5: stored event budgets (`EventBudget` shape). */
  budgets?: Json[];
  /** Revisión 1 · E5: stored expenses (`Expense` shape). */
  expenses?: Json[];
  /** Revisión 1 · E6: offer versions (`makeOfferVersion`). */
  offerVersions?: Json[];
  /** Revisión 1 · E7: quote requests with their links (`makeQuoteRequest`). */
  quoteRequests?: Json[];
  /** E7: proposals in the inbox (`makeProposal`). */
  proposals?: Json[];
  /** E6: renewal marks (`makeRenewal`). */
  renewals?: Json[];
  /** E6: `OfferSettings` fields to override. */
  offerSettings?: Json;
  /** E7: link tokens the public routes accept (`requestId` null = open link). */
  supplierLinks?: {
    token: string;
    requestId: string | null;
    linkId: string | null;
  }[];
}

export interface MockApi {
  /** Mutable: flip it during a test to simulate the server changing. */
  health: 'ok' | 'down' | 'database';
  /**
   * Revisión 1 · E4: accounts by username, and whether the server has a
   * mail transport (reset links are then e-mailed, 202, not shown).
   */
  e4: {accounts: Record<string, E4Live>; mailConfigured: boolean};
  /** When true every authenticated call answers 401 UNAUTHENTICATED. */
  sessionExpired: boolean;
  /** When true writes (POST/PATCH/DELETE) fail at network level. */
  writesOffline: boolean;
  /**
   * M6: when true every `/api` call, `/health` included, fails at network
   * level (the network is there, the server is not).
   */
  unreachable: boolean;
  /** M6: false makes `GET …/changes` answer 404, as an older server. */
  changesSupported: boolean;
  /**
   * M6: a server bug. Guests receive the withheld fields (still marked
   * `restricted: true`), so a spec can check the device cache withholds them
   * again by itself.
   */
  leakToGuests: boolean;
  /** M6: day-close activity requests (`from`/`to`) that answer 500 next. */
  failActivityRange: number;
  /**
   * M6: the next PATCH of record `id` answers 409 VERSION_CONFLICT with the
   * record as it is (another person's change that the device has not seen).
   */
  forceConflict: (id: string, times?: number) => void;
  /**
   * M6: the next matching request is handled (the server keeps its effect)
   * but its answer never reaches the browser: a lost response.
   */
  loseResponse: (method: string, path: string | RegExp, times?: number) => void;
  /** M6: the next matching write answers 400 VALIDATION with `fields`. */
  rejectWrite: (
    method: string,
    path: string | RegExp,
    fields: Record<string, string>,
    times?: number,
  ) => void;
  /** M6: the cursors `GET …/changes` handed out (index = cursor). */
  cursors: number;
  /** Server-side records; tests may edit them to simulate another user. */
  events: Json[];
  tasks: Json[];
  venues: ({id: string; name: string} & Json)[];
  companies: Json[];
  categories: Json[];
  contacts: Json[];
  offers: Json[];
  recentSearches: {query: string; at: string}[];
  warehouses: Json[];
  resources: Json[];
  notes: Json[];
  /** E3: every answer ever given (current and replaced), with text. */
  answers: Json[];
  activity: Json[];
  /** Milestone 5: stored delay hypotheses. */
  hypotheses: Json[];
  /** Revisión 1 · E2: accepted conflicts, with their reason. */
  acceptances: Json[];
  /**
   * Revisión 1 · E2 (Organización): the one organization as `/me` and the
   * login answer list it (`acronym`, `version`). Tests may edit it to
   * simulate another person changing the acronym.
   */
  organization: Json;
  /**
   * E2: the next moves (`POST /tasks/:id/move`) that answer 409 with the
   * involved tasks, changing nothing: a plan that changed meanwhile.
   */
  forceMoveConflict: number;
  /**
   * Apply requests (`POST /hypotheses/:id/apply`) that answer 409 next with
   * the involved tasks as they are, changing nothing: a plan that changed
   * between the confirmation and the write.
   */
  forceApplyConflict: number;
  /** History requests (`entityType` + `entityId`) that fail with a 500 next. */
  failHistory: number;
  /** Revisión 1 · E5: event budgets that were set (`EventBudget` shape). */
  budgets: Json[];
  /** Revisión 1 · E5: every expense, server-side (`Expense` shape). */
  expenses: Json[];
  /** E5: budget reads (`GET /events/:id/budget`) that answer 500 next. */
  failBudget: number;
  /** Revisión 1 · E6: every offer version (status computed when served). */
  offerVersions: Json[];
  /** E7: quote requests with their links. */
  quoteRequests: Json[];
  /** E7: proposals, every state. */
  proposals: Json[];
  /** E6: renewal marks. */
  renewals: Json[];
  /** E6: the organization's `OfferSettings`. */
  offerSettings: Json;
  /** E7: tokens the public routes accept (`requestId` null = the open link). */
  supplierLinks: {
    token: string;
    requestId: string | null;
    linkId: string | null;
  }[];
  /** E7: the next public calls that answer 429 RATE_LIMITED (Retry-After 120). */
  publicLimited: number;
  /**
   * Holds every history request until the returned function is called, so a
   * spec can see the loading state without depending on timing.
   */
  holdHistory: () => () => void;
  requests: RecordedRequest[];
  /** Requests matching a method and a path (string or pattern). */
  calls: (method: string, path: string | RegExp) => RecordedRequest[];
  /** Simulates another person saving an event: bumps its version. */
  editOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Simulates another person saving a task: bumps its version. */
  editTaskOnServer: (id: string, patch: Json, by?: typeof dailos) => Json;
  /** Milestones 3–4: another person saving a directory or inventory record. */
  editDirectoryOnServer: (
    list:
      | 'companies'
      | 'contacts'
      | 'offers'
      | 'warehouses'
      | 'resources'
      | 'notes',
    id: string,
    patch: Json,
    by?: typeof dailos,
  ) => Json;
}

/**
 * Same withholding as `WITHHELD_FROM_GUESTS` in
 * `shared/logistics/redaction.ts` (the server and the device cache apply
 * it): guests never receive contact details, prices or free-text
 * observations. Written out by hand on purpose, so a change to the shared
 * list is a visible decision here too; `mock-contract.spec.ts` asserts that
 * both lists are equal.
 */
export const MOCK_WITHHELD = {
  event: ['notes'],
  task: ['notes', 'contact'],
  contact: ['phone', 'email', 'description', 'notes'],
  company: ['phone', 'email', 'notes'],
  offer: [
    'price',
    'transportCost',
    'assemblyCost',
    'maintenanceCost',
    'conditions',
    // Revisión 1 · E5: taxes go with the prices.
    'tax',
    'companyTax',
  ],
  warehouse: ['address', 'notes'],
  resource: ['location', 'notes'],
  note: ['text'],
  hypothesis: ['note'],
  answer: ['text'],
  acceptance: ['reason'],
} as const;

/**
 * Safety audit: same as `DIRECTORY_REF_LABEL` in redaction.ts (asserted in
 * `mock-contract.spec.ts`). For guests, the company of a task or a resource
 * and a note's link to a company, person or offer read as what they are;
 * the activity label of a note on a company or an offer never names it.
 */
export const MOCK_DIRECTORY_REF_LABEL = {
  company: 'Empresa',
  contact: 'Persona de contacto',
  offer: 'Oferta del catálogo',
} as const;

/** The eight creates that accept a device id (M6), by path. */
const DEVICE_ID_CREATES = {
  '/events': 'events',
  '/tasks': 'tasks',
  '/companies': 'companies',
  '/contacts': 'contacts',
  '/offers': 'offers',
  '/warehouses': 'warehouses',
  '/resources': 'resources',
  '/notes': 'notes',
} as const;
type DeviceIdList = (typeof DEVICE_ID_CREATES)[keyof typeof DEVICE_ID_CREATES];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lists `GET …/changes` reports, with the activity type each one stands for. */
const CHANGE_TYPES = {
  events: 'event',
  tasks: 'task',
  venues: 'venue',
  companies: 'company',
  categories: 'category',
  contacts: 'contact',
  offers: 'offer',
  warehouses: 'warehouse',
  resources: 'resource',
  notes: 'note',
  hypotheses: 'hypothesis',
  acceptances: 'conflict_acceptance',
} as const;

const VENUES = [
  {id: 'v1', name: 'Plaza del Cristo'},
  {id: 'v2', name: 'Plaza del Adelantado'},
];

// Revisión 1 · E3: same texts as server/src/notes/service.ts and
// server/src/media (schemas.ts, service.ts).
const NOTE_NOT_FOUND = 'No encontramos esa nota: puede que se haya eliminado.';
const ONLY_THE_ASKER =
  'Solo quien hizo la pregunta puede darla por respondida (o reabrirla) cuando ya tiene una respuesta.';
const KIND_HAS_ANSWERS =
  'Esta pregunta ya tiene respuestas: no se puede cambiar a otro tipo de nota.';
const NOT_A_QUESTION = 'Solo las preguntas abiertas reciben respuestas.';
const QUESTION_CLOSED =
  'Esta pregunta ya está dada por respondida: quien la hizo puede reabrirla si hace falta otra respuesta.';
const ANSWER_CHANGED =
  'La respuesta ha cambiado mientras escribías. Mira la respuesta actual y quién la dio antes de sustituirla.';
const REPLACES_UNKNOWN =
  'Esa respuesta no es de esta pregunta. Vuelve a abrirla y responde de nuevo.';
const MEDIA_NOT_FOUND =
  'No encontramos esa foto: puede que otra persona la haya borrado.';
const MEDIA_OWNER_NOT_FOUND =
  'No encontramos ese material en esta organización: puede que se haya eliminado.';
const MEDIA_OWNER_TYPE_LATER =
  'Por ahora solo se pueden añadir fotos a los materiales del inventario.';
const MEDIA_TOO_MANY = `Este material ya tiene ${MEDIA_PER_RECORD} fotos: borra una para añadir otra.`;
const MEDIA_TOO_BIG = `La foto ocupa demasiado (máximo ${Math.round(MEDIA_MAX_BYTES / 1024)} KB). Vuelve a elegirla para que se reduzca.`;
const MEDIA_NOT_AN_IMAGE =
  'No hemos podido leer esta foto: usa una imagen JPEG, PNG o WebP.';
const MEDIA_TYPE_MISMATCH =
  'El tipo de la foto no coincide con su contenido: vuelve a elegirla.';
const MEDIA_TYPE_INVALID = 'Tipo de imagen no válido: usa JPEG, PNG o WebP.';
const MEDIA_SIDE_INVALID = `Medida no válida: un número entero de píxeles entre 1 y ${MEDIA_MAX_SIDE}.`;
const MEDIA_DATA_INVALID =
  'La foto no ha llegado bien (se esperaba base64 sin prefijo). Vuelve a elegirla.';

/**
 * The image type its first bytes announce (as server/src/media/image.ts
 * reads the header; the mock does not check the declared size against it).
 */
function imageKind(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Same texts as server/src/tasks (domain.ts, schemas.ts, service.ts).
const TASK_CONFLICT =
  'Otra persona ha cambiado esta tarea mientras la editabas. Revisa la versión actual antes de guardar tus cambios.';
const DEPENDS_ON_SELF = 'Una tarea no puede depender de sí misma.';
const DEPENDS_ON_UNKNOWN =
  'Alguna de las tareas previas ya no existe o no es de esta organización.';
const VERSION_MISSING =
  'Falta la versión del registro: recarga la tarea y vuelve a intentarlo.';

const nameKey = (s: string) => s.trim().toLocaleLowerCase('es-ES');
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Local date and times of a stored record, for partial slot updates. */
function storedSlot(record: Json) {
  const local = (iso: unknown) =>
    typeof iso === 'string' ? utcToLocal(iso, TZ).time : null;
  return {
    date: (record.date as string | null) ?? null,
    endDate: (record.endDate as string | null) ?? null,
    startTime: local(record.startsAt),
    endTime: local(record.endsAt),
  };
}

/** Slot rules of the contract; returns field errors (empty when valid). */
function slotProblems(slot: {
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if ((slot.startTime || slot.endTime) && !slot.date) {
    fields.date = 'Indica la fecha para poder guardar el horario.';
  }
  if (slot.endDate && !slot.date) {
    fields.endDate = 'Indica el primer día para poder guardar varios días.';
  } else if (slot.endDate && slot.date && slot.endDate <= slot.date) {
    fields.endDate = 'El último día tiene que ser posterior al primero.';
  }
  return fields;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const error = (route: Route, status: number, code: string, message: string) =>
  json(route, {code, message}, status);

export async function mockApi(
  page: Page,
  opts: MockOptions = {},
): Promise<MockApi> {
  let currentUser: {
    id: string;
    displayName: string;
    role: string;
    [e4: string]: unknown;
  } | null = null;
  let seq = 0;
  let historyGate: Promise<void> | null = null;
  /** Time of milestone 4 writes: the page's fixed clock when a spec sets it. */
  const clock = () => opts.now ?? new Date().toISOString();
  // M6 one-shot faults, matched against method + path.
  type Fault = {method: string; path: string | RegExp; times: number};
  const lost: Fault[] = [];
  const rejected: (Fault & {fields: Record<string, string>})[] = [];
  const conflicts = new Map<string, number>();
  const takeFault = <F extends Fault>(
    list: F[],
    method: string,
    path: string,
  ): F | null => {
    const f = list.find(
      x =>
        x.times > 0 &&
        x.method === method &&
        (typeof x.path === 'string' ? x.path === path : x.path.test(path)),
    );
    if (!f) return null;
    f.times--;
    return f;
  };
  /** Fingerprints of every list per cursor handed out by `…/changes`. */
  const snapshots: Record<string, string>[] = [];

  const state: MockApi = {
    health: opts.health ?? 'ok',
    e4: {accounts: e4Accounts(opts.accounts), mailConfigured: false},
    sessionExpired: false,
    writesOffline: false,
    unreachable: false,
    changesSupported: true,
    leakToGuests: false,
    failActivityRange: 0,
    forceConflict: (id, times = 1) => {
      conflicts.set(id, (conflicts.get(id) ?? 0) + times);
    },
    loseResponse: (method, path, times = 1) => {
      lost.push({method, path, times});
    },
    rejectWrite: (method, path, fields, times = 1) => {
      rejected.push({method, path, fields, times});
    },
    get cursors() {
      return snapshots.length;
    },
    events: opts.events ?? defaultEvents(),
    tasks: opts.tasks ?? [],
    venues: opts.venues ?? VENUES.map(v => ({...v})),
    companies: opts.companies ?? [],
    categories: opts.categories ?? makeCategories(),
    contacts: opts.contacts ?? [],
    offers: opts.offers ?? [],
    recentSearches: opts.recentSearches ?? [],
    warehouses: opts.warehouses ?? [],
    resources: opts.resources ?? [],
    notes: opts.notes ?? [],
    answers: [
      ...(opts.answers ?? []),
      ...(opts.notes ?? [])
        .map(n => n.answer as Json | null)
        .filter(
          (a): a is Json =>
            !!a && !(opts.answers ?? []).some(x => x.id === a.id),
        ),
    ],
    activity: opts.activity ?? [],
    hypotheses: opts.hypotheses ?? [],
    acceptances: opts.acceptances ?? [],
    organization: {
      id: ORG,
      name: 'Ayuntamiento de La Laguna',
      timezone: TZ,
      acronym: null,
      version: 1,
    },
    forceMoveConflict: 0,
    forceApplyConflict: 0,
    failHistory: 0,
    budgets: opts.budgets ?? [],
    expenses: opts.expenses ?? [],
    failBudget: 0,
    offerVersions: opts.offerVersions ?? [],
    quoteRequests: opts.quoteRequests ?? [],
    proposals: opts.proposals ?? [],
    renewals: opts.renewals ?? [],
    offerSettings: {
      organizationId: ORG,
      renewalNoticeDays: DEFAULT_RENEWAL_NOTICE_DAYS,
      openLink: {enabled: false, createdAt: null},
      version: 0,
      updatedBy: null,
      updatedAt: null,
      ...opts.offerSettings,
    },
    supplierLinks: opts.supplierLinks ?? [],
    publicLimited: 0,
    holdHistory: () => {
      let release = () => {};
      historyGate = new Promise<void>(resolve => {
        release = () => {
          historyGate = null;
          resolve();
        };
      });
      return release;
    },
    requests: [],
    calls: (method, path) =>
      state.requests.filter(
        r =>
          r.method === method &&
          (typeof path === 'string' ? r.path === path : path.test(r.path)),
      ),
    editOnServer: (id, patch, by = dailos) => {
      const event = state.events.find(e => e.id === id);
      if (!event) throw new Error(`No event ${id}`);
      Object.assign(event, patch, {
        version: (event.version as number) + 1,
        updatedBy: by,
        updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      return event;
    },
    editTaskOnServer: (id, patch, by = dailos) => {
      const task = state.tasks.find(t => t.id === id);
      if (!task) throw new Error(`No task ${id}`);
      Object.assign(task, patch, {
        version: (task.version as number) + 1,
        updatedBy: by,
        updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      return task;
    },
    editDirectoryOnServer: (list, id, patch, by = dailos) => {
      const record = state[list].find(r => r.id === id);
      if (!record) throw new Error(`No ${list} ${id}`);
      Object.assign(record, patch, {
        version: (record.version as number) + 1,
        updatedBy: by,
        updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      return record;
    },
  };

  // `/me` and the login answer list the latest copy of the organization.
  // E4: the viewer's roles and effective permissions in the organization.
  const orgs = () => orgsFor(currentUser);
  const orgsFor = (user: Json | null) => {
    const account = e4Account(
      String(user?.username ?? user?.displayName ?? 'Elvis'),
    );
    const roles = account?.roles ?? [];
    return [
      {
        ...state.organization,
        roles,
        permissions: effectivePermissions(roles, {
          provisional: account?.provisional === true,
          support: !!user?.support,
        }),
      },
    ];
  };
  /** An E4 account by username (any case): live, mutable state. */
  const e4Account = (name: string): E4Live | null => {
    const key = Object.keys(state.e4.accounts).find(
      k => k.toLowerCase() === name.trim().toLowerCase(),
    );
    return key ? state.e4.accounts[key]! : null;
  };
  const e4ById = (id: string): E4Live | null =>
    Object.values(state.e4.accounts).find(a => e4Id(a) === id) ?? null;
  /** The E4 `SessionUser` of an account. */
  const e4User = (account: E4Live, support: Json | null = null) => ({
    id: e4Id(account),
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    avatarId: account.avatarId,
    accent: account.accent,
    passwordProvisional: account.provisional,
    welcomed: account.welcomed,
    support,
  });

  // ---- Revisión 1 · E4 (roles and access)
  const LINK_GONE =
    'El enlace no es válido, ya se ha usado o ha caducado. Pide uno nuevo.';
  /** The open support or «Ver como Invitado» session (one at a time). */
  let support: {
    id: string;
    token: string;
    kind: 'support' | 'view_as_guest';
    username: string;
    by: {id: string; displayName: string};
    reason: string | null;
    startedAt: string;
    endsAt: string;
  } | null = null;
  /**
   * Safety audit (migration 0012): the administrator behind the request
   * being handled, when it comes with a support session's token. Writes
   * record it as `supportBy` / `acceptedBySupport`.
   */
  let writingAsSupport: {id: string; displayName: string} | null = null;
  const supportInfo = (s: NonNullable<typeof support>) => ({
    kind: s.kind,
    by: s.by,
    reason: s.reason,
    endsAt: s.endsAt,
  });
  let securitySeq = 0;
  const logSecurity = (
    account: E4Live,
    kind: string,
    actor: {id: string; displayName: string} | null = null,
    detail: string | null = null,
  ) => {
    account.log.unshift({
      id: `sec-${++securitySeq}`,
      kind,
      user: {id: e4Id(account), displayName: account.displayName},
      actor,
      at: new Date().toISOString(),
      detail,
      device: 'Chrome · Windows',
    });
  };
  const ref = (a: E4Live) => ({id: e4Id(a), displayName: a.displayName});
  const maskMail = (email: string) => {
    const at = email.lastIndexOf('@');
    return `${email[0]}•••${email.slice(at)}`;
  };
  const invalid = (route: Route, fields: Record<string, string>) =>
    json(
      route,
      {code: 'VALIDATION', message: 'Revisa los datos marcados.', fields},
      400,
    );
  const noContent = (route: Route, status = 204) =>
    route.fulfill({status, body: ''});
  const sharedAccount = (a: E4Live) => isSharedAccount(a.role, [a.roles]);
  /** The server's `requireOutranks`, for one organization. */
  const outranks = (actor: E4Live, target: E4Live) => {
    if (actor.roles.includes('admin')) return true;
    const given = new Set(rolePermissions(actor.roles));
    return rolePermissions(target.roles).every(p => given.has(p));
  };
  const profileOf = (a: E4Live) => ({
    user: e4User(a),
    bio: a.bio,
    recoveryEmail: a.recovery ? maskMail(a.recovery) : null,
    pendingRecoveryEmail: a.pending ? maskMail(a.pending) : null,
    sharedAccount: sharedAccount(a),
    version: a.version,
  });
  const adminUserOf = (a: E4Live) => ({
    id: e4Id(a),
    username: a.username,
    displayName: a.displayName,
    role: a.role,
    avatarId: a.avatarId,
    memberships: [{organizationId: ORG, roles: a.roles}],
    passwordProvisional: a.provisional,
    hasRecoveryEmail: !!a.recovery,
    lastLoginAt: a.lastLoginAt,
    openSessions: a.otherSessions.length + (a.lastLoginAt ? 1 : 0),
    sharedAccount: sharedAccount(a),
    version: a.version,
  });
  const startSession = (
    target: E4Live,
    kind: 'support' | 'view_as_guest',
    by: E4Live,
    reason: string | null,
    minutes: number,
  ) => {
    const now = Date.now();
    support = {
      id: `ss-${++securitySeq}`,
      token: SUPPORT_TOKEN,
      kind,
      username: target.username,
      by: ref(by),
      reason,
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + minutes * 60_000).toISOString(),
    };
    const info = supportInfo(support);
    logSecurity(
      kind === 'support' ? target : by,
      kind === 'support' ? 'support_started' : 'view_as_guest',
      ref(by),
      reason,
    );
    const user = e4User(target, info);
    return {
      token: SUPPORT_TOKEN,
      expiresAt: support.endsAt,
      user,
      organizations: orgsFor(user),
      sessionId: support.id,
    };
  };

  /** E4 routes; null when the path is not one of them. */
  const handleE4 = (
    route: Route,
    method: string,
    path: string,
    body: unknown,
    user: ReturnType<typeof e4User>,
    viaSupport: boolean,
  ): Promise<void> | null => {
    const input = (body ?? {}) as Json;
    const me = e4Account(user.username)!;
    const perms = orgsFor(user)[0]!.permissions;
    const forbidden = (message = 'No tienes permiso para hacer este cambio.') =>
      error(route, 403, 'FORBIDDEN', message);

    if (path === `/organizations/${ORG}/members` && method === 'GET') {
      return json(route, {
        items: Object.values(state.e4.accounts).map(a => ({
          id: e4Id(a),
          displayName: a.displayName,
          role: a.role,
          avatarId: a.role === 'guest' ? null : a.avatarId,
          accent: a.accent,
          bio: a.role === 'guest' ? null : a.bio,
          roles: a.roles,
          restricted: a.role === 'guest',
        })),
      });
    }

    if (path.startsWith('/me/')) {
      // Own account: never for the guest account nor during a support session.
      if (user.role === 'guest' || viaSupport) return forbidden();
      if (path === '/me/profile' && method === 'GET') {
        return json(route, profileOf(me));
      }
      if (path === '/me/profile' && method === 'PATCH') {
        if (input.version !== me.version) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message: 'Tu perfil ha cambiado desde otra sesión.',
              current: profileOf(me),
            },
            409,
          );
        }
        if (
          typeof input.displayName === 'string' &&
          input.displayName.trim() !== me.displayName &&
          sharedAccount(me)
        ) {
          return json(
            route,
            {
              code: 'FORBIDDEN',
              message:
                'El nombre de una cuenta compartida lo pone administración.',
              fields: {
                displayName:
                  'El nombre de una cuenta compartida lo pone administración.',
              },
            },
            403,
          );
        }
        if (typeof input.displayName === 'string') {
          const name = input.displayName.trim();
          const taken = Object.values(state.e4.accounts).some(
            a => a !== me && a.displayName.toLowerCase() === name.toLowerCase(),
          );
          if (taken) {
            return json(
              route,
              {
                code: 'DUPLICATE',
                message: 'Ya existe un registro con ese nombre.',
                fields: {displayName: 'Ya hay otra persona con ese nombre.'},
              },
              409,
            );
          }
          me.displayName = name;
        }
        if ('bio' in input) me.bio = (input.bio as string | null) || null;
        if ('accent' in input) {
          me.accent = (input.accent as string | null) ?? null;
        }
        me.version++;
        logSecurity(me, 'profile_changed');
        return json(route, profileOf(me));
      }
      if (path === '/me/password' && method === 'POST') {
        if (sharedAccount(me)) return forbidden();
        if (input.currentPassword !== me.password) {
          return invalid(route, {
            currentPassword: 'La contraseña actual no es correcta.',
          });
        }
        const problem = passwordProblem(
          String(input.newPassword ?? ''),
          me.username,
        );
        if (problem) return invalid(route, {newPassword: problem});
        me.password = String(input.newPassword);
        me.provisional = false;
        if (input.signOutOthers) me.otherSessions = [];
        logSecurity(me, 'password_changed');
        return noContent(route);
      }
      if (path === '/me/email' && method === 'POST') {
        if (sharedAccount(me)) return forbidden();
        me.pending = String(input.email ?? '');
        logSecurity(me, 'email_requested');
        return noContent(route, 202);
      }
      if (path === '/me/email' && method === 'DELETE') {
        me.recovery = null;
        me.pending = null;
        logSecurity(me, 'email_removed');
        return noContent(route);
      }
      if (path === '/me/welcome' && method === 'POST') {
        me.welcomed = true;
        return noContent(route);
      }
      if (path === '/me/sessions' && method === 'GET') {
        return json(route, {
          items: [
            {
              id: 's-current',
              current: true,
              createdAt: me.lastLoginAt ?? new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
              expiresAt: '2099-01-01T00:00:00.000Z',
              device: 'Chrome · Windows',
              kind: 'normal',
              openedBy: null,
            },
            ...me.otherSessions.map(s => ({
              id: s.id,
              current: false,
              createdAt: s.createdAt,
              lastSeenAt: s.createdAt,
              expiresAt: '2099-01-01T00:00:00.000Z',
              device: s.device,
              kind: 'normal',
              openedBy: null,
            })),
          ],
        });
      }
      if (path === '/me/sessions' && method === 'DELETE') {
        me.otherSessions = [];
        logSecurity(me, 'sessions_revoked');
        return noContent(route);
      }
      const one = /^\/me\/sessions\/([^/]+)$/.exec(path);
      if (one && method === 'DELETE') {
        me.otherSessions = me.otherSessions.filter(s => s.id !== one[1]);
        return noContent(route);
      }
      if (path === '/me/security' && method === 'GET') {
        return json(route, {items: me.log});
      }
      return null;
    }

    if (path.startsWith('/admin/')) {
      if (viaSupport) return forbidden();
      const isAdmin = me.roles.includes('admin');
      if (path === '/admin/view-as-guest' && method === 'POST') {
        if (!perms.includes('view_as_guest')) return forbidden();
        return json(
          route,
          startSession(e4Account('Invitado')!, 'view_as_guest', me, null, 30),
          201,
        );
      }
      if (path === '/admin/support-sessions' && method === 'POST') {
        if (!perms.includes('support.start')) return forbidden();
        if (input.password !== me.password) {
          return invalid(route, {password: 'Tu contraseña no es correcta.'});
        }
        const reason = String(input.reason ?? '').trim();
        if (reason.length < 10) {
          return invalid(route, {
            reason: 'Explica el motivo (10 caracteres o más).',
          });
        }
        const target = e4ById(String(input.userId ?? ''));
        if (!target || target === me || target.role === 'guest') {
          return invalid(route, {userId: 'No se puede abrir en esa cuenta.'});
        }
        return json(
          route,
          startSession(
            target,
            'support',
            me,
            reason,
            Number(input.minutes) || 15,
          ),
          201,
        );
      }
      if (path === '/admin/support-sessions' && method === 'GET') {
        if (!perms.includes('users.manage')) return forbidden();
        const s = support;
        return json(route, {
          items: s
            ? [
                {
                  id: s.id,
                  kind: s.kind,
                  user: ref(e4Account(s.username)!),
                  by: s.by,
                  reason: s.reason,
                  startedAt: s.startedAt,
                  endsAt: s.endsAt,
                },
              ]
            : [],
        });
      }
      const ended = /^\/admin\/support-sessions\/([^/]+)$/.exec(path);
      if (ended && method === 'DELETE') {
        if (support && support.id === ended[1]) {
          logSecurity(
            e4Account(support.username)!,
            'support_ended',
            support.by,
          );
          support = null;
        }
        return noContent(route);
      }
      if (!perms.includes('users.manage')) return forbidden();
      if (path === '/admin/users' && method === 'GET') {
        return json(route, {
          items: Object.values(state.e4.accounts).map(adminUserOf),
        });
      }
      if (path === '/admin/security' && method === 'GET') {
        return json(route, {
          items: Object.values(state.e4.accounts)
            .flatMap(a => a.log)
            .sort((x, y) => String(y.at).localeCompare(String(x.at))),
        });
      }
      const m =
        /^\/admin\/users\/([^/]+)\/(roles|provisional-password|reset-link|profile)$/.exec(
          path,
        );
      const target = m ? e4ById(m[1]!) : null;
      if (m && !target) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (target && m![2] === 'roles' && method === 'PUT') {
        if (!isAdmin) return forbidden();
        if (target.role === 'guest') {
          return invalid(route, {
            roles: 'La cuenta de Invitado no tiene roles.',
          });
        }
        const roles = normalizeRoles((input.roles as unknown[]) ?? []);
        if (target === me && !roles.includes('admin')) {
          return invalid(route, {
            roles: 'No puedes quitarte tu propio rol de administración.',
          });
        }
        target.roles = roles;
        logSecurity(target, 'roles_changed', ref(me));
        return json(route, adminUserOf(target));
      }
      const outranked = () =>
        forbidden(
          'Esta cuenta tiene permisos que tú no tienes: solo administración puede darle una contraseña provisional o un enlace.',
        );
      if (target && m![2] === 'profile' && method === 'PATCH') {
        // Shared accounts only (server/src/admin/service.ts).
        if (!sharedAccount(target)) {
          return forbidden('Cada persona cambia su propio perfil.');
        }
        if (input.version !== target.version) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message: 'La cuenta ha cambiado desde otra sesión.',
              current: adminUserOf(target),
            },
            409,
          );
        }
        let bumped = false;
        if (typeof input.displayName === 'string') {
          const name = input.displayName.trim();
          if (!name) return invalid(route, {displayName: 'Escribe un nombre.'});
          const taken = Object.values(state.e4.accounts).some(
            a =>
              a !== target &&
              a.displayName.toLowerCase() === name.toLowerCase(),
          );
          if (taken) {
            return json(
              route,
              {
                code: 'DUPLICATE',
                message: 'Ya existe un registro con ese nombre.',
                fields: {displayName: 'Ya hay otra persona con ese nombre.'},
              },
              409,
            );
          }
          if (name !== target.displayName) {
            target.displayName = name;
            bumped = true;
          }
        }
        if ('photo' in input) {
          if (input.photo !== null && target.role === 'guest') {
            return invalid(route, {
              photo: 'La cuenta de Invitado no lleva foto.',
            });
          }
          if (input.photo === null) {
            // Removing the photo does not change the account's version.
            target.avatarId = null;
          } else {
            const photo = (input.photo ?? {}) as Json;
            if (typeof photo.data !== 'string' || !photo.data) {
              return invalid(route, {'photo.data': MEDIA_DATA_INVALID});
            }
            target.avatarId = `m-avatar-${++securitySeq}`;
            bumped = true;
          }
        }
        if (bumped) target.version++;
        logSecurity(target, 'profile_changed', ref(me));
        return json(route, adminUserOf(target));
      }
      if (target && m![2] === 'provisional-password' && method === 'POST') {
        if (target === me) return forbidden();
        if (!outranks(me, target)) return outranked();
        target.password = PROVISIONAL_PASSWORD;
        target.provisional = true;
        target.otherSessions = [];
        logSecurity(target, 'password_provisional_set', ref(me));
        return json(route, {password: PROVISIONAL_PASSWORD});
      }
      if (target && m![2] === 'reset-link' && method === 'POST') {
        if (!outranks(me, target)) return outranked();
        logSecurity(target, 'reset_link_created', ref(me));
        if (state.e4.mailConfigured) return noContent(route, 202);
        return json(route, {
          url: `http://localhost:5173/#logistica/cuenta/restablecer/${RESET_TOKEN}`,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
      }
      return null;
    }

    // Contactos and Catálogo need `directory.read` (403 otherwise).
    if (
      !perms.includes('directory.read') &&
      !state.leakToGuests &&
      /\/(companies|contacts|offers)(\/|$)/.test(path)
    ) {
      return forbidden(
        'Contactos y Catálogo no están disponibles con este usuario.',
      );
    }
    return null;
  };

  /**
   * M6: the id of a new record. A create may carry a device id (already
   * checked to be a free UUID by the device-id gate); otherwise the mock's
   * own sequence.
   */
  const newId = (input: unknown, fallback: string): string => {
    const id = (input as Json | null)?.id;
    return typeof id === 'string' && UUID_RE.test(id)
      ? id.toLowerCase()
      : fallback;
  };

  /** Find or create by name, case-insensitive, as the server does. */
  const venueRef = (name: unknown) => {
    const n = text(name);
    if (!n) return null;
    let venue = state.venues.find(v => nameKey(v.name) === nameKey(n));
    if (!venue) {
      venue = {id: `v-new-${++seq}`, name: n};
      state.venues.push(venue);
    }
    return {id: venue.id, name: venue.name};
  };
  const companyRef = (input: Json, current: unknown = null) => {
    if (typeof input.companyId === 'string') {
      const c = state.companies.find(x => x.id === input.companyId);
      return c ? {id: c.id, name: c.name} : current;
    }
    if (input.companyId === null && input.companyName === undefined) {
      return null;
    }
    if (input.companyName === undefined) return current;
    const n = text(input.companyName);
    if (!n) return null;
    let company = state.companies.find(
      c => nameKey(c.name as string) === nameKey(n),
    );
    if (!company) {
      company = makeCompany(`c-new-${++seq}`, n);
      state.companies.push(company);
    }
    return {id: company.id, name: company.name};
  };

  // ---- milestone 3: people, companies, catalogue, recent searches
  const contactRef = (id: unknown) => {
    if (typeof id !== 'string') return null;
    const c = state.contacts.find(x => x.id === id);
    return c ? {id: c.id as string, name: c.name as string} : null;
  };
  const byName = (list: Json[]) =>
    [...list].sort((a, b) =>
      (a.name as string).localeCompare(b.name as string, 'es', {
        sensitivity: 'base',
      }),
    );
  const isGuest = (role: string) => role === 'guest';
  const WITHHELD = MOCK_WITHHELD;
  const redact = (
    kind: keyof typeof WITHHELD,
    record: Json,
    role: string,
  ): Json => {
    if (!isGuest(role)) return {...record, restricted: false};
    // M6: a server bug that forgets the withholding (the device cache must
    // still never store a withheld value for a guest).
    if (state.leakToGuests) return {...record, restricted: true};
    const out: Json = {...record, restricted: true};
    for (const k of WITHHELD[kind]) out[k] = null;
    // Safety audit: same as `DIRECTORY_NAMES` in redaction.ts.
    const names = MOCK_DIRECTORY_REF_LABEL;
    if ((kind === 'task' || kind === 'resource') && out.company) {
      out.company = {...(out.company as Json), name: names.company};
    }
    const link = out.ref as {type: string} | null | undefined;
    if (kind === 'note' && link && link.type in names) {
      out.ref = {...link, label: names[link.type as keyof typeof names]};
    }
    // Same as `NESTED` in redaction.ts: a note's answer is withheld with it.
    if (kind === 'note' && out.answer && typeof out.answer === 'object') {
      out.answer = redact('answer', out.answer as Json, role);
    }
    return out;
  };
  /** E3: an answer as this role may see it. */
  const viewAnswer = (a: Json, role: string) => redact('answer', a, role);
  /** E3: a stored photo in MediaInfo shape (its bytes never in lists). */
  const mediaInfo = (m: Json): Json => {
    const {data: _data, ...info} = m;
    return info;
  };
  const sortedMedia = (list: Json[]) =>
    [...list].sort(
      (a, b) =>
        Number(b.main) - Number(a.main) ||
        Date.parse(a.createdAt as string) - Date.parse(b.createdAt as string) ||
        String(a.id).localeCompare(String(b.id)),
    );
  const viewEvent = (e: Json, role: string) => redact('event', e, role);
  const viewTask = (t: Json, role: string) =>
    redact(
      'task',
      {
        ...t,
        resourceIds: t.resourceIds ?? [],
        subsoilReview: t.subsoilReview ?? null,
      },
      role,
    );
  const viewHypothesis = (h: Json, role: string) =>
    redact('hypothesis', h, role);
  const viewWarehouse = (w: Json, role: string) =>
    redact(
      'warehouse',
      {
        ...w,
        resourceCount: state.resources.filter(
          r => (r.warehouse as Json | null)?.id === w.id,
        ).length,
      },
      role,
    );
  const viewResource = (r: Json, role: string) =>
    redact(
      'resource',
      {
        ...r,
        taskIds: state.tasks
          .filter(t =>
            ((t.resourceIds as string[]) ?? []).includes(r.id as string),
          )
          .map(t => t.id as string)
          .sort(),
        // E3: guests see photos too (no personal data in them).
        media: sortedMedia((r.media as Json[] | undefined) ?? []).map(
          mediaInfo,
        ),
      },
      role,
    );
  /** What a note points at, with the record's current name. */
  const refRecord = (type: string, id: string): Json | undefined => {
    const lists: Record<string, Json[]> = {
      task: state.tasks,
      venue: state.venues as unknown as Json[],
      company: state.companies,
      contact: state.contacts,
      offer: state.offers,
      warehouse: state.warehouses,
      resource: state.resources,
    };
    return lists[type]?.find(x => x.id === id);
  };
  const viewNote = (n: Json, role: string) => {
    const ref = n.ref as {type: string; id: string; label: string} | null;
    const target = ref ? refRecord(ref.type, ref.id) : undefined;
    const ev = n.event as {id: string} | null;
    const event = ev ? state.events.find(e => e.id === ev.id) : undefined;
    return redact(
      'note',
      {
        ...n,
        ref: ref
          ? {
              ...ref,
              label: (target?.title ?? target?.name ?? ref.label) as string,
            }
          : null,
        event: ev
          ? {id: ev.id, name: event?.name ?? (n.event as Json).name}
          : null,
      },
      role,
    );
  };
  const viewCompany = (c: Json, role: string): Json => {
    const counted = {
      ...c,
      tax: c.tax ?? null,
      contactCount: state.contacts.filter(
        p => (p.company as Json | null)?.id === c.id,
      ).length,
      offerCount: state.offers.filter(
        o => (o.company as Json | null)?.id === c.id,
      ).length,
    };
    return isGuest(role) ? redact('company', counted, role) : counted;
  };
  const viewContact = (c: Json, role: string): Json =>
    isGuest(role) ? redact('contact', c, role) : c;
  /** E5: an offer with its own tax and its company's current one. */
  const withCompanyTax = (o: Json): Json => {
    const company = state.companies.find(
      c => c.id === (o.company as Json | null)?.id,
    );
    return {...o, tax: o.tax ?? null, companyTax: company?.tax ?? null};
  };
  const viewOffer = (o: Json, role: string): Json =>
    isGuest(role)
      ? redact('offer', withCompanyTax(o), role)
      : withCompanyTax(o);
  /** M6: a record of one of the device-id lists, as this role may see it. */
  const viewOf = (list: DeviceIdList, r: Json, role: string): Json => {
    switch (list) {
      case 'events':
        return viewEvent(r, role);
      case 'tasks':
        return viewTask(r, role);
      case 'companies':
        return viewCompany(r, role);
      case 'contacts':
        return viewContact(r, role);
      case 'offers':
        return viewOffer(r, role);
      case 'warehouses':
        return viewWarehouse(r, role);
      case 'resources':
        return viewResource(r, role);
      case 'notes':
        return viewNote(r, role);
    }
  };
  /** M6: one fingerprint per list, for `GET …/changes`. */
  const fingerprints = (): Record<string, string> =>
    Object.fromEntries(
      Object.keys(CHANGE_TYPES).map(l => [
        l,
        JSON.stringify(state[l as keyof typeof CHANGE_TYPES]),
      ]),
    );
  const bump = (record: Json, by: Json) =>
    Object.assign(record, {
      version: (record.version as number) + 1,
      updatedBy: by,
      updatedAt: new Date().toISOString(),
    });
  const conflict = (route: Route, current: Json, what: string) =>
    json(
      route,
      {
        code: 'VERSION_CONFLICT',
        message: `Otra persona ha cambiado ${what} mientras la editabas. Revisa la versión actual antes de guardar tus cambios.`,
        current,
      },
      409,
    );
  const checkVersion = (
    route: Route,
    record: Json,
    version: unknown,
    what: string,
  ) => {
    if (typeof version !== 'number' || Number.isNaN(version)) {
      return validation(route, {
        version:
          'Falta la versión del registro: recarga y vuelve a intentarlo.',
      });
    }
    if (version !== record.version) return conflict(route, record, what);
    return null;
  };
  const companyFrom = (input: Json): Json | null => {
    if (typeof input.companyId === 'string') {
      return state.companies.find(c => c.id === input.companyId) ?? null;
    }
    const n = text(input.companyName);
    if (!n) return null;
    let company = state.companies.find(
      c => nameKey(c.name as string) === nameKey(n),
    );
    if (!company) {
      company = makeCompany(`c-new-${++seq}`, n);
      state.companies.push(company);
    }
    return company;
  };
  const refOf = (c: Json | null) =>
    c ? {id: c.id as string, name: c.name as string} : null;
  const PROVENANCE = ['source', 'verification'];
  const amountKeys = [
    'price',
    'transportCost',
    'assemblyCost',
    'maintenanceCost',
  ];
  const amountProblems = (input: Json) => {
    const fields: Record<string, string> = {};
    for (const k of amountKeys) {
      const v = input[k];
      if (v === undefined || v === null) continue;
      if (
        typeof v !== 'number' ||
        v < 0 ||
        v > 10_000_000 ||
        Math.round(v * 100) !== v * 100
      ) {
        fields[k] = 'Importe no válido: hasta dos decimales.';
      }
    }
    return fields;
  };
  /**
   * E5: `input.tax` as stored, with the shared `normalizeTax`; problems as
   * `fields['tax.<key>']`, as the server answers them. `undefined` = not sent.
   */
  const taxOf = (
    input: Json,
    fields: Record<string, string>,
  ): Json | null | undefined => {
    if (!('tax' in input) || input.tax === undefined) return undefined;
    const r = normalizeTax(input.tax);
    if ('fields' in r) {
      for (const [k, m] of Object.entries(r.fields)) fields[`tax.${k}`] = m;
      return undefined;
    }
    return r.tax as unknown as Json | null;
  };

  // ---- milestone 4 helpers: activity log and unlinking
  const log = (
    by: Json,
    entity: {type: string; id: string; label: string},
    action: 'create' | 'update' | 'delete',
    changedFields: string[] = [],
  ) => {
    state.activity.push({
      id: `a-new-${++seq}`,
      user: by,
      entityType: entity.type,
      entityId: entity.id,
      entityLabel: entity.label,
      action,
      changedFields,
      at: clock(),
      ...(writingAsSupport ? {supportBy: writingAsSupport} : {}),
    });
  };
  /** Notes pointing at a deleted record lose the link (new version). */
  const unlinkNotes = (type: string, id: string, by: Json) => {
    for (const n of state.notes) {
      const r = n.ref as {type: string; id: string} | null;
      if (r?.type === type && r.id === id) {
        n.ref = null;
        bump(n, by);
      }
    }
  };
  /** Resources that used a deleted record lose it (new version). */
  const unlinkResources = (
    link: 'warehouse' | 'company' | 'offer' | 'category',
    id: string,
    by: Json,
  ) => {
    for (const r of state.resources) {
      const hit =
        link === 'offer'
          ? r.offerId === id
          : link === 'category'
            ? r.categoryId === id
            : (r[link] as Json | null)?.id === id;
      if (!hit) continue;
      if (link === 'offer') r.offerId = null;
      else if (link === 'category') r.categoryId = null;
      else r[link] = null;
      if (link === 'company') r.offerId = null;
      bump(r, by);
    }
  };

  const directoryRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      url: URL;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, url, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const now = () => new Date().toISOString();

    // categories
    if (path === `/organizations/${ORG}/categories` && method === 'GET') {
      return json(route, {items: state.categories});
    }
    if (path === '/categories' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'Escribe el nombre.'});
      const existing = state.categories.find(
        c =>
          c.scope === input.scope && nameKey(c.name as string) === nameKey(n),
      );
      if (existing) return json(route, existing);
      const created = {
        id: `cat-new-${++seq}`,
        organizationId: ORG,
        scope: input.scope ?? 'service',
        name: n,
        builtIn: false,
      };
      state.categories.push(created);
      return json(route, created, 201);
    }
    const categoryMatch = /^\/categories\/([^/]+)$/.exec(path);
    if (categoryMatch && method === 'DELETE') {
      const category = state.categories.find(c => c.id === categoryMatch[1]);
      if (!category) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (category.builtIn) {
        return validation(route, {
          id: 'Las categorías que trae Ox Eye no se pueden borrar.',
        });
      }
      const id = category.id as string;
      state.categories = state.categories.filter(c => c !== category);
      for (const c of state.companies) {
        const ids = c.categoryIds as string[];
        if (!ids.includes(id)) continue;
        c.categoryIds = ids.filter(x => x !== id);
        bump(c, ref);
      }
      for (const o of state.offers) {
        if (o.categoryId !== id) continue;
        o.categoryId = null;
        bump(o, ref);
      }
      unlinkResources('category', id, ref);
      return route.fulfill({status: 204, body: ''});
    }

    // recent searches (members only)
    const recentPath = `/organizations/${ORG}/recent-searches`;
    if (path === recentPath) {
      if (method === 'GET') return json(route, {items: state.recentSearches});
      if (isGuest(user.role)) {
        return error(route, 403, 'FORBIDDEN', 'Solo lectura.');
      }
      if (method === 'POST') {
        const q = text(input.query);
        if (!q) return validation(route, {query: 'Búsqueda vacía.'});
        const key = (s: string) =>
          s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        state.recentSearches = [
          {query: q, at: now()},
          ...state.recentSearches.filter(r => key(r.query) !== key(q)),
        ].slice(0, 5);
        return json(route, {items: state.recentSearches});
      }
      if (method === 'DELETE') {
        state.recentSearches = [];
        return route.fulfill({status: 204, body: ''});
      }
    }

    // companies
    if (path === '/companies' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
      const taxFields: Record<string, string> = {};
      const companyTax = taxOf(input, taxFields);
      if (Object.keys(taxFields).length) return validation(route, taxFields);
      const dup = state.companies.find(
        c => nameKey(c.name as string) === nameKey(n),
      );
      if (dup) {
        return json(
          route,
          {
            code: 'DUPLICATE',
            message: `Ya existe «${dup.name}».`,
            current: viewCompany(dup, user.role),
          },
          409,
        );
      }
      const created = makeCompany(newId(input, `c-new-${++seq}`), n, {
        kind: input.kind ?? 'supplier',
        categoryIds: input.categoryIds ?? [],
        phone: text(input.phone),
        email: text(input.email),
        website: text(input.website),
        notes: text(input.notes),
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        tax: companyTax ?? null,
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.companies.push(created);
      return json(route, viewCompany(created, user.role), 201);
    }
    const companyMatch = /^\/companies\/([^/]+)$/.exec(path);
    if (companyMatch) {
      const company = state.companies.find(c => c.id === companyMatch[1]);
      if (!company) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = checkVersion(route, company, input.version, 'esta empresa');
        if (bad) return bad;
        const taxFields: Record<string, string> = {};
        const companyTax = taxOf(input, taxFields);
        if (Object.keys(taxFields).length) return validation(route, taxFields);
        if ('name' in input) {
          const n = text(input.name);
          if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
          const dup = state.companies.find(
            c => c !== company && nameKey(c.name as string) === nameKey(n),
          );
          if (dup) {
            return json(
              route,
              {
                code: 'DUPLICATE',
                message: `Ya existe «${dup.name}».`,
                current: viewCompany(dup, user.role),
              },
              409,
            );
          }
          company.name = n;
          for (const list of [state.contacts, state.offers, state.tasks]) {
            for (const r of list) {
              const c = r.company as Json | null;
              if (c?.id === company.id) r.company = {id: company.id, name: n};
            }
          }
        }
        for (const k of ['phone', 'email', 'website', 'notes']) {
          if (k in input) company[k] = text(input[k]);
        }
        for (const k of [
          'kind',
          'categoryIds',
          'mainContactId',
          ...PROVENANCE,
        ]) {
          if (k in input) company[k] = input[k];
        }
        if (companyTax !== undefined) company.tax = companyTax;
        bump(company, ref);
        return json(route, viewCompany(company, user.role));
      }
      if (method === 'DELETE') {
        const bad = checkVersion(
          route,
          company,
          Number(url.searchParams.get('version') ?? NaN),
          'esta empresa',
        );
        if (bad) return bad;
        state.companies = state.companies.filter(c => c !== company);
        for (const o of state.offers) {
          if ((o.company as Json).id !== company.id) continue;
          unlinkResources('offer', o.id as string, ref);
          unlinkNotes('offer', o.id as string, ref);
        }
        state.offers = state.offers.filter(
          o => (o.company as Json).id !== company.id,
        );
        unlinkResources('company', company.id as string, ref);
        unlinkNotes('company', company.id as string, ref);
        for (const list of [state.contacts, state.tasks]) {
          for (const r of list) {
            if ((r.company as Json | null)?.id === company.id) {
              r.company = null;
              bump(r, ref);
            }
          }
        }
        return route.fulfill({status: 204, body: ''});
      }
    }

    // contacts
    if (path === `/organizations/${ORG}/contacts` && method === 'GET') {
      return json(route, {
        items: byName(state.contacts).map(c => viewContact(c, user.role)),
      });
    }
    if (path === '/contacts' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
      const created = makeContact(newId(input, `p-new-${++seq}`), n, {
        role: text(input.role),
        company: refOf(companyFrom(input)),
        phone: text(input.phone),
        email: text(input.email),
        description: text(input.description),
        notes: text(input.notes),
        eventIds: input.eventIds ?? [],
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.contacts.push(created);
      return json(route, created, 201);
    }
    const contactMatch = /^\/contacts\/([^/]+)$/.exec(path);
    if (contactMatch) {
      const contact = state.contacts.find(c => c.id === contactMatch[1]);
      if (!contact) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = checkVersion(route, contact, input.version, 'esta persona');
        if (bad) return bad;
        if ('name' in input) {
          const n = text(input.name);
          if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
          contact.name = n;
        }
        for (const k of ['role', 'phone', 'email', 'description', 'notes']) {
          if (k in input) contact[k] = text(input[k]);
        }
        for (const k of ['eventIds', ...PROVENANCE]) {
          if (k in input) contact[k] = input[k];
        }
        if ('companyId' in input || 'companyName' in input) {
          const before = (contact.company as Json | null)?.id;
          contact.company = refOf(companyFrom(input));
          const old = state.companies.find(c => c.id === before);
          if (
            old &&
            old.mainContactId === contact.id &&
            before !== (contact.company as Json | null)?.id
          ) {
            old.mainContactId = null;
            bump(old, ref);
          }
        }
        bump(contact, ref);
        return json(route, contact);
      }
      if (method === 'DELETE') {
        const bad = checkVersion(
          route,
          contact,
          Number(url.searchParams.get('version') ?? NaN),
          'esta persona',
        );
        if (bad) return bad;
        state.contacts = state.contacts.filter(c => c !== contact);
        unlinkNotes('contact', contact.id as string, ref);
        for (const t of state.tasks) {
          if ((t.contact as Json | null)?.id === contact.id) {
            t.contact = null;
            bump(t, ref);
          }
        }
        for (const c of state.companies) {
          if (c.mainContactId === contact.id) {
            c.mainContactId = null;
            bump(c, ref);
          }
        }
        return route.fulfill({status: 204, body: ''});
      }
    }

    // offers
    if (path === `/organizations/${ORG}/offers` && method === 'GET') {
      return json(route, {
        items: [...state.offers]
          .sort(
            (a, b) =>
              ((a.company as Json).name as string).localeCompare(
                (b.company as Json).name as string,
                'es',
              ) || (a.name as string).localeCompare(b.name as string, 'es'),
          )
          .map(o => viewOffer(o, user.role)),
      });
    }
    if (path === '/offers' && method === 'POST') {
      const fields = amountProblems(input);
      const n = text(input.name);
      if (!n) fields.name = 'Escribe qué se ofrece.';
      const company = companyFrom(input);
      if (!company) fields.companyName = 'Indica la empresa que lo ofrece.';
      const offerTax = taxOf(input, fields);
      if (Object.keys(fields).length) return validation(route, fields);
      const created = makeOffer(
        newId(input, `o-new-${++seq}`),
        n!,
        refOf(company)!,
        {
          categoryId: input.categoryId ?? null,
          description: text(input.description),
          price: input.price ?? null,
          unit: input.unit ?? 'unit',
          customUnit: input.unit === 'custom' ? text(input.customUnit) : null,
          transportCost: input.transportCost ?? null,
          assemblyCost: input.assemblyCost ?? null,
          maintenanceCost: input.maintenanceCost ?? null,
          conditions: text(input.conditions),
          // E5: a new offer without `vatIncluded` is before tax.
          vatIncluded: input.vatIncluded ?? false,
          tax: offerTax ?? null,
          source: input.source ?? null,
          verification: input.verification ?? 'draft',
          createdBy: ref,
          updatedBy: ref,
          createdAt: now(),
          updatedAt: now(),
        },
      );
      state.offers.push(created);
      return json(route, viewOffer(created, user.role), 201);
    }
    const offerMatch = /^\/offers\/([^/]+)$/.exec(path);
    if (offerMatch) {
      const offer = state.offers.find(o => o.id === offerMatch[1]);
      if (!offer) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = checkVersion(route, offer, input.version, 'esta oferta');
        if (bad) return bad;
        const fields = amountProblems(input);
        if ('name' in input && !text(input.name)) {
          fields.name = 'Escribe qué se ofrece.';
        }
        const offerTax = taxOf(input, fields);
        if (Object.keys(fields).length) return validation(route, fields);
        if (offerTax !== undefined) offer.tax = offerTax;
        if ('name' in input) offer.name = text(input.name);
        for (const k of ['description', 'conditions', 'customUnit']) {
          if (k in input) offer[k] = text(input[k]);
        }
        for (const k of [
          'categoryId',
          'unit',
          'vatIncluded',
          ...amountKeys,
          ...PROVENANCE,
        ]) {
          if (k in input) offer[k] = input[k];
        }
        if (offer.unit !== 'custom') offer.customUnit = null;
        if ('companyId' in input || 'companyName' in input) {
          const company = companyFrom(input);
          if (company) offer.company = refOf(company);
        }
        bump(offer, ref);
        return json(route, viewOffer(offer, user.role));
      }
      if (method === 'DELETE') {
        const bad = checkVersion(
          route,
          offer,
          Number(url.searchParams.get('version') ?? NaN),
          'esta oferta',
        );
        if (bad) return bad;
        state.offers = state.offers.filter(o => o !== offer);
        unlinkResources('offer', offer.id as string, ref);
        unlinkNotes('offer', offer.id as string, ref);
        return route.fulfill({status: 204, body: ''});
      }
    }
    return null;
  };

  // ---- Revisión 1 · E5 (Dinero): event budgets and expenses
  // Mirrors server/src/budget/service.ts: reads need `budget.read`, writes
  // `budget.edit` (403 with NO_ACCESS / PROVISIONAL_HOLD otherwise); every
  // event has a budget (`amount` null, `version` 0 until set); PUT and
  // PATCH / DELETE check `version` (409 VERSION_CONFLICT with `current`); an
  // expense from an offer copies `snapshotOf` the offer as it is now and
  // defaults company, amount (price before tax) and tax from it; the copy is
  // never touched again. No activity entries: the mock's activity list is
  // served to everyone, the server's budget entries are not.
  const BUDGET_CONFLICT =
    'Otra persona ha cambiado el presupuesto de este evento mientras lo editabas. Revisa el importe actual antes de guardar.';
  const EXPENSE_CONFLICT =
    'Otra persona ha cambiado este gasto mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.';
  const EXPENSE_NOT_FOUND =
    'No encontramos ese gasto: puede que se haya eliminado.';
  const BUDGET_EVENT_NOT_FOUND =
    'No encontramos ese evento en esta organización: puede que se haya eliminado.';
  const CONCEPT_REQUIRED =
    'Escribe el concepto del gasto (por ejemplo, «Alquiler de carpas»).';
  const OFFER_UNKNOWN =
    'Esa oferta ya no existe o no es de esta organización: elige otra o escribe el gasto a mano.';
  const AMOUNT_INVALID = 'Importe no válido: hasta dos decimales.';
  const budgetOf = (eventId: string): Json =>
    state.budgets.find(b => b.eventId === eventId) ?? {
      eventId,
      amount: null,
      version: 0,
      updatedBy: null,
      updatedAt: null,
    };
  /** The live company name while it exists; the copy (id null) once deleted. */
  const viewExpense = (x: Json): Json => {
    const c = x.company as {id: string | null; name: string} | null;
    if (!c?.id) return {...x};
    const live = state.companies.find(k => k.id === c.id);
    return {
      ...x,
      company: live
        ? {id: c.id, name: live.name as string}
        : {id: null, name: c.name},
    };
  };
  const expensesOf = (eventId: string) =>
    state.expenses
      .filter(x => x.eventId === eventId)
      .sort(
        (a, b) =>
          Date.parse(a.createdAt as string) -
            Date.parse(b.createdAt as string) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map(viewExpense);
  const budgetRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      url: URL;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, url, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const budgetPath = /^\/events\/([^/]+)\/budget$/.exec(path);
    const expensePath = /^\/expenses\/([^/]+)$/.exec(path);
    const listPath = path === `/organizations/${ORG}/budgets`;
    if (
      !budgetPath &&
      !expensePath &&
      !listPath &&
      !(path === '/expenses' && method === 'POST')
    ) {
      return null;
    }
    const org = orgs()[0];
    const permissions = org.permissions;
    const forbid = (p: Permission) =>
      error(
        route,
        403,
        'FORBIDDEN',
        currentUser?.passwordProvisional === true &&
          heldByProvisional(org.roles, p)
          ? PROVISIONAL_HOLD
          : NO_ACCESS[p],
      );
    const need: Permission = method === 'GET' ? 'budget.read' : 'budget.edit';
    if (!permissions.includes(need)) return forbid(need);

    if (listPath && method === 'GET') {
      const items = state.events
        .filter(
          e =>
            state.budgets.some(b => b.eventId === e.id) ||
            state.expenses.some(x => x.eventId === e.id),
        )
        .sort(
          (a, b) =>
            String(a.date ?? '9999').localeCompare(String(b.date ?? '9999')) ||
            String(a.startsAt ?? '').localeCompare(String(b.startsAt ?? '')) ||
            String(a.name).localeCompare(String(b.name), 'es'),
        )
        .map(e =>
          budgetSummary(
            {
              eventId: e.id as string,
              amount: budgetOf(e.id as string).amount as number | null,
            },
            expensesOf(e.id as string) as never,
          ),
        );
      return json(route, {items});
    }

    if (budgetPath) {
      const event = state.events.find(e => e.id === budgetPath[1]);
      if (!event) return error(route, 404, 'NOT_FOUND', BUDGET_EVENT_NOT_FOUND);
      const eventId = event.id as string;
      if (method === 'GET') {
        if (state.failBudget > 0) {
          state.failBudget--;
          return error(
            route,
            500,
            'INTERNAL',
            'Error interno del servidor. Inténtalo de nuevo.',
          );
        }
        return json(route, {
          budget: {...budgetOf(eventId)},
          expenses: expensesOf(eventId),
        });
      }
      if (method === 'PUT') {
        if (input.amount === undefined) {
          return validation(route, {
            amount: 'Indica el presupuesto en euros, o vacío para quitarlo.',
          });
        }
        const amount = input.amount as number | null;
        if (
          amount !== null &&
          (typeof amount !== 'number' || !isValidAmount(amount))
        ) {
          return validation(route, {amount: AMOUNT_INVALID});
        }
        if (typeof input.version !== 'number') {
          return validation(route, {
            version:
              'Falta la versión del presupuesto: recarga el evento y vuelve a intentarlo.',
          });
        }
        const current = budgetOf(eventId);
        if (current.version !== input.version) {
          return json(
            route,
            {code: 'VERSION_CONFLICT', message: BUDGET_CONFLICT, current},
            409,
          );
        }
        const stored = state.budgets.find(b => b.eventId === eventId);
        if (current.amount === amount && (stored || amount === null)) {
          return json(route, {...current});
        }
        const next = {
          eventId,
          amount,
          version: (current.version as number) + 1,
          updatedBy: ref,
          updatedAt: clock(),
        };
        state.budgets = [
          ...state.budgets.filter(b => b.eventId !== eventId),
          next,
        ];
        return json(route, {...next});
      }
      return null;
    }

    /** Shared checks of a create or an update; fills `fields`. */
    const check = (fields: Record<string, string>) => {
      if ('concept' in input) {
        const c = text(input.concept);
        if (!c || c.length > 200) fields.concept = CONCEPT_REQUIRED;
      }
      if (
        input.amount !== undefined &&
        input.amount !== null &&
        (typeof input.amount !== 'number' || !isValidAmount(input.amount))
      ) {
        fields.amount = AMOUNT_INVALID;
      }
      if (
        input.status !== undefined &&
        !(EXPENSE_STATUSES as readonly unknown[]).includes(input.status)
      ) {
        fields.status = 'Estado no válido: usa previsto o confirmado.';
      }
      if (
        typeof input.notes === 'string' &&
        input.notes.trim().length > NOTES_MAX
      ) {
        fields.notes = `Como mucho ${NOTES_MAX} caracteres.`;
      }
      return taxOf(input, fields);
    };
    const companyById = (id: unknown, fields: Record<string, string>) => {
      if (typeof id !== 'string') return null;
      const c = state.companies.find(k => k.id === id);
      if (!c) {
        fields.companyId =
          'No encontramos esa empresa: puede que se haya eliminado.';
      }
      return c ?? null;
    };

    if (path === '/expenses' && method === 'POST') {
      const deviceId = input.id;
      if (typeof deviceId === 'string') {
        const existing = state.expenses.find(
          x => String(x.id).toLowerCase() === deviceId.toLowerCase(),
        );
        if (existing) {
          if ((existing.createdBy as Json | null)?.id !== user.id) {
            return validation(route, {
              id: 'Este identificador ya está en uso.',
            });
          }
          return json(route, viewExpense(existing), 200);
        }
      }
      const event = state.events.find(e => e.id === input.eventId);
      if (!event) return error(route, 404, 'NOT_FOUND', BUDGET_EVENT_NOT_FOUND);
      if (input.offerId && !permissions.includes('directory.read')) {
        return forbid('directory.read');
      }
      const fields: Record<string, string> = {};
      if (expensesOf(event.id as string).length >= MAX_EXPENSES_PER_EVENT) {
        fields.eventId = `Un evento admite como máximo ${MAX_EXPENSES_PER_EVENT} gastos.`;
      }
      const stored = input.offerId
        ? state.offers.find(o => o.id === input.offerId)
        : undefined;
      if (input.offerId && !stored) fields.offerId = OFFER_UNKNOWN;
      const offer = stored
        ? (withCompanyTax(stored) as unknown as Offer)
        : null;
      const sentTax = check(fields);
      const company =
        input.companyId !== undefined
          ? companyById(input.companyId, fields)
          : offer
            ? (state.companies.find(c => c.id === offer.company.id) ?? null)
            : null;
      const concept =
        text(input.concept) ?? (offer ? offer.name : null) ?? null;
      if (!concept) fields.concept = CONCEPT_REQUIRED;
      if (Object.keys(fields).length) return validation(route, fields);
      const at = clock();
      const created: Json = {
        id: newId(input, `x-new-${++seq}`),
        version: 1,
        organizationId: ORG,
        eventId: event.id,
        concept,
        company: company ? {id: company.id, name: company.name} : null,
        amount:
          input.amount !== undefined
            ? input.amount
            : offer
              ? priceEstimate(offer).beforeTax
              : null,
        tax:
          sentTax !== undefined
            ? sentTax
            : offer
              ? effectiveTax(offer)
              : (company?.tax ?? null),
        status: input.status ?? 'planned',
        snapshot: offer ? snapshotOf(offer, at) : null,
        notes: text(input.notes),
        restricted: false,
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        isDemo: false,
        createdBy: ref,
        createdAt: at,
        updatedBy: ref,
        updatedAt: at,
      };
      state.expenses.push(created);
      return json(route, viewExpense(created), 201);
    }

    if (expensePath) {
      const expense = state.expenses.find(x => x.id === expensePath[1]);
      if (!expense) return error(route, 404, 'NOT_FOUND', EXPENSE_NOT_FOUND);
      const version =
        method === 'DELETE'
          ? Number(url.searchParams.get('version') ?? NaN)
          : input.version;
      if (typeof version !== 'number' || Number.isNaN(version)) {
        return validation(route, {
          version:
            'Falta la versión del registro: recarga y vuelve a intentarlo.',
        });
      }
      if (version !== expense.version) {
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: EXPENSE_CONFLICT,
            current: viewExpense(expense),
          },
          409,
        );
      }
      if (method === 'DELETE') {
        state.expenses = state.expenses.filter(x => x !== expense);
        return route.fulfill({status: 204, body: ''});
      }
      if (method === 'PATCH') {
        const fields: Record<string, string> = {};
        const sentTax = check(fields);
        const before = (expense.company as Json | null)?.id ?? null;
        const company =
          input.companyId !== undefined && input.companyId !== before
            ? input.companyId === null
              ? null
              : companyById(input.companyId, fields)
            : undefined;
        if (Object.keys(fields).length) return validation(route, fields);
        const next: Json = {...expense};
        if ('concept' in input) next.concept = text(input.concept);
        for (const k of [
          'amount',
          'status',
          'source',
          'verification',
        ] as const) {
          if (input[k] !== undefined) next[k] = input[k];
        }
        if (input.notes !== undefined) next.notes = text(input.notes);
        if (sentTax !== undefined) next.tax = sentTax;
        if (company !== undefined) {
          next.company = company ? {id: company.id, name: company.name} : null;
        }
        const same =
          JSON.stringify({...next, tax: null}) ===
            JSON.stringify({...expense, tax: null}) &&
          sameTax(next.tax as never, expense.tax as never);
        if (same) return json(route, viewExpense(expense));
        Object.assign(expense, next);
        bump(expense, ref);
        return json(route, viewExpense(expense));
      }
    }
    return null;
  };

  // ---- milestone 4: warehouses, resources, notes
  const versionOf = (
    route: Route,
    record: Json,
    version: unknown,
    current: Json,
    message: string,
  ) => {
    if (typeof version !== 'number' || Number.isNaN(version)) {
      return validation(route, {
        version:
          'Falta la versión del registro: recarga y vuelve a intentarlo.',
      });
    }
    if (version !== record.version) {
      return json(route, {code: 'VERSION_CONFLICT', message, current}, 409);
    }
    return null;
  };
  const RESOURCE_CONFLICT =
    'Otra persona ha cambiado este recurso mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.';
  const WAREHOUSE_CONFLICT =
    'Otra persona ha cambiado este almacén mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.';
  const NOTE_CONFLICT =
    'Otra persona ha cambiado esta nota mientras la editabas. Revisa la versión actual antes de guardar tus cambios.';
  const OWNED_WITHOUT_COMPANY =
    'Un recurso propio no tiene empresa: márcalo como contratado para indicar quién lo presta.';
  const OWNED_WITHOUT_OFFER =
    'Un recurso propio no viene de una oferta: márcalo como contratado para vincularla.';
  const OFFER_OF_OTHER_COMPANY =
    'Esa oferta es de otra empresa: elige una oferta de la empresa del recurso o cambia antes la empresa.';
  const duplicateWarehouse = (route: Route, dup: Json, role: string) =>
    json(
      route,
      {
        code: 'DUPLICATE',
        message: `Ya existe el almacén «${dup.name}».`,
        current: viewWarehouse(dup, role),
      },
      409,
    );
  /** Find-or-create by name (warehouseId wins), as resolveWarehouseRef. */
  const warehouseFrom = (input: Json, by: Json): Json | null | undefined => {
    if (typeof input.warehouseId === 'string') {
      return state.warehouses.find(w => w.id === input.warehouseId) ?? null;
    }
    if (input.warehouseId === null && input.warehouseName === undefined) {
      return null;
    }
    if (input.warehouseName === undefined) return undefined;
    const n = text(input.warehouseName);
    if (!n) return null;
    let w = state.warehouses.find(
      x => nameKey(x.name as string) === nameKey(n),
    );
    if (!w) {
      w = makeWarehouse(`w-new-${++seq}`, n, {
        createdBy: by,
        updatedBy: by,
        createdAt: clock(),
        updatedAt: clock(),
      });
      state.warehouses.push(w);
      log(by, {type: 'warehouse', id: w.id as string, label: n}, 'create');
    }
    return w;
  };
  const quantityProblem = (v: unknown) =>
    v === undefined ||
    v === null ||
    (typeof v === 'number' && isValidQuantity(v))
      ? null
      : 'Cantidad no válida: de 0 a 1.000.000, con dos decimales como mucho.';
  /** Applies a resource input to `r` (create or update); returns field errors. */
  const applyResource = (
    r: Json,
    input: Json,
    by: Json,
  ): Record<string, string> => {
    const fields: Record<string, string> = {};
    const ownership = (input.ownership ?? r.ownership) as string;
    if (ownership === 'owned') {
      if (input.companyId) fields.companyId = OWNED_WITHOUT_COMPANY;
      if (input.companyName) fields.companyName = OWNED_WITHOUT_COMPANY;
      if (input.offerId) fields.offerId = OWNED_WITHOUT_OFFER;
    }
    if ('name' in input && !text(input.name)) {
      fields.name = 'El nombre es obligatorio.';
    }
    const q = quantityProblem(input.quantity);
    if (q) fields.quantity = q;
    if (typeof input.categoryId === 'string') {
      const c = state.categories.find(x => x.id === input.categoryId);
      if (!c || c.scope !== 'resource') {
        fields.categoryId =
          'Esa categoría ya no existe o no es de recursos de esta organización.';
      }
    }
    const offer =
      typeof input.offerId === 'string'
        ? state.offers.find(o => o.id === input.offerId)
        : undefined;
    if (ownership === 'contracted' && typeof input.offerId === 'string') {
      if (!offer) {
        fields.offerId =
          'No encontramos esa oferta en esta organización: puede que se haya eliminado.';
      }
    }
    if (Object.keys(fields).length) return fields;

    if ('name' in input) r.name = text(input.name);
    r.ownership = ownership;
    if ('quantity' in input) r.quantity = input.quantity ?? null;
    if ('unit' in input) r.unit = text(input.unit) ?? 'unidades';
    for (const k of ['dimensions', 'location', 'notes']) {
      if (k in input) r[k] = text(input[k]);
    }
    for (const k of [
      'categoryId',
      'condition',
      'availability',
      'toAssess',
      ...PROVENANCE,
    ]) {
      if (k in input) r[k] = input[k];
    }
    const w = warehouseFrom(input, by);
    if (w !== undefined) r.warehouse = refOf(w);
    if (ownership === 'owned') {
      r.company = null;
      r.offerId = null;
      return {};
    }
    const companyGiven = 'companyId' in input || 'companyName' in input;
    const before = (r.company as Json | null)?.id ?? null;
    if (companyGiven) {
      r.company =
        input.companyId === null && !text(input.companyName)
          ? null
          : refOf(companyFrom(input));
    }
    const companyId = (r.company as Json | null)?.id ?? null;
    if (input.offerId === undefined) {
      if (companyId === null || companyId !== before) r.offerId = null;
    } else if (input.offerId === null) {
      r.offerId = null;
    } else if (offer) {
      const offerCompany = (offer.company as Json).id;
      if (companyGiven || companyId !== null) {
        if (offerCompany !== companyId) {
          return {offerId: OFFER_OF_OTHER_COMPANY};
        }
      } else {
        r.company = {...(offer.company as Json)};
      }
      r.offerId = offer.id;
    }
    return {};
  };
  /** Contract field names of an input, for the activity log. */
  const changedOf = (input: Json) => [
    ...new Set(
      Object.keys(input)
        .filter(k => k !== 'version' && k !== 'organizationId')
        .map(k =>
          k === 'warehouseName' || k === 'warehouseId'
            ? 'warehouse'
            : k === 'companyName' || k === 'companyId'
              ? 'company'
              : k === 'eventId'
                ? 'event'
                : k,
        ),
    ),
  ];
  const noteRefProblem = (input: Json): Record<string, string> => {
    const fields: Record<string, string> = {};
    if (typeof input.eventId === 'string') {
      if (!state.events.some(e => e.id === input.eventId)) {
        fields.eventId =
          'No encontramos ese evento en esta organización: puede que se haya eliminado.';
      }
    }
    const r = input.ref as {type?: string; id?: string} | null | undefined;
    if (r && (!r.type || !r.id || !refRecord(r.type, r.id))) {
      fields.ref =
        'No encontramos ese registro en esta organización: puede que se haya eliminado.';
    }
    return fields;
  };
  const applyNoteLinks = (n: Json, input: Json) => {
    if ('eventId' in input) {
      const e = state.events.find(x => x.id === input.eventId);
      n.event = e ? {id: e.id, name: e.name} : null;
    }
    if ('ref' in input) {
      const r = input.ref as {type: string; id: string} | null;
      const target = r ? refRecord(r.type, r.id) : undefined;
      n.ref =
        r && target
          ? {
              type: r.type,
              id: r.id,
              label: (target.title ?? target.name) as string,
            }
          : null;
    }
  };
  const noteEntity = (n: Json) => {
    // Safety audit: like `labelOf` (notes/refs.ts), a note on a company or
    // an offer is labelled by what it is, never by its name.
    const view = viewNote(n, 'member');
    const link = view.ref as {type: string} | null;
    const generic =
      link && (link.type === 'company' || link.type === 'offer')
        ? {...view, ref: {...link, label: MOCK_DIRECTORY_REF_LABEL[link.type]}}
        : view;
    return {
      type: 'note',
      id: n.id as string,
      label: noteLabel(generic as never),
    };
  };

  const inventoryRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      url: URL;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, url, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const now = clock;
    const role = user.role;
    const deleteVersion = () => Number(url.searchParams.get('version') ?? NaN);

    // warehouses
    if (path === `/organizations/${ORG}/warehouses` && method === 'GET') {
      return json(route, {
        items: byName(state.warehouses).map(w => viewWarehouse(w, role)),
      });
    }
    if (path === '/warehouses' && method === 'POST') {
      const n = text(input.name);
      if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
      const dup = state.warehouses.find(
        w => nameKey(w.name as string) === nameKey(n),
      );
      if (dup) return duplicateWarehouse(route, dup, role);
      const placeFields = placeProblems(input);
      if (placeFields) return validation(route, placeFields);
      const created = makeWarehouse(newId(input, `w-new-${++seq}`), n, {
        address: text(input.address),
        notes: text(input.notes),
        acronym: text(input.acronym),
        openingHours: input.openingHours ?? null,
        source: input.source ?? null,
        verification: input.verification ?? 'draft',
        createdBy: ref,
        updatedBy: ref,
        createdAt: now(),
        updatedAt: now(),
      });
      state.warehouses.push(created);
      log(
        ref,
        {type: 'warehouse', id: created.id as string, label: n},
        'create',
      );
      return json(route, viewWarehouse(created, role), 201);
    }
    const warehouseMatch = /^\/warehouses\/([^/]+)$/.exec(path);
    if (warehouseMatch) {
      const w = state.warehouses.find(x => x.id === warehouseMatch[1]);
      if (!w) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = versionOf(
          route,
          w,
          input.version,
          viewWarehouse(w, role),
          WAREHOUSE_CONFLICT,
        );
        if (bad) return bad;
        const placeFields = placeProblems(input);
        if (placeFields) return validation(route, placeFields);
        if ('name' in input) {
          const n = text(input.name);
          if (!n) return validation(route, {name: 'El nombre es obligatorio.'});
          const dup = state.warehouses.find(
            x => x !== w && nameKey(x.name as string) === nameKey(n),
          );
          if (dup) return duplicateWarehouse(route, dup, role);
          w.name = n;
          for (const r of state.resources) {
            if ((r.warehouse as Json | null)?.id === w.id) {
              r.warehouse = {id: w.id, name: n};
            }
          }
        }
        for (const k of ['address', 'notes', 'acronym']) {
          if (k in input) w[k] = text(input[k]);
        }
        if ('openingHours' in input) {
          w.openingHours = input.openingHours ?? null;
        }
        for (const k of PROVENANCE) if (k in input) w[k] = input[k];
        bump(w, ref);
        log(
          ref,
          {type: 'warehouse', id: w.id as string, label: w.name as string},
          'update',
          changedOf(input),
        );
        return json(route, viewWarehouse(w, role));
      }
      if (method === 'DELETE') {
        const bad = versionOf(
          route,
          w,
          deleteVersion(),
          viewWarehouse(w, role),
          WAREHOUSE_CONFLICT,
        );
        if (bad) return bad;
        state.warehouses = state.warehouses.filter(x => x !== w);
        unlinkResources('warehouse', w.id as string, ref);
        unlinkNotes('warehouse', w.id as string, ref);
        log(
          ref,
          {type: 'warehouse', id: w.id as string, label: w.name as string},
          'delete',
        );
        return route.fulfill({status: 204, body: ''});
      }
    }

    // resources
    if (path === `/organizations/${ORG}/resources` && method === 'GET') {
      return json(route, {
        items: byName(state.resources).map(r => viewResource(r, role)),
      });
    }
    if (path === '/resources' && method === 'POST') {
      if (!text(input.name)) {
        return validation(route, {name: 'El nombre es obligatorio.'});
      }
      const created = makeResource(
        newId(input, `r-new-${++seq}`),
        text(input.name)!,
        {
          createdBy: ref,
          updatedBy: ref,
          createdAt: now(),
          updatedAt: now(),
        },
      );
      const fields = applyResource(
        created,
        {ownership: 'owned', ...input},
        ref,
      );
      if (Object.keys(fields).length) return validation(route, fields);
      state.resources.push(created);
      log(
        ref,
        {
          type: 'resource',
          id: created.id as string,
          label: created.name as string,
        },
        'create',
      );
      return json(route, viewResource(created, role), 201);
    }
    const resourceMatch = /^\/resources\/([^/]+)$/.exec(path);
    if (resourceMatch) {
      const r = state.resources.find(x => x.id === resourceMatch[1]);
      if (!r) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = versionOf(
          route,
          r,
          input.version,
          viewResource(r, role),
          RESOURCE_CONFLICT,
        );
        if (bad) return bad;
        // Validate on a copy, so a 400 changes nothing.
        const draft = structuredClone(r);
        const fields = applyResource(draft, input, ref);
        if (Object.keys(fields).length) return validation(route, fields);
        // M5: a different quantity, unit or size is different material: the
        // live tasks that use it lose their declared subsoil review.
        const material = (x: Json) =>
          JSON.stringify([x.quantity, x.unit, x.dimensions]);
        if (material(draft) !== material(r)) {
          for (const t of state.tasks) {
            if (
              t.subsoilReview &&
              t.status !== 'done' &&
              t.status !== 'cancelled' &&
              ((t.resourceIds as string[]) ?? []).includes(r.id as string)
            ) {
              t.subsoilReview = null;
              bump(t, ref);
            }
          }
        }
        Object.assign(r, draft);
        bump(r, ref);
        log(
          ref,
          {type: 'resource', id: r.id as string, label: r.name as string},
          'update',
          changedOf(input),
        );
        return json(route, viewResource(r, role));
      }
      if (method === 'DELETE') {
        const bad = versionOf(
          route,
          r,
          deleteVersion(),
          viewResource(r, role),
          RESOURCE_CONFLICT,
        );
        if (bad) return bad;
        state.resources = state.resources.filter(x => x !== r);
        for (const t of state.tasks) {
          const ids = (t.resourceIds as string[]) ?? [];
          if (!ids.includes(r.id as string)) continue;
          t.resourceIds = ids.filter(x => x !== r.id);
          // M5: its material changed, so the declared subsoil review goes.
          t.subsoilReview = null;
          bump(t, ref);
        }
        unlinkNotes('resource', r.id as string, ref);
        log(
          ref,
          {type: 'resource', id: r.id as string, label: r.name as string},
          'delete',
        );
        return route.fulfill({status: 204, body: ''});
      }
    }

    // notes
    if (path === `/organizations/${ORG}/notes` && method === 'GET') {
      const items = [...state.notes]
        .sort(
          (a, b) =>
            Date.parse(b.createdAt as string) -
              Date.parse(a.createdAt as string) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .map(n => viewNote(n, role));
      return json(route, {items});
    }
    if (path === '/notes' && method === 'POST') {
      const fields = noteRefProblem(input);
      if (!NOTE_KINDS.includes(input.kind as NoteKind)) {
        fields.kind = 'Indica qué es: nota, incidencia, decisión…';
      }
      const t = typeof input.text === 'string' ? input.text.trim() : '';
      if (!t || t.length > NOTE_TEXT_MAX) fields.text = 'Escribe el texto.';
      if (Object.keys(fields).length) return validation(route, fields);
      const created = makeNote(
        newId(input, `n-new-${++seq}`),
        input.kind as NoteKind,
        t,
        {
          resolved: input.resolved === true,
          resolvedBy: input.resolved === true ? ref : null,
          resolvedAt: input.resolved === true ? now() : null,
          source: input.source ?? null,
          verification: input.verification ?? 'draft',
          createdBy: ref,
          updatedBy: ref,
          createdAt: now(),
          updatedAt: now(),
        },
      );
      applyNoteLinks(created, input);
      state.notes.push(created);
      log(ref, noteEntity(created), 'create');
      return json(route, viewNote(created, role), 201);
    }
    const noteMatch = /^\/notes\/([^/]+)$/.exec(path);
    if (noteMatch) {
      const n = state.notes.find(x => x.id === noteMatch[1]);
      if (!n) return error(route, 404, 'NOT_FOUND', 'No encontrado');
      if (method === 'PATCH') {
        const bad = versionOf(
          route,
          n,
          input.version,
          viewNote(n, role),
          NOTE_CONFLICT,
        );
        if (bad) return bad;
        const fields = noteRefProblem(input);
        if ('kind' in input && !NOTE_KINDS.includes(input.kind as NoteKind)) {
          fields.kind = 'Indica qué es: nota, incidencia, decisión…';
        }
        if ('text' in input) {
          const t = typeof input.text === 'string' ? input.text.trim() : '';
          if (!t || t.length > NOTE_TEXT_MAX) fields.text = 'Escribe el texto.';
        }
        // E3, same rules as server/src/notes/service.ts.
        const hasAnswers = state.answers.some(a => a.noteId === n.id);
        if (
          'kind' in input &&
          input.kind !== n.kind &&
          n.kind === 'open_question' &&
          hasAnswers
        ) {
          fields.kind = KIND_HAS_ANSWERS;
        }
        if (Object.keys(fields).length) return validation(route, fields);
        const flips =
          'resolved' in input &&
          Boolean(input.resolved) !== Boolean(n.resolved);
        if (
          flips &&
          n.kind === 'open_question' &&
          n.answer &&
          (n.createdBy as Json).id !== user.id
        ) {
          return error(route, 403, 'FORBIDDEN', ONLY_THE_ASKER);
        }
        if ('text' in input) n.text = (input.text as string).trim();
        for (const k of ['kind', 'resolved', ...PROVENANCE]) {
          if (k in input) n[k] = input[k];
        }
        if (flips) {
          n.resolvedBy = n.resolved ? ref : null;
          n.resolvedAt = n.resolved ? now() : null;
        }
        applyNoteLinks(n, input);
        bump(n, ref);
        log(ref, noteEntity(n), 'update', changedOf(input));
        return json(route, viewNote(n, role));
      }
      if (method === 'DELETE') {
        const bad = versionOf(
          route,
          n,
          deleteVersion(),
          viewNote(n, role),
          NOTE_CONFLICT,
        );
        if (bad) return bad;
        state.notes = state.notes.filter(x => x !== n);
        state.answers = state.answers.filter(a => a.noteId !== n.id);
        log(ref, noteEntity(n), 'delete');
        return route.fulfill({status: 204, body: ''});
      }
    }

    // E3: answers to open questions (server/src/notes/service.ts)
    const answersMatch = /^\/notes\/([^/]+)\/answers$/.exec(path);
    if (answersMatch) {
      const n = state.notes.find(x => x.id === answersMatch[1]);
      if (!n) return error(route, 404, 'NOT_FOUND', NOTE_NOT_FOUND);
      if (method === 'GET') {
        // Members see the text of every answer; guests never.
        // From the current answer back through `replacesId`.
        const mine = state.answers.filter(a => a.noteId === n.id);
        const byId = new Map(mine.map(a => [a.id, a]));
        const replaced = new Set(mine.map(a => a.replacesId).filter(Boolean));
        const ordered: Json[] = [];
        let at = mine.find(a => !replaced.has(a.id));
        while (at && ordered.length < mine.length) {
          ordered.push(at);
          at = at.replacesId ? byId.get(at.replacesId as string) : undefined;
        }
        return json(route, {items: ordered.map(a => viewAnswer(a, role))});
      }
      if (method === 'POST') {
        if (n.kind !== 'open_question') {
          return error(route, 400, 'VALIDATION', NOT_A_QUESTION);
        }
        if (n.resolved) return error(route, 400, 'VALIDATION', QUESTION_CLOSED);
        const t = typeof input.text === 'string' ? input.text.trim() : '';
        if (!t || t.length > NOTE_TEXT_MAX) {
          return validation(route, {
            text: `Escribe el texto (como mucho ${NOTE_TEXT_MAX} caracteres).`,
          });
        }
        const current = (n.answer as Json | null) ?? null;
        const replaces = (input.replaces as string | null | undefined) ?? null;
        if (replaces !== ((current?.id as string | undefined) ?? null)) {
          const known =
            replaces === null ||
            state.answers.some(a => a.id === replaces && a.noteId === n.id);
          if (!known) {
            return validation(route, {replaces: REPLACES_UNKNOWN});
          }
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message: ANSWER_CHANGED,
              current: current ? viewAnswer(current, role) : null,
            },
            409,
          );
        }
        const answer = makeAnswer(crypto.randomUUID(), n.id as string, t, {
          answeredBy: ref,
          answeredAt: now(),
          replacesId: current?.id ?? null,
        });
        state.answers.push(answer);
        n.answer = answer;
        bump(n, ref);
        log(ref, noteEntity(n), 'update', ['answer']);
        return json(route, viewAnswer(answer, role), 201);
      }
    }

    // E3: material photos (server/src/media/service.ts)
    const findMedia = (id: string) => {
      for (const r of state.resources) {
        const m = ((r.media as Json[] | undefined) ?? []).find(
          x => x.id === id,
        );
        if (m) return {owner: r, media: m};
      }
      return null;
    };
    const mediaChanged = (owner: Json) =>
      log(
        ref,
        {type: 'resource', id: owner.id as string, label: owner.name as string},
        'update',
        ['media'],
      );
    if (path === '/media' && method === 'POST') {
      const deviceId = input.id;
      if (deviceId !== undefined) {
        if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) {
          return validation(route, {id: 'Identificador no válido.'});
        }
        const hit = findMedia(deviceId.toLowerCase());
        if (hit) {
          if ((hit.media.createdBy as Json).id !== user.id) {
            return validation(route, {
              id: 'Este identificador ya está en uso.',
            });
          }
          // A replay: the photo as it is, nothing written.
          return json(route, mediaInfo(hit.media), 200);
        }
      }
      const fields: Record<string, string> = {};
      if (input.ownerType !== 'resource' && input.ownerType !== 'user') {
        fields.ownerType = 'Tipo de registro no válido para una foto.';
      }
      if (
        !(MEDIA_CONTENT_TYPES as readonly string[]).includes(
          input.contentType as string,
        )
      ) {
        fields.contentType = MEDIA_TYPE_INVALID;
      }
      for (const k of ['width', 'height'] as const) {
        const v = input[k];
        if (
          typeof v !== 'number' ||
          !Number.isInteger(v) ||
          v < 1 ||
          v > MEDIA_MAX_SIDE
        ) {
          fields[k] = MEDIA_SIDE_INVALID;
        }
      }
      const data = typeof input.data === 'string' ? input.data : null;
      if (
        data === null ||
        data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
      ) {
        fields.data = MEDIA_DATA_INVALID;
      } else if (data.length > Math.ceil(MEDIA_MAX_BYTES / 3) * 4) {
        fields.data = MEDIA_TOO_BIG;
      }
      if (Object.keys(fields).length) return validation(route, fields);
      if (input.ownerType !== 'resource') {
        return validation(route, {ownerType: MEDIA_OWNER_TYPE_LATER});
      }
      const owner = state.resources.find(r => r.id === input.ownerId);
      if (!owner) return validation(route, {ownerId: MEDIA_OWNER_NOT_FOUND});
      const bytes = Buffer.from(data!, 'base64');
      const kind = imageKind(bytes);
      if (!kind) return validation(route, {data: MEDIA_NOT_AN_IMAGE});
      if (kind !== input.contentType) {
        return validation(route, {data: MEDIA_TYPE_MISMATCH});
      }
      if (bytes.length > MEDIA_MAX_BYTES) {
        return validation(route, {data: MEDIA_TOO_BIG});
      }
      const list = (owner.media as Json[] | undefined) ?? [];
      if (list.length >= MEDIA_PER_RECORD) {
        return json(
          route,
          {
            code: 'VALIDATION',
            message: MEDIA_TOO_MANY,
            fields: {ownerId: MEDIA_TOO_MANY},
          },
          400,
        );
      }
      const main = list.length === 0 || input.main === true;
      const created = makeMedia(
        typeof deviceId === 'string'
          ? deviceId.toLowerCase()
          : `m-new-${++seq}`,
        owner.id as string,
        {
          contentType: input.contentType,
          bytes: bytes.length,
          width: input.width,
          height: input.height,
          main,
          createdBy: ref,
          createdAt: now(),
          data,
        },
      );
      owner.media = [
        ...(main ? list.map(m => ({...m, main: false})) : list),
        created,
      ];
      mediaChanged(owner);
      return json(route, mediaInfo(created), 201);
    }
    const mediaMatch = /^\/media\/([^/]+)$/.exec(path);
    if (mediaMatch) {
      const hit = findMedia(mediaMatch[1]);
      if (!hit) return error(route, 404, 'NOT_FOUND', MEDIA_NOT_FOUND);
      const {owner, media} = hit;
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: media.contentType as string,
          headers: {'Cache-Control': 'private, max-age=31536000, immutable'},
          body: Buffer.from(media.data as string, 'base64'),
        });
      }
      if (method === 'PATCH') {
        if (input.main !== true) {
          return validation(route, {
            main: 'Para cambiar la foto principal envía {main: true} en la que quieras.',
          });
        }
        owner.media = ((owner.media as Json[]) ?? []).map(m => ({
          ...m,
          main: m.id === media.id,
        }));
        mediaChanged(owner);
        return json(route, mediaInfo({...media, main: true}));
      }
      if (method === 'DELETE') {
        let rest = ((owner.media as Json[]) ?? []).filter(m => m !== media);
        if (media.main && rest.length) {
          const oldest = [...rest].sort(
            (a, b) =>
              Date.parse(a.createdAt as string) -
                Date.parse(b.createdAt as string) ||
              String(a.id).localeCompare(String(b.id)),
          )[0];
          rest = rest.map(m => ({...m, main: m === oldest}));
        }
        owner.media = rest;
        mediaChanged(owner);
        return route.fulfill({status: 204, body: ''});
      }
    }
    return null;
  };

  // ---- milestone 5: delay hypotheses (server/src/hypotheses/service.ts)
  const HYPOTHESIS_NOT_FOUND =
    'No encontramos esa hipótesis: puede que se haya descartado o que su tarea se haya eliminado.';
  const ALREADY_APPLIED =
    'Esta hipótesis ya se aplicó al plan: se conserva como registro de la decisión.';
  const PLAN_CHANGED =
    'El plan ha cambiado desde que revisaste esta hipótesis. Mira de nuevo qué tareas se mueven antes de aplicarla.';
  const DELAY_BLOCKED: Record<string, string> = {
    finished: 'Esa tarea ya está hecha: no se puede retrasar.',
    cancelled: 'Esa tarea está cancelada: no se puede retrasar.',
    untimed:
      'Esa tarea no tiene hora de inicio y de fin: ponle horario para poder calcular un retraso.',
  };
  const hypothesisEntity = (h: Json) => ({
    type: 'hypothesis',
    id: h.id as string,
    label: hypothesisLabel(h as never),
  });

  const hypothesisRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const role = user.role;

    if (path === `/organizations/${ORG}/hypotheses` && method === 'GET') {
      const items = [...state.hypotheses]
        .sort(
          (a, b) =>
            Date.parse(b.createdAt as string) -
              Date.parse(a.createdAt as string) ||
            String(b.id).localeCompare(String(a.id)),
        )
        .map(h => viewHypothesis(h, role));
      return json(route, {items});
    }
    if (path === '/hypotheses' && method === 'POST') {
      const fields: Record<string, string> = {};
      const task = state.tasks.find(t => t.id === input.taskId);
      if (!task) {
        fields.taskId =
          'No encontramos esa tarea en esta organización: puede que se haya eliminado.';
      } else {
        const blocker = delayBlocker(task as unknown as Task);
        if (blocker) fields.taskId = DELAY_BLOCKED[blocker];
      }
      if (
        typeof input.delayMinutes !== 'number' ||
        !isValidDelay(input.delayMinutes)
      ) {
        fields.delayMinutes =
          'Indica el retraso en minutos enteros, entre 1 y 1440 (un día).';
      }
      const mode = (input.mode ?? 'shift') as DelayMode;
      if (mode !== 'shift' && mode !== 'extend') {
        fields.mode = 'Tipo de retraso no válido.';
      }
      const note = text(input.note);
      if (note && note.length > HYPOTHESIS_NOTE_MAX) {
        fields.note = `Como mucho ${HYPOTHESIS_NOTE_MAX} caracteres.`;
      }
      if (Object.keys(fields).length) return validation(route, fields);
      const created = makeHypothesis(
        `h-new-${++seq}`,
        {id: task!.id as string, title: task!.title as string},
        input.delayMinutes as number,
        {
          mode,
          estimated: input.estimated === true,
          note,
          createdBy: ref,
          createdAt: clock(),
        },
      );
      state.hypotheses.push(created);
      log(ref, hypothesisEntity(created), 'create');
      return json(route, viewHypothesis(created, role), 201);
    }
    const applyMatch = /^\/hypotheses\/([^/]+)\/apply$/.exec(path);
    const oneMatch = /^\/hypotheses\/([^/]+)$/.exec(path);
    const id = applyMatch?.[1] ?? oneMatch?.[1];
    if (!id) return null;
    const h = state.hypotheses.find(x => x.id === id);
    if (!h) return error(route, 404, 'NOT_FOUND', HYPOTHESIS_NOT_FOUND);

    if (oneMatch && method === 'DELETE') {
      if (h.appliedAt) return error(route, 400, 'VALIDATION', ALREADY_APPLIED);
      state.hypotheses = state.hypotheses.filter(x => x !== h);
      log(ref, hypothesisEntity(h), 'delete');
      return route.fulfill({status: 204, body: ''});
    }
    if (applyMatch && method === 'POST') {
      const expected = input.expected as ShiftExpectation[] | undefined;
      if (!Array.isArray(expected) || expected.length === 0) {
        return validation(route, {
          expected:
            'Falta la lista de tareas que se mueven: vuelve a abrir la hipótesis y confirma de nuevo.',
        });
      }
      if (new Set(expected.map(e => e.id)).size !== expected.length) {
        return validation(route, {
          expected:
            'La misma tarea aparece dos veces en la confirmación: vuelve a abrir la hipótesis y confirma de nuevo.',
        });
      }
      if (h.appliedAt) return error(route, 400, 'VALIDATION', ALREADY_APPLIED);
      const tasks = state.tasks as unknown as Task[];
      const root = h.taskId ? tasks.find(t => t.id === h.taskId) : undefined;
      const impact =
        root && !delayBlocker(root)
          ? simulateDelay(
              delayItems(tasks, root.id),
              root.id,
              h.delayMinutes as number,
              h.mode as DelayMode,
            )
          : null;
      const computed = impact ? shiftExpectations(impact, tasks) : [];
      const forced = state.forceApplyConflict > 0;
      if (forced) state.forceApplyConflict--;
      if (forced || !root || !impact || !sameShift(expected, computed)) {
        const involved = new Set([
          ...expected.map(e => e.id),
          ...computed.map(c => c.id),
          ...(h.taskId ? [h.taskId as string] : []),
        ]);
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: PLAN_CHANGED,
            current: state.tasks
              .filter(t => involved.has(t.id as string))
              .map(t => viewTask(t, role)),
          },
          409,
        );
      }
      const at = clock();
      const moved: Json[] = [];
      for (const s of computed) {
        const t = state.tasks.find(x => x.id === s.id)!;
        const days = daysForInstants(
          s.startsAt,
          s.endsAt,
          (t.timezone as string) || TZ,
        );
        const status =
          s.id === root!.id &&
          input.markDelayed === true &&
          (t.status === 'planned' || t.status === 'confirmed')
            ? 'delayed'
            : t.status;
        const changed = [
          ...(status !== t.status ? ['status'] : []),
          ...(days.date !== t.date ? ['date'] : []),
          ...(days.endDate !== t.endDate ? ['endDate'] : []),
          'startsAt',
          'endsAt',
        ];
        Object.assign(t, {
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          date: days.date,
          endDate: days.endDate,
          status,
          version: (t.version as number) + 1,
          updatedBy: ref,
          updatedAt: at,
        });
        log(
          ref,
          {type: 'task', id: t.id as string, label: t.title as string},
          'update',
          changed,
        );
        moved.push(t);
      }
      Object.assign(h, {appliedAt: at, appliedBy: ref});
      log(ref, hypothesisEntity(h), 'update', ['appliedAt']);
      return json(route, {
        hypothesis: viewHypothesis(h, role),
        tasks: moved.map(t => viewTask(t, role)),
      });
    }
    return null;
  };

  // ---- Revisión 1 · E2: moves, accepted conflicts, venue acronym and hours
  // Mirrors server/src/{tasks/move,acceptances,venues}: a move is recomputed
  // with the shared `simulateMove` and written only when it equals the
  // confirmed `expected` (`sameShift`), else 409 with the involved tasks; a
  // root outside its venue's known hours is a 400 `fields.minutes`; «Deshacer»
  // writes the expected windows back when versions and durations still
  // match. An acceptance needs the warning on the current plan with the same
  // windows (409 VERSION_CONFLICT otherwise) and no live acceptance of it
  // (409 DUPLICATE). Venue PATCH checks `version`.
  const MOVE_PLAN_CHANGED =
    'El plan ha cambiado desde que revisaste este cambio de hora. Mira de nuevo qué tareas se mueven antes de confirmarlo.';
  const UNDO_PLAN_CHANGED =
    'Alguna de estas tareas ha cambiado desde que se movió: ya no se puede deshacer de golpe. Revísalas una a una.';
  const WARNING_GONE =
    'Este aviso ha cambiado o ya no está en el plan: revísalo de nuevo antes de mantener ambas tareas.';
  const NOT_A_CONFLICT =
    'Solo se pueden aceptar conflictos. Los recordatorios (rutas de emergencia, Carpa Amarilla, subsuelo, recursos) siguen a la vista.';
  const ALREADY_ACCEPTED =
    'Este conflicto ya está aceptado con las horas actuales.';
  const VENUE_CONFLICT =
    'Otra persona ha cambiado este lugar mientras lo editabas.';
  const msOf = (iso: unknown) =>
    typeof iso === 'string' ? Date.parse(iso) : NaN;
  const venueView = (v: Json): Json => ({
    organizationId: ORG,
    address: null,
    acronym: null,
    openingHours: null,
    version: 1,
    ...v,
  });
  const writeWindows = (windows: ShiftExpectation[], ref: Json): Json[] => {
    const at = clock();
    const moved: Json[] = [];
    for (const s of [...windows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const t = state.tasks.find(x => x.id === s.id)!;
      if (
        msOf(t.startsAt) === msOf(s.startsAt) &&
        msOf(t.endsAt) === msOf(s.endsAt)
      ) {
        continue;
      }
      const days = daysForInstants(
        s.startsAt,
        s.endsAt,
        (t.timezone as string) || TZ,
      );
      Object.assign(t, {
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        date: days.date,
        endDate: days.endDate,
        version: (t.version as number) + 1,
        updatedBy: ref,
        updatedAt: at,
      });
      log(
        ref,
        {type: 'task', id: t.id as string, label: t.title as string},
        'update',
        ['startsAt', 'endsAt'],
      );
      moved.push(t);
    }
    return moved;
  };

  const movesRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const role = user.role;
    const tasks = state.tasks as unknown as Task[];
    const involvedConflict = (ids: string[], message: string) =>
      json(
        route,
        {
          code: 'VERSION_CONFLICT',
          message,
          current: state.tasks
            .filter(t => new Set(ids).has(t.id as string))
            .map(t => viewTask(t, role)),
        },
        409,
      );

    const moveMatch = /^\/tasks\/([^/]+)\/move$/.exec(path);
    if (moveMatch && method === 'POST') {
      const root = tasks.find(t => t.id === moveMatch[1]);
      if (!root) {
        return error(
          route,
          404,
          'NOT_FOUND',
          'No encontramos esa tarea: puede que se haya eliminado.',
        );
      }
      const minutes = input.minutes as number;
      const expected = input.expected as ShiftExpectation[] | undefined;
      if (typeof minutes !== 'number' || !isValidMove(minutes)) {
        return validation(route, {
          minutes:
            'Indica un cambio en minutos, múltiplo de 5, de como mucho un día.',
        });
      }
      if (!Array.isArray(expected) || expected.length === 0) {
        return validation(route, {
          expected: 'Falta la lista de tareas que se mueven.',
        });
      }
      if (new Set(expected.map(e => e.id)).size !== expected.length) {
        return validation(route, {
          expected: 'La misma tarea aparece dos veces en la confirmación.',
        });
      }
      const byId = new Map(tasks.map(t => [t.id, t]));
      if (input.origin === 'undo') {
        const fits = expected.every(e => {
          const t = byId.get(e.id);
          return (
            !!t &&
            t.version === e.version &&
            msOf(e.endsAt) - msOf(e.startsAt) ===
              msOf(t.endsAt) - msOf(t.startsAt)
          );
        });
        if (!fits || !expected.some(e => e.id === root.id)) {
          return involvedConflict(
            [root.id, ...expected.map(e => e.id)],
            UNDO_PLAN_CHANGED,
          );
        }
        const moved = writeWindows(expected, ref);
        return json(route, {tasks: moved.map(t => viewTask(t, role))});
      }
      const blocker = moveBlocker(root);
      if (blocker) return validation(route, {minutes: MOVE_BLOCKED[blocker]});
      const impact = simulateMove(moveItems(tasks), root.id, minutes);
      const computed = shiftExpectations(impact, tasks);
      const forced = state.forceMoveConflict > 0;
      if (forced) state.forceMoveConflict--;
      if (forced || !computed.length || !sameShift(expected, computed)) {
        return involvedConflict(
          [root.id, ...expected.map(e => e.id), ...computed.map(c => c.id)],
          MOVE_PLAN_CHANGED,
        );
      }
      const venue = root.venue
        ? (state.venues.find(v => v.id === root.venue!.id) as Json | undefined)
        : undefined;
      const hours = (venue?.openingHours ?? null) as OpeningHours | null;
      const mine = computed.find(c => c.id === root.id);
      if (venue && hours && mine && !withinOpeningHours(mine, hours, TZ)) {
        const message = outsideHoursMessage(venue.name as string, hours);
        return json(
          route,
          {code: 'VALIDATION', message, fields: {minutes: message}},
          400,
        );
      }
      const moved = writeWindows(computed, ref);
      return json(route, {tasks: moved.map(t => viewTask(t, role))});
    }

    if (path === `/organizations/${ORG}/conflict-acceptances`) {
      if (method !== 'GET') return null;
      return json(route, {
        items: state.acceptances.map(a => redact('acceptance', a, role)),
      });
    }
    if (path === '/conflict-acceptances' && method === 'POST') {
      const reason = text(input.reason) ?? '';
      if (
        reason.length < ACCEPT_REASON_MIN ||
        reason.length > ACCEPT_REASON_MAX
      ) {
        return validation(route, {
          reason: `Escribe un motivo breve, de ${ACCEPT_REASON_MIN} a ${ACCEPT_REASON_MAX} caracteres.`,
        });
      }
      const warnings = planWarnings(
        tasks,
        state.events as never,
        state.resources as never,
      );
      const warning = warnings.find(w => w.key === input.warningKey);
      if (warning && !isAcceptable(warning)) {
        return validation(route, {warningKey: NOT_A_CONFLICT});
      }
      const sent = (input.windows ?? []) as AcceptedWindow[];
      const windows = warning ? windowsFor(warning, tasks) : null;
      if (!warning || !windows || !sameWindows(sent, windows)) {
        return involvedConflict(
          [...sent.map(w => w.taskId), ...(warning?.taskIds ?? [])],
          WARNING_GONE,
        );
      }
      const existing = state.acceptances.find(
        a =>
          a.warningKey === warning.key && acceptanceApplies(a as never, tasks),
      );
      if (existing) {
        return json(
          route,
          {
            code: 'DUPLICATE',
            message: ALREADY_ACCEPTED,
            current: redact('acceptance', existing, role),
          },
          409,
        );
      }
      const created: Json = {
        id: `ca-new-${++seq}`,
        organizationId: ORG,
        warningKey: warning.key,
        windows,
        reason,
        acceptedBy: ref,
        ...(writingAsSupport ? {acceptedBySupport: writingAsSupport} : {}),
        acceptedAt: clock(),
      };
      state.acceptances.push(created);
      log(
        ref,
        {
          type: 'conflict_acceptance',
          id: created.id as string,
          label: warning.title,
        },
        'create',
      );
      return json(route, redact('acceptance', created, role), 201);
    }
    const acceptanceMatch = /^\/conflict-acceptances\/([^/]+)$/.exec(path);
    if (acceptanceMatch && method === 'DELETE') {
      const a = state.acceptances.find(x => x.id === acceptanceMatch[1]);
      if (!a) {
        return error(
          route,
          404,
          'NOT_FOUND',
          'No encontramos esa aceptación: puede que ya se haya retirado.',
        );
      }
      state.acceptances = state.acceptances.filter(x => x !== a);
      log(
        ref,
        {type: 'conflict_acceptance', id: a.id as string, label: 'Conflicto'},
        'delete',
      );
      return route.fulfill({status: 204, body: ''});
    }

    const venueMatch = /^\/venues\/([^/]+)$/.exec(path);
    if (venueMatch && method === 'PATCH') {
      const v = state.venues.find(x => x.id === venueMatch[1]) as
        Json | undefined;
      if (!v) {
        return error(route, 404, 'NOT_FOUND', 'No encontramos ese lugar.');
      }
      const current = venueView(v);
      if (input.version !== current.version) {
        return json(
          route,
          {code: 'VERSION_CONFLICT', message: VENUE_CONFLICT, current},
          409,
        );
      }
      const fields: Record<string, string> = {};
      if (input.acronym !== undefined && input.acronym !== null) {
        const problem = acronymProblem(String(input.acronym));
        if (problem) fields.acronym = problem;
      }
      const hours = input.openingHours as OpeningHours | null | undefined;
      if (hours) {
        const problem = openingHoursProblem(hours);
        if (problem) fields.openingHours = problem;
      }
      if (Object.keys(fields).length) return validation(route, fields);
      const changed: string[] = [];
      if (input.acronym !== undefined) {
        v.acronym = text(input.acronym);
        changed.push('acronym');
      }
      if (hours !== undefined) {
        v.openingHours = hours ?? null;
        changed.push('openingHours');
      }
      Object.assign(v, {
        ...current,
        acronym: v.acronym ?? null,
        openingHours: v.openingHours ?? null,
        version: (current.version as number) + 1,
        updatedBy: ref,
        updatedAt: clock(),
      });
      log(
        ref,
        {type: 'venue', id: v.id as string, label: v.name as string},
        'update',
        changed,
      );
      return json(route, venueView(v));
    }
    return null;
  };

  /** Path of predecessors from `from` back to `target`, if any. */
  const pathTo = (
    from: string,
    target: string,
    edges: Map<string, string[]>,
    seen = new Set<string>(),
  ): string[] | null => {
    if (from === target) return [from];
    if (seen.has(from)) return null;
    seen.add(from);
    for (const next of edges.get(from) ?? []) {
      const rest = pathTo(next, target, edges, seen);
      if (rest) return [from, ...rest];
    }
    return null;
  };
  /** Same checks and message as server/src/tasks/domain.ts. */
  const dependencyProblem = (
    taskId: string | null,
    dependsOn: string[],
  ): string | null => {
    if (taskId && dependsOn.includes(taskId)) return DEPENDS_ON_SELF;
    if (dependsOn.some(id => !state.tasks.some(t => t.id === id))) {
      return DEPENDS_ON_UNKNOWN;
    }
    if (!taskId) return null;
    const edges = new Map(
      state.tasks.map(t => [t.id as string, t.dependsOn as string[]]),
    );
    for (const dep of dependsOn) {
      const back = pathTo(dep, taskId, edges);
      if (back) {
        const title = (id: string) =>
          `«${state.tasks.find(t => t.id === id)?.title ?? id}»`;
        const cycle = [taskId, ...back].map(title).join(' → ');
        return `Esa dependencia crearía un ciclo: ${cycle}. Cada tarea esperaría a la siguiente y ninguna podría empezar.`;
      }
    }
    return null;
  };
  const validation = (route: Route, fields: Record<string, string>) =>
    json(
      route,
      {code: 'VALIDATION', message: 'Revisa los datos marcados.', fields},
      400,
    );
  const taskConflict = (route: Route, task: Json) =>
    json(
      route,
      {code: 'VERSION_CONFLICT', message: TASK_CONFLICT, current: task},
      409,
    );

  // ---- Revisión 1 · E6–E7 (Ofertas): versions, quote requests, proposals,
  // renewals and the public supplier routes. Mirrors server/src/{offer-terms,
  // quotes}: guests get 403 on every member route; reading needs
  // `directory.read`, deciding, the settings and assignees `offers.approve`;
  // versions are never edited (approving supersedes the previous one and
  // resolves the offer's renewal); a token works while its link is not
  // revoked or expired and its request is open; every public failure is the
  // same 404, `publicLimited` answers 429 with Retry-After. Link tokens travel
  // in the body (`{token, …}`), never in the path.
  const E7_LINK_GONE =
    'Este enlace no funciona: puede que haya caducado o que ya no sea válido. Pide uno nuevo a quien te lo envió.';
  const E7_ALREADY =
    'Ya has respondido a esta solicitud por este enlace. Si quieres cambiar algo, escribe a quien te lo envió.';
  const E7_CONFLICT = {
    proposal:
      'Otra persona ha decidido o cambiado esta propuesta. Revisa la versión actual.',
    request:
      'Otra persona ha cambiado esta solicitud. Revisa la versión actual.',
    settings:
      'Otra persona ha cambiado los ajustes de ofertas. Revisa la versión actual.',
    renewal:
      'Otra persona ha cambiado esta renovación. Revisa la versión actual.',
  };
  const e7Today = () => utcToLocal(clock(), TZ).date;
  const e7Token = () => `k${++seq}`.padEnd(43, 'x');
  const companyNamed = (name: string) =>
    state.companies.find(c => nameKey(String(c.name)) === nameKey(name));
  const viewVersion = (v: Json): Json => ({
    ...v,
    status: versionStatus(
      !!v.supersededAt,
      (v.terms as OfferTerms).acceptUntil,
      e7Today(),
    ),
  });
  const viewLink = (l: Json): Json => ({
    ...l,
    expired:
      l.status === 'waiting' && Date.parse(String(l.expiresAt)) <= Date.now(),
  });
  const viewRequest = (r: Json): Json => ({
    ...r,
    need: {...(r.need as Json)},
    links: (r.links as Json[]).map(viewLink),
  });
  const viewProposal = (p: Json): Json => {
    const content = p.content as ProposalContent;
    const match = companyNamed(content.company.name);
    return {
      ...p,
      company: match ? {id: match.id, name: match.name} : null,
      flags: proposalFlags(content, e7Today()),
    };
  };
  const newestFirst = (key: string) => (a: Json, b: Json) =>
    String(b[key]).localeCompare(String(a[key]));
  /** A link issued now: the only time its address exists. */
  const issueLink = (
    request: Json,
    company: Json,
    linkDays: number,
    origin: string,
  ): Json => {
    const token = e7Token();
    const link = makeQuoteLink(
      `ql-${++seq}`,
      {
        id: String(company.id),
        name: String(company.name),
      },
      {expiresAt: new Date(Date.now() + linkDays * 86_400_000).toISOString()},
    );
    (request.links as Json[]).push(link);
    state.supplierLinks.push({
      token,
      requestId: String(request.id),
      linkId: String(link.id),
    });
    return {
      linkId: link.id,
      company: {
        id: company.id,
        name: company.name,
        email: (company.email as string | null) ?? null,
      },
      url: `${origin}/${supplierLinkHash(token)}`,
      expiresAt: link.expiresAt,
    };
  };
  /** Same rule as the server's `lookup`: one answer for every failure. */
  const workingLink = (token: unknown) => {
    if (typeof token !== 'string' || !LINK_TOKEN_RE.test(token)) return null;
    const entry = state.supplierLinks.find(
      l => l.token === token && l.requestId,
    );
    const request = entry
      ? state.quoteRequests.find(r => r.id === entry.requestId)
      : undefined;
    const link = request
      ? (request.links as Json[]).find(l => l.id === entry!.linkId)
      : undefined;
    if (!request || !link) return null;
    if (request.status === 'closed' || link.status === 'revoked') return null;
    if (Date.parse(String(link.expiresAt)) <= Date.now()) return null;
    return {request, link};
  };
  const openLinkWorks = (token: unknown) =>
    typeof token === 'string' &&
    (state.offerSettings.openLink as Json).enabled === true &&
    state.supplierLinks.some(l => l.token === token && !l.requestId);
  /** The stored content of a proposal input (`toContent` on the server). */
  const contentOf = (
    input: Json,
    privacyVersion: string | null,
  ): {content: ProposalContent} | {fields: Record<string, string>} => {
    const fields: Record<string, string> = {};
    const company = (input.company ?? {}) as Json;
    if (!text(company.name)) {
      fields['company.name'] = 'Escribe el nombre de la empresa.';
    }
    const products = Array.isArray(input.products)
      ? (input.products as ProposalProductInput[])
      : [];
    if (!products.length) fields.products = 'Añade al menos un producto.';
    products.forEach((p, i) => {
      if (!text(p.name)) fields[`products.${i}.name`] = 'Escribe qué ofreces.';
    });
    const tax = normalizeTax(input.tax ?? null);
    if ('fields' in tax) {
      for (const [k, v] of Object.entries(
        tax.fields as Record<string, string>,
      )) {
        fields[`tax.${k}`] = v;
      }
    }
    if (Object.keys(fields).length) return {fields};
    const {privacyAccepted: _p, token: _t, ...rest} = input;
    void _p;
    void _t;
    const live = companyNamed(String(company.name));
    return {
      content: {
        ...(rest as unknown as ProposalContent),
        company: {
          name: text(company.name)!,
          contactName: text(company.contactName),
          phone: text(company.phone),
          email: text(company.email),
        },
        tax: proposalTax(
          tax.ok ? tax.tax : null,
          (live?.tax as TaxInfo | null | undefined) ?? null,
        ),
        privacyVersion,
      },
    };
  };
  const storeProposal = (content: ProposalContent, extra: Json): Json => {
    const created = makeProposal(`p-new-${++seq}`, content, {
      receivedAt: clock(),
      ...extra,
    });
    state.proposals.push(created);
    return created;
  };

  const publicOffersRoute = async (
    route: Route,
    path: string,
    method: string,
    body: unknown,
  ): Promise<void | null> => {
    if (!path.startsWith('/public/')) return null;
    if (method !== 'POST') {
      return error(route, 404, 'NOT_FOUND', E7_LINK_GONE);
    }
    if (state.publicLimited > 0) {
      state.publicLimited--;
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: {'Retry-After': '120'},
        body: JSON.stringify({
          code: 'RATE_LIMITED',
          message: 'Demasiados intentos. Espera unos minutos.',
        }),
      });
    }
    const input = (body ?? {}) as Json;
    if (JSON.stringify(input).length > PROPOSAL_BODY_MAX_BYTES) {
      return error(
        route,
        400,
        'VALIDATION',
        'La propuesta es demasiado grande: acorta los textos.',
      );
    }
    const gone = () => error(route, 404, 'NOT_FOUND', E7_LINK_GONE);
    const privacyMissing = () =>
      validation(route, {
        privacyAccepted:
          'Para enviar la propuesta tienes que aceptar el uso de tus datos.',
      });
    if (path === '/public/requests/lookup') {
      const found = workingLink(input.token);
      if (!found) return gone();
      const {request, link} = found;
      link.openedAt ??= clock();
      const need = request.need as Json;
      const category = state.categories.find(c => c.id === need.categoryId);
      const {categoryId: _c, ...rest} = need;
      void _c;
      return json(route, {
        organization: {name: state.organization.name},
        company: {name: (link.company as Json).name},
        need: {...rest, categoryName: (category?.name as string) ?? null},
        expiresAt: link.expiresAt,
        status:
          link.status === 'waiting'
            ? 'open'
            : link.status === 'declined'
              ? 'declined'
              : 'answered',
      });
    }
    if (path === '/public/requests/proposal') {
      const found = workingLink(input.token);
      if (!found) return gone();
      const {request, link} = found;
      if (link.status !== 'waiting') {
        return error(route, 400, 'VALIDATION', E7_ALREADY);
      }
      if (input.privacyAccepted !== true) return privacyMissing();
      const made = contentOf(input, '2026-11-27-borrador');
      if ('fields' in made) return validation(route, made.fields);
      const created = storeProposal(made.content, {
        via: 'link',
        request: {id: request.id, title: (request.need as Json).title},
        offer: request.offerId
          ? {
              id: request.offerId,
              name:
                state.offers.find(o => o.id === request.offerId)?.name ?? '',
            }
          : null,
        linkId: link.id,
      });
      Object.assign(link, {
        status: 'answered',
        answeredAt: clock(),
        proposalId: created.id,
      });
      request.version = (request.version as number) + 1;
      return json(route, {receivedAt: created.receivedAt}, 201);
    }
    if (path === '/public/requests/decline') {
      const found = workingLink(input.token);
      if (!found) return gone();
      const {request, link} = found;
      if (link.status !== 'waiting') {
        return error(route, 400, 'VALIDATION', E7_ALREADY);
      }
      Object.assign(link, {
        status: 'declined',
        answeredAt: clock(),
        declineReason: text(input.reason),
      });
      request.version = (request.version as number) + 1;
      return route.fulfill({status: 204, body: ''});
    }
    if (path === '/public/offers/lookup') {
      if (!openLinkWorks(input.token)) return gone();
      return json(route, {organization: {name: state.organization.name}});
    }
    if (path === '/public/offers/proposal') {
      if (!openLinkWorks(input.token)) return gone();
      if (input.privacyAccepted !== true) return privacyMissing();
      const made = contentOf(input, '2026-11-27-borrador');
      if ('fields' in made) return validation(route, made.fields);
      const created = storeProposal(made.content, {via: 'open'});
      return json(route, {receivedAt: created.receivedAt}, 201);
    }
    return gone();
  };

  const offersRoute = async (
    route: Route,
    ctx: {
      path: string;
      method: string;
      body: unknown;
      url: URL;
      user: {id: string; displayName: string; role: string};
      ref: Json;
    },
  ): Promise<void | null> => {
    const {path, method, url, user, ref} = ctx;
    const input = (ctx.body ?? {}) as Json;
    const isE7 =
      path === `/organizations/${ORG}/offer-versions` ||
      /^\/offers\/[^/]+\/versions$/.test(path) ||
      path.startsWith(`/organizations/${ORG}/quote-requests`) ||
      path.startsWith('/quote-requests') ||
      path.startsWith(`/organizations/${ORG}/proposals`) ||
      path.startsWith('/proposals') ||
      path.startsWith(`/organizations/${ORG}/offer-settings`) ||
      path.startsWith(`/organizations/${ORG}/offer-renewals`) ||
      path.startsWith('/offer-renewals');
    if (!isE7) return null;
    const org = orgsFor(user)[0];
    const forbid = (p: Permission) =>
      error(
        route,
        403,
        'FORBIDDEN',
        currentUser?.passwordProvisional === true &&
          heldByProvisional(org.roles, p)
          ? PROVISIONAL_HOLD
          : NO_ACCESS[p],
      );
    if (user.role === 'guest' || !org.permissions.includes('directory.read')) {
      return forbid('directory.read');
    }
    const admin = org.permissions.includes('offers.approve');
    const userRef = {id: user.id, displayName: user.displayName};
    void ref;

    // ---- versions
    if (path === `/organizations/${ORG}/offer-versions` && method === 'GET') {
      return json(route, {
        items: state.offerVersions
          .filter(v => !v.supersededAt)
          .map(viewVersion),
      });
    }
    const versionsOf = /^\/offers\/([^/]+)\/versions$/.exec(path);
    if (versionsOf && method === 'GET') {
      if (!state.offers.some(o => o.id === versionsOf[1])) {
        return error(
          route,
          404,
          'NOT_FOUND',
          'No encontramos esa oferta: puede que se haya eliminado.',
        );
      }
      return json(route, {
        items: state.offerVersions
          .filter(v => v.offerId === versionsOf[1])
          .sort((a, b) => (b.number as number) - (a.number as number))
          .map(viewVersion),
      });
    }

    // ---- quote requests
    if (path === `/organizations/${ORG}/quote-requests` && method === 'GET') {
      return json(route, {
        items: [...state.quoteRequests]
          .sort(newestFirst('createdAt'))
          .map(viewRequest),
      });
    }
    const linkDaysOf = (v: unknown) =>
      v === undefined ? QUOTE_LINK_DAYS_DEFAULT : Number(v);
    const companiesOf = (ids: unknown) =>
      Array.isArray(ids)
        ? ids.map(id => state.companies.find(c => c.id === id))
        : [];
    if (path === '/quote-requests' && method === 'POST') {
      const need = (input.need ?? {}) as Json;
      const fields: Record<string, string> = {};
      if (!text(need.title)) {
        fields['need.title'] =
          'Di qué necesitas, por ejemplo «3 carpas de 6 × 6 m».';
      }
      if (!Number.isInteger(need.quantity) || (need.quantity as number) < 1) {
        fields['need.quantity'] = 'Un número entero mayor que cero.';
      }
      if (!Number.isInteger(need.days) || (need.days as number) < 1) {
        fields['need.days'] = 'Un número entero mayor que cero.';
      }
      const companies = companiesOf(input.companyIds);
      if (!companies.length) fields.companyIds = 'Elige al menos una empresa.';
      else if (companies.some(c => !c)) {
        fields.companyIds = 'Alguna empresa ya no existe en esta organización.';
      }
      if (Object.keys(fields).length) return validation(route, fields);
      const request = makeQuoteRequest(
        `qr-new-${++seq}`,
        {
          title: text(need.title),
          categoryId: need.categoryId ?? null,
          quantity: need.quantity,
          unitLabel: text(need.unitLabel),
          days: need.days,
          hoursPerDay: need.hoursPerDay ?? null,
          dateFrom: need.dateFrom ?? null,
          dateTo: need.dateTo ?? null,
          note: text(need.note),
        },
        [],
        {
          eventId: input.eventId ?? null,
          offerId: input.offerId ?? null,
          createdBy: userRef,
          createdAt: clock(),
        },
      );
      const days = linkDaysOf(input.linkDays);
      const links = companies.map(c =>
        issueLink(request, c!, days, url.origin),
      );
      state.quoteRequests.push(request);
      return json(route, {request: viewRequest(request), links}, 201);
    }
    const requestPath =
      /^\/quote-requests\/([^/]+)\/(links|close)(?:\/([^/]+)\/renew)?$/.exec(
        path,
      );
    if (requestPath && method === 'POST') {
      const request = state.quoteRequests.find(r => r.id === requestPath[1]);
      if (!request) {
        return error(
          route,
          404,
          'NOT_FOUND',
          'No encontramos esa solicitud: puede que se haya eliminado.',
        );
      }
      if (requestPath[2] === 'close') {
        if (input.version !== request.version) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message: E7_CONFLICT.request,
              current: viewRequest(request),
            },
            409,
          );
        }
        for (const l of request.links as Json[]) {
          if (l.status === 'waiting') l.status = 'revoked';
        }
        Object.assign(request, {
          status: 'closed',
          closedBy: userRef,
          closedAt: clock(),
          version: (request.version as number) + 1,
        });
        return json(route, viewRequest(request));
      }
      if (request.status === 'closed') {
        return error(
          route,
          400,
          'VALIDATION',
          'Esta solicitud está cerrada: crea otra para pedir más precios.',
        );
      }
      const days = linkDaysOf(input.linkDays);
      if (requestPath[3]) {
        const old = (request.links as Json[]).find(
          l => l.id === requestPath[3],
        );
        if (!old) {
          return error(route, 404, 'NOT_FOUND', 'No encontramos ese enlace.');
        }
        const company =
          state.companies.find(c => c.id === (old.company as Json).id) ??
          (old.company as Json);
        old.status = 'revoked';
        const issued = issueLink(request, company, days, url.origin);
        request.version = (request.version as number) + 1;
        return json(route, {request: viewRequest(request), links: [issued]});
      }
      const companies = companiesOf(input.companyIds);
      if (!companies.length || companies.some(c => !c)) {
        return validation(route, {companyIds: 'Elige al menos una empresa.'});
      }
      const links = companies.map(c =>
        issueLink(request, c!, days, url.origin),
      );
      request.version = (request.version as number) + 1;
      return json(route, {request: viewRequest(request), links});
    }

    // ---- proposals
    if (path === `/organizations/${ORG}/proposals` && method === 'GET') {
      const wanted = url.searchParams.get('state');
      return json(route, {
        items: state.proposals
          .filter(p => !wanted || p.state === wanted)
          .sort(newestFirst('receivedAt'))
          .map(viewProposal),
      });
    }
    if (path === '/proposals' && method === 'POST') {
      const fields: Record<string, string> = {};
      const origin = text(input.origin);
      if (!origin) fields.origin = 'Di cómo llegó: por teléfono, por correo…';
      else if (origin.length > PROPOSAL_ORIGIN_MAX) {
        fields.origin = `Como mucho ${PROPOSAL_ORIGIN_MAX} caracteres.`;
      }
      const made = contentOf((input.proposal ?? {}) as Json, null);
      if ('fields' in made) {
        for (const [k, v] of Object.entries(made.fields)) {
          fields[`proposal.${k}`] = v;
        }
      }
      if (Object.keys(fields).length || 'fields' in made) {
        return validation(route, fields);
      }
      const offer = state.offers.find(o => o.id === input.offerId);
      const request = state.quoteRequests.find(r => r.id === input.requestId);
      const created = storeProposal(made.content, {
        via: 'manual',
        origin,
        createdBy: userRef,
        offer: offer ? {id: offer.id, name: offer.name} : null,
        request: request
          ? {id: request.id, title: (request.need as Json).title}
          : null,
      });
      return json(route, viewProposal(created), 201);
    }
    const proposalPath = /^\/proposals\/([^/]+)(?:\/(approve|reject))?$/.exec(
      path,
    );
    if (proposalPath) {
      const proposal = state.proposals.find(p => p.id === proposalPath[1]);
      if (!proposal) {
        return error(
          route,
          404,
          'NOT_FOUND',
          'No encontramos esa propuesta: puede que se haya eliminado.',
        );
      }
      if (!proposalPath[2] && method === 'GET') {
        return json(route, viewProposal(proposal));
      }
      if (method !== 'POST' || !proposalPath[2]) {
        return error(route, 404, 'NOT_FOUND', 'No encontrado');
      }
      if (!admin) return forbid('offers.approve');
      if (input.version !== proposal.version) {
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: E7_CONFLICT.proposal,
            current: viewProposal(proposal),
          },
          409,
        );
      }
      if (proposal.state !== 'pending') {
        return error(
          route,
          400,
          'VALIDATION',
          proposal.state === 'approved'
            ? 'Esta propuesta ya está aprobada.'
            : 'Esta propuesta ya está rechazada.',
        );
      }
      const linkOf = () => {
        for (const r of state.quoteRequests) {
          const l = (r.links as Json[]).find(x => x.proposalId === proposal.id);
          if (l) return l;
        }
        return null;
      };
      const decide = (
        decided: 'approved' | 'rejected',
        extra: Json = {},
      ): void => {
        Object.assign(proposal, extra, {
          state: decided,
          decidedBy: userRef,
          ...(writingAsSupport ? {decidedBySupport: writingAsSupport} : {}),
          decidedAt: clock(),
          version: (proposal.version as number) + 1,
        });
        const link = linkOf();
        if (link) link.status = decided;
      };
      if (proposalPath[2] === 'reject') {
        const reason = text(input.reason) ?? '';
        if (
          reason.length < PROPOSAL_REASON_MIN ||
          reason.length > PROPOSAL_REASON_MAX
        ) {
          return validation(route, {
            reason: `Escribe el motivo (entre ${PROPOSAL_REASON_MIN} y ${PROPOSAL_REASON_MAX} caracteres).`,
          });
        }
        decide('rejected', {rejectReason: reason});
        return json(route, viewProposal(proposal));
      }
      // approve
      const content = proposal.content as ProposalContent;
      let company = companyNamed(content.company.name);
      if (!company) {
        company = makeCompany(`c-new-${++seq}`, content.company.name, {
          email: content.company.email ?? null,
          phone: content.company.phone ?? null,
          createdBy: userRef,
          updatedBy: userRef,
        });
        state.companies.push(company);
      }
      const companyRef = {id: String(company.id), name: String(company.name)};
      const request = state.quoteRequests.find(
        r => r.id === (proposal.request as Json | null)?.id,
      );
      const now = clock();
      const offers: Json[] = [];
      const versions: Json[] = [];
      const result: Json[] = [];
      for (const product of content.products) {
        const terms = proposalTerms(content, product);
        const renegotiated =
          proposal.offer && content.products.length === 1
            ? state.offers.find(o => o.id === (proposal.offer as Json).id)
            : undefined;
        let offer = renegotiated;
        if (offer) {
          Object.assign(offer, {
            price: product.price,
            vatIncluded: content.pricesIncludeTax,
            version: (offer.version as number) + 1,
            updatedBy: userRef,
            updatedAt: now,
          });
        } else {
          offer = makeOffer(`o-new-${++seq}`, product.name, companyRef, {
            categoryId: (request?.need as Json | undefined)?.categoryId ?? null,
            price: product.price,
            unit: 'day',
            vatIncluded: content.pricesIncludeTax,
            tax: content.tax,
            createdBy: userRef,
            updatedBy: userRef,
            createdAt: now,
            updatedAt: now,
          });
          state.offers.push(offer);
        }
        const previous = state.offerVersions.filter(
          v => v.offerId === offer.id,
        );
        for (const v of previous) v.supersededAt ??= now;
        const number =
          previous.reduce(
            (n, v) => Math.max(n, v.number as number),
            renegotiated ? 1 : 0,
          ) + 1;
        const version = makeOfferVersion(
          `ov-new-${++seq}`,
          String(offer.id),
          number,
          terms,
          {
            proposalId: proposal.id,
            approvedBy: userRef,
            createdBy: userRef,
            createdAt: now,
            changeNote: renegotiated ? 'Renegociada' : 'Propuesta aprobada',
          },
        );
        state.offerVersions.push(version);
        for (const r of state.renewals) {
          if ((r.offer as Json).id !== offer.id || r.resolvedAt) continue;
          Object.assign(r, {
            resolvedAt: now,
            resolvedByVersion: number,
            version: (r.version as number) + 1,
          });
          const task = state.tasks.find(t => t.id === r.taskId);
          if (task) {
            Object.assign(task, {
              status: 'done',
              version: (task.version as number) + 1,
              updatedBy: userRef,
              updatedAt: now,
            });
          }
        }
        offers.push(viewOffer(offer, user.role));
        versions.push(viewVersion(version));
        result.push({
          productKey: product.key,
          offerId: offer.id,
          versionNumber: number,
          created: !renegotiated,
        });
      }
      decide('approved', {result});
      return json(route, {proposal: viewProposal(proposal), offers, versions});
    }

    // ---- settings
    if (path === `/organizations/${ORG}/offer-settings`) {
      if (method === 'GET') return json(route, state.offerSettings);
      if (method !== 'PATCH') {
        return error(route, 404, 'NOT_FOUND', 'No encontrado');
      }
      if (!admin) return forbid('offers.approve');
      const settings = state.offerSettings;
      if (input.version !== settings.version) {
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: E7_CONFLICT.settings,
            current: settings,
          },
          409,
        );
      }
      if (
        input.renewalNoticeDays !== undefined &&
        !(RENEWAL_NOTICE_OPTIONS as readonly unknown[]).includes(
          input.renewalNoticeDays,
        )
      ) {
        return validation(route, {
          renewalNoticeDays: `Elige ${RENEWAL_NOTICE_OPTIONS.join(', ')} días.`,
        });
      }
      const open = settings.openLink as Json;
      let openLinkUrl: string | null = null;
      const issueOpen = () => {
        state.supplierLinks = state.supplierLinks.filter(l => l.requestId);
        const token = e7Token();
        state.supplierLinks.push({token, requestId: null, linkId: null});
        open.createdAt = clock();
        openLinkUrl = `${url.origin}/${openOfferLinkHash(token)}`;
      };
      if (input.renewalNoticeDays !== undefined) {
        settings.renewalNoticeDays = input.renewalNoticeDays;
      }
      if (input.openLinkEnabled === true && !open.enabled) {
        open.enabled = true;
        issueOpen();
      } else if (input.openLinkEnabled === false) {
        open.enabled = false;
      }
      if (input.rotateOpenLink === true && open.enabled) issueOpen();
      Object.assign(settings, {
        version: (settings.version as number) + 1,
        updatedBy: userRef,
        updatedAt: clock(),
      });
      return json(route, {settings, openLinkUrl});
    }

    // ---- renewals
    if (path === `/organizations/${ORG}/offer-renewals` && method === 'GET') {
      return json(route, {
        items: [...state.renewals].sort((a, b) =>
          String(a.acceptUntil).localeCompare(String(b.acceptUntil)),
        ),
      });
    }
    if (
      path === `/organizations/${ORG}/offer-renewals/run` &&
      method === 'POST'
    ) {
      const notice = state.offerSettings.renewalNoticeDays as number;
      let created = 0;
      for (const v of state.offerVersions) {
        const acceptUntil = (v.terms as OfferTerms).acceptUntil;
        if (v.supersededAt || !acceptUntil) continue;
        if (!renewalDue(acceptUntil, notice, e7Today())) continue;
        if (
          state.renewals.some(
            r =>
              (r.offer as Json).id === v.offerId &&
              r.versionNumber === v.number,
          )
        ) {
          continue;
        }
        const offer = state.offers.find(o => o.id === v.offerId);
        if (!offer) continue;
        const task = makeTask(
          `t-renew-${++seq}`,
          `Renegociar «${offer.name}»`,
          {},
          {
            company: offer.company,
            createdBy: userRef,
            updatedBy: userRef,
          },
        );
        state.tasks.push(task);
        state.renewals.push(
          makeRenewal(
            `rn-new-${++seq}`,
            {id: String(offer.id), name: String(offer.name)},
            offer.company as {id: string; name: string},
            {
              taskId: task.id,
              versionNumber: v.number,
              acceptUntil,
              noticeDays: notice,
              assignee: v.approvedBy ?? null,
              generatedAt: clock(),
            },
          ),
        );
        created++;
      }
      return json(route, {created});
    }
    const renewalPath = /^\/offer-renewals\/([^/]+)$/.exec(path);
    if (renewalPath && method === 'PATCH') {
      if (!admin) return forbid('offers.approve');
      const renewal = state.renewals.find(r => r.id === renewalPath[1]);
      if (!renewal) {
        return error(route, 404, 'NOT_FOUND', 'No encontramos esa renovación.');
      }
      if (input.version !== renewal.version) {
        return json(
          route,
          {
            code: 'VERSION_CONFLICT',
            message: E7_CONFLICT.renewal,
            current: renewal,
          },
          409,
        );
      }
      const account = E4_ACCOUNTS.find(a => e4Id(a) === input.assigneeId);
      if (input.assigneeId !== null && !account) {
        return validation(route, {
          assigneeId: 'Esa persona no es de esta organización.',
        });
      }
      Object.assign(renewal, {
        assignee: account
          ? {id: e4Id(account), displayName: account.username}
          : null,
        version: (renewal.version as number) + 1,
      });
      return json(route, renewal);
    }
    return error(route, 404, 'NOT_FOUND', 'No encontrado');
  };

  await page.route(
    u => u.pathname.startsWith('/api/'),
    async incoming => {
      const request = incoming.request();
      // M6: a lost response. The request is handled in full (the server
      // keeps its effect) but the browser only sees a dropped connection.
      const lose = takeFault(
        lost,
        request.method(),
        new URL(request.url()).pathname.replace(/^\/api/, ''),
      );
      const route: Route = lose
        ? ({
            request: () => incoming.request(),
            fulfill: () => incoming.abort('connectionreset'),
            abort: (code?: string) => incoming.abort(code),
          } as unknown as Route)
        : incoming;
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api/, '');
      const method = request.method();
      const authorization = request.headers()['authorization'] ?? null;
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      state.requests.push({
        method,
        path,
        query: url.search,
        body,
        authorization,
      });

      // M6: the server is not there at all (the network may be).
      if (state.unreachable) return route.abort('connectionrefused');

      // ---- public routes
      if (path === '/health') {
        if (state.health === 'down') return route.abort('connectionrefused');
        return json(route, {
          status: state.health === 'ok' ? 'ok' : 'degraded',
          database: state.health === 'ok' ? 'ok' : 'error',
          version: 'test',
        });
      }
      // Revisión 1 · E7: the public supplier routes (no session).
      const e7Public = await publicOffersRoute(route, path, method, body);
      if (e7Public !== null) return e7Public;
      // E4: always 202 with no body, whether the account exists or not.
      if (path === '/auth/recovery' && method === 'POST') {
        return route.fulfill({status: 202, body: ''});
      }
      // E4: account links (public). Only RESET_TOKEN / VERIFY_TOKEN work.
      if (path === '/auth/reset' && method === 'POST') {
        const input = (body ?? {}) as Json;
        if (input.token !== RESET_TOKEN) {
          return json(
            route,
            {
              code: 'VALIDATION',
              message: 'Revisa los datos marcados.',
              fields: {token: LINK_GONE},
            },
            400,
          );
        }
        const problem = passwordProblem(
          String(input.newPassword ?? ''),
          'Yeray',
        );
        if (problem) {
          return json(
            route,
            {
              code: 'VALIDATION',
              message: 'Revisa los datos marcados.',
              fields: {newPassword: problem},
            },
            400,
          );
        }
        const yeray = e4Account('Yeray')!;
        yeray.password = String(input.newPassword);
        yeray.provisional = false;
        return route.fulfill({status: 204, body: ''});
      }
      if (path === '/auth/verify-email' && method === 'POST') {
        const input = (body ?? {}) as Json;
        if (input.token !== VERIFY_TOKEN) {
          return json(
            route,
            {
              code: 'VALIDATION',
              message: 'Revisa los datos marcados.',
              fields: {token: LINK_GONE},
            },
            400,
          );
        }
        return route.fulfill({status: 204, body: ''});
      }
      // E4: GET /auth/users is gone (404, below); login by username.
      if (path === '/auth/login' && method === 'POST') {
        const {username, displayName, password} = (body ?? {}) as Json;
        const account = e4Account(String(username ?? displayName ?? ''));
        if (!account || password !== account.password) {
          // Same body as server/src/auth/service.ts (BAD_CREDENTIALS).
          return error(
            route,
            401,
            'UNAUTHENTICATED',
            'Usuario o contraseña incorrectos.',
          );
        }
        currentUser = e4User(account);
        account.lastLoginAt = new Date().toISOString();
        logSecurity(account, 'login');
        state.sessionExpired = false;
        return json(route, {
          token: TOKEN,
          // Far ahead: specs that fix the browser clock must still restore
          // the stored session after a reload.
          expiresAt: '2099-01-01T00:00:00.000Z',
          user: currentUser,
          organizations: orgs(),
        });
      }

      // ---- authenticated routes
      if (state.writesOffline && method !== 'GET') {
        return route.abort('internetdisconnected');
      }
      // E4: a support or «Ver como Invitado» session has its own token.
      if (support && Date.parse(support.endsAt) <= Date.now()) support = null;
      const viaSupport =
        !!support && authorization === `Bearer ${support.token}`;
      writingAsSupport =
        viaSupport && support?.kind === 'support' ? support.by : null;
      if (
        !viaSupport &&
        (authorization !== `Bearer ${TOKEN}` || state.sessionExpired)
      ) {
        // Same message as server/src/auth/middleware.ts.
        return error(
          route,
          401,
          'UNAUTHENTICATED',
          'Tu sesión ha caducado o se ha cerrado. Vuelve a iniciar sesión.',
        );
      }
      // A session restored from the device (no login in this page) is Elvis.
      const own = e4Account(String(currentUser?.username ?? 'Elvis'))!;
      const user =
        viaSupport && support
          ? e4User(e4Account(support.username)!, supportInfo(support))
          : e4User(own);
      const isWrite = method !== 'GET';
      if (isWrite && user.role === 'guest' && path !== '/auth/logout') {
        return error(route, 403, 'FORBIDDEN', 'Solo lectura.');
      }

      if (path === '/auth/logout' && method === 'POST') {
        if (viaSupport) {
          logSecurity(
            e4Account(support!.username)!,
            'support_ended',
            support!.by,
          );
          support = null;
        }
        return route.fulfill({status: 204, body: ''});
      }
      if (path === '/me') {
        return json(route, {user, organizations: orgsFor(user)});
      }

      // ---- Revisión 1 · E4 (roles and access), mirrors server/src/{account,admin}
      const e4 = handleE4(route, method, path, body, user, viaSupport);
      if (e4) return e4;

      // ---- Revisión 1 · E2 (Organización): the acronym
      // Mirrors server/src/organizations/service.ts: `version` must match
      // (409 VERSION_CONFLICT with `current`), the acronym is checked with
      // the shared `acronymProblem`, and an unchanged value is a no-op.
      if (path === `/organizations/${ORG}` && method === 'PATCH') {
        const input = (body ?? {}) as Json;
        const current = state.organization;
        if (input.version !== current.version) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message:
                'Otra persona ha cambiado los datos de la organización mientras los editabas. Revisa la versión actual antes de guardar.',
              current: {...current},
            },
            409,
          );
        }
        const next =
          typeof input.acronym === 'string' ? input.acronym.trim() : null;
        if (next !== null) {
          const problem = acronymProblem(next);
          if (problem) {
            return json(
              route,
              {
                code: 'VALIDATION',
                message: 'Revisa los datos marcados.',
                fields: {acronym: problem},
              },
              400,
            );
          }
        }
        if (input.acronym === undefined || next === current.acronym) {
          return json(route, {...current});
        }
        current.acronym = next;
        current.version = (current.version as number) + 1;
        return json(route, {...current});
      }

      // ---- milestone 6: forced faults, device ids, `…/changes`
      if (isWrite) {
        const reject = takeFault(rejected, method, path);
        if (reject) return validation(route, reject.fields);
      }
      const patchId = /^\/[a-z-]+\/([^/]+)$/.exec(path)?.[1];
      if (method === 'PATCH' && patchId && (conflicts.get(patchId) ?? 0) > 0) {
        conflicts.set(patchId, conflicts.get(patchId)! - 1);
        const list = (
          [
            'events',
            'tasks',
            'companies',
            'contacts',
            'offers',
            'warehouses',
            'resources',
            'notes',
          ] as const
        ).find(l => path.startsWith(`/${l}/`));
        const record = list
          ? (state[list] as Json[]).find(r => r.id === patchId)
          : undefined;
        if (record && list) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message:
                'Otra persona ha cambiado este registro mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.',
              current: viewOf(list, record, user.role),
            },
            409,
          );
        }
      }
      // Same rules as server/src/records/device-id.ts: a free UUID creates
      // the record with it; the same user's id again is a replay (200 with
      // the record as it is, nothing written, no activity); anyone else's
      // use of it is 400 `fields.id` without revealing whose.
      const createList =
        method === 'POST'
          ? DEVICE_ID_CREATES[path as keyof typeof DEVICE_ID_CREATES]
          : undefined;
      const deviceId = (body as Json | null)?.id;
      if (createList && deviceId !== undefined) {
        if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) {
          return validation(route, {id: 'Identificador no válido.'});
        }
        const existing = (state[createList] as Json[]).find(
          r => String(r.id).toLowerCase() === deviceId.toLowerCase(),
        );
        if (existing) {
          if (
            (existing.createdBy as Json | null)?.id !== user.id ||
            (existing.organizationId ?? ORG) !== ORG
          ) {
            return validation(route, {
              id: 'Este identificador ya está en uso.',
            });
          }
          return json(route, viewOf(createList, existing, user.role), 200);
        }
      }
      if (path === `/organizations/${ORG}/changes` && method === 'GET') {
        if (!state.changesSupported) {
          return error(route, 404, 'NOT_FOUND', 'No encontrado');
        }
        // Same answer shape as server/src/activity/service.ts. The mock
        // compares list fingerprints instead of reading an activity log, so
        // a spec that edits `state` directly (another person's save) is
        // reported too. No overlap window: nothing commits out of order here.
        const now = fingerprints();
        const since = url.searchParams.get('since');
        const known =
          since !== null && /^(0|[1-9]\d*)$/.test(since)
            ? snapshots[Number(since)]
            : undefined;
        snapshots.push(now);
        const cursor = String(snapshots.length - 1);
        if (!known) return json(route, {cursor, types: [], full: true});
        const types = (
          Object.keys(CHANGE_TYPES) as (keyof typeof CHANGE_TYPES)[]
        )
          .filter(l => known[l] !== now[l])
          .map(l => CHANGE_TYPES[l]);
        return json(route, {cursor, types, full: false});
      }
      if (path === `/organizations/${ORG}/events` && method === 'GET') {
        return json(route, {
          items: state.events.map(e => viewEvent(e, user.role)),
        });
      }
      if (path === `/organizations/${ORG}/venues`) {
        // E2: in contract shape (acronym, opening hours, version).
        return json(route, {
          items: state.venues.map(v => venueView(v as Json)),
        });
      }
      if (path === `/organizations/${ORG}/activity`) {
        // Same contract as server/src/activity/routes.ts: the organization's
        // recent activity, or one record's history (both parameters or
        // neither), newest first.
        const entityType = url.searchParams.get('entityType') || null;
        const entityId = url.searchParams.get('entityId') || null;
        if (!entityType !== !entityId) {
          return validation(route, {
            [entityType ? 'entityId' : 'entityType']:
              'Para ver el historial de un registro indica su tipo y su identificador.',
          });
        }
        // M6: a time range (the day close), as server/src/activity/routes.ts.
        const fromRaw = url.searchParams.get('from') || null;
        const toRaw = url.searchParams.get('to') || null;
        if (fromRaw || toRaw) {
          const INSTANT =
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
          const bad =
            'Instante no válido: usa ISO 8601 con zona horaria (2026-12-02T00:00:00.000Z).';
          const both =
            'Para ver un periodo indica su inicio y su final (instantes ISO 8601).';
          if (fromRaw && !INSTANT.test(fromRaw)) {
            return validation(route, {from: bad});
          }
          if (toRaw && !INSTANT.test(toRaw)) {
            return validation(route, {to: bad});
          }
          if (!fromRaw) return validation(route, {from: both});
          if (!toRaw) return validation(route, {to: both});
          if (entityType) {
            return validation(route, {
              from: 'Un periodo no se puede combinar con el historial de un registro: pide uno u otro.',
            });
          }
          const from = Date.parse(fromRaw);
          const to = Date.parse(toRaw);
          if (from >= to) {
            return validation(route, {
              to: 'El final del periodo debe ser posterior a su inicio.',
            });
          }
          if (to - from > ACTIVITY_RANGE_MAX_DAYS * 24 * 3600_000) {
            return validation(route, {
              to: `El periodo puede abarcar como máximo ${ACTIVITY_RANGE_MAX_DAYS} días.`,
            });
          }
          if (state.failActivityRange > 0) {
            state.failActivityRange--;
            return error(
              route,
              500,
              'INTERNAL',
              'Error interno del servidor. Inténtalo de nuevo.',
            );
          }
          const max = Number(
            url.searchParams.get('limit') || ACTIVITY_RANGE_MAX,
          );
          const items = state.activity
            .map((a, i) => ({a, i}))
            .filter(({a}) => {
              const t = Date.parse(a.at as string);
              return t >= from && t < to;
            })
            .sort(
              (x, y) =>
                Date.parse(y.a.at as string) - Date.parse(x.a.at as string) ||
                y.i - x.i,
            )
            .map(({a}) => a)
            .slice(0, Math.min(max, ACTIVITY_RANGE_MAX));
          return json(route, {items});
        }
        const limit = Number(url.searchParams.get('limit') || 20);
        if (entityType) {
          if (state.failHistory > 0) {
            state.failHistory--;
            return error(
              route,
              500,
              'INTERNAL',
              'Error interno del servidor. Inténtalo de nuevo.',
            );
          }
          if (historyGate) await historyGate;
        }
        // Newest first; entries with the same time, last logged first.
        const items = state.activity
          .map((a, i) => ({a, i}))
          .filter(
            ({a}) =>
              !entityType ||
              (a.entityType === entityType && a.entityId === entityId),
          )
          .sort(
            (x, y) =>
              Date.parse(y.a.at as string) - Date.parse(x.a.at as string) ||
              y.i - x.i,
          )
          .map(({a}) => a)
          .slice(0, limit);
        return json(route, {items});
      }
      if (path === `/organizations/${ORG}/demo` && method === 'DELETE') {
        // Same contract as server/src/demo/service.ts: demo tasks, offers,
        // contacts and events go; demo companies (and venues) go only when no
        // real record uses them; real records that lose a link to a demo
        // record get a new version and author.
        const by = {id: user.id, displayName: user.displayName};
        const ids = (list: Json[]) =>
          new Set(list.filter(r => r.isDemo).map(r => r.id as string));
        const demoEvents = ids(state.events);
        const demoTasks = ids(state.tasks);
        const demoContacts = ids(state.contacts);
        for (const t of state.tasks) {
          if (t.isDemo) continue;
          const deps = t.dependsOn as string[];
          const lostEvent = demoEvents.has(t.eventId as string);
          const lostContact = demoContacts.has(
            (t.contact as Json | null)?.id as string,
          );
          const lostDependency = deps.some(d => demoTasks.has(d));
          if (!lostEvent && !lostContact && !lostDependency) continue;
          if (lostEvent) t.eventId = null;
          if (lostContact) t.contact = null;
          t.dependsOn = deps.filter(d => !demoTasks.has(d));
          bump(t, by);
        }
        for (const c of state.contacts) {
          const events = c.eventIds as string[];
          if (c.isDemo || !events.some(e => demoEvents.has(e))) continue;
          c.eventIds = events.filter(e => !demoEvents.has(e));
          bump(c, by);
        }
        for (const c of state.companies) {
          const main = c.mainContactId as string;
          if (c.isDemo || !demoContacts.has(main)) continue;
          c.mainContactId = null;
          bump(c, by);
        }
        // Milestone 4: real tasks lose demo resources; real notes lose links
        // to demo records (and a demo event).
        const demoResources = ids(state.resources);
        for (const t of state.tasks) {
          const res = (t.resourceIds as string[]) ?? [];
          if (t.isDemo || !res.some(r => demoResources.has(r))) continue;
          t.resourceIds = res.filter(r => !demoResources.has(r));
          bump(t, by);
        }
        for (const n of state.notes) {
          if (n.isDemo) continue;
          const r = n.ref as {type: string; id: string} | null;
          const target = r ? refRecord(r.type, r.id) : undefined;
          // Venues, companies and warehouses that real notes use are kept.
          const lostRef =
            !!target?.isDemo &&
            !['warehouse', 'venue', 'company'].includes(r!.type);
          const lostEvent = demoEvents.has(
            (n.event as Json | null)?.id as string,
          );
          if (!lostRef && !lostEvent) continue;
          if (lostRef) n.ref = null;
          if (lostEvent) n.event = null;
          bump(n, by);
        }
        const before =
          state.tasks.length +
          state.offers.length +
          state.contacts.length +
          state.events.length +
          state.companies.length +
          state.notes.length +
          state.resources.length +
          state.warehouses.length;
        // M5: every hypothesis about a demo task goes, applied ones included.
        state.hypotheses = state.hypotheses.filter(
          h => !demoTasks.has(h.taskId as string),
        );
        state.notes = state.notes.filter(n => !n.isDemo);
        state.resources = state.resources.filter(r => !r.isDemo);
        state.warehouses = state.warehouses.filter(
          w =>
            !w.isDemo ||
            state.resources.some(
              r => (r.warehouse as Json | null)?.id === w.id,
            ) ||
            state.notes.some(
              n =>
                (n.ref as Json | null)?.type === 'warehouse' &&
                (n.ref as Json).id === w.id,
            ),
        );
        state.tasks = state.tasks.filter(t => !t.isDemo);
        state.offers = state.offers.filter(o => !o.isDemo);
        state.contacts = state.contacts.filter(c => !c.isDemo);
        state.events = state.events.filter(e => !e.isDemo);
        const usedCompany = (id: unknown) =>
          [
            ...state.tasks,
            ...state.contacts,
            ...state.offers,
            ...state.resources,
          ].some(r => (r.company as Json | null)?.id === id) ||
          state.notes.some(
            n =>
              (n.ref as Json | null)?.type === 'company' &&
              (n.ref as Json).id === id,
          );
        state.companies = state.companies.filter(
          c => !c.isDemo || usedCompany(c.id),
        );
        const after =
          state.tasks.length +
          state.offers.length +
          state.contacts.length +
          state.events.length +
          state.companies.length +
          state.notes.length +
          state.resources.length +
          state.warehouses.length;
        return json(route, {removed: before - after});
      }
      if (path === '/events' && method === 'POST') {
        const input = (body ?? {}) as Json;
        if (typeof input.name !== 'string' || !input.name.trim()) {
          return json(
            route,
            {
              code: 'VALIDATION',
              message: 'Revisa los datos marcados.',
              fields: {name: 'El nombre es obligatorio.'},
            },
            400,
          );
        }
        const ref = {id: user.id, displayName: user.displayName};
        const created = makeEvent(
          newId(input, `new-${++seq}`),
          input.name.trim(),
          {
            date: (input.date as string | null) ?? null,
            start: (input.startTime as string | null) ?? null,
            end: (input.endTime as string | null) ?? null,
          },
          {
            venue: input.venueName
              ? {id: `v-new-${seq}`, name: input.venueName}
              : null,
            status: input.status ?? 'planned',
            notes: input.notes ?? null,
            source: input.source ?? null,
            verification: input.verification ?? 'draft',
            createdBy: ref,
            updatedBy: ref,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        );
        state.events.push(created);
        return json(route, created, 201);
      }
      const patchMatch = /^\/events\/([^/]+)$/.exec(path);
      if (patchMatch && method === 'PATCH') {
        const event = state.events.find(e => e.id === patchMatch[1]);
        if (!event) return error(route, 404, 'NOT_FOUND', 'No encontrado');
        const input = (body ?? {}) as Json;
        if (input.version !== event.version) {
          return json(
            route,
            {
              code: 'VERSION_CONFLICT',
              message: 'Otra persona ha cambiado este evento.',
              current: viewEvent(event, user.role),
            },
            409,
          );
        }
        const {
          version: _v,
          venueName,
          date,
          endDate,
          startTime,
          endTime,
          ...changes
        } = input;
        void _v;
        if (venueName !== undefined) {
          event.venue = venueName ? {id: 'v-edit', name: venueName} : null;
        }
        if (date !== undefined) {
          Object.assign(
            event,
            {date: date ?? null, endDate: date ? (endDate ?? null) : null},
            slotToInstants(
              date as string | null,
              startTime as string | null,
              endTime as string | null,
              TZ,
              date ? ((endDate as string | null) ?? null) : null,
            ),
          );
        }
        Object.assign(event, changes, {
          version: (event.version as number) + 1,
          updatedBy: {id: user.id, displayName: user.displayName},
          updatedAt: new Date().toISOString(),
        });
        return json(route, viewEvent(event, user.role));
      }

      // ---- milestone 2: tasks and companies
      if (path === `/organizations/${ORG}/tasks` && method === 'GET') {
        const eventId = url.searchParams.get('eventId');
        return json(route, {
          items: (eventId
            ? state.tasks.filter(t => t.eventId === eventId)
            : state.tasks
          ).map(t => viewTask(t, user.role)),
        });
      }
      if (path === `/organizations/${ORG}/companies` && method === 'GET') {
        return json(route, {
          items: byName(state.companies).map(c => viewCompany(c, user.role)),
        });
      }
      const ref = {id: user.id, displayName: user.displayName};
      const m3 = await directoryRoute(route, {
        path,
        method,
        body,
        url,
        user,
        ref,
      });
      if (m3 !== null) return m3;
      const m4 = await inventoryRoute(route, {
        path,
        method,
        body,
        url,
        user,
        ref,
      });
      if (m4 !== null) return m4;
      const m5 = await hypothesisRoute(route, {path, method, body, user, ref});
      if (m5 !== null) return m5;
      const e2 = await movesRoute(route, {path, method, body, user, ref});
      if (e2 !== null) return e2;
      const e5 = await budgetRoute(route, {
        path,
        method,
        body,
        url,
        user,
        ref,
      });
      if (e5 !== null) return e5;
      const e7 = await offersRoute(route, {path, method, body, url, user, ref});
      if (e7 !== null) return e7;
      /** Same check as server/src/resources/links.ts (`areOwnResources`). */
      const resourceIdsProblem = (ids: unknown): string | null => {
        if (ids === undefined) return null;
        if (!Array.isArray(ids)) return 'Lista de recursos no válida.';
        if (ids.length > MAX_RESOURCES_PER_TASK) {
          return `Como mucho ${MAX_RESOURCES_PER_TASK} recursos por tarea.`;
        }
        return ids.every(id => state.resources.some(r => r.id === id))
          ? null
          : 'Alguno de los recursos ya no existe o no es de esta organización.';
      };
      /** `subsoilReviewed` only with a resulting heavy load (strict both ways). */
      const subsoilProblem = (
        input: Json,
        heavyAfter: boolean | null,
      ): string | null => {
        if (input.subsoilReviewed === undefined) return null;
        if (typeof input.subsoilReviewed !== 'boolean') {
          return 'Indica sí o no: ¿se revisó el subsuelo en el simulador?';
        }
        return heavyAfter === true
          ? null
          : 'Solo se puede declarar en una tarea con carga pesada.';
      };
      /** Venue, heavy load and material: what a subsoil review was for. */
      const placementOf = (t: Json) =>
        JSON.stringify([
          (t.venue as Json | null)?.id ?? null,
          t.heavyLoad ?? null,
          [...((t.resourceIds as string[]) ?? [])].sort(),
        ]);
      if (path === '/tasks' && method === 'POST') {
        const input = (body ?? {}) as Json;
        const slot = {
          date: (input.date as string | null) ?? null,
          endDate: (input.endDate as string | null) ?? null,
          startTime: (input.startTime as string | null) ?? null,
          endTime: (input.endTime as string | null) ?? null,
        };
        const fields = slotProblems(slot);
        if (!text(input.title)) fields.title = 'El título es obligatorio.';
        const dependsOn = (input.dependsOn as string[] | undefined) ?? [];
        const depProblem = dependencyProblem(null, dependsOn);
        if (depProblem) fields.dependsOn = depProblem;
        const resProblem = resourceIdsProblem(input.resourceIds);
        if (resProblem) fields.resourceIds = resProblem;
        const subsoil = subsoilProblem(
          input,
          (input.heavyLoad ?? null) as never,
        );
        if (subsoil) fields.subsoilReviewed = subsoil;
        if (Object.keys(fields).length) return validation(route, fields);
        const now = new Date().toISOString();
        const created = makeTask(
          newId(input, `t-new-${++seq}`),
          text(input.title)!,
          {
            date: slot.date,
            endDate: slot.endDate,
            start: slot.startTime,
            end: slot.endTime,
          },
          {
            eventId: (input.eventId as string | null) ?? null,
            venue: venueRef(input.venueName),
            company: companyRef(input),
            contact: contactRef(input.contactId),
            kind: input.kind ?? 'other',
            status: input.status ?? 'planned',
            dependsOn,
            heavyLoad: input.heavyLoad ?? null,
            resourceIds: [...new Set((input.resourceIds as string[]) ?? [])],
            subsoilReview:
              input.subsoilReviewed === true ? {by: ref, at: clock()} : null,
            notes: text(input.notes),
            source: input.source ?? null,
            verification: input.verification ?? 'draft',
            createdBy: ref,
            updatedBy: ref,
            createdAt: now,
            updatedAt: now,
          },
        );
        state.tasks.push(created);
        return json(route, viewTask(created, user.role), 201);
      }
      const taskMatch = /^\/tasks\/([^/]+)$/.exec(path);
      const task = taskMatch
        ? state.tasks.find(t => t.id === taskMatch[1])
        : undefined;
      if (taskMatch && !task && (method === 'PATCH' || method === 'DELETE')) {
        return error(route, 404, 'NOT_FOUND', 'No encontrado');
      }
      if (task && method === 'PATCH') {
        const input = (body ?? {}) as Json;
        if (typeof input.version !== 'number') {
          return validation(route, {version: VERSION_MISSING});
        }
        if (input.version !== task.version) return taskConflict(route, task);
        const fields: Record<string, string> = {};
        if ('title' in input && !text(input.title)) {
          fields.title = 'El título es obligatorio.';
        }
        const slotKeys = ['date', 'endDate', 'startTime', 'endTime'];
        const touchesSlot = slotKeys.some(k => k in input);
        const slot = {...storedSlot(task)};
        for (const k of slotKeys) {
          if (k in input) {
            (slot as Record<string, string | null>)[k] =
              (input[k] as string | null) ?? null;
          }
        }
        if (touchesSlot) Object.assign(fields, slotProblems(slot));
        if (Array.isArray(input.dependsOn)) {
          const problem = dependencyProblem(
            task.id as string,
            input.dependsOn as string[],
          );
          if (problem) fields.dependsOn = problem;
        }
        const resProblem = resourceIdsProblem(input.resourceIds);
        if (resProblem) fields.resourceIds = resProblem;
        const heavyAfter = (
          'heavyLoad' in input ? input.heavyLoad : task.heavyLoad
        ) as boolean | null;
        const subsoil = subsoilProblem(input, heavyAfter);
        if (subsoil) fields.subsoilReviewed = subsoil;
        if (Object.keys(fields).length) return validation(route, fields);
        const placementBefore = placementOf(task);

        if (Array.isArray(input.resourceIds)) {
          task.resourceIds = [...new Set(input.resourceIds as string[])];
        }
        for (const k of [
          'title',
          'kind',
          'status',
          'eventId',
          'heavyLoad',
          'source',
          'verification',
          'dependsOn',
        ]) {
          if (k in input) task[k] = k === 'title' ? text(input[k]) : input[k];
        }
        if ('notes' in input) task.notes = text(input.notes);
        if ('venueName' in input) task.venue = venueRef(input.venueName);
        if ('companyName' in input || 'companyId' in input) {
          task.company = companyRef(input, task.company);
        }
        if ('contactId' in input) task.contact = contactRef(input.contactId);
        // Same rule as nextSubsoilReview (server/src/tasks/domain.ts).
        const placementChanged = placementOf(task) !== placementBefore;
        if (input.subsoilReviewed === false) {
          task.subsoilReview = null;
        } else if (input.subsoilReviewed === true) {
          if (!task.subsoilReview || placementChanged) {
            task.subsoilReview = {by: ref, at: clock()};
          }
        } else if (placementChanged) {
          task.subsoilReview = null;
        }
        if (touchesSlot) {
          Object.assign(
            task,
            {date: slot.date, endDate: slot.endDate},
            slotToInstants(
              slot.date,
              slot.startTime,
              slot.endTime,
              TZ,
              slot.endDate,
            ),
          );
        }
        Object.assign(task, {
          version: (task.version as number) + 1,
          updatedBy: ref,
          updatedAt: new Date().toISOString(),
        });
        return json(route, viewTask(task, user.role));
      }
      if (task && method === 'DELETE') {
        const raw = url.searchParams.get('version');
        if (raw === null || raw.trim() === '') {
          return validation(route, {version: VERSION_MISSING});
        }
        if (Number(raw) !== task.version) return taskConflict(route, task);
        state.tasks = state.tasks.filter(t => t !== task);
        unlinkNotes('task', task.id as string, ref);
        // M5: open hypotheses go with it; applied ones keep their label.
        state.hypotheses = state.hypotheses.filter(
          h => h.taskId !== task.id || h.appliedAt,
        );
        for (const h of state.hypotheses) {
          if (h.taskId === task.id) h.taskId = null;
        }
        for (const t of state.tasks) {
          const deps = t.dependsOn as string[];
          if (!deps.includes(task.id as string)) continue;
          Object.assign(t, {
            dependsOn: deps.filter(d => d !== task.id),
            version: (t.version as number) + 1,
            updatedBy: ref,
            updatedAt: new Date().toISOString(),
          });
        }
        return route.fulfill({status: 204, body: ''});
      }
      return error(route, 404, 'NOT_FOUND', 'No encontrado');
    },
  );

  return state;
}

/**
 * E4: types the username and password into the login screen already on
 * screen and waits for the workspace. Any account of `E4_ACCOUNTS`.
 */
export async function loginAs(page: Page, name = 'Elvis') {
  await page.locator('#lx-login-username').fill(name);
  await page.locator('#lx-login-password').fill(PASSWORD);
  await page.locator('#lx-login-submit').click();
  await expect(page.locator('#lx-title')).toBeVisible();
}

/** Opens the module by deep link and signs in through the real login UI. */
export async function signIn(page: Page, name = 'Elvis', hash = '#logistica') {
  await page.goto(`/${hash}`);
  await loginAs(page, name);
}

/** From the login screen (e.g. after a session expired), signs in again. */
export async function signInAgain(page: Page, name = 'Elvis') {
  await loginAs(page, name);
}

export const RESCUE_KEY = 'oxeye.logistics.rescue.v1';

export const storedRescue = (page: Page) =>
  page.evaluate(key => sessionStorage.getItem(key), RESCUE_KEY);

export const storedSession = (page: Page) =>
  page.evaluate(key => localStorage.getItem(key), SESSION_KEY);
