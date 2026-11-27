/**
 * «Propuestas recibidas» (Revisión 1 · E7): what companies sent through
 * their links, the open form or recorded by hand, waiting for an
 * administrator. Pending first; decided ones keep who and when.
 */
import React, {useMemo, useState} from 'react';
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import type {
  Proposal,
  ProposalState,
} from '../../../shared/logistics/contracts.ts';
import {signatureLabel} from '../../../shared/logistics/history.ts';
import {proposalTerms} from '../../../shared/logistics/proposals.ts';
import {useAccess} from '../account/useAccess';
import {useActions} from '../common/actions';
import {instantShort} from '../lib/format';
import {Button, Chip, EmptyState, Icon, LoadError, SkeletonRows} from '../ui';
import {useProposals, useQuoteRequests} from './data';
import {basisText, VIA_LABEL} from './format';
import {ManualProposalSheet} from './ManualProposalSheet';
import {ProposalSheet} from './ProposalSheet';

const TABS: {id: ProposalState; label: string}[] = [
  {id: 'pending', label: 'Pendientes'},
  {id: 'approved', label: 'Aprobadas'},
  {id: 'rejected', label: 'Rechazadas'},
];

/** «195 € por unidad y jornada» of the first product, «+2 más». */
function priceSummary(p: Proposal): string {
  const first = p.content.products[0];
  if (!first) return '';
  const terms = proposalTerms(p.content, first);
  const price =
    terms.price === null
      ? 'Sin precio'
      : `${formatEuros(terms.price)} ${basisText(terms)}`;
  const more = p.content.products.length - 1;
  return more > 0 ? `${price} · y ${more} más` : price;
}

export const InboxView: React.FC = () => {
  const access = useAccess();
  const {canWrite, timeZone} = useActions();
  const proposals = useProposals();
  const requests = useQuoteRequests();
  const [tab, setTab] = useState<ProposalState>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const list = useMemo(
    () =>
      (proposals.data ?? [])
        .filter(p => p.state === tab)
        .sort((a, b) =>
          tab === 'pending'
            ? a.receivedAt.localeCompare(b.receivedAt)
            : (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''),
        ),
    [proposals.data, tab],
  );
  const count = (s: ProposalState) =>
    (proposals.data ?? []).filter(p => p.state === s).length;
  const open = proposals.data?.find(p => p.id === openId) ?? null;
  const canApprove = access.can('offers.approve');

  let body: React.ReactNode;
  if (proposals.state === 'loading' && !proposals.data) {
    body = <SkeletonRows rows={4} label="Cargando las propuestas" />;
  } else if (proposals.state === 'error' && !proposals.data) {
    body = proposals.unsupported ? (
      <EmptyState icon="server" title="Aún no disponible" compact>
        El servidor todavía no tiene las propuestas de proveedores.
      </EmptyState>
    ) : (
      <LoadError message={proposals.error ?? ''} onRetry={proposals.reload} />
    );
  } else if (!list.length) {
    body = (
      <EmptyState
        compact
        icon={tab === 'pending' ? 'check' : 'mail'}
        title={tab === 'pending' ? 'Nada pendiente' : 'Nada por aquí'}
        id="lx-inbox-empty"
      >
        {tab === 'pending'
          ? 'Cuando una empresa responda a una solicitud, su propuesta aparecerá aquí para revisarla.'
          : 'Las propuestas decididas aparecen aquí con quién y cuándo.'}
      </EmptyState>
    );
  } else {
    body = (
      <ul className="lx-inbox" id="lx-inbox-list">
        {list.map(p => (
          <li key={p.id}>
            <button
              type="button"
              className="lx-inbox__row"
              data-proposal-id={p.id}
              onClick={() => setOpenId(p.id)}
            >
              <span className="lx-inbox__icon" aria-hidden="true">
                <Icon name={p.offer ? 'refresh' : 'offer'} size={20} />
              </span>
              <span className="lx-inbox__main">
                <span className="lx-inbox__company">
                  {p.content.company.name}
                </span>
                <span className="lx-inbox__product">
                  {p.offer
                    ? `Renegocia «${p.offer.name}»`
                    : p.request
                      ? `Responde a «${p.request.title}»`
                      : p.content.products.map(x => x.name).join(', ')}
                </span>
                <span className="lx-inbox__meta lx-num">
                  {VIA_LABEL[p.via]} · {instantShort(p.receivedAt, timeZone)}
                  {p.decidedBy &&
                    ` · ${p.state === 'approved' ? 'aprobada' : 'rechazada'} por ${signatureLabel(p.decidedBy, p.decidedBySupport)}`}
                </span>
                {p.state === 'pending' &&
                  (p.flags.length > 0 || !p.company) && (
                    <span className="lx-inbox__flags">
                      {!p.company && (
                        <Chip size="sm" tag tone="neutral">
                          Empresa nueva
                        </Chip>
                      )}
                      {p.flags.slice(0, 3).map(f => (
                        <Chip
                          key={f}
                          size="sm"
                          certainty="planned"
                          tone={
                            /^Falta|sin precio|vencido/i.test(f)
                              ? 'danger'
                              : 'accent'
                          }
                        >
                          {f}
                        </Chip>
                      ))}
                      {p.flags.length > 3 && (
                        <span className="lx-muted">+{p.flags.length - 3}</span>
                      )}
                    </span>
                  )}
              </span>
              <span className="lx-inbox__price lx-num">{priceSummary(p)}</span>
              <Icon
                name="chevronRight"
                size={18}
                className="lx-offerrow__chev"
              />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="lx-offersview" id="lx-inbox">
      {!canApprove && (
        <p className="lx-notice lx-notice--quiet" id="lx-inbox-team-note">
          <Icon name="lock" size={18} />
          <span>
            Puedes revisar las propuestas; solo administración las aprueba o
            rechaza.
          </span>
        </p>
      )}
      <div className="lx-offersview__bar">
        <div
          className="lx-segtabs"
          role="tablist"
          aria-label="Estado de las propuestas"
        >
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`lx-inbox-tab-${t.id}`}
              className="lx-segtabs__tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="lx-segtabs__count lx-num">{count(t.id)}</span>
            </button>
          ))}
        </div>
        {canWrite && (
          <Button
            size="sm"
            icon="edit"
            id="lx-inbox-manual"
            onClick={() => setManual(true)}
          >
            Registrar una recibida
          </Button>
        )}
      </div>
      {body}
      {open && (
        <ProposalSheet
          key={open.id}
          proposal={open}
          request={requests.data?.find(r => r.id === open.request?.id) ?? null}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            proposals.reload();
            requests.reload();
          }}
        />
      )}
      {manual && <ManualProposalSheet onClose={() => setManual(false)} />}
    </div>
  );
};
