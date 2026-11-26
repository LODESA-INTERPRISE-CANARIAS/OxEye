/**
 * Service categories as tappable chips: several for a company, one for an
 * offer. «+ Nueva categoría» adds one for the whole organization (an existing
 * name, in any case, comes back as that category instead of a duplicate).
 */
import React, {useRef, useState} from 'react';
import type {Category} from '../../../shared/logistics/contracts.ts';
import {CATEGORY_NAME_MAX} from '../../../shared/logistics/rules.ts';
import {errorMessage} from '../api/client';
import {serviceCategories} from '../lib/directory';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, HelpTip, Icon, Input} from '../ui';

export const CategoryPicker: React.FC<{
  idPrefix: string;
  legend: string;
  multiple: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
  help?: React.ReactNode;
  error?: string;
}> = ({idPrefix, legend, multiple, value, onChange, help, error}) => {
  const all = useLogisticsStore(s => s.categories);
  const createCategory = useLogisticsStore(s => s.createCategory);
  const categories = serviceCategories(all);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = (c: Category, on: boolean) => {
    if (!multiple) onChange(on ? [c.id] : []);
    else {
      // Keep the categories' own order, whatever the tapping order.
      const next = on ? [...value, c.id] : value.filter(id => id !== c.id);
      onChange(categories.filter(x => next.includes(x.id)).map(x => x.id));
    }
  };

  const add = async () => {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setProblem('Escribe el nombre de la categoría.');
      inputRef.current?.focus();
      return;
    }
    if (clean.length > CATEGORY_NAME_MAX) {
      setProblem(`Como mucho ${CATEGORY_NAME_MAX} caracteres.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const created = await createCategory(clean);
      onChange(
        multiple
          ? [...value.filter(id => id !== created.id), created.id]
          : [created.id],
      );
      setName('');
      setAdding(false);
    } catch (err) {
      setProblem(`No se ha añadido. ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="lx-catpick" id={`${idPrefix}-categories`}>
      <legend className="lx-field__label lx-segmented__legend">
        {legend}
        <span className="lx-field__optional"> · opcional</span>
        {help && (
          <HelpTip label={legend.toLocaleLowerCase('es-ES')}>{help}</HelpTip>
        )}
      </legend>
      <div className="lx-catpick__chips">
        {categories.map(c => {
          const id = `${idPrefix}-cat-${c.id}`;
          const checked = value.includes(c.id);
          return (
            <span className="lx-catpick__chip" key={c.id}>
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={`${idPrefix}-category`}
                id={id}
                checked={checked}
                onChange={e => toggle(c, e.target.checked)}
                onClick={
                  // A radio cannot be unticked by itself: tap again to clear.
                  !multiple && checked ? () => toggle(c, false) : undefined
                }
              />
              <label htmlFor={id}>
                {checked && <Icon name="check" size={14} />}
                {c.name}
              </label>
            </span>
          );
        })}
        {!adding && (
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            id={`${idPrefix}-cat-new`}
            onClick={() => {
              setAdding(true);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Nueva categoría
          </Button>
        )}
      </div>
      {adding && (
        <div className="lx-catpick__new">
          <label
            className="lx-visually-hidden"
            htmlFor={`${idPrefix}-cat-name`}
          >
            Nombre de la nueva categoría
          </label>
          <Input
            ref={inputRef}
            id={`${idPrefix}-cat-name`}
            value={name}
            maxLength={CATEGORY_NAME_MAX + 10}
            placeholder="Aseos portátiles"
            autoComplete="off"
            invalid={!!problem}
            aria-describedby={problem ? `${idPrefix}-cat-problem` : undefined}
            onChange={e => {
              setName(e.target.value);
              setProblem(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                // Not the form's submit: this only adds the category.
                e.preventDefault();
                void add();
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            id={`${idPrefix}-cat-add`}
            onClick={() => void add()}
          >
            Añadir
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setName('');
              setProblem(null);
            }}
          >
            Cancelar
          </Button>
          {problem && (
            <p
              className="lx-field__error"
              id={`${idPrefix}-cat-problem`}
              role="alert"
            >
              {problem}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="lx-field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
};
