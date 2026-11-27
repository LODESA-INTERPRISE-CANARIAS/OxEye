/**
 * Header of one venue column in the day timeline: its name, task count, its
 * own warnings (a badge that opens them), the event frames held there and
 * the controls to fold the column to its acronym and to drag its width.
 * Collapsed, the whole header is one button that expands it again.
 */
import React, {useRef} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import {warningsSummary} from '../common/WarningList';
import {plural} from '../lib/format';
import {Icon} from '../ui';
import {COLUMN} from './layout';

/** How close to the plan's right edge a dragged column snaps to automatic. */
const SNAP_PX = 12;

export interface EventFrame {
  id: string;
  name: string;
  /** Short hours for the header («17:00 – 21:00»). */
  time: string;
  /** Full window for the tooltip. */
  full: string;
  status: string;
}

export interface VenueHeaderProps {
  colKey: string;
  colId: string;
  name: string;
  acronym: string;
  /** «Sin lugar»: tasks still without a venue. */
  none: boolean;
  taskCount: number;
  warnings: PlanWarning[];
  /** How many of the venue's conflicts were accepted (listed apart). */
  accepted?: number;
  frames: EventFrame[];
  collapsed: boolean;
  /** Width chosen by hand, if any. */
  width: number | undefined;
  maxWidth: number;
  onToggle: (key: string) => void;
  onOpenWarnings: (key: string, anchor: HTMLElement) => void;
  /** Live width while dragging; null when the drag is cancelled. */
  onDraftWidth: (key: string, width: number | null) => void;
  /** Final width; null returns the column to automatic. */
  onWidth: (key: string, width: number | null) => void;
}

/** Chevrons closing in (fold) or opening out (unfold). */
const FoldIcon: React.FC<{expand?: boolean}> = ({expand}) => (
  <svg
    className="lx-icon"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {expand ? (
      <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
    ) : (
      <path d="m4 7 5 5-5 5M20 7l-5 5 5 5" />
    )}
  </svg>
);

export function warningsLabel(name: string, warnings: PlanWarning[]): string {
  return `Avisos de ${name}: ${warningsSummary(warnings)}`;
}

export function acceptedText(accepted: number): string {
  return `${accepted} ${accepted === 1 ? 'conflicto aceptado' : 'conflictos aceptados'}`;
}

const WarningBadge: React.FC<{
  colKey: string;
  name: string;
  warnings: PlanWarning[];
  /** Accepted conflicts: with nothing open, the badge still opens them. */
  accepted: number;
  onOpen: VenueHeaderProps['onOpenWarnings'];
}> = ({colKey, name, warnings, accepted, onOpen}) => {
  const conflicts = warnings.filter(w => w.severity === 'conflict').length;
  const onlyAccepted = warnings.length === 0;
  const summary = onlyAccepted
    ? acceptedText(accepted)
    : warningsSummary(warnings);
  return (
    <button
      type="button"
      className={`lx-tl__warnbadge${conflicts ? ' has-conflict' : ''}${onlyAccepted ? ' is-accepted' : ''}`}
      aria-haspopup="dialog"
      aria-label={`Avisos de ${name}: ${summary}. Ver avisos.`}
      title={summary}
      onClick={e => onOpen(colKey, e.currentTarget)}
    >
      <Icon
        name={conflicts ? 'alert' : onlyAccepted ? 'check' : 'bell'}
        size={14}
      />
      <span className="lx-num">
        {onlyAccepted ? accepted : warnings.length}
      </span>
    </button>
  );
};

/**
 * Drag handle on the right edge of a header, and its keyboard equivalent:
 * ← / → narrow or widen (Shift for bigger steps), Inicio / Fin go to the
 * narrowest and widest, Supr or a double click return to automatic.
 */
const ResizeHandle: React.FC<{
  colKey: string;
  name: string;
  width: number | undefined;
  maxWidth: number;
  measure: () => number;
  onDraft: VenueHeaderProps['onDraftWidth'];
  onCommit: VenueHeaderProps['onWidth'];
}> = ({colKey, name, width, maxWidth, measure, onDraft, onCommit}) => {
  /**
   * `fill`: the width at which the column's right edge meets the plan's
   * visible right edge. Dragged that far, the column snaps back to automatic
   * (it fills the rest again); the other columns keep their widths.
   */
  const drag = useRef<{
    x: number;
    w: number;
    last: number;
    fill: number | null;
    snap: boolean;
  } | null>(null);
  const clamp = (w: number) =>
    Math.round(Math.min(maxWidth, Math.max(COLUMN.min, w)));

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (commit && d.snap) onCommit(colKey, null);
    else if (commit && Math.abs(d.last - d.w) >= 1) onCommit(colKey, d.last);
    else onDraft(colKey, null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const base = width ?? measure();
    let next: number | null | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      next = clamp(base + (e.shiftKey ? COLUMN.bigStep : COLUMN.step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      next = clamp(base - (e.shiftKey ? COLUMN.bigStep : COLUMN.step));
    } else if (e.key === 'Home') next = COLUMN.min;
    else if (e.key === 'End') next = maxWidth;
    else if (e.key === 'Delete' || e.key === 'Backspace') next = null;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    onCommit(colKey, next);
  };

  return (
    <span
      className="lx-tl__resize"
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={`Ancho de la columna ${name}`}
      aria-valuemin={COLUMN.min}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-valuetext={width ? `${width} píxeles` : 'Ancho automático'}
      title="Arrastra para cambiar el ancho; llévala hasta el borde derecho o haz doble clic para volver al automático"
      data-col-resize={colKey}
      onKeyDown={onKeyDown}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const w = width ?? measure();
        drag.current = {x: e.clientX, w, last: w, fill: null, snap: false};
        // Only a column sized by hand can snap back to automatic.
        const scroller = e.currentTarget.closest('.lx-tl__scroller');
        const head = e.currentTarget.closest('.lx-tl__head');
        if (width !== undefined && scroller && head) {
          const s = scroller.getBoundingClientRect();
          const visibleRight =
            s.left + scroller.clientLeft + scroller.clientWidth;
          const room = visibleRight - head.getBoundingClientRect().right;
          if (room > 0) drag.current.fill = w + room;
        }
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        const raw = d.w + e.clientX - d.x;
        d.snap = d.fill !== null && raw >= d.fill - SNAP_PX;
        const next = d.snap
          ? Math.round(Math.min(COLUMN.max, d.fill!))
          : clamp(raw);
        if (next === d.last) return;
        d.last = next;
        onDraft(colKey, next);
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(true)}
      onDoubleClick={() => onCommit(colKey, null)}
    />
  );
};

export const VenueHeader: React.FC<VenueHeaderProps> = props => {
  const {
    colKey,
    colId,
    name,
    acronym,
    none,
    taskCount,
    warnings,
    accepted = 0,
    frames,
    collapsed,
    width,
    maxWidth,
    onToggle,
    onOpenWarnings,
    onDraftWidth,
    onWidth,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const conflicts = warnings.some(w => w.severity === 'conflict');
  const count = plural(taskCount, 'tarea', 'tareas');

  if (collapsed) {
    const facts = [count, warnings.length ? warningsSummary(warnings) : '']
      .filter(Boolean)
      .join(', ');
    return (
      <div
        className={`lx-tl__head lx-tl__head--collapsed${none ? ' lx-tl__head--none' : ''}`}
        data-col={colKey}
        ref={ref}
      >
        <button
          type="button"
          className="lx-tl__expand"
          aria-expanded={false}
          aria-controls={colId}
          aria-label={`Expandir ${name} (${acronym}): ${facts}`}
          title={`${name} · ${facts}. Toca para expandir.`}
          onClick={() => onToggle(colKey)}
        >
          <span className="lx-tl__acronym">{acronym}</span>
          {warnings.length > 0 && (
            <span
              className={`lx-tl__acrowarn lx-num${conflicts ? ' has-conflict' : ''}`}
              aria-hidden="true"
            >
              {warnings.length}
            </span>
          )}
          <FoldIcon expand />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`lx-tl__head${none ? ' lx-tl__head--none' : ''}`}
      data-col={colKey}
      ref={ref}
    >
      <div className="lx-tl__head-row">
        <span className="lx-tl__venue" title={name}>
          <Icon name="pin" size={14} />
          <span className="lx-tl__venue-name">{name}</span>
        </span>
        <button
          type="button"
          className="lx-tl__fold"
          aria-expanded={true}
          aria-controls={colId}
          aria-label={`Contraer ${name} a sus siglas (${acronym})`}
          title={`Contraer a «${acronym}»`}
          onClick={() => onToggle(colKey)}
        >
          <FoldIcon />
        </button>
      </div>
      <div className="lx-tl__head-meta">
        <span className="lx-tl__count lx-num">{count}</span>
        {(warnings.length > 0 || accepted > 0) && (
          <WarningBadge
            colKey={colKey}
            name={name}
            warnings={warnings}
            accepted={accepted}
            onOpen={onOpenWarnings}
          />
        )}
      </div>
      {frames.map(f => (
        <span
          key={f.id}
          className={`lx-tl__frame lx-tl__frame--${f.status}`}
          title={`Evento · ${f.name} · ${f.full}`}
        >
          <span className="lx-tl__frame-swatch" aria-hidden="true" />
          <span className="lx-tl__frame-time lx-num">{f.time}</span>
          <span className="lx-tl__frame-name">{f.name}</span>
        </span>
      ))}
      <ResizeHandle
        colKey={colKey}
        name={name}
        width={width}
        maxWidth={maxWidth}
        measure={() => ref.current?.getBoundingClientRect().width ?? 0}
        onDraft={onDraftWidth}
        onCommit={onWidth}
      />
    </div>
  );
};
