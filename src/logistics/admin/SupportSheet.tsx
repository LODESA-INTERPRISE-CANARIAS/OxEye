/**
 * Opening a support session on someone's account (Revisión 1 · E4,
 * `support.start`): a reason they will read in their security history, a
 * time limit and the administrator's own password. While it runs the
 * administrator works as that person, without account administration, and
 * a banner on every screen offers «Terminar».
 */
import React, {useRef, useState} from 'react';
import {
  SUPPORT_MINUTES_MAX,
  SUPPORT_MINUTES_MIN,
  SUPPORT_REASON_MAX,
  SUPPORT_REASON_MIN,
} from '../../../shared/logistics/account.ts';
import type {AdminUser} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {api} from '../api/endpoints';
import {PasswordField} from '../account/PasswordField';
import {isUnresolved} from '../offline/local';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  Icon,
  Segmented,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';

const ID = 'lx-support';
const DURATIONS = [5, 10, 15, 20, 30].filter(
  m => m >= SUPPORT_MINUTES_MIN && m <= SUPPORT_MINUTES_MAX,
);

export const SupportSheet: React.FC<{
  target: AdminUser;
  onClose: () => void;
  onStarted: () => void;
}> = ({target, onClose, onStarted}) => {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const beginSupport = useLogisticsStore(s => s.beginSupport);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('15');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    reason?: string;
    password?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  // `Textarea` does not forward refs: reach it by id.
  const focusReason = () => document.getElementById(`${ID}-reason`)?.focus();
  const passwordRef = useRef<HTMLInputElement>(null);
  const length = [...reason.trim()].length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    if (length < SUPPORT_REASON_MIN) {
      setErrors({
        reason: `Explica el motivo en al menos ${SUPPORT_REASON_MIN} caracteres: ${target.displayName} lo verá.`,
      });
      focusReason();
      return;
    }
    if (!password) {
      setErrors({password: 'Escribe tu contraseña para confirmar.'});
      passwordRef.current?.focus();
      return;
    }
    // Checked before the server opens a session that could not be used.
    if (useLogisticsStore.getState().outbox.some(isUnresolved)) {
      setErrors({
        form: 'Tienes cambios sin enviar en este dispositivo. Envíalos o descártalos antes de entrar en otra cuenta.',
      });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const res = await api.startSupport(token, {
        userId: target.id,
        reason: reason.trim(),
        password,
        minutes: Number(minutes),
      });
      await beginSupport(res, Number(minutes));
      onStarted();
    } catch (err) {
      setPassword('');
      if (isApiError(err) && err.fields?.password) {
        setErrors({password: err.fields.password});
        passwordRef.current?.focus();
      } else if (isApiError(err) && err.fields?.reason) {
        setErrors({reason: err.fields.reason});
        focusReason();
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        setErrors({
          form: 'Demasiados intentos con tu contraseña. Espera unos minutos.',
        });
      } else {
        setErrors({form: errorMessage(err)});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Sesión de soporte · ${target.displayName}`}
      eyebrow="Usuarios"
      size="md"
      id={`${ID}-sheet`}
    >
      <form
        className="lx-acct-form"
        id={`${ID}-form`}
        onSubmit={submit}
        noValidate
      >
        <ul className="lx-acct-facts">
          <li>
            <Icon name="user" size={18} />
            <span>
              Verás y harás lo mismo que {target.displayName}; cada cambio
              quedará firmado con su nombre.
            </span>
          </li>
          <li>
            <Icon name="history" size={18} />
            <span>
              El motivo y la hora quedan en su historial de seguridad y en el
              registro.
            </span>
          </li>
          <li>
            <Icon name="lock" size={18} />
            <span>
              Durante la sesión no se gestionan usuarios ni su cuenta (perfil,
              contraseña, correo).
            </span>
          </li>
        </ul>
        <Field
          id={`${ID}-reason`}
          label="Motivo"
          error={errors.reason}
          hint={
            <>
              Lo leerá {target.displayName}.{' '}
              <span className="lx-num">
                {length}/{SUPPORT_REASON_MAX}
              </span>
            </>
          }
        >
          <Textarea
            id={`${ID}-reason`}
            rows={3}
            maxLength={SUPPORT_REASON_MAX}
            value={reason}
            invalid={!!errors.reason}
            aria-describedby={describedBy(`${ID}-reason`, {
              hint: true,
              error: errors.reason,
            })}
            placeholder="Ej.: no ve las tareas de mañana en el calendario"
            onChange={e => {
              setReason(e.target.value);
              if (errors.reason) setErrors({});
            }}
          />
        </Field>
        <Segmented<string>
          name={`${ID}-minutes`}
          id={`${ID}-minutes`}
          legend="Duración máxima"
          value={minutes}
          onChange={v => setMinutes(v ?? '15')}
          options={DURATIONS.map(m => ({
            value: String(m),
            label: `${m} min`,
          }))}
        />
        <PasswordField
          id={`${ID}-password`}
          label="Tu contraseña"
          autoComplete="current-password"
          inputRef={passwordRef}
          value={password}
          error={errors.password}
          hint="Para confirmar que eres tú."
          onChange={v => {
            setPassword(v);
            if (errors.password || errors.form) setErrors({});
          }}
        />
        {errors.form && (
          <p className="lx-notice lx-notice--error" role="alert">
            <Icon name="alert" size={18} />
            {errors.form}
          </p>
        )}
        <div className="lx-acct-actions lx-acct-actions--end">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="play"
            id={`${ID}-start`}
            busy={busy}
          >
            Entrar en su cuenta
          </Button>
        </div>
      </form>
    </Sheet>
  );
};
