/**
 * What an account link opens (Revisión 1 · E4): choosing a new password
 * from a reset link, or confirming a recovery e-mail. Works signed out (on
 * the login screen) and inside a session (in a sheet).
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  passwordProblem,
  RESET_LINK_MINUTES,
} from '../../../shared/logistics/account.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {Button, Icon, Spinner} from '../ui';
import type {AccountLink} from './links';
import {PasswordField} from './PasswordField';

const BAD_LINK =
  'El enlace no es válido, ya se ha usado o ha caducado. Pide uno nuevo.';

export interface AccountLinkPanelProps {
  link: AccountLink;
  /** 1 on the login screen (page title); 2 inside a sheet. */
  headingLevel: 1 | 2;
  onDone: () => void;
  /** Signed out: ask for another reset link. */
  onNewLink?: () => void;
  /** Inside a session the sheet has its own title. */
  hideTitle?: boolean;
  /**
   * Inside a session: the new password closed every session of the
   * account, this one too, so the caller signs out at once.
   */
  onResetDone?: () => void;
}

export const AccountLinkPanel: React.FC<AccountLinkPanelProps> = props =>
  props.link.purpose === 'reset' ? (
    <ResetPanel {...props} />
  ) : (
    <VerifyPanel {...props} />
  );

const Title: React.FC<{level: 1 | 2; hidden?: boolean; children: string}> = ({
  level,
  hidden,
  children,
}) => {
  if (hidden) return null;
  const Tag = level === 1 ? 'h1' : 'h2';
  return <Tag className="lx-gate__title">{children}</Tag>;
};

const ResetPanel: React.FC<AccountLinkPanelProps> = ({
  link,
  headingLevel,
  onDone,
  onNewLink,
  hideTitle,
  onResetDone,
}) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password, '');
    if (problem) {
      setError(problem);
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({token: link.token, newPassword: password});
      if (onResetDone) {
        onResetDone();
        return;
      }
      setDone(true);
    } catch (err) {
      if (isApiError(err) && err.fields?.token) {
        setLinkError(err.fields.token);
      } else if (isApiError(err) && err.fields?.newPassword) {
        setError(err.fields.newPassword);
        ref.current?.focus();
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        setError('Demasiados intentos. Espera unos minutos y vuelve a probar.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="lx-gate__status" id="lx-reset-done" role="status">
        <span className="lx-gate__icon" aria-hidden="true">
          <Icon name="check" size={26} />
        </span>
        <Title level={headingLevel} hidden={hideTitle}>
          Contraseña cambiada
        </Title>
        <p className="lx-gate__lead">
          Ya puedes entrar con la contraseña nueva. Por seguridad se han cerrado
          todas las sesiones abiertas de esta cuenta.
        </p>
        <div className="lx-gate__actions">
          <Button variant="primary" id="lx-reset-continue" onClick={onDone}>
            {headingLevel === 1 ? 'Ir a la entrada' : 'Continuar'}
          </Button>
        </div>
      </div>
    );
  }

  if (linkError) {
    return (
      <BadLink
        level={headingLevel}
        hideTitle={hideTitle}
        message={linkError}
        onDone={onDone}
        onNewLink={onNewLink}
      />
    );
  }

  return (
    <form
      className="lx-login-form"
      id="lx-reset-form"
      onSubmit={submit}
      noValidate
    >
      <Title level={headingLevel} hidden={hideTitle}>
        Elige una contraseña nueva
      </Title>
      <p className="lx-gate__lead">
        Este enlace sirve una vez y durante {RESET_LINK_MINUTES} minutos. Al
        guardarla se cierran todas las sesiones abiertas de la cuenta.
      </p>
      <PasswordField
        id="lx-reset-password"
        label="Contraseña nueva"
        autoComplete="new-password"
        inputRef={ref}
        autoFocus
        value={password}
        error={error}
        onChange={v => {
          setPassword(v);
          if (error) setError(null);
        }}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        id="lx-reset-submit"
        busy={busy}
      >
        {busy ? 'Guardando…' : 'Guardar contraseña'}
      </Button>
      <Button variant="ghost" id="lx-reset-cancel" onClick={onDone}>
        Ahora no
      </Button>
    </form>
  );
};

const VerifyPanel: React.FC<AccountLinkPanelProps> = ({
  link,
  headingLevel,
  onDone,
  hideTitle,
}) => {
  const [state, setState] = useState<
    | {status: 'busy'}
    | {status: 'done'}
    | {status: 'error'; message: string; badLink: boolean}
  >({status: 'busy'});
  const [attempt, setAttempt] = useState(0);
  const sent = useRef<number | null>(null);

  useEffect(() => {
    // Once per attempt, also under StrictMode's double effects.
    if (sent.current === attempt) return;
    sent.current = attempt;
    setState({status: 'busy'});
    api.verifyEmail({token: link.token}).then(
      () => setState({status: 'done'}),
      (err: unknown) => {
        const badLink = isApiError(err) && !!err.fields?.token;
        setState({
          status: 'error',
          badLink,
          message: badLink
            ? (err.fields?.token ?? BAD_LINK)
            : errorMessage(err),
        });
      },
    );
  }, [link.token, attempt]);

  if (state.status === 'busy') {
    return (
      <div className="lx-gate__status" id="lx-verify-busy" role="status">
        <Spinner label="Comprobando el enlace" />
        <Title level={headingLevel} hidden={hideTitle}>
          Comprobando el enlace…
        </Title>
      </div>
    );
  }
  if (state.status === 'error') {
    return state.badLink ? (
      <BadLink
        level={headingLevel}
        hideTitle={hideTitle}
        message={state.message}
        onDone={onDone}
        hint="Pide uno nuevo desde «Tu espacio en OxEye» › Seguridad › Correo de recuperación."
      />
    ) : (
      <div className="lx-gate__status" id="lx-verify-error" role="alert">
        <span className="lx-gate__icon lx-gate__icon--warn" aria-hidden="true">
          <Icon name="alert" size={26} />
        </span>
        <Title level={headingLevel} hidden={hideTitle}>
          No se ha podido comprobar
        </Title>
        <p className="lx-gate__lead">{state.message}</p>
        <div className="lx-gate__actions">
          <Button
            variant="primary"
            icon="refresh"
            id="lx-verify-retry"
            onClick={() => setAttempt(a => a + 1)}
          >
            Reintentar
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Ahora no
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="lx-gate__status" id="lx-verify-done" role="status">
      <span className="lx-gate__icon" aria-hidden="true">
        <Icon name="check" size={26} />
      </span>
      <Title level={headingLevel} hidden={hideTitle}>
        Correo verificado
      </Title>
      <p className="lx-gate__lead">
        Es tu correo de recuperación: si un día olvidas la contraseña, el enlace
        para elegir otra llegará ahí.
      </p>
      <div className="lx-gate__actions">
        <Button variant="primary" id="lx-verify-continue" onClick={onDone}>
          Continuar
        </Button>
      </div>
    </div>
  );
};

const BadLink: React.FC<{
  level: 1 | 2;
  hideTitle?: boolean;
  message: string;
  onDone: () => void;
  onNewLink?: () => void;
  hint?: string;
}> = ({level, hideTitle, message, onDone, onNewLink, hint}) => (
  <div className="lx-gate__status" id="lx-link-invalid" role="alert">
    <span className="lx-gate__icon lx-gate__icon--warn" aria-hidden="true">
      <Icon name="link" size={26} />
    </span>
    <Title level={level} hidden={hideTitle}>
      Este enlace ya no sirve
    </Title>
    <p className="lx-gate__lead">{message}</p>
    {hint && <p className="lx-muted">{hint}</p>}
    <div className="lx-gate__actions">
      {onNewLink && (
        <Button
          variant="primary"
          icon="send"
          id="lx-link-new"
          onClick={onNewLink}
        >
          Pedir un enlace nuevo
        </Button>
      )}
      <Button
        variant={onNewLink ? 'ghost' : 'primary'}
        id="lx-link-dismiss"
        onClick={onDone}
      >
        {onNewLink ? 'Volver a la entrada' : 'Continuar'}
      </Button>
    </div>
  </div>
);
