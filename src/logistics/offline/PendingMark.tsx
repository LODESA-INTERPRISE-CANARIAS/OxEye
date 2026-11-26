/**
 * «Pendiente de enviar» (M6): a record with a change saved only on this
 * device. Dotted, like every «not confirmed yet» mark in OxEye; danger tone
 * when the change needs a person («Por revisar»).
 */
import React from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon} from '../ui';

export type UnsentState = 'pending' | 'review';

/** Whether the record has a change the server has not accepted yet. */
export function useUnsent(id: string | null | undefined): UnsentState | null {
  return useLogisticsStore(s => {
    if (!id || !s.unsent.has(id)) return null;
    return s.outbox.some(
      e =>
        e.recordId === id &&
        (e.status === 'conflict' || e.status === 'rejected'),
    )
      ? 'review'
      : 'pending';
  });
}

export const UNSENT_LABEL: Record<UnsentState, string> = {
  pending: 'Pendiente de enviar',
  review: 'Por revisar',
};

const UNSENT_TITLE: Record<UnsentState, string> = {
  pending:
    'Guardado solo en este dispositivo. Se enviará solo cuando vuelva la conexión.',
  review:
    'No se ha enviado: otra persona lo cambió o el servidor lo rechazó. Revísalo en «Cambios pendientes».',
};

/** Text to append to a row's accessible name, or ''. */
export const unsentSuffix = (state: UnsentState | null) =>
  state ? `, ${UNSENT_LABEL[state].toLocaleLowerCase('es-ES')}` : '';

export const UnsentMark: React.FC<{
  id: string;
  /** Only the dotted mark, for dense rows (the label goes to aria/title). */
  compact?: boolean;
  className?: string;
}> = ({id, compact = false, className}) => {
  const state = useUnsent(id);
  if (!state) return null;
  return (
    <span
      className={[
        'lx-unsent',
        `lx-unsent--${state}`,
        compact ? 'lx-unsent--compact' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-unsent={state}
      title={UNSENT_TITLE[state]}
    >
      {state === 'review' ? (
        <Icon name="alert" size={13} />
      ) : (
        <span className="lx-chip__dot" aria-hidden="true" />
      )}
      <span className={compact ? 'lx-visually-hidden' : 'lx-unsent__text'}>
        {UNSENT_LABEL[state]}
      </span>
    </span>
  );
};
