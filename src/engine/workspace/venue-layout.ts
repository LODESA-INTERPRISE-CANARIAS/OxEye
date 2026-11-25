/**
 * Venue (Recinto) / Layout (Distribución) composition (OX-04).
 *
 * Pure functions only: no React, DOM, store or persistence. The editor works
 * on one composed `Scene`; `composeScene` builds it from the event-level scene,
 * a venue and a layout, and `splitScene` writes the editable part back.
 *
 * Membership of an element is decided by id: elements stored in the venue stay
 * in the venue and elements stored in the layout stay in the layout. New
 * elements are classified by kind and edit mode (plan D1, D3, D7).
 */
import type {
  BoothItem,
  EntranceItem,
  GeometryTrace,
  InfrastructureItem,
  PhaseKey,
  Scene,
} from '../../types';
import type {
  AccessOverride,
  EditMode,
  Layout,
  LayoutContent,
  LayoutSafety,
  LayoutState,
  Venue,
  VenueContent,
} from '../../types/venue';
import {ACCESS_OVERRIDE_FIELDS} from '../../types/venue';
import {OUTSIDE_PERIMETER_ISSUE_PREFIX, type RiskIssue} from '../emergency/risk';
import {contentHash} from './ids';

/** Composition mode: an edit mode (other part locked) or `plain` (export, no locks). */
export type ComposeMode = EditMode | 'plain';

export const ALL_PHASES: PhaseKey[] = ['pre', 'event', 'post'];

/** Same limit as `validateScene` (presets) and the catalogue paste check. */
export const COMPOSED_LIST_LIMIT = 500;

/** Trace origins that always belong to the venue perimeter. */
const PERIMETER_ORIGINS = new Set(['boundary-add', 'boundary-subtract']);
/** Restricted zone: venue or layout depending on the edit mode (user answer §12.2). */
const RESTRICTED_ORIGIN = 'subperimeter';
/**
 * Trace origins written by the editor for layout content, including the
 * exclusion-zone tool (`MapShell` «Zona excluida»). Other free-text origins
 * are provenance notes of preset reference traces (venue).
 */
const LAYOUT_ORIGINS = new Set(['interest-zone', 'turning', 'loading', 'Dibujada por el equipo']);

const LAYOUT_TRACE_LISTS = [
  'fences',
  'flows',
  'corridors',
  'roadPlans',
  'measurements',
] as const;

const clone = <T>(v: T): T => structuredClone(v);

const withLock = <T extends {locked?: boolean}>(item: T, lock: boolean): T =>
  lock ? {...item, locked: true} : item;

function idSet(list: Array<{id?: string}> | undefined): Set<string> {
  return new Set((list || []).map((x) => x.id).filter((x): x is string => !!x));
}

/** Gives every trace a stable id derived from its list, position and content. */
export function ensureTraceIds(list: GeometryTrace[], prefix: string): GeometryTrace[] {
  return list.map((t, i) =>
    t.id ? t : {...t, id: `${prefix}-${i}-${contentHash(JSON.stringify(t)).slice(0, 12)}`}
  );
}

export function emptyLayoutContent(): LayoutContent {
  return {
    passages: [],
    reserves: [],
    entrances: [],
    booths: [],
    infrastructure: [],
    fences: [],
    flows: [],
    corridors: [],
    roadPlans: [],
    measurements: [],
    annotations: [],
    groups: [],
    pendingStock: [],
  };
}

/** Applies a layout's operational override to a venue access (plan D2). */
export function applyAccessOverride(e: EntranceItem, o: AccessOverride | undefined): EntranceItem {
  if (!o) return e;
  const next = {...e};
  for (const f of ACCESS_OVERRIDE_FIELDS) {
    if (o[f] !== undefined) (next as Record<string, unknown>)[f] = clone(o[f]);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Migration split of a legacy scene (plan D15)                        */
/* ------------------------------------------------------------------ */

/**
 * Legacy classification of a trace: perimeter traces, restricted zones and
 * reference traces from presets (free-text provenance `origin`) are venue;
 * editor layout origins and traces without origin are layout.
 */
function legacyTraceIsVenue(t: GeometryTrace): boolean {
  const o = t.origin;
  if (!o) return false;
  if (PERIMETER_ORIGINS.has(o) || o === RESTRICTED_ORIGIN) return true;
  return !LAYOUT_ORIGINS.has(o);
}

/** Splits a legacy (pre-OX-04) scene into venue and layout content. */
export function splitLegacyScene(scene: Scene): {
  venue: VenueContent;
  layout: LayoutContent;
  safety: LayoutSafety;
} {
  const passages = ensureTraceIds(clone(scene.passages || []), 'passage');
  const reserves = ensureTraceIds(clone(scene.reserves || []), 'reserve');
  const booths = clone(scene.base?.booths || []);
  const infrastructure = clone(scene.infrastructure || []);
  const venue: VenueContent = {
    boundary: clone(scene.boundary || []),
    passages: passages.filter(legacyTraceIsVenue),
    reserves: reserves.filter(legacyTraceIsVenue),
    entrances: clone(scene.entrances || []),
    booths: booths.filter((b) => b.permanent),
    infrastructure: infrastructure.filter((o) => o.permanent),
    ...(scene.subsoil ? {subsoil: clone(scene.subsoil)} : {}),
  };
  const layout: LayoutContent = {
    ...layoutOnlyFrom(scene),
    passages: passages.filter((t) => !legacyTraceIsVenue(t)),
    reserves: reserves.filter((t) => !legacyTraceIsVenue(t)),
    entrances: [],
    booths: booths.filter((b) => !b.permanent),
    infrastructure: infrastructure.filter((o) => !o.permanent),
  };
  return {venue, layout, safety: safetyFrom(scene)};
}

function layoutOnlyFrom(scene: Scene): Omit<
  LayoutContent,
  'passages' | 'reserves' | 'entrances' | 'booths' | 'infrastructure'
> {
  const out: ReturnType<typeof layoutOnlyFrom> = {
    fences: ensureTraceIds(clone(scene.fences || []), 'fence'),
    roadPlans: ensureTraceIds(clone(scene.roadPlans || []), 'road'),
    measurements: ensureTraceIds(clone(scene.measurements || []), 'measure'),
    annotations: clone(scene.annotations || []),
  };
  if (scene.flows) out.flows = ensureTraceIds(clone(scene.flows), 'flow');
  if (scene.corridors) out.corridors = ensureTraceIds(clone(scene.corridors), 'corridor');
  if (scene.groups) out.groups = clone(scene.groups);
  if (scene.pendingStock) out.pendingStock = clone(scene.pendingStock);
  if (scene.serviceRoute) out.serviceRoute = clone(scene.serviceRoute);
  if (scene.vehicleRoute) out.vehicleRoute = clone(scene.vehicleRoute);
  if (scene.vehicleReference) out.vehicleReference = clone(scene.vehicleReference);
  return out;
}

function safetyFrom(scene: Scene): LayoutSafety {
  const s: LayoutSafety = {};
  if (scene.safetyReview !== undefined) s.safetyReview = clone(scene.safetyReview);
  if (scene.safetyLock) s.safetyLock = clone(scene.safetyLock);
  if (scene.safetyHistory) s.safetyHistory = clone(scene.safetyHistory);
  return s;
}

/* ------------------------------------------------------------------ */
/* Compose / split                                                     */
/* ------------------------------------------------------------------ */

/**
 * Builds the editor scene: event-level data from `eventScene`, physical
 * content from `venue`, placed content and safety review from `layout`.
 * In `layout` mode venue elements are shown locked and access overrides are
 * applied; in `venue` mode layout elements are locked and accesses show the
 * venue's own values; `plain` applies overrides without locks (export).
 */
export function composeScene(
  eventScene: Scene,
  venue: Venue,
  layout: Layout,
  mode: ComposeMode
): Scene {
  const s = clone(eventScene);
  const v = clone(venue.content);
  const l = clone(layout.content);
  // A venue without perimeter is still being set up from the event (onboarding):
  // its accesses stay editable in layout mode.
  const lockV = mode === 'layout' && (v.boundary || []).length >= 3;
  const lockL = mode === 'venue';
  const overrides = mode === 'venue' ? {} : layout.accessOverrides || {};

  s.boundary = v.boundary;
  s.passages = [...v.passages.map((t) => withLock(t, lockV)), ...l.passages.map((t) => withLock(t, lockL))];
  s.reserves = [...v.reserves.map((t) => withLock(t, lockV)), ...l.reserves.map((t) => withLock(t, lockL))];
  s.entrances = [
    ...v.entrances.map((e) => withLock(applyAccessOverride(e, overrides[e.id]), lockV)),
    ...l.entrances.map((e) => withLock(e, lockL)),
  ];
  s.base = {
    ...s.base,
    booths: [...v.booths.map((b) => withLock(b, lockV)), ...l.booths.map((b) => withLock(b, lockL))],
  };
  s.infrastructure = [
    ...v.infrastructure.map((o) => withLock(o, lockV)),
    ...l.infrastructure.map((o) => withLock(o, lockL)),
  ];
  // Subsoil is never lock-injected: `safetyFingerprint` hashes it verbatim, so
  // an injected flag would lift a safety stop. Its edits are gated by part
  // (MapShell drag guard, X-ray tools refused in layout mode).
  if (v.subsoil) s.subsoil = v.subsoil;
  else delete s.subsoil;

  s.fences = l.fences.map((t) => withLock(t, lockL));
  s.roadPlans = l.roadPlans.map((t) => withLock(t, lockL));
  s.measurements = l.measurements.map((t) => withLock(t, lockL));
  s.annotations = l.annotations.map((a) => withLock(a, lockL));
  setOptional(s, 'flows', l.flows?.map((t) => withLock(t, lockL)));
  setOptional(s, 'corridors', l.corridors?.map((t) => withLock(t, lockL)));
  setOptional(s, 'groups', l.groups);
  setOptional(s, 'pendingStock', l.pendingStock);
  setOptional(s, 'serviceRoute', l.serviceRoute);
  setOptional(s, 'vehicleRoute', l.vehicleRoute);
  setOptional(s, 'vehicleReference', l.vehicleReference);

  const safety = layout.safety || {};
  setOptional(s, 'safetyReview', clone(safety.safetyReview));
  setOptional(s, 'safetyLock', clone(safety.safetyLock));
  setOptional(s, 'safetyHistory', clone(safety.safetyHistory));
  return s;
}

function setOptional<K extends keyof Scene>(s: Scene, key: K, value: Scene[K] | undefined) {
  if (value === undefined) delete s[key];
  else s[key] = value;
}

export interface SplitResult {
  venue: VenueContent;
  layout: LayoutContent;
  accessOverrides: Record<string, AccessOverride>;
  safety: LayoutSafety;
}

type Part = 'venue' | 'layout';

/** Part of a new passage or reserve (not yet stored in either part). */
function newTracePart(t: GeometryTrace, mode: EditMode, venueHasPerimeter: boolean): Part {
  if (t.origin && PERIMETER_ORIGINS.has(t.origin)) {
    // Perimeter tools belong to «Editar recinto»; the first perimeter of a
    // venue may be drawn from the event set-up (onboarding).
    return mode === 'venue' || !venueHasPerimeter ? 'venue' : 'layout';
  }
  if (t.origin === RESTRICTED_ORIGIN) return mode === 'venue' ? 'venue' : 'layout';
  return 'layout';
}

/**
 * Writes the editable part of a composed scene back (inverse of
 * `composeScene`). The part that was locked is returned unchanged from its
 * stored record, so editing a layout never changes the venue silently
 * (card req. 4), except for drawing the first perimeter of a venue that has none.
 */
export function splitScene(
  composed: Scene,
  venue: Venue,
  layout: Layout,
  mode: EditMode
): SplitResult {
  const vStored = venue.content;
  const lStored = layout.content;
  const venueHasPerimeter = (vStored.boundary || []).length >= 3;
  const vOut: VenueContent = mode === 'venue' ? emptyVenueContent() : clone(vStored);
  const lOut: LayoutContent = mode === 'layout' ? emptyLayoutContent() : clone(lStored);

  // Traces (passages, reserves).
  for (const key of ['passages', 'reserves'] as const) {
    const vIds = idSet(vStored[key]);
    const lIds = idSet(lStored[key]);
    const list = ensureTraceIds(composed[key] || [], key === 'passages' ? 'passage' : 'reserve');
    for (const t of list) {
      const id = t.id!;
      if (vIds.has(id)) {
        if (mode === 'venue') vOut[key].push(clone(t));
      } else if (lIds.has(id)) {
        if (mode === 'layout') lOut[key].push(clone(t));
      } else {
        const part = newTracePart(t, mode, venueHasPerimeter);
        (part === 'venue' ? vOut[key] : lOut[key]).push(clone(t));
      }
    }
  }

  // Accesses: physical data in the venue, operation per layout (plan D2).
  if (mode === 'layout' && !venueHasPerimeter) {
    // Venue being set up from the event (first perimeter): accesses generated
    // or edited now are venue content (D1), not layout-only accesses.
    const lIds = idSet(lStored.entrances);
    vOut.entrances = [];
    for (const e of composed.entrances || []) {
      (lIds.has(e.id) ? lOut.entrances : vOut.entrances).push(clone(e));
    }
  } else {
    const vIds = idSet(vStored.entrances);
    const lIds = idSet(lStored.entrances);
    for (const e of composed.entrances || []) {
      if (vIds.has(e.id)) {
        if (mode === 'venue') vOut.entrances.push(clone(e));
      } else if (lIds.has(e.id)) {
        if (mode === 'layout') lOut.entrances.push(clone(e));
      } else {
        (mode === 'venue' ? vOut.entrances : lOut.entrances).push(clone(e));
      }
    }
  }

  // Booths and infrastructure: venue items are permanent (plan D1).
  splitItems(composed.base?.booths || [], vStored.booths, lStored.booths, mode, vOut.booths, lOut.booths);
  splitItems(
    composed.infrastructure || [],
    vStored.infrastructure,
    lStored.infrastructure,
    mode,
    vOut.infrastructure,
    lOut.infrastructure
  );

  let accessOverrides = clone(layout.accessOverrides || {});
  if (mode === 'venue') {
    vOut.boundary = clone(composed.boundary || []);
    if (composed.subsoil) vOut.subsoil = clone(composed.subsoil);
    // Layout-only lists: keep stored ones, append elements created in venue mode.
    for (const key of LAYOUT_TRACE_LISTS) {
      const stored = lStored[key];
      const ids = idSet(stored);
      const fresh = (composed[key] || []).filter((t) => !t.id || !ids.has(t.id));
      if (fresh.length || stored) lOut[key] = [...clone(stored || []), ...clone(fresh)];
    }
    const annIds = idSet(lStored.annotations);
    lOut.annotations = [
      ...clone(lStored.annotations),
      ...clone((composed.annotations || []).filter((a) => !annIds.has(a.id))),
    ];
    const groupIds = idSet(lStored.groups);
    const freshGroups = (composed.groups || []).filter((g) => !groupIds.has(g.id));
    if (lStored.groups || freshGroups.length) {
      lOut.groups = [...clone(lStored.groups || []), ...clone(freshGroups)];
    }
  } else {
    if (!venueHasPerimeter && (composed.boundary || []).length >= 3) {
      vOut.boundary = clone(composed.boundary);
    }
    for (const key of LAYOUT_TRACE_LISTS) {
      const list = composed[key];
      if (list) lOut[key] = ensureTraceIds(clone(list), key);
      else delete lOut[key];
    }
    lOut.annotations = clone(composed.annotations || []);
    if (composed.groups) lOut.groups = clone(composed.groups);
    else delete lOut.groups;
    accessOverrides = venueHasPerimeter
      ? diffAccessOverrides(composed.entrances || [], vStored.entrances)
      : {};
  }
  // Single-valued layout content and pending stock follow the composed scene.
  for (const key of ['pendingStock', 'serviceRoute', 'vehicleRoute', 'vehicleReference'] as const) {
    if (composed[key] !== undefined) (lOut as unknown as Record<string, unknown>)[key] = clone(composed[key]);
    else delete lOut[key];
  }

  return {venue: vOut, layout: lOut, accessOverrides, safety: safetyFrom(composed)};
}

function emptyVenueContent(): VenueContent {
  return {boundary: [], passages: [], reserves: [], entrances: [], booths: [], infrastructure: []};
}

function splitItems<T extends BoothItem | InfrastructureItem>(
  composed: T[],
  vStored: T[],
  lStored: T[],
  mode: EditMode,
  vOut: T[],
  lOut: T[]
) {
  const vIds = idSet(vStored);
  const lIds = idSet(lStored);
  for (const it of composed) {
    if (vIds.has(it.id)) {
      if (mode !== 'venue') continue;
      // Unchecking «permanente» in venue mode moves the element to the open layout.
      if (it.permanent === false) lOut.push(clone(it));
      else vOut.push({...clone(it), permanent: true});
    } else if (lIds.has(it.id)) {
      if (mode === 'layout') lOut.push(clone(it));
    } else if (mode === 'venue') {
      vOut.push({...clone(it), permanent: true});
    } else if (it.permanent) {
      // A copy of a permanent venue element pasted in layout mode is an
      // ordinary layout element: drop the venue flag and the injected lock.
      const copy = clone(it);
      delete copy.permanent;
      delete copy.locked;
      lOut.push(copy);
    } else {
      lOut.push(clone(it));
    }
  }
}

/** Operational fields of venue accesses that differ in the composed scene. */
export function diffAccessOverrides(
  composed: EntranceItem[],
  venueEntrances: EntranceItem[]
): Record<string, AccessOverride> {
  const byId = new Map(venueEntrances.map((e) => [e.id, e]));
  const out: Record<string, AccessOverride> = {};
  for (const e of composed) {
    const base = byId.get(e.id);
    if (!base) continue;
    const o: Record<string, unknown> = {};
    for (const f of ACCESS_OVERRIDE_FIELDS) {
      if (e[f] !== undefined && JSON.stringify(e[f]) !== JSON.stringify(base[f])) {
        o[f] = clone(e[f]);
      }
    }
    if (Object.keys(o).length) out[e.id] = o as AccessOverride;
  }
  return out;
}

/** JSON with object keys sorted, so construction order never matters. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );
}

/** Canonical content hash used to detect content changes (version bump, plan D6). */
export function contentFingerprint(value: unknown): string {
  return contentHash(canonicalJson(value));
}

/** `true` when a composed list would exceed the 500-element limit (plan D17). */
export function composedListOverflow(venue: VenueContent, layout: LayoutContent): boolean {
  const n = (a?: unknown[]) => a?.length || 0;
  return (
    n(venue.booths) + n(layout.booths) > COMPOSED_LIST_LIMIT ||
    n(venue.infrastructure) + n(layout.infrastructure) > COMPOSED_LIST_LIMIT ||
    n(venue.entrances) + n(layout.entrances) > COMPOSED_LIST_LIMIT ||
    n(venue.passages) + n(layout.passages) > COMPOSED_LIST_LIMIT ||
    n(venue.reserves) + n(layout.reserves) > COMPOSED_LIST_LIMIT
  );
}

/* ------------------------------------------------------------------ */
/* Layout lifecycle                                                    */
/* ------------------------------------------------------------------ */

export interface NewLayoutInput {
  id: string;
  orgId: string;
  eventId: string;
  venue: Venue;
  name: string;
  now: string;
  phases?: PhaseKey[];
  /** Scene slot of the event payload (defaults to the venue's own slot). */
  site?: Layout['site'];
}

/** Layout with only the venue (card req. 3, «en blanco»). */
export function blankLayout(input: NewLayoutInput): Layout {
  return {
    id: input.id,
    orgId: input.orgId,
    eventId: input.eventId,
    venueId: input.venue.id,
    site: input.site ?? input.venue.site,
    name: input.name,
    state: 'draft',
    phases: [...(input.phases || ALL_PHASES)],
    version: 1,
    baseVenueVersion: input.venue.version,
    content: emptyLayoutContent(),
    accessOverrides: {},
    safety: {},
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Copy of a layout with new ids for every element (plan D12). Internal
 * references are remapped, references to venue elements are kept, the origin
 * of each element is recorded, and the safety review is never copied (D11).
 */
export function duplicateLayout(
  src: Layout,
  opts: {id: string; name: string; now: string; newId: () => string}
): Layout {
  const c = clone(src.content);
  const map = new Map<string, string>();
  const reassign = <T extends {id?: string}>(list: T[] | undefined) => {
    for (const it of list || []) {
      const fresh = opts.newId();
      if (it.id) map.set(it.id, fresh);
      it.id = fresh;
    }
  };
  reassign(c.booths);
  reassign(c.infrastructure);
  reassign(c.entrances);
  reassign(c.passages);
  reassign(c.reserves);
  for (const key of LAYOUT_TRACE_LISTS) reassign(c[key]);
  reassign(c.annotations);
  reassign(c.groups);
  reassign(c.pendingStock as Array<{id?: string}> | undefined);

  const remap = (id: string | undefined) => (id && map.has(id) ? map.get(id)! : id);
  for (const it of [...c.booths, ...c.infrastructure]) {
    if (it.coverGroup) it.coverGroup = remap(it.coverGroup);
  }
  for (const o of c.infrastructure) {
    if (o.attachedCoverId) o.attachedCoverId = remap(o.attachedCoverId);
    if (o.homeBaseId) o.homeBaseId = remap(o.homeBaseId);
    if (o.patrolRouteId) o.patrolRouteId = remap(o.patrolRouteId);
  }
  for (const g of c.groups || []) {
    g.memberIds = g.memberIds.map((m) => remap(m)!);
    if (g.parentGroupId) g.parentGroupId = remap(g.parentGroupId);
  }
  const chains = new Map<string, string>();
  for (const f of c.fences) {
    if (!f.chainId) continue;
    if (!chains.has(f.chainId)) chains.set(f.chainId, opts.newId());
    f.chainId = chains.get(f.chainId);
  }

  const originItemIds: Record<string, string> = {};
  for (const [oldId, newId] of map) originItemIds[newId] = oldId;
  return {
    ...clone(src),
    id: opts.id,
    name: opts.name,
    state: 'draft',
    version: 1,
    originLayoutId: src.id,
    originItemIds,
    content: c,
    accessOverrides: clone(src.accessOverrides || {}),
    safety: {},
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/**
 * Changes a layout's state. Promoting to `current` demotes the other current
 * layouts of the same event and venue that share a phase to `proposal`, so at
 * most one layout is current per (event, venue, phase) (plan D5).
 * Returns every layout whose record changed.
 */
export function setLayoutState(
  layouts: Layout[],
  id: string,
  state: LayoutState,
  now: string
): Layout[] {
  const target = layouts.find((l) => l.id === id);
  if (!target) return [];
  const changed: Layout[] = [];
  if (state === 'current') {
    for (const l of layouts) {
      if (
        l.id !== id &&
        l.state === 'current' &&
        l.eventId === target.eventId &&
        l.venueId === target.venueId &&
        l.phases.some((p) => target.phases.includes(p))
      ) {
        changed.push({...l, state: 'proposal', updatedAt: now});
      }
    }
  }
  if (target.state !== state) changed.push({...target, state, updatedAt: now});
  return changed;
}

/** Layouts of `venue` evaluated against an older venue version (plan D8). */
export function affectedLayouts(venue: Venue, layouts: Layout[]): Layout[] {
  return layouts.filter(
    (l) => l.venueId === venue.id && l.state !== 'archived' && l.baseVenueVersion < venue.version
  );
}

/* ------------------------------------------------------------------ */
/* Promotion gate (plan D9)                                            */
/* ------------------------------------------------------------------ */

export type GateCategory = 'perimeter' | 'access' | 'subsoil' | 'medical' | 'response';

/** Route issues of the medical response plan (routes A/B/C, ambulance and on-foot medics). */
const MEDICAL_ROUTE_IDS = new Set(['route-ambulance', 'route-medical', 'route-unverified']);

export interface GateCause {
  category: GateCategory;
  issueId: string;
  title: string;
  action: string;
}

export interface GateResult {
  ok: boolean;
  causes: GateCause[];
  /** Other critical issues: reported, not blocking promotion. */
  otherCritical: RiskIssue[];
}

/** Category of a risk issue that blocks «confirmar como válida», if any. */
export function gateCategory(issue: RiskIssue): GateCategory | null {
  const id = issue.id;
  if (id.startsWith(OUTSIDE_PERIMETER_ISSUE_PREFIX)) return 'perimeter';
  if (issue.level !== 'critical') return null;
  if (id === 'boundary') return 'perimeter';
  if (id === 'entry' || id === 'exit' || id.startsWith('gate-')) return 'access';
  if (id.startsWith('subsoil-load-')) return 'subsoil';
  if (
    id === 'medical' ||
    id === 'transfer' ||
    id.startsWith('route-stretcher-') ||
    MEDICAL_ROUTE_IDS.has(id)
  ) {
    return 'medical';
  }
  // Fire, police and security approach routes: blocking, but not routes A/B/C.
  if (id.startsWith('route-')) return 'response';
  return null;
}

/**
 * Evaluates the promotion gate from a risk report computed on the composed
 * scene of the layout (with route checks). Drafts can always be saved; only
 * promotion to `proposal` or `current` uses this gate.
 */
export function evaluatePromotionGate(issues: RiskIssue[]): GateResult {
  const causes: GateCause[] = [];
  const otherCritical: RiskIssue[] = [];
  for (const i of issues) {
    const category = gateCategory(i);
    if (category) causes.push({category, issueId: i.id, title: i.title, action: i.action});
    else if (i.level === 'critical') otherCritical.push(i);
  }
  return {ok: causes.length === 0, causes, otherCritical};
}
