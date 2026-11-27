/**
 * The own profile (Revisión 1 · E4): photo, display name, a short bio and
 * the accent of the initials. The username, used to sign in, never changes.
 * Used by «Tu espacio en Ox Eye» and the first-login welcome.
 */
import React, {useRef, useState} from 'react';
import {BIO_MAX, DISPLAY_NAME_MAX} from '../../../shared/logistics/account.ts';
import type {Profile} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {forgetMedia} from '../inventory/media-cache';
import {PhotoError, preparePhoto} from '../inventory/photo-prepare';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Field, Icon, Input, Textarea, describedBy} from '../ui';
import {refreshMembers} from './members';
import {ACCENTS, UserAvatar} from './UserAvatar';

export interface ProfileEditorProps {
  idPrefix: string;
  profile: Profile;
  onSaved: (profile: Profile) => void;
  /** Another session changed the profile meanwhile: load it again. */
  onStale: () => void;
  submitLabel?: string;
  /** Welcome: no separate save button, the caller saves through `ref`. */
  footer?: (save: () => Promise<boolean>, busy: boolean) => React.ReactNode;
}

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  idPrefix,
  profile,
  onSaved,
  onStale,
  submitLabel = 'Guardar perfil',
  footer,
}) => {
  const session = useLogisticsStore(s => s.session);
  const orgId = useLogisticsStore(s => s.orgId);
  const refreshAccount = useLogisticsStore(s => s.refreshAccount);
  const toast = useLogisticsStore(s => s.toast);
  const [name, setName] = useState(profile.user.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [accent, setAccent] = useState<string | null>(profile.user.accent);
  const [errors, setErrors] = useState<{name?: string; form?: string}>({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = session?.user ?? profile.user;
  // Equipo, Invitado: name and photo are set by administration («Usuarios»);
  // bio and colour stay editable. The server refuses a new name anyway.
  const shared = profile.sharedAccount;

  const changed =
    name.trim() !== profile.user.displayName ||
    (bio.trim() || null) !== (profile.bio ?? null) ||
    accent !== profile.user.accent;

  /** Saves when something changed; true when nothing is left to save. */
  const save = async (): Promise<boolean> => {
    if (!session) return false;
    const trimmed = name.trim();
    if (!trimmed) {
      setErrors({name: 'Escribe cómo quieres que te vean.'});
      nameRef.current?.focus();
      return false;
    }
    if (!changed) return true;
    setBusy(true);
    setErrors({});
    try {
      const next = await api.updateProfile(session.token, {
        displayName: trimmed,
        bio: bio.trim() || null,
        accent,
        version: profile.version,
      });
      await refreshAccount(next.user);
      refreshMembers();
      onSaved(next);
      return true;
    } catch (err) {
      if (isApiError(err) && err.code === 'DUPLICATE') {
        setErrors({
          name:
            err.fields?.displayName ??
            'Ya hay otra persona con ese nombre. Añade un apellido o una inicial.',
        });
        nameRef.current?.focus();
      } else if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        setErrors({
          form: 'Tu perfil ha cambiado desde otra sesión. Lo hemos cargado de nuevo: revisa y vuelve a guardar.',
        });
        onStale();
      } else if (isApiError(err) && err.fields?.displayName) {
        setErrors({name: err.fields.displayName});
      } else {
        setErrors({form: errorMessage(err)});
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !session || !orgId) return;
    setPhotoBusy(true);
    setPhotoProblem(null);
    try {
      const prepared = await preparePhoto(file);
      const media = await api.uploadMedia(session.token, {
        organizationId: orgId,
        ownerType: 'user',
        ownerId: session.user.id,
        contentType: prepared.contentType,
        width: prepared.width,
        height: prepared.height,
        data: prepared.data,
      });
      if (session.user.avatarId) forgetMedia(session.user.avatarId);
      await refreshAccount({...session.user, avatarId: media.id});
      void refreshAccount();
      refreshMembers();
      toast('Foto de perfil actualizada.', 'success');
    } catch (err) {
      setPhotoProblem(
        err instanceof PhotoError ? err.message : errorMessage(err),
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const bioLeft = BIO_MAX - [...bio].length;
  const nameError = errors.name;
  const form = (
    <form
      className="lx-acct-form"
      id={`${idPrefix}-form`}
      noValidate
      onSubmit={e => {
        e.preventDefault();
        void save().then(ok => {
          if (ok && !footer) toast('Perfil guardado.', 'success');
        });
      }}
    >
      <div className="lx-acct-photo">
        <UserAvatar
          name={name || user.displayName}
          avatarId={user.avatarId}
          accent={accent}
          size="xl"
        />
        <div className="lx-acct-photo__text">
          <p className="lx-acct-photo__name">{name || user.displayName}</p>
          <p className="lx-muted">
            Usuario para entrar: <strong>{user.username}</strong> · no cambia
          </p>
          {shared ? (
            <p className="lx-muted" id={`${idPrefix}-shared`}>
              Cuenta compartida: su nombre y su foto los cambia administración
              desde «Usuarios».
            </p>
          ) : (
            <>
              <Button
                size="sm"
                icon="camera"
                id={`${idPrefix}-photo`}
                busy={photoBusy}
                onClick={() => fileRef.current?.click()}
              >
                {user.avatarId ? 'Cambiar foto' : 'Añadir foto'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                id={`${idPrefix}-photo-file`}
                onChange={e => {
                  void pickPhoto(e.target.files?.[0]).finally(() => {
                    e.target.value = '';
                  });
                }}
              />
            </>
          )}
          {photoProblem && (
            <p className="lx-field__error" role="alert">
              {photoProblem}
            </p>
          )}
        </div>
      </div>
      <Field
        id={`${idPrefix}-name`}
        label="Nombre visible"
        hint={
          shared
            ? 'Lo cambia administración: lo usan varias personas.'
            : 'Así te ven los demás en tareas, notas e historial.'
        }
        error={nameError}
      >
        <Input
          ref={nameRef}
          id={`${idPrefix}-name`}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          readOnly={shared}
          value={name}
          invalid={!!nameError}
          aria-describedby={describedBy(`${idPrefix}-name`, {
            hint: true,
            error: nameError,
          })}
          onChange={e => {
            setName(e.target.value);
            if (errors.name || errors.form) setErrors({});
          }}
        />
      </Field>
      <Field
        id={`${idPrefix}-bio`}
        label="Sobre ti"
        optional
        hint={
          <>
            Qué haces en el montaje o cómo localizarte.{' '}
            <span className="lx-num">{bioLeft}</span> caracteres libres.
          </>
        }
      >
        <Textarea
          id={`${idPrefix}-bio`}
          rows={3}
          maxLength={BIO_MAX}
          value={bio}
          aria-describedby={`${idPrefix}-bio-hint`}
          onChange={e => setBio(e.target.value)}
        />
      </Field>
      <fieldset className="lx-acct-accents">
        <legend className="lx-field__label">Color de tus iniciales</legend>
        <div className="lx-acct-accents__options">
          {[{key: null, label: 'El de la paleta'}, ...ACCENTS].map(a => {
            const id = `${idPrefix}-accent-${a.key ?? 'none'}`;
            return (
              <span className="lx-acct-accent" key={id}>
                <input
                  type="radio"
                  id={id}
                  name={`${idPrefix}-accent`}
                  checked={accent === a.key}
                  onChange={() => setAccent(a.key)}
                />
                <label htmlFor={id} title={a.label}>
                  <span
                    className="lx-avatar lx-avatar--sm"
                    data-accent={a.key ?? undefined}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  <span>{a.label}</span>
                </label>
              </span>
            );
          })}
        </div>
      </fieldset>
      {errors.form && (
        <p className="lx-notice lx-notice--error" role="alert">
          <Icon name="alert" size={18} />
          {errors.form}
        </p>
      )}
      {!footer && (
        <Button
          type="submit"
          variant="primary"
          id={`${idPrefix}-save`}
          busy={busy}
          disabled={!changed}
        >
          {busy ? 'Guardando…' : submitLabel}
        </Button>
      )}
    </form>
  );
  // The caller's footer goes after the form: it may hold forms of its own.
  return footer ? (
    <>
      {form}
      {footer(save, busy)}
    </>
  ) : (
    form
  );
};
