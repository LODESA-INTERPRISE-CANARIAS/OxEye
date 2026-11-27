/**
 * «Solicitudes» (Revisión 1 · E7): every request for quotes with who has
 * answered, who has not and whose link has expired. A request opens to
 * compare its answers with the catalogue for that very need; a lost or
 * expired link is renewed (the old one stops working) and shared again; a
 * request that is settled is closed (every link stops working).
 */
import React, {useMemo, useState} from 'react';
import type {
  QuoteRequest,
  QuoteRequestCreated,
  QuoteRequestLink,
} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {offersApi} from '../api/offers';
import {useActions} from '../common/actions';
import {instantShort, plural} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  LoadError,
  Sheet,
  SkeletonRows,
} from '../ui';
import {
  sessionToken,
  storeRequest,
  useCurrentVersions,
  useProposals,
  useQuoteRequests,
} from './data';
import {LINK_STATUS_LABEL, needText} from './format';
import {candidatesFor, NeedCompare, type CompareItem} from './NeedCompare';
import {ProposalSheet} from './ProposalSheet';
import {ShareLinks} from './ShareLinks';

type Tone = 'accent' | 'danger' | 'neutral';

function linkState(l: QuoteRequestLink): {
  label: string;
  tone: Tone;
  certainty: 'confirmed' | 'planned' | 'pending';
} {
  if (l.status === 'waiting' && l.expired) {
    return {label: 'Enlace caducado', tone: 'danger', certainty: 'planned'};
  }
  if (l.status === 'waiting') {
    return {
      label: l.openedAt ? 'Lo ha abierto' : LINK_STATUS_LABEL.waiting,
      tone: 'neutral',
      certainty: 'pending',
    };
  }
  if (l.status === 'answered') {
    return {
      label: 'Ha respondido · por revisar',
      tone: 'accent',
      certainty: 'planned',
    };
  }
  if (l.status === 'approved') {
    return {
      label: LINK_STATUS_LABEL.approved,
      tone: 'accent',
      certainty: 'confirmed',
    };
  }
  return {
    label: LINK_STATUS_LABEL[l.status],
    tone: 'neutral',
    certainty: 'planned',
  };
}

export const RequestsView: React.FC<{onNew: () => void}> = ({onNew}) => {
  const {canWrite} = useActions();
  const requests = useQuoteRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(
    () =>
      [...(requests.data ?? [])].sort((a, b) =>
        a.status === b.status
          ? b.createdAt.localeCompare(a.createdAt)
          : a.status === 'open'
            ? -1
            : 1,
      ),
    [requests.data],
  );
  const open = requests.data?.find(r => r.id === openId) ?? null;

  let body: React.ReactNode;
  if (requests.state === 'loading' && !requests.data) {
    body = <SkeletonRows rows={4} label="Cargando las solicitudes" />;
  } else if (requests.state === 'error' && !requests.data) {
    body = requests.unsupported ? (
      <EmptyState icon="server" title="Aún no disponible" compact>
        El servidor todavía no tiene las solicitudes de presupuesto.
      </EmptyState>
    ) : (
      <LoadError message={requests.error ?? ''} onRetry={requests.reload} />
    );
  } else if (!sorted.length) {
    body = (
      <EmptyState
        icon="send"
        title="Ninguna solicitud todavía"
        id="lx-requests-empty"
        action={
          canWrite && (
            <Button variant="primary" icon="send" onClick={onNew}>
              Pedir presupuesto
            </Button>
          )
        }
      >
        Pide precio para una necesidad concreta (qué, cuántos, cuántas jornadas)
        a una o varias empresas. Cada una recibe un enlace personal para
        responder desde el móvil.
      </EmptyState>
    );
  } else {
    body = (
      <ul className="lx-requests" id="lx-requests-list">
        {sorted.map(r => {
          const answered = r.links.filter(l =>
            ['answered', 'approved', 'rejected'].includes(l.status),
          ).length;
          const waiting = r.links.filter(l => l.status === 'waiting').length;
          return (
            <li key={r.id}>
              <button
                type="button"
                className="lx-request"
                data-request-id={r.id}
                data-status={r.status}
                onClick={() => setOpenId(r.id)}
              >
                <span className="lx-request__main">
                  <span className="lx-request__title">{r.need.title}</span>
                  <span className="lx-request__need lx-num">
                    {needText(r.need)}
                  </span>
                  <span className="lx-request__links">
                    {r.links.map(l => {
                      const s = linkState(l);
                      return (
                        <Chip
                          key={l.id}
                          size="sm"
                          tone={s.tone}
                          certainty={s.certainty}
                        >
                          {l.company.name} · {s.label}
                        </Chip>
                      );
                    })}
                  </span>
                </span>
                <span className="lx-request__side lx-num">
                  {r.status === 'closed' ? (
                    <Chip tag tone="neutral" size="sm">
                      Cerrada
                    </Chip>
                  ) : (
                    <>
                      <strong>
                        {answered}/{r.links.length}
                      </strong>
                      <span>
                        {waiting ? 'respuestas' : 'todas respondidas'}
                      </span>
                    </>
                  )}
                </span>
                <Icon
                  name="chevronRight"
                  size={18}
                  className="lx-offerrow__chev"
                />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="lx-offersview" id="lx-requests">
      {body}
      {open && (
        <RequestSheet
          key={open.id}
          request={open}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
};

/** One request: its need, each company's link, and the comparison. */
const RequestSheet: React.FC<{request: QuoteRequest; onClose: () => void}> = ({
  request,
  onClose,
}) => {
  const {canWrite, today, timeZone} = useActions();
  const toast = useLogisticsStore(s => s.toast);
  const offers = useLogisticsStore(s => s.offers);
  const openOffer = useActions().openOffer;
  const versions = useCurrentVersions();
  const proposals = useProposals();
  const requests = useQuoteRequests();
  const [issued, setIssued] = useState<QuoteRequestCreated | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const isOpen = request.status === 'open';

  const candidates = useMemo(
    () =>
      candidatesFor(
        request.need,
        offers,
        versions.data ?? [],
        proposals.data ?? [],
        {id: request.id, offerId: request.offerId},
      ),
    [request, offers, versions.data, proposals.data],
  );

  const renew = async (l: QuoteRequestLink) => {
    const token = sessionToken();
    if (!token) return;
    setBusy(l.id);
    setFailure(null);
    try {
      const res = await offersApi.renewQuoteLink(token, request.id, l.id);
      storeRequest(res.request);
      setIssued(res);
      toast(
        `Enlace nuevo para ${l.company.name}: el anterior ya no sirve`,
        'success',
      );
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    const token = sessionToken();
    if (!token) return;
    setBusy('close');
    setFailure(null);
    try {
      const res = await offersApi.closeQuoteRequest(
        token,
        request.id,
        request.version,
      );
      storeRequest(res);
      toast(
        'Solicitud cerrada: sus enlaces ya no abren el formulario',
        'success',
      );
      setConfirmClose(false);
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        requests.reload();
        setFailure(
          'Alguien ha cambiado la solicitud: revisa y vuelve a intentarlo.',
        );
      } else setFailure(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openItem = (item: CompareItem) => {
    if (item.proposal) setProposalId(item.proposal.id);
    else if (item.offer) openOffer(item.offer);
  };
  const proposal = proposals.data?.find(p => p.id === proposalId) ?? null;

  if (issued) {
    return (
      <Sheet
        open
        onClose={() => setIssued(null)}
        id="lx-request-links-sheet"
        eyebrow="Enlace nuevo"
        title={request.need.title}
        footer={
          <>
            <span className="lx-sheet__foot-spacer" />
            <Button variant="primary" onClick={() => setIssued(null)}>
              Hecho
            </Button>
          </>
        }
      >
        <ShareLinks
          links={issued.links}
          need={request.need}
          timeZone={timeZone}
          idPrefix="lx-renewed"
        />
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        id="lx-request-detail"
        eyebrow={request.offerId ? 'Renegociación' : 'Solicitud de presupuesto'}
        title={request.need.title}
        meta={
          <>
            {!isOpen && (
              <Chip tag tone="neutral" size="sm">
                Cerrada
              </Chip>
            )}
            <span className="lx-sheet__sub lx-num">
              {needText(request.need)}
            </span>
          </>
        }
        footer={
          confirmClose ? (
            <div className="lx-confirm-strip">
              <p>
                ¿Cerrar la solicitud? Los enlaces que no han respondido dejan de
                funcionar.
              </p>
              <div className="lx-confirm-strip__actions">
                <Button onClick={() => setConfirmClose(false)}>Volver</Button>
                <Button
                  variant="danger"
                  id="lx-request-close-confirm"
                  busy={busy === 'close'}
                  onClick={() => void close()}
                >
                  Cerrar solicitud
                </Button>
              </div>
            </div>
          ) : (
            <>
              {canWrite && isOpen && (
                <Button
                  variant="ghost"
                  icon="close"
                  id="lx-request-close"
                  onClick={() => setConfirmClose(true)}
                >
                  Cerrar solicitud
                </Button>
              )}
              <span className="lx-sheet__foot-spacer" />
              <Button variant="primary" onClick={onClose}>
                Listo
              </Button>
            </>
          )
        }
      >
        <div className="lx-record">
          {failure && (
            <p className="lx-notice lx-notice--error" role="alert">
              <Icon name="alert" size={18} />
              <span>{failure}</span>
            </p>
          )}
          {request.need.note && (
            <p className="lx-request__note">«{request.need.note}»</p>
          )}
          <p className="lx-muted lx-num">
            Creada por {request.createdBy.displayName} ·{' '}
            {instantShort(request.createdAt, timeZone)}
            {request.closedBy &&
              ` · cerrada por ${request.closedBy.displayName}`}
          </p>
          <section aria-labelledby="lx-request-links-title">
            <h3 className="lx-terms__legend" id="lx-request-links-title">
              Empresas · {plural(request.links.length, 'enlace', 'enlaces')}
            </h3>
            <ul className="lx-reqlinks" id="lx-request-links">
              {request.links.map(l => {
                const s = linkState(l);
                const renewable =
                  canWrite &&
                  isOpen &&
                  l.company.id !== null &&
                  (l.status === 'waiting' || l.status === 'revoked');
                return (
                  <li key={l.id} data-link-id={l.id} data-status={l.status}>
                    <span className="lx-reqlinks__who">
                      <strong>{l.company.name}</strong>
                      <span className="lx-muted lx-num">
                        {l.answeredAt
                          ? `Respondió el ${instantShort(l.answeredAt, timeZone)}`
                          : l.openedAt
                            ? `Lo abrió el ${instantShort(l.openedAt, timeZone)}`
                            : l.expired
                              ? `Caducó el ${instantShort(l.expiresAt, timeZone)}`
                              : `Sirve hasta el ${instantShort(l.expiresAt, timeZone)}`}
                      </span>
                      {l.declineReason && (
                        <span className="lx-reqlinks__reason">
                          «{l.declineReason}»
                        </span>
                      )}
                    </span>
                    <Chip size="sm" tone={s.tone} certainty={s.certainty}>
                      {s.label}
                    </Chip>
                    {l.proposalId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="offer"
                        onClick={() => setProposalId(l.proposalId)}
                      >
                        Ver propuesta
                      </Button>
                    )}
                    {renewable && (
                      <Button
                        size="sm"
                        icon="refresh"
                        busy={busy === l.id}
                        data-action="renew"
                        onClick={() => void renew(l)}
                      >
                        Enlace nuevo
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <NeedCompare
            need={request.need}
            candidates={candidates}
            today={today}
            onOpen={openItem}
            id="lx-request-compare"
          />
        </div>
      </Sheet>
      {proposal && (
        <ProposalSheet
          key={proposal.id}
          proposal={proposal}
          request={request}
          onClose={() => setProposalId(null)}
          onChanged={() => {
            proposals.reload();
            requests.reload();
          }}
        />
      )}
    </>
  );
};
