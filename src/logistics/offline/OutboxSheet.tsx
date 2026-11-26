/**
 * «Cambios pendientes» (M6): what is saved only on this device, in the order
 * it will be sent, and what each change needs. Opened from the sync chip.
 *
 * - Waiting changes go out by themselves; «Reintentar ahora» skips the wait.
 * - A conflict or a rejected change offers «Revisar» (the record's sheet with
 *   the merge or the errors already applied); a duplicate name also offers
 *   «Usar la existente».
 * - «Descartar» always asks first and says exactly what is lost.
 */
import React, {useState} from 'react';
import type {OutboxEntry} from '../../../shared/logistics/outbox.ts';
import {DEFAULT_TIMEZONE} from '../../../shared/logistics/time.ts';
import {plural, relativeTime} from '../lib/format';
import {lastSyncText, useSyncStatus} from '../shell/SyncChip';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, EmptyState, HelpTip, Icon, Sheet} from '../ui';

const HELP =
  'Cuando no hay cobertura o el servidor no responde, lo que guardas se queda en este dispositivo y se envía solo, en el mismo orden, en cuanto vuelve la conexión. Si otra persona cambió lo mismo mientras tanto, nada se sobrescribe: te lo enseñamos para que elijas.';

type EntryKind =
  'waiting' | 'sending' | 'retry' | 'conflict' | 'duplicate' | 'rejected';

function kindOf(e: OutboxEntry): EntryKind {
  if (e.status === 'sending') return 'sending';
  if (e.status === 'conflict') {
    return e.error?.code === 'DUPLICATE' ? 'duplicate' : 'conflict';
  }
  if (e.status === 'rejected') return 'rejected';
  return e.error ? 'retry' : 'waiting';
}

const KIND_LABEL: Record<EntryKind, string> = {
  waiting: 'En espera',
  sending: 'Enviando…',
  retry: 'Se reintentará',
  conflict: 'Otra persona lo cambió',
  duplicate: 'Ese nombre ya existe',
  rejected: 'El servidor no lo aceptó',
};

/** What «Descartar» loses, in plain words. */
function lossText(e: OutboxEntry, later: number): string {
  if (e.op === 'create') {
    return later
      ? `El registro nuevo y ${later === 1 ? 'el cambio posterior' : `los ${later} cambios posteriores`} no llegarán al servidor y desaparecerán de este dispositivo.`
      : 'El registro nuevo no llegará al servidor y desaparecerá de este dispositivo.';
  }
  return 'Tus cambios en este registro no llegarán al servidor; se queda la versión que tiene el servidor.';
}

const EntryRow: React.FC<{
  entry: OutboxEntry;
  later: number;
  timeZone: string;
  canSend: boolean;
  onReview: (entry: OutboxEntry) => void;
  onUseExisting: (entry: OutboxEntry) => void;
}> = ({entry, later, timeZone, canSend, onReview, onUseExisting}) => {
  const retryEntry = useLogisticsStore(s => s.retryEntry);
  const discardEntry = useLogisticsStore(s => s.discardEntry);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<'retry' | 'discard' | null>(null);
  const kind = kindOf(entry);
  const needsPerson =
    kind === 'conflict' || kind === 'duplicate' || kind === 'rejected';
  // An edit of a record the server no longer has: only discarding helps.
  const gone = entry.op === 'update' && entry.error?.code === 'NOT_FOUND';
  const existing =
    kind === 'duplicate' &&
    entry.op === 'create' &&
    entry.current &&
    typeof entry.current === 'object';
  const next =
    entry.nextAttemptAt && entry.nextAttemptAt > Date.now()
      ? new Date(entry.nextAttemptAt).toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone,
        })
      : null;
  const domId = `lx-outbox-${entry.id}`;

  return (
    <li
      className={`lx-outbox__item lx-outbox__item--${kind}`}
      data-outbox-entry={entry.id}
      data-status={entry.status}
      aria-labelledby={`${domId}-label`}
    >
      <div className="lx-outbox__head">
        <span className="lx-outbox__mark" aria-hidden="true">
          {needsPerson ? (
            <Icon name="alert" size={16} />
          ) : kind === 'sending' ? (
            <span className="lx-spinner lx-spinner--inline" />
          ) : (
            <span className="lx-chip__dot" />
          )}
        </span>
        <div className="lx-outbox__titles">
          <p className="lx-outbox__label" id={`${domId}-label`}>
            {entry.label}
          </p>
          <p className="lx-outbox__meta">
            <span className="lx-outbox__state">{KIND_LABEL[kind]}</span>
            {' · '}
            <span>
              Guardado{' '}
              <time dateTime={entry.queuedAt}>
                {relativeTime(entry.queuedAt, timeZone)}
              </time>
            </span>
            {entry.attempts > 0 && !needsPerson && (
              <>
                {' · '}
                <span className="lx-num">
                  {plural(entry.attempts, 'intento', 'intentos')}
                </span>
              </>
            )}
            {next && kind === 'retry' && (
              <>
                {' · '}
                <span>
                  próximo a las <span className="lx-num">{next}</span>
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {entry.error && kind !== 'waiting' && (
        <p className="lx-outbox__error">
          {kind === 'conflict'
            ? 'Nada se ha sobrescrito. Revisa qué cambió y elige qué se queda.'
            : gone
              ? 'Este registro ya no existe en el servidor: solo puedes descartar el cambio.'
              : entry.error.message}
        </p>
      )}
      {entry.dropped.includes('subsoilReviewed') && (
        <p className="lx-outbox__note">
          <Icon name="weight" size={14} />
          «Subsuelo revisado» se retiró: la tarea cambió de lugar, de carga o de
          recursos mientras tanto.
        </p>
      )}

      {asking ? (
        <div
          className="lx-outbox__confirm"
          role="group"
          aria-labelledby={`${domId}-confirm`}
        >
          <p id={`${domId}-confirm`}>
            <strong>¿Descartar «{entry.label}»?</strong>{' '}
            {lossText(entry, later)}
          </p>
          <div className="lx-outbox__actions">
            <Button
              size="sm"
              variant="danger"
              icon="trash"
              busy={busy === 'discard'}
              data-autofocus
              id={`${domId}-discard-yes`}
              onClick={async () => {
                setBusy('discard');
                try {
                  await discardEntry(entry.id);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Descartar el cambio
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              Conservar
            </Button>
          </div>
        </div>
      ) : (
        <div className="lx-outbox__actions">
          {needsPerson && !gone && (
            <Button
              size="sm"
              variant="primary"
              icon="edit"
              id={`${domId}-review`}
              onClick={() => onReview(entry)}
            >
              Revisar
            </Button>
          )}
          {existing && (
            <Button
              size="sm"
              icon="eye"
              id={`${domId}-existing`}
              onClick={() => onUseExisting(entry)}
            >
              Usar la existente
            </Button>
          )}
          {(kind === 'retry' ||
            kind === 'waiting' ||
            (kind === 'rejected' && !gone)) && (
            <Button
              size="sm"
              icon="refresh"
              id={`${domId}-retry`}
              busy={busy === 'retry'}
              disabled={!canSend}
              title={canSend ? undefined : 'Necesita conexión con el servidor.'}
              onClick={async () => {
                setBusy('retry');
                try {
                  await retryEntry(entry.id);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Reintentar ahora
            </Button>
          )}
          {kind !== 'sending' && (
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              id={`${domId}-discard`}
              onClick={() => setAsking(true)}
            >
              Descartar
            </Button>
          )}
        </div>
      )}
    </li>
  );
};

export const OutboxSheet: React.FC<{
  onClose: () => void;
  /** Opens the record's sheet with the server's answer applied. */
  onReview: (entry: OutboxEntry) => void;
  /** DUPLICATE: drop the queued record and open the one that exists. */
  onUseExisting: (entry: OutboxEntry) => void;
}> = ({onClose, onReview, onUseExisting}) => {
  const outbox = useLogisticsStore(s => s.outbox);
  const connection = useLogisticsStore(s => s.connection);
  const lastSyncAt = useLogisticsStore(s => s.lastSyncAt);
  const syncNow = useLogisticsStore(s => s.syncNow);
  const timeZone = useLogisticsStore(
    s =>
      s.organizations.find(o => o.id === s.orgId)?.timezone || DEFAULT_TIMEZONE,
  );
  const {status, waiting} = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const online = connection !== 'offline';
  const last = lastSyncText(lastSyncAt);
  const ordered = [...outbox].sort((a, b) => a.seq - b.seq);
  const laterOf = (e: OutboxEntry) =>
    ordered.filter(o => o.recordId === e.recordId && o.seq > e.seq).length;
  const needs = ordered.filter(
    e => e.status === 'conflict' || e.status === 'rejected',
  );
  const rest = ordered.filter(
    e => e.status !== 'conflict' && e.status !== 'rejected',
  );

  const send = async () => {
    setBusy(true);
    try {
      await syncNow({now: true});
    } finally {
      setBusy(false);
    }
  };

  const row = (e: OutboxEntry) => (
    <EntryRow
      key={e.id}
      entry={e}
      later={laterOf(e)}
      timeZone={timeZone}
      canSend={online}
      onReview={onReview}
      onUseExisting={onUseExisting}
    />
  );

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-outbox-sheet"
      className="lx-outbox-sheet"
      eyebrow="En este dispositivo"
      title={
        <>
          Cambios pendientes
          <HelpTip label="cambios pendientes">{HELP}</HelpTip>
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="lx-outbox-close">
            Cerrar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            variant="primary"
            icon="refresh"
            id="lx-outbox-send"
            busy={busy}
            disabled={!online || !waiting}
            onClick={() => void send()}
          >
            Enviar ahora
          </Button>
        </>
      }
    >
      <div className="lx-outbox">
        <div
          className={`lx-outbox__status lx-outbox__status--${status.state}`}
          role="status"
          id="lx-outbox-status"
        >
          <Icon
            name={
              status.state === 'offline'
                ? 'cloudOff'
                : status.state === 'local_only'
                  ? 'server'
                  : status.state === 'attention'
                    ? 'alert'
                    : 'check'
            }
            size={20}
          />
          <div>
            <p className="lx-outbox__status-label">{status.label}</p>
            <p>
              {status.detail}
              {!online &&
                ' «Enviar ahora» estará disponible al volver la conexión.'}
            </p>
            {last && (
              <p className="lx-muted">
                Última actualización desde el servidor: {last}.
              </p>
            )}
          </div>
        </div>

        {!ordered.length ? (
          <EmptyState
            id="lx-outbox-empty"
            icon="check"
            compact
            title="No hay cambios pendientes"
          >
            Todo lo que has guardado está en el servidor.
          </EmptyState>
        ) : (
          <>
            {needs.length > 0 && (
              <section aria-labelledby="lx-outbox-needs-title">
                <h3 className="lx-subsection__title" id="lx-outbox-needs-title">
                  Necesitan que decidas ({needs.length})
                </h3>
                <ol className="lx-outbox__list">{needs.map(row)}</ol>
              </section>
            )}
            {rest.length > 0 && (
              <section aria-labelledby="lx-outbox-rest-title">
                <h3 className="lx-subsection__title" id="lx-outbox-rest-title">
                  Se enviarán solos, en este orden ({rest.length})
                </h3>
                <ol className="lx-outbox__list">{rest.map(row)}</ol>
              </section>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
};
