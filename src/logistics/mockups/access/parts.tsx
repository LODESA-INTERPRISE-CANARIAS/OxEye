/**
 * Pieces shared by the welcome and the profile: the photo picker (local
 * preview only, nothing is uploaded) and the change-password form.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Button, Field, Icon, Sheet} from '../../ui';
import {Avatar, PasswordInput, StrengthMeter, passwordStrength} from '../kit';
import type {Me} from './me';

export const PhotoPicker: React.FC<{
  me: Me;
  onPhoto: (url: string | null) => void;
  size?: 'lg' | 'xl';
}> = ({me, onPhoto, size = 'xl'}) => {
  const input = useRef<HTMLInputElement>(null);
  const last = useRef<string | null>(null);
  useEffect(
    () => () => {
      // Object URLs live until revoked; the mock keeps only the latest.
      if (last.current) URL.revokeObjectURL(last.current);
    },
    [],
  );
  return (
    <div className={`lx-mk-photo lx-mk-photo--${size}`} data-accent={me.accent}>
      <Avatar name={me.displayName} photo={me.photo} size={size} />
      <div className="lx-mk-photo__actions">
        <Button size="sm" icon="edit" onClick={() => input.current?.click()}>
          {me.photo ? 'Cambiar foto' : 'Subir foto'}
        </Button>
        {me.photo && (
          <Button size="sm" variant="ghost" onClick={() => onPhoto(null)}>
            Quitar
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="lx-visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (last.current) URL.revokeObjectURL(last.current);
          last.current = URL.createObjectURL(file);
          onPhoto(last.current);
          e.target.value = '';
        }}
      />
    </div>
  );
};

/** New password (twice) with a strength hint; the old one is never shown. */
export const NewPasswordForm: React.FC<{
  idPrefix: string;
  askCurrent: boolean;
  submitLabel: string;
  onDone: () => void;
  onCancel?: () => void;
}> = ({idPrefix, askCurrent, submitLabel, onDone, onCancel}) => {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [closeOthers, setCloseOthers] = useState(true);
  const [error, setError] = useState<{field: string; text: string} | null>(
    null,
  );
  return (
    <form
      className="lx-mk-stack"
      noValidate
      onSubmit={e => {
        e.preventDefault();
        if (askCurrent && !current) {
          setError({field: 'current', text: 'Escribe tu contraseña actual.'});
          return;
        }
        if (passwordStrength(pw).score < 2) {
          setError({
            field: 'new',
            text: 'Elige una contraseña más larga o con más palabras.',
          });
          return;
        }
        if (pw !== pw2) {
          setError({
            field: 'repeat',
            text: 'Las dos contraseñas no coinciden.',
          });
          return;
        }
        onDone();
      }}
    >
      {askCurrent && (
        <Field
          id={`${idPrefix}-current`}
          label="Contraseña actual"
          error={error?.field === 'current' ? error.text : null}
        >
          <PasswordInput
            id={`${idPrefix}-current`}
            value={current}
            onChange={v => {
              setCurrent(v);
              setError(null);
            }}
            autoComplete="current-password"
            invalid={error?.field === 'current'}
            autoFocus
          />
        </Field>
      )}
      <Field
        id={`${idPrefix}-new`}
        label="Contraseña nueva"
        error={error?.field === 'new' ? error.text : null}
      >
        <PasswordInput
          id={`${idPrefix}-new`}
          value={pw}
          onChange={v => {
            setPw(v);
            setError(null);
          }}
          autoComplete="new-password"
          invalid={error?.field === 'new'}
          describedBy={`${idPrefix}-strength`}
        />
      </Field>
      <StrengthMeter password={pw} id={`${idPrefix}-strength`} />
      <Field
        id={`${idPrefix}-repeat`}
        label="Repítela"
        error={error?.field === 'repeat' ? error.text : null}
      >
        <PasswordInput
          id={`${idPrefix}-repeat`}
          value={pw2}
          onChange={v => {
            setPw2(v);
            setError(null);
          }}
          autoComplete="new-password"
          invalid={error?.field === 'repeat'}
        />
      </Field>
      <span className="lx-mk-check">
        <input
          type="checkbox"
          id={`${idPrefix}-others`}
          checked={closeOthers}
          onChange={e => setCloseOthers(e.target.checked)}
        />
        <label htmlFor={`${idPrefix}-others`}>
          Cerrar mis sesiones en otros dispositivos
        </label>
      </span>
      <p className="lx-mk-privacy-line">
        <Icon name="lock" size={15} /> OxEye no guarda tu contraseña, solo una
        huella que no se puede revertir: nadie, ni los administradores, puede
        leerla.
      </p>
      <div className="lx-mk-formactions">
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" variant="primary" size="lg">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};

export const PasswordSheet: React.FC<{
  open: boolean;
  provisional: boolean;
  onClose: () => void;
  onDone: () => void;
}> = ({open, provisional, onClose, onDone}) => (
  <Sheet
    open={open}
    onClose={onClose}
    size="sm"
    id="mk-password-sheet"
    eyebrow="Seguridad"
    title="Cambiar contraseña"
  >
    {provisional && (
      <p className="lx-notice lx-mk-sheet-notice">
        <Icon name="alert" size={18} />
        <span>
          Tu contraseña actual es provisional. Al cambiarla verás también la
          información sensible (presupuestos, contactos y precios).
        </span>
      </p>
    )}
    <NewPasswordForm
      idPrefix="mk-pw"
      askCurrent
      submitLabel="Guardar contraseña"
      onDone={onDone}
      onCancel={onClose}
    />
  </Sheet>
);
