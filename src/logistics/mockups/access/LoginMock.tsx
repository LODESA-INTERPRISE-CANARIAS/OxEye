/**
 * F2 · Login with a typed username and password: no list of people. The
 * error never says whether the user exists.
 */
import React, {useState} from 'react';
import {Button, Field, Icon, Input} from '../../ui';
import {USERS} from '../data';
import {MockGate, PasswordInput} from '../kit';

export const LoginMock: React.FC<{
  onBack: () => void;
  onForgot: () => void;
  onLogin: (username: string) => void;
  notice?: string | null;
}> = ({onBack, onForgot, onLogin, notice}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Escribe tu usuario y tu contraseña.');
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      const user = USERS.find(
        u =>
          u.username.toLocaleLowerCase('es-ES') ===
          username.trim().toLocaleLowerCase('es-ES'),
      );
      if (!user || password.length < 4) {
        setPassword('');
        setError(
          'Usuario o contraseña incorrectos. Revísalos e inténtalo de nuevo.',
        );
        return;
      }
      onLogin(user.username);
    }, 450);
  };

  return (
    <MockGate id="mk-login" onBack={onBack}>
      <h1 className="lx-gate__title">Entra en OxEye</h1>
      <p className="lx-gate__lead">
        Con tu usuario y tu contraseña. Cada cambio quedará firmado con tu
        nombre.
      </p>
      {notice && (
        <p className="lx-notice lx-notice--success" role="status">
          <Icon name="check" size={18} />
          {notice}
        </p>
      )}
      <form className="lx-login-form lx-mk-stack" onSubmit={submit} noValidate>
        <Field id="mk-login-user" label="Usuario">
          <Input
            id="mk-login-user"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            invalid={!!error && !username.trim()}
            onChange={e => {
              setUsername(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field id="mk-login-password" label="Contraseña" error={error}>
          <PasswordInput
            id="mk-login-password"
            value={password}
            onChange={v => {
              setPassword(v);
              setError(null);
            }}
            autoComplete="current-password"
            invalid={!!error}
            describedBy={error ? 'mk-login-password-error' : undefined}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          busy={busy}
          id="mk-login-submit"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
        <button
          type="button"
          className="lx-mk-link-btn"
          id="mk-forgot"
          onClick={onForgot}
        >
          ¿Has olvidado tu contraseña?
        </button>
      </form>
      <aside className="lx-mk-hint" aria-label="Cómo probar la maqueta">
        <p className="lx-eyebrow">Para probar la maqueta</p>
        <p>
          <code>Yeray</code> entra por primera vez (contraseña provisional) y ve
          la bienvenida; <code>Fabián</code> entra directo a su perfil.
          Cualquier contraseña de 4 letras o más sirve.
        </p>
      </aside>
    </MockGate>
  );
};
