/**
 * Floating panel anchored to a field: the pickers of TimeField and DateField
 * and the option lists of SelectField and MultiSelectField.
 *
 * React state is the authority (`open`). Where the Popover API exists the
 * panel is a `popover="manual"` element, so it sits in the top layer above a
 * modal Sheet and is never clipped by the sheet's scrolling body; without it
 * (iOS Safari 16, older Samsung Internet) the same panel is a fixed layer
 * inside the sheet, as `shell/AddMenu.tsx` does. Both paths share the same
 * dismissal: a tap outside the panel and its anchor, or Escape (handled
 * before the Sheet sees it, so Escape closes the list and not the form).
 * The page and the sheet keep scrolling; the panel follows its anchor.
 */
import React, {useLayoutEffect, useRef, useState} from 'react';

export type PopoverCloseReason = 'outside' | 'escape';

export interface PopoverProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children'
> {
  id: string;
  open: boolean;
  onClose: (reason: PopoverCloseReason) => void;
  /** The field the panel hangs from; taps on it do not dismiss. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** `anchor`: as wide as the field (at least 260 px); a number: that width. */
  width?: 'anchor' | number;
  children?: React.ReactNode;
}

function supportsPopover(): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.showPopover === 'function'
  );
}

const MARGIN = 8;
const GAP = 6;

/**
 * Below the anchor when the whole panel fits there, else above when it fits
 * there, else on the roomier side (and the panel scrolls).
 */
function place(
  panel: HTMLElement,
  anchor: HTMLElement,
  width: 'anchor' | number,
): void {
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const wanted = width === 'anchor' ? Math.max(r.width, 260) : width;
  const w = Math.min(wanted, vw - 2 * MARGIN);
  panel.style.width = `${w}px`;
  panel.style.left = `${Math.max(MARGIN, Math.min(vw - w - MARGIN, r.left))}px`;
  panel.style.maxHeight = '';
  const natural = panel.scrollHeight;
  const below = vh - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  if (natural <= below || (natural > above && below >= above)) {
    panel.style.bottom = '';
    panel.style.top = `${r.bottom + GAP}px`;
    panel.style.maxHeight = `${Math.max(160, below)}px`;
  } else {
    panel.style.top = '';
    panel.style.bottom = `${vh - r.top + GAP}px`;
    panel.style.maxHeight = `${Math.max(160, above)}px`;
  }
}

export const Popover: React.FC<PopoverProps> = ({
  id,
  open,
  onClose,
  anchorRef,
  width = 'anchor',
  className,
  children,
  ...rest
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [native] = useState(supportsPopover);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    if (native) {
      const shown = panel.matches(':popover-open');
      if (open && !shown) panel.showPopover();
      else if (!open && shown) panel.hidePopover();
    }
    const anchor = anchorRef.current;
    if (!open || !anchor) return;
    place(panel, anchor, width);

    let frame = 0;
    const follow = (e?: Event) => {
      // Scrolling the list inside the panel does not move the anchor.
      if (e && e.target instanceof Node && panel.contains(e.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (anchor.isConnected) place(panel, anchor, width);
      });
    };
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (panel.contains(target) || anchor.contains(target));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) onCloseRef.current('outside');
    };
    // Tab out of the field and its panel closes the panel too.
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) onCloseRef.current('outside');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !inside(e.target)) return;
      // Before the Sheet: Escape closes the panel, not the form.
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current('escape');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    window.visualViewport?.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('resize', follow);
    };
  }, [open, native, anchorRef, width]);

  // Content changes (search results, another month) can change the height.
  useLayoutEffect(() => {
    const panel = ref.current;
    const anchor = anchorRef.current;
    if (open && panel && anchor) place(panel, anchor, width);
  });

  return (
    <div
      ref={ref}
      id={id}
      popover={native ? 'manual' : undefined}
      hidden={native ? undefined : !open}
      className={['lx-pop', native ? '' : 'lx-pop--fallback', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {open && children}
    </div>
  );
};
