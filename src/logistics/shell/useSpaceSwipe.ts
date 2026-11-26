/**
 * Horizontal swipe between spaces on phones, with pointer events only.
 *
 * - Only touch/pen pointers, only below the desktop breakpoint.
 * - Ignores gestures that start in form controls, open sheets, elements
 *   marked `data-no-swipe` or anything that scrolls horizontally.
 * - The page follows the finger (with resistance at the ends) and snaps back
 *   when the gesture is too short or turns vertical.
 */
import {useEffect, type RefObject} from 'react';

const PHONE_QUERY = '(max-width: 899px)';
const LOCK_DISTANCE = 12;
const COMMIT_DISTANCE = 70;
const COMMIT_VELOCITY = 0.45; // px per ms

function startsInExcludedArea(target: EventTarget | null, root: HTMLElement) {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (
      el.matches(
        'input, textarea, select, [contenteditable="true"], dialog, [data-no-swipe]',
      )
    ) {
      return true;
    }
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function useSpaceSwipe(
  ref: RefObject<HTMLElement | null>,
  options: {
    canGo: (step: 1 | -1) => boolean;
    onSwipe: (step: 1 | -1) => void;
    enabled?: boolean;
  },
): void {
  const {canGo, onSwipe, enabled = true} = options;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let mode: 'pending' | 'horizontal' | 'vertical' = 'pending';
    let dx = 0;

    const reset = (animate: boolean) => {
      if (animate && !reduceMotion) {
        el.style.transition = 'transform 180ms ease-out';
      }
      el.style.transform = '';
      el.classList.remove('lx-swiping');
      pointerId = null;
      mode = 'pending';
      dx = 0;
      window.setTimeout(() => {
        el.style.transition = '';
      }, 200);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (!window.matchMedia?.(PHONE_QUERY).matches) return;
      if (pointerId !== null) return;
      if (startsInExcludedArea(e.target, el)) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      mode = 'pending';
      dx = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (mode === 'pending') {
        if (Math.abs(mx) < LOCK_DISTANCE && Math.abs(my) < LOCK_DISTANCE) {
          return;
        }
        mode = Math.abs(mx) > Math.abs(my) * 1.4 ? 'horizontal' : 'vertical';
        if (mode === 'horizontal') el.classList.add('lx-swiping');
      }
      if (mode !== 'horizontal') return;
      const step: 1 | -1 = mx < 0 ? 1 : -1;
      // Resist at the first and last space.
      dx = canGo(step) ? mx : mx * 0.25;
      if (!reduceMotion) el.style.transform = `translateX(${dx * 0.6}px)`;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (mode === 'horizontal') {
        const elapsed = Math.max(1, performance.now() - startT);
        const velocity = Math.abs(dx) / elapsed;
        const step: 1 | -1 = dx < 0 ? 1 : -1;
        const committed =
          canGo(step) &&
          (Math.abs(dx) > COMMIT_DISTANCE || velocity > COMMIT_VELOCITY);
        if (committed) {
          el.style.transform = '';
          el.classList.remove('lx-swiping');
          pointerId = null;
          mode = 'pending';
          dx = 0;
          onSwipe(step);
          return;
        }
      }
      reset(true);
    };

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === pointerId) reset(true);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.style.transform = '';
    };
  }, [ref, canGo, onSwipe, enabled]);
}
