/**
 * Day timeline layout, in one place: venue column widths and collapse (with
 * their remembered preferences), the CSS grid tracks, each venue's warnings,
 * the event frame and block time labels, horizontal stepping between venues
 * and the minute ↔ pixel geometry shared by blocks and bands (and, from E2,
 * by dragging a block). Pure functions; no React, no DOM, no store.
 */
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Span, TimelineBlock} from '../lib/calendar';

/** Column sizes in px. `default` widths live in CSS (`--lx-colw`). */
export const COLUMN = {
  /** Narrowest an expanded column can be dragged: name, fold and badge fit. */
  min: 128,
  /** Widest, whatever the screen: one venue never needs more. */
  max: 720,
  /** Keyboard steps (arrow, Shift + arrow). */
  step: 16,
  bigStep: 64,
} as const;

/** Key of a column in preferences and the DOM: venue id or `none`. */
export const columnKey = (column: {id: string | null}): string =>
  column.id ?? 'none';

// ---------------------------------------------------------------- preferences

export interface ColumnPref {
  /** Width chosen by dragging, in px; absent = automatic. */
  width?: number;
  collapsed?: boolean;
}

export type ColumnPrefs = Record<string, ColumnPref>;

/** Venues remembered at most; the least recently changed go first. */
export const MAX_COLUMN_PREFS = 80;

/** Reads stored preferences, dropping anything malformed. */
export function parseColumnPrefs(raw: string | null): ColumnPrefs {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: ColumnPrefs = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const pref: ColumnPref = {};
    if (typeof v.width === 'number' && Number.isFinite(v.width)) {
      pref.width = Math.round(
        Math.min(COLUMN.max, Math.max(COLUMN.min, v.width)),
      );
    }
    if (v.collapsed === true) pref.collapsed = true;
    if (pref.width !== undefined || pref.collapsed) out[key] = pref;
  }
  return out;
}

/**
 * Preferences with one column changed. `width: null` returns to automatic,
 * `collapsed: false` expands. Empty entries are removed and the list is kept
 * to `MAX_COLUMN_PREFS`, newest last.
 */
export function withColumnPref(
  prefs: ColumnPrefs,
  key: string,
  patch: {width?: number | null; collapsed?: boolean},
): ColumnPrefs {
  const {[key]: current, ...rest} = prefs;
  const next: ColumnPref = {...current};
  if (patch.width === null) delete next.width;
  else if (patch.width !== undefined) {
    next.width = Math.round(
      Math.min(COLUMN.max, Math.max(COLUMN.min, patch.width)),
    );
  }
  if (patch.collapsed === false) delete next.collapsed;
  else if (patch.collapsed) next.collapsed = true;
  const out: ColumnPrefs = rest;
  if (next.width !== undefined || next.collapsed) out[key] = next;
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COLUMN_PREFS))) {
    delete out[k];
  }
  return out;
}

// ---------------------------------------------------------------- widths and tracks

/**
 * Widest a column may be on this screen: the visible width of the plan
 * (`available`, without the hour gutter), never below `COLUMN.min`.
 */
export function maxColumnWidth(available: number | null): number {
  if (!available || available <= 0) return COLUMN.max;
  return Math.max(COLUMN.min, Math.min(COLUMN.max, Math.floor(available)));
}

export function clampColumnWidth(
  width: number,
  available: number | null,
): number {
  return Math.round(
    Math.min(maxColumnWidth(available), Math.max(COLUMN.min, width)),
  );
}

export interface TrackInput {
  pref?: ColumnPref;
  /** Lanes needed by blocks side by side (1 when none overlap). */
  lanes: number;
}

export interface GridTracks {
  /** One track per column, in order. */
  columns: string[];
  /**
   * Whether a trailing filler track is needed: when no column stretches
   * (all collapsed or sized by hand), it takes the free space so the grid
   * still reaches the right edge.
   */
  filler: boolean;
}

/**
 * CSS grid tracks for the venue columns. Collapsed: narrow and fixed. Sized
 * by hand: exactly that width (within the screen). Automatic: at least the
 * default width (or enough for its lanes) and stretching to share the rest.
 */
export function columnTracks(
  columns: TrackInput[],
  available: number | null,
): GridTracks {
  let flexible = false;
  const tracks = columns.map(({pref, lanes}) => {
    if (pref?.collapsed) return 'var(--lx-colw-collapsed)';
    if (pref?.width !== undefined) {
      return `${clampColumnWidth(pref.width, available)}px`;
    }
    flexible = true;
    return lanes > 1
      ? `minmax(max(var(--lx-colw), calc(${lanes} * var(--lx-lanew))), 1fr)`
      : 'minmax(var(--lx-colw), 1fr)';
  });
  return {columns: tracks, filler: !flexible && columns.length > 0};
}

// ---------------------------------------------------------------- stepping between venues

/**
 * Scroll position that brings the next (`dir` 1) or previous (-1) column to
 * the left edge of the plan, or null at the end. `starts` are the scroll
 * positions that align each column; `max` is the largest scroll position.
 */
export function nextColumnScroll(
  starts: number[],
  current: number,
  dir: 1 | -1,
  max: number,
): number | null {
  const stops = [
    ...new Set(starts.map(s => Math.round(Math.min(max, Math.max(0, s))))),
  ].sort((a, b) => a - b);
  if (dir > 0) return stops.find(s => s > current + 1) ?? null;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i] < current - 1) return stops[i];
  }
  return null;
}

// ---------------------------------------------------------------- warnings per venue

/**
 * The day's warnings that involve each column's tasks, conflicts first.
 * A warning between two venues (the same company in both) shows in both.
 */
export function columnWarnings(
  columns: {tasks: {id: string}[]}[],
  warnings: PlanWarning[],
): PlanWarning[][] {
  return columns.map(c => {
    const ids = new Set(c.tasks.map(t => t.id));
    const mine = warnings.filter(w => w.taskIds.some(id => ids.has(id)));
    return [
      ...mine.filter(w => w.severity === 'conflict'),
      ...mine.filter(w => w.severity !== 'conflict'),
    ];
  });
}

// ---------------------------------------------------------------- labels

/** «17:00», with the end of the day as «24:00». */
export function dayClock(minutes: number): string {
  if (minutes >= 1440) return '24:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Hours of an event frame on one day, short enough for a column header:
 * «17:00 – 21:00», «desde 10:00», «hasta 20:00», «todo el día»,
 * «17:00 · fin pendiente».
 */
export function frameTimeLabel(span: Span): string {
  if (span.continuesBefore && span.continuesAfter) return 'todo el día';
  if (span.continuesBefore) return `hasta ${dayClock(span.end)}`;
  if (span.continuesAfter) return `desde ${dayClock(span.start)}`;
  if (span.openEnd) return `${dayClock(span.start)} · fin pendiente`;
  return `${dayClock(span.start)} – ${dayClock(span.end)}`;
}

/**
 * A block's time split in two: `lead` (its start on this day, «Sigue» when
 * it comes from the day before) is always shown; `tail` («– 13:00») only
 * when there is room. `full` is the task's whole window («08:00 – 13:00»).
 */
export function blockTimeParts(
  full: string,
  span: Span,
): {lead: string; tail: string} {
  const dash = full.indexOf(' – ');
  const end = dash >= 0 ? full.slice(dash + 3) : '';
  if (span.continuesBefore) {
    return {lead: 'Sigue', tail: end ? ` hasta ${end}` : ''};
  }
  return {lead: dayClock(span.start), tail: end ? ` – ${end}` : ''};
}

// ---------------------------------------------------------------- geometry

type CssVars = Record<`--${string}`, number>;

/**
 * CSS variables that place a block: start and end minute, lane and lanes.
 * The stylesheet turns them into pixels with `--lx-hour`, so a pinch only
 * changes that one variable.
 */
export function blockVars(block: TimelineBlock): CssVars {
  return {
    '--lx-s': block.span.start,
    '--lx-e': block.span.end,
    '--lx-lane': block.lane,
    '--lx-lanes': block.lanes,
  };
}

/** CSS variables that place an event band. */
export function bandVars(span: Span): CssVars {
  return {'--lx-s': span.start, '--lx-e': span.end};
}

/** Pixels from the top of the day for a minute, at `hourPx` per hour. */
export function minuteToPx(minutes: number, hourPx: number): number {
  return (minutes / 60) * hourPx;
}

/**
 * Minute of the day at a vertical offset, rounded to `step` minutes and kept
 * within the day (for dragging a block in E2).
 */
export function pxToMinute(px: number, hourPx: number, step = 5): number {
  const raw = (px / hourPx) * 60;
  const snapped = Math.round(raw / step) * step;
  return Math.min(1440, Math.max(0, snapped));
}
