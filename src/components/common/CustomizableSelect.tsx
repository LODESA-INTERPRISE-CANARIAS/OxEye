import React, {useState} from 'react';
import {validateCustomOption} from '../../engine/planning/contacts';

const OTHER_SENTINEL = '__other__';

export interface CustomizableSelectProps {
  id?: string;
  name?: string;
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onAddOption?: (newValue: string) => void;
  placeholder?: string;
  otherLabel?: string;
  addButtonLabel?: string;
}

/**
 * Selector reutilizable con opción «Otra…» para escribir y validar nuevos valores
 * (no vacíos ni duplicados sin distinguir mayúsculas).
 */
export const CustomizableSelect: React.FC<CustomizableSelectProps> = ({
  id,
  name,
  label,
  options,
  value,
  onChange,
  onAddOption,
  placeholder = 'Escribe un tipo nuevo…',
  otherLabel = 'Otra…',
  addButtonLabel = 'Añadir',
}) => {
  const [addingOther, setAddingOther] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    const check = validateCustomOption(draft, options);
    if ('error' in check) {
      setError(check.error);
      return;
    }
    onAddOption?.(check.value);
    onChange(check.value);
    setDraft('');
    setError('');
    setAddingOther(false);
  };

  return (
    <div className="customizable-select">
      <label htmlFor={id}>
        {label}
        <select
          id={id}
          name={name}
          value={addingOther ? OTHER_SENTINEL : value}
          onChange={(e) => {
            if (e.target.value === OTHER_SENTINEL) {
              setAddingOther(true);
              setDraft('');
              setError('');
            } else {
              setAddingOther(false);
              setError('');
              onChange(e.target.value);
            }
          }}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          <option value={OTHER_SENTINEL}>{otherLabel}</option>
        </select>
      </label>
      {addingOther && (
        <div className="customizable-select-inline">
          <div className="customizable-select-row">
            <input
              id={id ? `${id}-other` : undefined}
              type="text"
              maxLength={80}
              placeholder={placeholder}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirm();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setAddingOther(false);
                  setError('');
                }
              }}
            />
            <button
              type="button"
              id={id ? `${id}-other-add` : undefined}
              className="dark"
              onClick={handleConfirm}
            >
              {addButtonLabel}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAddingOther(false);
                setError('');
              }}
            >
              Cancelar
            </button>
          </div>
          {error && (
            <small className="customizable-select-error" role="alert">
              {error}
            </small>
          )}
        </div>
      )}
    </div>
  );
};
