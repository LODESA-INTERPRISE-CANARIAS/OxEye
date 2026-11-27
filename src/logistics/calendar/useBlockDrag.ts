/**
 * Moving a block on the timeline (Revisión 1 · E2).
 *
 * Touch and mouse: hold a block for half a second and it lifts (a short
 * vibration where the device has one); drag it up or down to change its time
 * in 5-minute steps, with the plan scrolling near the top and bottom edges.
 * Moving the finger before it lifts is a normal scroll, and a quick tap still
 * opens the task. Releasing opens the move preview; nothing changes before
 * it is confirmed there.
 *
 * Keyboard: on a focused block, Alt+↑ / Alt+↓ move it by 5 minutes (with
 * Shift, 30); Enter opens the preview, Escape or leaving the block cancels.
 *
 * A task that cannot move (done, cancelled, under way, without times) says
 * why instead of lifting. A time outside the venue's known opening hours is
 * shown as refused and never reaches the preview.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {OpeningHours, Task} from '../../../shared/logistics/contracts.ts';
import {MOVE_BLOCKED, moveBlocker} from '../../../shared/logistics/move.ts';
import type {TimelineBlock} from '../lib/calendar';
import {
  CROSSES_DAY_MESSAGE,
  clampDrag,
  dragLimit,
  dragMinutes,
  dragRefusal,
  edgeSpeed,
} from '../moves/drag';

export const LIFT_MS = 500;
/** Movement that turns a press into a scroll before the block lifts. */
const SLOP_PX = 8;

export interface DragView {
  taskId: string;
  /** Signed minutes from the planned start (whole steps). */
  minutes: number;
  /** Why this time is refused (outside opening hours), or null. */
  refused: string | null;
  /** Why the block does not follow (it runs past midnight), or null. */
  limit: string | null;
  keyboard: boolean;
  /** Released: the preview is open and the block waits at its new time. */
  pending: boolean;
}

interface Press {
  pointerId: number;
  x: number;
  y: number;
  clientY: number;
  top: number;
  block: TimelineBlock;
  el: HTMLElement;
  timer: number;
  lifted: boolean;
}

export interface BlockDragOptions {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  hourRef: React.RefObject<number>;
  enabled: boolean;
  timeZone: string;
  /** The venue's name and opening hours (for the refusal). */
  placeOf: (
    task: Task,
  ) => {name: string; openingHours: OpeningHours | null} | undefined;
  /** A released move: open the preview. */
  onRelease: (task: Task, minutes: number) => void;
  /** A short explanation (cannot move, refused time). */
  onExplain: (message: string) => void;
}

export interface BlockHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onBlur: () => void;
}

export function useBlockDrag(opts: BlockDragOptions) {
  const [drag, setDrag] = useState<DragView | null>(null);
  const dragRef = useRef(drag);
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    dragRef.current = drag;
    optsRef.current = opts;
  });
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const edgeFrame = useRef(0);
  const detach = useRef<(() => void) | null>(null);

  const evaluate = useCallback(
    (block: TimelineBlock, minutes: number, keyboard: boolean): DragView => {
      const m = clampDrag(block.span, minutes);
      const {placeOf, timeZone} = optsRef.current;
      return {
        taskId: block.task.id,
        minutes: m,
        refused: dragRefusal(block.task, m, placeOf(block.task), timeZone),
        limit: m ? null : dragLimit(block.span, minutes),
        keyboard,
        pending: false,
      };
    },
    [],
  );

  const show = useCallback((next: DragView | null) => {
    const cur = dragRef.current;
    if (
      cur === next ||
      (cur &&
        next &&
        cur.taskId === next.taskId &&
        cur.minutes === next.minutes &&
        cur.refused === next.refused &&
        cur.limit === next.limit &&
        cur.keyboard === next.keyboard &&
        cur.pending === next.pending)
    ) {
      return;
    }
    dragRef.current = next;
    setDrag(next);
  }, []);

  const endPress = useCallback(() => {
    const p = press.current;
    press.current = null;
    if (p) {
      window.clearTimeout(p.timer);
      try {
        if (p.el.hasPointerCapture?.(p.pointerId)) {
          p.el.releasePointerCapture(p.pointerId);
        }
      } catch {
        // Capture is gone already.
      }
    }
    window.cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = 0;
    detach.current?.();
    detach.current = null;
  }, []);

  const update = useCallback(() => {
    const p = press.current;
    const el = optsRef.current.scrollerRef.current;
    if (!p?.lifted || !el) return;
    const dy = p.clientY - p.y + (el.scrollTop - p.top);
    show(
      evaluate(
        p.block,
        dragMinutes(dy, optsRef.current.hourRef.current),
        false,
      ),
    );
  }, [evaluate, show]);

  // Near the top (under the sticky header) or the bottom, keep scrolling.
  const edgeScroll = useCallback(() => {
    const p = press.current;
    const el = optsRef.current.scrollerRef.current;
    if (!p?.lifted || !el) return;
    const box = el.getBoundingClientRect();
    const head =
      el.querySelector<HTMLElement>('.lx-tl__corner')?.offsetHeight ?? 0;
    const speed = edgeSpeed(p.clientY, box.top + head, box.bottom);
    if (!speed) {
      edgeFrame.current = 0;
      return;
    }
    el.scrollTop += speed;
    update();
    edgeFrame.current = window.requestAnimationFrame(edgeScroll);
  }, [update]);

  const lift = useCallback(() => {
    const p = press.current;
    if (!p) return;
    suppressClick.current = true;
    const blocker = moveBlocker(p.block.task);
    if (blocker) {
      endPress();
      optsRef.current.onExplain(MOVE_BLOCKED[blocker]);
      return;
    }
    // A middle day of a task running over several days cannot move at all.
    if (p.block.span.continuesBefore && p.block.span.continuesAfter) {
      endPress();
      optsRef.current.onExplain(CROSSES_DAY_MESSAGE);
      return;
    }
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      // The pointer is gone; the move ends with it.
    }
    navigator.vibrate?.(10);
    p.lifted = true;
    show(evaluate(p.block, 0, false));
  }, [endPress, evaluate, show]);

  const release = useCallback(
    (cancelled: boolean) => {
      const p = press.current;
      const lifted = !!p?.lifted;
      endPress();
      if (!lifted || !p) return;
      const d = dragRef.current;
      if (cancelled || !d || !d.minutes) {
        // Held still is nothing; pulled against midnight says why.
        if (!cancelled && d?.limit) optsRef.current.onExplain(d.limit);
        show(null);
        return;
      }
      if (d.refused) {
        optsRef.current.onExplain(`${d.refused} Elige otra hora.`);
        show(null);
        return;
      }
      show({...d, pending: true});
      optsRef.current.onRelease(p.block.task, d.minutes);
    },
    [endPress, show],
  );

  const bind = useCallback(
    (block: TimelineBlock): BlockHandlers => ({
      onPointerDown: e => {
        suppressClick.current = false;
        if (!optsRef.current.enabled || dragRef.current?.pending) return;
        // A second finger is a pinch, not a move.
        if (press.current) {
          release(true);
          return;
        }
        if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
        // Keyboard drag on another block ends when the pointer comes in.
        if (dragRef.current?.keyboard) show(null);
        const el = e.currentTarget;
        const scroller = optsRef.current.scrollerRef.current;
        press.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          clientY: e.clientY,
          top: scroller?.scrollTop ?? 0,
          block,
          el,
          lifted: false,
          timer: window.setTimeout(lift, LIFT_MS),
        };
        const onMove = (ev: PointerEvent) => {
          const p = press.current;
          if (!p || ev.pointerId !== p.pointerId) return;
          if (!p.lifted) {
            if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > SLOP_PX) {
              endPress();
            }
            return;
          }
          ev.preventDefault();
          p.clientY = ev.clientY;
          update();
          if (!edgeFrame.current) {
            edgeFrame.current = window.requestAnimationFrame(edgeScroll);
          }
        };
        const onUp = (ev: PointerEvent) => {
          if (ev.pointerId === press.current?.pointerId) release(false);
        };
        const onCancel = (ev: PointerEvent) => {
          if (ev.pointerId === press.current?.pointerId) release(true);
        };
        window.addEventListener('pointermove', onMove, {passive: false});
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        detach.current = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
        };
      },
      onKeyDown: e => {
        const d = dragRef.current;
        const mine = d?.taskId === block.task.id && d.keyboard && !d.pending;
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          if (!optsRef.current.enabled || d?.pending) return;
          const blocker = moveBlocker(block.task);
          if (blocker) {
            optsRef.current.onExplain(MOVE_BLOCKED[blocker]);
            return;
          }
          const step = (e.shiftKey ? 30 : 5) * (e.key === 'ArrowUp' ? -1 : 1);
          const next = evaluate(block, (mine ? d.minutes : 0) + step, true);
          // The keyboard says it at once: the block would not move.
          if (next.limit && next.minutes === (mine ? d.minutes : 0)) {
            optsRef.current.onExplain(next.limit);
          }
          show(next);
          return;
        }
        if (!mine) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          show(null);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!d.minutes) {
            show(null);
          } else if (d.refused) {
            optsRef.current.onExplain(`${d.refused} Elige otra hora.`);
          } else {
            show({...d, pending: true});
            optsRef.current.onRelease(block.task, d.minutes);
          }
        }
      },
      onClickCapture: e => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
      onContextMenu: e => {
        // A long press must not open the browser's menu over the plan.
        if (optsRef.current.enabled) e.preventDefault();
      },
      onBlur: () => {
        const d = dragRef.current;
        if (d?.keyboard && !d.pending && d.taskId === block.task.id) show(null);
      },
    }),
    [edgeScroll, endPress, evaluate, lift, release, show, update],
  );

  // While a block is lifted, a finger never scrolls the plan.
  useEffect(() => {
    const el = opts.scrollerRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (press.current?.lifted && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, {passive: false});
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [opts.scrollerRef]);

  useEffect(() => endPress, [endPress]);

  /** The preview closed (confirmed or not): the block goes back to the plan. */
  const settle = useCallback(() => show(null), [show]);
  const cancel = useCallback(() => {
    endPress();
    show(null);
  }, [endPress, show]);

  return {drag, bind, settle, cancel};
}
