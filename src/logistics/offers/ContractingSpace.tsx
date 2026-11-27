/**
 * «Catálogo» with its contracting views (Revisión 1 · E6–E7): the offers
 * list, «Solicitudes» (requests for quotes and their links), «Recibidas»
 * (proposals waiting for an administrator) and «Renovaciones» (offers about
 * to expire). «Pedir presupuesto» is always at hand on the tab row.
 *
 * Guests never see the contracting views (every E6/E7 route answers them
 * 403): they keep the offers list as before. The chosen view is kept for
 * the tab.
 */
import React, {useRef, useState} from 'react';
import {useAccess} from '../account/useAccess';
import {useActions} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, type IconName} from '../ui';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import {refreshOffersData, useProposals, useRenewals} from './data';
import {InboxView} from './InboxView';
import {RenewalsView} from './RenewalsView';
import {RequestSheet, type RequestPrefill} from './RequestSheet';
import {RequestsView} from './RequestsView';

export type ContractingView = 'offers' | 'requests' | 'inbox' | 'renewals';

const TAB_KEY = 'oxeye.logistics.catalog.view';

const TABS: {id: ContractingView; label: string; icon: IconName}[] = [
  {id: 'offers', label: 'Ofertas', icon: 'catalog'},
  {id: 'requests', label: 'Solicitudes', icon: 'send'},
  {id: 'inbox', label: 'Recibidas', icon: 'mail'},
  {id: 'renewals', label: 'Renovaciones', icon: 'refresh'},
];

function storedView(): ContractingView {
  try {
    const v = sessionStorage.getItem(TAB_KEY);
    return TABS.some(t => t.id === v) ? (v as ContractingView) : 'offers';
  } catch {
    return 'offers';
  }
}

export const ContractingSpace: React.FC<{offers: React.ReactNode}> = ({
  offers,
}) => {
  const access = useAccess();
  const member = useLogisticsStore(s => s.session?.user.role === 'member');
  const enabled = member && access.can('directory.read');
  if (!enabled) return <>{offers}</>;
  return <Tabs offers={offers} />;
};

/**
 * «Actualizar»: what companies answered and the state of each link change on
 * the server; the lists also reload by themselves (view opened, tab back in
 * view, a sync), this is for when someone is waiting for an answer.
 */
const Refresh: React.FC = () => {
  const {timeZone} = useActions();
  // Only the user's own refresh spins; quiet reloads stay quiet.
  const [refreshing, setRefreshing] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const run = () => {
    setRefreshing(true);
    void refreshOffersData().then(() => {
      setRefreshing(false);
      setAt(utcToLocal(new Date().toISOString(), timeZone).time);
    });
  };
  return (
    <span className="lx-contracting__refresh">
      <span className="lx-field__hint lx-num" role="status">
        {at && !refreshing ? `Actualizado a las ${at}` : ''}
      </span>
      <Button
        variant="ghost"
        icon="refresh"
        id="lx-contracting-refresh"
        busy={refreshing}
        onClick={run}
      >
        Actualizar
      </Button>
    </span>
  );
};

const Tabs: React.FC<{offers: React.ReactNode}> = ({offers}) => {
  const {canWrite} = useActions();
  const [view, setView] = useState<ContractingView>(storedView);
  const [request, setRequest] = useState<{
    seq: number;
    prefill: RequestPrefill | null;
  } | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Badges: always loaded, so «Recibidas» says what waits from any view.
  const proposals = useProposals();
  const renewals = useRenewals();
  const pending = (proposals.data ?? []).filter(
    p => p.state === 'pending',
  ).length;
  const toRenew = (renewals.data ?? []).filter(r => !r.resolvedAt).length;
  const badge: Partial<Record<ContractingView, number>> = {
    inbox: pending,
    renewals: toRenew,
  };

  const choose = (v: ContractingView) => {
    setView(v);
    try {
      sessionStorage.setItem(TAB_KEY, v);
    } catch {
      // The view simply resets next time.
    }
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? TABS.length - 1
          : (i + step + TABS.length) % TABS.length;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    choose(TABS[to].id);
    tabRefs.current[to]?.focus();
  };

  return (
    <div className="lx-contracting" id="lx-catalog-space">
      <div className="lx-contracting__bar">
        <div
          className="lx-segtabs lx-contracting__tabs"
          role="tablist"
          aria-label="Catálogo y contratación"
        >
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={el => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`lx-ctab-${t.id}`}
              aria-controls="lx-ctab-panel"
              aria-selected={view === t.id}
              tabIndex={view === t.id ? 0 : -1}
              className="lx-segtabs__tab"
              onClick={() => choose(t.id)}
              onKeyDown={e => onKey(e, i)}
            >
              <Icon name={t.icon} size={17} />
              <span>{t.label}</span>
              {!!badge[t.id] && (
                <span className="lx-segtabs__count lx-num">
                  {badge[t.id]}
                  <span className="lx-visually-hidden"> pendientes</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="lx-contracting__actions">
          {view !== 'offers' && <Refresh />}
          {canWrite && (
            <Button
              variant={view === 'requests' ? 'primary' : 'secondary'}
              icon="send"
              id="lx-request-new"
              onClick={() => setRequest({seq: Date.now(), prefill: null})}
            >
              Pedir presupuesto
            </Button>
          )}
        </div>
      </div>
      <div
        role="tabpanel"
        id="lx-ctab-panel"
        aria-labelledby={`lx-ctab-${view}`}
        className="lx-contracting__panel"
      >
        {view === 'offers' ? (
          offers
        ) : view === 'requests' ? (
          <RequestsView
            onNew={() => setRequest({seq: Date.now(), prefill: null})}
          />
        ) : view === 'inbox' ? (
          <InboxView />
        ) : (
          <RenewalsView />
        )}
      </div>
      {request && (
        <RequestSheet
          key={request.seq}
          prefill={request.prefill}
          onClose={() => setRequest(null)}
          onCreated={() => choose('requests')}
        />
      )}
    </div>
  );
};
