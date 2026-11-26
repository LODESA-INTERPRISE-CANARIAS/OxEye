/**
 * «+ Añadir» with a choice of what to add (Evento, Tarea, Persona, Empresa o
 * entidad, Oferta). Opens on click or
 * Enter, closes on Escape or a tap elsewhere, sits above everything. Arrow
 * keys move between options; focus goes back to the button before a sheet
 * opens, so closing the sheet returns there.
 *
 * Uses the native Popover API (top layer, light dismiss) where it exists.
 * Pilot users bring their own phones, and iOS Safari 16 or older Samsung
 * Internet ignore `popover`: there the same menu (same ids and roles) is a
 * controlled React menu with its own outside-tap and Escape handling.
 */
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {Button, Icon, type IconName} from '../ui';

export interface AddOption {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  onSelect: () => void;
}

type Placement = 'below' | 'above';

/** Whether this browser implements the Popover API. */
function supportsPopover(): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.showPopover === 'function'
  );
}

/** Places the menu next to the button, inside the viewport. */
function placeMenu(
  menu: HTMLElement,
  button: HTMLElement,
  placement: Placement,
): void {
  const r = button.getBoundingClientRect();
  const vw = window.innerWidth;
  const width = Math.min(300, vw - 24);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(12, Math.min(vw - width - 12, r.right - width))}px`;
  if (placement === 'above') {
    menu.style.top = '';
    menu.style.bottom = `${window.innerHeight - r.top + 8}px`;
  } else {
    menu.style.bottom = '';
    menu.style.top = `${r.bottom + 8}px`;
  }
}

const firstItem = (menu: HTMLElement | null) =>
  menu?.querySelector<HTMLButtonElement>('[role="menuitem"]') ?? null;

export const AddMenu: React.FC<{
  id: string;
  options: AddOption[];
  /** Where the menu opens relative to the button. */
  placement?: Placement;
  className?: string;
  size?: 'md' | 'lg';
}> = ({id, options, placement = 'below', className, size = 'md'}) => {
  const menuId = `${id}-menu-${useId().replace(/:/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [native] = useState(supportsPopover);
  // Only used without the Popover API.
  const [open, setOpen] = useState(false);

  // Native popover: follow its own open state.
  useEffect(() => {
    if (!native) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      button.setAttribute('aria-expanded', String(isOpen));
      if (!isOpen) return;
      placeMenu(menu, button, placement);
      firstItem(menu)?.focus();
    };
    menu.addEventListener('toggle', onToggle);
    return () => menu.removeEventListener('toggle', onToggle);
  }, [native, placement]);

  // Fallback: place, focus, and dismiss on a tap elsewhere, Escape or resize.
  useLayoutEffect(() => {
    if (native || !open) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    placeMenu(menu, button, placement);
    firstItem(menu)?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The button toggles by itself.
      if (menu.contains(target) || button.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      button.focus();
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [native, open, placement]);

  const hide = () => {
    if (native) menuRef.current?.hidePopover?.();
    else setOpen(false);
  };

  const choose = (option: AddOption) => {
    hide();
    buttonRef.current?.focus();
    option.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? []),
    ];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      // Handled here; the fallback's document listener need not repeat it.
      e.nativeEvent.stopImmediatePropagation();
      hide();
      buttonRef.current?.focus();
      return;
    } else if (e.key === 'Tab') {
      hide();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        variant="primary"
        size={size}
        icon="plus"
        id={id}
        className={className}
        popoverTarget={native ? menuId : undefined}
        onClick={native ? undefined : () => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={native ? false : open}
        aria-controls={menuId}
      >
        Añadir
      </Button>
      <div
        ref={menuRef}
        id={menuId}
        popover={native ? 'auto' : undefined}
        hidden={native ? undefined : !open}
        role="menu"
        aria-label="Qué quieres añadir"
        className={`lx-addmenu${native ? '' : ' lx-addmenu--fallback'}`}
        onKeyDown={onKeyDown}
      >
        <p className="lx-addmenu__title" aria-hidden="true">
          Añadir
        </p>
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            role="menuitem"
            id={`${id}-${o.id}`}
            className="lx-addmenu__item"
            onClick={() => choose(o)}
          >
            <span className="lx-addmenu__icon" aria-hidden="true">
              <Icon name={o.icon} size={22} />
            </span>
            <span className="lx-addmenu__text">
              <strong>{o.label}</strong>
              <span>{o.description}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
};
