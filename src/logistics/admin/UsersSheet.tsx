/**
 * «Usuarios» (Revisión 1 · E4, `users.manage`): the people of the
 * organizations the viewer manages, and the security log.
 * - Roles per organization (administrators only; one's own administrator
 *   role stays; the server keeps at least one administrator).
 * - Help someone back in: a provisional password (shown once) or a reset
 *   link (shown when the server has no mail transport).
 * - «Sesión de soporte» on someone's account (`support.start`), and
 *   «Ver como Invitado» (`view_as_guest`).
 * Nothing here is ever cached on the device.
 */
import React, {useContext, useRef, useState} from 'react';
import type {
  AdminProfileInput,
  AdminUser,
  Organization,
  OrgRole,
  SupportSession,
} from '../../../shared/logistics/contracts.ts';
import {DISPLAY_NAME_MAX} from '../../../shared/logistics/account.ts';
import {
  ORG_ROLES,
  ROLE_LABEL,
  isDeveloper,
  normalizeRoles,
  rolePermissions,
} from '../../../shared/logistics/permissions.ts';
import {DEFAULT_TIMEZONE} from '../../../shared/logistics/time.ts';
import {VIEW_AS_GUEST_MINUTES} from '../../../shared/logistics/account.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {countdown, secondsLeft} from '../account/access';
import {NoAccess} from '../account/NoAccess';
import {SecurityList} from '../account/SecurityList';
import {TabPanel, Tabs} from '../account/Tabs';
import {useAccess} from '../account/useAccess';
import {useLoad} from '../account/useLoad';
import {refreshMembers} from '../account/members';
import {UserAvatar} from '../account/UserAvatar';
import {ActionsContext} from '../common/actions';
import {forgetMedia} from '../inventory/media-cache';
import {PhotoError, preparePhoto} from '../inventory/photo-prepare';
import {instantShort, relativeTime} from '../lib/format';
import {isUnresolved} from '../offline/local';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  Field,
  HelpTip,
  Icon,
  Input,
  LoadError,
  Sheet,
  SkeletonRows,
  describedBy,
} from '../ui';
import {SupportSheet} from './SupportSheet';

const ID = 'lx-users';

type Tab = 'personas' | 'registro';

const ROLE_HELP: Record<OrgRole, string> = {
  admin:
    'Todo, incluidos roles, aprobación de ofertas, presupuestos y sesiones de soporte.',
  developer:
    'Va siempre con administración: gestiona todas las contraseñas y ve el diagnóstico técnico. Sus roles son fijos.',
  team: 'Edita el plan y consulta Contactos y Catálogo.',
};

export const UsersSheet: React.FC<{onClose: () => void}> = ({onClose}) => {
  const access = useAccess();
  const [tab, setTab] = useState<Tab>('personas');
  const [support, setSupport] = useState<AdminUser | null>(null);
  const allowed = access.can('users.manage');

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title="Usuarios"
        eyebrow="Roles y acceso"
        size="tall"
        id={`${ID}-sheet`}
        className="lx-acct-sheet"
      >
        {!allowed ? (
          <NoAccess permission="users.manage" id={`${ID}-noaccess`} compact />
        ) : (
          <>
            <Tabs<Tab>
              idPrefix={ID}
              label="Secciones de usuarios"
              value={tab}
              onChange={setTab}
              items={[
                {value: 'personas', label: 'Personas', icon: 'contacts'},
                {
                  value: 'registro',
                  label: 'Registro de seguridad',
                  icon: 'history',
                },
              ]}
            />
            <TabPanel idPrefix={ID} value={tab}>
              {tab === 'personas' ? (
                <People onSupport={setSupport} onDone={onClose} />
              ) : (
                <SecurityTab />
              )}
            </TabPanel>
          </>
        )}
      </Sheet>
      {support && (
        <SupportSheet
          target={support}
          onClose={() => setSupport(null)}
          onStarted={() => {
            setSupport(null);
            onClose();
          }}
        />
      )}
    </>
  );
};

function useTimeZone(): string {
  return useLogisticsStore(
    s =>
      s.organizations.find(o => o.id === s.orgId)?.timezone || DEFAULT_TIMEZONE,
  );
}

const People: React.FC<{
  onSupport: (user: AdminUser) => void;
  onDone: () => void;
}> = ({onSupport, onDone}) => {
  const access = useAccess();
  const session = useLogisticsStore(s => s.session);
  const beginSupport = useLogisticsStore(s => s.beginSupport);
  const orgId = useLogisticsStore(s => s.orgId);
  const list = useLoad(t => api.adminUsers(t), 'admin-users');
  const unsent = useUnsent();
  const [open, setOpen] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);

  const viewAsGuest = async () => {
    // Never open a session on the server that could not be used.
    if (!session || unsent > 0) return;
    setGuestBusy(true);
    setGuestError(null);
    try {
      const res = await api.viewAsGuest(session.token, {
        organizationId: orgId ?? undefined,
      });
      await beginSupport(res, VIEW_AS_GUEST_MINUTES);
      onDone();
    } catch (err) {
      setGuestError(errorMessage(err));
    } finally {
      setGuestBusy(false);
    }
  };

  const update = (user: AdminUser) => {
    if (!list.data) return;
    list.set({
      ...list.data,
      items: list.data.items.map(u => (u.id === user.id ? user : u)),
    });
  };

  const items = list.data?.items ?? [];
  return (
    <div className="lx-acct-sections">
      {unsent > 0 &&
        (access.can('view_as_guest') || access.can('support.start')) && (
          <UnsentNotice count={unsent} />
        )}
      {access.can('view_as_guest') && (
        <div className="lx-acct-callout" id={`${ID}-guest`}>
          <span className="lx-acct-callout__text">
            <strong>Ver como Invitado</strong>
            <span className="lx-muted">
              Comprueba qué ve quien entra con el usuario compartido de solo
              lectura, durante {VIEW_AS_GUEST_MINUTES} minutos como máximo.
            </span>
          </span>
          <Button
            icon="eye"
            id={`${ID}-view-as-guest`}
            busy={guestBusy}
            disabled={unsent > 0}
            aria-describedby={unsent > 0 ? UNSENT_ID : undefined}
            onClick={() => void viewAsGuest()}
          >
            Ver como Invitado
          </Button>
          {guestError && (
            <p className="lx-field__error" role="alert">
              {guestError}
            </p>
          )}
        </div>
      )}
      {list.status === 'error' && !list.data ? (
        <LoadError message={list.message} onRetry={list.reload} />
      ) : !list.data ? (
        <SkeletonRows rows={4} label="Cargando usuarios" />
      ) : items.length === 0 ? (
        <p className="lx-muted">
          No hay personas en las organizaciones que gestionas.
        </p>
      ) : (
        <ul className="lx-users" id={`${ID}-list`}>
          {items.map(u => (
            <UserRow
              key={u.id}
              user={u}
              me={session?.user.id === u.id}
              open={open === u.id}
              onToggle={() => setOpen(o => (o === u.id ? null : u.id))}
              onChange={update}
              onSupport={() => onSupport(u)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const UserRow: React.FC<{
  user: AdminUser;
  me: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (user: AdminUser) => void;
  onSupport: () => void;
}> = ({user, me, open, onToggle, onChange, onSupport}) => {
  const timeZone = useTimeZone();
  const guest = user.role === 'guest';
  const roles = [...new Set(user.memberships.flatMap(m => m.roles))];
  const panelId = `${ID}-user-${user.id}`;
  return (
    <li
      className="lx-users__item"
      data-user={user.username}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="lx-users__head"
        aria-expanded={open}
        aria-controls={panelId}
        id={`${panelId}-toggle`}
        onClick={onToggle}
      >
        <UserAvatar
          name={user.displayName}
          avatarId={user.avatarId}
          accent={undefined}
          userId={user.id}
        />
        <span className="lx-users__who">
          <strong>
            {user.displayName}
            {me && <span className="lx-muted"> (tú)</span>}
          </strong>
          <span className="lx-muted">
            {user.username !== user.displayName && <>@{user.username} · </>}
            {guest
              ? 'Invitado · solo lectura'
              : roles.length
                ? normalizeRoles(roles)
                    .map(r => ROLE_LABEL[r])
                    .join(' · ')
                : 'Sin roles'}
          </span>
        </span>
        <span className="lx-users__flags">
          {user.passwordProvisional && (
            <Chip tag tone="danger" size="sm">
              Contraseña provisional
            </Chip>
          )}
          {user.sharedAccount && (
            <Chip tag tone="neutral" size="sm">
              Compartida
            </Chip>
          )}
          {!guest && !user.sharedAccount && !user.hasRecoveryEmail && (
            <Chip tag tone="neutral" size="sm">
              Sin correo
            </Chip>
          )}
          <span className="lx-users__last lx-muted lx-num">
            {user.lastLoginAt
              ? `Entró ${relativeTime(user.lastLoginAt, timeZone)}`
              : 'Nunca ha entrado'}
          </span>
        </span>
        <Icon name="chevronDown" size={18} />
      </button>
      {open && (
        <div className="lx-users__panel" id={panelId}>
          {user.sharedAccount && (
            <SharedProfile user={user} onChange={onChange} />
          )}
          <RolesEditor user={user} me={me} onChange={onChange} />
          {!guest && <HelpIn user={user} me={me} />}
          <p className="lx-muted lx-acct-note">
            <span className="lx-num">{user.openSessions}</span>{' '}
            {user.openSessions === 1 ? 'sesión abierta' : 'sesiones abiertas'}
            {user.lastLoginAt && (
              <>
                {' '}
                · última entrada{' '}
                <span className="lx-num">
                  {instantShort(user.lastLoginAt, timeZone)}
                </span>
              </>
            )}
          </p>
          {!guest && !me && <SupportEntry user={user} onSupport={onSupport} />}
        </div>
      )}
    </li>
  );
};

/** Unresolved changes in this device's outbox. */
function useUnsent(): number {
  return useLogisticsStore(s => s.outbox.filter(isUnresolved).length);
}

const UNSENT_ID = `${ID}-unsent`;

/**
 * Why «Ver como Invitado» and «Abrir sesión de soporte» wait: entering
 * another account with changes still on this device would strand them (the
 * store refuses it too, as a backstop).
 */
const UnsentNotice: React.FC<{count: number}> = ({count}) => {
  const actions = useContext(ActionsContext);
  return (
    <p className="lx-notice" id={UNSENT_ID} role="status">
      <Icon name="cloudOff" size={18} />
      <span>
        Tienes{' '}
        <span className="lx-num">
          {count === 1 ? 'un cambio' : `${count} cambios`}
        </span>{' '}
        sin enviar en este dispositivo. Envíalos o descártalos antes de entrar
        en otra cuenta.
      </span>
      {actions && (
        <Button size="sm" variant="ghost" onClick={actions.openOutbox}>
          Ver cambios pendientes
        </Button>
      )}
    </p>
  );
};

const SupportEntry: React.FC<{user: AdminUser; onSupport: () => void}> = ({
  user,
  onSupport,
}) => {
  const access = useAccess();
  const unsent = useUnsent();
  const organizations = useLogisticsStore(s => s.organizations);
  if (!access.can('support.start')) return null;
  // Same rule as passwords: nobody enters a developer account but development
  // (HelpIn already shows why).
  if (outrankedBy(user, organizations)) return null;
  return (
    <div className="lx-acct-callout">
      <span className="lx-acct-callout__text">
        <strong>Sesión de soporte</strong>
        <span className="lx-muted">
          Entra en su cuenta para ayudarle, con un motivo y un tiempo límite.
          Queda en su historial de seguridad.
        </span>
      </span>
      <Button
        icon="user"
        disabled={unsent > 0}
        aria-describedby={unsent > 0 ? UNSENT_ID : undefined}
        onClick={onSupport}
      >
        Abrir sesión de soporte
      </Button>
    </div>
  );
};

/**
 * Name and photo of a shared account (Equipo; Invitado has no photo). Several
 * people use it, so it is changed here and never from the account itself:
 * nobody on the field renames the team after themselves.
 */
const SharedProfile: React.FC<{
  user: AdminUser;
  onChange: (user: AdminUser) => void;
}> = ({user, onChange}) => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const toast = useLogisticsStore(s => s.toast);
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState<'name' | 'photo' | 'remove' | null>(null);
  const [error, setError] = useState<{name?: string; photo?: string}>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const guest = user.role === 'guest';
  const prefix = `${ID}-shared-${user.username}`;
  const trimmed = name.trim();
  const changed = trimmed !== user.displayName;

  const send = async (
    kind: 'name' | 'photo' | 'remove',
    body: Omit<AdminProfileInput, 'version'>,
  ) => {
    if (!token) return;
    setBusy(kind);
    setError({});
    try {
      const next = await api.adminProfile(token, user.id, {
        version: user.version,
        ...body,
      });
      if (user.avatarId && kind !== 'name') forgetMedia(user.avatarId);
      onChange(next);
      setName(next.displayName);
      refreshMembers();
      toast(
        kind === 'name'
          ? `Nombre de la cuenta compartida: ${next.displayName}.`
          : kind === 'photo'
            ? 'Foto de la cuenta compartida actualizada.'
            : 'Foto quitada.',
        'success',
      );
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT' && err.current) {
        const current = err.current as AdminUser;
        onChange(current);
        setName(current.displayName);
        setError({
          name: 'Otra persona la ha cambiado mientras tanto. Revisa y vuelve a guardar.',
        });
      } else if (isApiError(err) && err.fields?.displayName) {
        setError({name: err.fields.displayName});
      } else if (
        isApiError(err) &&
        err.fields &&
        Object.keys(err.fields).some(k => k.startsWith('photo'))
      ) {
        setError({
          photo: Object.entries(err.fields).find(([k]) =>
            k.startsWith('photo'),
          )![1],
        });
      } else if (kind === 'name') {
        setError({name: errorMessage(err)});
      } else {
        setError({photo: errorMessage(err)});
      }
    } finally {
      setBusy(null);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = await preparePhoto(file);
      await send('photo', {
        photo: {
          contentType: p.contentType,
          width: p.width,
          height: p.height,
          data: p.data,
        },
      });
    } catch (err) {
      setError({
        photo: err instanceof PhotoError ? err.message : errorMessage(err),
      });
    }
  };

  return (
    <section
      className="lx-users__shared"
      aria-labelledby={`${prefix}-title`}
      id={prefix}
    >
      <p className="lx-field__label" id={`${prefix}-title`}>
        {guest
          ? 'Nombre de la cuenta compartida'
          : 'Nombre y foto de la cuenta compartida'}
      </p>
      <p className="lx-muted lx-acct-note">
        La usan varias personas, así que se cambia aquí y no desde la propia
        cuenta.
      </p>
      <form
        className="lx-users__sharedform"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          if (!trimmed) {
            setError({name: 'Escribe un nombre.'});
            return;
          }
          if (changed) void send('name', {displayName: trimmed});
        }}
      >
        <Field id={`${prefix}-name`} label="Nombre visible" error={error.name}>
          <Input
            id={`${prefix}-name`}
            maxLength={DISPLAY_NAME_MAX}
            value={name}
            invalid={!!error.name}
            aria-describedby={describedBy(`${prefix}-name`, {
              error: error.name,
            })}
            onChange={e => {
              setName(e.target.value);
              if (error.name) setError({});
            }}
          />
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          id={`${prefix}-save`}
          busy={busy === 'name'}
          disabled={!changed}
        >
          Guardar nombre
        </Button>
      </form>
      {!guest && (
        <div className="lx-users__sharedphoto">
          <UserAvatar
            name={user.displayName}
            avatarId={user.avatarId}
            userId={user.id}
            size="lg"
          />
          <Button
            size="sm"
            icon="camera"
            id={`${prefix}-photo`}
            busy={busy === 'photo'}
            onClick={() => fileRef.current?.click()}
          >
            {user.avatarId ? 'Cambiar foto' : 'Añadir foto'}
          </Button>
          {user.avatarId && (
            <Button
              size="sm"
              variant="ghost"
              id={`${prefix}-photo-remove`}
              busy={busy === 'remove'}
              onClick={() => void send('remove', {photo: null})}
            >
              Quitar
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            id={`${prefix}-photo-file`}
            onChange={e => {
              void pick(e.target.files?.[0]).finally(() => {
                e.target.value = '';
              });
            }}
          />
        </div>
      )}
      {error.photo && (
        <p className="lx-field__error" role="alert">
          {error.photo}
        </p>
      )}
    </section>
  );
};

const RolesEditor: React.FC<{
  user: AdminUser;
  me: boolean;
  onChange: (user: AdminUser) => void;
}> = ({user, me, onChange}) => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const organizations = useLogisticsStore(s => s.organizations);
  const toast = useLogisticsStore(s => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown at once while the server confirms; back as it was if it refuses.
  const [pending, setPending] = useState<Record<string, OrgRole[]>>({});

  if (user.role === 'guest') {
    return (
      <p className="lx-muted" id={`${ID}-guest-roles`}>
        La cuenta de Invitado no tiene roles: siempre es de solo lectura y no ve
        Contactos ni Catálogo.
      </p>
    );
  }

  const set = async (orgId: string, roles: OrgRole[]) => {
    if (!token) return;
    setBusy(orgId);
    setPending(p => ({...p, [orgId]: roles}));
    setError(null);
    try {
      const next = await api.setRoles(token, user.id, {
        organizationId: orgId,
        roles,
      });
      onChange(next);
      toast(`Roles de ${user.displayName} guardados.`, 'success');
    } catch (err) {
      setError(
        isApiError(err) && err.fields?.roles
          ? err.fields.roles
          : errorMessage(err),
      );
    } finally {
      setBusy(null);
      setPending(p => {
        const rest = {...p};
        delete rest[orgId];
        return rest;
      });
    }
  };

  return (
    <div className="lx-users__roles">
      {user.memberships.map(m => {
        const org = organizations.find(o => o.id === m.organizationId);
        // Only an administrator of that organization changes roles there,
        // and never those of a developer account (they are fixed).
        const fixed = isDeveloper(m.roles);
        const editable = !fixed && !!org?.roles?.includes('admin');
        return (
          <fieldset
            key={m.organizationId}
            className="lx-users__rolegroup"
            disabled={!editable}
            aria-busy={busy === m.organizationId || undefined}
            aria-describedby={
              fixed ? `${ID}-fixed-${user.id}-${m.organizationId}` : undefined
            }
            data-org={m.organizationId}
          >
            <legend className="lx-field__label">
              Roles en {org?.name ?? 'otra organización'}
              {!editable && !fixed && (
                <HelpTip label="roles">
                  Solo administración cambia los roles. Tú puedes ayudar a
                  entrar (contraseña provisional, enlace).
                </HelpTip>
              )}
            </legend>
            {fixed && (
              <p
                className="lx-muted"
                id={`${ID}-fixed-${user.id}-${m.organizationId}`}
              >
                <Icon name="lock" size={16} /> Cuenta de desarrollo: sus roles
                son fijos (administración y desarrollo) y no se cambian desde
                aquí.
              </p>
            )}
            <div className="lx-users__rolechecks">
              {ORG_ROLES.map(r => {
                const id = `${ID}-role-${user.id}-${m.organizationId}-${r}`;
                const current = pending[m.organizationId] ?? m.roles;
                const checked = current.includes(r);
                const ownAdmin = me && r === 'admin' && m.roles.includes(r);
                // Development is given by the technical team, never here.
                const notAssignable = !fixed && r === 'developer';
                const why = ownAdmin
                  ? 'No puedes quitarte tu propio rol de administración.'
                  : notAssignable
                    ? 'Lo asigna el equipo técnico: no se da desde aquí.'
                    : null;
                return (
                  <span className="lx-acct-check" key={r}>
                    <input
                      type="checkbox"
                      id={id}
                      checked={checked}
                      disabled={ownAdmin || notAssignable}
                      aria-describedby={
                        why && editable ? `${id}-why` : undefined
                      }
                      onChange={e => {
                        if (busy === m.organizationId) return;
                        void set(
                          m.organizationId,
                          normalizeRoles(
                            e.target.checked
                              ? [...current, r]
                              : current.filter(x => x !== r),
                          ),
                        );
                      }}
                    />
                    <label htmlFor={id}>
                      <strong>{ROLE_LABEL[r]}</strong>
                      <span className="lx-muted">{ROLE_HELP[r]}</span>
                      {why && editable && (
                        <span className="lx-muted" id={`${id}-why`}>
                          {why}
                        </span>
                      )}
                    </label>
                  </span>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {error && (
        <p className="lx-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

/**
 * A role the target holds that gives what the viewer's roles do not, in the
 * same organization: then the viewer may not set their password nor send
 * them a link (the server's `requireOutranks` refuses with 403). The same
 * rule as the server: development outranks every account; administration
 * every account but a developer one; otherwise every permission of the
 * target's roles must be among the viewer's (so Desarrollo still helps
 * Equipo). Null when nothing stands in the way, or when a server before E4
 * sends no roles (it decides).
 */
function outrankedBy(
  user: AdminUser,
  organizations: readonly Organization[],
): {role: OrgRole; org: string} | null {
  for (const m of user.memberships) {
    const org = organizations.find(o => o.id === m.organizationId);
    if (!org || !Array.isArray(org.roles)) continue;
    const mine = normalizeRoles(org.roles);
    if (isDeveloper(mine)) continue;
    if (isDeveloper(m.roles)) return {role: 'developer', org: org.name};
    if (mine.includes('admin')) continue;
    const given = new Set(rolePermissions(mine));
    const missing = normalizeRoles(m.roles).find(r =>
      rolePermissions([r]).some(p => !given.has(p)),
    );
    if (missing) return {role: missing, org: org.name};
  }
  return null;
}

/**
 * Provisional password and reset link: someone who cannot get in. For a
 * shared account (Equipo) it is simply its new password, and there is no
 * reset link (no recovery e-mail; administration sets it).
 */
const HelpIn: React.FC<{user: AdminUser; me: boolean}> = ({user, me}) => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const organizations = useLogisticsStore(s => s.organizations);
  const toast = useLogisticsStore(s => s.toast);
  const timeZone = useTimeZone();
  const shared = user.sharedAccount === true;
  const outranked = me ? null : outrankedBy(user, organizations);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'pw' | 'link' | null>(null);
  const [shown, setShown] = useState<
    | {kind: 'password'; value: string}
    | {kind: 'link'; value: string; expiresAt: string}
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const provisional = async () => {
    if (!token) return;
    setBusy('pw');
    setError(null);
    try {
      const res = await api.provisionalPassword(token, user.id);
      setShown({kind: 'password', value: res.password});
      setConfirm(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const link = async () => {
    if (!token) return;
    setBusy('link');
    setError(null);
    try {
      const res = await api.resetLink(token, user.id);
      if (res && res.url) {
        setShown({kind: 'link', value: res.url, expiresAt: res.expiresAt});
      } else {
        setShown(null);
        toast(
          `Enlace enviado al correo de recuperación de ${user.displayName}.`,
          'success',
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast('Copiado.', 'success'),
      () =>
        toast(
          'No se ha podido copiar: selecciónalo y cópialo a mano.',
          'error',
        ),
    );
  };

  if (outranked) {
    return (
      <div className="lx-users__help">
        <p className="lx-field__label">
          {shared ? 'Contraseña' : 'Ayudar a entrar'}
        </p>
        <p className="lx-muted" id={`${ID}-help-blocked-${user.username}`}>
          <Icon name="lock" size={16} />{' '}
          {outranked.role === 'developer' ? (
            <>
              Es una cuenta de desarrollo: su contraseña y su acceso solo los
              gestiona desarrollo.
            </>
          ) : (
            <>
              Tiene el rol {ROLE_LABEL[outranked.role]} en {outranked.org}, con
              permisos que tú no tienes allí: su contraseña la cambia
              administración.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="lx-users__help">
      <p className="lx-field__label">
        {shared ? 'Contraseña' : 'Ayudar a entrar'}
      </p>
      {shared && (
        <p className="lx-muted lx-acct-note">
          Es una cuenta compartida: su contraseña la pone administración o
          desarrollo y se la da al equipo. No tiene correo de recuperación.
        </p>
      )}
      <div className="lx-acct-actions">
        {!me &&
          (confirm ? (
            <span
              className="lx-acct-confirm"
              role="group"
              id={`${ID}-pw-confirm`}
            >
              <span>
                {shared
                  ? 'Se cerrarán sus sesiones en todos los dispositivos: todo el equipo tendrá que entrar con la nueva.'
                  : 'Se cerrarán todas sus sesiones y tendrá que entrar con la nueva.'}
              </span>
              <Button
                size="sm"
                variant="primary"
                id={`${ID}-pw-confirm-yes`}
                busy={busy === 'pw'}
                onClick={() => void provisional()}
              >
                Poner contraseña
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm(false)}
              >
                Cancelar
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              icon="lock"
              id={`${ID}-pw-${user.username}`}
              onClick={() => setConfirm(true)}
            >
              {shared
                ? 'Poner contraseña nueva'
                : 'Poner contraseña provisional'}
            </Button>
          ))}
        {!shared && (
          <Button
            size="sm"
            icon="link"
            id={`${ID}-link-${user.username}`}
            busy={busy === 'link'}
            onClick={() => void link()}
          >
            Enlace de restablecimiento
          </Button>
        )}
      </div>
      {shown && (
        <div className="lx-users__secret" role="status" id={`${ID}-secret`}>
          <p>
            <strong>
              {shown.kind === 'link'
                ? 'Enlace para elegir contraseña'
                : shared
                  ? `Contraseña nueva de ${user.displayName}`
                  : 'Contraseña provisional'}
            </strong>{' '}
            · solo se muestra ahora. Dásela en persona o por un canal privado.
          </p>
          <code className="lx-users__secretvalue" id={`${ID}-secret-value`}>
            {shown.value}
          </code>
          {shown.kind === 'link' && (
            <p className="lx-muted">
              Sirve una vez, hasta las{' '}
              <span className="lx-num">
                {instantShort(shown.expiresAt, timeZone)}
              </span>
              .
            </p>
          )}
          <div className="lx-acct-actions">
            <Button size="sm" icon="copy" onClick={() => copy(shown.value)}>
              Copiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShown(null)}>
              Ocultar
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="lx-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

const SecurityTab: React.FC = () => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const toast = useLogisticsStore(s => s.toast);
  const timeZone = useTimeZone();
  const log = useLoad(t => api.adminSecurity(t), 'admin-security');
  const open = useLoad(t => api.supportSessions(t), 'admin-support');
  const [busy, setBusy] = useState<string | null>(null);

  const end = async (s: SupportSession) => {
    if (!token) return;
    setBusy(s.id);
    try {
      await api.endSupportSession(token, s.id);
      toast('Sesión terminada.', 'success');
      open.reload();
      log.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sessions = open.data?.items ?? [];
  return (
    <div className="lx-acct-sections">
      {sessions.length > 0 && (
        <section
          className="lx-acct-section"
          aria-labelledby={`${ID}-open-title`}
        >
          <h3 className="lx-acct-section__title" id={`${ID}-open-title`}>
            Sesiones de soporte abiertas
          </h3>
          <ul className="lx-acct-list" id={`${ID}-open`}>
            {sessions.map(s => (
              <li key={s.id} className="lx-acct-row">
                <Icon name={s.kind === 'support' ? 'user' : 'eye'} size={20} />
                <span className="lx-acct-row__main">
                  <strong>
                    {s.kind === 'support'
                      ? `Soporte en la cuenta de ${s.user.displayName}`
                      : 'Vista como Invitado'}
                  </strong>
                  <span className="lx-muted">
                    Por {s.by.displayName}
                    {s.reason && <> · «{s.reason}»</>} · quedan{' '}
                    <span className="lx-num">
                      {countdown(secondsLeft(s.endsAt))}
                    </span>
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  busy={busy === s.id}
                  onClick={() => void end(s)}
                >
                  Terminar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="lx-acct-section" aria-labelledby={`${ID}-log-title`}>
        <h3 className="lx-acct-section__title" id={`${ID}-log-title`}>
          Registro de seguridad
        </h3>
        <p className="lx-muted lx-acct-note">
          Las cuentas de las organizaciones que gestionas. Nunca incluye
          contraseñas ni direcciones de correo.
        </p>
        {log.status === 'error' && !log.data ? (
          <LoadError message={log.message} onRetry={log.reload} />
        ) : !log.data ? (
          <SkeletonRows rows={4} label="Cargando el registro" />
        ) : (
          <SecurityList
            id={`${ID}-log`}
            items={log.data.items}
            timeZone={timeZone}
            showUser
            emptyText="Todavía no hay nada registrado."
          />
        )}
      </section>
    </div>
  );
};
