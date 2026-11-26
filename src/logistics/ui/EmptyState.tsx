/**
 * Empty, loading and error states that keep the card's layout calm.
 */
import React from 'react';
import {Button} from './Button';
import {Icon, type IconName} from './icons';

export interface EmptyStateProps {
  icon?: IconName;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'default' | 'error';
  compact?: boolean;
  id?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'eye',
  title,
  children,
  action,
  tone = 'default',
  compact = false,
  id,
}) => (
  <div
    id={id}
    className={[
      'lx-empty',
      `lx-empty--${tone}`,
      compact ? 'lx-empty--compact' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    role={tone === 'error' ? 'alert' : undefined}
  >
    <span className="lx-empty__icon" aria-hidden="true">
      <Icon name={icon} size={compact ? 20 : 26} />
    </span>
    <p className="lx-empty__title">{title}</p>
    {children && <div className="lx-empty__text">{children}</div>}
    {action && <div className="lx-empty__action">{action}</div>}
  </div>
);

export const Spinner: React.FC<{label?: string}> = ({label = 'Cargando…'}) => (
  <span className="lx-spinner" role="status" aria-label={label} />
);

/** Placeholder rows while a list loads. */
export const SkeletonRows: React.FC<{rows?: number; label?: string}> = ({
  rows = 3,
  label = 'Cargando…',
}) => (
  <div className="lx-skeleton" role="status" aria-label={label}>
    {Array.from({length: rows}, (_, i) => (
      <span key={i} className="lx-skeleton__row" />
    ))}
  </div>
);

/** Error block with a retry button, for cards whose data failed to load. */
export const LoadError: React.FC<{
  message: string;
  onRetry: () => void;
}> = ({message, onRetry}) => (
  <EmptyState
    compact
    icon="alert"
    tone="error"
    title="No se ha podido cargar"
    action={
      <Button size="sm" icon="refresh" onClick={onRetry}>
        Reintentar
      </Button>
    }
  >
    {message}
  </EmptyState>
);
