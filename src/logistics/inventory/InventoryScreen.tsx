/**
 * «Inventarios»: what the organization has and what it hires, kept apart.
 *
 * - «Propios»: owned material grouped by warehouse (name, address and
 *   count; «Sin almacén» last). Warehouses with nothing yet still show, so a
 *   new one is visible and can be filled with «Añadir recurso aquí».
 * - «Contratados»: services hired from a company (portable toilets, a
 *   stage on hire…), grouped by company, with the offer when it is linked.
 * - Category chips with counts and a quick text filter (same ranking as the
 *   universal search: name, category, warehouse and company; never notes or
 *   locations).
 *
 * Quantities follow the certainty grammar and are never combined with units
 * or dimensions into a load (that is the simulator's X-ray check).
 */
import React, {useMemo, useRef, useState} from 'react';
import type {
  Resource,
  ResourceOwnership,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';
import {missingForWarehouse} from '../../../shared/logistics/quality.ts';
import {COMPANY_KIND_LABEL} from '../../../shared/logistics/rules.ts';
import {universalSearch} from '../../../shared/logistics/search.ts';
import {useActions} from '../common/actions';
import {categoryNames} from '../lib/directory';
import {plural} from '../lib/format';
import {
  countByCategory,
  groupByCompany,
  groupByWarehouse,
  LOOSE,
  resourceCategories,
} from '../lib/inventory';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  EmptyState,
  HelpTip,
  Icon,
  LoadError,
  Pending,
  SearchInput,
  SkeletonRows,
  Withheld,
} from '../ui';
import {ResourceRow} from './ResourceParts';

const SEGMENT_KEY = 'oxeye.logistics.inventory-segment.v1';

function readSegment(): ResourceOwnership {
  try {
    return sessionStorage.getItem(SEGMENT_KEY) === 'contracted'
      ? 'contracted'
      : 'owned';
  } catch {
    return 'owned';
  }
}

const SEGMENTS: {id: ResourceOwnership; label: string}[] = [
  {id: 'owned', label: 'Propios'},
  {id: 'contracted', label: 'Contratados'},
];

const OWNERSHIP_HELP =
  'Propios: material de la organización (carpas, vallas, mesas, vehículos…) guardado en sus almacenes. Contratados: servicios o alquileres de una empresa (aseos portátiles, un escenario alquilado…), con su oferta cuando la hay. Se registran aparte para no confundir lo que es nuestro con lo que se paga.';

export const InventoryScreen: React.FC = () => {
  const resources = useLogisticsStore(s => s.resources);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const categories = useLogisticsStore(s => s.categories);
  const state = useLogisticsStore(s => s.resourcesState);
  const error = useLogisticsStore(s => s.resourcesError);
  const warehousesState = useLogisticsStore(s => s.warehousesState);
  const warehousesError = useLogisticsStore(s => s.warehousesError);
  const refresh = useLogisticsStore(s => s.refresh);
  const {
    canWrite,
    openResource,
    addResource,
    openWarehouse,
    addWarehouse,
    openCompany,
  } = useActions();
  const [segment, setSegmentState] = useState<ResourceOwnership>(readSegment);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const tabs = useRef<Record<ResourceOwnership, HTMLButtonElement | null>>({
    owned: null,
    contracted: null,
  });
  const q = query.trim();
  const owned = segment === 'owned';

  const setSegment = (s: ResourceOwnership) => {
    setSegmentState(s);
    setCategory(null);
    try {
      sessionStorage.setItem(SEGMENT_KEY, s);
    } catch {
      // Not remembered; the default is fine.
    }
  };

  const counts = useMemo(() => {
    let o = 0;
    for (const r of resources) if (r.ownership === 'owned') o++;
    return {owned: o, contracted: resources.length - o};
  }, [resources]);

  const inSegment = useMemo(
    () => resources.filter(r => r.ownership === segment),
    [resources, segment],
  );
  const catCounts = useMemo(() => countByCategory(inSegment), [inSegment]);
  const resourceCats = useMemo(
    () => resourceCategories(categories),
    [categories],
  );
  const names = useMemo(() => categoryNames(categories), [categories]);
  const offerName = useMemo(
    () => new Map(offers.map(o => [o.id, o.name])),
    [offers],
  );

  const visible = useMemo(() => {
    let list = inSegment;
    if (category === LOOSE) list = list.filter(r => !r.categoryId);
    else if (category) list = list.filter(r => r.categoryId === category);
    if (!q) return list;
    const hits = universalSearch(
      q,
      {resources: list, categories},
      {types: ['resource'], limit: 1000},
    );
    const ids = new Set(hits.map(h => h.id));
    return list.filter(r => ids.has(r.id));
  }, [inSegment, category, q, categories]);
  const filtered = !!q || !!category;

  // A warehouse whose name matches the text filter shows whole.
  const matchingWarehouses = useMemo(() => {
    if (!q || category) return null;
    return new Set(
      universalSearch(q, {warehouses}, {types: ['warehouse'], limit: 200}).map(
        h => h.id,
      ),
    );
  }, [q, category, warehouses]);

  const ownedGroups = useMemo(() => {
    if (!owned) return [];
    if (!matchingWarehouses) {
      return groupByWarehouse(visible, warehouses, !filtered);
    }
    const extra = inSegment.filter(
      r => r.warehouse && matchingWarehouses.has(r.warehouse.id),
    );
    const merged = [...new Set([...visible, ...extra])];
    return groupByWarehouse(merged, warehouses, false).concat(
      // Empty warehouses that match by name, so they can still be opened.
      warehouses
        .filter(
          w =>
            matchingWarehouses.has(w.id) &&
            !merged.some(r => r.warehouse?.id === w.id),
        )
        .map(w => ({key: w.id, warehouse: w, items: [] as Resource[]})),
    );
  }, [owned, visible, warehouses, filtered, matchingWarehouses, inSegment]);
  const companyGroups = useMemo(
    () => (owned ? [] : groupByCompany(visible, companies)),
    [owned, visible, companies],
  );

  const chips = [
    ...resourceCats
      .filter(c => catCounts.has(c.id) || c.id === category)
      .map(c => ({id: c.id, name: c.name, count: catCounts.get(c.id) ?? 0})),
    ...(catCounts.has(LOOSE)
      ? [{id: LOOSE, name: 'Sin categoría', count: catCounts.get(LOOSE) ?? 0}]
      : []),
  ];

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: ResourceOwnership = owned ? 'contracted' : 'owned';
    setSegment(next);
    tabs.current[next]?.focus();
  };

  const loading =
    (state === 'loading' || state === 'idle') &&
    resources.length === 0 &&
    warehouses.length === 0;
  const failed =
    (state === 'error' || warehousesState === 'error') &&
    resources.length === 0 &&
    warehouses.length === 0;
  const nothing = resources.length === 0 && warehouses.length === 0;
  const shownCount = owned
    ? ownedGroups.reduce((n, g) => n + g.items.length, 0)
    : visible.length;

  let body: React.ReactNode;
  if (loading) {
    body = <SkeletonRows rows={6} label="Cargando el inventario" />;
  } else if (failed) {
    body = (
      <LoadError
        message={error ?? warehousesError ?? ''}
        onRetry={() => void refresh()}
      />
    );
  } else if (owned && nothing) {
    body = (
      <EmptyState
        icon="warehouse"
        title="Aún no hay almacenes ni recursos"
        id="lx-inventory-empty"
        action={
          canWrite && (
            <div className="lx-empty__actions">
              <Button
                variant="primary"
                icon="plus"
                id="lx-inventory-empty-add-warehouse"
                onClick={() => addWarehouse()}
              >
                Añadir almacén
              </Button>
              <Button
                icon="inventory"
                id="lx-inventory-empty-add"
                onClick={() => addResource({ownership: 'owned'})}
              >
                Añadir recurso
              </Button>
            </div>
          )
        }
      >
        {canWrite
          ? 'Empieza por el almacén que vayáis a visitar y apunta lo que veáis: carpas, vallas, mesas, vehículos… Basta con el nombre; la cantidad y el estado pueden quedar por evaluar.'
          : 'Cuando el equipo registre almacenes y material, aparecerán aquí.'}
      </EmptyState>
    );
  } else if (!owned && inSegment.length === 0) {
    body = (
      <EmptyState
        icon="building"
        title="Aún no hay servicios contratados"
        id="lx-inventory-empty-contracted"
        action={
          canWrite && (
            <Button
              variant="primary"
              icon="plus"
              id="lx-inventory-empty-add-contracted"
              onClick={() => addResource({ownership: 'contracted'})}
            >
              Añadir servicio contratado
            </Button>
          )
        }
      >
        {canWrite
          ? 'Lo que se alquila o se contrata a una empresa: aseos portátiles, un escenario, un generador… con su empresa y, si la hay, su oferta del catálogo.'
          : 'Cuando el equipo registre servicios contratados, aparecerán aquí.'}
      </EmptyState>
    );
  } else if (filtered && shownCount === 0 && (!owned || !ownedGroups.length)) {
    body = (
      <EmptyState
        compact
        icon="search"
        title={q ? `Nada coincide con «${q}»` : 'Nada en esta categoría'}
        id="lx-inventory-noresults"
        action={
          <div className="lx-empty__actions">
            {canWrite && q && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => addResource({name: q, ownership: segment})}
              >
                Añadir «{q}»
              </Button>
            )}
            <Button
              onClick={() => {
                setQuery('');
                setCategory(null);
              }}
            >
              Quitar filtros
            </Button>
          </div>
        }
      >
        Prueba con parte del nombre, la categoría o el almacén.
      </EmptyState>
    );
  } else if (owned) {
    body = ownedGroups.map(g =>
      g.warehouse ? (
        <WarehouseGroupView
          key={g.key}
          warehouse={g.warehouse}
          items={g.items}
          filtered={filtered}
          canWrite={canWrite}
          names={names}
          onOpenWarehouse={openWarehouse}
          onOpenResource={openResource}
          onAddHere={w =>
            addResource({
              ownership: 'owned',
              warehouseName: w.name,
              categoryId: category && category !== LOOSE ? category : null,
            })
          }
        />
      ) : (
        <section
          key={g.key}
          className="lx-whgroup lx-whgroup--loose"
          aria-labelledby="lx-whgroup-loose"
          data-warehouse-id="none"
        >
          <div className="lx-whgroup__head">
            <span className="lx-whgroup__icon" aria-hidden="true">
              <Icon name="inventory" size={20} />
            </span>
            <div className="lx-whgroup__titles">
              <h3 className="lx-whgroup__title" id="lx-whgroup-loose">
                Sin almacén
                <span className="lx-count lx-num">{g.items.length}</span>
              </h3>
              <p className="lx-whgroup__sub">
                Material del que aún no consta dónde se guarda.
              </p>
            </div>
          </div>
          <ul className="lx-reslist">
            {g.items.map(r => (
              <ResourceRow
                key={r.id}
                resource={r}
                category={r.categoryId ? names.get(r.categoryId) : null}
                onOpen={openResource}
              />
            ))}
          </ul>
        </section>
      ),
    );
  } else {
    body = companyGroups.map(g => (
      <section
        key={g.key}
        className="lx-whgroup"
        aria-labelledby={`lx-cogroup-${g.key}`}
        data-company-id={g.company?.id ?? 'none'}
      >
        <div className="lx-whgroup__head">
          {g.record ? (
            <button
              type="button"
              className="lx-whgroup__open"
              onClick={() => openCompany(g.record!)}
            >
              <span className="lx-whgroup__icon" aria-hidden="true">
                <Icon name="building" size={20} />
              </span>
              <span className="lx-whgroup__titles">
                <span className="lx-whgroup__title" id={`lx-cogroup-${g.key}`}>
                  {g.company!.name}
                  <span className="lx-count lx-num">{g.items.length}</span>
                </span>
                <span className="lx-whgroup__sub">
                  {COMPANY_KIND_LABEL[g.record.kind]}
                </span>
              </span>
              <Icon name="chevronRight" size={18} className="lx-dirrow__chev" />
            </button>
          ) : (
            <>
              <span className="lx-whgroup__icon" aria-hidden="true">
                <Icon name="building" size={20} />
              </span>
              <div className="lx-whgroup__titles">
                <h3 className="lx-whgroup__title" id={`lx-cogroup-${g.key}`}>
                  {g.company?.name ?? 'Sin empresa'}
                  <span className="lx-count lx-num">{g.items.length}</span>
                </h3>
                {!g.company && (
                  <p className="lx-whgroup__sub">
                    Aún no consta qué empresa lo presta.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        <ul className="lx-reslist">
          {g.items.map(r => (
            <ResourceRow
              key={r.id}
              resource={r}
              category={r.categoryId ? names.get(r.categoryId) : null}
              context={
                r.offerId && offerName.get(r.offerId)
                  ? `Oferta: ${offerName.get(r.offerId)}`
                  : null
              }
              onOpen={openResource}
            />
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <div className="lx-directory lx-inventory" id="lx-space-inventarios">
      <div className="lx-directory__bar">
        <div className="lx-inventory__segrow">
          <div
            className="lx-segtabs"
            role="tablist"
            aria-label="Qué ver"
            onKeyDown={onTabKey}
          >
            {SEGMENTS.map(s => {
              const selected = segment === s.id;
              return (
                <button
                  key={s.id}
                  ref={el => {
                    tabs.current[s.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`lx-inventory-tab-${s.id}`}
                  aria-selected={selected}
                  aria-controls="lx-inventory-panel"
                  tabIndex={selected ? 0 : -1}
                  className="lx-segtabs__tab"
                  onClick={() => setSegment(s.id)}
                >
                  <Icon
                    name={s.id === 'owned' ? 'warehouse' : 'building'}
                    size={18}
                  />
                  <span>{s.label}</span>
                  <span className="lx-segtabs__count lx-num">
                    {counts[s.id]}
                  </span>
                </button>
              );
            })}
          </div>
          <HelpTip label="propios y contratados">{OWNERSHIP_HELP}</HelpTip>
        </div>
        <div className="lx-directory__tools">
          <SearchInput
            id="lx-inventory-search"
            value={query}
            onValue={setQuery}
            label="Buscar en el inventario"
            placeholder={
              owned
                ? 'Buscar recurso, categoría o almacén'
                : 'Buscar servicio, categoría o empresa'
            }
          />
          {canWrite && (
            <Button
              icon="plus"
              id="lx-inventory-add"
              onClick={() =>
                addResource({
                  ownership: segment,
                  categoryId: category && category !== LOOSE ? category : null,
                })
              }
            >
              {owned ? 'Añadir recurso' : 'Añadir servicio'}
            </Button>
          )}
          {canWrite && owned && (
            <Button
              variant="ghost"
              icon="warehouse"
              className="lx-inventory__addwh"
              id="lx-inventory-add-warehouse"
              onClick={() => addWarehouse()}
            >
              Nuevo almacén
            </Button>
          )}
        </div>
        {chips.length > 0 && (
          <div
            className="lx-filterchips"
            role="group"
            aria-label="Filtrar por categoría"
            id="lx-inventory-filters"
          >
            <button
              type="button"
              className="lx-filterchip"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              Todas
              <span className="lx-num">{inSegment.length}</span>
            </button>
            {chips.map(c => (
              <button
                key={c.id}
                type="button"
                className="lx-filterchip"
                data-category-id={c.id}
                aria-pressed={category === c.id}
                onClick={() => setCategory(category === c.id ? null : c.id)}
              >
                {c.name}
                <span className="lx-num">{c.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="lx-directory__panel"
        role="tabpanel"
        id="lx-inventory-panel"
        aria-labelledby={`lx-inventory-tab-${segment}`}
      >
        {!loading &&
          !failed &&
          (inSegment.length > 0 || (owned && warehouses.length > 0)) && (
            <p className="lx-directory__count lx-num" role="status">
              {filtered
                ? `${plural(shownCount, owned ? 'recurso' : 'servicio', owned ? 'recursos' : 'servicios')} de ${inSegment.length}`
                : owned
                  ? `${plural(inSegment.length, 'recurso propio', 'recursos propios')} · ${plural(warehouses.length, 'almacén', 'almacenes')}`
                  : plural(
                      inSegment.length,
                      'servicio contratado',
                      'servicios contratados',
                    )}
            </p>
          )}
        {body}
      </div>
    </div>
  );
};

const WarehouseGroupView: React.FC<{
  warehouse: Warehouse;
  items: Resource[];
  filtered: boolean;
  canWrite: boolean;
  names: Map<string, string>;
  onOpenWarehouse: (w: Warehouse) => void;
  onOpenResource: (r: Resource) => void;
  onAddHere: (w: Warehouse) => void;
}> = ({
  warehouse: w,
  items,
  filtered,
  canWrite,
  names,
  onOpenWarehouse,
  onOpenResource,
  onAddHere,
}) => {
  const missing = missingForWarehouse(w);
  const titleId = `lx-whgroup-${w.id}`;
  return (
    <section
      className="lx-whgroup"
      aria-labelledby={titleId}
      data-warehouse-id={w.id}
    >
      <div className="lx-whgroup__head">
        <button
          type="button"
          className="lx-whgroup__open"
          onClick={() => onOpenWarehouse(w)}
        >
          <span className="lx-whgroup__icon" aria-hidden="true">
            <Icon name="warehouse" size={20} />
          </span>
          <span className="lx-whgroup__titles">
            <span className="lx-whgroup__title" id={titleId}>
              {w.name}
              <span className="lx-count lx-num">
                {filtered ? items.length : w.resourceCount}
              </span>
              {w.isDemo && <span className="lx-dirrow__demo">Demo</span>}
            </span>
            <span className="lx-whgroup__sub">
              <Icon name="pin" size={14} />
              {w.address ? (
                w.address
              ) : w.restricted ? (
                <Withheld />
              ) : (
                <Pending>Dirección pendiente de verificar</Pending>
              )}
            </span>
          </span>
          <Icon name="chevronRight" size={18} className="lx-dirrow__chev" />
        </button>
        {canWrite && (
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            className="lx-whgroup__add"
            id={`lx-whgroup-add-${w.id}`}
            aria-label={`Añadir recurso en ${w.name}`}
            onClick={() => onAddHere(w)}
          >
            Añadir aquí
          </Button>
        )}
      </div>
      {items.length ? (
        <ul className="lx-reslist">
          {items.map(r => (
            <ResourceRow
              key={r.id}
              resource={r}
              category={r.categoryId ? names.get(r.categoryId) : null}
              onOpen={onOpenResource}
            />
          ))}
        </ul>
      ) : (
        <p className="lx-muted lx-whgroup__empty">
          {filtered
            ? 'Nada de este almacén coincide con el filtro.'
            : canWrite
              ? 'Aún no hay recursos apuntados en este almacén.'
              : 'Sin recursos registrados.'}
          {missing.length > 0 && !filtered && (
            <span className="lx-dirrow__missing">
              {' '}
              · Falta {missing.join(', ')}
            </span>
          )}
        </p>
      )}
    </section>
  );
};
