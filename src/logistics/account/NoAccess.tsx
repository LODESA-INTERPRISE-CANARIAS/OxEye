/**
 * What a screen shows when the viewer lacks the permission it needs
 * (Revisión 1 · E4). A provisional password that holds it back asks for a
 * new password instead of saying «Sin acceso». Only presentation: the
 * server never sends the data anyway.
 */
import React from 'react';
import type {Permission} from '../../../shared/logistics/contracts.ts';
import {Button, Icon, type IconName} from '../ui';
import {useAccountUi} from './accountUi';
import {useAccess} from './useAccess';

export interface NoAccessProps {
  permission: Permission;
  /** What is locked, for the title («Contactos»). */
  what?: string;
  id?: string;
  /** Inside a card or a sheet instead of a whole space. */
  compact?: boolean;
  /**
   * A whole space: what the team does there, so the locked screen still
   * explains the product (styled like the early «próximamente» cards).
   */
  about?: {icon: IconName; lines: string[]};
  onGoToday?: () => void;
}

export const NoAccess: React.FC<NoAccessProps> = ({
  permission,
  what,
  id,
  compact = false,
  about,
  onGoToday,
}) => {
  const access = useAccess();
  const openPasswordChange = useAccountUi(s => s.openPasswordChange);
  const denial = access.denial(permission);
  if (!denial) return null;
  const held = denial.kind === 'held';
  const guest = access.role === 'guest' && !access.support;

  if (about && !compact && !held) {
    return (
      <div className="lx-placeholder">
        <section
          className="lx-card lx-card--accent lx-placeholder__card lx-noaccess--space"
          id={id}
          data-denial={denial.kind}
          aria-labelledby={id ? `${id}-title` : undefined}
        >
          <span className="lx-placeholder__icon" aria-hidden="true">
            <Icon name={about.icon} size={30} />
            <span className="lx-placeholder__lock">
              <Icon name="lock" size={14} />
            </span>
          </span>
          <p className="lx-eyebrow">Solo para el equipo</p>
          <h2
            className="lx-placeholder__title"
            id={id ? `${id}-title` : undefined}
          >
            {what ?? 'Sin acceso'}
          </h2>
          <p className="lx-placeholder__text">{denial.message}</p>
          <p className="lx-placeholder__lead">Lo que el equipo hace aquí:</p>
          <ul className="lx-placeholder__list">
            {about.lines.map(line => (
              <li key={line}>
                <Icon name="check" size={16} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="lx-placeholder__actions">
            {onGoToday && (
              <Button variant="secondary" icon="today" onClick={onGoToday}>
                Ir a Hoy
              </Button>
            )}
            {guest && (
              <p className="lx-noaccess__hint">
                Si formas parte del equipo, sal y entra con tu usuario.
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

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
      ) : guest ? (
        <p className="lx-noaccess__hint">
          Si formas parte del equipo, sal y entra con tu usuario.
        </p>
      ) : null}
    </section>
  );
};
