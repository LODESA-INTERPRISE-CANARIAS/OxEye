/**
 * F2 · Password recovery: username → the same neutral answer whether the
 * account exists or not → the e-mail with a single-use link → a new
 * password → done. The address the link goes to is never shown here.
 */
import React, {useState} from 'react';
import {Button, EyeMark, Field, Icon, Input} from '../../ui';
import {MockGate, PasswordInput, StrengthMeter, passwordStrength} from '../kit';

type Stage = 'ask' | 'sent' | 'mail' | 'new' | 'done';

export const RecoveryMock: React.FC<{
  onBack: () => void;
  onLogin: (notice: string) => void;
}> = ({onBack, onLogin}) => {
  const [stage, setStage] = useState<Stage>('ask');
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const strength = passwordStrength(pw);
  const n = {ask: 1, sent: 2, mail: 2, new: 3, done: 4}[stage];

  return (
    <MockGate
      id="mk-recovery"
      onBack={onBack}
      eyebrow={`Recuperar el acceso · ${n} de 4`}
    >
      {stage === 'ask' && (
        <form
          className="lx-mk-stack"
          onSubmit={e => {
            e.preventDefault();
            if (!username.trim()) {
              setError('Escribe tu usuario.');
              return;
            }
            setStage('sent');
          }}
          noValidate
        >
          <h1 className="lx-gate__title">¿Has olvidado tu contraseña?</h1>
          <p className="lx-gate__lead">
            Escribe tu usuario y te enviaremos un enlace para elegir una nueva.
            Nadie, ni los administradores, puede ver tu contraseña.
          </p>
          <Field id="mk-rec-user" label="Usuario" error={error}>
            <Input
              id="mk-rec-user"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              invalid={!!error}
              onChange={e => {
                setUsername(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            id="mk-rec-send"
          >
            Enviar el enlace
          </Button>
          <button
            type="button"
            className="lx-mk-link-btn"
            onClick={() => onLogin('')}
          >
            Volver a entrar
          </button>
        </form>
      )}

      {stage === 'sent' && (
        <div className="lx-mk-stack" id="mk-rec-sent">
          <span className="lx-gate__icon" aria-hidden="true">
            <Icon name="mail" size={26} />
          </span>
          <h1 className="lx-gate__title">Revisa tu correo</h1>
          <p className="lx-gate__lead">
            Si <strong>{username.trim()}</strong> es un usuario de Ox Eye, hemos
            enviado un enlace a su correo de recuperación. Caduca en 30 minutos
            y solo sirve una vez.
          </p>
          <p className="lx-notice">
            <Icon name="question" size={18} />
            <span>
              ¿No llega? Mira en «Spam». Si tu cuenta no tiene correo de
              recuperación, el enlace va al buzón del proyecto: pídeselo a un
              administrador.
            </span>
          </p>
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => setStage('mail')}
            id="mk-rec-open-mail"
          >
            Maqueta: abrir el correo recibido
          </Button>
          <button
            type="button"
            className="lx-mk-link-btn"
            onClick={() => setStage('ask')}
          >
            Probar con otro usuario
          </button>
        </div>
      )}

      {stage === 'mail' && (
        <div className="lx-mk-stack" id="mk-rec-mail">
          <p className="lx-mk-legend">Así llega el correo (simulado)</p>
          <article className="lx-mk-email" aria-label="Correo de recuperación">
            <header className="lx-mk-email__head">
              <EyeMark size={30} />
              <div>
                <p>
                  <strong>Ox Eye</strong> &lt;no-reply@example.com&gt;
                </p>
                <p className="lx-muted">Restablece tu contraseña de Ox Eye</p>
              </div>
            </header>
            <div className="lx-mk-email__body">
              <p>Hola:</p>
              <p>
                Alguien ha pedido restablecer la contraseña de la cuenta{' '}
                <strong>{username.trim() || 'Yeray'}</strong>. Si has sido tú,
                pulsa el botón. El enlace caduca en 30 minutos y solo funciona
                una vez.
              </p>
              <Button
                variant="primary"
                onClick={() => setStage('new')}
                id="mk-rec-link"
              >
                Elegir una contraseña nueva
              </Button>
              <p className="lx-muted">
                Si no lo has pedido tú, ignora este correo: tu contraseña no
                cambia.
              </p>
            </div>
          </article>
        </div>
      )}

      {stage === 'new' && (
        <form
          className="lx-mk-stack"
          onSubmit={e => {
            e.preventDefault();
            if (strength.score < 2) {
              setError('Elige una contraseña más larga o con más palabras.');
              return;
            }
            if (pw !== pw2) {
              setError('Las dos contraseñas no coinciden.');
              return;
            }
            setStage('done');
          }}
          noValidate
        >
          <h1 className="lx-gate__title">Elige tu nueva contraseña</h1>
          <p className="lx-gate__lead">
            Solo la sabrás tú. No hace falta que se la digas a nadie.
          </p>
          <Field id="mk-rec-pw" label="Contraseña nueva">
            <PasswordInput
              id="mk-rec-pw"
              value={pw}
              onChange={setPw}
              autoComplete="new-password"
              describedBy="mk-rec-strength"
            />
          </Field>
          <StrengthMeter password={pw} id="mk-rec-strength" />
          <Field id="mk-rec-pw2" label="Repítela" error={error}>
            <PasswordInput
              id="mk-rec-pw2"
              value={pw2}
              onChange={v => {
                setPw2(v);
                setError(null);
              }}
              autoComplete="new-password"
              invalid={!!error}
              describedBy={error ? 'mk-rec-pw2-error' : undefined}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            id="mk-rec-save"
          >
            Guardar contraseña
          </Button>
        </form>
      )}

      {stage === 'done' && (
        <div className="lx-mk-stack" id="mk-rec-done">
          <span className="lx-gate__icon" aria-hidden="true">
            <Icon name="check" size={26} />
          </span>
          <h1 className="lx-gate__title">Contraseña cambiada</h1>
          <p className="lx-gate__lead">
            Ya puedes entrar con ella. Por seguridad hemos cerrado tus sesiones
            abiertas en otros dispositivos y lo hemos apuntado en tu historial
            de seguridad.
          </p>
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => onLogin('Contraseña cambiada. Entra con la nueva.')}
          >
            Entrar
          </Button>
        </div>
      )}
    </MockGate>
  );
};
