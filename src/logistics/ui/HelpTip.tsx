/**
 * Plain-language `?` explanation. Built on the native Popover API, so it
 * opens on tap or Enter, closes on Escape or a tap elsewhere, and sits in the
 * top layer above sheets.
 */
import React, {useEffect, useId, useRef} from 'react';

export interface HelpTipProps {
  /** What is being explained, for the button's accessible name. */
  label: string;
  children: React.ReactNode;
}

export const HelpTip: React.FC<HelpTipProps> = ({label, children}) => {
  const id = `lx-help-${useId().replace(/:/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const pop = popRef.current;
    const button = buttonRef.current;
    if (!pop || !button) return;
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const r = button.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(300, vw - 24);
      pop.style.width = `${width}px`;
      const left = Math.max(
        12,
        Math.min(vw - width - 12, r.left + r.width / 2 - width / 2),
      );
      pop.style.left = `${left}px`;
      pop.style.top = `${r.bottom + 8}px`;
      const h = pop.getBoundingClientRect().height;
      if (r.bottom + 8 + h > vh - 12) {
        pop.style.top = `${Math.max(12, r.top - h - 8)}px`;
      }
    };
    pop.addEventListener('toggle', place);
    return () => pop.removeEventListener('toggle', place);
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="lx-help"
        popoverTarget={id}
        aria-label={`¿Qué significa ${label}?`}
        onClick={e => e.stopPropagation()}
      >
        ?
      </button>
      <span
        ref={popRef}
        id={id}
        popover="auto"
        className="lx-help__pop"
        role="note"
      >
        {children}
      </span>
    </>
  );
};
