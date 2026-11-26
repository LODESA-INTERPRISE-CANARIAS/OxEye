/**
 * Honest connection status. Tapping it refreshes the data (or retries when
 * the server was not reachable).
 */
import React, {useState} from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon} from '../ui';

const LABEL = {
  online: 'Conectado',
  offline: 'Sin conexión',
  unavailable: 'Servidor no disponible',
} as const;

export const SyncChip: React.FC<{compact?: boolean; id?: string}> = ({
  compact = false,
  id = 'lx-sync-chip',
}) => {
  const connection = useLogisticsStore(s => s.connection);
  const lastSyncAt = useLogisticsStore(s => s.lastSyncAt);
  const refresh = useLogisticsStore(s => s.refresh);
  const [busy, setBusy] = useState(false);

  const last = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const detail =
    connection === 'online'
      ? last
        ? `Datos actualizados a las ${last}. Toca para actualizar.`
        : 'Toca para actualizar.'
      : connection === 'offline'
        ? 'El dispositivo no tiene conexión. Lo que ves es lo último que se cargó.'
        : 'No se puede contactar con el servidor. Toca para reintentar.';

  return (
    <button
      type="button"
      id={id}
      className={`lx-sync lx-sync--${connection}${compact ? ' lx-sync--compact' : ''}`}
      data-state={connection}
      aria-label={`${LABEL[connection]}. ${detail}`}
      title={detail}
      aria-busy={busy || undefined}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await refresh({silent: true});
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <span className="lx-spinner lx-spinner--inline" aria-hidden="true" />
      ) : connection === 'online' ? (
        <span className="lx-sync__dot" aria-hidden="true" />
      ) : (
        <Icon name="cloudOff" size={16} />
      )}
      <span className="lx-sync__label">{LABEL[connection]}</span>
    </button>
  );
};
