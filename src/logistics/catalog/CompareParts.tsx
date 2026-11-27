/**
 * Pieces of «Comparar» shared by the offer sheet and the catalogue: the
 * position badge (gold, silver and bronze medals for the first three, said
 * in words too), the ranked list with its bars, and the list of offers kept
 * apart with the reason.
 *
 * E5: each row leads with the estimated unit price with tax («estimación»)
 * and shows below it the price before tax and the tax that offer uses, so
 * different taxes are compared in the open.
 */
import React from 'react';
import {
  formatEuros,
  perUnitLabel,
  priceLabel,
  type ApartReason,
} from '../../../shared/logistics/catalogue.ts';
import type {Offer} from '../../../shared/logistics/contracts.ts';
import type {PriceEstimate} from '../../../shared/logistics/money.ts';
import {TAX_ESTIMATE_LABEL} from '../../../shared/logistics/rules.ts';
import {taxText} from '../budget/tax';
import {Icon} from '../ui';
import {MEDAL, apartReasonText, positionLabel} from './compare';

export const RankBadge: React.FC<{position: number}> = ({position}) => {
  const medal = MEDAL[position as 1 | 2 | 3];
  return (
    <span
      className={`lx-compare__pos lx-num${
        medal ? ` lx-medal lx-medal--${medal.tone}` : ''
      }`}
      title={medal ? positionLabel(position) : undefined}
    >
      <span aria-hidden="true">{position}</span>
      <span className="lx-visually-hidden">{positionLabel(position)}</span>
    </span>
  );
};

/** «≈ 128,40 € / día» for the ranked figure. */
function perUnit(amount: number, offer: Offer): string {
  const per = perUnitLabel(offer);
  return per ? `${formatEuros(amount)} / ${per}` : formatEuros(amount);
}

/** «95 € sin impuestos · IVA 21 % de la empresa · por verificar». */
function basisText(offer: Offer, e: PriceEstimate): string {
  const before =
    offer.vatIncluded === true
      ? `${priceLabel(offer)} con impuestos incluidos`
      : e.beforeTax !== null
        ? `${formatEuros(e.beforeTax)} sin impuestos`
        : '';
  return [before, taxText(e.tax, {inherited: e.inherited})]
    .filter(Boolean)
    .join(' · ');
}

export const RankedList: React.FC<{
  peers: Offer[];
  estimates: Readonly<Record<string, PriceEstimate>>;
  /** The offer being viewed (offer sheet): a marker, not a link. */
  selfId?: string;
  onShow: (offer: Offer) => void;
  id?: string;
}> = ({peers, estimates, selfId, onShow, id}) => {
  const value = (o: Offer) => estimates[o.id]?.withTax ?? 0;
  const max = Math.max(...peers.map(value), 0);
  const best = peers.length ? value(peers[0]) : 0;
  return (
    <ol className="lx-compare" id={id}>
      {peers.map((p, i) => {
        const self = p.id === selfId;
        const e = estimates[p.id];
        const v = value(p);
        const width = max > 0 ? Math.max(4, (v / max) * 100) : 0;
        const diff = v - best;
        return (
          <li
            key={p.id}
            className={self ? 'is-self' : ''}
            data-offer-id={p.id}
            data-position={i + 1}
          >
            <button
              type="button"
              className="lx-compare__row"
              disabled={self}
              aria-current={self ? 'true' : undefined}
              onClick={() => onShow(p)}
            >
              <RankBadge position={i + 1} />
              <span className="lx-compare__name">
                <strong>{self ? 'Esta oferta' : p.name}</strong>
                <span className="lx-muted">{p.company.name}</span>
              </span>
              <span className="lx-compare__price lx-num">
                <span>
                  <span className="lx-compare__approx" aria-hidden="true">
                    ≈{' '}
                  </span>
                  {perUnit(v, p)}
                </span>
                <span className="lx-compare__tax">
                  {i === 0
                    ? `con impuestos · ${TAX_ESTIMATE_LABEL}`
                    : `+${formatEuros(Math.round(diff * 100) / 100)} · ${TAX_ESTIMATE_LABEL}`}
                </span>
              </span>
              <span className="lx-compare__bar" aria-hidden="true">
                <span style={{width: `${width}%`}} />
              </span>
              {e && (
                <span className="lx-compare__basis">{basisText(p, e)}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
};

/** Offers of the same comparison kept apart, each with why. */
export const ApartList: React.FC<{
  items: {offer: Offer; reason: ApartReason; estimate?: PriceEstimate}[];
  title: string;
  onShow: (offer: Offer) => void;
  id?: string;
}> = ({items, title, onShow, id}) =>
  items.length ? (
    <div className="lx-compare__apart" id={id}>
      <p className="lx-subtitle">{title}</p>
      <ul className="lx-compare lx-compare--apart">
        {items.map(({offer, reason, estimate}) => (
          <li key={offer.id} data-offer-id={offer.id} data-reason={reason}>
            <button
              type="button"
              className="lx-compare__row"
              onClick={() => onShow(offer)}
            >
              <span className="lx-compare__name">
                <strong>{offer.name}</strong>
                <span className="lx-muted">{offer.company.name}</span>
              </span>
              <span className="lx-compare__price lx-num">
                {priceLabel(offer) ?? '—'}
                <span className="lx-compare__tax">
                  {offer.price === null
                    ? 'sin precio'
                    : offer.vatIncluded === true
                      ? 'con impuestos incluidos'
                      : offer.vatIncluded === false
                        ? 'sin impuestos'
                        : 'tal como se apuntó'}
                </span>
              </span>
              <span className="lx-compare__why">
                <Icon name="alert" size={14} />
                {apartReasonText(reason, estimate)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
