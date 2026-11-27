/**
 * Login (Revisión 1 · E4): username and password, with no list of people.
 * The error never says which of the two was wrong. «¿Has olvidado tu
 * contraseña?» asks for a reset link and always answers the same, whether
 * the account exists or not. An account link opened from an e-mail
 * (`account/links.ts`) is handled here too, before signing in.
 */
import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {
  RESET_LINK_MINUTES,
  USERNAME_MAX,
} from '../../../shared/logistics/account.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {AccountLinkPanel} from '../account/AccountLinkPanel';
import {
  clearAccountLink,
  pendingAccountLink,
  subscribeAccountLink,
} from '../account/links';
import {PasswordField} from '../account/PasswordField';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Field, Icon, Input} from '../ui';
import {GateLayout} from './GateLayout';

function minutesText(seconds: number): string {
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

/**
 * Counts down a 429 so the button says how long to wait; `onUnlock` runs
 * when the wait is over (its message no longer applies).
 */
function useLock(onUnlock: () => void): {
  lockedFor: number;
  lock: (seconds: number) => void;
} {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const unlock = useRef(onUnlock);
  useEffect(() => {
    unlock.current = onUnlock;
  });
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) {
        setUntil(null);
        unlock.current();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return {
    lockedFor: until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0,
    lock: seconds => {
      setNow(Date.now());
      setUntil(Date.now() + seconds * 1000);
    },
  };
}

function unavailableText(): string {
  return 'Servidor no disponible. Comprueba la conexión y vuelve a intentarlo.';
}

type View = 'login' | 'recovery' | 'sent';

export const LoginScreen: React.FC<{onExit: () => void}> = ({onExit}) => {
  const link = useSyncExternalStore(subscribeAccountLink, pendingAccountLink);
  const [view, setView] = useState<View>('login');
  const [username, setUsername] = useState('');

  if (link) {
    return (
      <GateLayout onExit={onExit} id="lx-account-link">
        <AccountLinkPanel
          link={link}
          headingLevel={1}
          onDone={clearAccountLink}
          onNewLink={() => {
            clearAccountLink();
            setView('recovery');
          }}
        />
      </GateLayout>
    );
  }

  return (
    <GateLayout onExit={onExit} id="lx-login">
      {view === 'login' ? (
        <LoginForm
          username={username}
          onUsername={setUsername}
          onForgot={() => setView('recovery')}
        />
      ) : view === 'recovery' ? (
        <RecoveryForm
          username={username}
          onUsername={setUsername}
          onSent={() => setView('sent')}
          onBack={() => setView('login')}
        />
      ) : (
        <div className="lx-gate__status" id="lx-recovery-sent" role="status">
          <span className="lx-gate__icon" aria-hidden="true">
            <Icon name="mail" size={26} />
          </span>
          <h1 className="lx-gate__title">Revisa tu correo</h1>
          <p className="lx-gate__lead">
            Si <strong>{username.trim()}</strong> es un usuario del Gestor con
            recuperación activada, llegará un enlace para elegir una contraseña
            nueva. Sirve una vez y caduca en{' '}
            <span className="lx-num">{RESET_LINK_MINUTES}</span> minutos.
          </p>
          <p className="lx-muted">
            ¿No llega en unos minutos? Mira en el correo no deseado o pide a
            administración o desarrollo una contraseña provisional. Los usuarios
            compartidos (Equipo, Invitado) no tienen correo: su contraseña la
            pone administración.
          </p>
          <div className="lx-gate__actions">
            <Button
              variant="primary"
              icon="back"
              id="lx-recovery-done"
              onClick={() => setView('login')}
            >
              Volver a la entrada
            </Button>
          </div>
        </div>
      )}
    </GateLayout>
  );
};

const LoginForm: React.FC<{
  username: string;
  onUsername: (v: string) => void;
  onForgot: () => void;
}> = ({username, onUsername, onForgot}) => {
  const login = useLogisticsStore(s => s.login);
  const notice = useLogisticsStore(s => s.sessionNotice);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<'username' | 'password' | null>(null);
  const [busy, setBusy] = useState(false);
  const {lockedFor, lock} = useLock(() => setError(null));
  const userRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (username ? passwordRef : userRef).current?.focus();
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || lockedFor) return;
    if (!username.trim()) {
      setMissing('username');
      setError(null);
      userRef.current?.focus();
      return;
    }
    if (!password) {
      setMissing('password');
      setError(null);
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setMissing(null);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setPassword('');
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
        setError(
          'El usuario o la contraseña no son correctos. Revísalos e inténtalo de nuevo.',
        );
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        const wait = err.retryAfterSeconds ?? 60;
        lock(wait);
        setError(
          `Demasiados intentos seguidos. Por seguridad, espera ${minutesText(wait)} antes de volver a probar.`,
        );
      } else if (isApiError(err) && err.isUnavailable) {
        setError(unavailableText());
      } else if (isApiError(err) && err.code === 'VALIDATION') {
        setError(err.fields?.username ?? err.fields?.password ?? err.message);
      } else {
        setError(errorMessage(err));
      }
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="lx-login-form"
      id="lx-login-form"
      onSubmit={submit}
      noValidate
      aria-describedby={error ? 'lx-login-error' : undefined}
    >
      {notice && (
        <p className="lx-notice" role="status" id="lx-session-notice">
          <Icon name="clock" size={18} />
          {notice}
        </p>
      )}
      <h1 className="lx-gate__title">Entra en el Gestor</h1>
      <p className="lx-gate__lead">
        Con tu usuario y tu contraseña. Cada cambio queda firmado con tu nombre.
      </p>
      <Field
        id="lx-login-username"
        label="Usuario"
        error={
          missing === 'username' ? 'Escribe tu nombre de usuario.' : undefined
        }
      >
        <Input
          ref={userRef}
          id="lx-login-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          value={username}
          invalid={missing === 'username' || !!error}
          aria-describedby={
            missing === 'username' ? 'lx-login-username-error' : undefined
          }
          onChange={e => {
            onUsername(e.target.value);
            if (missing === 'username') setMissing(null);
            if (error && !lockedFor) setError(null);
          }}
        />
      </Field>
      <PasswordField
        id="lx-login-password"
        label="Contraseña"
        autoComplete="current-password"
        inputRef={passwordRef}
        value={password}
        error={missing === 'password' ? 'Escribe tu contraseña.' : undefined}
        onChange={v => {
          setPassword(v);
          if (missing === 'password') setMissing(null);
          if (error && !lockedFor) setError(null);
        }}
      />
      {error && (
        <p
          className="lx-notice lx-notice--error"
          id="lx-login-error"
          role="alert"
        >
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        id="lx-login-submit"
        busy={busy}
        disabled={lockedFor > 0}
      >
        {busy ? 'Entrando…' : lockedFor ? `Espera ${lockedFor} s` : 'Entrar'}
      </Button>
      <button
        type="button"
        className="lx-linkbtn lx-login-forgot"
        id="lx-login-forgot"
        onClick={onForgot}
      >
        ¿Has olvidado tu contraseña?
      </button>
    </form>
  );
};

const RecoveryForm: React.FC<{
  username: string;
  onUsername: (v: string) => void;
  onSent: () => void;
  onBack: () => void;
}> = ({username, onUsername, onSent, onBack}) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {lockedFor, lock} = useLock(() => setError(null));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || lockedFor) return;
    if (!username.trim()) {
      setError('Escribe tu nombre de usuario.');
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.requestRecovery({username: username.trim()});
      onSent();
    } catch (err) {
      if (isApiError(err) && err.code === 'RATE_LIMITED') {
        const wait = err.retryAfterSeconds ?? 60;
        lock(wait);
        setError(
          `Ya se han pedido varios enlaces. Espera ${minutesText(wait)} y vuelve a probar.`,
        );
      } else if (isApiError(err) && err.isUnavailable) {
        setError(unavailableText());
      } else if (isApiError(err) && err.code === 'VALIDATION') {
        setError(err.fields?.username ?? err.message);
      } else {
        setError(errorMessage(err));
      }
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="lx-login-form"
      id="lx-recovery-form"
      onSubmit={submit}
      noValidate
    >
      <h1 className="lx-gate__title">Recuperar el acceso</h1>
      <p className="lx-gate__lead">
        Escribe tu usuario. Si tiene un correo de recuperación, te enviaremos un
        enlace para elegir una contraseña nueva.
      </p>
      <Field id="lx-recovery-username" label="Usuario" error={error}>
        <Input
          ref={ref}
          id="lx-recovery-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          value={username}
          invalid={!!error}
          aria-describedby={error ? 'lx-recovery-username-error' : undefined}
          onChange={e => {
            onUsername(e.target.value);
            if (error && !lockedFor) setError(null);
          }}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        icon="send"
        id="lx-recovery-submit"
        busy={busy}
        disabled={lockedFor > 0}
      >
        {busy
          ? 'Enviando…'
          : lockedFor
            ? `Espera ${lockedFor} s`
            : 'Enviar enlace'}
      </Button>
      <Button
        variant="ghost"
        icon="back"
        id="lx-recovery-back"
        onClick={onBack}
      >
        Volver a la entrada
      </Button>
    </form>
  );
};
