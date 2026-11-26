/**
 * Form primitives: a labelled field wrapper, text inputs, select, textarea and
 * a segmented choice built on native radios (arrow keys work out of the box).
 *
 * Labels use `htmlFor` instead of wrapping controls, so the simulator's
 * plain-language enhancer never rewrites them.
 */
import React from 'react';
import {HelpTip} from './HelpTip';

export interface FieldProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  /** Marks the field as optional in the label. */
  optional?: boolean;
  help?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** ids for `aria-describedby` of a field's control. */
export function describedBy(
  id: string,
  opts: {hint?: unknown; error?: unknown},
): string | undefined {
  const ids = [opts.error ? `${id}-error` : '', opts.hint ? `${id}-hint` : '']
    .filter(Boolean)
    .join(' ');
  return ids || undefined;
}

export const Field: React.FC<FieldProps> = ({
  id,
  label,
  hint,
  error,
  optional,
  help,
  className,
  children,
}) => (
  <div
    className={['lx-field', error ? 'lx-field--invalid' : '', className]
      .filter(Boolean)
      .join(' ')}
  >
    <div className="lx-field__labelrow">
      <label className="lx-field__label" htmlFor={id}>
        {label}
        {optional && <span className="lx-field__optional"> · opcional</span>}
      </label>
      {help && (
        <HelpTip label={typeof label === 'string' ? label : 'este dato'}>
          {help}
        </HelpTip>
      )}
    </div>
    {children}
    {error && (
      <p className="lx-field__error" id={`${id}-error`} role="alert">
        {error}
      </p>
    )}
    {hint && !error && (
      <p className="lx-field__hint" id={`${id}-hint`}>
        {hint}
      </p>
    )}
  </div>
);

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({invalid, className, ...rest}, ref) => (
    <input
      ref={ref}
      className={['lx-input', className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select: React.FC<SelectProps> = ({
  invalid,
  className,
  ...rest
}) => (
  <select
    className={['lx-input', 'lx-select', className].filter(Boolean).join(' ')}
    aria-invalid={invalid || undefined}
    {...rest}
  />
);

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea: React.FC<TextareaProps> = ({
  invalid,
  className,
  ...rest
}) => (
  <textarea
    className={['lx-input', 'lx-textarea', className].filter(Boolean).join(' ')}
    aria-invalid={invalid || undefined}
    {...rest}
  />
);

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Short explanation shown as the option's tooltip. */
  title?: string;
}

export interface SegmentedProps<T extends string> {
  name: string;
  legend: React.ReactNode;
  value: T | null;
  options: SegmentedOption<T>[];
  onChange: (value: T | null) => void;
  /** Adds a «Sin indicar» option that maps to null. */
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  help?: React.ReactNode;
  id?: string;
}

export function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  allowNone = false,
  noneLabel = 'Sin indicar',
  disabled,
  help,
  id,
}: SegmentedProps<T>) {
  const all: {value: T | null; label: string; title?: string}[] = allowNone
    ? [{value: null, label: noneLabel}, ...options]
    : options;
  return (
    <fieldset className="lx-segmented" id={id} disabled={disabled}>
      <legend className="lx-field__label lx-segmented__legend">
        {legend}
        {help && (
          <HelpTip label={typeof legend === 'string' ? legend : 'esta opción'}>
            {help}
          </HelpTip>
        )}
      </legend>
      <div className="lx-segmented__options">
        {all.map(opt => {
          const optId = `${name}-${opt.value ?? 'none'}`;
          return (
            <span className="lx-segmented__option" key={optId}>
              <input
                type="radio"
                id={optId}
                name={name}
                value={opt.value ?? ''}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
              />
              <label htmlFor={optId} title={opt.title}>
                {opt.label}
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
