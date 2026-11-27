/**
 * Change the own password (`POST /me/password`, Revisión 1 · E4): the
 * current one, a new one with the indicative strength meter and, as an
 * option, closing every other session. A provisional password stops being
 * provisional, so the account (and its permissions) is fetched again.
 */
import React, {useRef, useState} from 'react';
import {passwordProblem} from '../../../shared/logistics/account.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon} from '../ui';
import {PasswordField} from './PasswordField';

export interface PasswordChangeFormProps {
  idPrefix: string;
  /** After a successful change (the account is already refreshed). */
  onDone?: () => void;
  autoFocus?: boolean;
  submitLabel?: string;
}

export const PasswordChangeForm: React.FC<PasswordChangeFormProps> = ({
  idPrefix,
  onDone,
  autoFocus,
  submitLabel = 'Cambiar contraseña',
}) => {
  const session = useLogisticsStore(s => s.session);
  const refreshAccount = useLogisticsStore(s => s.refreshAccount);
  const toast = useLogisticsStore(s => s.toast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [others, setOthers] = useState(false);
  const [errors, setErrors] = useState<{
    current?: string;
    next?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const provisional = session?.user.passwordProvisional === true;
  const username = session?.user.username ?? session?.user.displayName ?? '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !session) return;
    if (!current) {
      setErrors({current: 'Escribe tu contraseña actual.'});
      currentRef.current?.focus();
      return;
    }
    const problem = passwordProblem(next, username);
    if (problem) {
      setErrors({next: problem});
      nextRef.current?.focus();
      return;
    }
    if (next === current) {
      setErrors({next: 'La contraseña nueva debe ser distinta de la actual.'});
      nextRef.current?.focus();
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.changePassword(session.token, {
        currentPassword: current,
        newPassword: next,
        signOutOthers: others,
      });
      setCurrent('');
      setNext('');
      await refreshAccount();
      toast(
        others
          ? 'Contraseña cambiada. Se han cerrado tus otras sesiones.'
          : 'Contraseña cambiada.',
        'success',
      );
      onDone?.();
    } catch (err) {
      if (isApiError(err) && err.fields?.currentPassword) {
        setErrors({current: err.fields.currentPassword});
        setCurrent('');
        currentRef.current?.focus();
      } else if (isApiError(err) && err.fields?.newPassword) {
        setErrors({next: err.fields.newPassword});
        nextRef.current?.focus();
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        setErrors({
          form: 'Demasiados intentos con la contraseña actual. Espera unos minutos y vuelve a probar.',
        });
      } else {
        setErrors({form: errorMessage(err)});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="lx-acct-form"
      id={`${idPrefix}-form`}
      onSubmit={submit}
      noValidate
    >
      <PasswordField
        id={`${idPrefix}-current`}
        label={provisional ? 'Contraseña provisional' : 'Contraseña actual'}
        autoComplete="current-password"
        inputRef={currentRef}
        autoFocus={autoFocus}
        value={current}
        error={errors.current}
        hint={
          provisional
            ? 'La que te dio administración o desarrollo, con la que has entrado.'
            : undefined
        }
        onChange={v => {
          setCurrent(v);
          if (errors.current || errors.form) setErrors({});
        }}
      />
      <PasswordField
        id={`${idPrefix}-new`}
        label="Contraseña nueva"
        autoComplete="new-password"
        username={username}
        inputRef={nextRef}
        value={next}
        error={errors.next}
        onChange={v => {
          setNext(v);
          if (errors.next || errors.form) setErrors({});
        }}
      />
      <span className="lx-switch">
        <input
          type="checkbox"
          role="switch"
          id={`${idPrefix}-others`}
          checked={others}
          onChange={e => setOthers(e.target.checked)}
        />
        <label htmlFor={`${idPrefix}-others`}>
          <span className="lx-switch__track" aria-hidden="true" />
          Cerrar también mis otras sesiones
        </label>
      </span>
      {errors.form && (
        <p className="lx-notice lx-notice--error" role="alert">
          <Icon name="alert" size={18} />
          {errors.form}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        id={`${idPrefix}-submit`}
        busy={busy}
      >
        {busy ? 'Guardando…' : submitLabel}
      </Button>
    </form>
  );
};
