/**
 * Chips with OxEye's visual grammar for the certainty of data:
 * confirmed = solid, planned = outlined, hypothesis = dashed line with a soft
 * tint and its own label, pending = dotted marker («Pendiente de verificar»).
 */
import React from 'react';
import {Icon} from './icons';

export type Certainty = 'confirmed' | 'planned' | 'hypothesis' | 'pending';

export type ChipTone = 'accent' | 'danger' | 'neutral';

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  confirmed: 'Confirmado',
  planned: 'Previsto',
  hypothesis: 'Hipótesis',
  pending: 'Pendiente de verificar',
};

/** Plain-language meaning of each style, for legends and `?` help. */
export const CERTAINTY_HELP: Record<Certainty, string> = {
  confirmed: 'Relleno: dato confirmado.',
  planned: 'Contorno: previsto, aún sin confirmar.',
  hypothesis:
    'Borde discontinuo y tono suave: hipótesis de trabajo; no cambia el plan real.',
  pending: 'Punteado: falta comprobarlo con la fuente.',
};

export interface ChipProps {
  certainty?: Certainty;
  /** Neutral tag without certainty meaning (e.g. «Demo», «Solo lectura»). */
  tag?: boolean;
  tone?: ChipTone;
  /** Strike-through for cancelled items. */
  struck?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
  children?: React.ReactNode;
}

export const Chip: React.FC<ChipProps> = ({
  certainty = 'planned',
  tag = false,
  tone = 'accent',
  struck = false,
  size = 'md',
  title,
  className,
  children,
}) => {
  const kind = tag ? 'tag' : certainty;
  return (
    <span
      className={[
        'lx-chip',
        `lx-chip--${kind}`,
        `lx-chip--tone-${tone}`,
        `lx-chip--${size}`,
        struck ? 'lx-chip--struck' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
    >
      {kind === 'pending' && (
        <span className="lx-chip__dot" aria-hidden="true" />
      )}
      <span className="lx-chip__text">
        {children ?? (tag ? null : CERTAINTY_LABEL[certainty])}
      </span>
    </span>
  );
};

/**
 * Inline «Visible para el equipo» marker: the value exists but was withheld
 * from this viewer (a guest). Never shown as «Pendiente de verificar».
 */
export const Withheld: React.FC<{children?: React.ReactNode}> = ({
  children,
}) => (
  <span
    className="lx-withheld"
    title="Solo el equipo, con su propio usuario, ve teléfonos, correos, precios y observaciones."
  >
    <Icon name="lock" size={13} />
    {children ?? 'Visible para el equipo'}
  </span>
);

/** Inline «Pendiente de verificar» marker for a missing value. */
export const Pending: React.FC<{children?: React.ReactNode}> = ({children}) => (
  <span className="lx-pending">
    <span className="lx-chip__dot" aria-hidden="true" />
    {children ?? 'Pendiente de verificar'}
  </span>
);
