/**
 * Categories as tappable chips: several for a company, one for an offer or a
 * resource. `scope` picks the list (service = companies and offers, resource
 * = inventory). «+ Nueva categoría» adds one for the whole organization (an
 * existing name, in any case, comes back as that category instead of a
 * duplicate).
 *
 * «Gestionar» switches the same chips into a manage mode: the
 * organization's own categories turn soft red with a × in their corner,
 * built-ins stay as they are (they cannot be deleted), and «Hecho» leaves
 * the mode. The × first says which records lose the category.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {
  Category,
  CategoryScope,
} from '../../../shared/logistics/contracts.ts';
import {CATEGORY_NAME_MAX} from '../../../shared/logistics/rules.ts';
import {errorMessage} from '../api/client';
import {serviceCategories} from '../lib/directory';
import {plural} from '../lib/format';
import {resourceCategories} from '../lib/inventory';
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
  /** Which categories: companies and offers (default) or inventory. */
  scope?: CategoryScope;
  /**
   * Categories the saved record being edited holds. Deleting one would
   * change that record on the server (new version) and its own save would
   * then be rejected as a conflict, so «Gestionar» does not offer it.
   */
  lockedIds?: readonly string[];
}> = ({
  idPrefix,
  legend,
  multiple,
  value,
  onChange,
  help,
  error,
  scope = 'service',
  lockedIds = [],
}) => {
  const all = useLogisticsStore(s => s.categories);
  const createCategory = useLogisticsStore(s => s.createCategory);
  const deleteCategory = useLogisticsStore(s => s.deleteCategory);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const resources = useLogisticsStore(s => s.resources);
  const toast = useLogisticsStore(s => s.toast);
  const categories = useMemo(
    () =>
      scope === 'resource' ? resourceCategories(all) : serviceCategories(all),
    [all, scope],
  );
  const custom = categories.filter(c => !c.builtIn);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The category whose × was pressed: its confirmation is open. */
  const [asking, setAsking] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const manageRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes after the confirmation closes. */
  const returnFocus = useRef<string | null>(null);

  const managedNow = managing && custom.length > 0;
  const askingCategory = asking
    ? (custom.find(c => c.id === asking) ?? null)
    : null;
  const locked = custom.filter(c => lockedIds.includes(c.id));

  // The confirmation opens on «No borrar»: the safe answer is the default.
  useEffect(() => {
    if (askingCategory) keepRef.current?.focus();
  }, [askingCategory]);

  // After «No borrar», back to the × that opened it; after a delete (or when
  // the last own category is gone), to «Hecho» / «Gestionar».
  useEffect(() => {
    if (asking || !returnFocus.current) return;
    const target =
      document.getElementById(returnFocus.current) ??
      manageRef.current ??
      // The last own category is gone with «Gestionar»: «Nueva categoría».
      document.getElementById(`${idPrefix}-cat-new`);
    returnFocus.current = null;
    target?.focus();
  }, [asking, managedNow, idPrefix]);

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
      const created = await createCategory(clean, scope);
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

  const losers = (c: Category): string => {
    const parts: string[] = [];
    const co = companies.filter(x => x.categoryIds.includes(c.id)).length;
    const of = offers.filter(x => x.categoryId === c.id).length;
    const re = resources.filter(x => x.categoryId === c.id).length;
    if (co) parts.push(plural(co, 'empresa o entidad', 'empresas o entidades'));
    if (of) parts.push(plural(of, 'oferta', 'ofertas'));
    if (re) parts.push(plural(re, 'recurso', 'recursos'));
    if (!parts.length) return 'Ningún registro la usa.';
    const list =
      parts.length > 1
        ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
        : parts[0];
    return `La perderán ${list}; no se borra nada más.`;
  };

  const remove = async (c: Category) => {
    setRemoving(true);
    setRemoveProblem(null);
    try {
      await deleteCategory(c);
      if (value.includes(c.id)) onChange(value.filter(x => x !== c.id));
      returnFocus.current = `${idPrefix}-cat-manage`;
      setAsking(null);
      // Nothing of your own left to delete: the mode ends by itself.
      if (custom.length <= 1) setManaging(false);
      toast(`Categoría borrada: ${c.name}`, 'success');
    } catch (err) {
      setRemoveProblem(`No se ha borrado. ${errorMessage(err)}`);
    } finally {
      setRemoving(false);
    }
  };

  const stopManaging = () => {
    setManaging(false);
    setAsking(null);
    setRemoveProblem(null);
  };

  return (
    <fieldset
      className={`lx-catpick${managedNow ? ' is-managing' : ''}`}
      id={`${idPrefix}-categories`}
    >
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
          const removable = managedNow && !c.builtIn;
          const isLocked = lockedIds.includes(c.id);
          return (
            <span
              className={`lx-catpick__chip${removable ? ' is-removable' : ''}`}
              key={c.id}
            >
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
              {removable && (
                <button
                  type="button"
                  className="lx-catpick__remove"
                  id={`${idPrefix}-cat-delete-${c.id}`}
                  aria-label={`Borrar la categoría ${c.name}`}
                  aria-describedby={
                    isLocked ? `${idPrefix}-cat-locked-${c.id}` : undefined
                  }
                  aria-expanded={asking === c.id}
                  disabled={isLocked || removing}
                  onClick={() => {
                    setAsking(c.id);
                    setRemoveProblem(null);
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </span>
          );
        })}
        {!adding && !managedNow && (
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            id={`${idPrefix}-cat-new`}
            onClick={() => {
              setAdding(true);
              stopManaging();
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Nueva categoría
          </Button>
        )}
        {custom.length > 0 && !adding && (
          <Button
            ref={manageRef}
            size="sm"
            variant={managedNow ? 'primary' : 'ghost'}
            icon={managedNow ? 'check' : 'edit'}
            id={`${idPrefix}-cat-manage`}
            aria-pressed={managedNow}
            aria-controls={`${idPrefix}-cat-managed`}
            onClick={() => (managedNow ? stopManaging() : setManaging(true))}
          >
            {managedNow ? 'Hecho' : 'Gestionar'}
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
            placeholder={
              scope === 'resource' ? 'Material de limpieza' : 'Aseos portátiles'
            }
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
      {managedNow && (
        <div className="lx-catmanage" id={`${idPrefix}-cat-managed`}>
          {askingCategory ? (
            <div
              className="lx-catmanage__confirm"
              role="group"
              aria-labelledby={`${idPrefix}-cat-ask-${askingCategory.id}`}
            >
              <p id={`${idPrefix}-cat-ask-${askingCategory.id}`}>
                <strong>¿Borrar «{askingCategory.name}»?</strong>{' '}
                {losers(askingCategory)}
              </p>
              <div className="lx-catmanage__actions">
                <Button
                  ref={keepRef}
                  size="sm"
                  variant="ghost"
                  id={`${idPrefix}-cat-keep-${askingCategory.id}`}
                  disabled={removing}
                  onClick={() => {
                    returnFocus.current = `${idPrefix}-cat-delete-${askingCategory.id}`;
                    setAsking(null);
                    setRemoveProblem(null);
                  }}
                >
                  No borrar
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon="trash"
                  busy={removing}
                  id={`${idPrefix}-cat-confirm-${askingCategory.id}`}
                  onClick={() => void remove(askingCategory)}
                >
                  Borrar categoría
                </Button>
              </div>
            </div>
          ) : (
            <p className="lx-muted lx-catmanage__intro">
              Toca la <span aria-hidden="true">×</span>
              <span className="lx-visually-hidden">cruz</span> de una categoría
              vuestra (en rojo) para borrarla. Las que trae OxEye no se pueden
              borrar.
            </p>
          )}
          {locked.map(c => (
            <p className="lx-catmanage__locked" key={c.id}>
              <strong>{c.name}</strong>:{' '}
              <span id={`${idPrefix}-cat-locked-${c.id}`}>
                Quítala de esta ficha y guarda antes de borrarla.
              </span>
            </p>
          ))}
          {removeProblem && (
            <p className="lx-field__error" role="alert">
              {removeProblem}
            </p>
          )}
        </div>
      )}
      {error && (
        <p
          className="lx-field__error"
          role="alert"
          id={`${idPrefix}-categories-error`}
        >
          {error}
        </p>
      )}
    </fieldset>
  );
};
