/**
 * What a screen shows when the viewer lacks the permission it needs
 * (Revisión 1 · E4). A provisional password that holds it back asks for a
 * new password instead of saying «Sin acceso». Only presentation: the
 * server never sends the data anyway.
 */
import React from 'react';
import type {Permission} from '../../../shared/logistics/contracts.ts';
import {Button, Icon} from '../ui';
import {useAccountUi} from './accountUi';
import {useAccess} from './useAccess';

export interface NoAccessProps {
  permission: Permission;
  /** What is locked, for the title («Contactos»). */
  what?: string;
  id?: string;
  /** Inside a card or a sheet instead of a whole space. */
  compact?: boolean;
}

export const NoAccess: React.FC<NoAccessProps> = ({
  permission,
  what,
  id,
  compact = false,
}) => {
  const access = useAccess();
  const openPasswordChange = useAccountUi(s => s.openPasswordChange);
  const denial = access.denial(permission);
  if (!denial) return null;
  const held = denial.kind === 'held';
  return (
    <section
      className={['lx-noaccess', compact ? 'lx-noaccess--compact' : '']
        .filter(Boolean)
        .join(' ')}
      id={id}
      data-denial={denial.kind}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <span className="lx-noaccess__icon" aria-hidden="true">
        <Icon name="lock" size={compact ? 22 : 28} />
      </span>
      <h2 className="lx-noaccess__title" id={id ? `${id}-title` : undefined}>
        {held
          ? 'Pendiente de tu contraseña nueva'
          : what
            ? `${what}: sin acceso`
            : 'Sin acceso'}
      </h2>
      <p className="lx-noaccess__text">{denial.message}</p>
      {held ? (
        <Button
          variant="primary"
          icon="lock"
          id={id ? `${id}-password` : undefined}
          onClick={openPasswordChange}
        >
          Cambiar mi contraseña
        </Button>
      ) : access.role === 'guest' && !access.support ? (
        <p className="lx-noaccess__hint">
          Si formas parte del equipo, sal y entra con tu usuario.
        </p>
      ) : null}
    </section>
  );
};
