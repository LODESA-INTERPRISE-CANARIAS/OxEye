/**
 * «Desde el catálogo» (Revisión 1 · E5): pick the offer an expense comes
 * from. Each row shows the price before tax and its estimate with tax, so
 * the choice is made with the same figures the budget will use.
 */
import React, {useMemo, useState} from 'react';
import {priceLabel} from '../../../shared/logistics/catalogue.ts';
import type {Offer} from '../../../shared/logistics/contracts.ts';
import {universalSearch} from '../../../shared/logistics/search.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, EmptyState, Icon, Pending, SearchInput, Sheet} from '../ui';
import {estimateLine} from './tax';

export const OfferPicker: React.FC<{
  onPick: (offer: Offer) => void;
  onClose: () => void;
}> = ({onPick, onClose}) => {
  const offers = useLogisticsStore(s => s.offers);
  const categories = useLogisticsStore(s => s.categories);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const list = useMemo(() => {
    if (!q) return offers;
    const ids = new Set(
      universalSearch(
        q,
        {offers, categories},
        {types: ['offer'], limit: 500},
      ).map(h => h.id),
    );
    return offers.filter(o => ids.has(o.id));
  }, [offers, categories, q]);

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-offerpick-sheet"
      size="tall"
      eyebrow="Presupuesto"
      title="Añadir un gasto desde el catálogo"
      footer={
        <Button variant="ghost" onClick={onClose} id="lx-offerpick-cancel">
          Cancelar
        </Button>
      }
    >
      <p className="lx-muted lx-offerpick__lead">
        Elige la oferta: se copiará su precio y su impuesto de hoy. Después
        podrás ajustar la cantidad y el importe.
      </p>
      <SearchInput
        id="lx-offerpick-search"
        value={query}
        onValue={setQuery}
        label="Buscar oferta"
        placeholder="Buscar oferta, empresa o categoría"
      />
      {list.length === 0 ? (
        <EmptyState
          compact
          icon="search"
          title={
            offers.length
              ? `Ninguna oferta coincide con «${q}»`
              : 'El catálogo está vacío'
          }
          id="lx-offerpick-empty"
        >
          {offers.length
            ? 'Prueba con otra palabra.'
            : 'Apunta ofertas en Catálogo o escribe el gasto a mano.'}
        </EmptyState>
      ) : (
        <ul className="lx-offerpick" id="lx-offerpick-list">
          {list.map(o => {
            const price = priceLabel(o);
            const line = estimateLine(o);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className="lx-offerpick__row"
                  data-offer-id={o.id}
                  onClick={() => onPick(o)}
                >
                  <span className="lx-offerpick__main">
                    <strong>{o.name}</strong>
                    <span className="lx-muted">
                      <Icon name="building" size={14} /> {o.company.name}
                    </span>
                  </span>
                  <span className="lx-offerpick__price lx-num">
                    {price ?? <Pending>Precio pendiente</Pending>}
                    {line?.kind === 'estimate' && (
                      <small>≈ {line.amount} con impuestos</small>
                    )}
                  </span>
                  <Icon name="plus" size={18} className="lx-offerpick__add" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
};
