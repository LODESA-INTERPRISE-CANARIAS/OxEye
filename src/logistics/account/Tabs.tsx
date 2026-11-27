/**
 * Tabs inside an account sheet, on the Gestor's segmented tabs
 * (`.lx-segtabs`): arrow keys, Home and End move between them.
 */
import React, {useRef} from 'react';
import {Icon, type IconName} from '../ui';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  count?: number;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  idPrefix: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const onKey = (e: React.KeyboardEvent) => {
    const i = items.findIndex(t => t.value === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') {
      next = (i - 1 + items.length) % items.length;
    } else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = items[next]!.value;
    onChange(target);
    refs.current.get(target)?.focus();
  };
  return (
    <div
      className="lx-segtabs lx-acct-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
    >
      {items.map(t => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={el => {
              refs.current.set(t.value, el);
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.value}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            className="lx-segtabs__tab"
            onClick={() => onChange(t.value)}
          >
            {t.icon && <Icon name={t.icon} size={18} />}
            <span>{t.label}</span>
            {t.count != null && (
              <span className="lx-segtabs__count lx-num">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  value,
  children,
}: {
  idPrefix: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      className="lx-acct-panel"
    >
      {children}
    </div>
  );
}
