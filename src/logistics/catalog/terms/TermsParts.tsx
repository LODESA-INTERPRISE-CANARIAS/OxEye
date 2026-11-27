/**
 * How the terms of an offer version read (Revisión 1 · E6), shared by the
 * offer sheet, the proposal sheet and the comparison of a need:
 *
 * - the three dates an offer has, never mixed: until when it can be
 *   accepted, when the company can provide it, and how long a deal binds;
 * - seasonal rates on a twelve-month strip;
 * - what is included, charged apart (and how), or not done;
 * - minimums, availability and conditions as written.
 *
 * All prices are before tax unless the company wrote them with tax.
 */
import React from 'react';
import {formatEuros} from '../../../../shared/logistics/catalogue.ts';
import type {
  LocalDate,
  OfferTerms,
  OfferVersion,
  TaxInfo,
} from '../../../../shared/logistics/contracts.ts';
import {monthsLabel} from '../../../../shared/logistics/offer-terms.ts';
import {addDays, daysBetween} from '../../../../shared/logistics/time.ts';
import {TaxTag} from '../../budget/TaxParts';
import {plural} from '../../lib/format';
import {
  basisText,
  dayYear,
  priceText,
  supplementText,
  validityOf,
  VERSION_STATUS_LABEL,
} from '../../offers/format';
import {Chip, HelpTip, Icon, Pending} from '../../ui';

const MONTH_INITIAL = [
  'E',
  'F',
  'M',
  'A',
  'M',
  'J',
  'J',
  'A',
  'S',
  'O',
  'N',
  'D',
];
const MONTH_NAME = [
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
const MONTH_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** A need's dates, drawn over the strip and the timeline. */
export interface NeedMark {
  from: LocalDate;
  to: LocalDate;
  label: string;
}

// ---------------------------------------------------------------- validity chip

/** «Vigente hasta …», «Vence en 12 días», «Caducada»: one chip in the header. */
export const ValidityChip: React.FC<{
  acceptUntil: LocalDate | null;
  today: LocalDate;
  id?: string;
}> = ({acceptUntil, today, id}) => {
  const v = validityOf(acceptUntil, today);
  const chip =
    v.kind === 'expired' ? (
      <Chip tag tone="neutral" size="sm">
        Caducada · solo historial
      </Chip>
    ) : v.kind === 'soon' ? (
      <Chip certainty="planned" tone="danger" size="sm">
        {v.text}
      </Chip>
    ) : v.kind === 'current' ? (
      <Chip certainty="confirmed" size="sm">
        {v.text}
      </Chip>
    ) : (
      <Chip certainty="pending" size="sm">
        Sin fecha límite
      </Chip>
    );
  return (
    <span className="lx-validity" id={id} data-validity={v.kind}>
      {chip}
    </span>
  );
};

// ---------------------------------------------------------------- season strip

/** Twelve months coloured by the company's seasons, with the need's months marked. */
export const SeasonStrip: React.FC<{
  terms: Pick<OfferTerms, 'seasonal' | 'price' | 'basis' | 'customUnit'>;
  need?: NeedMark | null;
  id?: string;
}> = ({terms, need, id = 'lx-terms-seasons'}) => {
  if (!terms.seasonal.length) return null;
  const seasonOf = (m: number) =>
    terms.seasonal.findIndex(r => r.months.includes(m));
  const priceOf = (m: number) => {
    const i = seasonOf(m);
    return i >= 0 ? terms.seasonal[i].price : terms.price;
  };
  const needMonths = new Set<number>();
  if (need) {
    for (
      let d = need.from;
      d <= need.to && needMonths.size < 12;
      d = addDays(d, 1)
    ) {
      needMonths.add(Number(d.slice(5, 7)));
    }
  }
  const hasRest = Array.from({length: 12}, (_, i) => i + 1).some(
    m => seasonOf(m) < 0,
  );
  return (
    <figure className="lx-seasons" id={id}>
      <figcaption className="lx-terms__legend">
        Tarifas de temporada
        <HelpTip label="tarifas de temporada">
          El precio de cada jornada se toma de la temporada de su fecha. Los
          meses sin temporada usan el precio base. Las temporadas son las que
          indica la empresa.
        </HelpTip>
      </figcaption>
      <ol className="lx-seasons__months" aria-label="Precio por mes">
        {MONTH_INITIAL.map((initial, i) => {
          const m = i + 1;
          const s = seasonOf(m);
          const price = priceOf(m);
          return (
            <li
              key={m}
              data-season={s >= 0 ? s : 'base'}
              data-need={needMonths.has(m) || undefined}
              title={`${MONTH_NAME[i]}: ${price === null ? 'sin precio' : formatEuros(price)}`}
            >
              <span aria-hidden="true">{initial}</span>
              <span className="lx-visually-hidden">
                {MONTH_NAME[i]}:{' '}
                {price === null ? 'sin precio' : formatEuros(price)}
                {needMonths.has(m) ? ` (${need?.label})` : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <ul className="lx-seasons__legend lx-num">
        {terms.seasonal.map((r, i) => (
          <li key={r.label} data-season={i}>
            {r.label} · {monthsLabel(r.months)}{' '}
            <strong>{formatEuros(r.price)}</strong>
          </li>
        ))}
        {hasRest && (
          <li data-season="base">
            Resto del año{' '}
            <strong>
              {terms.price === null ? 'sin precio' : formatEuros(terms.price)}
            </strong>
          </li>
        )}
      </ul>
      {need && (
        <p className="lx-field__hint">
          <span className="lx-seasons__needkey" aria-hidden="true" />{' '}
          {need.label}
        </p>
      )}
    </figure>
  );
};

// ---------------------------------------------------------------- timeline

const firstOfMonth = (d: LocalDate) => `${d.slice(0, 7)}-01`;

function monthAfter(d: LocalDate): LocalDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Month ranges [from, to) within [start, end) when the company serves. */
function serviceSegments(
  months: readonly number[],
  start: LocalDate,
  end: LocalDate,
): [LocalDate, LocalDate][] {
  const out: [LocalDate, LocalDate][] = [];
  for (let d = firstOfMonth(start); d < end; d = monthAfter(d)) {
    if (!months.includes(Number(d.slice(5, 7)))) continue;
    const from = d < start ? start : d;
    const next = monthAfter(d);
    const to = next < end ? next : end;
    const last = out[out.length - 1];
    if (last && last[1] === from) last[1] = to;
    else out.push([from, to]);
  }
  return out;
}

/**
 * The three dates of an offer, kept apart: when it can be accepted (a bar up
 * to its deadline), when the company serves (its months) and the length of
 * any deal (in words: nobody knows when a deal would start). Today and the
 * need's dates are marked on both bars.
 */
export const ValidityTimeline: React.FC<{
  terms: Pick<
    OfferTerms,
    'acceptUntil' | 'serviceMonths' | 'commitment' | 'serviceNote'
  >;
  today: LocalDate;
  /** First day it could be accepted (the version's approval); default today. */
  since?: LocalDate | null;
  need?: NeedMark | null;
  id?: string;
}> = ({terms, today, since, need, id = 'lx-terms-dates'}) => {
  const from = since && since < today ? since : today;
  const start = firstOfMonth(addDays(from, -15));
  const ends = [addDays(start, 365)];
  if (terms.acceptUntil) ends.push(addDays(terms.acceptUntil, 30));
  if (need) ends.push(addDays(need.to, 30));
  // At most three years on screen: beyond that the bars are hairlines.
  const end = [...ends].sort().pop() as LocalDate;
  const last = end > addDays(start, 3 * 366) ? addDays(start, 3 * 366) : end;
  const span = daysBetween(start, last);
  const at = (d: LocalDate) =>
    Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100));
  const ticks: {date: LocalDate; label: string}[] = [];
  const step = span > 500 ? 6 : 3;
  for (let d = start, i = 0; d < last; d = monthAfter(d), i++) {
    if (i % step === 0) {
      const m = Number(d.slice(5, 7));
      ticks.push({
        date: d,
        label:
          m === 1 || i === 0
            ? `${MONTH_SHORT[m - 1]} ${d.slice(0, 4)}`
            : MONTH_SHORT[m - 1],
      });
    }
  }
  const validity = validityOf(terms.acceptUntil, today);
  const marks = (
    <>
      {need && (
        <span
          className="lx-tline__need"
          style={
            {
              '--at': `${at(need.from)}%`,
              '--w': `${Math.max(0.8, at(addDays(need.to, 1)) - at(need.from))}%`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      )}
      <span
        className="lx-tline__today"
        style={{'--at': `${at(today)}%`} as React.CSSProperties}
        aria-hidden="true"
      />
    </>
  );
  const service = terms.serviceMonths
    ? serviceSegments(terms.serviceMonths, start, last)
    : [];
  return (
    <figure className="lx-tline" id={id}>
      <div className="lx-tline__axis" aria-hidden="true">
        {ticks.map(t => (
          <span
            key={t.date}
            style={{'--at': `${at(t.date)}%`} as React.CSSProperties}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="lx-tline__lane" data-lane="accept">
        <p className="lx-tline__label">
          <span>Se puede aceptar hasta</span>
          <strong className="lx-num">
            {terms.acceptUntil ? (
              dayYear(terms.acceptUntil)
            ) : (
              <Pending>Sin fecha</Pending>
            )}
          </strong>
        </p>
        <div
          className="lx-tline__track"
          data-unknown={!terms.acceptUntil || undefined}
        >
          {terms.acceptUntil && (
            <span
              className="lx-tline__bar lx-tline__bar--accept"
              data-expired={validity.kind === 'expired' || undefined}
              style={
                {
                  '--at': `${at(from)}%`,
                  '--w': `${Math.max(1, at(terms.acceptUntil) - at(from))}%`,
                } as React.CSSProperties
              }
            />
          )}
          {marks}
        </div>
      </div>

      <div className="lx-tline__lane" data-lane="service">
        <p className="lx-tline__label">
          <span>Puede prestar el servicio</span>
          <strong>
            {terms.serviceMonths === null ? (
              <Pending />
            ) : (
              monthsLabel(terms.serviceMonths)
            )}
          </strong>
        </p>
        <div
          className="lx-tline__track"
          data-unknown={terms.serviceMonths === null || undefined}
        >
          {service.map(([a, b]) => (
            <span
              key={a}
              className="lx-tline__bar lx-tline__bar--service"
              style={
                {
                  '--at': `${at(a)}%`,
                  '--w': `${at(b) - at(a)}%`,
                } as React.CSSProperties
              }
            />
          ))}
          {marks}
        </div>
        {terms.serviceNote && (
          <p className="lx-tline__note">{terms.serviceNote}</p>
        )}
      </div>

      <div className="lx-tline__lane" data-lane="commitment">
        <p className="lx-tline__label">
          <span>Compromiso</span>
          <strong>
            {terms.commitment
              ? `${plural(terms.commitment.years, 'año', 'años')} desde que se contrate`
              : 'Sin compromiso'}
          </strong>
        </p>
      </div>

      <figcaption className="lx-tline__caption">
        <span>
          <i
            className="lx-tline__key lx-tline__key--today"
            aria-hidden="true"
          />{' '}
          Hoy
        </span>
        {need && (
          <span>
            <i
              className="lx-tline__key lx-tline__key--need"
              aria-hidden="true"
            />{' '}
            {need.label}
          </span>
        )}
      </figcaption>
    </figure>
  );
};

// ---------------------------------------------------------------- what it includes

/** Included, charged apart (and how), only on request, or not done. */
export const SupplementList: React.FC<{
  terms: Pick<OfferTerms, 'supplements' | 'notIncluded'>;
  id?: string;
}> = ({terms, id = 'lx-terms-extras'}) => {
  const included = terms.supplements.filter(s => s.included);
  const extra = terms.supplements.filter(
    s => !s.included && s.applies === 'always',
  );
  const onRequest = terms.supplements.filter(
    s => !s.included && s.applies === 'on_request',
  );
  if (
    !included.length &&
    !extra.length &&
    !onRequest.length &&
    !terms.notIncluded.length
  ) {
    return (
      <p className="lx-muted" id={id}>
        No consta qué incluye ni qué se cobra aparte.
      </p>
    );
  }
  return (
    <ul className="lx-incl" id={id}>
      {included.map(s => (
        <li key={`i-${s.label}`} className="lx-incl__item" data-kind="included">
          <Icon name="check" size={15} />
          {s.label} · incluido
        </li>
      ))}
      {extra.map(s => (
        <li
          key={`e-${s.label}`}
          className="lx-incl__item lx-num"
          data-kind={s.amount === null ? 'unknown' : 'extra'}
        >
          <Icon name={s.amount === null ? 'alert' : 'plus'} size={15} />
          {supplementText(s)}
        </li>
      ))}
      {onRequest.map(s => (
        <li
          key={`r-${s.label}`}
          className="lx-incl__item lx-num"
          data-kind="request"
        >
          <Icon name="question" size={15} />
          {supplementText(s)} · solo si se pide
        </li>
      ))}
      {terms.notIncluded.map(label => (
        <li key={`n-${label}`} className="lx-incl__item" data-kind="no">
          <Icon name="close" size={15} />
          {label} · no lo hace
        </li>
      ))}
    </ul>
  );
};

/** Minimums, availability and the multi-year price, one short line each. */
export const TermsFacts: React.FC<{terms: OfferTerms; id?: string}> = ({
  terms,
  id = 'lx-terms-facts',
}) => {
  const facts: React.ReactNode[] = [];
  if (terms.minimumDays) {
    facts.push(`Mínimo ${plural(terms.minimumDays, 'jornada', 'jornadas')}`);
  }
  if (terms.minimumQuantity) {
    facts.push(
      `Mínimo ${terms.minimumQuantity.toLocaleString('es-ES')} unidades`,
    );
  }
  if (terms.minimumOrder) {
    facts.push(`Pedido mínimo ${formatEuros(terms.minimumOrder)}`);
  }
  if (terms.available !== null) {
    facts.push(`Tiene ${terms.available.toLocaleString('es-ES')} disponibles`);
  }
  if (terms.commitment && terms.commitment.price !== null) {
    const saving =
      terms.price && terms.price > 0
        ? Math.round((1 - terms.commitment.price / terms.price) * 100)
        : null;
    facts.push(
      <>
        <strong>
          {formatEuros(terms.commitment.price)} {basisText(terms)}
        </strong>{' '}
        con compromiso de {plural(terms.commitment.years, 'año', 'años')}
        {saving !== null && saving > 0 ? ` (${saving} % menos)` : ''}
        {terms.commitment.conditions ? `. ${terms.commitment.conditions}` : ''}
      </>,
    );
  }
  if (!facts.length) return null;
  return (
    <ul className="lx-terms__facts lx-num" id={id}>
      {facts.map((f, i) => (
        <li key={i}>{f}</li>
      ))}
    </ul>
  );
};

/** The price line of some terms (proposal sheets; offers show their own). */
export const TermsPrice: React.FC<{
  terms: OfferTerms;
  tax: TaxInfo | null;
  id?: string;
}> = ({terms, tax, id}) => {
  const price = priceText(terms);
  return (
    <div className="lx-terms__price" id={id}>
      <p className="lx-terms__amount lx-num">
        {price ?? <Pending>Sin precio</Pending>}
      </p>
      <p className="lx-terms__basis">
        {terms.pricesIncludeTax === true
          ? 'Con impuestos incluidos, como lo escribió la empresa'
          : terms.pricesIncludeTax === null
            ? 'No dice si incluye impuestos'
            : 'Sin impuestos'}{' '}
        · <TaxTag tax={tax} />
      </p>
    </div>
  );
};

/** Everything but the price: dates, seasons, extras, minimums, conditions. */
export const TermsBody: React.FC<{
  terms: OfferTerms;
  today: LocalDate;
  since?: LocalDate | null;
  need?: NeedMark | null;
  /** Ids of the parts (several bodies on one sheet need their own). */
  idPrefix?: string;
}> = ({terms, today, since, need, idPrefix = 'lx-terms'}) => (
  <div className="lx-terms" id={idPrefix}>
    <section aria-labelledby={`${idPrefix}-dates-title`}>
      <h4 className="lx-terms__legend" id={`${idPrefix}-dates-title`}>
        Fechas
        <HelpTip label="las tres fechas de una oferta">
          Hasta cuándo se puede aceptar, cuándo puede prestar el servicio y
          cuánto dura un compromiso son cosas distintas: una oferta que hoy se
          puede aceptar puede no cubrir las fechas del evento.
        </HelpTip>
      </h4>
      <ValidityTimeline
        terms={terms}
        today={today}
        since={since}
        need={need}
        id={`${idPrefix}-dates`}
      />
    </section>
    <SeasonStrip terms={terms} need={need} id={`${idPrefix}-seasons`} />
    <section aria-labelledby={`${idPrefix}-extras-title`}>
      <h4 className="lx-terms__legend" id={`${idPrefix}-extras-title`}>
        Qué incluye
      </h4>
      <SupplementList terms={terms} id={`${idPrefix}-extras`} />
    </section>
    <TermsFacts terms={terms} id={`${idPrefix}-facts`} />
    {terms.conditions && (
      <p className="lx-terms__conditions" id={`${idPrefix}-conditions`}>
        <strong>Condiciones.</strong> {terms.conditions}
      </p>
    )}
  </div>
);

// ---------------------------------------------------------------- versions

/** Each version: number, price, deadline, the change and who approved it. */
export const VersionList: React.FC<{
  versions: OfferVersion[];
  idPrefix: string;
}> = ({versions, idPrefix}) => (
  <ol className="lx-versions" id={`${idPrefix}-versions`}>
    {versions.map(v => (
      <li key={v.id} data-status={v.status} data-version={v.number}>
        <span className="lx-versions__n lx-num">v{v.number}</span>
        <div className="lx-versions__text">
          <p className="lx-num">
            <strong>{priceText(v.terms) ?? 'Sin precio'}</strong>
            {v.terms.acceptUntil && (
              <> · aceptable hasta el {dayYear(v.terms.acceptUntil)}</>
            )}
          </p>
          {v.changeNote && (
            <p className="lx-versions__change">{v.changeNote}</p>
          )}
          <p className="lx-versions__by">
            {v.approvedBy
              ? `Aprobada por ${v.approvedBy.displayName}`
              : `Apuntada por ${v.createdBy.displayName}`}{' '}
            ·{' '}
            <span className="lx-num">{dayYear(v.createdAt.slice(0, 10))}</span>
          </p>
        </div>
        <Chip
          size="sm"
          tag={v.status !== 'current'}
          tone={v.status === 'current' ? 'accent' : 'neutral'}
          certainty="confirmed"
        >
          {VERSION_STATUS_LABEL[v.status]}
        </Chip>
      </li>
    ))}
  </ol>
);
