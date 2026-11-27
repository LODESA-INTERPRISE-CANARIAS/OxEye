/**
 * «Catálogo»: what each supplier offers and at what price, grouped by
 * category (built-in order, then the organization's own, then «Sin
 * categoría»), with category chips (a horizontal strip on phones) and a
 * search field. Unknown prices say so; withheld prices (guests) say who sees
 * them; unknown extras show as «+ transporte pendiente». A category with at
 * least two comparable offers has «Comparar» next to its name. E5: prices
 * are before tax; each row adds its estimate with tax when it is known.
 */
import React, {useMemo, useState} from 'react';
import {
  pendingExtras,
  perUnitLabel,
  priceLabel,
} from '../../../shared/logistics/catalogue.ts';
import type {Offer} from '../../../shared/logistics/contracts.ts';
import {universalSearch} from '../../../shared/logistics/search.ts';
import {useActions} from '../common/actions';
import {serviceCategories} from '../lib/directory';
import {plural} from '../lib/format';
import {UnsentMark} from '../offline/PendingMark';
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
import {estimateLine} from '../budget/tax';
import {
  COMPARE_HELP,
  categoriesWithComparison,
  compareCategory,
} from './compare';
import {ApartList, RankedList} from './CompareParts';
import {ContractingSpace} from '../offers/ContractingSpace';

const NONE = '__none__';

/** «transporte», «transporte y montaje», «transporte, montaje y mantenimiento». */
function listText(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} y ${words[words.length - 1]}`;
}

export function extrasHint(offer: Offer): string | null {
  const extras = pendingExtras(offer);
  if (!extras.length) return null;
  return `+ ${listText(extras)} ${extras.length === 1 ? 'pendiente' : 'pendientes'}`;
}

/** E6–E7: the offers list is the first view of the contracting tabs. */
export const CatalogScreen: React.FC = () => (
  <ContractingSpace offers={<CatalogOffers />} />
);

const CatalogOffers: React.FC = () => {
  const offers = useLogisticsStore(s => s.offers);
  const categories = useLogisticsStore(s => s.categories);
  const state = useLogisticsStore(s => s.offersState);
  const error = useLogisticsStore(s => s.offersError);
  const refresh = useLogisticsStore(s => s.refresh);
  const {canWrite, openOffer, addOffer} = useActions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  /** The category whose comparison is open under its name. */
  const [comparing, setComparing] = useState<string | null>(null);
  const q = query.trim();
  // Over every offer, as in the offer sheet: a search narrows the list, not
  // what an offer is compared with.
  const comparable = useMemo(() => categoriesWithComparison(offers), [offers]);

  const service = useMemo(() => serviceCategories(categories), [categories]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of offers) {
      const k = o.categoryId ?? NONE;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [offers]);

  const visible = useMemo(() => {
    let list = offers;
    if (category === NONE) list = list.filter(o => !o.categoryId);
    else if (category) list = list.filter(o => o.categoryId === category);
    if (!q) return list;
    const hits = universalSearch(
      q,
      {offers: list, categories},
      {types: ['offer'], limit: 500},
    );
    const ids = new Set(hits.map(h => h.id));
    return list.filter(o => ids.has(o.id));
  }, [offers, category, q, categories]);

  const groups = useMemo(() => {
    const out: {id: string; name: string; items: Offer[]}[] = [];
    for (const c of service) {
      const items = visible.filter(o => o.categoryId === c.id);
      if (items.length) out.push({id: c.id, name: c.name, items});
    }
    const known = new Set(service.map(c => c.id));
    const loose = visible.filter(
      o => !o.categoryId || !known.has(o.categoryId),
    );
    if (loose.length) out.push({id: NONE, name: 'Sin categoría', items: loose});
    return out;
  }, [service, visible]);

  const chips = [
    ...service
      .filter(c => counts.has(c.id) || c.id === category)
      .map(c => ({id: c.id, name: c.name, count: counts.get(c.id) ?? 0})),
    ...(counts.has(NONE)
      ? [{id: NONE, name: 'Sin categoría', count: counts.get(NONE) ?? 0}]
      : []),
  ];

  const loading = (state === 'loading' || state === 'idle') && !offers.length;
  const failed = state === 'error' && !offers.length;
  const filtered = !!q || !!category;

  let body: React.ReactNode;
  if (loading) {
    body = <SkeletonRows rows={6} label="Cargando el catálogo" />;
  } else if (failed) {
    body = <LoadError message={error ?? ''} onRetry={() => void refresh()} />;
  } else if (!offers.length) {
    body = (
      <EmptyState
        icon="catalog"
        title="El catálogo está vacío"
        id="lx-catalog-empty"
        action={
          canWrite && (
            <Button
              variant="primary"
              icon="plus"
              id="lx-catalog-empty-add"
              onClick={() => addOffer()}
            >
              Añadir oferta
            </Button>
          )
        }
      >
        {canWrite
          ? 'Apunta lo que ofrece cada proveedor: qué es, a qué precio y por qué unidad. Si no sabes el precio, déjalo pendiente.'
          : 'Cuando el equipo registre ofertas de proveedores, aparecerán aquí.'}
      </EmptyState>
    );
  } else if (!visible.length) {
    body = (
      <EmptyState
        compact
        icon="search"
        title={q ? `Ninguna oferta coincide con «${q}»` : 'Sin ofertas aquí'}
        id="lx-catalog-noresults"
        action={
          <Button
            onClick={() => {
              setQuery('');
              setCategory(null);
            }}
          >
            Quitar filtros
          </Button>
        }
      >
        Prueba con otra palabra o con todas las categorías.
      </EmptyState>
    );
  } else {
    body = groups.map(g => (
      <section
        key={g.id}
        className="lx-catgroup"
        aria-labelledby={`lx-catgroup-${g.id}`}
        data-category-id={g.id}
      >
        <div className="lx-catgroup__head">
          <h3 className="lx-catgroup__title" id={`lx-catgroup-${g.id}`}>
            {g.name}
            <span className="lx-count lx-num">{g.items.length}</span>
          </h3>
          {comparable.has(g.id) && (
            <Button
              size="sm"
              variant={comparing === g.id ? 'primary' : 'secondary'}
              icon={comparing === g.id ? 'close' : 'scale'}
              id={`lx-catgroup-compare-${g.id}`}
              aria-expanded={comparing === g.id}
              aria-controls={`lx-catcompare-${g.id}`}
              aria-label={
                comparing === g.id
                  ? `Ocultar la comparación de ${g.name}`
                  : `Comparar las ofertas de ${g.name}`
              }
              onClick={() => setComparing(comparing === g.id ? null : g.id)}
            >
              {comparing === g.id ? 'Ocultar' : 'Comparar'}
            </Button>
          )}
        </div>
        {comparing === g.id && comparable.has(g.id) && (
          <CategoryCompare
            categoryId={g.id}
            categoryName={g.name}
            offers={offers}
            onShow={openOffer}
          />
        )}
        <ul className="lx-offerlist">
          {g.items.map(o => (
            <li key={o.id}>
              <OfferRow offer={o} onOpen={openOffer} />
            </li>
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <div className="lx-directory lx-catalog" id="lx-space-catalogo">
      <div className="lx-directory__bar">
        <div className="lx-directory__tools">
          <SearchInput
            id="lx-catalog-search"
            value={query}
            onValue={setQuery}
            label="Buscar en el catálogo"
            placeholder="Buscar oferta, empresa o categoría"
          />
          {canWrite && (
            <Button
              icon="plus"
              id="lx-catalog-add"
              onClick={() =>
                addOffer({
                  categoryId: category && category !== NONE ? category : null,
                })
              }
            >
              Añadir oferta
            </Button>
          )}
        </div>
        {chips.length > 0 && (
          <div
            className="lx-filterchips"
            role="group"
            aria-label="Filtrar por categoría"
            id="lx-catalog-filters"
          >
            <button
              type="button"
              className="lx-filterchip"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              Todas
              <span className="lx-num">{offers.length}</span>
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
      {!loading && !failed && offers.length > 0 && (
        <p className="lx-directory__count lx-num" role="status">
          {filtered
            ? `${plural(visible.length, 'oferta', 'ofertas')} de ${offers.length}`
            : plural(offers.length, 'oferta', 'ofertas')}
        </p>
      )}
      {body}
    </div>
  );
};

/**
 * «Comparar» for one category, opened under its name without entering an
 * offer: each like-for-like group ranked with medals, the rest listed apart
 * with the reason. Tapping an offer opens it.
 */
const CategoryCompare: React.FC<{
  categoryId: string;
  categoryName: string;
  offers: Offer[];
  onShow: (offer: Offer) => void;
}> = ({categoryId, categoryName, offers, onShow}) => {
  const {groups, apart} = useMemo(
    () => compareCategory(categoryId, offers),
    [categoryId, offers],
  );
  const id = `lx-catcompare-${categoryId}`;
  return (
    <section className="lx-catcompare" id={id} aria-labelledby={`${id}-title`}>
      <h4 className="lx-catcompare__title" id={`${id}-title`}>
        <Icon name="scale" size={18} />
        Comparar · {categoryName}
        <HelpTip label="comparar">{COMPARE_HELP}</HelpTip>
      </h4>
      {groups.map(g => (
        <div className="lx-catcompare__group" key={g.key}>
          <p className="lx-catcompare__scope lx-num">
            <strong>€ / {perUnitLabel(g.peers[0])}</strong> · con el impuesto de
            cada una · estimación · la más barata primero
          </p>
          <RankedList peers={g.peers} estimates={g.estimates} onShow={onShow} />
        </div>
      ))}
      <ApartList
        items={apart}
        title="No se ordenan"
        onShow={onShow}
        id={`${id}-apart`}
      />
    </section>
  );
};

export const OfferRow: React.FC<{
  offer: Offer;
  onOpen: (offer: Offer) => void;
}> = ({offer, onOpen}) => {
  const price = priceLabel(offer);
  const extras = extrasHint(offer);
  // E5: one short line on how the price reads with tax.
  const line = offer.restricted ? null : estimateLine(offer);
  const taxHint = !line
    ? null
    : line.kind === 'estimate'
      ? `≈ ${line.amount} con impuestos`
      : line.kind === 'included'
        ? 'impuestos incluidos'
        : offer.vatIncluded === null
          ? 'impuestos sin verificar'
          : 'sin impuestos';
  return (
    <button
      type="button"
      className="lx-offerrow"
      data-offer-id={offer.id}
      onClick={() => onOpen(offer)}
    >
      <span className="lx-offerrow__main">
        <span className="lx-offerrow__name">{offer.name}</span>
        <span className="lx-offerrow__company">
          <Icon name="building" size={14} />
          {offer.company.name}
        </span>
        <UnsentMark id={offer.id} />
      </span>
      <span className="lx-offerrow__price">
        <span className="lx-offerrow__amount lx-num">
          {price ? (
            price
          ) : offer.restricted ? (
            <Withheld />
          ) : (
            <Pending>Precio pendiente de verificar</Pending>
          )}
        </span>
        {taxHint && (
          <span className="lx-offerrow__tax lx-num" data-offer-tax>
            {taxHint}
          </span>
        )}
        {extras && <span className="lx-offerrow__extras">{extras}</span>}
      </span>
      <Icon name="chevronRight" size={18} className="lx-offerrow__chev" />
    </button>
  );
};
