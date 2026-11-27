/**
 * Offer detail for the admin panel: price and what it includes, the three
 * dates that must never be confused (accept until / service window /
 * commitment) on one timeline, seasonal rates on a year strip, tax and the
 * history of versions.
 */
import React from 'react';
import {Button, Chip, HelpTip, Icon, Sheet} from '../../ui';
import {
  CATEGORY_LABEL,
  EVENT,
  MOCK_TODAY,
  PRICE_UNIT_LABEL,
  taxText,
  type MockOffer,
} from '../data';
import {daysFromToday, expiryText, fmtDay} from '../dates';
import {Glyph} from '../glyphs';
import {eur, isExpired} from '../pricing';

const MONTHS = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function seasonOf(month: number): 'lluvias' | 'verano' | 'resto' {
  if (month >= 10 || month <= 2) return 'lluvias';
  if (month >= 5 && month <= 8) return 'verano';
  return 'resto';
}

/** Twelve months coloured by season, with the event's month marked. */
export const SeasonStrip: React.FC<{offer: MockOffer}> = ({offer}) => {
  if (!offer.seasonal?.length) return null;
  const priceOf = (s: 'lluvias' | 'verano' | 'resto') =>
    offer.seasonal?.find(x => x.season === s)?.price ?? offer.unitPrice;
  const eventMonth = Number(EVENT.from.slice(5, 7)) - 1;
  return (
    <figure className="lx-mk-seasonstrip">
      <figcaption className="lx-mk-legend">
        Tarifas de temporada
        <HelpTip label="tarifas de temporada">
          El precio de cada evento se calcula con la tarifa de sus fechas. Las
          fechas sin temporada usan el precio base.
        </HelpTip>
      </figcaption>
      <ol className="lx-mk-seasonstrip__months" aria-label="Precio por mes">
        {MONTHS.map((m, i) => {
          const s = seasonOf(i);
          return (
            <li
              key={i}
              data-season={s}
              data-event={i === eventMonth || undefined}
              title={`${MONTH_NAMES[i]}: ${eur(priceOf(s))}`}
            >
              <span aria-hidden="true">{m}</span>
              <span className="lx-visually-hidden">
                {MONTH_NAMES[i]}: {eur(priceOf(s))}
              </span>
            </li>
          );
        })}
      </ol>
      <ul className="lx-mk-seasonstrip__legend lx-num">
        <li data-season="lluvias">
          Lluvias · nov – mar <strong>{eur(priceOf('lluvias'))}</strong>
        </li>
        <li data-season="verano">
          Verano · jun – sep <strong>{eur(priceOf('verano'))}</strong>
        </li>
        <li data-season="resto">
          Resto <strong>{eur(offer.unitPrice)}</strong>
        </li>
      </ul>
      <p className="lx-field__hint">
        <span className="lx-mk-eventdot" aria-hidden="true" /> {EVENT.name} (
        {EVENT.dates}) usa la tarifa de lluvias.
      </p>
    </figure>
  );
};

const toDays = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;

/** The three dates of an offer on one axis, with the event as a marker. */
export const ValidityTimeline: React.FC<{offer: MockOffer}> = ({offer}) => {
  const commitEnd = offer.commitment
    ? `${2026 + offer.commitment.years}-12-31`
    : null;
  const start = '2026-10-01';
  const endCandidates = [offer.acceptUntil, commitEnd ?? '', '2027-06-30']
    .filter(Boolean)
    .sort();
  const end = endCandidates[endCandidates.length - 1];
  const span = toDays(end) - toDays(start);
  const pos = (iso: string) =>
    Math.max(0, Math.min(100, ((toDays(iso) - toDays(start)) / span) * 100));
  const years: number[] = [];
  for (let y = 2027; y <= Number(end.slice(0, 4)); y++) years.push(y);
  const expired = isExpired(offer);
  const acceptFrom = offer.versions[0]?.from ?? MOCK_TODAY;
  const today = pos(MOCK_TODAY);
  const eventFrom = pos(EVENT.from);
  const eventWidth = pos(EVENT.to) - eventFrom;
  const service = serviceSegments(offer.serviceMonths, start, end).map(
    ([a, b]) => [pos(a), pos(b)] as const,
  );
  // Today and the event are drawn inside every track, never over the labels.
  const marks = (
    <>
      <span
        className="lx-mk-tl__event"
        style={{left: `${eventFrom}%`, width: `${eventWidth}%`}}
        aria-hidden="true"
      />
      <span
        className="lx-mk-tl__today"
        style={{left: `${today}%`}}
        aria-hidden="true"
      />
    </>
  );
  return (
    <figure className="lx-mk-tl" aria-label="Fechas de la oferta">
      <div className="lx-mk-tl__axis" aria-hidden="true">
        <span style={{left: 0}}>oct 2026</span>
        {/* Year labels too close to «oct 2026» would overlap it. */}
        {years
          .filter(y => pos(`${y}-01-01`) > 16)
          .map(y => (
            <span key={y} style={{left: `${pos(`${y}-01-01`)}%`}}>
              {y}
            </span>
          ))}
      </div>
      <div className="lx-mk-tl__flags" aria-hidden="true">
        <span className="lx-mk-tl__flag--today" style={{left: `${today}%`}}>
          hoy
        </span>
        <span
          className="lx-mk-tl__flag--event"
          style={{left: `${eventFrom + eventWidth}%`}}
        >
          evento
        </span>
      </div>
      <div className="lx-mk-tl__lane">
        <p className="lx-mk-tl__label">
          Se puede aceptar hasta
          <strong className="lx-num">{fmtDay(offer.acceptUntil)}</strong>
        </p>
        <div className="lx-mk-tl__track">
          <span
            className={`lx-mk-tl__bar lx-mk-tl__bar--accept${expired ? ' lx-mk-tl__bar--expired' : ''}`}
            style={{
              left: `${pos(acceptFrom)}%`,
              width: `${Math.max(1.5, pos(offer.acceptUntil) - pos(acceptFrom))}%`,
            }}
          />
          {marks}
        </div>
      </div>
      <div className="lx-mk-tl__lane">
        <p className="lx-mk-tl__label">
          Puede prestar el servicio
          <strong>{offer.serviceWindow}</strong>
        </p>
        <div
          className="lx-mk-tl__track"
          data-unknown={offer.serviceMonths === null || undefined}
        >
          {service.map(([a, b]) => (
            <span
              key={a}
              className="lx-mk-tl__bar lx-mk-tl__bar--service"
              style={{left: `${a}%`, width: `${b - a}%`}}
            />
          ))}
          {marks}
        </div>
      </div>
      <div className="lx-mk-tl__lane">
        <p className="lx-mk-tl__label">
          Compromiso
          <strong>
            {offer.commitment
              ? `${offer.commitment.years} años · 2027 – ${2026 + offer.commitment.years}`
              : 'Sin compromiso'}
          </strong>
        </p>
        <div className="lx-mk-tl__track">
          {offer.commitment && commitEnd && (
            <span
              className="lx-mk-tl__bar lx-mk-tl__bar--commit"
              style={{
                left: `${pos('2027-01-01')}%`,
                width: `${pos(commitEnd) - pos('2027-01-01')}%`,
              }}
            />
          )}
          {marks}
        </div>
      </div>
      <figcaption className="lx-mk-tl__caption">
        <span>
          <i className="lx-mk-tl__key--today" aria-hidden="true" /> Hoy
        </span>
        <span>
          <i className="lx-mk-tl__key--event" aria-hidden="true" /> {EVENT.name}{' '}
          · {EVENT.dates}
        </span>
      </figcaption>
    </figure>
  );
};

/**
 * Month ranges [from, to) within [start, end] when the supplier can serve.
 * Omitted months mean all year; null means unknown (no segments).
 */
function serviceSegments(
  months: number[] | null | undefined,
  start: string,
  end: string,
): [string, string][] {
  if (months === null) return [];
  if (months === undefined) return [[start, end]];
  const out: [string, string][] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const iso = (yy: number, mm: number) =>
    `${yy}-${String(mm).padStart(2, '0')}-01`;
  while (iso(y, m) < end) {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    if (months.includes(m)) {
      const last = out[out.length - 1];
      const to = iso(ny, nm) < end ? iso(ny, nm) : end;
      if (last && last[1] === iso(y, m)) last[1] = to;
      else out.push([iso(y, m), to]);
    }
    y = ny;
    m = nm;
  }
  return out;
}

export function validityChip(offer: MockOffer): React.ReactNode {
  const n = daysFromToday(offer.acceptUntil);
  if (n < 0) {
    return (
      <Chip tag tone="neutral" size="sm">
        Caducada
      </Chip>
    );
  }
  if (n <= 30) {
    return (
      <Chip certainty="planned" tone="danger" size="sm">
        {expiryText(offer.acceptUntil)}
      </Chip>
    );
  }
  return (
    <Chip certainty="confirmed" size="sm">
      Vigente hasta {fmtDay(offer.acceptUntil)}
    </Chip>
  );
}

/** A «not included» item that is charged apart shows only as its supplement. */
export const hasPricedExtra = (offer: MockOffer, item: string) =>
  offer.extras.some(e => e.amount !== null && e.label.startsWith(item));

/** Price, inclusions, dates, tax and conditions of one offer. */
export const OfferBody: React.FC<{offer: MockOffer; versions?: boolean}> = ({
  offer,
  versions = true,
}) => (
  <div className="lx-mk-offer">
    <section className="lx-mk-offer__price" aria-label="Precio">
      <span className="lx-mk-offer__glyph" aria-hidden="true">
        <Glyph name={offer.category} size={26} />
      </span>
      <div>
        <p className="lx-mk-offer__amount lx-num">
          {eur(offer.unitPrice)}
          <span> {PRICE_UNIT_LABEL[offer.priceUnit]}</span>
        </p>
        <p className="lx-mk-offer__sub">
          Sin impuestos · {taxText(offer.tax)}
          {offer.tax.kind !== 'unknown' &&
            offer.tax.kind !== 'none' &&
            (offer.tax.verified ? ' · verificado' : ' · por verificar')}
        </p>
      </div>
    </section>
    <div className="lx-mk-incl">
      {offer.included.map(i => (
        <span key={i} className="lx-mk-incl__item">
          <Icon name="check" size={14} /> {i}
        </span>
      ))}
      {offer.notIncluded
        .filter(i => !hasPricedExtra(offer, i))
        .map(i => (
          <span key={i} className="lx-mk-incl__item lx-mk-incl__item--no">
            <Icon name="close" size={14} /> {i}
          </span>
        ))}
      {offer.extras
        .filter(e => e.amount !== null)
        .map(e => (
          <span
            key={e.label}
            className="lx-mk-incl__item lx-mk-incl__item--extra lx-num"
          >
            + {e.label} {eur(e.amount ?? 0)}
            {e.per === 'unit' ? ' por unidad' : ' por pedido'}
          </span>
        ))}
    </div>
    {offer.minimumDays && (
      <p className="lx-mk-offer__note">
        <Icon name="minus" size={16} /> Mínimo {offer.minimumDays} jornadas
      </p>
    )}
    {offer.commitment && (
      <p className="lx-mk-offer__deal lx-num">
        <Icon name="link" size={16} />
        <span>
          <strong>
            {eur(offer.commitment.price)} con compromiso de{' '}
            {offer.commitment.years} años
          </strong>{' '}
          ({Math.round((1 - offer.commitment.price / offer.unitPrice) * 100)} %
          menos). {offer.commitment.note}
        </span>
      </p>
    )}
    <SeasonStrip offer={offer} />
    <section aria-label="Fechas">
      <p className="lx-mk-legend">
        Fechas
        <HelpTip label="las tres fechas de una oferta">
          Hasta cuándo podemos aceptarla, cuándo puede prestar el servicio y
          cuánto dura el compromiso son cosas distintas: una oferta aceptable
          hoy puede no cubrir las fechas del evento.
        </HelpTip>
      </p>
      <ValidityTimeline offer={offer} />
    </section>
    {offer.heavy && (
      <p className="lx-notice">
        <Icon name="weight" size={18} />
        <span>
          {offer.heavy} El Gestor no calcula cargas: la comprobación es
          orientativa y se hace en el simulador.
        </span>
      </p>
    )}
    {offer.conditions && (
      <p className="lx-mk-offer__conditions">
        <strong>Condiciones.</strong> {offer.conditions}
      </p>
    )}
    {versions && <VersionList offer={offer} />}
  </div>
);

const STATE_LABEL = {
  vigente: 'Vigente',
  sustituida: 'Sustituida',
  caducada: 'Caducada',
} as const;

export const VersionList: React.FC<{offer: MockOffer}> = ({offer}) => (
  <section className="lx-mk-versions" aria-labelledby={`v-${offer.id}`}>
    <p className="lx-mk-legend" id={`v-${offer.id}`}>
      Versiones
      <HelpTip label="las versiones">
        Renegociar crea una versión nueva. Los presupuestos y gastos ya
        registrados guardan el precio de su versión; nada se cambia hacia atrás.
      </HelpTip>
    </p>
    <ol>
      {offer.versions.map(v => (
        <li key={v.version} data-state={v.state}>
          <span className="lx-mk-versions__v lx-num">v{v.version}</span>
          <div className="lx-mk-versions__text">
            <p>
              <strong className="lx-num">{eur(v.price)}</strong> ·{' '}
              <span className="lx-num">
                {fmtDay(v.from)} – {fmtDay(v.until)}
              </span>
            </p>
            {v.change && <p className="lx-mk-versions__change">{v.change}</p>}
            <p className="lx-mk-versions__by">{v.by}</p>
          </div>
          <Chip
            size="sm"
            tag={v.state !== 'vigente'}
            tone="neutral"
            certainty="confirmed"
          >
            {STATE_LABEL[v.state]}
          </Chip>
        </li>
      ))}
    </ol>
  </section>
);

export const OfferDetailSheet: React.FC<{
  offer: MockOffer | null;
  onClose: () => void;
  onRenegotiate: (offer: MockOffer) => void;
}> = ({offer, onClose, onRenegotiate}) => (
  <Sheet
    open={!!offer}
    onClose={onClose}
    id="mk-offer-sheet"
    eyebrow={
      offer ? `${CATEGORY_LABEL[offer.category]} · ${offer.company}` : ''
    }
    title={offer?.product ?? ''}
    meta={
      offer && (
        <>
          <Chip tag tone="neutral" size="sm">
            v{offer.version}
          </Chip>
          {validityChip(offer)}
        </>
      )
    }
    footer={
      offer && (
        <>
          <Button onClick={onClose}>Cerrar</Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            variant="primary"
            icon="refresh"
            onClick={() => onRenegotiate(offer)}
          >
            Renegociar
          </Button>
        </>
      )
    }
  >
    {offer && <OfferBody offer={offer} />}
  </Sheet>
);
