/**
 * Helpers for names typed on the street:
 *
 * - `LookAlike`: while typing a new person's or company's name, «¿Es la
 *   misma que …?» with «Abrir» / «No, es otra» (shared `findLookAlikes`), so
 *   the same supplier is not saved twice under two spellings.
 * - `CompanyField`: type a company name to find it or create it (the server
 *   finds or creates by name), with tappable suggestions and a line saying
 *   which of the two will happen.
 */
import React, {useMemo, useState} from 'react';
import type {Company} from '../../../shared/logistics/contracts.ts';
import {COMPANY_KIND_LABEL} from '../../../shared/logistics/rules.ts';
import {findLookAlikes, rank} from '../../../shared/logistics/search.ts';
import {companyByName} from '../lib/directory';
import {Button, Field, Icon, Input, describedBy} from '../ui';

export const LookAlike = <T extends {id: string; name: string}>({
  id,
  name,
  candidates,
  excludeId,
  noun,
  describe,
  onOpen,
  openLabel = 'Abrir',
}: {
  id: string;
  name: string;
  candidates: T[];
  excludeId?: string;
  /** «la misma empresa», «la misma persona». */
  noun: string;
  /** Short context for each candidate (role, company, kind). */
  describe?: (candidate: T) => string | null;
  onOpen: (candidate: T) => void;
  openLabel?: string;
}) => {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const matches = useMemo(
    () =>
      name.trim().length >= 3
        ? findLookAlikes(name, candidates, {excludeId}).filter(
            c => !dismissed.includes(c.id),
          )
        : [],
    [name, candidates, excludeId, dismissed],
  );
  if (!matches.length) return null;
  return (
    <div className="lx-lookalike" id={id} role="status">
      <Icon name="alert" size={18} />
      <div className="lx-lookalike__body">
        {matches.map(c => {
          const context = describe?.(c);
          return (
            <div className="lx-lookalike__row" key={c.id}>
              <p>
                ¿Es {noun} que <strong>«{c.name}»</strong>
                {context ? (
                  <span className="lx-muted"> · {context}</span>
                ) : null}
                ?
              </p>
              <div className="lx-lookalike__actions">
                <Button
                  size="sm"
                  variant="primary"
                  id={`${id}-open-${c.id}`}
                  onClick={() => onOpen(c)}
                >
                  {openLabel}
                </Button>
                <Button
                  size="sm"
                  id={`${id}-dismiss-${c.id}`}
                  onClick={() => setDismissed(d => [...d, c.id])}
                >
                  No, es otra
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CompanyField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (name: string) => void;
  companies: Company[];
  error?: string;
  optional?: boolean;
  placeholder?: string;
}> = ({
  id,
  label,
  value,
  onChange,
  companies,
  error,
  optional,
  placeholder = 'Carpas Demo',
}) => {
  const [focused, setFocused] = useState(false);
  const exact = companyByName(companies, value);
  const typed = value.trim();
  const suggestions = useMemo(
    () =>
      typed && !exact
        ? rank(typed, companies, c => [c.name], 4).map(r => r.item)
        : [],
    [typed, exact, companies],
  );
  const lookAlikes = useMemo(
    () =>
      typed.length >= 3 && !exact
        ? findLookAlikes(typed, companies).filter(c => !suggestions.includes(c))
        : [],
    [typed, exact, companies, suggestions],
  );
  const options = [...suggestions, ...lookAlikes].slice(0, 4);
  const statusId = `${id}-status`;

  return (
    <Field id={id} label={label} optional={optional} error={error}>
      <Input
        id={id}
        name={id}
        value={value}
        invalid={!!error}
        aria-describedby={
          [describedBy(id, {error}), typed ? statusId : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="words"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => onChange(e.target.value)}
      />
      {typed && (
        <p
          className={`lx-namestatus${exact ? ' lx-namestatus--known' : ''}`}
          id={statusId}
        >
          {exact ? (
            <>
              <Icon name="check" size={15} />
              Se enlazará con «{exact.name}» ·{' '}
              {COMPANY_KIND_LABEL[exact.kind].toLocaleLowerCase('es-ES')}
            </>
          ) : (
            <>
              <Icon name="plus" size={15} />
              Se creará «{typed}» como empresa o entidad nueva; podrás
              completarla después.
            </>
          )}
        </p>
      )}
      {options.length > 0 && (focused || lookAlikes.length > 0) && (
        <div
          className="lx-suggest"
          role="group"
          aria-label="Empresas parecidas ya registradas"
          id={`${id}-suggestions`}
        >
          <span className="lx-suggest__label">
            {lookAlikes.length && !suggestions.length
              ? '¿Es alguna de estas?'
              : 'Ya registradas:'}
          </span>
          {options.map(c => (
            <button
              key={c.id}
              type="button"
              className="lx-suggest__chip"
              // Keep the input's focus state while tapping a suggestion.
              onMouseDown={e => e.preventDefault()}
              onClick={() => onChange(c.name)}
            >
              <Icon name="building" size={15} />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
};
