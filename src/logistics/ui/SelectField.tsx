/**
 * Single choice in the Gestor's style: a field-shaped button that opens a
 * list (search box when it has more than eight options, group headings,
 * an «empty» choice such as «Sin evento»). Keys and roles: `Listbox.tsx`.
 *
 * `optionsFromChildren` reads `<option>`/`<optgroup>` children, so the
 * `Select` of `Field.tsx` keeps its native-like API on top of this control.
 */
import React, {useRef} from 'react';
import {Icon} from './icons';
import {useListbox, type SelectOption} from './Listbox';

export type {SelectOption} from './Listbox';

export interface SelectFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Adds a first option with value `''` («Sin evento», «Todas»…). */
  emptyLabel?: string;
  /** Shown when the value matches no option. */
  placeholder?: string;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  /** Accessible name when there is no `<label for>`. */
  'aria-label'?: string;
  title?: string;
  searchThreshold?: number;
  className?: string;
}

/** The field's visible label, for the list's accessible name. */
export function labelOf(el: HTMLElement | null, fallback = 'Opciones') {
  const label =
    el && 'labels' in el
      ? (el as HTMLButtonElement).labels?.[0]?.textContent
      : null;
  return (
    label?.replace(/\s·\sopcional$/, '').trim() ||
    el?.getAttribute('aria-label') ||
    fallback
  );
}

export const SelectField: React.FC<SelectFieldProps> = ({
  id,
  value,
  onChange,
  options,
  emptyLabel,
  placeholder = 'Elige una opción',
  name,
  invalid,
  disabled,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  title,
  searchThreshold,
  className,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const all =
    emptyLabel !== undefined
      ? [{value: '', label: emptyLabel}, ...options]
      : options;
  const current = all.find(o => o.value === value);
  const lb = useListbox({
    id,
    options: all,
    multi: false,
    isSelected: v => v === value,
    onPick: o => {
      if (o.value !== value) onChange(o.value);
    },
    searchThreshold,
    triggerRef,
  });
  const empty = !current || current.value === '';

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className={[
          'lx-input',
          'lx-select',
          'lx-ctl__select',
          lb.open ? 'lx-ctl--open' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        data-value={value}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        {...lb.triggerProps}
      >
        <span
          className={[
            'lx-ctl__selected',
            empty ? 'lx-ctl__selected--empty' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {current?.label ?? placeholder}
        </span>
        <Icon name="chevronDown" size={18} className="lx-ctl__chevron" />
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {lb.panel({
        label: lb.open ? labelOf(triggerRef.current) : '',
        anchorRef: triggerRef,
      })}
    </>
  );
};

/** Plain text of option children («Ana» + « · Sonido»). */
function textOf(node: React.ReactNode): string {
  let out = '';
  React.Children.forEach(node, child => {
    if (typeof child === 'string' || typeof child === 'number') {
      out += String(child);
    } else if (React.isValidElement<{children?: React.ReactNode}>(child)) {
      out += textOf(child.props.children);
    }
  });
  return out;
}

interface OptionProps {
  value?: string | number;
  disabled?: boolean;
  label?: string;
  children?: React.ReactNode;
}

/** Options from `<option>`/`<optgroup>` children, fragments included. */
export function optionsFromChildren(
  children: React.ReactNode,
  group?: string,
  out: SelectOption[] = [],
): SelectOption[] {
  React.Children.forEach(children, child => {
    if (!React.isValidElement<OptionProps>(child)) return;
    const {props} = child;
    if (child.type === React.Fragment) {
      optionsFromChildren(props.children, group, out);
    } else if (child.type === 'optgroup') {
      optionsFromChildren(props.children, props.label, out);
    } else if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({
        value: props.value !== undefined ? String(props.value) : label,
        label,
        disabled: props.disabled,
        group,
      });
    }
  });
  return out;
}
