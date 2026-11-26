/**
 * Login in two steps: pick your name from large cards, then type only the
 * password. Errors are specific (wrong password, too many attempts).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {LoginUserOption} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {initials} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, EmptyState, Field, Icon, Input, SkeletonRows} from '../ui';
import {GateLayout} from './GateLayout';

type UsersState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'ready'; users: LoginUserOption[]};

function minutesText(seconds: number): string {
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

export const LoginScreen: React.FC<{onExit: () => void}> = ({onExit}) => {
  const login = useLogisticsStore(s => s.login);
  const notice = useLogisticsStore(s => s.sessionNotice);
  const [users, setUsers] = useState<UsersState>({status: 'loading'});
  const [selected, setSelected] = useState<LoginUserOption | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const passwordRef = useRef<HTMLInputElement>(null);

  const loadUsers = useCallback(async () => {
    setUsers({status: 'loading'});
    try {
      const res = await api.loginUsers();
      setUsers({status: 'ready', users: res.items});
    } catch (err) {
      setUsers({status: 'error', message: errorMessage(err)});
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (selected) passwordRef.current?.focus();
  }, [selected]);

  // Countdown while the server asks us to wait.
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const secondsLeft = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil - now) / 1000))
    : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || busy || lockedUntil) return;
    if (!password) {
      setError('Escribe tu contraseña.');
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(selected.displayName, password);
    } catch (err) {
      setPassword('');
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
        setError(
          'La contraseña no es correcta. Revísala e inténtalo de nuevo.',
        );
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        const wait = err.retryAfterSeconds ?? 60;
        setLockedUntil(Date.now() + wait * 1000);
        setNow(Date.now());
        setError(
          `Demasiados intentos seguidos. Por seguridad, espera ${minutesText(wait)} antes de volver a probar.`,
        );
      } else if (isApiError(err) && err.isUnavailable) {
        setError(
          'Servidor no disponible. Comprueba la conexión y vuelve a intentarlo.',
        );
      } else {
        setError(errorMessage(err));
      }
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateLayout onExit={onExit} id="lx-login" wide={!selected}>
      {notice && (
        <p className="lx-notice" role="status" id="lx-session-notice">
          <Icon name="clock" size={18} />
          {notice}
        </p>
      )}

      {!selected ? (
        <>
          <h1 className="lx-gate__title">¿Quién eres?</h1>
          <p className="lx-gate__lead">
            Elige tu nombre. Cada cambio quedará firmado con él.
          </p>
          {users.status === 'loading' && (
            <SkeletonRows rows={3} label="Cargando personas" />
          )}
          {users.status === 'error' && (
            <EmptyState
              icon="alert"
              tone="error"
              title="No se ha podido cargar la lista de personas"
              action={
                <Button icon="refresh" onClick={() => void loadUsers()}>
                  Reintentar
                </Button>
              }
            >
              {users.message}
            </EmptyState>
          )}
          {users.status === 'ready' && users.users.length === 0 && (
            <EmptyState
              icon="user"
              title="Todavía no hay personas dadas de alta"
            >
              Quien administra el servidor debe crear los usuarios del piloto (
              <code>npm --prefix server run db:seed</code>).
            </EmptyState>
          )}
          {users.status === 'ready' && users.users.length > 0 && (
            <ul className="lx-people" id="lx-login-users">
              {users.users.map(u => (
                <li key={u.displayName}>
                  <button
                    type="button"
                    className="lx-person"
                    data-name={u.displayName}
                    onClick={() => {
                      setSelected(u);
                      setPassword('');
                      setError(null);
                    }}
                  >
                    <span
                      className="lx-avatar lx-avatar--lg"
                      aria-hidden="true"
                    >
                      {initials(u.displayName)}
                    </span>
                    <span className="lx-person__text">
                      <strong>{u.displayName}</strong>
                      <span>
                        {u.role === 'guest' ? 'Solo lectura' : 'Equipo'}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form
          className="lx-login-form"
          id="lx-login-form"
          onSubmit={submit}
          noValidate
        >
          <div className="lx-person lx-person--static">
            <span className="lx-avatar lx-avatar--lg" aria-hidden="true">
              {initials(selected.displayName)}
            </span>
            <span className="lx-person__text">
              <strong id="lx-login-name">{selected.displayName}</strong>
              <span>
                {selected.role === 'guest' ? 'Solo lectura' : 'Equipo'}
              </span>
            </span>
            <button
              type="button"
              className="lx-btn lx-btn--ghost lx-btn--sm"
              id="lx-login-change"
              onClick={() => {
                setSelected(null);
                setError(null);
              }}
            >
              <span className="lx-btn__label">Cambiar</span>
            </button>
          </div>
          <h1 className="lx-gate__title">Hola, {selected.displayName}</h1>
          {/* Lets password managers pair the password with the name. */}
          <input
            className="lx-visually-hidden"
            type="text"
            name="username"
            autoComplete="username"
            value={selected.displayName}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <Field id="lx-login-password" label="Contraseña" error={error}>
            <div className="lx-password">
              <Input
                ref={passwordRef}
                id="lx-login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                // Shown as text, phones would otherwise capitalise or correct it.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                invalid={!!error}
                aria-describedby={error ? 'lx-login-password-error' : undefined}
                onChange={e => {
                  setPassword(e.target.value);
                  if (error && !lockedUntil) setError(null);
                }}
              />
              <button
                type="button"
                className="lx-password__toggle"
                aria-pressed={showPassword}
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                }
                onClick={() => setShowPassword(v => !v)}
              >
                <Icon name="eye" size={18} />
              </button>
            </div>
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            id="lx-login-submit"
            busy={busy}
            disabled={!!lockedUntil}
          >
            {busy
              ? 'Entrando…'
              : lockedUntil
                ? `Espera ${secondsLeft} s`
                : 'Entrar'}
          </Button>
        </form>
      )}
    </GateLayout>
  );
};
