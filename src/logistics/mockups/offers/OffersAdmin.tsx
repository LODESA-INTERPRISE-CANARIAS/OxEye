/**
 * F1 · Admin panel of offers and suppliers, inside the Gestor's look:
 * requests, received proposals, comparison of a concrete need and renewals.
 * A «Ver como» switch shows what a team member (not an administrator) sees.
 */
import React, {useState} from 'react';
import {Icon} from '../../ui';
import {
  PROPOSALS,
  REQUESTS,
  SUPPLIERS,
  type MockOffer,
  type MockProposal,
  type MockRequest,
} from '../data';
import {fmtDay} from '../dates';
import {MockShell, useNotify} from '../kit';
import {CompareView} from './CompareView';
import {InboxView} from './InboxView';
import {OfferDetailSheet} from './OfferDetail';
import {RenewalsView} from './RenewalsView';
import {RequestSheet, RequestsView, type RequestPrefill} from './RequestsView';

export type OffersView = 'requests' | 'inbox' | 'compare' | 'renewals';

const TITLE: Record<OffersView, [string, string]> = {
  requests: [
    'Solicitudes',
    'Pide presupuestos a una o varias empresas con un enlace personal',
  ],
  inbox: ['Recibidas', 'Propuestas de proveedores pendientes de revisar'],
  compare: [
    'Comparar',
    'El coste total de una necesidad concreta, con el impuesto de cada empresa',
  ],
  renewals: [
    'Renovaciones',
    'Ofertas que caducan pronto y tareas para renegociarlas',
  ],
};

export const OffersAdmin: React.FC<{
  initialView?: OffersView;
  onBack: () => void;
  onManual: () => void;
}> = ({initialView = 'inbox', onBack, onManual}) => {
  const notify = useNotify();
  const [view, setView] = useState<OffersView>(initialView);
  const [isAdmin, setIsAdmin] = useState(true);
  const [requests, setRequests] = useState<MockRequest[]>(REQUESTS);
  const [proposals, setProposals] = useState<MockProposal[]>(PROPOSALS);
  const [needId, setNeedId] = useState('n-carpas');
  const [offer, setOffer] = useState<MockOffer | null>(null);
  const [request, setRequest] = useState<{
    seq: number;
    prefill: RequestPrefill | null;
  } | null>(null);
  const pending = proposals.filter(p => p.state === 'pending').length;

  const openRequest = (prefill: RequestPrefill | null = null) =>
    setRequest({seq: Date.now(), prefill});

  const [title, subtitle] = TITLE[view];

  return (
    <>
      <MockShell<OffersView>
        id="mk-offers"
        navLabel="Contratación"
        nav={[
          {id: 'requests', label: 'Solicitudes', icon: 'send'},
          {id: 'inbox', label: 'Recibidas', icon: 'mail', badge: pending},
          {id: 'compare', label: 'Comparar', icon: 'scale'},
          {id: 'renewals', label: 'Renovaciones', icon: 'refresh', badge: 2},
        ]}
        active={view}
        onNav={setView}
        title={title}
        subtitle={subtitle}
        user={{
          name: isAdmin ? 'Yeray' : 'Equipo',
          role: isAdmin ? 'Administrador' : 'Equipo',
        }}
        onBack={onBack}
        actions={
          <div className="lx-mk-viewas" role="group" aria-label="Ver como">
            <span className="lx-mk-viewas__label">
              <Icon name="eye" size={16} /> Ver como
            </span>
            <button
              type="button"
              aria-pressed={isAdmin}
              onClick={() => setIsAdmin(true)}
            >
              Administrador
            </button>
            <button
              type="button"
              aria-pressed={!isAdmin}
              onClick={() => setIsAdmin(false)}
              id="mk-viewas-team"
            >
              Equipo
            </button>
          </div>
        }
      >
        {view === 'requests' && (
          <RequestsView
            requests={requests}
            onNew={() => openRequest()}
            onManual={onManual}
            onAnswers={() => setView('inbox')}
          />
        )}
        {view === 'inbox' && (
          <InboxView
            proposals={proposals}
            isAdmin={isAdmin}
            onDecide={(id, state, reason) =>
              setProposals(ps =>
                ps.map(p =>
                  p.id === id
                    ? {...p, state, reason, decidedBy: 'Yeray · ahora'}
                    : p,
                ),
              )
            }
            onCompare={id => {
              setNeedId(id);
              setView('compare');
            }}
          />
        )}
        {view === 'compare' && (
          <CompareView
            needId={needId}
            onNeed={setNeedId}
            onOpen={setOffer}
            onRequest={() => openRequest()}
          />
        )}
        {view === 'renewals' && (
          <RenewalsView
            isAdmin={isAdmin}
            onRenegotiate={t =>
              openRequest({
                resourceId: t.offerId === 'o-mario' ? 'carpa66' : 'aseo',
                supplierIds: t.offerId === 'o-mario' ? ['s-mario'] : [],
                renewal: `Tu precio actual vence el ${t.expires}. ¿Nos indicas las condiciones para el próximo periodo?`,
              })
            }
          />
        )}
      </MockShell>
      <OfferDetailSheet
        offer={offer}
        onClose={() => setOffer(null)}
        onRenegotiate={o => {
          setOffer(null);
          openRequest({
            resourceId:
              o.category === 'carpas'
                ? 'carpa66'
                : o.category === 'limpieza'
                  ? 'limpieza'
                  : 'castillo',
            supplierIds: [o.supplierId].filter(id =>
              SUPPLIERS.some(s => s.id === id),
            ),
            renewal: `Tu precio actual vence el ${fmtDay(o.acceptUntil)}. ¿Nos indicas las condiciones para el próximo periodo?`,
          });
        }}
      />
      {request && (
        <RequestSheet
          key={request.seq}
          open
          prefill={request.prefill}
          onClose={() => setRequest(null)}
          onDone={r => {
            setRequests(rs => [r, ...rs]);
            setRequest(null);
            setView('requests');
            notify('Solicitud guardada. Verás aquí quién responde.');
          }}
        />
      )}
    </>
  );
};
