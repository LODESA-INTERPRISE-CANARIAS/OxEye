/**
 * «Recursos» in the task form: which inventory items the task counts on.
 * Owned material and contracted services are listed apart, each with its
 * quantity as recorded (`quantityLabel`) and where it is or who provides it.
 * A text filter appears when the inventory is long; chosen items stay on top.
 *
 * Resources deleted meanwhile are shown as «Recurso borrado» and never sent.
 * Quantities are shown, never added up or turned into a load: whether the
 * task carries a heavy load is still its own question (RESOURCE_LOAD_NOTE).
 */
import React, {useMemo, useState} from 'react';
import type {Resource} from '../../../shared/logistics/contracts.ts';
import {quantityLabel} from '../../../shared/logistics/inventory.ts';
import {MAX_RESOURCES_PER_TASK} from '../../../shared/logistics/rules.ts';
import {universalSearch} from '../../../shared/logistics/search.ts';
import {LoadNoteTip} from '../inventory/ResourceParts';
import {sortResources} from '../lib/inventory';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, SearchInput} from '../ui';

/** From this many resources on, a filter helps find one. */
const FILTER_FROM = 8;

export const TaskResourcesField: React.FC<{
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}> = ({value, onChange, error}) => {
  const resources = useLogisticsStore(s => s.resources);
  const categories = useLogisticsStore(s => s.categories);
  const ready = useLogisticsStore(s => s.resourcesState === 'ready');
  const [query, setQuery] = useState('');
  const q = query.trim();

  const known = useMemo(() => new Set(resources.map(r => r.id)), [resources]);
  const gone = ready ? value.filter(id => !known.has(id)) : [];
  const full = value.length >= MAX_RESOURCES_PER_TASK;

  const matching = useMemo(() => {
    if (!q) return null;
    return new Set(
      universalSearch(
        q,
        {resources, categories},
        {types: ['resource'], limit: 1000},
      ).map(h => h.id),
    );
  }, [q, resources, categories]);

  const groups = useMemo(() => {
    const sorted = sortResources(resources);
    // Chosen ones first, so what the task uses is visible without scrolling.
    const order = (list: Resource[]) => [
      ...list.filter(r => value.includes(r.id)),
      ...list.filter(r => !value.includes(r.id)),
    ];
    const shown = sorted.filter(
      r => !matching || matching.has(r.id) || value.includes(r.id),
    );
    return [
      {
        id: 'owned',
        title: 'Propios',
        icon: 'warehouse' as const,
        items: order(shown.filter(r => r.ownership === 'owned')),
      },
      {
        id: 'contracted',
        title: 'Contratados',
        icon: 'building' as const,
        items: order(shown.filter(r => r.ownership === 'contracted')),
      },
    ].filter(g => g.items.length > 0);
    // `value` changes the order only when the list is rebuilt, which is fine:
    // a box ticked by the user stays where it is until the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, matching]);

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter(x => x !== id));

  // Enter (or the phone «Buscar» key) must not submit the task form. With a
  // single match it ticks or unticks that resource, like a quick pick.
  const onFilterKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!matching || matching.size !== 1) return;
    const [only] = matching;
    const on = !value.includes(only);
    if (on && full) return;
    toggle(only, on);
  };

  const errorId = 'lx-task-resources-error';

  return (
    <fieldset
      className="lx-picklist lx-taskres"
      id="lx-task-resources"
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="lx-field__label lx-segmented__legend">
        Recursos
        <span className="lx-field__optional"> · opcional</span>
        <LoadNoteTip label="recursos y carga" />
      </legend>
      {value.length > 0 && (
        <p className="lx-muted lx-taskres__count lx-num" role="status">
          {value.length === 1
            ? '1 recurso elegido'
            : `${value.length} recursos elegidos`}
          {full ? ` · como mucho ${MAX_RESOURCES_PER_TASK}` : ''}
        </p>
      )}
      {resources.length === 0 && gone.length === 0 ? (
        <p className="lx-muted">
          {ready
            ? 'Aún no hay recursos en el inventario. Añádelos en Inventarios y elígelos aquí.'
            : 'Cargando el inventario…'}
        </p>
      ) : (
        <>
          {resources.length >= FILTER_FROM && (
            <SearchInput
              id="lx-task-resources-search"
              value={query}
              onValue={setQuery}
              label="Filtrar recursos"
              placeholder="Filtrar por nombre, categoría o almacén"
              aria-describedby={error ? errorId : undefined}
              onKeyDown={onFilterKey}
            />
          )}
          <div className="lx-picklist__list lx-taskres__list">
            {gone.length > 0 && (
              <ul className="lx-taskres__group">
                {gone.map(id => (
                  <li key={id} className="lx-deps__gone">
                    <Icon name="trash" size={18} />
                    <span className="lx-deps__gone-text">
                      <span className="lx-deps__title">Recurso borrado</span>
                      <span
                        className="lx-deps__when"
                        id={`lx-task-res-gone-${id}-why`}
                      >
                        Alguien lo ha borrado del inventario. No se guardará.
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-describedby={`lx-task-res-gone-${id}-why`}
                      aria-label="Quitar el recurso borrado"
                      onClick={() => toggle(id, false)}
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {groups.map(g => (
              <div key={g.id} className="lx-taskres__block">
                <p
                  className="lx-taskres__title"
                  id={`lx-task-res-group-${g.id}`}
                >
                  <Icon name={g.icon} size={15} />
                  {g.title}
                </p>
                <ul
                  className="lx-taskres__group"
                  aria-labelledby={`lx-task-res-group-${g.id}`}
                >
                  {g.items.map(r => {
                    const id = `lx-task-res-${r.id}`;
                    const checked = value.includes(r.id);
                    const where =
                      r.ownership === 'owned'
                        ? r.warehouse?.name
                        : r.company?.name;
                    return (
                      <li key={r.id}>
                        <input
                          type="checkbox"
                          id={id}
                          checked={checked}
                          disabled={full && !checked}
                          onChange={e => toggle(r.id, e.target.checked)}
                        />
                        <label htmlFor={id}>
                          <span className="lx-taskres__text">
                            <span className="lx-picklist__title">{r.name}</span>
                            {where && (
                              <span className="lx-picklist__meta">{where}</span>
                            )}
                          </span>
                          <span className="lx-picklist__meta lx-num lx-taskres__qty">
                            {quantityLabel(r)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {q && groups.length === 0 && (
              <p className="lx-muted lx-taskres__none">
                Ningún recurso coincide con «{q}».
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="lx-field__error" role="alert" id={errorId}>
          {error}
        </p>
      )}
    </fieldset>
  );
};
