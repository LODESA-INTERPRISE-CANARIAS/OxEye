/**
 * «Comparar»: for one concrete need (quantity × days × dates), every current
 * offer ranked by estimated total with its own tax, the breakdown in sight,
 * medals for the three best approved ones. Pending proposals are shown where
 * their total puts them but get no position. Offers with an unknown tax stay apart (never
 * ranked with a guessed tax) and expired offers only appear as history.
 */
import React, {useMemo, useState} from 'react';
import {Button, Chip, HelpTip, Icon} from '../../ui';
import {NEEDS, OFFERS, PROPOSALS, type MockOffer} from '../data';
import {expiryText, fmtDay} from '../dates';
import {Glyph} from '../glyphs';
import {Medal, SectionTitle, useNotify} from '../kit';
import {eur, rankNeed, type NeedCost} from '../pricing';
import {hasPricedExtra, validityChip} from './OfferDetail';

const pendingIds = new Set(
  PROPOSALS.filter(p => p.state === 'pending').map(p => p.offerId),
);

const Breakdown: React.FC<{cost: NeedCost}> = ({cost}) => (
  <table className="lx-mk-breakdown lx-num">
    <caption className="lx-visually-hidden">Desglose</caption>
    <tbody>
      {cost.lines.map(l => (
        <tr key={l.label}>
          <th scope="row">
            {l.label}
            {l.detail && <span>{l.detail}</span>}
          </th>
          <td>
            {l.amount === null
              ? 'Sin precio'
              : l.amount === 0
                ? 'Incluido'
                : eur(l.amount)}
          </td>
        </tr>
      ))}
      <tr className="lx-mk-breakdown__sub">
        <th scope="row">Sin impuestos</th>
        <td>{eur(cost.beforeTax)}</td>
      </tr>
      {cost.tax && (
        <tr>
          <th scope="row">{cost.tax.label}</th>
          <td>{eur(cost.tax.amount)}</td>
        </tr>
      )}
      <tr className="lx-mk-breakdown__total">
        <th scope="row">Total estimado</th>
        <td>{cost.total === null ? '—' : eur(cost.total)}</td>
      </tr>
    </tbody>
  </table>
);

const RankCard: React.FC<{
  cost: NeedCost;
  /** Position among approved offers; null for a pending proposal. */
  rank: number | null;
  max: number;
  best: number;
  onOpen: (o: MockOffer) => void;
}> = ({cost, rank, max, best, onOpen}) => {
  const notify = useNotify();
  const o = cost.offer;
  const diff = cost.total !== null ? cost.total - best : 0;
  const compared =
    rank === 1
      ? 'el más económico'
      : rank === null
        ? `${diff < 0 ? '−' : '+'}${eur(Math.abs(diff))} frente a la 1.ª`
        : `+${eur(diff)}`;
  return (
    <li
      className="lx-mk-rank"
      data-rank={rank ?? 'pending'}
      data-pending={rank === null || undefined}
      data-offer={o.id}
    >
      <div className="lx-mk-rank__head">
        {rank === null ? (
          <span
            className="lx-mk-rank__n lx-mk-rank__n--pending"
            role="img"
            aria-label="Sin puesto: pendiente de aprobar"
            title="Sin puesto hasta que se apruebe"
          >
            <Icon name="clock" size={18} />
          </span>
        ) : rank <= 3 ? (
          <Medal rank={rank as 1 | 2 | 3} />
        ) : (
          <span className="lx-mk-rank__n lx-num">{rank}</span>
        )}
        <div className="lx-mk-rank__who">
          <h3>{o.company}</h3>
          <p>{o.product}</p>
        </div>
        <div className="lx-mk-rank__total lx-num">
          <strong>{cost.total === null ? '—' : eur(cost.total)}</strong>
          <span>{compared} · estimación</span>
        </div>
      </div>
      <div className="lx-mk-rank__bar" aria-hidden="true">
        <span style={{width: `${((cost.total ?? 0) / max) * 100}%`}} />
      </div>
      <div className="lx-mk-rank__chips">
        {pendingIds.has(o.id) && (
          <Chip size="sm" certainty="planned">
            Propuesta pendiente de aprobar
          </Chip>
        )}
        {validityChip(o)}
        <Chip size="sm" tag tone="neutral">
          {eur(cost.beforeTax)} sin impuestos · {cost.tax?.label}
          {!o.tax.verified && ' por verificar'}
        </Chip>
      </div>
      <div className="lx-mk-incl">
        {o.included.map(i => (
          <span key={i} className="lx-mk-incl__item">
            <Icon name="check" size={14} /> {i}
          </span>
        ))}
        {o.notIncluded.map(i =>
          hasPricedExtra(o, i) ? (
            <span key={i} className="lx-mk-incl__item lx-mk-incl__item--extra">
              + {i} aparte, ya sumado
            </span>
          ) : (
            <span key={i} className="lx-mk-incl__item lx-mk-incl__item--no">
              <Icon name="close" size={14} /> {i}
            </span>
          ),
        )}
        <span className="lx-mk-incl__item lx-mk-incl__item--plain">
          <Icon name="inventory" size={14} /> {o.availability}
        </span>
      </div>
      {(cost.seasonNote || cost.minimumNote) && (
        <ul className="lx-mk-rank__notes">
          {cost.seasonNote && (
            <li>
              <Icon name="calendar" size={14} /> {cost.seasonNote}
            </li>
          )}
          {cost.minimumNote && (
            <li>
              <Icon name="alert" size={14} /> {cost.minimumNote}
            </li>
          )}
        </ul>
      )}
      <details className="lx-mk-rank__details">
        <summary>Ver desglose</summary>
        <Breakdown cost={cost} />
      </details>
      <div className="lx-mk-rank__actions">
        <Button size="sm" onClick={() => onOpen(o)}>
          Ver oferta
        </Button>
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            notify(
              `Maqueta: se añadiría como gasto previsto del evento con una copia del precio (${eur(cost.total ?? 0)}).`,
              'info',
            )
          }
        >
          Añadir al presupuesto
        </Button>
      </div>
    </li>
  );
};

export const CompareView: React.FC<{
  needId: string;
  onNeed: (id: string) => void;
  onOpen: (o: MockOffer) => void;
  onRequest: () => void;
}> = ({needId, onNeed, onOpen, onRequest}) => {
  const need = NEEDS.find(n => n.id === needId) ?? NEEDS[0];
  const {ranked, unknownTax, expired} = useMemo(
    () => rankNeed(OFFERS, need),
    [need],
  );
  const [showExpired, setShowExpired] = useState(false);
  // Pending proposals stay in the list where their total puts them, but
  // only approved offers get a position (and a medal).
  const approved = ranked.filter(c => !pendingIds.has(c.offer.id));
  const pending = ranked.length - approved.length;
  const position = new Map(approved.map((c, i) => [c.offer.id, i + 1]));
  const max = Math.max(...ranked.map(r => r.total ?? 0), 1);
  const best = approved[0]?.total ?? ranked[0]?.total ?? 0;
  const cheapestBeforeTax = [...ranked].sort(
    (a, b) => a.beforeTax - b.beforeTax,
  )[0];
  const orderChanges =
    cheapestBeforeTax && ranked[0] && cheapestBeforeTax !== ranked[0];

  return (
    <div className="lx-mk-view" id="mk-compare">
      <div className="lx-filterchips" role="group" aria-label="Necesidad">
        {NEEDS.map(n => (
          <button
            key={n.id}
            type="button"
            className="lx-filterchip"
            aria-pressed={n.id === need.id}
            onClick={() => onNeed(n.id)}
          >
            <Glyph name={n.category} size={18} />
            {n.short}
          </button>
        ))}
      </div>

      <section className="lx-card lx-mk-need" aria-labelledby="mk-need-title">
        <p className="lx-eyebrow">Lo que necesitamos</p>
        <h2 className="lx-card__title lx-num" id="mk-need-title">
          {need.label}
        </h2>
        <p className="lx-mk-need__meta">
          {need.event} · {need.dates}
          <HelpTip label="cómo comparamos">
            Para cada oferta vigente calculamos el coste total de esta
            necesidad: cantidad × jornadas × precio de esas fechas (temporada y
            mínimos incluidos), más los extras, más el impuesto de cada empresa.
            Es una estimación: no sustituye al presupuesto firmado.
          </HelpTip>
        </p>
        {ranked.length > 0 && (
          <p className="lx-mk-need__lead">
            {approved.length === 0
              ? 'Aún no hay ofertas aprobadas para esta necesidad.'
              : approved.length === 1
                ? `Solo hay una oferta aprobada con impuesto conocido: ${approved[0].offer.company}, con ${eur(best)}.`
                : `${approved.length} ofertas aprobadas · la más económica, ${approved[0].offer.company}, con ${eur(best)}.`}
            {pending > 0 &&
              ` ${pending === 1 ? 'Una propuesta pendiente aparece' : `${pending} propuestas pendientes aparecen`} sin puesto hasta que se apruebe.`}
          </p>
        )}
        {orderChanges && (
          <p className="lx-notice">
            <Icon name="scale" size={18} />
            <span>
              Sin impuestos, la más barata sería{' '}
              {cheapestBeforeTax.offer.company} (
              {eur(cheapestBeforeTax.beforeTax)}), pero con su{' '}
              {cheapestBeforeTax.tax?.label} pasa a{' '}
              {eur(cheapestBeforeTax.total ?? 0)}. Comparamos siempre con el
              impuesto de cada una.
            </span>
          </p>
        )}
      </section>

      <ol
        className="lx-mk-ranks"
        aria-label="Ofertas ordenadas por total estimado"
      >
        {ranked.map(c => (
          <RankCard
            key={c.offer.id}
            cost={c}
            rank={position.get(c.offer.id) ?? null}
            max={max}
            best={best}
            onOpen={onOpen}
          />
        ))}
      </ol>

      {unknownTax.length > 0 && (
        <section className="lx-mk-apart" aria-labelledby="mk-unknown">
          <SectionTitle id="mk-unknown" count={unknownTax.length}>
            Sin impuesto conocido
          </SectionTitle>
          <p className="lx-mk-apart__why">
            No las ordenamos con las demás: sumarles un impuesto que nadie ha
            indicado sería inventar. Pregunta a la empresa y entrará en la
            comparación.
          </p>
          <ul className="lx-mk-cards">
            {unknownTax.map(c => (
              <li key={c.offer.id} className="lx-mk-apartrow">
                <span className="lx-mk-apartrow__who">
                  <strong>{c.offer.company}</strong>
                  <span>{c.offer.product}</span>
                </span>
                <span className="lx-mk-apartrow__amount lx-num">
                  {eur(c.beforeTax)} sin impuestos
                  {c.unpricedExtras.length > 0 && (
                    <small>+ {c.unpricedExtras.join(' y ')} sin precio</small>
                  )}
                </span>
                <Button size="sm" onClick={() => onOpen(c.offer)}>
                  Ver
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {expired.length > 0 && (
        <section className="lx-mk-apart" aria-labelledby="mk-expired">
          <SectionTitle
            id="mk-expired"
            count={expired.length}
            aside={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowExpired(v => !v)}
                aria-expanded={showExpired}
              >
                {showExpired ? 'Ocultar' : 'Mostrar'}
              </Button>
            }
          >
            Caducadas · no se comparan
          </SectionTitle>
          {showExpired && (
            <ul className="lx-mk-cards">
              {expired.map(c => (
                <li
                  key={c.offer.id}
                  className="lx-mk-apartrow lx-mk-apartrow--expired"
                >
                  <span className="lx-mk-apartrow__who">
                    <strong>{c.offer.company}</strong>
                    <span>
                      {c.offer.product} · {expiryText(c.offer.acceptUntil)} (
                      {fmtDay(c.offer.acceptUntil)})
                    </span>
                  </span>
                  <span className="lx-mk-apartrow__amount lx-num">
                    <s>{eur(c.offer.unitPrice)}</s> historial
                  </span>
                  <Button size="sm" icon="refresh" onClick={onRequest}>
                    Pedir precio nuevo
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
