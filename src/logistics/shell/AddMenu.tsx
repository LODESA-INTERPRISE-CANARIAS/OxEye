/**
 * «+ Añadir» with a choice of what to add, in groups (quick capture on site
 * first: Incidencia, Nota, Recurso, Persona; then planning, as smaller
 * tiles: Tarea, Evento, Empresa o entidad, Oferta). Opens on click or
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
  /** Heading of the group it belongs to (consecutive options share one). */
  group?: string;
  /** A smaller tile without the description (shown as a tooltip). */
  compact?: boolean;
}

interface OptionGroup {
  label: string | null;
  compact: boolean;
  options: AddOption[];
}

/** Consecutive options with the same `group`, in order. */
function groupOptions(options: AddOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  for (const o of options) {
    const last = groups[groups.length - 1];
    const label = o.group ?? null;
    if (last && last.label === label) {
      last.options.push(o);
      last.compact &&= !!o.compact;
    } else {
      groups.push({label, compact: !!o.compact, options: [o]});
    }
  }
  return groups;
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
  const vh = window.innerHeight;
  const width = Math.min(320, vw - 24);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(12, Math.min(vw - width - 12, r.right - width))}px`;
  if (placement === 'above') {
    menu.style.top = '';
    menu.style.bottom = `${vh - r.top + 8}px`;
    menu.style.maxHeight = `${Math.max(200, r.top - 20)}px`;
  } else {
    menu.style.bottom = '';
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.maxHeight = `${Math.max(200, vh - r.bottom - 20)}px`;
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
        {groupOptions(options).map((g, gi) => {
          const labelId = `${menuId}-g${gi}`;
          const items = g.options.map(o => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              id={`${id}-${o.id}`}
              className={`lx-addmenu__item${o.compact ? ' lx-addmenu__item--compact' : ''}`}
              title={o.compact ? o.description : undefined}
              onClick={() => choose(o)}
            >
              <span className="lx-addmenu__icon" aria-hidden="true">
                <Icon name={o.icon} size={o.compact ? 19 : 22} />
              </span>
              <span className="lx-addmenu__text">
                <strong>{o.label}</strong>
                <span className={o.compact ? 'lx-visually-hidden' : undefined}>
                  {o.description}
                </span>
              </span>
            </button>
          ));
          return (
            <div
              key={labelId}
              role="group"
              aria-labelledby={g.label ? labelId : undefined}
              aria-label={g.label ? undefined : 'Añadir'}
              className={`lx-addmenu__group${g.compact ? ' lx-addmenu__group--compact' : ''}`}
            >
              <p className="lx-addmenu__title" id={labelId}>
                {g.label ?? 'Añadir'}
              </p>
              <div className="lx-addmenu__items">{items}</div>
            </div>
          );
        })}
      </div>
    </>
  );
};
