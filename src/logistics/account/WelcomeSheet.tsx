/**
 * First sign-in (Revisión 1 · E4, `welcomed: false`): two short steps.
 * 1. The password: keep the provisional one for now or choose one's own.
 *    A provisional password only holds back what is sensitive.
 * 2. A quick profile: photo, display name, bio and, for personal accounts,
 *    a recovery e-mail.
 * «Empezar» (or «Saltar») records the welcome (`POST /me/welcome`); closing
 * it shows it again at the next sign-in.
 */
import React, {useState} from 'react';
import {errorMessage} from '../api/client';
import {api} from '../api/endpoints';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, LoadError, Sheet, SkeletonRows} from '../ui';
import {PasswordChangeForm} from './PasswordChangeForm';
import {ProfileEditor} from './ProfileEditor';
import {RecoveryEmail} from './RecoveryEmail';
import {useAccess} from './useAccess';
import {useLoad} from './useLoad';

const ID = 'lx-welcome';

export const WelcomeSheet: React.FC<{onClose: () => void}> = ({onClose}) => {
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const refreshAccount = useLogisticsStore(s => s.refreshAccount);
  const toast = useLogisticsStore(s => s.toast);
  // Shared accounts (Equipo) never choose their password: administration
  // sets it for the whole team.
  const shared = useAccess().shared;
  const provisional = user?.passwordProvisional === true && !shared;
  const [step, setStep] = useState<'password' | 'profile'>(
    provisional ? 'password' : 'profile',
  );
  const [choosing, setChoosing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = useLoad(t => api.profile(t), 'welcome-profile');
  const steps = provisional ? 2 : 1;
  const index = step === 'password' ? 1 : steps;

  const finish = async () => {
    if (!token) return;
    setFinishing(true);
    setError(null);
    try {
      await api.markWelcomed(token);
      await refreshAccount();
      toast(
        'Todo listo. Puedes cambiarlo cuando quieras en «Tu espacio».',
        'success',
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Te damos la bienvenida, ${user?.displayName ?? ''}`}
      eyebrow={
        steps > 1
          ? `Primer acceso · paso ${index} de ${steps}`
          : 'Primer acceso'
      }
      size="md"
      id={`${ID}-sheet`}
      className="lx-acct-sheet"
    >
      {step === 'password' ? (
        <div className="lx-acct-sections" id={`${ID}-password-step`}>
          <p className="lx-acct-lead">
            Has entrado con una <strong>contraseña provisional</strong>: la puso
            administración o desarrollo para darte acceso.
          </p>
          <ul className="lx-acct-facts">
            <li>
              <Icon name="check" size={18} />
              <span>
                Con ella ya puedes consultar y registrar el plan: eventos,
                tareas, inventarios, notas.
              </span>
            </li>
            <li>
              <Icon name="lock" size={18} />
              <span>
                Lo sensible (presupuestos, aprobación de ofertas, usuarios)
                queda bloqueado hasta que elijas una contraseña tuya.
              </span>
            </li>
          </ul>
          {choosing ? (
            <PasswordChangeForm
              idPrefix={`${ID}-password`}
              autoFocus
              submitLabel="Guardar y seguir"
              onDone={() => setStep('profile')}
            />
          ) : (
            <div className="lx-acct-choices">
              <Button
                variant="primary"
                size="lg"
                icon="lock"
                id={`${ID}-choose`}
                onClick={() => setChoosing(true)}
              >
                Elegir mi contraseña ahora
              </Button>
              <Button
                size="lg"
                id={`${ID}-keep`}
                onClick={() => setStep('profile')}
              >
                Seguir con la provisional por ahora
              </Button>
            </div>
          )}
        </div>
      ) : profile.status === 'error' && !profile.data ? (
        <LoadError message={profile.message} onRetry={profile.reload} />
      ) : !profile.data ? (
        <SkeletonRows rows={4} label="Cargando tu perfil" />
      ) : (
        <div className="lx-acct-sections" id={`${ID}-profile-step`}>
          <p className="lx-acct-lead">
            {profile.data.sharedAccount
              ? 'Es una cuenta compartida por varias personas del equipo: su nombre, su foto y su contraseña los pone administración.'
              : 'Así te verá el equipo en tareas, notas e historial. Todo es opcional y se cambia luego en «Tu espacio en Ox Eye».'}
          </p>
          <ProfileEditor
            key={profile.data.version}
            idPrefix={`${ID}-edit`}
            profile={profile.data}
            onSaved={profile.set}
            onStale={profile.reload}
            footer={(save, busy) => (
              <>
                {!profile.data?.sharedAccount && (
                  <section
                    className="lx-acct-section"
                    aria-labelledby={`${ID}-email-title`}
                  >
                    <h3
                      className="lx-acct-section__title"
                      id={`${ID}-email-title`}
                    >
                      Correo de recuperación
                    </h3>
                    {profile.data && (
                      <RecoveryEmail
                        idPrefix={ID}
                        profile={profile.data}
                        onChanged={profile.reload}
                      />
                    )}
                  </section>
                )}
                {error && (
                  <p className="lx-notice lx-notice--error" role="alert">
                    <Icon name="alert" size={18} />
                    {error}
                  </p>
                )}
                <div className="lx-acct-actions lx-acct-actions--end">
                  <Button
                    variant="ghost"
                    id={`${ID}-skip`}
                    disabled={busy || finishing}
                    onClick={() => void finish()}
                  >
                    Saltar
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    id={`${ID}-start`}
                    busy={busy || finishing}
                    onClick={() =>
                      void save().then(ok => {
                        if (ok) void finish();
                      })
                    }
                  >
                    Empezar
                  </Button>
                </div>
              </>
            )}
          />
        </div>
      )}
    </Sheet>
  );
};
