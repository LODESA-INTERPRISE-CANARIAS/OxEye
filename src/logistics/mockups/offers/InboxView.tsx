/**
 * «Recibidas»: proposals from suppliers (by link or registered by hand)
 * waiting for review. Only administrators approve or reject; approving
 * turns the proposal into a catalogue offer with its tariffs and dates.
 */
import React, {useState} from 'react';
import {Button, Chip, EmptyState, Field, Icon, Sheet, Textarea} from '../../ui';
import {
  CATEGORY_LABEL,
  OFFERS,
  PRICE_UNIT_LABEL,
  taxText,
  type MockProposal,
  type ProposalState,
} from '../data';
import {fmtDay} from '../dates';
import {Glyph} from '../glyphs';
import {useNotify} from '../kit';
import {eur} from '../pricing';
import {OfferBody} from './OfferDetail';

const TABS: {id: ProposalState; label: string}[] = [
  {id: 'pending', label: 'Pendientes'},
  {id: 'approved', label: 'Aprobadas'},
  {id: 'rejected', label: 'Rechazadas'},
];

const offerOf = (p: MockProposal) => OFFERS.find(o => o.id === p.offerId)!;

const ProposalSheet: React.FC<{
  proposal: MockProposal | null;
  isAdmin: boolean;
  onClose: () => void;
  onDecide: (id: string, state: ProposalState, reason?: string) => void;
  onCompare: () => void;
}> = ({proposal, isAdmin, onClose, onDecide, onCompare}) => {
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const offer = proposal ? offerOf(proposal) : null;
  const pending = proposal?.state === 'pending';

  let footer: React.ReactNode = <Button onClick={onClose}>Cerrar</Button>;
  if (proposal && pending && !isAdmin) {
    footer = (
      <>
        <p className="lx-mk-foot-note">
          <Icon name="lock" size={16} /> Solo un administrador puede aprobarla.
        </p>
        <Button onClick={onClose}>Cerrar</Button>
      </>
    );
  } else if (proposal && pending && confirm === 'approve') {
    footer = (
      <div className="lx-confirm-strip">
        <p>¿Incorporarla al catálogo con estas tarifas?</p>
        <div className="lx-confirm-strip__actions">
          <Button onClick={() => setConfirm(null)}>Volver</Button>
          <Button
            variant="primary"
            icon="check"
            id="mk-approve-confirm"
            onClick={() => onDecide(proposal.id, 'approved')}
          >
            Sí, aprobar
          </Button>
        </div>
      </div>
    );
  } else if (proposal && pending && confirm === 'reject') {
    footer = (
      <div className="lx-confirm-strip">
        <p>Se guarda con el motivo; la empresa no lo ve.</p>
        <div className="lx-confirm-strip__actions">
          <Button onClick={() => setConfirm(null)}>Volver</Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            onClick={() => onDecide(proposal.id, 'rejected', reason.trim())}
          >
            Rechazar
          </Button>
        </div>
      </div>
    );
  } else if (proposal && pending) {
    footer = (
      <>
        <Button onClick={() => setConfirm('reject')}>Rechazar</Button>
        <Button icon="scale" onClick={onCompare}>
          Comparar
        </Button>
        <span className="lx-sheet__foot-spacer" />
        <Button
          variant="primary"
          icon="check"
          id="mk-approve"
          onClick={() => setConfirm('approve')}
        >
          Aprobar
        </Button>
      </>
    );
  }

  return (
    <Sheet
      open={!!proposal}
      onClose={onClose}
      id="mk-proposal-sheet"
      eyebrow={offer ? `Propuesta · ${CATEGORY_LABEL[offer.category]}` : ''}
      title={offer?.company ?? ''}
      meta={
        proposal && (
          <>
            <Chip
              size="sm"
              certainty={
                proposal.state === 'approved' ? 'confirmed' : 'planned'
              }
              tone={proposal.state === 'rejected' ? 'neutral' : 'accent'}
            >
              {proposal.state === 'pending'
                ? 'Pendiente de aprobar'
                : proposal.state === 'approved'
                  ? 'Aprobada'
                  : 'Rechazada'}
            </Chip>
            <span className="lx-muted">
              {proposal.via} · {proposal.receivedAt}
            </span>
          </>
        )
      }
      footer={footer}
    >
      {proposal && offer && (
        <div className="lx-mk-stack">
          {proposal.flags.length > 0 && (
            <ul className="lx-mk-flags">
              {proposal.flags.map(f => (
                <li key={f}>
                  <Icon name="alert" size={15} /> {f}
                </li>
              ))}
            </ul>
          )}
          {proposal.diff && (
            <p className="lx-mk-diff lx-num">
              <Icon name="history" size={16} /> Cambia respecto a la versión
              anterior: <strong>{proposal.diff}</strong>
            </p>
          )}
          <h3 className="lx-mk-h3">{offer.product}</h3>
          <OfferBody offer={offer} versions={proposal.state !== 'pending'} />
          {confirm === 'approve' && (
            <div className="lx-notice lx-notice--success" role="status">
              <Icon name="check" size={18} />
              <span>
                Pasará al catálogo de contratación como versión {offer.version},
                vigente hasta el {fmtDay(offer.acceptUntil)}, firmada por ti. Un
                mes antes, Ox Eye creará la tarea de renegociarla.
              </span>
            </div>
          )}
          {confirm === 'reject' && (
            <Field
              id="mk-reject-reason"
              label="Motivo del rechazo"
              hint="Queda en el historial. Para contestar a la empresa, escríbele desde tu correo."
            >
              <Textarea
                id="mk-reject-reason"
                rows={2}
                value={reason}
                data-autofocus
                onChange={e => setReason(e.target.value)}
                aria-describedby="mk-reject-reason-hint"
              />
            </Field>
          )}
          {proposal.decidedBy && (
            <p className="lx-mk-signed">
              <Icon name="check" size={15} />
              {proposal.state === 'approved'
                ? 'Aprobada'
                : 'Rechazada'} por {proposal.decidedBy}
              {proposal.reason && ` · «${proposal.reason}»`}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
};

export const InboxView: React.FC<{
  proposals: MockProposal[];
  isAdmin: boolean;
  onDecide: (id: string, state: ProposalState, reason?: string) => void;
  onCompare: (needId: string) => void;
}> = ({proposals, isAdmin, onDecide, onCompare}) => {
  const notify = useNotify();
  const [tab, setTab] = useState<ProposalState>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = proposals.filter(p => p.state === tab);
  const open = proposals.find(p => p.id === openId) ?? null;

  return (
    <div className="lx-mk-view" id="mk-inbox">
      {!isAdmin && (
        <p className="lx-notice" id="mk-team-note">
          <Icon name="lock" size={18} />
          <span>
            Estás viendo como <strong>Equipo</strong>: puedes revisar las
            propuestas, pero solo un administrador las aprueba o rechaza.
          </span>
        </p>
      )}
      <div
        className="lx-segtabs lx-mk-segtabs3"
        role="tablist"
        aria-label="Estado"
      >
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="lx-segtabs__tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="lx-segtabs__count lx-num">
              {proposals.filter(p => p.state === t.id).length}
            </span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon="check"
          title={tab === 'pending' ? 'Todo revisado' : 'Nada por aquí'}
        >
          {tab === 'pending'
            ? 'Cuando una empresa responda a una solicitud, su propuesta aparecerá aquí.'
            : 'Las propuestas decididas aparecen aquí con quién y cuándo.'}
        </EmptyState>
      ) : (
        <ul className="lx-mk-inbox">
          {list.map(p => {
            const o = offerOf(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="lx-mk-prop"
                  data-proposal={p.id}
                  onClick={() => setOpenId(p.id)}
                >
                  <span className="lx-mk-prop__icon" aria-hidden="true">
                    <Glyph name={o.category} size={24} />
                  </span>
                  <span className="lx-mk-prop__main">
                    <span className="lx-mk-prop__company">{o.company}</span>
                    <span className="lx-mk-prop__product">{o.product}</span>
                    <span className="lx-mk-prop__meta">
                      {p.via} · {p.receivedAt}
                    </span>
                    {(p.flags.length > 0 || p.diff) && (
                      <span className="lx-mk-prop__flags">
                        {p.diff && (
                          <Chip size="sm" certainty="planned">
                            Renovación · {p.diff}
                          </Chip>
                        )}
                        {p.flags.map(f => (
                          <Chip
                            key={f}
                            size="sm"
                            certainty="planned"
                            tone={
                              f.startsWith('Falta') || f.includes('sin precio')
                                ? 'danger'
                                : 'accent'
                            }
                          >
                            {f}
                          </Chip>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="lx-mk-prop__price lx-num">
                    <strong>{eur(o.unitPrice)}</strong>
                    <span>{PRICE_UNIT_LABEL[o.priceUnit]}</span>
                    <span>{taxText(o.tax)}</span>
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
      )}
      <ProposalSheet
        key={openId ?? 'closed'}
        proposal={open}
        isAdmin={isAdmin}
        onClose={() => setOpenId(null)}
        onCompare={() => {
          const o = open ? offerOf(open) : null;
          setOpenId(null);
          if (o) onCompare(o.needIds[0]);
        }}
        onDecide={(id, state, reason) => {
          onDecide(id, state, reason);
          setOpenId(null);
          notify(
            state === 'approved'
              ? 'Aprobada e incorporada al catálogo · firmada por Yeray'
              : 'Propuesta rechazada · el motivo queda en el historial',
          );
        }}
      />
    </div>
  );
};
