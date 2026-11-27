/**
 * Password input with «Mostrar» and, for a new password, an indicative
 * strength meter (Revisión 1 · E4). The rules that the server enforces are
 * in `passwordProblem`; the meter only helps choose.
 */
import React, {useState} from 'react';
import {PASSWORD_MAX} from '../../../shared/logistics/account.ts';
import {Field, Icon, Input, describedBy} from '../ui';
import {passwordStrength} from './access';

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: React.ReactNode;
  /** `new-password` shows the strength meter. */
  autoComplete: 'current-password' | 'new-password';
  /** For the strength meter (a password with the name inside is weaker). */
  username?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  username = '',
  inputRef,
  disabled,
  autoFocus,
}) => {
  const [shown, setShown] = useState(false);
  const meter = autoComplete === 'new-password';
  const strength = meter ? passwordStrength(value, username) : null;
  const meterId = `${id}-strength`;
  const described = [describedBy(id, {hint, error}), meter ? meterId : '']
    .filter(Boolean)
    .join(' ');
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="lx-password">
        <Input
          ref={inputRef}
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          // Shown as text, phones would otherwise capitalise or correct it.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={PASSWORD_MAX * 2}
          value={value}
          invalid={!!error}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={described || undefined}
          onChange={e => onChange(e.target.value)}
        />
        <button
          type="button"
          className="lx-password__toggle"
          aria-pressed={shown}
          aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setShown(v => !v)}
        >
          <Icon name="eye" size={18} />
        </button>
      </div>
      {strength && (
        <div
          className="lx-strength"
          id={meterId}
          data-level={value ? strength.level : undefined}
          aria-live="polite"
        >
          <span className="lx-strength__bars" aria-hidden="true">
            {[0, 1, 2, 3].map(i => (
              <span
                key={i}
                className="lx-strength__bar"
                data-on={value && strength.level > i ? '' : undefined}
              />
            ))}
          </span>
          <span className="lx-strength__text">
            {value ? (
              <>
                <strong>Seguridad orientativa: {strength.label}.</strong>
                {strength.tip && <> {strength.tip}</>}
              </>
            ) : (
              'Al menos 10 caracteres. Mejor una frase que solo tú recuerdes.'
            )}
          </span>
        </div>
      )}
    </Field>
  );
};
