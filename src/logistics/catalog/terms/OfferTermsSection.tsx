/**
 * «Vigencia y condiciones» of a catalogue offer (Revisión 1 · E6), mounted
 * in the offer sheet after «Comparar»:
 *
 * - the version in force, its validity and its three dates kept apart;
 * - seasonal rates, what is included or charged apart, minimums and
 *   conditions, all before tax;
 * - «Coste de una necesidad»: quantity × days + extras + tax, broken down;
 * - the versions (history); an expired offer says so and is history only;
 * - «Renegociar»: asks the company for new terms with a personal link; the
 *   answer becomes a new version once an administrator approves it.
 *
 * Offers recorded before versions have no dates: they say so and keep their
 * price and costs as written.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {Offer} from '../../../../shared/logistics/contracts.ts';
import {termsTax} from '../../../../shared/logistics/offer-terms.ts';
import {useAccess} from '../../account/useAccess';
import {useActions} from '../../common/actions';
import {useCurrentVersions, useOfferVersions} from '../../offers/data';
import {dayYear, termsOfOffer, validityOf} from '../../offers/format';
import {RequestSheet, type RequestPrefill} from '../../offers/RequestSheet';
import {useLogisticsStore} from '../../store/useLogisticsStore';
import {Button, HelpTip, Icon, SkeletonRows, Withheld} from '../../ui';
import {
  NeedCost,
  eventNeedDates,
  needDraftFor,
  needOfDraft,
  type NeedDraft,
} from './NeedCost';
import {
  TermsBody,
  ValidityChip,
  VersionList,
  type NeedMark,
} from './TermsParts';

export const OfferTermsSection: React.FC<{
  offer: Offer;
  /** The event the offer is looked at for, if the caller has one. */
  eventId?: string | null;
}> = ({offer, eventId}) => {
  const access = useAccess();
  const readable = access.can('directory.read') && !offer.restricted;
  if (!readable) {
    return (
      <section className="lx-subsection" id="lx-offer-terms">
        <h3 className="lx-subsection__title">Vigencia y condiciones</h3>
        <p className="lx-muted">
          <Withheld>Las condiciones son visibles para el equipo.</Withheld>
        </p>
      </section>
    );
  }
  return <Terms offer={offer} eventId={eventId ?? null} />;
};

const Terms: React.FC<{offer: Offer; eventId: string | null}> = ({
  offer,
  eventId,
}) => {
  const {today, canWrite} = useActions();
  const current = useCurrentVersions();
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useOfferVersions(offer.id, historyOpen);
  const [request, setRequest] = useState<RequestPrefill | null>(null);
  const version = current.data?.find(v => v.offerId === offer.id) ?? null;
  const view = termsOfOffer(offer, version);
  const [draft, setDraft] = useState<NeedDraft>(() => needDraftFor(view.terms));
  // A seasonal price needs dates: start from the event in context (or the
  // next one) and say so, until the user types their own.
  const events = useLogisticsStore(s => s.events);
  const seasonal = view.terms.seasonal.length > 0;
  const suggested = useMemo(
    () => (seasonal ? eventNeedDates(events, today, eventId) : null),
    [seasonal, events, today, eventId],
  );
  const [datesFrom, setDatesFrom] = useState<string | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    if (!suggested) {
      setDatesFrom(null);
      return;
    }
    setDraft(d => ({
      ...d,
      from: suggested.from,
      to: suggested.to,
      days: String(suggested.days),
    }));
    setDatesFrom(suggested.name);
  }, [suggested]);
  const changeDraft = (next: NeedDraft) => {
    touched.current = true;
    if (next.from !== draft.from || next.to !== draft.to) setDatesFrom(null);
    setDraft(next);
  };
  const need = needOfDraft(draft);
  const mark: NeedMark | null = need?.dateFrom
    ? {
        from: need.dateFrom,
        to: need.dateTo ?? need.dateFrom,
        label: 'Fechas de la necesidad',
      }
    : null;
  const validity = validityOf(view.terms.acceptUntil, today);
  const tax = termsTax(view.terms, offer);

  const renegotiate = () =>
    setRequest({
      renegotiate: true,
      offerId: offer.id,
      title: offer.name,
      categoryId: offer.categoryId,
      companyIds: [offer.company.id],
      quantity: need?.quantity,
      days: need?.days,
      dateFrom: need?.dateFrom ?? null,
      dateTo: need?.dateTo ?? null,
      note: view.terms.acceptUntil
        ? `Tu precio actual (versión ${version?.number ?? 1}) ${
            validity.kind === 'expired' ? 'venció' : 'vence'
          } el ${dayYear(view.terms.acceptUntil)}. ¿Nos indicas las condiciones para el próximo periodo?`
        : '¿Nos indicas tus condiciones y precios actuales, con hasta cuándo se pueden aceptar?',
    });

  let body: React.ReactNode;
  if (current.state === 'loading' && !current.data) {
    body = <SkeletonRows rows={3} label="Cargando la vigencia" />;
  } else {
    body = (
      <>
        {current.state === 'error' && !current.unsupported && (
          <p className="lx-notice lx-notice--quiet" role="status">
            <Icon name="cloudOff" size={18} />
            <span>
              No se ha podido leer la versión vigente: se muestran los datos
              apuntados en el catálogo.{' '}
              <button
                type="button"
                className="lx-link"
                onClick={current.reload}
              >
                Reintentar
              </button>
            </span>
          </p>
        )}
        {validity.kind === 'expired' && (
          <p className="lx-notice lx-notice--error" id="lx-offer-terms-expired">
            <Icon name="history" size={18} />
            <span>
              <strong>
                Caducada el {dayYear(view.terms.acceptUntil as string)}.
              </strong>{' '}
              Queda en el historial y no se compara como oferta vigente.
              Renegóciala para tener un precio que se pueda aceptar.
            </span>
          </p>
        )}
        {view.legacy && (
          <p className="lx-notice lx-notice--quiet" id="lx-offer-terms-legacy">
            <Icon name="clock" size={18} />
            <span>
              Apuntada antes de las versiones: no tiene fechas de vigencia. Al
              renegociarla, la respuesta aprobada será su versión 2 con fechas.
            </span>
          </p>
        )}
        <TermsBody
          terms={view.terms}
          today={today}
          since={version?.createdAt.slice(0, 10) ?? null}
          need={mark}
          idPrefix="lx-offer-cond"
        />
        <NeedCost
          terms={view.terms}
          tax={tax}
          today={today}
          idPrefix="lx-offer"
          draft={draft}
          onDraft={changeDraft}
          datesFrom={datesFrom}
        />
        <details
          className="lx-terms__history"
          id="lx-offer-versions-box"
          onToggle={e => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            <Icon name="history" size={18} />
            Versiones
            {version && (
              <span className="lx-count lx-num">{version.number}</span>
            )}
            <HelpTip label="las versiones">
              Renegociar crea una versión nueva cuando un administrador aprueba
              la respuesta. Los gastos ya apuntados conservan el precio de su
              versión: nada cambia hacia atrás.
            </HelpTip>
          </summary>
          {history.state === 'loading' && !history.data ? (
            <SkeletonRows rows={2} label="Cargando las versiones" />
          ) : history.data?.length ? (
            <VersionList versions={history.data} idPrefix="lx-offer" />
          ) : history.state === 'error' && !history.unsupported ? (
            <p className="lx-muted">
              {history.error}{' '}
              <button
                type="button"
                className="lx-link"
                onClick={history.reload}
              >
                Reintentar
              </button>
            </p>
          ) : (
            <p className="lx-muted">
              Aún no tiene versiones: la primera se crea al aprobar una
              respuesta de la empresa.
            </p>
          )}
        </details>
      </>
    );
  }

  return (
    <section
      className="lx-subsection lx-offerterms"
      id="lx-offer-terms"
      aria-labelledby="lx-offer-terms-title"
    >
      <div className="lx-offerterms__head">
        <h3 className="lx-subsection__title" id="lx-offer-terms-title">
          <Icon name="calendar" size={20} />
          Vigencia y condiciones
        </h3>
        <ValidityChip
          acceptUntil={view.terms.acceptUntil}
          today={today}
          id="lx-offer-validity"
        />
      </div>
      {body}
      {canWrite && (
        <div className="lx-offerterms__actions">
          <Button
            variant={validity.kind === 'current' ? 'secondary' : 'primary'}
            icon="refresh"
            id="lx-offer-renegotiate"
            onClick={renegotiate}
          >
            Renegociar
          </Button>
          <p className="lx-field__hint">
            Prepara un enlace personal para que {offer.company.name} envíe sus
            nuevas condiciones. Pasan a ser la versión siguiente cuando un
            administrador las aprueba.
          </p>
        </div>
      )}
      {request && (
        <RequestSheet prefill={request} onClose={() => setRequest(null)} />
      )}
    </section>
  );
};
