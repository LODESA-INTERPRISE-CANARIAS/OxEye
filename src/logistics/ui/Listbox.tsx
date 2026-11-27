/**
 * The option list shared by SelectField and MultiSelectField, after the
 * WAI-ARIA select-only combobox pattern: DOM focus stays on the field's
 * button (or on the search box, for lists longer than `searchThreshold`)
 * and `aria-activedescendant` points at the active option.
 *
 * Keys: ↓/↑ (open, move), Home/End, Page Up/Down, Enter (choose), Space
 * (choose, or toggle in a multi-select), letters jump to the first option
 * that starts with them (type-ahead; with a search box they start a search),
 * Escape closes without changing, Tab moves on. A tap opens without the
 * on-screen keyboard; the search box is one tap away.
 */
import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {foldText} from './controls';
import {Icon} from './icons';
import {Popover} from './Popover';

export interface SelectOption {
  value: string;
  label: string;
  /** Second line in the list (role, date…), also searched. */
  hint?: string;
  disabled?: boolean;
  /** Group heading; consecutive options with the same group share one. */
  group?: string;
}

/** Lists longer than this get a search box. */
export const SEARCH_THRESHOLD = 8;

interface ListboxConfig {
  /** The field's id (on its button). */
  id: string;
  options: SelectOption[];
  multi: boolean;
  isSelected: (value: string) => boolean;
  /** Single: choose (the list closes); multi: toggle (it stays open). */
  onPick: (option: SelectOption) => void;
  searchThreshold?: number;
  triggerRef: React.RefObject<HTMLElement | null>;
}

type OpenMode = 'keyboard' | 'pointer';

const PAGE = 8;

export function useListbox({
  id,
  options,
  multi,
  isSelected,
  onPick,
  searchThreshold = SEARCH_THRESHOLD,
  triggerRef,
}: ListboxConfig) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({text: '', at: 0});
  const searchable = options.length > searchThreshold;
  const listId = `${id}-listbox`;
  const popupId = `${id}-popup`;

  const indexOf = useMemo(
    () => new Map(options.map((o, i) => [o.value, i])),
    [options],
  );
  const optionId = (value: string) => `${id}-opt-${indexOf.get(value) ?? 0}`;

  const visible = useMemo(() => {
    const q = foldText(query);
    if (!q) return options;
    return options.filter(o =>
      foldText(`${o.label} ${o.hint ?? ''}`).includes(q),
    );
  }, [options, query]);
  const enabled = visible.filter(o => !o.disabled);
  const activeOption =
    enabled.find(o => o.value === active) ?? (open ? enabled[0] : undefined);

  const openList = (mode: OpenMode, start?: string | null, text = '') => {
    const first =
      start ??
      options.find(o => !o.disabled && isSelected(o.value))?.value ??
      options.find(o => !o.disabled)?.value ??
      null;
    setQuery(text);
    setActive(first);
    setOpen(true);
    // A tap does not pop up the phone keyboard; keys go to the search box.
    setFocusSearch(searchable && (mode === 'keyboard' || !!text));
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (open && focusSearch) {
      searchRef.current?.focus();
      setFocusSearch(false);
    }
  }, [open, focusSearch]);

  // Keep the active option in view, inside the list only.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list || !activeOption) return;
    const el = document.getElementById(optionId(activeOption.value));
    if (!el) return;
    const box = list.getBoundingClientRect();
    const item = el.getBoundingClientRect();
    if (item.top < box.top) list.scrollTop -= box.top - item.top + 4;
    else if (item.bottom > box.bottom) {
      list.scrollTop += item.bottom - box.bottom + 4;
    }
  });

  const move = (to: 'next' | 'prev' | 'first' | 'last' | number) => {
    if (!enabled.length) return;
    const i = activeOption ? enabled.indexOf(activeOption) : -1;
    const n =
      to === 'first'
        ? 0
        : to === 'last'
          ? enabled.length - 1
          : to === 'next'
            ? i + 1
            : to === 'prev'
              ? i - 1
              : i + to;
    setActive(enabled[Math.max(0, Math.min(enabled.length - 1, n))].value);
  };

  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    setActive(option.value);
    onPick(option);
    if (!multi) close(true);
  };

  /** Type-ahead: the next option starting with what was typed. */
  const typeAhead = (key: string): string | null => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const q = foldText(t.text);
    const same = q.length > 1 && [...q].every(c => c === q[0]);
    const from = activeOption ? enabled.indexOf(activeOption) : -1;
    const ordered = [...enabled.slice(from + 1), ...enabled.slice(0, from + 1)];
    const hit =
      ordered.find(o => foldText(o.label).startsWith(q)) ??
      (same ? ordered.find(o => foldText(o.label).startsWith(q[0])) : null);
    return hit?.value ?? null;
  };

  const printable = (e: React.KeyboardEvent) =>
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  /** Keys on the field's button. */
  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    const typing = Date.now() - typed.current.at < 700;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList(
          'keyboard',
          e.key === 'ArrowUp' && !options.some(o => isSelected(o.value))
            ? (enabled[enabled.length - 1]?.value ?? null)
            : undefined,
        );
      } else if (printable(e)) {
        e.preventDefault();
        if (searchable) openList('keyboard', undefined, e.key);
        else {
          const hit = typeAhead(e.key);
          if (hit) openList('keyboard', hit);
        }
      }
      return;
    }
    if (e.key === ' ' && typing && !searchable) {
      e.preventDefault();
      const hit = typeAhead(' ');
      if (hit) setActive(hit);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeOption) pick(activeOption);
      return;
    }
    if (listKeys(e, true)) return;
    if (printable(e)) {
      e.preventDefault();
      if (searchable) {
        setQuery(e.key);
        setFocusSearch(true);
      } else {
        const hit = typeAhead(e.key);
        if (hit) setActive(hit);
      }
    }
  };

  /** Moves shared by the button and the search box; true when handled. */
  const listKeys = (e: React.KeyboardEvent, homeEnd: boolean): boolean => {
    const moves: Record<string, Parameters<typeof move>[0]> = {
      ArrowDown: 'next',
      ArrowUp: 'prev',
      PageDown: PAGE,
      PageUp: -PAGE,
      ...(homeEnd ? {Home: 'first', End: 'last'} : {}),
    };
    if (e.key in moves) {
      e.preventDefault();
      move(moves[e.key]);
      return true;
    }
    if (e.key === 'Tab') {
      close(false);
      return true;
    }
    return false;
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeOption) pick(activeOption);
      return;
    }
    listKeys(e, false);
  };

  const triggerProps = {
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant':
      open && activeOption ? optionId(activeOption.value) : undefined,
    onClick: () => {
      // Enter and Space are handled (and cancelled) on keydown, so this is a
      // tap, a mouse click, a tap on the label or a screen reader's action.
      if (open) close(false);
      else openList('pointer');
    },
    onKeyDown: onTriggerKeyDown,
  };

  const panel = (props: {
    /** Accessible name of the list (usually the field's label). */
    label: string;
    anchorRef: React.RefObject<HTMLElement | null>;
    footer?: React.ReactNode;
  }) => (
    <Popover
      id={popupId}
      open={open}
      anchorRef={props.anchorRef}
      width="anchor"
      onClose={reason => close(reason === 'escape')}
      className="lx-pop--list"
    >
      {searchable && (
        <div className="lx-lb__search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            id={`${id}-search`}
            type="text"
            role="combobox"
            className="lx-lb__searchinput"
            aria-label={`Buscar en «${props.label}»`}
            aria-expanded={true}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeOption ? optionId(activeOption.value) : undefined
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="Buscar…"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setActive(null);
            }}
            onKeyDown={onSearchKeyDown}
          />
        </div>
      )}
      <ul
        ref={listRef}
        role="listbox"
        id={listId}
        aria-label={props.label}
        aria-multiselectable={multi || undefined}
        className={['lx-lb', multi ? 'lx-lb--multi' : ''].join(' ')}
        // Keep focus on the button or the search box while choosing.
        onMouseDown={e => e.preventDefault()}
      >
        {groupRuns(visible).map((run, gi) => {
          const items = run.options.map(o => {
            const selected = isSelected(o.value);
            return (
              <li
                key={o.value}
                role="option"
                id={optionId(o.value)}
                data-value={o.value}
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                className={[
                  'lx-lb__option',
                  o === activeOption ? 'is-active' : '',
                  o.value === '' ? 'lx-lb__option--empty' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onPointerMove={() => {
                  if (!o.disabled && active !== o.value) setActive(o.value);
                }}
                onClick={() => pick(o)}
              >
                {multi && (
                  <span className="lx-lb__box" aria-hidden="true">
                    {selected && <Icon name="check" size={16} />}
                  </span>
                )}
                <span className="lx-lb__text">
                  <span className="lx-lb__label">{o.label}</span>
                  {o.hint && <span className="lx-lb__hint">{o.hint}</span>}
                </span>
                {!multi && selected && (
                  <Icon name="check" size={18} className="lx-lb__check" />
                )}
              </li>
            );
          });
          if (!run.group) return items;
          const headId = `${id}-grp-${gi}`;
          return (
            <li role="presentation" key={headId} className="lx-lb__groupwrap">
              <ul
                role="group"
                aria-labelledby={headId}
                className="lx-lb__group"
              >
                <li role="presentation" id={headId} className="lx-lb__heading">
                  {run.group}
                </li>
                {items}
              </ul>
            </li>
          );
        })}
      </ul>
      {!visible.length && (
        <p className="lx-lb__none" role="status">
          {query ? `Nada coincide con «${query.trim()}».` : 'No hay opciones.'}
        </p>
      )}
      {props.footer}
    </Popover>
  );

  return {open, openList, close, triggerProps, panel, listId, popupId};
}

interface Run {
  group: string | null;
  options: SelectOption[];
}

/** Consecutive options with the same group, in order. */
function groupRuns(options: SelectOption[]): Run[] {
  const runs: Run[] = [];
  for (const o of options) {
    const group = o.group ?? null;
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.options.push(o);
    else runs.push({group, options: [o]});
  }
  return runs;
}
