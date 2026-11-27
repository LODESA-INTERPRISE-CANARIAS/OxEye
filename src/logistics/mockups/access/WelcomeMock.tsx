/**
 * F2 · First login after personal accounts: a short welcome that invites to
 * set up the profile and asks whether to keep the provisional password for
 * now or choose a private one.
 */
import React, {useState} from 'react';
import {Button, Chip, Field, Icon, Input, Textarea} from '../../ui';
import {ChoiceCards, MockGate} from '../kit';
import type {Me} from './me';
import {NewPasswordForm, PhotoPicker} from './parts';

type Stage = 'hello' | 'password' | 'profile';

export const WelcomeMock: React.FC<{
  me: Me;
  setMe: (patch: Partial<Me>) => void;
  onBack: () => void;
  onDone: (notice: string) => void;
}> = ({me, setMe, onBack, onDone}) => {
  const [stage, setStage] = useState<Stage>('hello');
  const [choice, setChoice] = useState<'new' | 'keep' | null>(null);
  const [name, setName] = useState(me.displayName);
  const [email, setEmail] = useState(me.email);
  const [about, setAbout] = useState(me.description);
  const index = {hello: 1, password: 2, profile: choice === 'keep' ? 2 : 3}[
    stage
  ];
  const total = choice === 'keep' ? 2 : 3;

  return (
    <MockGate
      id="mk-welcome"
      onBack={onBack}
      wide
      eyebrow="Primer inicio de sesión"
    >
      <ol className="lx-mk-dots" aria-label={`Paso ${index} de ${total}`}>
        {Array.from({length: total}, (_, i) => (
          <li
            key={i}
            data-state={
              i + 1 < index ? 'done' : i + 1 === index ? 'now' : undefined
            }
          />
        ))}
      </ol>

      {stage === 'hello' && (
        <div className="lx-mk-stack">
          <h1 className="lx-gate__title">
            Bienvenido a tu espacio, {me.displayName}
          </h1>
          <p className="lx-gate__lead">
            OxEye ahora tiene cuentas personales. Tu usuario sigue siendo{' '}
            <strong>{me.username}</strong> y todo lo que has registrado sigue
            firmado con tu nombre.
          </p>
          <section className="lx-mk-callout" aria-labelledby="mk-prov-title">
            <span className="lx-mk-callout__icon" aria-hidden="true">
              <Icon name="lock" size={22} />
            </span>
            <div>
              <h2 id="mk-prov-title">Tu contraseña es provisional</h2>
              <p>
                Es la que te dio el equipo al empezar el piloto. Mientras sea
                provisional podrás usar el Gestor, pero no verás presupuestos,
                gastos, contactos ni precios.
              </p>
            </div>
          </section>
          <ChoiceCards<'new' | 'keep'>
            name="mk-welcome-choice"
            legend="¿Qué prefieres?"
            value={choice}
            onChange={setChoice}
            columns={2}
            options={[
              {
                value: 'new',
                label: 'Elegir una nueva ahora',
                sub: 'Recomendado · solo la sabrás tú',
                icon: 'lock',
              },
              {
                value: 'keep',
                label: 'Mantener la provisional por ahora',
                sub: 'Te lo recordaremos; lo sensible seguirá oculto',
                icon: 'clock',
              },
            ]}
          />
          <div className="lx-gate__actions">
            <Button
              variant="primary"
              size="lg"
              disabled={!choice}
              id="mk-welcome-next"
              onClick={() =>
                setStage(choice === 'new' ? 'password' : 'profile')
              }
            >
              Seguir
            </Button>
          </div>
        </div>
      )}

      {stage === 'password' && (
        <div className="lx-mk-stack">
          <h1 className="lx-gate__title">Elige tu contraseña</h1>
          <p className="lx-gate__lead">
            Una frase de tres o cuatro palabras es más fácil de recordar y más
            difícil de adivinar. No tienes que decírsela a nadie.
          </p>
          <NewPasswordForm
            idPrefix="mk-wpw"
            askCurrent={false}
            submitLabel="Guardar y seguir"
            onCancel={() => setStage('hello')}
            onDone={() => {
              setMe({provisional: false});
              setStage('profile');
            }}
          />
        </div>
      )}

      {stage === 'profile' && (
        <div className="lx-mk-stack">
          <h1 className="lx-gate__title">Prepara tu perfil</h1>
          <p className="lx-gate__lead">
            Tu foto y tu nombre aparecerán en tus tareas, notas y en el
            historial. Puedes cambiarlo cuando quieras.
          </p>
          <div className="lx-mk-welcome-profile">
            <PhotoPicker
              me={{...me, displayName: name || me.displayName}}
              onPhoto={photo => setMe({photo})}
            />
            <div className="lx-mk-stack">
              <Field id="mk-w-name" label="Nombre visible">
                <Input
                  id="mk-w-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </Field>
              <Field
                id="mk-w-email"
                label="Correo de recuperación"
                optional
                hint="Te enviaremos un enlace para confirmarlo. Solo se usa si olvidas tu contraseña."
              >
                <Input
                  id="mk-w-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="nombre@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  aria-describedby="mk-w-email-hint"
                />
              </Field>
              <Field id="mk-w-about" label="Una línea sobre ti" optional>
                <Textarea
                  id="mk-w-about"
                  rows={2}
                  maxLength={140}
                  placeholder="Por ejemplo: Coordinación de montaje"
                  value={about}
                  onChange={e => setAbout(e.target.value)}
                />
              </Field>
            </div>
          </div>
          {me.provisional && (
            <p className="lx-notice">
              <Icon name="alert" size={18} />
              <span>
                Sigues con la contraseña provisional. Podrás cambiarla desde tu
                perfil, en «Seguridad».
              </span>
            </p>
          )}
          <div className="lx-gate__actions">
            <Button
              onClick={() =>
                onDone('Puedes completar tu perfil cuando quieras.')
              }
            >
              Ahora no
            </Button>
            <Button
              variant="primary"
              size="lg"
              id="mk-welcome-done"
              onClick={() => {
                setMe({
                  displayName: name.trim() || me.displayName,
                  email: email.trim(),
                  emailState: email.trim() ? 'pending' : 'none',
                  description: about.trim(),
                });
                onDone(
                  email.trim()
                    ? 'Perfil guardado. Te hemos enviado un enlace para verificar tu correo.'
                    : 'Perfil guardado.',
                );
              }}
            >
              Guardar y entrar
            </Button>
          </div>
          <p className="lx-mk-privacy-line">
            <Chip tag tone="neutral" size="sm">
              Maqueta
            </Chip>{' '}
            La foto se queda en este navegador; no se sube a ningún sitio.
          </p>
        </div>
      )}
    </MockGate>
  );
};
