/**
 * Pure scheduling logic for the Logistics Manager: overlaps, finish-to-start
 * dependencies, slack and delay hypotheses. Works on plain items so the
 * server, the UI and the tests share one implementation. Nothing here mutates
 * its input: a hypothesis is computed, never applied.
 */
import type {IsoInstant, Uuid} from './contracts.ts';

export interface ScheduleItem {
  id: Uuid;
  label: string;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  /** Items in the same lane compete for the same space (e.g. venue or loading zone). */
  lane: string | null;
  /** Finish-to-start predecessors: this item cannot start before they end. */
  dependsOn: Uuid[];
  cancelled?: boolean;
}

export interface Overlap {
  a: Uuid;
  b: Uuid;
  lane: string;
  minutes: number;
}

const MIN = 60_000;
const toMs = (iso: IsoInstant | null) => (iso ? Date.parse(iso) : NaN);
const iso = (ms: number) => new Date(ms).toISOString();

function scheduled(item: ScheduleItem): boolean {
  return (
    !item.cancelled &&
    !Number.isNaN(toMs(item.startsAt)) &&
    !Number.isNaN(toMs(item.endsAt))
  );
}

/** Pairs of items in the same lane whose time windows intersect. */
export function findOverlaps(items: ScheduleItem[]): Overlap[] {
  const byLane = new Map<string, ScheduleItem[]>();
  for (const it of items) {
    if (!it.lane || !scheduled(it)) continue;
    const list = byLane.get(it.lane) ?? [];
    list.push(it);
    byLane.set(it.lane, list);
  }
  const out: Overlap[] = [];
  for (const [lane, list] of byLane) {
    const sorted = [...list].sort(
      (x, y) => toMs(x.startsAt) - toMs(y.startsAt),
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (toMs(b.startsAt) >= toMs(a.endsAt)) break;
        const minutes = Math.round(
          (Math.min(toMs(a.endsAt), toMs(b.endsAt)) - toMs(b.startsAt)) / MIN,
        );
        if (minutes > 0) out.push({a: a.id, b: b.id, lane, minutes});
      }
    }
  }
  return out;
}

/** Ids reachable from `ids` through dependency edges (successors), in topological order. */
export function successorsOf(items: ScheduleItem[], rootId: Uuid): Uuid[] {
  const succ = new Map<Uuid, Uuid[]>();
  for (const it of items) {
    for (const p of it.dependsOn) succ.set(p, [...(succ.get(p) ?? []), it.id]);
  }
  const seen = new Set<Uuid>();
  const order: Uuid[] = [];
  const visit = (id: Uuid) => {
    for (const s of succ.get(id) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      order.push(s);
      visit(s);
    }
  };
  visit(rootId);
  return order;
}

/** Returns an id cycle if the dependency graph has one, otherwise null. */
export function findCycle(items: ScheduleItem[]): Uuid[] | null {
  const deps = new Map(items.map(i => [i.id, i.dependsOn]));
  const state = new Map<Uuid, 1 | 2>();
  const stack: Uuid[] = [];
  const dfs = (id: Uuid): Uuid[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const p of deps.get(id) ?? []) {
      if (!deps.has(p)) continue;
      if (state.get(p) === 1) return [...stack.slice(stack.indexOf(p)), p];
      if (!state.has(p)) {
        const c = dfs(p);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of deps.keys()) {
    if (!state.has(id)) {
      const c = dfs(id);
      if (c) return c;
    }
  }
  return null;
}

/**
 * Minutes between the latest end of an item's predecessors and its start.
 * Null if the item or every predecessor lacks times. Negative means the plan
 * already violates the dependency.
 */
export function slackMinutes(items: ScheduleItem[], id: Uuid): number | null {
  const byId = new Map(items.map(i => [i.id, i]));
  const it = byId.get(id);
  if (!it || Number.isNaN(toMs(it.startsAt))) return null;
  let latestEnd = -Infinity;
  for (const p of it.dependsOn) {
    const pred = byId.get(p);
    if (pred && !pred.cancelled && !Number.isNaN(toMs(pred.endsAt)))
      {latestEnd = Math.max(latestEnd, toMs(pred.endsAt));}
  }
  if (latestEnd === -Infinity) return null;
  return Math.round((toMs(it.startsAt) - latestEnd) / MIN);
}

export interface ShiftedItem {
  id: Uuid;
  label: string;
  /** Minutes the item moves later (> 0). */
  deltaMinutes: number;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
  /** Slack the item had before the hypothesis (null if unknown). */
  slackBefore: number | null;
}

export interface DelayImpact {
  rootId: Uuid;
  delayMinutes: number;
  /** The delayed item itself plus every successor that has to move. */
  shifted: ShiftedItem[];
  /** Successors reached by the delay but absorbed by their slack. */
  absorbed: {id: Uuid; label: string; slackLeft: number}[];
  /** Overlaps that exist only under the hypothesis. */
  newOverlaps: Overlap[];
  /** Items whose times are unknown, so the effect cannot be computed. */
  unknown: Uuid[];
}

/**
 * Computes the effect of delaying `rootId` by `delayMinutes` (finish-to-start
 * propagation through `dependsOn`). Durations are preserved. The input is not
 * modified; apply the result only after the user confirms.
 */
export function simulateDelay(
  items: ScheduleItem[],
  rootId: Uuid,
  delayMinutes: number,
): DelayImpact {
  const byId = new Map(items.map(i => [i.id, i]));
  const root = byId.get(rootId);
  const empty: DelayImpact = {
    rootId,
    delayMinutes,
    shifted: [],
    absorbed: [],
    newOverlaps: [],
    unknown: [],
  };
  if (!root || !Number.isFinite(delayMinutes) || delayMinutes <= 0)
    {return empty;}
  if (!scheduled(root)) return {...empty, unknown: [rootId]};

  const newStart = new Map<Uuid, number>();
  const newEnd = new Map<Uuid, number>();
  newStart.set(rootId, toMs(root.startsAt) + delayMinutes * MIN);
  newEnd.set(rootId, toMs(root.endsAt) + delayMinutes * MIN);

  const order = successorsOf(items, rootId);
  const reached = new Set([rootId, ...order]);
  const unknown: Uuid[] = [];
  const absorbed: DelayImpact['absorbed'] = [];
  // Recompute in dependency order until stable (order from DFS may not be topological for diamonds).
  for (let pass = 0; pass < order.length + 1; pass++) {
    let changed = false;
    for (const id of order) {
      const it = byId.get(id)!;
      if (it.cancelled) continue;
      if (!scheduled(it)) {
        if (!unknown.includes(id)) unknown.push(id);
        continue;
      }
      let earliest = -Infinity;
      for (const p of it.dependsOn) {
        const pred = byId.get(p);
        if (!pred || pred.cancelled) continue;
        const end = newEnd.get(p) ?? toMs(pred.endsAt);
        if (!Number.isNaN(end)) earliest = Math.max(earliest, end);
      }
      const start0 = toMs(it.startsAt);
      const start = Math.max(start0, earliest);
      const prev = newStart.get(id);
      if (start > start0 && prev !== start) {
        newStart.set(id, start);
        newEnd.set(id, toMs(it.endsAt) + (start - start0));
        changed = true;
      }
    }
    if (!changed) break;
  }

  const shifted: ShiftedItem[] = [];
  for (const id of [rootId, ...order]) {
    const it = byId.get(id)!;
    const s = newStart.get(id);
    if (s === undefined) continue;
    shifted.push({
      id,
      label: it.label,
      deltaMinutes: Math.round((s - toMs(it.startsAt)) / MIN),
      startsAt: iso(s),
      endsAt: iso(newEnd.get(id)!),
      slackBefore: slackMinutes(items, id),
    });
  }
  for (const id of order) {
    const it = byId.get(id)!;
    if (newStart.has(id) || !scheduled(it) || it.cancelled) continue;
    // Reached but did not move: report the slack that remains under the hypothesis.
    const preds = it.dependsOn.filter(p => reached.has(p));
    if (!preds.length) continue;
    let latest = -Infinity;
    for (const p of it.dependsOn) {
      const pred = byId.get(p);
      if (!pred || pred.cancelled) continue;
      latest = Math.max(latest, newEnd.get(p) ?? toMs(pred.endsAt));
    }
    absorbed.push({
      id,
      label: it.label,
      slackLeft: Math.round((toMs(it.startsAt) - latest) / MIN),
    });
  }

  const hypothetical = items.map(it =>
    newStart.has(it.id)
      ? {
          ...it,
          startsAt: iso(newStart.get(it.id)!),
          endsAt: iso(newEnd.get(it.id)!),
        }
      : it,
  );
  const key = (o: Overlap) => [o.a, o.b].sort().join('|') + '@' + o.lane;
  const before = new Set(findOverlaps(items).map(key));
  const newOverlaps = findOverlaps(hypothetical).filter(
    o => !before.has(key(o)),
  );

  return {rootId, delayMinutes, shifted, absorbed, newOverlaps, unknown};
}
