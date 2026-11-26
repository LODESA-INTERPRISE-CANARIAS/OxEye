/**
 * Pill buttons and round icon buttons. Minimum target 44 px; `busy` shows a
 * spinner and blocks repeated taps while a request runs.
 */
import React from 'react';
import {Icon, type IconName} from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Shows a spinner, sets aria-busy and disables the button. */
  busy?: boolean;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      icon,
      busy = false,
      block = false,
      className,
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={[
        'lx-btn',
        `lx-btn--${variant}`,
        `lx-btn--${size}`,
        block ? 'lx-btn--block' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <span className="lx-spinner lx-spinner--inline" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={size === 'lg' ? 22 : 18} />
      ) : null}
      {children != null && <span className="lx-btn__label">{children}</span>}
    </button>
  ),
);
Button.displayName = 'Button';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: icon buttons have no visible text. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {icon, label, variant = 'ghost', className, type = 'button', ...rest},
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={['lx-iconbtn', `lx-iconbtn--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={20} />
    </button>
  ),
);
IconButton.displayName = 'IconButton';
