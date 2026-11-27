/**
 * Dependencies on the timeline (Revisión 1 · E2), kept light: nothing shows
 * until a block is hovered, focused or lifted. Then what it waits for and
 * what waits for it get an outline, a thin line joins the blocks that are on
 * screen, and the ones that are not (another day, off screen, without time)
 * appear as chips: «Espera a: Entrega del generador · 08:00».
 */
import React, {useEffect, useLayoutEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import type {LocalDate, Task} from '../../../shared/logistics/contracts.ts';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import {dayMonthShort} from '../lib/format';
import {taskZone} from '../lib/tasks';
import {Icon} from '../ui';

export type Relation = 'pred' | 'succ' | 'active' | null;

/** Task id → live tasks that wait for it. */
export function dependantsOf(
  tasksById: ReadonlyMap<string, Task>,
): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const t of tasksById.values()) {
    if (t.status === 'cancelled') continue;
    for (const id of t.dependsOn) {
      const list = out.get(id);
      if (list) list.push(t);
      else out.set(id, [t]);
    }
  }
  return out;
}

/** How `task` relates to the block being looked at. */
export function relationOf(
  active: Task | undefined,
  task: Task,
  dependants: ReadonlyMap<string, Task[]>,
): Relation {
  if (!active) return null;
  if (active.id === task.id) {
    return active.dependsOn.length || dependants.get(active.id)?.length
      ? 'active'
      : null;
  }
  if (active.dependsOn.includes(task.id)) return 'pred';
  if (active.id && task.dependsOn.includes(active.id)) return 'succ';
  return null;
}

/** «08:00», or «2 dic 08:00» on another day; «sin hora». */
export function whenText(task: Task, date: LocalDate): string {
  if (!task.startsAt) return 'sin hora';
  const local = utcToLocal(task.startsAt, taskZone(task));
  return local.date === date
    ? local.time
    : `${dayMonthShort(local.date)} ${local.time}`;
}

/** For the block's accessible name: «Espera a: A (08:00). La esperan: B.» */
export function dependencyText(
  task: Task,
  tasksById: ReadonlyMap<string, Task>,
  dependants: ReadonlyMap<string, Task[]>,
  date: LocalDate,
): string {
  const before = task.dependsOn
    .map(id => tasksById.get(id))
    .filter((t): t is Task => !!t);
  const after = dependants.get(task.id) ?? [];
  const list = (ts: Task[]) =>
    ts.map(t => `${t.title} (${whenText(t, date)})`).join(', ');
  return [
    before.length ? `Espera a: ${list(before)}.` : '',
    after.length
      ? `${after.length === 1 ? 'La espera' : 'La esperan'}: ${list(after)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface Line {
  id: string;
  d: string;
  x: number;
  y: number;
}

interface Chip {
  id: string;
  kind: 'pred' | 'succ';
  text: string;
}

export const DependencyLinks: React.FC<{
  active: Task | undefined;
  dependants: ReadonlyMap<string, Task[]>;
  tasksById: ReadonlyMap<string, Task>;
  date: LocalDate;
  gridRef: React.RefObject<HTMLDivElement | null>;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Where the chips go: over the plan, outside what scrolls. */
  chipsHost: HTMLElement | null;
  /** Anything that moves blocks (drag, scale, widths): re-measure. */
  stamp: string;
}> = ({
  active,
  dependants,
  tasksById,
  date,
  gridRef,
  scrollerRef,
  chipsHost,
  stamp,
}) => {
  const [lines, setLines] = useState<Line[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  // What is on screen changes with the scroll: look again (once a frame).
  const [tick, setTick] = useState(0);
  const watching = !!active;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !watching) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setTick(t => t + 1);
      });
    };
    el.addEventListener('scroll', onScroll, {passive: true});
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [scrollerRef, watching]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const scroller = scrollerRef.current;
    const preds = active
      ? active.dependsOn
          .map(id => tasksById.get(id))
          .filter((t): t is Task => !!t)
      : [];
    const succs = active ? (dependants.get(active.id) ?? []) : [];
    if (!grid || !scroller || !active || (!preds.length && !succs.length)) {
      setLines(l => (l.length ? [] : l));
      setChips(c => (c.length ? [] : c));
      return;
    }
    const find = (id: string) =>
      grid.querySelector<HTMLElement>(
        `.lx-tl__block[data-task-id="${CSS.escape(id)}"]`,
      );
    const g = grid.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const head =
      scroller.querySelector<HTMLElement>('.lx-tl__corner')?.offsetHeight ?? 0;
    const gutter =
      scroller.querySelector<HTMLElement>('.lx-tl__corner')?.offsetWidth ?? 0;
    const visible = (r: DOMRect) =>
      r.bottom > view.top + head &&
      r.top < view.bottom &&
      r.right > view.left + gutter &&
      r.left < view.right;
    const me = find(active.id)?.getBoundingClientRect();
    const nextLines: Line[] = [];
    const nextChips: Chip[] = [];
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const bend = Math.max(24, Math.abs(y2 - y1) / 2);
      return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
    };
    const place = (t: Task, kind: 'pred' | 'succ') => {
      const r = find(t.id)?.getBoundingClientRect();
      if (me && r && visible(r) && visible(me)) {
        // From the end of the one waited for to the start of the one waiting.
        const [from, to] = kind === 'pred' ? [r, me] : [me, r];
        const x1 = from.left + from.width / 2 - g.left;
        const y1 = from.bottom - g.top;
        const x2 = to.left + to.width / 2 - g.left;
        const y2 = to.top - g.top;
        nextLines.push({
          id: `${kind}-${t.id}`,
          d: curve(x1, y1, x2, y2),
          x: x2,
          y: y2,
        });
      } else {
        nextChips.push({
          id: `${kind}-${t.id}`,
          kind,
          text: `${t.title} · ${whenText(t, date)}`,
        });
      }
    };
    preds.forEach(t => place(t, 'pred'));
    succs.forEach(t => place(t, 'succ'));
    const same = <T,>(a: T[], b: T[]) =>
      JSON.stringify(a) === JSON.stringify(b);
    setLines(l => (same(l, nextLines) ? l : nextLines));
    setChips(c => (same(c, nextChips) ? c : nextChips));
  }, [active, dependants, tasksById, date, gridRef, scrollerRef, stamp, tick]);

  return (
    <>
      {lines.length > 0 && (
        <svg className="lx-tl__links" aria-hidden="true" focusable="false">
          {lines.map(l => (
            <g key={l.id}>
              <path d={l.d} />
              <circle cx={l.x} cy={l.y} r={3.5} />
            </g>
          ))}
        </svg>
      )}
      {chips.length > 0 &&
        chipsHost &&
        createPortal(
          // The block's accessible name already says this.
          <div className="lx-tl__deps" aria-hidden="true" id="lx-tl-deps">
            {chips.map(c => (
              <span key={c.id} className={`lx-tl__dep lx-tl__dep--${c.kind}`}>
                <Icon name="link" size={13} />
                <span className="lx-tl__dep-kind">
                  {c.kind === 'pred' ? 'Espera a:' : 'La espera:'}
                </span>
                <span className="lx-tl__dep-text">{c.text}</span>
              </span>
            ))}
          </div>,
          chipsHost,
        )}
    </>
  );
};
