/**
 * Universal search: one field for people, companies, offers, events, tasks,
 * places, warehouses and resources (never notes), with suggestions while
 * typing (shared `universalSearch` over
 * the loaded lists, so it is instant and works on a weak signal), type and
 * category filters, and the five recent searches when the field is empty.
 *
 * A query is recorded when a result is opened or the search is submitted.
 * Keyboard: arrows move, Enter opens, Escape clears then closes; focus goes
 * back to where the search was opened from.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {
  SearchEntityType,
  SearchHit,
} from '../../../shared/logistics/contracts.ts';
import {
  SEARCH_TYPE_LABEL,
  universalSearch,
} from '../../../shared/logistics/search.ts';
import {useActions} from '../common/actions';
import {relativeTime} from '../lib/format';
import {serviceCategories} from '../lib/directory';
import {resourceCategories} from '../lib/inventory';
import {TASK_KIND_ICON} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Icon,
  SearchInput,
  Select,
  Sheet,
  SkeletonRows,
  type IconName,
} from '../ui';

const TYPES: {type: SearchEntityType; label: string}[] = [
  {type: 'contact', label: 'Personas'},
  {type: 'company', label: 'Empresas'},
  {type: 'offer', label: 'Ofertas'},
  {type: 'event', label: 'Eventos'},
  {type: 'task', label: 'Tareas'},
  {type: 'venue', label: 'Lugares'},
  {type: 'warehouse', label: 'Almacenes'},
  {type: 'resource', label: 'Recursos'},
];

const TYPE_ICON: Partial<Record<SearchEntityType, IconName>> = {
  contact: 'user',
  company: 'building',
  offer: 'offer',
  event: 'calendar',
  task: 'task',
  venue: 'pin',
  warehouse: 'warehouse',
  resource: 'inventory',
};

/** Types a category filter applies to, by category scope. */
const SERVICE_TYPES: (SearchEntityType | null)[] = [null, 'company', 'offer'];
const RESOURCE_TYPES: (SearchEntityType | null)[] = [null, 'resource'];

export const SearchSheet: React.FC<{onClose: () => void}> = ({onClose}) => {
  const events = useLogisticsStore(s => s.events);
  const tasks = useLogisticsStore(s => s.tasks);
  const venues = useLogisticsStore(s => s.venues);
  const companies = useLogisticsStore(s => s.companies);
  const contacts = useLogisticsStore(s => s.contacts);
  const offers = useLogisticsStore(s => s.offers);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const resources = useLogisticsStore(s => s.resources);
  const categories = useLogisticsStore(s => s.categories);
  // Searching runs over the loaded lists: until they are all in, «nada
  // coincide» could be false, so say that they are still loading. Notes are
  // never searched.
  const listsState = useLogisticsStore(s => {
    const states = [
      s.contactsState,
      s.companiesState,
      s.offersState,
      s.eventsState,
      s.tasksState,
      s.warehousesState,
      s.resourcesState,
    ];
    if (states.some(x => x === 'loading' || x === 'idle')) return 'loading';
    return states.includes('error') ? 'partial' : 'ready';
  });
  const recent = useLogisticsStore(s => s.recentSearches);
  const recentState = useLogisticsStore(s => s.recentState);
  const isGuest = useLogisticsStore(s => s.session?.user.role !== 'member');
  const timeZone = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.timezone,
  );
  const loadRecent = useLogisticsStore(s => s.loadRecentSearches);
  const recordSearch = useLogisticsStore(s => s.recordSearch);
  const clearRecent = useLogisticsStore(s => s.clearRecentSearches);
  const toast = useLogisticsStore(s => s.toast);
  const actions = useActions();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchEntityType | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const service = useMemo(() => serviceCategories(categories), [categories]);
  const resourceCats = useMemo(
    () => resourceCategories(categories),
    [categories],
  );
  const serviceApplies = SERVICE_TYPES.includes(type);
  const resourceApplies = RESOURCE_TYPES.includes(type);
  const categoryApplies = serviceApplies || resourceApplies;
  // A category of the other scope (chosen before switching type) is ignored.
  const chosenScope = categories.find(c => c.id === categoryId)?.scope;
  const effectiveCategory =
    (chosenScope === 'service' && serviceApplies) ||
    (chosenScope === 'resource' && resourceApplies)
      ? categoryId
      : null;
  const q = query.trim();
  const filtering = !!type || !!effectiveCategory;

  const hits = useMemo<SearchHit[]>(
    () =>
      q || filtering
        ? universalSearch(
            q,
            {
              events,
              tasks,
              venues,
              companies,
              contacts,
              offers,
              warehouses,
              resources,
              categories,
            },
            {
              types: type ? [type] : undefined,
              categoryId: effectiveCategory,
              limit: 40,
            },
          )
        : [],
    [
      q,
      filtering,
      type,
      effectiveCategory,
      events,
      tasks,
      venues,
      companies,
      contacts,
      offers,
      warehouses,
      resources,
      categories,
    ],
  );

  // A new list starts with nothing highlighted.
  useEffect(() => setActive(-1), [q, type, effectiveCategory]);

  // Keep the highlighted option visible.
  useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`#lx-search-opt-${active}`)
      ?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  const iconOf = (hit: SearchHit): IconName => {
    if (hit.type === 'task') {
      const t = taskById.get(hit.id);
      return t ? TASK_KIND_ICON[t.kind] : 'task';
    }
    return TYPE_ICON[hit.type] ?? 'eye';
  };

  const open = (hit: SearchHit) => {
    if (q) recordSearch(q);
    onClose();
    // After the search sheet has gone, so focus returns properly later.
    window.setTimeout(() => {
      switch (hit.type) {
        case 'contact': {
          const c = contacts.find(x => x.id === hit.id);
          if (c) actions.openContact(c);
          break;
        }
        case 'company': {
          const c = companies.find(x => x.id === hit.id);
          if (c) actions.openCompany(c);
          break;
        }
        case 'offer': {
          const o = offers.find(x => x.id === hit.id);
          if (o) actions.openOffer(o);
          break;
        }
        case 'event': {
          const e = events.find(x => x.id === hit.id);
          if (e) actions.openEvent(e);
          break;
        }
        case 'task': {
          const t = taskById.get(hit.id);
          if (t) actions.openTask(t);
          break;
        }
        case 'venue':
          actions.openVenue(hit.id);
          break;
        case 'warehouse': {
          const w = warehouses.find(x => x.id === hit.id);
          if (w) actions.openWarehouse(w);
          break;
        }
        case 'resource': {
          const r = resources.find(x => x.id === hit.id);
          if (r) actions.openResource(r);
          break;
        }
        default:
          break;
      }
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setActive(i => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive(i => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) open(hit);
      else if (q) {
        recordSearch(q);
        toast(`Búsqueda guardada en recientes: «${q}»`, 'info');
      }
    }
  };

  const pickRecent = (text: string) => {
    setQuery(text);
    inputRef.current?.focus();
  };

  const clear = async () => {
    try {
      await clearRecent();
      toast('Búsquedas recientes borradas', 'success');
    } catch {
      toast('No se han podido borrar las recientes.', 'error');
    }
    inputRef.current?.focus();
  };

  const showRecent = !q && !filtering;
  const activeId = active >= 0 ? `lx-search-opt-${active}` : undefined;

  return (
    <Sheet
      open
      onClose={onClose}
      size="tall"
      id="lx-search-sheet"
      className="lx-searchsheet"
      eyebrow="Buscar en todo"
      title="Buscar"
    >
      <div className="lx-searchsheet__top">
        <SearchInput
          ref={inputRef}
          large
          id="lx-search-input"
          data-autofocus
          value={query}
          onValue={setQuery}
          label="Buscar personas, empresas, ofertas, eventos, tareas, lugares, almacenes y recursos"
          placeholder="Nombre, empresa, lugar, almacén, categoría…"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={hits.length > 0 ? 'lx-search-results' : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onKeyDown={onKeyDown}
        />
        <div
          className="lx-filterchips"
          role="group"
          aria-label="Qué buscar"
          id="lx-search-types"
        >
          <button
            type="button"
            className="lx-filterchip"
            aria-pressed={type === null}
            onClick={() => setType(null)}
          >
            Todo
          </button>
          {TYPES.map(t => (
            <button
              key={t.type}
              type="button"
              className="lx-filterchip"
              id={`lx-search-type-${t.type}`}
              aria-pressed={type === t.type}
              onClick={() => setType(type === t.type ? null : t.type)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {categoryApplies && service.length + resourceCats.length > 0 && (
          <div className="lx-searchsheet__cat">
            <label htmlFor="lx-search-category" className="lx-field__label">
              Categoría
            </label>
            <Select
              id="lx-search-category"
              value={effectiveCategory ?? ''}
              onChange={e => setCategoryId(e.target.value || null)}
            >
              <option value="">Todas las categorías</option>
              {serviceApplies && resourceApplies ? (
                <>
                  {service.length > 0 && (
                    <optgroup label="Empresas y ofertas">
                      {service.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {resourceCats.length > 0 && (
                    <optgroup label="Inventario">
                      {resourceCats.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              ) : (
                (serviceApplies ? service : resourceCats).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              )}
            </Select>
          </div>
        )}
      </div>

      <div className="lx-searchsheet__body">
        {showRecent ? (
          <section
            className="lx-recent"
            id="lx-search-recent"
            aria-labelledby="lx-search-recent-title"
          >
            <div className="lx-recent__head">
              <h3 className="lx-subtitle" id="lx-search-recent-title">
                Búsquedas recientes
                {isGuest && (
                  <span className="lx-muted"> · en este dispositivo</span>
                )}
              </h3>
              {recent.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  id="lx-search-clear-recent"
                  onClick={() => void clear()}
                >
                  Borrar recientes
                </Button>
              )}
            </div>
            {recentState === 'loading' && recent.length === 0 ? (
              <SkeletonRows rows={3} label="Cargando búsquedas recientes" />
            ) : recent.length ? (
              <ul className="lx-recent__list">
                {recent.map(r => (
                  <li key={`${r.query}:${r.at}`}>
                    <button
                      type="button"
                      className="lx-recent__row"
                      onClick={() => pickRecent(r.query)}
                    >
                      <Icon name="clock" size={18} />
                      <span className="lx-recent__query">{r.query}</span>
                      <span className="lx-recent__when lx-num">
                        {relativeTime(r.at, timeZone)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lx-muted lx-recent__empty">
                Busca personas, empresas, ofertas, eventos, tareas, lugares,
                almacenes y recursos. Tus cinco últimas búsquedas aparecerán
                aquí.
              </p>
            )}
          </section>
        ) : hits.length ? (
          <>
            <p className="lx-directory__count lx-num" role="status">
              {hits.length === 40
                ? 'Los 40 primeros resultados'
                : `${hits.length} ${hits.length === 1 ? 'resultado' : 'resultados'}`}
              {listsState === 'loading' && ' · aún se están cargando datos'}
            </p>
            <ul
              className="lx-hits"
              id="lx-search-results"
              role="listbox"
              aria-label="Resultados"
              ref={listRef}
            >
              {hits.map((hit, i) => (
                <li
                  key={`${hit.type}:${hit.id}`}
                  id={`lx-search-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`lx-hit${i === active ? ' is-active' : ''}`}
                  data-hit-type={hit.type}
                  onMouseMove={() => setActive(i)}
                  onClick={() => open(hit)}
                >
                  <span className="lx-hit__icon" aria-hidden="true">
                    <Icon name={iconOf(hit)} size={20} />
                  </span>
                  <span className="lx-hit__text">
                    <span className="lx-hit__title">{hit.title}</span>
                    {hit.subtitle && (
                      <span className="lx-hit__sub">{hit.subtitle}</span>
                    )}
                  </span>
                  <span className="lx-hit__type">
                    {SEARCH_TYPE_LABEL[hit.type]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : listsState === 'loading' ? (
          <div id="lx-search-loading">
            <p className="lx-muted" role="status">
              Cargando personas, empresas, ofertas, eventos, tareas e
              inventario…
            </p>
            <SkeletonRows rows={3} label="Cargando resultados" />
          </div>
        ) : (
          <div className="lx-empty lx-empty--compact" id="lx-search-noresults">
            <span className="lx-empty__icon" aria-hidden="true">
              <Icon name="search" size={20} />
            </span>
            <p className="lx-empty__title" role="status">
              {q ? `Nada coincide con «${q}»` : 'Nada con este filtro'}
            </p>
            <p className="lx-empty__text">
              {listsState === 'partial'
                ? 'Algunas listas no se han podido cargar, así que puede faltar algún resultado. Prueba con otra palabra o vuelve a intentarlo con conexión.'
                : 'Prueba con parte del nombre, otra palabra o quita los filtros.'}
            </p>
            {actions.canWrite && q && (
              <div className="lx-empty__actions">
                <Button
                  size="sm"
                  icon="user"
                  onClick={() => {
                    onClose();
                    window.setTimeout(() => actions.addContact({name: q}), 0);
                  }}
                >
                  Añadir persona «{q}»
                </Button>
                <Button
                  size="sm"
                  icon="building"
                  onClick={() => {
                    onClose();
                    window.setTimeout(() => actions.addCompany({name: q}), 0);
                  }}
                >
                  Añadir empresa «{q}»
                </Button>
                <Button
                  size="sm"
                  icon="inventory"
                  id="lx-search-add-resource"
                  onClick={() => {
                    onClose();
                    window.setTimeout(() => actions.addResource({name: q}), 0);
                  }}
                >
                  Añadir recurso «{q}»
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="lx-searchsheet__keys lx-desktop-only" aria-hidden="true">
        <kbd>↑</kbd> <kbd>↓</kbd> para moverte · <kbd>Intro</kbd> para abrir ·{' '}
        <kbd>Esc</kbd> para cerrar
      </p>
    </Sheet>
  );
};
