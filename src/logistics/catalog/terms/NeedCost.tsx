/**
 * «Coste de una necesidad» (Revisión 1 · E6): what a concrete need would cost
 * under one offer version, with the whole breakdown: quantity × days ×
 * price (season by season), the extras that always apply, minimums, then
 * the tax. Extras only charged on request are shown apart and never added.
 * Anything without a price stays visible as such and the total is not given
 * (only «al menos» the priced part): no invented figures. The total with
 * tax is always an estimate.
 */
import React, {useMemo} from 'react';
import {formatEuros} from '../../../../shared/logistics/catalogue.ts';
import type {
  LocalDate,
  OfferTerms,
  TaxInfo,
} from '../../../../shared/logistics/contracts.ts';
import {
  MAX_NEED_DAYS,
  MAX_NEED_QUANTITY,
  offerCost,
  type NeedSpec,
  type OfferCost,
} from '../../../../shared/logistics/offer-terms.ts';
import {addDays, daysBetween} from '../../../../shared/logistics/time.ts';
import {TAX_ESTIMATE_LABEL} from '../../../../shared/logistics/rules.ts';
import {Chip, DateField, Field, HelpTip, Icon, Input} from '../../ui';

const HOURLY = new Set(['hour', 'hour_person']);

/** Whole number in range, or null while the text is not one. */
function whole(text: string, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= max ? n : null;
}

export interface NeedDraft {
  quantity: string;
  days: string;
  hours: string;
  from: string;
  to: string;
}

export function needDraftFor(terms: OfferTerms): NeedDraft {
  return {
    quantity: String(terms.minimumQuantity ?? 1),
    days: String(terms.minimumDays ?? 1),
    hours: HOURLY.has(terms.basis) ? '8' : '',
    from: '',
    to: '',
  };
}

interface EventLike {
  id: string;
  name: string;
  date: LocalDate | null;
  endDate: LocalDate | null;
  status: string;
}

export interface EventDates {
  eventId: string;
  name: string;
  from: LocalDate;
  to: LocalDate;
  days: number;
}

/**
 * The dates a need most likely has: those of the event in context, else of
 * the organization's next event (the one under way, or the first to come).
 * Cancelled and undated events never count; null when there is none.
 */
export function eventNeedDates(
  events: readonly EventLike[],
  today: LocalDate,
  eventId?: string | null,
): EventDates | null {
  const dated = events.filter(
    e => e.date && e.status !== 'cancelled',
  ) as (EventLike & {date: LocalDate})[];
  const chosen =
    (eventId ? dated.find(e => e.id === eventId) : undefined) ??
    dated
      .filter(e => (e.endDate ?? e.date) >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!chosen) return null;
  const to =
    chosen.endDate && chosen.endDate >= chosen.date
      ? chosen.endDate
      : chosen.date;
  return {
    eventId: chosen.id,
    name: chosen.name,
    from: chosen.date,
    to,
    days: daysBetween(chosen.date, to) + 1,
  };
}

/** The draft as a need, or null while a number is missing or out of range. */
export function needOfDraft(d: NeedDraft): NeedSpec | null {
  const quantity = whole(d.quantity, MAX_NEED_QUANTITY);
  const days = whole(d.days, MAX_NEED_DAYS);
  if (quantity === null || days === null) return null;
  const hours = d.hours.trim() ? whole(d.hours, 24) : null;
  return {
    quantity,
    days,
    hoursPerDay: hours,
    dateFrom: d.from || null,
    dateTo: d.from && d.to && d.to >= d.from ? d.to : null,
  };
}

/** The breakdown of one cost, as a table with its total. */
export const CostBreakdown: React.FC<{
  cost: OfferCost;
  id: string;
  /** Compact: no notes (lists of several offers). */
  compact?: boolean;
}> = ({cost, id, compact}) => (
  <div
    className="lx-cost"
    id={id}
    data-known={cost.total !== null || undefined}
  >
    <table className="lx-cost__table lx-num">
      <caption className="lx-visually-hidden">Desglose del coste</caption>
      <tbody>
        {cost.parts.map(p => (
          <tr key={p.key} data-state={p.state}>
            <th scope="row">
              {p.label}
              {p.detail && <span className="lx-cost__detail">{p.detail}</span>}
            </th>
            <td>
              {p.state === 'included'
                ? 'Incluido'
                : p.amount === null
                  ? 'Sin precio'
                  : formatEuros(p.amount)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr data-row="before">
          <th scope="row">Sin impuestos</th>
          <td>
            {cost.beforeTax !== null
              ? formatEuros(cost.beforeTax)
              : cost.knownSum > 0
                ? `al menos ${formatEuros(cost.knownSum)}`
                : '—'}
          </td>
        </tr>
        {cost.tax && (
          <tr data-row="tax">
            <th scope="row">
              {cost.tax.label}
              {!cost.tax.verified && (
                <span className="lx-cost__detail">por verificar</span>
              )}
              {cost.tax.included && (
                <span className="lx-cost__detail">
                  ya incluido en los precios
                </span>
              )}
            </th>
            <td>
              {cost.tax.amount !== null ? formatEuros(cost.tax.amount) : '—'}
            </td>
          </tr>
        )}
        <tr data-row="total">
          <th scope="row">
            Total con impuestos
            <span className="lx-cost__detail">{TAX_ESTIMATE_LABEL}</span>
          </th>
          <td>
            {cost.total !== null ? (
              <strong>≈ {formatEuros(cost.total)}</strong>
            ) : (
              <span className="lx-cost__unknown">Sin total</span>
            )}
          </td>
        </tr>
      </tfoot>
    </table>
    {cost.unknown.length > 0 && (
      <p className="lx-cost__missing" role="note">
        <Icon name="alert" size={15} />
        <span>
          Sin cifra todavía: <strong>{cost.unknown.join(', ')}</strong>. Sin eso
          no se da un total.
        </span>
      </p>
    )}
    {cost.onRequest.length > 0 && (
      <p className="lx-cost__apart">
        Solo si se pide, no sumado:{' '}
        {cost.onRequest
          .map(p =>
            p.amount === null
              ? `${p.label} (sin precio)`
              : `${p.label} (${formatEuros(p.amount)})`,
          )
          .join(' · ')}
      </p>
    )}
    {!compact && cost.commitment && (
      <p className="lx-cost__apart lx-num">
        Con compromiso de {cost.commitment.years} años:{' '}
        {cost.commitment.total !== null
          ? `≈ ${formatEuros(cost.commitment.total)} con impuestos`
          : cost.commitment.beforeTax !== null
            ? `${formatEuros(cost.commitment.beforeTax)} sin impuestos`
            : 'sin precio de compromiso'}
      </p>
    )}
    {!compact && cost.notes.length > 0 && (
      <ul className="lx-cost__notes">
        {cost.notes.map(n => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    )}
  </div>
);

/** The calculator inside an offer: the need on top, the breakdown below. */
export const NeedCost: React.FC<{
  terms: OfferTerms;
  tax: TaxInfo | null;
  today: LocalDate;
  idPrefix: string;
  /** The draft lives in the parent so the timeline can mark its dates. */
  draft: NeedDraft;
  onDraft: (draft: NeedDraft) => void;
  /** The event whose dates were filled in for the user, if any. */
  datesFrom?: string | null;
}> = ({terms, tax, today, idPrefix, draft, onDraft, datesFrom}) => {
  const id = `${idPrefix}-need`;
  const cost = useMemo(() => {
    const need = needOfDraft(draft);
    return need ? offerCost(terms, need, tax) : null;
  }, [terms, draft, tax]);
  const hourly = HOURLY.has(terms.basis);
  const set = (patch: Partial<NeedDraft>) => onDraft({...draft, ...patch});
  const qtyError =
    whole(draft.quantity, MAX_NEED_QUANTITY) === null
      ? `Un número entero entre 1 y ${MAX_NEED_QUANTITY.toLocaleString('es-ES')}.`
      : null;
  const daysError =
    whole(draft.days, MAX_NEED_DAYS) === null
      ? `Un número entero entre 1 y ${MAX_NEED_DAYS}.`
      : null;
  return (
    <section
      className="lx-subsection lx-needcost"
      id={id}
      aria-labelledby={`${id}-title`}
    >
      <h3 className="lx-subsection__title" id={`${id}-title`}>
        <Icon name="scale" size={20} />
        Coste de una necesidad
        <HelpTip label="coste de una necesidad">
          Escribe cuánto necesitas y cuántas jornadas: se calcula con el precio
          de cada temporada, los extras que siempre se cobran, los mínimos y el
          impuesto de la empresa. Lo que no tiene precio se dice y no se suma.
          El total con impuestos es una estimación.
        </HelpTip>
      </h3>
      <div className="lx-needcost__form">
        <Field id={`${id}-qty`} label="Cantidad" error={qtyError}>
          <Input
            id={`${id}-qty`}
            inputMode="numeric"
            className="lx-num"
            value={draft.quantity}
            invalid={!!qtyError}
            onChange={e => set({quantity: e.target.value})}
          />
        </Field>
        <Field id={`${id}-days`} label="Jornadas" error={daysError}>
          <Input
            id={`${id}-days`}
            inputMode="numeric"
            className="lx-num"
            value={draft.days}
            invalid={!!daysError}
            onChange={e => set({days: e.target.value})}
          />
        </Field>
        {hourly && (
          <Field id={`${id}-hours`} label="Horas por jornada">
            <Input
              id={`${id}-hours`}
              inputMode="numeric"
              className="lx-num"
              value={draft.hours}
              onChange={e => set({hours: e.target.value})}
            />
          </Field>
        )}
        <Field
          id={`${id}-from`}
          label="Desde"
          optional
          hint={
            terms.seasonal.length
              ? 'Con fechas se aplica la tarifa de su temporada.'
              : undefined
          }
        >
          <DateField
            id={`${id}-from`}
            value={draft.from}
            today={today}
            onChange={v => {
              const days = whole(draft.days, MAX_NEED_DAYS) ?? 1;
              set({from: v, to: v ? addDays(v, days - 1) : ''});
            }}
          />
        </Field>
        {draft.from && (
          <Field id={`${id}-to`} label="Hasta" optional>
            <DateField
              id={`${id}-to`}
              value={draft.to}
              min={draft.from}
              today={today}
              onChange={v => {
                const patch: Partial<NeedDraft> = {to: v};
                if (v && v >= draft.from) {
                  patch.days = String(daysBetween(draft.from, v) + 1);
                }
                set(patch);
              }}
            />
          </Field>
        )}
      </div>
      {datesFrom && (
        <p className="lx-field__hint lx-needcost__from" id={`${id}-event`}>
          <Icon name="calendar" size={15} />
          <span>
            Fechas del evento «{datesFrom}»; cámbialas si no es para ese evento.
          </span>
        </p>
      )}
      {cost && cost.covers !== null && (
        <p className="lx-needcost__covers">
          {cost.covers ? (
            <Chip certainty="confirmed" size="sm">
              Presta el servicio en esas fechas
            </Chip>
          ) : (
            <Chip certainty="planned" tone="danger" size="sm">
              No presta el servicio en esas fechas
            </Chip>
          )}
        </p>
      )}
      {cost ? (
        <CostBreakdown cost={cost} id={`${id}-breakdown`} />
      ) : (
        <p className="lx-muted">Completa la cantidad y las jornadas.</p>
      )}
    </section>
  );
};
