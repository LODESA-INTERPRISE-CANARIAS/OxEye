/**
 * Several choices: the chosen ones as chips with ×, and a list with
 * checkboxes (and a search box when it has more than eight options) that
 * stays open while ticking. With nothing chosen the field says «Ninguno».
 * Keys and roles: `Listbox.tsx` (Space or Enter toggles the active option).
 */
import React, {useRef} from 'react';
import {Icon} from './icons';
import {useListbox, type SelectOption} from './Listbox';
import {labelOf} from './SelectField';

export interface MultiSelectFieldProps {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  /** Text when nothing is chosen. */
  noneLabel?: string;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
  searchThreshold?: number;
  className?: string;
}

export const MultiSelectField: React.FC<MultiSelectFieldProps> = ({
  id,
  values,
  onChange,
  options,
  noneLabel = 'Ninguno',
  name,
  invalid,
  disabled,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  searchThreshold,
  className,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const chosen = values.map(
    v => options.find(o => o.value === v) ?? {value: v, label: v},
  );
  const toggle = (value: string) =>
    onChange(
      values.includes(value)
        ? values.filter(v => v !== value)
        : // Keep the options' order, so chips do not jump around.
          options
            .map(o => o.value)
            .filter(v => v === value || values.includes(v)),
    );
  const lb = useListbox({
    id,
    options,
    multi: true,
    isSelected: v => values.includes(v),
    onPick: o => toggle(o.value),
    searchThreshold,
    triggerRef,
  });

  const remove = (value: string, index: number) => {
    onChange(values.filter(v => v !== value));
    // Focus the next chip's ×, or the field when none is left.
    requestAnimationFrame(() => {
      const buttons =
        chipsRef.current?.querySelectorAll<HTMLButtonElement>('button');
      const next = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)];
      (next ?? triggerRef.current)?.focus();
    });
  };

  const summary = chosen.length
    ? `${chosen.length} ${chosen.length === 1 ? 'elegido' : 'elegidos'}: ${chosen
        .map(o => o.label)
        .join(', ')}`
    : noneLabel;

  return (
    <>
      <div
        ref={wrapRef}
        className={[
          'lx-ctl',
          'lx-ctl--multi',
          invalid ? 'lx-ctl--invalid' : '',
          disabled ? 'lx-ctl--disabled' : '',
          lb.open ? 'lx-ctl--open' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={e => {
          // A tap on the empty part of the box opens the list too.
          if (e.target === e.currentTarget && !disabled) {
            triggerRef.current?.click();
          }
        }}
      >
        {chosen.length > 0 && (
          <ul className="lx-ms__chips" ref={chipsRef} aria-label="Elegidos">
            {chosen.map((o, i) => (
              <li key={o.value} className="lx-ms__chip">
                <span className="lx-ms__chiplabel">{o.label}</span>
                <button
                  type="button"
                  className="lx-ms__remove"
                  aria-label={`Quitar ${o.label}`}
                  title={`Quitar ${o.label}`}
                  disabled={disabled}
                  onClick={() => remove(o.value, i)}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          className="lx-ms__toggle"
          data-value={values.join(',')}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          {...lb.triggerProps}
        >
          <span className="lx-visually-hidden">{summary}</span>
          <span
            aria-hidden="true"
            className={chosen.length ? 'lx-ms__add' : 'lx-ms__none'}
          >
            {chosen.length ? 'Añadir' : noneLabel}
          </span>
          <Icon name="chevronDown" size={18} className="lx-ctl__chevron" />
        </button>
      </div>
      {name &&
        values.map(v => <input key={v} type="hidden" name={name} value={v} />)}
      {lb.panel({
        label: lb.open ? labelOf(triggerRef.current) : '',
        anchorRef: wrapRef,
        footer: (
          <div className="lx-pick__foot lx-pick__foot--list">
            <button
              type="button"
              className="lx-pick__clear"
              id={`${id}-clear`}
              disabled={!values.length}
              onClick={() => onChange([])}
            >
              Quitar todos
            </button>
            <span className="lx-pick__value lx-num" aria-live="polite">
              {values.length
                ? `${values.length} ${values.length === 1 ? 'elegido' : 'elegidos'}`
                : noneLabel}
            </span>
            <button
              type="button"
              className="lx-btn lx-btn--primary lx-btn--sm"
              id={`${id}-done`}
              onClick={() => lb.close(true)}
            >
              Listo
            </button>
          </div>
        ),
      })}
    </>
  );
};
