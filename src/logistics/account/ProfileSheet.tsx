/**
 * «Tu espacio en Ox Eye» (Revisión 1 · E4): the own account.
 * - Perfil: photo, display name, bio, accent.
 * - Seguridad: password, recovery e-mail, open sessions.
 * - Actividad: the own security history and the latest own changes.
 * Not for the guest account nor during a support session (the server
 * refuses `/me/*` there).
 */
import React, {useState} from 'react';
import type {SessionInfo} from '../../../shared/logistics/contracts.ts';
import {describeChange} from '../../../shared/logistics/history.ts';
import {DEFAULT_TIMEZONE} from '../../../shared/logistics/time.ts';
import {errorMessage} from '../api/client';
import {api} from '../api/endpoints';
import {instantShort, relativeTime} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Chip, Icon, LoadError, Sheet, SkeletonRows} from '../ui';
import {roleSummary} from './access';
import type {ProfileTab} from './accountUi';
import {PasswordChangeForm} from './PasswordChangeForm';
import {ProfileEditor} from './ProfileEditor';
import {RecoveryEmail} from './RecoveryEmail';
import {SecurityList} from './SecurityList';
import {Signature} from './Signature';
import {TabPanel, Tabs} from './Tabs';
import {useAccess} from './useAccess';
import {useLoad} from './useLoad';
import {UserAvatar} from './UserAvatar';

const ID = 'lx-profile';

export const ProfileSheet: React.FC<{
  tab: ProfileTab;
  focus?: 'password' | 'email';
  onClose: () => void;
}> = ({tab: initialTab, focus, onClose}) => {
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const access = useAccess();
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const profile = useLoad(token => api.profile(token), 'profile');

  return (
    <Sheet
      open
      onClose={onClose}
      title="Tu espacio en Ox Eye"
      eyebrow={
        user
          ? `${user.displayName} · ${
              // «Equipo · Equipo» says nothing; say what kind of account it is.
              access.shared ? 'Cuenta compartida' : roleSummary(access)
            }`
          : undefined
      }
      size="tall"
      id={`${ID}-sheet`}
      className="lx-acct-sheet"
    >
      <Tabs<ProfileTab>
        idPrefix={ID}
        label="Secciones de tu espacio"
        value={tab}
        onChange={setTab}
        items={[
          {value: 'perfil', label: 'Perfil', icon: 'user'},
          {value: 'seguridad', label: 'Seguridad', icon: 'lock'},
          {value: 'actividad', label: 'Actividad', icon: 'history'},
        ]}
      />
      <TabPanel idPrefix={ID} value={tab}>
        {tab === 'actividad' ? (
          <ActivityTab />
        ) : profile.status === 'error' && !profile.data ? (
          <LoadError message={profile.message} onRetry={profile.reload} />
        ) : !profile.data ? (
          <SkeletonRows rows={4} label="Cargando tu perfil" />
        ) : tab === 'perfil' ? (
          <section aria-label="Perfil">
            <ProfileEditor
              key={profile.data.version}
              idPrefix={`${ID}-edit`}
              profile={profile.data}
              onSaved={profile.set}
              onStale={profile.reload}
            />
          </section>
        ) : (
          <div className="lx-acct-sections">
            <section
              className="lx-acct-section"
              aria-labelledby={`${ID}-password-title`}
            >
              <h3
                className="lx-acct-section__title"
                id={`${ID}-password-title`}
              >
                Contraseña
              </h3>
              {profile.data.sharedAccount ? (
                // One person changing it would lock the rest of the team out.
                <p
                  className="lx-notice lx-notice--quiet"
                  id={`${ID}-password-shared`}
                >
                  <Icon name="user" size={18} />
                  La contraseña de {profile.data.user.displayName} la pone
                  administración: es una cuenta compartida y la usan varias
                  personas. Si hay que cambiarla, pídeselo.
                </p>
              ) : (
                <>
                  {user?.passwordProvisional && (
                    <p className="lx-notice" id={`${ID}-provisional`}>
                      <Icon name="lock" size={18} />
                      Tu contraseña es provisional: la puso otra persona. Elige
                      una tuya para desbloquear lo sensible (presupuestos,
                      aprobaciones, usuarios).
                    </p>
                  )}
                  <PasswordChangeForm
                    idPrefix={`${ID}-password`}
                    autoFocus={focus === 'password'}
                    onDone={profile.reload}
                  />
                </>
              )}
            </section>
            <section
              className="lx-acct-section"
              aria-labelledby={`${ID}-email-title`}
            >
              <h3 className="lx-acct-section__title" id={`${ID}-email-title`}>
                Correo de recuperación
              </h3>
              <RecoveryEmail
                idPrefix={ID}
                profile={profile.data}
                onChanged={profile.reload}
              />
            </section>
            <Sessions shared={profile.data.sharedAccount} />
          </div>
        )}
      </TabPanel>
    </Sheet>
  );
};

const KIND_LABEL: Record<SessionInfo['kind'], string> = {
  normal: '',
  support: 'Sesión de soporte',
  view_as_guest: 'Vista como Invitado',
};

/**
 * `shared`: the sessions of a shared account are the team's phones, so only
 * «Cerrar esta» is offered; closing the others would sign colleagues out.
 */
const Sessions: React.FC<{shared: boolean}> = ({shared}) => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const logout = useLogisticsStore(s => s.logout);
  const toast = useLogisticsStore(s => s.toast);
  const timeZone = useTimeZone();
  const list = useLoad(t => api.sessions(t), 'sessions');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const end = async (id: string | 'others') => {
    if (!token) return;
    setBusy(id);
    setError(null);
    try {
      if (id === 'others') await api.endOtherSessions(token);
      else await api.endSession(token, id);
      toast(
        id === 'others'
          ? 'Se han cerrado tus otras sesiones.'
          : 'Sesión cerrada.',
        'success',
      );
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const items = list.data?.items ?? [];
  const others = items.filter(s => !s.current).length;
  return (
    <section
      className="lx-acct-section"
      aria-labelledby={`${ID}-sessions-title`}
      id={`${ID}-sessions`}
    >
      <div className="lx-acct-section__head">
        <h3 className="lx-acct-section__title" id={`${ID}-sessions-title`}>
          Sesiones abiertas
        </h3>
        {others > 0 && !shared && (
          <Button
            size="sm"
            variant="ghost"
            icon="logout"
            id={`${ID}-sessions-others`}
            busy={busy === 'others'}
            onClick={() => void end('others')}
          >
            Cerrar las demás
          </Button>
        )}
      </div>
      {list.status === 'error' && !list.data ? (
        <LoadError message={list.message} onRetry={list.reload} />
      ) : !list.data ? (
        <SkeletonRows rows={2} label="Cargando sesiones" />
      ) : (
        <ul className="lx-acct-list">
          {items.map(s => (
            <li
              key={s.id}
              className="lx-acct-row"
              data-session-id={s.id}
              data-current={s.current || undefined}
            >
              <Icon name={s.kind === 'normal' ? 'phone' : 'user'} size={20} />
              <span className="lx-acct-row__main">
                <strong>
                  {s.device ?? 'Dispositivo sin identificar'}
                  {s.current && (
                    <>
                      {' '}
                      <Chip tag tone="accent" size="sm">
                        Esta sesión
                      </Chip>
                    </>
                  )}
                </strong>
                <span className="lx-muted">
                  {KIND_LABEL[s.kind]
                    ? `${KIND_LABEL[s.kind]}${
                        s.openedBy
                          ? ` · abierta por ${s.openedBy.displayName}`
                          : ''
                      } · `
                    : ''}
                  Activa {relativeTime(s.lastSeenAt, timeZone)} · desde{' '}
                  <span className="lx-num">
                    {instantShort(s.createdAt, timeZone)}
                  </span>
                </span>
              </span>
              <Button
                size="sm"
                variant={s.current ? 'secondary' : 'ghost'}
                busy={busy === s.id}
                aria-label={
                  s.current
                    ? 'Cerrar esta sesión'
                    : `Cerrar la sesión de ${s.device ?? 'otro dispositivo'}`
                }
                onClick={() => (s.current ? void logout() : void end(s.id))}
              >
                {s.current ? 'Cerrar esta' : 'Cerrar'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="lx-field__error" role="alert">
          {error}
        </p>
      )}
      <p className="lx-muted lx-acct-note">
        {shared
          ? '¿Ves un dispositivo que no reconoces? Ciérralo y avisa a administración para que cambie la contraseña.'
          : '¿Ves un dispositivo que no reconoces? Ciérralo y cambia tu contraseña.'}
      </p>
    </section>
  );
};

function useTimeZone(): string {
  return useLogisticsStore(
    s =>
      s.organizations.find(o => o.id === s.orgId)?.timezone || DEFAULT_TIMEZONE,
  );
}

const ActivityTab: React.FC = () => {
  const userId = useLogisticsStore(s => s.session?.user.id ?? null);
  const activity = useLogisticsStore(s => s.activity);
  const timeZone = useTimeZone();
  const security = useLoad(t => api.ownSecurity(t), 'own-security');
  const mine = activity.filter(a => a.user.id === userId).slice(0, 10);
  const name = useLogisticsStore(s => s.session?.user.displayName ?? '');
  return (
    <div className="lx-acct-sections">
      <section className="lx-acct-section" aria-labelledby={`${ID}-sec-title`}>
        <h3 className="lx-acct-section__title" id={`${ID}-sec-title`}>
          Historial de seguridad
        </h3>
        <p className="lx-muted lx-acct-note">
          Entradas, cambios de contraseña y sesiones de soporte en tu cuenta. Si
          algo no te suena, avisa a administración.
        </p>
        {security.status === 'error' && !security.data ? (
          <LoadError message={security.message} onRetry={security.reload} />
        ) : !security.data ? (
          <SkeletonRows rows={3} label="Cargando el historial" />
        ) : (
          <SecurityList
            id={`${ID}-security`}
            items={security.data.items}
            timeZone={timeZone}
            emptyText="Todavía no hay nada registrado."
          />
        )}
      </section>
      <section className="lx-acct-section" aria-labelledby={`${ID}-act-title`}>
        <h3 className="lx-acct-section__title" id={`${ID}-act-title`}>
          Tus últimos cambios
        </h3>
        {mine.length === 0 ? (
          <p className="lx-muted" id={`${ID}-activity-empty`}>
            En la actividad reciente de la organización no hay cambios tuyos.
          </p>
        ) : (
          <ol className="lx-acct-log" id={`${ID}-activity`}>
            {mine.map(a => (
              <li key={a.id} className="lx-acct-log__item">
                <UserAvatar name={name} userId={userId} size="sm" />
                <p className="lx-acct-log__text">
                  <span>
                    {describeChange(a)} <strong>«{a.entityLabel}»</strong>
                  </span>
                  {a.supportBy && (
                    <span className="lx-muted">
                      Firmado:{' '}
                      <Signature
                        user={a.user}
                        supportBy={a.supportBy}
                        strong={false}
                      />
                    </span>
                  )}
                </p>
                <time
                  className="lx-acct-log__time lx-num"
                  dateTime={a.at}
                  title={instantShort(a.at, timeZone)}
                >
                  {relativeTime(a.at, timeZone)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};
