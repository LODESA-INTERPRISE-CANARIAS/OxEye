/**
 * Honest sync status (M6, `syncStatus`): «Sincronizado» only when everything
 * saved here is on the server. Tapping it opens «Cambios pendientes» when
 * something waits on this device; otherwise it brings the data up to date
 * (or retries the server).
 */
import React, {useContext, useState} from 'react';
import {outboxCounts} from '../../../shared/logistics/outbox.ts';
import {syncStatus, type SyncState} from '../../../shared/logistics/sync.ts';
import {ActionsContext} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon, type IconName} from '../ui';

/** Short words for the phone top bar; the count goes in a badge. */
const COMPACT: Record<SyncState, string> = {
  synced: 'Sincronizado',
  syncing: 'Sincronizando',
  offline: 'Sin conexión',
  local_only: 'Solo aquí',
  attention: 'Por revisar',
};

const ICON: Partial<Record<SyncState, IconName>> = {
  offline: 'cloudOff',
  local_only: 'server',
  attention: 'alert',
};

/** The chip's status, shared with «Cambios pendientes». */
export function useSyncStatus() {
  const connection = useLogisticsStore(s => s.connection);
  const fromCache = useLogisticsStore(s => s.fromCache);
  const outbox = useLogisticsStore(s => s.outbox);
  const syncing = useLogisticsStore(s => s.syncing);
  const counts = outboxCounts(outbox);
  const status = syncStatus({
    browserOnline: connection !== 'offline',
    serverReachable: connection === 'online' && !fromCache,
    pending: counts.pending,
    needsReview: counts.needsReview,
    syncing,
  });
  return {status, waiting: counts.pending + counts.needsReview, ...counts};
}

/** «Datos de las 10:42» for the accessible name. */
export function lastSyncText(lastSyncAt: number | null): string | null {
  if (!lastSyncAt) return null;
  return new Date(lastSyncAt).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SyncChip: React.FC<{compact?: boolean; id?: string}> = ({
  compact = false,
  id = 'lx-sync-chip',
}) => {
  const lastSyncAt = useLogisticsStore(s => s.lastSyncAt);
  const syncNow = useLogisticsStore(s => s.syncNow);
  const actions = useContext(ActionsContext);
  const {status, waiting} = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const last = lastSyncText(lastSyncAt);
  const opensList = waiting > 0 && !!actions;
  const hint = opensList
    ? 'Toca para ver los cambios pendientes.'
    : status.state === 'synced'
      ? last
        ? `Datos actualizados a las ${last}. Toca para actualizar.`
        : 'Toca para actualizar.'
      : status.state === 'offline'
        ? last
          ? `Lo que ves se cargó a las ${last}.`
          : ''
        : 'Toca para reintentar.';
  const detail = [status.detail, hint].filter(Boolean).join(' ');
  const spinning = busy || status.state === 'syncing';
  const icon = ICON[status.state];

  return (
    <button
      type="button"
      id={id}
      className={`lx-sync lx-sync--${status.state}${compact ? ' lx-sync--compact' : ''}`}
      data-state={status.state}
      aria-label={`${status.label}. ${detail}`}
      title={detail}
      aria-busy={busy || undefined}
      aria-haspopup={opensList ? 'dialog' : undefined}
      onClick={async () => {
        if (opensList) {
          actions?.openOutbox();
          return;
        }
        if (busy) return;
        setBusy(true);
        try {
          await syncNow({full: true});
        } finally {
          setBusy(false);
        }
      }}
    >
      {spinning ? (
        <span className="lx-spinner lx-spinner--inline" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={16} />
      ) : (
        <span className="lx-sync__dot" aria-hidden="true" />
      )}
      <span className="lx-sync__label">
        {compact ? COMPACT[status.state] : status.label}
      </span>
      {compact && waiting > 0 && (
        <span className="lx-sync__count lx-num" aria-hidden="true">
          {waiting}
        </span>
      )}
    </button>
  );
};
