/**
 * One received proposal (Revisión 1 · E7): who sent it and how, the points
 * to check before approving, and each product with its terms and what the
 * need would cost. A renegotiation is compared with the offer in force.
 *
 * Only administrators (`offers.approve`) approve it into the catalogue (it
 * becomes a new offer, or the next version of the offer it renegotiates) or
 * reject it with a reason; everyone else sees «Pendiente de un
 * administrador». The company is never told: to answer it, write from your
 * own mail.
 */
import React, {useMemo, useState} from 'react';
import type {
  Proposal,
  QuoteRequest,
} from '../../../shared/logistics/contracts.ts';
import {NO_ACCESS} from '../../../shared/logistics/permissions.ts';
import {
  offerCost,
  termsTax,
  type NeedSpec,
} from '../../../shared/logistics/offer-terms.ts';
import {
  PROPOSAL_REASON_MAX,
  PROPOSAL_REASON_MIN,
  proposalTerms,
} from '../../../shared/logistics/proposals.ts';
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import {errorMessage, isApiError} from '../api/client';
import {offersApi} from '../api/offers';
import {Signature} from '../account/Signature';
import {useAccess} from '../account/useAccess';
import {useActions} from '../common/actions';
import {
  CostBreakdown,
  NeedCost,
  type NeedDraft,
} from '../catalog/terms/NeedCost';
import {TermsBody, TermsPrice} from '../catalog/terms/TermsParts';
import {instantShort} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Chip, Field, Icon, Sheet, Textarea, describedBy} from '../ui';
import {
  sessionToken,
  storeProposal,
  storeVersions,
  useCurrentVersions,
} from './data';
import {
  needText,
  PROPOSAL_STATE_LABEL,
  termsOfOffer,
  VIA_LABEL,
} from './format';

function draftOfNeed(need: QuoteRequest['need'] | null): NeedDraft {
  return {
    quantity: String(need?.quantity ?? 1),
    days: String(need?.days ?? 1),
    hours: need?.hoursPerDay ? String(need.hoursPerDay) : '',
    from: need?.dateFrom ?? '',
    to: need?.dateTo ?? need?.dateFrom ?? '',
  };
}

function specOf(d: NeedDraft): NeedSpec {
  return {
    quantity: Math.max(1, Number(d.quantity) || 1),
    days: Math.max(1, Number(d.days) || 1),
    hoursPerDay: d.hours ? Number(d.hours) : null,
    dateFrom: d.from || null,
    dateTo: d.from && d.to ? d.to : null,
  };
}

/**
 * Which company of Contactos this proposal is for, said before anything
 * else: on the open form anyone may type another company's name, so the
 * administrator checks it before approving.
 */
const CompanyMatch: React.FC<{proposal: Proposal}> = ({proposal}) => {
  const typed = proposal.content.company.name;
  const match = proposal.company;
  const open = proposal.via === 'open';
  if (!match) {
    return (
      <p className="lx-match" data-match="new" id="lx-proposal-company">
        <Icon name="building" size={18} />
        <span>
          <strong>Empresa nueva:</strong> no hay ninguna «{typed}» en Contactos.
          Al aprobarla se añade con ese nombre.
        </span>
      </p>
    );
  }
  return (
    <p
      className="lx-match"
      data-match={open ? 'check' : 'known'}
      id="lx-proposal-company"
    >
      <Icon name={open ? 'alert' : 'building'} size={18} />
      <span>
        <strong>Se asocia a «{match.name}»</strong> de Contactos
        {typed.trim().toLocaleLowerCase('es-ES') !==
        match.name.trim().toLocaleLowerCase('es-ES')
          ? ` (escribió «${typed}»)`
          : ''}
        .
        {open
          ? ' Llegó por el formulario abierto: cualquiera puede escribir el nombre de una empresa. Confirma con ella que es suya antes de aprobar.'
          : proposal.via === 'link'
            ? ' Llegó por su enlace personal.'
            : ''}
      </span>
    </p>
  );
};

export const ProposalSheet: React.FC<{
  proposal: Proposal;
  request: QuoteRequest | null;
  onClose: () => void;
  onChanged: () => void;
}> = ({proposal, request, onClose, onChanged}) => {
  const access = useAccess();
  const {today, timeZone} = useActions();
  const toast = useLogisticsStore(s => s.toast);
  const refresh = useLogisticsStore(s => s.refresh);
  const offers = useLogisticsStore(s => s.offers);
  const current = useCurrentVersions();
  const canApprove = access.can('offers.approve');
  const pending = proposal.state === 'pending';
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<NeedDraft>(() =>
    draftOfNeed(request?.need ?? null),
  );
  const content = proposal.content;
  const renegotiated = proposal.offer
    ? offers.find(o => o.id === proposal.offer?.id)
    : undefined;
  const currentView = renegotiated
    ? termsOfOffer(
        renegotiated,
        current.data?.find(v => v.offerId === renegotiated.id),
      )
    : null;
  const products = useMemo(
    () =>
      content.products.map(p => ({
        product: p,
        terms: proposalTerms(content, p),
      })),
    [content],
  );

  const decide = async (kind: 'approve' | 'reject') => {
    const token = sessionToken();
    if (!token || busy) return;
    if (kind === 'reject') {
      const r = reason.trim();
      if (r.length < PROPOSAL_REASON_MIN) {
        setReasonError(
          `Escribe el motivo (al menos ${PROPOSAL_REASON_MIN} caracteres).`,
        );
        document.getElementById('lx-proposal-reason')?.focus();
        return;
      }
    }
    setBusy(true);
    setFailure(null);
    try {
      if (kind === 'approve') {
        const res = await offersApi.approveProposal(token, proposal.id, {
          version: proposal.version,
        });
        storeProposal(res.proposal);
        storeVersions(res.versions);
        void refresh();
        const n = res.versions.length;
        toast(
          n === 1
            ? `Aprobada: en el catálogo como versión ${res.versions[0].number}`
            : `Aprobada: ${n} ofertas en el catálogo`,
          'success',
        );
      } else {
        const res = await offersApi.rejectProposal(token, proposal.id, {
          version: proposal.version,
          reason: reason.trim(),
        });
        storeProposal(res);
        toast(
          'Propuesta rechazada · el motivo queda en el historial',
          'success',
        );
      }
      onChanged();
      onClose();
    } catch (err) {
      if (isApiError(err) && err.code === 'FORBIDDEN') {
        setFailure(NO_ACCESS['offers.approve']);
      } else if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        setFailure(
          'Otra persona la ha decidido o cambiado mientras la mirabas. Se ha recargado la bandeja.',
        );
        onChanged();
      } else if (isApiError(err) && err.fields?.reason) {
        setReasonError(err.fields.reason);
      } else {
        setFailure(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  let footer: React.ReactNode;
  if (!pending) {
    footer = (
      <Button variant="primary" onClick={onClose} id="lx-proposal-close">
        Cerrar
      </Button>
    );
  } else if (!canApprove) {
    footer = (
      <>
        <p className="lx-foot-note" id="lx-proposal-locked">
          <Icon name="lock" size={16} /> Pendiente de un administrador
        </p>
        <span className="lx-sheet__foot-spacer" />
        <Button onClick={onClose} id="lx-proposal-close">
          Cerrar
        </Button>
      </>
    );
  } else if (confirm) {
    footer = (
      <div className="lx-confirm-strip" id="lx-proposal-confirm">
        <p>
          {confirm === 'approve'
            ? products.length === 1
              ? proposal.offer
                ? `¿Crear la versión siguiente de «${proposal.offer.name}» con estas condiciones?`
                : '¿Añadirla al catálogo con estas condiciones?'
              : `¿Añadir los ${products.length} productos al catálogo?`
            : 'Se guarda con el motivo. La empresa no recibe nada.'}
        </p>
        <div className="lx-confirm-strip__actions">
          <Button onClick={() => setConfirm(null)} disabled={busy}>
            Volver
          </Button>
          <Button
            variant={confirm === 'approve' ? 'primary' : 'danger'}
            icon={confirm === 'approve' ? 'check' : 'close'}
            id={`lx-proposal-${confirm}-confirm`}
            busy={busy}
            onClick={() => void decide(confirm)}
          >
            {confirm === 'approve' ? 'Sí, aprobar' : 'Rechazar'}
          </Button>
        </div>
      </div>
    );
  } else {
    footer = (
      <>
        <Button
          variant="ghost"
          id="lx-proposal-reject"
          onClick={() => setConfirm('reject')}
        >
          Rechazar
        </Button>
        <span className="lx-sheet__foot-spacer" />
        <Button
          variant="primary"
          icon="check"
          id="lx-proposal-approve"
          onClick={() => setConfirm('approve')}
        >
          Aprobar
        </Button>
      </>
    );
  }

  const spec = specOf(draft);

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-proposal-sheet"
      eyebrow={
        proposal.offer
          ? `Renegociación · ${proposal.offer.name}`
          : 'Propuesta recibida'
      }
      title={content.company.name}
      meta={
        <>
          <Chip
            size="sm"
            certainty={
              proposal.state === 'approved'
                ? 'confirmed'
                : proposal.state === 'pending'
                  ? 'pending'
                  : 'planned'
            }
            tone={proposal.state === 'rejected' ? 'neutral' : 'accent'}
          >
            {PROPOSAL_STATE_LABEL[proposal.state]}
          </Chip>
          <span className="lx-sheet__sub lx-num">
            {VIA_LABEL[proposal.via]}
            {proposal.origin ? ` (${proposal.origin})` : ''} ·{' '}
            {instantShort(proposal.receivedAt, timeZone)}
          </span>
        </>
      }
      footer={footer}
    >
      <div className="lx-record lx-proposal">
        {failure && (
          <p className="lx-notice lx-notice--error" role="alert">
            <Icon name="alert" size={18} />
            <span>{failure}</span>
          </p>
        )}
        {pending && !canApprove && (
          <p className="lx-notice lx-notice--quiet" id="lx-proposal-team-note">
            <Icon name="lock" size={18} />
            <span>
              Puedes revisarla, pero solo administración la aprueba o rechaza.
            </span>
          </p>
        )}
        <CompanyMatch proposal={proposal} />
        {proposal.flags.length > 0 && (
          <section aria-labelledby="lx-proposal-flags-title">
            <h3 className="lx-terms__legend" id="lx-proposal-flags-title">
              Antes de aprobar, revisa
            </h3>
            <ul className="lx-flags" id="lx-proposal-flags">
              {proposal.flags.map(f => (
                <li key={f}>
                  <Icon name="alert" size={15} /> {f}
                </li>
              ))}
            </ul>
          </section>
        )}
        {proposal.request && (
          <p className="lx-proposal__request">
            <Icon name="send" size={16} />
            <span>
              Responde a <strong>{proposal.request.title}</strong>
              {request && (
                <span className="lx-num"> · {needText(request.need)}</span>
              )}
              {content.intent === 'similar' && (
                <Chip size="sm" certainty="planned">
                  Ofrece algo parecido
                </Chip>
              )}
            </span>
          </p>
        )}
        <dl className="lx-detail" id="lx-proposal-contact">
          <div>
            <dt>Contacto</dt>
            <dd>{content.company.contactName ?? '—'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd className="lx-num">
              {content.company.phone ? (
                <a href={`tel:${content.company.phone}`}>
                  {content.company.phone}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Correo</dt>
            <dd>
              {content.company.email ? (
                <a href={`mailto:${content.company.email}`}>
                  {content.company.email}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>

        {products.map(({product, terms}, i) => {
          const tax = terms.tax;
          const mine = offerCost(terms, spec, tax);
          const now =
            currentView && renegotiated
              ? offerCost(
                  currentView.terms,
                  spec,
                  termsTax(currentView.terms, renegotiated),
                )
              : null;
          return (
            <section
              key={product.key}
              className="lx-proposal__product"
              data-product={product.key}
              aria-labelledby={`lx-proposal-p${i}`}
            >
              <h3 className="lx-proposal__name" id={`lx-proposal-p${i}`}>
                {product.name}
              </h3>
              {product.description && (
                <p className="lx-muted">{product.description}</p>
              )}
              <TermsPrice
                terms={terms}
                tax={tax}
                id={`lx-proposal-price-${i}`}
              />
              <TermsBody
                terms={terms}
                today={today}
                idPrefix={`lx-proposal-terms-${i}`}
              />
              {i === 0 && (
                <NeedCost
                  terms={terms}
                  tax={tax}
                  today={today}
                  idPrefix="lx-proposal"
                  draft={draft}
                  onDraft={setDraft}
                />
              )}
              {i > 0 && (
                <CostBreakdown
                  cost={mine}
                  id={`lx-proposal-cost-${i}`}
                  compact
                />
              )}
              {now && i === 0 && (
                <section
                  className="lx-versus"
                  id="lx-proposal-versus"
                  aria-label="Comparada con la oferta vigente"
                >
                  <h4 className="lx-terms__legend">
                    Ahora frente a la propuesta · misma necesidad
                  </h4>
                  <div className="lx-versus__cols lx-num">
                    <div data-side="now">
                      <p className="lx-eyebrow">
                        {currentView?.version
                          ? `Vigente · v${currentView.version.number}`
                          : 'Vigente · datos del catálogo'}
                      </p>
                      <p className="lx-versus__total">
                        {now.total !== null
                          ? `≈ ${formatEuros(now.total)}`
                          : 'Sin total'}
                      </p>
                    </div>
                    <div data-side="new">
                      <p className="lx-eyebrow">Propuesta</p>
                      <p className="lx-versus__total">
                        {mine.total !== null
                          ? `≈ ${formatEuros(mine.total)}`
                          : 'Sin total'}
                      </p>
                    </div>
                  </div>
                  {now.total !== null && mine.total !== null && (
                    <p
                      className="lx-versus__diff"
                      data-trend={
                        mine.total > now.total
                          ? 'up'
                          : mine.total < now.total
                            ? 'down'
                            : 'same'
                      }
                    >
                      {mine.total === now.total
                        ? 'Mismo total estimado.'
                        : `${mine.total > now.total ? 'Sube' : 'Baja'} ${formatEuros(Math.abs(Math.round((mine.total - now.total) * 100) / 100))} para esta necesidad (estimación con impuestos).`}
                    </p>
                  )}
                </section>
              )}
            </section>
          );
        })}

        {content.conditions && (
          <p className="lx-terms__conditions">
            <strong>Condiciones generales.</strong> {content.conditions}
          </p>
        )}

        {pending && canApprove && confirm === 'approve' && (
          <p className="lx-notice lx-notice--success" role="status">
            <Icon name="check" size={18} />
            <span>
              Quedará firmada por ti. Los gastos ya apuntados conservan su
              precio. Antes de que venza, OxEye creará la tarea de
              renegociarla.
            </span>
          </p>
        )}
        {pending && canApprove && confirm === 'reject' && (
          <Field
            id="lx-proposal-reason"
            label="Motivo del rechazo"
            hint="Queda en el historial. Para contestar a la empresa, escríbele desde tu correo."
            error={reasonError}
          >
            <Textarea
              id="lx-proposal-reason"
              rows={2}
              maxLength={PROPOSAL_REASON_MAX}
              value={reason}
              invalid={!!reasonError}
              data-autofocus
              aria-describedby={describedBy('lx-proposal-reason', {
                hint: true,
                error: reasonError,
              })}
              onChange={e => {
                setReason(e.target.value);
                setReasonError(null);
              }}
            />
          </Field>
        )}
        {proposal.decidedBy && (
          <p className="lx-proposal__decided" id="lx-proposal-decided">
            <Icon
              name={proposal.state === 'approved' ? 'check' : 'close'}
              size={16}
            />
            {proposal.state === 'approved' ? 'Aprobada' : 'Rechazada'} por{' '}
            <Signature
              user={proposal.decidedBy}
              supportBy={proposal.decidedBySupport}
              strong={false}
            />
            {proposal.decidedAt && (
              <span className="lx-num">
                {' '}
                · {instantShort(proposal.decidedAt, timeZone)}
              </span>
            )}
            {proposal.rejectReason && <> · «{proposal.rejectReason}»</>}
          </p>
        )}
      </div>
    </Sheet>
  );
};
