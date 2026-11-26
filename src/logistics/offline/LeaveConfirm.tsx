/**
 * Leaving with changes that never reached the server (M6): logout and
 * changing organization wipe this device's copy, so they ask first. Nothing
 * is dropped without «Salir y descartarlos».
 */
import React, {useState} from 'react';
import {isUnresolved} from './local';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Sheet} from '../ui';
import {plural} from '../lib/format';

const SHOWN = 5;

/** Resolves once no replay is running (one may have started earlier). */
function replayDone(): Promise<void> {
  return new Promise(resolve => {
    if (!useLogisticsStore.getState().syncing) {
      resolve();
      return;
    }
    const stop = useLogisticsStore.subscribe(s => {
      if (s.syncing) return;
      stop();
      resolve();
    });
  });
}

export const LeaveConfirm: React.FC = () => {
  const leave = useLogisticsStore(s => s.leave);
  const outbox = useLogisticsStore(s => s.outbox);
  const connection = useLogisticsStore(s => s.connection);
  const fromCache = useLogisticsStore(s => s.fromCache);
  const organizations = useLogisticsStore(s => s.organizations);
  const cancelLeave = useLogisticsStore(s => s.cancelLeave);
  const logout = useLogisticsStore(s => s.logout);
  const selectOrg = useLogisticsStore(s => s.selectOrg);
  const syncNow = useLogisticsStore(s => s.syncNow);
  const [sending, setSending] = useState(false);
  const [left, setLeft] = useState<string | null>(null);

  if (!leave) return null;
  const unsent = outbox.filter(isUnresolved);
  const count = unsent.length;
  const reachable = connection !== 'offline';
  const toOrg =
    leave.kind === 'org'
      ? (organizations.find(o => o.id === leave.orgId)?.name ??
        'otra organización')
      : null;

  const proceed = () => {
    if (leave.kind === 'logout') void logout({discardUnsent: true});
    else selectOrg(leave.orgId, {discardUnsent: true});
  };

  const sendFirst = async () => {
    setSending(true);
    setLeft(null);
    try {
      // A replay already under way would make this pass return at once:
      // wait for it, send what is left, and only then count.
      await replayDone();
      await syncNow({full: fromCache, now: true});
      await replayDone();
    } finally {
      setSending(false);
    }
    const still = useLogisticsStore.getState().outbox.filter(isUnresolved);
    if (!still.length) {
      // Everything went through: leave as asked, nothing is lost.
      proceed();
      return;
    }
    setLeft(
      `Quedan ${plural(still.length, 'cambio sin enviar', 'cambios sin enviar')}. Revísalos en «Cambios pendientes» o descártalos.`,
    );
  };

  return (
    <Sheet
      open
      size="sm"
      role="alertdialog"
      id="lx-leave-confirm"
      onClose={() => !sending && cancelLeave()}
      eyebrow={
        leave.kind === 'logout' ? 'Cerrar sesión' : 'Cambiar de organización'
      }
      title={`Tienes ${plural(count, 'cambio sin enviar', 'cambios sin enviar')}`}
      footer={
        <div className="lx-leave__actions">
          {reachable && (
            <Button
              variant="primary"
              icon="refresh"
              id="lx-leave-send"
              busy={sending}
              data-autofocus
              onClick={() => void sendFirst()}
            >
              Enviar ahora
            </Button>
          )}
          <Button
            variant="danger"
            icon="trash"
            id="lx-leave-discard"
            disabled={sending}
            onClick={proceed}
          >
            {leave.kind === 'logout'
              ? 'Salir y descartarlos'
              : 'Cambiar y descartarlos'}
          </Button>
          <Button
            variant="ghost"
            id="lx-leave-cancel"
            disabled={sending}
            data-autofocus={reachable ? undefined : true}
            onClick={cancelLeave}
          >
            Cancelar
          </Button>
        </div>
      }
    >
      <div className="lx-leave">
        <p>
          {count === 1 ? 'Está' : 'Están'} guardado{count === 1 ? '' : 's'} solo
          en este dispositivo.{' '}
          {leave.kind === 'logout'
            ? 'Al cerrar sesión se borra la copia de este dispositivo (otra persona puede usarlo después)'
            : `Al cambiar a ${toOrg} se borra la copia de esta organización`}
          {', y con ella '}
          {count === 1 ? 'este cambio' : 'estos cambios'}.
        </p>
        <ul className="lx-leave__list">
          {unsent.slice(0, SHOWN).map(e => (
            <li key={e.id}>
              <span className="lx-chip__dot" aria-hidden="true" />
              {e.label}
            </li>
          ))}
          {count > SHOWN && (
            <li className="lx-muted">
              y {plural(count - SHOWN, 'cambio más', 'cambios más')}
            </li>
          )}
        </ul>
        {!reachable && (
          <p className="lx-notice">
            <Icon name="cloudOff" size={18} />
            <span>
              Sin conexión no se pueden enviar ahora. Si puedes esperar, cancela
              y sal cuando vuelva la cobertura.
            </span>
          </p>
        )}
        {left && (
          <p className="lx-notice lx-notice--error" role="alert">
            <Icon name="alert" size={18} />
            <span>{left}</span>
          </p>
        )}
      </div>
    </Sheet>
  );
};
