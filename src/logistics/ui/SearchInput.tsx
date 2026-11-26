/**
 * Search field with a magnifier and a clear button (44 px targets). Escape
 * with text clears it first; with no text it lets the event through (e.g. to
 * close the sheet it lives in).
 */
import React from 'react';
import {Icon} from './icons';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  value: string;
  onValue: (value: string) => void;
  /** Accessible name when there is no visible label. */
  label: string;
  large?: boolean;
};

export const SearchInput = React.forwardRef<HTMLInputElement, Props>(
  (
    {value, onValue, label, large = false, className, onKeyDown, ...rest},
    ref,
  ) => {
    const inner = React.useRef<HTMLInputElement | null>(null);
    return (
      <span
        className={['lx-search', large ? 'lx-search--lg' : '', className]
          .filter(Boolean)
          .join(' ')}
      >
        <Icon
          name="search"
          size={large ? 22 : 19}
          className="lx-search__icon"
        />
        <input
          ref={el => {
            inner.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          type="search"
          className="lx-search__input"
          aria-label={label}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={value}
          onChange={e => onValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && value) {
              e.preventDefault();
              e.stopPropagation();
              onValue('');
            }
            onKeyDown?.(e);
          }}
          {...rest}
        />
        {value && (
          <button
            type="button"
            className="lx-search__clear"
            aria-label="Borrar la búsqueda"
            onClick={() => {
              onValue('');
              inner.current?.focus();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </span>
    );
  },
);
SearchInput.displayName = 'SearchInput';
