/**
 * The recovery e-mail (Revisión 1 · E4): where a reset link goes when the
 * password is forgotten. Only masked addresses come back from the server.
 * A new address is used once its verification link is opened; shared
 * accounts (Equipo, Invitado) have none.
 */
import React, {useState} from 'react';
import {
  EMAIL_LINK_HOURS,
  EMAIL_MAX,
  isEmailAddress,
} from '../../../shared/logistics/account.ts';
import type {Profile} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Chip, Field, Icon, Input, describedBy} from '../ui';

export const RecoveryEmail: React.FC<{
  idPrefix: string;
  profile: Profile;
  /** Load the profile again after a change. */
  onChanged: () => void;
}> = ({idPrefix, profile, onChanged}) => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const toast = useLogisticsStore(s => s.toast);
  const [email, setEmail] = useState('');
  const [editing, setEditing] = useState(!profile.recoveryEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (profile.sharedAccount) {
    return (
      <p className="lx-notice lx-notice--quiet" id={`${idPrefix}-shared`}>
        <Icon name="user" size={18} />
        Es un usuario compartido: no tiene correo de recuperación. Si se olvida
        la contraseña, administración o desarrollo ponen una nueva.
      </p>
    );
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    const value = email.trim();
    if (!isEmailAddress(value)) {
      setError('Escribe un correo válido, como nombre@ejemplo.es.');
      return;
    }
    setBusy('send');
    setError(null);
    try {
      await api.requestRecoveryEmail(token, {email: value});
      setEmail('');
      setEditing(false);
      toast(
        `Te hemos enviado un enlace a ese correo. Ábrelo en las próximas ${EMAIL_LINK_HOURS} horas para activarlo.`,
        'success',
      );
      onChanged();
    } catch (err) {
      setError(
        isApiError(err) && err.fields?.email
          ? err.fields.email
          : isApiError(err) && err.code === 'RATE_LIMITED'
            ? 'Ya se han enviado varios enlaces. Espera un rato y vuelve a probar.'
            : errorMessage(err),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!token) return;
    setBusy('remove');
    try {
      await api.removeRecoveryEmail(token);
      setConfirmRemove(false);
      toast('Correo de recuperación quitado.', 'success');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="lx-acct-email" id={`${idPrefix}-email`}>
      {profile.recoveryEmail ? (
        <div className="lx-acct-row">
          <Icon name="mail" size={20} />
          <span className="lx-acct-row__main">
            <strong id={`${idPrefix}-email-current`}>
              {profile.recoveryEmail}
            </strong>
            <span className="lx-muted">
              Aquí llegaría un enlace si olvidas la contraseña.
            </span>
          </span>
          <Chip tag tone="accent" size="sm">
            <Icon name="check" size={13} /> Verificado
          </Chip>
        </div>
      ) : (
        <p className="lx-muted" id={`${idPrefix}-email-none`}>
          Sin correo de recuperación: si olvidas la contraseña, tendrás que
          pedir una provisional a administración.
        </p>
      )}
      {profile.pendingRecoveryEmail && (
        <p className="lx-notice" role="status" id={`${idPrefix}-email-pending`}>
          <Icon name="clock" size={18} />
          <span>
            <strong>{profile.pendingRecoveryEmail}</strong> está pendiente de
            verificar: abre el enlace que te hemos enviado (caduca en{' '}
            {EMAIL_LINK_HOURS} horas).
          </span>
        </p>
      )}
      {editing ? (
        <form className="lx-acct-inline" onSubmit={send} noValidate>
          <Field
            id={`${idPrefix}-email-input`}
            label={
              profile.recoveryEmail
                ? 'Usar otro correo'
                : 'Correo de recuperación'
            }
            error={error}
            hint="Te enviaremos un enlace para confirmar que es tuyo."
          >
            <Input
              id={`${idPrefix}-email-input`}
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={EMAIL_MAX}
              value={email}
              invalid={!!error}
              aria-describedby={describedBy(`${idPrefix}-email-input`, {
                hint: true,
                error,
              })}
              onChange={e => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
          </Field>
          <div className="lx-acct-actions">
            <Button
              type="submit"
              variant="primary"
              icon="send"
              id={`${idPrefix}-email-send`}
              busy={busy === 'send'}
            >
              Enviar enlace
            </Button>
            {profile.recoveryEmail && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="lx-acct-actions">
          <Button
            size="sm"
            icon="edit"
            id={`${idPrefix}-email-change`}
            onClick={() => setEditing(true)}
          >
            Cambiar correo
          </Button>
          {confirmRemove ? (
            <span className="lx-acct-confirm" role="group">
              <span>¿Quitarlo? No podrás recuperar la contraseña tú solo.</span>
              <Button
                size="sm"
                variant="danger"
                id={`${idPrefix}-email-remove-confirm`}
                busy={busy === 'remove'}
                onClick={() => void remove()}
              >
                Quitar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmRemove(false)}
              >
                No
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              id={`${idPrefix}-email-remove`}
              onClick={() => setConfirmRemove(true)}
            >
              Quitar
            </Button>
          )}
          {error && (
            <p className="lx-field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
