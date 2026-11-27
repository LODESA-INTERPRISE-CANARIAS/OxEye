/**
 * Day timeline: one column per venue (plus «Sin lugar»), one row per hour.
 * Task blocks follow the certainty grammar (planned outlined, confirmed
 * solid, delayed in the danger tone, cancelled struck), overlapping blocks
 * sit side by side, conflicts get an outline, and events show as a faint
 * band behind the tasks of their venue. Today has a line at the current time.
 *
 * Scale: pinch on touch screens and Ctrl + wheel (trackpad pinch) change the
 * height of an hour; the toolbar's − / + buttons do the same for keyboard and
 * mouse. During a pinch only a CSS variable changes; the new height is
 * committed when the fingers lift.
 *
 * Venues (Revisión 1): each header shows the venue's own warnings and the
 * hours of the events held there, so the event frame is always readable
 * whatever covers the band. A column's right edge can be dragged (or moved
 * with ← / → once focused) to widen or narrow it, and a column folds to its
 * acronym with its blocks left as slim markers; both are remembered on this
 * device. With more than three venues that do not fit, ‹ › step one venue at
 * a time. Geometry and labels come from `./layout`.
 *
 * Moves (Revisión 1 · E2): members hold a block to lift it and drag it to
 * another time, or use Alt + arrows (`./useBlockDrag`); the move preview
 * opens on release. Hovering, focusing or lifting a block highlights what it
 * waits for and what waits for it (`./DependencyLinks`).
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {acronymFor} from '../../../shared/logistics/acronym.ts';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {
  LocalDate,
  OpeningHours,
  Task,
} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {taskLabel} from '../common/TaskRow';
import {windowText} from '../common/TimeWindow';
import type {AcceptedWarning} from '../common/usePlan';
import {slotText} from '../followup/text';
import {
  clock,
  layoutColumn,
  spanOnDate,
  type TimelineBlock as TimelineBlockLayout,
  type VenueColumn,
} from '../lib/calendar';
import {TASK_KIND_ICON, taskZone} from '../lib/tasks';
import {closedBands, shiftedWindow} from '../moves/drag';
import {durationText, shiftText} from '../moves/exits';
import {useMoveFlow} from '../moves/useMoveFlow';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon, IconButton} from '../ui';
import {
  DependencyLinks,
  dependantsOf,
  dependencyText,
  relationOf,
  type Relation,
} from './DependencyLinks';
import {
  bandVars,
  blockTimeParts,
  blockVars,
  columnKey,
  columnTracks,
  columnWarnings,
  frameTimeLabel,
  maxColumnWidth,
  nextColumnScroll,
} from './layout';
import {useBlockDrag, type BlockHandlers, type DragView} from './useBlockDrag';
import {useColumnPrefs} from './useColumnPrefs';
import {VenueHeader, type EventFrame} from './VenueHeader';
import {VenueWarnings} from './VenueWarnings';

export const HOUR_MIN = 28;
export const HOUR_MAX = 180;
export const clampHour = (h: number) =>
  Math.round(Math.min(HOUR_MAX, Math.max(HOUR_MIN, h)));

/** Minimum drawn height of a block, in px. */
const MIN_BLOCK_PX = 30;
const HOURS = Array.from({length: 24}, (_, h) => h);
/** Arrows appear from this many columns on, when they do not all fit. */
const ARROWS_FROM = 4;

export interface TimelineProps {
  date: LocalDate;
  columns: VenueColumn[];
  hour: number;
  onHour: (hour: number) => void;
  byTask: Map<string, PlanWarning[]>;
  /** The day's warnings (shown per venue in the headers). */
  warnings: PlanWarning[];
  tasksById: Map<string, Task>;
  /** Minutes since midnight when the day is today. */
  now: number | null;
  onOpenTask: (task: Task) => void;
  /** The day's accepted conflicts (listed apart in each venue's panel). */
  accepted?: AcceptedWarning[];
}

type Vars = React.CSSProperties & Record<`--${string}`, string | number>;

interface ViewState {
  /** Visible width for columns (scroller minus hour gutter), px. */
  avail: number | null;
  overflow: boolean;
  atStart: boolean;
  atEnd: boolean;
  /** Header row height and vertical scrollbar width, for the arrows. */
  headH: number;
  scrollbar: number;
}

const colIdOf = (key: string) => `lx-tl-col-${key}`;

export const Timeline: React.FC<TimelineProps> = ({
  date,
  columns,
  hour,
  onHour,
  byTask,
  warnings,
  tasksById,
  now,
  onOpenTask,
  accepted = [],
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef(hour);
  useLayoutEffect(() => {
    hourRef.current = hour;
  });

  const venues = useLogisticsStore(s => s.venues);
  const {prefs, setWidth, setCollapsed} = useColumnPrefs();
  const [draft, setDraft] = useState<{key: string; width: number} | null>(null);
  const [view, setView] = useState<ViewState>({
    avail: null,
    overflow: false,
    atStart: true,
    atEnd: true,
    headH: 0,
    scrollbar: 0,
  });
  const [openWarnings, setOpenWarnings] = useState<{
    key: string;
    anchor: HTMLElement;
  } | null>(null);
  const focusAfterToggle = useRef<string | null>(null);

  const layouts = useMemo(() => {
    const minMinutes = (MIN_BLOCK_PX / hour) * 60;
    return columns.map(c => layoutColumn(c.tasks, date, minMinutes));
  }, [columns, date, hour]);

  const perColumnWarnings = useMemo(
    () => columnWarnings(columns, warnings),
    [columns, warnings],
  );
  const perColumnAccepted = useMemo(() => {
    if (!accepted.length) return columns.map(() => [] as AcceptedWarning[]);
    const byKey = new Map(accepted.map(a => [a.warning.key, a]));
    return columnWarnings(
      columns,
      accepted.map(a => a.warning),
    ).map(list => list.map(w => byKey.get(w.key)!));
  }, [columns, accepted]);

  // ---------------------------------------------------------- moves (E2)
  const {canWrite, timeZone} = useActions();
  const toast = useLogisticsStore(s => s.toast);
  const flow = useMoveFlow();
  const venuesById = useMemo(
    () => new Map(venues.map(v => [v.id, v])),
    [venues],
  );
  const placeOf = useCallback(
    (task: Task) => {
      const v = task.venue ? venuesById.get(task.venue.id) : undefined;
      return v
        ? {name: v.name, openingHours: v.openingHours ?? null}
        : undefined;
    },
    [venuesById],
  );
  const settleRef = useRef<() => void>(() => undefined);
  const {drag, bind, settle} = useBlockDrag({
    scrollerRef,
    hourRef,
    enabled: canWrite,
    timeZone,
    placeOf,
    onExplain: message => toast(message, 'info'),
    onRelease: (task, minutes) =>
      flow.open(
        {kind: 'move', taskId: task.id, minutes, origin: 'calendar'},
        () => settleRef.current(),
      ),
  });
  useLayoutEffect(() => {
    settleRef.current = settle;
  });

  // ---------------------------------------------------------- dependencies
  // Hover and keyboard focus are kept apart: the mouse leaving some other
  // block (or a scroll moving blocks under it) never clears the focused one.
  // The most recent of the two wins while both are set.
  const [looked, setLooked] = useState<{
    hover: string | null;
    focus: string | null;
    last: 'hover' | 'focus';
  }>({hover: null, focus: null, last: 'hover'});
  const setHovered = useCallback(
    (id: string | null) =>
      setLooked(l =>
        l.hover === id ? l : {...l, hover: id, last: id ? 'hover' : l.last},
      ),
    [],
  );
  const setFocused = useCallback(
    (id: string | null) =>
      setLooked(l =>
        l.focus === id ? l : {...l, focus: id, last: id ? 'focus' : l.last},
      ),
    [],
  );
  const activeId =
    drag?.taskId ??
    (looked.last === 'focus'
      ? (looked.focus ?? looked.hover)
      : (looked.hover ?? looked.focus));
  const dependants = useMemo(() => dependantsOf(tasksById), [tasksById]);
  const activeTask = activeId ? tasksById.get(activeId) : undefined;

  const acronyms = useMemo(() => {
    const stored = new Map(venues.map(v => [v.id, v.acronym]));
    return columns.map(c =>
      acronymFor(
        {name: c.name, acronym: c.id ? stored.get(c.id) : null},
        {dotted: true},
      ),
    );
  }, [columns, venues]);

  const frames = useMemo(
    () =>
      columns.map(c =>
        c.events
          .map((e): EventFrame | null => {
            const span = spanOnDate(e, date);
            if (!span) return null;
            return {
              id: e.id,
              name: e.name,
              time: frameTimeLabel(span),
              full: windowText(e),
              status: e.status,
            };
          })
          .filter((f): f is EventFrame => !!f),
      ),
    [columns, date],
  );

  // Open at the current time on today, otherwise at the first block.
  const firstStart = useMemo(() => {
    let first: number | null = null;
    for (const blocks of layouts) {
      for (const b of blocks) {
        if (first === null || b.span.start < first) first = b.span.start;
      }
    }
    return first;
  }, [layouts]);
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || scrolledFor.current === date) return;
    scrolledFor.current = date;
    const target = now ?? firstStart ?? 8 * 60;
    el.scrollTop = Math.max(0, ((target - 60) / 60) * hourRef.current);
  }, [date, now, firstStart]);

  // Pinch (touch) and Ctrl + wheel (trackpad pinch, desktop) change the scale,
  // keeping the time under the fingers or pointer in place.
  useEffect(() => {
    const el = scrollerRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    let startDist = 0;
    let startHour = hourRef.current;
    let anchorMin = 0;
    let anchorY = 0;
    let live = hourRef.current;
    const headerH = () =>
      el.querySelector<HTMLElement>('.lx-tl__head')?.offsetHeight ?? 0;
    const apply = (h: number) => {
      live = clampHour(h);
      root.style.setProperty('--lx-hour', `${live}px`);
      el.scrollTop = (anchorMin / 60) * live + headerH() - anchorY;
    };
    const anchorAt = (clientY: number, h: number) => {
      anchorY = clientY - el.getBoundingClientRect().top;
      anchorMin = ((el.scrollTop + anchorY - headerH()) / h) * 60;
    };
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = dist(e.touches);
      startHour = hourRef.current;
      live = startHour;
      anchorAt((e.touches[0].clientY + e.touches[1].clientY) / 2, startHour);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      apply(startHour * (dist(e.touches) / startDist));
    };
    const onEnd = (e: TouchEvent) => {
      if (!startDist || e.touches.length >= 2) return;
      startDist = 0;
      if (live !== hourRef.current) onHour(live);
    };
    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (!wheelTimer) {
        startHour = hourRef.current;
        live = startHour;
      }
      anchorAt(e.clientY, live);
      apply(live * Math.exp(-e.deltaY * 0.01));
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelTimer = 0;
        if (live !== hourRef.current) onHour(live);
      }, 180);
    };
    el.addEventListener('touchstart', onStart, {passive: true});
    el.addEventListener('touchmove', onMove, {passive: false});
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('wheel', onWheel, {passive: false});
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheelTimer);
    };
  }, [onHour]);

  // Room for columns, whether they overflow and where the scroll is: drives
  // the widest a column may be and the ‹ › arrows.
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const corner = el.querySelector<HTMLElement>('.lx-tl__corner');
    const gutter = corner?.offsetWidth ?? 0;
    const max = el.scrollWidth - el.clientWidth;
    const next: ViewState = {
      avail: el.clientWidth - gutter,
      overflow: max > 1,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
      headH: corner?.offsetHeight ?? 0,
      scrollbar: el.offsetWidth - el.clientWidth,
    };
    setView(v =>
      (Object.keys(next) as (keyof ViewState)[]).every(k => v[k] === next[k])
        ? v
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const grid = gridRef.current;
    if (!el || !grid) return;
    measure();
    let frame = 0;
    let lastLeft = el.scrollLeft;
    const onScroll = () => {
      if (el.scrollLeft !== lastLeft) {
        lastLeft = el.scrollLeft;
        // The badge moved sideways: the panel would point at nothing.
        setOpenWarnings(null);
      }
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    el.addEventListener('scroll', onScroll, {passive: true});
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measure());
    ro?.observe(el);
    ro?.observe(grid);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [measure]);

  // A new day closes the warnings of the previous one.
  useEffect(() => {
    setOpenWarnings(null);
  }, [date]);

  const maxWidth = maxColumnWidth(view.avail);
  const effectivePrefs = columns.map(c => {
    const key = columnKey(c);
    const pref = prefs[key];
    return draft?.key === key ? {...pref, width: draft.width} : pref;
  });
  const tracks = columnTracks(
    layouts.map((blocks, i) => ({
      pref: effectivePrefs[i],
      lanes: blocks.reduce((n, b) => Math.max(n, b.lanes), 1),
    })),
    view.avail,
  );
  const arrows = columns.length >= ARROWS_FROM && view.overflow;
  const allTracks = [
    ...tracks.columns,
    ...(tracks.filler ? ['minmax(0, 1fr)'] : []),
    ...(arrows ? ['var(--lx-endw)'] : []),
  ];
  const vars: Vars = {
    '--lx-hour': `${hour}px`,
    '--lx-cols': columns.length,
    '--lx-tracks': allTracks.join(' '),
    '--lx-minh': `${MIN_BLOCK_PX}px`,
    '--lx-headh': `${view.headH}px`,
    '--lx-sbw': `${view.scrollbar}px`,
  };

  const toggle = useCallback(
    (key: string) => {
      focusAfterToggle.current = key;
      setOpenWarnings(null);
      setCollapsed(key, !prefs[key]?.collapsed);
    },
    [prefs, setCollapsed],
  );
  // Keep the keyboard where it was: on the same venue's fold / expand button.
  useEffect(() => {
    const key = focusAfterToggle.current;
    if (!key) return;
    focusAfterToggle.current = null;
    gridRef.current
      ?.querySelector<HTMLElement>(
        `[data-col="${key}"] .lx-tl__fold, [data-col="${key}"] .lx-tl__expand`,
      )
      ?.focus({preventScroll: true});
  }, [prefs]);

  // Chrome scrolls a control of the sticky header to its unstuck place when
  // Tab focuses it (the plan jumps towards midnight); keep the hour shown.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let keepTop: number | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      keepTop = e.key === 'Tab' ? el.scrollTop : null;
    };
    const onFocusIn = (e: FocusEvent) => {
      const top = keepTop;
      keepTop = null;
      if (top === null) return;
      if (!(e.target as HTMLElement).closest?.('.lx-tl__head')) return;
      el.scrollTop = top;
      window.requestAnimationFrame(() => {
        el.scrollTop = top;
      });
    };
    document.addEventListener('keydown', onKeyDown, true);
    el.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      el.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  const draftWidth = useCallback((key: string, width: number | null) => {
    setDraft(width === null ? null : {key, width});
  }, []);
  const commitWidth = useCallback(
    (key: string, width: number | null) => {
      setDraft(null);
      setWidth(key, width);
    },
    [setWidth],
  );
  const openRef = useRef(openWarnings);
  useLayoutEffect(() => {
    openRef.current = openWarnings;
  });
  const openPanel = useCallback((key: string, anchor: HTMLElement) => {
    setOpenWarnings(o => (o?.key === key ? null : {key, anchor}));
  }, []);
  const closePanel = useCallback((restoreFocus: boolean) => {
    const anchor = openRef.current?.anchor;
    setOpenWarnings(null);
    if (restoreFocus) anchor?.focus({preventScroll: true});
  }, []);

  const stepColumns = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const gutter =
      el.querySelector<HTMLElement>('.lx-tl__corner')?.offsetWidth ?? 0;
    const starts = [
      ...el.querySelectorAll<HTMLElement>('.lx-tl__head[data-col]'),
    ].map(
      h => h.getBoundingClientRect().left - box.left + el.scrollLeft - gutter,
    );
    const target = nextColumnScroll(
      starts,
      el.scrollLeft,
      dir,
      el.scrollWidth - el.clientWidth,
    );
    if (target === null) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches;
    el.scrollTo({left: target, behavior: smooth ? 'smooth' : 'auto'});
  };

  const panelIndex = openWarnings
    ? columns.findIndex(c => columnKey(c) === openWarnings.key)
    : -1;
  const panelWarnings = panelIndex >= 0 ? perColumnWarnings[panelIndex] : [];
  const panelAccepted = panelIndex >= 0 ? perColumnAccepted[panelIndex] : [];

  // The dragged block, its column and its venue's hours.
  const dragBlock = useMemo(() => {
    if (!drag) return null;
    for (let ci = 0; ci < layouts.length; ci++) {
      const block = layouts[ci].find(b => b.task.id === drag.taskId);
      if (block) return {ci, block};
    }
    return null;
  }, [drag, layouts]);
  const dragHours = dragBlock ? placeOf(dragBlock.block.task) : undefined;
  const announce = dragAnnouncement(drag, dragBlock?.block.task);

  return (
    <div
      className={`lx-tl${draft ? ' is-resizing' : ''}${drag && !drag.pending ? ' is-dragging' : ''}`}
      ref={rootRef}
      style={vars}
      id="lx-timeline"
    >
      <div
        className="lx-tl__scroller"
        ref={scrollerRef}
        data-no-swipe
        tabIndex={0}
        role="region"
        id="lx-tl-scroller"
        aria-label="Plan del día: una columna por lugar y una fila por hora. Pellizca o usa − y + para cambiar la escala."
      >
        <div className="lx-tl__grid" ref={gridRef}>
          <div className="lx-tl__corner" aria-hidden="true">
            <Icon name="clock" size={16} />
          </div>
          {columns.map((c, ci) => {
            const key = columnKey(c);
            return (
              <VenueHeader
                key={key}
                colKey={key}
                colId={colIdOf(key)}
                name={c.name}
                acronym={acronyms[ci]}
                none={!c.id}
                taskCount={c.tasks.length}
                warnings={perColumnWarnings[ci]}
                frames={frames[ci]}
                collapsed={!!prefs[key]?.collapsed}
                width={effectivePrefs[ci]?.width}
                maxWidth={maxWidth}
                onToggle={toggle}
                onOpenWarnings={openPanel}
                onDraftWidth={draftWidth}
                onWidth={commitWidth}
              />
            );
          })}
          {tracks.filler && (
            <div className="lx-tl__head lx-tl__head--filler" aria-hidden />
          )}
          {arrows && (
            <div className="lx-tl__head lx-tl__head--end" aria-hidden="true" />
          )}

          <div className="lx-tl__hours" aria-hidden="true">
            {HOURS.map(h => (
              <span
                key={h}
                className="lx-tl__hour lx-num"
                style={{'--lx-s': h * 60} as Vars}
              >
                {clock(h * 60)}
              </span>
            ))}
            {now !== null && (
              <span
                className="lx-tl__nowlabel lx-num"
                style={{'--lx-s': now} as Vars}
              >
                {clock(now)}
              </span>
            )}
          </div>

          {columns.map((c, ci) => {
            const key = columnKey(c);
            const collapsed = !!prefs[key]?.collapsed;
            return (
              <div
                className={`lx-tl__col${collapsed ? ' lx-tl__col--collapsed' : ''}`}
                key={key}
                id={colIdOf(key)}
                role="group"
                aria-label={`${c.name}: ${
                  c.tasks.length === 1 ? '1 tarea' : `${c.tasks.length} tareas`
                }${collapsed ? ' (contraído)' : ''}`}
              >
                {c.events.map(e => {
                  const span = spanOnDate(e, date);
                  if (!span) return null;
                  return (
                    <span
                      key={e.id}
                      className={`lx-tl__band lx-tl__band--${e.status}`}
                      style={bandVars(span) as Vars}
                      aria-hidden="true"
                    />
                  );
                })}
                {now !== null && (
                  <span
                    className="lx-tl__now"
                    style={{'--lx-s': now} as Vars}
                    aria-hidden="true"
                  />
                )}
                {dragBlock?.ci === ci && (
                  <DragMarks
                    block={dragBlock.block}
                    drag={drag!}
                    hours={dragHours}
                  />
                )}
                {layouts[ci].map(block => {
                  const id = block.task.id;
                  return (
                    <TaskBlock
                      key={id}
                      block={block}
                      warnings={byTask.get(id) ?? []}
                      marker={collapsed}
                      onOpen={onOpenTask}
                      handlers={canWrite ? bind(block) : undefined}
                      drag={drag?.taskId === id ? drag : null}
                      relation={relationOf(activeTask, block.task, dependants)}
                      depText={dependencyText(
                        block.task,
                        tasksById,
                        dependants,
                        date,
                      )}
                      onHover={setHovered}
                      onFocusChange={setFocused}
                      hintId={canWrite ? 'lx-tl-move-hint' : undefined}
                    />
                  );
                })}
              </div>
            );
          })}
          {tracks.filler && (
            <div className="lx-tl__col lx-tl__col--filler" aria-hidden="true" />
          )}
          {arrows && (
            <div className="lx-tl__col lx-tl__col--end" aria-hidden="true" />
          )}
          <DependencyLinks
            active={activeTask}
            dependants={dependants}
            tasksById={tasksById}
            date={date}
            gridRef={gridRef}
            scrollerRef={scrollerRef}
            chipsHost={rootRef.current}
            stamp={`${drag?.minutes ?? 0}|${hour}|${allTracks.join(' ')}`}
          />
        </div>
      </div>
      {canWrite && (
        <p className="lx-visually-hidden" id="lx-tl-move-hint">
          Para cambiar la hora, mantén pulsada la tarea y arrástrala, o usa Alt
          y las flechas arriba y abajo.
        </p>
      )}
      <p className="lx-visually-hidden" aria-live="polite" id="lx-tl-live">
        {announce}
      </p>
      {flow.element}
      {arrows && (
        // Outside the scroller, over the header row: they never move with
        // the venues, and focusing them never scrolls anything.
        <>
          <div className="lx-tl__arrow lx-tl__arrow--prev">
            <IconButton
              icon="chevronLeft"
              variant="secondary"
              label="Ver el lugar anterior"
              id="lx-tl-prev"
              aria-controls="lx-tl-scroller"
              disabled={view.atStart}
              onClick={() => stepColumns(-1)}
            />
          </div>
          <div className="lx-tl__arrow lx-tl__arrow--next">
            <IconButton
              icon="chevronRight"
              variant="secondary"
              label="Ver el lugar siguiente"
              id="lx-tl-next"
              aria-controls="lx-tl-scroller"
              disabled={view.atEnd}
              onClick={() => stepColumns(1)}
            />
          </div>
        </>
      )}
      {openWarnings && panelWarnings.length > 0 && (
        <VenueWarnings
          name={columns[panelIndex].name}
          warnings={panelWarnings}
          accepted={panelAccepted}
          anchor={openWarnings.anchor}
          tasksById={tasksById}
          onOpenTask={onOpenTask}
          onMove={request => flow.open(request)}
          onClose={closePanel}
        />
      )}
    </div>
  );
};

/** What a screen reader hears while a block moves. */
function dragAnnouncement(
  drag: DragView | null,
  task: Task | undefined,
): string {
  if (!drag || !task || drag.pending) return '';
  const moved = shiftedWindow(task, drag.minutes);
  if (!drag.minutes || !moved) {
    return `«${task.title}» levantada: muévela arriba o abajo para cambiar la hora.`;
  }
  const slot = slotText(moved.startsAt, moved.endsAt, taskZone(task));
  const tail = drag.refused
    ? `${drag.refused}`
    : drag.keyboard
      ? 'Intro para revisar el cambio; Escape para cancelar.'
      : 'Suelta para revisar el cambio.';
  return `«${task.title}»: ${slot}, ${shiftText(drag.minutes)}. ${tail}`;
}

/**
 * While a block moves: its planned place as a dashed outline, a pill with
 * the new time over the lifted block, and the venue's closed hours shaded.
 */
const DragMarks: React.FC<{
  block: TimelineBlockLayout;
  drag: DragView;
  hours: {name: string; openingHours: OpeningHours | null} | undefined;
}> = ({block, drag, hours}) => {
  const {task, span} = block;
  const moved = shiftedWindow(task, drag.minutes);
  const tz = taskZone(task);
  const bands = closedBands(hours?.openingHours);
  const at = span.start + drag.minutes;
  return (
    <>
      {bands.map(b => (
        <span
          key={b.start}
          className={`lx-tl__closed lx-tl__closed--${b.start === 0 ? 'before' : 'after'}${drag.refused ? ' is-hit' : ''}`}
          style={bandVars({...span, start: b.start, end: b.end}) as Vars}
          aria-hidden="true"
        >
          <span className="lx-tl__closed-label">
            {b.start === 0
              ? `Cerrado · abre ${hours!.openingHours!.opensAt}`
              : `Cerrado · desde ${hours!.openingHours!.closesAt}`}
          </span>
        </span>
      ))}
      {drag.minutes !== 0 && (
        <span
          className="lx-tl__origin"
          style={blockVars(block) as Vars}
          aria-hidden="true"
        />
      )}
      <span
        className={`lx-tl__dragtime lx-num${drag.refused ? ' is-refused' : ''}`}
        style={{...(blockVars(block) as Vars), '--lx-s': at} as Vars}
        aria-hidden="true"
      >
        {drag.refused ? (
          <>
            <Icon name="alert" size={13} />
            Fuera de horario
            {hours?.openingHours
              ? ` · ${hours.openingHours.opensAt}–${hours.openingHours.closesAt}`
              : ''}
          </>
        ) : (
          <>
            {moved ? slotText(moved.startsAt, moved.endsAt, tz) : ''}
            {drag.minutes !== 0 && (
              <span className="lx-tl__dragshift">
                {drag.minutes > 0 ? '+' : '−'}
                {durationText(drag.minutes)}
              </span>
            )}
          </>
        )}
      </span>
    </>
  );
};

/**
 * One task on the timeline. Its start time always shows: short blocks switch
 * to one line «08:00 Title», narrow ones drop the end time (container
 * queries in calendar.css). In a collapsed column it is a slim marker that
 * still opens the task, named in full for screen readers and the tooltip.
 */
const TaskBlock: React.FC<{
  block: TimelineBlockLayout;
  warnings: PlanWarning[];
  marker: boolean;
  onOpen: (task: Task) => void;
  /** Members: long press, mouse hold and Alt + arrows move it. */
  handlers?: BlockHandlers;
  drag: DragView | null;
  /** Relation to the block being looked at (dependencies). */
  relation: Relation;
  /** «Espera a: …» when it waits for a task or a task waits for it. */
  depText: string;
  onHover: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
  hintId?: string;
}> = ({
  block,
  warnings,
  marker,
  onOpen,
  handlers,
  drag,
  relation,
  depText,
  onHover,
  onFocusChange,
  hintId,
}) => {
  const {task, span} = block;
  const conflict = warnings.some(w => w.severity === 'conflict');
  const linked = !!depText;
  const label = [taskLabel(task, warnings), depText].filter(Boolean).join('. ');
  const time = blockTimeParts(windowText(task), span);
  const vars: Vars = {...(blockVars(block) as Vars)};
  if (drag) vars['--lx-drag'] = drag.minutes;
  return (
    <button
      type="button"
      data-task-id={task.id}
      className={[
        'lx-tl__block',
        `lx-tl__block--${task.status}`,
        marker ? 'is-marker' : '',
        conflict ? 'has-conflict' : '',
        span.openEnd ? 'is-open-end' : '',
        span.continuesBefore ? 'is-cont-before' : '',
        span.continuesAfter ? 'is-cont-after' : '',
        handlers ? 'is-movable' : '',
        drag ? (drag.pending ? 'is-pending' : 'is-lifted') : '',
        drag?.refused ? 'is-refused' : '',
        relation ? `is-${relation}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={vars}
      aria-label={label}
      aria-describedby={hintId}
      title={marker ? label : undefined}
      onClick={() => onOpen(task)}
      onPointerEnter={e => {
        if (e.pointerType === 'mouse') onHover(task.id);
      }}
      onPointerLeave={e => {
        if (e.pointerType === 'mouse') onHover(null);
      }}
      onFocus={() => onFocusChange(task.id)}
      onBlur={() => {
        onFocusChange(null);
        handlers?.onBlur();
      }}
      onPointerDown={handlers?.onPointerDown}
      onKeyDown={handlers?.onKeyDown}
      onClickCapture={handlers?.onClickCapture}
      onContextMenu={handlers?.onContextMenu}
    >
      <span className="lx-tl__block-body">
        <span className="lx-tl__block-title">
          <Icon name={TASK_KIND_ICON[task.kind]} size={15} />
          <span>{task.title}</span>
        </span>
        <span className="lx-tl__block-time lx-num">
          {linked && (
            <span className="lx-tl__block-link" title="Tiene dependencias">
              <Icon name="link" size={12} />
            </span>
          )}
          <span className="lx-tl__block-start">{time.lead}</span>
          <span className="lx-tl__block-end">{time.tail}</span>
        </span>
        {task.company && (
          <span className="lx-tl__block-company">{task.company.name}</span>
        )}
      </span>
      {warnings.length > 0 && (
        <span className="lx-tl__block-warn" aria-hidden="true">
          <Icon name={conflict ? 'alert' : 'bell'} size={14} />
        </span>
      )}
    </button>
  );
};
