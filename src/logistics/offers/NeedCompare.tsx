/**
 * The answers to one request side by side (Revisión 1 · E6–E7): every
 * catalogue offer of its category and every proposal still waiting,
 * ranked by the estimated total of that need (with each company's tax).
 *
 * - A proposal waiting for an administrator is shown where its total falls,
 *   marked «Pendiente de aprobar», never with a position or a medal.
 * - Only whether the company serves on the need's dates is shown here
 *   (the months belong to the offer sheet).
 * - Unknown totals, companies that do not serve on those dates and expired
 *   offers are listed apart with the reason; expired ones are history.
 */
import React, {useMemo} from 'react';
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import type {
  Offer,
  OfferVersion,
  Proposal,
  QuoteNeed,
} from '../../../shared/logistics/contracts.ts';
import {
  compareNeed,
  termsTax,
  type Candidate,
  type ComparedRow,
} from '../../../shared/logistics/offer-terms.ts';
import {proposalTerms} from '../../../shared/logistics/proposals.ts';
import {TAX_ESTIMATE_LABEL} from '../../../shared/logistics/rules.ts';
import {RankBadge} from '../catalog/CompareParts';
import {Chip, HelpTip, Icon} from '../ui';
import {termsOfOffer} from './format';

export interface CompareItem {
  key: string;
  name: string;
  company: string;
  pending: boolean;
  offer?: Offer;
  proposal?: Proposal;
}

export function candidatesFor(
  need: QuoteNeed,
  offers: Offer[],
  versions: OfferVersion[],
  proposals: Proposal[],
  request: {id: string; offerId: string | null} | null,
): Candidate<CompareItem>[] {
  const out: Candidate<CompareItem>[] = [];
  const requestId = request?.id ?? null;
  const byOffer = new Map(versions.map(v => [v.offerId, v]));
  for (const offer of offers) {
    if (offer.restricted) continue;
    const sameCategory =
      !!need.categoryId && offer.categoryId === need.categoryId;
    // A renegotiation always shows the offer it renegotiates.
    if (!sameCategory && offer.id !== request?.offerId) continue;
    const view = termsOfOffer(offer, byOffer.get(offer.id));
    out.push({
      item: {
        key: `o:${offer.id}`,
        name: offer.name,
        company: offer.company.name,
        pending: false,
        offer,
      },
      terms: view.terms,
      tax: termsTax(view.terms, offer),
      pending: false,
    });
  }
  for (const p of proposals) {
    if (p.state !== 'pending') continue;
    if (requestId && p.request?.id !== requestId) continue;
    for (const product of p.content.products) {
      const terms = proposalTerms(p.content, product);
      out.push({
        item: {
          key: `p:${p.id}:${product.key}`,
          name: product.name,
          company: p.content.company.name,
          pending: true,
          proposal: p,
        },
        terms,
        tax: terms.tax,
        pending: true,
      });
    }
  }
  return out;
}

const Row: React.FC<{
  row: ComparedRow<CompareItem>;
  best: number | null;
  onOpen: (item: CompareItem) => void;
}> = ({row, best, onOpen}) => {
  const {item, cost} = row;
  return (
    <li
      data-key={item.key}
      data-pending={row.pending || undefined}
      data-rank={row.rank ?? undefined}
    >
      <button
        type="button"
        className="lx-needcmp__row"
        onClick={() => onOpen(item)}
      >
        {row.rank !== null ? (
          <RankBadge position={row.rank} />
        ) : (
          <span className="lx-needcmp__norank" aria-hidden="true">
            ·
          </span>
        )}
        <span className="lx-needcmp__name">
          <strong>{item.name}</strong>
          <span className="lx-muted">{item.company}</span>
          {row.pending && (
            <Chip certainty="pending" size="sm">
              Pendiente de aprobar
            </Chip>
          )}
          {cost.covers === true && (
            <span className="lx-needcmp__covers">
              <Icon name="check" size={14} /> Cubre las fechas
            </span>
          )}
        </span>
        <span className="lx-needcmp__total lx-num">
          {cost.total !== null ? (
            <>
              <strong>≈ {formatEuros(cost.total)}</strong>
              <span className="lx-needcmp__sub">
                {best !== null && row.rank !== 1 && cost.total > best
                  ? `+${formatEuros(Math.round((cost.total - best) * 100) / 100)} · `
                  : ''}
                {TAX_ESTIMATE_LABEL}
              </span>
            </>
          ) : (
            <>
              <strong>Sin total</strong>
              <span className="lx-needcmp__sub">
                {cost.knownSum > 0
                  ? `al menos ${formatEuros(cost.knownSum)} · falta ${cost.unknown.join(', ')}`
                  : `falta ${cost.unknown.join(', ') || 'el precio'}`}
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
};

export const NeedCompare: React.FC<{
  need: QuoteNeed;
  candidates: Candidate<CompareItem>[];
  today: string;
  onOpen: (item: CompareItem) => void;
  id: string;
}> = ({need, candidates, today, onOpen, id}) => {
  const result = useMemo(
    () => compareNeed(candidates, need, today),
    [candidates, need, today],
  );
  const best = result.ranked.find(r => r.rank === 1)?.cost.total ?? null;
  const empty =
    !result.ranked.length &&
    !result.unknown.length &&
    !result.unavailable.length &&
    !result.expired.length;
  return (
    <section className="lx-needcmp" id={id} aria-labelledby={`${id}-title`}>
      <h4 className="lx-terms__legend" id={`${id}-title`}>
        <Icon name="scale" size={18} />
        Comparar para esta necesidad
        <HelpTip label="comparar para esta necesidad">
          Se ordenan por el total estimado de esta necesidad, con el impuesto de
          cada empresa. Las propuestas que esperan a un administrador se ven
          donde caería su total, sin puesto ni medalla. Las caducadas son
          historial y no se comparan.
        </HelpTip>
      </h4>
      {empty ? (
        <p className="lx-muted">
          {need.categoryId
            ? 'Aún no hay ofertas de esta categoría ni respuestas pendientes.'
            : 'Sin categoría solo se comparan las respuestas a esta solicitud; aún no hay ninguna pendiente.'}
        </p>
      ) : (
        <>
          {result.ranked.length > 0 && (
            <ol className="lx-needcmp__list">
              {result.ranked.map(r => (
                <Row key={r.item.key} row={r} best={best} onOpen={onOpen} />
              ))}
            </ol>
          )}
          {result.unknown.length > 0 && (
            <div className="lx-needcmp__apart">
              <p className="lx-subtitle">Sin total conocido · no se ordenan</p>
              <ul className="lx-needcmp__list">
                {result.unknown.map(r => (
                  <Row key={r.item.key} row={r} best={null} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          )}
          {result.unavailable.length > 0 && (
            <div className="lx-needcmp__apart">
              <p className="lx-subtitle">
                No prestan el servicio en esas fechas
              </p>
              <ul className="lx-needcmp__list">
                {result.unavailable.map(r => (
                  <Row key={r.item.key} row={r} best={null} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          )}
          {result.expired.length > 0 && (
            <div className="lx-needcmp__apart" data-apart="expired">
              <p className="lx-subtitle">Caducadas · solo historial</p>
              <ul className="lx-needcmp__list">
                {result.expired.map(r => (
                  <Row
                    key={r.item.key}
                    row={{...r, rank: null}}
                    best={null}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};
